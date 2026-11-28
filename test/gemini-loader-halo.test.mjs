import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'src', 'ui-runtime.js'), 'utf8');
const ON = 'html[data-ag-cs-style][data-ag-cs-gemini-loader="on"]';

test('gemini loader: 12-tick halo ring mask carries 12 rounded ticks fading 0.16 -> 1.0', () => {
  const m = css.match(/--ag-cs-halo-mask:\s*url\("data:image\/svg\+xml,([^"]+)"\)/);
  assert.ok(m, 'halo mask data URI exists');
  const svg = decodeURIComponent(m[1]);
  const lines = svg.match(/<line [^>]*>/g) || [];
  assert.equal(lines.length, 12);
  assert.ok(lines.every((l) => l.includes('stroke-linecap="round"')));
  const ops = lines.map((l) => Number(/stroke-opacity="([\d.]+)"/.exec(l)[1]));
  assert.equal(ops[0], 0.16);
  assert.equal(ops[11], 1);
  for (let i = 1; i < 12; i++) assert.ok(ops[i] > ops[i - 1]);
  lines.forEach((l, i) => assert.ok(l.includes(`rotate(${i * 30} 50 50)`)));
  assert.ok(!svg.includes('var('), 'no CSS vars inside data URI');
  assert.ok(!css.includes('ag-cs-loading-152'), 'old small spinner removed');
});

test('gemini loader: ring steps clockwise in 12 clock ticks, colour follows theme accent', () => {
  assert.match(css, /@keyframes ag-cs-halo-step\s*\{\s*100%\s*\{\s*transform:\s*rotate\(1turn\)/);
  assert.ok(css.includes('animation: ag-cs-halo-step 1.2s steps(12, end) infinite;'));
  const ring = css.slice(css.indexOf(`${ON} .ripple-container::before`));
  assert.match(ring, /background-color:\s*var\(--ag-cs-accent, #d97757\)/);
  assert.match(ring, /mask-image:\s*var\(--ag-cs-halo-mask\)/);
});

test('gemini loader: covers every host loading size and ripple container, avatar is round plate', () => {
  for (const w of [32, 40, 48, 64]) {
    assert.ok(css.includes(`${ON} :has(> svg.animate-spin[width="${w}"])::before`), `ring for ${w}`);
    assert.ok(css.includes(`${ON} svg.animate-spin[width="${w}"],`) || css.includes(`${ON} svg.animate-spin[width="${w}"] {`));
  }
  assert.ok(css.includes(`${ON} .ripple-container::before`));
  assert.ok(css.includes(`${ON} .ripple-container > svg.floating-icon`));
  assert.match(css, /border-radius:\s*50% !important;[\s\S]{0,260}animation:\s*none !important/);
  assert.match(css, /var\(--ag-cs-halo-plate, var\(--background, #faf8f4\)\)/);
});

test('gemini loader: reduced motion stops the ring', () => {
  const i = css.indexOf('@media (prefers-reduced-motion: reduce) {\n  ' + ON + ' :has(> svg.animate-spin[width="32"])::before')
    >= 0 ? 0 : css.search(/@media \(prefers-reduced-motion: reduce\) \{\r?\n  html\[data-ag-cs-style\]\[data-ag-cs-gemini-loader="on"\] :has\(> svg\.animate-spin\[width="32"\]\)::before/);
  assert.ok(i >= 0, 'reduced-motion block for halo');
  assert.match(css.slice(css.search(/@media \(prefers-reduced-motion: reduce\) \{\r?\n  html\[data-ag-cs-style\]\[data-ag-cs-gemini-loader="on"\]/)).split('\n').slice(0, 10).join('\n'), /animation: none !important/);
});

test('gemini loader: every rule is gated on the on-attribute, off restores native spinner', () => {
  const start = css.indexOf('/* ── 17. Gemini-chan Loading Spinner');
  const end = css.indexOf('/* ── Persistent 3-Column');
  const block = css.slice(start, end);
  const selectorLines = block.split(/\r?\n/).filter((l) => /^(html\[|  html\[)/.test(l));
  assert.ok(selectorLines.length > 10);
  assert.ok(selectorLines.every((l) => l.trim().startsWith(ON)), 'all selectors scoped to gemini-loader="on"');
  assert.match(runtime, /data-ag-cs-gemini-loader',\s*cfg\.geminiLoader === false \? 'off' : 'on'/);
});
