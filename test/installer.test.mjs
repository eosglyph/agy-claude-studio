import test from 'node:test';
import { verifyNativeToggle } from './native-watcher-toggle.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawn } from 'node:child_process';
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

function findCsc() {
  const winDir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('csc.exe (.NET Framework 4.x) not found');
}

function readLnkMetadata(lnkPath) {
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    '$sh = New-Object -ComObject WScript.Shell',
    '$s = $sh.CreateShortcut($env:AGY_LNK_PATH)',
    '@{ targetPath = $s.TargetPath; arguments = $s.Arguments; workingDirectory = $s.WorkingDirectory; iconLocation = $s.IconLocation } | ConvertTo-Json -Compress',
  ].join('\n');
  const out = execFileSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, AGY_LNK_PATH: lnkPath },
    }
  );
  return JSON.parse(out.trim());
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
import {
  VALIDATORS,
  collectPluginPayloadFiles,
  buildPluginZip,
  buildInstaller,
} from '../scripts/build-installer.mjs';

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

test('unified artifact naming, native plugin payload, and version parity stay consistent', () => {
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
    pluginZip: 'Claude-Studio-v2.1.0-plugin.zip',
    macosDmg: 'Claude-Studio-v2.1.0-macOS-universal.dmg',
    macosApp: 'Claude Studio.app',
  });
  assert.equal(createManifest('v2.1.0').version, '2.1.0');

  const payload = collectPluginPayloadFiles(pkg.version);
  const names = new Set(payload.entries.map((e) => e.name));
  assert.ok(names.has('plugin.json'));
  assert.ok(names.has('mcp_config.json'));
  assert.ok(names.has('hooks.json'));
  assert.ok(names.has('sidecars/studio/main.mjs'));
  assert.ok(names.has('sidecars/studio/index.html'));
  assert.ok(names.has('skills/studio-doctor/SKILL.md'));
  assert.ok(names.has('skills/studio-setup/SKILL.md'));
  assert.ok(names.has('skills/studio-notify/SKILL.md'));
  assert.ok(names.has('skills/studio-translation-protect/SKILL.md'));
  assert.ok(names.has('scripts/notify-stop.mjs'));
  assert.ok(names.has('scripts/fetch-agy-changelog.mjs'));
  assert.ok(names.has('i18n-sync.js'));
  assert.ok(names.has('locales/manifest.json'));
  assert.ok(names.has('locales/zh-CN.json'));
  assert.ok(names.has('locales/zh-TW.json'));
  assert.equal(names.has('locales/yue.json'), false, 'On-demand yue pack must not be bundled into plugin release');
  assert.equal(names.has('locales/ja.json'), false, 'On-demand ja pack must not be bundled into plugin release');
  assert.ok(names.has('assets/agy-gemini-clawd.ico'));
  assert.ok(names.has('manifest.json'));
  assert.equal(names.has('agy-claude-studio-watcher.exe'), false, 'Native plugin payload must not bundle standalone watcher exe');
});

