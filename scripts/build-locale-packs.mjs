#!/usr/bin/env node
// Generate pure-JSON per-language locale packs under locales/ from i18n-locales.js.
// Built-in offline baseline: zh-CN, zh-TW (plus native en).
// On-demand cloud downloadable: yue, ja (hosted in GitHub locales/, not bundled into plugin releases).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT_DIR, 'locales');
const i18nLocales = require(path.join(ROOT_DIR, 'i18n-locales.js'));

const LOCALE_SPECS = [
  { lang: 'zh-CN', label: '简体中文', bundled: true },
  { lang: 'zh-TW', label: '繁體中文', bundled: true },
  { lang: 'yue', label: '粵語', bundled: false },
  { lang: 'ja', label: '日本語', bundled: false },
];
const TARGET_LANGS = LOCALE_SPECS.map((s) => s.lang);
const DEFAULT_AGY_VERSION = '2.35.2';

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildLocalePacks({
  outDir = LOCALES_DIR,
  agyVersion = DEFAULT_AGY_VERSION,
  updatedAt = new Date().toISOString().slice(0, 10),
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    agyVersion,
    updatedAt,
    locales: {},
  };

  for (const spec of LOCALE_SPECS) {
    const { lang, label, bundled } = spec;
    const bundle = i18nLocales.resolveLocaleBundle(lang);
    if (!bundle) throw new Error(`Failed to resolve bundle for ${lang}`);
    const pack = {
      schemaVersion: 1,
      lang,
      label,
      bundled,
      agyVersion,
      updatedAt,
      cjkLatinSpacing: bundle.cjkLatinSpacing !== false,
      units: bundle.units,
      dict: bundle.dict,
      rules: bundle.rules,
      timeRules: bundle.timeRules,
      sentences: bundle.sentences,
    };
    const json = JSON.stringify(pack, null, 2) + '\n';
    const fileName = `${lang}.json`;
    fs.writeFileSync(path.join(outDir, fileName), json, 'utf8');
    manifest.locales[lang] = {
      file: fileName,
      label,
      bundled,
      dictCount: Object.keys(bundle.dict || {}).length,
      ruleCount: (bundle.rules || []).length,
      timeRuleCount: (bundle.timeRules || []).length,
      sentenceCount: (bundle.sentences || []).length,
      bytes: Buffer.byteLength(json, 'utf8'),
      sha256: sha256Hex(Buffer.from(json, 'utf8')),
    };
  }

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(outDir, 'manifest.json'), manifestJson, 'utf8');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  let agyVersion = DEFAULT_AGY_VERSION;
  let updatedAt;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--agy-version' && i + 1 < args.length) agyVersion = args[++i];
    else if (args[i] === '--updated-at' && i + 1 < args.length) updatedAt = args[++i];
  }
  const m = buildLocalePacks({ agyVersion, updatedAt });
  console.log(`[✓] Generated ${Object.keys(m.locales).length} locale packs in locales/ (AGY ${m.agyVersion}, ${m.updatedAt})`);
  for (const [lang, meta] of Object.entries(m.locales)) {
    console.log(
      `    - ${meta.file} [${meta.bundled ? 'built-in' : 'on-demand'}]: ${meta.dictCount} dict, ${meta.ruleCount} rules, ${(meta.bytes / 1024).toFixed(1)} KB`
    );
  }
}

export { LOCALE_SPECS, TARGET_LANGS, buildLocalePacks };
