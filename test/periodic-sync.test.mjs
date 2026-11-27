import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const periodicCore = require('../src/periodic-core.js');
const periodicSync = require('../src/periodic-sync.js');

test('resolveColorExpr accurately evaluates light-dark, var, and nested color-mix(in srgb)', () => {
  const tokens = periodicSync.parseColorV3Tokens(`
    :root {
      --color-v3-surface: light-dark(#fff, #191919);
      --color-v3-surface-container-high: light-dark(#fcfcfc, #252525);
      --color-v3-accent-7: light-dark(#1f4094, #87a9ff);
      --color-v3-accent-3: light-dark(#d73a49, #d73a49);
      --color-v3-accent-6: light-dark(#e87400, #ffb74d);
    }
  `);

  const hLight = periodicSync.resolveColorExpr(
    'light-dark(color-mix(in srgb,var(--%NS%color-v3-accent-7) 24%,var(--%NS%color-v3-surface)),color-mix(in srgb,var(--%NS%color-v3-accent-7) 24%,var(--%NS%color-v3-surface-container-high)))',
    'light',
    tokens
  );
  const hDark = periodicSync.resolveColorExpr(
    'light-dark(color-mix(in srgb,var(--%NS%color-v3-accent-7) 24%,var(--%NS%color-v3-surface)),color-mix(in srgb,var(--%NS%color-v3-accent-7) 24%,var(--%NS%color-v3-surface-container-high)))',
    'dark',
    tokens
  );

  assert.match(hLight, /^#[0-9a-f]{6}$/);
  assert.match(hDark, /^#[0-9a-f]{6}$/);
  assert.notEqual(hLight, hDark);

  const nestedNeon = periodicSync.resolveColorExpr(
    'color-mix(in srgb,color-mix(in srgb,var(--color-v3-accent-3) 62%,var(--color-v3-accent-6)) 86%,var(--color-v3-surface))',
    'light',
    tokens
  );
  assert.match(nestedNeon, /^#[0-9a-f]{6}$/);
});

test('parsePeriodicChunk extracts launched elements and themes even with renamed Closure identifiers and a new 5th element', () => {
  const fakeChunk = `
    var Xyz=new Map([
      [1,{abc:"hydrogen",def:["models/gemini-4-hydrogen"],fallbackDisplayName:"Gemini 4 Hydrogen"}],
      [2,{abc:"helium",def:["models/gemini-4-helium"],ghi:!0,fallbackDisplayName:"Gemini 4 Helium"}],
      [10,{abc:"neon",def:["models/gemini-4-neon"],fallbackDisplayName:"Gemini 4 Neon"}]
    ]);
    styles:["[_nghost-%COMP%]{--%NS%neon-hero-bg:light-dark(#e2694a,#b7523f)}.tile-theme-helium[_ngcontent-%COMP%]{--%NS%tile-bg:light-dark(color-mix(in srgb,var(--%NS%color-v3-accent-1) 25%,var(--%NS%color-v3-surface)),color-mix(in srgb,var(--%NS%color-v3-accent-1) 22%,var(--%NS%color-v3-surface-container-high)));--%NS%tile-edge-lip:light-dark(#e6c48a,#3d3018);--%NS%tile-symbol-ink:light-dark(#7c4503,#ffe082);--%NS%tile-num-ink:color-mix(in srgb,var(--%NS%tile-symbol-ink) 85%,var(--%NS%tile-bg))}"]
  `;
  const parsed = periodicSync.parsePeriodicChunk(fakeChunk);
  assert.equal(parsed.launched.length, 3);
  const he = parsed.launched.find((x) => x.symbol === 'He');
  assert.ok(he, 'Helium should be extracted');
  assert.equal(he.num, 2);
  assert.equal(he.theme, 'helium');
  assert.equal(he.slug, 'gemini-4-helium');
  assert.equal(he.isHero, true);

  assert.ok(parsed.themes.helium?.light['--tile-bg']);
  assert.ok(parsed.themes.helium?.dark['--tile-bg']);
  assert.ok(parsed.themes.helium?.light['--tile-num-ink']);
});

test('parseDocsModelsAndPricing extracts descriptions, context, pricing, and paid flag', () => {
  const modelsHtml = `
    {% card description="Ultra-light helium model." title="Gemini 4 Helium" variant="model-card" %}
    {% section class="model-specs" %}
    * *Model code* **gemini-4-helium**
    * *Context* **2M tokens**
    * *Max output* **128K / 2M tokens**
    {% /section %}
    {% /card %}
  `;
  const pricingHtml = `
    ## Gemini 4 Helium {% id="gemini-4-helium" %}
    Gemini 4 Helium is not available on the Free tier.
    * Input price * Not available * $0.50
    * Output price * Not available * $2.50
  `;
  const docs = periodicSync.parseDocsModelsAndPricing(modelsHtml, pricingHtml);
  assert.equal(docs['gemini-4-helium'].title, 'Gemini 4 Helium');
  assert.equal(docs['gemini-4-helium'].desc, 'Ultra-light helium model.');
  assert.equal(docs['gemini-4-helium'].context, '2M input · 128K output');
  assert.equal(docs['gemini-4-helium'].pricing, 'All context lengths • Input: $0.50 / Output: $2.50');
  assert.equal(docs['gemini-4-helium'].paid, true);
});

test('buildDynamicThemeCss rejects malicious CSS values and emits clean rules', () => {
  const css = periodicSync.buildDynamicThemeCss({
    helium: {
      light: {
        '--tile-bg': '#fff3cd',
        '--tile-edge-lip': 'url(javascript:alert(1))',
        '--tile-symbol-ink': '#664d03',
      },
      dark: {
        '--tile-bg': 'rgba(80, 60, 20, 0.9)',
      },
    },
    'bad;selector{body': {
      light: { '--tile-bg': '#000000' },
    },
  });
  assert.match(css, /\.ag-cs-ps-drawer\[data-ps-theme="light"\] \.ag-cs-ps-theme-helium/);
  assert.match(css, /--tile-bg: #fff3cd;/);
  assert.doesNotMatch(css, /javascript:/);
  assert.doesNotMatch(css, /bad;selector/);
});

test('periodic-core setDynamicSpecs merges newly synced element into periodic table tiles and restores cleanly', () => {
  try {
    periodicCore.setDynamicSpecs({
      He: {
        title: 'Gemini 4 Helium',
        slug: 'gemini-4-helium',
        theme: 'helium',
        isHero: true,
        isNew: true,
        paid: false,
        desc: 'New light element.',
        context: '2M input · 128K output',
        pricing: 'Input: $0.50 / Output: $2.50',
        released: 'Released Dec 2026',
      },
    });
    const grouped = periodicCore.groupModelOptions([], null);
    const heTile = grouped.tiles.find((t) => t.symbol === 'He');
    assert.ok(heTile);
    assert.equal(heTile.isLaunched, true);
    assert.equal(heTile.theme, 'helium');
    assert.equal(heTile.isHero, true);
    assert.equal(grouped.releasedCount, 5);
  } finally {
    periodicCore.setDynamicSpecs(null);
  }
  const restored = periodicCore.groupModelOptions([], null);
  assert.equal(restored.releasedCount, 4);
});

test('writePeriodicOverride and readPeriodicOverride round-trip safely in isolated plugin data dir', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cs-periodic-'));
  try {
    const written = periodicSync.writePeriodicOverride(tmpDir, {
      syncedAt: '2026-11-25T00:00:00.000Z',
      specs: {
        He: {
          title: 'Gemini 4 Helium',
          slug: 'gemini-4-helium',
          theme: 'helium',
          isHero: false,
          isNew: true,
          paid: false,
          desc: 'Fast.',
          context: '1M input · 64K output',
          pricing: 'Input: $0.50 / Output: $2.50',
          released: '',
        },
      },
      themes: {
        helium: {
          light: { '--tile-bg': '#fff3cd' },
          dark: { '--tile-bg': '#3d3018' },
        },
      },
    });
    assert.ok(written.css.includes('.ag-cs-ps-theme-helium'));
    const readBack = periodicSync.readPeriodicOverride(tmpDir);
    assert.equal(readBack.specs.He.title, 'Gemini 4 Helium');
    assert.equal(readBack.themes.helium.dark['--tile-bg'], '#3d3018');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
