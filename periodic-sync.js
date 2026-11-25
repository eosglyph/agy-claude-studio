'use strict';

const fs = require('node:fs');
const path = require('node:path');
const periodicCore = require('./periodic-core.js');

const PERIODIC_OVERRIDE_FILENAME = 'periodic-override.json';
const AI_STUDIO_MODELS_DOC_URL = 'https://aistudio.google.com/docs/models?auto_signin=false';
const AI_STUDIO_PRICING_DOC_URL = 'https://aistudio.google.com/docs/pricing?auto_signin=false';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const ELEMENT_BY_NUM = new Map();
const ELEMENT_BY_NAME_LC = new Map();
for (const el of periodicCore.PERIODIC_ELEMENTS || []) {
  if (!el || el.isRange) continue;
  if (typeof el.num === 'number') ELEMENT_BY_NUM.set(el.num, el);
  if (el.name) ELEMENT_BY_NAME_LC.set(el.name.toLowerCase(), el);
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeCssVarName(raw) {
  return String(raw || '')
    .trim()
    .replace(/^--%NS%/, '--')
    .replace(/^--/, '--');
}

function parseHexOrRgba(str) {
  const s = String(str || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: 1,
    };
  }
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    };
  }
  m = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (m) {
    const h = ((Number(m[1]) % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(1, Number(m[2]) / 100));
    const lig = Math.max(0, Math.min(1, Number(m[3]) / 100));
    const a = m[4] === undefined ? 1 : Number(m[4]);
    const c = (1 - Math.abs(2 * lig - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m0 = lig - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return {
      r: Math.round((r + m0) * 255),
      g: Math.round((g + m0) * 255),
      b: Math.round((b + m0) * 255),
      a,
    };
  }
  return null;
}

function formatRgba(c) {
  if (!c) return '';
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(c.r);
  const g = clamp(c.g);
  const b = clamp(c.b);
  const a = Math.max(0, Math.min(1, Number.isFinite(c.a) ? c.a : 1));
  if (a >= 0.995) {
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = str.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseColorMixStop(part) {
  const s = String(part || '').trim();
  const m = s.match(/^(.*?)\s+([\d.]+)%$/);
  if (m) return { expr: m[1].trim(), pct: Number(m[2]) };
  return { expr: s, pct: null };
}

function mixSrgbColors(c1, p1, c2, p2) {
  let w1 = p1;
  let w2 = p2;
  if (w1 === null && w2 === null) {
    w1 = 50;
    w2 = 50;
  } else if (w1 === null) {
    w1 = 100 - w2;
  } else if (w2 === null) {
    w2 = 100 - w1;
  }
  const sum = w1 + w2;
  if (sum <= 0) return c1;
  const alphaScale = sum < 100 ? sum / 100 : 1;
  const n1 = w1 / sum;
  const n2 = w2 / sum;
  const a1 = c1.a * n1;
  const a2 = c2.a * n2;
  const outA = a1 + a2;
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (c1.r * a1 + c2.r * a2) / outA,
    g: (c1.g * a1 + c2.g * a2) / outA,
    b: (c1.b * a1 + c2.b * a2) / outA,
    a: outA * alphaScale,
  };
}

function resolveColorExpr(expr, mode, tokens, extraVars = {}, depth = 0) {
  if (!expr || depth > 14) return '';
  const s = String(expr).trim().replace(/--%NS%/g, '--');
  if (!s) return '';

  // Direct color literal
  const direct = parseHexOrRgba(s);
  if (direct) return formatRgba(direct);

  // var(--name[, fallback])
  if (s.startsWith('var(') && s.endsWith(')')) {
    const inner = s.slice(4, -1);
    const [varName, fallback] = splitTopLevelCommas(inner);
    const key = normalizeCssVarName(varName);
    const rawVal =
      (Object.prototype.hasOwnProperty.call(extraVars, key) ? extraVars[key] : null) ||
      (Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : null) ||
      fallback ||
      '';
    return resolveColorExpr(rawVal, mode, tokens, extraVars, depth + 1);
  }

  // light-dark(lightVal, darkVal)
  if (s.startsWith('light-dark(') && s.endsWith(')')) {
    const inner = s.slice(11, -1);
    const [lightPart, darkPart] = splitTopLevelCommas(inner);
    const chosen = mode === 'dark' ? darkPart : lightPart;
    return resolveColorExpr(chosen, mode, tokens, extraVars, depth + 1);
  }

  // color-mix(in srgb, stop1, stop2)
  if (s.startsWith('color-mix(') && s.endsWith(')')) {
    const inner = s.slice(10, -1);
    const parts = splitTopLevelCommas(inner);
    if (parts.length >= 3) {
      const s1 = parseColorMixStop(parts[1]);
      const s2 = parseColorMixStop(parts[2]);
      const r1 = resolveColorExpr(s1.expr, mode, tokens, extraVars, depth + 1);
      const r2 = resolveColorExpr(s2.expr, mode, tokens, extraVars, depth + 1);
      const c1 = parseHexOrRgba(r1);
      const c2 = parseHexOrRgba(r2);
      if (c1 && c2) {
        return formatRgba(mixSrgbColors(c1, s1.pct, c2, s2.pct));
      }
    }
  }

  return '';
}

function parseColorV3Tokens(cssText) {
  const tokens = {
    // Safe fallback baseline matching AI Studio v3 tokens in case CSS misses any
    '--color-v3-surface': 'light-dark(#fff,#191919)',
    '--color-v3-surface-container': 'light-dark(#fff,#1f1f1f)',
    '--color-v3-surface-container-high': 'light-dark(#fcfcfc,#252525)',
    '--color-v3-text': 'light-dark(#1b1b1e,#d4d4d4)',
    '--color-v3-text-var': 'light-dark(#565b61,#8c8c8c)',
    '--color-v3-text-on-button-reverse': 'light-dark(#fff,#fff)',
    '--color-v3-accent-1': 'light-dark(#d97706,#fcbd00)',
    '--color-v3-accent-2': 'light-dark(#a855f7,#c597ff)',
    '--color-v3-accent-3': 'light-dark(#d73a49,#d73a49)',
    '--color-v3-accent-4': 'light-dark(#3ca059,#3ddb85)',
    '--color-v3-accent-5': 'light-dark(#7887b5,#8790ab)',
    '--color-v3-accent-6': 'light-dark(#e87400,#ffb74d)',
    '--color-v3-accent-7': 'light-dark(#1f4094,#87a9ff)',
  };
  const re = /(--color-v3-[a-z0-9-]+)\s*:\s*([^;}]+)/gi;
  let m;
  while ((m = re.exec(String(cssText || ''))) !== null) {
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    if (key && val) tokens[key] = val;
  }
  return tokens;
}

function extractCssDecls(block) {
  const decls = {};
  const str = String(block || '');
  // Split by semicolons at top-level (avoiding data URIs / parens)
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  if (start < str.length) parts.push(str.slice(start));
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const prop = normalizeCssVarName(part.slice(0, idx));
    const val = part.slice(idx + 1).trim();
    if (prop.startsWith('--') && val) {
      decls[prop] = val;
    }
  }
  return decls;
}

function parsePeriodicChunk(ptJs, v3Tokens = parseColorV3Tokens('')) {
  const src = String(ptJs || '');
  const launched = [];
  const seenNum = new Set();

  // Resilient structural match for AI Studio's launched elements Map entries:
  // [1,{SGa:"hydrogen",SUa:["models/gemini-4-hydrogen"],fallbackDisplayName:"Gemini 4 Hydrogen"}]
  // Matches regardless of Closure variable renaming (SGa/SUa/pBa).
  const entryRe =
    /\[\s*(\d{1,3})\s*,\s*\{([^{}]{10,360}?models\/gemini-4-[a-z0-9-]+[^{}]{0,260}?)\}\s*\]/g;
  let m;
  while ((m = entryRe.exec(src)) !== null) {
    const atomicNum = Number(m[1]);
    const body = m[2];
    if (!Number.isInteger(atomicNum) || atomicNum < 1 || atomicNum > 118 || seenNum.has(atomicNum)) {
      continue;
    }
    const el = ELEMENT_BY_NUM.get(atomicNum);
    if (!el) continue;

    const slugMatch = body.match(/models\/(gemini-4-[a-z0-9-]+)/i);
    const slug = slugMatch ? slugMatch[1].toLowerCase() : `gemini-4-${el.name.toLowerCase()}`;
    const displayMatch = body.match(/fallbackDisplayName\s*:\s*["']([^"']+)["']/);
    const title = displayMatch ? displayMatch[1].trim() : `Gemini 4 ${el.name}`;

    // Theme key is the lowercase single-word string prop (e.g., SGa:"hydrogen")
    let theme = el.name.toLowerCase();
    const themeMatch = body.match(/[A-Za-z0-9_$]+\s*:\s*["']([a-z][a-z0-9-]{1,24})["']/);
    if (themeMatch && themeMatch[1] !== slug && !themeMatch[1].startsWith('models/')) {
      theme = themeMatch[1].toLowerCase();
    }

    // Hero / 3D flip boolean flag (e.g., pBa:!0 or pBa:true)
    const isHero = /:\s*(?:!0|true)\b/.test(body);

    seenNum.add(atomicNum);
    launched.push({
      num: atomicNum,
      symbol: el.symbol,
      elementName: el.name,
      theme,
      slug,
      title,
      isHero,
    });
  }

  // Extract host-level custom vars (like --neon-hero-bg) from component styles
  const hostVars = {};
  const heroBgMatch = src.match(/--(?:%NS%)?neon-hero-bg\s*:\s*([^;}"]+)/);
  if (heroBgMatch) {
    hostVars['--neon-hero-bg'] = heroBgMatch[1].trim();
  }

  // Extract every .tile-theme-<name>{...} CSS block
  const themes = {};
  const themeRuleRe = /\.tile-theme-([a-z0-9-]+)(?:\[[^\]]*\])?\s*\{([^}]*)\}/gi;
  let tm;
  while ((tm = themeRuleRe.exec(src)) !== null) {
    const themeName = tm[1].toLowerCase();
    const decls = extractCssDecls(tm[2]);
    if (!Object.keys(decls).length) continue;

    const resolveMode = (mode) => {
      const localVars = { ...hostVars, ...decls };
      const out = {};
      // Resolve in dependency order: --tile-bg and --tile-symbol-ink first, then derived vars
      for (const prop of ['--tile-bg', '--tile-edge-lip', '--tile-symbol-ink', '--tile-num-ink', '--tile-pip']) {
        if (!decls[prop]) continue;
        const resolved = resolveColorExpr(decls[prop], mode, v3Tokens, localVars);
        if (resolved) {
          out[prop] = resolved;
          localVars[prop] = resolved;
        }
      }
      return out;
    };

    const light = resolveMode('light');
    const dark = resolveMode('dark');
    if (Object.keys(light).length || Object.keys(dark).length) {
      themes[themeName] = { light, dark };
    }
  }

  return { launched, themes };
}

function parseDocsModelsAndPricing(modelsHtml, pricingHtml) {
  const modelsText = decodeHtmlEntities(modelsHtml);
  const pricingText = decodeHtmlEntities(pricingHtml);
  const bySlug = {};

  // 1. Parse {% card description="..." title="Gemini 4 ..." ... %} blocks in docs/models
  const cardRe = /\{%\s*card\s+([^%]+?)\s*%\}([\s\S]*?)\{%\s*\/card\s*%\}/gi;
  let m;
  while ((m = cardRe.exec(modelsText)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const titleM = attrs.match(/title="([^"]+)"/i);
    const descM = attrs.match(/description="([^"]+)"/i);
    const slugM = body.match(/\*\*(gemini-4-[a-z0-9-]+)\*\*/i);
    if (!slugM) continue;
    const slug = slugM[1].toLowerCase();
    const ctxM = body.match(/\*Context\*\s*\*\*([^*]+)\*\*/i);
    const outM = body.match(/\*Max output\*\s*\*\*([^*]+)\*\*/i);
    const ctxShort = ctxM ? ctxM[1].replace(/\s*tokens?/i, '').trim() : '';
    const outShort = outM ? outM[1].replace(/\s*tokens?/i, '').split('/')[0].trim() : '';
    const context =
      ctxShort && outShort ? `${ctxShort} input · ${outShort} output` : ctxShort ? `${ctxShort} input` : '';
    bySlug[slug] = {
      ...(bySlug[slug] || {}),
      slug,
      title: titleM ? titleM[1].trim() : '',
      desc: descM ? descM[1].trim() : '',
      context,
    };
  }

  // Also scan "## All Gemini 4 models" table in case a newly released model isn't in the top cards
  const tableSlugRe = /\[(Gemini 4 [A-Za-z0-9 .-]+)\]\(\/docs\/models\/(gemini-4-[a-z0-9-]+)\)/gi;
  while ((m = tableSlugRe.exec(modelsText)) !== null) {
    const title = m[1].trim();
    const slug = m[2].toLowerCase();
    if (!bySlug[slug]) {
      bySlug[slug] = { slug, title, desc: '', context: '' };
    }
  }

  // 2. Parse "## Gemini 4 ..." sections in docs/pricing
  const sectionRe = /##\s+(Gemini 4 [^\n{]+?)\s*\{%\s*id="(gemini-4-[a-z0-9-]+)"\s*%\}([\s\S]*?)(?=\n##\s+|$)/gi;
  while ((m = sectionRe.exec(pricingText)) !== null) {
    const title = m[1].trim();
    const slug = m[2].toLowerCase();
    const secBody = m[3];
    const notFree = /not available on the free tier/i.test(secBody);
    const inputM = secBody.match(/Input price[\s\S]{0,160}?(\$[\d.]+)/i);
    const outputM = secBody.match(/Output price[\s\S]{0,160}?(\$[\d.]+)/i);
    let pricing = '';
    if (inputM && outputM) {
      pricing = `All context lengths • Input: ${inputM[1]} / Output: ${outputM[1]}`;
    } else if (inputM) {
      pricing = `Input: ${inputM[1]}`;
    }
    bySlug[slug] = {
      ...(bySlug[slug] || {}),
      slug,
      title: bySlug[slug]?.title || title,
      pricing,
      paid: notFree,
    };
  }

  return bySlug;
}

function sanitizeSafeCssColor(val) {
  const s = String(val || '').trim();
  if (!s || s.length > 64) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  if (/^rgba?\(\s*[\d.,\s%]+\)$/i.test(s)) return s;
  return '';
}

function buildDynamicThemeCss(themes) {
  if (!themes || typeof themes !== 'object') return '';
  const lines = [];
  const allowedProps = ['--tile-bg', '--tile-edge-lip', '--tile-symbol-ink', '--tile-num-ink', '--tile-pip'];
  for (const [rawTheme, modes] of Object.entries(themes)) {
    const theme = String(rawTheme || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,24}$/.test(theme)) continue;
    if (!modes || typeof modes !== 'object') continue;
    for (const mode of ['light', 'dark']) {
      const vars = modes[mode];
      if (!vars || typeof vars !== 'object') continue;
      const decls = [];
      for (const prop of allowedProps) {
        const clean = sanitizeSafeCssColor(vars[prop]);
        if (clean) decls.push(`  ${prop}: ${clean};`);
      }
      if (decls.length) {
        lines.push(`.ag-cs-ps-drawer[data-ps-theme="${mode}"] .ag-cs-ps-theme-${theme} {\n${decls.join('\n')}\n}`);
      }
    }
  }
  return lines.join('\n');
}

function sanitizeOverrideData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const specs = {};
  if (raw.specs && typeof raw.specs === 'object') {
    for (const [sym, spec] of Object.entries(raw.specs)) {
      if (!/^[A-Z][a-z]?$/.test(sym) || !spec || typeof spec !== 'object') continue;
      const theme = String(spec.theme || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]{0,24}$/.test(theme)) continue;
      specs[sym] = {
        title: String(spec.title || '').trim().slice(0, 80),
        slug: String(spec.slug || '').trim().slice(0, 80),
        theme,
        isHero: Boolean(spec.isHero),
        isNew: Boolean(spec.isNew),
        paid: Boolean(spec.paid),
        desc: String(spec.desc || '').trim().slice(0, 320),
        context: String(spec.context || '').trim().slice(0, 80),
        pricing: String(spec.pricing || '').trim().slice(0, 120),
        released: String(spec.released || '').trim().slice(0, 80),
      };
    }
  }
  const themes = {};
  if (raw.themes && typeof raw.themes === 'object') {
    for (const [t, modes] of Object.entries(raw.themes)) {
      const theme = String(t || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]{0,24}$/.test(theme) || !modes || typeof modes !== 'object') continue;
      const cleanModes = {};
      for (const mode of ['light', 'dark']) {
        if (!modes[mode] || typeof modes[mode] !== 'object') continue;
        const cleanVars = {};
        for (const [k, v] of Object.entries(modes[mode])) {
          if (!/^--tile-(?:bg|edge-lip|symbol-ink|num-ink|pip)$/.test(k)) continue;
          const clean = sanitizeSafeCssColor(v);
          if (clean) cleanVars[k] = clean;
        }
        if (Object.keys(cleanVars).length) cleanModes[mode] = cleanVars;
      }
      if (Object.keys(cleanModes).length) themes[theme] = cleanModes;
    }
  }
  return {
    version: 1,
    syncedAt: String(raw.syncedAt || '').trim(),
    specs,
    themes,
    css: buildDynamicThemeCss(themes),
  };
}

