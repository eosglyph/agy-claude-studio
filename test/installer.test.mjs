import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

function runExe(exePath, args, timeoutMs = 20000, extraEnv = null) {
  return new Promise((resolve, reject) => {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const child = spawn(exePath, args, { stdio: 'ignore', windowsHide: true, env });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout running ${path.basename(exePath)} ${args.join(' ')}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(exePath)} exited with code ${code}`));
    });
  });
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listCsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listCsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.cs')) {
      out.push(full);
    }
  }
  return out;
}

import { createManifest, getArtifactNames, normalizeVersion } from '../scripts/build-common.mjs';
import { VALIDATORS, buildInstaller } from '../scripts/build-installer.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT_DIR, 'cdp.js'));

function createMockCdpServer() {
  const receivedCalls = [];
  const sockets = new Set();
  let claudeStyleMounted = false;
  let lastInjectedExpr = null;
  let lastRemovedExpr = null;

  function encodeWsTextFrame(str) {
    const payload = Buffer.from(str, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  function sendWsMessage(socket, obj) {
    if (!socket.destroyed) {
      socket.write(encodeWsTextFrame(JSON.stringify(obj)));
    }
  }

  function handleCdpCommand(socket, msg) {
    receivedCalls.push(msg);
    let result = {};
    if (msg.method === 'Page.addScriptToEvaluateOnNewDocument') {
      result = { identifier: 'script-' + receivedCalls.length };
    } else if (msg.method === 'Runtime.evaluate') {
      const expr = msg.params && msg.params.expression ? msg.params.expression : '';
      if (expr === 'Boolean(window.__agClaudeStudio)') {
        result = { result: { type: 'boolean', value: claudeStyleMounted } };
      } else if (expr.includes('delete globalThis.__agCsUiMain')) {
        lastRemovedExpr = expr;
        claudeStyleMounted = false;
        result = { result: { type: 'object', value: { removed: 3 } } };
      } else {
        lastInjectedExpr = expr;
        claudeStyleMounted = true;
        const evalStatus = expr.includes("status: 'refreshed'") ? 'refreshed' : 'ok';
        result = {
          result: {
            type: 'object',
            value: { version: cdp.PLUGIN_VERSION, status: evalStatus, state: { mounted: true } },
          },
        };
      }
    }
    sendWsMessage(socket, { id: msg.id, result });
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      const addr = server.address();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 'PAGE_1',
            type: 'page',
            title: 'Antigravity',
            url: 'https://127.0.0.1:9999/',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/PAGE_1`,
          },
          {
            id: 'DEVTOOLS_1',
            type: 'page',
            title: 'DevTools',
            url: 'devtools://devtools/bundled/inspector.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/DEVTOOLS_1`,
          },
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));

    let buf = Buffer.alloc(0);
    let fragChunks = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buf.length < 4) return;
          payloadLen = buf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buf.length < 10) return;
          payloadLen = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + payloadLen) return;
        let payload = buf.subarray(offset + maskLen, offset + maskLen + payloadLen);
        if (masked) {
          const mask = buf.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ mask[i & 3];
          }
          payload = unmasked;
        }
        buf = buf.subarray(offset + maskLen + payloadLen);

        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          // Ping -> Pong
          const pong = Buffer.alloc(2 + payload.length);
          pong[0] = 0x8a;
          pong[1] = payload.length;
          payload.copy(pong, 2);
          socket.write(pong);
          continue;
        }
        if (opcode === 0x1 || opcode === 0x0) {
          fragChunks.push(payload);
          if (fin) {
            const fullText = Buffer.concat(fragChunks).toString('utf8');
            fragChunks = [];
            try {
              const msg = JSON.parse(fullText);
              handleCdpCommand(socket, msg);
            } catch {}
          }
        }
      }
    });
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    },
    emitBindingCalled(name, payload) {
      for (const s of sockets) {
        sendWsMessage(s, {
          method: 'Runtime.bindingCalled',
          params: { name, payload: JSON.stringify(payload) },
        });
      }
    },
    getCalls() {
      return receivedCalls;
    },
    getLastInjectedExpr() {
      return lastInjectedExpr;
    },
    getLastRemovedExpr() {
      return lastRemovedExpr;
    },
    async close() {
      for (const s of sockets) s.destroy();
      if (!server.listening) return;
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function waitFor(fn, timeoutMs = 6000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

test('installer manifest validators match inject.js and cdp.js defaults', () => {
  const manifestKeys = Object.keys(VALIDATORS).sort();
  assert.deepEqual(manifestKeys, Object.keys(cdp.CONFIG_VALIDATORS).sort());
  for (const k of manifestKeys) {
    assert.ok(k in cdp.DEFAULT_CONFIG, `DEFAULT_CONFIG includes ${k}`);
    const rule = cdp.CONFIG_VALIDATORS[k];
    if (rule === 'boolean') {
      assert.equal(cdp.validateConfigSetting(k, true), true);
      assert.equal(cdp.validateConfigSetting(k, 'invalid'), false);
    } else if (Array.isArray(rule)) {
      assert.equal(cdp.validateConfigSetting(k, rule[0]), true);
      assert.equal(cdp.validateConfigSetting(k, '__invalid_opt__'), false);
    }
  }
  assert.equal(cdp.validateConfigSetting('pollIntervalMs', 3000), true);
  assert.equal(cdp.validateConfigSetting('pollIntervalMs', 50), false);
  assert.equal(cdp.validateConfigSetting('__unknown_key__', true), false);
});

test('unified artifact naming and version parity stay consistent across package, runtime, and installers', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const csClient = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'), 'utf8');
  const csSetup = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'setup', 'Program.cs'), 'utf8');
  const swiftClient = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'macos', 'Common', 'CdpClient.swift'), 'utf8');

  assert.equal(cdp.PLUGIN_VERSION, pkg.version);
  assert.equal(csClient.match(/GetString\(raw, "version", "([^"]+)"\)/)?.[1], pkg.version);
  assert.equal(csSetup.match(/SetValue\("DisplayVersion", version \?\? "([^"]+)"/)?.[1], pkg.version);
  assert.equal(swiftClient.match(/raw\["version"\]\?\.stringValue \?\? "([^"]+)"/)?.[1], pkg.version);

  assert.equal(normalizeVersion('v2.1.0'), '2.1.0');
  assert.equal(normalizeVersion('2.1.0'), '2.1.0');

  assert.deepEqual(getArtifactNames('v2.1.0'), {
    version: '2.1.0',
    windowsInstaller: 'Claude-Studio-v2.1.0-Windows-x64.exe',
    macosDmg: 'Claude-Studio-v2.1.0-macOS-universal.dmg',
    macosApp: 'Claude Studio.app',
  });
  assert.equal(createManifest('v2.1.0').version, '2.1.0');
});

