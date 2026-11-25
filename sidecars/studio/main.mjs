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
const scriptsCore = require('../../scripts-core.js');
const periodicSync = require('../../periodic-sync.js');
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

async function syncPeriodicElementsApi({
  fetchFn = typeof fetch === 'function' ? fetch : null,
  pluginDataDir = cdp.PLUGIN_DATA_DIR || cdp.STATE_DIR,
  reinjectFn = () => injectOnce({ log: () => {} }),
} = {}) {
  try {
    const syncRes = await periodicSync.syncAndSavePeriodicElements({
      pluginDataDir,
      fetchFn,
      timeoutMs: 25000,
    });
    try {
      await reinjectFn();
    } catch {}
    return {
      ok: true,
      syncedAt: syncRes.syncedAt,
      totalElements: syncRes.totalElements,
      symbols: syncRes.symbols,
      newSymbols: syncRes.newSymbols,
      updatedSymbols: syncRes.updatedSymbols,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'periodic_sync_failed',
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

function resolveScriptsDir() {
  return scriptsCore.resolveScriptsDataDir(process.env, cdp.PLUGIN_DATA_DIR || null);
}

function getScriptsApi({ dataDir = resolveScriptsDir() } = {}) {
  const scripts = scriptsCore.readScriptsConfig(dataDir);
  return { ok: true, scripts };
}

function upsertScriptApi(data, { dataDir = resolveScriptsDir() } = {}) {
  const payload = data && typeof data === 'object' && data.script ? data.script : data;
  return scriptsCore.upsertCustomScript(dataDir, payload);
}

function deleteScriptApi(data, { dataDir = resolveScriptsDir() } = {}) {
  const id = data && typeof data === 'object' ? data.id : data;
  return scriptsCore.deleteCustomScript(dataDir, id);
}

async function runScriptApi(data, { dataDir = resolveScriptsDir() } = {}) {
  const id = data && typeof data === 'object' ? data.id : data;
  return scriptsCore.runCustomScript(dataDir, id);
}

async function callConversationService(method, body, { env = process.env, fetchFn = typeof fetch === 'function' ? fetch : null, timeoutMs = 4000 } = {}) {
  const addr = String(env?.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const csrf = String(env?.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (!addr || !csrf || typeof fetchFn !== 'function') {
    return { ok: false, reason: 'no_ls_env' };
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(`http://${addr}/product.v1.ConversationService/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': csrf,
      },
      body: JSON.stringify(body || {}),
      signal: ctrl?.signal,
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const json = await res.json();
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : err?.message || 'fetch_failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getLiveTasksCdpFallback() {
  const ports = cdp.readActivePorts();
  for (const port of ports) {
    let pages = [];
    try {
      pages = await cdp.listPages(port);
    } catch {
      continue;
    }
    for (const p of pages) {
      if (!p?.webSocketDebuggerUrl || !cdp.isAntigravityPageTarget(p)) continue;
      let sess = null;
      try {
        sess = await cdp.CdpSession.connect(p.webSocketDebuggerUrl);
        const snap = await sess.evaluate(
          `(() => {
            const title = (document.title || '').replace(/\\s*-\\s*Antigravity$/i, '').trim() || 'Antigravity';
            const stopBtn = document.querySelector('.surface-composer-card button[aria-label*="取消"], .surface-composer-card button[aria-label*="Cancel"], .surface-composer-card button[aria-label*="Stop"]');
            const isRunning = Boolean(stopBtn && stopBtn.offsetParent !== null);
            const rows = Array.from(document.querySelectorAll('[data-testid="conversation-row-sidebar"]')).slice(0, 5).map((r, i) => {
              const txt = (r.innerText || '').trim().split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
              const spinning = Boolean(r.querySelector('.animate-spin, [data-running="true"], svg.animate-spin'));
              return {
                id: 'dom_' + i,
                title: txt[0] || 'Conversation',
                runState: spinning ? 'RUN_STATE_RUNNING' : 'RUN_STATE_IDLE',
                updateTime: null,
                subagentCount: 0,
              };
            });
            const running = rows.filter(r => r.runState === 'RUN_STATE_RUNNING');
            if (isRunning && !running.length) {
              running.push({ id: 'active_window', title, runState: 'RUN_STATE_RUNNING', updateTime: new Date().toISOString(), subagentCount: 0 });
            }
            const recent = rows.filter(r => r.runState !== 'RUN_STATE_RUNNING').slice(0, 3);
            return { ok: true, available: true, source: 'cdp', running, recent, checkedAt: new Date().toISOString() };
          })()`,
          false
        );
        if (snap && snap.ok) return snap;
      } catch {
        // try next target
      } finally {
        sess?.close();
      }
    }
  }
  return { ok: true, available: false, source: 'none', running: [], recent: [], checkedAt: new Date().toISOString() };
}

async function callLanguageServer(method, body, { env = process.env, fetchFn = typeof fetch === 'function' ? fetch : null, timeoutMs = 4000 } = {}) {
  const addr = String(env?.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const csrf = String(env?.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (!addr || !csrf || typeof fetchFn !== 'function') {
    return { ok: false, reason: 'no_ls_env' };
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(`http://${addr}/exa.language_server_pb.LanguageServerService/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': csrf,
      },
      body: JSON.stringify(body || {}),
      signal: ctrl?.signal,
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const json = await res.json();
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : err?.message || 'fetch_failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractShortBaseName(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return '';
  let clean = rawUri.trim();
  try {
    clean = decodeURIComponent(clean);
  } catch {}
  clean = clean.replace(/^file:\/+/i, '').replace(/[\\/]+$/, '');
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function parseJsonSafe(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function classifyLiveStepActivity(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const ACTIVE_STATUSES = new Set([
    'CORTEX_STEP_STATUS_RUNNING',
    'CORTEX_STEP_STATUS_GENERATING',
    'CORTEX_STEP_STATUS_WAITING',
    'CORTEX_STEP_STATUS_PENDING',
  ]);

  let target = null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const s = steps[i];
    if (s && ACTIVE_STATUSES.has(String(s.status || ''))) {
      target = s;
      break;
    }
  }
  if (!target) {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i]) {
        target = steps[i];
        break;
      }
    }
  }
  if (!target) return null;

  const type = String(target.type || '').toUpperCase();
  const status = String(target.status || '').toUpperCase();
  const waiting = status === 'CORTEX_STEP_STATUS_WAITING';
  const toolCall = target.metadata?.toolCall || target.generic?.toolCall || null;
  const toolName = String(toolCall?.name || '').trim().toLowerCase();
  const toolArgs = parseJsonSafe(toolCall?.argumentsJson) || {};
  const toolSummary = String(target.metadata?.toolSummary || toolArgs.toolSummary || '').trim();
  const startedAt = target.metadata?.createdAt || null;

  let kind = 'running';
  let detail = toolSummary;

  if (waiting) {
    kind = 'waiting';
  } else if (type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
    const pr = target.plannerResponse || {};
    const hasResp = Boolean(pr.modifiedResponse || pr.response);
    const hasThink = Boolean(pr.thinking);
    kind = hasResp && !hasThink ? 'responding' : hasResp && status === 'CORTEX_STEP_STATUS_DONE' ? 'responding' : 'thinking';
    if (hasResp && hasThink && status === 'CORTEX_STEP_STATUS_GENERATING') {
      kind = 'responding';
    }
  } else if (type === 'CORTEX_STEP_TYPE_VIEW_FILE' || toolName === 'read_file' || toolName === 'view_file') {
    kind = 'reading_file';
    const file = extractShortBaseName(
      target.viewFile?.absolutePathUri || toolArgs.Path || toolArgs.AbsolutePath || ''
    );
    if (file) detail = file;
  } else if (
    type === 'CORTEX_STEP_TYPE_CODE_ACTION' ||
    toolName === 'edit_file' ||
    toolName === 'write_file' ||
    toolName === 'write_to_file' ||
    toolName === 'replace_file_content' ||
    toolName === 'multi_replace_file_content'
  ) {
    kind = 'editing_file';
    const file = extractShortBaseName(
      target.codeAction?.actionSpec?.editFile?.path?.absoluteUri ||
        target.codeAction?.actionSpec?.createFile?.path?.absoluteUri ||
        toolArgs.Path ||
        toolArgs.TargetFile ||
        ''
    );
    if (file) detail = file;
  } else if (type === 'CORTEX_STEP_TYPE_RUN_COMMAND' || toolName === 'run_command' || toolName === 'command_status') {
    kind = 'running_command';
    if (!detail) {
      const cmdLine = String(target.runCommand?.commandLine || toolArgs.CommandLine || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cmdLine) detail = cmdLine.slice(0, 44);
    }
  } else if (
    type === 'CORTEX_STEP_TYPE_GREP_SEARCH' ||
    type === 'CORTEX_STEP_TYPE_FIND' ||
    type === 'CORTEX_STEP_TYPE_LIST_DIRECTORY' ||
    toolName === 'grep_search' ||
    toolName === 'find_by_name' ||
    toolName === 'list_dir'
  ) {
    kind = 'searching';
    if (!detail) {
      detail = String(toolArgs.Query || toolArgs.Pattern || extractShortBaseName(toolArgs.SearchPath || toolArgs.DirectoryPath || '') || '').slice(0, 40);
    }
  } else if (type === 'CORTEX_STEP_TYPE_SEARCH_WEB' || toolName === 'search_web' || toolName === 'read_url_content') {
    kind = 'web_search';
    if (!detail) detail = String(toolArgs.query || toolArgs.Url || '').slice(0, 40);
  } else if (
    type === 'CORTEX_STEP_TYPE_BROWSER_SUBAGENT' ||
    toolName === 'invoke_subagent' ||
    toolName === 'swarm' ||
    toolName === 'browser_subagent'
  ) {
    kind = 'subagent';
    if (!detail) detail = String(toolArgs.Role || toolArgs.name || toolArgs.TaskName || '').slice(0, 40);
  } else if (type === 'CORTEX_STEP_TYPE_MCP_TOOL' || toolName === 'call_mcp_tool') {
    kind = 'mcp_tool';
    if (!detail) detail = String(toolArgs.ToolName || toolArgs.ServerName || '').slice(0, 40);
  } else if (toolName === 'ask_question') {
    kind = 'waiting';
  } else if (toolName) {
    kind = 'tool';
    if (!detail) detail = toolName;
  }

  return {
    kind,
    detail: String(detail || '').slice(0, 60),
    toolName,
    status,
    waiting,
    startedAt,
  };
}

async function getLiveTasksApi({ env = process.env, fetchFn = typeof fetch === 'function' ? fetch : null, allowCdpFallback = true } = {}) {
  const listRes = await callConversationService(
    'ListConversations',
    { pageSize: 30, includeArchived: false },
    { env, fetchFn }
  );
  if (!listRes.ok) {
    if (allowCdpFallback) {
      return getLiveTasksCdpFallback();
    }
    return {
      ok: true,
      available: false,
      source: 'none',
      reason: listRes.reason || 'unavailable',
      running: [],
      recent: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const convos = Array.isArray(listRes.data?.conversations) ? listRes.data.conversations : [];
  const normalizeConvo = (c) => ({
    id: String(c?.id || ''),
    title: String(c?.annotations?.title || c?.state?.summary || 'Untitled Conversation').trim(),
    runState: String(c?.state?.runState || 'RUN_STATE_IDLE'),
    updateTime: c?.state?.updateTime || c?.metadata?.createTime || null,
    createTime: c?.metadata?.createTime || null,
    pinned: Boolean(c?.annotations?.pinned),
    subagentCount: 0,
    activeSubagentCount: 0,
    stepCount: 0,
    activity: null,
  });

  const normalized = convos.map(normalizeConvo);
  const running = normalized.filter(
    (c) => c.runState === 'RUN_STATE_RUNNING' || c.runState === 'RUN_STATE_CANCELLING'
  );
  const recent = normalized
    .filter((c) => c.runState !== 'RUN_STATE_RUNNING' && c.runState !== 'RUN_STATE_CANCELLING')
    .slice(0, 3);

  // Enrich up to 5 running conversations with live step activity (via lightweight tail stepOffset) & subagents
  if (running.length > 0) {
    let summaries = {};
    const sumRes = await callLanguageServer('GetAllCascadeTrajectories', {}, { env, fetchFn, timeoutMs: 2500 });
    if (sumRes.ok && sumRes.data?.trajectorySummaries && typeof sumRes.data.trajectorySummaries === 'object') {
      summaries = sumRes.data.trajectorySummaries;
    }

    await Promise.all(
      running.slice(0, 5).map(async (item) => {
        const subPromise = callConversationService(
          'ListConversations',
          { pageSize: 20, parentConversationId: item.id, includeArchived: false },
          { env, fetchFn, timeoutMs: 2500 }
        );
        const stepCount = Number(summaries?.[item.id]?.stepCount || 0);
        item.stepCount = stepCount;
        const stepPromise =
          stepCount > 0
            ? callLanguageServer(
                'GetCascadeTrajectorySteps',
                { cascadeId: item.id, stepOffset: Math.max(0, stepCount - 10) },
                { env, fetchFn, timeoutMs: 2500 }
              )
            : Promise.resolve({ ok: false });

        const [subRes, stepsRes] = await Promise.all([subPromise, stepPromise]);
        if (subRes.ok && Array.isArray(subRes.data?.conversations)) {
          const subs = subRes.data.conversations;
          item.subagentCount = subs.length;
          item.activeSubagentCount = subs.filter(
            (s) => s?.state?.runState === 'RUN_STATE_RUNNING' || s?.state?.runState === 'RUN_STATE_CANCELLING'
          ).length;
        }
        if (stepsRes.ok && Array.isArray(stepsRes.data?.steps)) {
          item.activity = classifyLiveStepActivity(stepsRes.data.steps);
        }
      })
    );
  }

  return {
    ok: true,
    available: true,
    source: 'conversation_service',
    running,
    recent,
    totalCount: normalized.length,
    checkedAt: new Date().toISOString(),
  };
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
  app.api('/api/periodic-sync', guardApi(async () => syncPeriodicElementsApi()), 'POST');
  app.api('/api/notify', guardApi(async () => getNotifyConfigApi()), 'GET');
  app.api('/api/notify', guardApi(async (data) => saveNotifyConfigApi(data)), 'POST');
  app.api('/api/notify/test', guardApi(async (data) => testNotifyApi(data)), 'POST');
  app.api('/api/live-tasks', guardApi(async () => getLiveTasksApi()), 'GET');
  app.api('/api/scripts', guardApi(async () => getScriptsApi()), 'GET');
  app.api('/api/scripts', guardApi(async (data) => upsertScriptApi(data)), 'POST');
  app.api('/api/scripts/delete', guardApi(async (data) => deleteScriptApi(data)), 'POST');
  app.api('/api/scripts/run', guardApi(async (data) => runScriptApi(data)), 'POST');
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
  syncPeriodicElementsApi,
  resolveNotifyDir,
  resolveScriptsDir,
  getNotifyConfigApi,
  saveNotifyConfigApi,
  testNotifyApi,
  getScriptsApi,
  upsertScriptApi,
  deleteScriptApi,
  runScriptApi,
  classifyLiveStepActivity,
  getLiveTasksApi,
  getStudioStatus,
  applyConfigUpdate,
  resetStudioConfig,
  relaunchDesktopHost,
  startStudioSidecar,
};
