// Shared lifecycle, safe logging, and orphan-prevention helpers for Claude Studio (agy-claude-studio).
// Zero external dependencies (Node >= 22).
const fs = require('fs');
const { createHash } = require('node:crypto');
const os = require('os');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');

const BROKEN_PIPE_CODES = new Set([
  'EPIPE',
  'EOF',
  'EBADF',
  'ERR_STREAM_DESTROYED',
  'ERR_IPC_CHANNEL_CLOSED',
]);

function isBrokenPipeError(err) {
  if (!err) return false;
  if (err.code && BROKEN_PIPE_CODES.has(err.code)) return true;
  const msg = String(err.message || err || '').toLowerCase();
  return (
    msg.includes('epipe') ||
    msg.includes('stream was destroyed') ||
    msg.includes('write after end') ||
    msg.includes('write eof')
  );
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

const DEFAULT_WATCHER_EXE_NAMES = new Set([
  'node',
  'node.exe',
  'electron',
  'electron.exe',
  'antigravity',
  'antigravity.exe',
  'agy-claude-studio-watcher',
  'agy-claude-studio-watcher.exe',
  'agy-claude-style-watcher',
  'agy-claude-style-watcher.exe',
]);

function inspectProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { alive: false, reason: 'invalid-pid' };
  }
  if (pid === process.pid) {
    return {
      alive: true,
      exeName: path.basename(process.execPath || ''),
      commandLine: Array.isArray(process.argv) ? process.argv.join(' ') : '',
    };
  }
  let eperm = false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err && err.code === 'EPERM') {
      eperm = true;
    } else {
      return { alive: false, reason: err && err.code ? err.code : 'esrch' };
    }
  }
  if (process.platform === 'win32') {
    if (eperm) {
      return { alive: true, eperm: true };
    }
    try {
      const out = execFileSync(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        {
          encoding: 'utf8',
          timeout: 1500,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      for (const rawLine of String(out || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('"')) continue;
        const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
        if (cols.length >= 2 && parseInt(cols[1], 10) === pid) {
          return { alive: true, exeName: cols[0] || '' };
        }
      }
      return { alive: false, reason: 'tasklist-not-found' };
    } catch {
      return { alive: true, unknown: true };
    }
  }
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const cmdLine = String(out || '').trim();
    if (!cmdLine) {
      return { alive: false, reason: 'ps-empty' };
    }
    const firstToken = cmdLine.split(/\s+/)[0] || '';
    return {
      alive: true,
      exeName: path.basename(firstToken),
      commandLine: cmdLine,
    };
  } catch {
    return { alive: true, unknown: true };
  }
}

function isWatcherProcessAlive(
  pid,
  meta = null,
  { inspectProcess = inspectProcessIdentity, platform = process.platform } = {}
) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  const info = inspectProcess(pid);
  if (!info || !info.alive) return false;
  if (platform === 'win32' && info.eperm) {
    return false;
  }
  if (info.exeName) {
    const allowed = new Set(DEFAULT_WATCHER_EXE_NAMES);
    if (meta && typeof meta.exeName === 'string' && meta.exeName.trim()) {
      allowed.add(meta.exeName.trim().toLowerCase());
    }
    if (!allowed.has(String(info.exeName).trim().toLowerCase())) {
      return false;
    }
  }
  if (info.commandLine && meta && typeof meta.scriptHint === 'string' && meta.scriptHint.trim()) {
    if (!String(info.commandLine).toLowerCase().includes(meta.scriptHint.trim().toLowerCase())) {
      return false;
    }
  }
  return true;
}

function createSafeLogger({ logFile = null, enableConsole = true, maxLogBytes = 1024 * 1024, onBrokenPipe } = {}) {
  let stdioBroken = false;
  let brokenNotified = false;
  let inErrorHandler = false;

  const notifyBroken = (err) => {
    stdioBroken = true;
    if (!brokenNotified) {
      brokenNotified = true;
      if (typeof onBrokenPipe === 'function') {
        try {
          onBrokenPipe(err);
        } catch {}
      }
    }
  };

  const attachStreamErrorGuard = (stream) => {
    if (!stream || typeof stream.on !== 'function') return () => {};
    const onErr = (err) => {
      if (isBrokenPipeError(err)) {
        notifyBroken(err);
      }
    };
    stream.on('error', onErr);
    return () => {
      try {
        stream.off('error', onErr);
      } catch {}
    };
  };

  const detachStdout = attachStreamErrorGuard(process.stdout);
  const detachStderr = attachStreamErrorGuard(process.stderr);

  const writeToLogFile = (line) => {
    if (!logFile) return;
    try {
      try {
        const st = fs.statSync(logFile);
        if (st.size > maxLogBytes) {
          fs.writeFileSync(logFile, '', 'utf8');
        }
      } catch {}
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
    } catch {}
  };

  const log = (...args) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (enableConsole && !stdioBroken) {
      try {
        const out = process.stdout;
        if (!out || out.destroyed || out.writableEnded || out.writable === false) {
          notifyBroken(new Error('stdout destroyed'));
        } else {
          console.log(line);
        }
      } catch (err) {
        if (isBrokenPipeError(err)) {
          notifyBroken(err);
        }
      }
    }
    writeToLogFile(line);
  };

  const resetLogFile = () => {
    if (!logFile) return;
    try {
      fs.writeFileSync(logFile, '', 'utf8');
    } catch {}
  };

  const installProcessErrorGuards = ({ onFatalPipe } = {}) => {
    const handleAsyncError = (kind, err) => {
      if (isBrokenPipeError(err)) {
        notifyBroken(err);
        if (typeof onFatalPipe === 'function') {
          try {
            onFatalPipe(err);
          } catch {}
        }
        return;
      }
      if (inErrorHandler) return;
      inErrorHandler = true;
      try {
        const detail = err && err.stack ? err.stack : String(err);
        writeToLogFile(`[!] ${kind}: ${detail}`);
      } finally {
        inErrorHandler = false;
      }
    };

    const onUncaught = (err) => handleAsyncError('未捕获异常', err);
    const onUnhandled = (err) => handleAsyncError('未处理 Promise 拒绝', err);
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUnhandled);
    return () => {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUnhandled);
    };
  };

  const dispose = () => {
    detachStdout();
    detachStderr();
  };

  return {
    log,
    resetLogFile,
    installProcessErrorGuards,
    isStdioBroken: () => stdioBroken,
    dispose,
  };
}

function createIdleHostTracker({ maxIdleFailures = 3, keepAlive = false } = {}) {
  const threshold = Math.max(1, Number(maxIdleFailures) || 3);
  let hadAttachedWindow = false;
  let consecutiveFailures = 0;

  return {
    markAttached() {
      hadAttachedWindow = true;
      consecutiveFailures = 0;
    },
    recordTick({ reachable, pageCount = 0, attachedCount = 0 }) {
      if (reachable && (pageCount > 0 || attachedCount > 0)) {
        consecutiveFailures = 0;
        if (attachedCount > 0) hadAttachedWindow = true;
        return;
      }
      if (hadAttachedWindow && attachedCount === 0) {
        consecutiveFailures += 1;
      }
    },
    shouldExit() {
      return !keepAlive && hadAttachedWindow && consecutiveFailures >= threshold;
    },
    shouldBackoff() {
      return Boolean(keepAlive) && hadAttachedWindow && consecutiveFailures >= threshold;
    },
    getState() {
      return { hadAttachedWindow, consecutiveFailures, threshold, keepAlive: Boolean(keepAlive) };
    },
  };
}

function normalizeLsHealthzUrl(lsAddress) {
  const raw = String(lsAddress || '').trim();
  if (!raw || raw === 'test.invalid') return null;
  const base = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, '') : `http://${raw.replace(/\/+$/, '')}`;
  return `${base}/healthz`;
}

