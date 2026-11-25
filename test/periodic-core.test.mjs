import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const periodicCore = require('../periodic-core.js');

const SAMPLE_OPTIONS = [
  { label: 'Gemini 4 Neon (High)', value: 1532, disabled: false, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', modelId: 'gemini-4-neon-high' },
  { label: 'Gemini 4 Neon (XHigh)', value: 1535, disabled: false, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', modelId: 'gemini-4-neon-xhigh' },
  { label: 'Gemini 4 Neon (Medium)', value: 1533, disabled: false, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', modelId: 'gemini-4-neon-medium' },
  { label: 'Gemini 4 Neon (Low)', value: 1534, disabled: false, tagTitle: 'New', tagDescription: 'For most deep reasoning and complex problems', modelId: 'gemini-4-neon-low' },
  { label: 'Gemini 4 Argon (Medium)', value: 1418, disabled: false, tagTitle: 'New', tagDescription: 'The original Gemini 4 model for advanced workflows', modelId: 'gemini-4-argon-medium' },
  { label: 'Gemini 4 Argon (High)', value: 1417, disabled: false, tagTitle: 'New', tagDescription: 'The original Gemini 4 model for advanced workflows', modelId: 'gemini-4-argon-high' },
  { label: 'Gemini 4 Argon (Low)', value: 1419, disabled: false, tagTitle: 'New', tagDescription: 'The original Gemini 4 model for advanced workflows', modelId: 'gemini-4-argon-low' },
  { label: 'Gemini 4 Hydrogen (High)', value: 1525, disabled: false, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', modelId: 'gemini-4-hydrogen-high' },
  { label: 'Gemini 4 Hydrogen (XHigh)', value: 1528, disabled: false, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', modelId: 'gemini-4-hydrogen-xhigh' },
  { label: 'Gemini 4 Hydrogen (Medium)', value: 1526, disabled: false, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', modelId: 'gemini-4-hydrogen-medium' },
  { label: 'Gemini 4 Hydrogen (Low)', value: 1527, disabled: false, tagTitle: 'New', tagDescription: 'For speed and efficiency in execution tasks', modelId: 'gemini-4-hydrogen-low' },
  { label: 'Orchestrator (Neon)', value: 1537, disabled: false, tagTitle: 'New', tagDescription: 'Neon that may offload routine steps to Hydrogen.', modelId: 'gemini-pro-orchestrator-neon' },
  { label: 'Orchestrator (Argon)', value: 1668, disabled: false, tagTitle: 'New', tagDescription: 'Argon that may offload routine steps to Hydrogen.', modelId: 'gemini-pro-orchestrator-g1-pro' },
  { label: 'Gemini 3.8 Flash (High)', value: 1318, disabled: false, tagTitle: '', tagDescription: '', modelId: 'gemini-3.8-flash-high' },
  { label: 'Claude Opus 5.5 (High)', value: 1402, disabled: false, tagTitle: 'New', tagDescription: '', modelId: 'claude-opus-5-5-high' },
  { label: 'Claude Sonnet 5.5 (Medium)', value: 1404, disabled: false, tagTitle: 'New', tagDescription: '', modelId: 'claude-sonnet-5-5-medium' },
  { label: 'GPT-OSS 120B (Medium)', value: 342, disabled: false, tagTitle: 'Notice', tagDescription: 'GPT-OSS notice', modelId: 'gpt-oss-120b-medium' },
];

test('PERIODIC_ELEMENTS matches 72-tile Periods 1-6 layout and key coordinates', () => {
  assert.equal(periodicCore.PERIODIC_ELEMENTS.length, 72);
  const bySym = new Map(periodicCore.PERIODIC_ELEMENTS.map((e) => [e.symbol, e]));
  assert.deepEqual({ row: bySym.get('H').row, col: bySym.get('H').col, num: bySym.get('H').num }, { row: 1, col: 1, num: 1 });
  assert.deepEqual({ row: bySym.get('C').row, col: bySym.get('C').col, num: bySym.get('C').num }, { row: 2, col: 14, num: 6 });
  assert.deepEqual({ row: bySym.get('Ne').row, col: bySym.get('Ne').col, num: bySym.get('Ne').num }, { row: 2, col: 18, num: 10 });
  assert.deepEqual({ row: bySym.get('Ar').row, col: bySym.get('Ar').col, num: bySym.get('Ar').num }, { row: 3, col: 18, num: 18 });
  assert.equal(bySym.get('57-71').isRange, true);
  assert.equal(bySym.get('57-71').row, 6);
  assert.equal(bySym.get('57-71').col, 3);
  const row6Faded = periodicCore.PERIODIC_ELEMENTS.filter((e) => e.row === 6 && e.faded);
  assert.equal(row6Faded.length, 18);
});

test('groupModelOptions maps Gemini 4 models accurately without colliding with Orchestrator', () => {
  const selected = SAMPLE_OPTIONS[7]; // Gemini 4 Hydrogen (High)
  const res = periodicCore.groupModelOptions(SAMPLE_OPTIONS, selected);

  assert.equal(res.releasedCount, 4); // H, C (preview), Ne, Ar
  assert.equal(res.availableCount, 3); // H, Ne, Ar
  assert.ok(res.bySymbol.H);
  assert.ok(res.bySymbol.Ne);
  assert.ok(res.bySymbol.Ar);
  assert.equal(res.bySymbol.C, undefined);

  assert.equal(res.bySymbol.H.isSelected, true);
  assert.equal(res.bySymbol.H.selectedEffortId, 'high');
  assert.deepEqual(res.bySymbol.H.variants.map((v) => v.effortId), ['low', 'medium', 'high', 'xhigh']);

  const tileC = res.tiles.find((t) => t.symbol === 'C');
  assert.equal(tileC.isLaunched, true);
  assert.equal(tileC.isPreviewOnly, true);
  assert.equal(tileC.isAvailableInHost, false);
  assert.equal(tileC.isDisabledInHost, false);
  assert.equal(tileC.isSubscriptionLocked, true);
  assert.match(tileC.spec.pricing, /\$2\.00/);

  const tileNe = res.tiles.find((t) => t.symbol === 'Ne');
  assert.equal(tileNe.isHero, true);
  assert.equal(tileNe.isNew, true);
  assert.equal(tileNe.isAvailableInHost, true);

  const orchNeon = res.families.find((f) => f.baseName === 'Orchestrator (Neon)');
  assert.equal(orchNeon.category, 'orchestrator');
  assert.equal(orchNeon.elementSymbol, '');
});

test('groupModelOptions automatically activates Carbon tile when Gemini 4 Carbon is added to options', () => {
  const withCarbon = [
    ...SAMPLE_OPTIONS,
    { label: 'Gemini 4 Carbon (High)', value: 1600, disabled: false, tagTitle: 'New', modelId: 'gemini-4-carbon-high' },
  ];
  const res = periodicCore.groupModelOptions(withCarbon, withCarbon[withCarbon.length - 1]);
  assert.equal(res.availableCount, 4);
  const tileC = res.tiles.find((t) => t.symbol === 'C');
  assert.equal(tileC.isAvailableInHost, true);
  assert.equal(tileC.isPreviewOnly, false);
  assert.equal(tileC.isSelected, true);
});

test('pickPreferredVariant preserves effort tier and falls back cleanly', () => {
  const res = periodicCore.groupModelOptions(SAMPLE_OPTIONS, SAMPLE_OPTIONS[7]);
  assert.equal(periodicCore.pickPreferredVariant(res.bySymbol.Ne, 'xhigh').effortId, 'xhigh');
  assert.equal(periodicCore.pickPreferredVariant(res.bySymbol.Ar, 'xhigh').effortId, 'high');
});

test('filterModelFamilies filters by tab category and search query', () => {
  const res = periodicCore.groupModelOptions(SAMPLE_OPTIONS, SAMPLE_OPTIONS[7]);
  assert.equal(periodicCore.filterModelFamilies(res.families, 'claude', '').length, 2);
  assert.equal(periodicCore.filterModelFamilies(res.families, 'orchestrator', '').length, 2);
  assert.equal(periodicCore.filterModelFamilies(res.families, 'gemini', '').length, 4);
  const searchNe = periodicCore.filterModelFamilies(res.families, 'all', 'neon');
  assert.deepEqual(searchNe.map((f) => f.baseName), ['Gemini 4 Neon', 'Orchestrator (Neon)']);
});

test('groupModelOptions marks disabled host Gemini 4 models as subscription-locked without exposing in families', () => {
  const withDisabled = [
    ...SAMPLE_OPTIONS,
    { label: 'Gemini 4 Carbon (High)', value: 1601, disabled: true, tagTitle: 'Pro+', tagDescription: 'Locked in Pro plan', modelId: 'gemini-4-carbon-high' },
    { label: 'Gemini 4 Helium (High)', value: 1602, disabled: true, tagTitle: 'Ultra', tagDescription: 'Disabled preview', modelId: 'gemini-4-helium-high' },
  ];
  const res = periodicCore.groupModelOptions(withDisabled, SAMPLE_OPTIONS[7]);

  assert.equal(res.availableCount, 3);
  assert.equal(res.releasedCount, 5); // H, He (disabled), C (spec+disabled), Ne, Ar
  assert.equal(res.families.some((f) => f.elementSymbol === 'C' || f.elementSymbol === 'He'), false);

  for (const sym of ['C', 'He']) {
    const tile = res.tiles.find((t) => t.symbol === sym);
    assert.equal(tile.isDisabledInHost, true);
    assert.equal(tile.isSubscriptionLocked, true);
    assert.equal(tile.isLaunched, true);
    assert.equal(tile.isAvailableInHost, false);
    assert.equal(tile.isPreviewOnly, true);
  }
});

test('buildPeriodicSyncPrompt generates self-contained AI Studio sync prompts for zh-CN and en', () => {
  for (const lang of ['zh-CN', 'en']) {
    const prompt = periodicCore.buildPeriodicSyncPrompt(lang);
    assert.ok(prompt.includes('aistudio.google.com'), `${lang} includes aistudio.google.com`);
    assert.ok(prompt.includes('H, C, Ne, Ar'), `${lang} includes known symbols`);
    assert.ok(prompt.includes('agy-claude-studio'), `${lang} references repo`);
    assert.ok(prompt.includes('periodic-core.js'), `${lang} includes periodic-core.js`);
    assert.ok(prompt.includes('style.css'), `${lang} includes style.css`);
    assert.ok(prompt.includes('~/.gemini/config/plugins/agy-claude-studio/'), `${lang} includes plugin deploy dir`);
    assert.equal(/[A-Za-z]:\\/.test(prompt), false, `${lang} contains no hardcoded drive path`);
  }
});

test('Orchestrator helpers map Gemini 4 elements and toggle cleanly between standard and Orchestrator modes', () => {
  const options = [
    { label: 'Gemini 4 Neon (Low)', modelId: 'gemini-4-neon-low', value: 1534 },
    { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-neon-high', value: 1532 },
    { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-carbon-high', value: 1427 },
    { label: 'Gemini 4 Argon (Medium)', modelId: 'gemini-4-argon-medium', value: 1418 },
    { label: 'Gemini 4 Hydrogen (High)', modelId: 'gemini-4-hydrogen-high', value: 1525 },
    { label: 'Orchestrator (Neon)', modelId: 'gemini-pro-orchestrator-neon', value: 1537 },
    { label: 'Orchestrator (Carbon)', modelId: 'gemini-pro-orchestrator', value: 1667 },
    { label: 'Orchestrator (Argon)', modelId: 'gemini-pro-orchestrator-argon', value: 1681 },
  ];

  // Toggle ON from Gemini 4 Neon (High) -> Orchestrator (Neon)
  const onRes = periodicCore.computeOrchestratorToggleTarget(options, options[1], 'high');
  assert.equal(onRes.available, true);
  assert.equal(onRes.nextOrchestrator, true);
  assert.equal(onRes.targetOption.modelId, 'gemini-pro-orchestrator-neon');

  // Toggle OFF from Orchestrator (Neon) with preferredEffortId='high' -> Gemini 4 Neon (High)
  const offRes = periodicCore.computeOrchestratorToggleTarget(options, options[5], 'high');
  assert.equal(offRes.available, true);
  assert.equal(offRes.nextOrchestrator, false);
  assert.equal(offRes.targetOption.modelId, 'gemini-4-neon-high');

  // Toggle ON from Hydrogen (no Orchestrator (Hydrogen)) -> falls back to default Orchestrator (Neon)
  const fallbackRes = periodicCore.computeOrchestratorToggleTarget(options, options[4], 'high');
  assert.equal(fallbackRes.nextOrchestrator, true);
  assert.equal(fallbackRes.targetOption.modelId, 'gemini-pro-orchestrator-neon');

  // groupModelOptions attaches orchestratorOption and marks tile selected when Orchestrator (Carbon) is active
  const grouped = periodicCore.groupModelOptions(options, options[6]);
  const cTile = grouped.tiles.find((t) => t.symbol === 'C');
  const neTile = grouped.tiles.find((t) => t.symbol === 'Ne');
  const hTile = grouped.tiles.find((t) => t.symbol === 'H');
  assert.equal(cTile.orchestratorOption.modelId, 'gemini-pro-orchestrator');
  assert.equal(cTile.isOrchestratorSelected, true);
  assert.equal(cTile.isSelected, true);
  assert.equal(neTile.orchestratorOption.modelId, 'gemini-pro-orchestrator-neon');
  assert.equal(neTile.isOrchestratorSelected, false);
  assert.equal(hTile.orchestratorOption, null);

  // Orchestrator planner helpers preserve model + effort tier when toggling ON and carry effort changes back OFF
  const planners = [
    { label: 'Gemini 4 Neon (Low)', modelId: 'gemini-4-neon-low', value: 1534 },
    { label: 'Gemini 4 Neon (Medium)', modelId: 'gemini-4-neon-medium', value: 1533 },
    { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-neon-high', value: 1532 },
    { label: 'Gemini 4 Neon (XHigh)', modelId: 'gemini-4-neon-xhigh', value: 1535 },
    { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-carbon-high', value: 1427 },
  ];
  const defaultPlanner = planners[3]; // Neon XHigh
  assert.equal(
    periodicCore.resolveOrchestratorPlanner(planners, { model: 0 }, defaultPlanner).value,
    1535
  );
  assert.equal(
    periodicCore.resolveOrchestratorPlanner(planners, { model: 1532 }, defaultPlanner).value,
    1532
  );
  // Toggling ON from Neon High matches Neon High planner (1532) instead of jumping to XHigh (1535)
  assert.equal(
    periodicCore.findMatchingOrchestratorPlanner(planners, options[1], 'high').value,
    1532
  );
  // Toggling OFF after dragging Orchestrator effort to Low returns Gemini 4 Neon (Low)
  const offWithPlanner = periodicCore.computeOrchestratorToggleTarget(
    options,
    options[5],
    'high',
    null,
    planners[0]
  );
  assert.equal(offWithPlanner.targetOption.value, 1534);
});
