// Inject Claude Studio (agy-claude-studio) into every open Antigravity window over CDP.
//
//   node inject.js            one-shot: inject now and exit
//   node inject.js --watch    daemon mode: auto-inject into new/reloaded windows
//                             and hot-reload style.css / *.js / config.json
//   node inject.js --launch   launch Antigravity with --remote-debugging-port=0
//                             (add --relaunch to restart a running instance without CDP)
//   node inject.js --managed  managed mode (equivalent to --launch --watch --exit-on-host-close):
//                             launch/attach Antigravity with CDP, watch windows, and exit when host closes
//   Options: --exit-on-host-close, --startup-grace <sec> (default 90s), --poll-ms <ms>, --replace
const fs = require('fs');
const path = require('path');
let cdpApi = require('./cdp');
const {
  PID_FILE,
  CONFIG_FILE,
  SETTING_BINDING,
  STARTUP_GRACE_SECONDS,
} = cdpApi;

const MANAGED = process.argv.includes('--managed');
const LAUNCH = MANAGED || process.argv.includes('--launch');
const WATCH = MANAGED || process.argv.includes('--watch');
const RELAUNCH = process.argv.includes('--relaunch');
const REPLACE_EXISTING = process.argv.includes('--replace');
const SKIP_IF_RUNNING = process.argv.includes('--skip-if-running');
const EXIT_ON_HOST_CLOSE_FLAG = MANAGED || process.argv.includes('--exit-on-host-close');
const LOG_FILE = path.join(__dirname, 'watch.log');

