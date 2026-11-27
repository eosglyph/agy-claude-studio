// Chrome DevTools Protocol (CDP) helpers for Claude Studio (agy-claude-studio).
// Node >= 22: uses built-in fetch and WebSocket (zero external dependencies).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const STYLE_ID = 'ag-claude-studio-css';
const LEGACY_STYLE_ID = 'ag-claude-style-css';
const PLUGIN_VERSION = '2.2.3';
const SETTING_BINDING = '__agClaudeStudioSetting';
const STARTUP_GRACE_SECONDS = 90;
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

function resolveHostPluginConfigPath({ env = process.env, homeDir = os.homedir() } = {}) {
  const override = String(env.AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG || env.AGY_CLAUDE_STYLE_ANTIGRAVITY_CONFIG || '').trim();
  return override ? path.resolve(override) : path.join(homeDir, '.gemini', 'config', 'config.json');
}

function createWatcherEnabledReader(configPath = resolveHostPluginConfigPath()) {
  let enabled = false;
  return () => {
    if (!configPath) return true;
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
      if (config && typeof config === 'object' && !Array.isArray(config)) {
        enabled = config.plugins?.['agy-claude-studio']?.enabled !== false;
      }
    } catch (err) {
      // A standalone install has no host config. A partial write keeps the last decision.
      if (err.code === 'ENOENT') enabled = true;
    }
    return enabled;
  };
}

const APP_DATA = IS_MAC
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : IS_WIN
  ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

const STATE_DIR_ENV = (process.env.AGY_CLAUDE_STUDIO_STATE_DIR || process.env.AGY_CLAUDE_STYLE_STATE_DIR)
  ? path.resolve(process.env.AGY_CLAUDE_STUDIO_STATE_DIR || process.env.AGY_CLAUDE_STYLE_STATE_DIR)
  : '';
const CONFIG_FILE_ENV = (process.env.AGY_CLAUDE_STUDIO_CONFIG || process.env.AGY_CLAUDE_STYLE_CONFIG)
  ? path.resolve(process.env.AGY_CLAUDE_STUDIO_CONFIG || process.env.AGY_CLAUDE_STYLE_CONFIG)
  : '';

function resolvePluginDataDir(env = process.env) {
  const pluginData = String(env?.AGY_CLAUDE_STUDIO_PLUGIN_DATA || env?.AGY_CLAUDE_STYLE_PLUGIN_DATA || '').trim();
  if (pluginData && !pluginData.includes('${')) {
    return path.resolve(pluginData);
  }
  const sidecarData = String(env?.ANTIGRAVITY_EXECUTABLE_DATA_DIR || '').trim();
  const lsAddr = String(env?.ANTIGRAVITY_LS_ADDRESS || '').trim();
  if (sidecarData && lsAddr !== 'test.invalid') {
    const resolvedSidecar = path.resolve(sidecarData);
    let cur = resolvedSidecar;
    let prevChild = '';
    for (let depth = 0; depth < 8 && cur && path.dirname(cur) !== cur; depth += 1) {
      const base = path.basename(cur);
      const isSidecarData = process.platform === 'win32'
        ? base.toLowerCase() === 'sidecar_data'
        : base === 'sidecar_data';
      if (isSidecarData && prevChild) {
        return path.join(path.dirname(cur), 'plugin_data', prevChild);
      }
      prevChild = base;
      cur = path.dirname(cur);
    }
    return resolvedSidecar;
  }
  return null;
}

const PLUGIN_DATA_DIR = resolvePluginDataDir(process.env);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT_FILE = path.join(APP_DATA, 'Antigravity', 'DevToolsActivePort');
const STATE_DIR = STATE_DIR_ENV || PLUGIN_DATA_DIR || ROOT_DIR;
const PID_FILE = path.join(STATE_DIR, '.watch.pid');
const LOCK_FILE = path.join(STATE_DIR, '.watch.lock.json');
const LEGACY_CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
const CONFIG_FILE =
  CONFIG_FILE_ENV ||
  (PLUGIN_DATA_DIR ? path.join(PLUGIN_DATA_DIR, 'config.json') : LEGACY_CONFIG_FILE);

function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

const DEFAULT_CONFIG = {
  language: 'zh-CN',
  palette: 'claude',
  glassEffect: true,
  homeLayout: 'studio',
  homeRipple: true,
  composerRestyle: true,
  mascot: 'crab',
  logoInk: 'accent',
  pinRightPane: 'studio',
  usageStatsEnabled: true,
  inlineStats: true,
  ringMode: 'context',
  turnBadges: true,
  hudTopBar: true,
  hudBottomBar: false,
  hudRimProgress: false,
  effortSliderStyle: 'chatgpt',
  effortAccent: true,
  smoothCaret: true,
  sidebarRestyle: true,
  sidebarCompact: true,
  placeholderStyle: 'studio',
  compactPreset: 'clean',
  compactCustomText: '',
  periodicSelector: true,
  orchestratorSwitch: true,
  pluginPageTranslate: true,
  fileLinkContextMenu: true,
  geminiLoader: true,
  receivePrerelease: false,
  i18nIgnoreSelectors: [],
  autoRelaunchWithCdp: true,
  exitOnHostClose: false,
  pollIntervalMs: 2500,
};

// Shared declarative schema consumed by inject.js and installer build manifests.
const CONFIG_VALIDATORS = {
  language: ['zh-CN', 'zh-TW', 'yue', 'en', 'ja'],
  palette: ['obsidian', 'claude', 'host'],
  glassEffect: 'boolean',
  homeLayout: ['studio', 'classic', 'off'],
  homeRipple: 'boolean',
  composerRestyle: 'boolean',
  mascot: ['crab', 'off'],
  logoInk: ['accent', 'foreground'],
  pinRightPane: ['off', 'studio'],
  usageStatsEnabled: 'boolean',
  inlineStats: 'boolean',
  ringMode: ['context', 'quota'],
  turnBadges: 'boolean',
  hudTopBar: 'boolean',
  hudBottomBar: 'boolean',
  hudRimProgress: 'boolean',
  effortSliderStyle: ['claude', 'chatgpt'],
  effortAccent: 'boolean',
  smoothCaret: 'boolean',
  sidebarRestyle: 'boolean',
  sidebarCompact: 'boolean',
  placeholderStyle: ['studio', 'host'],
  compactPreset: ['empty', 'clean', 'dev', 'continue', 'custom'],
  periodicSelector: 'boolean',
  orchestratorSwitch: 'boolean',
  pluginPageTranslate: 'boolean',
  fileLinkContextMenu: 'boolean',
  geminiLoader: 'boolean',
  receivePrerelease: 'boolean',
  autoRelaunchWithCdp: 'boolean',
  exitOnHostClose: 'boolean',
};

const I18N_COMPAT_FILE = path.join(ROOT_DIR, 'i18n-compat.json');
const REMOTE_I18N_COMPAT_URL =
  'https://raw.githubusercontent.com/eosglyph/agy-claude-studio/main/i18n-compat.json';

function sanitizeSelectorList(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
    ? raw.split(/[\r\n,]+/)
    : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const s = typeof item === 'string' ? item.trim() : '';
    if (!s || s.length > 160 || /[\r\n\0<>{};]/.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 50) break;
  }
  return out;
}

function validateConfigSetting(key, value) {
  if (key === 'pollIntervalMs') {
    return Number.isInteger(value) && value >= 250 && value <= 60000;
  }
  if (key === 'i18nIgnoreSelectors') {
    if (!Array.isArray(value) || value.length > 50) return false;
    return value.every((s) => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 160 && !/[\r\n\0<>{};]/.test(s));
  }
  if (key === 'compactCustomText') {
    return typeof value === 'string' && value.length <= 600 && !/\0/.test(value);
  }
  if (!Object.prototype.hasOwnProperty.call(CONFIG_VALIDATORS, key)) return false;
  const rule = CONFIG_VALIDATORS[key];
  if (rule === 'boolean') return typeof value === 'boolean';
  if (Array.isArray(rule)) return typeof value === 'string' && rule.includes(value);
  return false;
}

function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function sanitizeConfig(raw) {
  const out = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined) {
      out[key] = raw[key];
    }
  }
  if (raw.pinRightPane === undefined && typeof raw.pinUsageMonitorPane === 'boolean') {
    out.pinRightPane = 'off';
  }
  if (out.pinRightPane === 'usage-monitor') {
    out.pinRightPane = 'off';
  }
  if (!CONFIG_VALIDATORS.pinRightPane.includes(out.pinRightPane)) {
    out.pinRightPane = DEFAULT_CONFIG.pinRightPane;
  }
  if (raw.usageStatsEnabled === undefined && typeof raw.usageMonitorCompat === 'boolean') {
    out.usageStatsEnabled = !raw.usageMonitorCompat;
  }
  if (raw.paletteEnabled === false && raw.palette !== 'obsidian' && raw.palette !== 'claude') {
    out.palette = 'host';
  } else if (out.palette !== 'obsidian' && out.palette !== 'claude' && out.palette !== 'host') {
    out.palette = 'obsidian';
  }
  out.i18nIgnoreSelectors = sanitizeSelectorList(out.i18nIgnoreSelectors);
  if (!CONFIG_VALIDATORS.compactPreset.includes(out.compactPreset)) {
    out.compactPreset = DEFAULT_CONFIG.compactPreset;
  }
  out.compactCustomText =
    typeof out.compactCustomText === 'string' ? out.compactCustomText.replace(/\0/g, '').slice(0, 600) : '';
  return out;
}

