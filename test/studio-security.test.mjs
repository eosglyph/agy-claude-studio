import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { getNotifyConfigApi, saveNotifyConfigApi, startStudioSidecar, registerStudioApis, performStudioSelfUpdate } from '../sidecars/studio/main.mjs';

const require = createRequire(import.meta.url);
const notify = require('../notify-core.js');
const scripts = require('../scripts-core.js');

async function withDataDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-security-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Studio has matching authenticated POST routes and will not start without a UI token', async () => {
  const routes = new Map();
  registerStudioApis({ api(route, handler, method) { routes.set(route, method); } });
  assert.ok(routes.size >= 20);
  assert.ok([...routes.values()].every((method) => method === 'POST'));
  const html = fs.readFileSync(new URL('../sidecars/studio/index.html', import.meta.url), 'utf8');
  for (const [, route] of html.matchAll(/apiFetch\('(\/api\/[^']+)'/g)) {
    assert.equal(routes.get(route), 'POST', route);
  }
  const start = html.indexOf('const apiFetch =');
  const end = html.indexOf('const COLLAPSED_STORAGE_KEY', start);
  const sandbox = { window: {} };
  const apiFetch = vm.runInNewContext(html.slice(start, end) + '\napiFetch', sandbox);
  await assert.rejects(apiFetch('/api/status'), /bridge is unavailable/);
  sandbox.window.sidecar = { fetch(url, init) { return { url, ...init }; } };
  const bridged = await apiFetch('/api/status');
  assert.equal(bridged.url, '/api/status');
  assert.equal(bridged.method, 'POST');
  const key = 'ANTIGRAVITY_SIDECAR_UI_TOKEN';
  const previous = process.env[key];
  try {
    delete process.env[key];
    await assert.rejects(startStudioSidecar(), /Missing Antigravity sidecar UI token/);
  } finally {
    if (previous !== undefined) process.env[key] = previous;
  }
});