function parseIntArg(flag, envName) {
  const prefix = `${flag}=`;
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    let raw = null;
    if (arg === flag && i + 1 < process.argv.length) {
      raw = process.argv[i + 1];
    } else if (arg.startsWith(prefix)) {
      raw = arg.slice(prefix.length);
    }
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  if (envName && process.env[envName]) {
    const n = parseInt(process.env[envName], 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

const PARENT_PID = parseIntArg('--parent-pid', 'AG_PARENT_PID');
const STARTUP_GRACE_SECONDS_VAL =
  parseIntArg('--startup-grace', 'AG_STARTUP_GRACE_SEC') || STARTUP_GRACE_SECONDS;
const POLL_INTERVAL_MS = Math.max(
  100,
  Math.min(10000, parseIntArg('--poll-ms', 'AG_WATCH_POLL_MS') || 2000)
);

function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  try {
    console.log(line);
  } catch {}
  if (WATCH) {
    try {
      const stat = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
      if (stat && stat.size > 1024 * 1024) {
        fs.writeFileSync(LOG_FILE, '');
      }
      fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
    } catch {}
  }
}

function shortTitle(page) {
  const t = page.title || page.url;
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

async function injectOnce({ log: outLog = log } = {}) {
  const ports = typeof cdpApi.readActivePorts === 'function' ? cdpApi.readActivePorts() : [cdpApi.readPort()].filter(Boolean);
  if (!ports.length) {
    const proc = cdpApi.detectAntigravityProcess();
    throw new Error(cdpApi.formatCdpUnavailableMessage({ running: proc.running, port: null }));
  }
  let port = null;
  let pages = null;
  for (const cand of ports) {
    try {
      const list = await cdpApi.listPages(cand);
      port = cand;
      pages = list;
      if (pages.length > 0) break;
    } catch {}
  }
  if (!pages) {
    const proc = cdpApi.detectAntigravityProcess();
    throw new Error(cdpApi.formatCdpUnavailableMessage({ running: proc.running, port: ports[0] }));
  }
  if (pages.length === 0) throw new Error('未找到 Antigravity 窗口页面');

  outLog(`[+] 调试端口 ${port}，发现 ${pages.length} 个窗口`);
  const expr = cdpApi.buildInjectExpression();
  let injected = 0;
  let skipped = 0;
  for (const page of pages) {
    const session = await cdpApi.CdpSession.connect(page.webSocketDebuggerUrl);
    try {
      const res = await session.evaluate(expr);
      if (res && res.status === 'skipped-non-host') {
        skipped += 1;
        continue;
      }
      injected += 1;
      outLog(`[✓] ${shortTitle(page)} (agy-claude-studio ${res.version} · 状态: ${res.status})`);
    } finally {
      session.close();
    }
  }
  return { port, injected, skipped };
}

async function launchWithCdp({ autoRelaunchFromConfig = false } = {}) {
  const autoRelaunchWithCdp =
    WATCH || autoRelaunchFromConfig ? cdpApi.readConfig().autoRelaunchWithCdp === true : false;
  const res = await cdpApi.ensureAntigravityWithCdp({
    port: 0,
    relaunch: RELAUNCH,
    autoRelaunchWithCdp,
  });
  if (res.action === 'already-cdp') {
    log(`[✓] Antigravity 已在调试端口 ${res.port} 运行 (${res.pagesCount} 个窗口)`);
    return;
  }
  if (res.action === 'waiting-cdp') {
    log(`[*] Antigravity 已携带调试参数启动 (PID: ${res.pids.join(', ')})，等待调试端口就绪...`);
    return;
  }
  if (res.action === 'relaunched') {
    log('[✓] 已重新启动 Antigravity（CDP 远程调试端口已开启）');
    return;
  }
  if (res.action === 'launched') {
    log('[✓] 已以 --remote-debugging-port=0 启动 Antigravity');
    return;
  }
  if (res.action === 'running-without-cdp') {
    throw new Error(
      `Antigravity 正在运行但未开启 CDP 端口（PID: ${res.pids.join(', ')}）。` +
        `请先完全退出 Antigravity，或运行 node inject.js --launch --relaunch 自动重启。`
    );
  }
  if (res.action === 'relaunch-failed') {
    throw new Error(`自动重启失败 (${res.reason})，请手动完全退出 Antigravity 后重试`);
  }
  throw new Error('未找到 Antigravity 可执行程序，请手动以 --remote-debugging-port=0 启动');
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function releasePidFile() {
  try {
    if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(opts = {}) {
  const pidFile = opts.pidFile || PID_FILE;
  const targetDir = opts.targetDir || __dirname;
  const replaceExisting = opts.replaceExisting !== undefined ? opts.replaceExisting : REPLACE_EXISTING;
  const allowGracefulDuplicateExit = Boolean(opts.allowGracefulDuplicateExit);
  const duplicateWaitMs = Number.isInteger(opts.duplicateWaitMs) && opts.duplicateWaitMs >= 0 ? opts.duplicateWaitMs : 1500;
  const killFn = typeof opts.killFn === 'function' ? opts.killFn : (p, sig) => process.kill(p, sig);
  const exitFn = typeof opts.exitFn === 'function' ? opts.exitFn : (code) => process.exit(code);
  const aliveCheck = (p) => {
    try {
      killFn(p, 0);
      return true;
    } catch (err) {
      return Boolean(err && err.code === 'EPERM');
    }
  };

  const decision = cdpApi.resolveExistingWatchPidAction(pidFile, targetDir, {
    selfPid: opts.selfPid,
    killFn,
    inspectFn: opts.inspectFn,
    platform: opts.platform,
  });

  if (decision.action === 'refuse') {
    const errMsg = `[!] 无法验证 .watch.pid 进程归属 (PID ${decision.pid})，出于安全策略拒绝终止或覆盖锁文件`;
    console.error(errMsg);
    return exitFn(1, { blocked: true, reason: decision.reason || 'unknown', pid: decision.pid });
  }

  if (decision.action === 'owned') {
    const pid = decision.pid;
    if (replaceExisting) {
      try {
        killFn(pid, 'SIGTERM');
      } catch {}
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && aliveCheck(pid)) {
        sleepSync(50);
      }
      if (aliveCheck(pid)) {
        try {
          killFn(pid, 'SIGKILL');
        } catch {}
      }
    } else if (allowGracefulDuplicateExit) {
      const deadline = Date.now() + duplicateWaitMs;
      while (Date.now() < deadline && aliveCheck(pid)) {
        sleepSync(100);
      }
      if (aliveCheck(pid)) {
        log(`[*] 监听进程已在运行 (PID ${pid})，跳过重复启动`);
        return { acquired: false, duplicate: true, pid };
      }
      const reDecision = cdpApi.resolveExistingWatchPidAction(pidFile, targetDir, {
        selfPid: opts.selfPid,
        killFn,
        inspectFn: opts.inspectFn,
        platform: opts.platform,
      });
      if (reDecision.action === 'refuse') {
        const errMsg = `[!] 无法验证 .watch.pid 进程归属 (PID ${reDecision.pid})，出于安全策略拒绝终止或覆盖锁文件`;
        console.error(errMsg);
        return exitFn(1, { blocked: true, reason: reDecision.reason || 'unknown', pid: reDecision.pid });
      }
      if (reDecision.action === 'owned') {
        log(`[*] 监听进程已在运行 (PID ${reDecision.pid})，跳过重复启动`);
        return { acquired: false, duplicate: true, pid: reDecision.pid };
      }
    } else {
      console.error(`[!] 守护进程已在运行 (PID ${pid})。如需重启请先运行 remove.sh / remove.bat 或附加 --replace`);
      return exitFn(1, { blocked: true, reason: 'already-running', pid });
    }
  }

  // Only reached when action is 'write', 'clear' (dead/foreign/invalid), or 'owned' resolved via --replace / prior exit.
  cdpApi.writeFileAtomic(pidFile, String(opts.selfPid || process.pid));
  if (!opts.skipExitHook) {
    process.on('exit', releasePidFile);
  }
  return { acquired: true, replaced: decision.action === 'owned', priorStatus: decision.status };
}

async function applyPageScripts(entry, { expr, configExpr, refreshOnly = false } = {}) {
  if (refreshOnly && configExpr && entry.bootstrapScriptId) {
    if (entry.configScriptId) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.configScriptId })
        .catch(() => {});
      entry.configScriptId = null;
    }
    const { identifier } = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: configExpr,
    });
    entry.configScriptId = identifier;
    const fastRes = await entry.session.evaluate(configExpr).catch(() => null);
    if (fastRes && fastRes.status === 'refreshed') return fastRes;
  }

  if (entry.configScriptId) {
    await entry.session
      .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.configScriptId })
      .catch(() => {});
    entry.configScriptId = null;
  }
  if (entry.bootstrapScriptId) {
    await entry.session
      .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.bootstrapScriptId })
      .catch(() => {});
    entry.bootstrapScriptId = null;
  }
  const { identifier: bootstrapId } = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: expr,
  });
  entry.bootstrapScriptId = bootstrapId;
  if (configExpr) {
    const { identifier: cfgId } = await entry.session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: configExpr,
    });
    entry.configScriptId = cfgId;
    // Apply latest config override before evaluating (possibly cached) full bootstrap expr.
    await entry.session.evaluate(configExpr).catch(() => null);
  }
  return await entry.session.evaluate(expr);
}

