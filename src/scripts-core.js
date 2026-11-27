'use strict';

// Custom local script runner & store for Claude Studio (agy-claude-studio).
// Zero external dependencies, MIT licensed.
// Scripts metadata lives exclusively in PLUGIN_DATA/scripts.json (never injected into renderer).

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const MAX_SCRIPTS = 32;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MIN_TIMEOUT_SEC = 5;
const MAX_TIMEOUT_SEC = 300;
const DEFAULT_TIMEOUT_SEC = 60;

function resolveScriptsDataDir(env = process.env, fallbackDir = null) {
  const fromEnv =
    env && typeof env.PLUGIN_DATA === 'string' && env.PLUGIN_DATA.trim()
      ? env.PLUGIN_DATA.trim()
      : '';
  if (fromEnv) return fromEnv;
  if (fallbackDir && typeof fallbackDir === 'string' && fallbackDir.trim()) {
    return fallbackDir.trim();
  }
  return path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-claude-studio');
}

function getScriptsFilePath(dataDir) {
  return path.join(dataDir, 'scripts.json');
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.copyFileSync(tmp, filePath);
      fs.unlinkSync(tmp);
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      throw err;
    }
  }
}

function parseArgsInput(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item ?? '').replace(/\0/g, '').trim())
      .filter(Boolean)
      .slice(0, 40);
  }
  if (typeof raw !== 'string') return [];
  const input = raw.replace(/\0/g, '').trim();
  if (!input) return [];
  const out = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\' && i + 1 < input.length && input[i + 1] === quote) {
        cur += quote;
        i += 1;
      } else if (ch === quote) {
        quote = '';
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out.slice(0, 40);
}

function clampTimeoutSec(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_SEC;
  return Math.max(MIN_TIMEOUT_SEC, Math.min(MAX_TIMEOUT_SEC, Math.round(n)));
}

function sanitizeScriptEntry(raw, existing = null) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? existing?.name ?? '').replace(/\0/g, '').trim().slice(0, 80);
  const scriptPath = String(raw.scriptPath ?? existing?.scriptPath ?? '').replace(/\0/g, '').trim().slice(0, 500);
  const command = String(raw.command ?? existing?.command ?? '').replace(/\0/g, '').trim().slice(0, 120);
  if (!name) return null;
  if (!scriptPath && !command) return null;

  const idRaw = String(raw.id ?? existing?.id ?? '').trim();
  const id = /^[a-zA-Z0-9_-]{4,48}$/.test(idRaw)
    ? idRaw
    : `scr_${crypto.randomBytes(6).toString('hex')}`;

  const cwd = String(raw.cwd ?? existing?.cwd ?? '').replace(/\0/g, '').trim().slice(0, 500);
  const args =
    raw.args !== undefined
      ? parseArgsInput(raw.args)
      : Array.isArray(existing?.args)
      ? existing.args
      : [];
  const timeoutSec = clampTimeoutSec(
    raw.timeoutSec !== undefined ? raw.timeoutSec : existing?.timeoutSec
  );

  return {
    id,
    name,
    command,
    scriptPath,
    args,
    cwd,
    timeoutSec,
    lastRunAt: existing?.lastRunAt || raw.lastRunAt || null,
    lastExitCode:
      typeof existing?.lastExitCode === 'number'
        ? existing.lastExitCode
        : typeof raw.lastExitCode === 'number'
        ? raw.lastExitCode
        : null,
    lastDurationMs:
      typeof existing?.lastDurationMs === 'number'
        ? existing.lastDurationMs
        : typeof raw.lastDurationMs === 'number'
        ? raw.lastDurationMs
        : null,
    lastSummary: String(existing?.lastSummary ?? raw.lastSummary ?? '').slice(0, 240),
  };
}

function readScriptsConfig(dataDir) {
  const filePath = getScriptsFilePath(dataDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.scripts) ? parsed.scripts : [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const clean = sanitizeScriptEntry(item, item);
      if (!clean || seen.has(clean.id)) continue;
      seen.add(clean.id);
      out.push(clean);
      if (out.length >= MAX_SCRIPTS) break;
    }
    return out;
  } catch {
    return [];
  }
}

function writeScriptsConfig(dataDir, scripts) {
  const filePath = getScriptsFilePath(dataDir);
  const safeList = (Array.isArray(scripts) ? scripts : [])
    .map((item) => sanitizeScriptEntry(item, item))
    .filter(Boolean)
    .slice(0, MAX_SCRIPTS);
  atomicWriteJson(filePath, { version: 1, scripts: safeList });
  return safeList;
}