function getPeriodicOverridePath(pluginDataDir) {
  if (!pluginDataDir) return '';
  return path.join(pluginDataDir, PERIODIC_OVERRIDE_FILENAME);
}

function readPeriodicOverride(pluginDataDir) {
  const filePath = getPeriodicOverridePath(pluginDataDir);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitizeOverrideData(parsed);
  } catch {
    return null;
  }
}

function writePeriodicOverride(pluginDataDir, data) {
  const filePath = getPeriodicOverridePath(pluginDataDir);
  if (!filePath) throw new Error('pluginDataDir is required');
  const sanitized = sanitizeOverrideData(data);
  if (!sanitized) throw new Error('Invalid periodic override payload');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
  return sanitized;
}

async function fetchTextWithTimeout(url, { fetchFn = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch is unavailable');
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      redirect: 'follow',
      headers: { 'User-Agent': DEFAULT_UA },
      signal: ctrl?.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchPeriodicFromAiStudio({
  fetchFn = globalThis.fetch,
  timeoutMs = 15000,
  baseSpecs = periodicCore.GEMINI4_SPECS,
} = {}) {
  // 1. Fetch public SSR docs (models + pricing) in parallel — zero login required
  const [modelsHtml, pricingHtml] = await Promise.all([
    fetchTextWithTimeout(AI_STUDIO_MODELS_DOC_URL, { fetchFn, timeoutMs }),
    fetchTextWithTimeout(AI_STUDIO_PRICING_DOC_URL, { fetchFn, timeoutMs }).catch(() => ''),
  ]);

  const docsBySlug = parseDocsModelsAndPricing(modelsHtml, pricingHtml);

  // 2. Dynamically locate live versioned AI Studio JS & CSS bundle URLs
  const jsUrl = modelsHtml.match(/https:\/\/www\.gstatic\.com\/_\/mss\/boq-makersuite\/_\/js\/[^"]+/)?.[0] || '';
  const cssUrl = modelsHtml.match(/https:\/\/www\.gstatic\.com\/_\/mss\/boq-makersuite\/_\/ss\/[^"]+/)?.[0] || '';

  let launched = [];
  let themes = {};

  if (jsUrl) {
    const [baseJs, baseCss] = await Promise.all([
      fetchTextWithTimeout(jsUrl, { fetchFn, timeoutMs }),
      cssUrl ? fetchTextWithTimeout(cssUrl, { fetchFn, timeoutMs }).catch(() => '') : Promise.resolve(''),
    ]);
    const v3Tokens = parseColorV3Tokens(baseCss);

    // Dynamically discover chat chunk ID (prompts/new_chat -> <id>)
    const chatChunkMatch =
      baseJs.match(/path\s*:\s*["']prompts\/new_chat["'][^}]{0,260}?\.gq\)\(\s*["']([A-Za-z0-9_]+)["']\s*\)/) ||
      baseJs.match(/path\s*:\s*["']prompts\/:id["'][^}]{0,260}?\.gq\)\(\s*["']([A-Za-z0-9_]+)["']\s*\)/);
    if (chatChunkMatch) {
      const chatId = chatChunkMatch[1];
      const chatUrl = jsUrl.replace(/\/m=_b$/, `/m=${chatId}`);
      const chatJs = await fetchTextWithTimeout(chatUrl, { fetchFn, timeoutMs });

      // Dynamically discover Periodic Table component chunk ID
      const ptChunkMatch = chatJs.match(
        /Periodic table of Gemini 4[\s\S]{0,260}?\.gq\)\(\s*["']([A-Za-z0-9_]+)["']\s*\)/i
      );
      if (ptChunkMatch) {
        const ptId = ptChunkMatch[1];
        const ptUrl = jsUrl
          .replace(/\/excm=_b\//, `/excm=${chatId},_b/`)
          .replace(/\/m=_b$/, `/m=${ptId}`);
        const ptJs = await fetchTextWithTimeout(ptUrl, { fetchFn, timeoutMs });
        const parsedPt = parsePeriodicChunk(ptJs, v3Tokens);
        launched = parsedPt.launched;
        themes = parsedPt.themes;
      }
    }
  }

  // Fallback: if chunk discovery ever misses, still pick up any gemini-4-<element> from docs/models
  if (launched.length === 0) {
    for (const [slug, doc] of Object.entries(docsBySlug)) {
      const m = slug.match(/^gemini-4-([a-z]+)$/);
      if (!m) continue;
      const el = ELEMENT_BY_NAME_LC.get(m[1]);
      if (!el) continue;
      launched.push({
        num: el.num,
        symbol: el.symbol,
        elementName: el.name,
        theme: m[1],
        slug,
        title: doc.title || `Gemini 4 ${el.name}`,
        isHero: Boolean(baseSpecs?.[el.symbol]?.isHero),
      });
    }
  }

  if (launched.length === 0) {
    throw new Error('Could not parse any Gemini 4 elements from Google AI Studio');
  }

  // Merge launched elements + docs metadata with built-in baseline
  const mergedSpecs = {};
  const newSymbols = [];
  const updatedSymbols = [];

  for (const item of launched) {
    const sym = item.symbol;
    const prev = (baseSpecs && baseSpecs[sym]) || null;
    const doc = docsBySlug[item.slug] || {};

    const nextSpec = {
      title: item.title || doc.title || prev?.title || `Gemini 4 ${item.elementName}`,
      slug: item.slug || prev?.slug || `gemini-4-${item.elementName.toLowerCase()}`,
      theme: item.theme || prev?.theme || item.elementName.toLowerCase(),
      isHero: Boolean(item.isHero),
      isNew: item.isHero ? true : prev ? Boolean(prev.isNew) : true,
      // Preserve curated Antigravity paid flag on known elements; for brand-new elements infer from pricing Free tier note
      paid: prev ? Boolean(prev.paid) : Boolean(doc.paid),
      desc: doc.desc || prev?.desc || '',
      context: doc.context || prev?.context || '1M input · 64K output',
      pricing: doc.pricing || prev?.pricing || '',
      released: prev?.released || '',
    };

    mergedSpecs[sym] = nextSpec;

    if (!prev) {
      newSymbols.push(sym);
    } else if (
      prev.title !== nextSpec.title ||
      prev.isHero !== nextSpec.isHero ||
      prev.pricing !== nextSpec.pricing ||
      prev.context !== nextSpec.context ||
      prev.desc !== nextSpec.desc
    ) {
      updatedSymbols.push(sym);
    }
  }

  // Keep any built-in spec that wasn't removed
  for (const [sym, spec] of Object.entries(baseSpecs || {})) {
    if (!mergedSpecs[sym]) {
      mergedSpecs[sym] = { ...spec };
    }
  }

  const syncedAt = new Date().toISOString();
  const payload = sanitizeOverrideData({
    version: 1,
    syncedAt,
    specs: mergedSpecs,
    themes,
  });

  return {
    ok: true,
    syncedAt,
    totalElements: Object.keys(payload.specs).length,
    symbols: Object.keys(payload.specs),
    newSymbols,
    updatedSymbols,
    override: payload,
  };
}

async function syncAndSavePeriodicElements({
  pluginDataDir,
  fetchFn = globalThis.fetch,
  timeoutMs = 15000,
  baseSpecs = periodicCore.GEMINI4_SPECS,
} = {}) {
  const result = await fetchPeriodicFromAiStudio({ fetchFn, timeoutMs, baseSpecs });
  if (pluginDataDir) {
    result.override = writePeriodicOverride(pluginDataDir, result.override);
  }
  return result;
}

module.exports = {
  PERIODIC_OVERRIDE_FILENAME,
  AI_STUDIO_MODELS_DOC_URL,
  AI_STUDIO_PRICING_DOC_URL,
  parseColorV3Tokens,
  resolveColorExpr,
  parsePeriodicChunk,
  parseDocsModelsAndPricing,
  buildDynamicThemeCss,
  sanitizeOverrideData,
  getPeriodicOverridePath,
  readPeriodicOverride,
  writePeriodicOverride,
  fetchPeriodicFromAiStudio,
  syncAndSavePeriodicElements,
};
