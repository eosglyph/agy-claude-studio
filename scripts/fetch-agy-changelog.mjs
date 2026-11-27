#!/usr/bin/env node
// Antigravity Official Changelog & Version (ver) Fetcher (MIT, zero external dependencies).
// Usage:
//   node scripts/fetch-agy-changelog.mjs [--all] [--json] [--push] [--raw]
// Fetches https://antigravity.google/docs/changelog for the latest Antigravity App releases,
// caches & auto-translates release notes to Simplified Chinese (Google Translate + MyMemory fallback),
// and compares against PLUGIN_DATA/agy-changelog-state.json.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const CHANGELOG_URL = 'https://antigravity.google/docs/changelog';
const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';

const args = new Set(process.argv.slice(2));
const shouldPush = args.has('--push');
const showAll = args.has('--all');
const asJson = args.has('--json');
const rawOnly = args.has('--raw') || args.has('--en');

function resolveDataDir() {
  return (
    process.env.PLUGIN_DATA ||
    process.env.AGY_CLAUDE_STUDIO_DATA_DIR ||
    path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-claude-studio')
  );
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJsonSafe(filePath, state) {
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

function cleanBulletLine(raw) {
  let line = String(raw || '').trim();
  // Separate merged category headers like "Fixes(1)Fixed an issue..." or "Improvements(2)Added..."
  line = line.replace(/^(Improvements|Fixes|Features|Changes|Security|Performance)\s*\((\d+)\)\s*/i, (_, cat, cnt) => {
    const labelMap = {
      improvements: '改进',
      fixes: '修复',
      features: '新功能',
      changes: '变更',
      security: '安全',
      performance: '性能',
    };
    const zhCat = labelMap[cat.toLowerCase()] || cat;
    return `【${zhCat} (${cnt})】`;
  });
  return line;
}

const CATEGORY_HEADING_RE = /^(?:Improvements|Fixes|Features|Changes|Security|Performance)(?:(?:\s*\(\d+\))?:?$|\s*\(\d+\))/i;

function parseLatestReleases(text, limit = 2) {
  const start = text.indexOf('Antigravity App\nv');
  if (start < 0) return [];
  const slice = text.slice(start, start + 32000);
  const lines = slice.split('\n').map((l) => l.trim()).filter(Boolean);
  const releases = [];
  let current = null;
  let seenCategory = false;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^Antigravity (CLI|IDE|SDK)/.test(line)) break;
    if (/^v\d+\.\d+\.\d+$/.test(line)) {
      if (current) releases.push(current);
      if (releases.length >= limit) break;
      current = { version: line, date: '', headline: '', bullets: [] };
      seenCategory = false;
      continue;
    }
    if (!current) continue;
    if (line === 'Latest') continue;
    if (!current.date && /^[A-Z][a-z]+ \d{1,2}, 20\d{2}$/.test(line)) {
      current.date = line;
      continue;
    }
    if (CATEGORY_HEADING_RE.test(line)) {
      seenCategory = true;
      if (current.bullets.length < 16) {
        current.bullets.push(cleanBulletLine(line));
      }
      continue;
    }
    if (!current.headline && !seenCategory) {
      current.headline = line;
      continue;
    }
    if (current.bullets.length < 16) {
      current.bullets.push(cleanBulletLine(line));
    }
  }
  if (current && releases.length < limit) releases.push(current);
  return releases;
}

function formatDateZh(enDate) {
  const m = String(enDate || '').match(/^([A-Z][a-z]+)\s+(\d{1,2}),\s*(20\d{2})$/);
  if (!m) return enDate || '未知日期';
  const months = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
  };
  const mo = months[m[1]];
  if (!mo) return enDate;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

