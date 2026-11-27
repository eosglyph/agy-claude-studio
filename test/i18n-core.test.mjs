import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const i18nCore = require('../i18n-core.js');
const i18nLocales = require('../i18n-locales.js');
const i18nSync = require('../i18n-sync.js');
const sidecarCore = require('../sidecar-core.js');

function createMiniDom() {
  const FILTER_ACCEPT = 1;
  const FILTER_REJECT = 2;
  const FILTER_SKIP = 3;
  const SHOW_TEXT = 4;
  const SHOW_ELEMENT = 1;

  function makeText(text) {
    return {
      nodeType: 3,
      nodeValue: String(text),
      parentElement: null,
      parentNode: null,
      isConnected: true,
      childNodes: [],
      children: [],
    };
  }

  function matchesSimple(node, simple) {
    let rest = simple.trim();
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
        const m = /^\[([^\]=*^$]+)(?:="([^"]*)")?\]/.exec(rest);
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

  function matchesSelector(node, sel) {
    if (!node || node.nodeType !== 1) return false;
    return sel.split(',').some((part) => {
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

  function makeEl(tag, opts = {}) {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const classes = new Set((opts.className || '').split(/\s+/).filter(Boolean));
    const childNodes = [];
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      id: opts.id || attrs.get('id') || '',
      parentElement: null,
      parentNode: null,
      isConnected: true,
      childNodes,
      get children() {
        return childNodes.filter((c) => c.nodeType === 1);
      },
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
      },
      append(...nodes) {
        for (const n of nodes) {
          const item = typeof n === 'string' ? makeText(n) : n;
          item.parentElement = this;
          item.parentNode = this;
          childNodes.push(item);
        }
        return this;
      },
      appendChild(n) {
        return this.append(n);
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') this.id = String(v);
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      hasAttribute(k) {
        return attrs.has(k);
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      matches(sel) {
        return matchesSelector(this, sel);
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (matchesSelector(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.childNodes) {
            if (c.nodeType === 1) {
              if (matchesSelector(c, sel)) out.push(c);
              walk(c);
            }
          }
        };
        walk(this);
        return out;
      },
      get textContent() {
        return childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
      },
    };
    if (opts.text) el.append(makeText(opts.text));
    return el;
  }

  let activeObserverCb = null;
  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {
      activeObserverCb = this.cb;
    }
    disconnect() {
      if (activeObserverCb === this.cb) activeObserverCb = null;
    }
  }

  const html = makeEl('html', { attrs: { lang: 'en' } });
  const body = makeEl('body');
  html.append(body);

  const doc = {
    nodeType: 9,
    documentElement: html,
    body,
    get childNodes() {
      return [html];
    },
    defaultView: { MutationObserver: MockMutationObserver },
    createTreeWalker(root, whatToShow, filter) {
      const list = [];
      const accept = (n) => {
        if (n.nodeType === 1 && !(whatToShow & SHOW_ELEMENT)) return FILTER_SKIP;
        if (n.nodeType === 3 && !(whatToShow & SHOW_TEXT)) return FILTER_SKIP;
        if (filter && typeof filter.acceptNode === 'function') return filter.acceptNode(n);
        return FILTER_ACCEPT;
      };
      const traverse = (node) => {
        for (const ch of node.childNodes) {
          const res = accept(ch);
          if (res === FILTER_REJECT) continue;
          if (res === FILTER_ACCEPT) list.push(ch);
          if (ch.nodeType === 1) traverse(ch);
        }
      };
      traverse(root);
      let idx = -1;
      return {
        currentNode: null,
        nextNode() {
          idx += 1;
          if (idx >= list.length) return false;
          this.currentNode = list[idx];
          return true;
        },
      };
    },
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
  };

  return {
    doc,
    html,
    body,
    makeEl,
    makeText,
    NodeFilter: { SHOW_TEXT, SHOW_ELEMENT, FILTER_ACCEPT, FILTER_REJECT },
    MutationObserver: MockMutationObserver,
    emitMutation(records) {
      if (activeObserverCb) activeObserverCb(records);
    },
  };
}

test('normalizeLanguage, LANG_OPTIONS, and UI_TABLE support all 5 required languages', () => {
  assert.deepEqual(
    i18nCore.LANG_OPTIONS.map((o) => [o.id, o.label]),
    [
      ['zh-CN', '简体中文'],
      ['zh-TW', '繁體中文'],
      ['yue', '粵語'],
      ['en', 'English'],
      ['ja', '日本語'],
    ]
  );

  assert.equal(i18nCore.normalizeLanguage('zh-CN'), 'zh-CN');
  assert.equal(i18nCore.normalizeLanguage('zh_TW'), 'zh-TW');
  assert.equal(i18nCore.normalizeLanguage('zh-Hant'), 'zh-TW');
  assert.equal(i18nCore.normalizeLanguage('zh-HK'), 'yue');
  assert.equal(i18nCore.normalizeLanguage('cantonese'), 'yue');
  assert.equal(i18nCore.normalizeLanguage('en-US'), 'en');
  assert.equal(i18nCore.normalizeLanguage('ja-JP'), 'ja');
  assert.equal(i18nCore.normalizeLanguage(true), 'zh-CN');
  assert.equal(i18nCore.normalizeLanguage(false), 'en');
  assert.equal(i18nCore.isCjkLanguage('en'), false);
  assert.equal(i18nCore.isCjkLanguage('ja'), true);

  for (const lang of ['zh-CN', 'zh-TW', 'yue', 'en', 'ja']) {
    const ui = i18nLocales.getUiStrings(lang);
    assert.ok(ui.setLanguageTitle);
    assert.ok(ui.setLanguageDesc);
    assert.ok(ui.tabOverview);
    assert.ok(ui.tabQuotas);
    assert.ok(ui.studioPlaceholder);
    assert.ok(ui.effortTitle);
  }
});

test('createDomTranslator translates full Antigravity UI across all 5 locales, guards protected zones, and reverts losslessly', () => {
  const { doc, html, body, makeEl, makeText, NodeFilter, MutationObserver, emitMutation } = createMiniDom();
  const prevNF = globalThis.NodeFilter;
  const prevMO = globalThis.MutationObserver;
  globalThis.NodeFilter = NodeFilter;
  globalThis.MutationObserver = MutationObserver;

  try {
    // Build realistic Antigravity UI chrome + protected zones
    const dialog = makeEl('div', { attrs: { role: 'dialog' } });
    const h2 = makeEl('h2', { text: 'Appearance' });
    const planLabel = makeEl('span', { text: 'Plan' });
    const generalH2 = makeEl('h2', { text: 'General' });
    dialog.append(generalH2, h2, planLabel);

    const sidebarRow = makeEl('div', { attrs: { 'data-testid': 'conversation-row-sidebar' } });
    const convTitle = makeEl('span', { text: 'Fix Settings' });
    const convTime = makeEl('span', { text: '5m' });
    const pinBtn = makeEl('button', { text: 'Pin conversation' });
    sidebarRow.append(convTitle, convTime, pinBtn);

    const modelBtn = makeEl('button', {
      attrs: { 'data-testid': 'model-selector-trigger', 'aria-label': 'Select model, current: Gemini 4 Hydrogen (High)' },
    });
    const effortBadge = makeEl('span', { attrs: { 'data-ag-cs-effort': 'high' }, text: ' High' });
    modelBtn.append(effortBadge);

    const workedBtn = makeEl('button', { text: 'Worked for 4m 12s' });
    const homeGreeting = makeEl('h1', { text: 'Welcome back, girl. Where should we pick up?' });

    const sentenceP = makeEl('p');
    const codeSlash = makeEl('code', { text: '/' });
    const bPlan = makeEl('b', { text: 'plan' });
    sentenceP.append(makeText('Type '), codeSlash, makeText(' and select '), bPlan, makeText(' to have the agent generate a plan.'));

    const prose = makeEl('div', { className: 'prose' });
    const codeEl = makeEl('code', { text: 'now' });
    const copyCodeBtn = makeEl('button', { text: 'Copy code' });
    prose.append(codeEl, copyCodeBtn);

    const optOut = makeEl('div', { attrs: { 'data-ag-no-i18n': '' } });
    const optOutTime = makeEl('span', { text: 'now' });
    optOut.append(optOutTime);

    body.append(dialog, sidebarRow, modelBtn, workedBtn, homeGreeting, sentenceP, prose, optOut);

    const translator = i18nCore.createDomTranslator(i18nLocales.resolveLocaleBundle);

    // 1. Simplified Chinese
    translator.setLanguage('zh-CN', doc);
    assert.equal(html.getAttribute('lang'), 'zh-CN');
    assert.equal(html.getAttribute('data-ag-cs-cjk'), '1');
    assert.equal(h2.textContent, '外观');
    assert.equal(generalH2.textContent, '常规');
    assert.equal(planLabel.textContent, '套餐');
    assert.equal(convTitle.textContent, 'Fix Settings'); // user title untouched
    assert.equal(convTime.textContent, '5分钟'); // relative timestamp translated
    assert.equal(pinBtn.textContent, '置顶对话'); // button inside sidebar row translated
    assert.equal(modelBtn.getAttribute('aria-label'), '选择模型，当前：Gemini 4 Hydrogen (High)');
    assert.equal(effortBadge.textContent, ' High'); // [data-ag-cs-effort] untouched
    assert.equal(workedBtn.textContent, '已运行 4分钟12秒');
    assert.equal(homeGreeting.textContent, '欢迎回来，girl。从哪里继续？');
    assert.equal(sentenceP.textContent, '输入 / 并选择 plan ，即可让智能体生成计划。');
    assert.equal(codeEl.textContent, 'now'); // code untouched
    assert.equal(copyCodeBtn.textContent, '复制代码'); // control inside prose translated
    assert.equal(optOutTime.textContent, 'now'); // opt-out untouched

    // Verify characterData mutation inside protected code/opt-out (zone === 0) does NOT trigger timeRules!
    codeEl.childNodes[0].nodeValue = '5m';
    optOutTime.childNodes[0].nodeValue = '5m';
    emitMutation([
      { type: 'characterData', target: codeEl.childNodes[0] },
      { type: 'characterData', target: optOutTime.childNodes[0] },
    ]);
    assert.equal(codeEl.textContent, '5m');
    assert.equal(optOutTime.textContent, '5m');

    // 2. Traditional Chinese
    translator.setLanguage('zh-TW', doc);
    assert.equal(html.getAttribute('lang'), 'zh-TW');
    assert.equal(h2.textContent, '外觀');
    assert.equal(generalH2.textContent, '一般');
    assert.equal(planLabel.textContent, '方案');
    assert.equal(convTime.textContent, '5分鐘');
    assert.equal(workedBtn.textContent, '已執行 4分鐘12秒');
    assert.equal(modelBtn.getAttribute('aria-label'), '選取模型，目前：Gemini 4 Hydrogen (High)');
    assert.equal(copyCodeBtn.textContent, '複製程式碼');

    // 3. Cantonese
    translator.setLanguage('yue', doc);
    assert.equal(html.getAttribute('lang'), 'zh-HK');
    assert.equal(h2.textContent, '外觀');
    assert.equal(workedBtn.textContent, '做咗 4分鐘12秒');
    assert.equal(modelBtn.getAttribute('aria-label'), '揀模型，而家：Gemini 4 Hydrogen (High)');
    assert.equal(homeGreeting.textContent, '歡迎返嚟，girl。由邊度繼續好？');

    // 4. Japanese
    translator.setLanguage('ja', doc);
    assert.equal(html.getAttribute('lang'), 'ja');
    assert.equal(h2.textContent, '外観');
    assert.equal(generalH2.textContent, '一般');
    assert.equal(planLabel.textContent, 'プラン');
    assert.equal(convTime.textContent, '5分');
    assert.equal(workedBtn.textContent, '4分12秒 作業');
    assert.equal(modelBtn.getAttribute('aria-label'), 'モデルを選択（現在: Gemini 4 Hydrogen (High)）');
    assert.equal(copyCodeBtn.textContent, 'コードをコピー');

    // Test revertNode / translateNode on a single subtree
    translator.revertNode(homeGreeting);
    assert.equal(homeGreeting.textContent, 'Welcome back, girl. Where should we pick up?');
    translator.translateNode(homeGreeting);
    assert.equal(homeGreeting.textContent, 'おかえりなさい、girl。どこから続けますか？');

    // 5. English (lossless revert)
    translator.setLanguage('en', doc);
    assert.equal(html.getAttribute('lang'), 'en');
    assert.equal(html.hasAttribute('data-ag-cs-cjk'), false);
    assert.equal(h2.textContent, 'Appearance');
    assert.equal(generalH2.textContent, 'General');
    assert.equal(planLabel.textContent, 'Plan');
    assert.equal(convTime.textContent, '5m');
    assert.equal(pinBtn.textContent, 'Pin conversation');
    assert.equal(workedBtn.textContent, 'Worked for 4m 12s');
    assert.equal(modelBtn.getAttribute('aria-label'), 'Select model, current: Gemini 4 Hydrogen (High)');
    assert.equal(homeGreeting.textContent, 'Welcome back, girl. Where should we pick up?');
    assert.equal(copyCodeBtn.textContent, 'Copy code');

    translator.destroy();
  } finally {
    globalThis.NodeFilter = prevNF;
    globalThis.MutationObserver = prevMO;
  }
});

test('i18n-locales dictionary has unique English keys, complete 5-language rows, and valid regex rules', () => {
  const seen = new Set();
  for (const row of i18nLocales.DICT_ROWS) {
    assert.equal(typeof row[0], 'string');
    assert.ok(row[0].length > 0);
    assert.equal(seen.has(row[0]), false, `Duplicate DICT_ROWS key: ${row[0]}`);
    seen.add(row[0]);
    assert.equal(row.length, 5, `Row must have 5 columns for ${row[0]}`);
    for (let col = 1; col < 5; col++) {
      const val = row[col];
      if (typeof val === 'string') {
        assert.ok(val.length > 0, `Empty translation at col ${col} for ${row[0]}`);
      } else {
        assert.equal(typeof val, 'object', `Expected string or selector map at col ${col} for ${row[0]}`);
        assert.ok(val && typeof val['*'] === 'string' && val['*'].length > 0, `Missing default '*' for ${row[0]}`);
      }
    }
  }

  for (const lang of ['zh-CN', 'zh-TW', 'yue', 'ja']) {
    const bundle = i18nLocales.resolveLocaleBundle(lang);
    assert.ok(bundle && bundle.dict && Array.isArray(bundle.rules));
    for (const [src, flags, to] of bundle.rules) {
      assert.doesNotThrow(() => new RegExp(src, flags), `Invalid regex ${src} in ${lang}`);
      assert.equal(typeof to, 'string');
    }
    for (const [src, flags, to] of sidecarCore.getSwarmExtraRules(lang)) {
      assert.doesNotThrow(() => new RegExp(src, flags), `Invalid swarm extra regex ${src} in ${lang}`);
      assert.equal(typeof to, 'string');
    }
  }
});

test('Swarm sidecar translator translates chrome, <select><option>, dynamic rules, and Plan/Orchestrator UI while protecting user content', () => {
  const { doc, html, body, makeEl, NodeFilter, MutationObserver } = createMiniDom();
  const prevNF = globalThis.NodeFilter;
  const prevMO = globalThis.MutationObserver;
  globalThis.NodeFilter = NodeFilter;
  globalThis.MutationObserver = MutationObserver;

  try {
    const header = makeEl('header');
    const swarmTitle = makeEl('h1', { id: 'swarm-title', text: 'Board' }); // user title must stay untouched
    const liveLabel = makeEl('span', { id: 'live-label', text: 'Live' });
    const tabOverview = makeEl('button', { text: 'Overview' });
    const tabBoard = makeEl('button', { text: 'Board' });
    const tabMembers = makeEl('button', { text: 'Members' });
    const tabGraph = makeEl('button', { text: 'Graph' });
    header.append(swarmTitle, liveLabel, tabOverview, tabBoard, tabMembers, tabGraph);

    const overviewSec = makeEl('section', { id: 'tab-overview' });
    const ovBlocked = makeEl('span', { text: 'Blocked' });
    const ovNow = makeEl('span', { text: 'Now' });
    const ovRunning = makeEl('span', { text: 'Running' });
    const ovTask = makeEl('b', { className: 'o2-runt', text: 'Overview' }); // user task title protected
    const ovWait = makeEl('span', { text: 'Waiting on @worker-1' });
    const ovDone = makeEl('p', { text: '3 of 5 tasks done' });
    overviewSec.append(ovBlocked, ovNow, ovRunning, ovTask, ovWait, ovDone);

    const filterSelect = makeEl('select', {
      id: 'f-agent',
      attrs: { 'aria-label': 'Filter by poster', title: 'Show posts by one member' },
    });
    const optAny = makeEl('option', { text: 'From anyone' });
    const optCoord = makeEl('option', { text: 'From coordinator' });
    filterSelect.append(optAny, optCoord);

    const unreadDivider = makeEl('div', { attrs: { 'data-testid': 'swarm-unread-divider' }, text: 'New' });

    const msgBody = makeEl('div', { className: 'msg-body' });
    const msgProse = makeEl('p', { text: 'Export GIF' }); // prose inside .msg-body must stay untouched
    const msgMoreBtn = makeEl('button', { text: 'Show more' }); // button inside .msg-body IS translated
    msgBody.append(msgProse, msgMoreBtn);

    const planArea = makeEl('div');
    const orchTitle = makeEl('h3', { text: 'Orchestrator Settings' });
    const orchModel = makeEl('span', { text: 'Orchestrator Model' });
    const execModel = makeEl('span', { text: 'Executor Model' });
    const olderBtn = makeEl('button', {
      attrs: { 'aria-label': 'No more older messages, showing 41 of 41' },
      text: 'No more older messages',
    });
    planArea.append(orchTitle, orchModel, execModel, olderBtn);

    body.append(header, overviewSec, filterSelect, unreadDivider, msgBody, planArea);

    const translator = i18nCore.createDomTranslator(i18nLocales.resolveLocaleBundle, {
      content: sidecarCore.SWARM_CONTENT_SELECTORS,
      names: sidecarCore.SWARM_NAME_SELECTORS,
      controls: sidecarCore.SWARM_CONTROL_SELECTORS,
      extraRules: sidecarCore.getSwarmExtraRules,
    });

    translator.setLanguage('zh-CN', doc);
    assert.equal(swarmTitle.textContent, 'Board');
    assert.equal(liveLabel.textContent, '实时');
    assert.equal(tabOverview.textContent, '概览');
    assert.equal(tabBoard.textContent, '看板');
    assert.equal(tabMembers.textContent, '成员');
    assert.equal(tabGraph.textContent, '图谱');
    assert.equal(ovBlocked.textContent, '受阻');
    assert.equal(ovNow.textContent, '当前');
    assert.equal(ovRunning.textContent, '运行中');
    assert.equal(ovTask.textContent, 'Overview');
    assert.equal(ovWait.textContent, '等待 @worker-1 响应');
    assert.equal(ovDone.textContent, '已完成 3 / 5 项任务');
    assert.equal(filterSelect.getAttribute('aria-label'), '按发帖成员筛选');
    assert.equal(filterSelect.getAttribute('title'), '仅显示某位成员的帖子');
    assert.equal(optAny.textContent, '来自所有人');
    assert.equal(optCoord.textContent, '来自 coordinator');
    assert.equal(unreadDivider.textContent, '新消息');
    assert.equal(msgProse.textContent, 'Export GIF');
    assert.equal(msgMoreBtn.textContent, '显示更多');
    assert.equal(orchTitle.textContent, '协作模式设置');
    assert.equal(orchModel.textContent, '规划模型');
    assert.equal(execModel.textContent, '执行模型');
    assert.equal(olderBtn.textContent, '没有更早的消息了');
    assert.equal(olderBtn.getAttribute('aria-label'), '没有更早的消息了（当前 41 / 41）');

    translator.setLanguage('ja', doc);
    assert.equal(tabBoard.textContent, 'ボード');
    assert.equal(ovBlocked.textContent, 'ブロック中');
    assert.equal(ovNow.textContent, '現在');
    assert.equal(optAny.textContent, 'すべての投稿者');
    assert.equal(optCoord.textContent, '送信者: coordinator');
    assert.equal(unreadDivider.textContent, '新着');
    assert.equal(orchTitle.textContent, 'オーケストレーター設定');

    translator.setLanguage('en', doc);
    assert.equal(html.getAttribute('lang'), 'en');
    assert.equal(tabBoard.textContent, 'Board');
    assert.equal(optAny.textContent, 'From anyone');
    assert.equal(optCoord.textContent, 'From coordinator');
    assert.equal(unreadDivider.textContent, 'New');
    assert.equal(orchTitle.textContent, 'Orchestrator Settings');
    assert.equal(olderBtn.getAttribute('aria-label'), 'No more older messages, showing 41 of 41');

    translator.destroy();
  } finally {
    globalThis.NodeFilter = prevNF;
    globalThis.MutationObserver = prevMO;
  }
});

test('Antigravity Settings sentence-case notifications, sounds, overages, and dynamic plan strings translate cleanly', () => {
  const { doc, html, body, makeEl, NodeFilter, MutationObserver } = createMiniDom();
  const prevNF = globalThis.NodeFilter;
  const prevMO = globalThis.MutationObserver;
  globalThis.NodeFilter = NodeFilter;
  globalThis.MutationObserver = MutationObserver;
  try {
    const n1 = makeEl('div');
    n1.append('Enable notifications for agent');
    const n2 = makeEl('div');
    n2.append('Enable sounds for agent');
    const n3 = makeEl('div');
    n3.append('Enable AI credit overages');
    const n4 = makeEl('div');
    n4.append('Your plan: Google AI Pro');
    const n5 = makeEl('div');
    n5.append('Your plan: Google AI Ultra');
    body.append(n1, n2, n3, n4, n5);

    const translator = i18nCore.createDomTranslator(i18nLocales.resolveLocaleBundle);
    translator.setLanguage('zh-CN', doc);
    assert.equal(n1.textContent, '启用智能体通知');
    assert.equal(n2.textContent, '启用智能体提示音');
    assert.equal(n3.textContent, '允许 AI 额度超额');
    assert.equal(n4.textContent, '你的套餐：Google AI Pro');
    assert.equal(n5.textContent, '你的套餐：Google AI Ultra');

    translator.setLanguage('en', doc);
    assert.equal(html.getAttribute('lang'), 'en');
    assert.equal(n1.textContent, 'Enable notifications for agent');
    assert.equal(n4.textContent, 'Your plan: Google AI Pro');
    translator.destroy();
  } finally {
    globalThis.NodeFilter = prevNF;
    globalThis.MutationObserver = prevMO;
  }
});

test('multi-word case-insensitive fallback fixes v2.35.2 sentence-case settings, quota limits, and mid-turn model switch tooltip', () => {
  const { doc, html, body, makeEl, NodeFilter, MutationObserver } = createMiniDom();
  const prevNF = globalThis.NodeFilter;
  const prevMO = globalThis.MutationObserver;
  globalThis.NodeFilter = NodeFilter;
  globalThis.MutationObserver = MutationObserver;
  try {
    const items = [
      'Prevent sleep',
      'Keep in menu bar',
      'Notification settings',
      'Conversation width',
      'Screen reader mode',
      'Open links in',
      'Download location',
      'Browsing history',
      'Browser actuation rules',
      'You have hit your weekly limit, it refreshes in 5 days, 16 hours. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier.',
      'You have hit your weekly limit, the 5-hour limit does not currently apply. Your weekly limit will fully refresh in 5 days, 16 hours.',
      '2/4 steps',
      '1/1 steps · 2 skipped',
    ].map((t) => makeEl('div', { text: t }));
    const modelBtn = makeEl('button', {
      attrs: {
        'aria-label': 'Select model, current: Gemini 4 Neon High. Applies to /btw and messages sent after this turn',
      },
      text: 'Gemini 4 Neon High',
    });
    const planBadge = makeEl('button', {
      attrs: { 'aria-label': 'Plan, 1 of 3 steps done' },
      text: '2/4 steps',
    });
    body.append(...items, modelBtn, planBadge);

    const translator = i18nCore.createDomTranslator(i18nLocales.resolveLocaleBundle);
    translator.setLanguage('zh-CN', doc);
    assert.equal(items[0].textContent, '防止休眠');
    assert.equal(items[1].textContent, '常驻托盘');
    assert.equal(items[2].textContent, '通知设置');
    assert.equal(items[3].textContent, '对话宽度');
    assert.equal(items[4].textContent, '屏幕阅读器模式');
    assert.equal(items[5].textContent, '链接打开方式');
    assert.equal(items[6].textContent, '下载位置');
    assert.equal(items[7].textContent, '浏览历史');
    assert.equal(items[8].textContent, '浏览器操作规则');
    assert.equal(
      items[9].textContent,
      '本周额度已用尽，将于 5天16小时后重置。如使用受支持的付费套餐，期间可使用 AI 额度或升级至更高套餐。'
    );
    assert.equal(
      items[10].textContent,
      '本周额度已用尽，当前不适用 5 小时额度限制。本周额度将于 5天16小时后完全重置。'
    );
    assert.equal(items[11].textContent, '2/4 步');
    assert.equal(items[12].textContent, '1/1 步 · 跳过 2');
    assert.equal(
      modelBtn.getAttribute('aria-label'),
      '选择模型，当前：Gemini 4 Neon High（将应用于 /btw 及本轮之后发送的消息）'
    );
    assert.equal(planBadge.getAttribute('aria-label'), '计划：已完成 1 / 3 步');

    translator.setLanguage('ja', doc);
    assert.equal(items[0].textContent, 'スリープを防止');
    assert.equal(items[6].textContent, '保存先フォルダ');
    assert.equal(
      items[10].textContent,
      '週間上限に達しているため、現在5時間上限は適用されません。週間上限は 5日16時間後に完全にリセットされます。'
    );

    translator.setLanguage('en', doc);
    assert.equal(html.getAttribute('lang'), 'en');
    assert.equal(items[6].textContent, 'Download location');
    assert.equal(items[9].textContent, 'You have hit your weekly limit, it refreshes in 5 days, 16 hours. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier.');
    translator.destroy();
  } finally {
    globalThis.NodeFilter = prevNF;
    globalThis.MutationObserver = prevMO;
  }
});

test('i18n-sync validates, syncs, checksums, falls back to bundled offline packs, and hot-reloads in i18n-core', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-i18n-sync-'));
  try {
    // 1. Only zh-CN & zh-TW are bundled offline; yue & ja require on-demand download!
    for (const lang of i18nSync.BUNDLED_PACK_LANGS) {
      const bundled = i18nSync.readLocalePack(lang, dataDir);
      assert.ok(bundled, `bundled pack exists for ${lang}`);
      assert.equal(bundled.source, 'bundled');
      assert.ok(bundled.dictCount >= 2000);
      assert.ok(bundled.ruleCount >= 100);
    }
    for (const lang of i18nSync.ON_DEMAND_PACK_LANGS) {
      assert.equal(i18nSync.readLocalePack(lang, dataDir), null, `${lang} must not load before download`);
      const st = i18nSync.getLocalePackStatus(lang, dataDir);
      assert.equal(st.bundled, false);
      assert.equal(st.installed, false);
      assert.equal(st.source, 'not_installed');
      assert.ok(st.dictCount >= 2000, `${lang} manifest advertises dictCount for download UI`);
    }
    const catalogStatus = i18nSync.listLocalePacksStatus('zh-CN', dataDir);
    assert.deepEqual(
      catalogStatus.map((p) => [p.lang, p.bundled, p.installed]),
      [
        ['zh-CN', true, true],
        ['zh-TW', true, true],
        ['yue', false, false],
        ['ja', false, false],
      ]
    );

    // 2. Schema validation rejects invalid regexes & malformed payloads
    assert.equal(i18nSync.validateLocalePack(null, 'zh-CN'), null);
    assert.equal(i18nSync.validateLocalePack({ lang: 'zh-CN', dict: {}, rules: [], timeRules: [], units: {} }, 'zh-CN'), null);
    assert.equal(
      i18nSync.validateLocalePack(
        {
          lang: 'zh-CN',
          dict: { Hello: '你好' },
          rules: [['([unclosed', '', '$1']],
          timeRules: [],
          units: { s: '秒' },
        },
        'zh-CN'
      ),
      null
    );

    // 3. Cloud sync with SHA-256 verification saves override & takes priority over bundled baseline
    const cloudPack = {
      schemaVersion: 1,
      lang: 'zh-CN',
      agyVersion: '2.36.0',
      updatedAt: '2026-12-01',
      cjkLatinSpacing: true,
      units: { s: '秒', m: '分钟', h: '小时', d: '天', day: '天', hour: '小时', joiner: '' },
      dict: {
        'Prevent sleep': '防止电脑休眠（云端新版）',
        'Future Setting': '云端新词条',
      },
      rules: [['^Cloud count: (\\d+)$', '', '云端计数：$1']],
      timeRules: [['^(\\d+)s$', '', '$1秒']],
      sentences: [],
    };
    const packText = JSON.stringify(cloudPack);
    const packSha = crypto.createHash('sha256').update(packText, 'utf8').digest('hex');
    const mockManifest = {
      schemaVersion: 1,
      agyVersion: '2.36.0',
      updatedAt: '2026-12-01',
      locales: { 'zh-CN': { file: 'zh-CN.json', sha256: packSha } },
    };
    const mockFetch = async (url) => {
      if (url.endsWith('/manifest.json')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(mockManifest) };
      }
      if (url.endsWith('/zh-CN.json')) {
        return { ok: true, status: 200, text: async () => packText };
      }
      return { ok: false, status: 404, text: async () => 'not found' };
    };

    const syncRes = await i18nSync.syncLocalePack({
      lang: 'zh-CN',
      pluginDataDir: dataDir,
      fetchFn: mockFetch,
    });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.source, 'cloud');
    assert.equal(syncRes.agyVersion, '2.36.0');
    assert.equal(syncRes.dictCount, 2);

    const statusCloud = i18nSync.getLocalePackStatus('zh-CN', dataDir);
    assert.equal(statusCloud.source, 'cloud');
    assert.equal(statusCloud.hasCloudOverride, true);
    assert.deepEqual(statusCloud.cachedLangs, ['zh-CN']);

    // Checksum mismatch is rejected cleanly
    const badFetch = async (url) => {
      if (url.endsWith('/manifest.json')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(mockManifest) };
      }
      return { ok: true, status: 200, text: async () => packText.replace('云端新词条', '被篡改') };
    };
    await assert.rejects(
      i18nSync.syncLocalePack({ lang: 'zh-CN', pluginDataDir: dataDir, fetchFn: badFetch }),
      /Checksum mismatch/
    );

    // 4. i18n-core forceReload hot-swaps active DOM from built-in -> cloud pack -> built-in cleanly
    const { doc, body, makeEl, NodeFilter, MutationObserver } = createMiniDom();
    const prevNF = globalThis.NodeFilter;
    const prevMO = globalThis.MutationObserver;
    globalThis.NodeFilter = NodeFilter;
    globalThis.MutationObserver = MutationObserver;
    try {
      const el1 = makeEl('div', { text: 'Prevent sleep' });
      const el2 = makeEl('div', { text: 'Future Setting' });
      const el3 = makeEl('div', { text: 'Cloud count: 42' });
      body.append(el1, el2, el3);

      let overridePack = null;
      const translator = i18nCore.createDomTranslator((lang) => {
        if (overridePack && overridePack.lang === lang) return overridePack;
        return i18nLocales.resolveLocaleBundle(lang);
      });
      translator.setLanguage('zh-CN', doc);
      assert.equal(el1.textContent, '防止休眠');
      assert.equal(el2.textContent, 'Future Setting');

      overridePack = i18nSync.readCloudLocalePackOverride('zh-CN', dataDir).pack;
      translator.setLanguage('zh-CN', doc, true);
      assert.equal(el1.textContent, '防止电脑休眠（云端新版）');
      assert.equal(el2.textContent, '云端新词条');
      assert.equal(el3.textContent, '云端计数：42');

      // Reset reverts cleanly to bundled baseline
      const resetRes = i18nSync.resetLocalePack({ lang: 'zh-CN', pluginDataDir: dataDir });
      assert.deepEqual(resetRes.removed, ['zh-CN']);
      assert.equal(i18nSync.getLocalePackStatus('zh-CN', dataDir).source, 'bundled');
      overridePack = null;
      translator.setLanguage('zh-CN', doc, true);
      assert.equal(el1.textContent, '防止休眠');
      assert.equal(el2.textContent, 'Future Setting');
      translator.destroy();
    } finally {
      globalThis.NodeFilter = prevNF;
      globalThis.MutationObserver = prevMO;
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('i18n-sync distinguishes active cloud override from remote manifest updates via sourceSha256', async () => {
  const tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agy-i18n-update-')));
  try {
    const bundledManifest = i18nSync.readBundledManifest();
    const bundledZhSha = bundledManifest.locales['zh-CN'].sha256;

    // 1. Built-in zh-CN matches current manifest -> no remote update
    const stSame = i18nSync.getLocalePackStatus('zh-CN', tmpDir, { remoteManifest: bundledManifest });
    const zhSame = stSame.packs.find((p) => p.lang === 'zh-CN');
    assert.equal(zhSame.source, 'bundled');
    assert.equal(zhSame.hasRemoteUpdate, false);

    // 2. Remote manifest publishes a newer zh-CN pack -> hasRemoteUpdate becomes true
    const newPackObj = {
      schemaVersion: 1,
      lang: 'zh-CN',
      label: '简体中文',
      bundled: true,
      agyVersion: '2.36.0',
      updatedAt: '2026-12-01',
      cjkLatinSpacing: true,
      units: { sec: '秒' },
      dict: { Settings: '设置', Preview: '预览' },
      rules: [],
      timeRules: [],
      sentences: [],
    };
    const newPackText = JSON.stringify(newPackObj, null, 2) + '\n';
    const newPackSha = crypto.createHash('sha256').update(newPackText, 'utf8').digest('hex');
    const newerManifest = {
      schemaVersion: 1,
      agyVersion: '2.36.0',
      updatedAt: '2026-12-01',
      locales: {
        ...bundledManifest.locales,
        'zh-CN': {
          ...bundledManifest.locales['zh-CN'],
          dictCount: 2,
          sha256: newPackSha,
        },
      },
    };

    const stOutdated = i18nSync.getLocalePackStatus('zh-CN', tmpDir, { remoteManifest: newerManifest });
    const zhOutdated = stOutdated.packs.find((p) => p.lang === 'zh-CN');
    assert.equal(zhOutdated.source, 'bundled');
    assert.equal(zhOutdated.hasRemoteUpdate, true);
    assert.notEqual(bundledZhSha, newPackSha);

    // 3. After syncing the newer remote pack, source is 'cloud' and hasRemoteUpdate clears to false
    const mockFetch = async (url) => {
      if (String(url).endsWith('/manifest.json')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(newerManifest) };
      }
      if (String(url).endsWith('/zh-CN.json')) {
        return { ok: true, status: 200, text: async () => newPackText };
      }
      return { ok: false, status: 404, text: async () => '' };
    };
    const synced = await i18nSync.syncLocalePack({ lang: 'zh-CN', pluginDataDir: tmpDir, fetchFn: mockFetch });
    assert.equal(synced.ok, true);
    assert.equal(synced.sha256, newPackSha);

    const stAfterSync = i18nSync.getLocalePackStatus('zh-CN', tmpDir, { remoteManifest: newerManifest });
    const zhAfterSync = stAfterSync.packs.find((p) => p.lang === 'zh-CN');
    assert.equal(zhAfterSync.source, 'cloud');
    assert.equal(zhAfterSync.hasCloudOverride, true);
    assert.equal(zhAfterSync.hasRemoteUpdate, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
