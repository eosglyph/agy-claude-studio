// Background CDP watcher controller for Claude Studio (agy-claude-studio).
const fs = require('fs');
const path = require('path');
const {
  PID_FILE,
  LOCK_FILE,
  STATE_DIR: CDP_STATE_DIR,
  CONFIG_FILE: CDP_CONFIG_FILE,
  SETTING_BINDING,
  readConfig,
  readCss,
  readRuntimeBundle,
  computeHash,
  readActivePorts,
  listPages,
  CdpSession,
  buildInjectExpression,
  buildConfigScriptExpression,
  REMOVE_EXPRESSION,
} = require('./cdp');
const { applyPageScripts } = require('./inject');
const {
  createSafeLogger,
  createIdleHostTracker,
  startHostWatchdog,
  acquireWatcherLock,
} = require('./lifecycle');

const STATE_DIR = (process.env.AGY_CLAUDE_STUDIO_STATE_DIR || process.env.AGY_CLAUDE_STYLE_STATE_DIR)
  ? path.resolve(process.env.AGY_CLAUDE_STUDIO_STATE_DIR || process.env.AGY_CLAUDE_STYLE_STATE_DIR)
  : CDP_STATE_DIR || __dirname;
const LOG_FILE = path.join(STATE_DIR, 'watch.log');

