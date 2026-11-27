import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const lifecycle = require(path.join(ROOT_DIR, 'src', 'lifecycle.js'));
const MOCK_WIN_EXE = 'C:\\Mock\\Antigravity\\Antigravity.exe';
const MOCK_STALE_PORT_FILE = 'C:\\Temp\\DevToolsActivePort';
const MOCK_SYS_PATH = 'C:\\Windows\\System32';

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-win-relaunch-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Windows relaunch script omits SetEnvironmentVariable when no proxy env is present and wraps cleanup in try/finally', () => {
  const staleFiles = [MOCK_STALE_PORT_FILE];

  assert.deepEqual(
    lifecycle.extractProcessProxyEnv({
      PATH: MOCK_SYS_PATH,
      HTTP_PROXY: '',
      HTTPS_PROXY: '   ',
      ALL_PROXY: null,
      NO_PROXY: undefined,
      NODE_USE_ENV_PROXY: 1,
      OTHER_PROXY: 'http://127.0.0.1:9999',
    }),
    {}
  );

  for (const script of [
    lifecycle.buildWindowsRelaunchInnerScript(MOCK_WIN_EXE, staleFiles, 'desktop'),
    lifecycle.buildWindowsRelaunchInnerScript(MOCK_WIN_EXE, staleFiles, 'desktop', {
      PATH: MOCK_SYS_PATH,
      UNRELATED_VAR: 'keep-out',
    }),
  ]) {
    assert.doesNotMatch(script, /SetEnvironmentVariable/);
    assert.match(script, /^try \{/);
    assert.match(script, /\} finally \{/);
    assert.match(
      script,
      /Remove-Item -LiteralPath \$PSCommandPath -Force -ErrorAction SilentlyContinue/
    );
    assert.match(
      script,
      /Start-Process -FilePath \$exe -ArgumentList '--remote-debugging-port=0' -WorkingDirectory \$workDir/
    );
  }
});

test('Windows relaunch script injects all 5 whitelisted proxy variables (including SOCKS5) before Start-Process', () => {
  const env = {
    HTTP_PROXY: 'http://127.0.0.1:7897',
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    ALL_PROXY: 'socks5://127.0.0.1:7897',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    NODE_USE_ENV_PROXY: '1',
    FTP_PROXY: 'http://127.0.0.1:2121',
    SECRET_TOKEN: 'must-not-appear',
  };

  assert.deepEqual(lifecycle.extractProcessProxyEnv(env), {
    HTTP_PROXY: 'http://127.0.0.1:7897',
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    ALL_PROXY: 'socks5://127.0.0.1:7897',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    NODE_USE_ENV_PROXY: '1',
  });

  const script = lifecycle.buildWindowsRelaunchInnerScript(MOCK_WIN_EXE, [], 'desktop', env);
  const expectedLines = [
    "[System.Environment]::SetEnvironmentVariable('HTTP_PROXY', 'http://127.0.0.1:7897', 'Process')",
    "[System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', 'http://127.0.0.1:7897', 'Process')",
    "[System.Environment]::SetEnvironmentVariable('ALL_PROXY', 'socks5://127.0.0.1:7897', 'Process')",
    "[System.Environment]::SetEnvironmentVariable('NO_PROXY', 'localhost,127.0.0.1,::1', 'Process')",
    "[System.Environment]::SetEnvironmentVariable('NODE_USE_ENV_PROXY', '1', 'Process')",
  ];

  const startProcIdx = script.indexOf('Start-Process -FilePath $exe');
  assert.ok(startProcIdx > 0, 'Start-Process should exist in script');
  for (const line of expectedLines) {
    const idx = script.indexOf(line);
    assert.ok(idx > 0, `Missing expected line: ${line}`);
    assert.ok(idx < startProcIdx, `Proxy env must be set before Start-Process: ${line}`);
  }
  assert.doesNotMatch(script, /FTP_PROXY|SECRET_TOKEN|must-not-appear/);
});

