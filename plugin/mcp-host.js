// Zero-tool MCP Stdio lifecycle host for the native Claude Studio (agy-claude-studio) plugin.
// - Exposes 0 tools (`tools/list -> []`) so it consumes 0 context tokens.
// - Launches and supervises the CDP watcher inside the Antigravity plugin lifecycle.
// - Detects both plugin disable (stdin close while LS is still alive -> live restore UI)
//   and host shutdown (LS /healthz unreachable or parent exit -> immediate clean exit with zero orphans).
const fs = require('fs');
const path = require('path');
const { STATE_DIR: CDP_STATE_DIR, createWatcherEnabledReader, resolveHostPluginConfigPath } = require('../src/cdp');
const {
  isBrokenPipeError,
  isPidAlive,
  normalizeLsHealthzUrl,
  startHostWatchdog,
  readWatcherLockInfo,
  registerMcpHost,
  listAliveMcpHosts,
  readAntigravityPluginEnabledState,
  ensureIdeRemoteDebuggingArgv,
  ensureDesktopRemoteDebuggingLaunchers,
  cleanupLegacyFlatRootFiles,
  exitProcessCleanly,
} = require('../src/lifecycle');
const { updateConfigSetting } = require('../src/inject');
const { startWatchController, removeInjectedUiFromReachablePages } = require('../src/watcher-core');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const PLUGIN_MANIFEST_PATH = path.join(PLUGIN_ROOT, 'plugin.json');