function parseI18nCompatJson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const protocol = sanitizeSelectorList(raw.protocol);
  const plugins = [];
  if (Array.isArray(raw.plugins)) {
    for (const p of raw.plugins) {
      if (!p || typeof p !== 'object') continue;
      const id = String(p.id || '').trim();
      const selectors = sanitizeSelectorList(p.selectors);
      if (id && selectors.length) {
        plugins.push({ id, name: String(p.name || id).trim(), selectors });
      }
      if (plugins.length >= 64) break;
    }
  }
  return {
    version: Number(raw.version) || 1,
    updatedAt: String(raw.updatedAt || '').trim(),
    protocol,
    plugins,
  };
}

function readI18nCompatData(pluginDataDir = PLUGIN_DATA_DIR) {
  let bundled = { version: 1, updatedAt: '', protocol: [], plugins: [] };
  try {
    if (fs.existsSync(I18N_COMPAT_FILE)) {
      const parsed = parseI18nCompatJson(JSON.parse(fs.readFileSync(I18N_COMPAT_FILE, 'utf8')));
      if (parsed) bundled = parsed;
    }
  } catch {}

  let remote = null;
  const remoteFile = pluginDataDir ? path.join(pluginDataDir, 'i18n-compat-remote.json') : '';
  try {
    if (remoteFile && fs.existsSync(remoteFile)) {
      remote = parseI18nCompatJson(JSON.parse(fs.readFileSync(remoteFile, 'utf8')));
    }
  } catch {}

  const pluginMap = new Map();
  for (const p of bundled.plugins) pluginMap.set(p.id, p);
  if (remote) {
    for (const p of remote.plugins) pluginMap.set(p.id, p);
  }
  const mergedProtocol = sanitizeSelectorList([
    ...bundled.protocol,
    ...(remote ? remote.protocol : []),
  ]);
  const mergedPlugins = [...pluginMap.values()];
  const allSelectors = sanitizeSelectorList([
    ...mergedProtocol,
    ...mergedPlugins.flatMap((p) => p.selectors),
  ]);

  return {
    version: remote ? Math.max(bundled.version, remote.version) : bundled.version,
    updatedAt: (remote && remote.updatedAt) || bundled.updatedAt,
    hasRemote: Boolean(remote),
    protocol: mergedProtocol,
    plugins: mergedPlugins,
    selectors: allSelectors,
  };
}

const BUILTIN_I18N_OPT_OUT_SET = new Set([
  '[translate="no"]',
  '.notranslate',
  '[data-ag-no-i18n]',
  '[data-no-i18n]',
  '[data-agy-no-translate]',
  '[data-ag-cs-effort]',
  '#ag-usage-monitor-capsule',
  '#ag-usage-monitor-portal',
  '[id^="ag-usage-monitor-"]',
]);

function resolveExtraI18nOptOutSelectors(config = {}, pluginDataDir = PLUGIN_DATA_DIR) {
  const compat = readI18nCompatData(pluginDataDir);
  const userList = sanitizeSelectorList(config && config.i18nIgnoreSelectors);
  return sanitizeSelectorList([...compat.selectors, ...userList]).filter(
    (s) => !BUILTIN_I18N_OPT_OUT_SET.has(s)
  );
}

function readPeriodicOverride(pluginDataDir = PLUGIN_DATA_DIR || STATE_DIR) {
  try {
    const periodicSync = require('./periodic-sync.js');
    return periodicSync.readPeriodicOverride(pluginDataDir);
  } catch {
    return null;
  }
}

function readCloudLocalePackOverride(lang, pluginDataDir = PLUGIN_DATA_DIR || STATE_DIR) {
  try {
    const i18nSync = require('./i18n-sync.js');
    return i18nSync.readCloudLocalePackOverride(lang, pluginDataDir);
  } catch {
    return null;
  }
}