test('extractProcessProxyEnv deduplicates case-insensitively with exact uppercase priority and normalized uppercase keys', () => {
  const mixed = {
    http_proxy: 'http://127.0.0.1:1111',
    HTTP_PROXY: 'http://127.0.0.1:7897',
    https_proxy: 'http://127.0.0.1:7897',
    all_proxy: 'socks5h://127.0.0.1:7897',
    No_Proxy: 'localhost,127.0.0.1,::1',
    node_use_env_proxy: '1',
  };

  const extracted = lifecycle.extractProcessProxyEnv(mixed);
  assert.deepEqual(extracted, {
    HTTP_PROXY: 'http://127.0.0.1:7897',
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    ALL_PROXY: 'socks5h://127.0.0.1:7897',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    NODE_USE_ENV_PROXY: '1',
  });

  const script = lifecycle.buildWindowsRelaunchInnerScript(MOCK_WIN_EXE, [], 'desktop', mixed);
  const httpMatches = script.match(/SetEnvironmentVariable\('HTTP_PROXY',/g) || [];
  assert.equal(httpMatches.length, 1);
  assert.doesNotMatch(script, /127\.0\.0\.1:1111/);

  // Empty exact uppercase falls back to valid lowercase; multiple non-uppercase variants pick first valid value.
  assert.deepEqual(
    lifecycle.extractProcessProxyEnv({
      HTTP_PROXY: '',
      http_proxy: 'http://127.0.0.1:7898',
      Http_Proxy: 'http://127.0.0.1:7899',
    }),
    { HTTP_PROXY: 'http://127.0.0.1:7898' }
  );
});

test('Windows relaunch script safely escapes single quotes and PowerShell metacharacters in proxy values', () => {
  const env = {
    HTTP_PROXY: "http://u:p'w@127.0.0.1:7890",
    NO_PROXY: "localhost,127.0.0.1,::1,$env:USERPROFILE;`;\"'",
  };

  const script = lifecycle.buildWindowsRelaunchInnerScript(MOCK_WIN_EXE, [], 'desktop', env);
  assert.ok(
    script.includes(
      "[System.Environment]::SetEnvironmentVariable('HTTP_PROXY', 'http://u:p''w@127.0.0.1:7890', 'Process')"
    )
  );
  assert.ok(
    script.includes(
      "[System.Environment]::SetEnvironmentVariable('NO_PROXY', 'localhost,127.0.0.1,::1,$env:USERPROFILE;`;\"''', 'Process')"
    )
  );
});

test('extractProcessProxyEnv and script builder reject proxy values containing CR, LF, or NUL characters', () => {
  const maliciousEnv = {
    HTTP_PROXY: 'http://127.0.0.1:7890\nStart-Process calc.exe',
    HTTPS_PROXY: 'http://127.0.0.1:7890\rWrite-Output injected',
    ALL_PROXY: 'socks5://127.0.0.1:7890\0truncated',
    NO_PROXY: 'localhost\r\n127.0.0.1',
    NODE_USE_ENV_PROXY: '1\n',
  };

  assert.deepEqual(lifecycle.extractProcessProxyEnv(maliciousEnv), {});
  const script = lifecycle.buildWindowsRelaunchInnerScript(MOCK_WIN_EXE, [], 'desktop', maliciousEnv);
  assert.doesNotMatch(script, /SetEnvironmentVariable/);
  assert.doesNotMatch(script, /calc\.exe|injected|truncated/);

  // Malicious uppercase entry is skipped without blocking a valid lowercase fallback.
  assert.deepEqual(
    lifecycle.extractProcessProxyEnv({
      HTTP_PROXY: 'http://127.0.0.1:7890\nbad',
      http_proxy: 'http://127.0.0.1:7897',
    }),
    { HTTP_PROXY: 'http://127.0.0.1:7897' }
  );
});

test('triggerDesktopHostRelaunch writes UTF-8 BOM ps1 with sanitized proxy env and cleans up on dispatch failure', async () => {
  await withTempDir(async (sandboxDir) => {
    const mockExe = path.join(sandboxDir, 'Antigravity.exe');
    const tempOutDir = path.join(sandboxDir, 'tmp');
    fs.writeFileSync(mockExe, 'mock-binary', 'utf8');

    const baseEnv = {
      AGY_CLAUDE_STUDIO_HOST_EXE: mockExe,
      ANTIGRAVITY_INTERNAL_FLAG: 'strip-me',
      NODE_OPTIONS: '--max-old-space-size=4096',
      HTTP_PROXY: 'http://127.0.0.1:7897',
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      ALL_PROXY: 'socks5://127.0.0.1:7897',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      NODE_USE_ENV_PROXY: '1',
    };

    // 1. Success path: verify UTF-8 BOM, sanitized dispatch env, proxy SetEnvironmentVariable lines, and try/finally.
    let capturedFile = '';
    let capturedArgs = null;
    let capturedOpts = null;
    let writtenBytes = null;
    let writtenText = '';

    const okResult = await lifecycle.triggerDesktopHostRelaunch({
      env: baseEnv,
      platform: 'win32',
      tempDir: tempOutDir,
      allowInTest: true,
      execFileFn: async (file, args, opts) => {
        capturedFile = file;
        capturedArgs = args;
        capturedOpts = opts;
        const ps1Path = opts?.env?.AGY_RELAUNCH_PS1;
        assert.ok(ps1Path && fs.existsSync(ps1Path), 'relaunch ps1 should exist during dispatch');
        writtenBytes = fs.readFileSync(ps1Path);
        writtenText = writtenBytes.toString('utf8');
        return '{"ok":true,"method":"shell_application"}';
      },
    });

    assert.equal(okResult.ok, true);
    assert.equal(okResult.relaunching, true);
    assert.equal(okResult.executablePath, mockExe);
    assert.equal(capturedFile, 'powershell.exe');
    assert.ok(Array.isArray(capturedArgs) && capturedArgs.includes('-Sta'));
    assert.equal(capturedOpts.env.AGY_CLAUDE_STUDIO_HOST_EXE, undefined);
    assert.equal(capturedOpts.env.ANTIGRAVITY_INTERNAL_FLAG, undefined);
    assert.equal(capturedOpts.env.NODE_OPTIONS, undefined);
    assert.equal(capturedOpts.env.HTTP_PROXY, 'http://127.0.0.1:7897');

    // Verify UTF-8 BOM (EF BB BF)
    assert.equal(writtenBytes[0], 0xef);
    assert.equal(writtenBytes[1], 0xbb);
    assert.equal(writtenBytes[2], 0xbf);
    assert.ok(writtenText.includes("[System.Environment]::SetEnvironmentVariable('HTTP_PROXY', 'http://127.0.0.1:7897', 'Process')"));
    assert.ok(writtenText.includes("[System.Environment]::SetEnvironmentVariable('ALL_PROXY', 'socks5://127.0.0.1:7897', 'Process')"));
    assert.ok(writtenText.includes("[System.Environment]::SetEnvironmentVariable('NO_PROXY', 'localhost,127.0.0.1,::1', 'Process')"));
    assert.ok(writtenText.includes("[System.Environment]::SetEnvironmentVariable('NODE_USE_ENV_PROXY', '1', 'Process')"));
    assert.match(writtenText, /try \{[\s\S]*Start-Process -FilePath \$exe[\s\S]*\} finally \{[\s\S]*Remove-Item -LiteralPath \$PSCommandPath/);

    // Clean up the mock-dispatched file before failure tests.
    fs.unlinkSync(capturedOpts.env.AGY_RELAUNCH_PS1);

    // 2. Async dispatch rejection: Node catch block must synchronously remove temp .ps1.
    let failedAsyncPs1Path = '';
    await assert.rejects(
      lifecycle.triggerDesktopHostRelaunch({
        env: { ...baseEnv, HTTP_PROXY: "http://u:p'w@127.0.0.1:7890" },
        platform: 'win32',
        tempDir: tempOutDir,
        allowInTest: true,
        execFileFn: async (_file, _args, opts) => {
          failedAsyncPs1Path = opts?.env?.AGY_RELAUNCH_PS1;
          assert.equal(fs.existsSync(failedAsyncPs1Path), true);
          throw new Error('mock async dispatch failure');
        },
      }),
      /mock async dispatch failure/
    );
    assert.ok(failedAsyncPs1Path);
    assert.equal(fs.existsSync(failedAsyncPs1Path), false, 'temp ps1 must be deleted on async dispatch failure');

    // 3. Synchronous dispatch throw: Node catch block must also synchronously remove temp .ps1.
    let failedSyncPs1Path = '';
    await assert.rejects(
      lifecycle.triggerDesktopHostRelaunch({
        env: baseEnv,
        platform: 'win32',
        tempDir: tempOutDir,
        allowInTest: true,
        execFileFn: (_file, _args, opts) => {
          failedSyncPs1Path = opts?.env?.AGY_RELAUNCH_PS1;
          assert.equal(fs.existsSync(failedSyncPs1Path), true);
          throw new Error('mock sync dispatch failure');
        },
      }),
      /mock sync dispatch failure/
    );
    assert.ok(failedSyncPs1Path);
    assert.equal(fs.existsSync(failedSyncPs1Path), false, 'temp ps1 must be deleted on sync dispatch failure');
  });
});
