import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { getNotifyConfigApi, saveNotifyConfigApi, startStudioSidecar, registerStudioApis, performStudioSelfUpdate, runSubprocessReinject, spawnDetachedSafe, createRemoteLocaleManifestCache, requiresBackendRestart, queryHostSideQuestions, openSideQuestionInHost, getLiveTasksApi } from '../sidecars/studio/main.mjs';

const require = createRequire(import.meta.url);
const notify = require('../src/notify-core.js');
const scripts = require('../src/scripts-core.js');

async function withDataDir(fn) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-security-')));
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
  assert.match(html, /apiFetch\('\/api\/i18n-pack\/sync',\s*\{\s*body:\s*JSON\.stringify\(\{\s*lang:/);
  assert.match(html, /apiFetch\('\/api\/i18n-pack\/reset',\s*\{\s*body:\s*JSON\.stringify\(\{\s*lang:/);
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

test('reinject and detached tools receive no Sidecar credentials', async () => withDataDir(async (root) => {
  const names = ['ANTIGRAVITY_SIDECAR_UI_TOKEN', 'Antigravity_Sidecar_Future_Key'];
  const previous = names.map((key) => process.env[key]);
  try {
    for (const key of names) process.env[key] = 'secret-sentinel';
    fs.mkdirSync(path.join(root, 'src'));
    const script = path.join(root, 'src', 'inject.js');
    fs.writeFileSync(script, `require('fs').writeFileSync('child-env.json', JSON.stringify(
      Object.keys(process.env).filter(key => /^ANTIGRAVITY_SIDECAR_/i.test(key))));`);
    const marker = path.join(root, 'child-env.json');
    assert.equal((await runSubprocessReinject(root)).ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker)), []);
    fs.unlinkSync(marker);
    assert.equal((await spawnDetachedSafe(process.execPath, [script], { cwd: root })).ok, true);
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await delay(20);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker)), []);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}));

test('git update fast-forwards to the requested annotated tag, even when upstream is newer', async () => withDataDir(async (root) => {
  const remote = path.join(root, 'origin');
  const pluginDir = path.join(root, 'install');
  fs.mkdirSync(remote);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(remote, 'init', '-b', 'main');
  git(remote, 'config', 'user.name', 'Fixture');
  git(remote, 'config', 'user.email', 'fixture@example.invalid');
  function commit(version) {
    fs.writeFileSync(path.join(remote, 'package.json'), JSON.stringify({ version }));
    git(remote, 'add', 'package.json');
    git(remote, '-c', 'commit.gpgSign=false', 'commit', '-m', version);
  }
  commit('1.0.0');
  git(remote, 'tag', 'v1.0.0');
  git(root, 'clone', remote, pluginDir);
  commit('2.0.0');
  git(remote, '-c', 'tag.gpgSign=false', 'tag', '-a', 'v2.0.0', '-m', 'release');
  commit('3.0.0');
  git(pluginDir, 'fetch', 'origin');
  const result = await performStudioSelfUpdate({ pluginDir, targetTag: 'v2.0.0', reinjectFn: () => ({ code: 2, stderr: 'reinject exit 2' }) });
  assert.equal(result.version, '2.0.0');
  assert.equal(result.filesUpdated, true);
  assert.equal(result.reinjectOk, false);
  assert.equal(result.needsRestart, true);
  assert.match(result.reinjectError, /exit 2/);
  assert.equal(git(pluginDir, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'v2.0.0^{commit}'));
  assert.notEqual(git(pluginDir, 'rev-parse', 'HEAD'), git(pluginDir, 'rev-parse', '@{upstream}'));
  const older = await performStudioSelfUpdate({ pluginDir, targetTag: 'v1.0.0' });
  assert.equal(older.reason, 'not_fast_forward');
  assert.equal(older.filesUpdated, false);
}));

test('remote manifest retries failures and empty lists after 30 seconds and retains stale data', async () => {
  let time = 0;
  let attempts = 0;
  const first = { locales: { ja: { version: '1' } } };
  const latest = { locales: { ja: { version: '2' } } };
  const replies = [new Error('offline'), first, { locales: {} }, latest];
  const cache = createRemoteLocaleManifestCache(() => {
    const reply = replies[attempts++];
    if (reply instanceof Error) throw reply;
    return reply;
  }, () => time);
  const settle = () => new Promise((done) => setImmediate(done));
  assert.deepEqual(cache.read(), { value: null, stale: true });
  cache.read();
  await settle();
  time = 29_999;
  cache.read();
  await settle();
  assert.equal(attempts, 1);
  time++;
  cache.read();
  await settle();
  time += 599_999;
  assert.deepEqual(cache.read(), { value: first, stale: false });
  time++;
  assert.deepEqual(cache.read(), { value: first, stale: true });
  await settle();
  time += 29_999;
  assert.deepEqual(cache.read(), { value: first, stale: true });
  await settle();
  assert.equal(attempts, 3);
  time++;
  cache.read();
  await settle();
  assert.deepEqual(cache.read(), { value: latest, stale: false });
});

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
    if (Object.keys(process.env).some(key => key.toUpperCase().startsWith('ANTIGRAVITY_SIDECAR_'))) process.exit(3);
    require('node:child_process').spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit' });
    setTimeout(() => process.exit(0), 11000);
  `);
  const saved = scripts.upsertCustomScript(dataDir, { name: 'Process tree', scriptPath: parent, args: [descendant, pulse], timeoutSec: 5 });
  const key = 'ANTIGRAVITY_SIDECAR_UI_TOKEN';
  const previous = process.env[key];
  const future = 'ANTIGRAVITY_SIDECAR_FUTURE_TOKEN';
  const previousFuture = process.env[future];
  let pending;
  try {
    process.env[key] = 'test-token';
    process.env[future] = 'test-future-token';
    pending = scripts.runCustomScript(dataDir, saved.script.id);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    if (previousFuture === undefined) delete process.env[future];
    else process.env[future] = previousFuture;
  }
  const result = await pending;
  assert.equal(result.timedOut, true);
  assert.ok(fs.existsSync(pulse), 'descendant was started');
  const size = fs.statSync(pulse).size;
  await delay(300);
  assert.equal(fs.statSync(pulse).size, size, 'descendant stopped making progress');
}));

test('requiresBackendRestart only flags persistent backend files and UI refreshes status on needsRestart', () => {
  for (const file of [
    'plugin/mcp-host.js',
    'sidecars/studio/main.mjs',
    'src/cdp.js',
    'src/lifecycle.js',
    'src/watcher-core.js',
    'src/scripts-core.js',
    'src/notify-core.js',
    'src/i18n-sync.js',
    'src/sidecar-core.js',
    'src/inject.js',
    'src/remove.js',
    'src/periodic-sync.js',
    'src/periodic-core.js',
    'scripts/unknown-backend-helper.mjs',
    'package.json',
    'plugin.json',
  ]) {
    assert.equal(requiresBackendRestart(file), true, `expected backend restart for ${file}`);
  }
  for (const file of [
    'src/ui-runtime.js',
    'src/style.css',
    'src/usage-core.js',
    'src/effort-core.js',
    'src/i18n-core.js',
    'src/ripple-core.js',
    'src/mascot-core.js',
    'sidecars/studio/index.html',
    'locales/zh-CN.json',
    'skills/studio-doctor/SKILL.md',
    'README.md',
  ]) {
    assert.equal(requiresBackendRestart(file), false, `did not expect backend restart for ${file}`);
  }

  const studioHtml = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sidecars', 'studio', 'index.html'), 'utf8');
  assert.match(
    studioHtml,
    /if \(data\.reinjectOk === false \|\| data\.needsRestart === true\) \{\s*showToast\(t\.upgradeNeedsRestart\);\s*await refreshStatus\(\);\s*return;\s*\}/
  );
});

test('openSideQuestionInHost stops immediately on draft_present and continues only on miss', async () => {
  const evaluatedTargets = [];
  const makeCdp = (responsesByTarget) => ({
    readActivePorts: () => [9222],
    async listPages() {
      return Object.keys(responsesByTarget).map((id) => ({
        url: `vscode-webview://${id}`,
        webSocketDebuggerUrl: `ws://127.0.0.1:9222/${id}`,
      }));
    },
    isAntigravityPageTarget: () => true,
    CdpSession: {
      async connect(wsUrl) {
        const id = wsUrl.split('/').pop();
        return {
          async evaluate() {
            evaluatedTargets.push(id);
            return responsesByTarget[id];
          },
          close() {},
        };
      },
    },
  });

  const draftRes = await openSideQuestionInHost(
    { conversationId: 'conv-1' },
    {
      cdpClient: makeCdp({
        'win-1': { ok: false, reason: 'draft_present' },
        'win-2': { ok: true, status: 'opened' },
      }),
    }
  );
  assert.deepEqual(draftRes, { ok: false, reason: 'draft_present' });
  assert.deepEqual(evaluatedTargets, ['win-1']);

  evaluatedTargets.length = 0;
  const actionDraftRes = await openSideQuestionInHost(
    { conversationId: 'conv-1' },
    {
      cdpClient: makeCdp({
        'win-1': { ok: false, action: 'draft_present' },
        'win-2': { ok: true, status: 'opened' },
      }),
    }
  );
  assert.deepEqual(actionDraftRes, { ok: false, action: 'draft_present' });
  assert.deepEqual(evaluatedTargets, ['win-1']);

  evaluatedTargets.length = 0;
  const fallbackRes = await openSideQuestionInHost(
    { conversationId: 'conv-2' },
    {
      cdpClient: makeCdp({
        'win-1': { ok: false, reason: 'conversation_not_found' },
        'win-2': { ok: true, status: 'opened' },
      }),
    }
  );
  assert.deepEqual(fallbackRes, { ok: true, status: 'opened' });
  assert.deepEqual(evaluatedTargets, ['win-1', 'win-2']);

  // Multi-port cross-window sorting: matching conversationId on second port is prioritized before non-matching window on first port
  const crossPortTargets = [];
  const multiPortCdp = {
    readActivePorts: () => [9222, 9223],
    async listPages(port) {
      if (port === 9222) {
        return [{ url: 'vscode-webview://win-a', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/win-a' }];
      }
      return [{ url: 'vscode-webview://conv-target', webSocketDebuggerUrl: 'ws://127.0.0.1:9223/win-b' }];
    },
    isAntigravityPageTarget: () => true,
    CdpSession: {
      async connect(wsUrl) {
        const id = wsUrl.split('/').pop();
        return {
          async evaluate(expr) {
            crossPortTargets.push(id);
            if (expr.includes('getSideQuestionsState')) {
              return id === 'win-b'
                ? { ok: true, conversationId: 'conv-target', items: [{ question: 'Q1' }] }
                : { ok: false, reason: 'conversation_not_found' };
            }
            return id === 'win-b'
              ? { ok: true, status: 'opened', conversationId: 'conv-target' }
              : { ok: false, reason: 'conversation_not_found' };
          },
          close() {},
        };
      },
    },
  };

  const crossOpen = await openSideQuestionInHost({ conversationId: 'conv-target' }, { cdpClient: multiPortCdp });
  assert.equal(crossOpen.ok, true);
  assert.deepEqual(crossPortTargets, ['win-b']);

  crossPortTargets.length = 0;
  const crossQuery = await queryHostSideQuestions('conv-target', { cdpClient: multiPortCdp });
  assert.equal(crossQuery.ok, true);
  assert.equal(crossQuery.conversationId, 'conv-target');
  assert.deepEqual(crossPortTargets, ['win-b']);
});