async function syncRemoteI18nCompat({
  url = REMOTE_I18N_COMPAT_URL,
  pluginDataDir = PLUGIN_DATA_DIR,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  timeoutMs = 8000,
} = {}) {
  if (!fetchFn) throw new Error('fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': `agy-claude-studio/${PLUGIN_VERSION}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const parsed = parseI18nCompatJson(await res.json());
    if (!parsed) throw new Error('Invalid i18n-compat.json payload');
    if (pluginDataDir) {
      const target = path.join(pluginDataDir, 'i18n-compat-remote.json');
      atomicWriteFileSync(target, JSON.stringify(parsed, null, 2) + '\n');
    }
    return {
      ok: true,
      version: parsed.version,
      updatedAt: parsed.updatedAt,
      pluginCount: parsed.plugins.length,
      selectorCount: sanitizeSelectorList([
        ...parsed.protocol,
        ...parsed.plugins.flatMap((p) => p.selectors),
      ]).length,
    };
  } finally {
    clearTimeout(timer);
  }
}

function ensureMigratedPluginConfig({
  pluginDataDir = PLUGIN_DATA_DIR,
  configFile = CONFIG_FILE,
  legacyConfigFile = LEGACY_CONFIG_FILE,
  explicitConfig = Boolean(CONFIG_FILE_ENV),
} = {}) {
  if (!pluginDataDir || explicitConfig) return false;
  if (fs.existsSync(configFile)) return false;
  const siblingLegacyConfig = path.join(path.dirname(path.resolve(pluginDataDir)), 'agy-claude-style', 'config.json');
  const candidates = [siblingLegacyConfig, legacyConfigFile];
  for (const cand of candidates) {
    if (!cand || path.resolve(cand) === path.resolve(configFile)) continue;
    try {
      if (!fs.existsSync(cand)) continue;
      const raw = fs.readFileSync(cand, 'utf8');
      const sanitized = sanitizeConfig(JSON.parse(raw));
      atomicWriteFileSync(configFile, JSON.stringify(sanitized, null, 2) + '\n');
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

function readConfig(configPath = CONFIG_FILE) {
  if (path.resolve(configPath) === path.resolve(CONFIG_FILE)) {
    ensureMigratedPluginConfig();
  }
  try {
    return sanitizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function updateConfigSetting(key, value, configPath = CONFIG_FILE) {
  if (!validateConfigSetting(key, value)) return false;
  if (path.resolve(configPath) === path.resolve(CONFIG_FILE)) {
    ensureMigratedPluginConfig();
  }
  const next = { ...readConfig(configPath), [key]: value };
  writeFileAtomic(configPath, JSON.stringify(next, null, 2) + '\n');
  return true;
}

function resolvePortCandidates() {
  if (IS_MAC) {
    return [
      PORT_FILE,
      path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity IDE', 'DevToolsActivePort'),
    ];
  }
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return Array.from(
      new Set([
        PORT_FILE,
        path.join(localAppData, 'Antigravity', 'DevToolsActivePort'),
        path.join(APP_DATA, 'Antigravity IDE', 'DevToolsActivePort'),
        path.join(localAppData, 'Antigravity IDE', 'DevToolsActivePort'),
      ])
    );
  }
  return [
    PORT_FILE,
    path.join(APP_DATA, 'Antigravity IDE', 'DevToolsActivePort'),
  ];
}

function readActivePorts() {
  if (process.env.AG_CDP_PORT) {
    const envPort = parseInt(process.env.AG_CDP_PORT, 10);
    return Number.isInteger(envPort) && envPort > 0 ? [envPort] : [];
  }
  const ports = [];
  const seen = new Set();
  for (const candidate of resolvePortCandidates()) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      const port = parseInt(text.split(/\r?\n/)[0].trim(), 10);
      if (Number.isInteger(port) && port > 0 && !seen.has(port)) {
        seen.add(port);
        ports.push(port);
      }
    } catch {}
  }
  return ports;
}

function readPort() {
  const ports = readActivePorts();
  return ports.length > 0 ? ports[0] : null;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const SIDECAR_TITLE_RE = /^(?:(?:AGY\s+)?Claude\s+Studio|AGY\s+Claude\s+Style(?:\s+Studio)?|Antigravity\s+UI\s+(?:增强|增強|Enhanced|強化)|(?:Antigravity\s+)?Usage\s+Monitor|Swarm\s+Board)\s*$/i;

function isLoopbackHttpUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isIdeExtensionChatTarget(t) {
  if (!t || typeof t !== 'object' || !t.webSocketDebuggerUrl) return false;
  const type = String(t.type || '').trim().toLowerCase();
  if (type !== 'iframe' && type !== 'webview' && type !== 'page') return false;
  const url = String(t.url || '').trim();
  if (!isLoopbackHttpUrl(url)) return false;
  return (
    /[?&]extension(?:View|Variant)=/i.test(url) ||
    /\/c\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[/?#]|$)/i.test(url)
  );
}

function isAntigravityPageTarget(t) {
  if (!t || typeof t !== 'object' || !t.webSocketDebuggerUrl) return false;
  const type = String(t.type || '').trim().toLowerCase();
  const url = String(t.url || '').trim();
  const title = String(t.title || '').trim();
  if (!url) return false;
  if (/^(?:devtools|chrome|chrome-extension|data|about|vscode-webview|plugin|agy-favicon):/i.test(url)) return false;
  if (/sharedProcess\.html/i.test(url)) return false;
  let pathname = url;
  try {
    pathname = new URL(url).pathname || '';
  } catch {}
  if (/\/sidecars?\//i.test(pathname)) return false;
  if (SIDECAR_TITLE_RE.test(title) && !/\/c\/[0-9a-f-]{36}(?:[/?#]|$)/i.test(pathname)) return false;
  if (type !== 'page') {
    return isIdeExtensionChatTarget(t);
  }
  if (/^https?:/i.test(url)) {
    return isLoopbackHttpUrl(url);
  }
  return /^(?:file|vscode-file):\/\//i.test(url);
}

const SWARM_SIDECAR_URL_PREFIX = 'plugin://swarm--';

function isInjectableTarget(t) {
  if (!t || typeof t !== 'object' || !t.webSocketDebuggerUrl) return false;
  const type = String(t.type || '').trim().toLowerCase();
  const url = typeof t.url === 'string' ? t.url : '';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.startsWith('devtools://') || lowerUrl.startsWith('data:')) return false;
  if (type === 'iframe' && lowerUrl.startsWith(SWARM_SIDECAR_URL_PREFIX)) return true;
  return isAntigravityPageTarget(t);
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  });
  const targets = await res.json();
  return targets.filter(isInjectableTarget);
}

// Limit the OS bridge to a conversation or IDE workbench, not every local preview.
function isFileActionDocument(page, url) {
  if (!isAntigravityPageTarget({ ...page, url })) return false;
  const initial = new URL(page.url), live = new URL(url);
  if (initial.protocol !== live.protocol || initial.host !== live.host) return false;
  return isLoopbackHttpUrl(url) ? /^\/c\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(live.pathname)
    : /\/workbench(?:\.desktop)?(?:\.main)?\.html$/i.test(live.pathname);
}

// Runtime supplies the world/frame mapping; never take either ID from the binding payload.
function trackBindingSource(session, page) {
  const worlds = new Map();
  session.on('Runtime.executionContextCreated', ({ context }) => {
    worlds.delete(context.id);
    if (context.auxData?.isDefault === true && context.auxData.frameId) worlds.set(context.id, context);
  });
  session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => worlds.delete(executionContextId));
  session.on('Runtime.executionContextsCleared', () => worlds.clear());
  return async (id, fileAction = true) => {
    const world = worlds.get(id);
    if (!world || page.type !== 'page' || !isAntigravityPageTarget(page)) return false;
    const tree = await session.send('Page.getFrameTree').catch(() => null);
    const frame = tree?.frameTree?.frame;
    return !session.closed && worlds.get(id) === world && frame?.id === world.auxData.frameId &&
      !frame.parentId && (fileAction ? isFileActionDocument(page, frame.url) : isAntigravityPageTarget({ ...page, url: frame.url }));
  };
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onClose = null;
    this.listeners = new Map();
    ws.addEventListener('message', (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.method) {
        for (const cb of this.listeners.get(msg.method) || []) cb(msg.params);
        return;
      }
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    });
    const handleClosed = () => {
      if (this.closed) return;
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
      if (this.onClose) this.onClose();
    };
    ws.addEventListener('close', handleClosed);
    ws.addEventListener('error', handleClosed);
  }

  static connect(wsUrl, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP connect timeout'));
      }, timeoutMs);
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve(new CdpSession(ws));
        },
        { once: true }
      );
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('CDP connect failed'));
        },
        { once: true }
      );
    });
  }

  send(method, params = {}, timeoutMs = 5000) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, callback) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(callback);
  }

  async evaluate(expression, awaitPromise = false) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  }

  close() {
    if (!this.closed) this.ws.close();
  }
}

function readCss() {
  return fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
}

const RUNTIME_PARTS = ['i18n-locales.js', 'i18n-core.js', 'sidecar-core.js', 'usage-core.js', 'ripple-core.js', 'mascot-core.js', 'crab-assets.js', 'effort-core.js', 'periodic-core.js', 'ui-runtime.js'];

function readRuntimeBundle() {
  return RUNTIME_PARTS.map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
}

function computeHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function buildInjectExpression(customConfig) {
  const config = customConfig || readConfig();
  const css = readCss();
  const bundle = readRuntimeBundle();
  const codeHash = computeHash(bundle);
  return `(() => {
    const css = ${JSON.stringify(css)};
    for (const cancel of globalThis.__agCsPendingReady || []) cancel();
    const listenUntilReady = (event, fn, opts) => {
      const pending = globalThis.__agCsPendingReady ||= new Set();
      const remove = () => { document.removeEventListener(event, fn); pending.delete(remove); };
      pending.add(remove);
      document.addEventListener(event, fn, opts);
    };
    const applyStyle = () => {
      const targetParent = document.head || document.documentElement;
      if (!targetParent) return;
      const legacyStyle = document.getElementById(${JSON.stringify(LEGACY_STYLE_ID)});
      if (legacyStyle) legacyStyle.remove();
      let style = document.getElementById(${JSON.stringify(STYLE_ID)});
      if (!style) {
        style = document.createElement('style');
        style.id = ${JSON.stringify(STYLE_ID)};
      }
      if (style.textContent !== css) style.textContent = css;
      if (style.parentNode !== targetParent || targetParent.lastElementChild !== style) {
        targetParent.appendChild(style);
      }
    };

    const isHostDocument = () => {
      const proto = typeof location !== 'undefined' && location?.protocol ? String(location.protocol).toLowerCase() : '';
      if (!proto || (proto !== 'http:' && proto !== 'https:')) return true;
      if (typeof window !== 'undefined' && (window.electronNative || window.nativeStorage || window.__APP_CONFIG__)) {
        return true;
      }
      const href = typeof location !== 'undefined' && location?.href ? String(location.href) : '';
      if (
        /[?&]extension(?:View|Variant)=/i.test(href) ||
        new RegExp('/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[/?#]|$)', 'i').test(href)
      ) {
        return true;
      }
      if (typeof document === 'undefined') return false;
      if (document.title === 'Jetski Web') return true;
      if (
        typeof document.querySelector === 'function' &&
        document.querySelector(
          'link[href="/jetbox.css"], link[href*="jetbox.css"], script[src="/prism_bundle.js"], script[src*="prism_bundle.js"], [data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="home-greeting"], [data-testid="new-conversation-button"], [data-testid="sidebar-split"], .agy-home, body.theme-standalone, body[data-agy-theme]'
        )
      ) {
        return true;
      }
      return false;
    };

    let status = 'ok';
    let mounted = false;
    let hostDeferred = false;
    const mount = () => {
      if (mounted || !document.documentElement) return;
      if (!isHostDocument()) {
        if (document.readyState === 'loading') {
          status = 'deferred';
          if (!hostDeferred) {
            hostDeferred = true;
            listenUntilReady('DOMContentLoaded', mount, { once: true });
          }
          return;
        }
        status = 'skipped-non-host';
        return;
      }
      mounted = true;
      status = 'ok';
      try {
        const isSidecar = typeof location !== 'undefined' && location.protocol === 'plugin:';
        if (!isSidecar) {
          if (document.head) applyStyle();
          else listenUntilReady('DOMContentLoaded', applyStyle, { once: true });
        }
        ${bundle}
        if (typeof globalThis.__agCsUiMain === 'function') {
          const baseCfg = ${JSON.stringify(
            (() => {
              const extraOptOut = resolveExtraI18nOptOutSelectors(config);
              const periodicOverride = readPeriodicOverride();
              const cloudPack = readCloudLocalePackOverride(config.language);
              const out = { ...config, binding: SETTING_BINDING, codeHash };
              if (extraOptOut.length) out.i18nOptOutSelectors = extraOptOut;
              if (periodicOverride) out.periodicOverride = periodicOverride;
              if (cloudPack && cloudPack.pack) {
                out.i18nPackOverride = cloudPack.pack;
                out.i18nPackHash = cloudPack.hash || '';
              }
              return out;
            })()
          )};
          const ov = globalThis.__agCsOverrideConfig;
          const nextCfg =
            ov && typeof ov === 'object' && ov.codeHash === baseCfg.codeHash
              ? { ...baseCfg, ...ov, binding: baseCfg.binding, codeHash: baseCfg.codeHash }
              : baseCfg;
          globalThis.__agCsUiMain(nextCfg);
        }
      } catch (e) {
        status = 'error: ' + (e && e.message ? e.message : String(e));
        if (typeof console !== 'undefined' && console.error) {
          console.error('[agy-claude-studio] init error:', e);
        }
      }
    };

    if (document.documentElement) {
      mount();
    } else {
      status = 'deferred';
      const onReady = () => {
        if (document.documentElement) {
          document.removeEventListener('readystatechange', onReady);
          document.removeEventListener('DOMContentLoaded', onReady);
          mount();
        }
      };
      listenUntilReady('readystatechange', onReady);
      listenUntilReady('DOMContentLoaded', onReady);
    }
    const st = window.__agClaudeStudio && window.__agClaudeStudio.getState ? window.__agClaudeStudio.getState() : null;
    return {
      version: ${JSON.stringify(PLUGIN_VERSION)},
      status,
      state: st,
    };
  })()`;
}

function buildConfigScriptExpression(customConfig, expectedCodeHash) {
  const config = customConfig || readConfig();
  const expectedHash = expectedCodeHash || '';
  const extraOptOut = resolveExtraI18nOptOutSelectors(config);
  const periodicOverride = readPeriodicOverride();
  const cloudPack = readCloudLocalePackOverride(config.language);
  const payload = { ...config, binding: SETTING_BINDING, codeHash: expectedHash };
  if (extraOptOut.length) payload.i18nOptOutSelectors = extraOptOut;
  if (periodicOverride) payload.periodicOverride = periodicOverride;
  if (cloudPack && cloudPack.pack) {
    payload.i18nPackOverride = cloudPack.pack;
    payload.i18nPackHash = cloudPack.hash || '';
  } else {
    payload.i18nPackOverride = null;
    payload.i18nPackHash = '';
  }
  return `(() => {
    const nextCfg = ${JSON.stringify(payload)};
    globalThis.__agCsOverrideConfig = nextCfg;
    if (
      window.__agClaudeStudio &&
      typeof window.__agClaudeStudio.refreshConfig === 'function' &&
      (!${JSON.stringify(expectedHash)} || window.__agClaudeStudio.codeHash === ${JSON.stringify(expectedHash)})
    ) {
      window.__agClaudeStudio.refreshConfig(nextCfg);
      return {
        version: ${JSON.stringify(PLUGIN_VERSION)},
        status: 'refreshed',
        state: window.__agClaudeStudio.getState ? window.__agClaudeStudio.getState() : null,
      };
    }
    return null;
  })()`;
}

function buildRefreshExpression(customConfig, expectedCodeHash) {
  return buildConfigScriptExpression(customConfig, expectedCodeHash);
}

const REMOVE_EXPRESSION = `(() => {
  for (const cancel of globalThis.__agCsPendingReady || []) cancel();
  delete globalThis.__agCsPendingReady;
  if (Array.isArray(globalThis.__agCsCleanups)) {
    while (globalThis.__agCsCleanups.length) {
      const fn = globalThis.__agCsCleanups.pop();
      try {
        if (typeof fn === 'function') fn();
      } catch (e) {}
    }
  }
  delete globalThis.__agCsCleanups;
  delete globalThis.__agCsOverrideConfig;
  try {
    if (window.__agClaudeStudio && typeof window.__agClaudeStudio.destroy === 'function') {
      window.__agClaudeStudio.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agClaudeStyle && typeof window.__agClaudeStyle.destroy === 'function') {
      window.__agClaudeStyle.destroy();
    }
  } catch (e) {}
  if (window.__agCsI18n && typeof window.__agCsI18n.destroy === 'function') {
    window.__agCsI18n.destroy();
  }
  delete window.__agClaudeStudio;
  delete window.__agClaudeStyle;
  delete window.__agCsI18n;
  delete globalThis.__agCsUiMain;
  delete globalThis.__agCsCrabAssets;
  delete globalThis.__agCsMascotCore;
  delete globalThis.__agCsRippleCore;
  delete globalThis.__agCsUsageCore;
  delete globalThis.__agCsEffortCore;
  delete globalThis.__agCsCustomThemes;
  delete globalThis.__agCsPeriodicCore;
  delete globalThis.__agCsI18nCore;
  delete globalThis.__agCsSidecarCore;
  delete globalThis.__agCsLocales;
  const root = document.documentElement;
  if (root) {
    root.removeAttribute('data-ag-cs-effort-accent');
    root.removeAttribute('data-ag-cs-glass');
    root.removeAttribute('data-ag-cs-fx-glass');
    root.removeAttribute('data-ag-cs-fx-scrollbar');
    root.removeAttribute('data-ag-cs-fx-voice');
    root.removeAttribute('data-ag-cs-fx-media');
    root.removeAttribute('data-ag-cs-fx-glow');
    root.removeAttribute('data-ag-cs-fx-terminal');
    root.removeAttribute('data-ag-cs-lang');
    root.removeAttribute('data-ag-cs-cjk');
    root.removeAttribute('data-ag-custom-theme');
    root.removeAttribute('data-aux-pane-maximized');
    root.removeAttribute('data-ag-cs-dock-dragging');
    if (root.style && typeof root.style.removeProperty === 'function') {
      root.style.removeProperty('--antigravity-active-theme-id');
    }
    if (root.getAttribute('data-ag-cjk') === '1') root.removeAttribute('data-ag-cjk');
  }
  document.querySelectorAll('[data-ag-cs-effort], .ag-cs-effort-badge').forEach((el) => {
    el.removeAttribute('data-ag-cs-effort');
    el.classList.remove('ag-cs-effort-badge');
  });
  document.querySelectorAll('[data-ag-cs-has-effort]').forEach((el) => {
    el.removeAttribute('data-ag-cs-has-effort');
    el.style?.removeProperty?.('--ag-cs-effort-cut');
  });
  document.querySelectorAll('[data-ag-cs-dock-open], [data-ag-cs-dock-solo]').forEach((el) => {
    el.removeAttribute('data-ag-cs-dock-open');
    el.removeAttribute('data-ag-cs-dock-solo');
    el.style?.removeProperty?.('--ag-cs-dock-w');
    el.style?.removeProperty?.('--ag-cs-dock-solo-pr');
  });
  document.querySelectorAll('[data-ag-cs-docked-slot], [data-ag-cs-dock-hidden]').forEach((slot) => {
    slot.removeAttribute('data-ag-cs-docked-slot');
    slot.removeAttribute('data-ag-cs-dock-hidden');
    const ov = slot.parentElement;
    if (ov?.style?.removeProperty) {
      ov.style.removeProperty('--ag-cs-dock-slot-left');
      ov.style.removeProperty('--ag-cs-dock-slot-top');
      ov.style.removeProperty('--ag-cs-dock-slot-width');
      ov.style.removeProperty('--ag-cs-dock-slot-height');
    }
  });
  const nodes = document.querySelectorAll(
    'style#${STYLE_ID}, style#${LEGACY_STYLE_ID}, style#ag-cs-aurora-theme-css, style#ag-token-hud-style, .ag-cs-pinned-dock, .ag-cs-home-panel-seat, .ag-cs-ripple-host, .ag-cs-ripple-canvas, .ag-cs-crab, .ag-cs-inline-stats, .ag-cs-periodic-trigger, .ag-cs-orch-switch, .ag-cs-ps-backdrop, .ag-cs-ps-drawer, .ag-cs-context-ring, .ag-cs-um-ctx-proxy, .ag-cs-ctx-popover, .ag-cs-effort-popover, .ag-cs-smooth-caret, .ag-cs-compact-hint, .ag-cs-turn-bar, .ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar, .ag-cs-hud-rim-progress, .ag-cs-hud-footer-chip, #ag-cs-settings-sec, #ag-cs-theme-selector, #ag-cs-theme-dropdown, .ag-th-top-bar, .ag-th-bottom-bar, .ag-th-rim-progress, .ag-th-footer-chip, .ag-th-popover, .ag-th-turn-bar, .ag-th-reopen-pill'
  );
  nodes.forEach((n) => n.remove());
  try {
    const umSr = document.getElementById('ag-usage-monitor-capsule')?.shadowRoot;
    const umSplit = umSr && (typeof umSr.getElementById === 'function' ? umSr.getElementById('ag-cs-um-split-css') : umSr.querySelector('#ag-cs-um-split-css'));
    if (umSplit) umSplit.remove();
  } catch {}
  return { removed: nodes.length };
})()`;

function detectAntigravityProcess() {
  try {
    if (IS_MAC) {
      const out = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,comm='], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const pids = [];
      for (const rawLine of out.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const m = line.match(/^(\d+)\s+(.+)$/);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        const comm = m[2].trim();
        const lower = comm.toLowerCase();
        if (
          lower.endsWith('/antigravity.app/contents/macos/antigravity') ||
          lower === 'antigravity'
        ) {
          pids.push(pid);
        }
      }
      return { running: pids.length > 0, pids };
    }
    if (IS_WIN) {
      const out = execFileSync(
        'tasklist',
        ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'],
        {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      const pids = [];
      for (const rawLine of out.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('"')) continue;
        const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
        if (cols.length >= 2 && cols[0].toLowerCase() === 'antigravity.exe') {
          const pid = parseInt(cols[1], 10);
          if (Number.isInteger(pid) && pid > 0) pids.push(pid);
        }
      }
      return { running: pids.length > 0, pids };
    }
    const out = execFileSync('ps', ['-eo', 'pid=,comm='], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = [];
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trim();
      const m = line.match(/^(\d+)\s+(.+)$/);
      if (!m) continue;
      if (path.basename(m[2].trim()).toLowerCase() === 'antigravity') {
        pids.push(parseInt(m[1], 10));
      }
    }
    return { running: pids.length > 0, pids };
  } catch {
    return { running: false, pids: [] };
  }
}

function findAntigravityExecutable() {
  if (IS_MAC) {
    const candidates = [
      '/Applications/Antigravity.app',
      path.join(os.homedir(), 'Applications', 'Antigravity.app'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates = [
      path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
      path.join(progFiles, 'Antigravity', 'Antigravity.exe'),
      path.join(progFilesX86, 'Antigravity', 'Antigravity.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }
  for (const c of ['/usr/bin/antigravity', '/usr/local/bin/antigravity', '/opt/Antigravity/antigravity']) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveRunningAntigravityPath(pids = []) {
  const validPids = Array.isArray(pids) ? pids.filter((p) => Number.isInteger(p) && p > 0) : [];
  try {
    if (IS_MAC) {
      const args = validPids.length > 0 ? ['-p', validPids.join(','), '-o', 'comm='] : ['-ax', '-o', 'comm='];
      const out = execFileSync('/bin/ps', args, {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const suffix = '/contents/macos/antigravity';
      for (const rawLine of out.split(/\r?\n/)) {
        const comm = rawLine.trim();
        const lower = comm.toLowerCase();
        if (lower.endsWith(`.app${suffix}`) && comm.length > suffix.length) {
          const appPath = comm.slice(0, comm.length - suffix.length);
          if (fs.existsSync(appPath)) return appPath;
        }
      }
      return null;
    }
    if (IS_WIN) {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Select-Object -ExpandProperty ExecutablePath",
        ],
        {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      for (const rawLine of out.split(/\r?\n/)) {
        const exePath = rawLine.trim();
        if (exePath && fs.existsSync(exePath)) return exePath;
      }
      return null;
    }
    for (const pid of validPids) {
      try {
        const target = fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
        if (target && fs.existsSync(target)) return target;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

function hasRemoteDebuggingFlag(pids = []) {
  const validPids = Array.isArray(pids) ? pids.filter((p) => Number.isInteger(p) && p > 0) : [];
  if (validPids.length === 0) return false;
  try {
    if (IS_MAC) {
      const out = execFileSync('/bin/ps', ['-p', validPids.join(','), '-o', 'args='], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return /--remote-debugging-port(?:=|\s|$)/i.test(out);
    }
    if (IS_WIN) {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Select-Object -ExpandProperty CommandLine",
        ],
        {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      return /--remote-debugging-port(?:=|\s|$)/i.test(out);
    }
    for (const pid of validPids) {
      try {
        const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const args = raw.split('\0').filter(Boolean);
        if (args.some((arg) => /^--remote-debugging-port(?:=|$)/i.test(arg))) {
          return true;
        }
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

function checkPidAlive(pid, killFn = (p, sig) => process.kill(p, sig)) {
  if (!Number.isInteger(pid) || pid <= 0) return 'dead';
  try {
    killFn(pid, 0);
    return 'alive';
  } catch (err) {
    if (err && err.code === 'EPERM') return 'alive';
    return 'dead';
  }
}

function splitCommandArgs(cmdLine) {
  if (typeof cmdLine !== 'string' || !cmdLine.trim()) return [];
  const args = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmdLine.length; i++) {
    const ch = cmdLine[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < cmdLine.length && (cmdLine[i + 1] === '"' || cmdLine[i + 1] === '\\')) {
        cur += cmdLine[++i];
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        args.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) args.push(cur);
  return args;
}

function inspectProcessInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (IS_MAC) {
      const cmd = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!cmd) return null;
      let exePath = null;
      try {
        exePath = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], {
          encoding: 'utf8',
          timeout: 1500,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null;
      } catch {}
      return { cmd, args: null, exePath, cwd: null };
    }
    if (IS_WIN) {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p | Select-Object ExecutablePath, CommandLine | ConvertTo-Json -Compress }`,
        ],
        {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      ).trim();
      if (!out) return null;
      const parsed = JSON.parse(out);
      const cmd = typeof parsed.CommandLine === 'string' ? parsed.CommandLine.trim() : '';
      const exePath = typeof parsed.ExecutablePath === 'string' ? parsed.ExecutablePath.trim() : null;
      if (!cmd) return null;
      return {
        cmd,
        args: splitCommandArgs(cmd),
        exePath: exePath || null,
        cwd: null,
      };
    }
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const args = raw.split('\0').filter((s) => s.length > 0);
    const cmd = args.join(' ').trim();
    if (!cmd) return null;
    let cwd = null;
    try {
      cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {}
    let exePath = null;
    try {
      exePath = fs.readlinkSync(`/proc/${pid}/exe`);
    } catch {}
    return { cmd, args, exePath, cwd };
  } catch {
    return null;
  }
}