test('Windows C# sources define managed launch contract and stay strictly C# 5 compatible', () => {
  const csClient = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'), 'utf8');
  const csWatcher = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'watcher', 'Program.cs'), 'utf8');
  const csSetup = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'setup', 'Program.cs'), 'utf8');

  assert.match(csClient, /public\s+const\s+int\s+DefaultStartupGraceSeconds\s*=\s*90\s*;/);
  assert.match(csClient, /EnsureAntigravityWithCdpAsync/);
  assert.match(csClient, /ActivateAntigravityWindow/);
  assert.ok(csClient.includes('"--managed"'), 'CdpClient.cs must treat --managed equivalently to --watch');
  assert.ok(csClient.includes('BuildConfigScriptExpression'));
  assert.ok(csClient.includes('ReadBundleAndCssHashes'));
  assert.ok(csClient.includes('__agCsOverrideConfig'));
  assert.ok(csClient.includes('plugin://swarm--'), 'CdpClient.cs must include Swarm sidecar iframe targets');
  assert.ok(csClient.includes("location.protocol === 'plugin:'"), 'CdpClient.cs must skip CSS injection in plugin: sidecars');
  assert.ok(createManifest('v2.1.0').parts.includes('sidecar-core.js'), 'Installer manifest must bundle sidecar-core.js');
  assert.equal(csClient.includes('System.Windows.Forms'), false, 'CdpClient.cs must not reference System.Windows.Forms');

  assert.match(csWatcher, /--launch/);
  assert.match(csWatcher, /--startup-grace/);
  assert.match(csWatcher, /AG_WATCH_POLL_MS/);
  assert.ok(csWatcher.includes('BootstrapScriptId'));
  assert.ok(csWatcher.includes('ConfigScriptId'));
  assert.ok(csWatcher.includes('GetConfigBool(initCfg, "autoRelaunchWithCdp", true)'));
  assert.ok(csWatcher.includes('GetConfigBool(nextCfg, "autoRelaunchWithCdp", true)'));
  assert.equal(csWatcher.includes('GetConfigBool(nextCfg, "autoRelaunchWithCdp")'), false);
  assert.equal(csWatcher.includes('"autoRelaunchWithCdp", false'), false);
  assert.equal(csWatcher.includes('System.Windows.Forms'), false, 'watcher/Program.cs must not reference System.Windows.Forms');

  assert.match(csSetup, /TargetPath[\s\S]*?watcherExe/);
  assert.match(csSetup, /--launch --relaunch --exit-on-host-close --dir/);
  assert.match(csSetup, /AGY_CS_TEST_SYSTEM_ROOT/);
  assert.ok(csSetup.includes('AGYClaudeStudioStop_'));
  assert.ok(csSetup.includes('WatcherPidStatus.Owned'));
  assert.ok(csSetup.includes('-LiteralPath'));

  const csFiles = listCsFiles(path.join(ROOT_DIR, 'installer'));
  assert.ok(csFiles.length >= 4, 'found installer C# source files');
  for (const file of csFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT_DIR, file);
    assert.equal(src.includes('$"'), false, `${rel} must not use C# 6 interpolated strings ($")`);
    assert.equal(src.includes('?.'), false, `${rel} must not use C# 6 null-conditional (?.)`);
    assert.equal(src.includes('?['), false, `${rel} must not use C# 6 null-conditional (?[)`);
    assert.equal(/\bnameof\s*\(/.test(src), false, `${rel} must not use C# 6 nameof(...)`);
    assert.equal(/\busing\s+var\b/.test(src), false, `${rel} must not use C# 8 using var`);
  }
});