function upsertCustomScript(dataDir, payload) {
  const list = readScriptsConfig(dataDir);
  const idx = payload?.id ? list.findIndex((s) => s.id === payload.id) : -1;
  if (idx < 0 && list.length >= MAX_SCRIPTS) {
    return { ok: false, error: 'max_scripts_reached', scripts: list };
  }
  const existing = idx >= 0 ? list[idx] : null;
  const entry = sanitizeScriptEntry(payload, existing);
  if (!entry) {
    return { ok: false, error: 'invalid_script_entry', scripts: list };
  }
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  const saved = writeScriptsConfig(dataDir, list);
  return { ok: true, script: entry, scripts: saved };
}

function deleteCustomScript(dataDir, id) {
  const list = readScriptsConfig(dataDir);
  const next = list.filter((s) => s.id !== String(id || ''));
  if (next.length === list.length) {
    return { ok: false, error: 'not_found', scripts: list };
  }
  const saved = writeScriptsConfig(dataDir, next);
  return { ok: true, scripts: saved };
}

function resolveInvocation(entry) {
  const scriptPath = String(entry.scriptPath || '').trim();
  const explicitCmd = String(entry.command || '').trim();
  const extraArgs = Array.isArray(entry.args) ? entry.args.slice() : [];
  const ext = scriptPath ? path.extname(scriptPath).toLowerCase() : '';

  const commandName = path.win32.basename(explicitCmd).toLowerCase().replace(/[ .]+$/, '');
  const commandExt = path.win32.extname(commandName);
  if (['.bat', '.cmd'].includes(ext) || ['.bat', '.cmd'].includes(commandExt) || /^(?:cmd|cmd\.exe)$/.test(commandName)) {
    return {
      cmd: '',
      argv: [],
      blockedReason: 'unsupported_batch_script',
      blockedMessage:
        'Batch (.bat/.cmd) scripts are disabled because cmd.exe parses shell metacharacters; use .ps1, .mjs/.js, .py, or .sh instead.',
    };
  }

  if (explicitCmd) {
    const cmd = explicitCmd === 'node' ? process.execPath : explicitCmd;
    const argv = scriptPath ? [scriptPath, ...extraArgs] : extraArgs;
    return { cmd, argv };
  }

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return { cmd: process.execPath, argv: [scriptPath, ...extraArgs] };
  }
  if (ext === '.py') {
    return { cmd: process.platform === 'win32' ? 'python' : 'python3', argv: [scriptPath, ...extraArgs] };
  }
  if (ext === '.ps1') {
    const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    return { cmd: ps, argv: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...extraArgs] };
  }
  if (ext === '.sh') {
    return { cmd: 'bash', argv: [scriptPath, ...extraArgs] };
  }
  return { cmd: scriptPath, argv: extraArgs };
}

function isRunning(child) {
  return Boolean(child.pid) && child.exitCode === null && child.signalCode === null;
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    if (isRunning(child)) {
      try { child.kill(signal); } catch {}
    }
  }
}

async function stopTimedOutScript(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (!isRunning(child)) return;
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
    const killed = await new Promise((done) => {
      execFile(taskkill, ['/T', '/F', '/PID', String(child.pid)], {
        timeout: 3000,
        windowsHide: true,
      }, (error) => done(!error));
    });
    if (!killed && isRunning(child)) child.kill('SIGKILL');
    return;
  }
  signalProcessGroup(child, 'SIGTERM');
  await new Promise((done) => setTimeout(done, 1200));
  signalProcessGroup(child, 'SIGKILL');
}

function isLocalScriptPath(value) {
  return !/[\x00-\x1f\x7f]/.test(value) && (process.platform !== 'win32' || (
    !/^[\\/]{2}/.test(value) && !value.replace(/^[A-Za-z]:[\\/]/, '').includes(':')
  ));
}

function scriptChildEnv(dataDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('ANTIGRAVITY_SIDECAR_')) delete env[key];
  }
  return { ...env, PLUGIN_DATA: dataDir, AGY_CLAUDE_STUDIO_DATA_DIR: dataDir };
}

function clipTail(bufs, maxBytes = MAX_OUTPUT_BYTES) {
  const full = Buffer.concat(bufs);
  if (full.length <= maxBytes) return { text: full.toString('utf8'), truncated: false };
  return {
    text: '…[truncated]\n' + full.subarray(full.length - maxBytes).toString('utf8'),
    truncated: true,
  };
}

function buildSummaryLine(stdoutText, stderrText, exitCode, timedOut) {
  if (timedOut) return '执行超时';
  const combined = (exitCode === 0 ? stdoutText : stderrText || stdoutText) || '';
  const lines = combined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return exitCode === 0 ? '已完成（无输出）' : `退出码 ${exitCode}`;
  return lines[0].slice(0, 140);
}

