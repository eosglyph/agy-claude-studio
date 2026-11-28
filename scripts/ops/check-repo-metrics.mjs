#!/usr/bin/env node
// GitHub & Bilibili Metrics Daily Report Script (MIT, zero external dependencies).
// Usage:
//   node scripts/ops/check-repo-metrics.mjs [--repo owner/name] [--bvid BV1xxx,BV2xxx] [--push]
// Fetches public GitHub repo + release download stats and optional Bilibili video stats,
// computes deltas against PLUGIN_DATA/ops-state.json, and prints a clean Markdown table report.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export function extractBvid(token) {
  const m = String(token || '').trim().match(/BV[0-9A-Za-z]{8,}/i);
  if (!m) return '';
  return 'BV' + m[0].slice(2);
}

export function parseCliArgs(argv) {
  const out = { repo: 'eosglyph/agy-claude-studio', bvids: [], push: false };
  const seen = new Set();
  const addBvid = (raw) => {
    const bvid = extractBvid(raw);
    if (!bvid || seen.has(bvid)) return;
    seen.add(bvid);
    out.bvids.push(bvid);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--push') out.push = true;
    else if (a === '--repo' && argv[i + 1]) {
      out.repo = argv[++i];
    } else if ((a === '--bvid' || a === '--bv') && argv[i + 1]) {
      const raw = argv[++i];
      for (const part of raw.split(/[,;\s]+/)) {
        addBvid(part);
      }
    } else {
      addBvid(a);
    }
  }
  return out;
}

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

export function fmtNum(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '0';
}

export function fmtDelta(cur, prev) {
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return '';
  const diff = cur - prev;
  if (diff === 0) return ' (±0)';
  return diff > 0 ? ` (+${fmtNum(diff)})` : ` (-${fmtNum(Math.abs(diff))})`;
}

export function fmtDeltaCell(cur, prev) {
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return '首次记录';
  const diff = cur - prev;
  if (diff === 0) return '±0';
  return diff > 0 ? `+${fmtNum(diff)}` : `-${fmtNum(Math.abs(diff))}`;
}

export function fmtMetricWithDelta(cur, prev) {
  const base = fmtNum(cur);
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return `${base} (新)`;
  const diff = cur - prev;
  if (diff === 0) return base;
  return diff > 0 ? `${base} (+${fmtNum(diff)})` : `${base} (-${fmtNum(Math.abs(diff))})`;
}

