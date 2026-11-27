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
import { buildIcns } from '../scripts/build-common.mjs';
import { buildMacosApp, generateInfoPlist } from '../scripts/build-macos.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT_DIR, 'src', 'cdp.js'));

function runBin(binPath, args, timeoutMs = 20000, extraEnv = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, {
      stdio: 'ignore',
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout running ${path.basename(binPath)} ${args.join(' ')}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(binPath)} exited with code ${code}`));
    });
  });
}

function collectSwiftFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSwiftFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.swift')) {
      results.push(full);
    }
  }
  return results.sort();
}

function verifySwiftDelimiters(src, fileLabel) {
  const stack = [];
  const openers = { '{': '}', '(': ')', '[': ']' };
  const closers = { '}': '{', ')': '(', ']': '[' };
  // Mode stack: 'code' | 'str' | 'mstr'
  const modeStack = [{ kind: 'code', parenDepth: 0 }];
  let i = 0;
  while (i < src.length) {
    const cur = modeStack[modeStack.length - 1];
    const ch = src[i];
    const next = src[i + 1];

    if (cur.kind === 'code') {
      if (ch === '/' && next === '/') {
        i += 2;
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        let depth = 1;
        i += 2;
        while (i < src.length && depth > 0) {
          if (src[i] === '/' && src[i + 1] === '*') {
            depth++;
            i += 2;
          } else if (src[i] === '*' && src[i + 1] === '/') {
            depth--;
            i += 2;
          } else {
            i++;
          }
        }
        assert.equal(depth, 0, `${fileLabel}: unterminated block comment`);
        continue;
      }
      if (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
        modeStack.push({ kind: 'mstr' });
        i += 3;
        continue;
      }
      if (ch === '"') {
        modeStack.push({ kind: 'str' });
        i += 1;
        continue;
      }
      if (openers[ch]) {
        stack.push({ ch, idx: i });
        if (ch === '(') cur.parenDepth++;
      } else if (closers[ch]) {
        const top = stack.pop();
        assert.ok(top && top.ch === closers[ch], `${fileLabel}: unmatched '${ch}' at offset ${i}`);
        if (ch === ')') {
          if (cur.parenDepth > 0) {
            cur.parenDepth--;
          } else if (modeStack.length > 1) {
            modeStack.pop();
          }
        }
      }
      i += 1;
      continue;
    }

    if (cur.kind === 'str') {
      if (ch === '\\') {
        if (next === '(') {
          stack.push({ ch: '(', idx: i + 1 });
          modeStack.push({ kind: 'code', parenDepth: 0 });
          i += 2;
          continue;
        }
        i += 2;
        continue;
      }
      if (ch === '"') {
        modeStack.pop();
        i += 1;
        continue;
      }
      assert.notEqual(ch, '\n', `${fileLabel}: unterminated string literal before newline at offset ${i}`);
      i += 1;
      continue;
    }

    if (cur.kind === 'mstr') {
      if (ch === '\\') {
        if (next === '(') {
          stack.push({ ch: '(', idx: i + 1 });
          modeStack.push({ kind: 'code', parenDepth: 0 });
          i += 2;
          continue;
        }
        i += 2;
        continue;
      }
      if (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
        modeStack.pop();
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }
  }
  assert.equal(modeStack.length, 1, `${fileLabel}: unterminated string literal at EOF`);
  assert.equal(stack.length, 0, `${fileLabel}: unclosed delimiters remaining: ${JSON.stringify(stack)}`);
}

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

test('buildIcns generates a valid Apple ICNS container with PNG icon chunks', () => {
  const icns = buildIcns();
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  let offset = 8;
  const types = [];
  const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  while (offset < icns.length) {
    const chunkType = icns.subarray(offset, offset + 4).toString('ascii');
    const chunkLen = icns.readUInt32BE(offset + 4);
    assert.ok(chunkLen > 16, `Chunk ${chunkType} has payload`);
    assert.deepEqual(icns.subarray(offset + 8, offset + 16), pngMagic, `Chunk ${chunkType} is valid PNG`);
    types.push(chunkType);
    offset += chunkLen;
  }
  assert.equal(offset, icns.length);
  assert.ok(types.includes('icp4'));
  assert.ok(types.includes('ic08'));
  assert.ok(types.includes('ic10'));
});

test('generateInfoPlist generates valid bundle metadata and escapes special XML characters', () => {
  const plist = generateInfoPlist('1.2.3-beta&1<test>');
  assert.ok(plist.includes('<key>CFBundleExecutable</key>'));
  assert.ok(plist.includes('<string>Claude Studio</string>'));
  assert.ok(plist.includes('<string>io.github.eosglyph.agy-claude-studio</string>'));
  assert.ok(plist.includes('<key>NSAllowsLocalNetworking</key>'));
  assert.ok(plist.includes('<string>1.2.3-beta&amp;1&lt;test&gt;</string>'));
});

test('CdpClient.swift defines defaultStartupGraceSeconds, activateAntigravityApp, ensureAntigravityWithCdp, ownership, and lightweight config script', () => {
  const cdpSwift = fs.readFileSync(
    path.join(ROOT_DIR, 'installer', 'macos', 'Common', 'CdpClient.swift'),
    'utf8'
  );
  assert.ok(cdpSwift.includes('static let defaultStartupGraceSeconds: Double = 90.0'));
  assert.ok(cdpSwift.includes('struct EnsureAntigravityResult'));
  assert.ok(cdpSwift.includes('static func activateAntigravityApp('));
  assert.ok(cdpSwift.includes('static func ensureAntigravityWithCdp('));
  assert.ok(cdpSwift.includes('removeStalePortFile()'));
  assert.ok(cdpSwift.includes('static func readBundleAndCssHashes('));
  assert.ok(cdpSwift.includes('static func buildConfigScriptExpression('));
  assert.ok(cdpSwift.includes('__agCsOverrideConfig'));
  assert.ok(cdpSwift.includes('plugin://swarm--'), 'CdpClient.swift must include Swarm sidecar iframe targets');
  assert.ok(cdpSwift.includes("location.protocol === 'plugin:'"), 'CdpClient.swift must skip CSS injection in plugin: sidecars');
  assert.ok(cdpSwift.includes('static func evaluateWatcherOwnership('));
  assert.ok(cdpSwift.includes('static func classifyWatcherPid('));
  assert.ok(
    cdpSwift.includes('hasStandaloneFlag(cmd, "--watch") || hasStandaloneFlag(cmd, "--managed")'),
    'CdpClient.swift evaluates --managed watcher ownership equivalently to --watch'
  );
  assert.ok(
    cdpSwift.includes('"/private/var", "/private/tmp", "/private/etc"'),
    'CdpClient.swift canonicalizes macOS /private symlinks in normalizePath & evaluateWatcherOwnership'
  );
  for (const action of [
    'already-cdp',
    'waiting-cdp',
    'relaunched',
    'relaunch-failed',
    'running-without-cdp',
    'launched',
    'executable-not-found',
  ]) {
    assert.ok(cdpSwift.includes(`"${action}"`), `CdpClient.swift handles ${action}`);
  }
});

test('Watcher/main.swift supports --launch, --relaunch, --replace, --exit-on-host-close, --startup-grace, lightweight reload, and fail-closed ownership', () => {
  const watcherSwift = fs.readFileSync(
    path.join(ROOT_DIR, 'installer', 'macos', 'Watcher', 'main.swift'),
    'utf8'
  );
  for (const flag of ['"--launch"', '"--relaunch"', '"--replace"', '"--exit-on-host-close"', '"--startup-grace"', '"--startup-grace="']) {
    assert.ok(watcherSwift.includes(flag), `Watcher/main.swift supports ${flag}`);
  }
  assert.ok(watcherSwift.includes('AG_STARTUP_GRACE_SEC'));
  assert.ok(watcherSwift.includes('AG_WATCH_POLL_MS'));
  assert.ok(watcherSwift.includes('mode == "watch" || mode == "launch"'));
  assert.ok(watcherSwift.includes('initCfg["autoRelaunchWithCdp"]?.boolValue ?? true'));
  assert.ok(watcherSwift.includes('nextCfg["autoRelaunchWithCdp"]?.boolValue ?? true'));
  assert.equal(watcherSwift.includes('autoRelaunchWithCdp"]?.boolValue ?? false'), false);
  assert.ok(watcherSwift.includes('var bootstrapScriptId: String?'));
  assert.ok(watcherSwift.includes('var configScriptId: String?'));
  assert.ok(watcherSwift.includes('buildConfigScriptExpression('));
  assert.ok(watcherSwift.includes('CdpHelper.classifyWatcherPid(existingPid'));
  assert.ok(watcherSwift.includes('func runLaunchAndWatch('));
  assert.ok(watcherSwift.includes('AGY_CS_NO_UI'));
  assert.ok(watcherSwift.includes('/usr/bin/osascript'));
  assert.ok(watcherSwift.includes('startupGraceEnabled'));
  assert.ok(watcherSwift.includes('Date().timeIntervalSince(watchStart) >= startupGraceSeconds'));
  assert.ok(watcherSwift.includes('waitBrieflyForLock'));
  assert.ok(watcherSwift.includes('DispatchTimeInterval.milliseconds(sleepMs)'));

  const existingIdx = watcherSwift.indexOf('if let existingPid = readPidFile()');
  const writePidIdx = watcherSwift.indexOf('try? String(selfPid).write(toFile: pidFile');
  assert.ok(existingIdx > 0 && writePidIdx > existingIdx, 'existingPid check must precede .watch.pid write');
});

test('Setup/main.swift supports managed/daemon modes, launcher .app, updated .command, LaunchAgent cleanup, and --managed legacy cleanup', () => {
  const setupSwift = fs.readFileSync(
    path.join(ROOT_DIR, 'installer', 'macos', 'Setup', 'main.swift'),
    'utf8'
  );
  for (const flag of ['"--managed"', '"--daemon"', '"--mode"', '"--mode="', '"--app-launcher"', '"--no-app-launcher"']) {
    assert.ok(setupSwift.includes(flag), `Setup/main.swift supports ${flag}`);
  }
  assert.ok(setupSwift.includes('AGY_CS_TEST_SYSTEM_ROOT'));
  assert.ok(setupSwift.includes('Antigravity (Claude Studio).app'));
  assert.ok(setupSwift.includes('createLauncherAppBundle('));
  assert.ok(setupSwift.includes('--launch --relaunch --exit-on-host-close --dir'));
  assert.ok(setupSwift.includes('launch-antigravity.command'));
  assert.ok(setupSwift.includes('.install-mode'));
  assert.ok(setupSwift.includes('NSButton(\n            radioButtonWithTitle:') || setupSwift.includes('radioButtonWithTitle:'));
  assert.ok(setupSwift.includes('checkboxWithTitle:'));
  assert.ok(setupSwift.includes('width: 620, height: 560'));
  assert.ok(setupSwift.includes('"runMode"'));
  assert.ok(setupSwift.includes('"watcherStarted"'));
  assert.ok(setupSwift.includes('"launchAgent"'));
  assert.ok(setupSwift.includes('"launcherApp"'));
  assert.ok(setupSwift.includes('"installedMode"'));
  assert.ok(setupSwift.includes('activeCfg["autoRelaunchWithCdp"]?.boolValue ?? true'));
  assert.equal(setupSwift.includes('activeCfg["autoRelaunchWithCdp"]?.boolValue ?? false'), false);
  assert.ok(setupSwift.includes('CdpHelper.matchesWatcherForDir('));
  assert.ok(
    setupSwift.includes('(!lowerRaw.contains("--watch") && !lowerRaw.contains("--managed"))'),
    'Setup/main.swift stopLegacyNodeWatchers accepts --watch or --managed'
  );
});

test('All Swift sources under installer/macos have balanced delimiters and valid macOS 11.0+ compatibility', () => {
  const swiftFiles = collectSwiftFiles(path.join(ROOT_DIR, 'installer', 'macos'));
  assert.equal(swiftFiles.length, 4);
  for (const file of swiftFiles) {
    const rel = path.relative(ROOT_DIR, file);
    const src = fs.readFileSync(file, 'utf8');
    verifySwiftDelimiters(src, rel);
  }
});

test(
  'macOS .app builds cleanly as universal binary and executes managed/daemon install, mode switching, startup grace, and uninstall lifecycle',
  { skip: process.platform !== 'darwin' ? 'macOS-only .app E2E test' : false },
  async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-macos-e2e-'));
    const testRoot = path.join(workDir, 'test-sys-root');
    const appPath = path.join(workDir, 'Claude Studio.app');
    const installDir = path.join(workDir, 'installed');
    const outManagedNoCdp = path.join(workDir, 'managed-nocdp.json');
    const outInstall = path.join(workDir, 'install.json');
    const outUpgrade = path.join(workDir, 'upgrade.json');
    const outDaemon = path.join(workDir, 'daemon.json');
    const outBackToManaged = path.join(workDir, 'back-managed.json');
    const outUninstall = path.join(workDir, 'uninstall.json');
    const outStatus = path.join(workDir, 'status.json');
    const plistPath = path.join(testRoot, 'LaunchAgents', 'io.github.eosglyph.agy-claude-studio.plist');
    const appLauncherPath = path.join(testRoot, 'Applications', 'Antigravity (Claude Studio).app');
    const testEnv = {
      AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG: path.join(workDir, 'host.json'),
      AGY_CS_TEST_SYSTEM_ROOT: testRoot,
      AGY_CS_NO_UI: '1',
      AG_WATCH_POLL_MS: '200',
    };
    const mockCdp = createMockCdpServer();
    const mockCdp2 = createMockCdpServer();
    const mockCdp3 = createMockCdpServer();

    try {
      const buildRes = buildMacosApp({ appOut: appPath, createDmg: false });
      assert.ok(fs.existsSync(appPath));
      assert.ok(buildRes.appSizeBytes > 100 * 1024);

      const installerBin = path.join(appPath, 'Contents', 'MacOS', 'Claude Studio');
      const watcherBundleBin = path.join(appPath, 'Contents', 'MacOS', 'agy-claude-studio-watcher');
      assert.ok(fs.existsSync(installerBin));
      assert.ok(fs.existsSync(watcherBundleBin));

      for (const bin of [installerBin, watcherBundleBin]) {
        const archs = execFileSync('lipo', ['-archs', bin], { encoding: 'utf8' }).trim().split(/\s+/);
        assert.ok(archs.includes('arm64'), `${path.basename(bin)} includes arm64`);
        assert.ok(archs.includes('x86_64'), `${path.basename(bin)} includes x86_64`);
      }

      execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

      const port = await mockCdp.start();

      // 1. Check --status CLI before install
      await runBin(
        installerBin,
        ['--status', '--install-dir', installDir, '--cdp-port', String(port), '--out', outStatus],
        10000,
        testEnv
      );
      const stBefore = JSON.parse(fs.readFileSync(outStatus, 'utf8'));
      assert.equal(stBefore.installed, false);
      assert.equal(stBefore.cdpPort, port);
      assert.equal(stBefore.launchAgent, false);
      assert.equal(stBefore.launcherApp, false);

      // 2. Fresh managed install with NO CDP -> 0 watchers, no LaunchAgent plist, launcher .app + .command created
      await runBin(
        installerBin,
        [
          '--silent',
          '--mode=managed',
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
      const managedNoCdpRes = JSON.parse(fs.readFileSync(outManagedNoCdp, 'utf8'));
      assert.equal(managedNoCdpRes.ok, true);
      assert.equal(managedNoCdpRes.runMode, 'managed');
      assert.equal(managedNoCdpRes.watcherStarted, false);
      assert.equal(managedNoCdpRes.launchAgent, false);
      assert.equal(fs.existsSync(path.join(installDir, '.watch.pid')), false);
      assert.equal(fs.existsSync(plistPath), false);
      assert.equal(fs.readFileSync(path.join(installDir, '.install-mode'), 'utf8').trim(), 'managed');
      assert.ok(fs.existsSync(appLauncherPath));
      const launcherExe = path.join(appLauncherPath, 'Contents', 'MacOS', 'launch-antigravity');
      assert.ok(fs.existsSync(launcherExe));
      assert.ok((fs.statSync(launcherExe).mode & 0o111) !== 0);
      assert.ok(fs.readFileSync(launcherExe, 'utf8').includes('--launch --relaunch --exit-on-host-close --dir'));
      assert.ok(fs.existsSync(path.join(installDir, 'Antigravity (Claude Studio).app')));
      const cmdFile = path.join(installDir, 'launch-antigravity.command');
      assert.ok(fs.existsSync(cmdFile));
      assert.ok(fs.readFileSync(cmdFile, 'utf8').includes('agy-claude-studio-watcher'));
      assert.ok(fs.readFileSync(cmdFile, 'utf8').includes('--launch --relaunch --exit-on-host-close --dir'));

      await runBin(
        installerBin,
        ['--status', '--install-dir', installDir, '--cdp-port', '1', '--out', outStatus],
        10000,
        testEnv
      );
      const stManaged = JSON.parse(fs.readFileSync(outStatus, 'utf8'));
      assert.equal(stManaged.installed, true);
      assert.equal(stManaged.installedMode, 'managed');
      assert.equal(stManaged.runMode, 'managed');
      assert.equal(stManaged.watcherStarted, false);
      assert.equal(stManaged.launchAgent, false);
      assert.equal(stManaged.launcherApp, true);

      // 3. Managed install against active mock CDP server
      await runBin(
        installerBin,
        [
          '--silent',
          '--mode=managed',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(port),
          '--out',
          outInstall,
        ],
        20000,
        testEnv
      );

      const installResult = JSON.parse(fs.readFileSync(outInstall, 'utf8'));
      assert.equal(installResult.ok, true);
      assert.equal(installResult.runMode, 'managed');
      assert.equal(installResult.watcherStarted, true);
      assert.equal(installResult.launchAgent, false);
      assert.equal(installResult.preservedExistingConfig, true);
      assert.deepEqual(installResult.injectedPages, ['Antigravity']);
      assert.ok(fs.existsSync(path.join(installDir, 'agy-claude-studio-watcher')));
      assert.ok(fs.existsSync(path.join(installDir, 'agy-claude-studio-installer')));
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
      assert.doesNotThrow(() => new vm.Script(injectedExpr), 'Swift injected JS compiles cleanly');

      // Verify codeHash parity and active config values between Node cdp.js and Swift watcher
      const nodeExpr = cdp.buildInjectExpression();
      const nodeHash = nodeExpr.match(/"codeHash":"([^"]+)"/)[1];
      const swiftHash = injectedExpr.match(/"codeHash":"([^"]+)"/)[1];
      assert.equal(swiftHash, nodeHash);
      const expectedCfgObj = JSON.parse(expectedCfg);
      assert.ok(injectedExpr.includes(`"palette":"${expectedCfgObj.palette}"`));
      assert.ok(injectedExpr.includes(`"ringMode":"${expectedCfgObj.ringMode}"`));

      // Verify watcher --once CLI mode works standalone against CDP
      const watcherBin = path.join(installDir, 'agy-claude-studio-watcher');
      const onceOut = path.join(workDir, 'once.json');
      await runBin(
        watcherBin,
        ['--once', '--dir', installDir, '--cdp-port', String(port), '--out', onceOut],
        10000,
        testEnv
      );
      const onceResult = JSON.parse(fs.readFileSync(onceOut, 'utf8'));
      assert.equal(onceResult.ok, true);
      assert.deepEqual(onceResult.pages, ['Antigravity']);

      // 4. Test Runtime.bindingCalled -> config.json update & hot-reload
      const targetPalette = expectedCfgObj.palette === 'claude' ? 'obsidian' : 'claude';
      const beforeCallCount = mockCdp.getCalls().length;
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: 'hacker-invalid' });
      mockCdp.emitBindingCalled(cdp.SETTING_BINDING, { key: 'palette', value: targetPalette });

      const updatedCfg = await waitFor(() => {
        const parsed = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
        return parsed.palette === targetPalette ? parsed : null;
      });
      assert.equal(updatedCfg.palette, targetPalette);

      // Confirm hot-reload fired on watcher without re-sending full ~1.4MB bundle over Page.addScriptToEvaluateOnNewDocument
      await waitFor(() => {
        const newer = mockCdp.getCalls().slice(beforeCallCount);
        const hasRm = newer.some((c) => c.method === 'Page.removeScriptToEvaluateOnNewDocument');
        const hasAdd = newer.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument');
        return hasRm && hasAdd ? true : null;
      });
      const reloadCalls = mockCdp.getCalls().slice(beforeCallCount);
      const reloadAddCalls = reloadCalls.filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument');
      assert.ok(reloadAddCalls.length >= 1, 'Expected lightweight Page.addScriptToEvaluateOnNewDocument during config reload');
      const maxReloadLen = Math.max(...reloadAddCalls.map((c) => (c.params?.source || '').length));
      assert.ok(maxReloadLen < 2048, `Expected short config script (<2KB) on Swift hot-reload, got ${maxReloadLen}`);

      await verifyNativeToggle({ file: testEnv.AGY_CLAUDE_STUDIO_ANTIGRAVITY_CONFIG, mock: mockCdp, waitFor, removeExpr: cdp.REMOVE_EXPRESSION, once: async () => {
        await runBin(watcherBin, ['--once', '--dir', installDir, '--cdp-port', String(port), '--out', onceOut], 10000, testEnv);
        return JSON.parse(fs.readFileSync(onceOut, 'utf8'));
      } });

      // Verify compiled Swift watcher --remove refuses to kill a foreign PID stored in .watch.pid
      const probeDir = path.join(workDir, 'foreign-pid-probe');
      fs.mkdirSync(probeDir, { recursive: true });
      const foreignProc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
      try {
        await new Promise((r) => setTimeout(r, 100));
        fs.writeFileSync(path.join(probeDir, '.watch.pid'), String(foreignProc.pid), 'utf8');
        await runBin(watcherBin, ['--remove', '--dir', probeDir], 10000);
        assert.equal(foreignProc.exitCode, null, 'Swift watcher --remove must NOT terminate a foreign PID');
        assert.equal(fs.existsSync(path.join(probeDir, '.watch.pid')), false, 'Stale foreign .watch.pid should be cleared');
      } finally {
        try { foreignProc.kill('SIGKILL'); } catch {}
      }

      // 5. Test re-install / upgrade preserves existing user config.json
      await runBin(
        installerBin,
        [
          '--silent',
          '--mode=managed',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(port),
          '--out',
          outUpgrade,
        ],
        20000,
        testEnv
      );
      const upgradeResult = JSON.parse(fs.readFileSync(outUpgrade, 'utf8'));
      assert.equal(upgradeResult.ok, true);
      assert.equal(upgradeResult.preservedExistingConfig, true);
      const cfgAfterUpgrade = JSON.parse(fs.readFileSync(path.join(installDir, 'config.json'), 'utf8'));
      assert.equal(cfgAfterUpgrade.palette, targetPalette);

      // Close mockCdp -> managed watcher must exit automatically & clean .watch.pid
      await mockCdp.close();
      await waitFor(() => (!fs.existsSync(path.join(installDir, '.watch.pid')) ? true : null), 8000, 100);

      // 6. Switch managed -> daemon: creates LaunchAgent plist & persistent watcher stays alive after CDP closes
      const port2 = await mockCdp2.start();
      await runBin(
        installerBin,
        [
          '--silent',
          '--mode=daemon',
          '--no-kill-legacy',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(port2),
          '--out',
          outDaemon,
        ],
        20000,
        testEnv
      );
      const daemonResult = JSON.parse(fs.readFileSync(outDaemon, 'utf8'));
      assert.equal(daemonResult.ok, true);
      assert.equal(daemonResult.runMode, 'daemon');
      assert.equal(daemonResult.watcherStarted, true);
      assert.equal(daemonResult.launchAgent, true);
      assert.equal(daemonResult.preservedExistingConfig, true);
      assert.ok(fs.existsSync(plistPath));
      assert.equal(fs.readFileSync(path.join(installDir, '.install-mode'), 'utf8').trim(), 'daemon');
      assert.ok(fs.existsSync(path.join(installDir, '.watch.pid')));

      await mockCdp2.close();
      await new Promise((r) => setTimeout(r, 1200));
      assert.ok(fs.existsSync(path.join(installDir, '.watch.pid')), 'daemon watcher stays alive after CDP closes');

      // 7. Switch daemon -> managed with no CDP: deletes LaunchAgent plist & stops daemon watcher
      await runBin(
        installerBin,
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
      const backManagedResult = JSON.parse(fs.readFileSync(outBackToManaged, 'utf8'));
      assert.equal(backManagedResult.ok, true);
      assert.equal(backManagedResult.runMode, 'managed');
      assert.equal(backManagedResult.watcherStarted, false);
      assert.equal(backManagedResult.launchAgent, false);
      assert.equal(fs.existsSync(plistPath), false);
      assert.equal(fs.existsSync(path.join(installDir, '.watch.pid')), false);

      // 8. Watcher --startup-grace 1 exits cleanly when no CDP window appears
      await runBin(
        watcherBin,
        ['--watch', '--exit-on-host-close', '--startup-grace', '1', '--cdp-port', '1', '--dir', installDir],
        8000,
        testEnv
      );
      assert.equal(fs.existsSync(path.join(installDir, '.watch.pid')), false);

      // 9. Test --uninstall from installed copy inside installDir (removes appLauncher, plist, CDP injection, installDir)
      const port3 = await mockCdp3.start();
      const installedSelf = path.join(installDir, 'agy-claude-studio-installer');
      await runBin(
        installedSelf,
        [
          '--uninstall',
          '--silent',
          '--install-dir',
          installDir,
          '--cdp-port',
          String(port3),
          '--out',
          outUninstall,
        ],
        20000,
        testEnv
      );

      const uninstallResult = JSON.parse(fs.readFileSync(outUninstall, 'utf8'));
      assert.equal(uninstallResult.ok, true);
      assert.deepEqual(uninstallResult.injectedPages, ['Antigravity']);
      assert.equal(mockCdp3.getLastRemovedExpr(), cdp.REMOVE_EXPRESSION);
      assert.equal(fs.existsSync(appLauncherPath), false);
      assert.equal(fs.existsSync(plistPath), false);

      await waitFor(() => (!fs.existsSync(installDir) ? true : null), 5000, 100);
      assert.equal(fs.existsSync(installDir), false);
    } finally {
      try {
        const pidPath = path.join(installDir, '.watch.pid');
        if (fs.existsSync(pidPath)) {
          const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
          if (pid) process.kill(pid);
        }
      } catch {}
      await mockCdp.close();
      await mockCdp2.close();
      await mockCdp3.close();
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  }
);
