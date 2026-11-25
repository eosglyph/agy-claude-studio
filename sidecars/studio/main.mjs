// Aux Pane Sidecar UI server for Claude Studio (agy-claude-studio).
// Uses sidecar_sdk and cleans up cleanly via host /healthz watchdog when Antigravity exits.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cdp = require('../../cdp.js');
const lifecycle = require('../../lifecycle.js');
const notifyCore = require('../../notify-core.js');
const { updateConfigSetting, injectOnce } = require('../../inject.js');
const { removeFromAllWindows } = require('../../remove.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT_DIR = resolve(__dirname, '..', '..');
const HTML_PATH = join(__dirname, 'index.html');
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/eosglyph/agy-claude-studio/releases/latest';
const LATEST_RELEASE_WEB_URL = 'https://github.com/eosglyph/agy-claude-studio/releases/latest';
const LATEST_PACKAGE_RAW_URL = 'https://raw.githubusercontent.com/eosglyph/agy-claude-studio/main/package.json';

function isLocalHostRequest(req) {
  if (!req?.headers) return true;
  const host = String(req.headers.host || '').trim().toLowerCase();
  const hostMatch = host.match(/^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/);
  if (host && !hostMatch) {
    return false;
  }
  const origin = String(req.headers.origin || '').trim().toLowerCase();
  if (origin && /^(?:vscode-webview|plugin):\/\/[a-z0-9._-]+$/.test(origin)) {
    return true;
  }
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }
  if (origin) {
    const originMatch = origin.match(/^(https?):\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/);
    if (!originMatch) {
      return false;
    }
    if (hostMatch) {
      const defaultPort = originMatch[1] === 'https' ? '443' : '80';
      const originPort = originMatch[3] || defaultPort;
      const hostPort = hostMatch[2] || defaultPort;
      if (originPort !== hostPort) {
        return false;
      }
    }
  }
  return true;
}

const LAUNCHER_CACHE_TTL_MS = 30000;
let launcherDiagCache = { at: 0, value: null };

async function getLauncherDiagnosticsCached() {
  const now = Date.now();
  if (launcherDiagCache.value && now - launcherDiagCache.at < LAUNCHER_CACHE_TTL_MS) {
    return launcherDiagCache.value;
  }
  let res = null;
  try {
    res = await lifecycle.ensureDesktopRemoteDebuggingLaunchers({ enabled: true });
  } catch (err) {
    res = { checked: true, configured: false, updated: false, reason: err?.message || 'error' };
  }
  const normalized = {
    checked: Boolean(res?.checked),
    configured: Boolean(res?.configured),
    updated: Boolean(res?.updated),
    updatedCount: Array.isArray(res?.updatedPaths) ? res.updatedPaths.length : 0,
    configuredCount: Array.isArray(res?.configuredPaths) ? res.configuredPaths.length : 0,
    reason: String(res?.reason || ''),
  };
  launcherDiagCache = { at: now, value: normalized };
  return normalized;
}

function detectUsageMonitorInstalled(pluginDirs) {
  const roots = Array.isArray(pluginDirs) && pluginDirs.length > 0
    ? pluginDirs
    : [
        resolve(__dirname, '..', '..', '..'),
        join(homedir(), '.gemini', 'config', 'plugins'),
        join(homedir(), '.gemini', 'antigravity', 'plugins'),
      ];
  const seen = new Set();
  for (const rawRoot of roots) {
    if (!rawRoot) continue;
    const root = resolve(String(rawRoot));
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (!existsSync(root)) continue;
      for (const directName of ['usage-monitor', 'antigravity-usage-monitor']) {
        const directManifest = join(root, directName, 'plugin.json');
        if (existsSync(directManifest)) return true;
      }
      const entries = readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(root, entry.name, 'plugin.json');
        if (!existsSync(manifestPath)) continue;
        try {
          const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
          const name = String(parsed?.name || '').toLowerCase();
          if (name === 'usage-monitor' || name === 'antigravity-usage-monitor' || /usage-monitor/.test(name)) {
            return true;
          }
        } catch {}
      }
    } catch {}
  }
  return false;
}