export function escapeMdCell(text) {
  return String(text ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

export function shortenVideoTitle(title, maxUnits = 38) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  let units = 0;
  let out = '';
  for (const ch of clean) {
    const w = ch.charCodeAt(0) > 127 ? 2 : 1;
    if (units + w > maxUnits) return out.trimEnd() + '…';
    out += ch;
    units += w;
  }
  return out;
}

export function formatMetricsReport({ repo, gh, prevGh = null, biliResults = [], prevBiliMap = {} }) {
  const dlNote = gh.source === 'web-fallback' ? 'API 限流，沿用上次记录' : `最新 \`${gh.latestTag || 'all'}\``;

  const okVideos = biliResults.filter((x) => x.ok);
  let totalView = 0;
  let prevTotalView = 0;
  let hasAllPrevView = okVideos.length > 0;
  for (const bv of okVideos) {
    totalView += bv.view;
    const prevBv = prevBiliMap?.[bv.bvid];
    if (typeof prevBv?.view === 'number' && Number.isFinite(prevBv.view)) {
      prevTotalView += prevBv.view;
    } else {
      hasAllPrevView = false;
    }
  }

  const biliSummaryPart =
    okVideos.length > 0
      ? ` | B站 ${okVideos.length} 稿 播放 ${fmtNum(totalView)}${hasAllPrevView ? fmtDelta(totalView, prevTotalView) : ''}`
      : '';

  const lines = [
    `📊 ${repo} · ★ ${fmtNum(gh.stars)}${fmtDelta(gh.stars, prevGh?.stars)} | Fork ${fmtNum(gh.forks)}${fmtDelta(gh.forks, prevGh?.forks)} | 下载 ${fmtNum(gh.releaseDownloads)}${fmtDelta(gh.releaseDownloads, prevGh?.releaseDownloads)}${biliSummaryPart}`,
    '',
    `### GitHub 仓库数据（${repo}${gh.source === 'web-fallback' ? ' · Web 兜底' : ''}）`,
    '| 指标 | 当前 | 较上次 | 备注 |',
    '| --- | ---: | ---: | --- |',
    `| Stars | **${fmtNum(gh.stars)}** | ${fmtDeltaCell(gh.stars, prevGh?.stars)} | \`${escapeMdCell(repo)}\` |`,
    `| Forks | **${fmtNum(gh.forks)}** | ${fmtDeltaCell(gh.forks, prevGh?.forks)} | — |`,
    `| Open Issues | **${fmtNum(gh.issues)}** | ${fmtDeltaCell(gh.issues, prevGh?.issues)} | — |`,
    `| Release 总下载 | **${fmtNum(gh.releaseDownloads)}** | ${fmtDeltaCell(gh.releaseDownloads, prevGh?.releaseDownloads)} | ${dlNote} |`,
  ];

  if (biliResults.length > 0) {
    lines.push(
      '',
      '### Bilibili 视频数据',
      '| 视频 | 播放 | 点赞 | 投币 | 收藏 | 评论 |',
      '| --- | ---: | ---: | ---: | ---: | ---: |'
    );

    const totals = { view: 0, like: 0, coin: 0, favorite: 0, reply: 0 };
    const prevTotals = { view: 0, like: 0, coin: 0, favorite: 0, reply: 0 };
    let allHavePrev = okVideos.length > 0;

    for (const bv of biliResults) {
      if (!bv.ok) {
        lines.push(`| \`${escapeMdCell(bv.bvid)}\`（获取失败：${escapeMdCell(bv.error)}） | — | — | — | — | — |`);
        continue;
      }
      const prevBv = prevBiliMap?.[bv.bvid] || null;
      const titleLabel = `**${escapeMdCell(shortenVideoTitle(bv.title))}** \`${escapeMdCell(bv.bvid)}\``;
      lines.push(
        `| ${titleLabel} | ${fmtMetricWithDelta(bv.view, prevBv?.view)} | ${fmtMetricWithDelta(bv.like, prevBv?.like)} | ${fmtMetricWithDelta(bv.coin, prevBv?.coin)} | ${fmtMetricWithDelta(bv.favorite, prevBv?.favorite)} | ${fmtMetricWithDelta(bv.reply, prevBv?.reply)} |`
      );
      for (const k of Object.keys(totals)) {
        totals[k] += Number(bv[k] || 0);
        if (typeof prevBv?.[k] === 'number' && Number.isFinite(prevBv[k])) {
          prevTotals[k] += prevBv[k];
        } else {
          allHavePrev = false;
        }
      }
    }

    if (okVideos.length >= 2) {
      const fmtSum = (k) => (allHavePrev ? fmtMetricWithDelta(totals[k], prevTotals[k]) : fmtNum(totals[k]));
      lines.push(
        `| **合计（${okVideos.length} 稿）** | **${fmtSum('view')}** | **${fmtSum('like')}** | **${fmtSum('coin')}** | **${fmtSum('favorite')}** | **${fmtSum('reply')}** |`
      );
    }
  } else {
    lines.push('', '提示：在脚本启动参数中加上 `--bvid BVxxxxxxxxxx` 即可同步抓取 B 站视频播放与三连增量。');
  }

  return lines.join('\n');
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ClaudeStudioOps/1.0', ...headers },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function resolveGithubToken() {
  const envToken = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return String(out || '').trim();
  } catch {
    return '';
  }
}

