'use strict';
// Cloud on-demand i18n locale pack loader, schema validator, and GitHub syncer (zero external deps, MIT).
// Built-in offline baseline: zh-CN, zh-TW (plus native en).
// On-demand cloud downloadable: yue, ja (downloaded manually from GitHub into PLUGIN_DATA/i18n-packs/).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BUNDLED_PACK_LANGS = Object.freeze(['zh-CN', 'zh-TW']);
const ON_DEMAND_PACK_LANGS = Object.freeze(['yue', 'ja']);
const SUPPORTED_PACK_LANGS = Object.freeze([...BUNDLED_PACK_LANGS, ...ON_DEMAND_PACK_LANGS]);
const LANGUAGE_CATALOG = Object.freeze([
  Object.freeze({ lang: 'zh-CN', label: '简体中文', bundled: true }),
  Object.freeze({ lang: 'zh-TW', label: '繁體中文', bundled: true }),
  Object.freeze({ lang: 'yue', label: '粵語', bundled: false }),
  Object.freeze({ lang: 'ja', label: '日本語', bundled: false }),
]);

const REMOTE_LOCALES_BASE_URL =
  'https://raw.githubusercontent.com/eosglyph/agy-claude-studio/main/locales';
const BUNDLED_LOCALES_DIR = path.join(__dirname, 'locales');
const PACKS_SUBDIR = 'i18n-packs';
const MAX_PACK_BYTES = 1536 * 1024;
const ALLOWED_REGEX_FLAGS = /^[ims]*$/;

function normalizePackLang(raw) {
  const s = String(raw || '').trim();
  if (SUPPORTED_PACK_LANGS.includes(s)) return s;
  const lo = s.toLowerCase().replace(/_/g, '-');
  if (lo === 'zh-cn' || lo === 'zh' || lo === 'zh-hans') return 'zh-CN';
  if (lo === 'zh-tw' || lo === 'zh-hant' || lo === 'tw') return 'zh-TW';
  if (lo === 'yue' || lo === 'zh-hk' || lo === 'zh-mo') return 'yue';
  if (lo === 'ja' || lo === 'jp' || lo === 'ja-jp') return 'ja';
  return null;
}

function isBundledLang(lang) {
  const norm = normalizePackLang(lang);
  return Boolean(norm && BUNDLED_PACK_LANGS.includes(norm));
}

function getCloudPacksDir(pluginDataDir) {
  if (!pluginDataDir) return '';
  return path.join(pluginDataDir, PACKS_SUBDIR);
}

function getCloudPackPath(lang, pluginDataDir) {
  const norm = normalizePackLang(lang);
  const dir = getCloudPacksDir(pluginDataDir);
  if (!norm || !dir) return '';
  return path.join(dir, `${norm}.json`);
}

function getBundledPackPath(lang, bundledDir = BUNDLED_LOCALES_DIR) {
  const norm = normalizePackLang(lang);
  if (!norm || !bundledDir || !isBundledLang(norm)) return '';
  return path.join(bundledDir, `${norm}.json`);
}