async function getStudioStatus() {
  const config = cdp.readConfig();
  const ports = cdp.readActivePorts();
  const watcherLock = lifecycle.readWatcherLockInfo(cdp.PID_FILE, cdp.LOCK_FILE);
  const watcherAlive = Boolean(watcherLock && watcherLock.alive);
  const watcherPid = watcherAlive ? watcherLock.pid : null;
  const usageMonitorInstalled = detectUsageMonitorInstalled();

  let activePort = null;
  let pages = [];
  for (const port of ports) {
    try {
      const list = await cdp.listPages(port);
      activePort = port;
      pages = list.map((p) => ({
        id: p.id,
        title: p.title || p.url || 'Antigravity',
      }));
      if (pages.length > 0) break;
    } catch {}
  }

  const launcher = !activePort
    ? await getLauncherDiagnosticsCached()
    : { checked: false, configured: true, updated: false, updatedCount: 0, configuredCount: 0, reason: '' };
  const hostInfo = !activePort ? lifecycle.resolveDesktopHostExecutable() : { found: false };
  const canRelaunch = Boolean(hostInfo.found || process.platform === 'win32' || process.platform === 'darwin');

  const compatInfo = cdp.readI18nCompatData();

  return {
    ok: true,
    version: cdp.PLUGIN_VERSION,
    config,
    defaults: cdp.DEFAULT_CONFIG,
    watcher: {
      alive: watcherAlive,
      pid: watcherAlive ? watcherPid : null,
    },
    integrations: {
      usageMonitorInstalled,
    },
    i18nCompat: {
      version: compatInfo.version,
      updatedAt: compatInfo.updatedAt,
      hasRemote: compatInfo.hasRemote,
      pluginCount: compatInfo.plugins.length,
      selectorCount: compatInfo.selectors.length,
    },
    notify: notifyCore.getNotifyStatusSummary(resolveNotifyDir()),
    update: {
      isGitRepo: existsSync(join(PLUGIN_ROOT_DIR, '.git')),
      releaseUrl: LATEST_RELEASE_WEB_URL,
    },
    launcher,
    cdp: {
      port: activePort,
      candidatePorts: ports,
      pageCount: pages.length,
      needsCdpRestart: !activePort,
      canRelaunch,
      pages,
    },
  };
}

async function relaunchDesktopHost() {
  await lifecycle.ensureDesktopRemoteDebuggingLaunchers({ enabled: true }).catch(() => null);
  launcherDiagCache = { at: 0, value: null };
  return lifecycle.triggerDesktopHostRelaunch({
    stalePortFiles: cdp.resolvePortCandidates(),
    tempDir: cdp.STATE_DIR,
  });
}

async function applyConfigUpdate(data) {
  const updates = data && typeof data.updates === 'object' && data.updates !== null
    ? data.updates
    : data && typeof data.key === 'string'
    ? { [data.key]: data.value }
    : {};

  const applied = [];
  const rejected = [];
  for (const [k, v] of Object.entries(updates)) {
    if (updateConfigSetting(k, v)) {
      applied.push(k);
    } else {
      rejected.push(k);
    }
  }

  const watcherLock = lifecycle.readWatcherLockInfo(cdp.PID_FILE, cdp.LOCK_FILE);
  const watcherAlive = Boolean(watcherLock && watcherLock.alive);
  const watcherPid = watcherAlive ? watcherLock.pid : null;
  if (applied.length > 0 && !watcherAlive) {
    try {
      await injectOnce({ log: () => {} });
    } catch {}
  }

  return {
    ok: rejected.length === 0,
    applied,
    rejected,
    config: cdp.readConfig(),
  };
}

