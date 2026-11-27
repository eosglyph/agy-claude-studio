import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lifecycle = require('../src/lifecycle.js');
const studioMain = require('../sidecars/studio/main.mjs');

function makeTempDir(prefix) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('LEGACY_FLAT_ROOT_FILES contains exact 31 pre-v2.2.4 migrated and retired root files', () => {
  assert.equal(lifecycle.LEGACY_FLAT_ROOT_FILES.length, 31);
  assert.equal(new Set(lifecycle.LEGACY_FLAT_ROOT_FILES).size, 31);
  assert.ok(lifecycle.LEGACY_FLAT_ROOT_FILES.includes('cdp.js'));
  assert.ok(lifecycle.LEGACY_FLAT_ROOT_FILES.includes('ui-runtime.js'));
  assert.ok(lifecycle.LEGACY_FLAT_ROOT_FILES.includes('style.css'));
  assert.ok(lifecycle.LEGACY_FLAT_ROOT_FILES.includes('watch-hidden.vbs'));
  assert.ok(lifecycle.LEGACY_FLAT_ROOT_FILES.includes('launch.bat'));
  assert.ok(lifecycle.LEGACY_FLAT_ROOT_FILES.includes('launch.sh'));
});

test('cleanupLegacyFlatRootFiles removes all 31 legacy files while preserving valid root, src, ops, and custom files', () => {
  const rootDir = makeTempDir('agy-cs-cleanup-');
  try {
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'scripts', 'ops'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src', 'cdp.js'), '// new layout\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'src', 'inject.js'), '// new inject\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'package.json'), '{"name":"agy-claude-studio"}\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'plugin.json'), '{"name":"agy-claude-studio"}\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'i18n-compat.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'scripts', 'ops', 'user.js'), '// user script\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'custom-user-note.txt'), 'keep me\n', 'utf8');

    for (const file of lifecycle.LEGACY_FLAT_ROOT_FILES) {
      fs.writeFileSync(path.join(rootDir, file), `legacy:${file}\n`, 'utf8');
    }

    const res = lifecycle.cleanupLegacyFlatRootFiles(rootDir);
    assert.equal(res.skipped, false);
    assert.equal(res.reason, 'cleaned');
    assert.deepEqual(res.errors, []);
    assert.equal(res.removed.length, 31);

    for (const file of lifecycle.LEGACY_FLAT_ROOT_FILES) {
      assert.equal(fs.existsSync(path.join(rootDir, file)), false, `Expected ${file} to be removed`);
    }

    assert.equal(fs.existsSync(path.join(rootDir, 'package.json')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'i18n-compat.json')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'src', 'cdp.js')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'src', 'inject.js')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'scripts', 'ops', 'user.js')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'custom-user-note.txt')), true);

    // Re-running on an already clean directory is a fast no-op
    const second = lifecycle.cleanupLegacyFlatRootFiles(rootDir);
    assert.equal(second.skipped, false);
    assert.equal(second.reason, 'already_clean');
    assert.deepEqual(second.removed, []);
    assert.deepEqual(second.errors, []);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('cleanupLegacyFlatRootFiles skips when .git directory or .git worktree file is present', () => {
  const repoDir = makeTempDir('agy-cs-gitdir-');
  const wtDir = makeTempDir('agy-cs-gitfile-');
  try {
    for (const dir of [repoDir, wtDir]) {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'cdp.js'), '// src\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'cdp.js'), '// legacy\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'launch.bat'), '@echo off\n', 'utf8');
    }
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(wtDir, '.git'), 'gitdir: /tmp/fake-worktree\n', 'utf8');

    const resRepo = lifecycle.cleanupLegacyFlatRootFiles(repoDir);
    assert.equal(resRepo.skipped, true);
    assert.equal(resRepo.reason, 'git_repo');
    assert.deepEqual(resRepo.removed, []);
    assert.equal(fs.existsSync(path.join(repoDir, 'cdp.js')), true);
    assert.equal(fs.existsSync(path.join(repoDir, 'launch.bat')), true);

    const resWt = lifecycle.cleanupLegacyFlatRootFiles(wtDir);
    assert.equal(resWt.skipped, true);
    assert.equal(resWt.reason, 'git_repo');
    assert.deepEqual(resWt.removed, []);
    assert.equal(fs.existsSync(path.join(wtDir, 'cdp.js')), true);
    assert.equal(fs.existsSync(path.join(wtDir, 'launch.bat')), true);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(wtDir, { recursive: true, force: true });
  }
});