test(
  'Windows managed mode, daemon mode switching, startup grace, and uninstall E2E',
  { skip: process.platform !== 'win32' ? 'Windows-only managed mode E2E test' : false },
  async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-managed-e2e-'));
    const testSysRoot = path.join(workDir, 'sysroot');
    const installerExe = path.join(workDir, 'installer.exe');
    const installDir = path.join(workDir, 'installed');

    const outManagedNoCdp = path.join(workDir, 'managed-nocdp.json');
    const outStatus1 = path.join(workDir, 'status1.json');
    const outManagedCdp = path.join(workDir, 'managed-cdp.json');
    const outDaemon = path.join(workDir, 'daemon.json');
    const outBackToManaged = path.join(workDir, 'back-managed.json');
    const outPreUninstallDaemon = path.join(workDir, 'pre-uninstall-daemon.json');
    const outUninstall = path.join(workDir, 'uninstall.json');

    const startupLnk = path.join(testSysRoot, 'Startup', 'Claude-Studio.lnk');
    const startMenuLnk = path.join(testSysRoot, 'StartMenu', 'Antigravity (Claude Studio).lnk');
    const desktopLnk = path.join(testSysRoot, 'Desktop', 'Antigravity (Claude Studio).lnk');
    const localLauncherLnk = path.join(installDir, 'Antigravity (Claude Studio).lnk');
    const pidFile = path.join(installDir, '.watch.pid');
    const modeFile = path.join(installDir, '.install-mode');

    const testEnv = {
      AGY_CS_TEST_SYSTEM_ROOT: testSysRoot,
      AGY_CS_NO_UI: '1',
      AG_WATCH_POLL_MS: '300',
    };

    const mockCdpA = createMockCdpServer();
    const mockCdpB = createMockCdpServer();

    try {
      buildInstaller({ outputPath: installerExe });
      assert.ok(fs.existsSync(installerExe));

      // 1) Fresh --silent --mode=managed --desktop-shortcut with NO CDP (--cdp-port 1)
      await runExe(
        installerExe,
        [
          '--silent',
          '--mode=managed',
          '--desktop-shortcut',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          '1',
          '--out',
          outManagedNoCdp,
        ],
        20000,
        testEnv
      );
      const res1 = JSON.parse(fs.readFileSync(outManagedNoCdp, 'utf8'));
      assert.equal(res1.ok, true);
      assert.equal(res1.runMode, 'managed');
      assert.equal(res1.watcherStarted, false);
      assert.equal(res1.startupShortcut, false);
      assert.equal(fs.readFileSync(modeFile, 'utf8').trim(), 'managed');
      assert.equal(fs.existsSync(pidFile), false);
      assert.equal(fs.existsSync(startupLnk), false);
      assert.equal(fs.existsSync(startMenuLnk), true);
      assert.equal(fs.existsSync(desktopLnk), true);
      assert.equal(fs.existsSync(localLauncherLnk), true);

      await runExe(
        installerExe,
        ['--status', '--install-dir', installDir, '--cdp-port', '1', '--out', outStatus1],
        10000,
        testEnv
      );
      const st1 = JSON.parse(fs.readFileSync(outStatus1, 'utf8'));
      assert.equal(st1.installed, true);
      assert.equal(st1.installedMode, 'managed');
      assert.equal(st1.runMode, 'managed');
      assert.equal(st1.watcherStarted, false);
      assert.equal(st1.startupShortcut, false);
      assert.equal(st1.startMenuShortcut, true);
      assert.equal(st1.desktopShortcut, true);
      assert.equal(st1.launcherShortcut, true);

      // 2) Managed install against running mock CDP server: injects and auto-exits on CDP close
      const portA = await mockCdpA.start();
      await runExe(
        installerExe,
        [
          '--silent',
          '--mode=managed',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(portA),
          '--out',
          outManagedCdp,
        ],
        20000,
        testEnv
      );
      const res2 = JSON.parse(fs.readFileSync(outManagedCdp, 'utf8'));
      assert.equal(res2.ok, true);
      assert.equal(res2.runMode, 'managed');
      assert.equal(res2.watcherStarted, true);
      assert.equal(res2.cdpPort, portA);
      assert.deepEqual(res2.injectedPages, ['Antigravity']);
      assert.equal(fs.existsSync(pidFile), true);
      const managedPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      assert.ok(isPidAlive(managedPid), 'managed watcher process is alive while mock CDP is up');

      await mockCdpA.close();
      await waitFor(
        () => (!fs.existsSync(pidFile) && !isPidAlive(managedPid) ? true : null),
        10000,
        100
      );
      assert.equal(fs.existsSync(pidFile), false);

      // 3) Mode switch managed -> daemon against mock CDP: Startup shortcut created, watcher stays running
      const portB = await mockCdpB.start();
      await runExe(
        installerExe,
        [
          '--silent',
          '--mode=daemon',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(portB),
          '--out',
          outDaemon,
        ],
        20000,
        testEnv
      );
      const res3 = JSON.parse(fs.readFileSync(outDaemon, 'utf8'));
      assert.equal(res3.ok, true);
      assert.equal(res3.runMode, 'daemon');
      assert.equal(res3.watcherStarted, true);
      assert.equal(res3.startupShortcut, true);
      assert.equal(fs.readFileSync(modeFile, 'utf8').trim(), 'daemon');
      assert.equal(fs.existsSync(startupLnk), true);
      assert.equal(fs.existsSync(pidFile), true);
      const daemonPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      assert.ok(isPidAlive(daemonPid), 'daemon watcher process is alive');

      await mockCdpB.close();
      await new Promise((r) => setTimeout(r, 1500));
      assert.ok(isPidAlive(daemonPid), 'daemon watcher stays alive after mock CDP closes');
      assert.equal(fs.existsSync(pidFile), true);

      // 4) Mode switch daemon -> managed with no CDP (--cdp-port 1): Startup shortcut DELETED, old daemon stopped
      await runExe(
        installerExe,
        [
          '--silent',
          '--mode=managed',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          '1',
          '--out',
          outBackToManaged,
        ],
        20000,
        testEnv
      );
      const res4 = JSON.parse(fs.readFileSync(outBackToManaged, 'utf8'));
      assert.equal(res4.ok, true);
      assert.equal(res4.runMode, 'managed');
      assert.equal(res4.watcherStarted, false);
      assert.equal(res4.startupShortcut, false);
      assert.equal(fs.readFileSync(modeFile, 'utf8').trim(), 'managed');
      assert.equal(fs.existsSync(startupLnk), false);
      assert.equal(isPidAlive(daemonPid), false);
      assert.equal(fs.existsSync(pidFile), false);

      // 5) Standalone watcher --watch --exit-on-host-close --startup-grace 1 --cdp-port 1 exits cleanly (code 0)
      const watcherExe = path.join(installDir, 'agy-claude-studio-watcher.exe');
      await runExe(
        watcherExe,
        ['--watch', '--exit-on-host-close', '--startup-grace', '1', '--cdp-port', '1', '--dir', installDir],
        12000,
        testEnv
      );
      assert.equal(fs.existsSync(pidFile), false);

      // 6) --uninstall removes Startup, StartMenu, Desktop shortcuts and installDir
      await runExe(
        installerExe,
        [
          '--silent',
          '--mode=daemon',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          '1',
          '--out',
          outPreUninstallDaemon,
        ],
        20000,
        testEnv
      );
      assert.equal(fs.existsSync(startupLnk), true);
      assert.equal(fs.existsSync(startMenuLnk), true);
      assert.equal(fs.existsSync(desktopLnk), true);

      await runExe(
        installerExe,
        [
          '--uninstall',
          '--silent',
          '--install-dir',
          installDir,
          '--cdp-port',
          '1',
          '--out',
          outUninstall,
        ],
        20000,
        testEnv
      );
      const res6 = JSON.parse(fs.readFileSync(outUninstall, 'utf8'));
      assert.equal(res6.ok, true);
      assert.equal(res6.startupShortcut, false);
      assert.equal(fs.existsSync(startupLnk), false);
      assert.equal(fs.existsSync(startMenuLnk), false);
      assert.equal(fs.existsSync(desktopLnk), false);
      assert.equal(fs.existsSync(installDir), false);
    } finally {
      try {
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
          if (pid) process.kill(pid);
        }
      } catch {}
      try { await mockCdpA.close(); } catch {}
      try { await mockCdpB.close(); } catch {}
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  }
);