test('getLiveTasksApi does not backfill sideQuestions when unbound is true', async () => {
  const res = await getLiveTasksApi({
    allowCdpFallback: false,
    conversationId: '',
    unbound: true,
    fetchFn: async (url) => {
      if (String(url).includes('ListConversations')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              conversations: [
                { id: 'old-conv-1', state: { runState: 'RUN_STATE_IDLE', summary: 'Old chat' } },
              ],
            };
          },
        };
      }
      return { ok: true, status: 200, async json() { return { trajectorySummaries: {} }; } };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.sideQuestionConvoId, '');
  assert.deepEqual(res.sideQuestions, []);
});

test('spawnDetachedSafe preserves caller options.env while stripping Sidecar credentials', async () => withDataDir(async (root) => {
  const script = path.join(root, 'env-check.cjs');
  const outPath = path.join(root, 'detached-env.json');
  fs.writeFileSync(script, `
    require('node:fs').writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({
      custom: process.env.CUSTOM_SAFE_VAR || null,
      sidecar: Object.keys(process.env).filter(k => /^ANTIGRAVITY_SIDECAR_/i.test(k)),
    }));
  `);
  const res = await spawnDetachedSafe(process.execPath, [script], {
    cwd: root,
    env: {
      ...process.env,
      CUSTOM_SAFE_VAR: 'kept-value',
      ANTIGRAVITY_SIDECAR_UI_TOKEN: 'secret-should-strip',
    },
  });
  assert.equal(res.ok, true);
  for (let i = 0; i < 100 && !fs.existsSync(outPath); i++) await delay(20);
  const recorded = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(recorded.custom, 'kept-value');
  assert.deepEqual(recorded.sidecar, []);
}));