function readBundledManifest(bundledDir = BUNDLED_LOCALES_DIR) {
  if (!bundledDir) return null;
  const p = path.join(bundledDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (raw && typeof raw === 'object' && raw.locales && typeof raw.locales === 'object') {
      return raw;
    }
  } catch {}
  return null;
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const text = JSON.stringify(data, null, 2) + '\n';
  try {
    fs.writeFileSync(tmpPath, text, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function validateRuleList(rawRules, maxCount = 500) {
  if (!Array.isArray(rawRules) || rawRules.length > maxCount) return null;
  const out = [];
  for (const row of rawRules) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const [src, flags, to] = row;
    if (typeof src !== 'string' || typeof flags !== 'string' || typeof to !== 'string') return null;
    if (!src || src.length > 400 || to.length > 600 || !ALLOWED_REGEX_FLAGS.test(flags)) return null;
    try {
      // eslint-disable-next-line no-new
      new RegExp(src, flags);
    } catch {
      return null;
    }
    out.push([src, flags, to]);
  }
  return out;
}

function validateDict(rawDict) {
  if (!rawDict || typeof rawDict !== 'object' || Array.isArray(rawDict)) return null;
  const entries = Object.entries(rawDict);
  if (entries.length === 0 || entries.length > 12000) return null;
  const dict = Object.create(null);
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || !k || k.length > 400) return null;
    if (typeof v === 'string') {
      if (v.length > 800) return null;
      dict[k] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sub = Object.create(null);
      const subEntries = Object.entries(v);
      if (!subEntries.length || subEntries.length > 16) return null;
      for (const [sel, val] of subEntries) {
        if (typeof sel !== 'string' || typeof val !== 'string' || sel.length > 160 || val.length > 800) return null;
        sub[sel] = val;
      }
      dict[k] = sub;
    } else {
      return null;
    }
  }
  return dict;
}

function validateSentences(rawSentences) {
  if (!Array.isArray(rawSentences) || rawSentences.length > 200) return null;
  const out = [];
  for (const item of rawSentences) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [fullText, parts] = item;
    if (typeof fullText !== 'string' || !fullText || fullText.length > 600) return null;
    if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return null;
    const cleanParts = Object.create(null);
    for (const [frag, repl] of Object.entries(parts)) {
      if (typeof frag !== 'string' || typeof repl !== 'string' || frag.length > 400 || repl.length > 600) return null;
      cleanParts[frag] = repl;
    }
    out.push([fullText, cleanParts]);
  }
  return out;
}

function validateUnits(rawUnits) {
  if (!rawUnits || typeof rawUnits !== 'object' || Array.isArray(rawUnits)) return null;
  const out = Object.create(null);
  for (const [k, v] of Object.entries(rawUnits)) {
    if (typeof k !== 'string' || typeof v !== 'string' || k.length > 24 || v.length > 24) return null;
    out[k] = v;
  }
  return out;
}

function validateLocalePack(raw, expectedLang = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const lang = normalizePackLang(raw.lang);
  if (!lang) return null;
  if (expectedLang && normalizePackLang(expectedLang) !== lang) return null;
  const dict = validateDict(raw.dict);
  const rules = validateRuleList(raw.rules, 500);
  const timeRules = validateRuleList(raw.timeRules, 100);
  const sentences = validateSentences(raw.sentences || []);
  const units = validateUnits(raw.units);
  if (!dict || !rules || !timeRules || !sentences || !units) return null;
  const out = {
    schemaVersion: Number(raw.schemaVersion) || 1,
    lang,
    agyVersion: String(raw.agyVersion || '').trim().slice(0, 32),
    updatedAt: String(raw.updatedAt || '').trim().slice(0, 32),
    cjkLatinSpacing: raw.cjkLatinSpacing !== false,
    units,
    dict,
    rules,
    timeRules,
    sentences,
  };
  if (typeof raw.sourceSha256 === 'string' && /^[a-f0-9]{64}$/i.test(raw.sourceSha256.trim())) {
    out.sourceSha256 = raw.sourceSha256.trim().toLowerCase();
  }
  return out;
}

function computePackContentSignature(pack) {
  if (!pack || typeof pack !== 'object') return '';
  const semantic = {
    lang: pack.lang,
    agyVersion: pack.agyVersion,
    updatedAt: pack.updatedAt,
    cjkLatinSpacing: pack.cjkLatinSpacing,
    units: pack.units,
    dict: pack.dict,
    rules: pack.rules,
    timeRules: pack.timeRules,
    sentences: pack.sentences,
  };
  return crypto.createHash('sha256').update(JSON.stringify(semantic), 'utf8').digest('hex');
}

