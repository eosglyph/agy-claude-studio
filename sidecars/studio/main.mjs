// Aux Pane Sidecar UI server for Claude Studio (agy-claude-studio).
// Uses sidecar_sdk and cleans up cleanly via host /healthz watchdog when Antigravity exits.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cdp = require('../../cdp.js');
const lifecycle = require('../../lifecycle.js');
const { updateConfigSetting, injectOnce } = require('../../inject.js');
const { removeFromAllWindows } = require('../../remove.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'index.html');
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

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
  getStudioStatus,
  applyConfigUpdate,
  resetStudioConfig,
  relaunchDesktopHost,
  startStudioSidecar,
};