async function openUsageMonitorPaneInHost() {
  const ports = cdp.readActivePorts();
  let lastResult = { ok: false, status: 'cdp_unavailable' };
  for (const port of ports) {
    let pages = [];
    try {
      pages = await cdp.listPages(port);
    } catch {
      continue;
    }
    for (const p of pages) {
      if (!p?.webSocketDebuggerUrl) continue;
      let sess = null;
      try {
        sess = await cdp.CdpSession.connect(p.webSocketDebuggerUrl);
        const res = await sess.evaluate(
          '(() => { const api = window.__agClaudeStudio || window.__agClaudeStyle; return (api && typeof api.openUsageMonitorPane === "function") ? api.openUsageMonitorPane({ forceSwitch: true }) : { ok: false, status: "not_injected" }; })()',
          false
        );
        if (res && res.ok) return res;
        if (res) lastResult = res;
      } catch {
        // try next target
      } finally {
        sess?.close();
      }
    }
  }
  return lastResult;
}

function parseSemverParts(raw) {
  const clean = String(raw || '').trim().replace(/^v/i, '').split('-')[0];
  const parts = clean.split('.').map((n) => parseInt(n, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function compareSemver(a, b) {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function inspectGitRepoState(pluginDir = PLUGIN_ROOT_DIR, execFn = execFileSync) {
  const isGitRepo = Boolean(pluginDir && existsSync(join(pluginDir, '.git')));
  if (!isGitRepo) return { isGitRepo: false, gitClean: false, branch: '' };
  try {
    const statusOut = String(execFn('git', ['status', '--porcelain'], { cwd: pluginDir, encoding: 'utf8', timeout: 5000 })).trim();
    let branch = '';
    try {
      branch = String(execFn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: pluginDir, encoding: 'utf8', timeout: 5000 })).trim();
    } catch {}
    return { isGitRepo: true, gitClean: statusOut.length === 0, branch };
  } catch {
    return { isGitRepo: true, gitClean: false, branch: '' };
  }
}

async function checkStudioUpdate({
  fetchFn = typeof fetch === 'function' ? fetch : null,
  pluginDir = PLUGIN_ROOT_DIR,
  currentVersion = cdp.PLUGIN_VERSION,
  execFn = execFileSync,
  timeoutMs = 8000,
} = {}) {
  const gitState = inspectGitRepoState(pluginDir, execFn);
  if (!fetchFn) {
    return { ok: false, error: 'fetch unavailable', currentVersion, ...gitState, releaseUrl: LATEST_RELEASE_WEB_URL };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ua = `agy-claude-studio/${currentVersion}`;

  const buildOkResult = ({ latestTag, releaseName, publishedAt, releaseUrl, source }) => {
    const cleanTag = String(latestTag || '').trim();
    const latestVersion = cleanTag.replace(/^v/i, '');
    const hasUpdate = Boolean(latestVersion && compareSemver(latestVersion, currentVersion) > 0);
    return {
      ok: true,
      source,
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      latestTag: cleanTag || `v${currentVersion}`,
      hasUpdate,
      releaseName: String(releaseName || cleanTag || ''),
      publishedAt: String(publishedAt || ''),
      releaseUrl: String(releaseUrl || LATEST_RELEASE_WEB_URL),
      ...gitState,
    };
  };

  let primaryErr = '';
  try {
    // 1. Primary: GitHub Releases API (rich metadata; may hit 403/429 rate limits on shared IPs)
    try {
      const res = await fetchFn(LATEST_RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': ua },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const latestTag = String(data?.tag_name || '').trim();
        if (latestTag) {
          return buildOkResult({
            latestTag,
            releaseName: data?.name || latestTag,
            publishedAt: data?.published_at || '',
            releaseUrl: data?.html_url || LATEST_RELEASE_WEB_URL,
            source: 'github-api',
          });
        }
      } else {
        primaryErr = `HTTP ${res.status}`;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      primaryErr = err?.message || 'network error';
    }

    // 2. Fallback A: GitHub Releases web redirect (no 60/hr REST API rate limit)
    try {
      const webRes = await fetchFn(LATEST_RELEASE_WEB_URL, {
        redirect: 'manual',
        headers: { 'User-Agent': ua },
        signal: controller.signal,
      });
      const loc = String(webRes?.headers?.get?.('location') || webRes?.url || '').trim();
      const tagMatch = loc.match(/\/releases\/tag\/(v?\d+\.\d+\.\d+[^/?#]*)/i);
      if (tagMatch) {
        return buildOkResult({
          latestTag: tagMatch[1],
          releaseName: tagMatch[1],
          publishedAt: '',
          releaseUrl: loc.startsWith('http') ? loc : `https://github.com${loc}`,
          source: 'release-redirect',
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }

    // 3. Fallback B: Raw package.json on main (no REST API rate limit)
    try {
      const rawRes = await fetchFn(LATEST_PACKAGE_RAW_URL, {
        headers: { Accept: 'application/json', 'User-Agent': ua },
        signal: controller.signal,
      });
      if (rawRes.ok) {
        const pkg = await rawRes.json();
        const ver = String(pkg?.version || '').trim().replace(/^v/i, '');
        if (ver) {
          return buildOkResult({
            latestTag: `v${ver}`,
            releaseName: `v${ver}`,
            publishedAt: '',
            releaseUrl: LATEST_RELEASE_WEB_URL,
            source: 'raw-package',
          });
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }

    return {
      ok: false,
      error: primaryErr || 'update check failed',
      currentVersion,
      ...gitState,
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'network error',
      currentVersion,
      ...gitState,
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function performStudioSelfUpdate({
  pluginDir = PLUGIN_ROOT_DIR,
  execFn = execFileSync,
  reinjectFn = () => injectOnce({ log: () => {} }),
} = {}) {
  const gitState = inspectGitRepoState(pluginDir, execFn);
  if (!gitState.isGitRepo) {
    return {
      ok: false,
      reason: 'not_git_repo',
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  }
  if (!gitState.gitClean) {
    return {
      ok: false,
      reason: 'dirty_worktree',
      branch: gitState.branch,
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  }
  try {
    execFn('git', ['fetch', '--tags', 'origin'], { cwd: pluginDir, encoding: 'utf8', timeout: 25000 });
    const pullOut = String(
      execFn('git', ['pull', '--ff-only'], { cwd: pluginDir, encoding: 'utf8', timeout: 25000 })
    ).trim();
    let nextVersion = cdp.PLUGIN_VERSION;
    try {
      const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
      if (pkg?.version) nextVersion = String(pkg.version);
    } catch {}
    try {
      await reinjectFn();
    } catch {}
    return {
      ok: true,
      updated: !/already up to date/i.test(pullOut),
      output: pullOut,
      version: nextVersion,
      branch: gitState.branch,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'git_pull_failed',
      error: err?.message || String(err),
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  }
}

async function syncI18nCompatWhitelist({
  fetchFn = typeof fetch === 'function' ? fetch : null,
  pluginDataDir = cdp.PLUGIN_DATA_DIR,
  reinjectFn = () => injectOnce({ log: () => {} }),
} = {}) {
  try {
    const syncRes = await cdp.syncRemoteI18nCompat({ fetchFn, pluginDataDir });
    try {
      await reinjectFn();
    } catch {}
    return {
      ok: true,
      ...syncRes,
    };
  } catch (err) {
    if (err?.status === 404) {
      const local = cdp.readI18nCompatData(pluginDataDir);
      return {
        ok: true,
        fallbackToBundled: true,
        status: 404,
        version: local.version,
        updatedAt: local.updatedAt,
        pluginCount: local.plugins.length,
        selectorCount: local.selectors.length,
      };
    }
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'sync failed',
    };
  }
}

function resolveNotifyDir() {
  return notifyCore.resolveNotifyDataDir(process.env, cdp.PLUGIN_DATA_DIR || null);
}

function getNotifyConfigApi({ dataDir = resolveNotifyDir() } = {}) {
  const config = notifyCore.readNotifyConfig(dataDir);
  return {
    ok: true,
    config,
    configured: notifyCore.isChannelConfigured(config),
    channels: notifyCore.CHANNEL_LIST,
  };
}

function saveNotifyConfigApi(data, { dataDir = resolveNotifyDir() } = {}) {
  const payload = data && typeof data === 'object' && data.config ? data.config : data;
  const saved = notifyCore.writeNotifyConfig(dataDir, payload || {}, true);
  return {
    ok: true,
    config: saved.config,
    configured: saved.configured,
  };
}

async function testNotifyApi(
  data,
  {
    dataDir = resolveNotifyDir(),
    fetchFn = typeof fetch === 'function' ? fetch : null,
    language = cdp.readConfig().language,
  } = {}
) {
  const baseCfg = notifyCore.readNotifyConfig(dataDir);
  const rawCandidate =
    data && typeof data === 'object' && data.config
      ? data.config
      : data && typeof data === 'object'
      ? data
      : null;
  const effectiveCfg = rawCandidate
    ? notifyCore.sanitizeNotifyConfig(rawCandidate, baseCfg)
    : baseCfg;

  if (!notifyCore.isChannelConfigured(effectiveCfg)) {
    return {
      ok: false,
      channel: effectiveCfg.channel,
      status: 0,
      error: 'not_configured',
      configured: false,
    };
  }

  let title = '🔔 [Claude Studio] 测试推送通知';
  let body =
    '通道连接验证成功！后续当 Antigravity 完成耗时任务或执行异常时，将通过 Stop Hook 以 0 Token 自动推送到你的手机。';
  if (language === 'en') {
    title = '🔔 [Claude Studio] Test Push Notification';
    body =
      'Connection verified! Mobile notifications will trigger automatically with 0 extra tokens when tasks finish or error.';
  } else if (language === 'ja') {
    title = '🔔 [Claude Studio] テスト通知';
    body =
      'プッシュ設定のテストに成功しました。タスク完了・エラー時に Stop Hook 経由で 0 Token 通知します。';
  } else if (language === 'zh-TW' || language === 'yue') {
    title = '🔔 [Claude Studio] 測試推播通知';
    body =
      '連線驗證成功！後續當 Antigravity 完成耗時任務或執行異常時，將透過 Stop Hook 以 0 Token 自動推播至手機。';
  }

  const msg = {
    title,
    body,
    level: 'info',
    workspace: 'Claude Studio',
    durationSec: 18,
    terminationReason: 'NO_TOOL_CALL',
    conversationId: 'test',
    timestamp: new Date().toISOString(),
  };

  return notifyCore.deliverNotification(effectiveCfg, msg, { fetchFn, timeoutMs: 6000 });
}

async function resetStudioConfig() {
  cdp.ensureMigratedPluginConfig();
  cdp.atomicWriteFileSync(cdp.CONFIG_FILE, JSON.stringify(cdp.DEFAULT_CONFIG, null, 2) + '\n');
  const watcherLock = lifecycle.readWatcherLockInfo(cdp.PID_FILE, cdp.LOCK_FILE);
  if (!watcherLock || !watcherLock.alive) {
    try {
      await injectOnce({ log: () => {} });
    } catch {}
  }
  return { ok: true, config: cdp.readConfig() };
}

async function startStudioSidecar() {
  const { Response, SidecarApp } = await import('sidecar_sdk');
  const app = new SidecarApp();

  app.page('/', () => {
    const html = readFileSync(HTML_PATH, 'utf8');
    return new Response(html, {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: NO_STORE_HEADERS,
    });
  });

  const guardApi = (fn) => async (data, req) => {
    if (!isLocalHostRequest(req)) {
      return new Response(JSON.stringify({ ok: false, error: 'Forbidden host or origin' }), {
        status: 403,
        contentType: 'application/json',
      });
    }
    return fn(data, req);
  };

  app.api('/api/status', guardApi(async () => getStudioStatus()), 'GET');
  app.api('/api/config', guardApi(async (data) => applyConfigUpdate(data)), 'POST');
  app.api('/api/reset', guardApi(async () => resetStudioConfig()), 'POST');
  app.api('/api/reinject', guardApi(async () => {
    const res = await injectOnce({ log: () => {} });
    return { ok: true, ...res };
  }), 'POST');
  app.api('/api/remove', guardApi(async () => {
    const removed = await removeFromAllWindows({ log: () => {}, warn: () => {} });
    return { ok: true, removed };
  }), 'POST');
  app.api('/api/open-usage-monitor', guardApi(async () => openUsageMonitorPaneInHost()), 'POST');
  app.api('/api/check-update', guardApi(async () => checkStudioUpdate()), 'GET');
  app.api('/api/self-update', guardApi(async () => performStudioSelfUpdate()), 'POST');
  app.api('/api/sync-i18n-compat', guardApi(async () => syncI18nCompatWhitelist()), 'POST');
  app.api('/api/notify', guardApi(async () => getNotifyConfigApi()), 'GET');
  app.api('/api/notify', guardApi(async (data) => saveNotifyConfigApi(data)), 'POST');
  app.api('/api/notify/test', guardApi(async (data) => testNotifyApi(data)), 'POST');
  app.api('/api/relaunch', guardApi(async () => {
    const res = await relaunchDesktopHost();
    if (!res?.ok) {
      return new Response(JSON.stringify(res), {
        status: res?.status || 500,
        contentType: 'application/json',
      });
    }
    return res;
  }), 'POST');

  let shuttingDown = false;
  let watchdog = null;
  let detachErrors = null;
  let logger = null;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceTimer = setTimeout(() => process.exit(0), 1500);
    forceTimer.unref?.();
    try {
      watchdog?.stop();
      detachErrors?.();
      logger?.dispose();
      await app.close();
    } catch {
      // Ignore close errors
    } finally {
      clearTimeout(forceTimer);
      lifecycle.exitProcessCleanly(0, 50);
    }
  };

  logger = lifecycle.createSafeLogger({
    enableConsole: false,
    logFile: null,
    onBrokenPipe: () => {
      void shutdown();
    },
  });
  detachErrors = logger.installProcessErrorGuards({
    onFatalPipe: () => {
      void shutdown();
    },
  });

  watchdog = lifecycle.startHostWatchdog({
    lsAddress: process.env.ANTIGRAVITY_LS_ADDRESS,
    watchStdin: false,
    checkIntervalMs: 3000,
    maxLsFailures: 2,
    onShutdown: () => {
      void shutdown();
    },
  });

  await app.run();
  return app;
}

function safeRealpath(filePath) {
  if (!filePath) return '';
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function isSameEntryPath(a, b) {
  if (!a || !b) return false;
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

const invokedPath = process.argv[1] ? safeRealpath(process.argv[1]) : '';
const currentPath = safeRealpath(fileURLToPath(import.meta.url));
if (isSameEntryPath(invokedPath, currentPath)) {
  startStudioSidecar().catch((err) => {
    console.error('[agy-claude-studio sidecar] failed:', err?.message || err);
    process.exit(1);
  });
}

export {
  isLocalHostRequest,
  detectUsageMonitorInstalled,
  compareSemver,
  checkStudioUpdate,
  performStudioSelfUpdate,
  syncI18nCompatWhitelist,
  resolveNotifyDir,
  getNotifyConfigApi,
  saveNotifyConfigApi,
  testNotifyApi,
  getStudioStatus,
  applyConfigUpdate,
  resetStudioConfig,
  relaunchDesktopHost,
  startStudioSidecar,
};
