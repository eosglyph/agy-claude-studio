import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const i18nCore = require('../i18n-core.js');
const i18nLocales = require('../i18n-locales.js');
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
    assert.equal(orchTitle.textContent, '编排器设置');
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
