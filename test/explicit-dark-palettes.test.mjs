import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const cdp = require('../src/cdp.js');

test('CONFIG_VALIDATORS and sanitizeConfig accept explicit dark palettes while staying backward compatible', () => {
  assert.deepEqual(cdp.CONFIG_VALIDATORS.palette, [
    'obsidian',
    'obsidian-dark',
    'claude',
    'claude-dark',
    'host',
  ]);

  for (const valid of ['obsidian', 'obsidian-dark', 'claude', 'claude-dark', 'host']) {
    assert.equal(cdp.validateConfigSetting('palette', valid), true, `validateConfigSetting accepts ${valid}`);
    assert.equal(cdp.sanitizeConfig({ palette: valid }).palette, valid, `sanitizeConfig preserves ${valid}`);
  }

  assert.equal(cdp.validateConfigSetting('palette', 'dark'), false);
  assert.equal(cdp.validateConfigSetting('palette', 'gemini'), false);
  assert.equal(cdp.sanitizeConfig({ palette: 'gemini' }).palette, 'obsidian');
  assert.equal(cdp.sanitizeConfig({ paletteEnabled: false, palette: 'gemini' }).palette, 'host');
  assert.equal(cdp.sanitizeConfig({ paletteEnabled: false, palette: 'claude-dark' }).palette, 'claude-dark');
  assert.equal(cdp.sanitizeConfig({ paletteEnabled: false, palette: 'obsidian-dark' }).palette, 'obsidian-dark');
});