test('Windows C# sources define native plugin installer contract and stay strictly C# 5 compatible', () => {
  const csClient = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'), 'utf8');
  const csWatcher = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'watcher', 'Program.cs'), 'utf8');
  const csSetup = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'setup', 'Program.cs'), 'utf8');

  assert.match(csClient, /public\s+const\s+int\s+DefaultStartupGraceSeconds\s*=\s*90\s*;/);
  assert.match(csClient, /EnsureAntigravityWithCdpAsync/);
  assert.match(csClient, /ActivateAntigravityWindow/);
  assert.ok(csClient.includes('FindAntigravityFromUninstallRegistry'), 'CdpClient.cs must probe Windows Uninstall registry');
  assert.ok(csClient.includes('FindAntigravityFromShortcuts'), 'CdpClient.cs must probe Start Menu / Desktop shortcuts');
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

  assert.match(csSetup, /TargetPath[\s\S]*?antigravityExe/);
  assert.ok(csSetup.includes('--remote-debugging-port=0'), 'Direct shortcut must launch Antigravity with --remote-debugging-port=0');
  assert.ok(csSetup.includes('agy-gemini-clawd.ico'), 'Installer must use Gemini x Clawd icon for shortcuts');
  assert.ok(csSetup.includes('AGY_CS_TEST_SYSTEM_ROOT'));
  assert.ok(csSetup.includes('AGYClaudeStudioStop_'));
  assert.ok(csSetup.includes('AGYClaudeStyleStop_'));
  assert.ok(csSetup.includes('WatcherPidStatus.Owned'));
  assert.ok(csSetup.includes('-LiteralPath'));
  assert.ok(csSetup.includes('SetHostPluginEnabled'));

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
  'Windows 1-click native plugin installer cleans legacy 2.1/2.2 installs, migrates config, creates Gemini-icon shortcut, enables plugin, and cleanly uninstalls',
  { skip: process.platform !== 'win32' ? 'Windows-only native plugin installer E2E test' : false },
  async () => {
    const workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-native-exe-e2e-')));
    const testSysRoot = path.join(workDir, 'sysroot');
    const installerExe = path.join(workDir, 'installer.exe');
    const pluginZip = path.join(workDir, 'plugin.zip');

    const userProfile = path.join(testSysRoot, 'UserProfile');
    const localAppData = path.join(testSysRoot, 'LocalAppData');
    const startupDir = path.join(testSysRoot, 'Startup');
    const startMenuDir = path.join(testSysRoot, 'StartMenu');
    const desktopDir = path.join(testSysRoot, 'Desktop');

    const pluginDir = path.join(userProfile, '.gemini', 'config', 'plugins', 'agy-claude-studio');
    const pluginDataDir = path.join(userProfile, '.gemini', 'antigravity', 'plugin_data', 'agy-claude-studio');
    const hostConfigPath = path.join(userProfile, '.gemini', 'config', 'config.json');
    const uninstallerExe = path.join(localAppData, 'agy-claude-studio-setup', 'agy-claude-studio-installer.exe');

    const mockAgDir = path.join(workDir, 'CustomAntigravity');
    const mockAgExe = path.join(mockAgDir, 'Antigravity.exe');
    fs.mkdirSync(mockAgDir, { recursive: true });
    fs.writeFileSync(mockAgExe, 'MZ-mock-antigravity', 'utf8');

    // Seed all legacy 2.1.0 / 2.2.0 / 2.2.1 artifacts + user personal files that MUST survive!
    const legacyStyleDir = path.join(localAppData, 'agy-claude-style');
    const legacyStudioDir = path.join(localAppData, 'agy-claude-studio');
    const legacyStylePluginDir = path.join(userProfile, '.gemini', 'config', 'plugins', 'agy-claude-style');
    fs.mkdirSync(legacyStyleDir, { recursive: true });
    fs.mkdirSync(legacyStudioDir, { recursive: true });
    fs.mkdirSync(legacyStylePluginDir, { recursive: true });
    fs.mkdirSync(startupDir, { recursive: true });
    fs.mkdirSync(startMenuDir, { recursive: true });
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.mkdirSync(pluginDataDir, { recursive: true });
    fs.mkdirSync(path.join(pluginDir, 'scripts', 'ops'), { recursive: true });
    fs.mkdirSync(path.dirname(hostConfigPath), { recursive: true });

    fs.writeFileSync(path.join(legacyStyleDir, 'config.json'), JSON.stringify({ palette: 'host', language: 'en' }), 'utf8');
    fs.writeFileSync(path.join(legacyStudioDir, 'config.json'), JSON.stringify({ palette: 'obsidian', language: 'zh-CN' }), 'utf8');
    fs.writeFileSync(path.join(legacyStylePluginDir, 'plugin.json'), '{"name":"agy-claude-style"}', 'utf8');
    fs.writeFileSync(path.join(startupDir, 'AGY-Claude-Style.lnk'), 'legacy-startup', 'utf8');
    fs.writeFileSync(path.join(startupDir, 'Claude-Studio.lnk'), 'legacy-startup-2', 'utf8');
    fs.writeFileSync(path.join(desktopDir, 'Antigravity (AGY Claude Style).lnk'), 'legacy-desk', 'utf8');
    // User's personal Gemini.lnk must NEVER be touched!
    const userGeminiLnk = path.join(desktopDir, 'Gemini.lnk');
    fs.writeFileSync(userGeminiLnk, 'user-custom-gemini-shortcut', 'utf8');
    // User's existing notify.json and custom ops script must NEVER be overwritten or deleted!
    const userNotifyPath = path.join(pluginDataDir, 'notify.json');
    fs.writeFileSync(userNotifyPath, JSON.stringify({ serverchan: { sendKey: 'KEEP_ME_SECRET' } }), 'utf8');
    const customOpsScript = path.join(pluginDir, 'scripts', 'ops', 'custom-user-script.mjs');
    fs.writeFileSync(customOpsScript, 'export const keep = true;\n', 'utf8');
    const existingBundledOps = path.join(pluginDir, 'scripts', 'ops', 'check-agy-update.mjs');
    fs.writeFileSync(existingBundledOps, '// user-customized-ops-file\n', 'utf8');

    // Existing host config with another plugin + legacy agy-claude-style
    fs.writeFileSync(
      hostConfigPath,
      JSON.stringify({
        theme: 'warm',
        plugins: {
          'usage-monitor': { enabled: true },
          'agy-claude-style': { enabled: true },
        },
      }, null, 2),
      'utf8'
    );

    const outStatus = path.join(workDir, 'status.json');
    const outInstall = path.join(workDir, 'install.json');
    const outUpgrade = path.join(workDir, 'upgrade.json');
    const outUninstall = path.join(workDir, 'uninstall.json');

    const testEnv = {
      AGY_CS_TEST_SYSTEM_ROOT: testSysRoot,
      AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG: hostConfigPath,
    };

    const mockCdp = createMockCdpServer();

    try {
      const zipRes = buildPluginZip({ outputPath: pluginZip });
      assert.ok(fs.existsSync(pluginZip));
      assert.ok(zipRes.fileCount >= 30);

      const buildRes = buildInstaller({ outputPath: installerExe });
      assert.ok(fs.existsSync(installerExe));
      assert.ok(buildRes.sizeBytes > 150 * 1024);
      assert.ok(buildRes.iconSource.endsWith('agy-gemini-clawd.ico'), 'Installer uses Gemini x Clawd icon');

      // 1) --status reports legacy installs and not yet installed
      await runExe(
        installerExe,
        ['--status', '--antigravity-exe', mockAgExe, '--cdp-port', '1', '--out', outStatus],
        15000,
        testEnv
      );
      const st = JSON.parse(fs.readFileSync(outStatus, 'utf8'));
      assert.equal(st.installed, false);
      assert.equal(st.installType, 'native-plugin');
      assert.equal(st.installDir, pluginDir);
      assert.equal(st.antigravityExe, mockAgExe);
      assert.equal(st.legacyInstalls.length, 3);

      // 2) Run --silent --desktop-shortcut install (full 3-safeguard flow)
      await runExe(
        installerExe,
        ['--silent', '--desktop-shortcut', '--antigravity-exe', mockAgExe, '--cdp-port', '1', '--out', outInstall],
        20000,
        testEnv
      );
      const res1 = JSON.parse(fs.readFileSync(outInstall, 'utf8'));
      assert.equal(res1.ok, true);
      assert.equal(res1.installType, 'native-plugin');
      assert.equal(res1.installDir, pluginDir);
      assert.equal(res1.hostPluginEnabled, true);
      assert.equal(res1.preservedExistingConfig, true);
      assert.equal(res1.migratedConfigFrom, path.join(legacyStudioDir, 'config.json'));

      // Safeguard 1: Legacy installs cleaned, user configs & Gemini.lnk preserved!
      assert.equal(fs.existsSync(legacyStyleDir), false, 'v2.1.0 standalone dir removed');
      assert.equal(fs.existsSync(legacyStudioDir), false, 'v2.2.0/v2.2.1 standalone dir removed');
      assert.equal(fs.existsSync(legacyStylePluginDir), false, 'legacy agy-claude-style plugin dir removed');
      assert.equal(fs.existsSync(path.join(startupDir, 'AGY-Claude-Style.lnk')), false);
      assert.equal(fs.existsSync(path.join(startupDir, 'Claude-Studio.lnk')), false);
      assert.equal(fs.existsSync(path.join(desktopDir, 'Antigravity (AGY Claude Style).lnk')), false);
      assert.equal(fs.readFileSync(userGeminiLnk, 'utf8'), 'user-custom-gemini-shortcut', 'User Gemini.lnk untouched');
      assert.equal(JSON.parse(fs.readFileSync(path.join(pluginDataDir, 'config.json'), 'utf8')).palette, 'obsidian');
      assert.equal(JSON.parse(fs.readFileSync(userNotifyPath, 'utf8')).serverchan.sendKey, 'KEEP_ME_SECRET');
      assert.equal(fs.readFileSync(customOpsScript, 'utf8'), 'export const keep = true;\n');
      assert.equal(fs.readFileSync(existingBundledOps, 'utf8'), '// user-customized-ops-file\n');

      // Safeguard 2: Complete native plugin deployed & enabled in host config (without touching unrelated keys)
      assert.ok(fs.existsSync(path.join(pluginDir, 'plugin.json')));
      assert.ok(fs.existsSync(path.join(pluginDir, 'hooks.json')));
      assert.ok(fs.existsSync(path.join(pluginDir, 'sidecars', 'studio', 'main.mjs')));
      assert.ok(fs.existsSync(path.join(pluginDir, 'skills', 'studio-doctor', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(pluginDir, 'assets', 'agy-gemini-clawd.ico')));
      assert.equal(fs.existsSync(path.join(pluginDir, 'agy-claude-studio-watcher.exe')), false);
      assert.ok(fs.existsSync(uninstallerExe), 'Uninstaller copied outside pluginDir');

      const hostCfg = JSON.parse(fs.readFileSync(hostConfigPath, 'utf8'));
      assert.equal(hostCfg.theme, 'warm');
      assert.equal(hostCfg.plugins['usage-monitor'].enabled, true);
      assert.equal(hostCfg.plugins['agy-claude-studio'].enabled, true);
      assert.equal(hostCfg.plugins['agy-claude-style'].enabled, false);

      // Safeguard 3: Verified direct .lnk shortcuts with Gemini x Clawd icon
      const startMenuLnk = path.join(startMenuDir, 'Antigravity (Claude Studio).lnk');
      const desktopLnk = path.join(desktopDir, 'Antigravity (Claude Studio).lnk');
      assert.ok(fs.existsSync(startMenuLnk));
      assert.ok(fs.existsSync(desktopLnk));

      const expectedIcon = `${path.join(pluginDir, 'assets', 'agy-gemini-clawd.ico')},0`;
      for (const lnk of [startMenuLnk, desktopLnk]) {
        const meta = readLnkMetadata(lnk);
        assert.equal(meta.targetPath.toLowerCase(), mockAgExe.toLowerCase());
        assert.equal(meta.arguments, '--remote-debugging-port=0');
        assert.equal(meta.workingDirectory.toLowerCase(), mockAgDir.toLowerCase());
        assert.equal(meta.iconLocation.toLowerCase(), expectedIcon.toLowerCase());
      }

      // 3) Re-install / upgrade preserves existing plugin_data/config.json
      fs.writeFileSync(path.join(pluginDataDir, 'config.json'), JSON.stringify({ palette: 'claude', language: 'ja' }), 'utf8');
      await runExe(
        installerExe,
        ['--silent', '--desktop-shortcut', '--antigravity-exe', mockAgExe, '--cdp-port', '1', '--out', outUpgrade],
        20000,
        testEnv
      );
      const res2 = JSON.parse(fs.readFileSync(outUpgrade, 'utf8'));
      assert.equal(res2.ok, true);
      assert.equal(res2.preservedExistingConfig, true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(pluginDataDir, 'config.json'), 'utf8')).language, 'ja');

      // 4) --uninstall from copied uninstaller restores CDP pages, disables host plugin, removes pluginDir & shortcuts, preserves plugin_data!
      const port = await mockCdp.start();
      await runExe(
        uninstallerExe,
        ['--uninstall', '--silent', '--cdp-port', String(port), '--out', outUninstall],
        20000,
        testEnv
      );
      const res3 = JSON.parse(fs.readFileSync(outUninstall, 'utf8'));
      assert.equal(res3.ok, true);
      assert.equal(res3.selfDeleteScheduled, true);
      assert.deepEqual(res3.injectedPages, ['Antigravity']);
      assert.equal(mockCdp.getLastRemovedExpr(), cdp.REMOVE_EXPRESSION);
      assert.equal(fs.existsSync(pluginDir), false);
      assert.equal(fs.existsSync(startMenuLnk), false);
      assert.equal(fs.existsSync(desktopLnk), false);
      assert.equal(fs.readFileSync(userGeminiLnk, 'utf8'), 'user-custom-gemini-shortcut', 'Uninstall keeps user Gemini.lnk');
      assert.equal(JSON.parse(fs.readFileSync(hostConfigPath, 'utf8')).plugins['agy-claude-studio'].enabled, false);
      assert.equal(JSON.parse(fs.readFileSync(userNotifyPath, 'utf8')).serverchan.sendKey, 'KEEP_ME_SECRET', 'Uninstall preserves plugin_data');

      await waitFor(() => (!fs.existsSync(path.dirname(uninstallerExe)) ? true : null), 8000, 150);
    } finally {
      try { await mockCdp.close(); } catch {}
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }
);