function startHostWatchdog({
  lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS,
  parentPid = 0,
  watchStdin = false,
  checkIntervalMs = 3500,
  maxLsFailures = 2,
  onShutdown,
} = {}) {
  const healthzUrl = normalizeLsHealthzUrl(lsAddress);
  const ppid = Number.isInteger(parentPid) && parentPid > 0 ? parentPid : 0;
  let stopped = false;
  let triggered = false;
  let lsFailures = 0;
  let polling = false;
  let intervalTimer = null;

  const cleanups = [];

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        fn();
      } catch {}
    }
  };

  const trigger = (reason) => {
    if (stopped || triggered) return;
    triggered = true;
    stop();
    if (typeof onShutdown === 'function') {
      Promise.resolve().then(() => onShutdown(reason)).catch(() => {});
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    const handler = () => trigger(`signal:${sig}`);
    try {
      process.on(sig, handler);
      cleanups.push(() => process.off(sig, handler));
    } catch {}
  }

  if (watchStdin && process.stdin) {
    const onEnd = () => trigger('stdin-end');
    const onClose = () => trigger('stdin-close');
    const onErr = (err) => {
      if (isBrokenPipeError(err)) trigger('stdin-error');
    };
    process.stdin.on('end', onEnd);
    process.stdin.on('close', onClose);
    process.stdin.on('error', onErr);
    cleanups.push(() => {
      try {
        process.stdin.off('end', onEnd);
        process.stdin.off('close', onClose);
        process.stdin.off('error', onErr);
      } catch {}
    });
  }

  const checkHost = async () => {
    if (stopped || triggered) return;
    if (ppid > 0 && !isPidAlive(ppid)) {
      trigger('parent-dead');
      return;
    }
    if (!healthzUrl || polling) return;
    polling = true;
    try {
      await fetch(healthzUrl, { signal: AbortSignal.timeout(1500) });
      lsFailures = 0;
    } catch {
      lsFailures += 1;
      if (lsFailures >= Math.max(1, maxLsFailures)) {
        trigger('ls-dead');
      }
    } finally {
      polling = false;
    }
  };

  if (ppid > 0 || healthzUrl) {
    intervalTimer = setInterval(() => {
      void checkHost();
    }, Math.max(100, checkIntervalMs));
    if (typeof intervalTimer.unref === 'function') {
      intervalTimer.unref();
    }
  }

  return {
    stop,
    isTriggered: () => triggered,
    checkNow: checkHost,
  };
}

function readWatcherLockInfo(pidFile, lockFile, opts = {}) {
  let pidFilePid = null;
  if (pidFile) {
    try {
      const raw = fs.readFileSync(pidFile, 'utf8').trim();
      const parsed = parseInt(raw, 10);
      if (Number.isInteger(parsed) && parsed > 0) pidFilePid = parsed;
    } catch {}
  }

  let lockData = null;
  let lockPid = null;
  if (lockFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        lockData = parsed;
        const candidate = parseInt(parsed.pid, 10);
        if (Number.isInteger(candidate) && candidate > 0) lockPid = candidate;
      }
    } catch {}
  }

  const defaultDir = pidFile ? path.dirname(pidFile) : lockFile ? path.dirname(lockFile) : null;
  const buildFromLock = (source, alive) => ({
    pid: lockPid,
    alive,
    mode: typeof lockData.mode === 'string' && lockData.mode ? lockData.mode : null,
    startedAt: typeof lockData.startedAt === 'string' && lockData.startedAt ? lockData.startedAt : null,
    dir: typeof lockData.dir === 'string' && lockData.dir ? lockData.dir : defaultDir,
    exeName: typeof lockData.exeName === 'string' && lockData.exeName ? lockData.exeName : null,
    scriptHint: typeof lockData.scriptHint === 'string' && lockData.scriptHint ? lockData.scriptHint : null,
    source,
  });
  const buildFromPid = (source, alive) => {
    const matchesLock = lockData && lockPid === pidFilePid;
    return {
      pid: pidFilePid,
      alive,
      mode: matchesLock && typeof lockData.mode === 'string' && lockData.mode ? lockData.mode : null,
      startedAt:
        matchesLock && typeof lockData.startedAt === 'string' && lockData.startedAt
          ? lockData.startedAt
          : null,
      dir:
        matchesLock && typeof lockData.dir === 'string' && lockData.dir ? lockData.dir : defaultDir,
      exeName:
        matchesLock && typeof lockData.exeName === 'string' && lockData.exeName
          ? lockData.exeName
          : null,
      scriptHint:
        matchesLock && typeof lockData.scriptHint === 'string' && lockData.scriptHint
          ? lockData.scriptHint
          : null,
      source,
    };
  };

  if (lockPid && isWatcherProcessAlive(lockPid, lockData, opts)) {
    return buildFromLock('lock', true);
  }
  if (pidFilePid && isWatcherProcessAlive(pidFilePid, lockPid === pidFilePid ? lockData : null, opts)) {
    return buildFromPid('pid', true);
  }
  if (lockPid) {
    return buildFromLock('lock-stale', false);
  }
  if (pidFilePid) {
    return buildFromPid('pid-stale', false);
  }
  return null;
}

function readWatcherPid(pidFile, lockFile, opts = {}) {
  const info = readWatcherLockInfo(pidFile, lockFile, opts);
  return info && info.alive ? info.pid : null;
}

async function waitForPidExit(pid, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return !isPidAlive(pid);
}

async function acquireWatcherLock({
  pidFile,
  lockFile,
  mode = 'watch',
  replaceExisting = false,
  preserveModes = [],
  inspectProcess,
  platform,
} = {}) {
  const preserveSet = new Set(Array.isArray(preserveModes) ? preserveModes.filter(Boolean) : []);
  const inspectOpts = {};
  if (typeof inspectProcess === 'function') inspectOpts.inspectProcess = inspectProcess;
  if (platform) inspectOpts.platform = platform;
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  if (lockFile) {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  }

  let acquired = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = readWatcherLockInfo(pidFile, lockFile, inspectOpts);
    if (existing && existing.alive && existing.pid !== process.pid) {
      const preserved = Boolean(existing.mode && preserveSet.has(existing.mode));
      if (!replaceExisting || preserved) {
        return {
          acquired: false,
          existingPid: existing.pid,
          existingMode: existing.mode || null,
          preserved,
        };
      }
      try {
        process.kill(existing.pid);
      } catch {}
      await waitForPidExit(existing.pid, 1200);
      if (isWatcherProcessAlive(existing.pid, existing, inspectOpts)) {
        return {
          acquired: false,
          existingPid: existing.pid,
          existingMode: existing.mode || null,
          preserved: false,
        };
      }
    }

    try {
      const rawPid = fs.readFileSync(pidFile, 'utf8').trim();
      const recordedPid = parseInt(rawPid, 10);
      if (
        !Number.isInteger(recordedPid) ||
        recordedPid <= 0 ||
        recordedPid === process.pid ||
        !isWatcherProcessAlive(recordedPid, null, inspectOpts)
      ) {
        try {
          fs.unlinkSync(pidFile);
        } catch {}
      }
    } catch {}

    if (lockFile) {
      try {
        const meta = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        const metaPid = parseInt(meta && meta.pid, 10);
        if (
          !Number.isInteger(metaPid) ||
          metaPid <= 0 ||
          metaPid === process.pid ||
          !isWatcherProcessAlive(metaPid, meta, inspectOpts)
        ) {
          try {
            fs.unlinkSync(lockFile);
          } catch {}
        }
      } catch (err) {
        if (!err || err.code !== 'ENOENT') {
          try {
            fs.unlinkSync(lockFile);
          } catch {}
        }
      }
    }

    const lockPayload =
      JSON.stringify(
        {
          pid: process.pid,
          mode,
          dir: path.dirname(pidFile),
          exeName: path.basename(process.execPath || ''),
          scriptHint: path.basename((Array.isArray(process.argv) && process.argv[1]) || ''),
          startedAt: new Date().toISOString(),
        },
        null,
        2
      ) + '\n';

    try {
      if (lockFile) {
        fs.writeFileSync(lockFile, lockPayload, { encoding: 'utf8', flag: 'wx' });
        try {
          fs.writeFileSync(pidFile, String(process.pid), 'utf8');
        } catch {}
      } else {
        fs.writeFileSync(pidFile, String(process.pid), { encoding: 'utf8', flag: 'wx' });
      }
      acquired = true;
      break;
    } catch (err) {
      if (err && (err.code === 'EEXIST' || err.code === 'EPERM' || err.code === 'EBUSY')) {
        await new Promise((r) => setTimeout(r, 35));
        continue;
      }
      throw err;
    }
  }

  if (!acquired) {
    const existing = readWatcherLockInfo(pidFile, lockFile, inspectOpts);
    return {
      acquired: false,
      existingPid: existing && existing.pid ? existing.pid : null,
      existingMode: existing && existing.mode ? existing.mode : null,
      preserved: Boolean(existing && existing.mode && preserveSet.has(existing.mode)),
    };
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const curPid = fs.readFileSync(pidFile, 'utf8').trim();
      if (curPid === String(process.pid)) {
        fs.unlinkSync(pidFile);
      }
    } catch {}
    if (lockFile) {
      try {
        const meta = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (meta && Number(meta.pid) === process.pid) {
          fs.unlinkSync(lockFile);
        }
      } catch {}
    }
  };

  process.on('exit', release);
  return {
    acquired: true,
    pid: process.pid,
    mode,
    release: () => {
      process.off('exit', release);
      release();
    },
  };
}

function getMcpHostsDir(stateDir) {
  return path.join(path.resolve(stateDir), '.mcp-hosts');
}

