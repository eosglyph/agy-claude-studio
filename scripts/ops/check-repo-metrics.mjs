#!/usr/bin/env node
// GitHub & Bilibili Metrics Daily Report Ops Script (0-Token, MIT).
// Usage:
//   node scripts/ops/check-repo-metrics.mjs [--repo owner/name] [--bvid BV1xxx] [--push]
// Fetches public GitHub repo + release download stats and optional Bilibili video stats,
// computes deltas against PLUGIN_DATA/ops-state.json, and prints a clean report.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function parseCliArgs(argv) {
  const out = { repo: 'eosglyph/agy-claude-studio', bvids: [], push: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--push') out.push = true;
    else if (a === '--repo' && argv[i + 1]) {
      out.repo = argv[++i];
    } else if ((a === '--bvid' || a === '--bv') && argv[i + 1]) {
      const raw = argv[++i];
      for (const part of raw.split(/[,;\s]+/)) {
        const clean = part.trim();
        if (/^BV[0-9A-Za-z]+$/i.test(clean)) out.bvids.push(clean);
      }
    } else if (/^BV[0-9A-Za-z]{8,}$/i.test(a)) {
      out.bvids.push(a);
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

function fmtDelta(cur, prev) {
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return '';
  const diff = cur - prev;
  if (diff === 0) return ' (±0)';
  return diff > 0 ? ` (+${diff})` : ` (${diff})`;
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

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const dataDir = resolveDataDir();
  const statePath = path.join(dataDir, 'ops-state.json');
  const state = readOpsState(statePath);
  const prevGh = state.github?.[cli.repo] || null;

  const gh = await fetchGithubMetrics(cli.repo, prevGh);
  const dlNote = gh.source === 'web-fallback' ? '（API 限流，沿用上次记录）' : '';
  const lines = [
    `📊 ${cli.repo} · ★ ${gh.stars}${fmtDelta(gh.stars, prevGh?.stars)} | Fork ${gh.forks}${fmtDelta(gh.forks, prevGh?.forks)} | 下载 ${gh.releaseDownloads}${fmtDelta(gh.releaseDownloads, prevGh?.releaseDownloads)}`,
    '',
    `### GitHub (${cli.repo})${gh.source === 'web-fallback' ? ' · Web 兜底' : ''}`,
    `- Stars: **${gh.stars}**${fmtDelta(gh.stars, prevGh?.stars)}`,
    `- Forks: **${gh.forks}**${fmtDelta(gh.forks, prevGh?.forks)}`,
    `- Open Issues: **${gh.issues}**${fmtDelta(gh.issues, prevGh?.issues)}`,
    `- Release 总下载 (${gh.latestTag || 'all'}): **${gh.releaseDownloads}**${fmtDelta(gh.releaseDownloads, prevGh?.releaseDownloads)}${dlNote}`,
  ];

  state.github = state.github || {};
  state.github[cli.repo] = { ...gh, updatedAt: new Date().toISOString() };

  const bvids = cli.bvids.length > 0 ? cli.bvids : Array.isArray(state.defaultBvids) ? state.defaultBvids : [];
  if (bvids.length > 0) {
    state.bilibili = state.bilibili || {};
    lines.push('', '### Bilibili 视频数据');
    for (const bvid of bvids) {
      const prevBv = state.bilibili[bvid] || null;
      const bv = await fetchBilibiliMetrics(bvid);
      if (!bv.ok) {
        lines.push(`- ${bvid}: 获取失败 (${bv.error})`);
        continue;
      }
      lines.push(
        `- **${bv.title}** (${bv.bvid})`,
        `  播放 ${bv.view}${fmtDelta(bv.view, prevBv?.view)} · 点赞 ${bv.like}${fmtDelta(bv.like, prevBv?.like)} · 投币 ${bv.coin}${fmtDelta(bv.coin, prevBv?.coin)} · 收藏 ${bv.favorite}${fmtDelta(bv.favorite, prevBv?.favorite)} · 评论 ${bv.reply}${fmtDelta(bv.reply, prevBv?.reply)}`
      );
      state.bilibili[bvid] = { ...bv, updatedAt: new Date().toISOString() };
    }
  } else {
    lines.push('', '提示：在脚本启动参数中加上 `--bvid BVxxxxxxxxxx` 即可同步抓取 B 站视频播放与三连增量。');
  }

  writeOpsState(statePath, state);
  const report = lines.join('\n');
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

main().catch((err) => {
  console.error('数据日报抓取失败:', err?.message || err);
  process.exit(1);
});