function runCustomScript(dataDir, id, options = {}) {
  const list = readScriptsConfig(dataDir);
  const idx = list.findIndex((s) => s.id === String(id || ''));
  if (idx < 0) {
    return Promise.resolve({ ok: false, error: 'not_found' });
  }
  const entry = list[idx];
  if (![entry.cwd, entry.scriptPath, entry.command].every(isLocalScriptPath)) {
    return Promise.resolve({ ok: false, error: 'invalid_script_path' });
  }
  const scriptPath = entry.scriptPath ? path.resolve(entry.cwd || process.cwd(), entry.scriptPath) : '';
  const invocation = resolveInvocation({ ...entry, scriptPath });
  if (invocation.blockedReason) {
    return Promise.resolve({
      ok: false,
      error: invocation.blockedReason,
      message: invocation.blockedMessage || 'Script type is not allowed',
    });
  }
  const { cmd, argv } = invocation;
  const cwd = entry.cwd ? path.resolve(entry.cwd) : scriptPath ? path.dirname(scriptPath) : process.cwd();
  try {
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Working directory is not a directory');
  } catch {
    return Promise.resolve({ ok: false, error: 'invalid_cwd', message: `Invalid working directory: ${cwd}` });
  }
  if (scriptPath) {
    try {
      if (!fs.statSync(scriptPath).isFile()) throw new Error('Not a regular file');
    } catch {
      return Promise.resolve({ ok: false, error: 'script_not_found', message: `Script not found: ${scriptPath}` });
    }
  }

  const timeoutMs = clampTimeoutSec(options.timeoutSec ?? entry.timeoutSec) * 1000;
  const startedAt = Date.now();

  return new Promise((resolveRun) => {
    const outChunks = [];
    const errChunks = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let settled = false;

    let child;
    try {
      child = spawn(cmd, argv, {
        cwd,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: scriptChildEnv(dataDir),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolveRun({
        ok: false,
        error: 'spawn_failed',
        message: err?.message || String(err),
      });
      return;
    }

    const timer = setTimeout(async () => {
      timedOut = true;
      try {
        await stopTimedOutScript(child);
      } catch {
        // Preserve the timeout result even if the operating system rejects cleanup.
      } finally {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish(child.exitCode);
      }
    }, timeoutMs);
    timer.unref?.();

    const pushChunk = (arr, chunk, isErr) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      if (isErr) {
        errBytes += buf.length;
        if (errBytes <= MAX_OUTPUT_BYTES * 2) arr.push(buf);
      } else {
        outBytes += buf.length;
        if (outBytes <= MAX_OUTPUT_BYTES * 2) arr.push(buf);
      }
    };

    child.stdout?.on('data', (c) => pushChunk(outChunks, c, false));
    child.stderr?.on('data', (c) => pushChunk(errChunks, c, true));

    const finish = (exitCode, spawnErr = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const outRes = clipTail(outChunks);
      const errRes = clipTail(errChunks);
      const stderrText = spawnErr ? `${errRes.text}\n${spawnErr.message || spawnErr}`.trim() : errRes.text;
      const code = typeof exitCode === 'number' ? exitCode : -1;
      const ok = !timedOut && !spawnErr && code === 0;
      const summary = buildSummaryLine(outRes.text, stderrText, code, timedOut);

      // Persist latest run stats back into scripts.json
      const freshList = readScriptsConfig(dataDir);
      const freshIdx = freshList.findIndex((s) => s.id === entry.id);
      if (freshIdx >= 0) {
        freshList[freshIdx] = {
          ...freshList[freshIdx],
          lastRunAt: new Date().toISOString(),
          lastExitCode: code,
          lastDurationMs: durationMs,
          lastSummary: summary,
        };
        try {
          writeScriptsConfig(dataDir, freshList);
        } catch {}
      }

      resolveRun({
        ok,
        id: entry.id,
        name: entry.name,
        exitCode: code,
        timedOut,
        durationMs,
        stdout: outRes.text,
        stderr: stderrText,
        truncated: outRes.truncated || errRes.truncated,
        summary,
        ranAt: new Date().toISOString(),
      });
    };

    child.on('error', (err) => { if (!timedOut) finish(-1, err); });
    child.on('close', (code) => { if (!timedOut) finish(code); });
  });
}

module.exports = {
  MAX_SCRIPTS,
  MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_SEC,
  resolveScriptsDataDir,
  getScriptsFilePath,
  parseArgsInput,
  sanitizeScriptEntry,
  readScriptsConfig,
  writeScriptsConfig,
  upsertCustomScript,
  deleteCustomScript,
  resolveInvocation,
  runCustomScript,
};