function inspectProcessCommand(pid) {
  const info = inspectProcessInfo(pid);
  return info && typeof info.cmd === 'string' && info.cmd.length > 0 ? info.cmd : null;
}

function normalizePathForCompare(p, targetPlatform = process.platform) {
  if (!p || typeof p !== 'string') return '';
  const pathMod = targetPlatform === 'win32' ? path.win32 : path.posix;
  let cleaned = pathMod.normalize(p.replace(/[\\\/]+$/, '') || p);
  if (targetPlatform === 'darwin') {
    cleaned = cleaned.replace(/^\/private(?=\/(?:var|tmp|etc)(?:\/|$))/, '');
  } else if (targetPlatform === 'win32') {
    cleaned = cleaned.toLowerCase();
  }
  return cleaned;
}

function resolveCandidatePath(candidate, cwd, targetPlatform = process.platform) {
  if (!candidate || typeof candidate !== 'string') return '';
  const pathMod = targetPlatform === 'win32' ? path.win32 : path.posix;
  if (pathMod.isAbsolute(candidate)) {
    return normalizePathForCompare(pathMod.resolve(candidate), targetPlatform);
  }
  if (cwd && pathMod.isAbsolute(cwd)) {
    return normalizePathForCompare(pathMod.resolve(cwd, candidate), targetPlatform);
  }
  return '';
}

