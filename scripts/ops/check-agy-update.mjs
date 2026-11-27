#!/usr/bin/env node
// AGY Changelog & Local i18n Coverage Ops Script (0-Token, MIT).
// Usage:
//   node scripts/ops/check-agy-update.mjs [--push] [--all]
// Checks https://antigravity.google/docs/changelog for the latest Antigravity App release,
// compares against cached last-seen version in PLUGIN_DATA/ops-state.json, and optionally
// pushes a concise update alert via Claude Studio's configured notify.json (--push).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const CHANGELOG_URL = 'https://antigravity.google/docs/changelog';
const args = new Set(process.argv.slice(2));
const shouldPush = args.has('--push');
const showAll = args.has('--all');

function resolveDataDir() {
  return (
    process.env.PLUGIN_DATA ||
    process.env.AGY_CLAUDE_STUDIO_DATA_DIR ||
    path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-claude-studio')
  );
}

function readOpsState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeOpsState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseLatestReleases(text, limit = 2) {
  const start = text.indexOf('Antigravity App\nv');
  if (start < 0) return [];
  const slice = text.slice(start, start + 24000);
  const lines = slice.split('\n').map((l) => l.trim()).filter(Boolean);
  const releases = [];
  let current = null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^Antigravity (CLI|IDE|SDK)/.test(line)) break;
    if (/^v\d+\.\d+\.\d+$/.test(line)) {
      if (current) releases.push(current);
      if (releases.length >= limit) break;
      current = { version: line, date: '', headline: '', bullets: [] };
      continue;
    }
    if (!current) continue;
    if (line === 'Latest') continue;
    if (!current.date && /^[A-Z][a-z]+ \d{1,2}, 20\d{2}$/.test(line)) {
      current.date = line;
      continue;
    }
    if (!current.headline && line.length > 10 && !/^(Improvements|Fixes)/.test(line)) {
      current.headline = line;
      continue;
    }
    if (line.length > 20 && current.bullets.length < 12) {
      current.bullets.push(line);
    }
  }
  if (current && releases.length < limit) releases.push(current);
  return releases;
}

function countLocalI18nEntries() {
  const localesPath = path.join(REPO_ROOT, 'src', 'i18n-locales.js');
  if (!fs.existsSync(localesPath)) return null;
  try {
    const src = fs.readFileSync(localesPath, 'utf8');
    const exactMatches = src.match(/^\s*\[['"`]/gm) || [];
    return exactMatches.length;
  } catch {
    return null;
  }
}

async function main() {
  const res = await fetch(CHANGELOG_URL, {
    headers: { 'User-Agent': 'ClaudeStudioOps/1.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${CHANGELOG_URL}`);
  }
  const html = await res.text();
  const text = stripHtml(html);
  const releases = parseLatestReleases(text, showAll ? 3 : 2);
  if (!releases.length) {
    throw new Error('Could not parse Antigravity App releases from changelog');
  }

  const latest = releases[0];
  const dataDir = resolveDataDir();
  const statePath = path.join(dataDir, 'ops-state.json');
  const state = readOpsState(statePath);
  const prevVersion = state.lastAgyVersion || '';
  const isNew = Boolean(prevVersion && prevVersion !== latest.version);

  const i18nCount = countLocalI18nEntries();
  const statusTag = isNew
    ? `🆕 发现新版本 ${latest.version}（上次记录：${prevVersion}）`
    : prevVersion
    ? `✅ 当前最新 ${latest.version}（无新版本）`
    : `📌 首次记录最新 ${latest.version}`;

  const lines = [
    `${statusTag} · ${latest.date || '未知日期'}`,
    `标题：${latest.headline || '—'}`,
  ];
  if (i18nCount !== null) {
    lines.push(`本地 i18n-locales.js 词条约 ${i18nCount} 条`);
  }

  for (const rel of releases) {
    lines.push('');
    lines.push(`=== ${rel.version} (${rel.date || '-'}) ===`);
    if (rel.headline) lines.push(rel.headline);
    for (const b of rel.bullets.slice(0, 6)) {
      lines.push(`- ${b}`);
    }
  }

  const report = lines.join('\n');
  console.log(report);

  state.lastAgyVersion = latest.version;
  state.lastAgyCheckAt = new Date().toISOString();
  writeOpsState(statePath, state);

  if (shouldPush && isNew) {
    try {
      const notifyCore = require(path.join(REPO_ROOT, 'src', 'notify-core.js'));
      const cfg = notifyCore.readNotifyConfig(dataDir);
      if (cfg.enabled && notifyCore.isChannelConfigured(cfg)) {
        const pushRes = await notifyCore.deliverNotification(cfg, {
          title: `Antigravity 新版本 ${latest.version}`,
          body: report,
          level: 'info',
          workspace: 'agy-claude-studio',
          durationSec: 0,
          terminationReason: 'OPS_CHECK',
          timestamp: new Date().toISOString(),
        });
        console.log(`\n[Push] ${pushRes.ok ? '已推送' : '推送失败: ' + (pushRes.error || pushRes.status)}`);
      }
    } catch (err) {
      console.error('[Push] error:', err?.message || err);
    }
  }
}

main().catch((err) => {
  console.error('AGY 更新巡检失败:', err?.message || err);
  process.exit(1);
});
