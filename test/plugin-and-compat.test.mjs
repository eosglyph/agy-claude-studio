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
    assert.equal(orchHeading.childNodes[0].nodeValue, '协作模式设置');
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
    assert.equal(cdp.DEFAULT_CONFIG.usageStatsEnabled, true, 'Built-in usage stats must default to true');
    assert.equal(cdp.DEFAULT_CONFIG.hudBottomBar, false, 'hudBottomBar must default to false');
    assert.equal(cdp.DEFAULT_CONFIG.hudRimProgress, false, 'hudRimProgress must default to false');
    assert.equal(cdp.DEFAULT_CONFIG.pinRightPane, 'studio', 'pinRightPane must default to studio');
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
      }),
      sandbox
    );
    assert.equal(footer.querySelector('.ag-cs-context-ring'), null, 'Ring must hide when inlineStats is false');
    assert.equal(footer.querySelector('.ag-cs-inline-stats'), null, 'Inline stats must hide when inlineStats is false');
    assert.ok(card.querySelector('.ag-cs-hud-top-bar'), 'Top HUD bar must stay active when inlineStats is false');
    assert.ok(card.querySelector('.ag-cs-hud-bottom-bar'), 'Bottom HUD bar must stay active when inlineStats is false');
    assert.ok(card.querySelector('.ag-cs-hud-rim-progress'), 'Rim progress must stay active when inlineStats is false');
    assert.equal(footer.querySelector('.ag-cs-hud-footer-chip'), null, 'Removed footer quota chip must not mount');

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
  assert.ok(studioHtml.includes('pinRightPane'), 'Studio UI includes pinRightPane dropdown');
  assert.equal(studioHtml.includes('hudFooterChip'), false, 'Studio UI removes deprecated hudFooterChip toggle');
  assert.equal(studioHtml.includes('hudCompact'), false, 'Studio UI removes deprecated hudCompact toggle');
  assert.equal(studioHtml.includes('超过 1 分钟（推荐）'), false, 'Studio UI removes recommended-time label from notify duration options');
  assert.ok(studioHtml.includes('btn-open-um') && studioHtml.includes('/api/open-usage-monitor'), 'Studio UI includes one-click jump button to Usage Monitor pane');
  assert.ok(studioHtml.includes('黑曜石'), 'Studio UI labels obsidian palette as 黑曜石');
  assert.ok(studioHtml.includes('glassEffect'), 'Studio UI includes standalone glassEffect toggle');
  assert.ok(studioHtml.includes('periodicSelector'), 'Studio UI includes periodicSelector toggle');
  assert.equal(studioHtml.includes('paletteEnabled'), false, 'Studio UI no longer has redundant paletteEnabled toggle');
  assert.equal(studioHtml.includes('Gemini Aurora'), false, 'Studio UI no longer has Aurora wallpaper themes');
  assert.ok(studioHtml.includes('Claude Studio'), 'Studio UI uses renamed brand title');
  assert.ok(studioHtml.includes('section-body') && studioHtml.includes('section-chevron') && studioHtml.includes('is-collapsed'), 'Studio UI provides collapsible section panels');
  assert.ok(studioHtml.includes('agCsStudioCollapsedGroups'), 'Studio UI persists collapsed group state in localStorage');
  assert.ok(
    studioHtml.includes('panel-chat') && studioHtml.includes('panel-tools') && studioHtml.includes('panel-settings'),
    'Studio UI splits Chat, Tools, and Settings tabs'
  );
  assert.ok(studioHtml.includes('btn-header-upgrade') && studioHtml.includes('cd-inspector'), 'Studio UI includes header upgrade pill and Claude-style chat inspector');
  assert.ok(studioHtml.includes('agCsStudioActiveTab') && studioHtml.includes('agCsStudioCollapseDefaultV2'), 'Studio UI persists active tab and defaults settings cards collapsed on v2');
  assert.ok(studioHtml.includes('notify-section') && studioHtml.includes('overview-notify-card'), 'Studio UI includes mobile push cards on both Overview and Settings');
  assert.ok(studioHtml.includes('/api/notify') && studioHtml.includes('/api/notify/test'), 'Studio UI wires mobile push save and test endpoints');
  assert.equal(/liangwufeng|performanceBackdrop/i.test(studioHtml), false, 'Studio UI contains no Liang Wufeng controls');

  const css = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');
  assert.match(css, /\.agy-composer-footer\s*\{[\s\S]*?position:\s*relative\s*!important/, 'Composer footer establishes positioning context so Tier-1 controls stay immune to bottom HUD bar');
  assert.match(css, /permissions-selector-trigger[\s\S]*?order:\s*9\s*!important/, 'Permissions selector sits on the right side of the Claude-style footer');
  assert.match(css, /button\[aria-haspopup="menu"\][\s\S]*?left:\s*8px\s*!important[\s\S]*?bottom:\s*calc\(100%\s*\+\s*18px\)\s*!important/, 'Add (+) button is pinned inside Tier-1 left edge');
  assert.match(css, /div:nth-child\(2\)\s*>\s*div\.flex[\s\S]*?bottom:\s*calc\(100%\s*\+\s*18px\)\s*!important/, 'Voice/Mic & Send cluster is pinned inside Tier-1 right edge');

  const studioMod = await import('../sidecars/studio/main.mjs');

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

test('usage-monitor footer capsule is never mutated in Shadow DOM and legacy split artifacts are cleaned up', () => {
  const timers = new Set();
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
  sr.appendChild(makeEl('style', { attrs: { id: 'ag-cs-um-split-css' }, text: '/* legacy */' }));
  umCap.shadowRoot = sr;
  footer.appendChild(makeEl('button', { className: 'ag-cs-um-ctx-proxy' }));

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
    assert.equal(footer.querySelector('.ag-cs-um-ctx-proxy'), null, 'Legacy proxy button must be cleaned up');
    assert.equal(sr.getElementById('ag-cs-um-split-css'), null, 'Legacy Shadow DOM split CSS must be removed');
    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
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
            resolveSidecarLink: (t) => (/usage-monitor\/panel|agy-claude-studio\/studio/.test(t) ? { title: t } : null),
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
    // 1. With pinRightPane: 'usage-monitor' and no tab yet -> opens via host sidecar link bridge ONCE for convo-aaa
    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'usage-monitor' }),
      sandbox
    );
    assert.deepEqual(sidecarCalls, ['usage-monitor/panel/'], 'Auto-opens Usage Monitor pane once when entering conversation');

    // Re-syncing same conversation must NOT re-trigger (polite: never steals focus!)
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'usage-monitor' });
    assert.equal(sidecarCalls.length, 1, 'Must not re-open Usage Monitor within the same conversation');

    // 2. Switching to a new conversation triggers once again
    conv.setAttribute('data-cascade-id', '22222222-2222-4222-8222-222222222222');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'usage-monitor' });
    assert.equal(sidecarCalls.length, 2, 'Auto-opens Usage Monitor once when switching to a new conversation');

    // 2b. Switching pinRightPane to 'studio' opens Claude Studio sidecar pane
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.deepEqual(sidecarCalls[2], 'agy-claude-studio/studio/', 'Auto-opens Claude Studio pane when pinRightPane is studio');

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
    assert.equal(parsed.pinRightPane, 'usage-monitor', 'Legacy pinUsageMonitorPane:true migrates to pinRightPane:usage-monitor');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('disabling composerRestyle keeps HUD stats active and places periodic/orchestrator controls on a single inline row', () => {
  const timers = new Set();
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
      get nextSibling() {
        if (!this.parentElement) return null;
        const i = this.parentElement.children.indexOf(this);
        return i >= 0 ? this.parentElement.children[i + 1] || null : null;
      },
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
  const flexRow = footer.appendChild(makeEl('div', { className: 'flex items-center gap-1 min-w-0' }));
  const modelWrap = flexRow.appendChild(makeEl('div', { className: 'min-w-0 no-focus-agent-input' }));
  const modelBtn = modelWrap.appendChild(makeEl('button', { attrs: { 'data-testid': 'model-selector-trigger' }, text: 'Gemini 4 Neon High' }));
  modelBtn.__reactFiber$test = {
    memoizedProps: {
      modelOptions: [
        { label: 'Gemini 4 Neon (High)', value: 1532 },
        { label: 'Orchestrator (Neon)', value: 1537 },
      ],
      selectedModel: { label: 'Gemini 4 Neon (High)', value: 1532 },
      setSelectedModel: () => {},
    },
    return: null,
  };

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
      cdp.buildInjectExpression({
        ...cdp.DEFAULT_CONFIG,
        composerRestyle: false,
        usageStatsEnabled: true,
        hudTopBar: true,
        hudBottomBar: true,
        inlineStats: true,
      }),
      sandbox
    );
    // Periodic & Orchestrator controls must mount in flexRow alongside modelWrap (NOT inside block modelWrap)
    const psBtn = card.querySelector('.ag-cs-periodic-trigger');
    const orchBtn = card.querySelector('.ag-cs-orch-switch');
    assert.ok(psBtn && orchBtn, 'Both periodic trigger and orchestrator switch must render when composerRestyle is false');
    assert.equal(psBtn.parentElement, flexRow, 'Periodic trigger must mount in flex row, not inside block modelWrap');
    assert.equal(orchBtn.parentElement, flexRow, 'Orchestrator switch must mount in flex row, not inside block modelWrap');
    assert.deepEqual(flexRow.children, [psBtn, modelWrap, orchBtn], 'Inline order must be [✦] [Model] [协作] on one row');

    // Disabling composerRestyle must NOT disable HUD stats!
    assert.ok(card.querySelector('.ag-cs-hud-top-bar'), 'Top HUD bar must stay mounted when composerRestyle is false');
    assert.ok(card.querySelector('.ag-cs-hud-bottom-bar'), 'Bottom HUD bar must stay mounted when composerRestyle is false');
    assert.ok(footer.querySelector('.ag-cs-inline-stats'), 'Inline stats must stay mounted when composerRestyle is false');
    assert.ok(footer.querySelector('.ag-cs-context-ring'), 'Context ring must stay mounted when composerRestyle is false');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('i18n-core universal opt-out protocol and dynamic setExtraOptOut protect third-party roots', () => {
  const i18nCore = require('../i18n-core.js');
  const i18nLocales = require('../i18n-locales.js');

  assert.ok(i18nCore.OPT_OUT_PROTOCOL.includes('[translate="no"]'));
  assert.ok(i18nCore.OPT_OUT_PROTOCOL.includes('.notranslate'));
  assert.ok(i18nCore.OPT_OUT_PROTOCOL.includes('[data-ag-no-i18n]'));
  assert.ok(i18nCore.OPT_OUT_PROTOCOL.includes('[data-no-i18n]'));
  assert.ok(i18nCore.OPT_OUT_PROTOCOL.includes('[data-agy-no-translate]'));

  const makeNode = (tag, attrs = {}, text = '') => {
    const attrMap = new Map(Object.entries(attrs));
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      parentElement: null,
      childNodes: [],
      children: [],
      isConnected: true,
      getAttribute(k) { return k === 'class' ? Array.from(classes).join(' ') : (attrMap.has(k) ? attrMap.get(k) : null); },
      setAttribute(k, v) { if (k === 'class') { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); } else attrMap.set(k, String(v)); },
      removeAttribute(k) { attrMap.delete(k); },
      hasAttribute(k) { return attrMap.has(k); },
      matches(sel) {
        return sel.split(',').map((s) => s.trim()).filter(Boolean).some((s) => {
          if (s === '[translate="no"]') return attrMap.get('translate') === 'no';
          if (s === '.notranslate') return classes.has('notranslate');
          if (s === '[data-ag-no-i18n]') return attrMap.has('data-ag-no-i18n');
          if (s === '[data-no-i18n]') return attrMap.has('data-no-i18n');
          if (s === '[data-agy-no-translate]') return attrMap.has('data-agy-no-translate');
          if (s === '#third-party-widget') return attrMap.get('id') === 'third-party-widget';
          return false;
        });
      },
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
          for (const c of n.children || []) {
            if (c.matches && c.matches(sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      appendChild(c) {
        c.parentElement = this;
        this.childNodes.push(c);
        if (c.nodeType === 1) this.children.push(c);
        return c;
      },
    };
    if (text) {
      el.appendChild({ nodeType: 3, nodeValue: text, parentElement: el, isConnected: true });
    }
    return el;
  };

  const htmlEl = makeNode('html');
  const bodyEl = makeNode('body');
  htmlEl.appendChild(bodyEl);
  const doc = {
    nodeType: 9,
    documentElement: htmlEl,
    body: bodyEl,
    childNodes: [htmlEl],
    children: [htmlEl],
    createElement: (t) => makeNode(t),
    querySelectorAll(sel) { return this.body.querySelectorAll(sel); },
    createTreeWalker(root, what, filter) {
      const flat = [];
      const visit = (n) => {
        for (const c of n.childNodes || []) {
          if (c.nodeType === 1 && filter && filter.acceptNode(c) === 2) continue;
          flat.push(c);
          if (c.nodeType === 1) visit(c);
        }
      };
      visit(root);
      let idx = -1;
      return {
        currentNode: null,
        nextNode() {
          idx += 1;
          if (idx >= flat.length) return false;
          this.currentNode = flat[idx];
          return true;
        },
      };
    },
  };

  const normalBtn = makeNode('button', {}, 'Settings');
  const htmlNoTrans = makeNode('div', { translate: 'no' }, 'Settings');
  const clsNoTrans = makeNode('div', { class: 'notranslate' }, 'Settings');
  const dataNoI18n = makeNode('div', { 'data-no-i18n': '' }, 'Settings');
  const thirdParty = makeNode('div', { id: 'third-party-widget' }, 'Settings');
  doc.body.appendChild(normalBtn);
  doc.body.appendChild(htmlNoTrans);
  doc.body.appendChild(clsNoTrans);
  doc.body.appendChild(dataNoI18n);
  doc.body.appendChild(thirdParty);

  const origNF = globalThis.NodeFilter;
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  try {
    const tr = i18nCore.createDomTranslator(i18nLocales.resolveLocaleBundle);
    tr.setLanguage('zh-CN', doc);
    assert.equal(normalBtn.childNodes[0].nodeValue, '设置');
    assert.equal(htmlNoTrans.childNodes[0].nodeValue, 'Settings', 'translate="no" must stay untranslated');
    assert.equal(clsNoTrans.childNodes[0].nodeValue, 'Settings', '.notranslate must stay untranslated');
    assert.equal(dataNoI18n.childNodes[0].nodeValue, 'Settings', 'data-no-i18n must stay untranslated');
    assert.equal(thirdParty.childNodes[0].nodeValue, '设置', 'Unregistered third-party starts translated');

    tr.setExtraOptOut(['#third-party-widget', 'bad<script>'], doc);
    assert.equal(thirdParty.childNodes[0].nodeValue, 'Settings', 'setExtraOptOut must revert matching node live');
    assert.equal(normalBtn.childNodes[0].nodeValue, '设置', 'Normal UI stays translated');
    tr.destroy();
  } finally {
    if (origNF === undefined) delete globalThis.NodeFilter;
    else globalThis.NodeFilter = origNF;
  }
});

test('cdp.syncRemoteI18nCompat and Studio update helpers validate remote payloads and git safety', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cs-compat-'));
  try {
    const mockFetch = async (url) => {
      if (String(url).includes('i18n-compat.json')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              version: 2,
              updatedAt: '2026-11-24',
              protocol: ['[translate="no"]'],
              plugins: [
                { id: 'demo-plugin', name: 'Demo', selectors: ['#demo-plugin-root', '<bad>'] },
              ],
            };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            tag_name: 'v2.2.0',
            name: 'v2.2.0',
            html_url: 'https://github.com/eosglyph/agy-claude-studio/releases/tag/v2.2.0',
            published_at: '2026-11-24T00:00:00Z',
          };
        },
      };
    };

    const syncRes = await cdp.syncRemoteI18nCompat({
      pluginDataDir: tmpDir,
      fetchFn: mockFetch,
    });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.version, 2);
    assert.equal(syncRes.pluginCount, 1);

    const extra = cdp.resolveExtraI18nOptOutSelectors(
      { i18nIgnoreSelectors: ['.my-custom-badge'] },
      tmpDir
    );
    assert.ok(extra.includes('#demo-plugin-root'));
    assert.ok(extra.includes('.my-custom-badge'));
    assert.ok(!extra.includes('<bad>'), 'Unsafe selector must be filtered out');

    const studioMod = await import('../sidecars/studio/main.mjs');
    assert.equal(studioMod.compareSemver('2.2.0', '2.1.0'), 1);
    assert.equal(studioMod.compareSemver('2.1.0', '2.1.0'), 0);
    assert.equal(studioMod.compareSemver('2.0.9', '2.1.0'), -1);

    const upd = await studioMod.checkStudioUpdate({
      fetchFn: mockFetch,
      pluginDir: tmpDir,
      currentVersion: '2.1.0',
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.hasUpdate, true);
    assert.equal(upd.latestVersion, '2.2.0');
    assert.equal(upd.isGitRepo, false);

    // HTTP 403 rate-limit on api.github.com falls back to release web redirect (zero rate limit)
    const updFallbackRedirect = await studioMod.checkStudioUpdate({
      pluginDir: tmpDir,
      currentVersion: '2.1.0',
      fetchFn: async (url) => {
        if (String(url).includes('api.github.com')) {
          return { ok: false, status: 403 };
        }
        if (String(url).includes('/releases/latest')) {
          return {
            ok: false,
            status: 302,
            headers: new Map([['location', 'https://github.com/eosglyph/agy-claude-studio/releases/tag/v2.2.1']]),
          };
        }
        return { ok: false, status: 500 };
      },
    });
    assert.equal(updFallbackRedirect.ok, true);
    assert.equal(updFallbackRedirect.source, 'release-redirect');
    assert.equal(updFallbackRedirect.latestVersion, '2.2.1');
    assert.equal(updFallbackRedirect.hasUpdate, true);

    // If both API and release redirect fail, falls back to raw package.json
    const updFallbackRaw = await studioMod.checkStudioUpdate({
      pluginDir: tmpDir,
      currentVersion: '2.1.0',
      fetchFn: async (url) => {
        if (String(url).includes('package.json')) {
          return { ok: true, status: 200, async json() { return { version: '2.1.0' }; } };
        }
        return { ok: false, status: 403, headers: new Map() };
      },
    });
    assert.equal(updFallbackRaw.ok, true);
    assert.equal(updFallbackRaw.source, 'raw-package');
    assert.equal(updFallbackRaw.latestVersion, '2.1.0');
    assert.equal(updFallbackRaw.hasUpdate, false);

    // Unreleased remote i18n-compat.json (HTTP 404) falls back cleanly to bundled whitelist
    const compat404 = await studioMod.syncI18nCompatWhitelist({
      pluginDataDir: tmpDir,
      fetchFn: async () => ({ ok: false, status: 404 }),
      reinjectFn: async () => {},
    });
    assert.equal(compat404.ok, true);
    assert.equal(compat404.fallbackToBundled, true);
    assert.equal(compat404.status, 404);
    assert.ok(compat404.selectorCount > 0);

    const nonGitSelf = await studioMod.performStudioSelfUpdate({ pluginDir: tmpDir });
    assert.equal(nonGitSelf.ok, false);
    assert.equal(nonGitSelf.reason, 'not_git_repo');

    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    const dirtySelf = await studioMod.performStudioSelfUpdate({
      pluginDir: tmpDir,
      execFn: (cmd, args) => (args[0] === 'status' ? ' M cdp.js\n' : 'main\n'),
    });
    assert.equal(dirtySelf.ok, false);
    assert.equal(dirtySelf.reason, 'dirty_worktree');

    let reinjected = false;
    const pulledCalls = [];
    const upstream = 'a'.repeat(40);
    const cleanSelf = await studioMod.performStudioSelfUpdate({
      pluginDir: tmpDir,
      execFn: (cmd, args) => {
        pulledCalls.push(args.join(' '));
        if (args[0] === 'status') return '';
        if (args[0] === 'rev-parse') return args[1] === '--verify' ? upstream : 'main\n';
        if (args[0] === 'merge') return 'Updating 4c06173..abc1234\nFast-forward\n';
        return '';
      },
      reinjectFn: async () => {
        reinjected = true;
      },
    });
    assert.equal(cleanSelf.ok, true);
    assert.equal(cleanSelf.updated, true);
    assert.equal(reinjected, true);
    assert.ok(pulledCalls.includes(`merge --ff-only --no-overwrite-ignore ${upstream}`));

    // Notify API helpers stay isolated in notify.json and deliver localized test payloads
    const notifyDir = path.join(tmpDir, 'notify-isolation');
    const initialNotify = studioMod.getNotifyConfigApi({ dataDir: notifyDir });
    assert.equal(initialNotify.ok, true);
    assert.equal(initialNotify.configured, false);

    const unconfTest = await studioMod.testNotifyApi({}, { dataDir: notifyDir, fetchFn: async () => ({ ok: true }) });
    assert.equal(unconfTest.ok, false);
    assert.equal(unconfTest.error, 'not_configured');

    const savedNotify = studioMod.saveNotifyConfigApi(
      {
        enabled: true,
        channel: 'ntfy',
        minDurationSec: 20,
        channels: { ntfy: { topic: 'my-phone' } },
      },
      { dataDir: notifyDir }
    );
    assert.equal(savedNotify.ok, true);
    assert.equal(savedNotify.configured, true);
    assert.equal(fs.existsSync(path.join(notifyDir, 'notify.json')), true);
    assert.equal(fs.existsSync(path.join(notifyDir, 'config.json')), false);

    let capturedTestReq = null;
    const okTest = await studioMod.testNotifyApi(null, {
      dataDir: notifyDir,
      language: 'en',
      fetchFn: async (url, init) => {
        capturedTestReq = { url, init };
        return { ok: true, status: 200, async text() { return '{}'; } };
      },
    });
    assert.equal(okTest.ok, true);
    assert.equal(capturedTestReq.url, 'https://ntfy.sh/');
    const bodyObj = JSON.parse(capturedTestReq.init.body);
    assert.equal(bodyObj.topic, 'my-phone');
    assert.ok(bodyObj.title.includes('Test Push Notification'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ui-runtime persists and restores Orchestrator planner effort when Antigravity restarts with orchestratorPick.model === 0', () => {
  const timers = new Set();
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
      _text: opts.text || '',
      style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} },
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
  const modelBtn = footer.appendChild(
    makeEl('button', {
      attrs: { 'data-testid': 'model-selector-trigger', 'aria-label': 'Select model, current: Orchestrator (Neon)' },
      text: 'Gemini 4 Neon Extra High',
    })
  );

  const selectedCalls = [];
  const neonHigh = { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-neon-high', value: 1532 };
  const neonXHigh = { label: 'Gemini 4 Neon (XHigh)', modelId: 'gemini-4-neon-xhigh', value: 1535 };
  const orchNeon = { label: 'Orchestrator (Neon)', modelId: 'gemini-pro-orchestrator-neon', value: 1600 };
  const orchPick = {
    model: 0,
    select(v) {
      selectedCalls.push(v);
      this.model = v;
    },
  };
  modelBtn.__reactFiber$test = {
    memoizedProps: {
      selectedModel: orchNeon,
      setSelectedModel() {},
      modelOptions: [neonHigh, neonXHigh, orchNeon],
      orchestratorPlanners: [neonHigh, neonXHigh],
      orchestratorPick: orchPick,
      orchestratorDefaultPlanner: neonXHigh,
    },
    return: null,
  };

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Test - Antigravity',
    createElement: (t) => makeEl(t),
    getElementById: (id) => docEl.querySelector('#' + id),
    querySelector: (s) => docEl.querySelector(s),
    querySelectorAll: (s) => docEl.querySelectorAll(s),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const storage = {
    'agClaudeStyle.lastOrchPlanner.v1': JSON.stringify({
      value: 1532,
      modelId: 'gemini-4-neon-high',
      label: 'Gemini 4 Neon (High)',
      effortId: 'high',
      symbol: 'Ne',
    }),
  };
  const sandbox = {
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { protocol: 'https:', href: 'https://127.0.0.1:1161/', pathname: '/' },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
      setItem(k, v) { storage[k] = String(v); },
    },
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
    vm.runInNewContext(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, orchestratorSwitch: true }), sandbox);
    assert.deepEqual(selectedCalls, [1532], 'Saved Neon High (1532) must be restored instead of falling back to default XHigh (1535)');
    assert.equal(orchPick.model, 1532);
    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('ui-runtime shows inline compact guide hint only when standalone compact pill is active and clears on typing, IME, or remove', async () => {
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
      get textContent() { return children.length ? children.map((c) => c.textContent).join('') : this._text; },
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
      removeEventListener(ev, fn) {
        const list = listeners.get(ev);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      _listenerCount(ev) { return (listeners.get(ev) || []).length; },
      dispatch(ev) { for (const fn of listeners.get(ev) || []) fn({ type: ev, target: this }); },
      animate() { return { cancel() {} }; },
      getBoundingClientRect() { return opts.rect || { left: 100, top: 600, right: 500, bottom: 636, width: 400, height: 36 }; },
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
  const inputBox = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const wrap = card.appendChild(makeEl('div', { className: 'relative w-full', rect: { left: 100, top: 600, right: 500, bottom: 636, width: 400, height: 36 } }));
  const ed = wrap.appendChild(makeEl('div', { attrs: { contenteditable: 'true' }, rect: { left: 100, top: 600, right: 500, bottom: 636, width: 400, height: 36 } }));
  const p = ed.appendChild(makeEl('p'));
  const chip = p.appendChild(makeEl('span', {
    attrs: { 'data-lexical-decorator': 'true' },
    rect: { left: 112, top: 606, right: 194, bottom: 628, width: 82, height: 22 },
  }));
  const bdi = chip.appendChild(makeEl('bdi', {
    rect: { left: 112, top: 606, right: 190, bottom: 628, width: 78, height: 22 },
  }));
  bdi.appendChild(makeEl('span', {
    className: 'google-symbols',
    attrs: { 'data-symbol-name': 'unfold_less', 'aria-hidden': 'true' },
    text: 'unfold_less',
  }));
  bdi.appendChild(makeEl('span', { text: 'compact' }));

  let lexNodes = [{ type: 'contextScopeItemMention', trigger: '/', value: '/compact' }];
  const lexListeners = new Set();
  let lexUnsubCalled = false;
  ed.__lexicalEditor = {
    getEditorState() {
      return {
        toJSON() {
          return { root: { children: [{ type: 'paragraph', children: lexNodes }] } };
        },
      };
    },
    registerUpdateListener(fn) {
      lexListeners.add(fn);
      return () => {
        lexUnsubCalled = true;
        lexListeners.delete(fn);
      };
    },
  };

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Test - Antigravity',
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
    getComputedStyle: () => ({ paddingRight: '8px', getPropertyValue: () => '' }),
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
    vm.runInNewContext(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'zh-CN' }), sandbox);

    const hint = wrap.querySelector('.ag-cs-compact-hint');
    assert.ok(hint, 'Compact guide hint must render inside wrap without modifying contenteditable DOM');
    assert.equal(ed.querySelector('.ag-cs-compact-hint'), null, 'Hint must stay outside Lexical contenteditable DOM');
    assert.ok(hint.textContent.includes('可选：输入压缩要求'));
    assert.equal(hint.style.left, '98px');

    // Composition hides hint immediately, compositionend restores it when still empty
    ed.dispatch('compositionstart');
    assert.equal(wrap.querySelector('.ag-cs-compact-hint'), null, 'IME compositionstart must hide hint');
    ed.dispatch('compositionend');
    assert.ok(wrap.querySelector('.ag-cs-compact-hint'), 'IME compositionend restores hint when empty');

    // Typing instruction text hides hint (via Lexical update listener cleanly)
    lexNodes = [
      { type: 'contextScopeItemMention', trigger: '/', value: '/compact' },
      { type: 'text', text: '保留未完成规划' },
    ];
    for (const fn of lexListeners) fn();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(wrap.querySelector('.ag-cs-compact-hint'), null, 'Hint must disappear once user types compaction prompt');

    // Clearing typed text brings hint back via Lexical listener, and REMOVE_EXPRESSION cleans up both hint & listener
    lexNodes = [{ type: 'contextScopeItemMention', trigger: '/', value: '/compact' }];
    for (const fn of lexListeners) fn();
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(wrap.querySelector('.ag-cs-compact-hint'), 'Hint reappears when custom prompt is cleared');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
    assert.equal(wrap.querySelector('.ag-cs-compact-hint'), null, 'REMOVE_EXPRESSION cleans up compact guide hint');
    assert.equal(lexUnsubCalled, true, 'REMOVE_EXPRESSION unsubscribes Lexical compact listener');
    assert.equal(ed._agCsCompactHintBound, undefined, 'REMOVE_EXPRESSION resets compact hint bound flag for clean reinject');
    assert.equal(ed._listenerCount('input'), 0, 'REMOVE_EXPRESSION detaches DOM compact hint listeners');
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('ui-runtime clicks inner mention row (not outer option) when filling /compact and mounts guide hint', async () => {
  const timers = new Set();
  let mountMenu = null;
  let outerOptionClicks = 0;
  let innerRowClicks = 0;

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
      style: {
        _props: {},
        setProperty(k, v) { this._props[k] = String(v); },
        getPropertyValue(k) { return this._props[k] || ''; },
        removeProperty(k) { delete this._props[k]; },
      },
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
      get textContent() { return children.length ? children.map((c) => c.textContent).join('') : this._text; },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      set innerHTML(v) {
        this._text = String(v ?? '');
        children.length = 0;
        if (this._text.includes('data-hud-compact-btn="1"')) {
          const btn = makeEl('button', {
            className: 'ag-cs-hud-compact-btn',
            attrs: { 'data-hud-compact-btn': '1', type: 'button' },
            text: '/compact',
          });
          this.appendChild(btn);
        }
      },
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
        this.isConnected = false;
      },
      focus() {},
      addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
      removeEventListener(ev, fn) {
        const list = listeners.get(ev);
        if (!list) return;
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      },
      dispatch(ev, extra = {}) {
        const eventObj = { type: ev, target: this, stopPropagation() {}, preventDefault() {}, ...extra };
        for (const fn of listeners.get(ev) || []) fn(eventObj);
      },
      dispatchEvent(evObj) {
        const t = evObj?.type || 'event';
        for (const fn of listeners.get(t) || []) fn(evObj);
        return true;
      },
      click() { this.dispatch('click'); },
      animate() { return { cancel() {} }; },
      getBoundingClientRect() { return opts.rect || { left: 100, top: 600, right: 500, bottom: 636, width: 400, height: 36 }; },
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
  const inputBox = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const wrap = card.appendChild(makeEl('div', { className: 'relative w-full', rect: { left: 100, top: 600, right: 500, bottom: 636, width: 400, height: 36 } }));
  const ed = wrap.appendChild(makeEl('div', { attrs: { contenteditable: 'true' }, rect: { left: 100, top: 600, right: 500, bottom: 636, width: 400, height: 36 } }));
  const footer = card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));

  let lexNodes = [];
  const lexListeners = new Set();
  ed.__lexicalEditor = {
    getEditorState() {
      return {
        toJSON() {
          return { root: { children: lexNodes.length ? [{ type: 'paragraph', children: lexNodes }] : [] } };
        },
      };
    },
    registerUpdateListener(fn) {
      lexListeners.add(fn);
      return () => lexListeners.delete(fn);
    },
  };

  let menuPortal = null;
  mountMenu = () => {
    if (menuPortal) menuPortal.remove();
    menuPortal = body.appendChild(makeEl('div', { attrs: { role: 'listbox', 'data-mention-menu': '' } }));
    const listWrap = menuPortal.appendChild(makeEl('div'));
    // Mimic Antigravity's exact tHb + qHb nested structure: outer [role="option"] with sibling section header
    // (total height > 80 to also test height filtering) and inner cursor-pointer row holding React's onClickCapture.
    const option = listWrap.appendChild(makeEl('div', {
      attrs: { id: 'typeahead-item-0', role: 'option', 'aria-selected': 'true' },
      rect: { left: 100, top: 500, right: 480, bottom: 590, width: 380, height: 90 },
    }));
    option.appendChild(makeEl('div', { attrs: { 'data-testid': 'menu-section-header' }, text: 'Commands' }));
    option.addEventListener('click', () => {
      outerOptionClicks += 1;
    });

    const row = option.appendChild(makeEl('div', {
      className: 'flex w-full px-2 py-1 items-center gap-2 cursor-pointer',
      rect: { left: 100, top: 530, right: 480, bottom: 562, width: 380, height: 32 },
    }));
    const iconOuter = row.appendChild(makeEl('span'));
    iconOuter.appendChild(makeEl('span', {
      className: 'google-symbols',
      attrs: { 'data-symbol-name': 'unfold_less', 'aria-hidden': 'true' },
      text: 'unfold_less',
    }));
    row.appendChild(makeEl('span', { attrs: { 'data-testid': 'menu-option-label' }, text: 'compact' }));
    row.appendChild(makeEl('span', { attrs: { 'data-testid': 'menu-option-description' }, text: 'Compact the conversation now' }));

    row.addEventListener('click', () => {
      innerRowClicks += 1;
      // Replace plain '/compact' text in editor with Lexical contextScopeItemMention chip (BDI + google-symbols)
      ed.textContent = '';
      const p = ed.appendChild(makeEl('p'));
      const chip = p.appendChild(makeEl('span', {
        attrs: { 'data-lexical-decorator': 'true' },
        rect: { left: 112, top: 606, right: 194, bottom: 628, width: 82, height: 22 },
      }));
      const bdi = chip.appendChild(makeEl('bdi', {
        rect: { left: 112, top: 606, right: 190, bottom: 628, width: 78, height: 22 },
      }));
      bdi.appendChild(makeEl('span', {
        className: 'google-symbols',
        attrs: { 'data-symbol-name': 'unfold_less', 'aria-hidden': 'true' },
        text: 'unfold_less',
      }));
      bdi.appendChild(makeEl('span', { text: 'compact' }));
      lexNodes = [{ type: 'contextScopeItemMention', trigger: '/', value: '/compact' }];
      if (menuPortal) {
        menuPortal.remove();
        menuPortal = null;
      }
      for (const fn of lexListeners) fn();
    });
  };

  class MockMouseEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Test - Antigravity',
    createElement: (t) => makeEl(t),
    getElementById: (id) => docEl.querySelector('#' + id),
    querySelector: (s) => docEl.querySelector(s),
    querySelectorAll: (s) => docEl.querySelectorAll(s),
    execCommand: (cmd, _ui, val) => {
      if (cmd === 'selectAll') return true;
      if (cmd === 'insertText' && val === '/compact') {
        ed.textContent = '/compact';
        lexNodes = [{ type: 'text', text: '/compact' }];
        // Delay menu mount slightly like Antigravity's async typeahead (~90ms)
        const id = setTimeout(() => mountMenu(), 85);
        timers.add(id);
        return true;
      }
      return false;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const sandbox = {
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { protocol: 'https:', href: 'https://127.0.0.1:1161/', pathname: '/' },
    localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
    getComputedStyle: () => ({ paddingRight: '8px', getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MouseEvent: MockMouseEvent,
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
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'zh-CN', usageStatsEnabled: true, hudTopBar: true }),
      sandbox
    );

    const hudCompactBtn = card.querySelector('[data-hud-compact-btn]');
    assert.ok(hudCompactBtn, 'Top HUD bar /compact button must be rendered');
    hudCompactBtn.click();

    await new Promise((r) => setTimeout(r, 260));

    assert.equal(innerRowClicks, 1, 'tryAutoSelectCompactMenu must click inner cursor-pointer row rather than outer [role="option"]');
    assert.equal(outerOptionClicks, 0, 'Outer [role="option"] mock had no bubble trigger; inner row must handle conversion');
    assert.ok(wrap.querySelector('.ag-cs-compact-hint'), 'Inline gray compact guide hint must appear right after chip conversion');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
    assert.equal(wrap.querySelector('.ag-cs-compact-hint'), null, 'REMOVE_EXPRESSION cleans up compact guide hint');
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('compactPreset config validation, sanitization, and auto-fill after /compact chip conversion', async () => {
  assert.equal(cdp.DEFAULT_CONFIG.compactPreset, 'clean');
  assert.equal(cdp.DEFAULT_CONFIG.compactCustomText, '');
  assert.equal(cdp.validateConfigSetting('compactPreset', 'clean'), true);
  assert.equal(cdp.validateConfigSetting('compactPreset', 'dev'), true);
  assert.equal(cdp.validateConfigSetting('compactPreset', 'custom'), true);
  assert.equal(cdp.validateConfigSetting('compactPreset', 'invalid'), false);
  assert.equal(cdp.validateConfigSetting('compactCustomText', '保留待办'), true);
  assert.equal(cdp.validateConfigSetting('compactCustomText', 'a'.repeat(601)), false);
  assert.equal(cdp.validateConfigSetting('compactCustomText', 'bad\0text'), false);

  const sanitized = cdp.sanitizeConfig({ compactPreset: 'bogus', compactCustomText: 'hello\0world' });
  assert.equal(sanitized.compactPreset, 'clean');
  assert.equal(sanitized.compactCustomText, 'helloworld');

  const timers = new Set();
  const insertedTexts = [];
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
      get textContent() { return children.length ? children.map((c) => c.textContent).join('') : this._text; },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      set innerHTML(v) {
        this._text = String(v ?? '');
        children.length = 0;
        if (this._text.includes('data-hud-compact-btn="1"')) {
          this.appendChild(makeEl('button', { className: 'ag-cs-hud-compact-btn', attrs: { 'data-hud-compact-btn': '1', type: 'button' }, text: '/compact' }));
        }
      },
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
        this.isConnected = false;
      },
      focus() {},
      addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
      removeEventListener() {},
      dispatch(ev, extra = {}) {
        const eventObj = { type: ev, target: this, stopPropagation() {}, preventDefault() {}, ...extra };
        for (const fn of listeners.get(ev) || []) fn(eventObj);
      },
      dispatchEvent(evObj) {
        const t = evObj?.type || 'event';
        for (const fn of listeners.get(t) || []) fn(evObj);
        return true;
      },
      click() { this.dispatch('click'); },
      animate() { return { cancel() {} }; },
      getBoundingClientRect() { return opts.rect || { left: 100, top: 600, right: 500, bottom: 636, width: 400, height: 36 }; },
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
  const inputBox = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const wrap = card.appendChild(makeEl('div', { className: 'relative w-full' }));
  const ed = wrap.appendChild(makeEl('div', { attrs: { contenteditable: 'true' } }));
  card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));

  let lexNodes = [];
  const lexListeners = new Set();
  ed.__lexicalEditor = {
    getEditorState() {
      return { toJSON() { return { root: { children: lexNodes.length ? [{ type: 'paragraph', children: lexNodes }] : [] } }; } };
    },
    registerUpdateListener(fn) {
      lexListeners.add(fn);
      return () => lexListeners.delete(fn);
    },
  };

  let menuPortal = null;
  const mountMenu = () => {
    if (menuPortal) menuPortal.remove();
    menuPortal = body.appendChild(makeEl('div', { attrs: { role: 'listbox', 'data-mention-menu': '' } }));
    const option = menuPortal.appendChild(makeEl('div', { attrs: { role: 'option', 'aria-selected': 'true' } }));
    const row = option.appendChild(makeEl('div', { className: 'cursor-pointer', rect: { left: 100, top: 530, right: 480, bottom: 562, width: 380, height: 32 } }));
    row.appendChild(makeEl('span', { attrs: { 'data-testid': 'menu-option-label' }, text: 'compact' }));
    row.addEventListener('click', () => {
      ed.textContent = '';
      const p = ed.appendChild(makeEl('p'));
      const chip = p.appendChild(makeEl('span', { attrs: { 'data-lexical-decorator': 'true' } }));
      chip.appendChild(makeEl('bdi', { text: 'compact' }));
      p.appendChild(makeEl('span', { text: ' ' }));
      lexNodes = [
        { type: 'contextScopeItemMention', trigger: '/', value: '/compact' },
        { type: 'text', text: ' ' },
      ];
      if (menuPortal) { menuPortal.remove(); menuPortal = null; }
      for (const fn of lexListeners) fn();
    });
  };

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Test - Antigravity',
    createElement: (t) => makeEl(t),
    getElementById: (id) => docEl.querySelector('#' + id),
    querySelector: (s) => docEl.querySelector(s),
    querySelectorAll: (s) => docEl.querySelectorAll(s),
    execCommand: (cmd, _ui, val) => {
      if (cmd === 'selectAll') return true;
      if (cmd === 'insertText') {
        insertedTexts.push(val);
        if (val === '/compact') {
          ed.textContent = '/compact';
          lexNodes = [{ type: 'text', text: '/compact' }];
          const id = setTimeout(() => mountMenu(), 30);
          timers.add(id);
          return true;
        }
        // Appending preset text after chip
        lexNodes = [
          { type: 'contextScopeItemMention', trigger: '/', value: '/compact' },
          { type: 'text', text: ` ${val}` },
        ];
        const p = ed.querySelector('p') || ed;
        p.appendChild(makeEl('span', { text: val }));
        for (const fn of lexListeners) fn();
        return true;
      }
      return false;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const sandbox = {
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { protocol: 'https:', href: 'https://127.0.0.1:1161/', pathname: '/' },
    localStorage: { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); } },
    getComputedStyle: () => ({ paddingRight: '8px', getPropertyValue: () => '' }),
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
      cdp.buildInjectExpression({
        ...cdp.DEFAULT_CONFIG,
        language: 'zh-CN',
        usageStatsEnabled: true,
        hudTopBar: true,
        compactPreset: 'clean',
      }),
      sandbox
    );

    const hudCompactBtn = card.querySelector('[data-hud-compact-btn]');
    assert.ok(hudCompactBtn, 'Top HUD bar /compact button must be rendered');
    hudCompactBtn.click();

    await new Promise((r) => setTimeout(r, 240));

    assert.equal(insertedTexts[0], '/compact');
    assert.ok(
      insertedTexts[1] && insertedTexts[1].includes('丢弃已完成任务的琐碎过程与历史噪音') && !insertedTexts[1].startsWith(' '),
      'Must insert clean preset text right after trailing space without double-spacing'
    );
    assert.equal(wrap.querySelector('.ag-cs-compact-hint'), null, 'Guide hint must stay hidden once preset text is filled');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});