test(
  'installer.exe builds cleanly and executes full install, CDP injection, setting sync, upgrade, and uninstall lifecycle',
  { skip: process.platform !== 'win32' ? 'Windows-only installer.exe E2E test' : false },
  async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-e2e-'));
  const installerExe = path.join(workDir, 'installer.exe');
  const installDir = path.join(workDir, 'installed');
  const outInstall = path.join(workDir, 'install.json');
  const outUpgrade = path.join(workDir, 'upgrade.json');
  const outUninstall = path.join(workDir, 'uninstall.json');
  const outStatus = path.join(workDir, 'status.json');
  const mockCdp = createMockCdpServer();

  try {
    const buildRes = buildInstaller({ outputPath: installerExe });
    assert.ok(fs.existsSync(installerExe));
    assert.ok(buildRes.sizeBytes > 200 * 1024);

    const port = await mockCdp.start();

    // 1. Check --status CLI
    await runExe(
      installerExe,
      ['--status', '--install-dir', installDir, '--cdp-port', String(port), '--out', outStatus],
      10000
    );
    const st = JSON.parse(fs.readFileSync(outStatus, 'utf8'));
    assert.equal(st.installed, false);
    assert.equal(st.cdpPort, port);

    // 2. Run --silent install against mock CDP server
    await runExe(
      installerExe,
      [
        '--silent',
        '--no-autostart',
        '--no-kill-legacy',
        '--install-dir',
        installDir,
        '--cdp-port',
        String(port),
        '--out',
        outInstall,
      ],
      20000
    );

    const installResult = JSON.parse(fs.readFileSync(outInstall, 'utf8'));
    assert.equal(installResult.ok, true);
    assert.equal(installResult.preservedExistingConfig, false);
    assert.deepEqual(installResult.injectedPages, ['Antigravity']);
    assert.ok(fs.existsSync(path.join(installDir, 'agy-claude-studio-watcher.exe')));
    assert.ok(fs.existsSync(path.join(installDir, 'agy-claude-studio-installer.exe')));
    assert.ok(fs.existsSync(path.join(installDir, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(installDir, '.watch.pid')));

    const activeCfgPath = fs.existsSync(path.join(ROOT_DIR, 'config.json'))
      ? path.join(ROOT_DIR, 'config.json')
      : path.join(ROOT_DIR, 'config.example.json');
    const expectedCfg = fs.readFileSync(activeCfgPath, 'utf8');
    assert.equal(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'), expectedCfg);

    // Verify exact CDP sequence & valid JS payload
    const calls = mockCdp.getCalls();
    assert.ok(calls.some((c) => c.method === 'Page.enable'));
    assert.ok(calls.some((c) => c.method === 'Runtime.enable'));
    assert.ok(
      calls.some(
        (c) =>
          c.method === 'Runtime.addBinding' &&
          c.params &&
          c.params.name === cdp.SETTING_BINDING
      )
    );
    assert.ok(calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument'));
    const injectedExpr = mockCdp.getLastInjectedExpr();
    assert.ok(injectedExpr, 'injected expression was sent over CDP');
    assert.doesNotThrow(() => new vm.Script(injectedExpr), 'C# injected JS compiles cleanly');

    // Verify codeHash parity and active config values between Node cdp.js and C# watcher
    const nodeExpr = cdp.buildInjectExpression();
    const nodeHash = nodeExpr.match(/"codeHash":"([^"]+)"/)[1];
    const csHash = injectedExpr.match(/"codeHash":"([^"]+)"/)[1];
    assert.equal(csHash, nodeHash);
    const expectedCfgObj = JSON.parse(expectedCfg);
    assert.ok(injectedExpr.includes(`"palette":"${expectedCfgObj.palette}"`));
    assert.ok(injectedExpr.includes(`"ringMode":"${expectedCfgObj.ringMode}"`));

    // Verify watcher --once CLI mode works standalone against CDP
    const watcherExe = path.join(installDir, 'agy-claude-studio-watcher.exe');
    const onceOut = path.join(workDir, 'once.json');
    await runExe(
      watcherExe,
      ['--once', '--dir', installDir, '--cdp-port', String(port), '--out', onceOut],
      10000
    );
    const onceResult = JSON.parse(fs.readFileSync(onceOut, 'utf8'));
    assert.equal(onceResult.ok, true);
    assert.deepEqual(onceResult.pages, ['Antigravity']);

    // 3. Test Runtime.bindingCalled -> config.json update & hot-reload
    const targetPalette = expectedCfgObj.palette === 'claude' ? 'obsidian' : 'claude';
    const beforeCallCount = mockCdp.getCalls().length;
    mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: 'hacker-invalid' });
    mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: targetPalette });

    const updatedCfg = await waitFor(() => {
      const parsed = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
      return parsed.palette === targetPalette ? parsed : null;
    });
    assert.equal(updatedCfg.palette, targetPalette);

    // Confirm hot-reload fired on watcher without re-sending ~1.4MB payload
    await waitFor(() => {
      const newer = mockCdp.getCalls().slice(beforeCallCount);
      const hasRemove = newer.some((c) => c.method === 'Page.removeScriptToEvaluateOnNewDocument');
      const hasAdd = newer.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument');
      return hasRemove && hasAdd ? true : null;
    });
    const reloadCalls = mockCdp.getCalls().slice(beforeCallCount);
    const reloadAddCalls = reloadCalls.filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument');
    assert.ok(reloadAddCalls.length >= 1);
    const maxReloadLen = Math.max(...reloadAddCalls.map((c) => (c.params?.source || '').length));
    assert.ok(maxReloadLen < 2048, `Expected short config script (<2KB) on C# hot-reload, got ${maxReloadLen}`);

    // Verify compiled C# watcher --remove refuses to kill a foreign PID stored in .watch.pid
    const probeDir = path.join(workDir, 'foreign-pid-probe');
    fs.mkdirSync(probeDir, { recursive: true });
    const foreignProc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    try {
      await new Promise((r) => setTimeout(r, 150));
      fs.writeFileSync(path.join(probeDir, '.watch.pid'), String(foreignProc.pid), 'utf8');
      await runExe(watcherExe, ['--remove', '--dir', probeDir], 10000);
      assert.equal(foreignProc.exitCode, null, 'C# watcher --remove must NOT terminate a foreign PID');
      assert.equal(fs.existsSync(path.join(probeDir, '.watch.pid')), false, 'Stale foreign .watch.pid should be cleared');
    } finally {
      try { foreignProc.kill('SIGKILL'); } catch {}
    }

    // 4. Test re-install / upgrade preserves existing user config.json
    await runExe(
      installerExe,
      [
        '--silent',
        '--no-autostart',
        '--no-kill-legacy',
        '--install-dir',
        installDir,
        '--cdp-port',
        String(port),
        '--out',
        outUpgrade,
      ],
      20000
    );
    const upgradeResult = JSON.parse(fs.readFileSync(outUpgrade, 'utf8'));
    assert.equal(upgradeResult.ok, true);
    assert.equal(upgradeResult.preservedExistingConfig, true);
    const cfgAfterUpgrade = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
    assert.equal(cfgAfterUpgrade.palette, targetPalette);

    // 5. Test --uninstall from installed copy inside installDir (exercises self-delete & CDP cleanup)
    const installedSelf = path.join(installDir, 'agy-claude-studio-installer.exe');
    await runExe(
      installedSelf,
      [
        '--uninstall',
        '--silent',
        '--no-autostart',
        '--install-dir',
        installDir,
        '--cdp-port',
        String(port),
        '--out',
        outUninstall,
      ],
      20000
    );

    const uninstallResult = JSON.parse(fs.readFileSync(outUninstall, 'utf8'));
    assert.equal(uninstallResult.ok, true);
    assert.equal(uninstallResult.selfDeleteScheduled, true);
    assert.deepEqual(uninstallResult.injectedPages, ['Antigravity']);
    assert.equal(mockCdp.getLastRemovedExpr(), cdp.REMOVE_EXPRESSION);

    await waitFor(() => (!fs.existsSync(installDir) ? true : null), 8000, 150);
    assert.equal(fs.existsSync(installDir), false);
  } finally {
    // Best-effort cleanup of any lingering watcher in workDir
    try {
      const pidPath = path.join(installDir, '.watch.pid');
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
        if (pid) process.kill(pid);
      }
    } catch {}
    await mockCdp.close();
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
});