async function fetchGithubMetricsWebFallback(repo, prevGh) {
  const pageRes = await fetch(`https://github.com/${repo}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!pageRes.ok) {
    throw new Error(`GitHub Web HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();
  const numFrom = (re, fallback = 0) => {
    const m = html.match(re);
    if (!m) return fallback;
    const n = Number(String(m[1]).replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
  };
  const stars = numFrom(/"stargazerCount"\s*:\s*(\d+)/i, numFrom(/id="repo-stars-counter-star"[^>]*title="([\d,]+)"/i, prevGh?.stars ?? 0));
  const forks = numFrom(/"forksCount"\s*:\s*(\d+)/i, numFrom(/id="repo-network-counter"[^>]*title="([\d,]+)"/i, prevGh?.forks ?? 0));
  const watchers = numFrom(/"watcherCount"\s*:\s*(\d+)/i, prevGh?.watchers ?? 0);
  const issues = numFrom(/"openIssuesCount"\s*:\s*(\d+)/i, numFrom(/id="issues-repo-tab-count"[^>]*title="([\d,]+)"/i, prevGh?.issues ?? 0));

  let latestTag = prevGh?.latestTag || '';
  try {
    const relRes = await fetch(`https://github.com/${repo}/releases/latest`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const loc = relRes.headers.get('location') || '';
    const tagMatch = loc.match(/\/releases\/tag\/([^/?#]+)/);
    if (tagMatch) latestTag = decodeURIComponent(tagMatch[1]);
  } catch {}

  return {
    stars,
    forks,
    issues,
    watchers,
    latestTag,
    releaseDownloads: Number(prevGh?.releaseDownloads || 0),
    source: 'web-fallback',
  };
}

async function fetchGithubMetrics(repo, prevGh = null) {
  const ghHeaders = { Accept: 'application/vnd.github+json' };
  const token = resolveGithubToken();
  if (token) ghHeaders.Authorization = `Bearer ${token}`;

  const repoRes = await fetchJson(`https://api.github.com/repos/${repo}`, ghHeaders);
  if (!repoRes.ok || !repoRes.json) {
    if (repoRes.status === 403 || repoRes.status === 429) {
      return await fetchGithubMetricsWebFallback(repo, prevGh);
    }
    throw new Error(`GitHub API HTTP ${repoRes.status}`);
  }
  const r = repoRes.json;

  let releaseDownloads = 0;
  let latestTag = '';
  const relRes = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=10`, ghHeaders);
  if (relRes.ok && Array.isArray(relRes.json)) {
    latestTag = relRes.json[0]?.tag_name || '';
    for (const rel of relRes.json) {
      for (const asset of rel.assets || []) {
        releaseDownloads += Number(asset.download_count || 0);
      }
    }
  } else if (prevGh) {
    releaseDownloads = Number(prevGh.releaseDownloads || 0);
    latestTag = prevGh.latestTag || '';
  }

  return {
    stars: Number(r.stargazers_count || 0),
    forks: Number(r.forks_count || 0),
    issues: Number(r.open_issues_count || 0),
    watchers: Number(r.subscribers_count ?? r.watchers_count ?? 0),
    latestTag,
    releaseDownloads,
    source: 'api',
  };
}

async function fetchBilibiliMetrics(bvid) {
  const res = await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    { Referer: 'https://www.bilibili.com/' }
  );
  if (!res.ok || !res.json || res.json.code !== 0 || !res.json.data) {
    return { ok: false, bvid, error: res.json?.message || `HTTP ${res.status}` };
  }
  const d = res.json.data;
  const st = d.stat || {};
  return {
    ok: true,
    bvid: d.bvid || bvid,
    title: d.title || bvid,
    view: Number(st.view || 0),
    like: Number(st.like || 0),
    coin: Number(st.coin || 0),
    favorite: Number(st.favorite || 0),
    share: Number(st.share || 0),
    reply: Number(st.reply || 0),
  };
}

export async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const dataDir = resolveDataDir();
  const statePath = path.join(dataDir, 'ops-state.json');
  const state = readOpsState(statePath);
  const prevGh = state.github?.[cli.repo] || null;
  const prevBiliMap = state.bilibili ? { ...state.bilibili } : {};

  const gh = await fetchGithubMetrics(cli.repo, prevGh);
  state.github = state.github || {};
  state.github[cli.repo] = { ...gh, updatedAt: new Date().toISOString() };

  const bvids = cli.bvids.length > 0 ? cli.bvids : Array.isArray(state.defaultBvids) ? state.defaultBvids : [];
  const biliResults = [];
  if (bvids.length > 0) {
    state.bilibili = state.bilibili || {};
    for (const bvid of bvids) {
      const bv = await fetchBilibiliMetrics(bvid);
      biliResults.push(bv);
      if (bv.ok) {
        state.bilibili[bvid] = { ...bv, updatedAt: new Date().toISOString() };
      }
    }
  }

  const report = formatMetricsReport({
    repo: cli.repo,
    gh,
    prevGh,
    biliResults,
    prevBiliMap,
  });

  writeOpsState(statePath, state);
  console.log(report);

  if (cli.push) {
    try {
      const notifyCore = require(path.join(REPO_ROOT, 'src', 'notify-core.js'));
      const cfg = notifyCore.readNotifyConfig(dataDir);
      if (cfg.enabled && notifyCore.isChannelConfigured(cfg)) {
        const pushRes = await notifyCore.deliverNotification(cfg, {
          title: `数据日报 · ★${gh.stars}${fmtDelta(gh.stars, prevGh?.stars)}`,
          body: report,
          level: 'info',
          workspace: cli.repo,
          durationSec: 0,
          terminationReason: 'OPS_METRICS',
          timestamp: new Date().toISOString(),
        });
        console.log(`\n[Push] ${pushRes.ok ? '已推送' : '推送失败: ' + (pushRes.error || pushRes.status)}`);
      }
    } catch (err) {
      console.error('[Push] error:', err?.message || err);
    }
  }
}

const isDirectMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectMain) {
  main().catch((err) => {
    console.error('数据日报抓取失败:', err?.message || err);
    process.exit(1);
  });
}
