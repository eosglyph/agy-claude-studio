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

// Released inject.sh, also used to exercise CRLF checkouts and edited copies.
const releasedInject = `#!/usr/bin/env bash
# Inject Claude Studio (agy-claude-studio) into Antigravity windows once.
cd "$(dirname "$0")"
echo "Injecting Claude Studio (agy-claude-studio)..."
node inject.js
`;

function writeLayout(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const file of ['cdp.js', 'inject.js', 'ui-runtime.js', 'style.css', 'lifecycle.js']) {
    fs.writeFileSync(path.join(root, 'src', file), '/* new layout */\n');
  }
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

test('cleanupLegacyFlatRootFiles removes published originals while preserving valid root, src, ops, and custom files', () => {
  const rootDir = makeTempDir('agy-cs-cleanup-');
  try {
    writeLayout(rootDir);
    fs.mkdirSync(path.join(rootDir, 'scripts', 'ops'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'package.json'), '{"name":"agy-claude-studio"}\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'plugin.json'), '{"name":"agy-claude-studio"}\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'i18n-compat.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'scripts', 'ops', 'user.js'), '// user script\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'custom-user-note.txt'), 'keep me\n', 'utf8');

    for (const file of lifecycle.LEGACY_FLAT_ROOT_FILES) {
      fs.writeFileSync(path.join(rootDir, file), `legacy:${file}\n`, 'utf8');
    }

    fs.writeFileSync(path.join(rootDir, 'inject.sh'), releasedInject.replace(/\n/g, '\r\n'));
    const modifiedScript = releasedInject + '# customized\n';
    fs.writeFileSync(path.join(rootDir, 'launch.sh'), modifiedScript);
    const res = lifecycle.cleanupLegacyFlatRootFiles(rootDir);
    assert.equal(res.skipped, false);
    assert.equal(res.reason, 'cleaned');
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.removed, ['inject.sh']);
    assert.equal(fs.existsSync(path.join(rootDir, 'inject.sh')), false);
    assert.deepEqual(res.preserved, lifecycle.LEGACY_FLAT_ROOT_FILES.filter((file) => file !== 'inject.sh'));
    assert.equal(fs.readFileSync(path.join(rootDir, 'launch.sh'), 'utf8'), modifiedScript);

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
      writeLayout(dir);
      fs.writeFileSync(path.join(dir, 'inject.sh'), releasedInject);
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
    for (const dir of [repoDir, wtDir]) assert.ok(fs.existsSync(path.join(dir, 'inject.sh')));
    assert.equal(fs.existsSync(path.join(wtDir, 'cdp.js')), true);
    assert.equal(fs.existsSync(path.join(wtDir, 'launch.bat')), true);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(wtDir, { recursive: true, force: true });
  }
});

test('cleanupLegacyFlatRootFiles skips a partial layout even when src/cdp.js exists', () => {
  const rootDir = makeTempDir('agy-cs-nosrc-');
  try {
    writeLayout(rootDir);
    fs.unlinkSync(path.join(rootDir, 'src', 'style.css'));
    fs.writeFileSync(path.join(rootDir, 'inject.sh'), releasedInject);
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

test('cleanup preserves links even when their target contains a released original', (t) => {
  const root = makeTempDir('agy-cs-link-');
  try {
    writeLayout(root);
    const original = path.join(root, 'keep');
    fs.writeFileSync(original, releasedInject);
    const link = path.join(root, 'inject.sh');
    try {
      fs.symlinkSync(original, link, 'file');
    } catch (err) {
      if (err.code !== 'EPERM') throw err;
      // Windows without symlink privileges still permits directory junctions.
      fs.symlinkSync(path.join(root, 'src'), link, 'junction');
      t.diagnostic('Tested a junction on this Windows host');
    }
    assert.deepEqual(lifecycle.cleanupLegacyFlatRootFiles(root).preserved, ['inject.sh']);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(fs.readFileSync(original, 'utf8'), releasedInject);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test('v2.2.3 overlay, restart cleanup and next archive update use the installed subprocess injector', async () => {
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
    fs.writeFileSync(path.join(pluginDir, 'inject.sh'), releasedInject);
    fs.writeFileSync(path.join(pluginDir, 'launch.bat'), 'user-edited');
    writeLayout(releaseSrc);

    const markerPath = path.join(pluginDir, 'archive-reinject-marker.txt');
    fs.writeFileSync(path.join(releaseSrc, 'plugin.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.4' }), 'utf8');
    fs.writeFileSync(path.join(releaseSrc, 'package.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.4' }), 'utf8');
    fs.writeFileSync(path.join(releaseSrc, 'src', 'cdp.js'), 'module.exports = { PLUGIN_VERSION: "2.2.4" };\n', 'utf8');
    fs.writeFileSync(
      path.join(releaseSrc, 'src', 'inject.js'),
      `require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'subprocess-ran:' + process.pid, 'utf8');\n`,
      'utf8'
    );

    // v2.2.3 copied the new layout over the flat install and called its cached injector.
    // Start a fresh process against the installed lifecycle as the restarted host does.
    fs.copyFileSync(new URL('../src/lifecycle.js', import.meta.url), path.join(releaseSrc, 'src', 'lifecycle.js'));
    fs.cpSync(releaseSrc, pluginDir, { recursive: true });
    assert.ok(fs.existsSync(path.join(pluginDir, 'inject.sh')));
    const restart = execFileSync(process.execPath, ['-e',
      "console.log(JSON.stringify(require('./src/lifecycle').cleanupLegacyFlatRootFiles(process.cwd())))",
    ], { cwd: pluginDir, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(restart).removed, ['inject.sh']);
    assert.equal(fs.existsSync(markerPath), false);
    fs.writeFileSync(path.join(releaseSrc, 'package.json'), JSON.stringify({ version: '2.2.5' }));
    const tarFile = path.join(tmpDir, 'v2.2.5.tar.gz');
    execFileSync('tar', ['-czf', tarFile, '-C', tmpDir, 'agy-claude-studio-2.2.4']);
    const tarBuf = fs.readFileSync(tarFile);

    const updateOptions = {
      pluginDir,
      pluginDataDir,
      targetTag: 'v2.2.5',
      fetchFn: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength),
      }),
    };
    const updRes = await studioMain.performStudioSelfUpdate(updateOptions);

    assert.equal(updRes.ok, true);
    assert.equal(updRes.mode, 'archive');
    assert.equal(updRes.version, '2.2.5');

    assert.equal(updRes.filesUpdated, true);
    assert.equal(updRes.reinjectOk, true);
    assert.equal(updRes.needsRestart, true);
    assert.match(updRes.reinjectError, /updated plugin backend/);
    assert.equal(fs.existsSync(path.join(pluginDir, 'inject.sh')), false);
    assert.equal(fs.readFileSync(path.join(pluginDir, 'launch.bat'), 'utf8'), 'user-edited');
    assert.equal(fs.existsSync(path.join(pluginDir, 'src', 'cdp.js')), true);
    assert.equal(fs.existsSync(markerPath), true);
    assert.match(fs.readFileSync(markerPath, 'utf8'), /^subprocess-ran:\d+$/);
    const failed = await studioMain.performStudioSelfUpdate({ ...updateOptions, reinjectFn() { throw Error('activation failed'); } });
    assert.equal(failed.ok, true);
    assert.equal(failed.filesUpdated, true);
    assert.equal(failed.reinjectOk, false);
    assert.match(failed.reinjectError, /activation failed/);
    assert.equal(failed.needsRestart, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