function readPackFromFile(filePath, expectedLang) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_PACK_BYTES) return null;
    const rawText = fs.readFileSync(filePath, 'utf8');
    const parsed = validateLocalePack(JSON.parse(rawText), expectedLang);
    if (!parsed) return null;
    const normalizedText = rawText.replace(/\r\n/g, '\n');
    const fileSha256 = crypto.createHash('sha256').update(normalizedText, 'utf8').digest('hex').toLowerCase();
    const hash = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex').slice(0, 16);
    const sha256 = parsed.sourceSha256 || fileSha256;
    const contentSig = computePackContentSignature(parsed);
    return { pack: parsed, hash, sha256, hasSourceSha: Boolean(parsed.sourceSha256), contentSig, bytes: stat.size };
  } catch {
    return null;
  }
}

function readLocalePack(lang, pluginDataDir, { bundledDir = BUNDLED_LOCALES_DIR } = {}) {
  const norm = normalizePackLang(lang);
  if (!norm) return null;

  const cloudPath = getCloudPackPath(norm, pluginDataDir);
  const cloud = readPackFromFile(cloudPath, norm);
  if (cloud) {
    return {
      pack: cloud.pack,
      hash: cloud.hash,
      sha256: cloud.sha256,
      hasSourceSha: cloud.hasSourceSha,
      contentSig: cloud.contentSig,
      bytes: cloud.bytes,
      source: 'cloud',
      path: cloudPath,
      dictCount: Object.keys(cloud.pack.dict).length,
      ruleCount: cloud.pack.rules.length,
      sentenceCount: cloud.pack.sentences.length,
    };
  }

  if (isBundledLang(norm)) {
    const bundledPath = getBundledPackPath(norm, bundledDir);
    const bundled = readPackFromFile(bundledPath, norm);
    if (bundled) {
      return {
        pack: bundled.pack,
        hash: bundled.hash,
        sha256: bundled.sha256,
        hasSourceSha: bundled.hasSourceSha,
        contentSig: bundled.contentSig,
        bytes: bundled.bytes,
        source: 'bundled',
        path: bundledPath,
        dictCount: Object.keys(bundled.pack.dict).length,
        ruleCount: bundled.pack.rules.length,
        sentenceCount: bundled.pack.sentences.length,
      };
    }
  }

  return null;
}

function readCloudLocalePackOverride(lang, pluginDataDir) {
  const norm = normalizePackLang(lang);
  if (!norm || !pluginDataDir) return null;
  const cloudPath = getCloudPackPath(norm, pluginDataDir);
  const cloud = readPackFromFile(cloudPath, norm);
  if (!cloud) return null;
  return {
    pack: cloud.pack,
    hash: cloud.hash,
    source: 'cloud',
  };
}

