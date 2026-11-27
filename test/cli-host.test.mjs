import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import cdp from '../src/cdp.js';
import notify from '../src/notify-core.js';
import scripts from '../src/scripts-core.js';

const plugin = 'agy-claude-studio';
const hostScript = fileURLToPath(new URL('../plugin/mcp-host.js', import.meta.url));

function fixture(t) {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cli-host-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const base = path.join(home, '.gemini');
  const data = (host, kind = 'plugin_data') => path.join(base, host, kind, plugin);
  return { home, data, desktop: data('antigravity'), cli: data('antigravity-cli') };
}

test('CLI host detection matches whole normalized path segments in either path syntax', () => {
  for (const raw of [String.raw`C:\.gemini\Antigravity-CLI\PLUGIN_DATA\Example` + '\\',
    '/home/a/antigravity-cli/sidecar_data/Example/studio/', 'antigravity-cli/plugin_data']) {
    assert.equal(cdp.isCliPluginDataPath(raw), true, raw);
  }
  for (const raw of ['/antigravity/plugin_data/x', '/antigravity-ide/sidecar_data/x',
    '/antigravity-cli-copy/plugin_data/x', '/not-antigravity-cli/plugin_data/x',
    '/antigravity-cli/plugin_data_old/x', '/antigravity-cli/plugin_data/../../antigravity/plugin_data/x',
    '${PLUGIN_DATA}', '', undefined]) {
    assert.equal(cdp.isCliPluginDataPath(raw), false, raw);
  }
});

test('CLI host detection uses the first expanded host hint, ignoring test sidecars', () => {
  const cli = '/antigravity-cli/plugin_data/x';
  const desktop = '/antigravity/plugin_data/x';
  const sidecar = { ANTIGRAVITY_EXECUTABLE_DATA_DIR: '/antigravity-cli/sidecar_data/x/studio' };
  const explicit = (current, legacy) => ({ AGY_CLAUDE_STUDIO_PLUGIN_DATA: current, AGY_CLAUDE_STYLE_PLUGIN_DATA: legacy });
  for (const [env, expected] of [
    [{ ...sidecar, ...explicit(desktop, cli), PLUGIN_DATA: cli }, false],
    [{ ...sidecar, ...explicit('${PLUGIN_DATA}', desktop), PLUGIN_DATA: cli }, false],
    [{ ...explicit('  ', cli), PLUGIN_DATA: desktop }, true],
    [{ ...sidecar, PLUGIN_DATA: desktop }, false],
    [{ ...explicit('${PLUGIN_DATA}'), PLUGIN_DATA: cli }, true],
    [{ ...sidecar, PLUGIN_DATA: '${PLUGIN_DATA}' }, true],
    [{ ...sidecar, ANTIGRAVITY_LS_ADDRESS: 'test.invalid' }, false],
    [{ PLUGIN_DATA: cli, ANTIGRAVITY_LS_ADDRESS: 'test.invalid' }, true],
    [{}, false],
  ]) assert.equal(cdp.isAntigravityCliHost(env), expected, JSON.stringify(env));
});

test('only an exact CLI plugin root can share an existing desktop data directory', t => {
  const { data, desktop } = fixture(t);
  const cli = data('Antigravity-CLI', 'PLUGIN_DATA');
  const sidecar = path.join(data('Antigravity-CLI', 'Sidecar_Data'), 'studio');
  assert.equal(cdp.resolvePluginDataDir({ AGY_CLAUDE_STUDIO_PLUGIN_DATA: '${PLUGIN_DATA}' }), null);
  for (const dir of [desktop, data('antigravity-ide'), path.dirname(cli), path.join(cli, 'nested'), sidecar]) {
    assert.equal(cdp.normalizeCliPluginDataDir(dir, { existsSync: () => assert.fail('unexpected sibling lookup') }), dir);
  }
  for (const exists of [false, true]) {
    if (exists) fs.mkdirSync(desktop, { recursive: true });
    const expected = exists ? desktop : cli;
    const hook = { PLUGIN_DATA: cli };
    const explicit = { AGY_CLAUDE_STUDIO_PLUGIN_DATA: cli };
    assert.equal(cdp.normalizeCliPluginDataDir(cli + path.sep), expected);
    assert.equal(cdp.resolvePluginDataDir(explicit), expected);
    assert.equal(cdp.resolvePluginDataDir({ ANTIGRAVITY_EXECUTABLE_DATA_DIR: sidecar }), exists ? desktop : data('Antigravity-CLI'));
    assert.equal(notify.resolveNotifyDataDir(hook), expected);
    assert.equal(notify.resolveNotifyDataDir({ ...explicit, PLUGIN_DATA: '${PLUGIN_DATA}' }), expected);
    assert.equal(notify.resolveNotifyDataDir({ ...hook, AGY_CLAUDE_STUDIO_NOTIFY_DATA_DIR: cli }), cli);
    assert.equal(scripts.resolveScriptsDataDir(hook), expected);
  }
  assert.equal(scripts.resolveScriptsDataDir({ PLUGIN_DATA: '${PLUGIN_DATA}' }, 'relative-fallback'), 'relative-fallback');
});

