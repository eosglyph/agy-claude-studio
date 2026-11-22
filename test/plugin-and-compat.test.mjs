import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const cdp = require(path.join(ROOT_DIR, 'cdp.js'));
const effortCore = require(path.join(ROOT_DIR, 'effort-core.js'));
const i18nLocales = require(path.join(ROOT_DIR, 'i18n-locales.js'));
const i18nCore = require(path.join(ROOT_DIR, 'i18n-core.js'));
const lifecycle = require(path.join(ROOT_DIR, 'lifecycle.js'));
const mcpHost = require(path.join(ROOT_DIR, 'plugin', 'mcp-host.js'));

function matchesCompound(node, sel) {
  if (!node || node.nodeType !== 1) return false;
  let rest = sel.trim();
  if (!rest) return false;
  const tagM = /^[a-zA-Z0-9_-]+/.exec(rest);
  if (tagM) {
    if (node.tagName !== tagM[0].toUpperCase()) return false;
    rest = rest.slice(tagM[0].length);
  }
  while (rest) {
    if (rest[0] === '#') {
      const m = /^#([a-zA-Z0-9_-]+)/.exec(rest);
      if (!m || node.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest[0] === '.') {
      const m = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
      if (!m || !node.classList.contains(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest[0] === '[') {
      const m = /^\[([^\]=*^$]+)(?:(\^?=)"([^"]*)")?\]/.exec(rest);
      if (!m) return false;
      const val = node.getAttribute(m[1]);
      if (m[2] === undefined) {
        if (!node.hasAttribute(m[1])) return false;
      } else if (m[2] === '^=') {
        if (!String(val || '').startsWith(m[3])) return false;
      } else if (val !== m[3]) {
        return false;
      }
      rest = rest.slice(m[0].length);
    } else {
      return false;
    }
  }
  return true;
}

function matchesSelector(node, sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean).some((chain) => {
    const tokens = chain.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    if (!matchesCompound(node, tokens[tokens.length - 1])) return false;
    let cur = node.parentElement;
    for (let i = tokens.length - 2; i >= 0; i--) {
      if (tokens[i] === '>') {
        i -= 1;
        if (i < 0 || !cur || !matchesCompound(cur, tokens[i])) return false;
        cur = cur.parentElement;
      } else {
        while (cur && !matchesCompound(cur, tokens[i])) cur = cur.parentElement;
        if (!cur) return false;
        cur = cur.parentElement;
      }
    }
    return true;
  });
}

test('cdp.isAntigravityPageTarget allows conversation titles starting with Claude Studio and rejects sidecars/plugins', () => {
  assert.equal(
    cdp.isAntigravityPageTarget({
      type: 'page',
      title: 'Agy Claude Style 迁移归档 - agy-claude-studio - Antigravity',
      url: 'https://127.0.0.1:1161/c/acfe92b1-1a9a-410b-a9a3-df07467cd7a8?tab=sidecar__agy-claude-studio%2Fstudio__%2F',
      webSocketDebuggerUrl: 'ws://127.0.0.1:1159/devtools/page/1',
    }),
    true
  );

  assert.equal(
    cdp.isAntigravityPageTarget({
      type: 'iframe',
      title: 'plugin://agy-claude-studio--studio-6155/?token=abc',
      url: 'plugin://agy-claude-studio--studio-6155/?token=abc',
      webSocketDebuggerUrl: 'ws://127.0.0.1:1159/devtools/page/2',
    }),
    false
  );

  assert.equal(
    cdp.isAntigravityPageTarget({
      type: 'page',
      title: 'Claude Studio',
      url: 'http://127.0.0.1:6155/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:1159/devtools/page/3',
    }),
    false
  );

  assert.equal(
    cdp.isAntigravityPageTarget({
      type: 'page',
      title: 'External Page',
      url: 'https://example.com/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:1159/devtools/page/4',
    }),
    false
  );
});

test('buildInjectExpression skips non-host HTTP documents (Antigravity 2.33.1 guard)', () => {
  const expr = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
  const sandbox = {
    location: { protocol: 'https:', href: 'https://example.com/third-party' },
    document: {
      title: 'Third Party Docs',
      readyState: 'complete',
      documentElement: {},
      head: {},
      querySelector: () => null,
      addEventListener: () => {},
    },
    window: {},
    console,
  };
  sandbox.globalThis = sandbox;
  const res = vm.runInNewContext(expr, sandbox);
  assert.equal(res.status, 'skipped-non-host');
});

test('effort-core strips Antigravity 2.33.1 context window suffixes and Thinking labels', () => {
  assert.equal(effortCore.stripContextWindowSuffix('Gemini 4 Neon (High) · 1M'), 'Gemini 4 Neon (High)');
  assert.equal(effortCore.stripContextWindowSuffix('Claude Opus 4.6 (High Thinking) • 200k ctx'), 'Claude Opus 4.6 (High Thinking)');
  assert.deepEqual(effortCore.parseModelLabelEffort('Gemini 4 Neon (High) · 1M'), {
    base: 'Gemini 4 Neon',
    effort: 'high',
  });
  assert.deepEqual(effortCore.parseModelLabelEffort('Claude Opus 4.6 (High Thinking) · extended'), {
    base: 'Claude Opus 4.6',
    effort: 'high',
  });
});

test('i18n-core protects usage-monitor DOM roots and translates Antigravity 2.33.1 UI strings', () => {
  const NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
  const prevNF = globalThis.NodeFilter;
  const prevMO = globalThis.MutationObserver;
  globalThis.NodeFilter = NodeFilter;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };

  const mkEl = (tag, text, attrs = {}) => {
    const classes = new Set();
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      childNodes: [],
      children: [],
      attributes: attrs,
      parentElement: null,
      parentNode: null,
      isConnected: true,
      classList: { contains: (c) => classes.has(c) },
      get id() { return attrs.id || ''; },
      getAttribute(k) { return attrs[k] ?? null; },
      setAttribute(k, v) { attrs[k] = String(v); },
      removeAttribute(k) { delete attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
      matches(sel) { return matchesSelector(this, sel); },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (matchesSelector(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      append(child) {
        child.parentElement = this;
        child.parentNode = this;
        this.childNodes.push(child);
        if (child.nodeType === 1) this.children.push(child);
        return child;
      },
    };
    if (text !== undefined) {
      el.append({ nodeType: 3, nodeValue: text, isConnected: true, childNodes: [], children: [] });
    }
    return el;
  };

  try {
    const html = mkEl('html');
    const body = html.append(mkEl('body'));
    const nav = body.append(mkEl('nav'));
    const coordNode = nav.append(mkEl('button', 'Coordinators'));
    const customModelsNode = nav.append(mkEl('button', 'Custom Models'));
    const umCapsule = nav.append(mkEl('div', undefined, { id: 'ag-usage-monitor-capsule' }));
    const umText = umCapsule.append(mkEl('button', 'Coordinators'));
    const umDynamic = nav.append(mkEl('div', undefined, { id: 'ag-usage-monitor-custom-widget' }));
    const umDynText = umDynamic.append(mkEl('button', 'Custom Models'));
    const orchHeading = nav.append(mkEl('div', 'Orchestrator Settings'));
    const orchModel = nav.append(mkEl('div', 'Orchestrator Model'));
    const execModel = nav.append(mkEl('div', 'Executor Model'));
    const weeklyLimit = nav.append(mkEl('div', 'Gemini 4 Argon Weekly Limit'));
    const inputBoxLbl = nav.append(mkEl('div', 'Input Box'));
    const openLinksIn = nav.append(mkEl('div', 'Open Links In'));
    const createPrompt = nav.append(mkEl('div', 'Create with Prompt'));
    const noAuto = nav.append(mkEl('div', 'No automations yet'));

    const doc = {
      nodeType: 9,
      documentElement: html,
      body,
      childNodes: [html],
      createTreeWalker(root, what, filter) {
        const list = [];
        const walk = (n) => {
          for (const c of n.childNodes) {
            if ((what & NodeFilter.SHOW_TEXT) && c.nodeType === 3) {
              const res = filter?.acceptNode ? filter.acceptNode(c) : NodeFilter.FILTER_ACCEPT;
              if (res === NodeFilter.FILTER_ACCEPT) list.push(c);
            } else if (c.nodeType === 1) {
              const res = filter?.acceptNode ? filter.acceptNode(c) : NodeFilter.FILTER_ACCEPT;
              if (res === NodeFilter.FILTER_REJECT) continue;
              if ((what & NodeFilter.SHOW_ELEMENT) && res === NodeFilter.FILTER_ACCEPT) list.push(c);
              walk(c);
            }
          }
        };
        walk(root);
        let idx = -1;
        const w = {
          currentNode: root,
          nextNode() {
            idx += 1;
            if (idx < list.length) {
              this.currentNode = list[idx];
              return this.currentNode;
            }
            return null;
          },
        };
        return w;
      },
    };

    const translator = i18nCore.createDomTranslator(i18nLocales.resolveLocaleBundle);
    translator.setLanguage('zh-CN', doc);

    assert.equal(coordNode.childNodes[0].nodeValue, '协调者');
    assert.equal(customModelsNode.childNodes[0].nodeValue, '自定义模型');
    assert.equal(orchHeading.childNodes[0].nodeValue, '编排器设置');
    assert.equal(orchModel.childNodes[0].nodeValue, '规划模型');
    assert.equal(execModel.childNodes[0].nodeValue, '执行模型');
    assert.equal(weeklyLimit.childNodes[0].nodeValue, 'Gemini 4 Argon 本周额度');
    assert.equal(inputBoxLbl.childNodes[0].nodeValue, '输入框');
    assert.equal(openLinksIn.childNodes[0].nodeValue, '链接打开方式');
    assert.equal(createPrompt.childNodes[0].nodeValue, '用提示词创建');
    assert.equal(noAuto.childNodes[0].nodeValue, '暂无自动化任务');
    assert.equal(umText.childNodes[0].nodeValue, 'Coordinators', 'usage-monitor capsule must stay untouched');
    assert.equal(umDynText.childNodes[0].nodeValue, 'Custom Models', 'ag-usage-monitor-* widget must stay untouched');
    translator.destroy();
  } finally {
    globalThis.NodeFilter = prevNF;
    globalThis.MutationObserver = prevMO;
  }
});

test('usageStatsEnabled defaults to false, controls all in-chat HUD without mutating saved child prefs, and decouples inlineStats', async () => {
  const timers = new Set();
  const makeEl = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const classes = new Set((opts.className || '').split(/\s+/).filter(Boolean));
    const children = [];
    const listeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      parentElement: null,
      parentNode: null,
      children,
      childNodes: children,
      isConnected: true,
      _text: opts.text || '',
      style: { _props: {}, setProperty(k, v) { this._props[k] = String(v); }, getPropertyValue(k) { return this._props[k] || ''; }, removeProperty(k) { delete this._props[k]; } },
      classList: {
        add(...cs) { cs.forEach((c) => classes.add(c)); },
        remove(...cs) { cs.forEach((c) => classes.delete(c)); },
        contains(c) { return classes.has(c); },
        toggle(c, f) { if (f === undefined ? !classes.has(c) : f) classes.add(c); else classes.delete(c); },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { attrs.set('id', String(v)); },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get textContent() { return this._text || children.map((c) => c.textContent).join(''); },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      set innerHTML(v) { this._text = String(v ?? ''); children.length = 0; },
      get childElementCount() { return children.length; },
      get firstChild() { return children[0] || null; },
      get lastElementChild() { return children[children.length - 1] || null; },
      getAttribute(k) { return k === 'class' ? this.className : (attrs.has(k) ? attrs.get(k) : null); },
      setAttribute(k, v) { if (k === 'class') this.className = v; else attrs.set(k, String(v)); },
      removeAttribute(k) { attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      toggleAttribute(k, f) { if (f) attrs.set(k, ''); else attrs.delete(k); },
      appendChild(child) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, child);
        else children.push(child);
        return child;
      },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
          this.parentNode = null;
        }
      },
      addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
      removeEventListener() {},
      animate() { return { cancel() {} }; },
      getBoundingClientRect() { return { left: 100, top: 600, right: 500, bottom: 660, width: 400, height: 60 }; },
      matches(sel) { return matchesSelector(this, sel); },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (matchesSelector(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  const docEl = makeEl('html');
  const head = docEl.appendChild(makeEl('head'));
  const body = docEl.appendChild(makeEl('body', { className: 'theme-standalone' }));
  const home = body.appendChild(makeEl('div', { className: 'agy-home' }));
  const inputBox = home.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const footer = card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));
  footer.appendChild(makeEl('button', { attrs: { 'data-testid': 'send-button' } }));

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Jetski Web',
    createElement: (t) => makeEl(t),
    getElementById: (id) => docEl.querySelector('#' + id),
    querySelector: (s) => docEl.querySelector(s),
    querySelectorAll: (s) => docEl.querySelectorAll(s),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const sandbox = {
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { protocol: 'https:', href: 'https://127.0.0.1:1161/', pathname: '/' },
    localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { const id = setTimeout(() => fn(Date.now()), 5); timers.add(id); return id; },
    cancelAnimationFrame: (id) => { timers.delete(id); clearTimeout(id); },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 1,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    assert.equal(cdp.DEFAULT_CONFIG.usageStatsEnabled, false, 'Built-in usage stats must default to false');
    assert.equal(cdp.sanitizeConfig({ usageMonitorCompat: true }).usageStatsEnabled, false, 'Legacy usageMonitorCompat:true maps to usageStatsEnabled:false');
    assert.equal(cdp.sanitizeConfig({ usageMonitorCompat: false }).usageStatsEnabled, true, 'Legacy usageMonitorCompat:false maps to usageStatsEnabled:true');

    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, usageStatsEnabled: true, inlineStats: true, hudTopBar: true }),
      sandbox
    );
    assert.ok(footer.querySelector('.ag-cs-context-ring'), 'Ring should render when usageStatsEnabled is true');
    assert.ok(footer.querySelector('.ag-cs-inline-stats'), 'Inline stats should render when usageStatsEnabled is true');
    assert.ok(card.querySelector('.ag-cs-hud-top-bar'), 'Top HUD bar should render when usageStatsEnabled is true');

    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, usageStatsEnabled: false, inlineStats: true, hudTopBar: true }),
      sandbox
    );
    assert.equal(footer.querySelector('.ag-cs-context-ring'), null, 'Ring must hide when usageStatsEnabled is false');
    assert.equal(footer.querySelector('.ag-cs-inline-stats'), null, 'Inline stats must hide when usageStatsEnabled is false');
    assert.equal(card.querySelector('.ag-cs-hud-top-bar'), null, 'Top HUD bar must hide when usageStatsEnabled is false');
    const st = sandbox.window.__agClaudeStudio.getState();
    assert.equal(st.cfg.inlineStats, true, 'Saved inlineStats preference must remain intact');
    assert.equal(st.cfg.hudTopBar, true, 'Saved hudTopBar preference must remain intact');

    vm.runInNewContext(
      cdp.buildInjectExpression({
        ...cdp.DEFAULT_CONFIG,
        usageStatsEnabled: true,
        inlineStats: false,
        hudTopBar: true,
        hudBottomBar: true,
        hudRimProgress: true,
        hudFooterChip: true,
      }),
      sandbox
    );
    assert.equal(footer.querySelector('.ag-cs-context-ring'), null, 'Ring must hide when inlineStats is false');
    assert.equal(footer.querySelector('.ag-cs-inline-stats'), null, 'Inline stats must hide when inlineStats is false');
    assert.ok(card.querySelector('.ag-cs-hud-top-bar'), 'Top HUD bar must stay active when inlineStats is false');
    assert.ok(card.querySelector('.ag-cs-hud-bottom-bar'), 'Bottom HUD bar must stay active when inlineStats is false');
    assert.ok(card.querySelector('.ag-cs-hud-rim-progress'), 'Rim progress must stay active when inlineStats is false');
    assert.ok(footer.querySelector('.ag-cs-hud-footer-chip'), 'Footer quota chip must stay active when inlineStats is false');

    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, usageStatsEnabled: true, inlineStats: true, hudTopBar: true }),
      sandbox
    );
    assert.ok(footer.querySelector('.ag-cs-context-ring'), 'Ring should restore after turning inlineStats back on');
    assert.ok(card.querySelector('.ag-cs-hud-top-bar'), 'Top HUD bar should restore after turning usageStatsEnabled on');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('MCP lifecycle host exposes zero tools and Studio UI exposes pure palettes, glassEffect, Periodic Table, and usageStatsEnabled without Aurora or Liang Wufeng', async () => {
  const initRes = mcpHost.handleMcpJsonRpcMessage(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    '1.3.0'
  );
  assert.equal(initRes.result.serverInfo.name, 'agy-claude-studio-host');
  assert.equal(initRes.result.serverInfo.version, '1.3.0');

  const toolsRes = mcpHost.handleMcpJsonRpcMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, '1.3.0');
  assert.deepEqual(toolsRes.result.tools, []);

  const studioHtml = fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'studio', 'index.html'), 'utf8');
  assert.ok(studioHtml.includes('usageStatsEnabled'), 'Studio UI includes usageStatsEnabled master toggle');
  assert.ok(studioHtml.includes('pinUsageMonitorPane'), 'Studio UI includes pinUsageMonitorPane toggle');
  assert.ok(studioHtml.includes('btn-open-um') && studioHtml.includes('/api/open-usage-monitor'), 'Studio UI includes one-click jump button to Usage Monitor pane');
  assert.ok(studioHtml.includes('黑曜石'), 'Studio UI labels obsidian palette as 黑曜石');
  assert.ok(studioHtml.includes('glassEffect'), 'Studio UI includes standalone glassEffect toggle');
  assert.ok(studioHtml.includes('periodicSelector'), 'Studio UI includes periodicSelector toggle');
  assert.equal(studioHtml.includes('paletteEnabled'), false, 'Studio UI no longer has redundant paletteEnabled toggle');
  assert.equal(studioHtml.includes('Gemini Aurora'), false, 'Studio UI no longer has Aurora wallpaper themes');
  assert.ok(studioHtml.includes('Claude Studio'), 'Studio UI uses renamed brand title');
  assert.ok(studioHtml.includes('section-body') && studioHtml.includes('section-chevron') && studioHtml.includes('is-collapsed'), 'Studio UI provides collapsible section panels');
  assert.ok(studioHtml.includes('agCsStudioCollapsedGroups'), 'Studio UI persists collapsed group state in localStorage');
  assert.equal(/liangwufeng|performanceBackdrop/i.test(studioHtml), false, 'Studio UI contains no Liang Wufeng controls');

  const css = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');
  assert.match(css, /\.agy-composer-footer\s+#ag-usage-monitor-capsule[\s\S]*?order:\s*5\s*!important[\s\S]*?margin-left:\s*8px\s*!important/, 'Composer CSS left-aligns usage-monitor metrics after left controls to prevent jitter');
  assert.match(css, /\.ag-cs-um-ctx-proxy[\s\S]*?order:\s*8;/, 'Composer CSS places mirrored usage-monitor context ring at far right edge');

  const studioMod = await import('../sidecars/studio/main.mjs');
  assert.equal(studioMod.isLocalHostRequest({ headers: { host: '127.0.0.1:6155', origin: 'plugin://agy-claude-studio--studio-6155' } }), true);
  assert.equal(studioMod.isLocalHostRequest({ headers: { host: 'evil.example.com', origin: 'https://evil.example.com' } }), false);

  const logoSvg = fs.readFileSync(path.join(ROOT_DIR, 'assets', 'logo.svg'), 'utf8');
  assert.ok(logoSvg.includes('ag-cs-gemini-star'), 'Plugin tab logo uses crisp Gemini sparkle star vector SVG');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cs-um-detect-'));
  try {
    assert.equal(studioMod.detectUsageMonitorInstalled([tmpRoot]), false, 'Detects missing usage-monitor cleanly');
    const umDir = path.join(tmpRoot, 'usage-monitor');
    fs.mkdirSync(umDir, { recursive: true });
    fs.writeFileSync(path.join(umDir, 'plugin.json'), JSON.stringify({ name: 'usage-monitor', version: '1.5.3' }), 'utf8');
    assert.equal(studioMod.detectUsageMonitorInstalled([tmpRoot]), true, 'Detects installed usage-monitor plugin');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('usage-monitor composer footer split mirrors context ring to far right, forwards clicks, and cleans up on undock or remove', () => {
  const timers = new Set();
  const makeEl = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const classes = new Set((opts.className || '').split(/\s+/).filter(Boolean));
    const children = [];
    const listeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      parentElement: null,
      parentNode: null,
      children,
      childNodes: children,
      isConnected: true,
      hidden: Boolean(opts.hidden),
      _text: opts.text || '',
      style: { _props: {}, setProperty(k, v) { this._props[k] = String(v); }, getPropertyValue(k) { return this._props[k] || ''; }, removeProperty(k) { delete this._props[k]; } },
      classList: {
        add(...cs) { cs.forEach((c) => classes.add(c)); },
        remove(...cs) { cs.forEach((c) => classes.delete(c)); },
        contains(c) { return classes.has(c); },
        toggle(c, f) { if (f === undefined ? !classes.has(c) : f) classes.add(c); else classes.delete(c); },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { attrs.set('id', String(v)); },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get textContent() { return this._text || children.map((c) => c.textContent).join(''); },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      set innerHTML(v) { this._text = String(v ?? ''); children.length = 0; },
      get childElementCount() { return children.length; },
      get firstChild() { return children[0] || null; },
      get lastElementChild() { return children[children.length - 1] || null; },
      getAttribute(k) { return k === 'class' ? this.className : (attrs.has(k) ? attrs.get(k) : null); },
      setAttribute(k, v) { if (k === 'class') this.className = v; else attrs.set(k, String(v)); },
      removeAttribute(k) { attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      toggleAttribute(k, f) { if (f) attrs.set(k, ''); else attrs.delete(k); },
      appendChild(child) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, child);
        else children.push(child);
        return child;
      },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
          this.parentNode = null;
        }
      },
      addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) {
        for (const fn of listeners.get(ev.type) || []) fn(ev);
        return true;
      },
      click() {
        this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} });
      },
      animate() { return { cancel() {} }; },
      getBoundingClientRect() { return { left: 100, top: 600, right: 500, bottom: 660, width: 400, height: 60 }; },
      matches(sel) { return matchesSelector(this, sel); },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      getElementById(id) { return this.querySelector('#' + id); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (matchesSelector(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  const docEl = makeEl('html');
  const head = docEl.appendChild(makeEl('head'));
  const body = docEl.appendChild(makeEl('body', { className: 'theme-standalone' }));
  const topBar = body.appendChild(makeEl('div', { className: 'top-bar' }));
  const inputBox = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const footer = card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));

  // Build mock usage-monitor capsule with Shadow DOM mounted inside footer
  const umCap = footer.appendChild(makeEl('div', { attrs: { id: 'ag-usage-monitor-capsule' } }));
  const sr = makeEl('div');
  const umMultiBtn = sr.appendChild(makeEl('button', { className: 'wm-multi-btn is-running', attrs: { 'aria-label': '多会话实时信息', 'aria-expanded': 'false' } }));
  let umMultiClicks = 0;
  umMultiBtn.addEventListener('click', () => { umMultiClicks += 1; });
  umMultiBtn.appendChild(makeEl('span', { className: 'wm-multi-dot' }));
  umMultiBtn.appendChild(makeEl('span', { className: 'wm-multi-label', attrs: { 'data-od-value': '1 运行中', 'aria-label': '1 运行中' }, text: '0123456789 运行中' }));
  const umBtn = sr.appendChild(makeEl('button', { className: 'wm-capsule-btn', attrs: { title: 'Usage Monitor' } }));
  let umBtnClicks = 0;
  umBtn.addEventListener('click', () => { umBtnClicks += 1; });
  umBtn.appendChild(makeEl('span', { className: 'wm-cap-slot', attrs: { 'data-metric': 'tps', 'data-vis-rank': '1' }, text: '27.5 t/s' }));
  umBtn.appendChild(makeEl('span', { className: 'wm-sep', attrs: { 'data-sep-for-rank': '2' } }));
  const ctxSlot = umBtn.appendChild(makeEl('span', { className: 'wm-cap-slot wm-ctx-seg tone-danger', attrs: { 'data-metric': 'context', 'data-vis-rank': '2' } }));
  const ringSvg = ctxSlot.appendChild(makeEl('svg', { className: 'wm-ring-svg' }));
  ringSvg.appendChild(makeEl('circle', { className: 'wm-ring-fill', attrs: { 'stroke-dasharray': '32.67', 'stroke-dashoffset': '0.65' } }));
  ctxSlot.appendChild(makeEl('span', { className: 'wm-slot-text wm-ctx-pct', attrs: { 'data-od-value': '98%', 'aria-label': '98%' }, text: '01234567890123456789%' }));
  umCap.shadowRoot = sr;

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Jetski Web',
    createElement: (t) => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    getElementById: (id) => docEl.querySelector('#' + id),
    querySelector: (s) => docEl.querySelector(s),
    querySelectorAll: (s) => docEl.querySelectorAll(s),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const sandbox = {
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { protocol: 'https:', href: 'https://127.0.0.1:1161/', pathname: '/' },
    localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { const id = setTimeout(() => fn(Date.now()), 5); timers.add(id); return id; },
    cancelAnimationFrame: (id) => { timers.delete(id); clearTimeout(id); },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 1,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, usageStatsEnabled: false, composerRestyle: true }),
      sandbox
    );
    const proxy = footer.querySelector('.ag-cs-um-ctx-proxy');
    assert.ok(proxy, 'Far-right context proxy button must mount when usage-monitor is docked in footer');
    assert.equal(proxy.querySelector('.ag-cs-um-ctx-label').textContent, '98%', 'Proxy must read clean data-od-value instead of raw odometer digits');
    assert.equal(proxy.classList.contains('tone-danger'), true, 'Proxy must mirror tone-danger class');
    assert.equal(proxy.querySelector('.ag-cs-um-ring-fill').getAttribute('stroke-dashoffset'), '0.65', 'Proxy must mirror SVG ring progress');
    assert.ok(sr.getElementById('ag-cs-um-split-css'), 'Shadow DOM split style must hide duplicate context segment inside middle capsule');

    proxy.click();
    assert.equal(umBtnClicks, 1, 'Clicking far-right proxy must forward click to usage-monitor capsule button');

    // Move usage-monitor back to top bar -> proxy & shadow split CSS must automatically clean up
    topBar.appendChild(umCap);
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, usageStatsEnabled: false, composerRestyle: true });
    assert.equal(footer.querySelector('.ag-cs-um-ctx-proxy'), null, 'Proxy must unmount when usage-monitor moves out of footer');
    assert.equal(sr.getElementById('ag-cs-um-split-css'), null, 'Shadow DOM split style must be removed when usage-monitor moves back to top bar');

    // Move back into footer and verify REMOVE_EXPRESSION cleans both proxy and shadow style
    footer.appendChild(umCap);
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, usageStatsEnabled: false, composerRestyle: true });
    assert.ok(footer.querySelector('.ag-cs-um-ctx-proxy'));
    assert.ok(sr.getElementById('ag-cs-um-split-css'));

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
    assert.equal(footer.querySelector('.ag-cs-um-ctx-proxy'), null, 'REMOVE_EXPRESSION must remove proxy');
    assert.equal(sr.getElementById('ag-cs-um-split-css'), null, 'REMOVE_EXPRESSION must remove shadow DOM split style');
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('openUsageMonitorPane switches existing tab or opens via host sidecar link bridge, and pinUsageMonitorPane triggers once per conversation', async () => {
  const makeEl = (tag, { id = '', className = '', attrs = {}, text = '' } = {}) => {
    const el = {
      tagName: tag.toUpperCase(),
      id,
      className,
      attrs: new Map(Object.entries(attrs)),
      children: [],
      parentElement: null,
      textContent: text,
      isConnected: true,
      style: { setProperty() {}, removeProperty() {} },
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains(c) { return String(el.className || '').split(/\s+/).includes(c); },
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 }),
      matches: () => false,
      animate: () => ({ cancel() {}, finish() {} }),
      insertBefore(c) { return this.appendChild(c); },
      clicks: 0,
      setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      hasAttribute(k) { return this.attrs.has(k); },
      removeAttribute(k) { this.attrs.delete(k); },
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
      remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; } },
      addEventListener() {},
      removeEventListener() {},
      click() { this.clicks++; },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === '[data-testid="conversation-view"]' && cur.getAttribute('data-testid') === 'conversation-view') return cur;
          if (sel === '[data-testid="agent-input-box"]' && cur.getAttribute('data-testid') === 'agent-input-box') return cur;
          if (sel === '[data-cascade-id]' && cur.hasAttribute('data-cascade-id')) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            const match =
              (sel === '[data-testid="agent-input-box"] .surface-composer-card' && c.className.includes('surface-composer-card')) ||
              (sel === '[data-aux-pane-open]' && c.hasAttribute('data-aux-pane-open')) ||
              (sel === '[data-side-panel-strip]' && c.hasAttribute('data-side-panel-strip')) ||
              (sel === '[data-testid="toggle-aux-sidebar"]' && c.getAttribute('data-testid') === 'toggle-aux-sidebar') ||
              (sel === 'button' && c.tagName === 'BUTTON') ||
              (sel === '.agy-composer-footer' && c.className.includes('agy-composer-footer'));
            if (match) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  const docEl = makeEl('html');
  const head = docEl.appendChild(makeEl('head'));
  const body = docEl.appendChild(makeEl('body', { className: 'theme-standalone' }));
  const root = body.appendChild(makeEl('div', { id: 'root' }));
  const conv = root.appendChild(makeEl('div', { attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': '11111111-1111-4111-8111-111111111111' } }));
  const inputBox = conv.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));

  const auxPane = root.appendChild(makeEl('div', { attrs: { 'data-aux-pane-open': 'false' } }));
  const toggleBtn = auxPane.appendChild(makeEl('button', { attrs: { 'data-testid': 'toggle-aux-sidebar' } }));
  const strip = auxPane.appendChild(makeEl('div', { attrs: { 'data-side-panel-strip': '', 'data-active-tab-id': 'sidecar__agy-claude-studio/studio__/' } }));

  const sidecarCalls = [];
  root.__reactContainer$test = {
    current: {
      child: {
        memoizedProps: {
          value: {
            resolveSidecarLink: (t) => (/usage-monitor\/panel/.test(t) ? { title: '用量监控' } : null),
            onSidecarLinkClick: (t) => { sidecarCalls.push(t); },
          },
        },
      },
    },
  };

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Test - Antigravity',
    getElementById: (id) => (id === 'root' ? root : null),
    querySelector: (sel) => docEl.querySelector(sel),
    querySelectorAll: (sel) => docEl.querySelectorAll(sel),
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
  };

  const timers = new Set();
  const sandbox = {
    document: doc,
    location: { href: 'https://127.0.0.1:2015/c/11111111-1111-4111-8111-111111111111', protocol: 'https:', hostname: '127.0.0.1', pathname: '/c/11111111-1111-4111-8111-111111111111' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { const id = setTimeout(() => fn(Date.now()), 5); timers.add(id); return id; },
    cancelAnimationFrame: (id) => { timers.delete(id); clearTimeout(id); },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 1,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    // 1. With pinUsageMonitorPane: true and no tab yet -> opens via host sidecar link bridge ONCE for convo-aaa
    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, pinUsageMonitorPane: true }),
      sandbox
    );
    assert.deepEqual(sidecarCalls, ['usage-monitor/panel/'], 'Auto-opens Usage Monitor pane once when entering conversation');

    // Re-syncing same conversation must NOT re-trigger (polite: never steals focus!)
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinUsageMonitorPane: true });
    assert.equal(sidecarCalls.length, 1, 'Must not re-open Usage Monitor within the same conversation');

    // 2. Switching to a new conversation triggers once again
    conv.setAttribute('data-cascade-id', '22222222-2222-4222-8222-222222222222');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinUsageMonitorPane: true });
    assert.equal(sidecarCalls.length, 2, 'Auto-opens Usage Monitor once when switching to a new conversation');

    // 3. Explicit openUsageMonitorPane when tab already exists expands closed pane & clicks tab
    const umTabBtn = strip.appendChild(makeEl('button', { text: '用量监控' }));
    const res = sandbox.window.__agClaudeStudio.openUsageMonitorPane({ forceSwitch: true });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'switched');
    assert.equal(toggleBtn.clicks, 1, 'Expands closed aux pane before switching tab');
    assert.equal(umTabBtn.clicks, 1, 'Clicks existing Usage Monitor tab');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('lifecycle lock and MCP host registry ignore recycled OS PIDs (EPERM / non-watcher executables)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cs-pid-reuse-'));
  const pidFile = path.join(tmpDir, '.watch.pid');
  const lockFile = path.join(tmpDir, '.watch.lock.json');
  const hostsDir = lifecycle.getMcpHostsDir(tmpDir);
  const recycledPid = 25248;
  try {
    fs.mkdirSync(hostsDir, { recursive: true });
    fs.writeFileSync(pidFile, String(recycledPid), 'utf8');
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: recycledPid, mode: 'mcp-plugin', dir: tmpDir, startedAt: '2026-11-22T07:03:10.515Z' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(hostsDir, `${recycledPid}.json`),
      JSON.stringify({ pid: recycledPid, lsAddress: '', startedAt: '2026-11-22T07:03:10.501Z' }),
      'utf8'
    );

    const winEpermInspect = () => ({ alive: true, eperm: true });
    assert.equal(
      lifecycle.isWatcherProcessAlive(recycledPid, null, { inspectProcess: winEpermInspect, platform: 'win32' }),
      false
    );
    const lockInfoEperm = lifecycle.readWatcherLockInfo(pidFile, lockFile, {
      inspectProcess: winEpermInspect,
      platform: 'win32',
    });
    assert.equal(lockInfoEperm.alive, false);
    assert.equal(lockInfoEperm.source, 'lock-stale');

    const wrongExeInspect = () => ({ alive: true, exeName: 'SearchFilterHost.exe' });
    const lock = await lifecycle.acquireWatcherLock({
      pidFile,
      lockFile,
      mode: 'mcp-plugin',
      replaceExisting: true,
      preserveModes: ['mcp-plugin'],
      inspectProcess: wrongExeInspect,
      platform: 'win32',
    });
    assert.equal(lock.acquired, true, 'Must reclaim lock when old PID now belongs to an unrelated process');
    assert.equal(lock.pid, process.pid);

    const alivePeers = lifecycle.listAliveMcpHosts({
      stateDir: tmpDir,
      excludePid: process.pid,
      pruneStale: true,
      inspectProcess: wrongExeInspect,
      platform: 'win32',
    });
    assert.deepEqual(alivePeers, []);
    assert.equal(fs.existsSync(path.join(hostsDir, `${recycledPid}.json`)), false);

    const realNodeInspect = () => ({ alive: true, exeName: 'node.exe', commandLine: 'node plugin/mcp-host.js' });
    assert.equal(
      lifecycle.isWatcherProcessAlive(recycledPid, { exeName: 'node.exe', scriptHint: 'mcp-host.js' }, { inspectProcess: realNodeInspect, platform: 'win32' }),
      true
    );

    lock.release();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('cdp.ensureMigratedPluginConfig migrates legacy agy-claude-style plugin_data config seamlessly', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cs-migrate-'));
  try {
    const oldPluginData = path.join(tmpBase, 'agy-claude-style');
    const newPluginData = path.join(tmpBase, 'agy-claude-studio');
    fs.mkdirSync(oldPluginData, { recursive: true });
    fs.writeFileSync(
      path.join(oldPluginData, 'config.json'),
      JSON.stringify({ palette: 'obsidian', glassEffect: false, usageStatsEnabled: false, pinUsageMonitorPane: true }),
      'utf8'
    );
    const newConfigPath = path.join(newPluginData, 'config.json');
    const migrated = cdp.ensureMigratedPluginConfig({
      pluginDataDir: newPluginData,
      configFile: newConfigPath,
      legacyConfigFile: path.join(tmpBase, 'nonexistent-legacy.json'),
      explicitConfig: false,
    });
    assert.equal(migrated, true, 'Must migrate config from sibling plugin_data/agy-claude-style');
    const parsed = JSON.parse(fs.readFileSync(newConfigPath, 'utf8'));
    assert.equal(parsed.palette, 'obsidian');
    assert.equal(parsed.glassEffect, false);
    assert.equal(parsed.usageStatsEnabled, false);
    assert.equal(parsed.pinUsageMonitorPane, true);
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('usage-monitor footer split observes Shadow DOM even when context segment starts hidden on cold start', () => {
  const timers = new Set();
  const observedCallbacks = new Map();
  const makeEl = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const classes = new Set((opts.className || '').split(/\s+/).filter(Boolean));
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      parentElement: null,
      parentNode: null,
      children,
      childNodes: children,
      isConnected: true,
      hidden: Boolean(opts.hidden),
      _text: opts.text || '',
      style: { _props: {}, setProperty(k, v) { this._props[k] = String(v); }, getPropertyValue(k) { return this._props[k] || ''; }, removeProperty(k) { delete this._props[k]; } },
      classList: {
        add(...cs) { cs.forEach((c) => classes.add(c)); },
        remove(...cs) { cs.forEach((c) => classes.delete(c)); },
        contains(c) { return classes.has(c); },
        toggle(c, f) { if (f === undefined ? !classes.has(c) : f) classes.add(c); else classes.delete(c); },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { attrs.set('id', String(v)); },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get textContent() { return this._text || children.map((c) => c.textContent).join(''); },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      set innerHTML(v) { this._text = String(v ?? ''); children.length = 0; },
      get childElementCount() { return children.length; },
      get firstChild() { return children[0] || null; },
      get lastElementChild() { return children[children.length - 1] || null; },
      getAttribute(k) { return k === 'class' ? this.className : (attrs.has(k) ? attrs.get(k) : null); },
      setAttribute(k, v) { if (k === 'class') this.className = v; else attrs.set(k, String(v)); },
      removeAttribute(k) { attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      toggleAttribute(k, f) { if (f) attrs.set(k, ''); else attrs.delete(k); },
      appendChild(child) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, child);
        else children.push(child);
        return child;
      },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
          this.parentNode = null;
        }
      },
      addEventListener() {},
      removeEventListener() {},
      animate() { return { cancel() {} }; },
      getBoundingClientRect() { return { left: 100, top: 600, right: 500, bottom: 660, width: 400, height: 60 }; },
      matches(sel) { return matchesSelector(this, sel); },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      getElementById(id) { return this.querySelector('#' + id); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (matchesSelector(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  const docEl = makeEl('html');
  const head = docEl.appendChild(makeEl('head'));
  const body = docEl.appendChild(makeEl('body', { className: 'theme-standalone' }));
  const inputBox = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const footer = card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));

  const umCap = footer.appendChild(makeEl('div', { attrs: { id: 'ag-usage-monitor-capsule' } }));
  const sr = makeEl('div');
  const umBtn = sr.appendChild(makeEl('button', { className: 'wm-capsule-btn', attrs: { title: 'Usage Monitor' } }));
  const ctxSlot = umBtn.appendChild(
    makeEl('span', { className: 'wm-cap-slot wm-ctx-seg', hidden: true, attrs: { 'data-metric': 'context', hidden: '' } })
  );
  ctxSlot.appendChild(makeEl('span', { className: 'wm-slot-text wm-ctx-pct', attrs: { 'data-od-value': '42%' }, text: '42%' }));
  umCap.shadowRoot = sr;

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Jetski Web',
    createElement: (t) => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    getElementById: (id) => docEl.querySelector('#' + id),
    querySelector: (s) => docEl.querySelector(s),
    querySelectorAll: (s) => docEl.querySelectorAll(s),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const sandbox = {
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { protocol: 'https:', href: 'https://127.0.0.1:1161/', pathname: '/' },
    localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe(target) { observedCallbacks.set(target, this.cb); }
      disconnect() {}
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { const id = setTimeout(() => fn(Date.now()), 5); timers.add(id); return id; },
    cancelAnimationFrame: (id) => { timers.delete(id); clearTimeout(id); },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 1,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, usageStatsEnabled: false, composerRestyle: true }),
      sandbox
    );
    assert.equal(footer.querySelector('.ag-cs-um-ctx-proxy'), null);
    const srCb = observedCallbacks.get(sr);
    assert.equal(typeof srCb, 'function', 'Shadow DOM observer must attach even when context slot starts hidden');

    ctxSlot.hidden = false;
    ctxSlot.removeAttribute('hidden');
    srCb([{ target: ctxSlot, addedNodes: [], removedNodes: [] }]);

    const proxy = footer.querySelector('.ag-cs-um-ctx-proxy');
    assert.ok(proxy, 'Proxy must mount immediately once Shadow DOM unhides context slot');
    assert.equal(proxy.querySelector('.ag-cs-um-ctx-label').textContent, '42%');
    assert.ok(sr.getElementById('ag-cs-um-split-css'));

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});