test('style.css forces pure dark tokens for obsidian-dark & claude-dark and guards all body.theme-light overrides', () => {
  const css = fs.readFileSync(path.join(ROOT_DIR, 'src', 'style.css'), 'utf8');

  // 1a Obsidian Dark explicit selectors & key dark tokens
  assert.match(
    css,
    /html\[data-ag-cs-style\]\[data-ag-cs-palette="obsidian-dark"\]\s*>\s*body\.theme-light[\s\S]*?color-scheme:\s*dark\s*!important;[\s\S]*?--background:\s*#13161d\s*!important;[\s\S]*?--foreground:\s*#f4f9ff\s*!important;/
  );
  // 1c Claude Dark explicit selectors & key dark tokens
  assert.match(
    css,
    /html\[data-ag-cs-style\]\[data-ag-cs-palette="claude-dark"\]\s*>\s*body\.theme-light[\s\S]*?color-scheme:\s*dark\s*!important;[\s\S]*?--background:\s*#191919\s*!important;[\s\S]*?--foreground:\s*#fdfdfd\s*!important;/
  );

  // Categorical chart dark palette includes both explicit dark palettes
  assert.match(
    css,
    /html\[data-ag-cs-style\]\[data-ag-cs-palette="obsidian-dark"\],\s*html\[data-ag-cs-style\]\[data-ag-cs-palette="claude-dark"\]\s*\{\s*--ag-cs-data-0:\s*#82aaff;/
  );

  // Forced-dark neutralization of host .theme-light Prism syntax & code block backgrounds
  assert.match(
    css,
    /html\[data-ag-cs-style\]\[data-ag-cs-palette\$="-dark"\]\s*>\s*body\.theme-light[\s\S]*?--syntax-default-fg:\s*#f8f8f2\s*!important;/
  );

  // Section 11 effort popover must NOT contain any unguarded body.theme-light / body.light-theme / body.light rules
  const unguardedLightEffort = css.match(
    /^\s*(?:html\[data-ag-cs-effort-accent="off"\]\s+)?body\.(?:theme-light|light-theme|light)\s+\.ag-cs-effort-popover/gm
  );
  assert.equal(unguardedLightEffort, null, 'Effort popover light-body selectors must be guarded against -dark palettes');

  // Section 13 dark glassEffect overrides must also apply to explicit -dark palettes
  const darkGlassHits = css.match(/\[data-ag-cs-glass="on"\](?:\[data-ag-cs-composer="on"\])?\[data-ag-cs-palette\$="-dark"\]/g) || [];
  assert.ok(darkGlassHits.length >= 8, `Expected dark glassEffect selectors for -dark palettes, found ${darkGlassHits.length}`);
});

test('ui-runtime treats claude-dark and obsidian-dark as dark theme even under body.theme-light', async () => {
  function makeNode(tag, opts = {}) {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const listeners = new Map();
    const children = [];
    const classes = new Set((opts.className || '').split(/\s+/).filter(Boolean));
    return {
      tagName: tag.toUpperCase(),
      id: opts.id || '',
      style: {
        _props: {},
        setProperty(k, v) { this._props[k] = String(v); },
        getPropertyValue(k) { return this._props[k] || ''; },
        removeProperty(k) { delete this._props[k]; },
      },
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle(c, force) {
          const on = force === undefined ? !classes.has(c) : Boolean(force);
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
      },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      children,
      parentElement: null,
      parentNode: null,
      isConnected: true,
      _text: opts.text || '',
      get textContent() { return children.length ? children.map((c) => c.textContent).join('') : this._text; },
      set textContent(v) { children.length = 0; this._text = String(v); },
      set innerHTML(h) { children.length = 0; this._html = h; },
      get innerHTML() { return this._html || ''; },
      get childElementCount() { return children.length; },
      get firstChild() { return children[0] || null; },
      get nextSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx >= 0 ? this.parentElement.children[idx + 1] || null : null;
      },
      clientWidth: 900,
      clientHeight: 700,
      appendChild(ch) { ch.parentElement = this; ch.parentNode = this; children.push(ch); return ch; },
      insertBefore(ch, ref) {
        ch.parentElement = this; ch.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, ch); else children.push(ch);
        return ch;
      },
      removeChild(ch) {
        const idx = children.indexOf(ch);
        if (idx >= 0) children.splice(idx, 1);
        ch.parentElement = null; ch.parentNode = null;
        return ch;
      },
      remove() { if (this.parentElement) this.parentElement.removeChild(this); },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      toggleAttribute(k, force) {
        const on = force === undefined ? !attrs.has(k) : Boolean(force);
        if (on) attrs.set(k, ''); else attrs.delete(k);
        return on;
      },
      addEventListener(ev, cb) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(cb); },
      removeEventListener(ev, cb) {
        const arr = listeners.get(ev);
        if (!arr) return;
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      },
      getContext() { return null; },
      getBoundingClientRect() { return { left: 100, top: 600, right: 240, bottom: 626, width: 140, height: 26 }; },
      animate() { return { cancel() {}, finished: Promise.resolve() }; },
      closest(sel) {
        let cur = this;
        while (cur) { if (matches(cur, sel)) return cur; cur = cur.parentElement; }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (matches(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
  }

  function matchesSimple(node, simple) {
    let rest = simple.trim();
    if (!rest) return false;
    const tagMatch = /^[a-zA-Z0-9_-]+/.exec(rest);
    if (tagMatch) {
      if (node.tagName !== tagMatch[0].toUpperCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }
    while (rest.length > 0) {
      if (rest[0] === '#') {
        const m = /^#([a-zA-Z0-9_-]+)/.exec(rest);
        if (!m || node.id !== m[1]) return false;
        rest = rest.slice(m[0].length);
      } else if (rest[0] === '.') {
        const m = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
        if (!m || !node.classList.contains(m[1])) return false;
        rest = rest.slice(m[0].length);
      } else if (rest[0] === '[') {
        const m = /^\[([^\]=]+)(?:="([^"]*)")?\]/.exec(rest);
        if (!m) return false;
        const ok = m[2] === undefined ? node.hasAttribute(m[1]) : node.getAttribute(m[1]) === m[2];
        if (!ok) return false;
        rest = rest.slice(m[0].length);
      } else {
        return false;
      }
    }
    return true;
  }

  function matches(node, selector) {
    return selector.split(',').some((part) => {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length || !matchesSimple(node, tokens[tokens.length - 1])) return false;
      let cur = node.parentElement;
      let idx = tokens.length - 2;
      while (cur && idx >= 0) {
        if (matchesSimple(cur, tokens[idx])) idx--;
        cur = cur.parentElement;
      }
      return idx < 0;
    });
  }

  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body', { className: 'theme-light' });
  html.appendChild(head);
  html.appendChild(body);

  const inputBox = body.appendChild(makeNode('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeNode('div', { className: 'surface-composer-card' }));
  const footer = card.appendChild(makeNode('div', { className: 'agy-composer-footer' }));
  const modelBtn = footer.appendChild(makeNode('button', { attrs: { 'data-testid': 'model-selector-trigger' } }));
  const modelSpan = modelBtn.appendChild(makeNode('span'));
  modelSpan.appendChild(makeNode('span', { text: 'Gemini 4 Hydrogen ' }));
  const effortSpan = modelSpan.appendChild(makeNode('span', { text: 'High' }));

  const storage = new Map();
  const timers = new Set();
  const doc = {
    documentElement: html,
    head,
    body,
    readyState: 'complete',
    hidden: false,
    createElement: (t) => makeNode(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    document: doc,
    navigator: { language: 'zh-CN' },
    innerWidth: 1280,
    innerHeight: 900,
    devicePixelRatio: 1,
    location: { pathname: '/', protocol: 'http:', href: 'http://127.0.0.1:1234/' },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    HTMLElement: Object,
    Element: Object,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    performance: { now: () => Date.now() },
    setTimeout: (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  win.window = win;
  win.globalThis = win;

  try {
    const expr = cdp.buildInjectExpression({
      ...cdp.DEFAULT_CONFIG,
      palette: 'claude',
      effortSliderStyle: 'claude',
      periodicSelector: true,
      homeRipple: false,
      mascot: 'off',
    });
    const res = vm.runInNewContext(expr, win);
    assert.equal(res.status, 'ok');

    assert.equal(html.getAttribute('data-ag-cs-palette'), 'claude');
    win.__agClaudeStudio.openEffortPopover(effortSpan, modelBtn);
    const effortPop = body.querySelector('.ag-cs-effort-popover');
    assert.ok(effortPop);
    assert.equal(effortPop.getAttribute('data-effort-theme'), 'light', 'Auto claude follows host theme-light');

    // Switch to claude-dark under body.theme-light -> dark immediately
    win.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, palette: 'claude-dark', effortSliderStyle: 'claude' });
    assert.equal(html.getAttribute('data-ag-cs-palette'), 'claude-dark');
    assert.equal(effortPop.getAttribute('data-effort-theme'), 'dark', 'claude-dark forces effort popover dark');

    // Open Periodic Table under body.theme-light + obsidian-dark -> dark immediately
    win.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, palette: 'obsidian-dark', effortSliderStyle: 'claude' });
    assert.equal(html.getAttribute('data-ag-cs-palette'), 'obsidian-dark');
    win.__agClaudeStudio.openPeriodicSelector(null, modelBtn);
    const psDrawer = body.querySelector('.ag-cs-ps-drawer');
    assert.ok(psDrawer);
    assert.equal(psDrawer.getAttribute('data-ps-theme'), 'dark', 'obsidian-dark forces Periodic Table dark');

    // Switch back to auto obsidian under body.theme-light -> returns to light
    win.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, palette: 'obsidian', effortSliderStyle: 'claude' });
    assert.equal(html.getAttribute('data-ag-cs-palette'), 'obsidian');
    assert.equal(psDrawer.getAttribute('data-ps-theme'), 'light', 'Switching back to auto obsidian restores light');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, win);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('Studio sidecar HTML exposes all 5 palettes in all 5 locales and syncs data-theme="dark" for explicit dark palettes', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'studio', 'index.html'), 'utf8');

  // Verify PALETTE_OPTS across all 5 languages
  const optsMatch = html.match(/const PALETTE_OPTS = (\{[\s\S]*?\n\s*\});/);
  assert.ok(optsMatch, 'PALETTE_OPTS block exists');
  const paletteOpts = vm.runInNewContext(`(${optsMatch[1]})`);
  const expectedIds = ['obsidian', 'obsidian-dark', 'claude', 'claude-dark', 'host'];
  for (const lang of ['zh-CN', 'zh-TW', 'yue', 'en', 'ja']) {
    assert.ok(Array.isArray(paletteOpts[lang]), `PALETTE_OPTS includes ${lang}`);
    assert.deepEqual(
      Array.from(paletteOpts[lang], ([id]) => id),
      expectedIds,
      `PALETTE_OPTS[${lang}] has all 5 palette options`
    );
  }

  // Verify Studio CSS defines explicit dark variables and overrides inline body colors
  assert.match(html, /:root\[data-palette="claude-dark"\]\s*\{[\s\S]*?--bg:\s*#1f1f1f;/);
  assert.match(html, /:root\[data-palette="obsidian-dark"\]\s*\{[\s\S]*?--bg:\s*#13161d;/);
  assert.match(html, /:root\[data-palette="claude-dark"\]\s+body,\s*:root\[data-palette="obsidian-dark"\]\s+body\s*\{[\s\S]*?background:\s*var\(--bg\)\s*!important;/);

  // Extract and run parseColorLuminance + syncHostThemeAttr under simulated light host
  const fnMatch = html.match(
    /function parseColorLuminance\(raw\)[\s\S]*?function syncHostThemeAttr\(overrideBg\) \{[\s\S]*?\n    \}/
  );
  assert.ok(fnMatch, 'syncHostThemeAttr helper exists');

  const attrs = new Map();
  const rootEl = {
    className: '',
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    removeAttribute(k) { attrs.delete(k); },
  };
  const sandbox = {
    currentConfig: { palette: 'claude' },
    document: {
      documentElement: rootEl,
      body: { className: '' },
    },
    getComputedStyle(el) {
      if (el === rootEl) {
        return { getPropertyValue: (k) => (k === '--background' ? '#ffffff' : '') };
      }
      return { backgroundColor: 'rgb(250, 250, 250)' };
    },
    window: { matchMedia: () => ({ matches: true }) },
  };

  vm.runInNewContext(fnMatch[0], sandbox);

  // Light host + auto claude -> light
  sandbox.syncHostThemeAttr('#ffffff');
  assert.equal(rootEl.getAttribute('data-theme'), 'light');
  assert.equal(rootEl.getAttribute('data-palette'), null);

  // Light host + claude-dark -> forced dark even if theme-change sends #ffffff
  sandbox.currentConfig = { palette: 'claude-dark' };
  sandbox.syncHostThemeAttr('#ffffff');
  assert.equal(rootEl.getAttribute('data-theme'), 'dark');
  assert.equal(rootEl.getAttribute('data-palette'), 'claude-dark');

  // Light host + obsidian-dark -> forced dark
  sandbox.currentConfig = { palette: 'obsidian-dark' };
  sandbox.syncHostThemeAttr();
  assert.equal(rootEl.getAttribute('data-theme'), 'dark');
  assert.equal(rootEl.getAttribute('data-palette'), 'obsidian-dark');

  // Switch back to host/claude -> restores light theme cleanly
  sandbox.currentConfig = { palette: 'host' };
  sandbox.syncHostThemeAttr();
  assert.equal(rootEl.getAttribute('data-theme'), 'light');
  assert.equal(rootEl.getAttribute('data-palette'), null);
});
