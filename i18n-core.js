(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsI18nCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const LANG_OPTIONS = Object.freeze([
    { id: 'zh-CN', label: '简体中文', htmlLang: 'zh-CN', intl: 'zh-CN' },
    { id: 'zh-TW', label: '繁體中文', htmlLang: 'zh-TW', intl: 'zh-TW' },
    { id: 'yue', label: '粵語', htmlLang: 'zh-HK', intl: 'zh-HK' },
    { id: 'en', label: 'English', htmlLang: 'en', intl: 'en-US' },
    { id: 'ja', label: '日本語', htmlLang: 'ja', intl: 'ja-JP' },
  ]);

  const LANG_META = Object.fromEntries(LANG_OPTIONS.map((opt) => [opt.id, opt]));

  /**
   * Normalize language identifier (or legacy boolean `zh` flag) to one of the 5 supported UI languages.
   */
  function normalizeLanguage(lang, fallback = 'zh-CN') {
    if (lang === true) return 'zh-CN';
    if (lang === false) return 'en';
    const raw = typeof lang === 'string' ? lang.trim().toLowerCase().replace(/_/g, '-') : '';
    if (!raw) return fallback;
    if (raw === 'en' || raw.startsWith('en-') || raw === 'english') return 'en';
    if (raw === 'ja' || raw.startsWith('ja-') || raw === 'jp' || raw === 'japanese') return 'ja';
    if (
      raw === 'yue' ||
      raw.startsWith('yue-') ||
      raw === 'zh-yue' ||
      raw === 'zh-hk' ||
      raw === 'zh-mo' ||
      raw.includes('cantonese')
    ) {
      return 'yue';
    }
    if (
      raw === 'zh-tw' ||
      raw === 'zh-hant' ||
      raw.startsWith('zh-hant-') ||
      raw === 'tw' ||
      raw === 'hant'
    ) {
      return 'zh-TW';
    }
    if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw.startsWith('zh-')) {
      return 'zh-CN';
    }
    return fallback;
  }

  function intlLocale(lang) {
    const id = normalizeLanguage(lang);
    return LANG_META[id]?.intl || 'zh-CN';
  }

  function htmlLangAttr(lang) {
    const id = normalizeLanguage(lang);
    return LANG_META[id]?.htmlLang || 'zh-CN';
  }

  function isCjkLanguage(lang) {
    return normalizeLanguage(lang) !== 'en';
  }

  const DURATION_TOKEN = /(\d+)\s*(months?|mo|weeks?|w|days?|d|hours?|h|minutes?|mins?|m|seconds?|secs?|s|years?|y)\b/g;

  /**
   * Translate an English duration snippet such as "4m 12s" or "6 days, 22 hours" using locale units.
   * Returns null if text contains non-duration tokens.
   */
  function formatDuration(text, units) {
    if (!text || !units) return null;
    DURATION_TOKEN.lastIndex = 0;
    const parts = [...String(text).matchAll(DURATION_TOKEN)];
    if (!parts.length) return null;
    const leftover = String(text)
      .replace(DURATION_TOKEN, '')
      .replace(/,|\band\b/gi, '')
      .trim();
    if (leftover) return null;
    if (parts.length === 1 && parts[0][2] === 'm' && units.singleMin) {
      return parts[0][1] + units.singleMin;
    }
    const sep = typeof units.joiner === 'string' ? units.joiner : '';
    return parts
      .map((p) => {
        const key = p[2].toLowerCase();
        const unit = units[key] || units[key.replace(/s$/, '')] || key;
        return p[1] + unit;
      })
      .join(sep);
  }

  const hasOwn = Object.prototype.hasOwnProperty;
  const CJK_LATIN = /([\u3400-\u9fff])([A-Za-z])|([A-Za-z])([\u3400-\u9fff])/g;

  // Universal third-party opt-out protocol (HTML standard + community attributes) + built-in protected roots.
  const OPT_OUT_PROTOCOL = Object.freeze([
    '[translate="no"]',
    '.notranslate',
    '[data-ag-no-i18n]',
    '[data-no-i18n]',
    '[data-agy-no-translate]',
  ]);
  const OPT_OUT = [
    ...OPT_OUT_PROTOCOL,
    '[data-ag-cs-effort]',
    '#ag-usage-monitor-capsule',
    '#ag-usage-monitor-portal',
    '[id^="ag-usage-monitor-"]',
  ].join(', ');
  // Code / editing surfaces: text is untouched, but nested toolbar buttons (e.g. "Copy code") are UI.
  const HARD = [
    'script',
    'style',
    'noscript',
    'svg',
    'iframe',
    'code',
    'pre',
    'kbd',
    'samp',
    'textarea',
    'input',
    'select',
    '[contenteditable="true"]',
    '.monaco-editor',
    '.xterm',
    '.font-mono',
  ].join(',');
  // Conversation content containers: prose/user messages untouched except interactive controls inside.
  const CONTENT = [
    '[data-testid="planner-response-text"]',
    '[data-testid="user-message-content"]',
    '[data-testid="user-input-step"] .bg-card',
    '[class*="_code:not(pre_code)"]',
    '.prose',
    '.markdown',
    '.markdown-alert',
  ].join(',');
  // User-chosen workspace / conversation titles: only relative timestamps ("4m", "5d") apply.
  const NAMES = [
    '[data-testid="conversation-row-sidebar"]',
    '[data-testid="breadcrumb-segment"]',
    '[data-testid="project-header"]',
    '[data-project-label]',
  ].join(',');
  const ATTRS = ['placeholder', 'aria-label', 'title', 'data-placeholder', 'data-tooltip-content'];
  const FIELD = 'input,textarea,select,[contenteditable="true"]';
  const CONTROLS = 'button,[role="button"],[role="menuitem"]';

  function closestSel(el, sel) {
    if (!el || typeof el.closest !== 'function') return null;
    try {
      return el.closest(sel);
    } catch {
      return null;
    }
  }

  function matchesSel(el, sel) {
    if (!el || typeof el.matches !== 'function') return false;
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  }

  function joinSel(base, extra) {
    if (!Array.isArray(extra) || !extra.length) return base;
    const parts = extra.filter((s) => typeof s === 'string' && s.trim());
    return parts.length ? base + ',' + parts.join(',') : base;
  }

  function sanitizeExtraSelectors(extra, doc) {
    if (!Array.isArray(extra) || !extra.length) return [];
    const out = [];
    const seen = new Set();
    const probe = doc && typeof doc.createElement === 'function' ? doc.createElement('div') : null;
    for (const item of extra) {
      const s = typeof item === 'string' ? item.trim() : '';
      if (!s || s.length > 160 || /[\r\n\0<>{};]/.test(s) || seen.has(s)) continue;
      if (probe && typeof probe.matches === 'function') {
        try {
          probe.matches(s);
        } catch {
          continue;
        }
      }
      seen.add(s);
      out.push(s);
      if (out.length >= 64) break;
    }
    return out;
  }

  /**
   * Create a reversible multi-locale DOM translator modeled after Claudized-Antigravity.
   * Restores every modified Text node and attribute in-place before switching locales or detaching.
   */
  function createDomTranslator(resolveBundle, options = {}) {
    const contentSel = joinSel(CONTENT, options && options.content);
    const namesSel = joinSel(NAMES, options && options.names);
    const controlsSel = joinSel(CONTROLS, options && options.controls);
    let extraOptOut = sanitizeExtraSelectors(options && options.optOut);
    let optOutSel = joinSel(OPT_OUT, extraOptOut);
    const resolveExtraRules = typeof options?.extraRules === 'function' ? options.extraRules : null;
    const texts = new Map();
    const attrs = new Map();
    let observer = null;
    let activeDoc = null;
    let activeLang = 'en';
    let bundle = null;
    let ciDict = null;
    let compiledRules = [];
    let compiledTimeRules = [];
    let allZone2Rules = [];
    let regexCache = new Map();
    let sentenceMap = new Map();
    let fragmentSet = new Set();
    let origHtmlLang = null;
    let htmlLangCaptured = false;
    let sincePrune = 0;

    function clearBundleState() {
      bundle = null;
      ciDict = null;
      compiledRules = [];
      compiledTimeRules = [];
      allZone2Rules = [];
      regexCache.clear();
      sentenceMap = new Map();
      fragmentSet = new Set();
    }

    function compileBundle(nextBundle) {
      bundle = nextBundle;
      regexCache.clear();
      ciDict = Object.create(null);
      if (nextBundle && nextBundle.dict) {
        for (const key in nextBundle.dict) {
          if (!hasOwn.call(nextBundle.dict, key) || key.indexOf(' ') < 0) continue;
          const lower = key.toLowerCase();
          if (!hasOwn.call(ciDict, lower)) {
            ciDict[lower] = nextBundle.dict[key];
          } else if (ciDict[lower] !== nextBundle.dict[key]) {
            ciDict[lower] = null;
          }
        }
      }
      const baseRules = nextBundle.rules || [];
      const extra = resolveExtraRules ? resolveExtraRules(nextBundle.lang) || [] : [];
      compiledRules = [];
      for (const item of baseRules.concat(extra)) {
        if (!Array.isArray(item) || item.length < 3) continue;
        try {
          compiledRules.push({ re: new RegExp(item[0], item[1]), to: item[2] });
        } catch {}
      }
      compiledTimeRules = [];
      for (const item of nextBundle.timeRules || []) {
        if (!Array.isArray(item) || item.length < 3) continue;
        try {
          compiledTimeRules.push({ re: new RegExp(item[0], item[1]), to: item[2] });
        } catch {}
      }
      allZone2Rules = compiledRules.concat(compiledTimeRules);
      sentenceMap = new Map((nextBundle.sentences || []).map(([text, parts]) => [text, parts]));
      fragmentSet = new Set((nextBundle.sentences || []).flatMap(([, parts]) => Object.keys(parts)));
    }

    function lookupRaw(text) {
      if (!bundle || !bundle.dict) return null;
      if (hasOwn.call(bundle.dict, text)) return bundle.dict[text];
      if (ciDict && text.indexOf(' ') >= 0) {
        const lower = text.toLowerCase();
        if (hasOwn.call(ciDict, lower) && ciDict[lower] != null) return ciDict[lower];
      }
      return null;
    }

    function lookup(text, el) {
      const v = lookupRaw(text);
      if (v == null) return null;
      if (typeof v === 'string') return v;
      if (typeof v !== 'object') return null;
      for (const sel in v) {
        if (sel !== '*' && closestSel(el, sel)) return v[sel];
      }
      return v['*'] ?? null;
    }

    function applyRule(rule, m, el) {
      let failed = false;
      let composed = false;
      let contextDependent = false;
      const out = rule.to.replace(/\$([DT]?)(\d)/g, (_, kind, idx) => {
        const g = m[+idx] ?? '';
        if (kind === 'T') {
          composed = true;
          const cap = g.charAt(0).toUpperCase() + g.slice(1);
          const raw = lookupRaw(g) ?? lookupRaw(cap);
          if (raw && typeof raw === 'object') contextDependent = true;
          const v = lookup(g, el) ?? lookup(cap, el);
          if (v == null) failed = true;
          return v ?? g;
        }
        if (kind !== 'D') return g;
        const v = formatDuration(g, bundle?.units);
        if (v == null) failed = true;
        return v ?? g;
      });
      if (failed) return { value: null, contextDependent };
      const finalOut =
        composed && bundle?.cjkLatinSpacing !== false
          ? out.replace(CJK_LATIN, (_, a, b, c, d) => (a ? a + ' ' + b : c + ' ' + d))
          : out;
      return { value: finalOut, contextDependent };
    }

    function originalText(el) {
      if (!el || !activeDoc || typeof activeDoc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') {
        return '';
      }
      let s = '';
      const w = activeDoc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const rec = texts.get(w.currentNode);
        s += rec && w.currentNode.nodeValue === rec.t ? rec.o : w.currentNode.nodeValue;
      }
      return s.replace(/\s+/g, ' ').trim();
    }

    function fromSentence(text, el) {
      if (!fragmentSet.has(text)) return null;
      for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
        const parts = sentenceMap.get(originalText(e));
        if (parts && hasOwn.call(parts, text)) return parts[text];
      }
      return null;
    }

    function convert(text, zone, el) {
      if (!bundle || !text || !zone) return null;
      if (zone === 2) {
        const s = el && fromSentence(text, el);
        if (s != null) return s;
        const d = lookup(text, el);
        if (d != null) return d;
      }
      const cacheKey = (zone === 2 ? '2:' : '1:') + text;
      if (regexCache.has(cacheKey)) {
        return regexCache.get(cacheKey);
      }
      const list = zone === 2 ? allZone2Rules : compiledTimeRules;
      let sawContextDep = false;
      for (let i = 0; i < list.length; i += 1) {
        const rule = list[i];
        const m = text.match(rule.re);
        if (m) {
          const applied = applyRule(rule, m, el);
          if (applied.contextDependent) sawContextDep = true;
          if (applied.value != null) {
            if (!sawContextDep) {
              if (regexCache.size >= 1024) regexCache.clear();
              regexCache.set(cacheKey, applied.value);
            }
            return applied.value;
          }
        }
      }
      if (!sawContextDep) {
        if (regexCache.size >= 1024) regexCache.clear();
        regexCache.set(cacheKey, null);
      }
      return null;
    }

    // 0 = skip, 1 = names (relative times only), 2 = full UI chrome
    function zoneOf(el) {
      if (!el) return 0;
      if (closestSel(el, optOutSel)) return 0;
      const hard = closestSel(el, HARD);
      if (hard) {
        const ctl = closestSel(el, controlsSel);
        return ctl && hard.contains(ctl) ? 2 : 0;
      }
      const content = closestSel(el, contentSel);
      if (content) {
        const ctl = closestSel(el, controlsSel);
        return ctl && content.contains(ctl) ? 2 : 0;
      }
      const names = closestSel(el, namesSel);
      if (!names) return 2;
      // Fixed shell breadcrumb root (not a user-chosen title) must be translated.
      if (matchesSel(names, '[data-testid="breadcrumb-segment"]') && /^\s*Customizations\s*$/.test(names.textContent || '')) return 2;
      const ctl = closestSel(el, controlsSel);
      return ctl && ctl !== names && names.contains(ctl) ? 2 : 1;
    }

    function doText(node) {
      if (!bundle || !node) return;
      const cur = node.nodeValue;
      const rec = texts.get(node);
      if (rec && cur === rec.t) return;
      const trimmed = typeof cur === 'string' ? cur.trim() : '';
      if (!trimmed || trimmed.length > 300 || !/[A-Za-z]/.test(trimmed)) {
        if (rec) texts.delete(node);
        return;
      }
      const parent = node.parentElement;
      const zone = zoneOf(parent);
      if (!zone) {
        if (rec) texts.delete(node);
        return;
      }
      const out = convert(trimmed, zone, parent);
      if (out == null || out === trimmed) {
        if (rec) texts.delete(node);
        return;
      }
      const next = cur.replace(trimmed, () => out);
      texts.set(node, { o: cur, t: next });
      node.nodeValue = next;
    }

    // Handle React-interpolated pure-text elements (e.g. ["No ", "automations", " yet"] inside <p>).
    function doSplitTextElement(el) {
      if (!bundle || !el || !el.childNodes || el.childNodes.length < 2) return false;
      const children = [];
      let combined = '';
      for (let i = 0; i < el.childNodes.length; i += 1) {
        const ch = el.childNodes[i];
        if (!ch || ch.nodeType !== 3) return false;
        const rec = texts.get(ch);
        if (rec && ch.nodeValue === rec.t) return false;
        const val = typeof ch.nodeValue === 'string' ? ch.nodeValue : '';
        children.push({ node: ch, val });
        combined += val;
      }
      const trimmed = combined.trim();
      if (!trimmed || trimmed.length > 300 || !/[A-Za-z]/.test(trimmed)) return false;
      const zone = zoneOf(el);
      if (!zone) return false;
      const out = convert(trimmed, zone, el);
      if (out == null || out === trimmed) return false;
      const nextFirst = combined.replace(trimmed, () => out);
      texts.set(children[0].node, { o: children[0].val, t: nextFirst });
      children[0].node.nodeValue = nextFirst;
      for (let i = 1; i < children.length; i += 1) {
        texts.set(children[i].node, { o: children[i].val, t: '' });
        children[i].node.nodeValue = '';
      }
      return true;
    }

    function doAttrs(el, only) {
      if (!bundle || !el || closestSel(el, optOutSel)) return;
      let zone = -1;
      for (const name of only ? [only] : ATTRS) {
        const cur = typeof el.getAttribute === 'function' ? el.getAttribute(name) : null;
        if (cur == null) continue;
        const recs = attrs.get(el);
        const rec = recs && recs[name];
        if (rec && cur === rec.t) continue;
        if (zone < 0) {
          zone = matchesSel(el, FIELD) ? zoneOf(el.parentElement) : zoneOf(el);
        }
        const trimmed = cur.trim();
        const out = zone && trimmed ? convert(trimmed, zone, el) : null;
        if (out == null || out === trimmed) {
          if (rec) delete recs[name];
          continue;
        }
        const next = cur.replace(trimmed, () => out);
        (recs || attrs.set(el, {}).get(el))[name] = { o: cur, t: next };
        el.setAttribute(name, next);
      }
    }

    function walkControlsIn(el) {
      if (!el || typeof el.querySelectorAll !== 'function' || closestSel(el, optOutSel)) return;
      for (const ctl of el.querySelectorAll(controlsSel)) {
        if (!closestSel(ctl, optOutSel)) walk(ctl);
      }
    }

    function walk(root) {
      if (!bundle || !root) return;
      if (root.nodeType === 3) return doText(root);
      if (root.nodeType !== 1 && root.nodeType !== 9) return;
      if (root.nodeType === 1) {
        if (closestSel(root, optOutSel)) return;
        const fenced = closestSel(root, HARD) || closestSel(root, contentSel);
        if (fenced && !(closestSel(root, controlsSel) && fenced.contains(closestSel(root, controlsSel)))) {
          if (matchesSel(root, FIELD)) doAttrs(root);
          return walkControlsIn(root);
        }
        doAttrs(root);
        doSplitTextElement(root);
      }
      const doc = activeDoc || root.ownerDocument || root;
      if (!doc || typeof doc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return;
      const contents = [];
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
          if (matchesSel(n, optOutSel)) return NodeFilter.FILTER_REJECT;
          if (matchesSel(n, HARD) || matchesSel(n, contentSel)) {
            if (matchesSel(n, FIELD)) doAttrs(n);
            contents.push(n);
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.nodeType === 3) doText(n);
        else {
          doAttrs(n);
          doSplitTextElement(n);
        }
      }
      for (const c of contents) walkControlsIn(c);
    }

    function prune() {
      for (const n of texts.keys()) if (!n.isConnected) texts.delete(n);
      for (const el of attrs.keys()) if (!el.isConnected) attrs.delete(el);
    }

    function stopObserver() {
      if (observer) {
        try {
          observer.disconnect();
        } catch {}
        observer = null;
      }
    }

    function revertDom() {
      stopObserver();
      for (const [n, r] of texts) {
        if (n.nodeValue === r.t) n.nodeValue = r.o;
      }
      for (const [el, recs] of attrs) {
        for (const name in recs) {
          if (el.getAttribute(name) === recs[name].t) el.setAttribute(name, recs[name].o);
        }
      }
      texts.clear();
      attrs.clear();
    }

    function restoreHtmlLang(doc) {
      const html = doc?.documentElement;
      if (!html || !htmlLangCaptured) return;
      if (origHtmlLang == null) html.removeAttribute('lang');
      else html.setAttribute('lang', origHtmlLang);
      html.removeAttribute('data-ag-cs-cjk');
    }

    function revertNode(root) {
      if (!root) return;
      const visit = (n) => {
        if (!n) return;
        if (n.nodeType === 3) {
          const r = texts.get(n);
          if (r) {
            if (n.nodeValue === r.t) n.nodeValue = r.o;
            texts.delete(n);
          }
          return;
        }
        if (n.nodeType !== 1 && n.nodeType !== 9) return;
        if (n.nodeType === 1 && attrs.has(n)) {
          const recs = attrs.get(n);
          for (const name in recs) {
            if (typeof n.getAttribute === 'function' && n.getAttribute(name) === recs[name].t) {
              n.setAttribute(name, recs[name].o);
            }
          }
          attrs.delete(n);
        }
        const list = n.childNodes || n.children || [];
        for (let i = 0; i < list.length; i += 1) visit(list[i]);
      };
      visit(root);
    }

    function translateNode(root) {
      if (!bundle || !root) return;
      walk(root);
    }

    function revert(doc = activeDoc) {
      revertDom();
      clearBundleState();
      restoreHtmlLang(doc);
      activeLang = 'en';
    }

    function setLanguage(lang, doc, forceReload = false) {
      const targetDoc = doc || activeDoc || (typeof document !== 'undefined' ? document : null);
      activeDoc = targetDoc;
      const norm = normalizeLanguage(lang);
      const html = targetDoc?.documentElement;
      if (html && !htmlLangCaptured) {
        origHtmlLang = html.getAttribute('lang');
        htmlLangCaptured = true;
      }
      if (!forceReload && norm === activeLang && (norm === 'en' || (bundle && observer))) {
        return norm;
      }

      revertDom();
      clearBundleState();
      activeLang = norm;

      if (norm === 'en') {
        restoreHtmlLang(targetDoc);
        return norm;
      }

      const nextBundle = typeof resolveBundle === 'function' ? resolveBundle(norm) : null;
      if (!nextBundle) {
        restoreHtmlLang(targetDoc);
        return norm;
      }

      compileBundle(nextBundle);
      if (html) {
        html.setAttribute('lang', htmlLangAttr(norm));
        html.setAttribute('data-ag-cs-cjk', '1');
      }

      if (!targetDoc || typeof targetDoc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') {
        return norm;
      }

      const MO = typeof MutationObserver === 'function' ? MutationObserver : targetDoc.defaultView?.MutationObserver;
      if (typeof MO === 'function') {
        observer = new MO((records) => {
          const added = new Set();
          for (let i = 0; i < records.length; i += 1) {
            const r = records[i];
            if (r.type === 'characterData') {
              if (r.target && r.target.isConnected !== false) doText(r.target);
            } else if (r.type === 'attributes') {
              if (r.target && r.target.isConnected !== false) doAttrs(r.target, r.attributeName);
            } else if (r.addedNodes && r.addedNodes.length) {
              for (let j = 0; j < r.addedNodes.length; j += 1) {
                const n = r.addedNodes[j];
                if (n && n.isConnected !== false) added.add(n);
              }
            }
          }
          if (added.size > 0) {
            for (const n of added) {
              // Skip if an ancestor is already queued in this batch.
              let covered = false;
              for (let p = n.parentElement; p; p = p.parentElement) {
                if (added.has(p)) {
                  covered = true;
                  break;
                }
              }
              if (!covered) walk(n);
            }
          }
          if (++sincePrune > 500) {
            sincePrune = 0;
            prune();
          }
        });
        observer.observe(targetDoc, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ATTRS,
        });
      }

      walk(targetDoc);
      return norm;
    }

    function missing(doc = activeDoc) {
      const targetDoc = doc || activeDoc;
      if (!targetDoc?.body || typeof targetDoc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') {
        return [];
      }
      const seen = new Set();
      const w = targetDoc.createTreeWalker(targetDoc.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode;
        const t = (n.nodeValue || '').trim();
        if (!/[A-Za-z]{2}/.test(t) || texts.has(n)) continue;
        const p = n.parentElement;
        if (!p || zoneOf(p) !== 2) continue;
        if (typeof p.getClientRects === 'function' && !p.getClientRects().length) continue;
        seen.add(t);
      }
      if (typeof targetDoc.querySelectorAll === 'function') {
        for (const el of targetDoc.querySelectorAll('[aria-label],[placeholder],[title]')) {
          if (closestSel(el, optOutSel) || zoneOf(el) !== 2) continue;
          const recs = attrs.get(el) || {};
          for (const a of ['aria-label', 'placeholder', 'title']) {
            const v = el.getAttribute(a);
            if (v && /[A-Za-z]{2}/.test(v) && !recs[a]) seen.add('@' + a + ': ' + v);
          }
        }
      }
      return [...seen];
    }

    function setExtraOptOut(nextList, doc = activeDoc) {
      const targetDoc = doc || activeDoc || (typeof document !== 'undefined' ? document : null);
      const cleaned = sanitizeExtraSelectors(nextList, targetDoc);
      const nextSel = joinSel(OPT_OUT, cleaned);
      if (nextSel === optOutSel) return cleaned;
      extraOptOut = cleaned;
      optOutSel = nextSel;
      if (bundle && targetDoc) {
        // Revert any nodes now covered by opt-out selectors, and re-walk to restore any newly un-ignored nodes.
        if (typeof targetDoc.querySelectorAll === 'function') {
          for (const sel of cleaned) {
            try {
              for (const el of targetDoc.querySelectorAll(sel)) revertNode(el);
            } catch {}
          }
        }
        walk(targetDoc);
      }
      return cleaned;
    }

    function destroy() {
      revert(activeDoc);
      activeDoc = null;
    }

    return {
      get locale() {
        return activeLang;
      },
      setLanguage,
      setExtraOptOut,
      revertNode,
      translateNode,
      revert,
      destroy,
      missing,
      stats: () => ({ lang: activeLang, texts: texts.size, attrs: attrs.size, extraOptOut: extraOptOut.length }),
      t: (text, el) => convert(String(text || '').trim(), 2, el || activeDoc?.body || null),
    };
  }

  return {
    LANG_OPTIONS,
    OPT_OUT_PROTOCOL,
    normalizeLanguage,
    intlLocale,
    htmlLangAttr,
    isCjkLanguage,
    formatDuration,
    createDomTranslator,
  };
});