function frame(body, lsp) {
  const json = JSON.stringify(body);
  return lsp ? `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}` : `${json}\n`;
}

for (const hasDesktop of [false, true]) {
  test(`CLI MCP stdio remains isolated ${hasDesktop ? 'with' : 'without'} desktop data`, async t => {
    const { home, cli, desktop } = fixture(t);
    const config = '{ "pinRightPane": "off", "composerRestyle": false }\n';
    if (hasDesktop) {
      fs.mkdirSync(desktop, { recursive: true });
      fs.writeFileSync(path.join(desktop, 'config.json'), config);
    }
    const requests = [];
    const cdpProbe = http.createServer((req, res) => { requests.push(req.url); res.end('[]'); });
    cdpProbe.listen(0, '127.0.0.1');
    await once(cdpProbe, 'listening');
    t.after(() => new Promise(resolve => cdpProbe.close(resolve)));
    const env = { ...process.env, HOME: home, USERPROFILE: home, VSCODE_PORTABLE: home,
      APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home,
      ANTIGRAVITY_LS_ADDRESS: '', AG_CDP_PORT: String(cdpProbe.address().port),
      AGY_CLAUDE_STUDIO_SKIP_LAUNCHER_PROVISION: '1', AGY_CLAUDE_STUDIO_PLUGIN_DATA: cli,
      AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG: path.join(home, 'host.json') };
    for (const key of ['STATE_DIR', 'CONFIG']) {
      delete env[`AGY_CLAUDE_STUDIO_${key}`];
      delete env[`AGY_CLAUDE_STYLE_${key}`];
    }
    const child = spawn(process.execPath, [hostScript], { env, cwd: home, timeout: 10000, windowsHide: true });
    const closed = once(child, 'close');
    const stderr = text(child.stderr);
    const stdout = text(child.stdout);
    const firstReply = once(child.stdout, 'data');
    const rpc = (id, method) => ({ jsonrpc: '2.0', id, method });
    const lsp = hasDesktop;
    const assertIsolated = () => {
      assert.equal(fs.existsSync(cli), false, 'CLI state directory created');
      assert.deepEqual(fs.existsSync(desktop) ? fs.readdirSync(desktop) : null, hasDesktop ? ['config.json'] : null);
      if (hasDesktop) assert.equal(fs.readFileSync(path.join(desktop, 'config.json'), 'utf8'), config);
      assert.equal(fs.existsSync(path.join(home, 'argv.json')), false);
      assert.deepEqual(requests, [], 'unexpected desktop CDP traffic');
    };
    try {
      child.stdin.write(frame({ ...rpc(1, 'initialize'), params: { protocolVersion: '2025-11-25' } }, lsp));
      await Promise.race([firstReply, closed.then(() => assert.fail('host exited before initialize'))]);
      assertIsolated();
      // Disabling the plugin normally triggers UI removal on desktop shutdown.
      fs.writeFileSync(env.AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG, JSON.stringify({ plugins: { [plugin]: { enabled: false } } }));
      const methods = ['tools/list', 'ping', 'resources/list', 'resources/templates/list', 'prompts/list'];
      child.stdin.end(methods.map((method, i) => frame(rpc(i + 2, method), lsp)).join(''));
      assert.deepEqual(await closed, [0, null], await stderr);
      const results = [{ protocolVersion: '2025-11-25', capabilities: { tools: {} },
        serverInfo: { name: 'agy-claude-studio-host', version: cdp.PLUGIN_VERSION } },
        { tools: [] }, {}, { resources: [] }, { resourceTemplates: [] }, { prompts: [] }];
      assert.equal(await stdout, results.map((result, i) => frame({ jsonrpc: '2.0', id: i + 1, result }, lsp)).join(''));
      assertIsolated();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    }
  });
}