function shortTitle(page) {
  const t = (page && (page.title || page.url)) || '';
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

async function resolveReachableTarget() {
  const ports = readActivePorts();
  if (!ports.length) return { port: null, pages: null };
  let fallbackReachable = null;
  for (const port of ports) {
    try {
      const pages = await listPages(port);
      if (pages.length > 0) {
        return { port, pages };
      }
      if (!fallbackReachable) {
        fallbackReachable = { port, pages };
      }
    } catch {
      // Port is unreachable or stale; try next candidate
    }
  }
  return fallbackReachable || { port: ports[0], pages: null };
}

async function removeInjectedUiFromReachablePages({ timeoutMs = 1200 } = {}) {
  const run = async () => {
    const target = await resolveReachableTarget();
    if (!target.pages || target.pages.length === 0) return;
    await Promise.allSettled(
      target.pages.map(async (page) => {
        const session = await CdpSession.connect(page.webSocketDebuggerUrl, 800);
        try {
          await session.evaluate(REMOVE_EXPRESSION);
        } finally {
          session.close();
        }
      })
    );
  };
  const timeout = new Promise((resolve) => {
    const t = setTimeout(resolve, Math.max(100, Number(timeoutMs) || 1200));
    if (typeof t.unref === 'function') t.unref();
  });
  await Promise.race([run().catch(() => {}), timeout]);
}

async function startWatchController(options = {}) {
  const {
    mode = 'cli',
    keepAlive = false,
    watchHostExit = true,
    maxIdleFailures = Number(process.env.AG_WATCH_MAX_IDLE_FAILURES) || 3,
    tickIntervalMs = 2000,
    backoffIntervalMs = 10000,
    parentPid = 0,
    watchStdin = false,
    installWatchdog = true,
    replaceExisting = false,
    preserveModes = [],
    enableConsole = true,
    logFile = LOG_FILE,
    lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS,
    updateConfigSetting = null,
    onExit = null,
  } = options;

  const resolvedStateDir = options.stateDir
    ? path.resolve(options.stateDir)
    : STATE_DIR;
  const pidFile = options.pidFile || path.join(resolvedStateDir, '.watch.pid');
  const lockFile = options.lockFile || path.join(resolvedStateDir, '.watch.lock.json');
  const resolvedLogFile = options.logFile !== undefined ? options.logFile : path.join(resolvedStateDir, 'watch.log');

  let stopPromise = null;
  let stopped = false;

  const logger = createSafeLogger({
    logFile: resolvedLogFile,
    enableConsole,
    onBrokenPipe: () => {
      void stop({ removeFromPages: false, exitCode: 0, reason: 'broken-pipe' });
    },
  });

  const lock = await acquireWatcherLock({
    pidFile,
    lockFile,
    mode,
    replaceExisting,
    preserveModes,
  });

  if (!lock.acquired) {
    const err = new Error(`守护进程已在运行 (PID ${lock.existingPid})。如需重启请先运行 remove.bat`);
    err.code = 'WATCHER_LOCKED';
    err.existingPid = lock.existingPid;
    err.existingMode = lock.existingMode || null;
    err.preserved = Boolean(lock.preserved);
    logger.dispose();
    throw err;
  }

  logger.resetLogFile();
  logger.log(
    `[*] Claude Studio (agy-claude-studio) 守护模式启动 (PID ${process.pid}, mode=${mode}${keepAlive ? ', keep-alive' : ''})，每 ${Math.round(tickIntervalMs / 1000)} 秒检查一次窗口`
  );

  const attached = new Map();
  const skippedTargets = new Map();
  const idleTracker = createIdleHostTracker({ maxIdleFailures, keepAlive });
  let currentConfig = readConfig();
  let currentCodeHash = computeHash(readRuntimeBundle());
  let currentCssHash = computeHash(readCss());
  let expr = buildInjectExpression(currentConfig);
  let configExpr = buildConfigScriptExpression(currentConfig, currentCodeHash);
  let lastPort = null;
  let busy = false;
  let tickTimer = null;
  let reloadTimer = null;
  let fsWatcher = null;
  let configWatcher = null;
  let watchdog = null;
  let detachErrorGuards = null;

  function clearAttachedSessions() {
    for (const entry of attached.values()) {
      if (entry && entry.session) {
        entry.session.onClose = null;
        entry.session.close();
      }
    }
    attached.clear();
    skippedTargets.clear();
  }

  async function apply(entry, { refreshOnly = false } = {}) {
    return await applyPageScripts(entry, { expr, configExpr, refreshOnly });
  }

  async function attach(page) {
    if (stopped) return;
    attached.set(page.id, null);
    try {
      const session = await CdpSession.connect(page.webSocketDebuggerUrl);
      if (stopped) {
        session.close();
        attached.delete(page.id);
        return;
      }
      const entry = { session, bootstrapScriptId: null, configScriptId: null, page };
      attached.set(page.id, entry);

      session.onClose = () => {
        attached.delete(page.id);
        if (!stopped) {
          logger.log(`[-] 窗口已关闭: ${shortTitle(page)}`);
        }
      };

      let periodicSyncInFlight = false;
      await session.send('Page.enable');
      session.on('Runtime.bindingCalled', ({ name, payload }) => {
        if (name !== SETTING_BINDING) return;
        try {
          const msg = JSON.parse(payload);
          if (msg && msg.action === 'syncPeriodicElements') {
            const requestId = String(msg.requestId || '');
            if (periodicSyncInFlight) {
              session
                .evaluate(
                  `window.__agCsOnPeriodicSyncResult && window.__agCsOnPeriodicSyncResult(${JSON.stringify({
                    requestId,
                    ok: false,
                    error: 'already_running',
                  })});`
                )
                .catch(() => {});
              return;
            }
            periodicSyncInFlight = true;
            (async () => {
              try {
                const periodicSync = require('./periodic-sync.js');
                const freshCdp = require('./cdp');
                const dataDir = freshCdp.PLUGIN_DATA_DIR || freshCdp.STATE_DIR;
                const syncRes = await periodicSync.syncAndSavePeriodicElements({
                  pluginDataDir: dataDir,
                  timeoutMs: 25000,
                });
                logger.log(
                  `[↻] AI Studio 元素周期表同步完成: ${syncRes.totalElements} 个元素` +
                    (syncRes.newSymbols.length ? ` (新增: ${syncRes.newSymbols.join(', ')})` : '')
                );
                triggerHotReload(periodicSync.PERIODIC_OVERRIDE_FILENAME);
                if (!session.closed) {
                  await session
                    .evaluate(
                      `window.__agCsOnPeriodicSyncResult && window.__agCsOnPeriodicSyncResult(${JSON.stringify({
                        requestId,
                        ok: true,
                        totalElements: syncRes.totalElements,
                        symbols: syncRes.symbols,
                        newSymbols: syncRes.newSymbols,
                        updatedSymbols: syncRes.updatedSymbols,
                        syncedAt: syncRes.syncedAt,
                        override: syncRes.override,
                      })});`
                    )
                    .catch(() => {});
                }
              } catch (err) {
                logger.log(`[!] AI Studio 元素同步失败: ${err?.message || err}`);
                if (!session.closed) {
                  await session
                    .evaluate(
                      `window.__agCsOnPeriodicSyncResult && window.__agCsOnPeriodicSyncResult(${JSON.stringify({
                        requestId,
                        ok: false,
                        error: String(err?.message || err || 'sync_failed').slice(0, 180),
                      })});`
                    )
                    .catch(() => {});
                }
              } finally {
                periodicSyncInFlight = false;
              }
            })();
            return;
          }
          if (typeof updateConfigSetting !== 'function') return;
          const { key, value } = msg;
          if (updateConfigSetting(key, value)) {
            logger.log(`[⚙] 设置已保存: ${key} = ${JSON.stringify(value)}`);
          }
        } catch {}
      });
      await session.send('Runtime.enable');
      await session.send('Runtime.addBinding', { name: SETTING_BINDING });
      const res = await apply(entry);
      if (res && res.status === 'skipped-non-host') {
        for (const id of [entry.configScriptId, entry.bootstrapScriptId]) {
          if (!id) continue;
          await session
            .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id })
            .catch(() => {});
        }
        session.onClose = null;
        session.close();
        attached.delete(page.id);
        skippedTargets.set(page.id, page.url || '');
        return;
      }
      idleTracker.markAttached();
      logger.log(`[✓] 已注入 agy-claude-studio: ${shortTitle(page)} (${res.status})`);
    } catch (err) {
      const entry = attached.get(page.id);
      if (entry && entry.session) {
        entry.session.onClose = null;
        entry.session.close();
      }
      attached.delete(page.id);
      if (!stopped) {
        logger.log(`[!] 注入失败，稍后重试: ${shortTitle(page)} — ${err.message}`);
      }
    }
  }

  async function removeInjectedUiBestEffort() {
    const evaluateRemove = async () => {
      const activeEntries = Array.from(attached.values()).filter((e) => e && e.session && !e.session.closed);
      if (activeEntries.length > 0) {
        await Promise.allSettled(
          activeEntries.map((entry) => entry.session.evaluate(REMOVE_EXPRESSION).catch(() => {}))
        );
        return;
      }
      await removeInjectedUiFromReachablePages({ timeoutMs: 1200 });
    };
    const timeout = new Promise((resolve) => {
      const t = setTimeout(resolve, 1200);
      if (typeof t.unref === 'function') t.unref();
    });
    await Promise.race([evaluateRemove().catch(() => {}), timeout]);
  }

  async function stop({ removeFromPages = false, exitCode = 0, reason = 'stop' } = {}) {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      if (tickTimer) {
        clearTimeout(tickTimer);
        tickTimer = null;
      }
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      if (fsWatcher) {
        try {
          fsWatcher.close();
        } catch {}
        fsWatcher = null;
      }
      if (configWatcher) {
        try {
          configWatcher.close();
        } catch {}
        configWatcher = null;
      }
      if (watchdog) {
        watchdog.stop();
        watchdog = null;
      }
      if (detachErrorGuards) {
        detachErrorGuards();
        detachErrorGuards = null;
      }
      if (removeFromPages) {
        await removeInjectedUiBestEffort();
      }
      clearAttachedSessions();
      lock.release();
      logger.dispose();
      await new Promise((r) => setTimeout(r, 25));
      if (typeof onExit === 'function') {
        await onExit(exitCode, reason);
      }
    })();
    return stopPromise;
  }

  async function tick() {
    if (stopped || busy) return;
    busy = true;
    try {
      const { port, pages } = await resolveReachableTarget();
      if (stopped) return;

      if (!pages) {
        if (attached.size > 0) {
          clearAttachedSessions();
        }
        idleTracker.recordTick({ reachable: false, pageCount: 0, attachedCount: attached.size });
        if (watchHostExit && idleTracker.shouldExit()) {
          logger.log('[✓] 检测到 Antigravity 已关闭，守护进程自动退出');
          await stop({ removeFromPages: false, exitCode: 0, reason: 'host-closed' });
          return;
        }
        if (idleTracker.shouldBackoff()) {
          lastPort = null;
        }
        return;
      }

      if (port !== lastPort) {
        if (attached.size > 0) {
          clearAttachedSessions();
        }
        logger.log(`[+] 连接到调试端口 ${port}`);
        lastPort = port;
      }

      const activePageUrls = new Map(pages.map((p) => [p.id, p.url || '']));
      for (const [id, prevUrl] of skippedTargets.entries()) {
        if (!activePageUrls.has(id) || activePageUrls.get(id) !== prevUrl) {
          skippedTargets.delete(id);
        }
      }

      await Promise.all(
        pages.filter((p) => !attached.has(p.id) && !skippedTargets.has(p.id)).map(attach)
      );

      idleTracker.recordTick({
        reachable: true,
        pageCount: pages.length,
        attachedCount: attached.size,
      });

      if (watchHostExit && idleTracker.shouldExit()) {
        logger.log('[✓] 检测到 Antigravity 窗口全部关闭，守护进程自动退出');
        await stop({ removeFromPages: false, exitCode: 0, reason: 'host-closed' });
        return;
      }
    } finally {
      busy = false;
    }
  }

  function scheduleNextTick() {
    if (stopped) return;
    const delay = idleTracker.shouldBackoff() ? backoffIntervalMs : tickIntervalMs;
    tickTimer = setTimeout(async () => {
      tickTimer = null;
      try {
        await tick();
      } catch (err) {
        if (!stopped) logger.log(`[!] 轮询异常: ${err.message}`);
      }
      scheduleNextTick();
    }, delay);
  }

  function triggerHotReload(filename) {
    if (stopped) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      if (stopped) return;
      const baseChanged = path.basename(String(filename || '')).toLowerCase();
      const isConfigOnly =
        baseChanged === path.basename(CDP_CONFIG_FILE).toLowerCase() ||
        baseChanged === 'periodic-override.json';
      let refreshOnly = false;
      try {
        delete require.cache[require.resolve('./cdp')];
        const freshCdp = require('./cdp');
        currentConfig = freshCdp.readConfig();
        if (isConfigOnly) {
          const nextCodeHash = freshCdp.computeHash(freshCdp.readRuntimeBundle());
          const nextCssHash = freshCdp.computeHash(freshCdp.readCss());
          if (nextCodeHash === currentCodeHash && nextCssHash === currentCssHash) {
            configExpr = freshCdp.buildConfigScriptExpression(currentConfig, currentCodeHash);
            refreshOnly = true;
          } else {
            currentCodeHash = nextCodeHash;
            currentCssHash = nextCssHash;
            expr = freshCdp.buildInjectExpression(currentConfig);
            configExpr = freshCdp.buildConfigScriptExpression(currentConfig, currentCodeHash);
          }
        } else {
          currentCodeHash = freshCdp.computeHash(freshCdp.readRuntimeBundle());
          currentCssHash = freshCdp.computeHash(freshCdp.readCss());
          expr = freshCdp.buildInjectExpression(currentConfig);
          configExpr = freshCdp.buildConfigScriptExpression(currentConfig, currentCodeHash);
        }
      } catch (err) {
        logger.log(`[!] 读取文件失败: ${err.message}`);
        return;
      }
      let n = 0;
      for (const entry of attached.values()) {
        if (!entry || stopped) continue;
        try {
          await apply(entry, { refreshOnly });
          n++;
        } catch {}
      }
      if (!stopped) {
        logger.log(`[↻] ${filename} 已变更，已${refreshOnly ? '轻量刷新' : '热更新'} ${n} 个窗口`);
      }
    }, 180);
    if (typeof reloadTimer.unref === 'function') reloadTimer.unref();
  }

  try {
    fsWatcher = fs.watch(__dirname, (_, filename) => {
      if (stopped || !filename) return;
      if (filename.startsWith('.')) return;
      if (!/\.(css|js|json)$/i.test(filename)) return;
      if (/^(?:package|plugin|mcp_config)\.json$/i.test(filename)) return;
      triggerHotReload(filename);
    });
    if (typeof fsWatcher.unref === 'function') fsWatcher.unref();
  } catch {}

  try {
    const configDir = path.dirname(CDP_CONFIG_FILE);
    const configBase = path.basename(CDP_CONFIG_FILE).toLowerCase();
    if (path.resolve(configDir) !== path.resolve(__dirname)) {
      fs.mkdirSync(configDir, { recursive: true });
      configWatcher = fs.watch(configDir, (_, filename) => {
        if (stopped || !filename) return;
        const base = path.basename(filename).toLowerCase();
        if (base !== configBase && base !== 'periodic-override.json') return;
        triggerHotReload(base);
      });
      if (typeof configWatcher.unref === 'function') configWatcher.unref();
    }
  } catch {}

  detachErrorGuards = logger.installProcessErrorGuards({
    onFatalPipe: () => {
      void stop({ removeFromPages: false, exitCode: 0, reason: 'broken-pipe' });
    },
  });

  if (installWatchdog) {
    watchdog = startHostWatchdog({
      lsAddress,
      parentPid,
      watchStdin,
      onShutdown: (reason) => {
        if (reason !== 'broken-pipe') {
          logger.log(`[*] 收到退出信号 (${reason})，守护进程退出`);
        }
        void stop({ removeFromPages: false, exitCode: 0, reason });
      },
    });
  }

  await tick();
  if (!stopped) {
    scheduleNextTick();
  }

  return {
    stop,
    tick,
    getAttachedCount: () => attached.size,
    getLastPort: () => lastPort,
    isStopped: () => stopped,
  };
}

module.exports = {
  LOG_FILE,
  shortTitle,
  resolveReachableTarget,
  removeInjectedUiFromReachablePages,
  startWatchController,
};