test('cleanupLegacyFlatRootFiles skips when src/cdp.js is missing', () => {
  const rootDir = makeTempDir('agy-cs-nosrc-');
  try {
    fs.writeFileSync(path.join(rootDir, 'cdp.js'), '// legacy\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'watch.bat'), '@echo off\n', 'utf8');

    const res = lifecycle.cleanupLegacyFlatRootFiles(rootDir);
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'missing_src_layout');
    assert.deepEqual(res.removed, []);
    assert.equal(fs.existsSync(path.join(rootDir, 'cdp.js')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'watch.bat')), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('runSubprocessReinject executes target src/inject.js in a fresh Node subprocess', async () => {
  const pluginDir = makeTempDir('agy-cs-reinject-');
  try {
    fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true });
    const markerPath = path.join(pluginDir, 'reinject-marker.json');
    const stubInject = path.join(pluginDir, 'src', 'inject.js');
    fs.writeFileSync(
      stubInject,
      [
        "const fs = require('fs');",
        "const path = require('path');",
        `fs.writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify({`,
        '  pid: process.pid,',
        '  cwd: fs.realpathSync.native(process.cwd()),',
        '  script: fs.realpathSync.native(__filename),',
        "}));",
        "console.log('reinjected-ok');",
      ].join('\n'),
      'utf8'
    );

    const res = await studioMain.runSubprocessReinject(pluginDir);
    assert.equal(res.ok, true);
    assert.equal(fs.realpathSync.native(res.scriptPath), fs.realpathSync.native(stubInject));
    assert.match(res.stdout, /reinjected-ok/);

    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    assert.notEqual(marker.pid, process.pid);
    assert.equal(marker.cwd, pluginDir);
    assert.equal(marker.script, fs.realpathSync.native(stubInject));
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

test('runSubprocessReinject captures stderr when subprocess exits non-zero', async () => {
  const pluginDir = makeTempDir('agy-cs-reinject-fail-');
  try {
    fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'src', 'inject.js'),
      "console.error('boom-stderr'); process.exit(2);\n",
      'utf8'
    );

    await assert.rejects(
      () => studioMain.runSubprocessReinject(pluginDir),
      (err) => {
        assert.match(err.message, /boom-stderr/);
        assert.match(err.stderr, /boom-stderr/);
        return true;
      }
    );
  } finally {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }
});

test('performArchiveSelfUpdate cleans legacy flat files and runs subprocess reinject on non-git install', async () => {
  const tmpDir = makeTempDir('agy-cs-arch-cleanup-');
  try {
    const pluginDir = path.join(tmpDir, 'installed-plugin');
    const pluginDataDir = path.join(tmpDir, 'plugin-data');
    const releaseSrc = path.join(tmpDir, 'agy-claude-studio-2.2.4');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(pluginDataDir, { recursive: true });
    fs.mkdirSync(path.join(releaseSrc, 'src'), { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.3' }), 'utf8');
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.3' }), 'utf8');
    for (const file of lifecycle.LEGACY_FLAT_ROOT_FILES) {
      fs.writeFileSync(path.join(pluginDir, file), `old:${file}\n`, 'utf8');
    }

    const markerPath = path.join(pluginDir, 'archive-reinject-marker.txt');
    fs.writeFileSync(path.join(releaseSrc, 'plugin.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.4' }), 'utf8');
    fs.writeFileSync(path.join(releaseSrc, 'package.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.4' }), 'utf8');
    fs.writeFileSync(path.join(releaseSrc, 'src', 'cdp.js'), 'module.exports = { PLUGIN_VERSION: "2.2.4" };\n', 'utf8');
    fs.writeFileSync(
      path.join(releaseSrc, 'src', 'inject.js'),
      `require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'subprocess-ran:' + process.pid, 'utf8');\n`,
      'utf8'
    );

    const tarFile = path.join(tmpDir, 'v2.2.4.tar.gz');
    execFileSync('tar', ['-czf', tarFile, '-C', tmpDir, 'agy-claude-studio-2.2.4']);
    const tarBuf = fs.readFileSync(tarFile);

    const updRes = await studioMain.performArchiveSelfUpdate({
      pluginDir,
      pluginDataDir,
      targetTag: 'v2.2.4',
      fetchFn: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength),
      }),
    });

    assert.equal(updRes.ok, true);
    assert.equal(updRes.mode, 'archive');
    assert.equal(updRes.version, '2.2.4');

    for (const file of lifecycle.LEGACY_FLAT_ROOT_FILES) {
      assert.equal(fs.existsSync(path.join(pluginDir, file)), false, `Expected ${file} to be cleaned`);
    }
    assert.equal(fs.existsSync(path.join(pluginDir, 'src', 'cdp.js')), true);
    assert.equal(fs.existsSync(markerPath), true);
    assert.match(fs.readFileSync(markerPath, 'utf8'), /^subprocess-ran:\d+$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
