import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const effortCore = require('../src/effort-core.js');

test('resolveClaudeEffortSteps groups model variants in ascending strength and falls back cleanly', () => {
  const options = [
    { label: 'Gemini 4 Hydrogen XHigh' },
    { label: 'Gemini 4 Hydrogen Low' },
    { label: 'Gemini 4 Hydrogen High' },
    { label: 'Gemini 4 Hydrogen Medium' },
    { label: 'Gemini 4 Argon High' },
  ];
  const res = effortCore.resolveClaudeEffortSteps(options, 'Gemini 4 Hydrogen Medium', 'medium');
  assert.equal(res.baseName, 'Gemini 4 Hydrogen');
  assert.deepEqual(
    res.steps.map((s) => s.id),
    ['low', 'medium', 'high', 'xhigh']
  );
  assert.equal(res.selectedIdx, 1);

  const extraAlias = effortCore.resolveClaudeEffortSteps(
    [{ label: 'Gemini 4 Hydrogen Low' }, { label: 'Gemini 4 Hydrogen Medium' }, { label: 'Gemini 4 Hydrogen High' }, { label: 'Gemini 4 Hydrogen XHigh' }],
    'Gemini 4 Hydrogen Extra',
    'extra'
  );
  assert.equal(extraAlias.selectedIdx, 3);
  assert.equal(extraAlias.steps[3].id, 'xhigh');
  assert.equal(extraAlias.steps[3].display, 'Extra');

  const hostXHigh = effortCore.resolveClaudeEffortSteps(
    [{ label: 'Gemini 4 Hydrogen Low' }, { label: 'Gemini 4 Hydrogen Medium' }, { label: 'Gemini 4 Hydrogen High' }, { label: 'Gemini 4 Hydrogen XHigh' }],
    'Gemini 4 Hydrogen (XHigh)',
    'Extra'
  );
  assert.equal(hostXHigh.selectedIdx, 3);
  assert.equal(hostXHigh.steps[3].id, 'xhigh');
  assert.equal(hostXHigh.steps[3].display, 'Extra');

  const noExtraBadge = effortCore.resolveClaudeEffortSteps(
    [{ label: 'Gemini 4 Hydrogen Low' }, { label: 'Gemini 4 Hydrogen High' }, { label: 'Gemini 4 Hydrogen XHigh' }],
    'Gemini 4 Hydrogen (XHigh)',
    'xhigh'
  );
  assert.equal(noExtraBadge.steps[2].id, 'xhigh');
  assert.equal(noExtraBadge.steps[2].display, 'XHigh');

  const fallback = effortCore.resolveClaudeEffortSteps([], 'Custom Model Max', 'max');
  assert.deepEqual(
    fallback.steps.map((s) => s.id),
    ['low', 'medium', 'high', 'max']
  );
  assert.equal(fallback.selectedIdx, 3);

  const fallbackExtra = effortCore.resolveClaudeEffortSteps([], 'Gemini 4 Hydrogen Extra', 'Extra');
  assert.equal(fallbackExtra.steps[3].id, 'xhigh');
  assert.equal(fallbackExtra.steps[3].display, 'Extra');

  const labelOnlyExtra = effortCore.resolveClaudeEffortSteps(
    [{ label: 'Gemini 4 Hydrogen Low' }, { label: 'Gemini 4 Hydrogen High' }, { label: 'Gemini 4 Hydrogen XHigh' }],
    'Gemini 4 Hydrogen (Extra)',
    ''
  );
  assert.equal(labelOnlyExtra.selectedIdx, 2);
  assert.equal(labelOnlyExtra.steps[2].id, 'xhigh');
  assert.equal(labelOnlyExtra.steps[2].display, 'Extra');

  // Two-word "Extra High" (e.g. Antigravity Orchestrator planner display) must preserve "Extra High"
  // and report hasRealVariants accurately instead of degrading to broken "Extra".
  const extraHighReal = effortCore.resolveClaudeEffortSteps(
    [
      { label: 'Gemini 4 Neon (Low)', value: 1534 },
      { label: 'Gemini 4 Neon (Medium)', value: 1533 },
      { label: 'Gemini 4 Neon (High)', value: 1532 },
      { label: 'Gemini 4 Neon (XHigh)', value: 1535 },
    ],
    'Gemini 4 Neon (XHigh)',
    'extra high'
  );
  assert.equal(extraHighReal.hasRealVariants, true);
  assert.equal(extraHighReal.selectedIdx, 3);
  assert.equal(extraHighReal.steps[3].id, 'xhigh');
  assert.equal(extraHighReal.steps[3].display, 'Extra High');
  assert.equal(extraHighReal.steps[3].option.value, 1535);

  const orchNoVariants = effortCore.resolveClaudeEffortSteps(
    [{ label: 'Orchestrator (Neon)', value: 1537 }],
    'Orchestrator (Neon)',
    'extra high'
  );
  assert.equal(orchNoVariants.hasRealVariants, false);
  assert.equal(orchNoVariants.steps[3].id, 'xhigh');
  assert.equal(orchNoVariants.steps[3].display, 'Extra High');
});