function registerMcpHost({
  stateDir,
  pid = process.pid,
  lsAddress = '',
  startedAt = new Date().toISOString(),
} = {}) {
  const hostsDir = getMcpHostsDir(stateDir);
  fs.mkdirSync(hostsDir, { recursive: true });
  const filePath = path.join(hostsDir, `${pid}.json`);
  const payload =
    JSON.stringify(
      {
        pid,
        lsAddress: String(lsAddress || ''),
        exeName: path.basename(process.execPath || ''),
        scriptHint: path.basename((Array.isArray(process.argv) && process.argv[1]) || ''),
        startedAt,
      },
      null,
      2
    ) + '\n';
  fs.writeFileSync(filePath, payload, 'utf8');

  let removed = false;
  const unregister = () => {
    if (removed) return;
    removed = true;
    process.off('exit', unregister);
    try {
      fs.unlinkSync(filePath);
    } catch {}
  };

  process.on('exit', unregister);
  return {
    filePath,
    hostsDir,
    pid,
    unregister,
  };
}

function listAliveMcpHosts({
  stateDir,
  excludePid = 0,
  pruneStale = true,
  inspectProcess,
  platform,
} = {}) {
  const hostsDir = getMcpHostsDir(stateDir);
  let entries = [];
  try {
    entries = fs.readdirSync(hostsDir);
  } catch {
    return [];
  }

  const inspectOpts = {};
  if (typeof inspectProcess === 'function') inspectOpts.inspectProcess = inspectProcess;
  if (platform) inspectOpts.platform = platform;

  const alive = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const fullPath = path.join(hostsDir, name);
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch {}

    let pid = parsed && typeof parsed === 'object' ? parseInt(parsed.pid, 10) : NaN;
    if (!Number.isInteger(pid) || pid <= 0) {
      const stem = name.slice(0, -5);
      if (/^\d+$/.test(stem)) {
        pid = parseInt(stem, 10);
      }
    }

    if (!Number.isInteger(pid) || pid <= 0 || !isWatcherProcessAlive(pid, parsed, inspectOpts)) {
      if (pruneStale) {
        try {
          fs.unlinkSync(fullPath);
        } catch {}
      }
      continue;
    }

    if (excludePid && pid === excludePid) {
      continue;
    }

    alive.push({
      pid,
      lsAddress: parsed && typeof parsed.lsAddress === 'string' ? parsed.lsAddress : '',
      startedAt: parsed && typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      filePath: fullPath,
    });
  }
  return alive;
}

function readAntigravityPluginEnabledState({
  pluginName = 'agy-claude-studio',
  pluginRoot = '',
  homeDir = os.homedir(),
  configPath = '',
} = {}) {
  const targetPath = configPath
    ? path.resolve(configPath)
    : path.join(homeDir, '.gemini', 'config', 'config.json');
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return 'unknown';
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.plugins || typeof parsed.plugins !== 'object') {
    return 'unknown';
  }

  const candidates = [];
  const rootKey = pluginRoot ? path.basename(path.resolve(pluginRoot)) : '';
  if (rootKey) candidates.push(rootKey);
  if (pluginName && !candidates.includes(pluginName)) candidates.push(pluginName);

  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(parsed.plugins, key)) continue;
    const entry = parsed.plugins[key];
    if (entry && typeof entry === 'object' && typeof entry.enabled === 'boolean') {
      return entry.enabled === false ? 'disabled' : 'enabled';
    }
  }
  return 'unknown';
}

function stripJsonc(rawText) {
  let out = '';
  let i = 0;
  const text = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      out += text.slice(start, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  // Remove trailing commas before } or ] outside strings
  return out.replace(/,\s*([}\]])/g, '$1');
}

function ensureIdeRemoteDebuggingArgv(env = process.env, homeDir = os.homedir()) {
  const portableRoot = String(env.VSCODE_PORTABLE || '').trim();
  const ideDir = portableRoot || path.join(homeDir, '.antigravity-ide');
  if (!fs.existsSync(ideDir)) {
    return { changed: false, skipped: 'ide-dir-missing' };
  }
  const argvPath = path.join(ideDir, 'argv.json');
  if (!fs.existsSync(argvPath)) {
    const fresh =
      '{\n\t// Automatically configured by agy-claude-studio for Antigravity IDE CDP support.\n\t"remote-debugging-port": "0"\n}\n';
    try {
      fs.writeFileSync(argvPath, fresh, 'utf8');
      return { changed: true, created: true, path: argvPath };
    } catch (err) {
      return { changed: false, error: err.message };
    }
  }

  let raw;
  try {
    raw = fs.readFileSync(argvPath, 'utf8');
  } catch (err) {
    return { changed: false, error: err.message };
  }
  if (!raw.trim()) {
    const fresh =
      '{\n\t// Automatically configured by agy-claude-studio for Antigravity IDE CDP support.\n\t"remote-debugging-port": "0"\n}\n';
    fs.writeFileSync(argvPath, fresh, 'utf8');
    return { changed: true, created: true, path: argvPath };
  }

  const cleaned = stripJsonc(raw);
  if (!cleaned) {
    return { changed: false, skipped: 'invalid-jsonc' };
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { changed: false, skipped: 'invalid-jsonc' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { changed: false, skipped: 'not-object' };
  }
  if (
    typeof parsed['remote-debugging-port'] === 'string' &&
    parsed['remote-debugging-port'].trim().length > 0
  ) {
    return { changed: false, alreadyConfigured: true, path: argvPath };
  }

  // If present as non-string or empty string, replace in-place cleanly or insert before closing brace
  let nextText;
  const keyPropRe = /("remote-debugging-port"\s*:\s*)(?:"[^"]*"|-?\d+(?:\.\d+)?|true|false|null)/;
  if (Object.prototype.hasOwnProperty.call(parsed, 'remote-debugging-port') && keyPropRe.test(raw)) {
    nextText = raw.replace(keyPropRe, '$1"0"');
  } else {
    const lastBrace = raw.lastIndexOf('}');
    if (lastBrace < 0) return { changed: false, skipped: 'missing-brace' };
    const before = raw.slice(0, lastBrace).replace(/\s+$/, '');
    const needsComma = !before.endsWith('{') && !before.endsWith(',');
    const sep = needsComma ? ',\n\t' : '\n\t';
    nextText = `${before}${sep}"remote-debugging-port": "0"\n${raw.slice(lastBrace)}`;
  }

  try {
    fs.writeFileSync(argvPath, nextText, 'utf8');
    return { changed: true, path: argvPath };
  } catch (err) {
    return { changed: false, error: err.message };
  }
}

const REMOTE_DEBUG_LAUNCH_FLAG = '--remote-debugging-port=0';
const REMOTE_DEBUG_ANY_RE = /(?:^|\s)--remote-debugging-port(?:=|\s|$)/i;
const REMOTE_DEBUG_MANAGED_ZERO_RE = /(?:^|\s+)--remote-debugging-port=(?:"0"|'0'|0)(?=\s|$)/gi;

function ensureRemoteDebugFlagInArgs(rawArgs, { enabled = true } = {}) {
  const current = String(rawArgs ?? '').trim();
  if (enabled) {
    if (REMOTE_DEBUG_ANY_RE.test(current)) {
      return {
        changed: false,
        configured: true,
        alreadyConfigured: true,
        args: current,
      };
    }
    const nextArgs = current
      ? `${current} ${REMOTE_DEBUG_LAUNCH_FLAG}`
      : REMOTE_DEBUG_LAUNCH_FLAG;
    return {
      changed: true,
      configured: true,
      args: nextArgs,
    };
  }

  REMOTE_DEBUG_MANAGED_ZERO_RE.lastIndex = 0;
  if (!REMOTE_DEBUG_MANAGED_ZERO_RE.test(current)) {
    REMOTE_DEBUG_MANAGED_ZERO_RE.lastIndex = 0;
    return {
      changed: false,
      configured: REMOTE_DEBUG_ANY_RE.test(current),
      removed: false,
      args: current,
    };
  }
  REMOTE_DEBUG_MANAGED_ZERO_RE.lastIndex = 0;
  const stripped = current
    .replace(REMOTE_DEBUG_MANAGED_ZERO_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    changed: stripped !== current,
    configured: REMOTE_DEBUG_ANY_RE.test(stripped),
    removed: stripped !== current,
    args: stripped,
  };
}

function patchWindowsRunRegistryCommand(rawValue, { enabled = true } = {}) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) {
    return { matched: false, changed: false, configured: false, value: raw };
  }
  const m = raw.match(/^\s*(?:"([^"]+)"|([^\s"]+))([\s\S]*)$/);
  if (!m) {
    return { matched: false, changed: false, configured: false, value: raw };
  }
  const exePath = String(m[1] || m[2] || '').trim();
  const exeLeaf = exePath.split(/[\\/]/).pop() || '';
  if (exeLeaf.toLowerCase() !== 'antigravity.exe') {
    return { matched: false, changed: false, configured: false, value: raw };
  }
  const quotedExe = m[1] ? `"${exePath}"` : /\s/.test(exePath) ? `"${exePath}"` : exePath;
  const patchedArgs = ensureRemoteDebugFlagInArgs(m[3] || '', { enabled });
  const nextValue = patchedArgs.args ? `${quotedExe} ${patchedArgs.args}` : quotedExe;
  return {
    matched: true,
    changed: nextValue !== raw,
    configured: patchedArgs.configured,
    value: nextValue,
  };
}