test(
  'legacy C# watcher compiles cleanly and passes WindowsFileAction STA, HostEnabled fail-safe, and native toggle checks',
  { skip: process.platform !== 'win32' ? 'Windows-only C# watcher regression test' : false },
  async () => {
    const workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-watcher-reg-')));
    const watcherDir = path.join(workDir, 'watcher-dir');
    const watcherExe = path.join(watcherDir, 'agy-claude-studio-watcher.exe');
    const hostCfgFile = path.join(workDir, 'host.json');
    const mockCdp = createMockCdpServer();

    try {
      fs.mkdirSync(watcherDir, { recursive: true });
      fs.writeFileSync(path.join(watcherDir, 'manifest.json'), JSON.stringify(createManifest(cdp.PLUGIN_VERSION), null, 2), 'utf8');
      fs.writeFileSync(path.join(watcherDir, 'style.css'), fs.readFileSync(path.join(ROOT_DIR, 'style.css')));
      fs.writeFileSync(path.join(watcherDir, 'config.json'), fs.readFileSync(path.join(ROOT_DIR, 'config.example.json')));
      for (const part of cdp.RUNTIME_PARTS) {
        fs.writeFileSync(path.join(watcherDir, part), fs.readFileSync(path.join(ROOT_DIR, part)));
      }

      const csc = findCsc();
      execFileSync(csc, [
        '/nologo',
        '/utf8output',
        '/codepage:65001',
        '/target:winexe',
        '/optimize+',
        `/out:${watcherExe}`,
        '/r:System.dll',
        '/r:System.Core.dll',
        '/r:System.Management.dll',
        '/r:System.Net.Http.dll',
        path.join(ROOT_DIR, 'installer', 'common', 'MiniJson.cs'),
        path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs'),
        path.join(ROOT_DIR, 'scripts', 'WindowsFileAction.cs'),
        path.join(ROOT_DIR, 'installer', 'watcher', 'Program.cs'),
      ], { stdio: 'inherit' });

      const probe = String.raw`
        $ErrorActionPreference = 'Stop'
        $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($env:AGY_TEST_WATCHER))
        Add-Type -TypeDefinition @'
using System;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
public static class RevealProbe {
    public static void Check(Assembly assembly) {
        var method = assembly.GetType("AgyClaudeStudio.WindowsFileAction", true).GetMethod("RunInSta", BindingFlags.Static | BindingFlags.NonPublic);
        Func<bool> probe = () => Thread.CurrentThread.GetApartmentState() == ApartmentState.STA;
        bool ok = Task.Run(() => Thread.CurrentThread.GetApartmentState() == ApartmentState.MTA &&
            (bool)method.Invoke(null, new object[] { probe })).Result;
        if (!ok) throw new InvalidOperationException("Shell callback did not run in STA");
    }
}
'@
        [RevealProbe]::Check($assembly)
        $flags = [Reflection.BindingFlags]'NonPublic,Static'
        $enabled = $assembly.GetType('AgyClaudeStudio.Watcher.Program', $true).GetMethod('HostEnabled', $flags)
        $fixture = $env:AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG
        foreach ($expected in @($true, $false)) {
          $env:AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG = $fixture
          [IO.File]::WriteAllText($fixture, (@{plugins=@{'agy-claude-studio'=@{enabled=$expected}}} | ConvertTo-Json -Depth 4))
          if ($enabled.Invoke($null, $null) -ne $expected) { throw 'valid decision failed' }
          [IO.File]::WriteAllText($fixture, '{')
          if ($enabled.Invoke($null, $null) -ne $expected) { throw 'partial write changed last decision' }
          $env:AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG = 'invalid"path'
          if ($enabled.Invoke($null, $null) -ne $expected) { throw 'invalid config path changed last decision' }
        }
      `;
      const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      await runExe(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')], 15000, {
        AGY_TEST_WATCHER: watcherExe,
        AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG: path.join(workDir, 'probe-config.json'),
      });

      const port = await mockCdp.start();
      const onceOut = path.join(workDir, 'once.json');
      const testEnv = { AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG: hostCfgFile, AG_WATCH_POLL_MS: '200' };

      const watcherChild = spawn(watcherExe, ['--watch', '--dir', watcherDir, '--cdp-port', String(port)], {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ...testEnv },
      });
      try {
        await waitFor(() => (mockCdp.getLastInjectedExpr() ? true : null), 8000, 100);
        const injectedExpr = mockCdp.getLastInjectedExpr();
        assert.doesNotThrow(() => new vm.Script(injectedExpr), 'C# injected JS compiles cleanly');
        const nodeHash = cdp.buildInjectExpression().match(/"codeHash":"([^"]+)"/)[1];
        const csHash = injectedExpr.match(/"codeHash":"([^"]+)"/)[1];
        assert.equal(csHash, nodeHash);

        await verifyNativeToggle({
          file: hostCfgFile,
          mock: mockCdp,
          waitFor,
          removeExpr: cdp.REMOVE_EXPRESSION,
          once: async () => {
            await runExe(watcherExe, ['--once', '--dir', watcherDir, '--cdp-port', String(port), '--out', onceOut], 10000, testEnv);
            return JSON.parse(fs.readFileSync(onceOut, 'utf8'));
          },
        });
      } finally {
        try { watcherChild.kill(); } catch {}
      }
    } finally {
      try { await mockCdp.close(); } catch {}
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }
);