test('dampTravel (DETENT = 0.8) is strictly monotonic, pins endpoints, and slows mid-detents', () => {
  assert.equal(effortCore.DETENT, 0.8);
  const span = 210;
  const steps = 4;
  assert.equal(effortCore.dampTravel(0, span, steps), 0);
  assert.equal(effortCore.dampTravel(span, span, steps), span);

  let prev = -1;
  for (let x = 0; x <= span; x += 3) {
    const d = effortCore.dampTravel(x, span, steps);
    assert.ok(d >= prev, `dampTravel should be monotonic at x=${x}`);
    assert.ok(d >= 0 && d <= span);
    prev = d;
  }

  // Stops at exact detents remain unshifted
  const seg = span / (steps - 1);
  for (let i = 0; i < steps; i++) {
    assert.ok(Math.abs(effortCore.dampTravel(i * seg, span, steps) - i * seg) < 1e-9);
  }
});

test('nearestStepIndex and computeEffortTintPercent resolve edge boundaries accurately', () => {
  assert.equal(effortCore.nearestStepIndex(0, 200, 4), 0);
  assert.equal(effortCore.nearestStepIndex(200, 200, 4), 3);
  assert.equal(effortCore.nearestStepIndex(67, 200, 4), 1);
  assert.equal(effortCore.nearestStepIndex(133, 200, 4), 2);
  assert.equal(effortCore.computeEffortTintPercent(4, 0), 0);
  assert.equal(effortCore.computeEffortTintPercent(4, 3), 100);
  assert.equal(effortCore.computeEffortTintPercent(1, 0), null);
});

test('5-row matrix-field solver and plume fade envelope stay within expected bounds', () => {
  assert.equal(effortCore.cellFade(0.05), 0);
  assert.equal(effortCore.cellFade(0.75), 1);
  assert.ok(effortCore.cellFade(0.4) > 0 && effortCore.cellFade(0.4) < 1);

  const field = effortCore.solveField(432, 2);
  assert.equal(field.heightDev, effortCore.BAND_H * 2);
  assert.ok(field.blocks.length >= 50);

  const first = field.blocks[0];
  assert.equal(first.fade, 0);
  const last = field.blocks[field.blocks.length - 1];
  assert.equal(last.fade, 1);

  const out = effortCore.composeBlockColour([163, 89, 255], [242, 232, 255], 0.5, 0.25, 0.5);
  assert.equal(out.length, 3);
  for (const ch of out) {
    assert.ok(ch >= 89 && ch <= 255);
  }
});

test('normalizeEffortStyle and Codex effort math stay consistent with dsh-codex-effort-slider', () => {
  assert.equal(effortCore.normalizeEffortStyle('claude'), 'claude');
  assert.equal(effortCore.normalizeEffortStyle('chatgpt'), 'chatgpt');
  assert.equal(effortCore.normalizeEffortStyle('codex'), 'chatgpt');
  assert.equal(effortCore.normalizeEffortStyle('liangwufeng'), 'claude');
  assert.equal(effortCore.normalizeEffortStyle('performance'), 'claude');
  assert.equal(effortCore.normalizeEffortStyle('unknown'), 'claude');

  assert.equal(effortCore.CODEX_PARTICLES.length, 22);
  assert.equal(effortCore.codexEnergyFor(0), 0);
  assert.equal(effortCore.codexEnergyFor(1 / 3), 0);
  assert.ok(Math.abs(effortCore.codexEnergyFor(2 / 3) - 0.5) < 1e-6);
  assert.equal(effortCore.codexEnergyFor(1), 1);

  assert.equal(effortCore.codexFillColorFor(0), 'rgb(77,147,248)');
  assert.equal(effortCore.codexFillColorFor(2 / 3), 'rgb(147,51,234)');
  assert.equal(effortCore.codexFillColorFor(1), 'rgb(76,29,149)');
  assert.equal(effortCore.codexValueColorFor(0, 'Off'), '');
  assert.equal(effortCore.codexValueColorFor(1, 'Extra'), 'rgb(139,92,246)');

  const m = { x: 0, v: 0, a: 0, target: 1 };
  for (let i = 0; i < 60; i += 1) {
    effortCore.codexMotionStep(m, 1 / 60);
  }
  assert.equal(effortCore.codexMotionSettled(m), true);
  assert.equal(m.x, 1);
  assert.equal(m.v, 0);
});