function patchLinuxDesktopEntryText(rawText, { enabled = true } = {}) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { matched: false, changed: false, configured: false, text: String(rawText || '') };
  }
  const eol = rawText.includes('\r\n') ? '\r\n' : '\n';
  const lines = rawText.split(/\r?\n/);
  let matched = false;
  let changed = false;
  let configured = false;

  const nextLines = lines.map((line) => {
    const execMatch = line.match(/^(\s*Exec\s*=\s*)(.+)$/);
    if (!execMatch) return line;
    const prefix = execMatch[1];
    const cmdBody = execMatch[2].trim();
    const binMatch = cmdBody.match(/^(?:"([^"]+)"|'([^']+)'|([^\s"']+))([\s\S]*)$/);
    if (!binMatch) return line;
    const rawBin = String(binMatch[1] || binMatch[2] || binMatch[3] || '');
    const leaf = (rawBin.split('/').pop() || '').toLowerCase();
    if (leaf !== 'antigravity') {
      return line;
    }
    matched = true;
    const binToken = binMatch[1]
      ? `"${binMatch[1]}"`
      : binMatch[2]
        ? `'${binMatch[2]}'`
        : binMatch[3];
    const rest = String(binMatch[4] || '').trim();

    if (enabled) {
      if (REMOTE_DEBUG_ANY_RE.test(rest)) {
        configured = true;
        return line;
      }
      configured = true;
      changed = true;
      const fieldCodeMatch = rest.match(/^(.*?)\s*(%[fFuUdDnNickvm](?:\s+%[fFuUdDnNickvm])*)\s*$/);
      if (fieldCodeMatch) {
        const beforeCodes = fieldCodeMatch[1].trim();
        const codes = fieldCodeMatch[2].trim();
        const mid = beforeCodes
          ? `${beforeCodes} ${REMOTE_DEBUG_LAUNCH_FLAG}`
          : REMOTE_DEBUG_LAUNCH_FLAG;
        return `${prefix}${binToken} ${mid} ${codes}`;
      }
      return rest
        ? `${prefix}${binToken} ${rest} ${REMOTE_DEBUG_LAUNCH_FLAG}`
        : `${prefix}${binToken} ${REMOTE_DEBUG_LAUNCH_FLAG}`;
    }

    const stripped = ensureRemoteDebugFlagInArgs(rest, { enabled: false });
    configured = configured || stripped.configured;
    if (!stripped.changed) return line;
    changed = true;
    return stripped.args ? `${prefix}${binToken} ${stripped.args}` : `${prefix}${binToken}`;
  });

  return {
    matched,
    changed,
    configured,
    text: changed ? nextLines.join(eol) : rawText,
  };
}

const WIN_SHORTCUT_PROVISION_PS = `
$ErrorActionPreference = 'Stop'
$enableFlag = $env:AGY_CS_LAUNCH_ENABLED -eq '1'
$updated = New-Object System.Collections.Generic.List[string]
$configured = New-Object System.Collections.Generic.List[string]
$ws = New-Object -ComObject WScript.Shell
$userProgramsDir = [Environment]::GetFolderPath('Programs')

$scanSpecs = @(
  @{ Dir = [Environment]::GetFolderPath('Desktop'); Recurse = $false; IsCommon = $false },
  @{ Dir = $userProgramsDir; Recurse = $true; IsCommon = $false },
  @{ Dir = [Environment]::GetFolderPath('StartMenu'); Recurse = $false; IsCommon = $false },
  @{ Dir = [Environment]::GetFolderPath('Startup'); Recurse = $false; IsCommon = $false },
  @{ Dir = (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'); Recurse = $false; IsCommon = $false },
  @{ Dir = [Environment]::GetFolderPath('CommonDesktopDirectory'); Recurse = $false; IsCommon = $true },
  @{ Dir = [Environment]::GetFolderPath('CommonPrograms'); Recurse = $true; IsCommon = $true }
)

$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($spec in $scanSpecs) {
  $dir = [string]$spec.Dir
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
  $items = @()
  try {
    if ($spec.Recurse) {
      $items = @(Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -File -Recurse -Depth 2 -ErrorAction SilentlyContinue)
    } else {
      $items = @(Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -File -ErrorAction SilentlyContinue)
    }
  } catch { continue }

  foreach ($item in $items) {
    $lnkPath = [string]$item.FullName
    if (-not $seen.Add($lnkPath)) { continue }
    try {
      $sc = $ws.CreateShortcut($lnkPath)
      $target = [string]$sc.TargetPath
      if ([System.IO.Path]::GetFileName($target) -ine 'Antigravity.exe') { continue }
      $curArgs = [string]$sc.Arguments
      if ($enableFlag) {
        if ($curArgs -match '(?:^|\\s)--remote-debugging-port(?:=|\\s|$)') {
          $configured.Add($lnkPath)
          continue
        }
        $nextArgs = ($curArgs.Trim() + ' --remote-debugging-port=0').Trim()
        try {
          $sc.Arguments = $nextArgs
          $sc.Save()
          $updated.Add($lnkPath)
          $configured.Add($lnkPath)
        } catch {
          if ($spec.IsCommon -and $userProgramsDir -and (Test-Path -LiteralPath $userProgramsDir)) {
            $fallbackLnk = Join-Path $userProgramsDir ([System.IO.Path]::GetFileName($lnkPath))
            if (-not (Test-Path -LiteralPath $fallbackLnk)) {
              try {
                $uSc = $ws.CreateShortcut($fallbackLnk)
                $uSc.TargetPath = $target
                $uSc.Arguments = $nextArgs
                if ($sc.WorkingDirectory) { $uSc.WorkingDirectory = $sc.WorkingDirectory }
                if ($sc.IconLocation) { $uSc.IconLocation = $sc.IconLocation }
                if ($sc.Description) { $uSc.Description = $sc.Description }
                $uSc.Save()
                $updated.Add($fallbackLnk)
                $configured.Add($fallbackLnk)
              } catch {}
            }
          }
        }
      } else {
        $stripped = ([regex]::Replace($curArgs, '(?:^|\\s+)--remote-debugging-port=(?:"0"|''0''|0)(?=\\s|$)', ' ')).Trim()
        if ($stripped -ne $curArgs.Trim()) {
          try {
            $sc.Arguments = $stripped
            $sc.Save()
            $updated.Add($lnkPath)
          } catch {}
        }
        if ($stripped -match '(?:^|\\s)--remote-debugging-port(?:=|\\s|$)') {
          $configured.Add($lnkPath)
        }
      }
    } catch {}
  }
}

$runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
if (Test-Path -LiteralPath $runKey) {
  try {
    $regItem = Get-Item -LiteralPath $runKey -ErrorAction SilentlyContinue
    if ($regItem) {
      foreach ($valName in $regItem.GetValueNames()) {
        $rawCmd = [string]$regItem.GetValue($valName, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if (-not $rawCmd) { continue }
        if ($rawCmd -notmatch '^\\s*(?:"([^"]+)"|([^\\s"]+))(.*)$') { continue }
        $exeCandidate = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
        $restPart = [string]$Matches[3]
        if ([System.IO.Path]::GetFileName($exeCandidate) -ine 'Antigravity.exe') { continue }
        $quotedExe = if ($Matches[1] -or $exeCandidate -match '\\s') { '"' + $exeCandidate + '"' } else { $exeCandidate }
        if ($enableFlag) {
          if ($restPart -match '(?:^|\\s)--remote-debugging-port(?:=|\\s|$)') {
            $configured.Add("HKCU:Run:$valName")
            continue
          }
          $nextRest = ($restPart.Trim() + ' --remote-debugging-port=0').Trim()
          $nextVal = "$quotedExe $nextRest"
          Set-ItemProperty -LiteralPath $runKey -Name $valName -Value $nextVal -ErrorAction SilentlyContinue
          $updated.Add("HKCU:Run:$valName")
          $configured.Add("HKCU:Run:$valName")
        } else {
          $strippedRest = ([regex]::Replace($restPart, '(?:^|\\s+)--remote-debugging-port=(?:"0"|''0''|0)(?=\\s|$)', ' ')).Trim()
          $nextVal = if ($strippedRest) { "$quotedExe $strippedRest" } else { $quotedExe }
          if ($nextVal -ne $rawCmd.Trim()) {
            Set-ItemProperty -LiteralPath $runKey -Name $valName -Value $nextVal -ErrorAction SilentlyContinue
            $updated.Add("HKCU:Run:$valName")
          }
          if ($strippedRest -match '(?:^|\\s)--remote-debugging-port(?:=|\\s|$)') {
            $configured.Add("HKCU:Run:$valName")
          }
        }
      }
    }
  } catch {}
}

[pscustomobject]@{
  ok = $true
  updatedPaths = @($updated)
  configuredPaths = @($configured)
} | ConvertTo-Json -Compress
`.trim();