test('saved notification credentials never echo and ordinary edits preserve them', async () => withDataDir((dataDir) => {
  const secret = 'test-token';
  const privateUrl = 'https://example.test/private-destination';
  const options = { dataDir };
  const save = saveNotifyConfigApi({ config: { channel: 'webhook', channels: { webhook: {
    authHeader: secret, webhookUrl: privateUrl,
  } } } }, options);
  for (const result of [save, getNotifyConfigApi(options)]) {
    assert.equal(result.configured, true);
    assert.deepEqual(result.savedFields.webhook.sort(), ['authHeader', 'webhookUrl']);
    assert.doesNotMatch(JSON.stringify(result), /test-token|private-destination/);
  }
  saveNotifyConfigApi({ config: { minDurationSec: 240 } }, options);
  assert.equal(notify.readNotifyConfig(dataDir).channels.webhook.authHeader, secret);
  saveNotifyConfigApi({ config: { channels: { webhook: { webhookUrl: 'https://example.test/new' } } } }, options);
  assert.equal(notify.readNotifyConfig(dataDir).channels.webhook.authHeader, '');
  saveNotifyConfigApi({ config: { channels: { webhook: { webhookUrl: '' } } } }, options);
  assert.equal(getNotifyConfigApi(options).configured, false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(notify.getNotifyConfigPath(dataDir)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  }
}));

test('notification form only sends changed fields and can explicitly clear a hidden value', () => {
  const html = fs.readFileSync(new URL('../sidecars/studio/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('    let notifyLoaded = false;');
  const end = html.indexOf('    function loadActiveTab()', start);
  const ctx = vm.createContext({ renderNotifySection() {} });
  const result = vm.runInContext(html.slice(start, end) + `
    const redacted = cloneObj(notifyConfig);
    delete redacted.channels.webhook.authHeader;
    delete redacted.channels.webhook.webhookUrl;
    acceptNotifyConfig({ config: redacted, savedFields: { webhook: ['authHeader', 'webhookUrl'] } });
    notifyConfig.minDurationSec = 240;
    const ordinary = notifyPatch();
    notifyConfig.channels.webhook.authHeader = '';
    JSON.stringify([ordinary, notifyPatch()]);
  `, ctx);
  assert.deepEqual(JSON.parse(result), [
    { minDurationSec: 240 },
    { minDurationSec: 240, channels: { webhook: { authHeader: '' } } },
  ]);
});

test('merging notification settings leaves unreadable settings untouched', async () => withDataDir((dataDir) => {
  const file = notify.getNotifyConfigPath(dataDir);
  fs.writeFileSync(file, '{unfinished');
  assert.throws(() => saveNotifyConfigApi({ config: { enabled: true } }, { dataDir }), /Could not read notification settings/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{unfinished');
}));

test('git update refuses to replace an ancestor of a protected data directory', async () => withDataDir(async (pluginDir) => {
  fs.mkdirSync(path.join(pluginDir, '.git'));
  let mergeAttempted = false;
  const result = await performStudioSelfUpdate({
    pluginDir,
    pluginDataDir: path.join(pluginDir, 'sidecars', 'data'),
    execFn(_cmd, args) {
      if (args[0] === 'status' || args[0] === 'fetch') return '';
      if (args[0] === 'rev-parse') return args[1] === '--verify' ? 'a'.repeat(40) : 'main';
      if (args[0] === 'diff') return 'sidecars\0';
      if (args[0] === 'merge') mergeAttempted = true;
      return '';
    },
  });
  assert.equal(result.reason, 'protected_data_path');
  assert.equal(mergeAttempted, false);
}));

test('notification deadline remains active while reading the provider response', async () => {
  const config = notify.sanitizeNotifyConfig({ channel: 'serverchan', channels: { serverchan: { sendKey: 'test-token' } } });
  const result = await notify.deliverNotification(config, { title: 'test' }, {
    timeoutMs: 500,
    async fetchFn(_url, init) {
      assert.equal(init.redirect, 'error');
      return { ok: true, status: 200, text: () => delay(1000, '{}', { signal: init.signal }) };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
});

test('explicit batch or cmd entries are declined and invalid cwd does not silently fall back', async () => withDataDir(async (dataDir) => {
  for (const [command, scriptPath] of [['example.cmd', ''], ['cmd.exe', ''], ['node', 'file.bat']]) {
    const saved = scripts.upsertCustomScript(dataDir, { name: 'Batch test', command, scriptPath });
    assert.equal((await scripts.runCustomScript(dataDir, saved.script.id)).error, 'unsupported_batch_script');
  }
  const saved = scripts.upsertCustomScript(dataDir, { name: 'Working directory test', command: 'node', cwd: path.join(dataDir, 'missing') });
  assert.equal((await scripts.runCustomScript(dataDir, saved.script.id)).error, 'invalid_cwd');
}));

test('timed-out scripts stop their child and do not inherit the sidecar UI token', { timeout: 15000 }, async () => withDataDir(async (dataDir) => {
  const parent = path.join(dataDir, 'parent.cjs');
  const descendant = path.join(dataDir, 'child.cjs');
  const pulse = path.join(dataDir, 'pulse.txt');
  fs.writeFileSync(descendant, `
    const fs = require('node:fs');
    const touch = () => { try { fs.appendFileSync(process.argv[2], '.'); } catch {} };
    touch();
    setInterval(touch, 75);
    setTimeout(() => process.exit(0), 10000);
  `);
  fs.writeFileSync(parent, `
    if (process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN) process.exit(3);
    require('node:child_process').spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit' });
    setTimeout(() => process.exit(0), 11000);
  `);
  const saved = scripts.upsertCustomScript(dataDir, { name: 'Process tree', scriptPath: parent, args: [descendant, pulse], timeoutSec: 5 });
  const key = 'ANTIGRAVITY_SIDECAR_UI_TOKEN';
  const previous = process.env[key];
  let pending;
  try {
    process.env[key] = 'test-token';
    pending = scripts.runCustomScript(dataDir, saved.script.id);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  const result = await pending;
  assert.equal(result.timedOut, true);
  assert.ok(fs.existsSync(pulse), 'descendant was started');
  const size = fs.statSync(pulse).size;
  await delay(300);
  assert.equal(fs.statSync(pulse).size, size, 'descendant stopped making progress');
}));