async function translateViaGoogle(text, targetLang, fetchFn = fetch) {
  const url = `${GOOGLE_TRANSLATE_URL}?client=gtx&sl=en&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`google_http_${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('google_invalid');
  const out = data[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('').trim();
  if (!out) throw new Error('google_empty');
  return out;
}

async function translateViaMyMemory(text, targetLang, fetchFn = fetch) {
  const mmLang = String(targetLang || 'zh-CN').trim() || 'zh-CN';
  const trimmed = text.length > 460 ? text.slice(0, 460) : text;
  const url = `${MYMEMORY_TRANSLATE_URL}?q=${encodeURIComponent(trimmed)}&langpair=en|${encodeURIComponent(mmLang)}`;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`mymemory_http_${res.status}`);
  const data = await res.json();
  if (Number(data?.responseStatus) !== 200) {
    throw new Error(`mymemory_status_${data?.responseStatus ?? 'unknown'}`);
  }
  const out = String(data?.responseData?.translatedText || '').trim();
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error('mymemory_quota');
  return out;
}

async function translateLineDetailed(line, targetLang, { fetchFn = fetch } = {}) {
  if (!line || !/[A-Za-z]{2,}/.test(line)) return { text: line, failed: false };
  // Preserve leading Chinese category prefix such as 【修复 (1)】
  const prefixMatch = line.match(/^(【[^】]+】)\s*/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const rawBody = prefixMatch ? line.slice(prefixMatch[0].length).trim() : line;
  if (!rawBody) return { text: line, failed: false };
  // Clarify Antigravity domain terms so machine translation avoids literal puns (e.g. "turn" -> "转弯")
  const body = rawBody
    .replace(/\bwhile a turn is running\b/gi, 'while a conversation turn is running')
    .replace(/\bduring a turn\b/gi, 'during a conversation turn');
  try {
    const zh = await translateViaGoogle(body, targetLang, fetchFn);
    return { text: prefix + zh, failed: false };
  } catch {
    try {
      const zh = await translateViaMyMemory(body, targetLang, fetchFn);
      return { text: prefix + zh, failed: false };
    } catch {
      return { text: line, failed: true };
    }
  }
}

async function translateLine(line, targetLang) {
  const result = await translateLineDetailed(line, targetLang);
  return result.text;
}

function buildReleaseContentHash(rel) {
  const payload = JSON.stringify({
    headline: String(rel?.headline || ''),
    bullets: Array.isArray(rel?.bullets) ? rel.bullets.map((item) => String(item || '')) : [],
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function buildTranslationCacheKey(rel, targetLang) {
  return `${rel.version}:${targetLang}:${buildReleaseContentHash(rel)}`;
}

async function translateReleasesWithCache(releases, targetLang, state, { translateLineFn = translateLineDetailed } = {}) {
  if (!state.translatedCache || typeof state.translatedCache !== 'object') {
    state.translatedCache = {};
  }
  const translated = [];
  for (const rel of releases) {
    const contentHash = buildReleaseContentHash(rel);
    const cacheKey = `${rel.version}:${targetLang}:${contentHash}`;
    const cached = state.translatedCache[cacheKey];
    if (
      cached &&
      cached.contentHash === contentHash &&
      cached.targetLang === targetLang &&
      cached.headlineSrc === rel.headline &&
      Array.isArray(cached.bullets) &&
      cached.bullets.length === rel.bullets.length
    ) {
      translated.push({
        ...rel,
        headlineZh: cached.headlineZh || rel.headline,
        bulletsZh: cached.bullets,
      });
      continue;
    }

    let anyFailed = false;
    const headlineRes = await translateLineFn(rel.headline, targetLang);
    const headlineZh = typeof headlineRes === 'string' ? headlineRes : headlineRes.text;
    if (typeof headlineRes === 'object' && headlineRes?.failed) anyFailed = true;

    const bulletsZh = [];
    for (const b of rel.bullets) {
      const bulletRes = await translateLineFn(b, targetLang);
      bulletsZh.push(typeof bulletRes === 'string' ? bulletRes : bulletRes.text);
      if (typeof bulletRes === 'object' && bulletRes?.failed) anyFailed = true;
    }

    if (!anyFailed) {
      state.translatedCache[cacheKey] = {
        contentHash,
        targetLang,
        headlineSrc: rel.headline,
        headlineZh,
        bullets: bulletsZh,
      };
      // Keep cache compact (latest 10 entries)
      const keys = Object.keys(state.translatedCache);
      if (keys.length > 10) {
        for (const oldKey of keys.slice(0, keys.length - 10)) {
          delete state.translatedCache[oldKey];
        }
      }
    } else {
      delete state.translatedCache[cacheKey];
    }
    translated.push({ ...rel, headlineZh, bulletsZh });
  }
  return translated;
}

async function main() {
  const res = await fetch(CHANGELOG_URL, {
    headers: { 'User-Agent': 'ClaudeStudioChangelog/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${CHANGELOG_URL}`);
  }
  const html = await res.text();
  const text = stripHtml(html);
  const rawReleases = parseLatestReleases(text, showAll ? 5 : 2);
  if (!rawReleases.length) {
    throw new Error('Could not parse Antigravity App releases from changelog');
  }

  const dataDir = resolveDataDir();
  const userCfg = readJsonSafe(path.join(dataDir, 'config.json'));
  const lang = String(userCfg.language || 'zh-CN');
  const shouldTranslate = !rawOnly && lang !== 'en';
  const targetLang = lang === 'zh-TW' || lang === 'yue' ? 'zh-TW' : lang === 'ja' ? 'ja' : 'zh-CN';

  const statePath = path.join(dataDir, 'agy-changelog-state.json');
  const state = readJsonSafe(statePath);
  const releases = shouldTranslate
    ? await translateReleasesWithCache(rawReleases, targetLang, state)
    : rawReleases.map((r) => ({ ...r, headlineZh: r.headline, bulletsZh: r.bullets }));

  const latest = releases[0];
  const prevVersion = state.lastAgyVersion || '';
  const isNew = Boolean(prevVersion && prevVersion !== latest.version);

  const statusTag = isNew
    ? `🆕 发现新版本 ${latest.version}（上次记录：${prevVersion}）`
    : prevVersion
    ? `✅ 当前最新 ${latest.version}（无新版本）`
    : `📌 当前最新 ${latest.version}`;

  const lines = [
    `${statusTag} · ${formatDateZh(latest.date)}`,
    `标题：${latest.headlineZh || latest.headline || '—'}`,
  ];

  for (const rel of releases) {
    lines.push('');
    lines.push(`### ${rel.version}（${formatDateZh(rel.date)}）`);
    if (rel.headlineZh) lines.push(`**${rel.headlineZh}**`);
    const list = (rel.bulletsZh || rel.bullets).slice(0, showAll ? 12 : 8);
    for (const b of list) {
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
          headline: latest.headlineZh || latest.headline || '',
          headlineEn: latest.headline || '',
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
  writeJsonSafe(statePath, state);

  if (shouldPush && isNew) {
    try {
      const notifyCore = require(path.join(REPO_ROOT, 'src', 'notify-core.js'));
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

export {
  stripHtml,
  cleanBulletLine,
  parseLatestReleases,
  buildReleaseContentHash,
  buildTranslationCacheKey,
  translateLine,
  translateLineDetailed,
  translateViaGoogle,
  translateViaMyMemory,
  translateReleasesWithCache,
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error('Antigravity 更新日志抓取失败:', err?.message || err);
    process.exit(1);
  });
}
