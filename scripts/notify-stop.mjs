#!/usr/bin/env node
// Stop hook runner for Claude Studio zero-token mobile push notifications.
// Hook invocation evaluates filters locally and spawns a detached `--deliver` worker,
// immediately outputting `{}` to stdout (~20ms) so the Antigravity agent loop is never blocked.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT_DIR = resolve(__dirname, '..');
const notifyCore = require(join(PLUGIN_ROOT_DIR, 'src', 'notify-core.js'));

function readStdinWithTimeout(timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    if (process.stdin.isTTY) {
      resolvePromise('');
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      try {
        process.stdin.pause();
      } catch {}
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    };

    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();

    process.stdin.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    try {
      process.stdin.resume();
    } catch {
      finish();
    }
  });
}

async function runDeliverWorker() {
  const payloadFile = String(process.env.AGY_NOTIFY_PAYLOAD_FILE || '').trim();
  try {
    let decoded = null;
    if (payloadFile) {
      decoded = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    } else {
      const rawB64 = String(process.env.AGY_NOTIFY_PAYLOAD_B64 || '').trim();
      if (!rawB64) return;
      decoded = JSON.parse(Buffer.from(rawB64, 'base64').toString('utf8'));
    }
    const dataDir = decoded?.dataDir ? resolve(String(decoded.dataDir)) : notifyCore.resolveNotifyDataDir(process.env);
    const msg = decoded?.msg;
    if (!msg || typeof msg !== 'object') return;
    const cfg = notifyCore.readNotifyConfig(dataDir);
    if (!cfg.enabled || !notifyCore.isChannelConfigured(cfg)) return;
    await notifyCore.deliverNotification(cfg, msg, { timeoutMs: 8000 });
  } catch {
    // Never propagate errors from detached background delivery.
  } finally {
    if (payloadFile) {
      try {
        fs.unlinkSync(payloadFile);
      } catch {}
    }
  }
}

async function runStopHook() {
  try {
    const rawStdin = await readStdinWithTimeout(1500);
    if (!rawStdin || !rawStdin.trim()) return;

    let payload = null;
    try {
      payload = JSON.parse(rawStdin);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;

    const dataDir = notifyCore.resolveNotifyDataDir(process.env);
    const cfg = notifyCore.readNotifyConfig(dataDir);
    if (!cfg.enabled || !notifyCore.isChannelConfigured(cfg)) return;

    const nowMs = Date.now();
    const summaryInfo = notifyCore.readTranscriptTailSummary(payload.transcriptPath, { nowMs });
    const state = notifyCore.readNotifyState(dataDir);
    const decision = notifyCore.shouldSendNotification(
      payload,
      cfg,
      state,
      nowMs,
      summaryInfo.durationSec
    );
    if (!decision.send) return;

    const msg = notifyCore.buildNotificationMessage(payload, summaryInfo, cfg);
    notifyCore.recordNotifySent(dataDir, payload.conversationId, nowMs);

    fs.mkdirSync(dataDir, { recursive: true });
    const payloadFile = join(dataDir, `.notify-deliver-${process.pid}-${nowMs}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(payloadFile, JSON.stringify({ dataDir, msg }), { encoding: 'utf8', mode: 0o600 });

    const child = spawn(process.execPath, [__filename, '--deliver'], {
      cwd: PLUGIN_ROOT_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        AGY_NOTIFY_PAYLOAD_FILE: payloadFile,
      },
    });
    child.unref();
  } catch {
    // Swallow all errors so Antigravity's Stop hook contract always succeeds.
  } finally {
    process.stdout.write('{}\n');
  }
}

if (process.argv.includes('--deliver')) {
  runDeliverWorker()
    .catch(() => {})
    .finally(() => process.exit(0));
} else {
  runStopHook()
    .catch(() => {})
    .finally(() => process.exit(0));
}
