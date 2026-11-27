import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rippleCore = require('../src/ripple-core.js');

test('hash and fractalNoise are deterministic and bounded in [0, 1)', () => {
  for (let i = -20; i < 40; i++) {
    const h1 = rippleCore.hash(i, i * 3 + 7);
    const h2 = rippleCore.hash(i, i * 3 + 7);
    assert.equal(h1, h2);
    assert.ok(h1 >= 0 && h1 < 1);
    const n = rippleCore.fractalNoise(i * 0.13, i * 0.27);
    assert.ok(n >= 0 && n <= 1);
  }
});

test('glyphIndex stays within GLYPHS atlas bounds', () => {
  for (let t = 0; t < 10; t++) {
    for (let c = 0; c < 15; c++) {
      const idx = rippleCore.glyphIndex(c, t, t);
      assert.ok(Number.isInteger(idx));
      assert.ok(idx >= 0 && idx < rippleCore.GLYPHS.length);
    }
  }
});

test('createWaveField propagates disturbance and damps back to rest', () => {
  const wf = rippleCore.createWaveField(20, 15, () => 0.5);
  assert.equal(wf.active(), false);
  wf.disturb(10, 7);
  assert.equal(wf.active(), true);
  wf.advance(0.05);
  let maxH = 0;
  for (let i = 0; i < wf.height.length; i++) {
    maxH = Math.max(maxH, Math.abs(wf.height[i]));
  }
  assert.ok(maxH > 0, 'wave height should become non-zero after disturbance');
  // Advance enough seconds so wave damps down cleanly below REST_HEIGHT
  for (let step = 0; step < 500; step++) wf.advance(0.05);
  assert.equal(wf.active(), false);
});

test('createWaveField handles zero-sized grids and out-of-bounds clicks safely', () => {
  const zero = rippleCore.createWaveField(0, 0);
  zero.disturb(5, 5);
  assert.equal(zero.active(), false);

  const small = rippleCore.createWaveField(4, 4, () => 0.2);
  small.disturb(-10, 99);
  assert.equal(small.active(), true);
});

test('parseCssColorToRgb parses hex and rgb(a) formats', () => {
  assert.deepEqual(rippleCore.parseCssColorToRgb('#4d6bfe'), [77, 107, 254]);
  assert.deepEqual(rippleCore.parseCssColorToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(rippleCore.parseCssColorToRgb('rgb(19, 22, 29)'), [19, 22, 29]);
  assert.deepEqual(rippleCore.parseCssColorToRgb('rgba(127, 166, 255, 0.8)'), [127, 166, 255]);
  assert.equal(rippleCore.parseCssColorToRgb('transparent'), null);
});

test('cloudClear keeps subtle atmospheric range without over-brightening idle dark matrix', () => {
  assert.ok(rippleCore.RIPPLE.idleAlphaDark > 0 && rippleCore.RIPPLE.idleAlphaDark <= 0.18);
  let min = 1;
  let max = 0;
  for (let i = 0; i < 60; i++) {
    const v = rippleCore.cloudClear(i * 47, i * 31);
    assert.ok(v >= 0.22 && v <= 1);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(min < 0.35, `expected low cloud valley (< 0.35), got ${min}`);
  assert.ok(max >= min);
});

test('createWaveField idle advance short-circuits cleanly without disturbing rest state', () => {
  const wf = rippleCore.createWaveField(12, 8, () => 0.5);
  assert.equal(wf.active(), false);
  wf.advance(0.05);
  wf.advance(0.05);
  assert.equal(wf.active(), false);
  for (let i = 0; i < wf.height.length; i++) {
    assert.equal(wf.height[i], 0);
  }
});
