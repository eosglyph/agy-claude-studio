#!/usr/bin/env node
// 0-Token Google AI Studio Gemini 4 Periodic Table sync script.
// Fetches public AI Studio docs & periodic component bundle (no Google login, no browser, 0 LLM tokens)
// and updates PLUGIN_DATA/periodic-override.json for instant hot-reload in Claude Studio.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdp = require('../../src/cdp.js');
const periodicSync = require('../../src/periodic-sync.js');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const noSave = args.includes('--no-save');

async function main() {
  const t0 = Date.now();
  const pluginDataDir = noSave ? '' : cdp.PLUGIN_DATA_DIR || cdp.STATE_DIR;
  const res = await periodicSync.syncAndSavePeriodicElements({
    pluginDataDir,
    timeoutMs: 25000,
  });
  const elapsedMs = Date.now() - t0;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          elapsedMs,
          savedTo: pluginDataDir ? periodicSync.getPeriodicOverridePath(pluginDataDir) : null,
          syncedAt: res.syncedAt,
          totalElements: res.totalElements,
          symbols: res.symbols,
          newSymbols: res.newSymbols,
          updatedSymbols: res.updatedSymbols,
          specs: res.override.specs,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`=== Gemini 4 元素周期表同步完成 (${(elapsedMs / 1000).toFixed(1)}s, 0-Token) ===`);
  console.log(`已点亮元素 (${res.totalElements}): ${res.symbols.join(', ')}`);
  console.log(`新增元素: ${res.newSymbols.length ? res.newSymbols.join(', ') : '无'}`);
  console.log(`字段变动: ${res.updatedSymbols.length ? res.updatedSymbols.join(', ') : '无'}`);
  console.log('');
  for (const sym of res.symbols) {
    const s = res.override.specs[sym];
    const flags = [s.isHero ? 'Hero' : '', s.isNew ? 'New' : '', s.paid ? 'Paid' : ''].filter(Boolean).join('/');
    console.log(`- [${sym}] ${s.title} (${s.slug})${flags ? ` [${flags}]` : ''}`);
    if (s.context || s.pricing) {
      console.log(`  ${[s.context, s.pricing].filter(Boolean).join(' | ')}`);
    }
  }
  if (pluginDataDir) {
    console.log('');
    console.log(`已写入覆盖层: ${periodicSync.getPeriodicOverridePath(pluginDataDir)}`);
  }
}

main().catch((err) => {
  if (asJson) {
    console.log(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  } else {
    console.error(`[sync-periodic-elements] 同步失败: ${err?.message || err}`);
  }
  process.exit(1);
});