function toStringList(val) {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string' && val.trim()) return [val.trim()];
  return [];
}

async function ensureDesktopRemoteDebuggingLaunchers({
  enabled = true,
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  execFileFn = null,
  fsOps = null,
  allowInTest = false,
} = {}) {
  if (
    !allowInTest &&
    (String(env?.AGY_CLAUDE_STUDIO_SKIP_LAUNCHER_PROVISION || env?.AGY_CLAUDE_STYLE_SKIP_LAUNCHER_PROVISION || '') === '1' ||
      String(env?.ANTIGRAVITY_LS_ADDRESS || '').trim() === 'test.invalid')
  ) {
    return {
      checked: false,
      updated: false,
      alreadyConfigured: false,
      configured: false,
      updatedPaths: [],
      configuredPaths: [],
      reason: 'skipped',
    };
  }

  const ops = {
    existsFn: fsOps?.existsFn || fs.existsSync,
    readFn: fsOps?.readFn || fs.readFileSync,
    writeFn: fsOps?.writeFn || fs.writeFileSync,
    mkdirFn: fsOps?.mkdirFn || fs.mkdirSync,
  };

  if (platform === 'win32') {
    try {
      const runner =
        execFileFn ||
        ((file, args, opts) =>
          new Promise((resolve, reject) => {
            execFile(file, args, opts, (err, stdout) => {
              if (err) {
                reject(err);
                return;
              }
              resolve(String(stdout || ''));
            });
          }));
      const out = await runner(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SHORTCUT_PROVISION_PS],
        {
          windowsHide: true,
          timeout: 9000,
          maxBuffer: 1024 * 1024,
          env: {
            ...env,
            AGY_CS_LAUNCH_ENABLED: enabled ? '1' : '0',
          },
        }
      );
      const trimmed = String(out || '').trim();
      const jsonLine =
        trimmed
          .split(/\r?\n/)
          .reverse()
          .find((l) => l.trim().startsWith('{')) || '';
      const parsed = jsonLine ? JSON.parse(jsonLine) : null;
      const updatedPaths = toStringList(parsed?.updatedPaths);
      const configuredPaths = toStringList(parsed?.configuredPaths);
      return {
        checked: true,
        updated: updatedPaths.length > 0,
        alreadyConfigured: updatedPaths.length === 0 && configuredPaths.length > 0,
        configured: configuredPaths.length > 0,
        updatedPaths,
        configuredPaths,
      };
    } catch (err) {
      return {
        checked: true,
        updated: false,
        alreadyConfigured: false,
        configured: false,
        updatedPaths: [],
        configuredPaths: [],
        reason: 'win_shortcut_error',
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  if (platform === 'linux') {
    const dataHome = env?.XDG_DATA_HOME || path.join(homeDir, '.local', 'share');
    const configHome = env?.XDG_CONFIG_HOME || path.join(homeDir, '.config');
    const userDesktopFile = path.join(dataHome, 'applications', 'antigravity.desktop');
    const systemDesktopFiles = [
      '/usr/share/applications/antigravity.desktop',
      '/usr/local/share/applications/antigravity.desktop',
    ];
    const autostartDesktopFile = path.join(configHome, 'autostart', 'antigravity.desktop');

    const updatedPaths = [];
    const configuredPaths = [];

    try {
      const existedUser = Boolean(ops.existsFn(userDesktopFile));
      let baseUserText = '';
      if (existedUser) {
        baseUserText = String(ops.readFn(userDesktopFile, 'utf8') || '');
      } else if (enabled) {
        for (const sysFile of systemDesktopFiles) {
          if (ops.existsFn(sysFile)) {
            baseUserText = String(ops.readFn(sysFile, 'utf8') || '');
            if (baseUserText) break;
          }
        }
      }

      if (baseUserText) {
        const patchedUser = patchLinuxDesktopEntryText(baseUserText, { enabled });
        if (patchedUser.matched) {
          if (patchedUser.changed || (enabled && !existedUser && patchedUser.configured)) {
            ops.mkdirFn(path.dirname(userDesktopFile), { recursive: true });
            ops.writeFn(userDesktopFile, patchedUser.text, 'utf8');
            updatedPaths.push(userDesktopFile);
          }
          if (patchedUser.configured) {
            configuredPaths.push(userDesktopFile);
          }
        }
      }

      if (ops.existsFn(autostartDesktopFile)) {
        const autoText = String(ops.readFn(autostartDesktopFile, 'utf8') || '');
        const patchedAuto = patchLinuxDesktopEntryText(autoText, { enabled });
        if (patchedAuto.matched) {
          if (patchedAuto.changed) {
            ops.writeFn(autostartDesktopFile, patchedAuto.text, 'utf8');
            updatedPaths.push(autostartDesktopFile);
          }
          if (patchedAuto.configured) {
            configuredPaths.push(autostartDesktopFile);
          }
        }
      }

      return {
        checked: true,
        updated: updatedPaths.length > 0,
        alreadyConfigured: updatedPaths.length === 0 && configuredPaths.length > 0,
        configured: configuredPaths.length > 0,
        updatedPaths,
        configuredPaths,
      };
    } catch (err) {
      return {
        checked: true,
        updated: false,
        alreadyConfigured: false,
        configured: false,
        updatedPaths: [],
        configuredPaths: [],
        reason: 'linux_desktop_error',
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  if (platform === 'darwin') {
    // macOS .app bundles carry Apple code signatures; relaunching via `open -a ... --args` handles CDP flags.
    return {
      checked: true,
      updated: false,
      alreadyConfigured: false,
      configured: false,
      updatedPaths: [],
      configuredPaths: [],
      reason: 'macos_app_bundle_signed',
    };
  }

  return {
    checked: true,
    updated: false,
    alreadyConfigured: false,
    configured: false,
    updatedPaths: [],
    configuredPaths: [],
    reason: 'unsupported_platform',
  };
}

function buildSanitizedDesktopRelaunchEnv(baseEnv = process.env) {
  const clean = {};
  for (const [key, val] of Object.entries(baseEnv || {})) {
    if (val === undefined || val === null) continue;
    if (/^(?:ANTIGRAVITY_|CHROME_DEVTOOLS_MCP_|AGY_CLAUDE_STUDIO_|AGY_CLAUDE_STYLE_|ELECTRON_RUN_AS_NODE$|NODE_OPTIONS$)/i.test(key)) {
      continue;
    }
    clean[key] = String(val);
  }
  return clean;
}

function resolveDesktopHostExecutable({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  existsFn = fs.existsSync,
} = {}) {
  const safeExists = (p) => {
    try {
      return Boolean(p && existsFn(p));
    } catch {
      return false;
    }
  };

  const hintPaths = [
    String(env?.AGY_CLAUDE_STUDIO_HOST_EXE || env?.AGY_CLAUDE_STYLE_HOST_EXE || '').trim(),
    String(env?.ANTIGRAVITY_AGENTAPI_EXE || '').trim(),
    String(env?.CHROME_DEVTOOLS_MCP_JS || '').trim(),
  ].filter(Boolean);

  for (const rawHint of hintPaths) {
    if (platform === 'darwin') {
      const appIdx = rawHint.toLowerCase().indexOf('.app/');
      const bundleCand =
        appIdx >= 0
          ? rawHint.slice(0, appIdx + 4)
          : rawHint.toLowerCase().endsWith('.app')
            ? rawHint
            : '';
      if (bundleCand && safeExists(bundleCand)) {
        const isIde = /antigravity\s*ide\.app$/i.test(bundleCand);
        const macBin = path.join(bundleCand, 'Contents', 'MacOS', isIde ? 'Antigravity IDE' : 'Antigravity');
        return {
          found: true,
          kind: isIde ? 'ide' : 'desktop',
          executablePath: safeExists(macBin) ? macBin : bundleCand,
          appBundlePath: bundleCand,
        };
      }
    }

    if (platform === 'win32' && /\.exe$/i.test(rawHint) && !/language_server/i.test(rawHint)) {
      if (safeExists(rawHint)) {
        const isIde = /antigravity\s*ide\.exe$/i.test(rawHint);
        return {
          found: true,
          kind: isIde ? 'ide' : 'desktop',
          executablePath: rawHint,
          appBundlePath: '',
        };
      }
    }

    let cur = rawHint;
    for (let depth = 0; depth < 8 && cur && path.dirname(cur) !== cur; depth += 1) {
      const base = path.basename(cur).toLowerCase();
      if (base === 'resources') {
        const installRoot = path.dirname(cur);
        if (platform === 'win32') {
          const desktopExe = path.join(installRoot, 'Antigravity.exe');
          if (safeExists(desktopExe)) {
            return { found: true, kind: 'desktop', executablePath: desktopExe, appBundlePath: '' };
          }
          const ideExe = path.join(installRoot, 'Antigravity IDE.exe');
          if (safeExists(ideExe)) {
            return { found: true, kind: 'ide', executablePath: ideExe, appBundlePath: '' };
          }
        } else if (platform === 'linux') {
          for (const binName of ['antigravity', 'Antigravity']) {
            const linuxExe = path.join(installRoot, binName);
            if (safeExists(linuxExe)) {
              return { found: true, kind: 'desktop', executablePath: linuxExe, appBundlePath: '' };
            }
          }
        }
      }
      cur = path.dirname(cur);
    }
  }

  if (platform === 'win32') {
    const localAppData = env?.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    const programFiles = env?.ProgramFiles || 'C:\\Program Files';
    const winCandidates = [
      path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(programFiles, 'Antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Antigravity', 'Antigravity.exe'),
    ];
    for (const cand of winCandidates) {
      if (safeExists(cand)) {
        return { found: true, kind: 'desktop', executablePath: cand, appBundlePath: '' };
      }
    }
  } else if (platform === 'darwin') {
    const macBundles = [
      path.join(homeDir, 'Applications', 'Antigravity.app'),
      '/Applications/Antigravity.app',
    ];
    for (const bundlePath of macBundles) {
      if (safeExists(bundlePath)) {
        const macBin = path.join(bundlePath, 'Contents', 'MacOS', 'Antigravity');
        return {
          found: true,
          kind: 'desktop',
          executablePath: safeExists(macBin) ? macBin : bundlePath,
          appBundlePath: bundlePath,
        };
      }
    }
  } else {
    const linuxCandidates = [
      '/opt/Antigravity/antigravity',
      '/opt/antigravity/antigravity',
      '/usr/share/antigravity/antigravity',
      '/usr/bin/antigravity',
      path.join(homeDir, '.local', 'bin', 'antigravity'),
    ];
    for (const cand of linuxCandidates) {
      if (safeExists(cand)) {
        return { found: true, kind: 'desktop', executablePath: cand, appBundlePath: '' };
      }
    }
  }

  return { found: false, kind: '', executablePath: '', appBundlePath: '' };
}

function runLauncherExecFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: options.timeoutMs || 8000,
        maxBuffer: 1024 * 1024,
        env: options.env || process.env,
      },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(String(stdout || ''));
      }
    );
  });
}

