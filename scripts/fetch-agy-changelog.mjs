#!/usr/bin/env node
// Antigravity Official Changelog & Version (ver) Fetcher (0-Token, MIT).
// Usage:
//   node scripts/fetch-agy-changelog.mjs [--all] [--json] [--push]
// Fetches https://antigravity.google/docs/changelog for the latest Antigravity App release,
// compares against cached last-seen version in PLUGIN_DATA/agy-changelog-state.json, and prints
// version, release date, headline, and changelog items (optionally pushing on new release via --push).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const CHANGELOG_URL = 'https://antigravity.google/docs/changelog';
const args = new Set(process.argv.slice(2));
const shouldPush = args.has('--push');
const showAll = args.has('--all');
const asJson = args.has('--json');

function resolveDataDir() {
  return (
    process.env.PLUGIN_DATA ||
    process.env.AGY_CLAUDE_STUDIO_DATA_DIR ||
    path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-claude-studio')
  );
}

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(filePath, state) {
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
  const slice = text.slice(start, start + 32000);
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
    if (line.length > 16 && current.bullets.length < 16) {
      current.bullets.push(line);
    }
  }
  if (current && releases.length < limit) releases.push(current);
  return releases;
}

async function main() {
  const res = await fetch(CHANGELOG_URL, {
    headers: { 'User-Agent': 'ClaudeStudioChangelog/1.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${CHANGELOG_URL}`);
  }
  const html = await res.text();
  const text = stripHtml(html);
  const releases = parseLatestReleases(text, showAll ? 5 : 2);
  if (!releases.length) {
    throw new Error('Could not parse Antigravity App releases from changelog');
  }

  const latest = releases[0];
  const dataDir = resolveDataDir();
  const statePath = path.join(dataDir, 'agy-changelog-state.json');
  const state = readState(statePath);
  const prevVersion = state.lastAgyVersion || '';
  const isNew = Boolean(prevVersion && prevVersion !== latest.version);

  const statusTag = isNew
    ? `🆕 发现新版本 ${latest.version}（上次记录：${prevVersion}）`
    : prevVersion
    ? `✅ 当前最新 ${latest.version}（无新版本）`
    : `📌 当前最新 ${latest.version}`;

  const lines = [
    `${statusTag} · ${latest.date || '未知日期'}`,
    `标题：${latest.headline || '—'}`,
  ];

  for (const rel of releases) {
    lines.push('');
    lines.push(`=== ${rel.version} (${rel.date || '-'}) ===`);
    if (rel.headline) lines.push(rel.headline);
    for (const b of rel.bullets.slice(0, showAll ? 12 : 8)) {
      lines.push(`- ${b}`);
    }
  }

  const report = lines.join('\n');
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          latestVersion: latest.version,
          previousVersion: prevVersion || null,
          isNew,
          date: latest.date || null,
          headline: latest.headline || '',
          releases,
        },
        null,
        2
      )
    );
  } else {
    console.log(report);
  }

  state.lastAgyVersion = latest.version;
  state.lastAgyCheckAt = new Date().toISOString();
  writeState(statePath, state);

  if (shouldPush && isNew) {
    try {
      const notifyCore = require(path.join(REPO_ROOT, 'notify-core.js'));
      const cfg = notifyCore.readNotifyConfig(dataDir);
      if (cfg.enabled && notifyCore.isChannelConfigured(cfg)) {
        const pushRes = await notifyCore.deliverNotification(cfg, {
          title: `Antigravity 新版本 ${latest.version}`,
          body: report,
          level: 'info',
          workspace: 'Antigravity',
          durationSec: 0,
          terminationReason: 'CHANGELOG_CHECK',
          timestamp: new Date().toISOString(),
        });
        if (!asJson) {
          console.log(`\n[Push] ${pushRes.ok ? '已推送' : '推送失败: ' + (pushRes.error || pushRes.status)}`);
        }
      }
    } catch (err) {
      console.error('[Push] error:', err?.message || err);
    }
  }
}

main().catch((err) => {
  console.error('Antigravity 更新日志抓取失败:', err?.message || err);
  process.exit(1);
});