function listLocalePacksStatus(
  activeLang,
  pluginDataDir,
  { bundledDir = BUNDLED_LOCALES_DIR, remoteManifest = null } = {}
) {
  const manifest = readBundledManifest(bundledDir);
  const activeNorm = normalizePackLang(activeLang);
  return LANGUAGE_CATALOG.map((entry) => {
    const { lang, label, bundled } = entry;
    const loaded = readLocalePack(lang, pluginDataDir, { bundledDir });
    const meta = manifest && manifest.locales && manifest.locales[lang] ? manifest.locales[lang] : null;
    const remoteMeta =
      remoteManifest && remoteManifest.locales && remoteManifest.locales[lang] ? remoteManifest.locales[lang] : null;
    const installed = Boolean(loaded);
    const hasCloudOverride = Boolean(loaded && loaded.source === 'cloud');
    const source = loaded ? loaded.source : 'not_installed';

    let effectiveSha256 = loaded?.sha256 || '';
    if (hasCloudOverride && !loaded.hasSourceSha && bundled) {
      const bundledPack = readPackFromFile(getBundledPackPath(lang, bundledDir), lang);
      if (bundledPack && bundledPack.contentSig === loaded.contentSig) {
        effectiveSha256 = bundledPack.sha256;
      }
    }
    const remoteSha256 =
      typeof remoteMeta?.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(remoteMeta.sha256)
        ? remoteMeta.sha256.toLowerCase()
        : '';
    const hasRemoteUpdate = Boolean(installed && remoteSha256 && effectiveSha256 && remoteSha256 !== effectiveSha256);

    return {
      lang,
      label,
      bundled,
      installed,
      hasCloudOverride,
      hasRemoteUpdate,
      source,
      agyVersion: loaded?.pack?.agyVersion || remoteManifest?.agyVersion || manifest?.agyVersion || '',
      updatedAt: loaded?.pack?.updatedAt || remoteManifest?.updatedAt || manifest?.updatedAt || '',
      dictCount: loaded ? loaded.dictCount : Number(remoteMeta?.dictCount || meta?.dictCount || 0),
      ruleCount: loaded ? loaded.ruleCount : Number(remoteMeta?.ruleCount || meta?.ruleCount || 0),
      sentenceCount: loaded ? loaded.sentenceCount : Number(remoteMeta?.sentenceCount || meta?.sentenceCount || 0),
      bytes: loaded ? loaded.bytes : Number(remoteMeta?.bytes || meta?.bytes || 0),
      remoteDictCount: Number(remoteMeta?.dictCount || 0),
      remoteAgyVersion: String(remoteManifest?.agyVersion || ''),
      remoteUpdatedAt: String(remoteManifest?.updatedAt || ''),
      isActive: activeNorm === lang,
    };
  });
}

function getLocalePackStatus(
  lang,
  pluginDataDir,
  { bundledDir = BUNDLED_LOCALES_DIR, remoteManifest = null } = {}
) {
  const norm = normalizePackLang(lang);
  const packs = listLocalePacksStatus(lang, pluginDataDir, { bundledDir, remoteManifest });
  const cachedLangs = packs.filter((p) => p.hasCloudOverride).map((p) => p.lang);
  const installedLangs = ['en', ...packs.filter((p) => p.installed).map((p) => p.lang)];
  if (!norm) {
    return {
      lang: 'en',
      supported: false,
      bundled: true,
      installed: true,
      source: 'native',
      agyVersion: '',
      updatedAt: '',
      dictCount: 0,
      ruleCount: 0,
      sentenceCount: 0,
      hasCloudOverride: false,
      cachedLangs,
      installedLangs,
      packs,
    };
  }
  const active = packs.find((p) => p.lang === norm);
  return {
    lang: norm,
    supported: true,
    bundled: Boolean(active?.bundled),
    installed: Boolean(active?.installed),
    source: active ? active.source : 'not_installed',
    agyVersion: active?.agyVersion || '',
    updatedAt: active?.updatedAt || '',
    dictCount: active?.dictCount || 0,
    ruleCount: active?.ruleCount || 0,
    sentenceCount: active?.sentenceCount || 0,
    hasCloudOverride: Boolean(active?.hasCloudOverride),
    cachedLangs,
    installedLangs,
    packs,
  };
}

