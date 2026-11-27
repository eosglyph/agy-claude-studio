import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mascotCore = require('../src/mascot-core.js');
const crabAssets = require('../src/crab-assets.js');

test('all 19 crab animations have matching body & ink PNG data URIs', () => {
  const keys = Object.keys(crabAssets.CRAB_SHEETS);
  assert.equal(keys.length, 19);
  for (const key of keys) {
    const sheet = crabAssets.CRAB_SHEETS[key];
    const url = crabAssets.CRAB_SHEET_URLS[key];
    assert.ok(sheet.frames >= 1 && sheet.still >= 0 && sheet.still < sheet.frames, `invalid sheet ${key}`);
    assert.ok(url && url.body.startsWith('data:image/png;base64,'), `missing body png for ${key}`);
    assert.ok(url && url.ink.startsWith('data:image/png;base64,'), `missing ink png for ${key}`);
  }
});

test('mascot state machine handles idle, sleep/wake, extras, moments, and reactions', () => {
  const t0 = 100000;
  const stage = mascotCore.freshStage(t0);
  const around = { extras: mascotCore.CRAB_EXTRAS, extrasAllowed: true, random: () => 0.5 };

  // Starts idle
  let pick = mascotCore.decideStage(stage, t0, { state: 'idle', animation: 'idle', priority: 1 }, around);
  assert.equal(pick.key, 'idle');

  // After 35s (> EXTRA_MIN_MS + 0.5 * EXTRA_SPAN_MS = 30s), plays an idle extra
  pick = mascotCore.decideStage(stage, t0 + 35000, { state: 'idle', animation: 'idle', priority: 1 }, around);
  assert.equal(pick.key, 'idle-wave');
  assert.equal(pick.mode, 'once');
  mascotCore.finishStage(stage, 'idle-wave', t0 + 36000, () => 0.5);

  // After 60s of quiet, sleeps
  pick = mascotCore.decideStage(stage, t0 + mascotCore.SLEEP_AFTER_MS + 100, { state: 'idle', animation: 'idle', priority: 1 }, around);
  assert.equal(pick.key, 'sleeping');

  // Thinking overrides sleep
  pick = mascotCore.decideStage(stage, t0 + 70000, { state: 'thinking', animation: 'thinking', priority: 6 }, around);
  assert.equal(pick.key, 'thinking');
  assert.equal(stage.asleep, false);

  // Attention moment queues behind higher priority error moment and promotes when error expires
  assert.equal(mascotCore.takeMoment(stage, 'error', t0 + 71000), true);
  assert.equal(mascotCore.takeMoment(stage, 'attention', t0 + 71500), false);
  assert.equal(stage.queued, 'attention');
  pick = mascotCore.decideStage(stage, t0 + 72000, { state: 'idle', animation: 'idle', priority: 1 }, around);
  assert.equal(pick.key, 'error');
  pick = mascotCore.decideStage(stage, t0 + 76000, { state: 'idle', animation: 'idle', priority: 1 }, around);
  assert.equal(pick.key, 'happy');
});

test('levelFromActiveInfo maps Antigravity trajectory states accurately', () => {
  assert.equal(mascotCore.levelFromActiveInfo(null).state, 'idle');
  assert.equal(mascotCore.levelFromActiveInfo({ isRunning: true, isThinking: true }).animation, 'thinking');
  assert.equal(mascotCore.levelFromActiveInfo({ isRunning: true, isThinking: false }).animation, 'typing');
  assert.equal(mascotCore.levelFromActiveInfo({ hasError: true, isRunning: true }).animation, 'error');
});