function spawnDetachedRelaunch(file, args, options = {}) {
  const child = spawn(file, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: options.cwd || undefined,
    env: options.env || process.env,
  });
  if (typeof child.unref === 'function') child.unref();
  return Promise.resolve({ pid: Number(child?.pid || 0) });
}

async function discoverRunningHostExecutable({ platform = process.platform, execFileFn = null } = {}) {
  const runner = execFileFn || runLauncherExecFile;
  if (platform === 'win32') {
    try {
      const ps =
        "@(Get-Process -Name 'Antigravity','Antigravity IDE' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1) | ForEach-Object { [pscustomobject]@{ path = [string]$_.Path; name = [string]$_.ProcessName } } | ConvertTo-Json -Compress";
      const out = await runner(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { timeoutMs: 4000 }
      );
      const trimmed = String(out || '').trim();
      if (trimmed && trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        const exePath = String(parsed?.path || '').trim();
        if (exePath) {
          const isIde = /ide/i.test(String(parsed?.name || '')) || /antigravity\s*ide\.exe$/i.test(exePath);
          return {
            found: true,
            kind: isIde ? 'ide' : 'desktop',
            executablePath: exePath,
            appBundlePath: '',
          };
        }
      }
    } catch {}
  } else if (platform === 'darwin') {
    try {
      const out = await runner('osascript', ['-e', 'POSIX path of (path to application "Antigravity")'], {
        timeoutMs: 3000,
      });
      const bundlePath = String(out || '').trim().replace(/\/+$/, '');
      if (bundlePath && /\.app$/i.test(bundlePath)) {
        return {
          found: true,
          kind: 'desktop',
          executablePath: bundlePath,
          appBundlePath: bundlePath,
        };
      }
    } catch {}
  }
  return { found: false, kind: '', executablePath: '', appBundlePath: '' };
}

function psSingleQuote(val) {
  return `'${String(val ?? '').replace(/'/g, "''")}'`;
}

function buildWindowsRelaunchInnerScript(executablePath, stalePortFiles = [], kind = 'desktop') {
  const procName = kind === 'ide' ? 'Antigravity IDE' : 'Antigravity';
  const portLiterals = (Array.isArray(stalePortFiles) ? stalePortFiles : [])
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .map(psSingleQuote)
    .join(', ');

  return `
Start-Sleep -Milliseconds 480
$exe = ${psSingleQuote(executablePath)}
$procName = ${psSingleQuote(procName)}
$staleList = @(${portLiterals})
$mySid = (Get-Process -Id $PID).SessionId

if (-not $exe -or -not (Test-Path -LiteralPath $exe)) {
  $livePath = Get-Process -Name $procName -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $mySid -and $_.Path } | Select-Object -First 1 -ExpandProperty Path
  if ($livePath) { $exe = [string]$livePath }
}

$findTargets = {
  @(Get-Process -Name $procName -ErrorAction SilentlyContinue | Where-Object {
    $_.SessionId -eq $mySid -and (-not $_.Path -or -not $exe -or [string]::Equals($_.Path, $exe, [System.StringComparison]::OrdinalIgnoreCase))
  })
}

$initial = & $findTargets
foreach ($p in $initial) {
  try {
    if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }
  } catch {}
}
Start-Sleep -Milliseconds 850

$remaining = & $findTargets
foreach ($p in $remaining) {
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
}

for ($i = 0; $i -lt 30; $i++) {
  if ((& $findTargets).Count -eq 0) { break }
  Start-Sleep -Milliseconds 200
}

foreach ($fp in $staleList) {
  if ($fp -and (Test-Path -LiteralPath $fp)) {
    try { Remove-Item -LiteralPath $fp -Force -ErrorAction SilentlyContinue } catch {}
  }
}

if ($exe -and (Test-Path -LiteralPath $exe)) {
  $workDir = Split-Path -Parent $exe
  Start-Process -FilePath $exe -ArgumentList '--remote-debugging-port=0' -WorkingDirectory $workDir
}

if ($PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath)) {
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}
`.trim();
}

const WIN_OUT_OF_JOB_DISPATCH_PS = `
$ErrorActionPreference = 'Stop'
$innerArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $env:AGY_RELAUNCH_PS1 + '"'
try {
  $shellApp = New-Object -ComObject Shell.Application
  $shellApp.ShellExecute('powershell.exe', $innerArgs, '', 'open', 0)
  Write-Output '{"ok":true,"method":"shell_application"}'
} catch {
  Start-Process -FilePath 'powershell.exe' -ArgumentList $innerArgs -WindowStyle Hidden
  Write-Output '{"ok":true,"method":"start_process"}'
}
`.trim();

