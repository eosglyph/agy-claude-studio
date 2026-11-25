// Aux Pane Sidecar UI server for Claude Studio (agy-claude-studio).
// Uses sidecar_sdk and cleans up cleanly via host /healthz watchdog when Antigravity exits.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
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
  const updateState = inspectGitRepoState(PLUGIN_ROOT_DIR);
  const hasPluginManifest = existsSync(join(PLUGIN_ROOT_DIR, 'plugin.json'));
  const updateMode = updateState.isGitRepo
    ? updateState.gitClean
      ? 'git'
      : 'dirty_git'
    : hasPluginManifest
    ? 'archive'
    : 'manual';

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
      isGitRepo: updateState.isGitRepo,
      gitClean: updateState.gitClean,
      updateMode,
      canAutoUpdate: updateMode === 'git' || updateMode === 'archive',
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

const UPDATE_CHECK_CACHE_TTL_MS = 10 * 60 * 1000;
let updateCheckCache = { at: 0, value: null };

function isValidStudioPluginDir(pluginDir) {
  if (!pluginDir) return false;
  const manifestPath = join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const name = String(manifest?.name || '').trim().toLowerCase();
    return name === 'agy-claude-studio' || name.startsWith('agy-claude-');
  } catch {
    return false;
  }
}

async function checkStudioUpdate({
  fetchFn = typeof fetch === 'function' ? fetch : null,
  pluginDir = PLUGIN_ROOT_DIR,
  currentVersion = cdp.PLUGIN_VERSION,
  execFn = execFileSync,
  timeoutMs = 8000,
  forceRefresh = false,
} = {}) {
  const isDefaultCall =
    pluginDir === PLUGIN_ROOT_DIR &&
    currentVersion === cdp.PLUGIN_VERSION &&
    execFn === execFileSync &&
    (fetchFn === fetch || fetchFn === null);

  if (
    isDefaultCall &&
    !forceRefresh &&
    updateCheckCache.value &&
    Date.now() - updateCheckCache.at < UPDATE_CHECK_CACHE_TTL_MS
  ) {
    return updateCheckCache.value;
  }

  const gitState = inspectGitRepoState(pluginDir, execFn);
  const canArchiveUpdate = !gitState.isGitRepo && isValidStudioPluginDir(pluginDir);
  const updateMode = gitState.isGitRepo
    ? gitState.gitClean
      ? 'git'
      : 'dirty_git'
    : canArchiveUpdate
    ? 'archive'
    : 'manual';
  const canAutoUpdate = updateMode === 'git' || updateMode === 'archive';
  const extraState = { ...gitState, updateMode, canAutoUpdate };

  if (!fetchFn) {
    return { ok: false, error: 'fetch unavailable', currentVersion, ...extraState, releaseUrl: LATEST_RELEASE_WEB_URL };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ua = `agy-claude-studio/${currentVersion}`;

  const buildOkResult = ({ latestTag, releaseName, publishedAt, releaseUrl, source }) => {
    const cleanTag = String(latestTag || '').trim();
    const latestVersion = cleanTag.replace(/^v/i, '');
    const hasUpdate = Boolean(latestVersion && compareSemver(latestVersion, currentVersion) > 0);
    const result = {
      ok: true,
      source,
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      latestTag: cleanTag || `v${currentVersion}`,
      hasUpdate,
      releaseName: String(releaseName || cleanTag || ''),
      publishedAt: String(publishedAt || ''),
      releaseUrl: String(releaseUrl || LATEST_RELEASE_WEB_URL),
      ...extraState,
    };
    if (isDefaultCall) {
      updateCheckCache = { at: Date.now(), value: result };
    }
    return result;
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
      ...extraState,
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'network error',
      currentVersion,
      ...extraState,
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  } finally {
    clearTimeout(timer);
  }
}

function findExtractedStudioRoot(extractDir) {
  if (isValidStudioPluginDir(extractDir)) return extractDir;
  try {
    const entries = readdirSync(extractDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const cand = join(extractDir, ent.name);
      if (isValidStudioPluginDir(cand)) return cand;
    }
  } catch {}
  return null;
}

const ARCHIVE_SKIP_TOP_NAMES = new Set(['.git', '.github', '.gitignore', 'node_modules', 'dist', 'release']);

async function performArchiveSelfUpdate({
  pluginDir,
  targetTag = '',
  fetchFn = typeof fetch === 'function' ? fetch : null,
  execFn = execFileSync,
  reinjectFn = () => injectOnce({ log: () => {} }),
  timeoutMs = 30000,
} = {}) {
  if (!isValidStudioPluginDir(pluginDir)) {
    return { ok: false, reason: 'not_git_repo', releaseUrl: LATEST_RELEASE_WEB_URL };
  }
  if (!fetchFn) {
    return { ok: false, reason: 'fetch_unavailable', releaseUrl: LATEST_RELEASE_WEB_URL };
  }

  let cleanTag = String(targetTag || '').trim();
  if (!cleanTag) {
    const chk = await checkStudioUpdate({ fetchFn, pluginDir, execFn, forceRefresh: true });
    if (!chk.ok || !chk.latestTag) {
      return {
        ok: false,
        reason: 'update_check_failed',
        error: chk?.error || 'Could not resolve latest release tag',
        releaseUrl: LATEST_RELEASE_WEB_URL,
      };
    }
    cleanTag = chk.latestTag;
  }
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(cleanTag)) {
    return { ok: false, reason: 'invalid_tag', error: `Invalid release tag: ${cleanTag}`, releaseUrl: LATEST_RELEASE_WEB_URL };
  }

  const normalizedTag = cleanTag.startsWith('v') ? cleanTag : `v${cleanTag}`;
  const tarUrl = `https://github.com/eosglyph/agy-claude-studio/archive/refs/tags/${encodeURIComponent(normalizedTag)}.tar.gz`;
  const tmpRoot = mkdtempSync(join(tmpdir(), 'agy-cs-upd-'));
  const archivePath = join(tmpRoot, 'release.tar.gz');
  const extractDir = join(tmpRoot, 'extracted');

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let buf = null;
    try {
      const res = await fetchFn(tarUrl, {
        redirect: 'follow',
        headers: { 'User-Agent': `agy-claude-studio/${cdp.PLUGIN_VERSION}` },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: 'archive_download_failed',
          error: `HTTP ${res.status}`,
          releaseUrl: LATEST_RELEASE_WEB_URL,
        };
      }
      buf = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }

    if (!buf || buf.length < 100) {
      return {
        ok: false,
        reason: 'archive_download_failed',
        error: 'Downloaded archive is empty',
        releaseUrl: LATEST_RELEASE_WEB_URL,
      };
    }

    writeFileSync(archivePath, buf);
    mkdirSync(extractDir, { recursive: true });
    execFn('tar', ['-xzf', archivePath, '-C', extractDir], { encoding: 'utf8', timeout: timeoutMs });

    const sourceRoot = findExtractedStudioRoot(extractDir);
    if (!sourceRoot) {
      return {
        ok: false,
        reason: 'archive_invalid',
        error: 'Release archive missing valid plugin.json',
        releaseUrl: LATEST_RELEASE_WEB_URL,
      };
    }

    const entries = readdirSync(sourceRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (ARCHIVE_SKIP_TOP_NAMES.has(ent.name)) continue;
      const srcPath = join(sourceRoot, ent.name);
      const dstPath = join(pluginDir, ent.name);
      cpSync(srcPath, dstPath, { recursive: true, force: true });
    }

    let nextVersion = normalizedTag.replace(/^v/i, '');
    try {
      const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
      if (pkg?.version) nextVersion = String(pkg.version);
    } catch {}

    updateCheckCache = { at: 0, value: null };
    try {
      await reinjectFn();
    } catch {}

    return {
      ok: true,
      mode: 'archive',
      updated: true,
      version: nextVersion,
      tag: normalizedTag,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'archive_update_failed',
      error: err?.message || String(err),
      releaseUrl: LATEST_RELEASE_WEB_URL,
    };
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

async function performStudioSelfUpdate({
  pluginDir = PLUGIN_ROOT_DIR,
  execFn = execFileSync,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  targetTag = '',
  allowArchive = true,
  reinjectFn = () => injectOnce({ log: () => {} }),
} = {}) {
  const gitState = inspectGitRepoState(pluginDir, execFn);
  if (!gitState.isGitRepo) {
    if (allowArchive && isValidStudioPluginDir(pluginDir)) {
      return performArchiveSelfUpdate({
        pluginDir,
        targetTag,
        fetchFn,
        execFn,
        reinjectFn,
      });
    }
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
    updateCheckCache = { at: 0, value: null };
    try {
      await reinjectFn();
    } catch {}
    return {
      ok: true,
      mode: 'git',
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

const BOOKKEEPING_TOOLS = new Set(['update_steps', 'update_focus']);

function extractSingleStepActivity(step) {
  if (!step || typeof step !== 'object') return null;
  const type = String(step.type || '').toUpperCase();
  const status = String(step.status || '').toUpperCase();
  const waiting = status === 'CORTEX_STEP_STATUS_WAITING';
  const toolCall = step.metadata?.toolCall || step.generic?.toolCall || null;
  const toolName = String(toolCall?.name || '').trim().toLowerCase();
  const toolArgs = parseJsonSafe(toolCall?.argumentsJson) || {};
  const toolSummary = String(step.metadata?.toolSummary || toolArgs.toolSummary || '').trim();
  const startedAt = step.metadata?.createdAt || null;

  let kind = 'running';
  let detail = toolSummary;
  let isToolStep = false;

  if (waiting) {
    kind = 'waiting';
  } else if (type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
    const pr = step.plannerResponse || {};
    const hasResp = Boolean(pr.modifiedResponse || pr.response);
    const hasThink = Boolean(pr.thinking);
    kind = hasResp && !hasThink ? 'responding' : hasResp && status === 'CORTEX_STEP_STATUS_DONE' ? 'responding' : 'thinking';
    if (hasResp && hasThink && status === 'CORTEX_STEP_STATUS_GENERATING') {
      kind = 'responding';
    }
  } else if (type === 'CORTEX_STEP_TYPE_VIEW_FILE' || toolName === 'read_file' || toolName === 'view_file') {
    kind = 'reading_file';
    isToolStep = true;
    const file = extractShortBaseName(
      step.viewFile?.absolutePathUri || toolArgs.Path || toolArgs.AbsolutePath || ''
    );
    const startLine = Number(toolArgs.StartLine || (step.viewFile?.startLine != null ? Number(step.viewFile.startLine) + 1 : 0));
    const endLine = Number(toolArgs.EndLine || (step.viewFile?.endLine != null ? Number(step.viewFile.endLine) + 1 : 0));
    if (file) {
      detail = startLine > 0 && endLine >= startLine ? `${file}:${startLine}-${endLine}` : file;
    }
  } else if (
    type === 'CORTEX_STEP_TYPE_CODE_ACTION' ||
    toolName === 'edit_file' ||
    toolName === 'write_file' ||
    toolName === 'write_to_file' ||
    toolName === 'replace_file_content' ||
    toolName === 'multi_replace_file_content'
  ) {
    kind = 'editing_file';
    isToolStep = true;
    const file = extractShortBaseName(
      step.codeAction?.actionSpec?.editFile?.path?.absoluteUri ||
        step.codeAction?.actionSpec?.createFile?.path?.absoluteUri ||
        toolArgs.Path ||
        toolArgs.TargetFile ||
        ''
    );
    if (file) detail = file;
  } else if (type === 'CORTEX_STEP_TYPE_RUN_COMMAND' || toolName === 'run_command' || toolName === 'command_status') {
    kind = 'running_command';
    isToolStep = true;
    if (!detail) {
      const cmdLine = String(step.runCommand?.commandLine || toolArgs.CommandLine || '')
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
    isToolStep = true;
    if (!detail) {
      detail = String(toolArgs.Query || toolArgs.Pattern || extractShortBaseName(toolArgs.SearchPath || toolArgs.DirectoryPath || '') || '').slice(0, 40);
    }
  } else if (type === 'CORTEX_STEP_TYPE_SEARCH_WEB' || toolName === 'search_web' || toolName === 'read_url_content') {
    kind = 'web_search';
    isToolStep = true;
    if (!detail) detail = String(toolArgs.query || toolArgs.Url || '').slice(0, 40);
  } else if (
    type === 'CORTEX_STEP_TYPE_BROWSER_SUBAGENT' ||
    toolName === 'invoke_subagent' ||
    toolName === 'swarm' ||
    toolName === 'browser_subagent'
  ) {
    kind = 'subagent';
    isToolStep = true;
    if (!detail) detail = String(toolArgs.Role || toolArgs.name || toolArgs.TaskName || '').slice(0, 40);
  } else if (type === 'CORTEX_STEP_TYPE_MCP_TOOL' || toolName === 'call_mcp_tool') {
    kind = 'mcp_tool';
    isToolStep = true;
    if (!detail) detail = String(toolArgs.ToolName || toolArgs.ServerName || '').slice(0, 40);
  } else if (toolName === 'ask_question') {
    kind = 'waiting';
    isToolStep = true;
  } else if (toolName) {
    kind = 'tool';
    isToolStep = true;
    if (!detail) detail = toolName;
  }

  return {
    kind,
    detail: String(detail || '').slice(0, 72),
    toolName,
    status,
    waiting,
    startedAt,
    isToolStep,
    isBookkeeping: BOOKKEEPING_TOOLS.has(toolName),
  };
}

function classifyLiveStepActivity(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const ACTIVE_STATUSES = new Set([
    'CORTEX_STEP_STATUS_RUNNING',
    'CORTEX_STEP_STATUS_GENERATING',
    'CORTEX_STEP_STATUS_WAITING',
    'CORTEX_STEP_STATUS_PENDING',
  ]);

  let targetIdx = -1;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const s = steps[i];
    if (s && ACTIVE_STATUSES.has(String(s.status || ''))) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx < 0) {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i]) {
        targetIdx = i;
        break;
      }
    }
  }
  if (targetIdx < 0) return null;

  const targetInfo = extractSingleStepActivity(steps[targetIdx]);
  if (!targetInfo) return null;

  // Detect parallel tool call batch within the current turn (after the latest PLANNER_RESPONSE)
  let batch = null;
  let combinedDetail = targetInfo.detail;
  if (targetInfo.isToolStep) {
    let lastPlannerIdx = -1;
    let plannedToolCount = 0;
    for (let i = targetIdx - 1; i >= 0; i -= 1) {
      const st = steps[i];
      if (!st) continue;
      const tp = String(st.type || '').toUpperCase();
      if (tp === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
        lastPlannerIdx = i;
        const pTools = Array.isArray(st.plannerResponse?.toolCalls) ? st.plannerResponse.toolCalls : [];
        const nonBook = pTools.filter((tc) => !BOOKKEEPING_TOOLS.has(String(tc?.name || '').toLowerCase()));
        plannedToolCount = nonBook.length;
        break;
      }
      if (tp === 'CORTEX_STEP_TYPE_USER_INPUT') break;
    }

    const turnItems = [];
    for (let i = lastPlannerIdx + 1; i < steps.length; i += 1) {
      const info = extractSingleStepActivity(steps[i]);
      if (info && info.isToolStep && !info.isBookkeeping) {
        turnItems.push(info);
      }
    }

    const sameKindItems = turnItems.filter((it) => it.kind === targetInfo.kind);
    const batchItems = sameKindItems.length >= 2 ? sameKindItems : turnItems;
    const total = Math.max(batchItems.length, sameKindItems.length >= 2 ? sameKindItems.length : plannedToolCount);
    if (total >= 2) {
      const done = batchItems.filter((it) => it.status === 'CORTEX_STEP_STATUS_DONE').length;
      batch = { done: Math.min(done, total), total };
      const uniqDetails = [];
      for (const it of batchItems) {
        if (it.detail && !uniqDetails.includes(it.detail)) uniqDetails.push(it.detail);
      }
      if (uniqDetails.length > 0) {
        combinedDetail = uniqDetails.slice(0, 2).join(', ');
      }
    }
  }

  return {
    kind: targetInfo.kind,
    detail: String(combinedDetail || '').slice(0, 72),
    toolName: targetInfo.toolName,
    status: targetInfo.status,
    waiting: targetInfo.waiting,
    startedAt: targetInfo.startedAt,
    batch,
  };
}

function normalizeChildSubagent(conv, trajSummary) {
  const meta = trajSummary?.trajectoryMetadata || {};
  const spec = meta.subagentSpec || {};
  const scriptName = String(meta.agentScript?.name || '').trim();
  const typeName = String(spec.typeName || '').toLowerCase();
  const rawRole = String(spec.role || '').trim();
  const isSwarm = typeName === 'worker' || /^swarm\s+worker/i.test(rawRole) || /^@/.test(String(conv?.annotations?.title || ''));

  let title = '';
  if (isSwarm) {
    const swarmName = scriptName || rawRole.replace(/^Swarm Worker\s*\((.+)\)$/i, '$1').trim() || String(conv?.annotations?.title || '').trim();
    title = swarmName ? (swarmName.startsWith('@') ? swarmName : `@${swarmName}`) : 'Swarm Worker';
  } else {
    title =
      rawRole ||
      String(conv?.annotations?.title || '').trim() ||
      String(trajSummary?.summary || '').trim() ||
      scriptName ||
      'Subagent';
  }

  const runState = String(conv?.state?.runState || '').toUpperCase();
  const sumStatus = String(trajSummary?.status || '').toUpperCase();
  const term = String(trajSummary?.latestExecutorTerminationReason || '').toUpperCase();

  let state = 'done';
  if (runState === 'RUN_STATE_RUNNING' || sumStatus.includes('RUNNING')) {
    state = 'running';
  } else if (runState === 'RUN_STATE_CANCELLING' || sumStatus.includes('CANCELLING')) {
    state = 'cancelling';
  } else if (term.includes('CANCELED') || term.includes('TERMINAL_CUSTOM_HOOK') || sumStatus.includes('CANCELLED')) {
    state = 'stopped';
  } else if (term.includes('ERROR') || sumStatus.includes('ERROR')) {
    state = 'error';
  }

  return {
    id: String(conv?.id || ''),
    title,
    kind: isSwarm ? 'swarm' : 'subagent',
    state,
    runState: runState || 'RUN_STATE_IDLE',
    stepCount: Number(trajSummary?.stepCount || 0),
    createdAt: String(conv?.metadata?.createTime || meta.createdAt || trajSummary?.createdTime || ''),
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
    subagents: [],
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

  const targetsToEnrich = running.length > 0 ? running.slice(0, 5) : recent.slice(0, 1);
  if (targetsToEnrich.length > 0) {
    let summaries = {};
    const sumRes = await callLanguageServer('GetAllCascadeTrajectories', {}, { env, fetchFn, timeoutMs: 2500 });
    if (sumRes.ok && sumRes.data?.trajectorySummaries && typeof sumRes.data.trajectorySummaries === 'object') {
      summaries = sumRes.data.trajectorySummaries;
    }

    await Promise.all(
      targetsToEnrich.map(async (item) => {
        const isRunningItem = item.runState === 'RUN_STATE_RUNNING' || item.runState === 'RUN_STATE_CANCELLING';
        const subPromise = callConversationService(
          'ListConversations',
          { pageSize: 30, parentConversationId: item.id, includeArchived: false },
          { env, fetchFn, timeoutMs: 2500 }
        );
        const stepCount = Number(summaries?.[item.id]?.stepCount || 0);
        item.stepCount = stepCount;
        const stepPromise =
          isRunningItem && stepCount > 0
            ? callLanguageServer(
                'GetCascadeTrajectorySteps',
                { cascadeId: item.id, stepOffset: Math.max(0, stepCount - 12) },
                { env, fetchFn, timeoutMs: 2500 }
              )
            : Promise.resolve({ ok: false });

        const [subRes, stepsRes] = await Promise.all([subPromise, stepPromise]);
        if (subRes.ok && Array.isArray(subRes.data?.conversations)) {
          const subs = subRes.data.conversations;
          const mapped = subs
            .map((s) => normalizeChildSubagent(s, summaries?.[s?.id]))
            .sort((a, b) => (Date.parse(a.createdAt || 0) || 0) - (Date.parse(b.createdAt || 0) || 0));
          item.subagents = mapped;
          item.subagentCount = mapped.length;
          item.activeSubagentCount = mapped.filter(
            (s) => s.state === 'running' || s.state === 'cancelling'
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

// ── Conversation Inspector (Environment / Context / Connectors / Outputs) ──
const INSPECTOR_CONTEXT_CACHE_MAX = 16;
const inspectorContextCache = new Map();

function decodeFileUriToPath(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return '';
  let s = rawUri.trim();
  if (!s) return '';
  if (/^file:/i.test(s)) {
    s = s.replace(/^file:\/\//i, '');
    try {
      s = decodeURIComponent(s);
    } catch {}
    if (/^\/[a-zA-Z]:/.test(s)) {
      s = s.slice(1);
    }
  }
  s = s.replace(/[\\/]+$/, '');
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(s)) {
    s = s[0].toUpperCase() + s.slice(1).replace(/\//g, '\\');
  }
  return s;
}

function readGitBranchFast(workspaceDir, fallbackBranch = '') {
  if (!workspaceDir || !existsSync(workspaceDir)) return String(fallbackBranch || '').trim();
  try {
    let gitDir = join(workspaceDir, '.git');
    if (!existsSync(gitDir)) return String(fallbackBranch || '').trim();
    const st = statSync(gitDir);
    if (st.isFile()) {
      const ptr = readFileSync(gitDir, 'utf8').trim();
      const m = ptr.match(/^gitdir:\s*(.+)$/i);
      if (m) gitDir = resolve(workspaceDir, m[1].trim());
    }
    const headPath = join(gitDir, 'HEAD');
    if (!existsSync(headPath)) return String(fallbackBranch || '').trim();
    const head = readFileSync(headPath, 'utf8').trim();
    const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (refMatch) return refMatch[1].trim();
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);
  } catch {}
  return String(fallbackBranch || '').trim();
}

function resolveAppDataDir(customDir) {
  if (customDir) return resolve(String(customDir));
  return join(homedir(), '.gemini', 'antigravity');
}

function resolveUserConfigDir(customDir) {
  if (customDir) return resolve(String(customDir));
  return join(homedir(), '.gemini', 'config');
}

function formatConnectorDisplayName(rawId, installedPluginMap) {
  const clean = String(rawId || '').trim();
  if (!clean) return '';
  const low = clean.toLowerCase();
  for (const [slug, display] of installedPluginMap.entries()) {
    if (low === slug || low.startsWith(`${slug}_`) || low.startsWith(`${slug}-`)) {
      return display || slug;
    }
  }
  return clean;
}

function scanMcpAndConnectors(appDataDir, configDir) {
  const installedPlugins = new Map();
  const pluginsRoot = join(configDir, 'plugins');
  try {
    if (existsSync(pluginsRoot)) {
      for (const ent of readdirSync(pluginsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const manifestPath = join(pluginsRoot, ent.name, 'plugin.json');
        let display = ent.name;
        let slug = ent.name.toLowerCase();
        if (existsSync(manifestPath)) {
          try {
            const p = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (p?.name) slug = String(p.name).toLowerCase();
            if (p?.displayName) display = String(p.displayName);
          } catch {}
        }
        installedPlugins.set(slug, display);
        installedPlugins.set(ent.name.toLowerCase(), display);
      }
    }
  } catch {}

  const connectors = [];
  const mcpTools = [];
  const mcpRoot = join(appDataDir, 'mcp');
  try {
    if (existsSync(mcpRoot)) {
      for (const ent of readdirSync(mcpRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const serverDir = join(mcpRoot, ent.name);
        let tools = [];
        try {
          tools = readdirSync(serverDir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.slice(0, -5))
            .sort();
        } catch {}
        const low = ent.name.toLowerCase();
        let matchesInstalledPlugin = false;
        for (const slug of installedPlugins.keys()) {
          if (low === slug || low.startsWith(`${slug}_`) || low.startsWith(`${slug}-`)) {
            matchesInstalledPlugin = true;
            break;
          }
        }
        // Skip stale leftover plugin host directories that have 0 tools and are no longer installed
        if (tools.length === 0 && !matchesInstalledPlugin) continue;
        const displayName = formatConnectorDisplayName(ent.name, installedPlugins);
        connectors.push({
          id: ent.name,
          name: displayName,
          toolCount: tools.length,
          tools,
        });
        for (const tName of tools) {
          mcpTools.push({ name: tName, server: displayName });
        }
      }
    }
  } catch {}

  connectors.sort((a, b) => b.toolCount - a.toolCount || a.name.localeCompare(b.name));
  return { connectors, mcpTools };
}

function scanSkillsAndRules(configDir, workspacePath = '') {
  const skills = [];
  const rules = [];
  const seenSkill = new Set();

  const scanSkillRoot = (rootDir, scope) => {
    try {
      if (!existsSync(rootDir)) return;
      for (const ent of readdirSync(rootDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (!existsSync(join(rootDir, ent.name, 'SKILL.md'))) continue;
        const key = `${scope}:${ent.name}`;
        if (seenSkill.has(key)) continue;
        seenSkill.add(key);
        skills.push({ name: ent.name, scope });
      }
    } catch {}
  };

  scanSkillRoot(join(configDir, 'skills'), 'user');
  const pluginsRoot = join(configDir, 'plugins');
  try {
    if (existsSync(pluginsRoot)) {
      for (const ent of readdirSync(pluginsRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        scanSkillRoot(join(pluginsRoot, ent.name, 'skills'), ent.name);
      }
    }
  } catch {}

  const addRuleFile = (filePath, scope) => {
    try {
      if (!existsSync(filePath)) return;
      const st = statSync(filePath);
      if (!st.isFile()) return;
      rules.push({ name: basename(filePath), path: filePath, scope });
    } catch {}
  };

  const userRulesDir = join(configDir, 'rules');
  try {
    if (existsSync(userRulesDir)) {
      for (const f of readdirSync(userRulesDir)) {
        if (/\.md$/i.test(f)) addRuleFile(join(userRulesDir, f), 'global');
      }
    }
  } catch {}

  if (workspacePath && existsSync(workspacePath)) {
    for (const rel of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      addRuleFile(join(workspacePath, rel), 'workspace');
    }
    for (const sub of [join('.gemini', 'rules'), join('.agent', 'rules')]) {
      const dir = join(workspacePath, sub);
      try {
        if (existsSync(dir)) {
          for (const f of readdirSync(dir)) {
            if (/\.md$/i.test(f)) addRuleFile(join(dir, f), 'workspace');
          }
        }
      } catch {}
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, rules };
}

const OUTPUTS_SKIP_NAMES = new Set(['scratch', 'browser_sandbox', 'browser_evidence']);

function scanConversationOutputs(appDataDir, conversationId) {
  if (!conversationId) return [];
  const brainDir = join(appDataDir, 'brain', String(conversationId));
  if (!existsSync(brainDir)) return [];
  const outputs = [];
  try {
    const entries = readdirSync(brainDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (ent.name.startsWith('.') || OUTPUTS_SKIP_NAMES.has(ent.name)) continue;
      const fullPath = join(brainDir, ent.name);
      try {
        const st = statSync(fullPath);
        outputs.push({
          name: ent.name,
          path: fullPath,
          ext: extname(ent.name).toLowerCase(),
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {}
    }
  } catch {}
  outputs.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  return outputs.slice(0, 20);
}

function classifyBreakdownGroupKey(grp) {
  const type = String(grp?.type || '').toUpperCase();
  const name = String(grp?.name || '').toLowerCase();
  if (type === 'TOKEN_TYPE_CHAT_MESSAGES' || type === '7' || /chat|message/.test(name)) return 'messages';
  if (type === 'TOKEN_TYPE_MCP_TOOLS' || type === '4' || /mcp/.test(name)) return 'mcpTools';
  if (type === 'TOKEN_TYPE_TOOLS' || type === '2' || name === 'tools') return 'systemTools';
  if (type === 'TOKEN_TYPE_SYSTEM_PROMPT' || type === '1' || /system\s*prompt/.test(name)) return 'systemPrompt';
  if (type === 'TOKEN_TYPE_SKILLS' || type === '6' || /skill/.test(name)) return 'skills';
  if (type === 'TOKEN_TYPE_RULES' || type === '5' || /rule|memory/.test(name)) return 'rules';
  if (type === 'TOKEN_TYPE_SUBAGENTS' || /subagent/.test(name)) return 'subagents';
  if (type === 'TOKEN_TYPE_PLUGINS' || type === '9' || /plugin/.test(name)) return 'plugins';
  return 'other';
}

const CONTEXT_SEGMENT_ORDER = [
  'messages',
  'mcpTools',
  'systemTools',
  'systemPrompt',
  'skills',
  'rules',
  'subagents',
  'plugins',
  'other',
];

function extractContextBreakdownFromGm(gmList) {
  if (!Array.isArray(gmList) || gmList.length === 0) return null;
  let latestCw = null;
  let latestVal = null;
  for (let i = gmList.length - 1; i >= 0; i -= 1) {
    const entry = gmList[i];
    const val = entry?.chatModel || entry?.metadata?.value || entry;
    if (!val || typeof val !== 'object') continue;
    const cw = val.chatStartMetadata?.contextWindowMetadata;
    if (cw && (Number(cw.maxContextTokens || 0) > 0 || Number(cw.estimatedTokensUsed || 0) > 0 || cw.tokenBreakdown?.groups?.length)) {
      latestCw = cw;
      latestVal = val;
      break;
    }
    if (!latestVal && val.usage) {
      latestVal = val;
    }
  }

  if (!latestCw && !latestVal) return null;

  const usage = latestVal?.usage || {};
  const usagePrompt =
    Number(usage.inputTokens || 0) + Number(usage.cacheReadTokens || 0) + Number(usage.cacheWriteTokens || 0);
  const usageOut = Number(usage.outputTokens || 0);
  const usageThink = Number(usage.thinkingOutputTokens || 0);
  const usageResp = Number(usage.responseOutputTokens || Math.max(0, usageOut - usageThink) || 0);
  const usageAfterCall = usagePrompt > 0 ? usagePrompt + usageResp : 0;
  const maxTokens = Number(latestCw?.maxContextTokens || 0) || 256000;
  const rawGroups = Array.isArray(latestCw?.tokenBreakdown?.groups) ? latestCw.tokenBreakdown.groups : [];

  const buckets = new Map();
  let groupSum = 0;
  for (const grp of rawGroups) {
    const tokens = Math.max(0, Number(grp?.numTokens || 0));
    if (tokens <= 0) continue;
    const key = classifyBreakdownGroupKey(grp);
    const cur = buckets.get(key) || { key, tokens: 0, childCount: 0 };
    cur.tokens += tokens;
    cur.childCount += Array.isArray(grp?.children) ? grp.children.length : 0;
    buckets.set(key, cur);
    groupSum += tokens;
  }

  const estimatedUsed = Number(latestCw?.estimatedTokensUsed || 0);
  // Align total used tokens with usage-core.js billed context metric:
  // max(pre-request estimatedTokensUsed, actual prompt + responseOutputTokens)
  const usedTokens = Math.max(estimatedUsed, groupSum, usageAfterCall);

  if (usedTokens > 0) {
    if (buckets.size === 0) {
      buckets.set('messages', { key: 'messages', tokens: usedTokens, childCount: 0 });
    } else if (usedTokens > groupSum) {
      const delta = usedTokens - groupSum;
      const msgCur = buckets.get('messages') || { key: 'messages', tokens: 0, childCount: 0 };
      msgCur.tokens += delta;
      buckets.set('messages', msgCur);
    }
  }

  const segments = [];
  for (const key of CONTEXT_SEGMENT_ORDER) {
    const item = buckets.get(key);
    if (!item || item.tokens <= 0) continue;
    segments.push({
      key: item.key,
      tokens: item.tokens,
      pct: maxTokens > 0 ? (item.tokens / maxTokens) * 100 : 0,
      childCount: item.childCount,
    });
  }

  const freeTokens = Math.max(0, maxTokens - usedTokens);
  const usedPct = maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : 0;
  const freePct = maxTokens > 0 ? Math.max(0, Math.min(100, (freeTokens / maxTokens) * 100)) : 100;

  return {
    available: usedTokens > 0 || maxTokens > 0,
    modelName: String(latestVal?.modelDisplayName || latestVal?.responseModel || '').trim(),
    usedTokens,
    maxTokens,
    freeTokens,
    usedPct,
    freePct,
    segments,
  };
}

async function getConversationInspectorApi({
  conversationId = '',
  env = process.env,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  appDataDir = resolveAppDataDir(),
  configDir = resolveUserConfigDir(),
} = {}) {
  let targetId = String(conversationId || '').trim();
  let summary = null;
  let lsAvailable = false;

  const sumRes = await callLanguageServer('GetAllCascadeTrajectories', {}, { env, fetchFn, timeoutMs: 3000 });
  const summaries =
    sumRes.ok && sumRes.data?.trajectorySummaries && typeof sumRes.data.trajectorySummaries === 'object'
      ? sumRes.data.trajectorySummaries
      : null;

  if (summaries) {
    lsAvailable = true;
    if (targetId && summaries[targetId]) {
      summary = summaries[targetId];
    } else if (!targetId) {
      // Pick active running conversation first, else most recently modified root conversation
      const entries = Object.entries(summaries).filter(([, s]) => !s?.trajectoryMetadata?.parentConversationId);
      const running = entries.filter(([, s]) => String(s?.status || '').includes('RUNNING'));
      const pool = running.length > 0 ? running : entries;
      pool.sort((a, b) => {
        const ta = Date.parse(a[1]?.lastModifiedTime || a[1]?.createdTime || 0) || 0;
        const tb = Date.parse(b[1]?.lastModifiedTime || b[1]?.createdTime || 0) || 0;
        return tb - ta;
      });
      if (pool.length > 0) {
        targetId = pool[0][0];
        summary = pool[0][1];
      }
    }
  }

  // Environment
  const ws = Array.isArray(summary?.workspaces) && summary.workspaces[0]
    ? summary.workspaces[0]
    : Array.isArray(summary?.trajectoryMetadata?.workspaces) && summary.trajectoryMetadata.workspaces[0]
    ? summary.trajectoryMetadata.workspaces[0]
    : null;
  const fullPath = decodeFileUriToPath(ws?.workspaceFolderAbsoluteUri || '');
  const workspaceName = fullPath ? basename(fullPath) : '';
  const parentPath = fullPath ? dirname(fullPath) : '';
  const branch = readGitBranchFast(fullPath, ws?.branchName || '');

  const environment = {
    host: 'local',
    workspaceName,
    parentPath,
    fullPath,
    branch,
  };

  // Context (cached by conversationId + stepCount + lastModifiedTime)
  let context = null;
  if (lsAvailable && targetId) {
    const stepCount = Number(summary?.stepCount || 0);
    const lastMod = String(summary?.lastModifiedTime || '');
    const cached = inspectorContextCache.get(targetId);
    if (cached && cached.stepCount === stepCount && cached.lastModifiedTime === lastMod && cached.context) {
      context = cached.context;
    } else {
      const reqBody = { cascadeId: targetId };
      const usedOffset = cached && cached.gmCount > 3 ? cached.gmCount - 3 : 0;
      if (usedOffset > 0) {
        reqBody.generatorMetadataOffset = usedOffset;
      }
      let gmRes = await callLanguageServer('GetCascadeTrajectoryGeneratorMetadata', reqBody, {
        env,
        fetchFn,
        timeoutMs: 4000,
      });
      let gmList = gmRes.ok && Array.isArray(gmRes.data?.generatorMetadata) ? gmRes.data.generatorMetadata : [];
      if (usedOffset > 0 && gmList.length === 0) {
        gmRes = await callLanguageServer(
          'GetCascadeTrajectoryGeneratorMetadata',
          { cascadeId: targetId },
          { env, fetchFn, timeoutMs: 4000 }
        );
        gmList = gmRes.ok && Array.isArray(gmRes.data?.generatorMetadata) ? gmRes.data.generatorMetadata : [];
      }
      context = extractContextBreakdownFromGm(gmList);
      const nextGmCount = usedOffset > 0 && gmList.length > 0 ? usedOffset + gmList.length : gmList.length;
      if (inspectorContextCache.size >= INSPECTOR_CONTEXT_CACHE_MAX) {
        const oldestKey = inspectorContextCache.keys().next().value;
        if (oldestKey) inspectorContextCache.delete(oldestKey);
      }
      inspectorContextCache.set(targetId, {
        stepCount,
        lastModifiedTime: lastMod,
        gmCount: nextGmCount,
        context,
      });
    }
  }

  const { connectors, mcpTools } = scanMcpAndConnectors(appDataDir, configDir);
  const { skills, rules } = scanSkillsAndRules(configDir, fullPath);
  const outputs = scanConversationOutputs(appDataDir, targetId);

  return {
    ok: true,
    available: lsAvailable || connectors.length > 0 || outputs.length > 0,
    conversationId: targetId,
    title: String(summary?.annotations?.title || summary?.summary || '').trim(),
    stepCount: Number(summary?.stepCount || 0),
    environment,
    context: context || {
      available: false,
      modelName: '',
      usedTokens: 0,
      maxTokens: 0,
      freeTokens: 0,
      usedPct: 0,
      freePct: 100,
      segments: [],
    },
    mcpTools,
    skills,
    rules,
    connectors,
    outputs,
    checkedAt: new Date().toISOString(),
  };
}

const BLOCKED_OPEN_EXTS = new Set(['.exe', '.bat', '.cmd', '.com', '.ps1', '.vbs', '.js', '.mjs', '.cjs', '.sh', '.msi', '.scr', '.lnk']);

function openInspectorFileApi(data, { appDataDir = resolveAppDataDir(), spawnFn = spawn } = {}) {
  const filePath = String(data?.path || '').trim();
  const conversationId = String(data?.conversationId || '').trim();
  if (!filePath || !conversationId || !/^[a-zA-Z0-9_-]{4,128}$/.test(conversationId)) {
    return { ok: false, error: 'invalid_request' };
  }
  const brainDir = resolve(appDataDir, 'brain', conversationId);
  const resolvedTarget = resolve(filePath);
  const normBase = (process.platform === 'win32' ? brainDir.toLowerCase() : brainDir) + (process.platform === 'win32' ? '\\' : '/');
  const normTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  if (!normTarget.startsWith(normBase)) {
    return { ok: false, error: 'path_not_allowed' };
  }
  if (!existsSync(resolvedTarget)) {
    return { ok: false, error: 'file_not_found' };
  }
  try {
    if (!statSync(resolvedTarget).isFile()) return { ok: false, error: 'not_a_file' };
  } catch {
    return { ok: false, error: 'stat_failed' };
  }
  const ext = extname(resolvedTarget).toLowerCase();
  if (BLOCKED_OPEN_EXTS.has(ext)) {
    return { ok: false, error: 'blocked_extension' };
  }
  try {
    let cmd = 'xdg-open';
    let args = [resolvedTarget];
    if (process.platform === 'win32') {
      cmd = 'explorer.exe';
      args = [resolvedTarget];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [resolvedTarget];
    }
    const child = spawnFn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child?.unref?.();
    return { ok: true, path: resolvedTarget };
  } catch (err) {
    return { ok: false, error: err?.message || 'open_failed' };
  }
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
  app.api('/api/check-update', guardApi(async (data, req) => {
    const force = Boolean(data?.force || /[?&]force=1(?:&|$)/.test(String(req?.url || '')));
    return checkStudioUpdate({ forceRefresh: force });
  }), 'GET');
  app.api('/api/self-update', guardApi(async (data) => performStudioSelfUpdate({ targetTag: data?.targetTag || '' })), 'POST');
  app.api('/api/sync-i18n-compat', guardApi(async () => syncI18nCompatWhitelist()), 'POST');
  app.api('/api/periodic-sync', guardApi(async () => syncPeriodicElementsApi()), 'POST');
  app.api('/api/notify', guardApi(async () => getNotifyConfigApi()), 'GET');
  app.api('/api/notify', guardApi(async (data) => saveNotifyConfigApi(data)), 'POST');
  app.api('/api/notify/test', guardApi(async (data) => testNotifyApi(data)), 'POST');
  app.api('/api/live-tasks', guardApi(async () => getLiveTasksApi()), 'GET');
  app.api('/api/conversation-inspector', guardApi(async (data, req) => {
    let cid = String(data?.conversationId || '').trim();
    if (!cid && req?.url) {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        cid = String(u.searchParams.get('conversationId') || '').trim();
      } catch {}
    }
    return getConversationInspectorApi({ conversationId: cid });
  }), 'GET');
  app.api('/api/conversation-inspector', guardApi(async (data) => {
    return getConversationInspectorApi({ conversationId: String(data?.conversationId || '').trim() });
  }), 'POST');
  app.api('/api/open-file', guardApi(async (data) => openInspectorFileApi(data)), 'POST');
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
  extractContextBreakdownFromGm,
  getConversationInspectorApi,
  openInspectorFileApi,
  getStudioStatus,
  applyConfigUpdate,
  resetStudioConfig,
  relaunchDesktopHost,
  startStudioSidecar,
};