async function fetchJsonWithTimeout(url, fetchFn, timeoutMs, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': userAgent },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_PACK_BYTES) {
      throw new Error('Remote locale pack exceeds size limit');
    }
    return { text, json: JSON.parse(text) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteLocaleManifest({
  baseUrl = REMOTE_LOCALES_BASE_URL,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  timeoutMs = 5000,
  userAgent = 'agy-claude-studio',
} = {}) {
  if (!fetchFn) return null;
  const cleanBase = String(baseUrl || REMOTE_LOCALES_BASE_URL).replace(/\/+$/, '');
  try {
    const { json } = await fetchJsonWithTimeout(
      `${cleanBase}/manifest.json`,
      fetchFn,
      timeoutMs,
      userAgent
    );
    if (!json || typeof json !== 'object' || !json.locales || typeof json.locales !== 'object') {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

async function syncLocalePack({
  lang,
  pluginDataDir,
  baseUrl = REMOTE_LOCALES_BASE_URL,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  timeoutMs = 12000,
  userAgent = 'agy-claude-studio',
} = {}) {
  const norm = normalizePackLang(lang);
  if (!norm) {
    throw new Error('Current language is English (native); no translation pack required');
  }
  if (!fetchFn) {
    throw new Error('fetch is unavailable');
  }
  if (!pluginDataDir) {
    throw new Error('pluginDataDir is required to save cloud locale pack');
  }

  const cleanBase = String(baseUrl || REMOTE_LOCALES_BASE_URL).replace(/\/+$/, '');
  let expectedSha = '';
  let remoteManifest = null;
  try {
    const { json: manifest } = await fetchJsonWithTimeout(
      `${cleanBase}/manifest.json`,
      fetchFn,
      Math.min(timeoutMs, 6000),
      userAgent
    );
    remoteManifest = manifest && typeof manifest === 'object' && manifest.locales ? manifest : null;
    const entry = remoteManifest && remoteManifest.locales[norm];
    if (entry && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256)) {
      expectedSha = entry.sha256.toLowerCase();
    }
  } catch {
    // Manifest is optional; pack JSON itself is strictly schema-validated below.
  }

  const packUrl = `${cleanBase}/${encodeURIComponent(norm)}.json`;
  const { text, json } = await fetchJsonWithTimeout(packUrl, fetchFn, timeoutMs, userAgent);
  const actualSha = crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex').toLowerCase();
  if (expectedSha) {
    const rawSha = crypto.createHash('sha256').update(text, 'utf8').digest('hex').toLowerCase();
    if (rawSha !== expectedSha && actualSha !== expectedSha) {
      throw new Error(`Checksum mismatch for ${norm}.json`);
    }
  }

  const validated = validateLocalePack(json, norm);
  if (!validated) {
    throw new Error(`Invalid locale pack payload for ${norm}`);
  }
  validated.sourceSha256 = expectedSha || actualSha;

  const targetPath = getCloudPackPath(norm, pluginDataDir);
  atomicWriteJson(targetPath, validated);

  return {
    ok: true,
    lang: norm,
    bundled: isBundledLang(norm),
    source: 'cloud',
    sha256: validated.sourceSha256,
    remoteManifest,
    agyVersion: validated.agyVersion,
    updatedAt: validated.updatedAt,
    dictCount: Object.keys(validated.dict).length,
    ruleCount: validated.rules.length,
    sentenceCount: validated.sentences.length,
  };
}

function resetLocalePack({ lang, pluginDataDir } = {}) {
  if (!pluginDataDir) return { ok: false, removed: [] };
  const removed = [];
  if (lang === 'all') {
    for (const code of SUPPORTED_PACK_LANGS) {
      const p = getCloudPackPath(code, pluginDataDir);
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          removed.push(code);
        } catch {}
      }
    }
  } else {
    const norm = normalizePackLang(lang);
    if (norm) {
      const p = getCloudPackPath(norm, pluginDataDir);
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          removed.push(norm);
        } catch {}
      }
    }
  }
  return { ok: true, removed };
}

module.exports = {
  BUNDLED_PACK_LANGS,
  ON_DEMAND_PACK_LANGS,
  SUPPORTED_PACK_LANGS,
  LANGUAGE_CATALOG,
  REMOTE_LOCALES_BASE_URL,
  BUNDLED_LOCALES_DIR,
  PACKS_SUBDIR,
  normalizePackLang,
  isBundledLang,
  getCloudPacksDir,
  getCloudPackPath,
  getBundledPackPath,
  readBundledManifest,
  validateLocalePack,
  readLocalePack,
  readCloudLocalePackOverride,
  listLocalePacksStatus,
  getLocalePackStatus,
  fetchRemoteLocaleManifest,
  syncLocalePack,
  resetLocalePack,
};