function hasPathToken(haystack, targetPath, targetPlatform = process.platform) {
  if (!haystack || !targetPath) return false;
  const h = targetPlatform === 'win32' ? haystack.toLowerCase() : haystack;
  const t = normalizePathForCompare(targetPath, targetPlatform);
  let idx = 0;
  while ((idx = h.indexOf(t, idx)) !== -1) {
    const before = idx === 0 ? ' ' : h[idx - 1];
    const afterIdx = idx + t.length;
    const after = afterIdx >= h.length ? ' ' : h[afterIdx];
    const beforeOk = idx === 0 || /[\s"']/.test(before);
    const afterOk = afterIdx === h.length || /[\s"']/.test(after);
    if (beforeOk && afterOk) return true;
    idx += t.length;
  }
  return false;
}

function extractDirFlagValue(cmd, args, cwd, targetPlatform = process.platform) {
  if (Array.isArray(args) && args.length > 0) {
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--dir' && i + 1 < args.length) {
        return { present: true, resolved: resolveCandidatePath(args[i + 1], cwd, targetPlatform) };
      }
      if (args[i].startsWith('--dir=')) {
        return { present: true, resolved: resolveCandidatePath(args[i].slice(6), cwd, targetPlatform) };
      }
    }
    return { present: false, resolved: '' };
  }
  const m = cmd.match(/(?:^|\s)--dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(.+?))(?=\s+--[a-z0-9-]+(?:=|\s|$)|$)/i);
  if (!m) return { present: false, resolved: '' };
  const rawVal = (m[1] || m[2] || m[3] || '').trim();
  return { present: true, resolved: resolveCandidatePath(rawVal, cwd, targetPlatform) };
}

const NODE_DISALLOWED_ENTRY_FLAGS = new Set([
  '-e',
  '--eval',
  '-p',
  '--print',
  '-i',
  '--interactive',
  '-c',
  '--check',
  '-h',
  '--help',
  '-v',
  '--version',
]);

function isNodeBinaryName(binPathOrToken, targetPlatform = process.platform) {
  if (!binPathOrToken || typeof binPathOrToken !== 'string') return false;
  const pathMod = targetPlatform === 'win32' ? path.win32 : path.posix;
  const base = pathMod.basename(binPathOrToken).toLowerCase();
  return /^(?:node(?:\.exe)?|nodejs|electron(?:\.exe)?|electron helper.*|antigravity(?:\.exe)?)$/.test(base);
}