async function triggerDesktopHostRelaunch({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  stalePortFiles = [],
  tempDir = '',
  execFileFn = null,
  spawnFn = null,
  existsFn = fs.existsSync,
  writeFileFn = fs.writeFileSync,
  mkdirFn = fs.mkdirSync,
  allowInTest = false,
} = {}) {
  if (
    !allowInTest &&
    (String(env?.AGY_CLAUDE_STUDIO_SKIP_LAUNCHER_PROVISION || env?.AGY_CLAUDE_STYLE_SKIP_LAUNCHER_PROVISION || '') === '1' ||
      String(env?.ANTIGRAVITY_LS_ADDRESS || '').trim() === 'test.invalid')
  ) {
    return { ok: false, status: 403, error: 'Disabled in test sandbox' };
  }

  let hostInfo = resolveDesktopHostExecutable({ env, platform, homeDir, existsFn });
  if (!hostInfo.found) {
    hostInfo = await discoverRunningHostExecutable({ platform, execFileFn });
  }
  if (!hostInfo.found) {
    return {
      ok: false,
      status: 404,
      error: 'Unable to locate Antigravity executable on this machine',
    };
  }

  const cleanEnv = buildSanitizedDesktopRelaunchEnv(env);
  const cleanStaleFiles = (Array.isArray(stalePortFiles) ? stalePortFiles : [])
    .map((p) => String(p || '').trim())
    .filter(Boolean);

  if (platform === 'win32') {
    const innerScript = buildWindowsRelaunchInnerScript(
      hostInfo.executablePath,
      cleanStaleFiles,
      hostInfo.kind
    );
    const resolvedTempDir = String(tempDir || env?.TEMP || env?.TMP || os.tmpdir()).trim();
    mkdirFn(resolvedTempDir, { recursive: true });
    const relaunchPs1Path = path.join(resolvedTempDir, `agy-cs-relaunch-${process.pid}.ps1`);
    // UTF-8 BOM lets Windows PowerShell 5.1 handle non-ASCII install paths reliably.
    writeFileFn(relaunchPs1Path, `\uFEFF${innerScript}\r\n`, 'utf8');

    const runner = execFileFn || runLauncherExecFile;
    await runner(
      'powershell.exe',
      [
        '-Sta',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WIN_OUT_OF_JOB_DISPATCH_PS,
      ],
      {
        timeoutMs: 6000,
        env: {
          ...cleanEnv,
          AGY_RELAUNCH_PS1: relaunchPs1Path,
        },
      }
    );
    return {
      ok: true,
      relaunching: true,
      platform,
      executablePath: hostInfo.executablePath,
    };
  }

  const spawner = spawnFn || spawnDetachedRelaunch;

  if (platform === 'darwin') {
    const appTarget = hostInfo.appBundlePath || hostInfo.executablePath;
    const appName = hostInfo.kind === 'ide' ? 'Antigravity IDE' : 'Antigravity';
    const shScript = [
      'sleep 0.45',
      `osascript -e 'tell application "${appName}" to quit' >/dev/null 2>&1 || true`,
      `i=0; while [ $i -lt 25 ] && pgrep -x "${appName}" >/dev/null 2>&1; do sleep 0.2; i=$((i+1)); done`,
      `if pgrep -x "${appName}" >/dev/null 2>&1; then killall "${appName}" >/dev/null 2>&1 || true; sleep 0.4; fi`,
      'IFS=":"; for f in $AGY_STALE_PORT_FILES; do [ -n "$f" ] && rm -f "$f"; done',
      'open -a "$AGY_RELAUNCH_APP" --args --remote-debugging-port=0 >/dev/null 2>&1',
    ].join('; ');
    await spawner('/bin/sh', ['-c', shScript], {
      env: {
        ...cleanEnv,
        AGY_RELAUNCH_APP: appTarget,
        AGY_STALE_PORT_FILES: cleanStaleFiles.join(':'),
      },
    });
    return {
      ok: true,
      relaunching: true,
      platform,
      executablePath: appTarget,
    };
  }

  const procLeaf = path.basename(hostInfo.executablePath) || 'antigravity';
  const linuxScript = [
    'sleep 0.45',
    'uid="$(id -u)"',
    'pkill -u "$uid" -x "$AGY_PROC_NAME" >/dev/null 2>&1 || true',
    'i=0; while [ $i -lt 25 ] && pgrep -u "$uid" -x "$AGY_PROC_NAME" >/dev/null 2>&1; do sleep 0.2; i=$((i+1)); done',
    'IFS=":"; for f in $AGY_STALE_PORT_FILES; do [ -n "$f" ] && rm -f "$f"; done',
    'nohup "$AGY_RELAUNCH_EXE" --remote-debugging-port=0 >/dev/null 2>&1 &',
  ].join('; ');
  await spawner('/bin/sh', ['-c', linuxScript], {
    env: {
      ...cleanEnv,
      AGY_RELAUNCH_EXE: hostInfo.executablePath,
      AGY_PROC_NAME: procLeaf,
      AGY_STALE_PORT_FILES: cleanStaleFiles.join(':'),
    },
  });
  return {
    ok: true,
    relaunching: true,
    platform,
    executablePath: hostInfo.executablePath,
  };
}

