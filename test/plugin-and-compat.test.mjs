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

const cdp = require(path.join(ROOT_DIR, 'src', 'cdp.js'));
const effortCore = require(path.join(ROOT_DIR, 'src', 'effort-core.js'));
const i18nLocales = require(path.join(ROOT_DIR, 'src', 'i18n-locales.js'));
const i18nCore = require(path.join(ROOT_DIR, 'src', 'i18n-core.js'));
const lifecycle = require(path.join(ROOT_DIR, 'src', 'lifecycle.js'));
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
  assert.equal(studioHtml.includes('btn-open-um'), false, 'Studio UI removes redundant Usage Monitor button from narrow header');
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

  const css = fs.readFileSync(path.join(ROOT_DIR, 'src', 'style.css'), 'utf8');
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

test('openStudioPane switches existing tab or opens via host sidecar link bridge, and pinRightPane studio triggers once per conversation', async () => {
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
      append(...nodes) { for (const c of nodes) this.appendChild(c); },
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
  const strip = auxPane.appendChild(makeEl('div', { attrs: { 'data-side-panel-strip': '', 'data-active-tab-id': 'browser__google' } }));

  const sidecarCalls = [];
  root.__reactContainer$test = {
    current: {
      child: {
        memoizedProps: {
          value: {
            resolveSidecarLink: (t) => (/agy-claude-studio\/studio/.test(t) ? { title: t } : null),
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
    // 1. With pinRightPane: 'studio' and no tab yet -> opens via host sidecar link bridge ONCE for convo-1
    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' }),
      sandbox
    );
    assert.deepEqual(sidecarCalls, ['agy-claude-studio/studio/'], 'Auto-opens Claude Studio pane once when entering conversation');

    // Re-syncing same conversation must NOT re-trigger (polite: never steals focus!)
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(sidecarCalls.length, 1, 'Must not re-open Claude Studio within the same conversation');

    // 2. Switching to a new conversation triggers once again
    conv.setAttribute('data-cascade-id', '22222222-2222-4222-8222-222222222222');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(sidecarCalls.length, 2, 'Auto-opens Claude Studio once when switching to a new conversation');

    // 2b. Legacy usage-monitor target is no longer supported
    const umRes = sandbox.window.__agClaudeStudio.openRightSidecarPane('usage-monitor');
    assert.equal(umRes.ok, false);
    assert.equal(umRes.status, 'invalid_target');

    // 3. Explicit openStudioPane when tab already exists expands closed pane & clicks tab
    const studioTabBtn = strip.appendChild(makeEl('button', { text: 'Claude Studio' }));
    const res = sandbox.window.__agClaudeStudio.openStudioPane({ forceSwitch: true });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'switched');
    assert.equal(toggleBtn.clicks, 1, 'Expands closed aux pane before switching tab');
    assert.equal(studioTabBtn.clicks, 1, 'Clicks existing Claude Studio tab');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('persistent Claude Studio dock stays pinned across Studio tab / closed aux (solo mode), bounces back when other tabs exist, hides slot on collapse, and cleans up on REMOVE_EXPRESSION', async () => {
  const makeEl = (tag, { id = '', className = '', attrs = {}, text = '', rect = null } = {}) => {
    const styleProps = new Map();
    const classes = new Set((className || '').split(/\s+/).filter(Boolean));
    const listeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      id,
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); for (const c of String(v || '').split(/\s+/).filter(Boolean)) classes.add(c); },
      attrs: new Map(Object.entries(attrs)),
      children: [],
      parentElement: null,
      textContent: text,
      innerHTML: '',
      clicks: 0,
      get isConnected() {
        let cur = this;
        while (cur) {
          if (cur === docEl) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      get firstElementChild() { return this.children[0] || null; },
      style: {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
        removeProperty(k) { styleProps.delete(k); },
      },
      classList: {
        add(...cs) { for (const c of cs) if (c) classes.add(c); },
        remove(...cs) { for (const c of cs) classes.delete(c); },
        toggle(c, force) {
          const on = force === undefined ? !classes.has(c) : Boolean(force);
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
        contains(c) { return classes.has(c); },
      },
      getBoundingClientRect: () => rect || (
        classes.has('ag-cs-dock-body')
          ? { left: 700, top: 70, width: 310, height: 900, right: 1010, bottom: 970 }
          : { left: 257, top: 30, width: 1664, height: 1002, right: 1921, bottom: 1032 }
      ),
      matches: () => false,
      animate: () => ({ cancel() {}, finish() {} }),
      setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      hasAttribute(k) { return this.attrs.has(k); },
      removeAttribute(k) { this.attrs.delete(k); },
      appendChild(c) {
        if (c.parentElement) c.remove();
        c.parentElement = this;
        this.children.push(c);
        return c;
      },
      append(...nodes) { for (const c of nodes) this.appendChild(c); },
      insertBefore(c, ref) {
        if (c.parentElement) c.remove();
        c.parentElement = this;
        const idx = ref ? this.children.indexOf(ref) : -1;
        if (idx >= 0) this.children.splice(idx, 0, c);
        else this.children.push(c);
        return c;
      },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
        }
      },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener(ev, fn) {
        const list = listeners.get(ev);
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      },
      click() {
        this.clicks++;
        for (const fn of listeners.get('click') || []) fn({ stopPropagation() {}, preventDefault() {} });
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === '[data-testid="sidecar-iframe-slot"]' && cur.getAttribute('data-testid') === 'sidecar-iframe-slot') return cur;
          if (sel === '[data-testid="conversation-view"]' && cur.getAttribute('data-testid') === 'conversation-view') return cur;
          if (sel === '[data-testid="agent-input-box"]' && cur.getAttribute('data-testid') === 'agent-input-box') return cur;
          if (sel === '[data-testid="toggle-aux-sidebar"]' && cur.getAttribute('data-testid') === 'toggle-aux-sidebar') return cur;
          if (sel === '[data-cascade-id]' && cur.hasAttribute('data-cascade-id')) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const parts = sel.split(',').map((s) => s.trim());
        const matchOne = (c, p) => {
          if (p === 'button') return c.tagName === 'BUTTON';
          if (p === '[data-testid="conversation-view"]') return c.getAttribute('data-testid') === 'conversation-view';
          if (p === '[data-testid="aux-pane-split"]') return c.getAttribute('data-testid') === 'aux-pane-split';
          if (p === '[data-aux-pane-open]') return c.hasAttribute('data-aux-pane-open');
          if (p === '[data-side-panel-strip]') return c.hasAttribute('data-side-panel-strip');
          if (p === '[data-testid="toggle-aux-sidebar"]') return c.getAttribute('data-testid') === 'toggle-aux-sidebar';
          if (p === '[data-testid="toggle-maximize-pane"]') return c.getAttribute('data-testid') === 'toggle-maximize-pane';
          if (p === '[data-testid="side-panel-new-tab-button"]') return c.getAttribute('data-testid') === 'side-panel-new-tab-button';
          if (p === 'iframe[src*="agy-claude-studio--studio"]') return c.tagName === 'IFRAME' && String(c.getAttribute('src') || '').includes('agy-claude-studio--studio');
          if (p === '[data-ag-cs-dock-open]') return c.hasAttribute('data-ag-cs-dock-open');
          if (p === '[data-ag-cs-dock-solo]') return c.hasAttribute('data-ag-cs-dock-solo');
          if (p === '[data-ag-cs-docked-slot]') return c.hasAttribute('data-ag-cs-docked-slot');
          if (p === '[data-ag-cs-dock-hidden]') return c.hasAttribute('data-ag-cs-dock-hidden');
          if (p === '.ag-cs-pinned-dock') return c.classList.contains('ag-cs-pinned-dock');
          if (p === '[data-testid="agent-input-box"] .surface-composer-card') return c.classList.contains('surface-composer-card');
          if (p === '.agy-composer-footer') return c.classList.contains('agy-composer-footer');
          return false;
        };
        const walk = (n) => {
          for (const c of n.children) {
            if (parts.some((p) => matchOne(c, p))) out.push(c);
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
  const body = docEl.appendChild(makeEl('body', { className: 'theme-light' }));
  const root = body.appendChild(makeEl('div', { id: 'root' }));
  const topControls = root.appendChild(makeEl('div', {
    className: 'absolute right-0 z-50 flex items-center shrink-0',
    rect: { left: 1852, top: 30, width: 68, height: 40, right: 1920, bottom: 70 },
  }));
  const topControlsInner = topControls.appendChild(makeEl('div', {
    className: 'relative flex items-center gap-1 pr-2',
    rect: { left: 1852, top: 36, width: 68, height: 28, right: 1920, bottom: 64 },
  }));
  topControlsInner.appendChild(makeEl('button', { attrs: { 'data-testid': 'toggle-maximize-pane' } }));
  const toggleAuxBtn = topControlsInner.appendChild(makeEl('button', { attrs: { 'data-testid': 'toggle-aux-sidebar' } }));

  const split = root.appendChild(makeEl('div', {
    attrs: { 'data-testid': 'aux-pane-split' },
    rect: { left: 257, top: 30, width: 1664, height: 1002, right: 1921, bottom: 1032 },
  }));
  const chatCol = split.appendChild(makeEl('div', { attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': '33333333-3333-4333-8333-333333333333' } }));
  const nativeSplitter = split.appendChild(makeEl('div', { className: 'native-splitter' }));
  const auxWrap = split.appendChild(makeEl('div', { className: 'aux-wrap' }));
  const auxPane = auxWrap.appendChild(makeEl('div', { attrs: { 'data-aux-pane-open': 'true' } }));
  const strip = auxPane.appendChild(makeEl('div', { attrs: { 'data-side-panel-strip': '', 'data-active-tab-id': 'browser__google' } }));
  const studioTabBtn = strip.appendChild(makeEl('button', {
    text: 'Claude Studio',
    attrs: { 'data-tab-id': 'sidecar__agy-claude-studio/studio__/' },
  }));
  const newTabBtn = strip.appendChild(makeEl('button', {
    text: '',
    attrs: { 'data-testid': 'side-panel-new-tab-button', 'aria-label': '新标签页' },
  }));
  newTabBtn.addEventListener('click', () => {
    strip.setAttribute('data-active-tab-id', 'newTab__empty');
  });
  const overlay = root.appendChild(makeEl('div', {
    className: 'sidecar-overlay',
    rect: { left: 257, top: 30, width: 1664, height: 1002, right: 1921, bottom: 1032 },
  }));
  const studioSlot = overlay.appendChild(makeEl('div', { attrs: { 'data-testid': 'sidecar-iframe-slot' } }));
  studioSlot.appendChild(makeEl('iframe', { attrs: { src: 'https://agy-claude-studio--studio.local/' } }));

  const docListeners = new Map();
  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Dock Test - Antigravity',
    getElementById: (id) => (id === 'root' ? root : null),
    querySelector: (sel) => docEl.querySelector(sel),
    querySelectorAll: (sel) => docEl.querySelectorAll(sel),
    createElement: (tag) => makeEl(tag),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener(ev, fn) {
      const list = docListeners.get(ev);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchClick(target) {
      for (const fn of docListeners.get('click') || []) fn({ target, isTrusted: true });
    },
  };

  const storage = new Map();
  const timers = new Set();
  const sandbox = {
    document: doc,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    location: { href: 'https://127.0.0.1:2015/c/33333333-3333-4333-8333-333333333333', protocol: 'https:', hostname: '127.0.0.1', pathname: '/c/33333333-3333-4333-8333-333333333333' },
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
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' }),
      sandbox
    );

    // 1. Active Browser tab with pinRightPane='studio' -> 3-column dock mounts between chatCol & nativeSplitter
    const dockEl = split.children[1];
    assert.ok(dockEl && dockEl.classList.contains('ag-cs-pinned-dock'), 'Dock must insert right before native splitter');
    assert.equal(split.children[0], chatCol);
    assert.equal(split.children[2], nativeSplitter);
    assert.equal(split.getAttribute('data-ag-cs-dock-open'), '1');
    assert.equal(split.hasAttribute('data-ag-cs-dock-solo'), false);
    assert.equal(split.style.getPropertyValue('--ag-cs-dock-w'), '310px');
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');
    assert.equal(studioSlot.hasAttribute('data-ag-cs-dock-hidden'), false);
    assert.equal(overlay.style.getPropertyValue('--ag-cs-dock-slot-left'), '443px');
    assert.equal(overlay.style.getPropertyValue('--ag-cs-dock-slot-top'), '40px');
    assert.equal(overlay.style.getPropertyValue('--ag-cs-dock-slot-width'), '310px');
    assert.equal(overlay.style.getPropertyValue('--ag-cs-dock-slot-height'), '900px');

    // 2. Collapsing dock shrinks to 28px rail, releases docked slot, and marks slot hidden (prevents ghost overlay)
    sandbox.window.__agClaudeStudio.setPinnedDockCollapsed(true);
    assert.equal(dockEl.classList.contains('is-collapsed'), true);
    assert.equal(split.style.getPropertyValue('--ag-cs-dock-w'), '28px');
    assert.equal(studioSlot.hasAttribute('data-ag-cs-docked-slot'), false);
    assert.equal(studioSlot.getAttribute('data-ag-cs-dock-hidden'), '1');

    // openStudioPane expands collapsed pinned dock instead of reverting to native tab
    const expandRes = sandbox.window.__agClaudeStudio.openStudioPane({ forceSwitch: true });
    assert.equal(expandRes.ok, true);
    assert.equal(expandRes.status, 'dock_expanded');
    assert.equal(dockEl.classList.contains('is-collapsed'), false);
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');
    assert.equal(studioSlot.hasAttribute('data-ag-cs-dock-hidden'), false);
    assert.equal(studioTabBtn.clicks, 0, 'Must not click native Studio tab when pinned dock handles it');

    // 3. Switching active tab to Claude Studio (with no other tabs) stays pinned in solo mode (never reverts to regular sidebar!)
    strip.setAttribute('data-active-tab-id', 'sidecar__agy-claude-studio/studio__/');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.ok(split.querySelector('.ag-cs-pinned-dock'), 'Dock must stay mounted on Studio tab');
    assert.equal(split.getAttribute('data-ag-cs-dock-open'), '1');
    assert.equal(split.getAttribute('data-ag-cs-dock-solo'), '1');
    assert.equal(split.style.getPropertyValue('--ag-cs-dock-solo-pr'), '76px');
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');
    assert.equal(sandbox.window.__agClaudeStudio.getState().pinnedDockSolo, true);

    // Collapsing in solo mode hides the Studio slot cleanly so it never ghosts over the chat pane
    sandbox.window.__agClaudeStudio.setPinnedDockCollapsed(true);
    assert.equal(studioSlot.hasAttribute('data-ag-cs-docked-slot'), false);
    assert.equal(studioSlot.getAttribute('data-ag-cs-dock-hidden'), '1');
    sandbox.window.__agClaudeStudio.setPinnedDockCollapsed(false);
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');
    assert.equal(studioSlot.hasAttribute('data-ag-cs-dock-hidden'), false);

    // 4. Closing the native aux sidebar keeps the pinned dock mounted in solo mode
    auxPane.setAttribute('data-aux-pane-open', 'false');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.ok(split.querySelector('.ag-cs-pinned-dock'), 'Dock must stay mounted when native aux pane is closed');
    assert.equal(split.getAttribute('data-ag-cs-dock-solo'), '1');
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');

    // 4b. User explicitly clicking toggle-aux-sidebar while only Studio tab exists opens blank New Tab in column 3 (never swallows right blank pane!)
    doc.dispatchClick(toggleAuxBtn);
    auxPane.setAttribute('data-aux-pane-open', 'true');
    strip.setAttribute('data-active-tab-id', 'sidecar__agy-claude-studio/studio__/');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(newTabBtn.clicks, 1, 'Clicks native New Tab button when user opens right sidebar with only Studio tab');
    assert.equal(strip.getAttribute('data-active-tab-id'), 'newTab__empty');
    assert.equal(split.hasAttribute('data-ag-cs-dock-solo'), false, 'Right blank panel must stay visible in 3-column mode');
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');

    // 5. Re-opening aux pane with another tab + clicking Plugins -> Claude Studio while collapsed auto-expands dock & bounces back to Browser tab
    auxPane.setAttribute('data-aux-pane-open', 'true');
    const browserTabBtn = strip.appendChild(makeEl('button', {
      text: 'Browser',
      attrs: { 'data-tab-id': 'browser__google' },
    }));
    browserTabBtn.addEventListener('click', () => {
      strip.setAttribute('data-active-tab-id', 'browser__google');
    });
    strip.setAttribute('data-active-tab-id', 'browser__google');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(split.hasAttribute('data-ag-cs-dock-solo'), false);

    sandbox.window.__agClaudeStudio.setPinnedDockCollapsed(true);
    strip.setAttribute('data-active-tab-id', 'sidecar__agy-claude-studio/studio__/');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(browserTabBtn.clicks, 1, 'Bounces native aux strip back to open Browser tab');
    assert.equal(strip.getAttribute('data-active-tab-id'), 'browser__google');
    assert.equal(dockEl.classList.contains('is-collapsed'), false, 'Auto-expands collapsed pinned dock when re-entering Claude Studio');
    assert.equal(split.hasAttribute('data-ag-cs-dock-solo'), false, 'Remains in 3-column mode');
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');

    // 5b. When right sidebar is CLOSED (even with dormant Browser tab in strip), clicking Plugins -> Claude Studio
    // stays in solo pinned mode, expands collapsed dock, and closes the unwanted aux sidebar without waking Browser
    const prevBrowserClicks = browserTabBtn.clicks;
    toggleAuxBtn.addEventListener('click', () => {
      const next = auxPane.getAttribute('data-aux-pane-open') === 'true' ? 'false' : 'true';
      auxPane.setAttribute('data-aux-pane-open', next);
    });
    auxPane.setAttribute('data-aux-pane-open', 'false');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    sandbox.window.__agClaudeStudio.setPinnedDockCollapsed(true);
    // Simulate Plugins -> Claude Studio opening auxPane to Studio tab (without user clicking toggle-aux-sidebar)
    auxPane.setAttribute('data-aux-pane-open', 'true');
    strip.setAttribute('data-active-tab-id', 'sidecar__agy-claude-studio/studio__/');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(auxPane.getAttribute('data-aux-pane-open'), 'false', 'Must close aux sidebar back when it was closed before Plugins -> Claude Studio');
    assert.equal(browserTabBtn.clicks, prevBrowserClicks, 'Must not wake dormant non-Studio tab when aux was closed');
    assert.equal(dockEl.classList.contains('is-collapsed'), false, 'Auto-expands collapsed pinned dock');
    assert.equal(split.getAttribute('data-ag-cs-dock-solo'), '1', 'Stays in solo pinned mode');
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');

    // 5c. Opening another plugin (e.g. Swarm) opens Column 3 normally without interference
    auxPane.setAttribute('data-aux-pane-open', 'true');
    strip.setAttribute('data-active-tab-id', 'sidecar__swarm/swarm_board__/');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(auxPane.getAttribute('data-aux-pane-open'), 'true');
    assert.equal(split.hasAttribute('data-ag-cs-dock-solo'), false, 'Other plugin opens Column 3 alongside pinned Studio dock');
    assert.equal(studioSlot.getAttribute('data-ag-cs-docked-slot'), '1');

    // 6. REMOVE_EXPRESSION tears everything down cleanly including solo/hidden attrs
    sandbox.window.__agClaudeStudio.setPinnedDockCollapsed(true);
    assert.equal(studioSlot.getAttribute('data-ag-cs-dock-hidden'), '1');
    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
    assert.equal(split.querySelector('.ag-cs-pinned-dock'), null);
    assert.equal(split.hasAttribute('data-ag-cs-dock-open'), false);
    assert.equal(split.hasAttribute('data-ag-cs-dock-solo'), false);
    assert.equal(split.style.getPropertyValue('--ag-cs-dock-solo-pr'), '');
    assert.equal(studioSlot.hasAttribute('data-ag-cs-docked-slot'), false);
    assert.equal(studioSlot.hasAttribute('data-ag-cs-dock-hidden'), false);
    assert.equal(overlay.style.getPropertyValue('--ag-cs-dock-slot-width'), '');
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
    assert.equal(parsed.pinRightPane, 'off', 'Legacy pinUsageMonitorPane:true migrates safely to pinRightPane:off after usage-monitor pin removal');
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
  const i18nCore = require('../src/i18n-core.js');
  const i18nLocales = require('../src/i18n-locales.js');

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

test('receivePrerelease config defaults off, compareSemver orders prereleases, and checkStudioUpdate supports beta channel with HTML fallback', async () => {
  assert.equal(cdp.DEFAULT_CONFIG.receivePrerelease, false);
  assert.equal(cdp.validateConfigSetting('receivePrerelease', true), true);
  assert.equal(cdp.validateConfigSetting('receivePrerelease', false), true);
  assert.equal(cdp.validateConfigSetting('receivePrerelease', 'yes'), false);

  const sidecarMod = await import(new URL('../sidecars/studio/main.mjs', import.meta.url).href);
  const { compareSemver, checkStudioUpdate } = sidecarMod;

  assert.equal(compareSemver('2.2.4-beta.1', '2.2.3'), 1);
  assert.equal(compareSemver('2.2.4', '2.2.4-beta.1'), 1);
  assert.equal(compareSemver('2.2.4-beta.2', '2.2.4-beta.1'), 1);
  assert.equal(compareSemver('2.2.4-rc.1', '2.2.4-beta.9'), 1);
  assert.equal(compareSemver('2.2.4-beta.1', '2.2.4-beta.1'), 0);

  // Beta channel via Releases API: picks non-draft prerelease over older stable
  const betaApiRes = await checkStudioUpdate({
    currentVersion: '2.2.3',
    includePrerelease: true,
    forceRefresh: true,
    fetchFn: async (url) => {
      assert.ok(url.includes('/releases?per_page=10'));
      return {
        ok: true,
        status: 200,
        json: async () => [
          { tag_name: 'v2.2.5-alpha.1', draft: true, prerelease: true },
          { tag_name: 'v2.2.4-beta.1', draft: false, prerelease: true, name: 'v2.2.4-beta.1', html_url: 'https://github.com/eosglyph/agy-claude-studio/releases/tag/v2.2.4-beta.1' },
          { tag_name: 'v2.2.3', draft: false, prerelease: false },
        ],
      };
    },
  });
  assert.equal(betaApiRes.ok, true);
  assert.equal(betaApiRes.hasUpdate, true);
  assert.equal(betaApiRes.latestTag, 'v2.2.4-beta.1');
  assert.equal(betaApiRes.isPrerelease, true);
  assert.equal(betaApiRes.channel, 'beta');

  // Beta channel fallback to public HTML when API hits 403
  const betaHtmlRes = await checkStudioUpdate({
    currentVersion: '2.2.3',
    includePrerelease: true,
    forceRefresh: true,
    fetchFn: async (url) => {
      if (url.includes('api.github.com')) return { ok: false, status: 403, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        text: async () => '<a href="/eosglyph/agy-claude-studio/releases/tag/v2.2.4-beta.2">beta</a><a href="/eosglyph/agy-claude-studio/releases/tag/v2.2.3">stable</a>',
      };
    },
  });
  assert.equal(betaHtmlRes.ok, true);
  assert.equal(betaHtmlRes.hasUpdate, true);
  assert.equal(betaHtmlRes.latestTag, 'v2.2.4-beta.2');
  assert.equal(betaHtmlRes.isPrerelease, true);
  assert.equal(betaHtmlRes.source, 'releases-html');

  // Stable channel ignores prereleases and hits /releases/latest
  const stableRes = await checkStudioUpdate({
    currentVersion: '2.2.3',
    includePrerelease: false,
    forceRefresh: true,
    fetchFn: async (url) => {
      assert.ok(url.includes('/releases/latest'));
      return {
        ok: true,
        status: 200,
        json: async () => ({ tag_name: 'v2.2.3', html_url: 'https://github.com/eosglyph/agy-claude-studio/releases/tag/v2.2.3' }),
      };
    },
  });
  assert.equal(stableRes.ok, true);
  assert.equal(stableRes.hasUpdate, false);
  assert.equal(stableRes.isPrerelease, false);
  assert.equal(stableRes.channel, 'stable');

  const studioHtml = fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'studio', 'index.html'), 'utf8');
  assert.ok(studioHtml.includes('chk-receive-prerelease') && studioHtml.includes('接受测试版本推送'));
});

test('compactPreset continue mode and persistent /btw side-question restore & composer chip hint work end-to-end', async () => {
  // 1. Validate compactPreset 'continue' in config & Studio HTML
  assert.equal(cdp.validateConfigSetting('compactPreset', 'continue'), true);
  assert.equal(cdp.sanitizeConfig({ compactPreset: 'continue' }).compactPreset, 'continue');
  const studioHtml = fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'studio', 'index.html'), 'utf8');
  assert.ok(studioHtml.includes("['continue', '继续工作']"), 'Studio UI includes continue compact preset');
  assert.ok(studioHtml.includes('id="live-btw-block"') && studioHtml.includes('/api/side-question/open'), 'Studio UI includes persistent /btw dock block');

  // 2. Runtime sandbox test: /btw chip conversion + gray hint + Redux side-question listing & restore
  const timers = new Set();
  const dispatched = [];
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
      style: { _props: {}, setProperty(k, v) { this._props[k] = String(v); }, removeProperty(k) { delete this._props[k]; } },
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
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { c.parentElement = this; c.parentNode = this; children.push(c); return c; },
      insertBefore(c) { return this.appendChild(c); },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
          this.parentNode = null;
        }
      },
      focus() {},
      click() {
        if (typeof opts.onClick === 'function') opts.onClick();
        else if (this.parentElement && typeof this.parentElement.click === 'function') this.parentElement.click();
      },
      dispatchEvent() {},
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 10, top: 8, width: 60, height: 22, right: 70, bottom: 30 }),
      matches(sel) {
        return sel.split(',').some((s) => {
          const t = s.trim();
          if (t === '[role="option"]') return attrs.get('role') === 'option';
          return false;
        });
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (sel === '[data-testid="conversation-view"]' && cur.getAttribute('data-testid') === 'conversation-view') return cur;
          if (sel === '[data-testid="agent-input-box"]' && cur.getAttribute('data-testid') === 'agent-input-box') return cur;
          if (sel === '.surface-composer-card' && cur.classList.contains('surface-composer-card')) return cur;
          if (sel === '[data-cascade-id]' && cur.hasAttribute('data-cascade-id')) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const parts = sel.split(',').map((s) => s.trim());
        const walk = (n) => {
          for (const c of n.children) {
            const ok = parts.some((p) => {
              if (p === '*') return true;
              if (p === '[data-testid="agent-input-box"] .surface-composer-card') return c.classList.contains('surface-composer-card');
              if (p === '[data-testid="agent-input-box"]') return c.getAttribute('data-testid') === 'agent-input-box';
              if (p === '[data-testid="agent-input-box"] [contenteditable="true"]') return c.getAttribute('contenteditable') === 'true';
              if (p === '[contenteditable="true"]') return c.getAttribute('contenteditable') === 'true';
              if (p === '.ag-cs-compact-hint') return c.classList.contains('ag-cs-compact-hint');
              if (p === '[data-lexical-decorator="true"]') return c.getAttribute('data-lexical-decorator') === 'true';
              if (p === '[data-mention-menu] [role="option"]' || p === '[role="option"]') return c.getAttribute('role') === 'option';
              if (p === '[data-testid="menu-option-label"]') return c.getAttribute('data-testid') === 'menu-option-label';
              if (p === '[data-aux-pane-open]') return c.hasAttribute('data-aux-pane-open');
              if (p === '[data-testid="toggle-aux-sidebar"]') return c.getAttribute('data-testid') === 'toggle-aux-sidebar';
              return false;
            });
            if (ok) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  const convoId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const docEl = makeEl('html');
  const head = docEl.appendChild(makeEl('head'));
  const body = docEl.appendChild(makeEl('body', { className: 'theme-standalone' }));
  const root = body.appendChild(makeEl('div', { attrs: { id: 'root' } }));
  const conv = root.appendChild(makeEl('div', { attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': convoId } }));
  const inputBox = conv.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const card = inputBox.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const edWrap = card.appendChild(makeEl('div', { className: 'ed-wrap' }));
  const ed = edWrap.appendChild(makeEl('div', { attrs: { contenteditable: 'true' } }));
  const auxPane = root.appendChild(makeEl('div', { attrs: { 'data-aux-pane-open': 'false' } }));
  let auxToggleClicks = 0;
  auxPane.appendChild(makeEl('button', { attrs: { 'data-testid': 'toggle-aux-sidebar' }, onClick: () => { auxToggleClicks++; } }));

  const menu = body.appendChild(makeEl('div', { attrs: { 'data-mention-menu': '1' } }));
  let btwOptionClicks = 0;
  const btwOpt = menu.appendChild(makeEl('div', {
    attrs: { role: 'option' },
    onClick: () => {
      btwOptionClicks++;
      ed.textContent = '';
      ed.appendChild(makeEl('span', { attrs: { 'data-lexical-decorator': 'true' }, text: 'btw' }));
    },
  }));
  btwOpt.appendChild(makeEl('span', { attrs: { 'data-testid': 'menu-option-label' }, text: 'btw' }));

  const reduxState = {
    sideQuestion: {
      states: {
        [convoId]: {
          question: '这个配置怎么写？',
          cascadeId: 'fork-111',
          minimized: true,
          mode: 'btw',
          history: [{ question: '这个配置怎么写？', cascadeId: 'fork-111', startTimestamp: 1700000000, mode: 'btw' }],
          currentIndex: 0,
        },
      },
    },
    ephemeralFork: { forks: {} },
    sidePanelV2: {
      conversationPanes: {
        [convoId]: {
          tabs: [],
          closedTabs: [
            { tab: { id: 'side_question__fork-111', content: { type: 'sideQuestionView', sideQuestionView: { cascadeId: 'fork-111' } } } },
          ],
        },
      },
    },
  };
  root.__reactContainer$test = {
    current: {
      memoizedProps: {
        value: {
          store: {
            getState: () => reduxState,
            dispatch: (act) => dispatched.push(act),
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
    execCommand(cmd, _ui, val) {
      if (cmd === 'insertText') {
        ed.textContent = String(val || '');
        return true;
      }
      return true;
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const sandbox = {
    document: doc,
    location: { href: `https://127.0.0.1:2015/c/${convoId}`, protocol: 'https:', hostname: '127.0.0.1', pathname: `/c/${convoId}` },
    getComputedStyle: () => ({ getPropertyValue: () => '', paddingRight: '8px' }),
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
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl, RegExp,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'zh-CN', compactPreset: 'continue' }),
      sandbox
    );

    // A. Reads existing closed/minimized side question cleanly
    const sqSnap = sandbox.window.__agClaudeStudio.getSideQuestionsState(convoId);
    assert.equal(sqSnap.ok, true);
    assert.equal(sqSnap.items.length, 1);
    assert.equal(sqSnap.items[0].cascadeId, 'fork-111');
    assert.equal(sqSnap.items[0].question, '这个配置怎么写？');

    // B. Clicking existing entry dispatches restore + sidePanelV2/setContent and opens aux pane
    const openRes = sandbox.window.__agClaudeStudio.openSideQuestion({ conversationId: convoId, cascadeId: 'fork-111', index: 0 });
    assert.equal(openRes.ok, true);
    assert.equal(openRes.action, 'restored');
    assert.ok(dispatched.some((a) => a.type === 'sideQuestion/restoreSideQuestion' && a.payload === convoId));
    assert.ok(dispatched.some((a) => a.type === 'sidePanelV2/setContent' && a.payload?.content?.type === 'sideQuestionView'));
    assert.ok(dispatched.some((a) => a.type === 'sidePanelV2/setActiveTab' && a.payload?.tabId === 'side_question__fork-111'));
    assert.equal(auxToggleClicks, 1, 'Opens closed aux pane when restoring sideQuestionView tab');

    // C. Clicking forceNew inserts /btw, converts to chip, and shows gray ghost guide hint
    const newRes = sandbox.window.__agClaudeStudio.openSideQuestion({ conversationId: convoId, forceNew: true });
    assert.equal(newRes.ok, true);
    assert.equal(newRes.action, 'composer_btw');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(btwOptionClicks, 1, 'Auto-selects /btw menu option into native chip');
    const hint = edWrap.querySelector('.ag-cs-compact-hint');
    assert.ok(hint, 'Renders gray ghost hint next to standalone /btw chip');
    assert.equal(hint.getAttribute('data-ag-cs-hint-kind'), 'btw');
    assert.ok(hint.textContent.includes('不影响当前会话'), 'Hint explains /btw does not interrupt current chat');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});


test('getSideQuestionsState reads persisted annotations.sideQuestionCascadeIds/Titles and enriches untitled closed tabs', async () => {
  const timers = new Set();
  const convoId = '3e950d9e-f798-4da2-8b1c-9c2585d7abd4';
  const sqId = 'ff7d0c37-1eaa-4173-ba7b-d9414c30a210';
  const sqId2 = 'aa7d0c37-1eaa-4173-ba7b-d9414c30a299';

  const makeEl = (tag, { id = '', className = '', attrs = {} } = {}) => {
    const classes = new Set((className || '').split(/\s+/).filter(Boolean));
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      id,
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); for (const c of String(v || '').split(/\s+/).filter(Boolean)) classes.add(c); },
      attrs: new Map(Object.entries(attrs)),
      children: [],
      parentElement: null,
      textContent: '',
      innerHTML: '',
      style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} },
      classList: {
        add(...cs) { for (const c of cs) if (c) classes.add(c); },
        remove(...cs) { for (const c of cs) classes.delete(c); },
        toggle(c, force) { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); },
        contains: (c) => classes.has(c),
      },
      appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
      remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; },
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      setAttribute(k, v) { this.attrs.set(k, String(v)); },
      removeAttribute(k) { this.attrs.delete(k); },
      hasAttribute(k) { return this.attrs.has(k); },
      addEventListener() {},
      removeEventListener() {},
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    return el;
  };

  const docEl = makeEl('html');
  const head = docEl.appendChild(makeEl('head'));
  const body = docEl.appendChild(makeEl('body', { className: 'theme-standalone' }));
  const root = body.appendChild(makeEl('div', { id: 'root' }));
  root.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));

  const reduxState = {
    conversation: { convoState: { type: 'active', cascadeId: convoId } },
    sideQuestion: { states: {} },
    ephemeralFork: { forks: {} },
    sidePanelV2: {
      conversationPanes: {
        [convoId]: {
          tabs: [],
          closedTabs: [
            { tab: { id: `side_question__${sqId}`, content: { type: 'sideQuestionView', sideQuestionView: { cascadeId: sqId } } } },
          ],
        },
      },
    },
    trajectorySummaries: {
      summaries: {
        [convoId]: {
          summary: 'test',
          annotations: {
            sideQuestionCascadeIds: [sqId, sqId2],
            sideQuestionTitles: {
              [sqId]: 'Agy官方新模型特性讨论',
              [sqId2]: '正在跑的旁支研究',
            },
          },
        },
        [sqId]: { status: 1, stepCount: 120, lastModifiedTime: { seconds: '1795700000' } },
        [sqId2]: { status: 2, stepCount: 42, lastModifiedTime: { seconds: '1795705000' } },
      },
    },
  };
  root.__reactContainer$test = {
    current: {
      memoizedProps: {
        value: { store: { getState: () => reduxState, dispatch: () => {} } },
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
    querySelector: (sel) => (sel.includes('agent-input-box') ? root.children[0] : null),
    querySelectorAll: (sel) => (sel.includes('agent-input-box') ? [root.children[0]] : []),
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  const sandbox = {
    document: doc,
    location: { href: 'https://127.0.0.1:2015/', protocol: 'https:', hostname: '127.0.0.1', pathname: '/' },
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
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl, RegExp,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'zh-CN' }), sandbox);
    const snap = sandbox.window.__agClaudeStudio.getSideQuestionsState('');
    assert.equal(snap.conversationId, convoId, 'Resolves active conversation from Redux conversation.convoState.cascadeId');
    assert.equal(snap.items.length, 2, 'Includes both closed-tab and persisted-only side questions');
    assert.equal(snap.items[0].cascadeId, sqId2, 'Sorts running side question first');
    assert.equal(snap.items[0].isRunning, true);
    assert.equal(snap.items[0].question, '正在跑的旁支研究');
    assert.equal(snap.items[1].cascadeId, sqId);
    assert.equal(snap.items[1].question, 'Agy官方新模型特性讨论', 'Fills missing title from annotations.sideQuestionTitles');
    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('getLiveTasksApi counts running side-question sessions and merges persisted sideQuestions from trajectorySummaries', async () => {
  const { getLiveTasksApi } = await import('../sidecars/studio/main.mjs');
  const parentId = 'parent-convo-1';
  const runningSqId = 'sq-running-1';
  const closedSqId = 'sq-closed-2';

  const mockFetch = async (url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes('ListConversations')) {
      if (body.parentConversationId) {
        return { ok: true, status: 200, json: async () => ({ conversations: [] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          conversations: [
            {
              id: parentId,
              annotations: { title: 'Main Feature Work' },
              state: { runState: 'RUN_STATE_IDLE', updateTime: '2026-11-26T15:00:00Z' },
              metadata: { createTime: '2026-11-26T14:00:00Z' },
            },
          ],
        }),
      };
    }
    if (u.includes('GetAllCascadeTrajectories')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          trajectorySummaries: {
            [parentId]: {
              summary: 'Main Feature Work',
              status: 'CASCADE_RUN_STATUS_IDLE',
              stepCount: 50,
              annotations: {
                title: 'Main Feature Work',
                sideQuestionCascadeIds: [runningSqId, closedSqId],
                sideQuestionTitles: {
                  [runningSqId]: '旁支模型对比',
                  [closedSqId]: '历史旁支笔记',
                },
              },
            },
            [runningSqId]: {
              summary: '',
              status: 'CASCADE_RUN_STATUS_RUNNING',
              stepCount: 12,
              lastModifiedTime: '2026-11-26T15:10:00Z',
            },
            [closedSqId]: {
              summary: '',
              status: 'CASCADE_RUN_STATUS_IDLE',
              stepCount: 8,
              lastModifiedTime: '2026-11-26T14:10:00Z',
            },
          },
        }),
      };
    }
    if (u.includes('GetCascadeTrajectorySteps')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          steps: [{ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', status: 'CORTEX_STEP_STATUS_RUNNING', plannerResponse: { thinking: 'analyzing...' } }],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const res = await getLiveTasksApi({
    env: {
      ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:49998',
      ANTIGRAVITY_CSRF_TOKEN: 'lstok',
    },
    fetchFn: mockFetch,
    allowCdpFallback: false,
    conversationId: parentId,
  });

  assert.equal(res.ok, true);
  assert.equal(res.running.length, 1, 'Running side-question session is counted in running list');
  assert.equal(res.running[0].id, runningSqId);
  assert.equal(res.running[0].isSideQuestion, true);
  assert.equal(res.running[0].title, '旁支模型对比');
  assert.equal(res.running[0].parentConversationId, parentId);
  assert.equal(res.running[0].parentTitle, 'Main Feature Work');
  assert.equal(res.sideQuestions.length, 2, 'Both running and closed persisted side questions are returned');
  assert.equal(res.sideQuestions[0].cascadeId, runningSqId);
  assert.equal(res.sideQuestions[0].isRunning, true);
  assert.equal(res.sideQuestions[1].cascadeId, closedSqId);
  assert.equal(res.sideQuestions[1].question, '历史旁支笔记');
});

test('Environment git metadata detects worktree & normalizes remotes, and performEnvironmentActionApi enforces workspace boundary', async () => {
  const { normalizeGitRemoteToWebUrl, inspectWorkspaceGitMeta, performEnvironmentActionApi } = await import('../sidecars/studio/main.mjs');

  assert.deepEqual(normalizeGitRemoteToWebUrl('git@github.com:eosglyph/agy-claude-studio.git'), {
    url: 'https://github.com/eosglyph/agy-claude-studio',
    host: 'github.com',
    isGitHub: true,
  });
  assert.deepEqual(normalizeGitRemoteToWebUrl('https://gitlab.com/org/proj.git'), {
    url: 'https://gitlab.com/org/proj',
    host: 'gitlab.com',
    isGitHub: false,
  });
  assert.equal(normalizeGitRemoteToWebUrl('javascript:alert(1)').url, '');
  assert.equal(normalizeGitRemoteToWebUrl('file:///C:/Windows/win.ini').url, '');
  assert.equal(normalizeGitRemoteToWebUrl('https://github.com/a/b; calc.exe').url, '');

  const tmpRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-env-test-')));
  try {
    const commonGit = path.join(tmpRoot, 'main-repo', '.git');
    const wtGitDir = path.join(commonGit, 'worktrees', 'feat-demo');
    const wtDir = path.join(tmpRoot, 'wt-demo');
    const outsideDir = path.join(tmpRoot, 'outside');
    fs.mkdirSync(wtGitDir, { recursive: true });
    fs.mkdirSync(wtDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(commonGit, 'config'), '[remote "origin"]\n\turl = git@github.com:eosglyph/agy-claude-studio.git\n');
    fs.writeFileSync(path.join(wtGitDir, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(wtGitDir, 'HEAD'), 'ref: refs/heads/claude/adoring-han-edf0d3\n');
    fs.writeFileSync(path.join(wtDir, '.git'), `gitdir: ${wtGitDir}\n`);

    const meta = inspectWorkspaceGitMeta(wtDir);
    assert.equal(meta.isWorktree, true);
    assert.equal(meta.branch, 'claude/adoring-han-edf0d3');
    assert.equal(meta.repoWebUrl, 'https://github.com/eosglyph/agy-claude-studio');
    assert.equal(meta.isGitHub, true);

    const spawned = [];
    const fakeSpawn = (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      const handlers = new Map();
      const child = {
        once(ev, fn) { handlers.set(ev, fn); },
        unref() {},
      };
      setImmediate(() => {
        if (cmd === 'wt.exe') handlers.get('error')?.({ code: 'ENOENT' });
        else handlers.get('exit')?.(0);
      });
      return child;
    };

    const revealCalls = [];
    const revealViaHelper = await performEnvironmentActionApi(
      { action: 'reveal', path: wtDir },
      {
        allowedDirs: [wtDir],
        revealFn: async (opts) => {
          revealCalls.push(opts);
          return { ok: true, mode: 'reveal' };
        },
        platform: 'win32',
      }
    );
    assert.equal(revealViaHelper.ok, true);
    assert.equal(revealCalls.length, 1);
    assert.equal(revealCalls[0].mode, 'reveal');
    assert.ok(revealCalls[0].target.startsWith('file:///'), 'Passes file:/// URI to shared WindowsFileAction reveal helper');

    const revealOk = await performEnvironmentActionApi(
      { action: 'reveal', path: wtDir },
      { allowedDirs: [wtDir], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(revealOk.ok, true);
    assert.equal(spawned[0].cmd, 'explorer.exe');
    assert.deepEqual(spawned[0].args, [wtDir]);
    assert.equal(spawned[0].opts.shell, false);
    assert.equal(spawned[0].opts.windowsHide, false);

    const termOk = await performEnvironmentActionApi(
      { action: 'terminal', path: wtDir },
      { allowedDirs: [wtDir], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(termOk.ok, true);
    assert.equal(spawned[1].cmd, 'wt.exe');
    assert.equal(spawned[2].cmd, 'pwsh.exe');
    assert.equal(spawned[2].opts.cwd, wtDir);
    assert.equal(spawned[2].opts.shell, false);

    const repoOk = await performEnvironmentActionApi(
      { action: 'open-repo', url: 'https://github.com/eosglyph/agy-claude-studio' },
      { allowedUrls: ['https://github.com/eosglyph/agy-claude-studio'], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(repoOk.ok, true);

    const blockedDir = await performEnvironmentActionApi(
      { action: 'reveal', path: outsideDir },
      { allowedDirs: [wtDir], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(blockedDir.ok, false);
    assert.equal(blockedDir.error, 'path_not_allowed');

    const blockedUrl = await performEnvironmentActionApi(
      { action: 'open-repo', url: 'https://evil.example/repo' },
      { allowedUrls: ['https://github.com/eosglyph/agy-claude-studio'], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(blockedUrl.ok, false);
    assert.equal(blockedUrl.error, 'url_not_allowed');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Dock reacts to real MutationObserver attribute changes, guards narrow windows before clicking host, debounces pending host commits, and avoids steady-state rAF loops', async () => {
  const timers = new Set();
  const docListeners = new Map();
  let observerCb = null;

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
      clicks: 0,
      _rect: opts.rect || { left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900 },
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
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get textContent() { return children.length ? children.map((c) => c.textContent).join('') : this._text; },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      get firstElementChild() { return children[0] || null; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { c.parentElement = this; c.parentNode = this; children.push(c); return c; },
      append(...nodes) { for (const n of nodes) this.appendChild(n); },
      insertBefore(c, ref) {
        if (c.parentElement) {
          const old = c.parentElement.children.indexOf(c);
          if (old >= 0) c.parentElement.children.splice(old, 1);
        }
        c.parentElement = this;
        c.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, c);
        else children.push(c);
        return c;
      },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
          this.parentNode = null;
        }
      },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener(ev, fn) {
        const list = listeners.get(ev);
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      },
      click() {
        this.clicks += 1;
        for (const fn of [...(listeners.get('click') || [])]) fn({ target: this });
      },
      getBoundingClientRect() { return this._rect; },
      closest(sel) {
        const sels = sel.split(',').map((s) => s.trim());
        let cur = this;
        while (cur) {
          for (const s of sels) {
            if (s === '[data-testid="aux-pane-split"]' && cur.getAttribute('data-testid') === 'aux-pane-split') return cur;
            if (s === '[data-aux-pane-open]' && cur.hasAttribute('data-aux-pane-open')) return cur;
            if (s === '[data-side-panel-strip]' && cur.hasAttribute('data-side-panel-strip')) return cur;
            if (s === '[data-testid="sidecar-iframe-slot"]' && cur.getAttribute('data-testid') === 'sidecar-iframe-slot') return cur;
            if (s === '[data-tab-id]' && cur.hasAttribute('data-tab-id')) return cur;
          }
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const parts = sel.split(',').map((s) => s.trim());
        const walk = (n) => {
          for (const c of n.children) {
            const ok = parts.some((p) => {
              if (p === '[data-testid="conversation-view"]') return c.getAttribute('data-testid') === 'conversation-view';
              if (p === '[data-testid="aux-pane-split"]') return c.getAttribute('data-testid') === 'aux-pane-split';
              if (p === '[data-aux-pane-open]') return c.hasAttribute('data-aux-pane-open');
              if (p === '[data-side-panel-strip]') return c.hasAttribute('data-side-panel-strip');
              if (p === '[data-testid="toggle-aux-sidebar"]') return c.getAttribute('data-testid') === 'toggle-aux-sidebar';
              if (p === '[data-testid="side-panel-new-tab-button"]') return c.getAttribute('data-testid') === 'side-panel-new-tab-button';
              if (p === 'iframe[src*="agy-claude-studio--studio"]') return c.tagName === 'IFRAME' && (c.getAttribute('src') || '').includes('agy-claude-studio--studio');
              if (p === '[data-testid="sidecar-iframe-slot"]') return c.getAttribute('data-testid') === 'sidecar-iframe-slot';
              if (p === '.ag-cs-pinned-dock') return c.classList.contains('ag-cs-pinned-dock');
              if (p === '.ag-cs-dock-body') return c.classList.contains('ag-cs-dock-body');
              if (p === 'button') return c.tagName === 'BUTTON';
              return false;
            });
            if (ok) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  const html = makeEl('html');
  const head = html.appendChild(makeEl('head'));
  const body = html.appendChild(makeEl('body', { className: 'theme-dark' }));
  const convo = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'conversation-view' } }));
  const split = convo.appendChild(makeEl('div', {
    attrs: { 'data-testid': 'aux-pane-split' },
    rect: { left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900 },
  }));
  split.appendChild(makeEl('div', { className: 'chat-col' }));
  split.appendChild(makeEl('div', { className: 'native-splitter' }));
  const auxPane = split.appendChild(makeEl('div', { attrs: { 'data-aux-pane-open': 'true' } }));
  const strip = auxPane.appendChild(makeEl('div', { attrs: { 'data-side-panel-strip': '1', 'data-active-tab-id': 'browser__1' } }));
  const browserBtn = strip.appendChild(makeEl('button', { attrs: { 'data-tab-id': 'browser__1' }, text: 'Browser' }));
  strip.appendChild(makeEl('button', { attrs: { 'data-tab-id': 'sidecar__agy-claude-studio/studio__/' }, text: 'Claude Studio' }));
  const newTabBtn = strip.appendChild(makeEl('button', { attrs: { 'data-testid': 'side-panel-new-tab-button' } }));
  const toggleAuxBtn = body.appendChild(makeEl('button', { attrs: { 'data-testid': 'toggle-aux-sidebar' } }));
  const overlay = body.appendChild(makeEl('div', { rect: { left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900 } }));
  const studioSlot = overlay.appendChild(makeEl('div', { attrs: { 'data-testid': 'sidecar-iframe-slot' } }));
  studioSlot.appendChild(makeEl('iframe', { attrs: { src: 'plugin://agy-claude-studio--studio/' } }));

  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    createElement: (t) => makeEl(t, { rect: { left: 450, top: 40, width: 310, height: 860, right: 760, bottom: 900 } }),
    getElementById: (id) => html.querySelectorAll('*').find((e) => e.getAttribute('id') === id) || null,
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener(ev, fn) {
      const list = docListeners.get(ev);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };

  let rafCalls = 0;
  const sandbox = {
    document: doc,
    location: { href: 'https://127.0.0.1:2015/c/44444444-4444-4444-8444-444444444444', protocol: 'https:', hostname: '127.0.0.1', pathname: '/c/44444444-4444-4444-8444-444444444444' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class {
      constructor(cb) { observerCb = cb; }
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => {
      rafCalls += 1;
      const id = setTimeout(() => fn(Date.now()), 5);
      timers.add(id);
      return id;
    },
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
    vm.runInNewContext(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' }), sandbox);
    assert.ok(split.querySelector('.ag-cs-pinned-dock'), 'Dock mounted initially');
    await new Promise((r) => setTimeout(r, 270));

    // P2-1: Steady-state refreshConfig must NOT start a new 240ms rAF tracking loop (at most 1 rAF for scheduleSync itself)
    const rafBeforeSteady = rafCalls;
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(rafCalls - rafBeforeSteady <= 1, `Steady-state sync must not run 240ms rAF loop (got ${rafCalls - rafBeforeSteady} rAFs)`);

    // P1-5: Pure attribute mutation on data-active-tab-id / data-aux-pane-open wakes Dock sync via MutationObserver
    strip.setAttribute('data-active-tab-id', 'sidecar__agy-claude-studio/studio__/');
    observerCb([{ type: 'attributes', target: strip, attributeName: 'data-active-tab-id' }]);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(browserBtn.clicks, 1, 'Attribute mutation triggered Dock sync to bounce back to browser tab');

    // P1-4 (delayed commit): While React has not committed data-active-tab-id yet, a second sync must NOT re-click browserBtn
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(browserBtn.clicks, 1, 'Pending host action prevents duplicate click before React commits');

    // React commits one frame later
    strip.setAttribute('data-active-tab-id', 'browser__1');
    observerCb([{ type: 'attributes', target: strip, attributeName: 'data-active-tab-id' }]);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(split.hasAttribute('data-ag-cs-dock-solo'), false);

    // P2: Mixed MutationObserver batch (Dock attr + childList) schedules only one sync (no duplicate scheduleDockSync + scheduleSync)
    const rafBeforeMixed = rafCalls;
    observerCb([
      { type: 'attributes', target: strip, attributeName: 'data-active-tab-id' },
      { type: 'childList', target: body, addedNodes: [], removedNodes: [] },
    ]);
    assert.equal(rafCalls - rafBeforeMixed, 1, 'Mixed MutationObserver batch must schedule only 1 rAF (full sync covers Dock)');
    await new Promise((r) => setTimeout(r, 25));

    // P1-4 (narrow window): Width below 900px in 3-column mode must tear down Dock WITHOUT clicking host buttons
    const clicksBeforeNarrow = {
      browser: browserBtn.clicks,
      toggle: toggleAuxBtn.clicks,
      newTab: newTabBtn.clicks,
    };
    split._rect = { left: 0, top: 0, width: 820, height: 900, right: 820, bottom: 900 };
    strip.setAttribute('data-active-tab-id', 'sidecar__agy-claude-studio/studio__/');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(split.querySelector('.ag-cs-pinned-dock'), null, 'Narrow 3-column window tears down Dock');
    assert.equal(browserBtn.clicks, clicksBeforeNarrow.browser, 'Must not click otherTabBtn on narrow window');
    assert.equal(toggleAuxBtn.clicks, clicksBeforeNarrow.toggle, 'Must not click toggleAuxBtn on narrow window');
    assert.equal(newTabBtn.clicks, clicksBeforeNarrow.newTab, 'Must not click newTabBtn on narrow window');

    // P2: Pending close_aux at 820px keeps target solo mode (560px threshold) until host commits or times out
    auxPane.setAttribute('data-aux-pane-open', 'false');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.ok(split.querySelector('.ag-cs-pinned-dock'), 'Solo mode mounts cleanly at 820px');
    const toggleBeforePendingClose = toggleAuxBtn.clicks;
    const browserBeforePendingClose = browserBtn.clicks;
    auxPane.setAttribute('data-aux-pane-open', 'true');
    strip.setAttribute('data-active-tab-id', 'sidecar__agy-claude-studio/studio__/');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.equal(toggleAuxBtn.clicks, toggleBeforePendingClose + 1, 'Round 1 requests close_aux');
    assert.ok(split.querySelector('.ag-cs-pinned-dock'), 'Dock stays mounted while close_aux is pending');
    // Round 2 before host commits data-aux-pane-open="false" must keep solo 560px threshold and NOT teardown at 900px
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.ok(split.querySelector('.ag-cs-pinned-dock'), 'Dock must not teardown prematurely at 820px while close_aux is pending');
    assert.equal(browserBtn.clicks, browserBeforePendingClose, 'Pending close_aux must not switch to browser tab');
    auxPane.setAttribute('data-aux-pane-open', 'false');
    sandbox.window.__agClaudeStudio.refreshConfig({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio' });
    assert.ok(split.querySelector('.ag-cs-pinned-dock'), 'Dock remains mounted in solo mode after host commits close_aux');

    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('/btw draft protection preserves non-empty drafts, handles restore errors without overwriting, and cancels delayed restore timers on destroy/switch', async () => {
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
      clicks: 0,
      focusCount: 0,
      _text: opts.text || '',
      style: { _props: {}, setProperty(k, v) { this._props[k] = String(v); }, getPropertyValue(k) { return this._props[k] || ''; }, removeProperty(k) { delete this._props[k]; } },
      classList: {
        add(...cs) { cs.forEach((c) => classes.add(c)); },
        remove(...cs) { cs.forEach((c) => classes.delete(c)); },
        contains(c) { return classes.has(c); },
        toggle(c, f) { if (f === undefined ? !classes.has(c) : f) classes.add(c); else classes.delete(c); },
      },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get textContent() { return children.length ? children.map((c) => c.textContent).join('') : this._text; },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { c.parentElement = this; c.parentNode = this; children.push(c); return c; },
      append(...nodes) { for (const n of nodes) this.appendChild(n); },
      insertBefore(c) { return this.appendChild(c); },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
          this.parentNode = null;
        }
      },
      focus() { this.focusCount += 1; },
      click() { this.clicks += 1; },
      dispatchEvent() {},
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 10, top: 8, width: 60, height: 22, right: 70, bottom: 30 }),
      closest(sel) {
        const sels = sel.split(',').map((s) => s.trim());
        let cur = this;
        while (cur) {
          for (const s of sels) {
            if (s === '[data-testid="conversation-view"]' && cur.getAttribute('data-testid') === 'conversation-view') return cur;
            if (s === '[data-testid="agent-input-box"]' && cur.getAttribute('data-testid') === 'agent-input-box') return cur;
            if (s === '.surface-composer-card' && cur.classList.contains('surface-composer-card')) return cur;
            if (s === '[data-cascade-id]' && cur.hasAttribute('data-cascade-id')) return cur;
          }
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const parts = sel.split(',').map((s) => s.trim());
        const walk = (n) => {
          for (const c of n.children) {
            const ok = parts.some((p) => {
              if (p === '*') return true;
              if (p === '[data-testid="agent-input-box"] .surface-composer-card') return c.classList.contains('surface-composer-card');
              if (p === '[data-testid="agent-input-box"]') return c.getAttribute('data-testid') === 'agent-input-box';
              if (p === '.surface-composer-card') return c.classList.contains('surface-composer-card');
              if (p === '[contenteditable="true"]') return c.getAttribute('contenteditable') === 'true';
              if (p === '[data-side-panel-strip]') return c.hasAttribute('data-side-panel-strip');
              if (p === '[data-aux-pane-open="true"]') return c.getAttribute('data-aux-pane-open') === 'true';
              if (p === '[data-testid="agent-input-box"] [contenteditable="true"]') {
                return c.getAttribute('contenteditable') === 'true' && Boolean(c.closest('[data-testid="agent-input-box"]'));
              }
              if (p === 'button') return c.tagName === 'BUTTON';
              return false;
            });
            if (ok) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  let shouldThrowOnDispatch = false;
  let activeCid = '11111111-1111-4111-8111-111111111111';
  const store = {
    getState: () => ({
      conversation: { convoState: { cascadeId: activeCid } },
      sideQuestion: {
        states: {
          '11111111-1111-4111-8111-111111111111': {
            minimized: false,
            history: [{ cascadeId: 'sq-1', question: 'Why?' }],
          },
        },
      },
      sidePanelV2: { panes: {} },
    }),
    dispatch: () => {
      if (shouldThrowOnDispatch) throw new Error('host dispatch failed');
    },
  };

  const html = makeEl('html');
  const head = html.appendChild(makeEl('head'));
  const body = html.appendChild(makeEl('body', { className: 'theme-dark' }));
  const root = body.appendChild(makeEl('div', { attrs: { id: 'root' } }));
  root.__reactContainer$test = { current: { memoizedProps: { value: { store } } } };

  const convo1 = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': '11111111-1111-4111-8111-111111111111' } }));
  const box1 = convo1.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box', 'data-cascade-id': '11111111-1111-4111-8111-111111111111' } }));
  const card1 = box1.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const ed1 = card1.appendChild(makeEl('div', { attrs: { contenteditable: 'true' }, text: 'unsent user draft' }));

  const convo2 = body.appendChild(makeEl('div', { attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': '22222222-2222-4222-8222-222222222222' } }));
  const box2 = convo2.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box', 'data-cascade-id': '22222222-2222-4222-8222-222222222222' } }));
  const card2 = box2.appendChild(makeEl('div', { className: 'surface-composer-card' }));
  const ed2 = card2.appendChild(makeEl('div', { attrs: { contenteditable: 'true' }, text: '' }));

  const sidePane = body.appendChild(makeEl('div', { attrs: { 'data-aux-pane-open': 'true' } }));
  const strip = sidePane.appendChild(makeEl('div', { attrs: { 'data-side-panel-strip': '1', 'data-active-tab-id': 'browser__1' } }));
  const sqTabBtn = strip.appendChild(makeEl('button', { attrs: { 'data-tab-id': 'side_question__sq-1' } }));
  const sqBox = sidePane.appendChild(makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } }));
  const sqEditor = sqBox.appendChild(makeEl('div', { attrs: { contenteditable: 'true' } }));

  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t ?? '') }),
    getElementById: (id) => html.querySelectorAll('*').find((e) => e.getAttribute('id') === id) || null,
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };

  const sandbox = {
    document: doc,
    location: { href: 'https://127.0.0.1:2015/', protocol: 'https:', hostname: '127.0.0.1', pathname: '/' },
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
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(cdp.buildInjectExpression(cdp.DEFAULT_CONFIG), sandbox);

    // 1. Non-empty draft in convo1 is preserved
    const draftRes = sandbox.window.__agClaudeStudio.fillBtwCommand({ conversationId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(draftRes.ok, false);
    assert.equal(draftRes.reason, 'draft_present');
    assert.equal(ed1.textContent, 'unsent user draft', 'Draft text must never be overwritten');

    const forceNewRes = sandbox.window.__agClaudeStudio.openSideQuestion({ forceNew: true, conversationId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(forceNewRes.ok, false);
    assert.equal(forceNewRes.action, 'draft_present');
    assert.equal(ed1.textContent, 'unsent user draft');

    // 2. Empty composer in convo2 is targeted cleanly without touching convo1
    const c2Res = sandbox.window.__agClaudeStudio.fillBtwCommand({ conversationId: '22222222-2222-4222-8222-222222222222' });
    assert.equal(c2Res.ok, true);
    assert.equal(ed2.textContent, '/btw');
    assert.equal(ed1.textContent, 'unsent user draft');

    // 2b. Non-existent explicit conversationId must NOT fall back to first composer
    ed2.textContent = '';
    const missingRes = sandbox.window.__agClaudeStudio.fillBtwCommand({ conversationId: '99999999-9999-4999-8999-999999999999' });
    assert.equal(missingRes.ok, false);
    assert.equal(missingRes.reason, 'conversation_not_found');
    assert.equal(ed1.textContent, 'unsent user draft', 'Missing conversationId must not touch convo1');
    assert.equal(ed2.textContent, '', 'Missing conversationId must not fall back to empty convo2');

    const missingForceNew = sandbox.window.__agClaudeStudio.openSideQuestion({ forceNew: true, conversationId: '99999999-9999-4999-8999-999999999999' });
    assert.equal(missingForceNew.ok, false);
    assert.equal(missingForceNew.action, 'conversation_not_found');
    assert.equal(ed2.textContent, '');

    // 3. Restore error returns explicit restore_failed and never overwrites draft
    shouldThrowOnDispatch = true;
    const errRes = sandbox.window.__agClaudeStudio.openSideQuestion({ conversationId: '11111111-1111-4111-8111-111111111111', cascadeId: 'sq-1' });
    assert.equal(errRes.ok, false);
    assert.equal(errRes.action, 'restore_failed');
    assert.equal(ed1.textContent, 'unsent user draft', 'Restore error must not overwrite user draft');

    // 3b. User switching to another sidebar tab within 40ms cancels delayed restore retries and never steals focus
    shouldThrowOnDispatch = false;
    strip.setAttribute('data-active-tab-id', 'side_question__sq-1');
    const switchTestRes = sandbox.window.__agClaudeStudio.openSideQuestion({ conversationId: '11111111-1111-4111-8111-111111111111', cascadeId: 'sq-1' });
    assert.equal(switchTestRes.ok, true);
    const clicksBeforeUserSwitch = sqTabBtn.clicks;
    const focusBeforeUserSwitch = sqEditor.focusCount;
    // Simulate user switching to browser tab within 10ms
    await new Promise((r) => setTimeout(r, 10));
    strip.setAttribute('data-active-tab-id', 'browser__1');
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(sqTabBtn.clicks, clicksBeforeUserSwitch, 'Delayed restore retry must not click back to old /btw tab after user switched');
    assert.equal(sqEditor.focusCount, focusBeforeUserSwitch, 'Delayed restore retry must not steal focus after user switched');

    // 4. Destroy cancels pending 40-140ms restore timers so they do not click tabs or steal focus
    shouldThrowOnDispatch = false;
    const okRes = sandbox.window.__agClaudeStudio.openSideQuestion({ conversationId: '11111111-1111-4111-8111-111111111111', cascadeId: 'sq-1' });
    assert.equal(okRes.ok, true);
    const clicksAtRestore = sqTabBtn.clicks;
    const focusAtRestore = sqEditor.focusCount;
    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(sqTabBtn.clicks, clicksAtRestore, 'Destroyed runtime must not fire delayed tab click');
    assert.equal(sqEditor.focusCount, focusAtRestore, 'Destroyed runtime must not steal focus after unmount');
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});

test('Environment container worktree detection discovers .repo & worktree/* layouts, selects active branch, and scopes actions safely', async () => {
  const { inspectWorkspaceGitMeta, performEnvironmentActionApi } = await import('../sidecars/studio/main.mjs');

  const tmpRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-env-container-')));
  try {
    const containerRoot = path.join(tmpRoot, 'project-container');
    const repoGit = path.join(containerRoot, '.repo', '.git');
    const wtMainGit = path.join(repoGit, 'worktrees', 'main');
    const wtDevGit = path.join(repoGit, 'worktrees', 'dev');
    const wtOutsideGit = path.join(repoGit, 'worktrees', 'escaped');
    const wtMainDir = path.join(containerRoot, 'worktree', 'main');
    const wtDevDir = path.join(containerRoot, 'worktree', 'dev');
    const notesDir = path.join(containerRoot, 'notes');
    const outsideWtDir = path.join(tmpRoot, 'outside-wt');

    for (const d of [wtMainGit, wtDevGit, wtOutsideGit, wtMainDir, wtDevDir, notesDir, outsideWtDir]) {
      fs.mkdirSync(d, { recursive: true });
    }

    fs.writeFileSync(path.join(repoGit, 'config'), '[remote "origin"]\n\turl = git@github.com:eosglyph/agy-claude-studio.git\n');

    fs.writeFileSync(path.join(wtMainGit, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(wtMainGit, 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(wtMainGit, 'gitdir'), `${path.join(wtMainDir, '.git')}\n`);
    fs.writeFileSync(path.join(wtMainGit, 'index'), 'idx-main');
    fs.writeFileSync(path.join(wtMainDir, '.git'), `gitdir: ${wtMainGit}\n`);

    fs.writeFileSync(path.join(wtDevGit, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(wtDevGit, 'HEAD'), 'ref: refs/heads/dev\n');
    fs.writeFileSync(path.join(wtDevGit, 'gitdir'), `${path.join(wtDevDir, '.git')}\n`);
    fs.writeFileSync(path.join(wtDevGit, 'index'), 'idx-dev');
    fs.writeFileSync(path.join(wtDevDir, '.git'), `gitdir: ${wtDevGit}\n`);

    // External worktree registered in .repo/.git/worktrees but physically outside containerRoot
    fs.writeFileSync(path.join(wtOutsideGit, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(wtOutsideGit, 'HEAD'), 'ref: refs/heads/feat/outside\n');
    fs.writeFileSync(path.join(wtOutsideGit, 'gitdir'), `${path.join(outsideWtDir, '.git')}\n`);
    fs.writeFileSync(path.join(outsideWtDir, '.git'), `gitdir: ${wtOutsideGit}\n`);

    // Make dev clearly newer than main
    const older = new Date('2026-11-27T09:00:00Z');
    const newer = new Date('2026-11-27T11:00:00Z');
    fs.utimesSync(path.join(wtMainGit, 'HEAD'), older, older);
    fs.utimesSync(path.join(wtMainGit, 'index'), older, older);
    fs.utimesSync(path.join(wtDevGit, 'HEAD'), newer, newer);
    fs.utimesSync(path.join(wtDevGit, 'index'), newer, newer);

    // Stale wsMeta says "main", container inspection must override with active worktree "dev"
    const meta = inspectWorkspaceGitMeta(containerRoot, { branchName: 'main' });
    assert.equal(meta.isWorktree, true);
    assert.equal(meta.branch, 'dev');
    assert.equal(meta.worktreeName, 'dev');
    assert.equal(fs.realpathSync.native(meta.worktreePath), fs.realpathSync.native(wtDevDir));
    assert.equal(meta.repoWebUrl, 'https://github.com/eosglyph/agy-claude-studio');
    assert.equal(meta.isGitHub, true);
    assert.equal(meta.worktrees.length, 2, 'Deduplicates .repo and worktree/* entries and excludes outside worktrees');
    assert.equal(meta.worktrees[0].branch, 'dev');
    assert.equal(meta.worktrees[0].active, true);
    assert.equal(meta.worktrees[0].relPath, 'worktree/dev');
    assert.equal(meta.worktrees[1].branch, 'main');
    assert.equal(meta.worktrees[1].active, false);

    // Equal timestamps tie-break: feature branch > dev > main
    const wtFeatGit = path.join(repoGit, 'worktrees', 'feat-ui');
    const wtFeatDir = path.join(containerRoot, 'worktrees', 'feat-ui');
    fs.mkdirSync(wtFeatGit, { recursive: true });
    fs.mkdirSync(wtFeatDir, { recursive: true });
    fs.writeFileSync(path.join(wtFeatGit, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(wtFeatGit, 'HEAD'), 'ref: refs/heads/feat/branch-tooltip\n');
    fs.writeFileSync(path.join(wtFeatDir, '.git'), `gitdir: ${wtFeatGit}\n`);
    for (const g of [wtMainGit, wtDevGit, wtFeatGit]) {
      fs.utimesSync(path.join(g, 'HEAD'), newer, newer);
      if (fs.existsSync(path.join(g, 'index'))) fs.utimesSync(path.join(g, 'index'), newer, newer);
    }
    const metaTie = inspectWorkspaceGitMeta(containerRoot);
    assert.equal(metaTie.branch, 'feat/branch-tooltip');
    assert.equal(metaTie.worktrees.length, 3);
    assert.equal(metaTie.worktrees[0].relPath, 'worktrees/feat-ui');

    // performEnvironmentActionApi permits child worktrees inside containerRoot, blocks arbitrary subdirs & external worktrees
    const spawned = [];
    const fakeSpawn = (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      const handlers = new Map();
      const child = {
        once(ev, fn) { handlers.set(ev, fn); },
        unref() {},
      };
      setImmediate(() => handlers.get('exit')?.(0));
      return child;
    };

    const childWtTerm = await performEnvironmentActionApi(
      { action: 'terminal', path: wtDevDir },
      { allowedDirs: [containerRoot], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(childWtTerm.ok, true);
    assert.equal(fs.realpathSync.native(spawned[0].opts.cwd), fs.realpathSync.native(wtDevDir));

    const blockedNotes = await performEnvironmentActionApi(
      { action: 'reveal', path: notesDir },
      { allowedDirs: [containerRoot], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(blockedNotes.ok, false);
    assert.equal(blockedNotes.error, 'path_not_allowed');

    const blockedOutside = await performEnvironmentActionApi(
      { action: 'reveal', path: outsideWtDir },
      { allowedDirs: [containerRoot], spawnFn: fakeSpawn, platform: 'win32' }
    );
    assert.equal(blockedOutside.ok, false);
    assert.equal(blockedOutside.error, 'path_not_allowed');

    // Verify Studio HTML dark branch tooltip markup and inline script syntax
    const html = fs.readFileSync(new URL('../sidecars/studio/index.html', import.meta.url), 'utf8');
    assert.match(html, /id="cd-env-branch-tooltip"/);
    assert.match(html, /function showBranchTooltip\(/);
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch && scriptMatch[1], 'Studio HTML contains inline script');
    new vm.Script(scriptMatch[1]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Sticky dock selects active conversation Studio iframe, syncs active conversation via postMessage, and replaces existing slash tokens cleanly', async () => {
  const cdp = require('../src/cdp.js');
  const timers = new Set();

  function makeEl(tag, attrs = {}) {
    const attrMap = new Map(Object.entries(attrs));
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const listeners = new Map();
    const styleProps = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      parentElement: null,
      children: [],
      isConnected: true,
      _text: '',
      _rect: { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 },
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        contains: (c) => classes.has(c),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : f ? classes.add(c) : classes.delete(c)),
      },
      style: {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
        removeProperty(k) { styleProps.delete(k); },
      },
      get textContent() {
        if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
        return this._text;
      },
      set textContent(v) {
        this._text = String(v ?? '');
        this.children = [];
      },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); },
      get src() { return attrMap.get('src') || ''; },
      set src(v) { attrMap.set('src', String(v)); },
      getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
      setAttribute(k, v) { attrMap.set(k, String(v)); if (k === 'class') this.className = v; },
      removeAttribute(k) { attrMap.delete(k); },
      hasAttribute(k) { return attrMap.has(k); },
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
      append(...nodes) { nodes.forEach((n) => this.appendChild(n)); },
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter((x) => x !== this);
          this.parentElement = null;
        }
        this.isConnected = false;
      },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener() {},
      dispatchEvent() { return true; },
      focus() {},
      getBoundingClientRect() { return this._rect; },
      matches(sel) {
        for (const part of sel.split(',').map((s) => s.trim())) {
          if (part === '[data-testid="agent-input-box"] .surface-composer-card' && classes.has('surface-composer-card') && this.closest('[data-testid="agent-input-box"]')) return true;
          if (part === '[data-testid="agent-input-box"] [contenteditable="true"]' && this.getAttribute('contenteditable') === 'true' && this.closest('[data-testid="agent-input-box"]')) return true;
          if (part === '[data-testid="conversation-view"]' && this.getAttribute('data-testid') === 'conversation-view') return true;
          if (part === '[data-testid="agent-input-box"]' && this.getAttribute('data-testid') === 'agent-input-box') return true;
          if (part === '.surface-composer-card' && classes.has('surface-composer-card')) return true;
          if (part === '[contenteditable="true"]' && this.getAttribute('contenteditable') === 'true') return true;
          if (part === '[data-testid="sidecar-iframe-slot"]' && this.getAttribute('data-testid') === 'sidecar-iframe-slot') return true;
          if (part === '[data-testid="aux-pane-split"]' && this.getAttribute('data-testid') === 'aux-pane-split') return true;
          if (part === '[data-aux-pane-open]' && this.hasAttribute('data-aux-pane-open')) return true;
          if (part === '[data-side-panel-strip]' && this.hasAttribute('data-side-panel-strip')) return true;
          if (part === '[data-lexical-decorator]' && this.hasAttribute('data-lexical-decorator')) return true;
          if (part === '[data-lexical-decorator="true"]' && this.getAttribute('data-lexical-decorator') === 'true') return true;
          if (part === '[data-chip]' && this.hasAttribute('data-chip')) return true;
          if (part === 'iframe[src*="agy-claude-studio--studio"]' && this.tagName === 'IFRAME' && this.src.includes('agy-claude-studio--studio')) return true;
        }
        return false;
      },
      closest(sel) {
        for (let cur = this; cur; cur = cur.parentElement) {
          if (cur.matches(sel)) return cur;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const ch of n.children) {
            if (ch.matches(sel)) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    };
    return el;
  }

  const cid1 = '11111111-1111-4111-8111-111111111111';
  const cid2 = '22222222-2222-4222-8222-222222222222';
  const cid3 = '33333333-3333-4333-8333-333333333333';

  const body = makeEl('body');
  const head = makeEl('head');
  const docEl = makeEl('html');
  docEl.append(head, body);

  const split = makeEl('div', { 'data-testid': 'aux-pane-split' });
  split._rect = { left: 0, top: 0, right: 1400, bottom: 900, width: 1400, height: 900 };
  const auxPane = makeEl('div', { 'data-aux-pane-open': 'false' });
  const strip = makeEl('div', { 'data-side-panel-strip': '', 'data-active-tab-id': '' });
  const cv = makeEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': cid2 });
  const box = makeEl('div', { 'data-testid': 'agent-input-box' });
  const card = makeEl('div', { class: 'surface-composer-card' });
  const ed = makeEl('div', { contenteditable: 'true' });

  // Simulate Lexical editor with an existing /compact chip + preset text
  let lexChildren = [
    { type: 'beautifulMention', trigger: '/', value: 'compact' },
    { type: 'text', text: ' drop finished noise' },
  ];
  let lexClearCount = 0;
  let lexStickyClears = 0;
  const stickyCmd = { type: 'CLEAR_DISMISSED_STICKY_MENTION_COMMAND' };
  const lexRoot = {
    clear() {
      lexClearCount += 1;
      lexChildren = [];
      ed.textContent = '';
    },
    select() {},
  };
  const nodeMap = new Map([['root', lexRoot]]);
  ed.__lexicalEditor = {
    _commands: new Map([[stickyCmd, [new Set()]]]),
    _editorState: { _nodeMap: nodeMap },
    _pendingEditorState: { _nodeMap: nodeMap },
    getEditorState() {
      return {
        toJSON: () => ({
          root: { children: lexChildren.length ? [{ type: 'paragraph', children: lexChildren }] : [] },
        }),
      };
    },
    dispatchCommand(cmd) {
      if (cmd === stickyCmd) lexStickyClears += 1;
      return true;
    },
    update(fn) { fn(); },
  };
  const compactChipEl = makeEl('span', { 'data-lexical-decorator': 'true' });
  compactChipEl.textContent = 'compact';
  const presetTextEl = makeEl('span');
  presetTextEl.textContent = ' drop finished noise';
  ed.append(compactChipEl, presetTextEl);

  card.appendChild(ed);
  box.appendChild(card);
  cv.appendChild(box);
  split.append(cv, auxPane, strip);

  // Two Studio sidecar slots in DOM: convo1 cached first, convo2 second
  const overlay = makeEl('div');
  overlay._rect = { left: 0, top: 0, right: 1400, bottom: 900, width: 1400, height: 900 };
  const postedMsgs = { iframe1: [], iframe2: [] };
  const slot1 = makeEl('div', {
    'data-testid': 'sidecar-iframe-slot',
    'data-sidecar-id': 'agy-claude-studio/studio',
    'data-sidecar-url': `plugin://agy-claude-studio--studio-4332/?token=t&conversationId=${cid1}`,
    'data-visible': 'false',
  });
  const iframe1 = makeEl('iframe', {
    src: `plugin://agy-claude-studio--studio-4332/?token=t&conversationId=${cid1}`,
  });
  iframe1.contentWindow = { postMessage(msg) { postedMsgs.iframe1.push(msg); } };
  slot1.appendChild(iframe1);

  const slot2 = makeEl('div', {
    'data-testid': 'sidecar-iframe-slot',
    'data-sidecar-id': 'agy-claude-studio/studio',
    'data-sidecar-url': `plugin://agy-claude-studio--studio-4332/?token=t&conversationId=${cid2}`,
    'data-visible': 'false',
  });
  const iframe2 = makeEl('iframe', {
    src: `plugin://agy-claude-studio--studio-4332/?token=t&conversationId=${cid2}`,
  });
  iframe2.contentWindow = { postMessage(msg) { postedMsgs.iframe2.push(msg); } };
  slot2.appendChild(iframe2);
  overlay.append(slot1, slot2);
  body.append(split, overlay);

  const doc = {
    documentElement: docEl,
    head,
    body,
    createElement: (t) => {
      const n = makeEl(t);
      n._rect = { left: 1080, top: 70, right: 1390, bottom: 880, width: 310, height: 810 };
      return n;
    },
    querySelector: (sel) => docEl.querySelector(sel),
    querySelectorAll: (sel) => docEl.querySelectorAll(sel),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    execCommand(cmd, _ui, val) {
      if (cmd === 'insertText') {
        ed.textContent = String(val || '');
        return true;
      }
      return true;
    },
  };

  const sandbox = {
    document: doc,
    location: { href: `https://127.0.0.1:2015/c/${cid2}`, protocol: 'https:', hostname: '127.0.0.1', pathname: `/c/${cid2}` },
    URL,
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
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl,
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio', mascot: false }), sandbox);
    await new Promise((r) => setTimeout(r, 40));

    // 1. Sticky dock must pin convo2's slot (not cached convo1's slot)
    assert.equal(slot2.getAttribute('data-ag-cs-docked-slot'), '1', 'Active conversation2 Studio slot must be docked');
    assert.equal(slot1.getAttribute('data-ag-cs-docked-slot'), null, 'Cached conversation1 Studio slot must NOT be docked');

    // 2. Switching to convo3 (which has no dedicated iframe yet) notifies fallback iframe via postMessage
    cv.setAttribute('data-cascade-id', cid3);
    sandbox.location.pathname = `/c/${cid3}`;
    sandbox.window.__agClaudeStudio.syncNow?.();
    await new Promise((r) => setTimeout(r, 40));
    const allPosted = [...postedMsgs.iframe1, ...postedMsgs.iframe2];
    assert.ok(
      allPosted.some((m) => m?.type === 'ag-cs:active-conversation' && m.conversationId === cid3),
      'Fallback docked iframe must be notified of active conversation change via postMessage'
    );

    // 3. Replacing an existing /compact slash token with /btw clears Lexical cleanly and writes /btw
    cv.setAttribute('data-cascade-id', cid2);
    sandbox.location.pathname = `/c/${cid2}`;
    const replaceCompactRes = sandbox.window.__agClaudeStudio.fillBtwCommand({ conversationId: cid2 });
    assert.equal(replaceCompactRes.ok, true, 'fillBtwCommand must replace existing /compact slash token');
    assert.ok(lexClearCount >= 1, 'Lexical root.clear() must be invoked to remove existing slash decorator');
    assert.ok(lexStickyClears >= 1, 'CLEAR_DISMISSED_STICKY_MENTION_COMMAND must be dispatched');
    assert.equal(ed.textContent, '/btw');

    // 4. Non-slash @file mention chip is still protected as draft_present
    lexChildren = [
      { type: 'contextScopeItemMention', trigger: '@', value: 'src/cdp.js' },
      { type: 'text', text: ' check this file' },
    ];
    ed.textContent = '';
    const fileChip = makeEl('span', { 'data-lexical-decorator': 'true' });
    fileChip.textContent = '@src/cdp.js';
    ed.appendChild(fileChip);
    const keepFileDraftRes = sandbox.window.__agClaudeStudio.fillBtwCommand({ conversationId: cid2 });
    assert.equal(keepFileDraftRes.ok, false);
    assert.equal(keepFileDraftRes.reason, 'draft_present', 'Non-slash @file mention draft must still be preserved');

    // 5. Verify Studio HTML renders unified /btw header & handles active-conversation postMessage + draft_present toast
    const html = fs.readFileSync(new URL('../sidecars/studio/index.html', import.meta.url), 'utf8');
    assert.match(html, /msg\.type !== 'ag-cs:active-conversation'/);
    assert.match(html, /if \(reason === 'draft_present'\)/);
    const renderFnMatch = html.match(/function renderLiveBtwBlock\(c\) \{[\s\S]*?\n    \}/);
    assert.ok(renderFnMatch, 'renderLiveBtwBlock exists');
    const headIdx = renderFnMatch[0].indexOf("head.className = 'cd-btw-head'");
    const emptyIdx = renderFnMatch[0].indexOf('if (items.length === 0)');
    assert.ok(headIdx > 0 && emptyIdx > headIdx, 'Unified .cd-btw-head must render for both empty and non-empty /btw states');
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});