function evaluateWatcherOwnership(rawInfo, targetDir = ROOT_DIR, targetPlatform = process.platform) {
  if (!rawInfo || !targetDir) return 'unknown';
  const info =
    typeof rawInfo === 'string'
      ? { cmd: rawInfo, args: null, exePath: null, cwd: null }
      : rawInfo;
  const cmd = typeof info.cmd === 'string' ? info.cmd.trim() : '';
  if (!cmd) return 'unknown';

  const args = Array.isArray(info.args) ? info.args : null;
  const pathMod = targetPlatform === 'win32' ? path.win32 : path.posix;
  const normTargetDir = normalizePathForCompare(pathMod.resolve(targetDir), targetPlatform);
  if (!normTargetDir) return 'unknown';

  const hasFlag = (flag) =>
    args
      ? args.includes(flag)
      : new RegExp(`(?:^|\\s)${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(cmd);

  if (hasFlag('--once') || hasFlag('--remove')) {
    return 'foreign';
  }

  // 1. Native watcher binary check (must match executable itself, never mid-command arguments like `tail /path/watcher`).
  const nativeExeName = targetPlatform === 'win32' ? 'agy-claude-studio-watcher.exe' : 'agy-claude-studio-watcher';
  const expectedNativeExe = normalizePathForCompare(pathMod.join(normTargetDir, nativeExeName), targetPlatform);
  const exePrefix = cmd.split(/\s+--/)[0].trim().replace(/^["']|["']$/g, '');
  const leadingToken = exePrefix.split(/\s+/)[0] || '';
  const exeMatchesNative = info.exePath
    ? pathMod.basename(info.exePath).toLowerCase() === nativeExeName
    : args && args[0]
    ? pathMod.basename(args[0]).toLowerCase() === nativeExeName
    : normalizePathForCompare(exePrefix, targetPlatform) === expectedNativeExe ||
      (!/\s/.test(exePrefix) && pathMod.basename(exePrefix).toLowerCase() === nativeExeName);

  if (exeMatchesNative) {
    const dirFlag = extractDirFlagValue(cmd, args, info.cwd, targetPlatform);
    if (dirFlag.present) {
      if (dirFlag.resolved) {
        return dirFlag.resolved === normTargetDir ? 'owned' : 'foreign';
      }
      return 'unknown';
    }
    const resolvedExe = info.exePath
      ? normalizePathForCompare(pathMod.resolve(info.exePath), targetPlatform)
      : args && args[0]
      ? resolveCandidatePath(args[0], info.cwd, targetPlatform)
      : pathMod.isAbsolute(exePrefix)
      ? normalizePathForCompare(exePrefix, targetPlatform)
      : '';
    if (resolvedExe) {
      return normalizePathForCompare(pathMod.dirname(resolvedExe), targetPlatform) === normTargetDir ? 'owned' : 'foreign';
    }
    return 'unknown';
  }

  // 2. Node inject.js --watch / --managed check: verify executable AND exact first script argument (no ambiguous CLI flag skipping).
  if (!hasFlag('--watch') && !hasFlag('--managed')) return 'foreign';
  const expectedScripts = [
    normalizePathForCompare(pathMod.join(normTargetDir, 'src', 'inject.js'), targetPlatform),
    normalizePathForCompare(pathMod.join(normTargetDir, 'inject.js'), targetPlatform),
  ];

  if (args && args.length >= 2) {
    if (!isNodeBinaryName(info.exePath || args[0], targetPlatform)) return 'foreign';
    const entryScript = args[1];
    if (!entryScript) return 'foreign';
    if (entryScript.startsWith('-')) {
      return NODE_DISALLOWED_ENTRY_FLAGS.has(entryScript.toLowerCase()) ? 'foreign' : 'unknown';
    }
    if (pathMod.basename(entryScript).toLowerCase() !== 'inject.js') {
      return 'foreign';
    }
    const resolvedEntry = resolveCandidatePath(entryScript, info.cwd, targetPlatform);
    if (resolvedEntry) {
      return expectedScripts.includes(resolvedEntry) ? 'owned' : 'foreign';
    }
    return 'unknown';
  }

  // Space-joined cmd string (e.g. macOS ps): use info.exePath (from -o comm=) when available, else first token.
  let launcherTok = '';
  let rest = '';
  if (info.exePath) {
    launcherTok = info.exePath;
    if (cmd.startsWith(info.exePath) && (cmd.length === info.exePath.length || /\s/.test(cmd[info.exePath.length]))) {
      rest = cmd.slice(info.exePath.length).trim();
    } else {
      const baseExe = pathMod.basename(info.exePath);
      if (cmd.startsWith(baseExe) && (cmd.length === baseExe.length || /\s/.test(cmd[baseExe.length]))) {
        rest = cmd.slice(baseExe.length).trim();
      } else {
        rest = cmd.slice(leadingToken.length).trim();
      }
    }
  } else {
    const tokens = splitCommandArgs(cmd);
    launcherTok = tokens[0] || leadingToken;
    const trimmed = cmd.trimStart();
    if (tokens[0] && (trimmed.startsWith(`"${tokens[0]}"`) || trimmed.startsWith(`'${tokens[0]}'`))) {
      rest = trimmed.slice(tokens[0].length + 2).trim();
    } else {
      rest = trimmed.slice(launcherTok.length).trim();
    }
  }

  if (!isNodeBinaryName(launcherTok, targetPlatform)) return 'foreign';
  if (!rest) return 'foreign';
  if (rest.startsWith('-')) {
    const firstFlag = rest.split(/\s+/)[0].toLowerCase();
    return NODE_DISALLOWED_ENTRY_FLAGS.has(firstFlag) ? 'foreign' : 'unknown';
  }

  const normRest = targetPlatform === 'win32' ? rest.toLowerCase() : rest;
  const rawUnquotedRest = normRest.replace(/^["']/, '');
  const unquotedRest =
    targetPlatform === 'darwin'
      ? rawUnquotedRest.replace(/^\/private(?=\/(?:var|tmp|etc)(?:\/|\s|"|'|$))/, '')
      : rawUnquotedRest;
  for (const expectedScript of expectedScripts) {
    if (unquotedRest.startsWith(expectedScript)) {
      const nextChar = unquotedRest[expectedScript.length];
      if (!nextChar || /[\s"']/.test(nextChar)) {
        return 'owned';
      }
    }
  }

  const firstArg = rest.replace(/^["']/, '').split(/[\s"']/)[0] || '';
  if (!firstArg || pathMod.basename(firstArg).toLowerCase() !== 'inject.js') {
    // Handles non-inject.js first arg (e.g. other.js) AND also safe fallback for unknown spaces in script path
    if (pathMod.isAbsolute(firstArg)) return 'foreign';
    return firstArg.toLowerCase().endsWith('inject.js') ? 'unknown' : 'foreign';
  }
  const resolvedRel = resolveCandidatePath(firstArg, info.cwd, targetPlatform);
  if (resolvedRel) {
    return expectedScripts.includes(resolvedRel) ? 'owned' : 'foreign';
  }
  return 'unknown';
}

function matchesWatcherForDir(rawInfo, targetDir = ROOT_DIR, targetPlatform = process.platform) {
  return evaluateWatcherOwnership(rawInfo, targetDir, targetPlatform) === 'owned';
}

function classifyWatcherPid(pid, targetDir = ROOT_DIR, opts = {}) {
  const killFn = typeof opts.killFn === 'function' ? opts.killFn : (p, sig) => process.kill(p, sig);
  const inspectFn = typeof opts.inspectFn === 'function' ? opts.inspectFn : inspectProcessInfo;
  const platform = opts.platform || process.platform;

  if (!Number.isInteger(pid) || pid <= 0) {
    return { status: 'dead', pid, reason: 'invalid-pid' };
  }
  if (checkPidAlive(pid, killFn) === 'dead') {
    return { status: 'dead', pid, reason: 'esrch' };
  }

  let rawInfo = null;
  try {
    rawInfo = inspectFn(pid);
  } catch {
    rawInfo = null;
  }
  const info =
    typeof rawInfo === 'string'
      ? { cmd: rawInfo, args: null, exePath: null, cwd: null }
      : rawInfo;

  if (!info || typeof info.cmd !== 'string' || !info.cmd.trim()) {
    if (checkPidAlive(pid, killFn) === 'dead') {
      return { status: 'dead', pid, reason: 'exited-during-inspect' };
    }
    return { status: 'unknown', pid, reason: 'inspect-unavailable' };
  }

  const ownership = evaluateWatcherOwnership(info, targetDir, platform);
  if (ownership === 'owned') {
    return { status: 'owned', pid, info };
  }
  if (ownership === 'unknown') {
    return { status: 'unknown', pid, info, reason: 'relative-path-unverified' };
  }
  return { status: 'foreign', pid, info };
}

function isLikelyWatcherProcess(pid, targetDir = ROOT_DIR, opts = {}) {
  return classifyWatcherPid(pid, targetDir, opts).status === 'owned';
}

function resolveExistingWatchPidAction(pidFile = PID_FILE, targetDir = ROOT_DIR, opts = {}) {
  const selfPid = Number.isInteger(opts.selfPid) ? opts.selfPid : process.pid;
  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  } catch {
    return { action: 'write', status: 'missing', pid: null };
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return { action: 'clear', status: 'invalid', pid: null };
  }
  if (pid === selfPid) {
    return { action: 'write', status: 'self', pid };
  }
  const cls = classifyWatcherPid(pid, targetDir, opts);
  if (cls.status === 'dead') {
    return { action: 'clear', status: 'dead', pid };
  }
  if (cls.status === 'foreign') {
    return { action: 'clear', status: 'foreign', pid, info: cls.info };
  }
  if (cls.status === 'owned') {
    return { action: 'owned', status: 'owned', pid, info: cls.info };
  }
  return { action: 'refuse', status: 'unknown', pid, reason: cls.reason };
}

function removeStalePortFile() {
  try {
    if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
  } catch {}
}

function activateAntigravityWindow(opts = {}) {
  if (IS_MAC) {
    try {
      const appTarget = opts.appPath || findAntigravityExecutable() || 'Antigravity';
      const child = spawn('/usr/bin/open', ['-a', appTarget], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function launchAntigravityWithCdp(opts = {}) {
  const cdpPort = Number.isInteger(opts.port) && opts.port >= 0 ? opts.port : 0;
  const flag = `--remote-debugging-port=${cdpPort}`;
  const detectFn = typeof opts.detectProcess === 'function' ? opts.detectProcess : detectAntigravityProcess;
  const removePortFileFn =
    typeof opts.removePortFile === 'function' ? opts.removePortFile : removeStalePortFile;
  const spawnFn = typeof opts.spawn === 'function' ? opts.spawn : spawn;
  if (!opts.skipPortCleanup && !detectFn().running) {
    removePortFileFn();
  }
  if (IS_MAC) {
    const appTarget = opts.appPath || findAntigravityExecutable() || 'Antigravity';
    const child = spawnFn('/usr/bin/open', ['-a', appTarget, '--args', flag], {
      detached: true,
      stdio: 'ignore',
    });
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  }
  const exePath = opts.appPath || findAntigravityExecutable();
  if (!exePath) return false;
  const child = spawnFn(exePath, [flag], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  if (child && typeof child.unref === 'function') child.unref();
  return true;
}

async function ensureAntigravityWithCdp(opts = {}) {
  const readPortFn = typeof opts.readPort === 'function' ? opts.readPort : readPort;
  const listPagesFn = typeof opts.listPages === 'function' ? opts.listPages : listPages;
  const detectProcessFn =
    typeof opts.detectProcess === 'function' ? opts.detectProcess : detectAntigravityProcess;
  const hasCdpFlagFn =
    typeof opts.hasRemoteDebuggingFlag === 'function'
      ? opts.hasRemoteDebuggingFlag
      : hasRemoteDebuggingFlag;
  const launchFn = typeof opts.launch === 'function' ? opts.launch : launchAntigravityWithCdp;
  const relaunchFn =
    typeof opts.relaunch === 'function'
      ? opts.relaunch
      : typeof opts.relaunchFn === 'function'
      ? opts.relaunchFn
      : relaunchAntigravityWithCdp;
  const activateFn =
    typeof opts.activate === 'function' ? opts.activate : activateAntigravityWindow;
  const shouldRelaunch = opts.relaunch === true || Boolean(opts.autoRelaunchWithCdp);

  const port = readPortFn();
  if (port) {
    try {
      const pages = await listPagesFn(port);
      if (Array.isArray(pages) && pages.length > 0) {
        try {
          await activateFn({ appPath: opts.appPath });
        } catch {}
        return { ok: true, action: 'already-cdp', port, pagesCount: pages.length };
      }
    } catch {}
  }

  const proc = detectProcessFn() || { running: false, pids: [] };
  const pids = Array.isArray(proc.pids) ? proc.pids : [];
  if (proc.running) {
    if (hasCdpFlagFn(pids)) {
      try {
        await activateFn({ appPath: opts.appPath });
      } catch {}
      return { ok: true, action: 'waiting-cdp', pids };
    }
    if (shouldRelaunch) {
      const res = await relaunchFn({
        port: opts.port ?? 0,
        waitMs: opts.waitMs,
        appPath: opts.appPath,
      });
      if (res && res.relaunched) {
        return { ok: true, action: 'relaunched' };
      }
      return { ok: false, action: 'relaunch-failed', reason: res?.reason || 'unknown' };
    }
    return { ok: false, action: 'running-without-cdp', pids };
  }

  const launched = launchFn({ port: opts.port ?? 0, appPath: opts.appPath });
  if (launched) {
    return { ok: true, action: 'launched' };
  }
  return { ok: false, action: 'executable-not-found' };
}

async function relaunchAntigravityWithCdp(opts = {}) {
  const waitMs = Number.isInteger(opts.waitMs) && opts.waitMs > 0 ? opts.waitMs : 8000;
  const detectFn = typeof opts.detectProcess === 'function' ? opts.detectProcess : detectAntigravityProcess;
  const resolveRunningFn =
    typeof opts.resolveRunningPath === 'function' ? opts.resolveRunningPath : resolveRunningAntigravityPath;
  const findExeFn = typeof opts.findExecutable === 'function' ? opts.findExecutable : findAntigravityExecutable;
  const launchFn = typeof opts.launch === 'function' ? opts.launch : launchAntigravityWithCdp;
  const removePortFileFn =
    typeof opts.removePortFile === 'function' ? opts.removePortFile : removeStalePortFile;
  const killFn =
    typeof opts.terminate === 'function'
      ? opts.terminate
      : (pids) => {
          if (IS_WIN) {
            const validWinPids = Array.isArray(pids) ? pids.filter((p) => Number.isInteger(p) && p > 0 && p !== process.pid) : [];
            if (validWinPids.length > 0) {
              for (const pid of validWinPids) {
                try {
                  execFileSync('taskkill', ['/PID', String(pid), '/T'], {
                    timeout: 4000,
                    windowsHide: true,
                    stdio: 'ignore',
                  });
                } catch {}
              }
            } else {
              execFileSync('taskkill', ['/IM', 'Antigravity.exe'], {
                timeout: 4000,
                windowsHide: true,
                stdio: 'ignore',
              });
            }
          } else {
            for (const pid of pids) {
              if (pid > 0 && pid !== process.pid) {
                try {
                  process.kill(pid, 'SIGTERM');
                } catch {}
              }
            }
          }
        };

  const initialProc = detectFn();
  const initialPids = Array.isArray(initialProc?.pids) ? initialProc.pids : [];
  const resolvedPath = opts.appPath || resolveRunningFn(initialPids) || findExeFn();
  const hasValidTarget = Boolean(
    resolvedPath && (typeof opts.launch === 'function' || fs.existsSync(resolvedPath))
  );
  if (!hasValidTarget) {
    return { relaunched: false, reason: 'executable-not-found' };
  }

  try {
    killFn(initialPids);
  } catch {}

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!detectFn().running) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (detectFn().running) {
    return { relaunched: false, reason: 'still-running' };
  }
  removePortFileFn();
  await new Promise((r) => setTimeout(r, 350));
  const launched = launchFn({ ...opts, appPath: resolvedPath });
  return { relaunched: launched, reason: launched ? 'ok' : 'executable-not-found' };
}

function formatCdpUnavailableMessage({ running, port }) {
  const launchHint = IS_MAC
    ? 'open -a Antigravity --args --remote-debugging-port=0（或运行 npm run launch）'
    : IS_WIN
    ? 'Antigravity.exe --remote-debugging-port=0（或运行 npm run launch）'
    : 'antigravity --remote-debugging-port=0（或运行 npm run launch）';
  if (running) {
    return (
      `检测到 Antigravity 正在运行，但未开启远程调试端口（Antigravity 2.33.0+ 默认关闭 CDP` +
      `${port ? `，端口 ${port} 无响应` : `，未生成 ${PORT_FILE}`}）。` +
      `请完全退出 Antigravity 后带参启动：${launchHint}`
    );
  }
  if (port) {
    return `端口 ${port} 无响应：Antigravity 可能未运行。请通过带参方式启动：${launchHint}`;
  }
  return `未找到调试端口文件，Antigravity 未运行: ${PORT_FILE}。如使用 Antigravity 2.33.0+，请使用 ${launchHint}`;
}

const SAFE_OPEN_FILE_EXTS = new Set([
  '.html', '.htm', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.wav', '.mp3', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.mkv', '.webm', '.txt', '.md',
  '.markdown', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.xml', '.log', '.ini',
  '.cfg', '.conf', '.css', '.sql', '.diff', '.patch', '.rtf', '.doc', '.docx', '.xls',
  '.xlsx', '.ppt', '.pptx', '.zip', '.tar', '.gz', '.7z',
]);
const MACOS_FILE_PACKAGE_EXTS = new Set([
  '.app', '.pkg', '.mpkg', '.prefpane', '.workflow', '.action', '.saver', '.plugin',
  '.scptd', '.appex', '.bundle', '.framework',
]);

function resolveLocalFileUri(rawInput, platform = process.platform) {
  if (typeof rawInput !== 'string' || rawInput.length > 4096 || !/^file:\/\/\/(?!\/)/i.test(rawInput) || /[\x00-\x1f\x7f"\\]/.test(rawInput)) return null;
  let value;
  try { value = decodeURIComponent(rawInput.slice(7).split(/[?#]/, 1)[0]); } catch { return null; }
  if (!value.startsWith('/') || /^\/[\\/]/.test(value) || /[\x00-\x1f\x7f"]/.test(value)) return null;
  if (platform !== 'win32') return value;
  if (!/^\/[a-z]:\//i.test(value) || value.slice(3).includes(':')) return null;
  return value.slice(1).replace(/\//g, '\\');
}

function prepareLocalFileAction({ mode, target, platform = process.platform, fsApi = fs } = {}) {
  let resolved = resolveLocalFileUri(target, platform);
  if (!resolved || (mode !== 'open' && mode !== 'reveal')) return { ok: false, reason: 'invalid-path', mode };
  if (platform === 'win32') {
    // Keep all user data out of PowerShell source and arguments. The shared native
    // helper checks drive type and each component before querying the target.
    const command = 'try { Add-Type -LiteralPath $env:AGY_FILE_HELPER -ErrorAction Stop; if ([AgyClaudeStudio.WindowsFileAction]::Run($env:AGY_FILE_URI,$env:AGY_FILE_MODE)) { exit 0 } } catch {}; exit 1';
    const bin = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return { ok: true, mode, bin, args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', command], options: { windowsHide: true, stdio: 'ignore', env: { ...process.env, AGY_FILE_HELPER: path.join(ROOT_DIR, 'scripts', 'WindowsFileAction.cs'), AGY_FILE_URI: target, AGY_FILE_MODE: mode } } };
  }
  let stat;
  try {
    resolved = fsApi.realpathSync(resolved);
    stat = fsApi.statSync(resolved);
  } catch { return { ok: false, reason: 'not-found', mode }; }
  const ext = path.posix.extname(resolved).toLowerCase();
  const dir = stat.isDirectory();
  const mac = platform === 'darwin';
  if (mode === 'open' && ((!dir && (!stat.isFile() || !SAFE_OPEN_FILE_EXTS.has(ext))) ||
      (mac && dir && MACOS_FILE_PACKAGE_EXTS.has(ext)))) return { ok: false, reason: 'blocked-extension', mode };
  // Explicit Finder for directories: an unlisted package can never launch itself.
  const args = mac ? (mode === 'reveal' ? ['-R', resolved] : dir ? ['-a', 'Finder', resolved] : [resolved])
    : [mode === 'reveal' ? path.posix.dirname(resolved) : resolved];
  return { ok: true, mode, bin: mac ? '/usr/bin/open' : 'xdg-open', args, options: { detached: true, stdio: 'ignore' } };
}

const WINDOWS_FILE_ACTION_MAIN_CS = [
  'using System;',
  'namespace AgyClaudeStudio {',
  '  internal static class WindowsFileActionRunner {',
  '    [STAThread]',
  '    private static int Main() {',
  '      string uri = Environment.GetEnvironmentVariable("AGY_FILE_URI");',
  '      string mode = Environment.GetEnvironmentVariable("AGY_FILE_MODE");',
  '      return WindowsFileAction.Run(uri, mode) ? 0 : 1;',
  '    }',
  '  }',
  '}',
].join('\n');

let windowsFileActionBuildPromise = null;

function findWindowsCscExe() {
  const winDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.win32.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.win32.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function getWindowsFileActionCacheInfo(cacheDir = path.join(STATE_DIR, 'cache')) {
  const helperSrcPath = path.join(ROOT_DIR, 'scripts', 'WindowsFileAction.cs');
  if (!fs.existsSync(helperSrcPath)) return null;
  const src = fs.readFileSync(helperSrcPath, 'utf8');
  const hash = computeHash(src + '\n' + WINDOWS_FILE_ACTION_MAIN_CS);
  return {
    helperSrcPath,
    cacheDir,
    exePath: path.join(cacheDir, `agy-file-action-${hash}.exe`),
  };
}

function ensureWindowsFileActionExeAsync(cacheDir = path.join(STATE_DIR, 'cache')) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const info = getWindowsFileActionCacheInfo(cacheDir);
  if (!info) return Promise.resolve(null);
  if (fs.existsSync(info.exePath)) return Promise.resolve(info.exePath);
  if (windowsFileActionBuildPromise) return windowsFileActionBuildPromise;

  const csc = findWindowsCscExe();
  if (!csc) return Promise.resolve(null);

  windowsFileActionBuildPromise = new Promise((resolve) => {
    let stubPath = '';
    let tmpExe = '';
    try {
      fs.mkdirSync(info.cacheDir, { recursive: true });
      const suffix = `${process.pid}-${Date.now()}`;
      stubPath = path.join(info.cacheDir, `.file-action-main-${suffix}.cs`);
      tmpExe = path.join(info.cacheDir, `.file-action-${suffix}.exe`);
      fs.writeFileSync(stubPath, WINDOWS_FILE_ACTION_MAIN_CS, 'utf8');
      const child = spawn(
        csc,
        [
          '/nologo',
          '/utf8output',
          '/codepage:65001',
          '/target:winexe',
          '/optimize+',
          `/out:${tmpExe}`,
          '/r:System.dll',
          '/r:System.Core.dll',
          info.helperSrcPath,
          stubPath,
        ],
        { windowsHide: true, stdio: 'ignore' }
      );
      const cleanupTemp = () => {
        try { if (stubPath && fs.existsSync(stubPath)) fs.unlinkSync(stubPath); } catch {}
        try { if (tmpExe && fs.existsSync(tmpExe)) fs.unlinkSync(tmpExe); } catch {}
      };
      child.once('error', () => {
        cleanupTemp();
        resolve(null);
      });
      child.once('exit', (code) => {
        try { if (stubPath && fs.existsSync(stubPath)) fs.unlinkSync(stubPath); } catch {}
        if (code === 0 && fs.existsSync(tmpExe)) {
          try {
            if (!fs.existsSync(info.exePath)) {
              fs.renameSync(tmpExe, info.exePath);
            } else {
              fs.unlinkSync(tmpExe);
            }
            // Remove older stale cached helpers cleanly.
            for (const entry of fs.readdirSync(info.cacheDir)) {
              if (/^agy-file-action-.*\.exe$/i.test(entry)) {
                const full = path.join(info.cacheDir, entry);
                if (full !== info.exePath) {
                  try { fs.unlinkSync(full); } catch {}
                }
              }
            }
            resolve(fs.existsSync(info.exePath) ? info.exePath : null);
            return;
          } catch {}
        }
        cleanupTemp();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  }).finally(() => {
    windowsFileActionBuildPromise = null;
  });

  return windowsFileActionBuildPromise;
}

function buildWindowsExplorerRevealCommand(rawInput, { fsApi = fs, env = process.env } = {}) {
  const resolved = resolveLocalFileUri(rawInput, 'win32');
  if (!resolved) return null;
  // explorer.exe /select, splits arguments on literal commas; fall back to SHOpenFolderAndSelectItems for paths with ','.
  if (resolved.includes(',') || /[:\x00-\x1f\x7f"<>|?*]/.test(resolved.slice(2))) return null;
  const root = resolved.slice(0, 3);
  if (!/^[a-zA-Z]:\\$/.test(root)) return null;
  const parts = resolved.slice(3).split('\\').filter(Boolean);
  if (parts.length === 0) return null;
  let current = root.toUpperCase();
  try {
    if (!fsApi.lstatSync(current)) return null;
    for (const part of parts) {
      if (
        part === '.' ||
        part === '..' ||
        part.endsWith('.') ||
        part.endsWith(' ') ||
        /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part)
      ) {
        return null;
      }
      current = path.win32.join(current, part);
      const lst = fsApi.lstatSync(current);
      if (typeof lst.isSymbolicLink === 'function' && lst.isSymbolicLink()) return null;
    }
  } catch {
    return null;
  }
  const winDir = env.WINDIR || env.SystemRoot || 'C:\\Windows';
  const bin = path.win32.join(winDir, 'explorer.exe');
  return {
    bin,
    args: [`/select,"${current}"`],
    resolved: current,
    options: { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' },
  };
}

function openLocalFileActionAsync(options = {}) {
  const prepared = prepareLocalFileAction(options);
  if (!prepared.ok) return Promise.resolve(prepared);
  const spawnFn = options.spawnFn || spawn;
  const platform = options.platform || process.platform;
  const useFastWinHelper = platform === 'win32' && !options.spawnFn;

  const launch = (bin, args, spawnOpts) =>
    new Promise((resolve) => {
      let child;
      try { child = spawnFn(bin, args, spawnOpts); }
      catch (error) { resolve({ ok: false, mode: prepared.mode, reason: 'spawn-failed', error: error.message }); return; }
      let settled = false;
      const finish = (ok, reason) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok, mode: prepared.mode, reason }); } };
      const timer = setTimeout(() => { child.unref(); finish(false, 'launcher-timeout'); }, 10000);
      child.once('error', () => finish(false, 'spawn-failed'));
      child.once('exit', code => finish(code === 0, code === 0 ? undefined : 'launcher-error'));
    });

  if (!useFastWinHelper) {
    return launch(prepared.bin, prepared.args, prepared.options);
  }

  // Fast, native Windows reveal via explorer.exe /select,"<path>" (no DWM flicker, no helper compile).
  // Paths containing ',' fall through to the cached native SHOpenFolderAndSelectItems helper below.
  if (prepared.mode === 'reveal') {
    const explorerCmd = buildWindowsExplorerRevealCommand(options.target, { fsApi: options.fsApi || fs });
    if (explorerCmd) {
      return new Promise((resolve) => {
        let child;
        try {
          child = spawnFn(explorerCmd.bin, explorerCmd.args, explorerCmd.options);
        } catch {
          resolve(null);
          return;
        }
        let settled = false;
        const finish = (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(res);
        };
        const timer = setTimeout(() => {
          try { child.unref(); } catch {}
          finish({ ok: true, mode: 'reveal' });
        }, 1500);
        child.once('error', () => finish(null));
        child.once('spawn', () => {
          try { child.unref(); } catch {}
          finish({ ok: true, mode: 'reveal' });
        });
      }).then((res) => {
        if (res && res.ok) return res;
        return ensureWindowsFileActionExeAsync(options.cacheDir).then((cachedExe) => {
          if (cachedExe && fs.existsSync(cachedExe)) {
            return launch(cachedExe, [], {
              windowsHide: true,
              stdio: 'ignore',
              env: prepared.options.env,
            });
          }
          return launch(prepared.bin, prepared.args, prepared.options);
        });
      });
    }
  }

  return ensureWindowsFileActionExeAsync(options.cacheDir).then((cachedExe) => {
    if (cachedExe && fs.existsSync(cachedExe)) {
      return launch(cachedExe, [], {
        windowsHide: true,
        stdio: 'ignore',
        env: prepared.options.env,
      });
    }
    return launch(prepared.bin, prepared.args, prepared.options);
  });
}

module.exports = {
  createWatcherEnabledReader,
  resolveHostPluginConfigPath,
  STYLE_ID,
  PLUGIN_VERSION,
  SETTING_BINDING,
  STARTUP_GRACE_SECONDS,
  RUNTIME_PARTS,
  PLUGIN_DATA_DIR,
  STATE_DIR,
  PORT_FILE,
  PID_FILE,
  LOCK_FILE,
  LEGACY_CONFIG_FILE,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  CONFIG_VALIDATORS,
  I18N_COMPAT_FILE,
  REMOTE_I18N_COMPAT_URL,
  sanitizeSelectorList,
  readI18nCompatData,
  readPeriodicOverride,
  resolveExtraI18nOptOutSelectors,
  syncRemoteI18nCompat,
  validateConfigSetting,
  writeFileAtomic,
  resolvePluginDataDir,
  atomicWriteFileSync,
  sanitizeConfig,
  ensureMigratedPluginConfig,
  readConfig,
  updateConfigSetting,
  resolvePortCandidates,
  readActivePorts,
  readPort,
  SWARM_SIDECAR_URL_PREFIX,
  isAntigravityPageTarget,
  trackBindingSource,
  isInjectableTarget,
  listPages,
  detectAntigravityProcess,
  findAntigravityExecutable,
  resolveRunningAntigravityPath,
  hasRemoteDebuggingFlag,
  splitCommandArgs,
  inspectProcessInfo,
  inspectProcessCommand,
  evaluateWatcherOwnership,
  matchesWatcherForDir,
  classifyWatcherPid,
  resolveExistingWatchPidAction,
  isLikelyWatcherProcess,
  removeStalePortFile,
  activateAntigravityWindow,
  launchAntigravityWithCdp,
  relaunchAntigravityWithCdp,
  ensureAntigravityWithCdp,
  formatCdpUnavailableMessage,
  SAFE_OPEN_FILE_EXTS,
  resolveLocalFileUri,
  prepareLocalFileAction,
  buildWindowsExplorerRevealCommand,
  openLocalFileActionAsync,
  ensureWindowsFileActionExeAsync,
  CdpSession,
  readCss,
  readRuntimeBundle,
  computeHash,
  buildInjectExpression,
  buildConfigScriptExpression,
  buildRefreshExpression,
  REMOVE_EXPRESSION,
};