// Migration cleanup list for pre-v2.2.4 installs that still have flat root files
// alongside the new src/ layout. Safe to remove in v2.4+ once users have upgraded.
// Normalized SHA-256 of released blobs, newest first (v2.2.3 through v2.0.0).
const LEGACY_FLAT_ROOT_SHA256 = Object.freeze({
  'cdp.js': Object.freeze([
    '55d44228254c444b2f79bbdc92056ab0bdf44ea575365b53dcb90ff1e51e5361',
    'c43c3d586918da728e236d45578f95d85b6798f14777a2e83a7d956b9583118d',
    'c95311695fe341831d359cb0420c66b0a767134e479d19ad7a0be9fcf835d039',
    '2125024bbfd80d9e055ebbc8b278f71dc8f071ab2826de30587f704f5b8a1048',
    '56a794856db790bf131d41c5e755084bbc9c4f9aca1d98b7e3884e2057947a2a',
  ]),
  'crab-assets.js': Object.freeze([
    'af9616788f6345712db88569b152bbd839854e0fc30bea89ee33366bb2a9a440',
  ]),
  'effort-core.js': Object.freeze([
    'f273b23473601c0579492bafccc4285784d2107578eeb610520f85128186e6a0',
    'd3a23e1f458e52dc2e48fed79e72d348b91427a659f7da6a554dd33266eda337',
  ]),
  'i18n-core.js': Object.freeze([
    '5b0403f2c02bf6db6b3f079ca1fc86a9fdf0dc4234323ad69b1b715e8e11c5e4',
    '81cf48105b9a15a8bb979d7257cf37d79a848f7caa7986c270b143074b9ce8d7',
    '5851f0f8287e69b4abd3218a16a58bf12e304fb94e142cddd14926ce7bf7214b',
    'c70408a80951494be44b04d6cc17872de58768b9214176092de339efc461da0b',
  ]),
  'i18n-locales.js': Object.freeze([
    '8b9df3e10b3591ad1fee8b4c0b2dcd1d580325c6e8be570a7dc1f11316146e07',
    'ae49fdbe3ab5e3820fe33f0d6a67bc97d7bfe413b9eea4ee13743c7a9f50c17e',
    'dde1f400a0c92660d20f53eef1765f65ac4dd82460951fb030791583f60b4b9d',
    'b5fc841430170e4829e7c3153d1ae5a99a6f17456862f45b6c801ace8458b03c',
    '6f9524dbedb341dcfea6455c518d9e6599ffac8de23084b23374efc5c5f4e1ca',
  ]),
  'i18n-sync.js': Object.freeze([
    '99d46e76c2a4ea7aaf5b34e49bf5a71359f03115d9265050027f9e422159e6a9',
  ]),
  'inject.js': Object.freeze([
    'd06fbd729e8fed55f0083b4bd743731c35228ade94a914bacd306d03ffa45a1a',
    '9d299f43d52033f501615622365b0e27bddf2490aa9a9fd8d9a659ecd6e6fbe2',
    '97383e33448fa6b37d23251c7221ec4e1c0eefaa1c383552e8f81ef851f26c31',
  ]),
  'lifecycle.js': Object.freeze([
    '3e9370e5b42003948fa659fb78cc337a3625b24b9aa9042311cd01a1e175e43a',
  ]),
  'mascot-core.js': Object.freeze([
    'c1a335ce9ba0380be2e8ec2296ae98d9c6820f49eccbf865e2642f52d61e12d2',
  ]),
  'notify-core.js': Object.freeze([
    '6f9924c70ec9cf5c8561635b91013ad4c081fe016866c32ad24e4a5ac88eb70b',
    '99880ee5117868baeb09d713e71784227a41884a7f00971f2685e4dca6193c55',
  ]),
  'periodic-core.js': Object.freeze([
    '45dcc806364cf40920c68d4b23b0ea6c873fd071cdceef818959541a64f48daf',
  ]),
  'periodic-sync.js': Object.freeze([
    'cac2e35fe6835be367cef9b78af01f0b8382ad471abc612aa5784aef4df62c60',
  ]),
  'remove.js': Object.freeze([
    'd1362b32848be402c9da2e9c292b1caff4c3323c07367ec839b326f692811424',
    '13663565b14aa427c2e67e9c7ecfc4b17a56517c3f22920fdbf84a14a2926c00',
  ]),
  'ripple-core.js': Object.freeze([
    'eb7e73e3862dfe620e6934d78ba12a8a60467013dd1a95b5cf69be442d3486d5',
  ]),
  'scripts-core.js': Object.freeze([
    '0b5bff4d88fb054f91aae8ee1269ebcbcb8357144b5e87ba956bd68383646916',
    '9a3850ed06554b27ef4eddbe6b587cb4aeb41e816d19bf77b4c2dc57ada5459e',
  ]),
  'sidecar-core.js': Object.freeze([
    '03101ba96310c83d35658b2e67071d47068d1ba785ac23ddc03c6a20b598e95d',
    'c1a8993489e67c756d80c8194e8b04d7589d0b14e348aeda3786065b1c9c9211',
  ]),
  'style.css': Object.freeze([
    '74a392b143e22d4da58cdb1f330b39feae992444f65b399349648401df813401',
    '0bd46743be52c6cf189e073a09ce520186bfd942763ec96d86bc2ab1b1391f02',
    'c9946af5b102ef55b9e1af9571958f19261ba508ef3a348b8da345fe75400b37',
    '6b06fbd56589a7707ca471c4bed38ad8518546f24222197c25333c85652239ad',
  ]),
  'ui-runtime.js': Object.freeze([
    '58265dcb0d555ccdd605d7ff10575664264ac865765a950829c3de0eac7e03c6',
    '2ba4bc37c271f606e5e7275878626de2f614d06c85edc4c65e05104408e14805',
    'dd115d9572e2553aa3c07b260b186bc8bd4a630ab2572e8df72c48b33cc8c769',
    '5b20474d0d03d2e3732f2d16a8d6e565fb4cb3329a775de16ca64587ff8d4020',
    '1cc657ae0c77adb1fb1edc21742847e50e7aa054fef80b3b42241f310a34b595',
  ]),
  'usage-core.js': Object.freeze([
    '6b4925c7ca64762ba4d0fa417f11505e877350947e5a45631816f6a54da99cca',
    'bbbac7c7c46b29b819f49e067fdfbd9ce55a67afb8014b07f44f531bc14eebf9',
    '264a9cd9d472b1a3f86dd574d3f794b36e9ffebb317e861c42bcc6e7c0168c73',
  ]),
  'watcher-core.js': Object.freeze([
    '9ebba5c200cb8a0406717323e980e93cff2a52de82d7851451542d2c72f0375f',
    'a3428a7665e00cfea9cf2ed694482718c6b401b0ab6681b39c3e7016e3b49a44',
  ]),
  'autostart-off.bat': Object.freeze([
    'b450fe8f100d61bcfdea82406c27210a5da058f95f32080f579833a14ff94eed',
    'ffdb804b74ccaff5f3e2b2ba495b653ebdbd32eddec29f9e6dd9f9f4ba075404',
  ]),
  'autostart-on.bat': Object.freeze([
    'd50d1a59a481dc2b6514975921e514096c8ac2f5f7d40ccecea1451354b1a8ff',
    'fa53b4b1c824a86e70307fdae1b01221e6e4146a76ddfc24e5fae38554aff29d',
  ]),
  'inject.bat': Object.freeze([
    '4e66d1a6c94266fb1fbd1b327bc4255d51c3c4ddafc67c13c21546aac00690d0',
    'b1a067ff1a4f210124bc994779c5137bc462970992ebaef9ea17cde29724de3f',
  ]),
  'inject.sh': Object.freeze([
    'efaacd076ef489f40bffac10a807376c1f0fde4a88c49e38e66e6d8d712661eb',
    'e732958f56a05c91aa3621e3cc7b308e43f3c59d961d2dd6f225d6345861cb00',
  ]),
  'launch.bat': Object.freeze([
    '63e579f0223b11ee40a81a44b04b001756d4b51eaec0b6c6835fc19f8f1400c1',
    '7a5ad4498940a99c6c03ae08d3e843376fdc441b32bb45035dc507cdd59881a6',
  ]),
  'launch.sh': Object.freeze([
    '0938761c83f1c721be7a18693f71d325d84d15f9d790cae46a2c71bb1340a757',
    '2d27b4390a92bf098df5bda0946ab5d0ca494938424b456f049f7cd282dfae56',
  ]),
  'remove.bat': Object.freeze([
    'be3995502f039c658f0b6e29941180796423e218af1c17da5e30b6df24c98f82',
    'f3cb26e3f2e336e484536d5ec3f04f0ca3ebe5dee38c663b61a45296da4fbdf0',
  ]),
  'remove.sh': Object.freeze([
    '097d7568536ced43af3abbd723339800d9a2316bc5f3f14e58f8654d0d4e1e88',
    'b38a7d10320acaaf30de17d44f0d2a69d27ded431f15d2bc23746e2fcac9be7e',
  ]),
  'watch-hidden.vbs': Object.freeze([
    '01cb6b19cc2605c8e75e9c80c0ce6708d87ab61592d80f9557084ba5389538a1',
  ]),
  'watch.bat': Object.freeze([
    'f710616e081f18cb930c2ef5e2cf692cdba39734f885633d437fd44561050f4a',
    '7ae8a862b54ef75db73f64d90586870f8a5db106a0972f60c2766da1554d261d',
  ]),
  'watch.sh': Object.freeze([
    'b9892acf8ecf4bb4e37e7589bdfe99b944b98335237f91007bea41bdc3264bf0',
    '214f69c33c368e650b38b48845179250832356cf63064d78e104f56d83a40b9b',
  ]),
});
const LEGACY_FLAT_ROOT_FILES = Object.freeze(Object.keys(LEGACY_FLAT_ROOT_SHA256));
const CORE_LAYOUT_FILES = ['cdp.js', 'ui-runtime.js', 'style.css', 'inject.js', 'lifecycle.js'];

/**
 * Remove legacy flat root files left over from pre-v2.2.4 installations.
 * Safe to remove this migration hook in v2.4+.
 */
function cleanupLegacyFlatRootFiles(rootDir) {
  const removed = [];
  const preserved = [];
  const errors = [];
  const skip = (reason) => ({ skipped: true, reason, removed, preserved, errors });
  if (!rootDir || typeof rootDir !== 'string') return skip('invalid_root');
  const resolvedRoot = path.resolve(rootDir);
  const stat = (file) => fs.lstatSync(file, { throwIfNoEntry: false });
  try {
    if (!stat(resolvedRoot)?.isDirectory()) return skip('invalid_root');
    if (stat(path.join(resolvedRoot, '.git'))) return skip('git_repo');
    const src = path.join(resolvedRoot, 'src');
    if (!stat(src)?.isDirectory() || !CORE_LAYOUT_FILES.every((name) => stat(path.join(src, name))?.isFile())) {
      return skip('missing_src_layout');
    }
  } catch (err) {
    errors.push({ file: err.path, code: err.code, message: err.message });
    return skip('layout_check_failed');
  }
  for (const name of LEGACY_FLAT_ROOT_FILES) {
    const targetPath = path.join(resolvedRoot, name);
    try {
      const stat = fs.lstatSync(targetPath);
      // All known originals fit within 4 MiB, including CRLF checkouts.
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) {
        preserved.push(name);
        continue;
      }
      const bytes = fs.readFileSync(targetPath, 'latin1').replace(/\r\n/g, '\n');
      const digest = createHash('sha256').update(bytes, 'latin1').digest('hex');
      if (!LEGACY_FLAT_ROOT_SHA256[name].includes(digest)) {
        preserved.push(name);
        continue;
      }
      fs.unlinkSync(targetPath);
      removed.push(name);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      errors.push({
        file: name,
        code: (err && err.code) || '',
        message: (err && err.message) || String(err),
      });
    }
  }

  return {
    skipped: false,
    reason: removed.length > 0 ? 'cleaned' : 'already_clean',
    removed,
    preserved,
    errors,
  };
}

function exitProcessCleanly(code = 0, settleMs = 50) {
  process.exitCode = code;
  try {
    if (process.stdin && typeof process.stdin.pause === 'function') {
      process.stdin.pause();
    }
  } catch {}
  const timer = setTimeout(() => {
    process.exit(code);
  }, Math.max(10, settleMs));
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

module.exports = {
  BROKEN_PIPE_CODES,
  isBrokenPipeError,
  isPidAlive,
  inspectProcessIdentity,
  isWatcherProcessAlive,
  createSafeLogger,
  createIdleHostTracker,
  normalizeLsHealthzUrl,
  startHostWatchdog,
  readWatcherLockInfo,
  readWatcherPid,
  waitForPidExit,
  acquireWatcherLock,
  getMcpHostsDir,
  registerMcpHost,
  listAliveMcpHosts,
  readAntigravityPluginEnabledState,
  ensureIdeRemoteDebuggingArgv,
  REMOTE_DEBUG_LAUNCH_FLAG,
  ensureRemoteDebugFlagInArgs,
  patchWindowsRunRegistryCommand,
  patchLinuxDesktopEntryText,
  ensureDesktopRemoteDebuggingLaunchers,
  buildSanitizedDesktopRelaunchEnv,
  resolveDesktopHostExecutable,
  buildWindowsRelaunchInnerScript,
  triggerDesktopHostRelaunch,
  LEGACY_FLAT_ROOT_SHA256,
  LEGACY_FLAT_ROOT_FILES,
  cleanupLegacyFlatRootFiles,
  exitProcessCleanly,
};