async function watch({
  forceExitOnHostClose = false,
  startupGraceEnabled = false,
  allowGracefulDuplicateExit = false,
} = {}) {
  const lockRes = acquireLock({ allowGracefulDuplicateExit });
  if (!lockRes || !lockRes.acquired) return;
  try {
    fs.writeFileSync(LOG_FILE, '');
  } catch {}
  log(
    `[*] Claude Studio (agy-claude-studio) 守护模式启动 (PID ${process.pid})，每 ${POLL_INTERVAL_MS / 1000} 秒检查一次窗口`
  );

  const watchStartedAt = Date.now();
  const startupGraceMs = STARTUP_GRACE_SECONDS_VAL * 1000;
  const effectiveExitOnCloseFlag = EXIT_ON_HOST_CLOSE_FLAG || forceExitOnHostClose;

  const attached = new Map();
  let currentConfig = cdpApi.readConfig();
  let currentCodeHash = cdpApi.computeHash(cdpApi.readRuntimeBundle());
  let currentCssHash = cdpApi.computeHash(cdpApi.readCss());
  let expr = cdpApi.buildInjectExpression(currentConfig);
  let configExpr = cdpApi.buildConfigScriptExpression(currentConfig, currentCodeHash);
  let shuttingDown = false;
  let tickTimer = null;
  let reloadTimer = null;
  let watcher = null;

  function closeAllSessions() {
    for (const entry of attached.values()) {
      if (entry && entry.session) {
        try {
          entry.session.onClose = null;
          entry.session.close();
        } catch {}
      }
    }
    attached.clear();
  }

  function shutdown(code = 0, reason = '') {
    if (shuttingDown) return;
    shuttingDown = true;
    if (reason) log(`[*] 守护进程退出: ${reason}`);
    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      watcher = null;
    }
    closeAllSessions();
    releasePidFile();
    process.exit(code);
  }

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(sig, () => shutdown(0, `收到信号 ${sig}`));
  }

  // Prevent orphan CPU spin when stdout/stderr pipe disconnects (e.g. ELECTRON_RUN_AS_NODE=1)
  for (const stream of [process.stdout, process.stderr]) {
    if (stream && typeof stream.on === 'function') {
      stream.on('error', (err) => {
        if (err && (err.code === 'EPIPE' || err.code === 'EOF' || err.code === 'ERR_STREAM_DESTROYED')) {
          shutdown(0);
        }
      });
    }
  }
  if ((PARENT_PID || process.env.ELECTRON_RUN_AS_NODE === '1') && process.stdin && !process.stdin.isTTY) {
    try {
      const st = fs.fstatSync(0);
      if (st.isFIFO() || st.isSocket()) {
        process.stdin.resume();
        process.stdin.on('end', () => shutdown(0, '标准输入管道已关闭'));
        process.stdin.on('close', () => shutdown(0, '标准输入管道已断开'));
      }
    } catch {}
  }

  async function apply(entry, opts = {}) {
    return applyPageScripts(entry, { expr, configExpr, refreshOnly: opts.refreshOnly });
  }

  async function attach(page) {
    attached.set(page.id, null);
    try {
      const session = await cdpApi.CdpSession.connect(page.webSocketDebuggerUrl);
      const entry = { session, bootstrapScriptId: null, configScriptId: null };
      attached.set(page.id, entry);
      session.onClose = () => {
        attached.delete(page.id);
        log(`[-] 窗口已关闭: ${shortTitle(page)}`);
      };
      let periodicSyncInFlight = false;
      await session.send('Page.enable');
      session.on('Runtime.bindingCalled', ({ name, payload }) => {
        if (name !== SETTING_BINDING) return;
        try {
          const msg = JSON.parse(payload);
          if (msg && msg.action === 'syncPeriodicElements') {
            const requestId = String(msg.requestId || '');
            if (periodicSyncInFlight) return;
            periodicSyncInFlight = true;
            (async () => {
              try {
                const periodicSync = require('./periodic-sync.js');
                const dataDir = cdpApi.PLUGIN_DATA_DIR || cdpApi.STATE_DIR;
                const syncRes = await periodicSync.syncAndSavePeriodicElements({
                  pluginDataDir: dataDir,
                  timeoutMs: 25000,
                });
                log(`[↻] AI Studio 元素周期表同步完成: ${syncRes.totalElements} 个元素`);
                configExpr = cdpApi.buildConfigScriptExpression(currentConfig, currentCodeHash);
                for (const item of attached.values()) {
                  if (item) await apply(item, { refreshOnly: true }).catch(() => {});
                }
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
                log(`[!] AI Studio 元素同步失败: ${err?.message || err}`);
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
          const { key, value } = msg;
          if (cdpApi.updateConfigSetting(key, value)) {
            currentConfig = cdpApi.readConfig();
            log(`[⚙] 设置已保存: ${key} = ${JSON.stringify(value)}`);
          }
        } catch {}
      });
      await session.send('Runtime.enable');
      await session.send('Runtime.addBinding', { name: SETTING_BINDING });
      const res = await apply(entry);
      hadAttachedWindow = true;
      log(`[✓] 已注入 agy-claude-studio: ${shortTitle(page)} (${res.status})`);
    } catch (err) {
      const entry = attached.get(page.id);
      if (entry) entry.session.close();
      attached.delete(page.id);
      log(`[!] 注入失败，稍后重试: ${shortTitle(page)} — ${err.message}`);
    }
  }

  let busy = false;
  let lastPort = null;
  let hadAttachedWindow = false;
  let consecutivePortFailures = 0;
  let noCdpRunningTicks = 0;
  let warnedNoCdpSig = '';
  let relaunchedPidSig = '';
  let lastRelaunchAt = 0;
  let cdpFlagCache = { pidSig: '', hasFlag: false };

  async function tick() {
    if (busy || shuttingDown) return;
    if (PARENT_PID && !isAlive(PARENT_PID)) {
      shutdown(0, `父进程 ${PARENT_PID} 已退出`);
      return;
    }
    busy = true;
    let nextDelayMs = POLL_INTERVAL_MS;
    try {
      const port = cdpApi.readPort();
      let pages = null;
      if (port) {
        try {
          pages = await cdpApi.listPages(port);
        } catch {
          pages = null;
        }
      }

      if (port && pages !== null) {
        consecutivePortFailures = 0;
        noCdpRunningTicks = 0;
        warnedNoCdpSig = '';
        cdpFlagCache = { pidSig: '', hasFlag: false };
        if (port !== lastPort) {
          closeAllSessions();
          log(`[+] 连接到调试端口 ${port}`);
          lastPort = port;
        }
        await Promise.all(pages.filter((p) => !attached.has(p.id)).map(attach));
      } else {
        consecutivePortFailures++;
        if (consecutivePortFailures >= 3 && (attached.size > 0 || lastPort !== null)) {
          closeAllSessions();
          lastPort = null;
        }

        const proc = process.env.AG_CDP_PORT ? { running: false, pids: [] } : cdpApi.detectAntigravityProcess();
        const shouldExitOnClose = effectiveExitOnCloseFlag || currentConfig.exitOnHostClose === true;
        if (shouldExitOnClose && hadAttachedWindow && attached.size === 0 && consecutivePortFailures >= 3 && !proc.running) {
          shutdown(0, 'Antigravity 宿主已关闭');
          return;
        }
        if (
          shouldExitOnClose &&
          startupGraceEnabled &&
          !hadAttachedWindow &&
          attached.size === 0 &&
          consecutivePortFailures >= 2 &&
          !proc.running &&
          Date.now() - watchStartedAt >= startupGraceMs
        ) {
          shutdown(0, `启动超过 ${STARTUP_GRACE_SECONDS_VAL} 秒仍未检测到 Antigravity CDP 端口`);
          return;
        }

        if (proc.running) {
          noCdpRunningTicks++;
          const pidSig = proc.pids.slice().sort((a, b) => a - b).join(',');
          if (noCdpRunningTicks >= 3) {
            if (cdpFlagCache.pidSig !== pidSig) {
              cdpFlagCache = { pidSig, hasFlag: cdpApi.hasRemoteDebuggingFlag(proc.pids) };
            }
            if (cdpFlagCache.hasFlag) {
              if (warnedNoCdpSig !== `cdp:${pidSig}`) {
                warnedNoCdpSig = `cdp:${pidSig}`;
                log('[*] 检测到 Antigravity 已携带 --remote-debugging-port 参数，继续等待调试端口响应...');
              }
            } else {
              if (warnedNoCdpSig !== pidSig) {
                warnedNoCdpSig = pidSig;
                log(`[!] ${cdpApi.formatCdpUnavailableMessage({ running: true, port })}`);
                if (!currentConfig.autoRelaunchWithCdp) {
                  log('[*] 提示：可在 config.json 中设置 "autoRelaunchWithCdp": true 以启用自动温和重启接管');
                }
              }
              if (
                currentConfig.autoRelaunchWithCdp === true &&
                relaunchedPidSig !== pidSig &&
                Date.now() - lastRelaunchAt >= 60000
              ) {
                relaunchedPidSig = pidSig;
                lastRelaunchAt = Date.now();
                log('[↻] autoRelaunchWithCdp 已启用：正在温和重启 Antigravity 并附加 --remote-debugging-port=0 ...');
                const res = await cdpApi.relaunchAntigravityWithCdp({ port: 0 });
                if (res.relaunched) {
                  log('[✓] 已以 CDP 模式重启 Antigravity，等待窗口就绪...');
                  noCdpRunningTicks = 0;
                  cdpFlagCache = { pidSig: '', hasFlag: false };
                } else {
                  log(`[!] 自动重启未完成 (${res.reason})，请手动完全退出 Antigravity 后以 --remote-debugging-port=0 启动`);
                }
              }
            }
          }
        } else {
          noCdpRunningTicks = 0;
          warnedNoCdpSig = '';
          cdpFlagCache = { pidSig: '', hasFlag: false };
          if (consecutivePortFailures >= 3 && !(startupGraceEnabled && !hadAttachedWindow)) {
            nextDelayMs = Math.max(5000, POLL_INTERVAL_MS);
          }
        }
      }
    } finally {
      busy = false;
      if (!shuttingDown) {
        tickTimer = setTimeout(tick, nextDelayMs);
      }
    }
  }

  watcher = fs.watch(__dirname, (_, filename) => {
    if (!filename || !/\.(css|js|json)$/i.test(filename) || filename.startsWith('.')) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      let refreshOnly = false;
      try {
        delete require.cache[require.resolve('./cdp')];
        cdpApi = require('./cdp');
        currentConfig = cdpApi.readConfig();
        const nextCodeHash = cdpApi.computeHash(cdpApi.readRuntimeBundle());
        const nextCssHash = cdpApi.computeHash(cdpApi.readCss());
        refreshOnly =
          Boolean(currentCodeHash) &&
          nextCodeHash === currentCodeHash &&
          nextCssHash === currentCssHash;
        currentCodeHash = nextCodeHash;
        currentCssHash = nextCssHash;
        if (!refreshOnly) {
          expr = cdpApi.buildInjectExpression(currentConfig);
        }
        configExpr = cdpApi.buildConfigScriptExpression(currentConfig, currentCodeHash);
      } catch (err) {
        log(`[!] 读取文件失败: ${err.message}`);
        return;
      }
      let n = 0;
      for (const entry of attached.values()) {
        if (!entry) continue;
        try {
          await apply(entry, { refreshOnly });
          n++;
        } catch {}
      }
      log(`[↻] ${filename} 已变更，已热更新 ${n} 个窗口${refreshOnly ? '（轻量配置同步）' : ''}`);
    }, 180);
  });

  if (WATCH) {
    process.on('uncaughtException', (err) => {
      log(`[!] 未捕获异常: ${err && err.stack ? err.stack : err}`);
    });
    process.on('unhandledRejection', (err) => {
      log(`[!] 未处理 Promise 拒绝: ${err && err.stack ? err.stack : err}`);
    });
  }

  await tick();
}

async function main() {
  if (LAUNCH && WATCH) {
    await launchWithCdp({ autoRelaunchFromConfig: true });
    await watch({
      forceExitOnHostClose: true,
      startupGraceEnabled: true,
      allowGracefulDuplicateExit: true,
    });
  } else if (LAUNCH) {
    await launchWithCdp({ autoRelaunchFromConfig: false });
  } else if (WATCH) {
    await watch({
      forceExitOnHostClose: false,
      startupGraceEnabled: EXIT_ON_HOST_CLOSE_FLAG,
      allowGracefulDuplicateExit: SKIP_IF_RUNNING,
    });
  } else {
    await injectOnce();
  }
}

module.exports = {
  acquireLock,
  applyPageScripts,
  updateConfigSetting: cdpApi.updateConfigSetting,
  injectOnce,
  launchWithCdp,
  watch,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`[✗] ${err.message}`);
    process.exit(1);
  });
}
