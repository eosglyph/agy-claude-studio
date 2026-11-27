import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseLatestReleases,
  buildReleaseContentHash,
  buildTranslationCacheKey,
  translateReleasesWithCache,
} from '../scripts/fetch-agy-changelog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

test('parseLatestReleases preserves short headlines and short bullet entries', () => {
  const sample = [
    'Antigravity App',
    'v2.35.3',
    'Latest',
    'November 25, 2026',
    'UI polish',
    'Fixed crash.',
    'Added /btw.',
    'Improvements(1)Faster boot.',
  ].join('\n');

  const releases = parseLatestReleases(sample, 2);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].version, 'v2.35.3');
  assert.equal(releases[0].date, 'November 25, 2026');
  assert.equal(releases[0].headline, 'UI polish');
  assert.deepEqual(releases[0].bullets, [
    'Fixed crash.',
    'Added /btw.',
    '【改进 (1)】Faster boot.',
  ]);
});

test('translateReleasesWithCache keys by SHA-256 content digest + targetLang and invalidates when body changes', async () => {
  const state = {};
  let calls = 0;
  const mockTranslate = async (line, targetLang) => {
    calls += 1;
    return { text: `[${targetLang}] ${line}`, failed: false };
  };

  const relA = {
    version: 'v2.35.3',
    date: 'November 25, 2026',
    headline: 'Same Title',
    bullets: ['Fixed crash A.', 'Improved speed.'],
  };

  const first = await translateReleasesWithCache([relA], 'zh-CN', state, { translateLineFn: mockTranslate });
  assert.equal(calls, 3);
  assert.equal(first[0].bulletsZh[0], '[zh-CN] Fixed crash A.');

  const keyA = buildTranslationCacheKey(relA, 'zh-CN');
  assert.ok(keyA.startsWith(`v2.35.3:zh-CN:${buildReleaseContentHash(relA)}`));
  assert.ok(state.translatedCache[keyA]);

  // Same version, same headline, same bullet count — cache hit
  await translateReleasesWithCache([relA], 'zh-CN', state, { translateLineFn: mockTranslate });
  assert.equal(calls, 3);

  // Body changed while headline and bullet count remained identical — cache miss
  const relB = {
    version: 'v2.35.3',
    date: 'November 25, 2026',
    headline: 'Same Title',
    bullets: ['Fixed crash B.', 'Improved speed.'],
  };
  const second = await translateReleasesWithCache([relB], 'zh-CN', state, { translateLineFn: mockTranslate });
  assert.equal(calls, 6);
  assert.equal(second[0].bulletsZh[0], '[zh-CN] Fixed crash B.');
});

test('translateReleasesWithCache does not persist failed fallback translations into cache', async () => {
  const state = {};
  let shouldFail = true;
  let calls = 0;
  const mockTranslate = async (line, targetLang) => {
    calls += 1;
    if (shouldFail) return { text: line, failed: true };
    return { text: `[${targetLang}] ${line}`, failed: false };
  };

  const rel = {
    version: 'v2.35.3',
    date: 'November 25, 2026',
    headline: 'Release title',
    bullets: ['Short fix.'],
  };

  const fallbackRes = await translateReleasesWithCache([rel], 'zh-CN', state, { translateLineFn: mockTranslate });
  assert.equal(fallbackRes[0].headlineZh, 'Release title');
  assert.equal(fallbackRes[0].bulletsZh[0], 'Short fix.');
  assert.equal(Object.keys(state.translatedCache).length, 0);

  // Next attempt after translation service recovers should retry and cache
  shouldFail = false;
  const recoveredRes = await translateReleasesWithCache([rel], 'zh-CN', state, { translateLineFn: mockTranslate });
  assert.equal(calls, 4);
  assert.equal(recoveredRes[0].headlineZh, '[zh-CN] Release title');
  assert.equal(recoveredRes[0].bulletsZh[0], '[zh-CN] Short fix.');
  assert.equal(Object.keys(state.translatedCache).length, 1);
});

test('README.md and README.zh-CN.md do not reference retired flat-root commands or paths', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.inject, 'node src/inject.js');
  assert.equal(pkg.scripts.launch, 'node src/inject.js --launch');
  assert.equal(pkg.scripts.remove, 'node src/remove.js');

  for (const file of ['README.md', 'README.zh-CN.md']) {
    const content = fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
    assert.doesNotMatch(content, /\blaunch\.bat\b/);
    assert.doesNotMatch(content, /\.\/launch\.sh\b/);
    assert.doesNotMatch(content, /\bwatch\.bat\b/);
    assert.doesNotMatch(content, /\binject\.bat\b/);
    assert.doesNotMatch(content, /\bnode inject\.js\b/);
    assert.doesNotMatch(content, /\bnode remove\.js\b/);
    assert.doesNotMatch(content, /0-Token|零\s*Token/i);
  }
});

test('release.yml enforces strict version parity across tag, package/plugin manifests, cdp, and installers', () => {
  const workflow = fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.doesNotMatch(workflow, /::warning::Release version/);
  assert.match(workflow, /::error::Release version/);
  assert.match(workflow, /process\.exit\(1\)/);
  assert.match(workflow, /plugin\.json/);
  assert.match(workflow, /src\/cdp\.js/);
  assert.match(workflow, /installer\/common\/CdpClient\.cs/);
  assert.match(workflow, /installer\/setup\/Program\.cs/);
  assert.match(workflow, /installer\/macos\/Common\/CdpClient\.swift/);
});