const SUPPORTED_MCP_VERSIONS = new Set([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
const DEFAULT_MCP_VERSION = '2025-03-26';

function readPluginManifest() {
  try {
    if (fs.existsSync(PLUGIN_MANIFEST_PATH)) {
      return JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

function readPluginVersion() {
  const parsed = readPluginManifest();
  if (typeof parsed?.version === 'string' && parsed.version.trim()) {
    return parsed.version.trim();
  }
  return '1.0.0';
}

function readPluginName() {
  const parsed = readPluginManifest();
  if (typeof parsed?.name === 'string' && parsed.name.trim()) {
    return parsed.name.trim();
  }
  return 'agy-claude-studio';
}

function handleMcpJsonRpcMessage(msg, serverVersion = '1.0.0') {
  if (!msg || typeof msg !== 'object') return null;
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== undefined;
  if (!hasId) return null;

  const id = msg.id;
  const method = String(msg.method || '');

  if (method === 'initialize') {
    const requested = String(msg.params?.protocolVersion || '').trim();
    const protocolVersion = SUPPORTED_MCP_VERSIONS.has(requested)
      ? requested
      : DEFAULT_MCP_VERSION;
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'agy-claude-studio-host',
          version: serverVersion,
        },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: [] } };
  }

  if (method === 'resources/list') {
    return { jsonrpc: '2.0', id, result: { resources: [] } };
  }

  if (method === 'resources/templates/list') {
    return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
  }

  if (method === 'prompts/list') {
    return { jsonrpc: '2.0', id, result: { prompts: [] } };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

async function isHostStillAlive(reason, healthzUrl) {
  if (reason === 'ls-dead' || reason === 'parent-dead') return false;
  if (!healthzUrl) return false;
  try {
    await fetch(healthzUrl, { signal: AbortSignal.timeout(450) });
    return true;
  } catch {
    return false;
  }
}

async function shouldRemoveUiOnShutdown({
  reason,
  healthzUrl,
  stateDir,
  antigravityConfigPath,
  pluginName,
  pluginRoot = PLUGIN_ROOT,
  isLeader = false,
  excludePid = process.pid,
  settleDelayMs = 120,
} = {}) {
  const readState = () =>
    antigravityConfigPath
      ? readAntigravityPluginEnabledState({
          pluginName,
          pluginRoot,
          configPath: antigravityConfigPath,
        })
      : 'unknown';

  const hasOtherPeers = () =>
    Boolean(stateDir) && listAliveMcpHosts({ stateDir, excludePid, pruneStale: true }).length > 0;

  let pluginState = readState();
  if (pluginState === 'disabled') {
    return Boolean(isLeader) || !hasOtherPeers();
  }

  if (!isLeader) {
    return false;
  }

  if (reason === 'ls-dead' || reason === 'parent-dead') {
    return false;
  }

  if (
    settleDelayMs > 0 &&
    (reason === 'stdin-end' || reason === 'stdin-close' || reason === 'signal:SIGTERM')
  ) {
    await new Promise((r) => setTimeout(r, settleDelayMs));
    pluginState = readState();
    if (pluginState === 'disabled') {
      return true;
    }
  }

  if (hasOtherPeers()) {
    return false;
  }

  if (pluginState === 'enabled') {
    return false;
  }

  return await isHostStillAlive(reason, healthzUrl);
}

function startMcpPluginHost() {
  const serverVersion = readPluginVersion();
  const pluginName = readPluginName();
  const healthzUrl = normalizeLsHealthzUrl(process.env.ANTIGRAVITY_LS_ADDRESS);
  const customStateDir = process.env.AGY_CLAUDE_STUDIO_STATE_DIR || process.env.AGY_CLAUDE_STYLE_STATE_DIR;
  const stateDir = customStateDir
    ? path.resolve(customStateDir)
    : CDP_STATE_DIR || PLUGIN_ROOT;
  const pidFile = path.join(stateDir, '.watch.pid');
  const lockFile = path.join(stateDir, '.watch.lock.json');
  const logFile = path.join(stateDir, 'watch.log');
  const antigravityConfigPath = resolveHostPluginConfigPath();
  const watcherEnabled = createWatcherEnabledReader(antigravityConfigPath);
  const standbyPollMs = Math.max(
    100,
    Number(process.env.AGY_CLAUDE_STUDIO_STANDBY_POLL_MS || process.env.AGY_CLAUDE_STYLE_STANDBY_POLL_MS) || 1500
  );
  const rawSettleMs =
    process.env.AGY_CLAUDE_STUDIO_SHUTDOWN_SETTLE_MS !== undefined
      ? process.env.AGY_CLAUDE_STUDIO_SHUTDOWN_SETTLE_MS
      : process.env.AGY_CLAUDE_STYLE_SHUTDOWN_SETTLE_MS;
  const settleDelayMs = rawSettleMs !== undefined ? Math.max(0, Number(rawSettleMs) || 0) : 120;

  let shuttingDown = false;
  let shutdownTookControl = false;
  let framingMode = 'line';
  let rawBuffer = Buffer.alloc(0);

  function appendSafeLog(msg) {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
    } catch {}
  }

  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {}
  try {
    const cleanupRes = cleanupLegacyFlatRootFiles(PLUGIN_ROOT);
    if (!cleanupRes.skipped && (cleanupRes.removed.length > 0 || cleanupRes.preserved.length > 0 || cleanupRes.errors.length > 0)) {
      appendSafeLog(
        `Legacy root cleanup: removed=${cleanupRes.removed.length} preserved=${cleanupRes.preserved.length} errors=${cleanupRes.errors.length}`
      );
    }
  } catch {}
  const hostLease = registerMcpHost({
    stateDir,
    pid: process.pid,
    lsAddress: process.env.ANTIGRAVITY_LS_ADDRESS || '',
  });

  let controller = null;
  let provisionedLaunchers = false;
  let reconcileInFlight = null;
  let reconcileQueued = false;
  let reconcileDebounceTimer = null;
  let standbyTimer = null;
  let stateDirWatcher = null;
  let configWatcher = null;
  let watchdog = null;

  async function runReconcileStep() {
    if (shuttingDown) return;

    const pluginState = antigravityConfigPath
      ? readAntigravityPluginEnabledState({
          pluginName,
          pluginRoot: PLUGIN_ROOT,
          configPath: antigravityConfigPath,
        })
      : 'unknown';

    if (!watcherEnabled() || pluginState === 'disabled') {
      if (controller && !controller.isStopped()) {
        const ctrl = controller;
        controller = null;
        await ctrl.stop({ removeFromPages: true, exitCode: 0, reason: 'plugin-disabled' });
      }
      return;
    }

    if (controller && !controller.isStopped()) {
      return;
    }
    controller = null;

    const existing = readWatcherLockInfo(pidFile, lockFile);
    if (
      existing &&
      existing.alive &&
      existing.pid !== process.pid &&
      existing.mode === 'mcp-plugin'
    ) {
      return;
    }

    if (!provisionedLaunchers) {
      provisionedLaunchers = true;
      try {
        ensureIdeRemoteDebuggingArgv();
      } catch {}
      void ensureDesktopRemoteDebuggingLaunchers({ enabled: true }).catch(() => {});
    }

    try {
      const ctrl = await startWatchController({
        antigravityConfigPath,
        mode: 'mcp-plugin',
        keepAlive: true,
        watchHostExit: false,
        watchStdin: false,
        installWatchdog: false,
        replaceExisting: true,
        preserveModes: ['mcp-plugin'],
        enableConsole: false,
        lsAddress: '',
        stateDir,
        pidFile,
        lockFile,
        logFile,
        updateConfigSetting,
      });

      if (shuttingDown) {
        if (shutdownTookControl) {
          await ctrl.stop({ removeFromPages: false, exitCode: 0, reason: 'late-shutdown' }).catch(() => {});
        } else {
          controller = ctrl;
        }
        return;
      }

      const postAcquireState = antigravityConfigPath
        ? readAntigravityPluginEnabledState({
            pluginName,
            pluginRoot: PLUGIN_ROOT,
            configPath: antigravityConfigPath,
          })
        : 'unknown';
      if (!watcherEnabled() || postAcquireState === 'disabled') {
        await ctrl.stop({ removeFromPages: true, exitCode: 0, reason: 'plugin-disabled' }).catch(() => {});
        return;
      }

      controller = ctrl;
      try {
        listAliveMcpHosts({ stateDir, excludePid: process.pid, pruneStale: true });
      } catch {}
    } catch (err) {
      if (err && err.code === 'WATCHER_LOCKED') {
        return;
      }
      appendSafeLog(
        `[!] MCP watcher 启动失败，将在 standby 周期重试: ${err && err.message ? err.message : String(err)}`
      );
    }
  }

  function triggerReconcile() {
    if (shuttingDown) return reconcileInFlight || Promise.resolve();
    if (reconcileInFlight) {
      reconcileQueued = true;
      return reconcileInFlight;
    }
    reconcileInFlight = (async () => {
      do {
        reconcileQueued = false;
        if (shuttingDown) break;
        await runReconcileStep();
      } while (reconcileQueued && !shuttingDown);
    })()
      .catch((err) => {
        appendSafeLog(`[!] MCP watcher 协调异常: ${err && err.message ? err.message : String(err)}`);
      })
      .finally(() => {
        reconcileInFlight = null;
        if (reconcileQueued && !shuttingDown) {
          void triggerReconcile();
        }
      });
    return reconcileInFlight;
  }

  function scheduleReconcile() {
    if (shuttingDown) return;
    clearTimeout(reconcileDebounceTimer);
    reconcileDebounceTimer = setTimeout(() => {
      reconcileDebounceTimer = null;
      void triggerReconcile();
    }, 60);
    if (typeof reconcileDebounceTimer.unref === 'function') {
      reconcileDebounceTimer.unref();
    }
  }

  void triggerReconcile();

  try {
    if (fs.existsSync(stateDir)) {
      stateDirWatcher = fs.watch(stateDir, (_, filename) => {
        if (shuttingDown) return;
        if (!filename) {
          scheduleReconcile();
          return;
        }
        const name = process.platform === 'win32' ? String(filename).toLowerCase() : String(filename);
        if (name === '.watch.lock.json' || name === '.watch.pid') {
          scheduleReconcile();
        }
      });
      if (typeof stateDirWatcher.unref === 'function') stateDirWatcher.unref();
    }
  } catch {}

  if (antigravityConfigPath) {
    try {
      const configDir = path.dirname(antigravityConfigPath);
      const configBase = path.basename(antigravityConfigPath);
      if (fs.existsSync(configDir)) {
        configWatcher = fs.watch(configDir, (_, filename) => {
          if (shuttingDown) return;
          if (!filename) {
            scheduleReconcile();
            return;
          }
          const matches =
            process.platform === 'win32'
              ? String(filename).toLowerCase() === configBase.toLowerCase()
              : String(filename) === configBase;
          if (matches) {
            scheduleReconcile();
          }
        });
        if (typeof configWatcher.unref === 'function') configWatcher.unref();
      }
    } catch {}
  }

  standbyTimer = setInterval(() => {
    void triggerReconcile();
  }, standbyPollMs);
  if (typeof standbyTimer.unref === 'function') {
    standbyTimer.unref();
  }

  async function shutdownHost(reason = 'shutdown') {
    if (shuttingDown) return;
    shuttingDown = true;
    if (watchdog) {
      watchdog.stop();
      watchdog = null;
    }
    if (standbyTimer) {
      clearInterval(standbyTimer);
      standbyTimer = null;
    }
    if (reconcileDebounceTimer) {
      clearTimeout(reconcileDebounceTimer);
      reconcileDebounceTimer = null;
    }
    if (stateDirWatcher) {
      try {
        stateDirWatcher.close();
      } catch {}
      stateDirWatcher = null;
    }
    if (configWatcher) {
      try {
        configWatcher.close();
      } catch {}
      configWatcher = null;
    }

    hostLease.unregister();

    const forceTimer = setTimeout(() => {
      process.exit(0);
    }, 2200);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    try {
      if (reconcileInFlight) {
        await Promise.race([
          reconcileInFlight.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 500)),
        ]);
      }
      shutdownTookControl = true;
      const isLeader = Boolean(controller && !controller.isStopped());
      const shouldRemove = await shouldRemoveUiOnShutdown({
        reason,
        healthzUrl,
        stateDir,
        antigravityConfigPath,
        pluginName,
        pluginRoot: PLUGIN_ROOT,
        isLeader,
        excludePid: process.pid,
        settleDelayMs,
      });

      if (controller) {
        const ctrl = controller;
        controller = null;
        await ctrl.stop({ removeFromPages: shouldRemove, exitCode: 0, reason });
      } else if (shouldRemove) {
        await removeInjectedUiFromReachablePages({ timeoutMs: 1200 }).catch(() => {});
      }
    } catch {
      // Ignore shutdown errors
    } finally {
      clearTimeout(forceTimer);
      exitProcessCleanly(0, 50);
    }
  }

  const onPipeError = (err) => {
    if (isBrokenPipeError(err)) {
      void shutdownHost('broken-pipe');
    }
  };
  process.stdout?.on('error', onPipeError);
  process.stderr?.on('error', onPipeError);

  watchdog = startHostWatchdog({
    lsAddress: process.env.ANTIGRAVITY_LS_ADDRESS,
    watchStdin: true,
    checkIntervalMs: 3000,
    maxLsFailures: 2,
    onShutdown: (reason) => {
      void shutdownHost(reason);
    },
  });

  function writeJsonRpcResponse(payload, mode) {
    if (shuttingDown) return;
    try {
      const serialized = JSON.stringify(payload);
      if (mode === 'lsp') {
        const byteLen = Buffer.byteLength(serialized, 'utf8');
        process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${serialized}`);
      } else {
        process.stdout.write(`${serialized}\n`);
      }
    } catch (err) {
      onPipeError(err);
    }
  }

  function dispatchParsedPayload(parsed, mode) {
    if (Array.isArray(parsed)) {
      const batchOut = parsed
        .map((item) => handleMcpJsonRpcMessage(item, serverVersion))
        .filter(Boolean);
      if (batchOut.length > 0) {
        writeJsonRpcResponse(batchOut, mode);
      }
      return;
    }
    const response = handleMcpJsonRpcMessage(parsed, serverVersion);
    if (response) {
      writeJsonRpcResponse(response, mode);
    }
  }

  function drainInputBuffer() {
    while (rawBuffer.length > 0) {
      const preview = rawBuffer.subarray(0, Math.min(rawBuffer.length, 64)).toString('utf8');
      if (/^Content-Length:/i.test(preview.trimStart())) {
        framingMode = 'lsp';
        const sepIdx = rawBuffer.indexOf('\r\n\r\n');
        const lfSepIdx = sepIdx < 0 ? rawBuffer.indexOf('\n\n') : -1;
        const headerEnd = sepIdx >= 0 ? sepIdx : lfSepIdx;
        const sepLen = sepIdx >= 0 ? 4 : 2;
        if (headerEnd < 0) return;

        const headerStr = rawBuffer.subarray(0, headerEnd).toString('utf8');
        const lenMatch = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) {
          rawBuffer = rawBuffer.subarray(headerEnd + sepLen);
          continue;
        }
        const contentLen = Number(lenMatch[1]);
        const totalFrameLen = headerEnd + sepLen + contentLen;
        if (rawBuffer.length < totalFrameLen) return;

        const bodyStr = rawBuffer.subarray(headerEnd + sepLen, totalFrameLen).toString('utf8');
        rawBuffer = rawBuffer.subarray(totalFrameLen);
        try {
          dispatchParsedPayload(JSON.parse(bodyStr), 'lsp');
        } catch {}
        continue;
      }

      const nlIdx = rawBuffer.indexOf(0x0a);
      if (nlIdx < 0) return;
      const lineStr = rawBuffer.subarray(0, nlIdx).toString('utf8').trim();
      rawBuffer = rawBuffer.subarray(nlIdx + 1);
      if (!lineStr) continue;
      try {
        dispatchParsedPayload(JSON.parse(lineStr), framingMode);
      } catch {}
    }
  }

  process.stdin.on('data', (chunk) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    rawBuffer = rawBuffer.length === 0 ? buf : Buffer.concat([rawBuffer, buf]);
    drainInputBuffer();
  });
  process.stdin.resume();
}

if (require.main === module) {
  startMcpPluginHost();
}

module.exports = {
  readPluginVersion,
  readPluginName,
  resolveHostPluginConfigPath,
  isHostStillAlive,
  shouldRemoveUiOnShutdown,
  handleMcpJsonRpcMessage,
  startMcpPluginHost,
};
