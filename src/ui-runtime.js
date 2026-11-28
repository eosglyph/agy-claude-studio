(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.__agCsUiMain = factory;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (initialConfig) {
  const sidecarCore = globalThis.__agCsSidecarCore;
  if (sidecarCore && typeof location !== 'undefined' && sidecarCore.isSidecarLocation(location)) {
    return sidecarCore.mountSidecar(initialConfig);
  }

  const VERSION = 2;
  const CODE_HASH = initialConfig?.codeHash || '';
  if (window.__agTokenHud) {
    try {
      window.__agTokenHud.destroy();
    } catch {}
    delete window.__agTokenHud;
  }
  document
    .querySelectorAll(
      '#ag-token-hud-style, .ag-th-top-bar, .ag-th-bottom-bar, .ag-th-rim-progress, .ag-th-footer-chip, .ag-th-popover, .ag-th-turn-bar, .ag-th-reopen-pill'
    )
    .forEach((n) => n.remove());

  if (
    window.__agClaudeStudio &&
    window.__agClaudeStudio.version === VERSION &&
    (!CODE_HASH || window.__agClaudeStudio.codeHash === CODE_HASH)
  ) {
    window.__agClaudeStudio.refreshConfig(initialConfig);
    return;
  }
  if (Array.isArray(globalThis.__agCsCleanups)) {
    while (globalThis.__agCsCleanups.length) {
      const fn = globalThis.__agCsCleanups.pop();
      try {
        if (typeof fn === 'function') fn();
      } catch {}
    }
  }
  if (window.__agClaudeStudio) {
    try {
      window.__agClaudeStudio.destroy();
    } catch {}
    delete window.__agClaudeStudio;
  }
  if (window.__agClaudeStyle) {
    try {
      window.__agClaudeStyle.destroy();
    } catch {}
    delete window.__agClaudeStyle;
  }

  if (window.__agCsI18n && typeof window.__agCsI18n.destroy === 'function') {
    try {
      window.__agCsI18n.destroy();
    } catch {}
    delete window.__agCsI18n;
  }

  const usageCore = globalThis.__agCsUsageCore;
  const rippleCore = globalThis.__agCsRippleCore;
  const mascotCore = globalThis.__agCsMascotCore;
  const crabAssets = globalThis.__agCsCrabAssets;
  const effortCore = globalThis.__agCsEffortCore;
  const periodicCore = globalThis.__agCsPeriodicCore;
  const i18nCore = globalThis.__agCsI18nCore;
  const i18nLocales = globalThis.__agCsLocales;

  function nodeContains(parent, child) {
    if (!parent || !child) return false;
    if (typeof parent.contains === 'function') return parent.contains(child);
    let cur = child;
    while (cur) {
      if (cur === parent) return true;
      cur = cur.parentElement || cur.parentNode || null;
    }
    return false;
  }

  function isExplicitDarkPalette(val) {
    return val === 'obsidian-dark' || val === 'claude-dark';
  }

  function isExplicitLightPalette(val) {
    return val === 'obsidian' || val === 'claude';
  }

  function normalizePaletteId(val) {
    if (
      val === 'claude' ||
      val === 'claude-dark' ||
      val === 'obsidian' ||
      val === 'obsidian-dark' ||
      val === 'host'
    ) {
      return val;
    }
    return 'obsidian';
  }

  function getEffectivePalette() {
    return normalizePaletteId(cfg && cfg.palette);
  }

  function getPaletteDisplayName(val, lang) {
    const ui = uiText(lang);
    const p = normalizePaletteId(val);
    if (p === 'claude-dark') return ui.optClaudeDark || 'Claude (Dark)';
    if (p === 'claude') return ui.optClaude || 'Claude (Light)';
    if (p === 'obsidian-dark') return ui.optObsidianDark || 'Obsidian (Dark)';
    if (p === 'host') return ui.optHost || 'Host';
    return ui.optObsidian || 'Obsidian (Light)';
  }

  function isUsageStatsEnabled() {
    if (typeof cfg.usageStatsEnabled === 'boolean') return cfg.usageStatsEnabled;
    if (typeof cfg.usageMonitorCompat === 'boolean') return !cfg.usageMonitorCompat;
    return true;
  }
  let activeI18nPackOverride = null;
  function resolveActiveLocaleBundle(targetLang) {
    if (
      activeI18nPackOverride &&
      typeof activeI18nPackOverride === 'object' &&
      activeI18nPackOverride.lang === targetLang
    ) {
      return activeI18nPackOverride;
    }
    return i18nLocales && typeof i18nLocales.resolveLocaleBundle === 'function'
      ? i18nLocales.resolveLocaleBundle(targetLang)
      : null;
  }

  const domTranslator =
    i18nCore && i18nLocales && typeof i18nCore.createDomTranslator === 'function'
      ? i18nCore.createDomTranslator(resolveActiveLocaleBundle)
      : null;
  if (domTranslator && typeof window !== 'undefined') {
    window.__agCsI18n = domTranslator;
  }

  const STORAGE_SETTINGS_KEY = 'agClaudeStyle.settings.v1';
  const STORAGE_FILE_CFG_KEY = 'agClaudeStyle.lastFileConfig.v1';
  const STORAGE_USAGE_CACHE_KEY = 'agClaudeStyle.trajRollup.v1';
  const STORAGE_LAST_STD_MODEL_KEY = 'agClaudeStyle.lastStdModel.v1';
  const STORAGE_LAST_ORCH_PLANNER_KEY = 'agClaudeStyle.lastOrchPlanner.v1';

  let lastStandardModelMeta = null;
  try {
    const rawStd = JSON.parse(localStorage.getItem(STORAGE_LAST_STD_MODEL_KEY) || 'null');
    if (rawStd && typeof rawStd === 'object') lastStandardModelMeta = rawStd;
  } catch {}

  let lastOrchPlannerMeta = null;
  let restoredOrchPlannerOnce = false;
  try {
    const rawOrch = JSON.parse(localStorage.getItem(STORAGE_LAST_ORCH_PLANNER_KEY) || 'null');
    if (rawOrch && typeof rawOrch === 'object') lastOrchPlannerMeta = rawOrch;
  } catch {}

  function rememberOrchestratorPlanner(opt) {
    if (!opt || !periodicCore) return;
    const label = String(opt.label || opt.modelId || '').trim();
    if (!label && (opt.value === undefined || opt.value === null || opt.value === 0)) return;
    const parsed = periodicCore.parseOptionEffort(label);
    const el =
      typeof periodicCore.matchGemini4Element === 'function'
        ? periodicCore.matchGemini4Element(parsed.base || label)
        : null;
    const next = {
      value: opt.value,
      modelId: String(opt.modelId || ''),
      label,
      effortId: parsed.effortId || '',
      symbol: el ? el.symbol : '',
    };
    if (
      lastOrchPlannerMeta &&
      lastOrchPlannerMeta.value === next.value &&
      lastOrchPlannerMeta.modelId === next.modelId &&
      lastOrchPlannerMeta.label === next.label
    ) {
      return;
    }
    lastOrchPlannerMeta = next;
    try {
      localStorage.setItem(STORAGE_LAST_ORCH_PLANNER_KEY, JSON.stringify(next));
    } catch {}
  }

  function syncOrRestoreOrchestratorPlanner(fp, state) {
    if (!state?.isOrchestrator || !fp || !Array.isArray(fp.orchestratorPlanners) || !fp.orchestratorPlanners.length) {
      return;
    }
    const planners = fp.orchestratorPlanners.filter((p) => p && !p.disabled);
    if (!planners.length) return;
    const pick = fp.orchestratorPick;
    if (!pick || typeof pick !== 'object') return;

    const pickVal = pick.model;
    if (pickVal !== undefined && pickVal !== null && pickVal !== 0) {
      restoredOrchPlannerOnce = true;
      const liveHit = planners.find((p) => p.value === pickVal || p.modelId === pickVal);
      if (liveHit) rememberOrchestratorPlanner(liveHit);
      return;
    }

    if (restoredOrchPlannerOnce || typeof pick.select !== 'function') return;
    restoredOrchPlannerOnce = true;

    const activeSym = String(state.activeSymbol || '');
    const getPlannerSym = (p) => {
      if (!p || typeof periodicCore?.matchGemini4Element !== 'function') return '';
      const parsed = periodicCore.parseOptionEffort(p.label || p.modelId || '');
      const el = periodicCore.matchGemini4Element(parsed.base || p.label || '');
      return el ? el.symbol : '';
    };

    let target = null;
    if (lastOrchPlannerMeta) {
      const candidate =
        planners.find(
          (p) =>
            (lastOrchPlannerMeta.value !== undefined && p.value === lastOrchPlannerMeta.value) ||
            (lastOrchPlannerMeta.modelId && p.modelId === lastOrchPlannerMeta.modelId) ||
            (lastOrchPlannerMeta.label && p.label === lastOrchPlannerMeta.label)
        ) || null;
      if (candidate && (!activeSym || !getPlannerSym(candidate) || getPlannerSym(candidate) === activeSym)) {
        target = candidate;
      }
    }
    if (!target && lastStandardModelMeta && typeof periodicCore?.findMatchingOrchestratorPlanner === 'function') {
      const candidate = periodicCore.findMatchingOrchestratorPlanner(
        planners,
        lastStandardModelMeta,
        lastStandardModelMeta.effortId
      );
      if (candidate && (!activeSym || !getPlannerSym(candidate) || getPlannerSym(candidate) === activeSym)) {
        target = candidate;
      }
    }
    if (!target || target.value === undefined || target.value === null) return;
    if (fp.orchestratorDefaultPlanner && fp.orchestratorDefaultPlanner.value === target.value) {
      return;
    }
    try {
      rememberOrchestratorPlanner(target);
      pick.select(target.value);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => scheduleSync());
      } else {
        scheduleSync();
      }
    } catch {}
  }

  function rememberStandardModel(opt) {
    if (!opt || !periodicCore) return;
    if (typeof periodicCore.parseOrchestratorOption === 'function' && periodicCore.parseOrchestratorOption(opt)) {
      return;
    }
    const label = String(opt.label || opt.modelId || '').trim();
    if (!label) return;
    const parsed = periodicCore.parseOptionEffort(label);
    const next = {
      modelId: String(opt.modelId || ''),
      label,
      value: opt.value,
      effortId: parsed.effortId || '',
    };
    if (
      lastStandardModelMeta &&
      lastStandardModelMeta.modelId === next.modelId &&
      lastStandardModelMeta.label === next.label &&
      lastStandardModelMeta.effortId === next.effortId
    ) {
      return;
    }
    lastStandardModelMeta = next;
    try {
      localStorage.setItem(STORAGE_LAST_STD_MODEL_KEY, JSON.stringify(next));
    } catch {}
  }

  function loadSettings(base) {
    try {
      const cleanBase = { ...base };
      delete cleanBase.binding;
      delete cleanBase.pollIntervalMs;
      delete cleanBase.codeHash;
      const baseJson = JSON.stringify(cleanBase);
      const prevBaseJson = localStorage.getItem(STORAGE_FILE_CFG_KEY);
      let saved = {};
      try {
        const rawSaved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY) || '{}');
        if (rawSaved && typeof rawSaved === 'object') saved = rawSaved;
      } catch {}
      if (prevBaseJson && prevBaseJson !== baseJson) {
        // 3-way diff merge: only keys modified externally in config.json override saved UI state.
        let prevBase = {};
        try {
          prevBase = JSON.parse(prevBaseJson) || {};
        } catch {}
        const merged = { ...saved };
        for (const key of Object.keys(cleanBase)) {
          if (prevBase[key] !== cleanBase[key]) {
            merged[key] = cleanBase[key];
          }
        }
        localStorage.setItem(STORAGE_FILE_CFG_KEY, baseJson);
        localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(merged));
        return { ...base, ...merged };
      }
      if (!prevBaseJson) localStorage.setItem(STORAGE_FILE_CFG_KEY, baseJson);
      return { ...base, ...saved };
    } catch {
      return { ...base };
    }
  }

  let runtimeInitConfig = { ...initialConfig };
  let cfg = loadSettings(runtimeInitConfig);
  let destroyed = false;

  function saveSetting(key, value) {
    cfg[key] = value;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY) || '{}');
      saved[key] = value;
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(saved));
    } catch {}
    try {
      const send = window[cfg.binding];
      if (typeof send === 'function') send(JSON.stringify({ key, value }));
    } catch {}
    applyRootAttrs();
    scheduleSync();
  }

  function getLang() {
    const raw = cfg.language || initialConfig?.language || 'zh-CN';
    if (i18nCore && typeof i18nCore.normalizeLanguage === 'function') {
      return i18nCore.normalizeLanguage(raw);
    }
    return raw === 'zh-TW' || raw === 'yue' || raw === 'en' || raw === 'ja' ? raw : 'zh-CN';
  }

  function uiText(lang = getLang()) {
    if (i18nLocales && typeof i18nLocales.getUiStrings === 'function') {
      return i18nLocales.getUiStrings(lang);
    }
    return {};
  }

  function isZh() {
    const lang = getLang();
    return lang === 'zh-CN' || lang === 'zh-TW' || lang === 'yue';
  }

  function fmtBucketReset(bucket, lang = getLang()) {
    if (!bucket) return '';
    if (bucket.resetSeconds > 0 && typeof usageCore?.fmtResetTime === 'function') {
      return usageCore.fmtResetTime(bucket.resetSeconds, lang) || bucket.resetIn || '';
    }
    return bucket.resetIn || '';
  }

  function isDarkTheme() {
    const p = getEffectivePalette();
    if (isExplicitDarkPalette(p)) return true;
    if (isExplicitLightPalette(p)) return false;
    const b = document.body?.classList;
    const h = document.documentElement?.classList;
    if (b?.contains('theme-light') || b?.contains('light-theme') || b?.contains('light')) return false;
    if (b?.contains('theme-dark') || b?.contains('dark') || b?.contains('dark-theme')) return true;
    if (h?.contains('theme-light') || h?.contains('light-theme') || h?.contains('light')) return false;
    if (h?.contains('theme-dark') || h?.contains('dark') || h?.contains('dark-theme')) return true;
    return true;
  }

  let lastThemeKey = '';
  let lastAppliedLang = '';
  let lastAppliedI18nPackHash = '';

  function refreshOpenContextPopover() {
    if (!openPopover || !openPopover.isConnected) return;
    const latest = activeTrajCache.get(openPopoverCascadeId)?.data || null;
    renderContextPopoverContent(openPopover, latest, openPopoverCascadeId);
    if (openPopoverAnchor && openPopoverAnchor.isConnected) {
      positionPopoverAboveAnchor(openPopover, openPopoverAnchor);
    }
  }

  function refreshOpenUiForLanguage() {
    const inHero = Boolean(document.querySelector('.agy-home [data-testid="home-greeting"]'));
    syncGreeting(inHero);
    if (inHero && cfg.homeLayout === 'studio') renderHomePanel(true);
    refreshOpenEffortPopover();
    refreshOpenContextPopover();
    refreshOpenPeriodicSelector();
    syncComposers();
    syncPluginDetailTranslateButton();
    ensureSettingsSection();
  }

  function cleanupLegacyAuroraArtifacts() {
    const html = document.documentElement;
    if (html) {
      html.removeAttribute('data-ag-custom-theme');
      html.removeAttribute('data-aux-pane-maximized');
      for (const oldAttr of [
        'data-ag-cs-fx-glass',
        'data-ag-cs-fx-scrollbar',
        'data-ag-cs-fx-voice',
        'data-ag-cs-fx-media',
        'data-ag-cs-fx-glow',
        'data-ag-cs-fx-terminal',
      ]) {
        html.removeAttribute(oldAttr);
      }
      if (html.style && typeof html.style.removeProperty === 'function') {
        html.style.removeProperty('--antigravity-active-theme-id');
      }
    }
    document
      .querySelectorAll('style#ag-cs-aurora-theme-css, #ag-cs-theme-selector, #ag-cs-theme-dropdown')
      .forEach((el) => el.remove());
  }

  const PERIODIC_DYNAMIC_STYLE_ID = 'ag-cs-periodic-dynamic';
  let psSyncState = { status: 'idle', label: '', timer: null, reqId: '' };

  function applyPeriodicOverride(override) {
    if (periodicCore && typeof periodicCore.setDynamicSpecs === 'function') {
      periodicCore.setDynamicSpecs(override && override.specs ? override.specs : null);
    }
    const cssText = override && typeof override.css === 'string' ? override.css : '';
    const existing = document.getElementById(PERIODIC_DYNAMIC_STYLE_ID);
    if (!cssText) {
      if (existing) existing.remove();
      return;
    }
    const targetParent = document.head || document.documentElement;
    if (!targetParent) return;
    let styleEl = existing;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = PERIODIC_DYNAMIC_STYLE_ID;
      targetParent.appendChild(styleEl);
    }
    if (styleEl.textContent !== cssText) styleEl.textContent = cssText;
  }

  window.__agCsOnPeriodicSyncResult = function (res) {
    if (!res || typeof res !== 'object') return;
    if (psSyncState.reqId && res.requestId && res.requestId !== psSyncState.reqId) return;
    if (psSyncState.timer) {
      clearTimeout(psSyncState.timer);
      psSyncState.timer = null;
    }
    const lang = getLang();
    const ui = uiText(lang);
    if (res.ok) {
      if (res.override) {
        cfg.periodicOverride = res.override;
        applyPeriodicOverride(res.override);
      }
      const total = Number(res.totalElements || 0);
      const added = Array.isArray(res.newSymbols) ? res.newSymbols : [];
      const doneLbl = added.length
        ? `${ui.psSyncAdded || 'Added'} ${added.join(', ')} (${total})`
        : `${ui.psSyncDone || 'Synced'} (${total})`;
      psSyncState = { status: 'synced', label: doneLbl, timer: null, reqId: '' };
      psSyncState.timer = setTimeout(() => {
        psSyncState = { status: 'idle', label: '', timer: null, reqId: '' };
        refreshOpenPeriodicSelector();
      }, 4000);
      refreshOpenPeriodicSelector();
    } else {
      psSyncState = {
        status: 'fallback',
        label: ui.psSyncFailFallback || 'Direct sync failed · Use prompt',
        timer: null,
        reqId: '',
      };
      psSyncState.timer = setTimeout(() => {
        psSyncState = { status: 'idle', label: '', timer: null, reqId: '' };
        refreshOpenPeriodicSelector();
      }, 10000);
      refreshOpenPeriodicSelector();
    }
  };

  let effortConfigGeneration = 0;
  let lastEffortSliderEnabled = null;
  let pendingEffortBadgeRaf = 0;

  function cancelPendingEffortBadgeRaf() {
    if (pendingEffortBadgeRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pendingEffortBadgeRaf);
      pendingEffortBadgeRaf = 0;
    }
  }

  function isEffortSliderEnabled() {
    if (cfg.effortSlider === false) return false;
    const styleMode =
      effortCore && typeof effortCore.normalizeEffortStyle === 'function'
        ? effortCore.normalizeEffortStyle(cfg.effortSliderStyle)
        : String(cfg.effortSliderStyle || '').trim().toLowerCase();
    return styleMode !== 'off';
  }

  function cleanupEffortBadgesInDom() {
    if (openEffortPop) closeEffortPopover();
    const btns = document.querySelectorAll('[data-testid="model-selector-trigger"]');
    for (const modelBtn of btns) {
      for (const el of modelBtn.querySelectorAll('.ag-cs-effort-badge, [data-ag-cs-effort]')) {
        if (el.hasAttribute('data-ag-cs-effort')) el.removeAttribute('data-ag-cs-effort');
        if (el.classList.contains('ag-cs-effort-badge')) el.classList.remove('ag-cs-effort-badge');
      }
      if (modelBtn.hasAttribute('data-ag-cs-has-effort')) {
        modelBtn.removeAttribute('data-ag-cs-has-effort');
      }
      if (modelBtn.style?.getPropertyValue?.('--ag-cs-effort-cut')) {
        modelBtn.style.removeProperty('--ag-cs-effort-cut');
      }
      modelBtn._agCsHasEffortTagged = false;
    }
  }

  function applyRootAttrs() {
    const html = document.documentElement;
    if (!html) return;
    const setHtmlAttr = (name, val) => {
      if (html.getAttribute(name) !== val) html.setAttribute(name, val);
    };
    const removeHtmlAttr = (name) => {
      const has = typeof html.hasAttribute === 'function' ? html.hasAttribute(name) : html.getAttribute(name) !== null;
      if (has) html.removeAttribute(name);
    };
    applyPeriodicOverride(cfg.periodicOverride || null);
    const palette = getEffectivePalette();
    const lang = getLang();
    const dark = isDarkTheme();
    const nextEffortEnabled = isEffortSliderEnabled();
    if (lastEffortSliderEnabled !== null && lastEffortSliderEnabled !== nextEffortEnabled) {
      effortConfigGeneration += 1;
      cancelPendingEffortBadgeRaf();
      if (!nextEffortEnabled) cleanupEffortBadgesInDom();
    }
    lastEffortSliderEnabled = nextEffortEnabled;
    setHtmlAttr('data-ag-cs-style', '1');
    setHtmlAttr('data-ag-cs-palette', palette);
    setHtmlAttr('data-ag-cs-glass', cfg.glassEffect === false ? 'off' : 'on');
    setHtmlAttr('data-ag-cs-home', cfg.homeLayout === 'classic' ? 'classic' : cfg.homeLayout === 'off' ? 'off' : 'studio');
    setHtmlAttr('data-ag-cs-composer', cfg.composerRestyle === false ? 'off' : 'on');
    setHtmlAttr('data-ag-cs-logo-ink', cfg.logoInk === 'foreground' ? 'foreground' : 'accent');
    setHtmlAttr('data-ag-cs-gemini-loader', cfg.geminiLoader === false ? 'off' : 'on');
    setHtmlAttr('data-ag-cs-sidebar', cfg.sidebarRestyle === false ? 'off' : 'on');
    setHtmlAttr('data-ag-cs-sidebar-compact', cfg.sidebarCompact === true ? 'on' : 'off');
    removeHtmlAttr('data-ag-cs-hud-compact');
    setHtmlAttr('data-ag-cs-effort-slider', nextEffortEnabled ? 'on' : 'off');
    setHtmlAttr('data-ag-cs-effort-accent', cfg.effortAccent === false ? 'off' : 'on');
    setHtmlAttr('data-ag-cs-periodic', cfg.periodicSelector === false ? 'off' : 'on');
    setHtmlAttr('data-ag-cs-lang', lang);
    const isCjk = i18nCore && typeof i18nCore.isCjkLanguage === 'function' ? i18nCore.isCjkLanguage(lang) : isZh();
    if (isCjk) setHtmlAttr('data-ag-cs-cjk', '1');
    else removeHtmlAttr('data-ag-cs-cjk');

    cleanupLegacyAuroraArtifacts();

    if (domTranslator && typeof domTranslator.setExtraOptOut === 'function') {
      const mergedOptOut = [
        ...(Array.isArray(cfg.i18nOptOutSelectors) ? cfg.i18nOptOutSelectors : []),
        ...(Array.isArray(cfg.i18nIgnoreSelectors) ? cfg.i18nIgnoreSelectors : []),
      ];
      domTranslator.setExtraOptOut(mergedOptOut, document);
    }

    activeI18nPackOverride =
      cfg.i18nPackOverride && typeof cfg.i18nPackOverride === 'object' && typeof cfg.i18nPackOverride.lang === 'string'
        ? cfg.i18nPackOverride
        : null;
    const nextPackHash = typeof cfg.i18nPackHash === 'string' ? cfg.i18nPackHash : '';
    const prevLang = lastAppliedLang;
    const prevPackHash = lastAppliedI18nPackHash;
    if (lang !== prevLang || nextPackHash !== prevPackHash) {
      lastAppliedLang = lang;
      lastAppliedI18nPackHash = nextPackHash;
      if (typeof window !== 'undefined' && window.__agI18n && typeof window.__agI18n.revert === 'function') {
        try {
          window.__agI18n.revert();
        } catch {}
      }
      if (domTranslator && typeof domTranslator.setLanguage === 'function') {
        domTranslator.setLanguage(lang, document, nextPackHash !== prevPackHash);
      }
      if (prevLang !== '') {
        refreshOpenUiForLanguage();
      }
    }

    const themeKey = `${palette}|${dark ? 'd' : 'l'}`;
    if (themeKey !== lastThemeKey) {
      const wasInitial = lastThemeKey === '';
      lastThemeKey = themeKey;
      if (rippleMount && typeof rippleMount.refreshTheme === 'function') {
        rippleMount.refreshTheme();
      }
      refreshOpenEffortPopover();
      refreshOpenPeriodicSelector();
      if (!wasInitial) {
        ensureSettingsSection();
      }
    }
  }

  // ── Antigravity React Fiber & Store Bridge ─────────────────────────────
  let cachedSvc = null;
  let cachedStore = null;
  let cachedTrajCtx = null;
  let trajCtxScannedAnchorCount = -1;
  let lastTrajAnchorEl = null;
  let storeUnsub = null;
  let storeDebounce = null;
  const cloudOnlyCascadeIds = new Set();
  const watchedAgentProviders = new Map(); // cascadeId -> { provider, disposable, timer }

  function sameCascadeId(a, b) {
    const sa = String(a || '').trim();
    const sb = String(b || '').trim();
    if (!sa || !sb) return false;
    if (sa === sb) return true;
    const tailA = sa.includes('/') ? sa.split('/').pop() : sa;
    const tailB = sb.includes('/') ? sb.split('/').pop() : sb;
    return Boolean(tailA && tailA === tailB);
  }

  function isTrajectoriesContext(v) {
    if (!v || typeof v !== 'object') return false;
    return (
      typeof v.getAgentStates === 'function' ||
      (typeof v.peek === 'function' && typeof v.subscribe === 'function')
    );
  }

  function isAppRootStore(s) {
    if (!s || typeof s.getState !== 'function') return false;
    try {
      const st = s.getState();
      return Boolean(
        st &&
          typeof st === 'object' &&
          ('trajectorySummaries' in st ||
            'cascadeTrajectorySummaries' in st ||
            'userStatus' in st ||
            'conversation' in st)
      );
    } catch {
      return false;
    }
  }

  function ensureHooks(allowPartial = false) {
    const anchors = document.querySelectorAll(
      '[data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="agent-response"], [data-testid="conversation-row-sidebar"], [data-testid="new-conversation-button"], [data-testid="home-greeting"]'
    );
    const primaryAnchor = anchors[0] || null;
    if (
      cachedSvc &&
      cachedStore &&
      isAppRootStore(cachedStore) &&
      (cachedTrajCtx || (trajCtxScannedAnchorCount === anchors.length && lastTrajAnchorEl === primaryAnchor))
    ) {
      return { svc: cachedSvc, store: cachedStore, trajCtx: cachedTrajCtx };
    }
    let bestRootStore = isAppRootStore(cachedStore) ? cachedStore : null;
    let fallbackStore = cachedStore || null;
    for (const el of anchors) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && el[key]; f && !(cachedSvc && bestRootStore && cachedTrajCtx); f = f.return) {
        const p = f.memoizedProps;
        if (p && p.store && typeof p.store.getState === 'function') {
          if (isAppRootStore(p.store)) bestRootStore = bestRootStore || p.store;
          else if (!fallbackStore) fallbackStore = p.store;
        }
        for (let d = f.dependencies && f.dependencies.firstContext; d; d = d.next) {
          const v = d.memoizedValue;
          if (!v || typeof v !== 'object') continue;
          if (!cachedSvc && typeof v.getCascadeTrajectory === 'function') cachedSvc = v;
          if (!cachedTrajCtx && isTrajectoriesContext(v)) cachedTrajCtx = v;
          if (v.store && typeof v.store.getState === 'function') {
            if (isAppRootStore(v.store)) bestRootStore = bestRootStore || v.store;
            else if (!fallbackStore) fallbackStore = v.store;
          }
        }
      }
      if (cachedSvc && bestRootStore && cachedTrajCtx) break;
    }
    trajCtxScannedAnchorCount = anchors.length;
    lastTrajAnchorEl = primaryAnchor;
    const chosenStore = bestRootStore || fallbackStore;
    if (chosenStore && chosenStore !== cachedStore) {
      if (storeUnsub) {
        try {
          storeUnsub();
        } catch {}
        storeUnsub = null;
      }
      cachedStore = chosenStore;
    }
    if (cachedStore && !storeUnsub && typeof cachedStore.subscribe === 'function') {
      storeUnsub = cachedStore.subscribe(() => {
        if (destroyed || storeDebounce) return;
        storeDebounce = setTimeout(() => {
          storeDebounce = null;
          if (!destroyed) onStoreChanged();
        }, 150);
      });
    }
    if (cachedSvc && cachedStore) return { svc: cachedSvc, store: cachedStore, trajCtx: cachedTrajCtx };
    if (allowPartial && (cachedSvc || cachedStore || cachedTrajCtx)) {
      return { svc: cachedSvc, store: cachedStore, trajCtx: cachedTrajCtx };
    }
    return null;
  }

  function findCascadeAgentStateProvider(cascadeId, scopeEl) {
    const id = String(cascadeId || '').trim();
    const peekFromTrajCtx = (ctx) => {
      if (!ctx || !id) return null;
      try {
        if (typeof ctx.peek === 'function') {
          const p = ctx.peek(id);
          if (p && typeof p.getState === 'function') return p;
        }
        if (typeof ctx.getAgentStates === 'function') {
          const states = ctx.getAgentStates();
          if (states instanceof Map) {
            const direct = states.get(id);
            if (direct?.provider && typeof direct.provider.getState === 'function') return direct.provider;
            for (const [k, entry] of states.entries()) {
              if (sameCascadeId(k, id) && entry?.provider && typeof entry.provider.getState === 'function') {
                return entry.provider;
              }
            }
          } else if (states && typeof states === 'object') {
            const direct = states[id];
            if (direct?.provider && typeof direct.provider.getState === 'function') return direct.provider;
          }
        }
      } catch {}
      return null;
    };

    const fromCached = peekFromTrajCtx(cachedTrajCtx);
    if (fromCached) return fromCached;

    const probes = [];
    if (scopeEl) probes.push(scopeEl);
    const cv = document.querySelector('[data-testid="conversation-view"]');
    if (cv && !probes.includes(cv)) probes.push(cv);
    const ib = document.querySelector('[data-testid="agent-input-box"]');
    if (ib && !probes.includes(ib)) probes.push(ib);

    for (const el of probes) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && el[key], depth = 0; f && depth < 80; f = f.return, depth++) {
        for (let d = f.dependencies && f.dependencies.firstContext; d; d = d.next) {
          const v = d.memoizedValue;
          if (!v || typeof v !== 'object') continue;
          if (!cachedTrajCtx && isTrajectoriesContext(v)) {
            cachedTrajCtx = v;
            const hit = peekFromTrajCtx(v);
            if (hit) return hit;
          }
          const prov = v.cascadeContext?.state?.agentStateProvider || v.agentStateProvider;
          if (prov && typeof prov.getState === 'function') {
            try {
              const pCid = prov.getState()?.conversationId || '';
              if (!id || !pCid || sameCascadeId(pCid, id)) return prov;
            } catch {}
          }
        }
      }
    }
    return null;
  }

  function unwatchAgentStateProvider(cascadeId) {
    const rec = watchedAgentProviders.get(cascadeId);
    if (!rec) return;
    watchedAgentProviders.delete(cascadeId);
    if (rec.timer) {
      clearTimeout(rec.timer);
      rec.timer = null;
    }
    try {
      if (typeof rec.disposable === 'function') rec.disposable();
      else if (rec.disposable && typeof rec.disposable.dispose === 'function') rec.disposable.dispose();
    } catch {}
  }

  function unwatchAllAgentStateProviders() {
    for (const id of Array.from(watchedAgentProviders.keys())) {
      unwatchAgentStateProvider(id);
    }
  }

  function watchAgentStateProvider(cascadeId, provider) {
    if (destroyed || !cascadeId || !provider || typeof provider.onDidChange !== 'function') return;
    const existing = watchedAgentProviders.get(cascadeId);
    if (existing && existing.provider === provider) return;
    if (existing) unwatchAgentStateProvider(cascadeId);
    if (watchedAgentProviders.size >= 4) {
      for (const oldId of watchedAgentProviders.keys()) {
        if (oldId !== cascadeId) {
          unwatchAgentStateProvider(oldId);
          break;
        }
      }
    }
    const rec = { provider, disposable: null, timer: null };
    try {
      rec.disposable = provider.onDidChange(() => {
        if (destroyed || rec.timer) return;
        rec.timer = setTimeout(() => {
          rec.timer = null;
          if (destroyed) return;
          const cacheEntry = activeTrajCache.get(cascadeId);
          if (cacheEntry) cacheEntry.lastAt = 0;
          scheduleSync();
        }, 150);
      });
      watchedAgentProviders.set(cascadeId, rec);
    } catch {}
  }

  function hasUsableAgentState(state) {
    if (!state || typeof state !== 'object') return false;
    const slice = state.trajectorySlice;
    if (Array.isArray(slice?.stepsInSlice) && slice.stepsInSlice.length > 0) return true;
    if (Array.isArray(state.steps) && state.steps.length > 0) return true;
    if (state.contextWindowUsage && Number(state.contextWindowUsage.estimatedTokensUsed || 0) > 0) return true;
    return false;
  }

  function isCloudOnlyTrajectoryError(err) {
    const msg = String(err?.message || err || '');
    return /unimplemented|cloudproxy|GetConversation/i.test(msg);
  }

  async function fetchAgentStateSnapshot(cascadeId, h, timeoutMs = 3500) {
    if (!cascadeId || destroyed) return null;
    let prov = null;
    let cleanup = null;
    try {
      if (typeof h?.trajCtx?.subscribe === 'function') {
        const sub = h.trajCtx.subscribe(cascadeId);
        if (sub?.agentStateProvider && typeof sub.agentStateProvider.getState === 'function') {
          prov = sub.agentStateProvider;
          cleanup = () => {
            try {
              if (typeof sub.unsubscribe === 'function') sub.unsubscribe();
            } catch {}
          };
        }
      }
      if (!prov && typeof h?.svc?.createAgentStateProviderForConvo === 'function') {
        const created = h.svc.createAgentStateProviderForConvo(cascadeId);
        if (created && typeof created.getState === 'function') {
          prov = created;
          cleanup = () => {
            try {
              if (typeof created.dispose === 'function') created.dispose();
            } catch {}
          };
        }
      }
      if (!prov) return null;
      const initial = prov.getState();
      if (hasUsableAgentState(initial)) return initial;
      if (typeof prov.onDidChange === 'function' && timeoutMs > 0) {
        await new Promise((resolve) => {
          let settled = false;
          let disp = null;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
              if (typeof disp === 'function') disp();
              else if (disp && typeof disp.dispose === 'function') disp.dispose();
            } catch {}
            resolve();
          };
          const timer = setTimeout(finish, timeoutMs);
          try {
            disp = prov.onDidChange(() => {
              try {
                if (hasUsableAgentState(prov.getState())) finish();
              } catch {}
            });
          } catch {
            finish();
          }
          try {
            if (hasUsableAgentState(prov.getState())) finish();
          } catch {}
        });
      }
      return prov.getState();
    } catch {
      return null;
    } finally {
      if (cleanup) cleanup();
    }
  }

  function normalizeAgentStatePayload(state, cascadeId) {
    if (!state || typeof state !== 'object') return null;
    if (typeof usageCore?.normalizeAgentStateToTrajectory === 'function') {
      return usageCore.normalizeAgentStateToTrajectory(state, cascadeId);
    }
    const slice = state.trajectorySlice || {};
    return {
      trajectory: {
        cascadeId: String(cascadeId || state.conversationId || slice.conversationId || ''),
        steps: Array.isArray(slice.stepsInSlice) ? slice.stepsInSlice : Array.isArray(state.steps) ? state.steps : [],
        generatorMetadata: Array.isArray(slice.generatorMetadatasInSlice) ? slice.generatorMetadatasInSlice : [],
        executorMetadatas: Array.isArray(slice.executorMetadatasInSlice)
          ? slice.executorMetadatasInSlice
          : state.executorMetadata
          ? [state.executorMetadata]
          : [],
        contextWindowUsage: state.contextWindowUsage || null,
        agentStatus: Number(state.status || 0),
        fullyIdle: typeof state.fullyIdle === 'boolean' ? state.fullyIdle : undefined,
      },
    };
  }

  async function resolveTrajectoryPayload(cascadeId, sum, h, opts = {}) {
    if (!cascadeId) return null;
    const isCloud = Boolean(sum?.cloud === true || cloudOnlyCascadeIds.has(cascadeId));
    const liveProv = findCascadeAgentStateProvider(cascadeId, opts.scopeEl);
    const liveState = liveProv ? liveProv.getState?.() || null : null;
    if (liveProv && (isCloud || opts.watchLive)) {
      watchAgentStateProvider(cascadeId, liveProv);
    }

    if (isCloud) {
      if (hasUsableAgentState(liveState)) {
        return normalizeAgentStatePayload(liveState, cascadeId);
      }
      if (!liveProv || opts.allowTempStream) {
        const snap = await fetchAgentStateSnapshot(cascadeId, h, opts.timeoutMs || 3500);
        if (hasUsableAgentState(snap)) return normalizeAgentStatePayload(snap, cascadeId);
        if (snap) return normalizeAgentStatePayload(snap, cascadeId);
      }
      return liveState ? normalizeAgentStatePayload(liveState, cascadeId) : null;
    }

    if (typeof h?.svc?.getCascadeTrajectory === 'function') {
      try {
        const res = await h.svc.getCascadeTrajectory({ cascadeId });
        const traj = res?.response?.trajectory || res?.trajectory || res;
        if (
          res &&
          ((Array.isArray(traj?.steps) && traj.steps.length > 0) ||
            (Array.isArray(traj?.generatorMetadata) && traj.generatorMetadata.length > 0) ||
            !hasUsableAgentState(liveState))
        ) {
          return res;
        }
      } catch (err) {
        if (isCloudOnlyTrajectoryError(err)) {
          cloudOnlyCascadeIds.add(cascadeId);
          if (liveProv) watchAgentStateProvider(cascadeId, liveProv);
        }
      }
    }

    if (hasUsableAgentState(liveState)) {
      if (liveProv) watchAgentStateProvider(cascadeId, liveProv);
      return normalizeAgentStatePayload(liveState, cascadeId);
    }
    if (opts.allowTempStream !== false) {
      const snap = await fetchAgentStateSnapshot(cascadeId, h, opts.timeoutMs || 3500);
      if (snap) return normalizeAgentStatePayload(snap, cascadeId);
    }
    return liveState ? normalizeAgentStatePayload(liveState, cascadeId) : null;
  }

  function getDisplayName() {
    const h = ensureHooks(true);
    const raw = String(h?.store?.getState()?.userStatus?.name || '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0] || raw;
  }

  function normalizeCascadeId(raw) {
    const s = String(raw || '').trim();
    if (!s || s === 'conversation') return '';
    const m = s.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return m ? m[1] : s;
  }

  function resolveCascadeId(inputBox, opts = {}) {
    if (inputBox) {
      const selfAttrId = normalizeCascadeId(inputBox.getAttribute?.('data-cascade-id'));
      if (selfAttrId) return selfAttrId;
    }
    if (opts?.viewScopedOnly && !inputBox) return '';
    const cv = inputBox ? inputBox.closest('[data-testid="conversation-view"]') : document.querySelector('[data-testid="conversation-view"]');
    if (inputBox && !cv && inputBox.closest('.agy-home')) {
      return '';
    }
    if (cv) {
      const attrId = normalizeCascadeId(cv.getAttribute('data-cascade-id'));
      if (attrId) return attrId;
    }
    const readIdFromObj = (obj) => {
      if (!obj || typeof obj !== 'object') return '';
      if (typeof obj.cascadeId === 'string') {
        const id = normalizeCascadeId(obj.cascadeId);
        if (id) return id;
      }
      if (typeof obj.conversationId === 'string') {
        const id = normalizeCascadeId(obj.conversationId);
        if (id) return id;
      }
      if (typeof obj.trajectory?.cascadeId === 'string') {
        const id = normalizeCascadeId(obj.trajectory.cascadeId);
        if (id) return id;
      }
      const provCid =
        obj.cascadeContext?.state?.agentStateProvider?.getState?.()?.conversationId ||
        obj.agentStateProvider?.getState?.()?.conversationId ||
        '';
      if (typeof provCid === 'string') {
        const id = normalizeCascadeId(provCid);
        if (id) return id;
      }
      return '';
    };
    const readCascadeFromFiber = (el, maxDepth) => {
      if (!el) return '';
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && el[key], d = 0; f && d < maxDepth; f = f.return, d++) {
        const fromProps = readIdFromObj(f.memoizedProps) || readIdFromObj(f.pendingProps);
        if (fromProps) return fromProps;
        for (let ctx = f.dependencies && f.dependencies.firstContext; ctx; ctx = ctx.next) {
          const fromCtx = readIdFromObj(ctx.memoizedValue);
          if (fromCtx) return fromCtx;
        }
      }
      return '';
    };
    const fromInputFiber = readCascadeFromFiber(inputBox, 60);
    if (fromInputFiber) return fromInputFiber;
    const fromCvFiber = readCascadeFromFiber(cv, 40);
    if (fromCvFiber) return fromCvFiber;
    if (cv) {
      const resp = cv.querySelector('[data-testid="agent-response"]');
      const tf = resp && extractFiberTurnContainer(resp);
      const tfId = normalizeCascadeId(tf?.cascadeId);
      if (tfId) return tfId;
    }
    if (opts && opts.viewScopedOnly) return '';
    if (!inputBox?.closest?.('[data-testid="subagent-tab-conversation"]')) {
      const h = ensureHooks(true);
      const convoState = h?.store?.getState?.()?.conversation?.convoState;
      if (convoState?.type === 'active' && typeof convoState.cascadeId === 'string') {
        const id = normalizeCascadeId(convoState.cascadeId);
        if (id) return id;
      }
      if (convoState?.type === 'subagent' && typeof convoState.childConversationId === 'string') {
        const id = normalizeCascadeId(convoState.childConversationId);
        if (id) return id;
      }
    }
    const m = location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    if (m) return m[1];
    return '';
  }

  // ── Usage Rollup Store (Incremental localStorage cache + live refresh) ──
  const usageRecords = new Map(); // cascadeId -> record
  let usageLoading = false;
  let usageHasData = false;
  let lastUsageFetchAt = 0;
  let bookPick = 0.07; // picks Alice / classic benchmark stably per home mount, refreshed on return
  let activeTab = 'overview';
  let activeRange = 'all';
  let modelsExpanded = false;
  let lastPanelRenderKey = '';

  function loadUsageCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_USAGE_CACHE_KEY) || '{}');
      if (raw && typeof raw === 'object') {
        for (const [id, rec] of Object.entries(raw)) {
          if (rec && rec.days) usageRecords.set(id, rec);
        }
        if (usageRecords.size > 0) usageHasData = true;
      }
    } catch {}
  }

  function saveUsageCache() {
    try {
      const obj = {};
      for (const [id, rec] of usageRecords.entries()) obj[id] = rec;
      localStorage.setItem(STORAGE_USAGE_CACHE_KEY, JSON.stringify(obj));
    } catch {}
  }

  loadUsageCache();

  async function refreshUsageRollup(force = false) {
    if (destroyed || usageLoading) return;
    const h = ensureHooks();
    if (!h) return;
    const now = Date.now();
    if (!force && usageHasData && now - lastUsageFetchAt < 15000) return;
    const stRollup = h.store.getState();
    const sums = { ...(stRollup.cascadeTrajectorySummaries || {}), ...(stRollup.trajectorySummaries?.summaries || {}) };
    const entries = Object.entries(sums).filter(([, s]) => !!s);
    if (entries.length === 0) {
      usageHasData = true;
      renderHomePanel();
      return;
    }

    const staleIds = [];
    const presentIds = new Set();
    for (const [id, sum] of entries) {
      presentIds.add(id);
      const stepCount = Number(sum.stepCount || 0);
      const lastModSec = Math.floor(
        typeof usageCore?.tsSec === 'function' ? usageCore.tsSec(sum.lastModifiedTime) : Number(sum.lastModifiedTime?.seconds || 0)
      );
      const cached = usageRecords.get(id);
      const cachedSumSteps = cached && cached.summaryStepCount !== undefined ? cached.summaryStepCount : cached?.stepCount;
      const isCloudSum = Boolean(sum.cloud === true || cloudOnlyCascadeIds.has(id));
      const sameVersion =
        cached &&
        cached.lastModifiedSec === lastModSec &&
        (isCloudSum ? true : cachedSumSteps === stepCount);
      if (!sameVersion) {
        staleIds.push([id, sum, stepCount, lastModSec]);
      }
    }
    for (const oldId of Array.from(usageRecords.keys())) {
      if (!presentIds.has(oldId)) usageRecords.delete(oldId);
    }

    if (staleIds.length === 0) {
      usageHasData = true;
      lastUsageFetchAt = now;
      renderHomePanel();
      return;
    }

    usageLoading = true;
    renderHomePanel();
    try {
      const CONCURRENCY = 6;
      for (let i = 0; i < staleIds.length && !destroyed; i += CONCURRENCY) {
        const batch = staleIds.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async ([id, sum, stepCount, lastModSec]) => {
            try {
              const isCloudSum = Boolean(sum.cloud === true || cloudOnlyCascadeIds.has(id));
              const res = await resolveTrajectoryPayload(id, sum, h, {
                allowTempStream: isCloudSum ? !sum?.annotations?.archived : false,
                timeoutMs: 2500,
              });
              if (res) {
                const rec = usageCore.analyzeTrajectoryForUsage(res, sum, id);
                usageRecords.set(id, rec);
              } else if (isCloudSum) {
                usageRecords.set(id, {
                  cascadeId: String(id),
                  stepCount: 0,
                  summaryStepCount: stepCount,
                  lastModifiedSec: lastModSec,
                  subagent: typeof usageCore?.isSubagentSummary === 'function' ? usageCore.isSubagentSummary(sum) : false,
                  calls: 0,
                  days: {},
                });
              }
            } catch {}
          })
        );
      }
      if (!destroyed) {
        usageHasData = true;
        lastUsageFetchAt = Date.now();
        saveUsageCache();
      }
    } finally {
      usageLoading = false;
      if (!destroyed) renderHomePanel();
    }
  }

  // ── Home Greeting Copy Manager (reversible) ────────────────────────────
  const replacedGreetings = new Map();
  let wasHero = false;

  function syncGreeting(inHero) {
    if (inHero && !wasHero) {
      bookPick = Math.random();
      if (cfg.homeLayout === 'studio') refreshUsageRollup(false);
    }
    wasHero = inHero;

    const h1 = document.querySelector('[data-testid="home-greeting"] h1');
    if (!h1) return;

    if (cfg.homeLayout !== 'studio') {
      h1.removeAttribute('data-ag-no-i18n');
      const orig = replacedGreetings.get(h1);
      if (orig !== undefined) {
        if (h1.textContent !== orig.host) {
          h1.textContent = orig.host;
        }
        replacedGreetings.delete(h1);
      }
      if (domTranslator && typeof domTranslator.translateNode === 'function') {
        domTranslator.translateNode(h1);
      }
      return;
    }

    const name = getDisplayName();
    const target = name ? `What's up next, ${name}?` : "What's up next?";
    h1.setAttribute('data-ag-no-i18n', '');
    if (h1.textContent !== target) {
      if (domTranslator && typeof domTranslator.revertNode === 'function') {
        domTranslator.revertNode(h1);
      }
      const prev = replacedGreetings.get(h1);
      const hostText = prev && h1.textContent === prev.written ? prev.host : h1.textContent || '';
      h1.textContent = target;
      replacedGreetings.set(h1, { host: hostText, written: target });
    }
  }

  function restoreGreetings() {
    for (const [el, rec] of replacedGreetings.entries()) {
      el.removeAttribute('data-ag-no-i18n');
      if (el.isConnected && el.textContent === rec.written) {
        el.textContent = rec.host;
      }
    }
    replacedGreetings.clear();
  }

  // ── Home Dashboard Card Renderer ───────────────────────────────────────
  let panelSeat = null;
  let panelEl = null;
  let heatTipEl = null;
  let modelColours = usageCore.createHomeModelColours();

  function ensurePanelSeat() {
    const home = document.querySelector('.agy-home');
    if (!home || cfg.homeLayout !== 'studio') {
      unmountPanelSeat();
      return null;
    }
    const greeting = home.querySelector('[data-testid="home-greeting"]');
    if (!greeting || !greeting.parentElement) return null;

    if (!panelSeat || !panelSeat.isConnected || panelSeat.parentElement !== greeting.parentElement) {
      unmountPanelSeat();
      panelSeat = document.createElement('div');
      panelSeat.className = 'ag-cs-home-panel-seat';
      panelSeat.setAttribute('data-ag-no-i18n', '');
      panelEl = document.createElement('section');
      panelEl.className = 'ag-cs-home-panel';
      panelSeat.appendChild(panelEl);
      greeting.parentElement.insertBefore(panelSeat, greeting.nextSibling);
    }
    return panelEl;
  }

  function unmountPanelSeat() {
    if (panelSeat && panelSeat.parentElement) panelSeat.parentElement.removeChild(panelSeat);
    panelSeat = null;
    panelEl = null;
    heatTipEl = null;
    lastPanelRenderKey = '';
  }

  function showHeatTip(cell, grid) {
    const tipText = cell.getAttribute('data-tip');
    if (!tipText || !heatTipEl) return;
    heatTipEl.textContent = tipText;
    heatTipEl.setAttribute('data-shown', 'true');
    const gBox = grid.getBoundingClientRect();
    const cBox = cell.getBoundingClientRect();
    const tBox = heatTipEl.getBoundingClientRect();
    const centred = cBox.left + cBox.width / 2 - tBox.width / 2;
    const left = Math.min(Math.max(centred, gBox.left), gBox.right - tBox.width) - gBox.left;
    const above = cBox.top - gBox.top;
    const below = gBox.bottom - cBox.bottom;
    const sideBelow = below > above && below >= tBox.height + 6;
    const top = (sideBelow ? cBox.bottom + 6 : cBox.top - 6 - tBox.height) - gBox.top;
    heatTipEl.style.left = Math.round(left) + 'px';
    heatTipEl.style.top = Math.round(top) + 'px';
  }

  function hideHeatTip() {
    if (heatTipEl) heatTipEl.removeAttribute('data-shown');
  }

  function renderHomePanel(force = false) {
    const panel = ensurePanelSeat();
    if (!panel) return;
    const lang = getLang();
    const ui = uiText(lang);
    const skeleton = !usageHasData && usageLoading;
    const data = usageCore.aggregateUsageRollup(Array.from(usageRecords.values()), activeRange, bookPick, lang);
    const renderKey = [
      lang,
      activeTab,
      activeRange,
      modelsExpanded ? '1' : '0',
      skeleton ? 'skel' : 'ready',
      usageRecords.size,
      data.sessions,
      data.calls,
      data.tokens,
      data.activeDays,
      data.peakHour || '',
      data.model || '',
    ].join('|');
    if (!force && renderKey === lastPanelRenderKey && panel.childElementCount > 0) return;
    lastPanelRenderKey = renderKey;

    panel.innerHTML = '';

    // Header: Tabs + Range Pills
    const head = document.createElement('div');
    head.className = 'ag-cs-home-panel-head';

    const tabs = document.createElement('div');
    tabs.className = 'ag-cs-home-tabs';
    for (const [id, label] of [
      ['overview', ui.tabOverview || 'Overview'],
      ['models', ui.tabModels || 'Models'],
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ag-cs-home-tab';
      btn.setAttribute('data-tab', id);
      btn.textContent = label;
      if (activeTab === id) btn.setAttribute('data-active', '');
      btn.addEventListener('click', () => {
        activeTab = id;
        renderHomePanel();
      });
      tabs.appendChild(btn);
    }

    const ranges = document.createElement('div');
    ranges.className = 'ag-cs-home-ranges';
    for (const r of usageCore.HOME_RANGES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ag-cs-home-range';
      btn.setAttribute('data-range', r.id);
      btn.textContent = typeof usageCore.homeRangeLabel === 'function' ? usageCore.homeRangeLabel(r, lang) : r.labelEn;
      if (activeRange === r.id) btn.setAttribute('data-active', '');
      btn.addEventListener('click', () => {
        activeRange = r.id;
        renderHomePanel();
      });
      ranges.appendChild(btn);
    }

    head.appendChild(tabs);
    head.appendChild(ranges);
    panel.appendChild(head);

    if (activeTab === 'overview') {
      // 3x2 KPI grid
      const stats = document.createElement('div');
      stats.className = 'ag-cs-home-stats';
      const items = [
        ['sessions', ui.kpiSessions || 'Sessions', usageCore.formatHomeCount(data.sessions), String(data.sessions)],
        ['calls', ui.kpiCalls || 'Messages', usageCore.formatHomeCount(data.calls), String(data.calls)],
        ['tokens', ui.kpiTokens || 'Total tokens', usageCore.formatCompactTokens(data.tokens), usageCore.formatHomeCount(data.tokens) + ' tokens'],
        ['days', ui.kpiDays || 'Active days', usageCore.formatHomeCount(data.activeDays), String(data.activeDays)],
        ['peak', ui.kpiPeak || 'Peak hour', data.peakHour || '—', data.peakHour || '—'],
        ['model', ui.kpiFavModel || 'Favorite model', data.model || '—', data.model || '—'],
      ];
      for (const [k, label, valText, titleText] of items) {
        const cell = document.createElement('div');
        cell.className = 'ag-cs-home-stat';
        cell.setAttribute('data-stat', k);
        if (skeleton) cell.setAttribute('data-skeleton', '');
        const lbl = document.createElement('span');
        lbl.className = 'ag-cs-home-stat-label';
        lbl.textContent = label;
        const val = document.createElement('span');
        val.className = 'ag-cs-home-stat-value';
        val.textContent = skeleton ? '' : valText;
        if (!skeleton) val.title = titleText;
        cell.appendChild(lbl);
        cell.appendChild(val);
        stats.appendChild(cell);
      }
      panel.appendChild(stats);

      // 26x7 Heatmap grid
      const heat = document.createElement('div');
      heat.className = 'ag-cs-home-heat';
      if (skeleton) heat.setAttribute('data-skeleton', '');
      const fmt = usageCore.homeShortDateFormat(lang);
      for (const c of data.grid.cells) {
        const sq = document.createElement('span');
        sq.className = 'ag-cs-home-heat-cell';
        sq.setAttribute('data-level', String(c.level));
        if (!skeleton) {
          const tip = `${usageCore.homeShortDate(fmt, c.date)} — ${usageCore.formatCompactTokens(c.tokens)} ${ui.tokenUnit || 'tokens'}`;
          sq.setAttribute('data-tip', tip);
          sq.setAttribute('aria-label', tip);
        }
        heat.appendChild(sq);
      }
      heatTipEl = document.createElement('span');
      heatTipEl.className = 'ag-cs-home-heat-hint';
      heatTipEl.setAttribute('aria-hidden', 'true');
      heat.appendChild(heatTipEl);

      heat.addEventListener('mouseover', (ev) => {
        const target = ev.target && ev.target.closest ? ev.target.closest('.ag-cs-home-heat-cell') : null;
        if (target) showHeatTip(target, heat);
      });
      heat.addEventListener('mouseleave', hideHeatTip);
      panel.appendChild(heat);

      if (data.funBook) {
        const fun = document.createElement('span');
        fun.className = 'ag-cs-home-fun';
        fun.textContent = data.funBook;
        panel.appendChild(fun);
      }
    } else {
      // Models Tab: 30d/7d stacked bar chart + ranked list
      const models = data.models || [];
      if (models.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ag-cs-home-models-empty';
        empty.textContent = ui.noModelUsage || 'No model usage data yet';
        panel.appendChild(empty);
        return;
      }

      const ids = models.map((m) => m.id);
      for (const col of data.modelDays || []) {
        for (const id of Object.keys(col.models || {})) ids.push(id);
      }
      const colours = modelColours(ids);
      const columns = data.modelDays || [];
      const fmt = usageCore.homeShortDateFormat(lang);

      if (columns.length > 0) {
        let peak = 0;
        for (const col of columns) {
          let sum = 0;
          for (const t of Object.values(col.models)) sum += t;
          if (sum > peak) peak = sum;
        }
        const top = usageCore.axisMax(peak);
        const chart = document.createElement('div');
        chart.className = 'ag-cs-home-chart';

        const plot = document.createElement('div');
        plot.className = 'ag-cs-home-chart-plot';
        for (const at of [1, 0.75, 0.5, 0.25, 0]) {
          const tick = document.createElement('span');
          tick.className = 'ag-cs-home-chart-tick';
          tick.style.bottom = `${at * 100}%`;
          tick.textContent = top > 0 ? usageCore.formatCompactTokens(top * at) : '';
          plot.appendChild(tick);
        }

        const bars = document.createElement('div');
        bars.className = 'ag-cs-home-chart-bars';
        for (const col of columns) {
          let dayTotal = 0;
          const stack = [];
          for (const [mId, tok] of Object.entries(col.models)) {
            dayTotal += tok;
            stack.push({ id: mId, tokens: tok });
          }
          stack.sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
          const colEl = document.createElement('span');
          colEl.className = 'ag-cs-home-chart-col';
          colEl.title = `${usageCore.homeShortDate(fmt, col.date)} · ${usageCore.formatCompactTokens(dayTotal)}`;
          colEl.style.height = `${top > 0 ? (dayTotal / top) * 100 : 0}%`;
          for (const slice of stack) {
            const seg = document.createElement('span');
            seg.className = 'ag-cs-home-chart-seg';
            seg.setAttribute('data-color', String(colours[slice.id] ?? 0));
            seg.style.height = `${dayTotal > 0 ? (slice.tokens / dayTotal) * 100 : 0}%`;
            colEl.appendChild(seg);
          }
          bars.appendChild(colEl);
        }
        plot.appendChild(bars);
        chart.appendChild(plot);

        const axis = document.createElement('div');
        axis.className = 'ag-cs-home-chart-axis';
        chart.appendChild(axis);
        panel.appendChild(chart);

        // Compute non-overlapping X ticks after layout
        requestAnimationFrame(() => {
          if (!axis.isConnected) return;
          const labels = columns.map((c) => usageCore.homeShortDate(fmt, c.date));
          const widths = labels.map((l) => Math.max(32, l.length * 6.5));
          const ticks = usageCore.homeChartTicks(widths, plot.clientWidth || 420);
          axis.innerHTML = '';
          for (const tk of ticks) {
            const sp = document.createElement('span');
            sp.className = 'ag-cs-home-chart-label';
            sp.style.left = `${tk.left}px`;
            sp.textContent = labels[tk.index];
            axis.appendChild(sp);
          }
        });
      }

      // Ranked model rows
      let totalAll = 0;
      for (const m of models) totalAll += m.tokens;
      const shown = modelsExpanded ? models : models.slice(0, usageCore.HOME_MODEL_ROWS);
      const listEl = document.createElement('div');
      listEl.className = 'ag-cs-home-models';
      for (const m of shown) {
        const row = document.createElement('div');
        row.className = 'ag-cs-home-model';
        row.title = `${m.id} · ${m.sessions} ${ui.sessionsUnit || 'sessions'}`;
        const sw = document.createElement('span');
        sw.className = 'ag-cs-home-model-swatch';
        sw.setAttribute('data-color', String(colours[m.id] ?? 0));
        const nm = document.createElement('span');
        nm.className = 'ag-cs-home-model-name';
        nm.textContent = m.id;
        const inp = (m.input || 0) + (m.cacheRead || 0) + (m.cacheWrite || 0);
        const outTok = m.output || 0;
        const sp = document.createElement('span');
        sp.className = 'ag-cs-home-model-split';
        sp.textContent = `${usageCore.formatCompactTokens(inp)} in · ${usageCore.formatCompactTokens(outTok)} out`;
        const sh = document.createElement('span');
        sh.className = 'ag-cs-home-model-share';
        sh.textContent = totalAll > 0 ? ((Math.round((m.tokens / totalAll) * 1000) / 10).toFixed(1) + '%') : '—';
        row.appendChild(sw);
        row.appendChild(nm);
        row.appendChild(sp);
        row.appendChild(sh);
        listEl.appendChild(row);
      }
      if (models.length > usageCore.HOME_MODEL_ROWS) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'ag-cs-home-models-more';
        const hiddenCount = models.length - shown.length;
        more.textContent = modelsExpanded
          ? ui.showLess || 'Show less'
          : typeof ui.showMoreN === 'function'
          ? ui.showMoreN(hiddenCount)
          : `Show ${hiddenCount} more`;
        more.addEventListener('click', () => {
          modelsExpanded = !modelsExpanded;
          renderHomePanel();
        });
        listEl.appendChild(more);
      }
      panel.appendChild(listEl);
    }
  }

  // ── Home Interactive ASCII Matrix & Ripple Field ───────────────────────
  let rippleMount = null;

  function motionReduced() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function readRipplePalette(canvas) {
    const cs = getComputedStyle(canvas);
    const ink = rippleCore.parseCssColorToRgb(cs.getPropertyValue('--ag-cs-ripple-ink')) || [136, 146, 159];
    const wave = rippleCore.parseCssColorToRgb(cs.getPropertyValue('--ag-cs-ripple-wave')) || [127, 166, 255];
    const dark = isDarkTheme();
    const fontFamily = cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, Consolas, monospace';
    return { ink, wave, dark, fontFamily };
  }

  function unmountRipple() {
    if (!rippleMount) return;
    clearTimeout(rippleMount.timer);
    if (rippleMount.rafId) cancelAnimationFrame(rippleMount.rafId);
    if (rippleMount.ro && typeof rippleMount.ro.disconnect === 'function') rippleMount.ro.disconnect();
    if (rippleMount.root && typeof rippleMount.root.removeEventListener === 'function') {
      rippleMount.root.removeEventListener('pointerdown', rippleMount.onPress);
    }
    document.removeEventListener('visibilitychange', rippleMount.onVis);
    if (rippleMount.field && typeof rippleMount.field.dispose === 'function') {
      rippleMount.field.dispose();
    }
    if (rippleMount.host && typeof rippleMount.host.remove === 'function') {
      rippleMount.host.remove();
    }
    rippleMount = null;
  }

  function syncRipple() {
    const home = cfg.homeRipple !== false && cfg.homeLayout !== 'off' ? document.querySelector('.agy-home') : null;
    if (rippleMount && (rippleMount.root !== home || !rippleMount.canvas.isConnected)) {
      unmountRipple();
    }
    if (!home || rippleMount) return;

    const host = document.createElement('div');
    host.className = 'ag-cs-ripple-host';
    host.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'ag-cs-ripple-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    home.insertBefore(host, home.firstChild);

    const state = {
      root: home,
      host,
      canvas,
      width: -1,
      height: -1,
      dpr: 0,
      waves: null,
      field: null,
      timer: 0,
      rafId: 0,
      ro: null,
      onPress: null,
      onVis: null,
    };
    let previous = performance.now();
    let frameWanted = false;
    let drawnOnce = false;

    function layout() {
      const w = home.clientWidth;
      const h = home.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === state.width && h === state.height && dpr === state.dpr) return;
      state.width = w;
      state.height = h;
      state.dpr = dpr;
      if (w <= 0 || h <= 0) {
        if (state.field) {
          state.field.dispose();
          state.field = null;
        }
        state.waves = null;
        canvas.width = 0;
        canvas.height = 0;
        drawnOnce = false;
        return;
      }
      const cols = Math.ceil(w / rippleCore.RIPPLE.cellWidth);
      const rows = Math.ceil(h / rippleCore.RIPPLE.cellHeight);
      canvas.width = Math.round(cols * rippleCore.RIPPLE.cellWidth * dpr);
      canvas.height = Math.round(rows * rippleCore.RIPPLE.cellHeight * dpr);
      canvas.style.width = `${cols * rippleCore.RIPPLE.cellWidth}px`;
      canvas.style.height = `${rows * rippleCore.RIPPLE.cellHeight}px`;
      if (state.field) state.field.dispose();
      state.waves = rippleCore.createWaveField(cols, rows);
      state.field = rippleCore.createGlyphField(canvas, cols, rows, state.waves);
      drawnOnce = false;
    }

    function wake() {
      clearTimeout(state.timer);
      state.timer = 0;
      if (destroyed || frameWanted) return;
      if (document.hidden) {
        if (!drawnOnce && canvas.width > 0) drawFrame(performance.now());
        return;
      }
      frameWanted = true;
      state.rafId = requestAnimationFrame(drawFrame);
    }

    function sleep(now) {
      if (destroyed || document.hidden) return;
      const period = 1000 / rippleCore.RIPPLE.changeRate;
      state.timer = setTimeout(wake, period - (now % period) + 1);
    }

    function drawFrame(now) {
      state.rafId = 0;
      frameWanted = false;
      if (destroyed) return;
      const still = motionReduced();
      if (state.waves) state.waves.advance(still ? 0 : (now - previous) / 1000);
      previous = now;
      if (canvas.width > 0 && state.field && state.field.needsDraw(now, still)) {
        const pal = readRipplePalette(canvas);
        state.field.draw(now, pal, still);
        drawnOnce = true;
      }
      if (state.field && state.field.busy() && !still) wake();
      else sleep(now);
    }

    state.onPress = (ev) => {
      if (ev.button !== 0 || motionReduced() || !state.waves) return;
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor((ev.clientX - rect.left) / rippleCore.RIPPLE.cellWidth);
      const row = Math.floor((ev.clientY - rect.top) / rippleCore.RIPPLE.cellHeight);
      previous = performance.now();
      state.waves.disturb(col, row);
      wake();
    };
    home.addEventListener('pointerdown', state.onPress, { passive: true });

    state.onVis = () => {
      if (!document.hidden) {
        previous = performance.now();
        wake();
      } else {
        clearTimeout(state.timer);
        state.timer = 0;
        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        frameWanted = false;
      }
    };
    document.addEventListener('visibilitychange', state.onVis);

    if (typeof ResizeObserver === 'function') {
      state.ro = new ResizeObserver(() => {
        layout();
        wake();
      });
      state.ro.observe(home);
    }
    layout();
    state.refreshTheme = () => {
      if (state.field) state.field.invalidate();
      if (document.hidden && canvas.width > 0) drawFrame(performance.now());
      else wake();
    };
    wake();
    rippleMount = state;
  }

  // ── Composer Decorations, Token HUD Inspector, Effort Slider & Smooth Caret ─
  const MAX_ACTIVE_TRAJ_CACHE = 40;
  const MAX_SUBAGENT_TRAJ_CACHE = 80;
  const activeTrajCache = new Map(); // cascadeId -> { fetching, lastMod, lastStep, data }
  const subagentTrajCache = new Map(); // subId -> { stepCount, status, analysis }
  function pruneMapCache(map, maxEntries, protectedKeys) {
    if (!map || map.size <= maxEntries) return;
    for (const k of map.keys()) {
      if (map.size <= maxEntries) break;
      if (protectedKeys && protectedKeys.has(k)) continue;
      const val = map.get(k);
      if (val && (val.fetching || val.promise)) continue;
      map.delete(k);
    }
  }
  const knownModelMaxCtx = new Map(); // normalized model base -> maxContextTokens
  const expandedHudGroups = new Set();
  let cachedQuotaData = null;
  let quotaFetchPromise = null;
  let lastQuotaFetchAt = 0;
  let openPopover = null;
  let openPopoverAnchor = null;
  let openPopoverCascadeId = '';
  let activeHudTab = 'breakdown';

  function normalizeModelCtxKey(label) {
    return String(label || '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\b(?:low|medium|med|high|xhigh|extra|max|minimal|light|none|off|ultra)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function getKnownMaxContextForCard(card, data) {
    const key = normalizeModelCtxKey(getCurrentModelLabel(card) || data?.lastModel || '');
    return (key && knownModelMaxCtx.get(key)) || 0;
  }

  function createEmptyConvoData(cascadeId = '', maxContextTokens = 0) {
    const known = maxContextTokens > 0 ? { maxContextTokens } : undefined;
    if (usageCore && typeof usageCore.analyzeActiveConversation === 'function') {
      return usageCore.analyzeActiveConversation(null, { cascadeId, knownLimits: known });
    }
    const maxCtx = maxContextTokens > 0 ? maxContextTokens : 256000;
    return {
      cascadeId: String(cascadeId || ''),
      turns: 0,
      turnDetails: [],
      toolBreakdown: [],
      chatMsgTokens: 0,
      toolResultsTokens: 0,
      overheadTokens: 0,
      lastModel: '',
      lastFreshInput: 0,
      lastCacheRead: 0,
      lastOutput: 0,
      lastThinking: 0,
      totalOutput: 0,
      subagents: [],
      subagentCount: 0,
      subagentCalls: 0,
      subagentTokens: 0,
      calls: 0,
      totalCalls: 0,
      callList: [],
      lastCall: null,
      hasCalls: false,
      steps: 0,
      totalSteps: 0,
      contextUsed: 0,
      contextRemaining: maxCtx,
      maxContextTokens: maxCtx,
      contextPct: 0,
      contextRemainingPct: 100,
      sysTokens: 0,
      toolsTokens: 0,
      msgTokens: 0,
      sysChildren: [],
      toolsChildren: [],
      msgChildren: [],
      topSteps: [],
      userMsgTokens: 0,
      botMsgTokens: 0,
      toolIoTokens: 0,
      sumInput: 0,
      sumCacheRead: 0,
      sumCacheWrite: 0,
      sumOutput: 0,
      sumThinking: 0,
      sumResponse: 0,
      totalTokens: 0,
      sumAllTokens: 0,
      cacheHitPct: 0,
      overallCacheHitPct: 0,
      overallThinkPct: 0,
      lastSpeed: 0,
      lastTtft: 0,
      avgTtft: 0,
      avgSpeed: 0,
      latestValidSpeed: 0,
      liveSpeed: 0,
      liveTokens: 0,
      displaySpeed: 0,
      isLiveSpeed: false,
      peakSpeed: 0,
      sustainedPeakSpeed: 0,
      checkpointIdx: -1,
      compactedSteps: 0,
      truncationReason: 0,
      budgets: { customizationTokenBudget: 20000, rulesTokenBudget: 20000 },
      hasActiveLimits: false,
      isRunning: false,
      isThinking: false,
      hasError: false,
    };
  }

  function resolveCardConvoData(card, fallbackData) {
    const ib = card?.closest?.('[data-testid="agent-input-box"]');
    const cid = resolveCascadeId(ib);
    if (cid) {
      const hit = activeTrajCache.get(cid)?.data;
      if (hit) return hit;
    }
    return card?._agCsLastData || fallbackData || createEmptyConvoData(cid, getKnownMaxContextForCard(card, fallbackData));
  }

  function closeContextPopover() {
    if (openPopover && openPopover.parentElement) openPopover.parentElement.removeChild(openPopover);
    openPopover = null;
    openPopoverAnchor = null;
    openPopoverCascadeId = '';
  }

  function formatCompactK(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getCurrentModelLabel(card) {
    const scope = card || document;
    const btn = scope.querySelector('[data-testid="model-selector-trigger"]');
    if (btn) {
      const aria = btn.getAttribute('aria-label') || '';
      const jaMatch = aria.match(/（現在[：:]\s*(.+)）$/);
      if (jaMatch && jaMatch[1]) return jaMatch[1].trim();
      const m = aria.match(/(?:当前|目前|而家|现在|現在|Current)[：:]\s*(.+)$/i);
      if (m && m[1]) return m[1].trim();
      const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) return txt;
    }
    return '';
  }

  function getDraftInfo(card) {
    const scope = card || document.querySelector('[data-testid="agent-input-box"]') || document;
    const ed = scope.querySelector ? scope.querySelector('[contenteditable="true"]') : null;
    if (!ed || typeof usageCore.estimateTextTokens !== 'function') {
      return { tokens: 0, chars: 0, cjk: 0, words: 0, codeSymbols: 0 };
    }
    const textContentRaw = String(ed.textContent || '');
    if (!textContentRaw.trim()) {
      return { tokens: 0, chars: 0, cjk: 0, words: 0, codeSymbols: 0 };
    }
    const raw = String(ed.innerText ?? textContentRaw).trim();
    if (!raw) {
      return { tokens: 0, chars: 0, cjk: 0, words: 0, codeSymbols: 0 };
    }
    return usageCore.estimateTextTokens(raw);
  }

  async function fetchQuotaData(force = false) {
    const h = ensureHooks(true);
    if (!h) return cachedQuotaData;
    const now = Date.now();
    if (!force && cachedQuotaData && now - lastQuotaFetchAt < 25000) return cachedQuotaData;
    if (quotaFetchPromise) return quotaFetchPromise;
    quotaFetchPromise = (async () => {
      try {
        let raw = null;
        if (typeof h.svc?.retrieveUserQuotaSummary === 'function') {
          raw = await h.svc.retrieveUserQuotaSummary({});
        }
        if (typeof usageCore.normalizeQuotaData === 'function') {
          const st = h.store?.getState?.() || null;
          cachedQuotaData = usageCore.normalizeQuotaData(raw, st, st?.credits || null, getLang());
        }
        lastQuotaFetchAt = Date.now();
      } catch {} finally {
        quotaFetchPromise = null;
      }
      return cachedQuotaData;
    })();
    return quotaFetchPromise;
  }

  function getActiveQuotaForInfo(data, card) {
    if (typeof usageCore.getActiveQuotaInfo !== 'function') return null;
    const modelLabel = getCurrentModelLabel(card) || data?.lastModel || '';
    return usageCore.getActiveQuotaInfo(cachedQuotaData, modelLabel);
  }

  function getRingTelemetryForCard(card, data) {
    const draftEst = getDraftInfo(card);
    const activeQuota = getActiveQuotaForInfo(data, card);
    const knownMax = getKnownMaxContextForCard(card, data);
    const effectiveInfo =
      data && (data.hasActiveLimits || !knownMax)
        ? data
        : { ...(data || {}), maxContextTokens: knownMax || Number(data?.maxContextTokens || 256000) };
    if (typeof usageCore.computeRingTelemetry === 'function') {
      return {
        ring: usageCore.computeRingTelemetry({
          activeInfo: effectiveInfo,
          quotaInfo: activeQuota,
          draftTokens: draftEst.tokens,
          ringMode: cfg.ringMode || 'context',
          knownLimits: knownMax > 0 ? { maxContextTokens: knownMax } : null,
        }),
        draftEst,
        activeQuota,
      };
    }
    const maxTokens = Number(effectiveInfo?.maxContextTokens || 256000);
    const usedTokens = Number(data?.contextUsed || 0) + draftEst.tokens;
    const remainingTokens = Math.max(0, maxTokens - usedTokens);
    const pct = maxTokens > 0 ? Math.max(0, Math.min(100, (remainingTokens / maxTokens) * 100)) : 100;
    const pctRound = Math.round(pct);
    const color = pct <= 10 ? '#dc3c3d' : pct <= 30 ? '#fbb315' : '#257de0';
    return {
      ring: {
        mode: 'context',
        pct,
        remainingPct: pct,
        pctRound,
        level: pct <= 10 ? 'danger' : pct <= 30 ? 'warn' : 'ok',
        color,
        usedTokens,
        remainingTokens,
        maxTokens,
        draftTokens: draftEst.tokens,
        contextUsedPct: 100 - pct,
        contextRemainingPct: pct,
        quotaRemainingPct: null,
      },
      draftEst,
      activeQuota,
    };
  }

  const lexCompactUnsubs = new Set();

  function cleanCompactCmd(s) {
    return String(s || '')
      .replace(/[\u200B\uFEFF\s]+/g, '')
      .replace(/^\/+/, '')
      .toLowerCase();
  }

  function isIconLigatureNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'SVG' || tag === 'STYLE' || tag === 'SCRIPT') return true;
    if (typeof node.hasAttribute === 'function') {
      if (node.hasAttribute('data-symbol-name')) return true;
      if (node.getAttribute('aria-hidden') === 'true') return true;
    }
    if (node.classList && typeof node.classList.contains === 'function') {
      if (
        node.classList.contains('google-symbols') ||
        node.classList.contains('material-symbols-outlined') ||
        node.classList.contains('material-icons')
      ) {
        return true;
      }
    }
    return false;
  }

  function getNonIconText(root) {
    if (!root) return '';
    if (root.nodeType === 3) return String(root.nodeValue || '');
    if (isIconLigatureNode(root)) return '';
    const kids = root.childNodes || root.children || [];
    if (!kids || kids.length === 0) {
      return String(root.textContent || '');
    }
    let out = '';
    for (let i = 0; i < kids.length; i++) {
      out += getNonIconText(kids[i]);
    }
    return out;
  }

  function parseSlashMentionPayload(node) {
    const rawData = node?.data && typeof node.data.data === 'string' ? node.data.data : '';
    const mentionText = cleanCompactCmd(node?.data?.mentionText || '');
    if (!rawData) return { isSlash: false, cmd: '', rawData: '' };
    try {
      const parsed = JSON.parse(rawData);
      if (parsed && typeof parsed === 'object') {
        if (parsed.slashCommand && typeof parsed.slashCommand === 'object') {
          const name = cleanCompactCmd(
            parsed.slashCommand.info?.name || parsed.slashCommand.name || mentionText || ''
          );
          return { isSlash: true, cmd: name || 'slash', rawData };
        }
        if (parsed.recipe && typeof parsed.recipe === 'object') {
          const name = cleanCompactCmd(
            parsed.recipe.recipeId || parsed.recipe.name || parsed.recipe.title || mentionText || ''
          );
          if (name) return { isSlash: true, cmd: name, rawData };
        }
        return { isSlash: false, cmd: '', rawData };
      }
    } catch {}
    if (/"(uri|fileUri|filePath|relativePath)"/i.test(rawData)) {
      return { isSlash: false, cmd: '', rawData };
    }
    if (/slashCommand/i.test(rawData) || /"recipe"\s*:\s*\{/i.test(rawData)) {
      const cmd = /\bcompact\b/i.test(rawData) ? 'compact' : /\bbtw\b/i.test(rawData) ? 'btw' : (mentionText || 'slash');
      return { isSlash: true, cmd, rawData };
    }
    return { isSlash: false, cmd: '', rawData };
  }

  function isSlashMentionNode(node, cmdName) {
    if (!node || typeof node !== 'object') return false;
    if (node.type !== 'beautifulMention' && node.type !== 'contextScopeItemMention') return false;
    const target = String(cmdName || '').toLowerCase();
    if (!target) return false;
    if (node.type === 'beautifulMention' && node.trigger && node.trigger !== '/') return false;
    const val = cleanCompactCmd(node.value);
    if (val && val !== 'contextscopeitemmention' && val === target) {
      return true;
    }
    const parsed = parseSlashMentionPayload(node);
    return parsed.isSlash && parsed.cmd === target;
  }

  function isCompactMentionNode(node) {
    return isSlashMentionNode(node, 'compact');
  }

  function isAnySlashCommandMentionNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type !== 'beautifulMention' && node.type !== 'contextScopeItemMention') return false;
    if (node.type === 'beautifulMention' && node.trigger && node.trigger !== '/') return false;
    if (node.trigger === '/') return true;
    const val = cleanCompactCmd(node.value);
    if (val === 'compact' || val === 'btw') return true;
    return parseSlashMentionPayload(node).isSlash;
  }

  function extractSlashCommandNameFromNode(node) {
    if (!isAnySlashCommandMentionNode(node)) return '';
    const val = cleanCompactCmd(node.value);
    if (val && val !== 'contextscopeitemmention') return val;
    const parsed = parseSlashMentionPayload(node);
    if (parsed.cmd) return parsed.cmd;
    const mentionText = cleanCompactCmd(node?.data?.mentionText || '');
    return mentionText || 'slash';
  }

  function normalizeComposerWhitespace(str) {
    return String(str || '').replace(/[\u200B\uFEFF\u00A0]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getKnownCompactPresetTexts() {
    const out = new Set();
    const add = (val) => {
      const norm = normalizeComposerWhitespace(val);
      if (norm) out.add(norm);
    };
    const curUi = uiText(getLang());
    add(resolveCompactPresetText(curUi));
    add(cfg?.compactCustomText);
    for (const ui of [curUi, uiText('en')]) {
      if (!ui) continue;
      add(ui.compactPresetClean || 'Drop verbose tool I/O, full logs, finished-task trial-and-error, and processed image/video details (keep conclusions only; for active unfinished tasks, extract key visual/content points first). Keep core business logic and architecture, finalized decisions, user preferences and rejected options, key constraints, full context of work in progress, and open TODOs.');
      add(ui.compactPresetDev || 'Drop verbose tool I/O, raw file dumps, full diffs/logs, finished-task trial-and-error, and processed screenshot/video details (keep conclusions only; for active unfinished tasks, extract visual defects and locations first). Preserve core architecture, key file paths and symbol/API contracts, current branch, uncommitted changes and verification status, error root causes, known pitfalls, hard constraints and rejected options, active task details, and open TODOs.');
      add(ui.compactPresetContinue || 'Drop verbose tool I/O/logs, finished-task trial-and-error, and processed image/video details (keep conclusions only; for active unfinished tasks, extract key points first). Preserve core architecture, hard constraints, user preferences/rejected options, the interrupted task checkpoint (progress, key paths, uncommitted changes, open errors, next action), and remaining TODOs. After compaction, resume immediately without recapping unless a user decision is required.');
    }
    return out;
  }

  function classifyComposerSlashState(ed) {
    if (!ed) return { state: 'draft', cmd: '', hasLexical: false };
    if (ed._agCsComposing) {
      return { state: 'draft', cmd: '', hasLexical: Boolean(ed.__lexicalEditor) };
    }
    const lex = ed.__lexicalEditor;
    if (lex && typeof lex.getEditorState === 'function') {
      try {
        const root = lex.getEditorState()?.toJSON?.()?.root;
        if (root && Array.isArray(root.children)) {
          const nonEmpty = root.children.filter((p) => {
            const kids = Array.isArray(p?.children) ? p.children : [];
            return kids.some((n) => n?.type !== 'text' || normalizeComposerWhitespace(n.text) !== '');
          });
          if (nonEmpty.length === 0) {
            const domTxt = normalizeComposerWhitespace(getNonIconText(ed));
            const domDec = Boolean(ed.querySelector?.('[data-lexical-decorator="true"], [data-chip]'));
            if (domTxt !== '' || domDec) {
              return { state: 'draft', cmd: '', hasLexical: true };
            }
            return { state: 'empty', cmd: '', hasLexical: true };
          }
          if (nonEmpty.length > 1) {
            return { state: 'draft', cmd: '', hasLexical: true };
          }
          let slashNode = null;
          const plainParts = [];
          for (const node of nonEmpty[0].children) {
            if (isAnySlashCommandMentionNode(node)) {
              if (slashNode) return { state: 'draft', cmd: '', hasLexical: true };
              slashNode = node;
            } else if (node?.type === 'text') {
              plainParts.push(String(node.text || ''));
            } else {
              return { state: 'draft', cmd: '', hasLexical: true };
            }
          }
          const extraText = normalizeComposerWhitespace(plainParts.join(''));
          if (!slashNode) {
            if (extraText === '') {
              const domTxt = normalizeComposerWhitespace(getNonIconText(ed));
              const domDec = Boolean(ed.querySelector?.('[data-lexical-decorator="true"], [data-chip]'));
              if (domTxt !== '' || domDec) {
                return { state: 'draft', cmd: '', hasLexical: true };
              }
              return { state: 'empty', cmd: '', hasLexical: true };
            }
            return { state: 'draft', cmd: '', hasLexical: true };
          }
          const cmd = extractSlashCommandNameFromNode(slashNode);
          if (extraText === '') {
            return { state: 'standalone_slash', cmd, hasPreset: false, hasLexical: true };
          }
          if (cmd === 'compact' && getKnownCompactPresetTexts().has(extraText)) {
            return { state: 'standalone_slash', cmd: 'compact', hasPreset: true, hasLexical: true };
          }
          return { state: 'draft', cmd: '', hasLexical: true };
        }
      } catch {}
    }

    const rawTxt = normalizeComposerWhitespace(getNonIconText(ed));
    const hasDecorators = Boolean(ed.querySelector?.('[data-lexical-decorator="true"], [data-chip]'));
    if (!hasDecorators && rawTxt === '') {
      return { state: 'empty', cmd: '', hasLexical: false };
    }
    return { state: 'draft', cmd: '', hasLexical: false };
  }

  function findLexicalCommandByName(lex, name) {
    if (!lex || !lex._commands || typeof lex._commands.keys !== 'function') return null;
    for (const key of lex._commands.keys()) {
      if (key && (key.type === name || key.name === name)) return key;
    }
    return null;
  }

  function clearComposerAndInsertSlashCommand(ed, cmdText) {
    if (!ed) return false;
    const targetCmd = cleanCompactCmd(cmdText);
    const hasExistingContent = () => {
      const txt = getNonIconText(ed).replace(/[\u200B\uFEFF\u00A0]/g, ' ').trim();
      const hasDec = Boolean(ed.querySelector?.('[data-lexical-decorator], [data-chip]'));
      return txt.length > 0 || hasDec;
    };

    ed.focus();

    if (hasExistingContent()) {
      const lex = ed.__lexicalEditor;
      if (!lex) return false;
      try {
        const clearSticky = findLexicalCommandByName(lex, 'CLEAR_DISMISSED_STICKY_MENTION_COMMAND');
        if (clearSticky && typeof lex.dispatchCommand === 'function') {
          lex.dispatchCommand(clearSticky, undefined);
        }
      } catch {}
      let clearedViaLexical = false;
      if (typeof lex.update === 'function') {
        try {
          lex.update(
            () => {
              const root =
                lex._pendingEditorState?._nodeMap?.get?.('root') ||
                lex._editorState?._nodeMap?.get?.('root');
              if (root && typeof root.clear === 'function') {
                root.clear();
                if (typeof root.select === 'function') root.select();
                clearedViaLexical = true;
              }
            },
            { discrete: true }
          );
        } catch {}
      }
      if (hasExistingContent() && typeof lex.dispatchCommand === 'function') {
        try {
          const selAll = findLexicalCommandByName(lex, 'SELECT_ALL_COMMAND');
          const remTxt = findLexicalCommandByName(lex, 'REMOVE_TEXT_COMMAND');
          const delChar = findLexicalCommandByName(lex, 'DELETE_CHARACTER_COMMAND');
          if (selAll) lex.dispatchCommand(selAll, null);
          if (remTxt) {
            lex.dispatchCommand(remTxt, null);
            clearedViaLexical = true;
          } else if (delChar) {
            lex.dispatchCommand(delChar, true);
            clearedViaLexical = true;
          }
        } catch {}
      }
      if (!clearedViaLexical || hasExistingContent()) {
        return false;
      }
      ed.focus();
    }

    let inserted = false;
    const hasExecCommand = typeof document.execCommand === 'function';
    if (hasExecCommand) {
      try {
        document.execCommand('selectAll', false, null);
        inserted = Boolean(document.execCommand('insertText', false, cmdText));
      } catch {}
      return inserted;
    } else {
      let beforeInputCancelled = false;
      if (typeof InputEvent === 'function' && typeof ed.dispatchEvent === 'function') {
        try {
          const evRes = ed.dispatchEvent(
            new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: cmdText, inputType: 'insertText' })
          );
          if (evRes === false) beforeInputCancelled = true;
        } catch {}
      }
      if (beforeInputCancelled) return false;
      if (cleanCompactCmd(getNonIconText(ed)) !== targetCmd) {
        if (ed.__lexicalEditor) return false;
        ed.textContent = cmdText;
        if (typeof InputEvent === 'function') {
          try {
            ed.dispatchEvent(new InputEvent('input', { bubbles: true, data: cmdText, inputType: 'insertText' }));
          } catch {}
        }
      }
    }
    return cleanCompactCmd(getNonIconText(ed)) === targetCmd || Boolean(findStandaloneSlashChip(ed, targetCmd));
  }

  function findStandaloneSlashChip(ed, cmdName) {
    if (!ed || ed._agCsComposing) return null;
    const target = String(cmdName || '').toLowerCase();
    if (!target) return null;

    const lex = ed.__lexicalEditor;
    if (lex && typeof lex.getEditorState === 'function') {
      try {
        const root = lex.getEditorState()?.toJSON?.()?.root;
        const paras = Array.isArray(root?.children) ? root.children : [];
        const nonEmpty = paras.filter((p) => Array.isArray(p?.children) && p.children.length > 0);
        if (nonEmpty.length !== 1) return null;
        let slashMention = null;
        for (const node of nonEmpty[0].children) {
          if (isSlashMentionNode(node, target)) {
            if (slashMention) return null;
            slashMention = node;
          } else if (node?.type === 'text' && cleanCompactCmd(node.text) === '') {
            continue;
          } else {
            return null;
          }
        }
        if (!slashMention) return null;
      } catch {}
    } else {
      if (ed.querySelectorAll('p').length > 1) return null;
      if (cleanCompactCmd(getNonIconText(ed)) !== target) return null;
    }

    const decorators = Array.from(ed.querySelectorAll('[data-lexical-decorator="true"]'));
    for (const d of decorators) {
      if (cleanCompactCmd(getNonIconText(d)) === target) return d;
    }
    const bdis = Array.from(ed.querySelectorAll('bdi'));
    for (const b of bdis) {
      if (cleanCompactCmd(getNonIconText(b)) === target) return b;
    }
    const spans = Array.from(ed.querySelectorAll('span'));
    for (const sp of spans) {
      if (
        cleanCompactCmd(getNonIconText(sp)) === target &&
        sp.querySelector('[data-symbol-name], .google-symbols, svg')
      ) {
        return sp;
      }
    }
    return null;
  }

  function findStandaloneCompactChip(ed) {
    return findStandaloneSlashChip(ed, 'compact');
  }

  function findStandaloneBtwChip(ed) {
    return findStandaloneSlashChip(ed, 'btw');
  }

  function removeCompactGuideHint(wrap) {
    if (!wrap) return;
    const old = wrap.querySelector('.ag-cs-compact-hint');
    if (old) old.remove();
  }

  function syncCompactGuideHint(card, ui) {
    if (!card || destroyed) return;
    const ed = card.querySelector('[contenteditable="true"]');
    const wrap = ed?.parentElement || null;
    if (!ed || !wrap) return;

    if (!ed._agCsCompactHintBound) {
      ed._agCsCompactHintBound = true;
      const onUpdate = () => syncCompactGuideHint(card, uiText(getLang()));
      const onCompStart = () => {
        ed._agCsComposing = true;
        removeCompactGuideHint(wrap);
      };
      const onCompEnd = () => {
        ed._agCsComposing = false;
        onUpdate();
      };
      ed.addEventListener('compositionstart', onCompStart);
      ed.addEventListener('compositionend', onCompEnd);
      ed.addEventListener('input', onUpdate);
      ed.addEventListener('keyup', onUpdate);
      ed.addEventListener('focus', onUpdate);
      ed.addEventListener('blur', onUpdate);
      lexCompactUnsubs.add(() => {
        try {
          ed.removeEventListener('compositionstart', onCompStart);
          ed.removeEventListener('compositionend', onCompEnd);
          ed.removeEventListener('input', onUpdate);
          ed.removeEventListener('keyup', onUpdate);
          ed.removeEventListener('focus', onUpdate);
          ed.removeEventListener('blur', onUpdate);
        } catch {}
        delete ed._agCsCompactHintBound;
        delete ed._agCsComposing;
      });
    }

    const lex = ed.__lexicalEditor;
    if (lex && typeof lex.registerUpdateListener === 'function' && !ed._agCsLexCompactUnsub) {
      try {
        const unsub = lex.registerUpdateListener(() => {
          if (destroyed) return;
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => syncCompactGuideHint(card, uiText(getLang())));
          } else {
            syncCompactGuideHint(card, uiText(getLang()));
          }
        });
        if (typeof unsub === 'function') {
          ed._agCsLexCompactUnsub = () => {
            try {
              unsub();
            } catch {}
            delete ed._agCsLexCompactUnsub;
          };
          lexCompactUnsubs.add(ed._agCsLexCompactUnsub);
        } else {
          ed._agCsLexCompactUnsub = true;
        }
      } catch {}
    }

    let chip = findStandaloneCompactChip(ed);
    let hintKind = 'compact';
    if (!chip) {
      chip = findStandaloneBtwChip(ed);
      hintKind = 'btw';
    }
    if (!chip) {
      removeCompactGuideHint(wrap);
      return;
    }

    let hint = wrap.querySelector('.ag-cs-compact-hint');
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'ag-cs-compact-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.setAttribute('data-ag-no-i18n', '');
      wrap.appendChild(hint);
    }
    if (hint.getAttribute('data-ag-cs-hint-kind') !== hintKind) {
      hint.setAttribute('data-ag-cs-hint-kind', hintKind);
    }
    const hintText =
      hintKind === 'btw'
        ? ui?.btwGuideHint ||
          'Side question: ask anything without interrupting the current chat · type and press Enter'
        : ui?.compactGuideHint ||
          'Optional: guide compaction (e.g. keep open plans, drop finished details) · Enter for default';
    if (hint.textContent !== hintText) {
      hint.textContent = hintText;
    }

    const chipRect = (() => {
      const bdi = typeof chip.querySelector === 'function' ? chip.querySelector('bdi') : null;
      if (bdi && typeof bdi.getBoundingClientRect === 'function') {
        const br = bdi.getBoundingClientRect();
        if (br && br.width > 0) return br;
      }
      return typeof chip.getBoundingClientRect === 'function'
        ? chip.getBoundingClientRect()
        : { left: 0, top: 0, right: 0, bottom: 0, height: 22 };
    })();
    const wrapRect = typeof wrap.getBoundingClientRect === 'function' ? wrap.getBoundingClientRect() : { left: 0, top: 0, right: 400 };
    const edRect = typeof ed.getBoundingClientRect === 'function' ? ed.getBoundingClientRect() : wrapRect;
    let padRight = 8;
    try {
      if (typeof getComputedStyle === 'function') {
        padRight = parseFloat(getComputedStyle(ed)?.paddingRight) || 8;
      }
    } catch {}

    const leftVal = `${Math.max(0, Math.round(chipRect.right - wrapRect.left + 8))}px`;
    const topVal = `${Math.max(0, Math.round(chipRect.top - wrapRect.top))}px`;
    const heightVal = `${Math.max(20, Math.round(chipRect.height || 22))}px`;
    const rightVal = `${Math.max(12, Math.round(Math.max(0, wrapRect.right - edRect.right) + padRight + 6))}px`;

    if (hint.style.left !== leftVal) hint.style.left = leftVal;
    if (hint.style.top !== topVal) hint.style.top = topVal;
    if (hint.style.height !== heightVal) hint.style.height = heightVal;
    if (hint.style.lineHeight !== heightVal) hint.style.lineHeight = heightVal;
    if (hint.style.right !== rightVal) hint.style.right = rightVal;
  }

  function tryAutoSelectSlashMenu(ed, cmdName) {
    const target = String(cmdName || '').toLowerCase();
    if (!target || !ed || !ed.isConnected || findStandaloneSlashChip(ed, target)) return true;
    if (cleanCompactCmd(getNonIconText(ed)) !== target) return false;
    const candidates = Array.from(
      new Set(
        document.querySelectorAll(
          '[data-mention-menu] [role="option"], [role="option"], [role="menuitem"], [role="listbox"] button, [role="listbox"] > div'
        )
      )
    );
    const cmdBoundaryRe = new RegExp(`\\b${target}\\b`, 'i');
    const cmdPrefixRe = new RegExp(`^\\/?${target}\\b`, 'i');
    for (const el of candidates) {
      if (!el || !el.isConnected) continue;
      if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') continue;
      const labelEl = typeof el.querySelector === 'function' ? el.querySelector('[data-testid="menu-option-label"]') : null;
      let isTargetOption = false;
      if (labelEl) {
        isTargetOption = cleanCompactCmd(getNonIconText(labelEl)) === target;
      } else {
        const txt = getNonIconText(el).replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 220) continue;
        const descMatch =
          target === 'compact'
            ? /compact the conversation/i.test(txt)
            : /side question|旁支|サイド質問|without interrupting/i.test(txt);
        isTargetOption =
          cmdBoundaryRe.test(txt) &&
          (descMatch ||
            (cmdPrefixRe.test(txt) &&
              typeof el.matches === 'function' &&
              el.matches('[role="option"], [role="listbox"] > div, [role="listbox"] button')));
      }
      if (!isTargetOption) continue;
      const clickableTarget =
        (labelEl && labelEl.parentElement && labelEl.parentElement !== el ? labelEl.parentElement : null) ||
        (typeof el.querySelector === 'function'
          ? el.querySelector('[class*="cursor-pointer"], button, a')
          : null) ||
        labelEl ||
        el;
      if (
        typeof clickableTarget.getAttribute === 'function' &&
        clickableTarget.getAttribute('aria-disabled') === 'true'
      ) {
        continue;
      }
      const rect = typeof clickableTarget.getBoundingClientRect === 'function' ? clickableTarget.getBoundingClientRect() : null;
      if (rect && (rect.height <= 0 || rect.height >= 120)) continue;
      try {
        if (typeof clickableTarget.dispatchEvent === 'function' && typeof MouseEvent === 'function') {
          clickableTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        }
        if (typeof clickableTarget.click === 'function') {
          clickableTarget.click();
        } else if (typeof clickableTarget.dispatchEvent === 'function' && typeof MouseEvent === 'function') {
          clickableTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        return true;
      } catch {}
    }
    return false;
  }

  function tryAutoSelectCompactMenu(ed) {
    return tryAutoSelectSlashMenu(ed, 'compact');
  }

  function resolveCompactPresetText(ui) {
    const mode = cfg?.compactPreset || 'clean';
    if (mode === 'clean') {
      return String(
        ui?.compactPresetClean ||
          'Drop verbose tool I/O, full logs, finished-task trial-and-error, and processed image/video details (keep conclusions only; for active unfinished tasks, extract key visual/content points first). Keep core business logic and architecture, finalized decisions, user preferences and rejected options, key constraints, full context of work in progress, and open TODOs.'
      ).trim();
    }
    if (mode === 'dev') {
      return String(
        ui?.compactPresetDev ||
          'Drop verbose tool I/O, raw file dumps, full diffs/logs, finished-task trial-and-error, and processed screenshot/video details (keep conclusions only; for active unfinished tasks, extract visual defects and locations first). Preserve core architecture, key file paths and symbol/API contracts, current branch, uncommitted changes and verification status, error root causes, known pitfalls, hard constraints and rejected options, active task details, and open TODOs.'
      ).trim();
    }
    if (mode === 'continue') {
      return String(
        ui?.compactPresetContinue ||
          'Drop verbose tool I/O/logs, finished-task trial-and-error, and processed image/video details (keep conclusions only; for active unfinished tasks, extract key points first). Preserve core architecture, hard constraints, user preferences/rejected options, the interrupted task checkpoint (progress, key paths, uncommitted changes, open errors, next action), and remaining TODOs. After compaction, resume immediately without recapping unless a user decision is required.'
      ).trim();
    }
    if (mode === 'custom') {
      return String(cfg?.compactCustomText || '').trim();
    }
    return '';
  }

  function insertCompactPresetAfterChip(ed, card, presetText) {
    if (!ed || !ed.isConnected || !presetText || !findStandaloneCompactChip(ed)) return false;
    try {
      ed.focus();
      try {
        if (typeof window !== 'undefined' && typeof window.getSelection === 'function' && typeof document.createRange === 'function') {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            const target = ed.lastElementChild || ed;
            range.selectNodeContents(target);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      } catch {}
      const curTxt = getNonIconText(ed);
      const payload = /\s$/.test(curTxt) ? presetText : ` ${presetText}`;
      let inserted = false;
      if (typeof document.execCommand === 'function') {
        inserted = Boolean(document.execCommand('insertText', false, payload));
      }
      if (!inserted) {
        if (typeof document.createTextNode === 'function') {
          const target = ed.lastElementChild || ed;
          target.appendChild(document.createTextNode(payload));
        }
        if (typeof InputEvent === 'function') {
          ed.dispatchEvent(new InputEvent('input', { bubbles: true, data: payload, inputType: 'insertText' }));
        }
      }
      syncCompactGuideHint(card, uiText(getLang()));
      return true;
    } catch {
      return false;
    }
  }

  function findPrimaryComposerTarget(scopeEl, conversationId = '') {
    if (scopeEl && (scopeEl.nodeType === 1 || typeof scopeEl.closest === 'function')) {
      const scopedBox = scopeEl.closest?.('[data-testid="agent-input-box"]') || scopeEl;
      const card =
        scopeEl.closest?.('.surface-composer-card') ||
        scopedBox?.querySelector?.('.surface-composer-card') ||
        scopeEl;
      const ed = scopedBox?.querySelector?.('[contenteditable="true"]') || null;
      return {
        card: ed ? card : null,
        ed,
        reason: ed ? '' : 'conversation_not_found',
      };
    }
    const cards = Array.from(document.querySelectorAll('[data-testid="agent-input-box"] .surface-composer-card'));
    const rawCid = String(conversationId || '').trim();
    const hasExplicitCid = Boolean(rawCid);
    const targetCid = normalizeCascadeId(rawCid);
    if (hasExplicitCid) {
      if (!targetCid) {
        return { card: null, ed: null, reason: 'conversation_not_found' };
      }
      const matchedCard =
        cards.find((c) => {
          if (c.closest?.('[data-testid="subagent-tab-conversation"]')) return false;
          const box = c.closest?.('[data-testid="agent-input-box"]');
          const boxCid = resolveCascadeId(box);
          return Boolean(boxCid && sameCascadeId(boxCid, targetCid));
        }) || null;
      if (!matchedCard) {
        return { card: null, ed: null, reason: 'conversation_not_found' };
      }
      const ed = matchedCard.querySelector?.('[contenteditable="true"]') || null;
      return {
        card: matchedCard,
        ed,
        reason: ed ? '' : 'conversation_not_found',
      };
    }
    const primaryCard =
      cards.find((c) => !c.closest?.('[data-testid="subagent-tab-conversation"]')) ||
      cards[0] ||
      null;
    const ed =
      primaryCard?.querySelector?.('[contenteditable="true"]') ||
      document.querySelector('[data-testid="agent-input-box"] [contenteditable="true"]') ||
      null;
    return { card: primaryCard, ed, reason: ed ? '' : 'composer_not_found' };
  }

  function fillBtwCommand(scopeEl, opts = {}) {
    let resolvedScope = scopeEl;
    let resolvedOpts = opts;
    if (
      resolvedScope &&
      resolvedScope.nodeType !== 1 &&
      typeof resolvedScope.closest !== 'function' &&
      typeof resolvedScope === 'object'
    ) {
      resolvedOpts = resolvedScope;
      resolvedScope = resolvedOpts.scopeEl || null;
    }
    const target = findPrimaryComposerTarget(resolvedScope, resolvedOpts?.conversationId || '');
    const { card, ed } = target;
    if (!ed) return { ok: false, reason: target.reason || 'composer_not_found' };
    try {
      const ui = uiText(getLang());
      if (findStandaloneBtwChip(ed)) {
        ed.focus();
        syncCompactGuideHint(card, ui);
        return { ok: true, reason: 'already_btw' };
      }
      const slashState = classifyComposerSlashState(ed);
      if (slashState.state === 'standalone_slash' && slashState.cmd === 'btw') {
        ed.focus();
        syncCompactGuideHint(card, ui);
        return { ok: true, reason: 'already_btw' };
      }
      if (slashState.state === 'draft') {
        try {
          ed.focus?.();
        } catch {}
        return { ok: false, action: 'draft_present', reason: 'draft_present' };
      }
      if (typeof window !== 'undefined' && typeof window.focus === 'function') {
        try {
          window.focus();
        } catch {}
      }
      if (!clearComposerAndInsertSlashCommand(ed, '/btw')) {
        try {
          ed.focus?.();
        } catch {}
        return { ok: false, action: 'insert_failed', reason: 'insert_failed' };
      }
      const delays = [60, 100, 140, 200, 260];
      let step = 0;
      const scheduleTrackedTimer = (fn, delayMs) => {
        const tid = setTimeout(() => {
          submitSyncTimers.delete(tid);
          fn();
        }, delayMs);
        submitSyncTimers.add(tid);
      };
      const refreshHint = () => {
        if (!destroyed && ed.isConnected && card) syncCompactGuideHint(card, uiText(getLang()));
      };
      const runAttempt = () => {
        if (destroyed || !ed.isConnected) return;
        if (tryAutoSelectSlashMenu(ed, 'btw')) {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(refreshHint);
          scheduleTrackedTimer(refreshHint, 50);
          scheduleTrackedTimer(refreshHint, 140);
          return;
        }
        if (step < delays.length) {
          scheduleTrackedTimer(runAttempt, delays[step++]);
        }
      };
      scheduleTrackedTimer(runAttempt, delays[step++]);
      return { ok: true, reason: 'composer_btw' };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }

  let cachedHostReduxStore = null;
  let cachedHostReduxRootEl = null;
  let cachedHostReduxProviderFiber = null;
  let cachedHostReduxPath = null;

  function resolveCachedFiberByPath(start, pathSteps) {
    if (!start || !Array.isArray(pathSteps)) return null;
    let cur = start;
    for (let i = 0; i < pathSteps.length; i++) {
      if (!cur) return null;
      cur = cur[pathSteps[i]];
    }
    return cur || null;
  }

  function findHostReduxStore() {
    try {
      const rootEl = document.getElementById('root') || document.body?.firstElementChild;
      if (!rootEl) {
        cachedHostReduxStore = null;
        cachedHostReduxRootEl = null;
        cachedHostReduxProviderFiber = null;
        cachedHostReduxPath = null;
        return null;
      }
      const fk = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
      const start = fk ? rootEl[fk]?.current || rootEl[fk] : null;
      if (!start) {
        cachedHostReduxStore = null;
        cachedHostReduxRootEl = null;
        cachedHostReduxProviderFiber = null;
        cachedHostReduxPath = null;
        return null;
      }
      if (
        cachedHostReduxStore &&
        cachedHostReduxRootEl === rootEl &&
        cachedHostReduxPath
      ) {
        const liveProvider = resolveCachedFiberByPath(start, cachedHostReduxPath);
        const liveStore = liveProvider?.memoizedProps?.value?.store;
        if (
          liveProvider &&
          liveStore &&
          typeof liveStore.getState === 'function' &&
          typeof liveStore.dispatch === 'function'
        ) {
          try {
            liveStore.getState();
            cachedHostReduxProviderFiber = liveProvider;
            cachedHostReduxStore = liveStore;
            return liveStore;
          } catch {
            cachedHostReduxStore = null;
            cachedHostReduxRootEl = null;
            cachedHostReduxProviderFiber = null;
            cachedHostReduxPath = null;
          }
        }
      }
      const queue = [{ fiber: start, path: [] }];
      let visited = 0;
      while (queue.length && visited < 15000) {
        const { fiber: f, path } = queue.shift();
        visited++;
        const val = f?.memoizedProps?.value;
        if (
          val &&
          typeof val === 'object' &&
          val.store &&
          typeof val.store.getState === 'function' &&
          typeof val.store.dispatch === 'function'
        ) {
          cachedHostReduxStore = val.store;
          cachedHostReduxRootEl = rootEl;
          cachedHostReduxProviderFiber = f;
          cachedHostReduxPath = path;
          return val.store;
        }
        if (f?.child) queue.push({ fiber: f.child, path: path.concat('child') });
        if (f?.sibling) queue.push({ fiber: f.sibling, path: path.concat('sibling') });
      }
    } catch {}
    cachedHostReduxStore = null;
    cachedHostReduxRootEl = null;
    cachedHostReduxProviderFiber = null;
    cachedHostReduxPath = null;
    return null;
  }

  function findVisibleConversationView() {
    try {
      const views = Array.from(document.querySelectorAll('[data-testid="conversation-view"]')).filter(
        (v) => !v.closest?.('[data-testid="subagent-tab-conversation"], [data-testid="side-panel-v2"]')
      );
      if (views.length === 0) return null;
      const isHiddenView = (v) => {
        if (v.getAttribute?.('data-visible') === 'false') return true;
        if (v.getAttribute?.('aria-hidden') === 'true') return true;
        if (v.hidden === true) return true;
        if (v.style?.display === 'none' || v.style?.visibility === 'hidden') return true;
        if (typeof getComputedStyle === 'function') {
          try {
            const cs = getComputedStyle(v);
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
          } catch {}
        }
        return false;
      };
      if (views.length === 1) {
        return isHiddenView(views[0]) ? null : views[0];
      }
      const nonHidden = views.filter((v) => !isHiddenView(v));
      if (nonHidden.length === 0) return null;
      if (nonHidden.length === 1) return nonHidden[0];

      // Multiple visible conversation views: disambiguate using route or Redux active cascadeId first
      let authCid = '';
      try {
        const m = String(location?.pathname || '').match(/\/c\/([0-9a-f-]{8,})/i);
        if (m && m[1]) authCid = normalizeCascadeId(m[1]) || m[1];
      } catch {}
      if (!authCid) {
        try {
          const storeCid = findHostReduxStore()?.getState?.()?.conversation?.convoState?.cascadeId;
          if (typeof storeCid === 'string' && storeCid.trim()) {
            authCid = normalizeCascadeId(storeCid) || storeCid.trim();
          }
        } catch {}
      }
      if (authCid) {
        const matchedByAuth = nonHidden.find((v) => {
          const vCid = normalizeCascadeId(v.getAttribute?.('data-cascade-id'));
          if (vCid && sameCascadeId(vCid, authCid)) return true;
          const boxCid = resolveCascadeId(v.querySelector?.('[data-testid="agent-input-box"]'));
          return Boolean(boxCid && sameCascadeId(boxCid, authCid));
        });
        if (matchedByAuth) return matchedByAuth;
      }

      const explicitVisible = nonHidden.find((v) => v.getAttribute?.('data-visible') === 'true' || v.getAttribute?.('data-active') === 'true');
      if (explicitVisible) return explicitVisible;
      const withRect = nonHidden.find((v) => {
        if (typeof v.getBoundingClientRect !== 'function') return false;
        const r = v.getBoundingClientRect();
        return Boolean(r && r.width > 0 && r.height > 0);
      });
      return withRect || nonHidden[0] || null;
    } catch {
      return null;
    }
  }

  function layoutHasCascadeId(node, targetCid) {
    if (!node || typeof node !== 'object' || !targetCid) return false;
    if (typeof node.cascadeId === 'string' && sameCascadeId(node.cascadeId, targetCid)) return true;
    if (Array.isArray(node.children)) {
      for (const ch of node.children) {
        if (layoutHasCascadeId(ch, targetCid)) return true;
      }
    }
    return false;
  }

  function doesHostWindowOwnConversation(targetCid, store) {
    const cleanCid = normalizeCascadeId(targetCid);
    if (!cleanCid) return false;
    try {
      const m = String(location?.pathname || '').match(/\/c\/([0-9a-f-]{8,})/i);
      if (m && m[1] && sameCascadeId(m[1], cleanCid)) return true;
    } catch {}
    try {
      const views = Array.from(document.querySelectorAll('[data-testid="conversation-view"]'));
      for (const v of views) {
        if (v.closest?.('[data-testid="subagent-tab-conversation"], [data-testid="side-panel-v2"]')) continue;
        const vCid = normalizeCascadeId(v.getAttribute?.('data-cascade-id'));
        if (vCid && sameCascadeId(vCid, cleanCid)) return true;
      }
      const boxes = Array.from(document.querySelectorAll('[data-testid="agent-input-box"]'));
      for (const b of boxes) {
        if (b.closest?.('[data-testid="subagent-tab-conversation"], [data-testid="side-panel-v2"]')) continue;
        const bCid = resolveCascadeId(b);
        if (bCid && sameCascadeId(bCid, cleanCid)) return true;
      }
    } catch {}
    try {
      const state = store?.getState?.();
      if (state) {
        const activeFromStore = state.conversation?.convoState?.cascadeId;
        if (activeFromStore && sameCascadeId(activeFromStore, cleanCid)) return true;
        if (layoutHasCascadeId(state.multiConvoLayout?.rootNode, cleanCid)) return true;
        if (state.sidePanelV2?.conversationPanes && state.sidePanelV2.conversationPanes[cleanCid]) return true;
        if (state.sideQuestion?.states && state.sideQuestion.states[cleanCid]) return true;
      }
    } catch {}
    return false;
  }

  function resolveActiveConversationIdForHost(preferredId, store) {
    const cleanPref = normalizeCascadeId(preferredId);
    if (cleanPref) return cleanPref;
    try {
      const activeFromStore = store?.getState?.()?.conversation?.convoState?.cascadeId;
      if (typeof activeFromStore === 'string' && activeFromStore.trim()) {
        return normalizeCascadeId(activeFromStore) || activeFromStore.trim();
      }
    } catch {}
    try {
      const m = String(location?.pathname || '').match(/\/c\/([0-9a-f-]{8,})/i);
      if (m && m[1]) return normalizeCascadeId(m[1]) || m[1];
    } catch {}
    try {
      const layout = store?.getState?.()?.multiConvoLayout;
      const walk = (node) => {
        if (!node || typeof node !== 'object') return '';
        if (typeof node.cascadeId === 'string' && node.cascadeId) return node.cascadeId;
        if (Array.isArray(node.children)) {
          for (const ch of node.children) {
            const hit = walk(ch);
            if (hit) return hit;
          }
        }
        return '';
      };
      const fromLayout = walk(layout?.rootNode);
      if (fromLayout) return normalizeCascadeId(fromLayout) || fromLayout;
    } catch {}
    try {
      const visibleView = findVisibleConversationView();
      if (visibleView) {
        const attrId = normalizeCascadeId(visibleView.getAttribute?.('data-cascade-id'));
        if (attrId) return attrId;
        const box = visibleView.querySelector?.('[data-testid="agent-input-box"]');
        const fromBox = resolveCascadeId(box);
        if (fromBox) return fromBox;
        return '';
      }
      const primaryBox = Array.from(document.querySelectorAll('[data-testid="agent-input-box"]')).find(
        (b) => !b.closest?.('[data-testid="subagent-tab-conversation"]') && !b.closest?.('[data-testid="side-panel-v2"]')
      );
      const fromDom = resolveCascadeId(primaryBox);
      if (fromDom) return fromDom;
    } catch {}
    return '';
  }

  function parseSummaryTimestampMs(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof ts === 'object' && ts.seconds != null) {
      const sec = Number(ts.seconds);
      if (Number.isFinite(sec) && sec > 0) return sec * 1000;
    }
    return 0;
  }

  function isSummaryRunningStatus(status) {
    if (status === 2) return true;
    const s = String(status || '').toUpperCase();
    return s.includes('RUNNING') || s.includes('CANCELLING');
  }

  function getSideQuestionsState(preferredConversationId = '') {
    const store = findHostReduxStore();
    const rawPref = String(preferredConversationId || '').trim();
    if (rawPref) {
      const reqCid = normalizeCascadeId(rawPref);
      if (!reqCid || !doesHostWindowOwnConversation(reqCid, store)) {
        return { ok: false, reason: 'conversation_not_found', action: 'conversation_not_found', items: [] };
      }
    }
    const cid = resolveActiveConversationIdForHost(rawPref, store);
    if (!store || !cid) {
      return { ok: true, conversationId: cid || '', items: [] };
    }
    const state = store.getState() || {};
    const pane = state.sidePanelV2?.conversationPanes?.[cid] || {};
    const openTabs = Array.isArray(pane.tabs) ? pane.tabs : [];
    const closedTabs = Array.isArray(pane.closedTabs) ? pane.closedTabs : [];
    const summaries = state.trajectorySummaries?.summaries || {};
    const parentSummary = summaries[cid] || {};
    const sqTitlesMap =
      parentSummary?.annotations?.sideQuestionTitles && typeof parentSummary.annotations.sideQuestionTitles === 'object'
        ? parentSummary.annotations.sideQuestionTitles
        : {};
    const persistedSqIds = Array.isArray(parentSummary?.annotations?.sideQuestionCascadeIds)
      ? parentSummary.annotations.sideQuestionCascadeIds
      : [];
    const openSideTabIds = new Set(
      openTabs
        .filter((t) => t?.content?.type === 'sideQuestionView')
        .map((t) => String(t.id || ''))
    );

    const items = [];
    const byKey = new Map();
    const mergeItem = (raw) => {
      const cascadeId = String(raw.cascadeId || '').trim();
      const tabId =
        String(raw.tabId || '').trim() ||
        (cascadeId ? `side_question__${cascadeId}` : 'side_question__draft');
      const sqSum = cascadeId ? summaries[cascadeId] : null;
      const resolvedTitle =
        String(raw.question || '').trim() ||
        (cascadeId ? String(sqTitlesMap[cascadeId] || '').trim() : '') ||
        String(sqSum?.annotations?.title || sqSum?.summary || '').trim();
      const dedupeKey = cascadeId ? `c:${cascadeId}` : tabId ? `t:${tabId}:${resolvedTitle.slice(0, 48)}` : `q:${resolvedTitle}`;
      const isOpen = openSideTabIds.has(tabId) || Boolean(raw.isOpenTab);
      const isRunning = Boolean(raw.isRunning) || isSummaryRunningStatus(sqSum?.status);
      const stepCount = Math.max(Number(raw.stepCount || 0) || 0, Number(sqSum?.stepCount || 0) || 0);
      const ts = Math.max(
        Number(raw.startTimestamp || 0) || 0,
        parseSummaryTimestampMs(sqSum?.lastModifiedTime),
        parseSummaryTimestampMs(sqSum?.createdTime)
      );

      const existing = byKey.get(dedupeKey);
      if (existing) {
        if (!existing.question && resolvedTitle) existing.question = resolvedTitle;
        if (!existing.tabId && tabId) existing.tabId = tabId;
        if (isOpen) {
          existing.isOpenTab = true;
          existing.minimized = false;
        }
        if (isRunning) existing.isRunning = true;
        if (stepCount > existing.stepCount) existing.stepCount = stepCount;
        if (ts > existing.startTimestamp) existing.startTimestamp = ts;
        if (existing.index === null && Number.isInteger(raw.index)) existing.index = raw.index;
        return;
      }

      const entry = {
        id: cascadeId || tabId || `sq_${items.length}`,
        cascadeId,
        tabId,
        question: resolvedTitle,
        mode: String(raw.mode || 'btw'),
        minimized: isOpen ? Boolean(raw.minimized && !isOpen) : raw.minimized !== false,
        isOpenTab: isOpen,
        isRunning,
        stepCount,
        index: Number.isInteger(raw.index) ? raw.index : null,
        startTimestamp: ts,
      };
      byKey.set(dedupeKey, entry);
      items.push(entry);
    };

    const sqState = state.sideQuestion?.states?.[cid];
    if (sqState && typeof sqState === 'object') {
      const hist = Array.isArray(sqState.history) && sqState.history.length > 0
        ? sqState.history
        : sqState.question || sqState.cascadeId
        ? [{ question: sqState.question, cascadeId: sqState.cascadeId, startTimestamp: sqState.startTimestamp, mode: sqState.mode }]
        : [];
      hist.forEach((h, idx) => {
        if (!h || (!h.question && !h.cascadeId)) return;
        mergeItem({
          cascadeId: h.cascadeId || '',
          question: h.question || '',
          mode: h.mode || sqState.mode || 'btw',
          minimized: Boolean(sqState.minimized),
          index: idx,
          startTimestamp: h.startTimestamp || 0,
        });
      });
    }

    const forks = state.ephemeralFork?.forks || {};
    for (const [forkId, meta] of Object.entries(forks)) {
      if (!meta || meta.parentConversationId !== cid) continue;
      mergeItem({
        cascadeId: forkId,
        question: meta.question || '',
        mode: 'btw',
        minimized: !openSideTabIds.has(`side_question__${forkId}`),
        startTimestamp: meta.startTimestamp || 0,
      });
    }

    for (const tab of openTabs) {
      if (tab?.content?.type !== 'sideQuestionView') continue;
      const fCid = String(tab.content?.sideQuestionView?.cascadeId || '').trim();
      mergeItem({
        cascadeId: fCid,
        tabId: String(tab.id || ''),
        question: String(tab.content?.sideQuestionView?.question || '').trim(),
        mode: 'btw',
        isOpenTab: true,
        minimized: false,
      });
    }

    for (const entry of closedTabs) {
      const tab = entry?.tab || entry;
      if (tab?.content?.type !== 'sideQuestionView') continue;
      const fCid = String(tab.content?.sideQuestionView?.cascadeId || '').trim();
      mergeItem({
        cascadeId: fCid,
        tabId: String(tab.id || ''),
        question: String(tab.content?.sideQuestionView?.question || '').trim(),
        mode: 'btw',
        minimized: true,
      });
    }

    for (const sqId of persistedSqIds) {
      const fCid = String(sqId || '').trim();
      if (!fCid) continue;
      mergeItem({
        cascadeId: fCid,
        tabId: `side_question__${fCid}`,
        question: String(sqTitlesMap[fCid] || '').trim(),
        mode: 'btw',
        minimized: !openSideTabIds.has(`side_question__${fCid}`),
      });
    }

    for (const [sqId, title] of Object.entries(sqTitlesMap)) {
      const fCid = String(sqId || '').trim();
      if (!fCid) continue;
      mergeItem({
        cascadeId: fCid,
        tabId: `side_question__${fCid}`,
        question: String(title || '').trim(),
        mode: 'btw',
        minimized: !openSideTabIds.has(`side_question__${fCid}`),
      });
    }

    items.sort((a, b) => {
      if (Boolean(b.isRunning) !== Boolean(a.isRunning)) return b.isRunning ? 1 : -1;
      if (Boolean(b.isOpenTab) !== Boolean(a.isOpenTab)) return b.isOpenTab ? 1 : -1;
      return (b.startTimestamp || 0) - (a.startTimestamp || 0);
    });
    return { ok: true, conversationId: cid, items };
  }

  let sideQuestionRestoreGen = 0;
  let sideQuestionRestoreActive = null;
  let internalSideQuestionClick = false;
  const sideQuestionRestoreTimers = new Set();

  function cancelSideQuestionRestore() {
    sideQuestionRestoreGen += 1;
    sideQuestionRestoreActive = null;
    for (const tid of sideQuestionRestoreTimers) {
      clearTimeout(tid);
    }
    sideQuestionRestoreTimers.clear();
  }

  function openSideQuestion(opts = {}) {
    const store = findHostReduxStore();
    const rawCid = String(opts?.conversationId || '').trim();
    if (rawCid) {
      const reqCid = normalizeCascadeId(rawCid);
      if (!reqCid || !doesHostWindowOwnConversation(reqCid, store)) {
        return {
          ok: false,
          action: 'conversation_not_found',
          reason: 'conversation_not_found',
          conversationId: '',
        };
      }
    }
    const cid = resolveActiveConversationIdForHost(rawCid, store);
    if (opts?.forceNew) {
      const res = fillBtwCommand({ conversationId: cid });
      return {
        ok: Boolean(res?.ok),
        action: res?.ok ? 'composer_btw' : (res?.action || res?.reason || 'composer_not_found'),
        reason: res?.ok ? '' : (res?.reason || 'composer_not_found'),
        conversationId: cid,
      };
    }

    const snap = getSideQuestionsState(cid);
    if (snap && snap.ok === false) {
      return {
        ok: false,
        action: snap.action || 'conversation_not_found',
        reason: snap.reason || 'conversation_not_found',
        conversationId: '',
      };
    }
    const items = Array.isArray(snap.items) ? snap.items : [];
    const reqCascadeId = String(opts?.cascadeId || '').trim();
    const reqTabId = String(opts?.tabId || '').trim();
    const hasExplicitIndex = opts?.index !== undefined && opts?.index !== null && opts?.index !== '';
    const reqIndex = Number.isInteger(opts?.index) && opts.index >= 0 ? opts.index : null;
    const hasExplicitTarget = Boolean(reqCascadeId || reqTabId || hasExplicitIndex);

    let target = null;
    if (reqCascadeId) {
      target = items.find((it) => it.cascadeId === reqCascadeId) || null;
    } else if (reqTabId) {
      target = items.find((it) => it.tabId === reqTabId) || null;
    } else if (hasExplicitIndex) {
      target = reqIndex !== null ? (items.find((it) => it.index === reqIndex) || null) : null;
    } else {
      target = items[0] || null;
    }

    if (hasExplicitTarget && (!target || !store || !cid)) {
      return {
        ok: false,
        action: 'side_question_not_found',
        reason: 'side_question_not_found',
        conversationId: cid,
      };
    }

    if (!target || !store || !cid) {
      const res = fillBtwCommand({ conversationId: cid });
      return {
        ok: Boolean(res?.ok),
        action: res?.ok ? 'composer_btw' : (res?.action || res?.reason || 'composer_not_found'),
        reason: res?.ok ? '' : (res?.reason || 'composer_not_found'),
        conversationId: cid,
      };
    }

    try {
      const sqState = store.getState()?.sideQuestion?.states?.[cid];
      if (sqState) {
        const idxToSelect = reqIndex !== null ? reqIndex : Number.isInteger(target.index) ? target.index : null;
        if (idxToSelect !== null) {
          store.dispatch({ type: 'sideQuestion/setSideQuestionIndex', payload: { conversationId: cid, index: idxToSelect } });
        }
        store.dispatch({ type: 'sideQuestion/restoreSideQuestion', payload: cid });
      }

      const tabId = target.tabId || (target.cascadeId ? `side_question__${target.cascadeId}` : 'side_question__draft');
      const sideQuestionView = target.cascadeId ? { cascadeId: target.cascadeId } : {};
      const panelScope = { kind: 'cascadeId', cascadeId: cid };
      store.dispatch({
        type: 'sidePanelV2/setContent',
        payload: {
          panelScope,
          content: { type: 'sideQuestionView', sideQuestionView },
          tabId,
          keepOpen: true,
        },
      });
      store.dispatch({
        type: 'sidePanelV2/setActiveTab',
        payload: {
          panelScope,
          tabId,
        },
      });

      const auxPane = document.querySelector('[data-aux-pane-open]');
      if (auxPane && auxPane.getAttribute('data-aux-pane-open') === 'false') {
        const toggleBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
        if (toggleBtn && typeof toggleBtn.click === 'function') toggleBtn.click();
      }
      const toolbarBtn = document.querySelector('[data-testid="side-question-toolbar-button"]');
      if (toolbarBtn && typeof toolbarBtn.click === 'function' && store.getState()?.sideQuestion?.states?.[cid]?.minimized) {
        toolbarBtn.click();
      }

      cancelSideQuestionRestore();
      const restoreGen = sideQuestionRestoreGen;
      const initialActiveTabId = document.querySelector('[data-side-panel-strip]')?.getAttribute('data-active-tab-id') || '';
      sideQuestionRestoreActive = {
        gen: restoreGen,
        conversationId: cid,
        tabId,
        sawTargetActive: initialActiveTabId === tabId,
      };

      const focusSideQuestionTab = () => {
        if (
          destroyed ||
          restoreGen !== sideQuestionRestoreGen ||
          !sideQuestionRestoreActive ||
          sideQuestionRestoreActive.gen !== restoreGen
        ) {
          return;
        }
        const liveCid = resolveActiveConversationIdForHost('', findHostReduxStore());
        if (cid && liveCid && !sameCascadeId(liveCid, cid)) {
          cancelSideQuestionRestore();
          return;
        }
        try {
          const strip = document.querySelector('[data-side-panel-strip]');
          const curTabId = strip ? (strip.getAttribute('data-active-tab-id') || '') : '';
          if (curTabId === tabId) {
            sideQuestionRestoreActive.sawTargetActive = true;
          } else if (sideQuestionRestoreActive.sawTargetActive) {
            cancelSideQuestionRestore();
            return;
          } else if (curTabId && initialActiveTabId && curTabId !== initialActiveTabId) {
            cancelSideQuestionRestore();
            return;
          }
          if (strip && curTabId !== tabId) {
            const tabBtns = Array.from(strip.querySelectorAll('button, [role="tab"]'));
            const matchBtn = tabBtns.find((btn) => {
              const idAttr = btn.getAttribute('data-tab-id') || btn.closest?.('[data-tab-id]')?.getAttribute('data-tab-id') || '';
              return idAttr === tabId;
            });
            if (matchBtn && typeof matchBtn.click === 'function') {
              internalSideQuestionClick = true;
              try {
                matchBtn.click();
              } finally {
                internalSideQuestionClick = false;
              }
            }
          }
          const afterTabId = strip ? (strip.getAttribute('data-active-tab-id') || '') : '';
          if (afterTabId === tabId) {
            sideQuestionRestoreActive.sawTargetActive = true;
          }
          const auxOpenAttr = document.querySelector('[data-aux-pane-open]')?.getAttribute('data-aux-pane-open');
          const isTargetTabActive = (!strip || afterTabId === tabId) && auxOpenAttr !== 'false';
          if (isTargetTabActive && restoreGen === sideQuestionRestoreGen) {
            const sidePane = document.querySelector('[data-aux-pane-open="true"], [data-testid="side-panel-v2"]');
            const sqEditor = sidePane?.querySelector?.('[data-testid="agent-input-box"] [contenteditable="true"]');
            if (sqEditor && typeof sqEditor.focus === 'function') {
              sqEditor.focus();
            }
          }
        } catch {}
      };
      focusSideQuestionTab();
      if (typeof setTimeout === 'function') {
        for (const delayMs of [40, 140]) {
          const tid = setTimeout(() => {
            sideQuestionRestoreTimers.delete(tid);
            focusSideQuestionTab();
          }, delayMs);
          sideQuestionRestoreTimers.add(tid);
        }
      }

      return { ok: true, action: 'restored', conversationId: cid, cascadeId: target.cascadeId || '', tabId };
    } catch {
      return { ok: false, action: 'restore_failed', conversationId: cid };
    }
  }

  function fillCompactCommand(scopeEl) {
    const scopedBox = scopeEl?.closest?.('[data-testid="agent-input-box"]') || scopeEl;
    const card =
      scopeEl?.closest?.('.surface-composer-card') ||
      scopedBox?.querySelector?.('.surface-composer-card') ||
      scopeEl;
    const ed =
      scopedBox?.querySelector?.('[contenteditable="true"]') ||
      document.querySelector('[data-testid="agent-input-box"] [contenteditable="true"]');
    if (!ed) return false;
    try {
      const ui = uiText(getLang());
      const presetText = resolveCompactPresetText(ui);
      if (findStandaloneCompactChip(ed)) {
        ed.focus();
        if (presetText) {
          insertCompactPresetAfterChip(ed, card, presetText);
        } else {
          syncCompactGuideHint(card, ui);
        }
        return true;
      }
      const slashState = classifyComposerSlashState(ed);
      if (slashState.state === 'standalone_slash' && slashState.cmd === 'compact') {
        ed.focus();
        if (presetText && !slashState.hasPreset) {
          insertCompactPresetAfterChip(ed, card, presetText);
        } else {
          syncCompactGuideHint(card, ui);
        }
        return true;
      }
      if (slashState.state === 'draft') {
        try {
          ed.focus?.();
        } catch {}
        return false;
      }
      if (!clearComposerAndInsertSlashCommand(ed, '/compact')) {
        try {
          ed.focus?.();
        } catch {}
        return false;
      }
      const delays = [60, 100, 140, 200, 250];
      let step = 0;
      const schedulePresetOrHint = () => {
        if (!presetText) {
          const refreshHint = () => {
            if (!destroyed && ed.isConnected) syncCompactGuideHint(card, uiText(getLang()));
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(refreshHint);
          setTimeout(refreshHint, 40);
          return;
        }
        const presetDelays = [40, 80, 140, 220];
        let pStep = 0;
        const tryInsertPreset = () => {
          if (destroyed || !ed.isConnected) return;
          if (insertCompactPresetAfterChip(ed, card, presetText)) return;
          if (pStep < presetDelays.length) {
            setTimeout(tryInsertPreset, presetDelays[pStep++]);
          }
        };
        setTimeout(tryInsertPreset, presetDelays[pStep++]);
      };
      const runAttempt = () => {
        if (destroyed || !ed.isConnected) return;
        if (tryAutoSelectCompactMenu(ed)) {
          schedulePresetOrHint();
          return;
        }
        if (step < delays.length) {
          setTimeout(runAttempt, delays[step++]);
        }
      };
      setTimeout(runAttempt, delays[step++]);
      return true;
    } catch {
      return false;
    }
  }

  function renderContextPopoverContent(pop, data, cascadeId) {
    const lang = getLang();
    const ui = uiText(lang);
    const card = openPopoverAnchor?.closest?.('.surface-composer-card') || document.querySelector('[data-testid="agent-input-box"] .surface-composer-card');
    const { ring, draftEst, activeQuota } = getRingTelemetryForCard(card, data);
    const totalW = ring.maxTokens || 256000;
    const sys = Number(data?.sysTokens || 0);
    const tools = Number(data?.toolsTokens || 0);
    const toolRes = Number(data?.toolResultsTokens || 0);
    const msgs = Number(
      data?.chatMsgTokens != null ? data.chatMsgTokens : Math.max(0, Number(data?.msgTokens || 0) - toolRes)
    );
    const overhead = Number(data?.overheadTokens || 0);
    const draft = Number(draftEst.tokens || 0);
    const modelName = data?.lastModel || getCurrentModelLabel(card) || ui.activeModelFallback || 'Active Model';
    const remStr = `${formatCompactK(ring.remainingTokens)} / ${formatCompactK(totalW)} (${ring.contextRemainingPct.toFixed(1)}%)`;
    const usedStr = `${formatCompactK(ring.usedTokens)} (${ring.contextUsedPct.toFixed(1)}%)`;
    const isLowCtx = Boolean((data?.calls > 0 || ring.usedTokens > 0) && ring.contextRemainingPct <= 20);
    const lowCtxLevel = ring.contextRemainingPct <= 10 ? 'danger' : 'warn';
    const lowCtxBannerHtml = isLowCtx
      ? `<button type="button" class="ag-cs-ctx-warn-banner" data-ctx-act="compact" data-ctx-low="${lowCtxLevel}">${escapeHtml(
          typeof ui.lowCtxBanner === 'function'
            ? ui.lowCtxBanner(Math.round(ring.contextRemainingPct))
            : `Low context (${Math.round(ring.contextRemainingPct)}% free) — click to fill /compact`
        )}</button>`
      : '';
    const activeReset5h = fmtBucketReset(activeQuota?.b5h, lang);
    const activeResetWeek = fmtBucketReset(activeQuota?.bWeek, lang);
    const quotaBadgeHtml =
      activeQuota && typeof activeQuota.effectiveRemainingPct === 'number'
        ? `<span class="ag-cs-ctx-quota-pill" style="color:${activeQuota.effectiveRemainingPct <= 10 ? '#dc3c3d' : activeQuota.effectiveRemainingPct <= 30 ? '#fbb315' : '#38bdf8'}">${escapeHtml(ui.quotaRemShort || 'Quota Rem')} ${activeQuota.effectiveRemainingPct.toFixed(1)}%${activeReset5h ? ' · ' + escapeHtml(activeReset5h) : activeResetWeek ? ' · ' + escapeHtml(activeResetWeek) : ''}</span>`
        : '';
    const statusBadgeHtml = data?.isRunning
      ? `<span class="ag-cs-ctx-live-pill">${escapeHtml(data.isThinking ? ui.thinkingEllipsis || 'Thinking…' : ui.streamingEllipsis || 'Streaming…')}</span>`
      : '';

    const pctOf = (v) => Math.max(0, Math.min(100, (v / totalW) * 100)).toFixed(2);
    const turnCount = Array.isArray(data?.turnDetails) ? data.turnDetails.length : data?.turns || 0;
    const toolCount = (Array.isArray(data?.toolBreakdown) ? data.toolBreakdown.length : 0) + Number(data?.subagentCount || 0);

    let tabBodyHtml = '';
    if (activeHudTab === 'breakdown') {
      const sysChildren = Array.isArray(data?.sysChildren) ? data.sysChildren : [];
      const toolsChildren = Array.isArray(data?.toolsChildren) ? data.toolsChildren : [];
      const topSteps = Array.isArray(data?.topSteps) ? data.topSteps : [];
      const segRows = [
        {
          id: 'sys',
          color: '#3b82f6',
          label: ui.segSystemRules || 'System & Rules',
          val: sys,
          children: sysChildren,
        },
        {
          id: 'tools',
          color: '#a855f7',
          label: typeof ui.toolDeclarationsN === 'function' ? ui.toolDeclarationsN(toolsChildren.length) : `Tool Declarations (${toolsChildren.length})`,
          val: tools,
          children: toolsChildren,
        },
        {
          id: 'msgs',
          color: '#10b981',
          label: ui.segChatMessages || 'Chat Messages',
          val: msgs,
        },
        {
          id: 'toolres',
          color: '#f59e0b',
          label: ui.segToolResults || 'Tool Results',
          val: toolRes,
          children: topSteps.map((s) => ({ name: s.label || s.name, tokens: s.tokens })),
        },
      ];
      if (overhead > 0) {
        segRows.push({ id: 'overhead', color: '#64748b', label: ui.segOverhead || 'Context Overhead', val: overhead });
      }
      if (draft > 0) {
        segRows.push({
          id: 'draft',
          color: '#ec4899',
          label: typeof ui.liveDraftN === 'function' ? ui.liveDraftN(draftEst.chars) : `Live Draft (${draftEst.chars} chars)`,
          val: draft,
        });
      }
      segRows.push({
        id: 'rem',
        color: ring.color,
        label: ui.segRemaining || 'Remaining Free Capacity',
        val: ring.remainingTokens,
        highlight: true,
      });

      const rulesB = Number(data?.budgets?.rulesTokenBudget || 0);
      const customB = Number(data?.budgets?.customizationTokenBudget || 0);

      tabBodyHtml = `
        <div class="ag-cs-ctx-kpi-grid">
          <div class="ag-cs-ctx-kpi">
            <span class="ag-cs-ctx-k">${escapeHtml(ui.kpiRemaining || 'Remaining Free')}</span>
            <span class="ag-cs-ctx-v" data-ag-live-kpi-rem-v="1" style="color:${ring.color}">${formatCompactK(ring.remainingTokens)} <small>(${ring.contextRemainingPct.toFixed(1)}%)</small></span>
            <span class="ag-cs-ctx-sub" data-ag-live-kpi-rem-sub="1">${escapeHtml(ui.usedWord || 'Used')} ${formatCompactK(ring.usedTokens)} / ${formatCompactK(totalW)}</span>
          </div>
          <div class="ag-cs-ctx-kpi">
            <span class="ag-cs-ctx-k">${escapeHtml(ui.kpiCacheHit || 'Cache Hit Rate')}</span>
            <span class="ag-cs-ctx-v">${(data?.cacheHitPct || 0).toFixed(1)}%</span>
            <span class="ag-cs-ctx-sub">${escapeHtml(ui.cacheReadShort || 'Read')} ${formatCompactK(data?.lastCacheRead || 0)} · ${escapeHtml(ui.cacheFreshShort || 'Fresh')} ${formatCompactK(data?.lastFreshInput || 0)}</span>
          </div>
          <div class="ag-cs-ctx-kpi">
            <span class="ag-cs-ctx-k">${escapeHtml(ui.kpiSpeed || 'Output Speed')}</span>
            <span class="ag-cs-ctx-v">${(data?.displaySpeed || data?.lastSpeed) ? (data.displaySpeed || data.lastSpeed) + ' tok/s' : '—'}</span>
            <span class="ag-cs-ctx-sub">${escapeHtml(ui.speedAvgShort || 'Avg')} ${data?.avgSpeed || 0} tok/s · TTFT ${(data?.avgTtft || data?.lastTtft || 0).toFixed(2)}s</span>
          </div>
          <div class="ag-cs-ctx-kpi">
            <span class="ag-cs-ctx-k">${escapeHtml(ui.kpiSessionTotal || 'Session Total')}</span>
            <span class="ag-cs-ctx-v">${formatCompactK(data?.totalTokens || 0)}</span>
            <span class="ag-cs-ctx-sub">${data?.turns || 0} ${escapeHtml(ui.turnsUnit || 'turns')} · ${data?.calls || 0} ${escapeHtml(ui.callsUnit || 'calls')} · ${escapeHtml(ui.outShort || 'Out')} ${formatCompactK(data?.totalOutput || 0)}</span>
          </div>
        </div>
        <div class="ag-cs-ctx-sec-title">${escapeHtml(ui.ctxBreakdownTitle || 'Context Window Breakdown')}</div>
        <div class="ag-cs-ctx-rows">
          ${segRows
            .map((r) => {
              const hasCh = Array.isArray(r.children) && r.children.length > 0;
              const isExp = hasCh && expandedHudGroups.has(r.id);
              const chHtml = isExp
                ? `<div class="ag-cs-ctx-children">
                    ${r.children
                      .slice(0, 12)
                      .map(
                        (c) => `
                      <div class="ag-cs-ctx-child-row">
                        <span class="ag-cs-ctx-child-name">${escapeHtml(c.name || '')}</span>
                        <span class="ag-cs-ctx-child-val">${formatCompactK(c.tokens || 0)}</span>
                      </div>`
                      )
                      .join('')}
                  </div>`
                : '';
              const labelAttr = r.id === 'draft' ? ' data-ag-live-draft-label="1"' : '';
              const valAttr = r.id === 'draft' ? ' data-ag-live-draft-val="1"' : r.id === 'rem' ? ' data-ag-live-rem-val="1"' : '';
              return `
                <div class="ag-cs-ctx-row${r.highlight ? ' is-highlight' : ''}${hasCh ? ' is-expandable' : ''}" ${hasCh ? `data-expand-group="${r.id}"` : ''}>
                  <span class="ag-cs-ctx-row-label"><span class="ag-cs-ctx-dot" style="background:${r.color}"></span><span${labelAttr}>${escapeHtml(r.label)}</span>${hasCh ? ` <small class="ag-cs-ctx-caret">${isExp ? '▾' : '▸'}</small>` : ''}</span>
                  <span class="ag-cs-ctx-row-val"${valAttr}>${formatCompactK(r.val)} <small>(${((r.val / totalW) * 100).toFixed(1)}%)</small></span>
                </div>
                ${chHtml}`;
            })
            .join('')}
        </div>
        ${
          rulesB > 0 || customB > 0
            ? `<div class="ag-cs-ctx-budgets">
                <span>${escapeHtml(ui.rulesBudget || 'Rules Budget')}: <strong>${formatCompactK(rulesB)}</strong></span>
                <span>${escapeHtml(ui.customBudget || 'Custom Budget')}: <strong>${formatCompactK(customB)}</strong></span>
                <span>${escapeHtml(ui.maxWindow || 'Max Window')}: <strong>${formatCompactK(totalW)}</strong></span>
              </div>`
            : ''
        }
        <div class="ag-cs-ctx-sec-title">${escapeHtml(ui.latestCallTitle || 'Latest Model Call')}</div>
        <div class="ag-cs-ctx-latest-grid">
          <div><span>${escapeHtml(ui.freshIn || 'Fresh In')}</span><strong>${formatCompactK(data?.lastFreshInput || 0)}</strong></div>
          <div><span>${escapeHtml(ui.cacheRead || 'Cache Read')}</span><strong>${formatCompactK(data?.lastCacheRead || 0)}</strong></div>
          <div><span>${escapeHtml(ui.replyOutput || 'Output')}</span><strong>${formatCompactK(data?.lastOutput || 0)}</strong></div>
          <div><span>${escapeHtml(ui.thinkingTokens || 'Thinking')}</span><strong>${formatCompactK(data?.lastThinking || 0)}</strong></div>
        </div>
      `;
    } else if (activeHudTab === 'turns') {
      const turns = Array.isArray(data?.turnDetails) ? data.turnDetails.slice().reverse() : [];
      if (turns.length === 0) {
        tabBodyHtml = `<div class="ag-cs-ctx-empty">${escapeHtml(ui.turnsEmpty || 'No turn records in active conversation yet.')}</div>`;
      } else {
        tabBodyHtml = `
          <div class="ag-cs-ctx-turns-list">
            ${turns
              .map((t) => {
                const dSign = t.ctxDelta >= 0 ? '+' : '';
                const dCls = t.ctxDelta >= 15000 ? 'is-high' : t.ctxDelta >= 5000 ? 'is-mid' : '';
                return `
                  <div class="ag-cs-ctx-turn-item">
                    <div class="ag-cs-ctx-turn-top">
                      <span class="ag-cs-ctx-turn-idx">#T${t.turn}</span>
                      <span class="ag-cs-ctx-turn-model">${escapeHtml(t.model || modelName)}</span>
                      <span class="ag-cs-ctx-turn-ctx">${escapeHtml(ui.ctxShort || 'Ctx')} ${formatCompactK(t.ctxUsed)}</span>
                      <span class="ag-cs-ctx-turn-delta ${dCls}">${dSign}${formatCompactK(t.ctxDelta)}</span>
                    </div>
                    ${t.userPreview ? `<div class="ag-cs-ctx-turn-prompt">${escapeHtml(t.userPreview)}</div>` : ''}
                    <div class="ag-cs-ctx-turn-meta">
                      <span>${escapeHtml(ui.outShort || 'Out')} ${formatCompactK(t.output)}</span>
                      ${t.thinking > 0 ? `<span>${escapeHtml(ui.thinkShort || 'Think')} ${formatCompactK(t.thinking)}</span>` : ''}
                      ${t.toolCalls > 0 ? `<span>🔧 ×${t.toolCalls}</span>` : ''}
                      ${t.speed > 0 ? `<span>⚡ ${t.speed} tok/s</span>` : ''}
                      <span>${escapeHtml(ui.cacheShort || 'Cache')} ${t.cacheHitPct}%</span>
                      ${t.subagentCalls > 0 ? `<span class="ag-cs-ctx-subagent-tag">🤖 ×${t.subagentCount || t.subagentCalls} (${formatCompactK(t.subagentTokens)})</span>` : ''}
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        `;
      }
    } else if (activeHudTab === 'tools') {
      const toolsList = Array.isArray(data?.toolBreakdown) ? data.toolBreakdown : [];
      const subList = Array.isArray(data?.subagents) ? data.subagents : [];
      const maxToolTok = toolsList.reduce((m, x) => Math.max(m, x.tokens || 0), 1);
      const subHead =
        typeof ui.subagentsHeading === 'function'
          ? ui.subagentsHeading(data?.subagentCount || 0, data?.subagentCalls || 0, formatCompactK(data?.subagentTokens || 0))
          : `Subagents (${data?.subagentCount || 0} · ${data?.subagentCalls || 0} calls · Total ${formatCompactK(data?.subagentTokens || 0)})`;
      const toolHead =
        typeof ui.toolResultsHeading === 'function'
          ? ui.toolResultsHeading(formatCompactK(data?.toolResultsTokens || 0))
          : `Tool Results Leaderboard (${formatCompactK(data?.toolResultsTokens || 0)} tok)`;
      tabBodyHtml = `
        <div class="ag-cs-ctx-sec-title">${escapeHtml(subHead)}</div>
        ${
          subList.length === 0
            ? `<div class="ag-cs-ctx-empty-sm">${escapeHtml(ui.noSubagents || 'No subagents invoked in this session.')}</div>`
            : `<div class="ag-cs-ctx-sub-list">
                ${subList
                  .map(
                    (s, idx) => `
                  <div class="ag-cs-ctx-sub-item">
                    <div class="ag-cs-ctx-sub-head">
                      <strong>🤖 #${idx + 1} (${escapeHtml(s.shortId || s.id || 'sub')}) ${s.isRunning ? `<em class="ag-cs-ctx-active-tag">${escapeHtml(ui.runningTag || 'Running')}</em>` : ''}</strong>
                      <span>${formatCompactK(s.totalTokens)} tok</span>
                    </div>
                    <div class="ag-cs-ctx-sub-meta">
                      <span>${escapeHtml(s.model || modelName)}</span>
                      <span>${s.calls || 0} ${escapeHtml(ui.callsUnit || 'calls')} / ${s.steps || 0} ${escapeHtml(ui.stepsUnit || 'steps')}</span>
                      <span>${escapeHtml(ui.outShort || 'Out')} ${formatCompactK(s.outputTokens || 0)}</span>
                      ${s.toolCount > 0 ? `<span>🔧 ×${s.toolCount}</span>` : ''}
                    </div>
                  </div>`
                  )
                  .join('')}
              </div>`
        }
        <div class="ag-cs-ctx-sec-title">${escapeHtml(toolHead)}</div>
        ${
          toolsList.length === 0
            ? `<div class="ag-cs-ctx-empty-sm">${escapeHtml(ui.noToolOutputs || 'No tool output data yet.')}</div>`
            : `<div class="ag-cs-ctx-tool-list">
                ${toolsList
                  .slice(0, 12)
                  .map(
                    (t) => `
                  <div class="ag-cs-ctx-tool-row">
                    <div class="ag-cs-ctx-tool-info">
                      <span class="ag-cs-ctx-tool-name">${escapeHtml(t.name)} <small>×${t.count}</small></span>
                      <span class="ag-cs-ctx-tool-val">~${formatCompactK(t.tokens)}</span>
                    </div>
                    <div class="ag-cs-ctx-tool-bar"><span style="width:${Math.min(100, ((t.tokens || 0) / maxToolTok) * 100).toFixed(1)}%"></span></div>
                  </div>`
                  )
                  .join('')}
              </div>`
        }
      `;
    } else if (activeHudTab === 'quotas') {
      const groups = Array.isArray(cachedQuotaData?.groups) ? cachedQuotaData.groups : [];
      tabBodyHtml = `
        <div class="ag-cs-ctx-sec-title">${escapeHtml(ui.quotaPoolsTitle || 'Model Quota Pools Remaining')}</div>
        ${
          groups.length === 0
            ? `<div class="ag-cs-ctx-empty-sm">${escapeHtml(ui.quotaLoading || 'Loading model quota status…')}</div>`
            : `<div class="ag-cs-ctx-quota-list">
                ${groups
                  .map((g) => {
                    const qPct = typeof g.effectiveRemainingPct === 'number' ? g.effectiveRemainingPct : 0;
                    const qCol = qPct <= 10 ? '#dc3c3d' : qPct <= 30 ? '#fbb315' : '#257de0';
                    const isAct = activeQuota && activeQuota.groupName === g.groupName;
                    const r5h = fmtBucketReset(g.b5h, lang);
                    const rWeek = fmtBucketReset(g.bWeek, lang);
                    return `
                      <div class="ag-cs-ctx-quota-row${isAct ? ' is-active' : ''}">
                        <div class="ag-cs-ctx-quota-top">
                          <span><strong>${escapeHtml(g.groupName)}</strong>${isAct ? ` <em class="ag-cs-ctx-active-tag">${escapeHtml(ui.activeTag || 'Active')}</em>` : ''}</span>
                          <span style="color:${qCol};font-weight:600">${escapeHtml(ui.remShort || 'Rem')} ${qPct.toFixed(1)}%</span>
                        </div>
                        <div class="ag-cs-ctx-quota-bar"><span style="width:${Math.max(0, Math.min(100, qPct)).toFixed(1)}%;background:${qCol}"></span></div>
                        <div class="ag-cs-ctx-quota-sub">
                          <span>${g.b5h && !g.b5h.disabled ? `5h: ${g.b5h.remainingPct.toFixed(1)}% (${escapeHtml(r5h || '—')})` : g.bWeek ? `${escapeHtml(ui.weeklyLabel || 'Weekly')}: ${g.bWeek.remainingPct.toFixed(1)}% (${escapeHtml(rWeek || '—')})` : ''}</span>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>`
        }
      `;
    }

    const tabTurnsLabel = typeof ui.tabTurnsN === 'function' ? ui.tabTurnsN(turnCount) : `Turns (${turnCount})`;
    const tabToolsLabel = typeof ui.tabToolsN === 'function' ? ui.tabToolsN(toolCount) : `Tools (${toolCount})`;
    const prevBodyScrollTop = pop.querySelector('.ag-cs-ctx-body')?.scrollTop || 0;

    pop.innerHTML = `
      <div class="ag-cs-ctx-top-bar">
        <div class="ag-cs-ctx-title-wrap">
          <span class="ag-cs-ctx-title">${escapeHtml(ui.popoverTitle || 'Context & Token HUD')}</span>
          <span class="ag-cs-ctx-model-badge">${escapeHtml(modelName)}</span>
          ${statusBadgeHtml}
        </div>
        <div class="ag-cs-ctx-actions">
          <button type="button" class="ag-cs-ctx-act-btn" data-ctx-act="compact" title="${escapeHtml(ui.compactBtnTitle || 'Fill /compact into composer')}">/compact</button>
          <button type="button" class="ag-cs-ctx-act-btn" data-ctx-act="copy" title="${escapeHtml(ui.copyBtnTitle || 'Copy telemetry report')}">${escapeHtml(ui.copyBtnLabel || 'Copy')}</button>
          <button type="button" class="ag-cs-ctx-act-btn" data-ctx-act="refresh" title="${escapeHtml(ui.refreshBtnTitle || 'Refresh telemetry')}">↻</button>
          <button type="button" class="ag-cs-ctx-act-btn is-close" data-ctx-act="close" title="${escapeHtml(ui.closeBtnTitle || 'Close')}">×</button>
        </div>
      </div>
      <div class="ag-cs-ctx-hero">
        <div class="ag-cs-ctx-hero-line">
          <span class="ag-cs-ctx-rem-main" data-ag-live-rem-hero="1" style="color:${ring.color}">${escapeHtml(ui.remAvailLabel || 'Remaining')} ${remStr}</span>
          <span class="ag-cs-ctx-used-sub" data-ag-live-used="1">${escapeHtml(ui.usedWord || 'Used')} ${usedStr}${draft > 0 ? ` · ${escapeHtml(ui.draftWord || 'Draft')} +${formatCompactK(draft)}` : ''}</span>
        </div>
        ${lowCtxBannerHtml}
        ${quotaBadgeHtml ? `<div class="ag-cs-ctx-hero-sub">${quotaBadgeHtml}</div>` : ''}
        <div class="ag-cs-ctx-bar">
          <span class="ag-cs-ctx-seg-sys" style="width:${pctOf(sys)}%" title="${escapeHtml(ui.segSystemRules || 'System')}: ${formatCompactK(sys)}"></span>
          <span class="ag-cs-ctx-seg-tools" style="width:${pctOf(tools)}%" title="${escapeHtml(ui.toolsShort || 'Tools')}: ${formatCompactK(tools)}"></span>
          <span class="ag-cs-ctx-seg-msgs" style="width:${pctOf(msgs)}%" title="${escapeHtml(ui.segChatMessages || 'Messages')}: ${formatCompactK(msgs)}"></span>
          <span class="ag-cs-ctx-seg-toolres" style="width:${pctOf(toolRes)}%" title="${escapeHtml(ui.segToolResults || 'Tool Results')}: ${formatCompactK(toolRes)}"></span>
          ${overhead > 0 ? `<span class="ag-cs-ctx-seg-overhead" style="width:${pctOf(overhead)}%;background:#64748b" title="${escapeHtml(ui.segOverhead || 'Context Overhead')}: ${formatCompactK(overhead)}"></span>` : ''}
          <span class="ag-cs-ctx-seg-draft" data-ag-live-draft-seg="1" style="width:${pctOf(draft)}%" title="${escapeHtml(ui.draftWord || 'Draft')}: ${formatCompactK(draft)}"></span>
        </div>
      </div>
      <div class="ag-cs-ctx-tabs" role="tablist">
        <button type="button" role="tab" class="ag-cs-ctx-tab${activeHudTab === 'breakdown' ? ' is-active' : ''}" data-ctx-tab="breakdown">${escapeHtml(ui.tabBreakdown || 'Breakdown')}</button>
        <button type="button" role="tab" class="ag-cs-ctx-tab${activeHudTab === 'turns' ? ' is-active' : ''}" data-ctx-tab="turns">${escapeHtml(tabTurnsLabel)}</button>
        <button type="button" role="tab" class="ag-cs-ctx-tab${activeHudTab === 'tools' ? ' is-active' : ''}" data-ctx-tab="tools">${escapeHtml(tabToolsLabel)}</button>
        <button type="button" role="tab" class="ag-cs-ctx-tab${activeHudTab === 'quotas' ? ' is-active' : ''}" data-ctx-tab="quotas">${escapeHtml(ui.tabQuotas || 'Quotas')}</button>
      </div>
      <div class="ag-cs-ctx-body">
        ${tabBodyHtml}
      </div>
    `;
    pop._agCsRenderedData = data;
    pop._agCsHadDraft = draft > 0;
    pop._agCsLowCtxAttr = isLowCtx ? lowCtxLevel : '';
    const newBodyEl = pop.querySelector('.ag-cs-ctx-body');
    if (newBodyEl && prevBodyScrollTop > 0) newBodyEl.scrollTop = prevBodyScrollTop;

    pop.querySelectorAll('button[data-ctx-tab]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activeHudTab = btn.getAttribute('data-ctx-tab') || 'breakdown';
        renderContextPopoverContent(pop, data, cascadeId);
        if (openPopoverAnchor) positionPopoverAboveAnchor(pop, openPopoverAnchor);
      });
    });

    pop.querySelectorAll('button[data-ctx-act]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const act = btn.getAttribute('data-ctx-act');
        if (act === 'close') {
          closeContextPopover();
        } else if (act === 'compact') {
          const targetCard = card;
          closeContextPopover();
          fillCompactCommand(targetCard);
        } else if (act === 'copy') {
          const curLang = getLang();
          const curUi = uiText(curLang);
          const safeData = data || createEmptyConvoData(cascadeId, getKnownMaxContextForCard(card, data));
          const textPayload =
            typeof usageCore.buildTelemetryReport === 'function'
              ? usageCore.buildTelemetryReport(safeData, draftEst, cachedQuotaData, activeQuota, curLang)
              : JSON.stringify(safeData || {}, null, 2);

          const writeClipboard = async () => {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
              return false;
            }
            try {
              await navigator.clipboard.writeText(textPayload);
              return true;
            } catch {
              return false;
            }
          };

          const setFeedback = (label, stateKind) => {
            if (!btn.isConnected) return;
            clearTimeout(btn._agCsFeedbackTimer);
            btn.setAttribute('data-action-state', stateKind);
            btn.textContent = label;
            btn._agCsFeedbackTimer = setTimeout(() => {
              if (!btn.isConnected) return;
              const resetUi = uiText(getLang());
              btn.removeAttribute('data-action-state');
              btn.textContent = resetUi.copyBtnLabel || 'Copy';
            }, 1400);
          };

          writeClipboard().then((clipOk) => {
            setFeedback(
              clipOk ? curUi.copiedBtnLabel || '✓ Copied' : curUi.actionFailedLabel || '✕ Failed',
              clipOk ? 'ok' : 'error'
            );
          });
        } else if (act === 'refresh') {
          Promise.all([fetchActiveConvo(cascadeId, true), fetchQuotaData(true)]).then(([fresh]) => {
            if (openPopover === pop && pop.isConnected) {
              renderContextPopoverContent(pop, fresh || data, cascadeId);
              if (openPopoverAnchor) positionPopoverAboveAnchor(pop, openPopoverAnchor);
            }
          });
        }
      });
    });

    pop.querySelectorAll('[data-expand-group]').forEach((row) => {
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const gid = row.getAttribute('data-expand-group');
        if (!gid) return;
        if (expandedHudGroups.has(gid)) expandedHudGroups.delete(gid);
        else expandedHudGroups.add(gid);
        renderContextPopoverContent(pop, data, cascadeId);
        if (openPopoverAnchor) positionPopoverAboveAnchor(pop, openPopoverAnchor);
      });
    });
  }

  function positionPopoverAboveAnchor(pop, anchor) {
    if (!pop || !anchor) return;
    const aRect = anchor.getBoundingClientRect();
    const vw = window.innerWidth || 900;
    const vh = window.innerHeight || 700;
    const placeAbove = aRect.top >= 240 || aRect.top >= vh - aRect.bottom;
    if (aRect.top >= 240) {
      pop.style.maxHeight = Math.min(645, Math.max(220, Math.floor(aRect.top - 16))) + 'px';
    } else if (!placeAbove) {
      pop.style.maxHeight = Math.min(645, Math.max(180, Math.floor(vh - aRect.bottom - 16))) + 'px';
    } else {
      pop.style.maxHeight = Math.min(645, Math.max(180, Math.floor(aRect.top - 16))) + 'px';
    }
    const pRect = pop.getBoundingClientRect();
    const popW = pop.offsetWidth || pop.clientWidth || pRect.width;
    const maxCap = parseFloat(pop.style.maxHeight) || pRect.height;
    const popH = Math.min(pop.offsetHeight || pRect.height, maxCap);
    const left = Math.max(8, Math.min(vw - popW - 8, aRect.right - popW));
    let top = placeAbove ? aRect.top - popH - 8 : aRect.bottom + 8;
    if (placeAbove && top < 8) {
      top = Math.max(8, Math.min(vh - popH - 8, aRect.bottom + 8));
    } else if (!placeAbove && top + popH > vh - 8) {
      top = Math.max(8, aRect.top - popH - 8);
    }
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  function openContextPopover(anchor, data, initialTab) {
    if (openPopover && openPopoverAnchor === anchor && (!initialTab || activeHudTab === initialTab)) {
      closeContextPopover();
      return;
    }
    closeContextPopover();
    closeEffortPopover();
    if (initialTab) activeHudTab = initialTab;
    const inputBox = anchor?.closest?.('[data-testid="agent-input-box"]') || document.querySelector('[data-testid="agent-input-box"]');
    const cascadeId = resolveCascadeId(inputBox);
    openPopoverCascadeId = cascadeId;

    const pop = document.createElement('div');
    pop.className = 'ag-cs-ctx-popover';
    pop.setAttribute('data-ag-no-i18n', '');
    openPopover = pop;
    openPopoverAnchor = anchor;
    renderContextPopoverContent(pop, data, cascadeId);
    document.body.appendChild(pop);
    positionPopoverAboveAnchor(pop, anchor);

    Promise.all([
      cascadeId ? fetchActiveConvo(cascadeId, true) : Promise.resolve(null),
      fetchQuotaData(false),
    ]).then(([fresh]) => {
      if (openPopover === pop && pop.isConnected) {
        const latest = fresh || activeTrajCache.get(cascadeId)?.data || data;
        renderContextPopoverContent(pop, latest, cascadeId);
        positionPopoverAboveAnchor(pop, anchor);
      }
    });
  }

  let lastUserSubmitAt = 0;

  function getDomConvoSignal(cascadeId) {
    let cv = null;
    if (cascadeId) {
      const views = document.querySelectorAll('[data-testid="conversation-view"]');
      for (const v of views) {
        if (v.getAttribute('data-cascade-id') === cascadeId) {
          cv = v;
          break;
        }
      }
      if (!cv && views.length > 0) cv = views[0];
    } else {
      cv = document.querySelector('[data-testid="conversation-view"]');
    }
    const resps = cv ? cv.querySelectorAll('[data-testid="agent-response"]') : [];
    let fiberStepsLen = 0;
    let fiberRunning = false;
    if (resps.length > 0) {
      const lastResp = resps[resps.length - 1];
      const tf = extractFiberTurnContainer(lastResp);
      const steps = tf?.container?.steps;
      if (Array.isArray(steps)) {
        fiberStepsLen = steps.length;
        for (let i = Math.max(0, steps.length - 6); i < steps.length; i++) {
          if (steps[i]?.status === 1 || steps[i]?.status === 2) {
            fiberRunning = true;
            break;
          }
        }
      }
    }
    let domRunning = fiberRunning;
    if (!domRunning) {
      const panels = document.querySelectorAll('[data-testid="running-items-panel"]');
      for (const p of panels) {
        if (String(p.className || '').includes('grid-rows-[1fr]')) {
          domRunning = true;
          break;
        }
      }
    }
    if (!domRunning) {
      const inputBoxes = document.querySelectorAll('[data-testid="agent-input-box"]');
      for (const ib of inputBoxes) {
        if (ib.querySelector('[data-testid="stop-button"], [data-testid="cancel-button"]')) {
          domRunning = true;
          break;
        }
        for (const btn of ib.querySelectorAll('button')) {
          const aria = String(btn.getAttribute('aria-label') || '');
          const tid = String(btn.getAttribute('data-testid') || '');
          if (/stop|cancel|停止|取消/i.test(aria) || /stop|cancel/i.test(tid)) {
            domRunning = true;
            break;
          }
        }
        if (domRunning) break;
      }
    }
    return {
      domSig: `${resps.length}:${fiberStepsLen}:${domRunning ? 1 : 0}`,
      domRunning,
    };
  }

  async function fetchActiveConvo(cascadeId, force = false, scopeEl = null) {
    if (!cascadeId) return null;
    const h = ensureHooks(true);
    const liveProv = findCascadeAgentStateProvider(cascadeId, scopeEl);
    if (!h && !liveProv) return null;
    if (h && !h.svc && !h.trajCtx && !liveProv) return null;
    const st = h?.store?.getState?.() || {};
    const rawPrimary = st.trajectorySummaries?.summaries || {};
    const rawFallback = st.cascadeTrajectorySummaries || {};
    const allSummaries = { ...rawFallback, ...rawPrimary };
    const sumEntry = rawPrimary[cascadeId] || rawFallback[cascadeId] || allSummaries[cascadeId];
    const sum = sumEntry?.summary || sumEntry || {};
    const isCloud = Boolean(sum?.cloud === true || cloudOnlyCascadeIds.has(cascadeId));
    const liveState = liveProv ? liveProv.getState?.() || null : null;
    if (liveProv && isCloud) {
      watchAgentStateProvider(cascadeId, liveProv);
    }
    const liveSlice = liveState?.trajectorySlice || null;
    const liveSteps = Array.isArray(liveSlice?.stepsInSlice) ? liveSlice.stepsInSlice : [];
    const liveLastStep = liveSteps.length > 0 ? liveSteps[liveSteps.length - 1] : null;
    const liveSig = liveState
      ? `${liveSlice?.totalStepsLength || liveSteps.length}:${liveSteps.length}:${liveState.status || 0}:${liveState.fullyIdle ? 1 : 0}:${liveLastStep?.status || 0}:${liveLastStep?.metadata?.modelUsage?.outputTokens || 0}:${liveLastStep?.step?.value?.thinking?.length || 0}:${liveLastStep?.step?.value?.response?.length || 0}:${liveState.contextWindowUsage?.estimatedTokensUsed || 0}`
      : '';
    const stepCount = Math.max(
      Number(sum?.stepCount || 0),
      Number(liveSlice?.totalStepsLength || 0),
      liveSteps.length
    );
    const lastMod = Math.floor(
      typeof usageCore?.tsSec === 'function' ? usageCore.tsSec(sum?.lastModifiedTime) : Number(sum?.lastModifiedTime?.seconds || 0)
    );
    const { domSig, domRunning } = getDomConvoSignal(cascadeId);
    const running = !!(
      sum?.notFullyIdle ||
      sum?.hasActivity ||
      sum?.status === 2 ||
      sum?.hasRunningSubagents ||
      liveState?.status === 2 ||
      (liveState && liveState.fullyIdle === false) ||
      domRunning
    );

    // Discover child subagents belonging to this conversation
    const childMetaList = [];
    for (const [subId, rawEntry] of Object.entries(allSummaries)) {
      if (subId === cascadeId) continue;
      const s = rawEntry?.summary || rawEntry || {};
      const meta = s.trajectoryMetadata || {};
      if (meta.parentConversationId === cascadeId || meta.rootConversationId === cascadeId) {
        childMetaList.push({
          id: subId,
          parentId: meta.parentConversationId || '',
          rootId: meta.rootConversationId || '',
          summary: s.summary || '',
          summaryObj: s,
          stepCount: Number(s.stepCount || 0),
          status: Number(s.status || 1),
          createdAt: meta.createdAt || s.createdTime,
        });
      }
    }

    let entry = activeTrajCache.get(cascadeId);
    if (entry) {
      // Touch for LRU ordering
      activeTrajCache.delete(cascadeId);
      activeTrajCache.set(cascadeId, entry);
    } else {
      entry = {
        fetching: false,
        promise: null,
        needsRefetch: false,
        lastStep: -1,
        lastMod: -1,
        lastSubCount: -1,
        lastRunning: false,
        lastDomSig: '',
        lastLiveSig: '',
        lastAt: 0,
        data: null,
      };
      activeTrajCache.set(cascadeId, entry);
      pruneMapCache(
        activeTrajCache,
        MAX_ACTIVE_TRAJ_CACHE,
        openPopoverCascadeId ? new Set([openPopoverCascadeId]) : null
      );
    }
    const now = Date.now();
    const changed =
      !entry.data ||
      entry.lastStep !== stepCount ||
      entry.lastMod !== lastMod ||
      entry.lastSubCount !== childMetaList.length ||
      entry.lastRunning !== running ||
      entry.lastDomSig !== domSig ||
      entry.lastLiveSig !== liveSig;

    if (entry.promise) {
      if (force || changed) entry.needsRefetch = true;
      return entry.promise;
    }

    const recentlySubmitted = now - lastUserSubmitAt < 12000;
    const isHot = running || Boolean(entry.data?.isRunning) || recentlySubmitted;
    const ttlMs = isHot ? 1000 : document.hidden ? 15000 : 3500;
    if (!force && !changed && entry.data && now - entry.lastAt < ttlMs) {
      return entry.data;
    }

    entry.fetching = true;
    entry.promise = (async () => {
      try {
        const res = await resolveTrajectoryPayload(cascadeId, sum, h, {
          scopeEl,
          allowTempStream: !liveProv,
          watchLive: isCloud,
          timeoutMs: 3500,
        });
        if (!res) return entry.data;
        const knownMax = getKnownMaxContextForCard(null, entry.data);
        const analyzed = usageCore.analyzeActiveConversation(res, {
          cascadeId,
          knownLimits: knownMax > 0 ? { maxContextTokens: knownMax } : undefined,
        });
        if (entry.data && entry.data.totalSteps > 0 && analyzed && analyzed.totalSteps === 0 && analyzed.totalCalls === 0) {
          return entry.data;
        }
        if (
          analyzed &&
          analyzed.maxContextTokens > 0 &&
          analyzed.hasActiveLimits &&
          analyzed.hasExactContextLimits !== false &&
          analyzed.lastModel
        ) {
          const mKey = normalizeModelCtxKey(analyzed.lastModel);
          if (mKey) knownModelMaxCtx.set(mKey, analyzed.maxContextTokens);
        }
        if (analyzed && analyzed.calls > 0 && typeof usageCore.analyzeTrajectoryForUsage === 'function') {
          try {
            const rec = usageCore.analyzeTrajectoryForUsage(res, sum, cascadeId);
            if (rec) {
              usageRecords.set(cascadeId, rec);
              if (isCloud || cloudOnlyCascadeIds.has(cascadeId)) saveUsageCache();
            }
          } catch {}
        }

        if (childMetaList.length > 0 && typeof usageCore.attachSubagentSummaries === 'function') {
          const subItems = await Promise.all(
            childMetaList.slice(0, 12).map(async (cm) => {
              const cachedSub = subagentTrajCache.get(cm.id);
              const subIsCloud = Boolean(cm.summaryObj?.cloud === true || cloudOnlyCascadeIds.has(cm.id));
              if (!subIsCloud && cachedSub && cachedSub.stepCount === cm.stepCount && cachedSub.status === 1 && cm.status === 1) {
                return { ...cm, analysis: cachedSub.analysis };
              }
              try {
                const subRes = await resolveTrajectoryPayload(cm.id, cm.summaryObj, h, {
                  allowTempStream: true,
                  timeoutMs: 2500,
                });
                if (!subRes) return cm;
                const subAnalysis = usageCore.analyzeActiveConversation(subRes, { cascadeId: cm.id });
                subagentTrajCache.delete(cm.id);
                subagentTrajCache.set(cm.id, {
                  stepCount: Math.max(cm.stepCount, subAnalysis?.totalSteps || 0),
                  status: cm.status,
                  analysis: subAnalysis,
                });
                pruneMapCache(subagentTrajCache, MAX_SUBAGENT_TRAJ_CACHE, null);
                return { ...cm, analysis: subAnalysis };
              } catch {
                return cm;
              }
            })
          );
          usageCore.attachSubagentSummaries(analyzed, subItems);
        }

        entry.data = analyzed;
        entry.lastStep = stepCount;
        entry.lastMod = lastMod;
        entry.lastSubCount = childMetaList.length;
        entry.lastRunning = running;
        entry.lastDomSig = domSig;
        entry.lastLiveSig = liveSig;
        entry.lastAt = Date.now();
      } catch {} finally {
        entry.fetching = false;
        entry.promise = null;
        if (entry.needsRefetch && !destroyed) {
          entry.needsRefetch = false;
          entry.lastAt = 0;
          scheduleSync();
        }
      }
      return entry.data;
    })();
    return entry.promise;
  }

  // ── Pixel Crab Mascot Player ───────────────────────────────────────────
  let crabState = {
    root: null,
    sprite: null,
    strip: null,
    stage: mascotCore.freshStage(Date.now()),
    wasRunning: false,
    anchor: null,
  };

  function playCrabAnimation(strip, key, mode) {
    if (crabState.stage.animation) {
      crabState.stage.animation.cancel();
      crabState.stage.animation = null;
    }
    const sheet = crabAssets.CRAB_SHEETS[key];
    if (!sheet) return;
    if (motionReduced() && !crabState.stage.reaction) {
      strip.style.transform = mascotCore.frameOffset(sheet, sheet.still, crabAssets.CRAB_GUTTER);
      return;
    }
    strip.style.transform = '';
    const keyframes = [];
    const duration = sheet.frames * crabAssets.CRAB_FRAME_MS;
    for (let f = 0; f < sheet.frames; f++) {
      keyframes.push({
        offset: f / sheet.frames,
        transform: mascotCore.frameOffset(sheet, f, crabAssets.CRAB_GUTTER),
        easing: 'steps(1)',
      });
    }
    keyframes.push({
      offset: 1,
      transform: mascotCore.frameOffset(sheet, mode === 'loop' ? 0 : sheet.frames - 1, crabAssets.CRAB_GUTTER),
    });
    const anim = strip.animate(keyframes, {
      duration,
      iterations: mode === 'loop' ? Infinity : 1,
      fill: 'forwards',
    });
    crabState.stage.animation = anim;
    if (mode === 'once') {
      anim.finished.then(
        () => {
          if (crabState.stage.animation !== anim || !crabState.stage.current || crabState.stage.current.key !== key || crabState.stage.current.done) return;
          crabState.stage.current.done = true;
          mascotCore.finishStage(crabState.stage, key, Date.now(), Math.random);
          stepCrab();
        },
        () => {}
      );
    }
  }

  function showCrabSheet(next, now) {
    const sheet = crabAssets.CRAB_SHEETS[next.key];
    const urls = crabAssets.CRAB_SHEET_URLS[next.key];
    if (!sheet || !urls || !crabState.root || !crabState.strip) return;
    const [cw, ch] = mascotCore.cellSize(sheet, crabAssets.CRAB_GUTTER);
    crabState.stage.current = { key: next.key, mode: next.mode, priority: next.priority, start: now };
    if (crabState.stage.reaction && crabState.stage.reaction.key === next.key) {
      crabState.stage.reaction.fresh = false;
    }
    const st = crabState.root.style;
    st.setProperty('--ag-cs-mascot-sheet', `url("${urls.body}")`);
    st.setProperty('--ag-cs-crab-ink', `url("${urls.ink}")`);
    st.setProperty('--ag-cs-mascot-x', String(sheet.box[0]));
    st.setProperty('--ag-cs-mascot-y', String(sheet.box[1]));
    st.setProperty('--ag-cs-mascot-w', String(sheet.box[2]));
    st.setProperty('--ag-cs-mascot-h', String(sheet.box[3]));
    st.setProperty('--ag-cs-mascot-cell-w', String(cw));
    st.setProperty('--ag-cs-mascot-columns', '8');
    st.setProperty('--ag-cs-mascot-strip-h', String(ch * Math.ceil(sheet.frames / 8)));
    crabState.root.setAttribute('data-animation', next.key);
    playCrabAnimation(crabState.strip, next.key, next.mode);
    if (!crabState.root.hasAttribute('data-ready')) crabState.root.setAttribute('data-ready', '');
  }

  function stepCrab() {
    if (destroyed || !crabState.root || !crabState.strip) return;
    const now = Date.now();
    if (
      crabState.stage.current &&
      crabState.stage.current.mode === 'once' &&
      !crabState.stage.current.done &&
      now - crabState.stage.current.start >= (crabAssets.CRAB_SHEETS[crabState.stage.current.key]?.frames || 1) * crabAssets.CRAB_FRAME_MS
    ) {
      crabState.stage.current.done = true;
      mascotCore.finishStage(crabState.stage, crabState.stage.current.key, now, Math.random);
    }
    const next = mascotCore.decideStage(crabState.stage, now, crabState.stage.level, {
      extras: mascotCore.CRAB_EXTRAS,
      extrasAllowed: !motionReduced() && !document.hidden,
      random: Math.random,
    });
    const switching =
      !crabState.stage.current ||
      next.key !== crabState.stage.current.key ||
      (crabState.stage.reaction && crabState.stage.reaction.fresh);
    const settled = mascotCore.switchSettles(crabState.stage, next, now);
    if (switching && settled) {
      showCrabSheet(next, now);
    }
    if (crabState.stage.timer) clearTimeout(crabState.stage.timer);
    crabState.stage.timer = null;
    const at = mascotCore.nextDecisionAt(
      crabState.stage,
      now,
      switching && !settled,
      (k) => (crabAssets.CRAB_SHEETS[k]?.frames || 1) * crabAssets.CRAB_FRAME_MS
    );
    if (at !== Infinity) {
      crabState.stage.timer = setTimeout(() => {
        crabState.stage.timer = null;
        stepCrab();
      }, Math.max(0, at - now));
    }
  }

  function buildCrabNode() {
    const root = document.createElement('span');
    root.className = 'ag-cs-crab';
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-ag-no-i18n', '');
    const sprite = document.createElement('span');
    sprite.className = 'ag-cs-crab-sprite';
    const strip = document.createElement('span');
    strip.className = 'ag-cs-crab-strip';
    sprite.appendChild(strip);
    root.appendChild(sprite);

    const hit = document.createElement('span');
    hit.className = 'ag-cs-crab-hit';
    hit.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      crabState.stage.quietSince = Date.now();
      crabState.stage.press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, lifted: false };
      try {
        hit.setPointerCapture(ev.pointerId);
      } catch {}
    });
    hit.addEventListener('pointermove', (ev) => {
      const p = crabState.stage.press;
      if (!p || p.lifted || ev.pointerId !== p.id) return;
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 4) return;
      p.lifted = true;
      crabState.stage.clicks = [];
      crabState.stage.reaction = { key: 'drag', mode: 'loop', fresh: true };
      stepCrab();
    });
    const endPress = (ev, allowPoke) => {
      const p = crabState.stage.press;
      if (!p || ev.pointerId !== p.id) return;
      const lifted = p.lifted;
      crabState.stage.press = null;
      if (lifted) {
        crabState.stage.reaction = null;
        stepCrab();
        return;
      }
      if (!allowPoke) return;
      const now = Date.now();
      if (crabState.stage.clicks.length > 0 && now - crabState.stage.clicks[crabState.stage.clicks.length - 1] > 450) {
        crabState.stage.clicks = [];
      }
      crabState.stage.clicks.push(now);
      if (crabState.stage.clicks.length >= 4) {
        crabState.stage.clicks = [];
        crabState.stage.reaction = { key: 'tickle', mode: 'once', fresh: true };
        stepCrab();
        return;
      }
      const box = hit.getBoundingClientRect();
      const key = ev.clientX - box.left < box.width / 2 ? 'poke-left' : 'poke-right';
      crabState.stage.reaction = { key, mode: 'once', fresh: true };
      stepCrab();
    };
    hit.addEventListener('pointerup', (ev) => endPress(ev, true));
    hit.addEventListener('pointercancel', (ev) => endPress(ev, false));
    hit.addEventListener('click', (ev) => ev.stopPropagation());
    root.appendChild(hit);
    return { root, sprite, strip };
  }

  function unmountCrab() {
    if (crabState.stage.timer) clearTimeout(crabState.stage.timer);
    if (crabState.stage.animation) crabState.stage.animation.cancel();
    if (crabState.root && crabState.root.parentElement) crabState.root.parentElement.removeChild(crabState.root);
    if (crabState.anchor) crabState.anchor.removeAttribute('data-ag-cs-crab-anchor');
    crabState.root = null;
    crabState.sprite = null;
    crabState.strip = null;
    crabState.anchor = null;
    crabState.stage = mascotCore.freshStage(Date.now());
  }

  function syncCrab(activeCard, activeInfo) {
    if (cfg.mascot !== 'crab' || !activeCard) {
      unmountCrab();
      return;
    }
    let needsStep = false;
    if (!crabState.root) {
      const built = buildCrabNode();
      crabState.root = built.root;
      crabState.sprite = built.sprite;
      crabState.strip = built.strip;
      needsStep = true;
    }
    if (crabState.root.parentElement !== activeCard) {
      if (crabState.anchor) crabState.anchor.removeAttribute('data-ag-cs-crab-anchor');
      activeCard.setAttribute('data-ag-cs-crab-anchor', 'composer');
      activeCard.appendChild(crabState.root);
      crabState.anchor = activeCard;
      needsStep = true;
    }
    const now = Date.now();
    const isRunning = Boolean(activeInfo?.isRunning);
    if (crabState.wasRunning && !isRunning) {
      mascotCore.takeMoment(crabState.stage, activeInfo?.hasError ? 'error' : 'attention', now);
      needsStep = true;
    }
    crabState.wasRunning = isRunning;
    const nextLevel = mascotCore.levelFromActiveInfo(activeInfo);
    if (!crabState.stage.level || crabState.stage.level.state !== nextLevel.state) {
      crabState.stage.level = nextLevel;
      needsStep = true;
    }
    if (needsStep || !crabState.stage.current) stepCrab();
  }

  // ── Per-Turn Token Badges (.ag-cs-turn-bar) & Surround HUD Bars ────────
  function clearTurnBadges() {
    document.querySelectorAll('.ag-cs-turn-bar').forEach((n) => n.remove());
  }

  function extractFiberTurnContainer(el) {
    let fEl = el;
    let foundContainer = null;
    let foundCascadeId = '';
    let foundStepIdx = -1;
    let foundMaxStepIdx = -1;
    let foundStepTimeSec = 0;
    let hasRunningStep = false;
    let isEmptySteps = false;

    const readStepIndexFromObj = (obj) => {
      if (!obj || typeof obj !== 'object') return -1;
      for (const k of ['stepIndex', 'startStepIndex', 'firstStepIndex', 'index']) {
        const v = obj[k];
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
      }
      const srcIdx = obj?.metadata?.sourceTrajectoryStepInfo?.stepIndex;
      if (typeof srcIdx === 'number' && Number.isInteger(srcIdx) && srcIdx >= 0) return srcIdx;
      if (Array.isArray(obj.stepIndices) && obj.stepIndices.length > 0) {
        const valid = obj.stepIndices.filter((n) => Number.isInteger(n) && n >= 0);
        if (valid.length > 0) return Math.min(...valid);
      }
      return -1;
    };

    for (let d = 0; d < 6 && fEl; d++) {
      const fk = Object.keys(fEl).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? fEl[fk] : null;
      for (let fd = 0; fd < 16 && f; fd++) {
        const p = f.memoizedProps || f.pendingProps;
        if (p && typeof p === 'object') {
          if (!foundCascadeId && typeof p.cascadeId === 'string' && p.cascadeId) {
            foundCascadeId = p.cascadeId;
          }
          if (p.status === 1 || p.status === 2 || p.step?.status === 1 || p.step?.status === 2) {
            hasRunningStep = true;
          }
          if (foundStepIdx < 0) {
            const directIdx = readStepIndexFromObj(p);
            if (directIdx >= 0) {
              foundStepIdx = directIdx;
              if (directIdx > foundMaxStepIdx) foundMaxStepIdx = directIdx;
            }
          }
          if (!foundContainer && p.container && Array.isArray(p.container.steps)) {
            foundContainer = p.container;
            if (!foundCascadeId && typeof p.container.cascadeId === 'string') {
              foundCascadeId = p.container.cascadeId;
            }
            if (foundStepIdx < 0) {
              const cIdx = readStepIndexFromObj(p.container);
              if (cIdx >= 0) {
                foundStepIdx = cIdx;
                if (cIdx > foundMaxStepIdx) foundMaxStepIdx = cIdx;
              }
            }
            if (p.container.steps.length === 0) {
              isEmptySteps = true;
            }
            for (const s of p.container.steps) {
              if (s?.status === 1 || s?.status === 2) {
                hasRunningStep = true;
              }
              const sIdx = readStepIndexFromObj(s);
              if (sIdx >= 0) {
                if (foundStepIdx < 0) foundStepIdx = sIdx;
                if (sIdx > foundMaxStepIdx) foundMaxStepIdx = sIdx;
              }
              if (foundStepTimeSec === 0 && s?.metadata?.createdAt && typeof usageCore.tsSec === 'function') {
                const sec = usageCore.tsSec(s.metadata.createdAt);
                if (sec > 0) foundStepTimeSec = sec;
              }
            }
            return {
              container: foundContainer,
              cascadeId: foundCascadeId,
              stepIndex: foundStepIdx,
              maxStepIndex: foundMaxStepIdx >= 0 ? foundMaxStepIdx : foundStepIdx,
              stepTimeSec: foundStepTimeSec,
              hasRunningStep,
              isEmptySteps,
            };
          }
        }
        f = f.return;
      }
      fEl = fEl.parentElement;
    }
    if (foundCascadeId || foundStepIdx >= 0 || foundStepTimeSec > 0 || hasRunningStep) {
      return {
        container: null,
        cascadeId: foundCascadeId,
        stepIndex: foundStepIdx,
        maxStepIndex: foundMaxStepIdx >= 0 ? foundMaxStepIdx : foundStepIdx,
        stepTimeSec: foundStepTimeSec,
        hasRunningStep,
        isEmptySteps,
      };
    }
    return null;
  }

  function summarizeFiberSteps(steps, fallbackModel, prevCtxUsed) {
    let ctxUsed = 0;
    let outSum = 0;
    let thinkSum = 0;
    let lastIn = 0;
    let lastCr = 0;
    let toolCalls = 0;
    let llmCalls = 0;
    for (const s of steps) {
      const sc = s?.step?.case;
      const mu = s?.metadata?.modelUsage || s?.step?.value?.metadata?.modelUsage;
      if (mu) {
        const inp = Number(mu.inputTokens || 0);
        const cr = Number(mu.cacheReadTokens || 0);
        const out = Number(mu.outputTokens || 0);
        if (inp + cr > 0) {
          ctxUsed = inp + cr;
          lastIn = inp;
          lastCr = cr;
          llmCalls++;
        }
        outSum += out;
      }
      if (sc === 'plannerResponse') {
        const th = s?.step?.value?.thinking || '';
        if (th && typeof usageCore.estimateTextTokens === 'function') {
          thinkSum += usageCore.estimateTextTokens(th).tokens;
        }
      } else if (sc && sc !== 'userInput' && sc !== 'systemMessage' && sc !== 'checkpoint') {
        toolCalls++;
      }
    }
    const promptTot = lastIn + lastCr;
    const cacheHitPct = promptTot > 0 ? Math.round((lastCr / promptTot) * 100) : 0;
    const ctxDelta = prevCtxUsed > 0 && ctxUsed > 0 ? ctxUsed - prevCtxUsed : ctxUsed;
    return {
      model: fallbackModel || 'Model',
      ctxUsed,
      ctxDelta,
      output: outSum,
      thinking: thinkSum,
      toolCalls,
      calls: llmCalls,
      speed: 0,
      cacheHitPct,
      subagentCount: 0,
      subagentCalls: 0,
      subagentTokens: 0,
    };
  }

  function syncTurnBadges(data) {
    if (!isUsageStatsEnabled() || cfg.turnBadges === false || !data || !Array.isArray(data.turnDetails) || data.turnDetails.length === 0) {
      clearTurnBadges();
      return;
    }
    const lang = getLang();
    const ui = uiText(lang);
    const cv = document.querySelector('[data-testid="conversation-view"]');
    if (!cv) {
      clearTurnBadges();
      return;
    }
    const allResps = Array.from(cv.querySelectorAll('[data-testid="agent-response"]'));
    if (allResps.length === 0) {
      clearTurnBadges();
      return;
    }

    // Build DOM turn-group map from [data-testid="user-input-step"] boundaries in main conversation
    const mainFlowNodes = Array.from(
      cv.querySelectorAll('[data-testid="user-input-step"], [data-testid="agent-response"]')
    ).filter((el) => !el.closest('[data-testid="subagent-tab-conversation"]'));
    const hasDomUserSteps = mainFlowNodes.some((el) => el.matches('[data-testid="user-input-step"]'));
    const domTurnGroupByResp = new Map();
    if (hasDomUserSteps) {
      let currentGroup = 0;
      for (const node of mainFlowNodes) {
        if (node.matches('[data-testid="user-input-step"]')) {
          currentGroup++;
        } else {
          domTurnGroupByResp.set(node, currentGroup);
        }
      }
    }

    // Group responses by cascadeId and deduplicate multi-response turns (keeping the last response host per turn)
    const rawMainTargets = [];
    const mainByContainer = new Map();
    const mainByDomGroup = new Map();
    const otherTargets = [];
    const otherByContainer = new Map();

    const mergeFiberInfo = (prevFi, nextFi) => {
      if (!prevFi) return nextFi || null;
      if (!nextFi) return prevFi;
      return {
        container: nextFi.container || prevFi.container || null,
        cascadeId: nextFi.cascadeId || prevFi.cascadeId || '',
        stepIndex: prevFi.stepIndex >= 0 ? prevFi.stepIndex : nextFi.stepIndex,
        maxStepIndex: Math.max(
          prevFi.maxStepIndex ?? prevFi.stepIndex ?? -1,
          nextFi.maxStepIndex ?? nextFi.stepIndex ?? -1
        ),
        stepTimeSec: prevFi.stepTimeSec > 0 ? prevFi.stepTimeSec : nextFi.stepTimeSec,
        hasRunningStep: Boolean(prevFi.hasRunningStep || nextFi.hasRunningStep),
        isEmptySteps: Boolean(!prevFi.container && nextFi.isEmptySteps),
      };
    };

    for (const resp of allResps) {
      const host = resp.closest('[data-turn-content]') || resp.parentElement || resp;
      const fiberInfo = extractFiberTurnContainer(resp);
      const inSubagentPane = Boolean(resp.closest('[data-testid="subagent-tab-conversation"]'));
      const isMain =
        !inSubagentPane &&
        (!fiberInfo || !fiberInfo.cascadeId || !data.cascadeId || sameCascadeId(fiberInfo.cascadeId, data.cascadeId));
      const item = {
        host,
        resp,
        fiberInfo,
        domTurnGroup: hasDomUserSteps && domTurnGroupByResp.has(resp) ? domTurnGroupByResp.get(resp) : -1,
      };

      if (isMain) {
        const containerRef = fiberInfo && fiberInfo.container ? fiberInfo.container : null;
        if (containerRef && mainByContainer.has(containerRef)) {
          const existing = mainByContainer.get(containerRef);
          existing.host = host;
          existing.resp = resp;
          existing.fiberInfo = mergeFiberInfo(existing.fiberInfo, fiberInfo);
          continue;
        }
        if (item.domTurnGroup >= 0 && mainByDomGroup.has(item.domTurnGroup)) {
          const existing = mainByDomGroup.get(item.domTurnGroup);
          existing.host = host;
          existing.resp = resp;
          existing.fiberInfo = mergeFiberInfo(existing.fiberInfo, fiberInfo);
          if (containerRef) mainByContainer.set(containerRef, existing);
          continue;
        }
        rawMainTargets.push(item);
        if (containerRef) mainByContainer.set(containerRef, item);
        if (item.domTurnGroup >= 0) mainByDomGroup.set(item.domTurnGroup, item);
      } else {
        const containerRef = fiberInfo && fiberInfo.container ? fiberInfo.container : null;
        if (containerRef && otherByContainer.has(containerRef)) {
          const existing = otherByContainer.get(containerRef);
          existing.host = host;
          existing.resp = resp;
          existing.fiberInfo = mergeFiberInfo(existing.fiberInfo, fiberInfo);
          continue;
        }
        otherTargets.push(item);
        if (containerRef) otherByContainer.set(containerRef, item);
      }
    }

    // Deduplicate any adjacent targets that share the exact same host element
    const mainTargets = [];
    const seenMainHosts = new Set();
    for (let i = rawMainTargets.length - 1; i >= 0; i--) {
      const item = rawMainTargets[i];
      if (seenMainHosts.has(item.host)) continue;
      seenMainHosts.add(item.host);
      mainTargets.push(item);
    }
    mainTargets.reverse();

    const turns = data.turnDetails;
    const activeSet = new Set();

    const renderBadgeOnHost = (host, t) => {
      if (!host || !t || t.inProgress) return;
      let bar = host.querySelector(':scope > .ag-cs-turn-bar') || host.querySelector('.ag-cs-turn-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'ag-cs-turn-bar';
        bar.setAttribute('data-ag-no-i18n', '');
        bar.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const latest = activeTrajCache.get(data.cascadeId)?.data || data;
          openContextPopover(bar, latest, 'turns');
        });
        host.appendChild(bar);
      }
      activeSet.add(bar);

      const dSign = t.ctxDelta >= 0 ? '+' : '';
      const dCls = t.ctxDelta >= 15000 ? 'is-high' : t.ctxDelta >= 5000 ? 'is-mid' : 'is-low';
      const shortModel = String(t.model || data.lastModel || '').replace(/\s*\([^)]*\)\s*/g, '').trim() || 'Model';
      const barKey = `${t.turn}|${t.ctxUsed}|${t.ctxDelta}|${t.output}|${t.thinking}|${t.toolCalls || 0}|${t.speed}|${t.cacheHitPct}|${t.subagentCalls}|${lang}`;
      if (bar.getAttribute('data-ag-cs-turn-key') !== barKey) {
        bar.setAttribute('data-ag-cs-turn-key', barKey);
        bar.innerHTML = `
          <span class="ag-cs-tb-idx">#T${t.turn}</span>
          <span class="ag-cs-tb-model">${escapeHtml(shortModel)}</span>
          <span class="ag-cs-tb-sep">·</span>
          <span class="ag-cs-tb-item">${escapeHtml(ui.ctxShort || 'Ctx')} <strong>${formatCompactK(t.ctxUsed)}</strong></span>
          <span class="ag-cs-tb-delta ${dCls}">${dSign}${formatCompactK(t.ctxDelta)}</span>
          <span class="ag-cs-tb-sep">·</span>
          <span class="ag-cs-tb-item">${escapeHtml(ui.outShort || 'Out')} <strong>${formatCompactK(t.output)}</strong></span>
          ${t.thinking > 0 ? `<span class="ag-cs-tb-item is-think">${escapeHtml(ui.thinkShort || 'Think')} ${formatCompactK(t.thinking)}</span>` : ''}
          ${t.toolCalls > 0 ? `<span class="ag-cs-tb-item">🔧 ×${t.toolCalls}</span>` : ''}
          ${t.subagentCalls > 0 ? `<span class="ag-cs-tb-sub">🤖 ×${t.subagentCount || t.subagentCalls} (${formatCompactK(t.subagentTokens)})</span>` : ''}
          ${t.speed > 0 ? `<span class="ag-cs-tb-item">⚡ ${t.speed} tok/s</span>` : ''}
          <span class="ag-cs-tb-item">${escapeHtml(ui.cacheShort || 'Cache')} ${t.cacheHitPct}%</span>
        `;
      }
    };

    const convoRunning = Boolean(
      data.isRunning || data.isThinking || getDomConvoSignal(data.cascadeId).domRunning
    );
    const isTargetInProgress = (target) => {
      const fi = target?.fiberInfo;
      return Boolean(fi?.hasRunningStep || fi?.isEmptySteps);
    };

    const hasIndexedTurns = turns.some((td) => td.userStepIdx >= 0);
    const hasFiberLocator = (fi) =>
      Boolean(
        fi &&
          ((typeof fi.stepIndex === 'number' && fi.stepIndex >= 0 && hasIndexedTurns) ||
            (typeof fi.stepTimeSec === 'number' && fi.stepTimeSec > 0))
      );

    const matchTurnByFiber = (fiberInfo) => {
      if (!fiberInfo) return null;
      if (typeof fiberInfo.stepIndex === 'number' && fiberInfo.stepIndex >= 0 && hasIndexedTurns) {
        for (let i = 0; i < turns.length; i++) {
          const td = turns[i];
          if (td.userStepIdx >= 0 && fiberInfo.stepIndex >= td.userStepIdx && fiberInfo.stepIndex < td.nextUserStepIdx) {
            return td;
          }
        }
        return null;
      }
      if (typeof fiberInfo.stepTimeSec === 'number' && fiberInfo.stepTimeSec > 0) {
        let best = null;
        for (let i = 0; i < turns.length; i++) {
          const td = turns[i];
          if (
            td.startTimeSec > 0 &&
            fiberInfo.stepTimeSec >= td.startTimeSec - 2 &&
            (!Number.isFinite(td.nextStartTimeSec) || fiberInfo.stepTimeSec < td.nextStartTimeSec - 1)
          ) {
            best = td;
          }
        }
        if (best) return best;
      }
      return null;
    };

    // Prefer exact Fiber step/timestamp binding; keep only the final host per turn
    const turnToHost = new Map();
    const matchedTargets = [];
    const fiberClaimedTurns = new Map();
    for (let idx = 0; idx < mainTargets.length; idx++) {
      const target = mainTargets[idx];
      const inProg = isTargetInProgress(target);
      let turn = matchTurnByFiber(target.fiberInfo);
      if (turn && fiberClaimedTurns.has(turn.turn)) {
        const prev = fiberClaimedTurns.get(turn.turn).target;
        const diffDomGroup =
          prev.domTurnGroup >= 0 && target.domTurnGroup >= 0 && target.domTurnGroup > prev.domTurnGroup;
        const diffContainer = Boolean(
          prev.fiberInfo?.container &&
            target.fiberInfo?.container &&
            prev.fiberInfo.container !== target.fiberInfo.container
        );
        const beyondLastStep =
          typeof target.fiberInfo?.stepIndex === 'number' &&
          target.fiberInfo.stepIndex >= 0 &&
          typeof turn.lastStepIdx === 'number' &&
          turn.lastStepIdx >= 0 &&
          target.fiberInfo.stepIndex > turn.lastStepIdx;
        if (diffDomGroup || diffContainer || beyondLastStep || inProg) {
          turn = null;
        }
      }
      if (turn) {
        fiberClaimedTurns.set(turn.turn, { target, idx });
      }
      matchedTargets.push({
        target,
        turn,
        idx,
        inProg,
        hasLocator: hasFiberLocator(target.fiberInfo),
      });
    }

    const anyFiberMatched = matchedTargets.some((m) => m.turn !== null);

    if (anyFiberMatched) {
      const usedTurnIds = new Set();
      for (const m of matchedTargets) {
        if (m.turn) {
          usedTurnIds.add(m.turn.turn);
          if (!m.inProg && !m.turn.inProgress) {
            turnToHost.set(m.turn.turn, { host: m.target.host, turn: m.turn });
          } else {
            turnToHost.delete(m.turn.turn);
          }
        }
      }

      // Only fallback-match targets that genuinely lacked Fiber step/timestamp locators,
      // are not in-progress, and strictly satisfy DOM chronological monotonicity between matched neighbors.
      let segStart = 0;
      while (segStart < matchedTargets.length) {
        if (matchedTargets[segStart].turn !== null) {
          segStart++;
          continue;
        }
        let segEnd = segStart;
        while (segEnd < matchedTargets.length && matchedTargets[segEnd].turn === null) {
          segEnd++;
        }
        const leftTurnNum = segStart > 0 && matchedTargets[segStart - 1].turn ? matchedTargets[segStart - 1].turn.turn : 0;
        const rightTurnNum =
          segEnd < matchedTargets.length && matchedTargets[segEnd].turn ? matchedTargets[segEnd].turn.turn : Infinity;

        const gapTargets = [];
        for (let i = segStart; i < segEnd; i++) {
          const m = matchedTargets[i];
          if (m.inProg || m.hasLocator) continue;
          if (convoRunning && i === matchedTargets.length - 1) continue;
          gapTargets.push(m.target);
        }

        if (gapTargets.length > 0) {
          const candidateTurns = turns.filter(
            (t) => !usedTurnIds.has(t.turn) && !t.inProgress && t.turn > leftTurnNum && t.turn < rightTurnNum
          );
          const count = Math.min(gapTargets.length, candidateTurns.length);
          for (let i = 0; i < count; i++) {
            // If anchored on the left (e.g. after a matched turn), align forward from leftTurnNum;
            // otherwise align from the tail toward rightTurnNum.
            const target = leftTurnNum > 0 ? gapTargets[i] : gapTargets[gapTargets.length - count + i];
            const t = leftTurnNum > 0 ? candidateTurns[i] : candidateTurns[candidateTurns.length - count + i];
            if (target && t) {
              turnToHost.set(t.turn, { host: target.host, turn: t });
              usedTurnIds.add(t.turn);
            }
          }
        }
        segStart = segEnd;
      }
    } else {
      const completedTurns = turns.filter((t) => !t.inProgress);
      let eligibleTargets = mainTargets.filter((target, idx) => {
        if (isTargetInProgress(target)) return false;
        if (convoRunning && idx === mainTargets.length - 1) return false;
        return true;
      });
      if (eligibleTargets.length > completedTurns.length) {
        eligibleTargets = eligibleTargets.slice(0, completedTurns.length);
      }
      const count = Math.min(eligibleTargets.length, completedTurns.length);
      for (let i = 0; i < count; i++) {
        const target = eligibleTargets[eligibleTargets.length - count + i];
        const t = completedTurns[completedTurns.length - count + i];
        if (target && t) turnToHost.set(t.turn, { host: target.host, turn: t });
      }
    }

    for (const entry of turnToHost.values()) {
      renderBadgeOnHost(entry.host, entry.turn);
    }

    // Also render badges for any subagent conversation turns visible in DOM
    let prevSubCtx = 0;
    for (let i = 0; i < otherTargets.length; i++) {
      const target = otherTargets[i];
      if (isTargetInProgress(target)) continue;
      const steps = target.fiberInfo?.container?.steps;
      if (Array.isArray(steps) && steps.length > 0) {
        const fb = summarizeFiberSteps(steps, data.lastModel, prevSubCtx);
        if (fb.ctxUsed > 0 || fb.output > 0) {
          prevSubCtx = fb.ctxUsed;
          renderBadgeOnHost(target.host, { ...fb, turn: i + 1 });
        }
      }
    }

    document.querySelectorAll('.ag-cs-turn-bar').forEach((b) => {
      if (!activeSet.has(b)) b.remove();
    });
  }

  function hasAnySurroundHudEnabled() {
    return cfg.hudTopBar === true || cfg.hudBottomBar === true || cfg.hudRimProgress === true;
  }

  function syncSurroundHud(card, footer, data, precomputedTelemetry = null) {
    const inputBox = card?.closest?.('[data-testid="agent-input-box"]');
    const composerShell = card?.closest?.('#antigravity\\.agentSidePanelInputBox') || card?.parentElement;
    if (!inputBox || !card) return;
    if (!isUsageStatsEnabled() || !hasAnySurroundHudEnabled()) {
      card
        .querySelectorAll('.ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar, .ag-cs-hud-rim-progress, .ag-cs-hud-footer-chip')
        .forEach((n) => n.remove());
      if (footer) {
        const legacyChip = footer.querySelector('.ag-cs-hud-footer-chip');
        if (legacyChip) legacyChip.remove();
      }
      if (composerShell && composerShell.hasAttribute('data-ag-cs-rim')) {
        composerShell.removeAttribute('data-ag-cs-rim');
        composerShell.style.removeProperty('--ag-cs-rim-color');
      }
      return;
    }
    const d = data || createEmptyConvoData('', getKnownMaxContextForCard(card, data));
    const lang = getLang();
    const ui = uiText(lang);
    const { ring, draftEst, activeQuota } = precomputedTelemetry || getRingTelemetryForCard(card, d);
    const totalW = ring.maxTokens || 256000;
    const pctOf = (v) => Math.max(0, Math.min(100, ((Number(v) || 0) / totalW) * 100)).toFixed(2);
    const chatMsgs =
      d.chatMsgTokens != null ? d.chatMsgTokens : Math.max(0, Number(d.msgTokens || 0) - Number(d.toolResultsTokens || 0));
    const topSpeed = Number(d.displaySpeed || d.lastSpeed || 0);

    // 1. Top HUD Bar (.ag-cs-hud-top-bar)
    let topBar = card.querySelector('.ag-cs-hud-top-bar');
    if (cfg.hudTopBar === true) {
      if (!topBar) {
        topBar = document.createElement('div');
        topBar.className = 'ag-cs-hud-top-bar';
        topBar.setAttribute('data-ag-no-i18n', '');
        topBar.addEventListener('click', (ev) => {
          if (ev.target && ev.target.closest && ev.target.closest('[data-hud-compact-btn]')) return;
          ev.stopPropagation();
          openContextPopover(topBar, resolveCardConvoData(card, d), 'breakdown');
        });
        if (typeof card.insertBefore === 'function') card.insertBefore(topBar, card.firstChild);
        else card.appendChild(topBar);
      }
      const ctxRemPctRound = Math.round(ring.contextRemainingPct);
      const isLowCtx = Boolean((d.calls > 0 || ring.usedTokens > 0) && ring.contextRemainingPct <= 20);
      const lowCtxAttr = isLowCtx ? (ring.contextRemainingPct <= 10 ? 'danger' : 'warn') : '';
      if (lowCtxAttr) topBar.setAttribute('data-ctx-low', lowCtxAttr);
      else topBar.removeAttribute('data-ctx-low');
      const ctxColor = ctxRemPctRound <= 10 ? '#dc3c3d' : ctxRemPctRound <= 30 ? 'var(--ag-cs-warn-fg, #9a5b13)' : '#257de0';
      const topKey = `${ctxRemPctRound}|${lowCtxAttr}|${ring.remainingTokens}|${totalW}|${ring.usedTokens}|${d.sysTokens || 0}|${d.toolsTokens || 0}|${chatMsgs}|${d.toolResultsTokens || 0}|${d.overheadTokens || 0}|${draftEst.tokens}|${Math.round(d.cacheHitPct || 0)}|${topSpeed}|${lang}`;
      if (topBar.getAttribute('data-ag-cs-top-key') !== topKey) {
        topBar.setAttribute('data-ag-cs-top-key', topKey);
        topBar.innerHTML = `
          <div class="ag-cs-hud-top-track">
            <span style="width:${pctOf(d.sysTokens)}%;background:#3b82f6"></span>
            <span style="width:${pctOf(d.toolsTokens)}%;background:#a855f7"></span>
            <span style="width:${pctOf(chatMsgs)}%;background:#10b981"></span>
            <span style="width:${pctOf(d.toolResultsTokens)}%;background:#f59e0b"></span>
            ${Number(d.overheadTokens || 0) > 0 ? `<span style="width:${pctOf(d.overheadTokens)}%;background:#64748b"></span>` : ''}
            <span style="width:${pctOf(draftEst.tokens)}%;background:#ec4899"></span>
          </div>
          <div class="ag-cs-hud-top-row">
            <span class="ag-cs-hud-rem" style="color:${ctxColor}">${escapeHtml(ui.remShort || 'Rem')} ${ctxRemPctRound}% (${formatCompactK(ring.remainingTokens)} / ${formatCompactK(totalW)})</span>
            <span>${escapeHtml(ui.usedWord || 'Used')} ${formatCompactK(ring.usedTokens)}${draftEst.tokens > 0 ? ` +${formatCompactK(draftEst.tokens)}` : ''}</span>
            <span>${escapeHtml(ui.cacheShort || 'Cache')} ${Math.round(d.cacheHitPct || 0)}%</span>
            ${topSpeed > 0 ? `<span>⚡ ${topSpeed} tok/s</span>` : ''}
            <button type="button" class="ag-cs-hud-compact-btn"${lowCtxAttr ? ` data-ctx-low="${lowCtxAttr}"` : ''} data-hud-compact-btn="1">/compact</button>
          </div>
        `;
        const cBtn = topBar.querySelector('[data-hud-compact-btn]');
        if (cBtn) {
          cBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            fillCompactCommand(card);
          });
        }
      }
    } else if (topBar) {
      topBar.remove();
    }

    // 2. Bottom HUD Bar (.ag-cs-hud-bottom-bar)
    let botBar = card.querySelector('.ag-cs-hud-bottom-bar');
    if (cfg.hudBottomBar === true) {
      if (!botBar) {
        botBar = document.createElement('div');
        botBar.className = 'ag-cs-hud-bottom-bar';
        botBar.setAttribute('data-ag-no-i18n', '');
        botBar.addEventListener('click', (ev) => {
          ev.stopPropagation();
          openContextPopover(botBar, resolveCardConvoData(card, d), 'turns');
        });
        card.appendChild(botBar);
      }
      const qPct = activeQuota && typeof activeQuota.effectiveRemainingPct === 'number' ? `${Math.round(activeQuota.effectiveRemainingPct)}%` : '';
      const botKey = `${d.totalTokens}|${d.turns}|${d.calls}|${d.totalOutput}|${d.subagentTokens}|${qPct}|${lang}`;
      if (botBar.getAttribute('data-ag-cs-bot-key') !== botKey) {
        botBar.setAttribute('data-ag-cs-bot-key', botKey);
        botBar.innerHTML = `
          <span>${escapeHtml(ui.sessionThroughput || 'Session')} <strong>${formatCompactK(d.totalTokens)}</strong></span>
          <span>${d.turns || d.calls} ${escapeHtml(ui.turnsUnit || 'turns')} / ${d.calls} ${escapeHtml(ui.callsUnit || 'calls')}</span>
          <span>${escapeHtml(ui.outShort || 'Out')} ${formatCompactK(d.totalOutput || 0)}</span>
          ${d.subagentCount > 0 ? `<span>🤖 ×${d.subagentCount} (${formatCompactK(d.subagentTokens)})</span>` : ''}
          ${qPct ? `<span>${escapeHtml(ui.modelQuotaRem || 'Quota Rem')} <strong>${qPct}</strong></span>` : ''}
        `;
      }
    } else if (botBar) {
      botBar.remove();
    }

    // 3. Rim Progress Border (data-ag-cs-rim on composerShell + proportional .ag-cs-hud-rim-progress)
    let rimBar = card.querySelector('.ag-cs-hud-rim-progress');
    if (cfg.hudRimProgress === true) {
      if (composerShell) {
        composerShell.setAttribute('data-ag-cs-rim', '1');
        composerShell.style.setProperty('--ag-cs-rim-color', ring.color);
      }
      const rimHost = card.querySelector(':scope > div.relative.w-full') || card;
      if (rimHost) {
        if (!rimBar || rimBar.parentElement !== rimHost) {
          rimBar?.remove();
          rimBar = document.createElement('div');
          rimBar.className = 'ag-cs-hud-rim-progress';
          rimBar.setAttribute('aria-hidden', 'true');
          rimBar.setAttribute('data-ag-no-i18n', '');
          const fill = document.createElement('span');
          fill.className = 'ag-cs-hud-rim-fill';
          rimBar.appendChild(fill);
          rimHost.appendChild(rimBar);
        }
        const fill = rimBar.firstElementChild;
        if (fill) {
          const usedPct = Math.max(2, Math.min(100, 100 - ring.pct));
          fill.style.width = `${usedPct.toFixed(1)}%`;
          fill.style.background = ring.color;
        }
      }
    } else {
      if (composerShell && composerShell.hasAttribute('data-ag-cs-rim')) {
        composerShell.removeAttribute('data-ag-cs-rim');
        composerShell.style.removeProperty('--ag-cs-rim-color');
      }
      if (rimBar) rimBar.remove();
    }

    // Clean up any legacy Footer Chip (.ag-cs-hud-footer-chip) left from older versions
    if (footer) {
      const legacyChip = footer.querySelector('.ag-cs-hud-footer-chip');
      if (legacyChip) legacyChip.remove();
    }
  }

  // ── Interactive Thinking Effort Slider Popover (Claude Code & ChatGPT Codex) ──
  let openEffortPop = null;
  let openEffortAnchor = null;
  let openEffortModelBtn = null;
  let openEffortBadgeEl = null;
  let effortMatrixRaf = 0;
  let codexMotionRaf = 0;

  function cancelCodexMotionRaf() {
    if (codexMotionRaf) {
      cancelAnimationFrame(codexMotionRaf);
      codexMotionRaf = 0;
    }
  }

  function closeEffortPopover() {
    if (effortMatrixRaf) {
      cancelAnimationFrame(effortMatrixRaf);
      effortMatrixRaf = 0;
    }
    cancelCodexMotionRaf();
    if (openEffortPop && openEffortPop.parentElement) {
      openEffortPop.parentElement.removeChild(openEffortPop);
    }
    openEffortPop = null;
    openEffortAnchor = null;
    openEffortModelBtn = null;
    openEffortBadgeEl = null;
  }

  function refreshOpenEffortPopover() {
    if (!openEffortPop || !openEffortPop.isConnected) return;
    if (!isEffortSliderEnabled()) {
      closeEffortPopover();
      return;
    }
    renderEffortPopoverContent(openEffortPop, openEffortModelBtn, openEffortBadgeEl);
    positionEffortPopover(openEffortPop, openEffortAnchor || openEffortModelBtn);
    if (typeof openEffortPop._syncEffortKnob === 'function') {
      openEffortPop._syncEffortKnob(true);
    }
  }

  function getModelFiberProps(modelBtn) {
    if (!modelBtn) return null;
    const fk = Object.keys(modelBtn).find((k) => k.startsWith('__reactFiber$'));
    for (let cur = fk && modelBtn[fk], d = 0; cur && d < 35; cur = cur.return, d++) {
      const mp = cur.memoizedProps;
      if (mp && Array.isArray(mp.modelOptions) && typeof mp.setSelectedModel === 'function') {
        return mp;
      }
      if (mp && mp.value && Array.isArray(mp.value.modelOptions) && typeof mp.value.setSelectedModel === 'function') {
        return mp.value;
      }
    }
    return null;
  }

  function stripEffortBadgeSuffix(text) {
    return String(text || '')
      .replace(/\s*[·•]\s*(?:\d+(?:\.\d+)?\s*[kKmM](?:\s*(?:ctx|context|tokens?))?|standard|extended)\s*$/i, '')
      .trim();
  }

  function findModelEffortBadgeSpan(modelBtn, { preferTagged = true } = {}) {
    if (!modelBtn) return null;
    if (preferTagged) {
      const tagged = modelBtn.querySelector('.ag-cs-effort-badge, [data-ag-cs-effort]');
      if (tagged && tagged.childElementCount === 0) return tagged;
    }
    const spans = Array.from(modelBtn.querySelectorAll('span')).filter((s) => s.childElementCount === 0);
    for (let i = spans.length - 1; i >= 0; i--) {
      const txt = stripEffortBadgeSuffix(spans[i].textContent).toLowerCase();
      if (/\b(max|xhigh|extra|high|med(?:ium)?|low|minimal|light|none|off)\b/.test(txt)) {
        return spans[i];
      }
    }
    return spans.length >= 2 ? spans[spans.length - 1] : null;
  }

  function resolveModelEffortContext(modelBtn, badgeEl) {
    const readLiveBadgeEffort = (el) => {
      if (!el) return '';
      const rawTxt = stripEffortBadgeSuffix(el.textContent).toLowerCase().replace(/\s+/g, ' ');
      const m = rawTxt.match(/\b(extra high|extra|xhigh|high|med(?:ium)?|low|max)\b/);
      if (m) return m[1].startsWith('med') ? 'medium' : m[1];
      return (el.getAttribute('data-ag-cs-effort') || rawTxt).trim().toLowerCase();
    };
    let badgeEffort = readLiveBadgeEffort(badgeEl);
    if (!badgeEffort && modelBtn) {
      const foundBadge = findModelEffortBadgeSpan(modelBtn, { preferTagged: true });
      if (foundBadge) {
        badgeEffort = readLiveBadgeEffort(foundBadge);
      }
    }
    const fiberProps = getModelFiberProps(modelBtn);

    const isOrchSelected = Boolean(
      periodicCore &&
        typeof periodicCore.parseOrchestratorOption === 'function' &&
        fiberProps?.selectedModel &&
        periodicCore.parseOrchestratorOption(fiberProps.selectedModel)
    );
    const canSelectOrchPlanner = Boolean(
      isOrchSelected &&
        Array.isArray(fiberProps?.orchestratorPlanners) &&
        fiberProps.orchestratorPlanners.length > 0 &&
        typeof fiberProps?.orchestratorPick?.select === 'function'
    );
    const activePlanner =
      canSelectOrchPlanner && typeof periodicCore.resolveOrchestratorPlanner === 'function'
        ? periodicCore.resolveOrchestratorPlanner(
            fiberProps.orchestratorPlanners,
            fiberProps.orchestratorPick,
            fiberProps.orchestratorDefaultPlanner
          )
        : null;

    const effectiveOptions = canSelectOrchPlanner ? fiberProps.orchestratorPlanners : fiberProps?.modelOptions;
    const selectedLabel =
      (canSelectOrchPlanner && activePlanner?.label) ||
      fiberProps?.selectedModel?.label ||
      getCurrentModelLabel(modelBtn?.closest?.('.surface-composer-card')) ||
      '';
    const resolved = effortCore.resolveClaudeEffortSteps(effectiveOptions, selectedLabel, badgeEffort);
    const interactive = !isOrchSelected || (canSelectOrchPlanner && resolved.hasRealVariants);

    const commitSelection = (opt, effortId, effortDisplay, fullLabel, onHostResolved) => {
      if (isModelButtonLocked(modelBtn)) return;
      const hasOrchPlannerSetter = Boolean(canSelectOrchPlanner && opt && opt.value !== undefined);
      const hasRealModelSetter = Boolean(
        hasOrchPlannerSetter || (!isOrchSelected && opt && fiberProps && typeof fiberProps.setSelectedModel === 'function')
      );
      if (hasOrchPlannerSetter) {
        try {
          rememberOrchestratorPlanner(opt);
          fiberProps.orchestratorPick.select(opt.value);
        } catch {}
      } else if (hasRealModelSetter) {
        try {
          fiberProps.setSelectedModel(opt);
        } catch {}
      }
      const commitGen = effortConfigGeneration;
      const syncBadgeDom = () => {
        if (destroyed || !isEffortSliderEnabled() || commitGen !== effortConfigGeneration) return;
        let targetBadge = badgeEl && badgeEl.isConnected ? badgeEl : null;
        if (!targetBadge && modelBtn) {
          targetBadge = findModelEffortBadgeSpan(modelBtn, { preferTagged: true });
        }
        let resolvedDisplay = effortDisplay;
        if (targetBadge && hasRealModelSetter) {
          if (effortId === 'xhigh') {
            const hostTxt = stripEffortBadgeSuffix(targetBadge.textContent);
            if (/\bextra\s+high\b/i.test(hostTxt)) {
              resolvedDisplay = 'Extra High';
            } else if (/\bextra\b/i.test(hostTxt)) {
              resolvedDisplay = 'Extra';
            }
          }
          const badgeLevel = String(resolvedDisplay || '').trim().toLowerCase() === 'extra' ? 'extra' : effortId;
          if (targetBadge.getAttribute('data-ag-cs-effort') !== badgeLevel) {
            targetBadge.setAttribute('data-ag-cs-effort', badgeLevel);
          }
          if (!targetBadge.classList.contains('ag-cs-effort-badge')) {
            targetBadge.classList.add('ag-cs-effort-badge');
          }
          if (modelBtn) modelBtn._agCsHasEffortTagged = true;
          openEffortAnchor = targetBadge;
          openEffortBadgeEl = targetBadge;
        }
        if (resolvedDisplay !== effortDisplay && typeof onHostResolved === 'function') {
          onHostResolved(resolvedDisplay);
        }
      };
      syncBadgeDom();
      cancelPendingEffortBadgeRaf();
      if (typeof requestAnimationFrame === 'function') {
        pendingEffortBadgeRaf = requestAnimationFrame(() => {
          pendingEffortBadgeRaf = 0;
          if (destroyed || !isEffortSliderEnabled() || commitGen !== effortConfigGeneration) return;
          syncBadgeDom();
          scheduleSync();
        });
      }
    };

    return {
      fiberProps,
      selectedLabel,
      badgeEffort,
      isOrchSelected,
      interactive,
      baseName: resolved.baseName,
      steps: resolved.steps,
      selectedIdx: resolved.selectedIdx,
      selectStep(step, onHostResolved) {
        if (!step || !interactive) return;
        commitSelection(step.option, step.id, step.display, step.option?.label, onHostResolved);
      },
    };
  }

  function paintEffortMatrixCanvas(canvas, activeStep, isApex, startTime, matrixState) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cssW = Math.max(180, Math.round(canvas.clientWidth || canvas.getBoundingClientRect().width || 232));
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const wDev = Math.round(cssW * dpr);
    const hDev = Math.round(effortCore.BAND_H * dpr);

    if (canvas.width !== wDev || canvas.height !== hDev) {
      canvas.width = wDev;
      canvas.height = hDev;
    }

    ctx.clearRect(0, 0, wDev, hDev);
    if (!isApex) return;

    if (!matrixState.field || matrixState.field.widthDev !== wDev || matrixState.field.dpr !== dpr) {
      matrixState.field = effortCore.solveField(wDev, dpr);
    }

    const blocks = matrixState.field.blocks;
    const dark = isDarkTheme();
    const accent =
      cfg.effortAccent === false
        ? dark
          ? [200, 200, 208]
          : [71, 85, 105]
        : dark
          ? activeStep?.rgb || [163, 89, 255]
          : [124, 58, 237];
    const flash =
      cfg.effortAccent === false
        ? dark
          ? [255, 255, 255]
          : [15, 23, 42]
        : dark
          ? [242, 232, 255]
          : [196, 181, 253];
    const reduced = motionReduced();
    const t = reduced ? 10 : Math.max(0, (performance.now() - startTime) / 1000);
    const rgb = [0, 0, 0];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.fade <= 0.004) continue;
      const phase = reduced ? 1 : effortCore.arrivalPhase(t, block.entrance);
      const rise = reduced ? 1 : effortCore.arrivalRise(phase);
      if (rise <= 0.004) continue;
      const glow = reduced ? 0 : effortCore.arrivalGlow(phase);
      const flashShare = effortCore.flashAt(block, t);
      const flow = effortCore.flowAt(block, t);
      effortCore.composeBlockColour(accent, flash, flashShare, glow, flow, rgb);
      const boost = Math.max(flashShare, flow, glow);
      const alpha = Math.max(0, Math.min(0.96, block.fade * rise * (0.3 + 0.64 * boost)));
      if (alpha <= 0.01) continue;
      ctx.fillStyle = `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha.toFixed(3)})`;
      ctx.fillRect(block.x, block.y, block.size, block.size);
    }
  }

  /**
   * Render the ChatGPT Codex effort slider popover (Microqian2th/dsh-codex-effort-slider style).
   */
  function renderCodexEffortPopover(pop, ctx, lang) {
    const ui = uiText(lang);
    const steps = ctx.steps || [];
    const count = steps.length;
    if (count <= 0) return;

    let currentIdx = Math.max(0, Math.min(count - 1, ctx.selectedIdx || 0));
    const initPct = effortCore.codexPctFromIndex(currentIdx, count);
    const motion = { x: initPct, v: 0, a: 0, target: initPct };
    let dragging = false;
    let pointerActive = false;
    let downClientX = 0;
    let snapTargetIdx = currentIdx;
    let shownIdx = currentIdx;
    let lastAt = performance.now();
    let starAnimCache = null;
    let lastStarRate = -1;
    let lastEnergy = -1;
    let lastRenderedIdx = -1;
    let lastFillBg = '';
    let lastValColor = '';
    let dragMetrics = null;

    const particles = effortCore.CODEX_PARTICLES;
    const ticksHtml = steps
      .map(
        (s, idx) =>
          `<span class="ag-cs-codex-tick" data-tick-idx="${idx}" data-on="${idx <= currentIdx ? '1' : '0'}" style="left:${effortCore.codexKnobOffsetOf(effortCore.codexPctFromIndex(idx, count))}" title="${escapeHtml(s.display)}"></span>`
      )
      .join('');

    const starsHtml = particles
      .map((p, idx) => {
        const dur = effortCore.codexStarDurationFor(idx);
        const delay = effortCore.codexStarDelayFor(idx, dur, particles);
        const bright = effortCore.codexStarBrightnessFor(idx);
        return `<span class="ag-cs-codex-star" style="top:${p.y.toFixed(3)}%;animation-duration:${dur.toFixed(3)}s;animation-delay:${delay.toFixed(3)}s"><span class="ag-cs-codex-star-dot" style="--ag-cs-codex-b:${bright.toFixed(3)};opacity:0"></span></span>`;
      })
      .join('');

    const initStep = steps[currentIdx] || steps[0];
    const effortTitle = escapeHtml(ui.effortTitle || 'Reasoning effort');
    pop.innerHTML = `
      <div class="ag-cs-codex-head">
        <span class="ag-cs-codex-title">${effortTitle}</span>
        <span class="ag-cs-codex-value">${escapeHtml(initStep.display)}</span>
      </div>
      <div class="ag-cs-codex-track" role="slider" tabindex="0" aria-label="${effortTitle}" aria-valuemin="0" aria-valuemax="${Math.max(0, count - 1)}" aria-valuenow="${currentIdx}" aria-valuetext="${escapeHtml(initStep.display)}">
        <div class="ag-cs-codex-fill"></div>
        <div class="ag-cs-codex-energy"><div class="ag-cs-codex-sweep"></div></div>
        <div class="ag-cs-codex-stars">${starsHtml}</div>
        ${ticksHtml}
        <div class="ag-cs-codex-knob"></div>
      </div>
    `;

    const valEl = pop.querySelector('.ag-cs-codex-value');
    const track = pop.querySelector('.ag-cs-codex-track');
    const fillEl = pop.querySelector('.ag-cs-codex-fill');
    const energyEl = pop.querySelector('.ag-cs-codex-energy');
    const starsEl = pop.querySelector('.ag-cs-codex-stars');
    const knobEl = pop.querySelector('.ag-cs-codex-knob');
    const tickEls = Array.from(pop.querySelectorAll('.ag-cs-codex-tick'));
    const starTrackEls = Array.from(pop.querySelectorAll('.ag-cs-codex-star'));
    const starDotEls = Array.from(pop.querySelectorAll('.ag-cs-codex-star-dot'));

    const updateStarRates = (pct) => {
      const rate = motionReduced()
        ? Math.max(0.25, effortCore.codexSpeedFor(pct) / 2.6)
        : effortCore.codexSpeedFor(pct);
      if (lastStarRate >= 0 && Math.abs(rate - lastStarRate) < 0.06) return;
      lastStarRate = rate;
      if (!starAnimCache) {
        starAnimCache = starTrackEls.map((el) => {
          try {
            const list = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
            return list && list.length > 0 ? list : null;
          } catch {
            return null;
          }
        });
      }
      for (let i = 0; i < starAnimCache.length; i += 1) {
        const anims = starAnimCache[i];
        if (!anims) continue;
        for (let a = 0; a < anims.length; a += 1) {
          try {
            anims[a].playbackRate = rate;
          } catch {}
        }
      }
    };

    const resolveKnobPx = (pct) => {
      const trackW = dragMetrics ? dragMetrics.trackW : track ? track.clientWidth || 0 : 0;
      if (trackW > effortCore.CODEX_KNOB_SIZE) {
        return effortCore.CODEX_KNOB_RADIUS + effortCore.codexClamp01(pct) * (trackW - effortCore.CODEX_KNOB_SIZE);
      }
      return -1;
    };

    const applyShown = (shownPct, displayIdx) => {
      const clampedPct = effortCore.codexClamp01(shownPct);
      const safeIdx = Math.max(0, Math.min(count - 1, displayIdx));
      const st = steps[safeIdx] || steps[0];
      const energy = effortCore.codexEnergyFor(clampedPct);
      const knobPx = resolveKnobPx(clampedPct);
      const knobOffset = knobPx >= 0 ? `${knobPx.toFixed(2)}px` : effortCore.codexKnobOffsetOf(clampedPct);

      const energyFlag = energy > 0 ? '1' : '0';
      if (pop.getAttribute('data-energy') !== energyFlag) {
        pop.setAttribute('data-energy', energyFlag);
      }
      if (energy !== lastEnergy) {
        pop.style.setProperty('--ag-cs-codex-energy', energy.toFixed(3));
      }

      if (fillEl) {
        fillEl.style.width = knobOffset;
        const nextFillBg = effortCore.codexFillBackgroundFor(clampedPct);
        if (nextFillBg !== lastFillBg) {
          fillEl.style.background = nextFillBg;
          lastFillBg = nextFillBg;
        }
      }
      if (energyEl) {
        energyEl.style.width = knobOffset;
      }
      if (starsEl) {
        starsEl.style.width = knobOffset;
        if (energy > 0 || lastEnergy > 0) {
          starsEl.style.opacity = effortCore.codexStarLayerOpacityFor(clampedPct).toFixed(3);
        }
      }
      if (knobEl) {
        if (knobPx >= 0) {
          knobEl.style.left = '0px';
          knobEl.style.transform = `translate3d(${knobPx.toFixed(2)}px, 0, 0)`;
        } else {
          knobEl.style.transform = '';
          knobEl.style.left = knobOffset;
        }
      }

      if (energy > 0 || lastEnergy > 0) {
        const progress = effortCore.codexStarProgressFor(clampedPct, count);
        const glow = 0.45 + 0.55 * progress;
        for (let s = 0; s < starDotEls.length; s += 1) {
          const dot = starDotEls[s];
          const reveal = effortCore.codexParticleReveal(s, progress, starDotEls.length);
          const bright = effortCore.codexStarBrightnessFor(s) * glow;
          dot.style.setProperty('--ag-cs-codex-b', bright.toFixed(3));
          dot.style.opacity = reveal.toFixed(3);
        }
        if (energy > 0) updateStarRates(clampedPct);
      }
      lastEnergy = energy;

      if (safeIdx !== lastRenderedIdx) {
        lastRenderedIdx = safeIdx;
        for (let t = 0; t < tickEls.length; t += 1) {
          tickEls[t].setAttribute('data-on', t <= safeIdx ? '1' : '0');
        }
        if (valEl && st && valEl.textContent !== st.display) {
          valEl.textContent = st.display;
        }
        if (track && st) {
          track.setAttribute('aria-valuenow', String(safeIdx));
          track.setAttribute('aria-valuetext', st.display);
        }
      }
      if (valEl && st) {
        const nextColor = effortCore.codexValueColorFor(clampedPct, st);
        if (nextColor !== lastValColor) {
          valEl.style.color = nextColor;
          lastValColor = nextColor;
        }
      }
    };

    const tickMotion = (now) => {
      if (!pop.isConnected || openEffortPop !== pop) {
        codexMotionRaf = 0;
        return;
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - lastAt) / 1000));
      lastAt = now;
      effortCore.codexMotionStep(motion, dt);
      shownIdx = dragging ? effortCore.codexIndexFromPct(motion.x, count) : snapTargetIdx;
      applyShown(motion.x, shownIdx);
      if (dragging || (!effortCore.codexMotionSettled(motion) && !motionReduced())) {
        codexMotionRaf = requestAnimationFrame(tickMotion);
      } else {
        motion.x = motion.target;
        motion.v = 0;
        motion.a = 0;
        shownIdx = snapTargetIdx;
        applyShown(motion.target, snapTargetIdx);
        codexMotionRaf = 0;
      }
    };

    const ensureMotionLoop = () => {
      // Never cancel an already-scheduled rAF frame during drag: doing so starves the spring
      // integrator on high-polling-rate mice (125-1000Hz).
      if (codexMotionRaf) return;
      lastAt = performance.now();
      codexMotionRaf = requestAnimationFrame(tickMotion);
    };

    const setTarget = (targetPct, nextIdx, commit) => {
      const clampedTarget = effortCore.codexClamp01(targetPct);
      const boundedIdx = Math.max(0, Math.min(count - 1, nextIdx));
      snapTargetIdx = boundedIdx;
      motion.target = clampedTarget;

      if (commit) {
        currentIdx = boundedIdx;
        const st = steps[boundedIdx];
        if (st) {
          ctx.selectStep(st, (resolvedDisplay) => {
            if (!pop.isConnected || openEffortPop !== pop) return;
            if (resolvedDisplay && valEl && resolvedDisplay !== valEl.textContent) {
              valEl.textContent = resolvedDisplay;
            }
          });
        }
      }

      const trackW = dragMetrics ? dragMetrics.trackW : track ? track.clientWidth || 0 : 0;
      if (motionReduced() || trackW <= 0 || typeof requestAnimationFrame !== 'function') {
        cancelCodexMotionRaf();
        motion.x = clampedTarget;
        motion.v = 0;
        motion.a = 0;
        shownIdx = boundedIdx;
        applyShown(clampedTarget, boundedIdx);
      } else {
        if (!dragging) {
          shownIdx = boundedIdx;
          applyShown(motion.x, boundedIdx);
        }
        ensureMotionLoop();
      }
    };

    pop._syncEffortKnob = () => applyShown(motion.x, shownIdx);
    applyShown(initPct, currentIdx);

    if (track) {
      const captureTrackMetrics = () => {
        const r = track.getBoundingClientRect();
        const trackW = track.clientWidth || r.width || 1;
        const zoomScale = trackW > 0 && r.width > 0 ? r.width / trackW : 1;
        dragMetrics = { left: r.left, trackW, zoomScale: zoomScale || 1 };
      };
      const pctFromClientX = (clientX) => {
        const m = dragMetrics;
        const left = m ? m.left : track.getBoundingClientRect().left;
        const trackW = m ? m.trackW : track.clientWidth || track.getBoundingClientRect().width || 1;
        const zoomScale = m ? m.zoomScale : (trackW > 0 && track.getBoundingClientRect().width > 0 ? track.getBoundingClientRect().width / trackW : 1);
        const localX = (clientX - left) / (zoomScale || 1);
        const usable = Math.max(1, trackW - effortCore.CODEX_KNOB_SIZE);
        return effortCore.codexClamp01((localX - effortCore.CODEX_KNOB_RADIUS) / usable);
      };

      track.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        pointerActive = true;
        dragging = false;
        downClientX = ev.clientX;
        captureTrackMetrics();
        try {
          track.setPointerCapture(ev.pointerId);
        } catch {}
        const pct = pctFromClientX(ev.clientX);
        const idx = effortCore.codexIndexFromPct(pct, count);
        setTarget(pct, idx, false);
      });

      track.addEventListener('pointermove', (ev) => {
        if (!pointerActive) return;
        if (!dragging && Math.abs(ev.clientX - downClientX) >= effortCore.DRAG_THRESHOLD_PX) {
          dragging = true;
          track.classList.add('is-dragging');
        }
        if (!dragging) return;
        const pct = pctFromClientX(ev.clientX);
        const idx = effortCore.codexIndexFromPct(pct, count);
        snapTargetIdx = idx;
        motion.target = pct;
        if (motionReduced() || typeof requestAnimationFrame !== 'function') {
          motion.x = pct;
          shownIdx = idx;
          applyShown(pct, idx);
        } else {
          ensureMotionLoop();
        }
      });

      const finishPointer = (ev) => {
        if (!pointerActive) return;
        pointerActive = false;
        dragging = false;
        track.classList.remove('is-dragging');
        const pct = pctFromClientX(ev.clientX);
        const idx = effortCore.codexIndexFromPct(pct, count);
        dragMetrics = null;
        setTarget(effortCore.codexPctFromIndex(idx, count), idx, true);
      };

      track.addEventListener('pointerup', finishPointer);
      track.addEventListener('pointercancel', finishPointer);
      track.addEventListener('keydown', (ev) => {
        let next = -1;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') next = Math.min(count - 1, currentIdx + 1);
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') next = Math.max(0, currentIdx - 1);
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = count - 1;
        if (next >= 0) {
          ev.preventDefault();
          setTarget(effortCore.codexPctFromIndex(next, count), next, true);
        }
      });
    }
  }

  function renderEffortPopoverContent(pop, modelBtn, badgeEl) {
    if (effortMatrixRaf) {
      cancelAnimationFrame(effortMatrixRaf);
      effortMatrixRaf = 0;
    }
    cancelCodexMotionRaf();
    const lang = getLang();
    const ui = uiText(lang);
    const dark = isDarkTheme();
    const styleMode = effortCore.normalizeEffortStyle(cfg.effortSliderStyle);
    const ctx = resolveModelEffortContext(modelBtn, badgeEl);
    pop.setAttribute('data-effort-style', styleMode);
    pop.setAttribute('data-effort-theme', dark ? 'dark' : 'light');
    pop._syncEffortKnob = null;

    if (styleMode === 'claude') {
      let currentIdx = ctx.selectedIdx;
      const count = ctx.steps.length;
      const maxIdx = Math.max(1, count - 1);
      let currentProgress = currentIdx / maxIdx;
      let matrixStartTime = performance.now();
      const matrixState = { field: null };
      let swapClearTimer = null;

      const step = ctx.steps[currentIdx] || ctx.steps[0];
      const isApex = currentIdx === count - 1;
      const pct = effortCore.computeEffortTintPercent(count, currentIdx);
      pop.style.setProperty('--ag-cs-effort-pct', (pct ?? 67) + '%');
      pop.style.setProperty('--ag-cs-effort-step-tint', step.tint);
      pop.style.setProperty('--ag-cs-effort-progress', currentProgress.toFixed(4));
      if (isApex) pop.setAttribute('data-effort-apex', '1');
      else pop.removeAttribute('data-effort-apex');

      const effortTitle = escapeHtml(ui.effortTitle || 'Reasoning effort');
      pop.innerHTML = `
        <div class="ag-cs-effort-head">
          <span class="ag-cs-effort-title">${effortTitle}</span>
          <span class="ag-cs-effort-value-slot">
            <span class="ag-cs-effort-value">${escapeHtml(step.display)}</span>
            <span class="ag-cs-effort-value-preview" aria-hidden="true"></span>
          </span>
        </div>
        <div class="ag-cs-effort-ends">
          <span>${escapeHtml(ui.effortFaster || 'Faster')}</span>
          <span>${escapeHtml(ui.effortSmarter || 'Smarter')}</span>
        </div>
        <div class="ag-cs-effort-track" role="slider" tabindex="0" aria-label="${effortTitle}" aria-valuemin="0" aria-valuemax="${maxIdx}" aria-valuenow="${currentIdx}" aria-valuetext="${escapeHtml(step.display)}">
          <div class="ag-cs-effort-groove">
            <div class="ag-cs-effort-fill"></div>
            <canvas class="ag-cs-effort-matrix"></canvas>
            <div class="ag-cs-effort-ticks">
              ${ctx.steps
                .map(
                  (s, idx) =>
                    `<span class="ag-cs-effort-tick${idx <= currentIdx ? ' is-reached' : ''}" style="left:calc(8px + ${(idx / maxIdx).toFixed(4)} * (100% - 16px))" data-tick-idx="${idx}" data-effort-id="${escapeHtml(s.id)}" title="${escapeHtml(s.display)}"></span>`
                )
                .join('')}
            </div>
          </div>
          <div class="ag-cs-effort-knob"></div>
        </div>
      `;

      const track = pop.querySelector('.ag-cs-effort-track');
      const slotEl = pop.querySelector('.ag-cs-effort-value-slot');
      const valEl = pop.querySelector('.ag-cs-effort-value');
      const previewEl = pop.querySelector('.ag-cs-effort-value-preview');
      const knobEl = pop.querySelector('.ag-cs-effort-knob');
      const canvas = pop.querySelector('.ag-cs-effort-matrix');
      const tickEls = Array.from(pop.querySelectorAll('.ag-cs-effort-tick'));

      let claudeDragRect = null;
      let claudeDragTrackW = 0;
      let claudeHasRendered = false;

      const positionKnob = (prog, instant = false) => {
        if (!knobEl) return;
        const applyCoords = () => {
          const trackW = claudeDragTrackW > 0 ? claudeDragTrackW : track ? (track.clientWidth || 0) : 0;
          const span = trackW > 16 ? trackW - 16 : 0;
          if (span > 0) {
            knobEl.style.left = '';
            knobEl.style.setProperty('--ag-cs-knob-x', `${(prog * span).toFixed(2)}px`);
          } else {
            knobEl.style.setProperty('--ag-cs-knob-x', '0px');
            knobEl.style.left = `calc(${prog.toFixed(4)} * (100% - 16px))`;
          }
        };
        if (instant) {
          knobEl.style.transition = 'none';
          applyCoords();
          if (knobEl.isConnected) void knobEl.offsetWidth;
          knobEl.style.transition = '';
        } else {
          applyCoords();
        }
      };
      pop._syncEffortKnob = (instant = false) => positionKnob(currentProgress, instant);

      const animateValueSwap = (prevIdx, nextIdx, nextText) => {
        if (!valEl) return;
        const prevText = valEl.textContent || '';
        if (prevText === nextText) return;
        if (slotEl && previewEl && !motionReduced() && prevIdx !== nextIdx) {
          previewEl.textContent = prevText;
          valEl.textContent = nextText;
          slotEl.removeAttribute('data-swap-dir');
          void slotEl.offsetWidth;
          slotEl.setAttribute('data-swap-dir', nextIdx > prevIdx ? 'up' : 'down');
          if (swapClearTimer) clearTimeout(swapClearTimer);
          swapClearTimer = setTimeout(() => {
            if (slotEl.isConnected) slotEl.removeAttribute('data-swap-dir');
          }, 170);
        } else {
          valEl.textContent = nextText;
        }
      };

      const stepLoop = () => {
        if (!pop.isConnected || openEffortPop !== pop) {
          effortMatrixRaf = 0;
          return;
        }
        const st = ctx.steps[currentIdx];
        const apex = currentIdx === count - 1;
        paintEffortMatrixCanvas(canvas, st, apex, matrixStartTime, matrixState);
        if (apex && !motionReduced()) {
          effortMatrixRaf = requestAnimationFrame(stepLoop);
        } else {
          effortMatrixRaf = 0;
        }
      };

      const updateVisual = (prog, idx, commit) => {
        const prevIdx = currentIdx;
        const wasApex = prevIdx === count - 1;
        currentProgress = Math.max(0, Math.min(1, prog));
        currentIdx = Math.max(0, Math.min(count - 1, idx));
        const st = ctx.steps[currentIdx];
        const apex = currentIdx === count - 1;
        const stepChanged = !claudeHasRendered || currentIdx !== prevIdx;
        claudeHasRendered = true;

        pop.style.setProperty('--ag-cs-effort-progress', currentProgress.toFixed(4));
        positionKnob(currentProgress);

        if (stepChanged) {
          const nextPct = effortCore.computeEffortTintPercent(count, currentIdx);
          pop.style.setProperty('--ag-cs-effort-pct', (nextPct ?? 67) + '%');
          pop.style.setProperty('--ag-cs-effort-step-tint', st.tint);
          if (apex) pop.setAttribute('data-effort-apex', '1');
          else pop.removeAttribute('data-effort-apex');
          animateValueSwap(prevIdx, currentIdx, st.display);
          if (track) {
            track.setAttribute('aria-valuenow', String(currentIdx));
            track.setAttribute('aria-valuetext', st.display);
          }
          tickEls.forEach((tk, i) => {
            if (i <= currentIdx) tk.classList.add('is-reached');
            else tk.classList.remove('is-reached');
          });
          if (apex && !wasApex) {
            matrixStartTime = performance.now();
          }
          paintEffortMatrixCanvas(canvas, st, apex, matrixStartTime, matrixState);
          if (apex && !effortMatrixRaf && !motionReduced()) {
            effortMatrixRaf = requestAnimationFrame(stepLoop);
          } else if (!apex && effortMatrixRaf) {
            cancelAnimationFrame(effortMatrixRaf);
            effortMatrixRaf = 0;
          }
        }
        if (commit) {
          ctx.selectStep(st, (resolvedDisplay) => {
            if (!resolvedDisplay || ctx.steps[currentIdx] !== st) return;
            st.display = resolvedDisplay;
            if (valEl && valEl.isConnected) valEl.textContent = resolvedDisplay;
            if (track && track.isConnected) track.setAttribute('aria-valuetext', resolvedDisplay);
            if (tickEls[currentIdx]) tickEls[currentIdx].setAttribute('title', resolvedDisplay);
          });
        }
      };

      positionKnob(currentProgress, true);
      paintEffortMatrixCanvas(canvas, step, isApex, matrixStartTime, matrixState);
      if (isApex && !motionReduced()) {
        effortMatrixRaf = requestAnimationFrame(stepLoop);
      }

      let lastPointerCommitAt = 0;

      tickEls.forEach((tk) => {
        tk.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (ev.detail > 0 && performance.now() - lastPointerCommitAt < 300) return;
          const idx = Number(tk.getAttribute('data-tick-idx') || 0);
          updateVisual(idx / maxIdx, idx, true);
        });
      });

      if (track) {
        let pointerActive = false;
        let dragging = false;
        let downClientX = 0;
        let lastIdx = currentIdx;
        let pendingMoveX = null;
        let claudeDragRaf = 0;

        const resolvePointer = (clientX, applyDamping) => {
          const r = claudeDragRect || track.getBoundingClientRect();
          const span = Math.max(1, r.width - 16);
          const rawX = Math.max(0, Math.min(span, clientX - r.left - 8));
          const visualX = applyDamping ? effortCore.dampTravel(rawX, span, count) : rawX;
          const prog = visualX / span;
          const nearest = effortCore.nearestStepIndex(rawX, span, count);
          return { prog, nearest };
        };

        const flushDragMove = () => {
          claudeDragRaf = 0;
          if (!pointerActive || !dragging || pendingMoveX === null) return;
          const x = pendingMoveX;
          pendingMoveX = null;
          const { prog, nearest } = resolvePointer(x, true);
          lastIdx = nearest;
          updateVisual(prog, nearest, false);
        };

        track.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0) return;
          ev.stopPropagation();
          pointerActive = true;
          dragging = false;
          downClientX = ev.clientX;
          lastIdx = currentIdx;
          claudeDragRect = track.getBoundingClientRect();
          claudeDragTrackW = track.clientWidth || claudeDragRect.width || 0;
          try {
            track.setPointerCapture(ev.pointerId);
          } catch {}
          const { prog, nearest } = resolvePointer(ev.clientX, true);
          lastIdx = nearest;
          updateVisual(prog, nearest, false);
        });
        track.addEventListener('pointermove', (ev) => {
          if (!pointerActive) return;
          if (!dragging && Math.abs(ev.clientX - downClientX) >= effortCore.DRAG_THRESHOLD_PX) {
            dragging = true;
            track.classList.add('is-dragging');
            knobEl?.setAttribute('data-dragging', '1');
          }
          if (!dragging) return;
          pendingMoveX = ev.clientX;
          if (typeof requestAnimationFrame === 'function') {
            if (!claudeDragRaf) claudeDragRaf = requestAnimationFrame(flushDragMove);
          } else {
            flushDragMove();
          }
        });
        const finishDrag = (ev) => {
          if (!pointerActive) return;
          pointerActive = false;
          if (claudeDragRaf && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(claudeDragRaf);
            claudeDragRaf = 0;
          }
          const hadPendingMove = pendingMoveX !== null;
          pendingMoveX = null;
          const wasDragging = dragging;
          dragging = false;
          track.classList.remove('is-dragging');
          knobEl?.removeAttribute('data-dragging');
          const { nearest } = resolvePointer(ev.clientX, false);
          claudeDragRect = null;
          claudeDragTrackW = 0;
          const finalIdx = wasDragging && !hadPendingMove ? lastIdx : nearest;
          lastPointerCommitAt = performance.now();
          updateVisual(finalIdx / maxIdx, finalIdx, true);
        };
        track.addEventListener('pointerup', finishDrag);
        track.addEventListener('pointercancel', finishDrag);
        track.addEventListener('keydown', (ev) => {
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            const next = Math.min(count - 1, currentIdx + 1);
            updateVisual(next / maxIdx, next, true);
          } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
            ev.preventDefault();
            const next = Math.max(0, currentIdx - 1);
            updateVisual(next / maxIdx, next, true);
          } else if (ev.key === 'Home') {
            ev.preventDefault();
            updateVisual(0, 0, true);
          } else if (ev.key === 'End') {
            ev.preventDefault();
            updateVisual(1, count - 1, true);
          }
        });
      }
    } else {
      renderCodexEffortPopover(pop, ctx, lang);
    }
  }

  function positionEffortPopover(pop, anchor) {
    if (!pop) return;
    let target = anchor && anchor.isConnected ? anchor : null;
    if (!target) {
      target = document.querySelector('[data-testid="model-selector-trigger"] .ag-cs-effort-badge, [data-testid="model-selector-trigger"]');
    }
    if (!target) return;
    const aRect = target.getBoundingClientRect();
    const pRect = pop.getBoundingClientRect();
    const vw = window.innerWidth || 900;
    const left = Math.max(8, Math.min(vw - pRect.width - 8, aRect.left + aRect.width / 2 - pRect.width / 2));
    let top = aRect.top - pRect.height - 10;
    if (top < 8) top = aRect.bottom + 10;
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  function openEffortPopover(badgeEl, modelBtn) {
    if (!isEffortSliderEnabled()) {
      closeEffortPopover();
      return;
    }
    const anchor = badgeEl || modelBtn;
    if (!anchor) return;
    const resolvedModelBtn = modelBtn || anchor?.closest?.('[data-testid="model-selector-trigger"]') || null;
    if (isModelButtonLocked(resolvedModelBtn)) {
      closeEffortPopover();
      return;
    }
    const preCtx = resolveModelEffortContext(resolvedModelBtn, badgeEl);
    if (!preCtx.interactive) return;
    if (openEffortPop && (openEffortAnchor === anchor || (resolvedModelBtn && resolvedModelBtn.contains(openEffortAnchor)))) {
      closeEffortPopover();
      return;
    }
    closeEffortPopover();
    closeContextPopover();

    const pop = document.createElement('div');
    pop.className = 'ag-cs-effort-popover';
    pop.setAttribute('data-ag-no-i18n', '');
    openEffortPop = pop;
    openEffortAnchor = anchor;
    openEffortModelBtn = resolvedModelBtn;
    openEffortBadgeEl = badgeEl || null;
    document.body.appendChild(pop);
    renderEffortPopoverContent(pop, openEffortModelBtn, openEffortBadgeEl);
    positionEffortPopover(pop, anchor);
    if (typeof pop._syncEffortKnob === 'function') {
      pop._syncEffortKnob(true);
    }
  }

  // ── Gemini 4 Periodic Table Model Selector (.ag-cs-ps-drawer) ──────────
  let openPsBackdrop = null;
  let openPsDrawer = null;
  let openPsTrigger = null;
  let openPsModelBtn = null;
  let openPsResizeFn = null;
  let psTab = 'periodic';
  let psQuery = '';
  let psPinnedSymbol = '';

  function positionPeriodicPopover(drawer, anchorBtn) {
    if (!drawer) return;
    const vw = window.innerWidth || 900;
    const vh = window.innerHeight || 700;
    const target = anchorBtn && anchorBtn.isConnected ? anchorBtn : document.querySelector('[data-testid="model-selector-trigger"]');
    const fallbackW = Math.min(700, Math.max(280, vw - 24));
    const popW = Math.min(vw - 24, drawer.offsetWidth || drawer.getBoundingClientRect().width || fallbackW);

    if (!target || typeof target.getBoundingClientRect !== 'function') {
      drawer.style.left = Math.max(12, Math.round((vw - popW) / 2)) + 'px';
      drawer.style.bottom = '64px';
      drawer.style.top = '';
      drawer.style.maxHeight = Math.min(620, Math.max(240, vh - 88)) + 'px';
      drawer.style.transformOrigin = 'bottom center';
      return;
    }

    const aRect = target.getBoundingClientRect();
    const card = typeof target.closest === 'function' ? target.closest('.surface-composer-card') : null;
    const cRect = card && typeof card.getBoundingClientRect === 'function' ? card.getBoundingClientRect() : null;
    const desiredLeft = cRect ? cRect.left + (cRect.width - popW) / 2 : aRect.right - popW;
    const left = Math.max(12, Math.min(vw - popW - 12, desiredLeft));
    drawer.style.left = Math.round(left) + 'px';

    if (aRect.top >= 320 || aRect.top >= vh - aRect.bottom) {
      const bottomPx = Math.max(12, Math.round(vh - aRect.top + 10));
      drawer.style.top = '';
      drawer.style.bottom = bottomPx + 'px';
      drawer.style.maxHeight = Math.min(620, Math.max(260, Math.floor(aRect.top - 22))) + 'px';
      drawer.style.transformOrigin = 'bottom center';
    } else {
      const topPx = Math.max(12, Math.round(aRect.bottom + 10));
      drawer.style.bottom = '';
      drawer.style.top = topPx + 'px';
      drawer.style.maxHeight = Math.min(620, Math.max(240, Math.floor(vh - aRect.bottom - 22))) + 'px';
      drawer.style.transformOrigin = 'top center';
    }
  }

  function closePeriodicSelector() {
    if (openPsResizeFn && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', openPsResizeFn);
    }
    openPsResizeFn = null;
    if (openPsTrigger && openPsTrigger.isConnected) {
      openPsTrigger.setAttribute('aria-expanded', 'false');
    }
    if (openPsBackdrop && openPsBackdrop.parentElement) {
      openPsBackdrop.parentElement.removeChild(openPsBackdrop);
    }
    if (openPsDrawer && openPsDrawer.parentElement) {
      openPsDrawer.parentElement.removeChild(openPsDrawer);
    }
    openPsBackdrop = null;
    openPsDrawer = null;
    openPsTrigger = null;
    openPsModelBtn = null;
  }

  function refreshOpenPeriodicSelector() {
    if (!openPsDrawer || !openPsDrawer.isConnected) return;
    const theme = isDarkTheme() ? 'dark' : 'light';
    if (openPsBackdrop) openPsBackdrop.setAttribute('data-ps-theme', theme);
    openPsDrawer.setAttribute('data-ps-theme', theme);
    renderPeriodicDrawerShell(openPsDrawer);
    positionPeriodicPopover(openPsDrawer, openPsTrigger || openPsModelBtn);
  }

  function buildPeriodicTriggerButton() {
    const lang = getLang();
    const ui = uiText(lang);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ag-cs-periodic-trigger';
    btn.setAttribute('data-ag-no-i18n', '');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    const tip = ui.psTriggerTooltip || 'Gemini 4 Periodic Table Model Selector';
    btn.setAttribute('aria-label', tip);
    btn.setAttribute('title', tip);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<defs><linearGradient id="ag-cs-gemini-star-grad" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="#4285f4"/>' +
      '<stop offset="52%" stop-color="#9b72cb"/>' +
      '<stop offset="100%" stop-color="#22c1dc"/>' +
      '</linearGradient></defs>' +
      '<path fill="url(#ag-cs-gemini-star-grad)" d="M12 2C12.35 7.45 16.55 11.65 22 12C16.55 12.35 12.35 16.55 12 22C11.65 16.55 7.45 12.35 2 12C7.45 11.65 11.65 7.45 12 2Z"/>' +
      '</svg>';
    btn.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
    });
    btn.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
    });
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const card = btn.closest('.surface-composer-card');
      const mBtn = card?.querySelector('[data-testid="model-selector-trigger"]') || btn._agCsModelBtn || null;
      if (btn.getAttribute('aria-disabled') === 'true' || isModelButtonLocked(mBtn)) return;
      openPeriodicSelector(btn, mBtn);
    });
    return btn;
  }

  function isModelButtonLocked(modelBtn) {
    if (!modelBtn) return false;
    return Boolean(modelBtn.disabled || modelBtn.getAttribute('aria-disabled') === 'true');
  }

  function resolveInlineModelAnchor(modelBtn) {
    const wrap = modelBtn && typeof modelBtn.closest === 'function' ? modelBtn.closest('.no-focus-agent-input') : null;
    if (wrap && wrap.parentElement) {
      return { parent: wrap.parentElement, slot: wrap };
    }
    return { parent: modelBtn?.parentElement || null, slot: modelBtn };
  }

  function syncPeriodicTrigger(card, footer, modelBtn) {
    if (!card) return;
    const existing = card.querySelector('.ag-cs-periodic-trigger');
    if (cfg.periodicSelector === false || !modelBtn || !periodicCore) {
      if (existing) {
        if (openPsTrigger === existing) closePeriodicSelector();
        if (existing.parentElement?.hasAttribute?.('data-ag-cs-inline-model-wrap')) {
          existing.parentElement.removeAttribute('data-ag-cs-inline-model-wrap');
        }
        existing.remove();
      }
      return;
    }

    const lang = getLang();
    const ui = uiText(lang);
    const isLocked = isModelButtonLocked(modelBtn);
    const lockedTip =
      lang === 'zh-CN'
        ? '智能体运行中无法更改模型'
        : lang === 'zh-TW'
        ? '代理執行中無法變更模型'
        : lang === 'yue'
        ? '代理行緊嗰陣唔可以改模型'
        : lang === 'ja'
        ? 'エージェント実行中はモデルを変更できません'
        : 'Model cannot be changed while the agent is running';
    const tip = isLocked ? lockedTip : ui.psTriggerTooltip || 'Gemini 4 Periodic Table Model Selector';
    const inlineMode = !footer || cfg.composerRestyle === false;
    const inlineAnchor = inlineMode ? resolveInlineModelAnchor(modelBtn) : null;
    const desiredParent = inlineMode ? inlineAnchor.parent : footer;
    if (!desiredParent) return;

    const btn = existing || buildPeriodicTriggerButton();
    btn._agCsModelBtn = modelBtn;
    if (btn.classList.contains('is-disabled') !== isLocked) {
      btn.classList.toggle('is-disabled', isLocked);
    }
    if (isLocked) {
      if (btn.getAttribute('aria-disabled') !== 'true') btn.setAttribute('aria-disabled', 'true');
      if (openPsTrigger === btn) closePeriodicSelector();
    } else if (btn.hasAttribute('aria-disabled')) {
      btn.removeAttribute('aria-disabled');
    }
    if (inlineMode) {
      if (!btn.classList.contains('is-inline')) btn.classList.add('is-inline');
    } else if (btn.classList.contains('is-inline')) {
      btn.classList.remove('is-inline');
    }
    if (btn.getAttribute('title') !== tip) {
      btn.setAttribute('title', tip);
      btn.setAttribute('aria-label', tip);
    }
    const expandedVal = openPsTrigger === btn && openPsDrawer?.isConnected ? 'true' : 'false';
    if (btn.getAttribute('aria-expanded') !== expandedVal) {
      btn.setAttribute('aria-expanded', expandedVal);
    }

    if (inlineMode) {
      const slot = inlineAnchor.slot;
      if (existing?.parentElement && existing.parentElement !== desiredParent && existing.parentElement.hasAttribute?.('data-ag-cs-inline-model-wrap')) {
        existing.parentElement.removeAttribute('data-ag-cs-inline-model-wrap');
      }
      if (desiredParent.getAttribute?.('data-ag-cs-inline-model-wrap') !== '1') {
        desiredParent.setAttribute?.('data-ag-cs-inline-model-wrap', '1');
      }
      if (btn.parentElement !== desiredParent || btn.nextSibling !== slot) {
        desiredParent.insertBefore(btn, slot);
      }
    } else {
      if (existing?.parentElement && existing.parentElement !== footer && existing.parentElement.hasAttribute?.('data-ag-cs-inline-model-wrap')) {
        existing.parentElement.removeAttribute('data-ag-cs-inline-model-wrap');
      }
      if (btn.parentElement !== footer) {
        footer.appendChild(btn);
      }
    }
  }

  function buildOrchestratorSwitchButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ag-cs-orch-switch';
    btn.setAttribute('data-ag-no-i18n', '');
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', 'false');
    btn.innerHTML =
      '<svg class="ag-cs-orch-ico" viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="3.2" r="1.7" fill="currentColor"/>' +
      '<circle cx="3.3" cy="12.2" r="1.7" fill="currentColor"/>' +
      '<circle cx="12.7" cy="12.2" r="1.7" fill="currentColor"/>' +
      '<path d="M8 5.1v2.5M8 7.6L4.5 10.8M8 7.6l3.5 3.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" fill="none"/>' +
      '</svg>' +
      '<span class="ag-cs-orch-lbl">协作</span>' +
      '<span class="ag-cs-orch-dot" aria-hidden="true"></span>';
    btn.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
    });
    btn.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
    });
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const mBtn = btn._agCsModelBtn || btn.closest('.surface-composer-card')?.querySelector('[data-testid="model-selector-trigger"]') || null;
      if (btn.getAttribute('aria-disabled') === 'true' || isModelButtonLocked(mBtn)) return;
      const fp = getModelFiberProps(mBtn);
      if (!fp || !periodicCore || typeof periodicCore.computeOrchestratorToggleTarget !== 'function') return;
      const prevSelected = fp.selectedModel || null;
      if (prevSelected) rememberStandardModel(prevSelected);
      const preferredEff = lastStandardModelMeta?.effortId || '';
      const activePlanner =
        typeof periodicCore.resolveOrchestratorPlanner === 'function' && Array.isArray(fp.orchestratorPlanners)
          ? periodicCore.resolveOrchestratorPlanner(fp.orchestratorPlanners, fp.orchestratorPick, fp.orchestratorDefaultPlanner)
          : null;
      const res = periodicCore.computeOrchestratorToggleTarget(
        fp.modelOptions,
        prevSelected,
        preferredEff,
        lastStandardModelMeta,
        activePlanner
      );
      if (res && res.targetOption && typeof fp.setSelectedModel === 'function') {
        if (
          res.nextOrchestrator &&
          prevSelected &&
          typeof fp.orchestratorPick?.select === 'function' &&
          typeof periodicCore.findMatchingOrchestratorPlanner === 'function' &&
          Array.isArray(fp.orchestratorPlanners)
        ) {
          const matchingPlanner = periodicCore.findMatchingOrchestratorPlanner(
            fp.orchestratorPlanners,
            prevSelected,
            preferredEff
          );
          if (matchingPlanner && matchingPlanner.value !== undefined) {
            try {
              rememberOrchestratorPlanner(matchingPlanner);
              fp.orchestratorPick.select(matchingPlanner.value);
            } catch {}
          }
        }
        try {
          fp.setSelectedModel(res.targetOption);
        } catch {}
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => scheduleSync());
        } else {
          scheduleSync();
        }
      }
    });
    return btn;
  }

  function syncOrchestratorSwitch(card, footer, modelBtn) {
    if (!card) return;
    const existing = card.querySelector('.ag-cs-orch-switch');
    if (!modelBtn || !periodicCore || typeof periodicCore.resolveOrchestratorState !== 'function') {
      if (existing) existing.remove();
      return;
    }

    const fp = getModelFiberProps(modelBtn);
    if (!fp || !Array.isArray(fp.modelOptions) || !fp.modelOptions.length) {
      if (existing) existing.remove();
      return;
    }
    if (fp.selectedModel) rememberStandardModel(fp.selectedModel);

    const state = periodicCore.resolveOrchestratorState(
      fp.modelOptions,
      fp.selectedModel,
      lastStandardModelMeta?.effortId || ''
    );
    syncOrRestoreOrchestratorPlanner(fp, state);

    if (cfg.orchestratorSwitch === false || !state.available) {
      if (existing) existing.remove();
      return;
    }

    const inlineMode = !footer || cfg.composerRestyle === false;
    const inlineAnchor = inlineMode ? resolveInlineModelAnchor(modelBtn) : null;
    const desiredParent = inlineMode ? inlineAnchor.parent : footer;
    if (!desiredParent) return;

    const btn = existing || buildOrchestratorSwitchButton();
    btn._agCsModelBtn = modelBtn;
    const isOrch = Boolean(state.isOrchestrator);
    const isLocked = isModelButtonLocked(modelBtn);
    if (btn.classList.contains('is-inline') !== inlineMode) {
      btn.classList.toggle('is-inline', inlineMode);
    }
    if (btn.classList.contains('is-active') !== isOrch) {
      btn.classList.toggle('is-active', isOrch);
    }
    if (btn.classList.contains('is-disabled') !== isLocked) {
      btn.classList.toggle('is-disabled', isLocked);
    }
    if (isLocked) {
      if (btn.getAttribute('aria-disabled') !== 'true') btn.setAttribute('aria-disabled', 'true');
    } else if (btn.hasAttribute('aria-disabled')) {
      btn.removeAttribute('aria-disabled');
    }
    const checkedVal = isOrch ? 'true' : 'false';
    if (btn.getAttribute('aria-checked') !== checkedVal) {
      btn.setAttribute('aria-checked', checkedVal);
    }

    const lang = getLang();
    const isZh = lang === 'zh-CN' || lang === 'zh-TW' || lang === 'yue';
    const lblText = lang === 'zh-CN' ? '协作' : (lang === 'zh-TW' || lang === 'yue') ? '協作' : lang === 'ja' ? '協調' : 'Orch';
    const lblEl = btn.querySelector('.ag-cs-orch-lbl');
    if (lblEl && lblEl.textContent !== lblText) lblEl.textContent = lblText;

    let targetSym = isOrch
      ? state.activeSymbol || state.matchingOrchestratorSymbol || ''
      : state.matchingOrchestratorSymbol || state.activeSymbol || '';
    if (isOrch && typeof periodicCore.resolveOrchestratorPlanner === 'function' && Array.isArray(fp.orchestratorPlanners)) {
      const planner = periodicCore.resolveOrchestratorPlanner(
        fp.orchestratorPlanners,
        fp.orchestratorPick,
        fp.orchestratorDefaultPlanner
      );
      if (planner) {
        const pParsed = periodicCore.parseOptionEffort(planner.label || planner.modelId || '');
        const pEl = periodicCore.matchGemini4Element(pParsed.base || planner.label || '');
        if (pEl?.symbol) targetSym = pEl.symbol;
      }
    }
    const lockedTip =
      lang === 'zh-CN'
        ? '智能体运行中无法切换协作模式'
        : lang === 'zh-TW'
        ? '代理執行中無法切換協作模式'
        : lang === 'yue'
        ? '代理行緊嗰陣唔可以切換協作模式'
        : lang === 'ja'
        ? 'エージェント実行中は協調モードを切り替えられません'
        : 'Orchestrator cannot be changed while the agent is running';
    const tip = isLocked
      ? lockedTip
      : isOrch
      ? isZh
        ? `协作模式已开启${targetSym ? `（${targetSym}）` : ''} — 点击切回标准模型`
        : `Orchestrator ON${targetSym ? ` (${targetSym})` : ''} — Click to return to standard model`
      : isZh
      ? `点击开启协作模式${targetSym ? `（${targetSym}）` : ''}`
      : `Click to enable Orchestrator mode${targetSym ? ` (${targetSym})` : ''}`;
    if (btn.getAttribute('title') !== tip) {
      btn.setAttribute('title', tip);
      btn.setAttribute('aria-label', tip);
    }

    const periodicBtn = card.querySelector('.ag-cs-periodic-trigger');
    if (inlineMode) {
      const slot = inlineAnchor.slot;
      const afterSlot = slot ? slot.nextSibling : null;
      if (btn.parentElement !== desiredParent || (slot && slot.nextSibling !== btn)) {
        desiredParent.insertBefore(btn, afterSlot);
      }
    } else {
      if (periodicBtn && periodicBtn.parentElement === footer) {
        if (btn.parentElement !== footer || btn.nextSibling !== periodicBtn) {
          footer.insertBefore(btn, periodicBtn);
        }
      } else if (btn.parentElement !== footer) {
        footer.appendChild(btn);
      }
    }
  }

  function createEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function commitPeriodicModelOption(fiberProps, option) {
    if (!option || !fiberProps || typeof fiberProps.setSelectedModel !== 'function') return;
    try {
      fiberProps.setSelectedModel(option);
    } catch {}
    closePeriodicSelector();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => scheduleSync());
    } else {
      scheduleSync();
    }
  }

  function findTargetComposerEditor(sourceCard) {
    const fromSource = sourceCard?.querySelector?.('[contenteditable="true"]');
    if (fromSource) return fromSource;
    const boxes = Array.from(document.querySelectorAll('[data-testid="agent-input-box"]'));
    for (const box of boxes) {
      if (box.closest && box.closest('[data-testid="subagent-tab-conversation"]')) continue;
      const ed = box.querySelector('[contenteditable="true"]');
      if (ed) return ed;
    }
    return document.querySelector('[data-testid="agent-input-box"] [contenteditable="true"]');
  }

  function insertTextIntoComposer(text, sourceCard) {
    if (!text) return false;
    const ed = findTargetComposerEditor(sourceCard);
    if (!ed) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          Promise.resolve(navigator.clipboard.writeText(text)).catch(() => {});
        }
      } catch {}
      return false;
    }

    if (typeof ed.focus === 'function') ed.focus();
    const existing = (ed.textContent || '').replace(/\u200b/g, '').trim();
    if (existing && existing.endsWith(text.trim())) return true;
    const payload = existing ? '\n\n' + text : text;

    try {
      if (typeof document.createRange === 'function' && typeof window.getSelection === 'function') {
        const range = document.createRange();
        range.selectNodeContents(ed);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    } catch {}

    let inserted = false;
    if (
      typeof DataTransfer === 'function' &&
      typeof ClipboardEvent === 'function' &&
      typeof ed.dispatchEvent === 'function'
    ) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', payload);
        const beforeLen = (ed.textContent || '').length;
        const pasteEv = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
        const dispatchOk = ed.dispatchEvent(pasteEv);
        const grew = (ed.textContent || '').length > beforeLen;
        if (!dispatchOk || pasteEv.defaultPrevented || grew) inserted = true;
      } catch {}
    }

    if (!inserted && typeof document.execCommand === 'function') {
      try {
        const beforeLen = (ed.textContent || '').length;
        const cmdOk = document.execCommand('insertText', false, payload);
        const grew = (ed.textContent || '').length > beforeLen;
        if (cmdOk || grew) inserted = true;
      } catch {}
    }

    if (!inserted && !ed.__lexicalEditor) {
      ed.textContent = existing ? existing + '\n\n' + text : text;
      inserted = true;
    }

    setTimeout(() => {
      if (!destroyed) {
        queueSmoothCaret(true, true);
        scheduleSync();
      }
    }, 40);

    return inserted;
  }

  function resolveQuotaBadgeText(baseName, ui) {
    if (typeof usageCore?.getActiveQuotaInfo !== 'function' || !cachedQuotaData) return '';
    const q = usageCore.getActiveQuotaInfo(cachedQuotaData, baseName);
    if (!q || typeof q.effectiveRemainingPct !== 'number') return '';
    const label = ui.psQuotaLabel || 'Quota';
    const pct = Math.round(q.effectiveRemainingPct);
    const rst = fmtBucketReset(q.b5h || q.bWeek, getLang());
    return rst ? `${label}: ${pct}% · ${rst}` : `${label}: ${pct}%`;
  }

  function renderPeriodicPreviewBar(previewEl, tile, fiberProps, curEffortId, ui) {
    if (!previewEl) return;
    previewEl.textContent = '';
    if (!tile) {
      previewEl.classList.add('is-dormant');
      return;
    }
    if (tile.isLaunched) previewEl.classList.remove('is-dormant');
    else previewEl.classList.add('is-dormant');

    const row = createEl('div', 'ag-cs-ps-preview-row');
    const swatchCls = tile.isLaunched
      ? `ag-cs-ps-swatch is-launched ag-cs-ps-theme-${tile.theme || 'hydrogen'}`
      : 'ag-cs-ps-swatch is-dormant';
    const swatch = createEl('div', swatchCls);
    if (tile.num !== '' && tile.num !== undefined) {
      swatch.appendChild(createEl('span', 'ag-cs-ps-num', tile.num));
    }
    swatch.appendChild(createEl('span', 'ag-cs-ps-sym', tile.symbol));
    row.appendChild(swatch);

    const details = createEl('div', 'ag-cs-ps-preview-details');
    const head = createEl('div', 'ag-cs-ps-preview-head');
    const spec = tile.spec || null;
    const fam = tile.family || null;

    if (!tile.isLaunched) {
      head.appendChild(createEl('span', 'ag-cs-ps-preview-title', tile.name || tile.symbol));
      details.appendChild(head);
      row.appendChild(details);
      previewEl.appendChild(row);
      return;
    }

    const titleTxt = fam?.baseName || tile.disabledInfo?.baseName || spec?.title || `Gemini 4 ${tile.name}`;
    const slugTxt = fam?.modelIdBase || spec?.slug || tile.disabledInfo?.modelId || '';
    head.appendChild(createEl('span', 'ag-cs-ps-preview-title', titleTxt));
    if (slugTxt) head.appendChild(createEl('span', 'ag-cs-ps-preview-slug', slugTxt));
    if (tile.isNew) {
      head.appendChild(createEl('span', 'ag-cs-ps-badge is-new', 'New'));
    }
    if (tile.isSubscriptionLocked) {
      head.appendChild(createEl('span', 'ag-cs-ps-badge is-locked', ui.psSubscriptionLocked || 'Unavailable on current plan'));
    } else if (tile.isPreviewOnly) {
      head.appendChild(createEl('span', 'ag-cs-ps-badge is-preview', ui.psPreviewOnly || 'Not available on current account'));
    }
    details.appendChild(head);

    const descTxt = spec?.desc || fam?.tagDescription || tile.disabledInfo?.tagDescription || '';
    if (descTxt) {
      details.appendChild(createEl('p', 'ag-cs-ps-preview-desc', descTxt));
    }
    row.appendChild(details);
    previewEl.appendChild(row);

    const drawerBody = createEl('div', 'ag-cs-ps-drawer-body is-open');
    const drawerInner = createEl('div', 'ag-cs-ps-drawer-inner');

    const chipsRow = createEl('div', 'ag-cs-ps-chips-row');
    if (spec?.context) chipsRow.appendChild(createEl('span', 'ag-cs-ps-meta-chip', spec.context));
    if (spec?.pricing) chipsRow.appendChild(createEl('span', 'ag-cs-ps-meta-chip', spec.pricing));
    if (spec?.released) chipsRow.appendChild(createEl('span', 'ag-cs-ps-meta-chip', spec.released));
    const quotaTxt = fam ? resolveQuotaBadgeText(fam.baseName, ui) : '';
    if (quotaTxt) chipsRow.appendChild(createEl('span', 'ag-cs-ps-meta-chip', quotaTxt));
    if (chipsRow.childElementCount > 0) drawerInner.appendChild(chipsRow);

    if ((fam && Array.isArray(fam.variants) && fam.variants.length > 0) || tile.orchestratorOption) {
      const effRow = createEl('div', 'ag-cs-ps-effort-row');
      if (fam && Array.isArray(fam.variants) && fam.variants.length > 0) {
        effRow.appendChild(createEl('span', 'ag-cs-ps-effort-lbl', `${ui.psEffortLabel || 'Effort'}:`));
        for (const v of fam.variants) {
          const isActive = fam.isSelected && !tile.isOrchestratorSelected && v.effortId === fam.selectedEffortId;
          const eb = createEl('button', `ag-cs-ps-effort-btn${isActive ? ' is-active' : ''}`, v.effortDisplay || v.label);
          eb.type = 'button';
          eb.addEventListener('click', (ev) => {
            ev.stopPropagation();
            rememberStandardModel(v.option);
            commitPeriodicModelOption(fiberProps, v.option);
          });
          effRow.appendChild(eb);
        }
      }
      if (tile.orchestratorOption) {
        const isOrchOn = Boolean(tile.isOrchestratorSelected);
        const curLang = getLang();
        const orchLabel = curLang === 'zh-CN' ? '协作模式' : (curLang === 'zh-TW' || curLang === 'yue') ? '協作模式' : 'Orchestrator';
        const orchBtn = createEl('button', `ag-cs-ps-orch-toggle${isOrchOn ? ' is-active' : ''}`);
        orchBtn.type = 'button';
        orchBtn.setAttribute('role', 'switch');
        orchBtn.setAttribute('aria-checked', isOrchOn ? 'true' : 'false');
        orchBtn.setAttribute('data-ag-no-i18n', '');
        orchBtn.innerHTML =
          '<svg class="ag-cs-orch-ico" viewBox="0 0 16 16" aria-hidden="true">' +
          '<circle cx="8" cy="3.2" r="1.7" fill="currentColor"/>' +
          '<circle cx="3.3" cy="12.2" r="1.7" fill="currentColor"/>' +
          '<circle cx="12.7" cy="12.2" r="1.7" fill="currentColor"/>' +
          '<path d="M8 5.1v2.5M8 7.6L4.5 10.8M8 7.6l3.5 3.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" fill="none"/>' +
          '</svg>' +
          `<span class="ag-cs-ps-orch-label">${orchLabel}</span>` +
          '<span class="ag-cs-orch-dot" aria-hidden="true"></span>';
        orchBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (isOrchOn && fam) {
            const activePlanner =
              typeof periodicCore.resolveOrchestratorPlanner === 'function' && Array.isArray(fiberProps?.orchestratorPlanners)
                ? periodicCore.resolveOrchestratorPlanner(
                    fiberProps.orchestratorPlanners,
                    fiberProps.orchestratorPick,
                    fiberProps.orchestratorDefaultPlanner
                  )
                : null;
            const plannerEff = activePlanner ? periodicCore.parseOptionEffort(activePlanner.label || '').effortId : '';
            const preferred = periodicCore.pickPreferredVariant(
              fam,
              plannerEff || lastStandardModelMeta?.effortId || curEffortId
            );
            if (preferred?.option) {
              commitPeriodicModelOption(fiberProps, preferred.option);
            }
          } else {
            if (fiberProps?.selectedModel) rememberStandardModel(fiberProps.selectedModel);
            const desiredEffort = lastStandardModelMeta?.effortId || curEffortId || 'high';
            const preferredForTile = fam ? periodicCore.pickPreferredVariant(fam, desiredEffort)?.option : null;
            if (
              preferredForTile &&
              typeof fiberProps?.orchestratorPick?.select === 'function' &&
              typeof periodicCore.findMatchingOrchestratorPlanner === 'function' &&
              Array.isArray(fiberProps?.orchestratorPlanners)
            ) {
              const matchingPlanner = periodicCore.findMatchingOrchestratorPlanner(
                fiberProps.orchestratorPlanners,
                preferredForTile,
                desiredEffort
              );
              if (matchingPlanner && matchingPlanner.value !== undefined) {
                try {
                  rememberOrchestratorPlanner(matchingPlanner);
                  fiberProps.orchestratorPick.select(matchingPlanner.value);
                } catch {}
              }
            }
            commitPeriodicModelOption(fiberProps, tile.orchestratorOption);
          }
        });
        effRow.appendChild(orchBtn);
      }
      drawerInner.appendChild(effRow);
    }

    drawerBody.appendChild(drawerInner);
    previewEl.appendChild(drawerBody);
  }

  function renderPeriodicContentArea(contentEl, grouped, fiberProps, curEffortId, ui) {
    if (!contentEl) return;
    contentEl.textContent = '';

    const showPeriodic = psTab === 'periodic' && !psQuery.trim();
    if (showPeriodic) {
      const stage = createEl('div', 'ag-cs-ps-stage');
      const grid = createEl('div', 'ag-cs-ps-grid');

      const saddle = createEl('div', 'ag-cs-ps-saddle');
      saddle.appendChild(createEl('div', 'ag-cs-ps-eyebrow', 'THE PERIODIC TABLE OF'));
      const h2 = createEl('h2', 'ag-cs-ps-board-title', 'Gemini 4');
      saddle.appendChild(h2);

      const legend = createEl('div', 'ag-cs-ps-legend');
      const countVal = Math.max(1, grouped.releasedCount || 4);
      const roller = createEl('span', 'ag-cs-ps-roller');
      const track = createEl('span', 'ag-cs-ps-roller-track');
      track.style.setProperty('--roll-steps', String(countVal - 1));
      for (let d = 1; d <= countVal; d++) {
        track.appendChild(createEl('span', '', String(d)));
      }
      roller.appendChild(track);
      legend.appendChild(roller);
      legend.appendChild(createEl('span', '', ui.psReleased || 'released'));
      saddle.appendChild(legend);
      grid.appendChild(saddle);

      const previewEl = createEl('div', 'ag-cs-ps-preview');

      const defaultTile =
        (psPinnedSymbol && grouped.tiles.find((t) => t.symbol === psPinnedSymbol && t.isLaunched)) ||
        grouped.tiles.find((t) => t.isSelected) ||
        grouped.tiles.find((t) => t.symbol === 'Ne' && t.isLaunched) ||
        grouped.tiles.find((t) => t.isLaunched) ||
        null;

      const tileCellsBySymbol = new Map();
      const syncPinnedTileVisuals = () => {
        for (const [sym, el] of tileCellsBySymbol.entries()) {
          if (psPinnedSymbol && sym === psPinnedSymbol) el.classList.add('is-pinned');
          else el.classList.remove('is-pinned');
        }
      };

      for (const tile of grouped.tiles) {
        const cls = ['ag-cs-ps-tile'];
        if (tile.isLaunched) {
          cls.push('is-launched', `ag-cs-ps-theme-${tile.theme || 'hydrogen'}`);
          if (tile.isHero) cls.push('is-neon');
          if (tile.isSelected) cls.push('is-selected');
          if (psPinnedSymbol && psPinnedSymbol === tile.symbol) cls.push('is-pinned');
          if (tile.isPreviewOnly) cls.push('is-preview-only');
        } else {
          cls.push('is-dormant');
          if (tile.faded) cls.push('is-faded-row');
          if (tile.isRange) cls.push('is-range-placeholder');
        }

        const cell = document.createElement(tile.isLaunched ? 'button' : 'div');
        cell.className = cls.join(' ');
        cell.style.gridColumn = String(tile.col);
        cell.style.gridRow = String(tile.row);

        if (tile.isLaunched) {
          cell.type = 'button';
          cell.setAttribute('data-ps-symbol', tile.symbol);
          tileCellsBySymbol.set(tile.symbol, cell);
          if (tile.num !== '' && tile.num !== undefined) {
            cell.setAttribute('data-atomic-number', String(tile.num));
          }
          cell.setAttribute('aria-pressed', tile.isSelected ? 'true' : 'false');
          const titleLabel = tile.family?.baseName || tile.spec?.title || tile.name;
          cell.setAttribute('aria-label', `${tile.name}, element ${tile.num} — ${titleLabel}`);
        }

        if (tile.isHero && tile.isLaunched) {
          const flipper = createEl('span', 'ag-cs-ps-card-flipper');
          const front = createEl('span', 'ag-cs-ps-card-face ag-cs-ps-card-face--front');
          front.appendChild(createEl('span', 'ag-cs-ps-num', tile.num));
          front.appendChild(createEl('span', 'ag-cs-ps-sym', tile.symbol));
          const back = createEl('span', `ag-cs-ps-card-face ag-cs-ps-card-face--back ag-cs-ps-theme-${tile.theme || 'neon'}`);
          back.appendChild(createEl('span', 'ag-cs-ps-num', tile.num));
          if (tile.isNew) back.appendChild(createEl('span', 'ag-cs-ps-pip'));
          back.appendChild(createEl('span', 'ag-cs-ps-sym', tile.symbol));
          flipper.appendChild(front);
          flipper.appendChild(back);
          cell.appendChild(flipper);
        } else {
          if (tile.num !== '' && tile.num !== undefined) {
            cell.appendChild(createEl('span', 'ag-cs-ps-num', tile.num));
          }
          if (tile.isNew && tile.isLaunched) {
            cell.appendChild(createEl('span', 'ag-cs-ps-pip'));
          }
          cell.appendChild(createEl('span', 'ag-cs-ps-sym', tile.symbol));
        }

        if (!tile.isRange) {
          cell.addEventListener('mouseenter', () => {
            // When an element is pinned for effort selection, moving cursor down across dormant tiles
            // toward the bottom effort buttons must not wipe out the pinned element's preview bar.
            if (psPinnedSymbol && !tile.isLaunched) return;
            renderPeriodicPreviewBar(previewEl, tile, fiberProps, curEffortId, ui);
          });
        }
        if (tile.isLaunched) {
          cell.addEventListener('focus', () => {
            renderPeriodicPreviewBar(previewEl, tile, fiberProps, curEffortId, ui);
          });
          cell.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (tile.isAvailableInHost && tile.family) {
              const variants = Array.isArray(tile.family.variants) ? tile.family.variants : [];
              // First click on a multi-effort element pins it so the user can choose an effort tier
              // without closing the drawer; clicking the already-pinned element (or a single-variant
              // element) commits immediately.
              if (variants.length > 1 && psPinnedSymbol !== tile.symbol) {
                psPinnedSymbol = tile.symbol;
                syncPinnedTileVisuals();
                renderPeriodicPreviewBar(previewEl, tile, fiberProps, curEffortId, ui);
                return;
              }
              const preferred = periodicCore.pickPreferredVariant(tile.family, curEffortId);
              if (preferred?.option) {
                commitPeriodicModelOption(fiberProps, preferred.option);
                return;
              }
            }
            psPinnedSymbol = tile.symbol;
            syncPinnedTileVisuals();
            renderPeriodicPreviewBar(previewEl, tile, fiberProps, curEffortId, ui);
          });
          cell.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            if (tile.isAvailableInHost && tile.family) {
              const preferred = periodicCore.pickPreferredVariant(tile.family, curEffortId);
              if (preferred?.option) {
                commitPeriodicModelOption(fiberProps, preferred.option);
              }
            }
          });
        }
        grid.appendChild(cell);
      }

      grid.addEventListener('mouseleave', () => {
        const fallbackTile =
          (psPinnedSymbol && grouped.tiles.find((t) => t.symbol === psPinnedSymbol && t.isLaunched)) ||
          defaultTile;
        renderPeriodicPreviewBar(previewEl, fallbackTile, fiberProps, curEffortId, ui);
      });

      stage.appendChild(grid);
      contentEl.appendChild(stage);
      renderPeriodicPreviewBar(previewEl, defaultTile, fiberProps, curEffortId, ui);
      contentEl.appendChild(previewEl);
      return;
    }

    const effectiveTab = psTab === 'periodic' ? 'all' : psTab;
    const list = periodicCore.filterModelFamilies(grouped.families, effectiveTab, psQuery);
    if (list.length === 0) {
      contentEl.appendChild(createEl('div', 'ag-cs-ps-empty', ui.psNoResults || 'No matching models'));
      return;
    }

    const listEl = createEl('div', 'ag-cs-ps-list');
    for (const fam of list) {
      const card = createEl('div', `ag-cs-ps-list-card${fam.isSelected ? ' is-selected' : ''}`);
      card.setAttribute('data-ps-family', fam.id);

      const top = createEl('div', 'ag-cs-ps-list-top');
      const titleWrap = createEl('div', 'ag-cs-ps-list-title-wrap');
      titleWrap.appendChild(createEl('span', 'ag-cs-ps-preview-title', fam.baseName));
      if (fam.modelIdBase) {
        titleWrap.appendChild(createEl('span', 'ag-cs-ps-preview-slug', fam.modelIdBase));
      }
      if (fam.tagTitle) {
        const badgeCls = fam.tagTitle.toLowerCase() === 'new' ? 'ag-cs-ps-badge is-new' : 'ag-cs-ps-badge';
        titleWrap.appendChild(createEl('span', badgeCls, fam.tagTitle));
      }
      top.appendChild(titleWrap);
      card.appendChild(top);

      const desc = fam.spec?.desc || fam.tagDescription || '';
      if (desc) {
        card.appendChild(createEl('p', 'ag-cs-ps-preview-desc', desc));
      }

      const metaRow = createEl('div', 'ag-cs-ps-chips-row');
      metaRow.style.paddingTop = '0';
      if (fam.spec?.context) metaRow.appendChild(createEl('span', 'ag-cs-ps-meta-chip', fam.spec.context));
      if (fam.spec?.pricing) metaRow.appendChild(createEl('span', 'ag-cs-ps-meta-chip', fam.spec.pricing));
      const quotaTxt = resolveQuotaBadgeText(fam.baseName, ui);
      if (quotaTxt) metaRow.appendChild(createEl('span', 'ag-cs-ps-meta-chip', quotaTxt));
      if (metaRow.childElementCount > 0) card.appendChild(metaRow);

      if (fam.variants.length > 0) {
        const effRow = createEl('div', 'ag-cs-ps-effort-row');
        for (const v of fam.variants) {
          const isActive = fam.isSelected && v.effortId === fam.selectedEffortId;
          const eb = createEl('button', `ag-cs-ps-effort-btn${isActive ? ' is-active' : ''}`, v.effortDisplay || v.label);
          eb.type = 'button';
          eb.addEventListener('click', (ev) => {
            ev.stopPropagation();
            commitPeriodicModelOption(fiberProps, v.option);
          });
          effRow.appendChild(eb);
        }
        card.appendChild(effRow);
      }

      card.addEventListener('click', () => {
        const preferred = periodicCore.pickPreferredVariant(fam, curEffortId);
        if (preferred?.option) {
          commitPeriodicModelOption(fiberProps, preferred.option);
        }
      });
      listEl.appendChild(card);
    }
    contentEl.appendChild(listEl);
  }

  function renderPeriodicDrawerShell(drawer) {
    if (!drawer || !periodicCore) return;
    drawer.textContent = '';

    const lang = getLang();
    const ui = uiText(lang);
    const fiberProps = getModelFiberProps(openPsModelBtn);
    const grouped = periodicCore.groupModelOptions(fiberProps?.modelOptions || [], fiberProps?.selectedModel || null);
    const curEffortId = periodicCore.parseOptionEffort(fiberProps?.selectedModel?.label).effortId || 'high';

    const header = createEl('div', 'ag-cs-ps-header');
    header.appendChild(createEl('span', 'ag-cs-ps-title', ui.psTitle || 'Model selection'));
    const actions = createEl('div', 'ag-cs-ps-header-actions');
    const syncBtn = createEl('button', 'ag-cs-ps-sync-btn');
    syncBtn.type = 'button';
    const syncTip =
      ui.psSyncTooltip ||
      'Sync latest elements, colors, and pricing from Google AI Studio';
    syncBtn.setAttribute('title', syncTip);
    syncBtn.setAttribute('aria-label', syncTip);
    syncBtn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.88L2.5 10.3M2.5 13.5v-3.2h3.2"/>' +
      '<path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.88L13.5 5.7M13.5 2.5v3.2h-3.2"/>' +
      '</svg>';
    const syncLblText =
      psSyncState.status === 'syncing'
        ? ui.psSyncing || 'Syncing…'
        : psSyncState.status === 'synced' || psSyncState.status === 'fallback'
        ? psSyncState.label
        : ui.psSyncBtn || 'Sync AI Studio';
    if (psSyncState.status === 'syncing') {
      syncBtn.classList.add('is-syncing');
      syncBtn.disabled = true;
    } else if (psSyncState.status === 'synced') {
      syncBtn.classList.add('is-synced');
    } else if (psSyncState.status === 'fallback') {
      syncBtn.classList.add('is-fallback');
    }
    syncBtn.appendChild(createEl('span', 'ag-cs-ps-sync-lbl', syncLblText));
    syncBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const sourceCard = (openPsTrigger || openPsModelBtn)?.closest?.('.surface-composer-card') || null;
      const runPromptFallback = () => {
        const prompt =
          typeof periodicCore.buildPeriodicSyncPrompt === 'function'
            ? periodicCore.buildPeriodicSyncPrompt(getLang())
            : '';
        closePeriodicSelector();
        if (prompt) insertTextIntoComposer(prompt, sourceCard);
      };
      if (psSyncState.status === 'fallback') {
        if (psSyncState.timer) clearTimeout(psSyncState.timer);
        psSyncState = { status: 'idle', label: '', timer: null, reqId: '' };
        runPromptFallback();
        return;
      }
      const bindingName = cfg && cfg.binding ? String(cfg.binding) : '';
      const bindingFn = bindingName && typeof window[bindingName] === 'function' ? window[bindingName] : null;
      if (!bindingFn) {
        runPromptFallback();
        return;
      }
      if (psSyncState.timer) clearTimeout(psSyncState.timer);
      const reqId = `ps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      psSyncState = { status: 'syncing', label: ui.psSyncing || 'Syncing…', timer: null, reqId };
      psSyncState.timer = setTimeout(() => {
        if (psSyncState.reqId === reqId && psSyncState.status === 'syncing') {
          window.__agCsOnPeriodicSyncResult?.({ requestId: reqId, ok: false, error: 'timeout' });
        }
      }, 30000);
      refreshOpenPeriodicSelector();
      try {
        bindingFn(JSON.stringify({ action: 'syncPeriodicElements', requestId: reqId }));
      } catch {
        window.__agCsOnPeriodicSyncResult?.({ requestId: reqId, ok: false, error: 'binding_error' });
      }
    });
    const closeBtn = createEl('button', 'ag-cs-ps-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => closePeriodicSelector());
    actions.appendChild(syncBtn);
    actions.appendChild(closeBtn);
    header.appendChild(actions);
    drawer.appendChild(header);

    const body = createEl('div', 'ag-cs-ps-body');

    const searchWrap = createEl('div', 'ag-cs-ps-search-wrap');
    const searchIcon = document.createElement('span');
    searchIcon.className = 'ag-cs-ps-search-icon';
    searchIcon.innerHTML =
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15" aria-hidden="true">' +
      '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4 4" stroke-linecap="round"/></svg>';
    const searchInput = createEl('input', 'ag-cs-ps-search');
    searchInput.type = 'text';
    searchInput.value = psQuery;
    searchInput.setAttribute('placeholder', ui.psSearchPlaceholder || 'Search for a model or agent');
    const clearBtn = createEl('button', 'ag-cs-ps-search-clear', '×');
    clearBtn.type = 'button';
    clearBtn.style.display = psQuery ? '' : 'none';
    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(clearBtn);
    body.appendChild(searchWrap);

    const tabsRow = createEl('div', 'ag-cs-ps-tabs');
    const contentArea = createEl('div', 'ag-cs-ps-content');

    const hasCat = (cat) => grouped.families.some((f) => f.category === cat);
    const tabSpecs = [
      { id: 'periodic', label: '4', isFour: true },
      { id: 'all', label: ui.psTabAll || 'All' },
      { id: 'gemini', label: ui.psTabGemini || 'Gemini' },
    ];
    if (hasCat('orchestrator')) tabSpecs.push({ id: 'orchestrator', label: ui.psTabOrchestrator || 'Orchestrator' });
    if (hasCat('claude')) tabSpecs.push({ id: 'claude', label: ui.psTabClaude || 'Claude' });
    if (hasCat('other')) tabSpecs.push({ id: 'other', label: ui.psTabOther || 'Other' });

    const tabButtons = [];
    const syncTabsActive = () => {
      const searching = Boolean(psQuery.trim());
      for (const { id, el } of tabButtons) {
        const active = searching ? (id === 'all' && psTab === 'periodic') || id === psTab : id === psTab;
        if (active) el.classList.add('is-active');
        else el.classList.remove('is-active');
        el.setAttribute('aria-selected', active ? 'true' : 'false');
      }
    };

    for (const spec of tabSpecs) {
      const tb = createEl('button', `ag-cs-ps-chip${spec.isFour ? ' ag-cs-ps-chip-4' : ''}`);
      tb.type = 'button';
      tb.setAttribute('data-ps-tab', spec.id);
      if (spec.isFour) {
        tb.setAttribute('aria-label', 'Periodic table of Gemini 4');
        tb.appendChild(createEl('span', 'ag-cs-ps-chip-4-glyph', '4'));
      } else {
        tb.textContent = spec.label;
      }
      tb.addEventListener('click', () => {
        psTab = spec.id;
        if (spec.id === 'periodic' && psQuery) {
          psQuery = '';
          searchInput.value = '';
          clearBtn.style.display = 'none';
        }
        syncTabsActive();
        renderPeriodicContentArea(contentArea, grouped, fiberProps, curEffortId, ui);
      });
      tabButtons.push({ id: spec.id, el: tb });
      tabsRow.appendChild(tb);
    }

    searchInput.addEventListener('input', () => {
      psQuery = searchInput.value || '';
      clearBtn.style.display = psQuery ? '' : 'none';
      syncTabsActive();
      renderPeriodicContentArea(contentArea, grouped, fiberProps, curEffortId, ui);
    });
    clearBtn.addEventListener('click', () => {
      psQuery = '';
      searchInput.value = '';
      clearBtn.style.display = 'none';
      syncTabsActive();
      renderPeriodicContentArea(contentArea, grouped, fiberProps, curEffortId, ui);
      if (typeof searchInput.focus === 'function') searchInput.focus();
    });

    syncTabsActive();
    body.appendChild(tabsRow);
    renderPeriodicContentArea(contentArea, grouped, fiberProps, curEffortId, ui);
    body.appendChild(contentArea);
    drawer.appendChild(body);
    drawer._agCsRefreshContent = () => {
      const latestFp = getModelFiberProps(openPsModelBtn);
      const latestGrouped = periodicCore.groupModelOptions(latestFp?.modelOptions || [], latestFp?.selectedModel || null);
      const latestEff = periodicCore.parseOptionEffort(latestFp?.selectedModel?.label).effortId || 'high';
      renderPeriodicContentArea(contentArea, latestGrouped, latestFp, latestEff, uiText(getLang()));
    };
  }

  function openPeriodicSelector(triggerBtn, modelBtn, opts = {}) {
    if (!periodicCore) return;
    const btn = triggerBtn || document.querySelector('.ag-cs-periodic-trigger');
    const mBtn =
      modelBtn ||
      btn?._agCsModelBtn ||
      btn?.closest?.('.surface-composer-card')?.querySelector('[data-testid="model-selector-trigger"]') ||
      document.querySelector('[data-testid="model-selector-trigger"]');

    if (openPsDrawer && openPsDrawer.isConnected && (!btn || openPsTrigger === btn)) {
      if (opts && opts.keepOpen) return;
      closePeriodicSelector();
      return;
    }

    closePeriodicSelector();
    closeEffortPopover();
    closeContextPopover();

    psTab = 'periodic';
    psQuery = '';
    psPinnedSymbol = '';

    const theme = isDarkTheme() ? 'dark' : 'light';
    const backdrop = createEl('div', 'ag-cs-ps-backdrop');
    backdrop.setAttribute('data-ag-no-i18n', '');
    backdrop.setAttribute('data-ps-theme', theme);
    backdrop.addEventListener('click', () => closePeriodicSelector());

    const drawer = createEl('div', 'ag-cs-ps-drawer');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('data-ag-no-i18n', '');
    drawer.setAttribute('data-ps-theme', theme);
    drawer.addEventListener('click', (ev) => ev.stopPropagation());

    openPsBackdrop = backdrop;
    openPsDrawer = drawer;
    openPsTrigger = btn || null;
    openPsModelBtn = mBtn || null;
    if (openPsTrigger) openPsTrigger.setAttribute('aria-expanded', 'true');

    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    renderPeriodicDrawerShell(drawer);
    positionPeriodicPopover(drawer, openPsTrigger || openPsModelBtn);

    if (typeof window.addEventListener === 'function') {
      openPsResizeFn = () => {
        if (openPsDrawer === drawer && drawer.isConnected) {
          positionPeriodicPopover(drawer, openPsTrigger || openPsModelBtn);
        }
      };
      window.addEventListener('resize', openPsResizeFn);
    }

    if (!cachedQuotaData || Date.now() - lastQuotaFetchAt >= 25000) {
      const qp = fetchQuotaData(false);
      if (qp && typeof qp.then === 'function') {
        qp.then((q) => {
          if (!destroyed && q && openPsDrawer === drawer && drawer.isConnected && typeof drawer._agCsRefreshContent === 'function') {
            drawer._agCsRefreshContent();
          }
        });
      }
    }
  }

  // ── Smooth Typing Cursor Gliding Animation (.ag-cs-smooth-caret) ───────
  let caretTypingTimer = null;
  let caretRaf = 0;
  let pendingCaretTyping = false;
  let anySmoothCaretVisible = false;
  const emptyCaretProbeCache = new WeakMap();
  const caretPrevState = new WeakMap();

  function teardownSmoothCarets() {
    if (caretTypingTimer) {
      clearTimeout(caretTypingTimer);
      caretTypingTimer = null;
    }
    if (caretRaf) {
      cancelAnimationFrame(caretRaf);
      caretRaf = 0;
    }
    pendingCaretTyping = false;
    anySmoothCaretVisible = false;
    document.querySelectorAll('.ag-cs-smooth-caret').forEach((n) => n.remove());
    document.querySelectorAll('[data-ag-cs-smooth-caret]').forEach((n) => n.removeAttribute('data-ag-cs-smooth-caret'));
    document.querySelectorAll('[data-ag-cs-caret-host]').forEach((n) => n.removeAttribute('data-ag-cs-caret-host'));
  }

  function measureEditorCaretBox(ed) {
    if (!ed) return null;
    const edRect = ed.getBoundingClientRect();
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(ed) : null;
    const padL = parseFloat(cs?.paddingLeft || '8') || 8;
    const padT = parseFloat(cs?.paddingTop || '8') || 8;
    const fontSize = parseFloat(cs?.fontSize || '14') || 14;
    const lineH = parseFloat(cs?.lineHeight || '22') || fontSize * 1.5 || 22;
    const estGlyphH = Math.max(16, Math.min(24, Math.round(fontSize * 1.28)));
    const defaultH = Math.max(16, Math.min(28, lineH));
    const estEmptyTopOffset = padT + Math.max(0, Math.round((defaultH - estGlyphH) / 2));

    const checkScrollBounds = (box) => {
      if (!box || !box.collapsed) return box;
      if ((ed.scrollHeight || 0) > (ed.clientHeight || 0) + 2 && edRect.height > 0) {
        if (box.top < edRect.top - 4 || box.top + box.height > edRect.bottom + 6) {
          return { collapsed: false };
        }
      }
      return box;
    };

    const cacheEmptyProbe = (boxRect) => {
      if (boxRect && boxRect.height > 0 && boxRect.height < 36 && edRect.height > 0) {
        emptyCaretProbeCache.set(ed, {
          dx: boxRect.left - edRect.left,
          dy: boxRect.top - edRect.top,
          height: boxRect.height,
        });
      }
    };

    if (typeof document.getSelection === 'function') {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0) {
        if (!sel.isCollapsed) return { collapsed: false };
        const range = sel.getRangeAt(0);
        if (ed.contains && ed.contains(range.startContainer)) {
          const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : [];
          const r0 = rects && rects.length > 0 ? rects[rects.length - 1] : typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
          if (r0 && r0.height > 0 && (r0.left > 0 || r0.top > 0)) {
            return checkScrollBounds({ collapsed: true, left: r0.left, top: r0.top, height: r0.height });
          }

          // Measure empty line / <br> at the exact selection container & offset (never ed.querySelector('br'))
          const sc = range.startContainer;
          const so = range.startOffset;
          if (sc?.nodeName === 'BR' && typeof sc.getBoundingClientRect === 'function') {
            const brRect = sc.getBoundingClientRect();
            if (brRect && brRect.height > 0 && (brRect.left > 0 || brRect.top > 0)) {
              if (!ed.textContent) cacheEmptyProbe(brRect);
              return checkScrollBounds({ collapsed: true, left: brRect.left, top: brRect.top, height: brRect.height });
            }
          }
          if (sc && sc.nodeType === 1) {
            const childAt = sc.childNodes?.[so];
            if (childAt?.nodeName === 'BR' && typeof childAt.getBoundingClientRect === 'function') {
              const brRect = childAt.getBoundingClientRect();
              if (brRect && brRect.height > 0 && (brRect.left > 0 || brRect.top > 0)) {
                if (sc.childNodes.length <= 1 && !ed.textContent) cacheEmptyProbe(brRect);
                return checkScrollBounds({ collapsed: true, left: brRect.left, top: brRect.top, height: brRect.height });
              }
            }
            const childPrev = so > 0 ? sc.childNodes?.[so - 1] : null;
            if (childPrev?.nodeName === 'BR' && typeof childPrev.getBoundingClientRect === 'function') {
              const brRect = childPrev.getBoundingClientRect();
              if (brRect && brRect.height > 0 && (brRect.left > 0 || brRect.top > 0)) {
                const isManagedEmptyLine =
                  (typeof childPrev.hasAttribute === 'function' && childPrev.hasAttribute('data-lexical-managed-linebreak')) ||
                  sc.childNodes.length === 1;
                const scRect = typeof sc.getBoundingClientRect === 'function' ? sc.getBoundingClientRect() : null;
                const lineLeft = scRect && scRect.left > 0 ? scRect.left : brRect.left;
                const lineTop = isManagedEmptyLine ? brRect.top : brRect.bottom;
                const box = { collapsed: true, left: lineLeft, top: lineTop, height: brRect.height };
                if (isManagedEmptyLine && sc.childNodes.length <= 1 && !ed.textContent) cacheEmptyProbe(box);
                return checkScrollBounds(box);
              }
            }
            if (typeof sc.getBoundingClientRect === 'function' && sc !== ed) {
              const scRect = sc.getBoundingClientRect();
              if (scRect && (scRect.left > 0 || scRect.top > 0)) {
                return checkScrollBounds({
                  collapsed: true,
                  left: scRect.left,
                  top: scRect.top,
                  height: Math.min(estGlyphH, scRect.height || estGlyphH),
                });
              }
            }
          }
        }
      }
    }

    const cached = emptyCaretProbeCache.get(ed);
    if (cached) {
      return checkScrollBounds({
        collapsed: true,
        left: edRect.left + cached.dx,
        top: edRect.top + cached.dy,
        height: cached.height,
      });
    }

    return checkScrollBounds({
      collapsed: true,
      left: edRect.left + padL,
      top: edRect.top + estEmptyTopOffset,
      height: estGlyphH,
    });
  }

  function syncSmoothCaret(isTypingEvent = false) {
    if (destroyed || cfg.smoothCaret === false) {
      teardownSmoothCarets();
      return;
    }

    const editors = Array.from(document.querySelectorAll('[data-testid="agent-input-box"] [contenteditable="true"]'));
    const activeEl = document.activeElement;
    let visibleCount = 0;

    for (const ed of editors) {
      const host = ed.parentElement;
      if (!host) continue;
      if (host.getAttribute('data-ag-cs-caret-host') !== '1') {
        host.setAttribute('data-ag-cs-caret-host', '1');
      }
      let caret = host.querySelector('.ag-cs-smooth-caret');
      if (!caret) {
        caret = document.createElement('div');
        caret.className = 'ag-cs-smooth-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.setAttribute('data-ag-no-i18n', '');
        host.appendChild(caret);
      }

      const isFocused = activeEl === ed || (activeEl && ed.contains && ed.contains(activeEl));
      if (!isFocused) {
        if (caret.getAttribute('data-ag-cs-caret-visible') !== null) {
          caret.removeAttribute('data-ag-cs-caret-visible');
        }
        if (ed.getAttribute('data-ag-cs-smooth-caret') !== null) {
          ed.removeAttribute('data-ag-cs-smooth-caret');
        }
        continue;
      }

      const measured = measureEditorCaretBox(ed);
      if (!measured || !measured.collapsed) {
        if (caret.getAttribute('data-ag-cs-caret-visible') !== null) {
          caret.removeAttribute('data-ag-cs-caret-visible');
        }
        if (ed.getAttribute('data-ag-cs-smooth-caret') !== null) {
          ed.removeAttribute('data-ag-cs-smooth-caret');
        }
        continue;
      }

      const hostRect = host.getBoundingClientRect();
      const x = Math.round(measured.left - hostRect.left - (host.clientLeft || 0) + (host.scrollLeft || 0));
      const y = Math.round(measured.top - hostRect.top - (host.clientTop || 0) + (host.scrollTop || 0));
      const h = Math.max(15, Math.round(measured.height || 18));
      const wasVisible = caret.getAttribute('data-ag-cs-caret-visible') === '1';
      const cleanText = (ed.textContent || '').replace(/\u200b/g, '');
      const isNowEmpty = cleanText.length === 0 && ed.querySelectorAll('p, div').length <= 1;
      const prev = caretPrevState.get(caret);
      const clearedToEmpty = Boolean(prev && prev.empty === false && isNowEmpty);

      if (!wasVisible || clearedToEmpty) {
        caret.style.transition = 'none';
        caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        caret.style.height = `${h}px`;
        void caret.offsetWidth;
        caret.style.transition = '';
      } else if (!prev || prev.x !== x || prev.y !== y || prev.h !== h) {
        caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        caret.style.height = `${h}px`;
      }
      caretPrevState.set(caret, { x, y, h, empty: isNowEmpty });

      if (caret.getAttribute('data-ag-cs-caret-visible') !== '1') {
        caret.setAttribute('data-ag-cs-caret-visible', '1');
      }
      if (ed.getAttribute('data-ag-cs-smooth-caret') !== '1') {
        ed.setAttribute('data-ag-cs-smooth-caret', '1');
      }
      visibleCount += 1;

      if (isTypingEvent) {
        caret.setAttribute('data-ag-cs-caret-typing', '1');
        if (caretTypingTimer) clearTimeout(caretTypingTimer);
        caretTypingTimer = setTimeout(() => {
          caretTypingTimer = null;
          if (caret.isConnected) caret.removeAttribute('data-ag-cs-caret-typing');
        }, 420);
      } else if (prev && (prev.x !== x || prev.y !== y) && typeof caret.getAnimations === 'function') {
        for (const anim of caret.getAnimations()) {
          if (anim && anim.animationName === 'ag-cs-caret-blink') anim.currentTime = 0;
        }
      }
    }
    anySmoothCaretVisible = visibleCount > 0;
  }

  function queueSmoothCaret(isTyping = false, immediate = false) {
    if (destroyed || cfg.smoothCaret === false) return;
    if (isTyping) pendingCaretTyping = true;
    if (immediate) {
      const typingNow = pendingCaretTyping || isTyping;
      pendingCaretTyping = false;
      syncSmoothCaret(typingNow);
    }
    if (caretRaf) cancelAnimationFrame(caretRaf);
    if (typeof requestAnimationFrame === 'function') {
      caretRaf = requestAnimationFrame(() => {
        caretRaf = 0;
        const typingNow = pendingCaretTyping;
        pendingCaretTyping = false;
        syncSmoothCaret(typingNow);
      });
    }
  }

  // ── Composer Footer Widgets (Placeholder, Effort Tag, Inline Stats, Ring, Crab Clearance) ──
  function setCrabClearanceAttr(el, attrName, active) {
    if (!el) return;
    if (active) {
      if (el.getAttribute(attrName) !== '1') el.setAttribute(attrName, '1');
      if (el.style.getPropertyValue('margin-bottom') !== '46px') {
        el.style.setProperty('margin-bottom', '46px', 'important');
      }
    } else if (el.hasAttribute(attrName)) {
      el.removeAttribute(attrName);
      el.style.removeProperty('margin-bottom');
    }
  }

  function syncCrabClearance(card, inputBox, active) {
    if (!inputBox) return;
    const composerShell = card.closest('#antigravity\\.agentSidePanelInputBox') || card.parentElement;
    let hasLowerClearance = false;

    // 0a. Active running-items-panel directly above composer card inside composerShell
    if (composerShell) {
      for (const ch of Array.from(composerShell.children)) {
        if (ch === card) break;
        const panel =
          ch.getAttribute?.('data-testid') === 'running-items-panel'
            ? ch
            : ch.querySelector?.('[data-testid="running-items-panel"]');
        const isActivePanel = Boolean(panel && String(panel.className || '').includes('grid-rows-[1fr]'));
        const shouldClear = active && isActivePanel && !hasLowerClearance;
        setCrabClearanceAttr(ch, 'data-ag-cs-queued', shouldClear);
        if (shouldClear) hasLowerClearance = true;
      }
    }

    // 0b. Queued-Message ("待发消息 / 排队中的消息") & floating banners inside [data-testid="agent-input-box"]
    const ibChildren = Array.from(inputBox.children);
    const shellIdx = ibChildren.indexOf(composerShell);
    const beforeShell = shellIdx >= 0 ? ibChildren.slice(0, shellIdx) : ibChildren;
    for (let i = beforeShell.length - 1; i >= 0; i--) {
      const ch = beforeShell[i];
      if (ch.classList && (ch.classList.contains('ag-cs-hud-top-bar') || ch.classList.contains('ag-cs-hud-bottom-bar'))) {
        continue;
      }
      const hasQueued = ch.childElementCount > 0 || (ch.textContent || '').trim().length > 0;
      const shouldClear = active && hasQueued && !hasLowerClearance;
      setCrabClearanceAttr(ch, 'data-ag-cs-queued', shouldClear);
      if (shouldClear) hasLowerClearance = true;
    }

    // 0c. Takeover Q&A / Permission Card & Side-Question Panel rendered above agent-input-box
    const inputSlot =
      inputBox.parentElement &&
      inputBox.parentElement.classList &&
      inputBox.parentElement.classList.contains('contents')
        ? inputBox.parentElement
        : inputBox;
    const hostWrap = inputSlot.parentElement;
    if (hostWrap) {
      const siblings = Array.from(hostWrap.children);
      const slotIdx = siblings.indexOf(inputSlot);
      for (let i = slotIdx - 1; i >= 0; i--) {
        const sib = siblings[i];
        const isTakeoverOrSideQ =
          sib.getAttribute?.('data-testid') === 'interaction-takeover-card' ||
          sib.getAttribute?.('data-testid') === 'side-question-panel' ||
          Boolean(sib.querySelector?.('[data-testid="interaction-takeover-card"], [data-testid="side-question-panel"]'));
        if (!isTakeoverOrSideQ) {
          if (sib.hasAttribute?.('data-ag-cs-takeover')) {
            setCrabClearanceAttr(sib, 'data-ag-cs-takeover', false);
          }
          continue;
        }
        const shouldClear = active && !hasLowerClearance;
        setCrabClearanceAttr(sib, 'data-ag-cs-takeover', shouldClear);
        if (shouldClear) hasLowerClearance = true;
      }
    }
  }

  const UM_CAPSULE_ID = 'ag-usage-monitor-capsule';
  const UM_SPLIT_STYLE_ID = 'ag-cs-um-split-css';
  const UM_CTX_PROXY_CLS = 'ag-cs-um-ctx-proxy';

  function cleanupUsageMonitorFooterSplit() {
    const cap = document.getElementById(UM_CAPSULE_ID);
    const sr = cap && cap.shadowRoot;
    if (sr) {
      try {
        const el =
          typeof sr.getElementById === 'function'
            ? sr.getElementById(UM_SPLIT_STYLE_ID)
            : sr.querySelector?.('#' + UM_SPLIT_STYLE_ID);
        if (el) el.remove();
      } catch {}
    }
    document.querySelectorAll('.' + UM_CTX_PROXY_CLS + ', .ag-cs-um-multi-proxy').forEach((el) => el.remove());
  }

  const RIGHT_PANE_TARGETS = {
    studio: {
      sidecarTarget: 'agy-claude-studio/studio/',
      sidecarFallback: 'agy-claude-studio/studio',
      tabId: 'sidecar__agy-claude-studio/studio__/',
      sidecarId: 'agy-claude-studio/studio',
      labelRe: /^Claude Studio$/i,
    },
  };
  let lastPinnedPaneConvoKey = null;
  let lastPinnedPaneTarget = 'off';

  function getEffectivePinRightPane() {
    if (cfg.pinRightPane === 'off' || cfg.pinRightPane === 'usage-monitor') {
      return 'off';
    }
    if (cfg.pinRightPane === 'studio') {
      return 'studio';
    }
    if (typeof cfg.pinUsageMonitorPane === 'boolean') {
      return 'off';
    }
    return 'studio';
  }

  function findSidecarLinkBridge() {
    try {
      const rootEl = document.getElementById('root') || document.body?.firstElementChild;
      if (!rootEl) return null;
      const fk = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
      const start = fk ? rootEl[fk]?.current || rootEl[fk] : null;
      if (!start) return null;
      const queue = [start];
      let visited = 0;
      while (queue.length && visited < 6000) {
        const f = queue.shift();
        visited++;
        const v = f?.memoizedProps?.value;
        if (v && typeof v.onSidecarLinkClick === 'function' && typeof v.resolveSidecarLink === 'function') {
          return v;
        }
        if (f?.child) queue.push(f.child);
        if (f?.sibling) queue.push(f.sibling);
      }
    } catch {}
    return null;
  }

  function findRightSidecarTabButton(strip, spec) {
    if (!strip || !spec) return null;
    for (const btn of strip.querySelectorAll('button')) {
      try {
        const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
        let f = fk ? btn[fk] : null;
        for (let i = 0; i < 6 && f; i++, f = f.return) {
          const tab = f?.memoizedProps?.tab;
          if (tab && (tab.id === spec.tabId || tab.content?.sidecarView?.sidecarId === spec.sidecarId)) {
            return btn;
          }
        }
      } catch {}
      const label = (btn.textContent || '').trim();
      const aria = btn.getAttribute('aria-label') || '';
      if (!aria && spec.labelRe.test(label)) {
        return btn;
      }
    }
    return null;
  }

  function openRightSidecarPane(targetKey, { forceSwitch = true } = {}) {
    const spec = RIGHT_PANE_TARGETS[targetKey];
    if (!spec) return { ok: false, status: 'invalid_target' };

    const auxPane = document.querySelector('[data-aux-pane-open]');
    const strip = document.querySelector('[data-side-panel-strip]');
    const isAuxOpen = auxPane ? auxPane.getAttribute('data-aux-pane-open') === 'true' : Boolean(strip);
    const activeTabId = strip?.getAttribute('data-active-tab-id') || '';

    if (isAuxOpen && activeTabId === spec.tabId) {
      return { ok: true, status: 'already_open' };
    }

    const existingTab = findRightSidecarTabButton(strip, spec);
    if (existingTab) {
      if (!isAuxOpen) {
        const toggleBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
        if (toggleBtn && typeof toggleBtn.click === 'function') toggleBtn.click();
      }
      if (forceSwitch && activeTabId !== spec.tabId) {
        existingTab.click();
      }
      return { ok: true, status: 'switched' };
    }

    const bridge = findSidecarLinkBridge();
    if (bridge) {
      let resolved = null;
      try {
        resolved = bridge.resolveSidecarLink(spec.sidecarTarget) || bridge.resolveSidecarLink(spec.sidecarFallback);
      } catch {}
      if (resolved) {
        try {
          bridge.onSidecarLinkClick(spec.sidecarTarget);
          return { ok: true, status: 'opened' };
        } catch {}
      }
    }
    return { ok: false, status: 'not_found' };
  }

  function openStudioPane(opts = {}) {
    const found = getEffectivePinRightPane() === 'studio' && pinnedDock.el && pinnedDock.el.isConnected ? findLiveStudioSlot() : null;
    if (found) {
      if (pinnedDock.auxMaximized) {
        const maxBtn = document.querySelector('[data-testid="toggle-maximize-pane"]');
        if (maxBtn && typeof maxBtn.click === 'function') {
          try { maxBtn.click(); } catch {}
        }
      }
      if (pinnedDock.collapsed) {
        setPinnedDockCollapsed(false);
        return { ok: true, status: 'dock_expanded' };
      }
      syncPinnedStudioDockPosition(found);
      return { ok: true, status: 'already_docked' };
    }
    return openRightSidecarPane('studio', opts);
  }

  function syncPinRightPane(convoKey) {
    const target = getEffectivePinRightPane();
    if (target === 'off') {
      lastPinnedPaneTarget = 'off';
      lastPinnedPaneConvoKey = null;
      return;
    }
    const key = String(convoKey || '');
    if (!key) return;
    if (lastPinnedPaneTarget === target && lastPinnedPaneConvoKey === key) return;
    if (target === 'studio' && findLiveStudioSlot()) {
      lastPinnedPaneTarget = target;
      lastPinnedPaneConvoKey = key;
      return;
    }
    const res = openRightSidecarPane(target, { forceSwitch: true });
    if (res.ok) {
      lastPinnedPaneTarget = target;
      lastPinnedPaneConvoKey = key;
    }
  }

  // ── Persistent 3-Column Claude Studio Dock ────────────────────────────────
  const DOCK_WIDTH_KEY = 'agCsPinnedDockWidth';
  const DOCK_COLLAPSED_KEY = 'agCsPinnedDockCollapsed';
  const DOCK_DEFAULT_WIDTH = 310;
  const DOCK_MIN_WIDTH = 250;
  const DOCK_MAX_WIDTH = 480;
  const DOCK_MIN_SPLIT_WIDTH = 900;
  const DOCK_MIN_SOLO_SPLIT_WIDTH = 560;
  const DOCK_COLLAPSED_WIDTH = 28;

  const pinnedDock = {
    el: null,
    headEl: null,
    badgeEl: null,
    collapseBtn: null,
    expandBtn: null,
    expandLabelEl: null,
    toolbarBtn: null,
    bodyEl: null,
    resizerEl: null,
    splitEl: null,
    slotEl: null,
    hiddenSlotEl: null,
    overlayEl: null,
    resizeObserver: null,
    posRaf: 0,
    trackRaf: 0,
    trackUntil: 0,
    splitTransitionStart: null,
    splitTransitionEnd: null,
    width: DOCK_DEFAULT_WIDTH,
    collapsed: false,
    toolbarCollapsed: false,
    soloMode: false,
    auxMaximized: false,
    lastNonStudioTabId: '',
    prevActiveTabId: '',
    prevAuxOpen: false,
    bounceAt: 0,
    userToggledAuxAt: 0,
    internalToggleClick: false,
    auxCloseAttempted: false,
    userForcedAuxOpen: false,
    toggleClickListener: null,
    toggleKeyListener: null,
    dragging: false,
    dragMove: null,
    dragUp: null,
    dispatchingHostResize: false,
    lastLang: '',
  };

  try {
    const savedW = Number(localStorage.getItem(DOCK_WIDTH_KEY));
    if (Number.isFinite(savedW) && savedW >= DOCK_MIN_WIDTH && savedW <= DOCK_MAX_WIDTH) {
      pinnedDock.width = Math.round(savedW);
    }
    pinnedDock.collapsed = localStorage.getItem(DOCK_COLLAPSED_KEY) === '1';
  } catch {}

  function getDockCopy(lang) {
    if (lang === 'en') {
      return { badge: 'Pinned', collapseTitle: 'Collapse pinned Claude Studio', expandTitle: 'Expand pinned Claude Studio', railLabel: 'Studio' };
    }
    if (lang === 'ja') {
      return { badge: '常駐', collapseTitle: '常駐 Claude Studio を折りたたむ', expandTitle: '常駐 Claude Studio を展開', railLabel: 'Studio' };
    }
    if (lang === 'zh-TW') {
      return { badge: '常駐', collapseTitle: '收合常駐 Claude Studio', expandTitle: '展開常駐 Claude Studio', railLabel: 'Studio' };
    }
    if (lang === 'yue') {
      return { badge: '長駐', collapseTitle: '收埋長駐 Claude Studio', expandTitle: '展開長駐 Claude Studio', railLabel: 'Studio' };
    }
    return { badge: '常驻', collapseTitle: '收起常驻 Claude Studio', expandTitle: '展开常驻 Claude Studio', railLabel: 'Studio' };
  }

  function clampPinnedDockWidth(rawWidth, splitWidth, soloMode = false) {
    const reservedOther = soloMode ? 340 : 340 + 308;
    const maxAllowed = Number.isFinite(splitWidth) && splitWidth > 0
      ? Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.floor(splitWidth - reservedOther)))
      : DOCK_MAX_WIDTH;
    return Math.max(DOCK_MIN_WIDTH, Math.min(maxAllowed, Math.round(rawWidth || DOCK_DEFAULT_WIDTH)));
  }

  function measureSoloHeadRightPadding() {
    const toggleBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
    if (!toggleBtn) return 44;
    let cluster = toggleBtn.parentElement;
    if (cluster && cluster.parentElement && /\babsolute\b/.test(String(cluster.parentElement.className || ''))) {
      cluster = cluster.parentElement;
    }
    const r = typeof cluster?.getBoundingClientRect === 'function' ? cluster.getBoundingClientRect() : null;
    if (r && r.width > 0) {
      return Math.max(40, Math.min(112, Math.ceil(r.width) + 8));
    }
    const hasMaximize = Boolean(document.querySelector('[data-testid="toggle-maximize-pane"]'));
    return hasMaximize ? 76 : 44;
  }

  function findNonStudioTabButton(strip, preferredTabId) {
    if (!strip) return null;
    const spec = RIGHT_PANE_TARGETS.studio;
    let firstMatch = null;
    for (const btn of strip.querySelectorAll('button')) {
      if (btn.getAttribute('data-testid') === 'side-panel-new-tab-button') continue;
      let tabId = btn.getAttribute('data-tab-id') || '';
      let sidecarId = '';
      if (!tabId) {
        try {
          const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
          let f = fk ? btn[fk] : null;
          for (let i = 0; i < 6 && f; i++, f = f.return) {
            const tab = f?.memoizedProps?.tab;
            if (tab && tab.id) {
              tabId = String(tab.id);
              sidecarId = String(tab.content?.sidecarView?.sidecarId || '');
              break;
            }
          }
        } catch {}
      }
      if (!tabId) continue;
      if (tabId === spec.tabId || sidecarId === spec.sidecarId) continue;
      const label = (btn.textContent || '').trim();
      if (!btn.getAttribute('aria-label') && spec.labelRe.test(label)) continue;
      if (preferredTabId && tabId === preferredTabId) return btn;
      if (!firstMatch) firstMatch = btn;
    }
    return firstMatch;
  }

  const boundConvoSyncIframes = new Set();

  function detachConvoSyncIframe(iframe) {
    if (!iframe) return;
    if (iframe._agCsConvoSyncLoadHandler && typeof iframe.removeEventListener === 'function') {
      try {
        iframe.removeEventListener('load', iframe._agCsConvoSyncLoadHandler);
      } catch {}
    }
    delete iframe._agCsConvoSyncLoadHandler;
    delete iframe._agCsConvoSyncLoadBound;
    delete iframe._agCsPostedCid;
    delete iframe._agCsPostedState;
    boundConvoSyncIframes.delete(iframe);
  }

  function detachAllConvoSyncIframes() {
    for (const iframe of Array.from(boundConvoSyncIframes)) {
      detachConvoSyncIframe(iframe);
    }
    boundConvoSyncIframes.clear();
  }

  function releaseDockedStudioSlot({ keepHidden = false } = {}) {
    if (pinnedDock.iframeEl) {
      detachConvoSyncIframe(pinnedDock.iframeEl);
      pinnedDock.iframeEl = null;
    }
    if (pinnedDock.slotEl) {
      try {
        pinnedDock.slotEl.removeAttribute('data-ag-cs-docked-slot');
        if (!keepHidden) pinnedDock.slotEl.removeAttribute('data-ag-cs-dock-hidden');
      } catch {}
      pinnedDock.slotEl = null;
    }
    if (!keepHidden && pinnedDock.hiddenSlotEl) {
      try {
        pinnedDock.hiddenSlotEl.removeAttribute('data-ag-cs-dock-hidden');
      } catch {}
      pinnedDock.hiddenSlotEl = null;
    }
    if (pinnedDock.overlayEl) {
      try {
        pinnedDock.overlayEl.style?.removeProperty?.('--ag-cs-dock-slot-left');
        pinnedDock.overlayEl.style?.removeProperty?.('--ag-cs-dock-slot-top');
        pinnedDock.overlayEl.style?.removeProperty?.('--ag-cs-dock-slot-width');
        pinnedDock.overlayEl.style?.removeProperty?.('--ag-cs-dock-slot-height');
      } catch {}
      pinnedDock.overlayEl = null;
    }
  }

  function hideStudioSlotWhileCollapsed(preFound = null) {
    const found = preFound || findLiveStudioSlot();
    if (pinnedDock.hiddenSlotEl && pinnedDock.hiddenSlotEl !== found?.slot) {
      try {
        pinnedDock.hiddenSlotEl.removeAttribute('data-ag-cs-dock-hidden');
      } catch {}
      pinnedDock.hiddenSlotEl = null;
    }
    if (found?.slot) {
      try {
        if (found.slot.getAttribute('data-ag-cs-dock-hidden') !== '1') {
          found.slot.setAttribute('data-ag-cs-dock-hidden', '1');
        }
      } catch {}
      pinnedDock.hiddenSlotEl = found.slot;
    }
  }

  function stopDockDrag() {
    if (!pinnedDock.dragging) return;
    pinnedDock.dragging = false;
    document.documentElement?.removeAttribute('data-ag-cs-dock-dragging');
    if (pinnedDock.dragMove) {
      window.removeEventListener?.('pointermove', pinnedDock.dragMove, true);
      pinnedDock.dragMove = null;
    }
    if (pinnedDock.dragUp) {
      window.removeEventListener?.('pointerup', pinnedDock.dragUp, true);
      window.removeEventListener?.('pointercancel', pinnedDock.dragUp, true);
      pinnedDock.dragUp = null;
    }
  }

  function stopDockTracking() {
    if (pinnedDock.posRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pinnedDock.posRaf);
      pinnedDock.posRaf = 0;
    }
    if (pinnedDock.trackRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pinnedDock.trackRaf);
      pinnedDock.trackRaf = 0;
    }
    pinnedDock.trackUntil = 0;
  }

  function detachDockSplitListeners() {
    if (pinnedDock.resizeObserver) {
      try {
        pinnedDock.resizeObserver.disconnect();
      } catch {}
      pinnedDock.resizeObserver = null;
    }
    if (pinnedDock.splitEl) {
      if (pinnedDock.splitTransitionStart) {
        pinnedDock.splitEl.removeEventListener?.('transitionstart', pinnedDock.splitTransitionStart, true);
      }
      if (pinnedDock.splitTransitionEnd) {
        pinnedDock.splitEl.removeEventListener?.('transitionend', pinnedDock.splitTransitionEnd, true);
      }
      try {
        pinnedDock.splitEl.removeAttribute('data-ag-cs-dock-open');
        pinnedDock.splitEl.removeAttribute('data-ag-cs-dock-solo');
        pinnedDock.splitEl.removeAttribute('data-ag-cs-dock-aux-max');
        pinnedDock.splitEl.style?.removeProperty?.('--ag-cs-dock-w');
        pinnedDock.splitEl.style?.removeProperty?.('--ag-cs-dock-solo-pr');
      } catch {}
      pinnedDock.splitEl = null;
    }
    pinnedDock.splitTransitionStart = null;
    pinnedDock.splitTransitionEnd = null;
  }

  function ensureDockToggleListeners() {
    if (!pinnedDock.toggleClickListener && typeof document.addEventListener === 'function') {
      pinnedDock.toggleClickListener = (ev) => {
        if (pinnedDock.internalToggleClick) return;
        const target = ev?.target;
        const toggleBtn = typeof target?.closest === 'function' ? target.closest('[data-testid="toggle-aux-sidebar"]') : null;
        if (toggleBtn) {
          const curAux = document.querySelector('[data-aux-pane-open]');
          const wasOpen = curAux ? curAux.getAttribute('data-aux-pane-open') === 'true' : false;
          pinnedDock.userToggledAuxAt = wasOpen ? 0 : Date.now();
          pinnedDock.auxCloseAttempted = false;
        }
      };
      document.addEventListener('click', pinnedDock.toggleClickListener, true);
    }
    if (!pinnedDock.toggleKeyListener && typeof document.addEventListener === 'function') {
      pinnedDock.toggleKeyListener = (ev) => {
        if ((ev?.ctrlKey || ev?.metaKey) && ev?.shiftKey && String(ev?.key || '').toLowerCase() === 'b') {
          const curAux = document.querySelector('[data-aux-pane-open]');
          const wasOpen = curAux ? curAux.getAttribute('data-aux-pane-open') === 'true' : false;
          pinnedDock.userToggledAuxAt = wasOpen ? 0 : Date.now();
          pinnedDock.auxCloseAttempted = false;
        }
      };
      document.addEventListener('keydown', pinnedDock.toggleKeyListener, true);
    }
  }

  function detachDockToggleListeners() {
    if (pinnedDock.toggleClickListener && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', pinnedDock.toggleClickListener, true);
      pinnedDock.toggleClickListener = null;
    }
    if (pinnedDock.toggleKeyListener && typeof document.removeEventListener === 'function') {
      document.removeEventListener('keydown', pinnedDock.toggleKeyListener, true);
      pinnedDock.toggleKeyListener = null;
    }
  }

  function teardownPinnedStudioDock() {
    stopDockDrag();
    stopDockTracking();
    releaseDockedStudioSlot();
    detachDockSplitListeners();
    detachDockToggleListeners();
    pinnedDock.soloMode = false;
    pinnedDock.auxMaximized = false;
    pinnedDock.toolbarCollapsed = false;
    pinnedDock.auxCloseAttempted = false;
    pinnedDock.userForcedAuxOpen = false;
    pinnedDock.pendingHostAction = null;
    if (pinnedDock.toolbarBtn) {
      try {
        pinnedDock.toolbarBtn.remove();
      } catch {}
    }
    if (pinnedDock.el) {
      try {
        pinnedDock.el.remove();
      } catch {}
    }
  }

  function setStylePropIfChanged(styleObj, prop, val) {
    if (!styleObj || typeof styleObj.setProperty !== 'function') return false;
    if (typeof styleObj.getPropertyValue === 'function' && styleObj.getPropertyValue(prop) === val) {
      return false;
    }
    styleObj.setProperty(prop, val);
    return true;
  }

  function extractConversationIdFromUrl(rawUrl) {
    const s = String(rawUrl || '').trim();
    if (!s) return '';
    try {
      const parsed = new URL(s);
      const q = parsed.searchParams.get('conversationId') || '';
      if (q) return normalizeCascadeId(q) || q.trim();
    } catch {
      const m = s.match(/[?&]conversationId=([^&#]+)/i);
      if (m && m[1]) {
        try {
          const dec = decodeURIComponent(m[1]);
          return normalizeCascadeId(dec) || dec.trim();
        } catch {}
      }
    }
    return '';
  }

  function getActiveConversationIdFast() {
    try {
      const cv = findVisibleConversationView();
      if (cv) {
        const attrId = normalizeCascadeId(cv.getAttribute?.('data-cascade-id'));
        if (attrId) return attrId;
        const box = cv.querySelector?.('[data-testid="agent-input-box"]');
        const boxId = box ? resolveCascadeId(box, { viewScopedOnly: true }) : '';
        if (boxId) return boxId;
        return '';
      }
    } catch {}
    try {
      const m = String(location?.pathname || '').match(/\/c\/([0-9a-f-]{8,})/i);
      if (m && m[1]) return normalizeCascadeId(m[1]) || m[1];
    } catch {}
    return resolveActiveConversationIdForHost('', findHostReduxStore());
  }

  function resolveStudioIframeTargetOrigin(iframe, slot) {
    const sidecarId = slot?.getAttribute?.('data-sidecar-id') || '';
    if (sidecarId && sidecarId !== 'agy-claude-studio/studio') return null;
    const iframeUrl = iframe?.getAttribute?.('src') || iframe?.src || '';
    const slotUrl = slot?.getAttribute?.('data-sidecar-url') || '';
    const rawUrl = iframeUrl || slotUrl;
    if (!rawUrl) return null;
    try {
      const parsed = new URL(rawUrl);
      if (iframeUrl && slotUrl) {
        const parsedSlot = new URL(slotUrl);
        if (parsed.protocol !== parsedSlot.protocol) return null;
        if (parsed.origin && parsed.origin !== 'null' && parsedSlot.origin && parsedSlot.origin !== 'null' && parsed.origin !== parsedSlot.origin) {
          return null;
        }
        if (parsed.protocol === 'plugin:' && parsed.hostname !== parsedSlot.hostname) {
          return null;
        }
      }
      const isHttp = /^https?:$/i.test(parsed.protocol);
      const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === '::1';
      const hostMatches = /^agy-claude-studio--studio(?:$|-)/i.test(parsed.hostname || '');
      const pathMatches = /^\/agy-claude-studio--studio(?:\/|$)/i.test(parsed.pathname || '');
      if (isHttp && parsed.origin && parsed.origin !== 'null') {
        if (hostMatches || (isLoopback && (sidecarId === 'agy-claude-studio/studio' || pathMatches))) {
          return parsed.origin;
        }
        return null;
      }
      if (parsed.protocol === 'plugin:' && hostMatches) {
        return '*';
      }
    } catch {}
    return null;
  }

  function syncDockedIframeConversation(iframe, activeCid) {
    if (!iframe) return;
    try {
      const slot = typeof iframe.closest === 'function' ? iframe.closest('[data-testid="sidecar-iframe-slot"]') : null;
      if (!slot) return;
      if (slot.hasAttribute?.('data-sidecar-id') && slot.getAttribute('data-sidecar-id') !== 'agy-claude-studio/studio') {
        return;
      }
      const targetOrigin = resolveStudioIframeTargetOrigin(iframe, slot);
      if (!targetOrigin) return;
      const win = iframe.contentWindow;
      if (!win || typeof win.postMessage !== 'function') return;
      if (!iframe._agCsConvoSyncLoadBound && typeof iframe.addEventListener === 'function') {
        const onLoad = () => {
          if (destroyed || !iframe.isConnected || pinnedDock.iframeEl !== iframe) return;
          iframe._agCsPostedCid = '';
          iframe._agCsPostedState = '';
          const liveCid = getActiveConversationIdFast();
          syncDockedIframeConversation(iframe, liveCid || '');
        };
        iframe._agCsConvoSyncLoadBound = true;
        iframe._agCsConvoSyncLoadHandler = onLoad;
        boundConvoSyncIframes.add(iframe);
        iframe.addEventListener('load', onLoad);
      }
      const nextCid = activeCid ? (normalizeCascadeId(activeCid) || String(activeCid).trim()) : '';
      const stateKey = nextCid ? `cid:${nextCid}` : 'unbound';
      if (iframe._agCsPostedState === stateKey) return;
      iframe._agCsPostedState = stateKey;
      iframe._agCsPostedCid = nextCid;
      const payload = nextCid
        ? { type: 'ag-cs:active-conversation', conversationId: nextCid }
        : { type: 'ag-cs:active-conversation', conversationId: '', unbound: true };
      win.postMessage(payload, targetOrigin);
    } catch {}
  }

  function findLiveStudioSlot() {
    const iframes = Array.from(document.querySelectorAll('iframe[src*="agy-claude-studio--studio"]'));
    if (!iframes.length) return null;
    const candidates = [];
    for (const iframe of iframes) {
      const slot = typeof iframe.closest === 'function' ? iframe.closest('[data-testid="sidecar-iframe-slot"]') : null;
      const overlay = slot?.parentElement || null;
      if (!slot || !overlay) continue;
      const url = iframe.getAttribute?.('src') || iframe.src || slot.getAttribute?.('data-sidecar-url') || '';
      const slotCid = extractConversationIdFromUrl(url);
      const isVisible = slot.getAttribute?.('data-visible') === 'true';
      candidates.push({ iframe, slot, overlay, slotCid, isVisible });
    }
    if (!candidates.length) return null;
    const activeCid = getActiveConversationIdFast();
    let chosen = null;
    let matched = false;
    if (activeCid) {
      const exact = candidates.filter((c) => c.slotCid && sameCascadeId(c.slotCid, activeCid));
      if (exact.length > 0) {
        chosen = exact.find((c) => c.isVisible) || exact[exact.length - 1];
        matched = true;
      }
    }
    if (!chosen) {
      chosen =
        candidates.find((c) => c.isVisible) ||
        candidates.find((c) => !c.slotCid) ||
        candidates[candidates.length - 1];
    }
    return { ...chosen, activeCid, matched };
  }

  function isAuxPaneMaximized(split) {
    if (!split) return false;
    const trans = split.getAttribute?.('data-split-transition') || '';
    if (trans === 'maximizing' || trans === 'restoring') return true;
    const children = Array.from(split.children || []);
    for (const ch of children) {
      if (ch && ch.getAttribute?.('data-split-overlaid') === 'true') return true;
    }
    return false;
  }

  function notifyHostAuxReposition() {
    if (destroyed || pinnedDock.dispatchingHostResize) return;
    if (typeof window.dispatchEvent !== 'function') return;
    pinnedDock.dispatchingHostResize = true;
    try {
      const ev = typeof Event === 'function' ? new Event('resize') : { type: 'resize' };
      window.dispatchEvent(ev);
    } catch {} finally {
      pinnedDock.dispatchingHostResize = false;
    }
  }

  function syncPinnedStudioDockPosition(preFound = null) {
    if (destroyed || !pinnedDock.el || !pinnedDock.el.isConnected) return;
    if (pinnedDock.splitEl?.style) {
      setStylePropIfChanged(pinnedDock.splitEl.style, '--ag-cs-dock-solo-pr', `${measureSoloHeadRightPadding()}px`);
    }
    if (pinnedDock.collapsed || pinnedDock.auxMaximized || isAuxPaneMaximized(pinnedDock.splitEl)) {
      releaseDockedStudioSlot({ keepHidden: true });
      hideStudioSlotWhileCollapsed(preFound);
      return;
    }
    const found = preFound || findLiveStudioSlot();
    if (!found) {
      releaseDockedStudioSlot();
      return;
    }
    if (pinnedDock.slotEl && pinnedDock.slotEl !== found.slot) {
      releaseDockedStudioSlot();
    }
    if (pinnedDock.iframeEl && pinnedDock.iframeEl !== found.iframe) {
      detachConvoSyncIframe(pinnedDock.iframeEl);
    }
    if (pinnedDock.hiddenSlotEl && pinnedDock.hiddenSlotEl !== found.slot) {
      try {
        pinnedDock.hiddenSlotEl.removeAttribute('data-ag-cs-dock-hidden');
      } catch {}
      pinnedDock.hiddenSlotEl = null;
    }
    const bodyRect = typeof pinnedDock.bodyEl?.getBoundingClientRect === 'function'
      ? pinnedDock.bodyEl.getBoundingClientRect()
      : null;
    const overlayRect = typeof found.overlay.getBoundingClientRect === 'function'
      ? found.overlay.getBoundingClientRect()
      : null;
    if (!bodyRect || !overlayRect || bodyRect.width < 40 || bodyRect.height < 40) {
      releaseDockedStudioSlot();
      return;
    }
    const left = Math.round(bodyRect.left - overlayRect.left);
    const top = Math.round(bodyRect.top - overlayRect.top);
    const width = Math.round(bodyRect.width);
    const height = Math.round(bodyRect.height);
    if (found.overlay.style?.setProperty) {
      setStylePropIfChanged(found.overlay.style, '--ag-cs-dock-slot-left', `${left}px`);
      setStylePropIfChanged(found.overlay.style, '--ag-cs-dock-slot-top', `${top}px`);
      setStylePropIfChanged(found.overlay.style, '--ag-cs-dock-slot-width', `${width}px`);
      setStylePropIfChanged(found.overlay.style, '--ag-cs-dock-slot-height', `${height}px`);
    }
    if (found.slot.hasAttribute('data-ag-cs-dock-hidden')) {
      found.slot.removeAttribute('data-ag-cs-dock-hidden');
    }
    pinnedDock.hiddenSlotEl = null;
    if (found.slot.getAttribute('data-ag-cs-docked-slot') !== '1') {
      found.slot.setAttribute('data-ag-cs-docked-slot', '1');
    }
    pinnedDock.slotEl = found.slot;
    pinnedDock.iframeEl = found.iframe;
    pinnedDock.overlayEl = found.overlay;
    syncDockedIframeConversation(found.iframe, found.activeCid || '');
  }

  function scheduleDockPositionSync() {
    if (destroyed || pinnedDock.posRaf) return;
    if (typeof requestAnimationFrame === 'function') {
      pinnedDock.posRaf = requestAnimationFrame(() => {
        pinnedDock.posRaf = 0;
        syncPinnedStudioDockPosition();
      });
    } else {
      syncPinnedStudioDockPosition();
    }
  }

  function trackDockTransition(durationMs = 620) {
    if (destroyed || typeof requestAnimationFrame !== 'function') {
      syncPinnedStudioDockPosition();
      if (!pinnedDock.soloMode && !pinnedDock.auxMaximized) notifyHostAuxReposition();
      return;
    }
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    pinnedDock.trackUntil = Math.max(pinnedDock.trackUntil, now + durationMs);
    if (pinnedDock.trackRaf) return;
    const tick = () => {
      pinnedDock.trackRaf = 0;
      if (destroyed || !pinnedDock.el || !pinnedDock.el.isConnected) return;
      syncPinnedStudioDockPosition();
      if (!pinnedDock.soloMode && !pinnedDock.auxMaximized) notifyHostAuxReposition();
      const t = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      if (t < pinnedDock.trackUntil) {
        pinnedDock.trackRaf = requestAnimationFrame(tick);
      }
    };
    pinnedDock.trackRaf = requestAnimationFrame(tick);
  }

  function ensureDockToolbarButton() {
    if (pinnedDock.toolbarBtn) return pinnedDock.toolbarBtn;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ag-cs-dock-toolbar-btn';
    btn.setAttribute('data-ag-no-i18n', '1');
    btn.setAttribute('data-testid', 'ag-cs-dock-expand-btn');
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5 14.35 9.65 21.5 12l-7.15 2.35L12 21.5l-2.35-7.15L2.5 12l7.15-2.35Z"/></svg>';
    const copy = getDockCopy(getLang());
    btn.setAttribute('title', copy.expandTitle);
    btn.setAttribute('aria-label', copy.expandTitle);
    btn.addEventListener?.('click', (ev) => {
      ev.stopPropagation?.();
      setPinnedDockCollapsed(false);
    });
    pinnedDock.toolbarBtn = btn;
    return btn;
  }

  function findDockTitlebarToolbar(split) {
    if (!split) return null;
    const root = split.firstElementChild && !split.firstElementChild.classList?.contains?.('ag-cs-pinned-dock')
      ? split.firstElementChild
      : split;
    const list = typeof root.querySelectorAll === 'function'
      ? Array.from(root.querySelectorAll('[data-testid="pane-titlebar-toolbar"]'))
      : [];
    if (!list.length) return null;
    for (const tb of list) {
      const r = typeof tb.getBoundingClientRect === 'function' ? tb.getBoundingClientRect() : null;
      if (!r || (r.width > 0 && r.height > 0)) return tb;
    }
    return list[0];
  }

  function syncDockToolbarButton(split) {
    if (!split || !pinnedDock.collapsed) {
      if (pinnedDock.toolbarBtn && pinnedDock.toolbarBtn.parentElement) {
        try {
          pinnedDock.toolbarBtn.remove();
        } catch {}
      }
      return false;
    }
    const toolbar = findDockTitlebarToolbar(split);
    if (!toolbar) {
      if (pinnedDock.toolbarBtn && pinnedDock.toolbarBtn.parentElement) {
        try {
          pinnedDock.toolbarBtn.remove();
        } catch {}
      }
      return false;
    }
    const btn = ensureDockToolbarButton();
    const kids = Array.from(toolbar.children || []).filter((ch) => ch !== btn);
    let refNode = null;
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const ch = kids[i];
      if (!ch.classList?.contains?.('wm-capsule-host')) {
        refNode = ch;
        break;
      }
    }
    if (refNode && typeof toolbar.insertBefore === 'function') {
      if (btn.parentElement !== toolbar || btn.nextElementSibling !== refNode) {
        toolbar.insertBefore(btn, refNode);
      }
    } else if (btn.parentElement !== toolbar) {
      toolbar.appendChild(btn);
    }
    return true;
  }

  function applyPinnedDockStateToDom(opts = {}) {
    if (!pinnedDock.el || !pinnedDock.splitEl) return;
    const splitRect = typeof pinnedDock.splitEl.getBoundingClientRect === 'function'
      ? pinnedDock.splitEl.getBoundingClientRect()
      : null;
    const splitW = splitRect?.width || 0;
    const useToolbarCollapsed = syncDockToolbarButton(pinnedDock.splitEl);
    pinnedDock.toolbarCollapsed = Boolean(pinnedDock.collapsed && useToolbarCollapsed);
    const activeWidth = pinnedDock.collapsed
      ? (useToolbarCollapsed ? 0 : DOCK_COLLAPSED_WIDTH)
      : clampPinnedDockWidth(pinnedDock.width, splitW, pinnedDock.soloMode);

    const wasOpen = pinnedDock.splitEl.getAttribute?.('data-ag-cs-dock-open') === '1';
    const wasSolo = pinnedDock.splitEl.getAttribute?.('data-ag-cs-dock-solo') === '1';
    const wasAuxMax = pinnedDock.splitEl.getAttribute?.('data-ag-cs-dock-aux-max') === '1';
    const wasCollapsed = Boolean(pinnedDock.el.classList?.contains?.('is-collapsed'));
    const wasToolbarCollapsed = Boolean(pinnedDock.el.classList?.contains?.('is-toolbar-collapsed'));
    const prevDockW = pinnedDock.splitEl.style?.getPropertyValue?.('--ag-cs-dock-w') || '';
    const nextDockW = `${activeWidth}px`;

    if (wasCollapsed !== Boolean(pinnedDock.collapsed)) {
      pinnedDock.el.classList?.toggle?.('is-collapsed', pinnedDock.collapsed);
    }
    if (wasToolbarCollapsed !== pinnedDock.toolbarCollapsed) {
      pinnedDock.el.classList?.toggle?.('is-toolbar-collapsed', pinnedDock.toolbarCollapsed);
    }
    if (!wasOpen) {
      pinnedDock.splitEl.setAttribute('data-ag-cs-dock-open', '1');
    }
    if (pinnedDock.auxMaximized) {
      stopDockDrag();
      if (!wasAuxMax) pinnedDock.splitEl.setAttribute('data-ag-cs-dock-aux-max', '1');
    } else if (wasAuxMax) {
      pinnedDock.splitEl.removeAttribute('data-ag-cs-dock-aux-max');
    }
    if (pinnedDock.soloMode) {
      if (!wasSolo) pinnedDock.splitEl.setAttribute('data-ag-cs-dock-solo', '1');
    } else if (wasSolo) {
      pinnedDock.splitEl.removeAttribute('data-ag-cs-dock-solo');
    }
    setStylePropIfChanged(pinnedDock.splitEl.style, '--ag-cs-dock-solo-pr', `${measureSoloHeadRightPadding()}px`);
    const widthChanged = setStylePropIfChanged(pinnedDock.splitEl.style, '--ag-cs-dock-w', nextDockW) || prevDockW !== nextDockW;
    const stateChanged =
      Boolean(opts.forceTrack) ||
      !wasOpen ||
      wasSolo !== Boolean(pinnedDock.soloMode) ||
      wasAuxMax !== Boolean(pinnedDock.auxMaximized) ||
      wasCollapsed !== Boolean(pinnedDock.collapsed) ||
      widthChanged;

    const lang = getLang();
    if (pinnedDock.lastLang !== lang) {
      pinnedDock.lastLang = lang;
      const copy = getDockCopy(lang);
      if (pinnedDock.badgeEl) {
        pinnedDock.badgeEl.setAttribute('title', copy.badge);
        pinnedDock.badgeEl.setAttribute('aria-label', copy.badge);
      }
      if (pinnedDock.collapseBtn) {
        pinnedDock.collapseBtn.setAttribute('title', copy.collapseTitle);
        pinnedDock.collapseBtn.setAttribute('aria-label', copy.collapseTitle);
      }
      if (pinnedDock.expandBtn) {
        pinnedDock.expandBtn.setAttribute('title', copy.expandTitle);
        pinnedDock.expandBtn.setAttribute('aria-label', copy.expandTitle);
      }
      if (pinnedDock.toolbarBtn) {
        pinnedDock.toolbarBtn.setAttribute('title', copy.expandTitle);
        pinnedDock.toolbarBtn.setAttribute('aria-label', copy.expandTitle);
      }
      if (pinnedDock.expandLabelEl) pinnedDock.expandLabelEl.textContent = copy.railLabel;
    }

    if (pinnedDock.collapsed || pinnedDock.auxMaximized) {
      releaseDockedStudioSlot({ keepHidden: true });
      hideStudioSlotWhileCollapsed(opts.preFound || null);
      if (stateChanged && !pinnedDock.soloMode && !pinnedDock.auxMaximized) {
        notifyHostAuxReposition();
        trackDockTransition(240);
      }
    } else {
      syncPinnedStudioDockPosition(opts.preFound || null);
      if (stateChanged) {
        if (!pinnedDock.soloMode && !pinnedDock.auxMaximized) notifyHostAuxReposition();
        trackDockTransition(240);
      }
    }
  }

  function setPinnedDockCollapsed(nextCollapsed) {
    pinnedDock.collapsed = Boolean(nextCollapsed);
    try {
      localStorage.setItem(DOCK_COLLAPSED_KEY, pinnedDock.collapsed ? '1' : '0');
    } catch {}
    applyPinnedDockStateToDom();
  }

  function ensurePinnedDockElement() {
    if (pinnedDock.el) return pinnedDock.el;
    const dock = document.createElement('div');
    dock.className = 'ag-cs-pinned-dock';
    dock.setAttribute('data-ag-no-i18n', '1');
    dock.setAttribute('data-testid', 'ag-cs-pinned-dock');

    const resizer = document.createElement('div');
    resizer.className = 'ag-cs-dock-resizer';
    resizer.addEventListener?.('pointerdown', (ev) => {
      if (pinnedDock.collapsed || (ev.button !== undefined && ev.button !== 0)) return;
      ev.preventDefault?.();
      ev.stopPropagation?.();
      const startX = Number(ev.clientX || 0);
      const startW = pinnedDock.width;
      const splitRect = typeof pinnedDock.splitEl?.getBoundingClientRect === 'function'
        ? pinnedDock.splitEl.getBoundingClientRect()
        : null;
      const splitW = splitRect?.width || 0;
      pinnedDock.dragging = true;
      document.documentElement?.setAttribute('data-ag-cs-dock-dragging', '1');

      pinnedDock.dragMove = (moveEv) => {
        if (!pinnedDock.dragging) return;
        const delta = startX - Number(moveEv.clientX || 0);
        const nextW = clampPinnedDockWidth(startW + delta, splitW, pinnedDock.soloMode);
        if (nextW !== pinnedDock.width) {
          pinnedDock.width = nextW;
          pinnedDock.splitEl?.style?.setProperty?.('--ag-cs-dock-w', `${nextW}px`);
        }
        syncPinnedStudioDockPosition();
        if (!pinnedDock.soloMode && !pinnedDock.auxMaximized) notifyHostAuxReposition();
      };
      pinnedDock.dragUp = () => {
        stopDockDrag();
        try {
          localStorage.setItem(DOCK_WIDTH_KEY, String(pinnedDock.width));
        } catch {}
        syncPinnedStudioDockPosition();
        if (!pinnedDock.soloMode && !pinnedDock.auxMaximized) notifyHostAuxReposition();
      };
      window.addEventListener?.('pointermove', pinnedDock.dragMove, true);
      window.addEventListener?.('pointerup', pinnedDock.dragUp, true);
      window.addEventListener?.('pointercancel', pinnedDock.dragUp, true);
    });

    const head = document.createElement('div');
    head.className = 'ag-cs-dock-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ag-cs-dock-title-wrap';
    const spark = document.createElement('span');
    spark.className = 'ag-cs-dock-spark';
    spark.textContent = '✦';
    const title = document.createElement('span');
    title.className = 'ag-cs-dock-title';
    title.textContent = 'Claude Studio';
    const badge = document.createElement('span');
    badge.className = 'ag-cs-dock-badge';
    badge.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8"/><path d="M9.5 4v6L6.5 13.5V15h11v-1.5L14.5 10V4"/><path d="M12 15v6"/></svg>';
    titleWrap.append(spark, title, badge);

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ag-cs-dock-btn';
    collapseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/></svg>';
    collapseBtn.addEventListener?.('click', (ev) => {
      ev.stopPropagation?.();
      setPinnedDockCollapsed(true);
    });

    head.append(titleWrap, collapseBtn);

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'ag-cs-dock-expand-rail';
    const expandGlyph = document.createElement('span');
    expandGlyph.className = 'ag-cs-dock-expand-glyph';
    expandGlyph.textContent = '✦';
    const expandLabel = document.createElement('span');
    expandLabel.className = 'ag-cs-dock-expand-label';
    expandBtn.append(expandGlyph, expandLabel);
    expandBtn.addEventListener?.('click', (ev) => {
      ev.stopPropagation?.();
      setPinnedDockCollapsed(false);
    });

    const body = document.createElement('div');
    body.className = 'ag-cs-dock-body';

    dock.append(resizer, head, expandBtn, body);

    pinnedDock.el = dock;
    pinnedDock.headEl = head;
    pinnedDock.badgeEl = badge;
    pinnedDock.collapseBtn = collapseBtn;
    pinnedDock.expandBtn = expandBtn;
    pinnedDock.expandLabelEl = expandLabel;
    pinnedDock.bodyEl = body;
    pinnedDock.resizerEl = resizer;
    return dock;
  }

  function syncPinnedStudioDock() {
    if (destroyed) return;
    if (getEffectivePinRightPane() !== 'studio') {
      teardownPinnedStudioDock();
      return;
    }
    const inConvo = Boolean(document.querySelector('[data-testid="conversation-view"]'));
    const split = document.querySelector('[data-testid="aux-pane-split"]');
    const auxPane = document.querySelector('[data-aux-pane-open]');
    const strip = document.querySelector('[data-side-panel-strip]');
    const isAuxOpen = auxPane ? auxPane.getAttribute('data-aux-pane-open') === 'true' : false;
    const activeTabId = strip?.getAttribute('data-active-tab-id') || '';
    const isStudioActiveTab = activeTabId === RIGHT_PANE_TARGETS.studio.tabId;

    if (!inConvo || !split) {
      teardownPinnedStudioDock();
      return;
    }

    const found = findLiveStudioSlot();
    if (!found) {
      teardownPinnedStudioDock();
      return;
    }

    ensureDockToggleListeners();

    const now = Date.now();
    const prevTab = pinnedDock.prevActiveTabId;
    const prevAuxOpen = pinnedDock.prevAuxOpen;
    if (activeTabId && !isStudioActiveTab) {
      pinnedDock.lastNonStudioTabId = activeTabId;
      pinnedDock.auxCloseAttempted = false;
      pinnedDock.bounceAt = 0;
      if (pinnedDock.pendingHostAction && pinnedDock.pendingHostAction.type !== 'close_aux') {
        pinnedDock.pendingHostAction = null;
      }
    }
    if (!isAuxOpen) {
      pinnedDock.auxCloseAttempted = false;
      pinnedDock.userForcedAuxOpen = false;
      pinnedDock.pendingHostAction = null;
      if (prevAuxOpen) pinnedDock.userToggledAuxAt = 0;
    }
    if (pinnedDock.pendingHostAction && now - pinnedDock.pendingHostAction.startedAt >= 1500) {
      pinnedDock.pendingHostAction = null;
    }
    pinnedDock.prevActiveTabId = activeTabId;
    pinnedDock.prevAuxOpen = isAuxOpen;

    const recentUserAuxToggle = now - pinnedDock.userToggledAuxAt < 1500;
    if (isAuxOpen && !prevAuxOpen && recentUserAuxToggle) {
      pinnedDock.userForcedAuxOpen = true;
      pinnedDock.userToggledAuxAt = 0;
    }

    // If user explicitly re-entered Claude Studio (e.g. via Plugins -> Claude Studio)
    // while the pinned dock was collapsed, expand the pinned dock instead of yielding.
    const reenteredStudio = isAuxOpen && isStudioActiveTab && (
      (prevTab && prevTab !== RIGHT_PANE_TARGETS.studio.tabId) ||
      (!prevAuxOpen && !recentUserAuxToggle)
    );
    if (reenteredStudio && pinnedDock.collapsed) {
      pinnedDock.collapsed = false;
      try {
        localStorage.setItem(DOCK_COLLAPSED_KEY, '0');
      } catch {}
    }

    const activePendingHostAction =
      pinnedDock.pendingHostAction && now - pinnedDock.pendingHostAction.startedAt < 1500
        ? pinnedDock.pendingHostAction
        : null;

    let expectedSoloMode = !isAuxOpen || isStudioActiveTab;
    let plannedHostOp = null;
    if (isAuxOpen && isStudioActiveTab && strip) {
      if (activePendingHostAction) {
        expectedSoloMode = activePendingHostAction.type === 'close_aux';
        plannedHostOp = activePendingHostAction.type;
      } else {
        const otherTabBtn = findNonStudioTabButton(strip, pinnedDock.lastNonStudioTabId);
        const newTabBtn = strip.querySelector('[data-testid="side-panel-new-tab-button"]');
        const wasBlankNewTab = /^newTab__/i.test(pinnedDock.lastNonStudioTabId);

        if (!prevAuxOpen && !recentUserAuxToggle && !pinnedDock.userForcedAuxOpen) {
          expectedSoloMode = true;
          plannedHostOp = 'close_aux';
        } else if (otherTabBtn && typeof otherTabBtn.click === 'function') {
          expectedSoloMode = false;
          plannedHostOp = 'switch_tab';
        } else if (pinnedDock.userForcedAuxOpen || recentUserAuxToggle || (prevAuxOpen && wasBlankNewTab)) {
          expectedSoloMode = false;
          plannedHostOp = 'new_tab';
        } else {
          expectedSoloMode = true;
          plannedHostOp = 'close_aux';
        }
      }
    }

    const minRequiredWidth = expectedSoloMode ? DOCK_MIN_SOLO_SPLIT_WIDTH : DOCK_MIN_SPLIT_WIDTH;
    const splitRect = typeof split.getBoundingClientRect === 'function' ? split.getBoundingClientRect() : null;
    if (splitRect && splitRect.width > 0 && splitRect.width < minRequiredWidth) {
      teardownPinnedStudioDock();
      return;
    }

    let soloMode = expectedSoloMode;
    const hasPendingHostAction = Boolean(activePendingHostAction);
    if (isAuxOpen && isStudioActiveTab && strip && !hasPendingHostAction) {
      const otherTabBtn = findNonStudioTabButton(strip, pinnedDock.lastNonStudioTabId);
      const newTabBtn = strip.querySelector('[data-testid="side-panel-new-tab-button"]');

      if (plannedHostOp === 'close_aux') {
        // Right sidebar was CLOSED and user clicked Plugins -> Claude Studio (or only redundant Studio tab remains):
        // stay in pinned solo mode and quietly close the native right sidebar back so it does not pop open.
        const toggleBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
        if (toggleBtn && typeof toggleBtn.click === 'function' && !pinnedDock.auxCloseAttempted) {
          pinnedDock.auxCloseAttempted = true;
          pinnedDock.pendingHostAction = { type: 'close_aux', startedAt: now };
          pinnedDock.internalToggleClick = true;
          try {
            toggleBtn.click();
          } catch {}
          pinnedDock.internalToggleClick = false;
          const nextAuxOpen = auxPane ? auxPane.getAttribute('data-aux-pane-open') === 'true' : false;
          pinnedDock.prevAuxOpen = nextAuxOpen;
          if (!nextAuxOpen) {
            pinnedDock.auxCloseAttempted = false;
            pinnedDock.pendingHostAction = null;
          }
        }
      } else if (plannedHostOp === 'switch_tab' && otherTabBtn && typeof otherTabBtn.click === 'function') {
        // Right sidebar was already open (or user toggled it open) and another non-Studio tab exists ->
        // bounce back to keep 3-column mode intact without showing a duplicate Studio tab.
        if (now - pinnedDock.bounceAt >= 250) {
          pinnedDock.bounceAt = now;
          pinnedDock.pendingHostAction = { type: 'switch_tab', startedAt: now };
          try {
            otherTabBtn.click();
          } catch {}
          const refreshedTabId = strip.getAttribute('data-active-tab-id') || '';
          if (refreshedTabId && refreshedTabId !== RIGHT_PANE_TARGETS.studio.tabId) {
            pinnedDock.lastNonStudioTabId = refreshedTabId;
            pinnedDock.prevActiveTabId = refreshedTabId;
            pinnedDock.pendingHostAction = null;
            soloMode = false;
          }
        }
      } else if (plannedHostOp === 'new_tab') {
        // User explicitly toggled open the right native aux pane (or was viewing the blank new tab):
        // never swallow the right blank panel; open Antigravity's native New Tab if available.
        soloMode = false;
        if (newTabBtn && typeof newTabBtn.click === 'function' && now - pinnedDock.bounceAt >= 250) {
          pinnedDock.bounceAt = now;
          pinnedDock.pendingHostAction = { type: 'new_tab', startedAt: now };
          try {
            newTabBtn.click();
          } catch {}
          const refreshedTabId = strip.getAttribute('data-active-tab-id') || '';
          if (refreshedTabId && refreshedTabId !== RIGHT_PANE_TARGETS.studio.tabId) {
            pinnedDock.lastNonStudioTabId = refreshedTabId;
            pinnedDock.prevActiveTabId = refreshedTabId;
            pinnedDock.pendingHostAction = null;
          }
        }
      }
    }

    pinnedDock.soloMode = soloMode;
    pinnedDock.auxMaximized = isAuxPaneMaximized(split);

    const dockEl = ensurePinnedDockElement();
    if (pinnedDock.splitEl !== split) {
      detachDockSplitListeners();
      pinnedDock.splitEl = split;
      pinnedDock.splitTransitionStart = () => trackDockTransition(650);
      pinnedDock.splitTransitionEnd = () => scheduleDockPositionSync();
      split.addEventListener?.('transitionstart', pinnedDock.splitTransitionStart, true);
      split.addEventListener?.('transitionend', pinnedDock.splitTransitionEnd, true);

      if (typeof ResizeObserver === 'function') {
        try {
          const ro = new ResizeObserver(() => scheduleDockPositionSync());
          ro.observe(split);
          if (split.firstElementChild) ro.observe(split.firstElementChild);
          ro.observe(pinnedDock.bodyEl);
          ro.observe(found.overlay);
          pinnedDock.resizeObserver = ro;
        } catch {}
      }
    }

    if (dockEl.parentElement !== split) {
      const nativeChildren = Array.from(split.children || []).filter(
        (ch) => !ch.classList?.contains('ag-cs-pinned-dock')
      );
      const insertBeforeEl = nativeChildren.length >= 2 ? nativeChildren[1] : null;
      if (insertBeforeEl && typeof split.insertBefore === 'function') {
        split.insertBefore(dockEl, insertBeforeEl);
      } else {
        split.appendChild(dockEl);
      }
    }

    applyPinnedDockStateToDom({ preFound: found });
  }

  function commitComposerHud(card, footer, data, { isPrimary = false, turnBadgeData = undefined } = {}) {
    const d = data || createEmptyConvoData('', getKnownMaxContextForCard(card, data));
    const needInlineStats = cfg.inlineStats !== false;
    const needSurroundHud = hasAnySurroundHudEnabled();
    const sharedTelemetry =
      isUsageStatsEnabled() && (needInlineStats || needSurroundHud)
        ? getRingTelemetryForCard(card, d)
        : null;
    updateFooterWidgets(card, footer, d, sharedTelemetry);
    syncSurroundHud(card, footer, d, sharedTelemetry);
    if (isPrimary && turnBadgeData !== undefined) {
      syncTurnBadges(turnBadgeData);
    }
  }

  function isCardStillInCascade(card, expectedCascadeId) {
    if (!card || !card.isConnected) return false;
    if (!expectedCascadeId) return true;
    if (card.closest && card.closest('.agy-home') && !card.closest('[data-testid="conversation-view"]')) {
      return false;
    }
    const liveInputBox = card.closest ? card.closest('[data-testid="agent-input-box"]') : null;
    const currentCascadeId = resolveCascadeId(liveInputBox);
    if (!currentCascadeId) return false;
    return sameCascadeId(currentCascadeId, expectedCascadeId);
  }

  function syncComposers() {
    const cards = Array.from(document.querySelectorAll('[data-testid="agent-input-box"] .surface-composer-card'));
    const lang = getLang();
    const ui = uiText(lang);

    // Pick primary card (home card or main conversation card, skipping subagent side panel if main exists)
    let primaryCard = null;
    for (const c of cards) {
      if (!c.closest('[data-testid="subagent-tab-conversation"]')) {
        primaryCard = c;
        break;
      }
    }
    if (!primaryCard && cards.length > 0) primaryCard = cards[0];

    let activeInfoForCrab = null;

    for (const card of cards) {
      const inputBox = card.closest('[data-testid="agent-input-box"]');

      // 0. Fix Queued-Message, Takeover Q&A Card, Side-Question, and Running-Tasks overlap with Clawd Mascot
      syncCrabClearance(card, inputBox, cfg.mascot === 'crab' && card === primaryCard);

      // 1. Studio placeholder override via attribute + ::before
      const p = card.querySelector('div.relative.w-full p.pointer-events-none');
      if (p) {
        if (cfg.composerRestyle !== false && cfg.placeholderStyle === 'studio') {
          const text = ui.studioPlaceholder || 'How can I help you today?';
          if (p.getAttribute('data-ag-cs-placeholder') !== text) {
            p.setAttribute('data-ag-cs-placeholder', text);
          }
        } else {
          p.removeAttribute('data-ag-cs-placeholder');
        }
      }

      // 1b. Inline ghost guidance hint when standalone /compact pill is active
      syncCompactGuideHint(card, ui);

      // 2. Effort level accent badge inside [data-testid="model-selector-trigger"]
      const modelBtn = card.querySelector('[data-testid="model-selector-trigger"]');
      if (modelBtn) {
        if (!isEffortSliderEnabled()) {
          if (
            modelBtn._agCsHasEffortTagged ||
            modelBtn.hasAttribute('data-ag-cs-has-effort') ||
            modelBtn.style?.getPropertyValue?.('--ag-cs-effort-cut')
          ) {
            if (openEffortPop && openEffortModelBtn === modelBtn) {
              closeEffortPopover();
            }
            for (const el of modelBtn.querySelectorAll('.ag-cs-effort-badge, [data-ag-cs-effort]')) {
              if (el.hasAttribute('data-ag-cs-effort')) el.removeAttribute('data-ag-cs-effort');
              if (el.classList.contains('ag-cs-effort-badge')) el.classList.remove('ag-cs-effort-badge');
            }
            if (modelBtn.hasAttribute('data-ag-cs-has-effort')) {
              modelBtn.removeAttribute('data-ag-cs-has-effort');
            }
            if (modelBtn.style?.getPropertyValue?.('--ag-cs-effort-cut')) {
              modelBtn.style.removeProperty('--ag-cs-effort-cut');
            }
            modelBtn._agCsHasEffortTagged = false;
          }
        } else {
        if (isModelButtonLocked(modelBtn) && openEffortPop && openEffortModelBtn === modelBtn) {
          closeEffortPopover();
        }
        const sub = findModelEffortBadgeSpan(modelBtn, { preferTagged: false });
        for (const el of modelBtn.querySelectorAll('.ag-cs-effort-badge, [data-ag-cs-effort]')) {
          if (el !== sub) {
            if (el.hasAttribute('data-ag-cs-effort')) el.removeAttribute('data-ag-cs-effort');
            if (el.classList.contains('ag-cs-effort-badge')) el.classList.remove('ag-cs-effort-badge');
          }
        }
        if (sub && sub.childElementCount === 0) {
          const fpForBadge = getModelFiberProps(modelBtn);
          const isOrchBadge = Boolean(
            periodicCore &&
              typeof periodicCore.parseOrchestratorOption === 'function' &&
              fpForBadge?.selectedModel &&
              periodicCore.parseOrchestratorOption(fpForBadge.selectedModel)
          );
          const canTuneOrchBadge = Boolean(
            !isOrchBadge ||
              (Array.isArray(fpForBadge?.orchestratorPlanners) &&
                fpForBadge.orchestratorPlanners.length > 0 &&
                typeof fpForBadge?.orchestratorPick?.select === 'function')
          );
          const txt = stripEffortBadgeSuffix(sub.textContent).toLowerCase().replace(/\s+/g, ' ');
          let level = '';
          if (canTuneOrchBadge) {
            if (/\bmax\b/.test(txt)) level = 'max';
            else if (/\b(?:extra high|xhigh)\b/.test(txt)) level = 'xhigh';
            else if (/\bhigh\b/.test(txt)) level = 'high';
            else if (/\bmed(?:ium)?\b/.test(txt)) level = 'medium';
            else if (/\blow\b/.test(txt)) level = 'low';
            else if (/\bextra\b/.test(txt)) level = 'extra';
          }
          if (level) {
            if (sub.getAttribute('data-ag-cs-effort') !== level) sub.setAttribute('data-ag-cs-effort', level);
            if (!sub.classList.contains('ag-cs-effort-badge')) sub.classList.add('ag-cs-effort-badge');
          } else {
            if (sub.hasAttribute('data-ag-cs-effort')) sub.removeAttribute('data-ag-cs-effort');
            if (sub.classList.contains('ag-cs-effort-badge')) sub.classList.remove('ag-cs-effort-badge');
          }
        }
        const activeEffortSpan = modelBtn.querySelector('.ag-cs-effort-badge, [data-ag-cs-effort]');
        if (activeEffortSpan) {
          if (modelBtn.getAttribute('data-ag-cs-has-effort') !== '1') {
            modelBtn.setAttribute('data-ag-cs-has-effort', '1');
          }
          modelBtn._agCsHasEffortTagged = true;
          let effortCut = 0;
          if (typeof modelBtn.getBoundingClientRect === 'function' && typeof activeEffortSpan.getBoundingClientRect === 'function') {
            const btnRect = modelBtn.getBoundingClientRect();
            const effortRect = activeEffortSpan.getBoundingClientRect();
            if (btnRect && effortRect && btnRect.width > 0 && effortRect.width > 0) {
              effortCut = Math.max(0, Math.round(btnRect.right - effortRect.left) + 4);
            }
          }
          const cutVal = effortCut + 'px';
          if (modelBtn.style?.getPropertyValue?.('--ag-cs-effort-cut') !== cutVal) {
            modelBtn.style?.setProperty?.('--ag-cs-effort-cut', cutVal);
          }
        } else {
          if (modelBtn.hasAttribute('data-ag-cs-has-effort')) {
            modelBtn.removeAttribute('data-ag-cs-has-effort');
          }
          if (modelBtn.style?.getPropertyValue?.('--ag-cs-effort-cut')) {
            modelBtn.style.removeProperty('--ag-cs-effort-cut');
          }
        }
        }
      }

      // 3. Inline stats, remaining-usage ring, turn badges & surround HUD (both new conversations & active chats)
      const footer = card.querySelector('.agy-composer-footer');
      syncPeriodicTrigger(card, footer, modelBtn);
      syncOrchestratorSwitch(card, footer, modelBtn);
      const isHomeCard = Boolean(card.closest('.agy-home') && !card.closest('[data-testid="conversation-view"]'));
      const cascadeId = isHomeCard ? '' : resolveCascadeId(inputBox);
      const inConvo = Boolean(cascadeId || card.closest('[data-testid="conversation-view"]'));
      if (card === primaryCard) {
        const paneKey = inConvo ? cascadeId || (typeof location !== 'undefined' ? location.pathname : 'convo') : '';
        syncPinRightPane(paneKey);
      }
      const hudSuppressed = !isUsageStatsEnabled();

      if (hudSuppressed || !footer) {
        card
          .querySelectorAll('.ag-cs-inline-stats, .ag-cs-context-ring, .ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar, .ag-cs-hud-rim-progress, .ag-cs-hud-footer-chip')
          .forEach((n) => n.remove());
        const composerShell = card.closest?.('#antigravity\\.agentSidePanelInputBox') || card.parentElement;
        if (composerShell) composerShell.removeAttribute('data-ag-cs-rim');
        if (hudSuppressed) {
          if (card === primaryCard) clearTurnBadges();
          if (openPopover) closeContextPopover();
          const cachedForCrab = inConvo && cascadeId ? activeTrajCache.get(cascadeId)?.data || null : null;
          if (card === primaryCard) activeInfoForCrab = cachedForCrab;
          if (inConvo && cascadeId && card === primaryCard) {
            fetchActiveConvo(cascadeId, false, card).then((fresh) => {
              if (!destroyed && fresh && fresh !== cachedForCrab && isCardStillInCascade(card, cascadeId)) {
                syncCrab(primaryCard, fresh);
              }
            });
          }
        }
        continue;
      }

      const isPrimary = card === primaryCard;
      const cached = inConvo && cascadeId ? activeTrajCache.get(cascadeId)?.data || null : null;
      const baseData = cached || createEmptyConvoData(cascadeId, getKnownMaxContextForCard(card, null));
      if (isPrimary) activeInfoForCrab = cached;

      commitComposerHud(card, footer, baseData, { isPrimary, turnBadgeData: cached });

      if (inConvo && cascadeId) {
        fetchActiveConvo(cascadeId, false, card).then((fresh) => {
          if (destroyed || !fresh || !isCardStillInCascade(card, cascadeId)) return;
          if (fresh !== cached) {
            commitComposerHud(card, footer, fresh, { isPrimary, turnBadgeData: fresh });
            if (isPrimary) {
              syncCrab(primaryCard, fresh);
            }
          }
          if (
            openPopover &&
            openPopover.isConnected &&
            openPopoverCascadeId === cascadeId &&
            openPopover._agCsRenderedData !== fresh
          ) {
            renderContextPopoverContent(openPopover, fresh, cascadeId);
            if (openPopoverAnchor && openPopoverAnchor.isConnected) {
              positionPopoverAboveAnchor(openPopover, openPopoverAnchor);
            }
          }
        });
      }
      const needQuotaPoll =
        cfg.ringMode === 'quota' ||
        cfg.hudBottomBar === true ||
        Boolean(openPopover && openPopover.isConnected && activeHudTab === 'quotas');
      if (needQuotaPoll) {
        const needQuotaRefresh = !cachedQuotaData || Date.now() - lastQuotaFetchAt >= 25000;
        const qProm = fetchQuotaData(false);
        if (needQuotaRefresh && qProm && typeof qProm.then === 'function') {
          qProm.then((q) => {
            if (!destroyed && q && isCardStillInCascade(card, cascadeId)) {
              const latest = resolveCardConvoData(card, baseData);
              commitComposerHud(card, footer, latest);
            }
          });
        }
      }
    }

    cleanupUsageMonitorFooterSplit();
    syncCrab(primaryCard, activeInfoForCrab);
    syncSmoothCaret(false);
  }

  function updateFooterWidgets(card, footer, data, precomputedTelemetry = null) {
    const d = data || createEmptyConvoData('', getKnownMaxContextForCard(card, data));
    card._agCsLastData = d;
    if (cfg.inlineStats === false) {
      footer.querySelectorAll('.ag-cs-inline-stats, .ag-cs-context-ring').forEach((n) => n.remove());
      return;
    }
    const lang = getLang();
    const ui = uiText(lang);
    let statsBtn = footer.querySelector('.ag-cs-inline-stats');
    let ringBtn = footer.querySelector('.ag-cs-context-ring');

    // Bottom-right circular ring displays REMAINING capacity percentage (usageCore.computeRingTelemetry)
    const { ring, draftEst } = precomputedTelemetry || getRingTelemetryForCard(card, d);

    const turnsTxt = `${d.calls} ${ui.callsShortUnit || 'calls'} ${d.steps} ${ui.stepsUnit || 'steps'}`;
    const speedVal = Number(d.displaySpeed || d.lastSpeed || 0);
    const speedTxt = speedVal > 0 ? ` · ${speedVal} tok/s` : '';
    const totalTxt =
      d.totalTokens > 0
        ? ` · ${usageCore.formatCompactTokens(d.totalTokens)} tok`
        : d.liveTokens > 0
        ? ` · ~${usageCore.formatCompactTokens(d.liveTokens)} tok`
        : draftEst.tokens > 0
        ? ` · ~${usageCore.formatCompactTokens(draftEst.tokens)} tok`
        : ' · 0 tok';
    const cacheTxt = ` · ${Math.round(d.cacheHitPct || 0)}% ${ui.cacheShort || 'Cache'}`;
    const statsKey = `${turnsTxt}|${speedTxt}|${totalTxt}|${cacheTxt}|${lang}`;

    if (!statsBtn) {
      statsBtn = document.createElement('button');
      statsBtn.type = 'button';
      statsBtn.className = 'ag-cs-inline-stats';
      statsBtn.setAttribute('data-ag-no-i18n', '');
      for (const cls of ['ag-cs-stat-turns', 'ag-cs-stat-speed', 'ag-cs-stat-total', 'ag-cs-stat-cache']) {
        const sp = document.createElement('span');
        sp.className = cls;
        statsBtn.appendChild(sp);
      }
      statsBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openContextPopover(statsBtn, resolveCardConvoData(card, d), 'breakdown');
      });
      footer.appendChild(statsBtn);
    }

    if (statsBtn.getAttribute('data-ag-cs-stats-key') !== statsKey) {
      statsBtn.setAttribute('data-ag-cs-stats-key', statsKey);
      const turnsEl = statsBtn.querySelector('.ag-cs-stat-turns');
      const speedEl = statsBtn.querySelector('.ag-cs-stat-speed');
      const totalEl = statsBtn.querySelector('.ag-cs-stat-total');
      const cacheEl = statsBtn.querySelector('.ag-cs-stat-cache');
      if (turnsEl) turnsEl.textContent = turnsTxt;
      if (speedEl) {
        speedEl.textContent = speedTxt;
        speedEl.style.display = speedTxt ? '' : 'none';
      }
      if (totalEl) totalEl.textContent = totalTxt;
      if (cacheEl) cacheEl.textContent = cacheTxt;
    }

    const pct = Math.max(0, Math.min(100, ring.pct));
    const r = 5.5;
    const circ = 2 * Math.PI * r;
    const dash = ((pct / 100) * circ).toFixed(2);
    const color = ring.color;
    const strokeColor = color === '#fbb315' ? 'var(--ag-cs-warn-fg, #b45309)' : color;
    const pctRound = ring.pctRound;
    const remStr = formatCompactK(ring.remainingTokens);
    const maxStr = formatCompactK(ring.maxTokens);
    const usedStr = formatCompactK(ring.usedTokens);
    const ringTitle =
      typeof ui.ringTooltip === 'function'
        ? ui.ringTooltip(remStr, maxStr, ring.contextRemainingPct.toFixed(1), usedStr, ring.contextUsedPct.toFixed(1), ring.quotaRemainingPct)
        : `Remaining ${remStr} / ${maxStr} (${ring.contextRemainingPct.toFixed(1)}%) · Used ${usedStr} (${ring.contextUsedPct.toFixed(1)}%)`;
    const lowCtxRingAttr =
      ring.mode === 'context' && (d.calls > 0 || ring.usedTokens > 0) && ring.contextRemainingPct <= 20
        ? ring.contextRemainingPct <= 10
          ? 'danger'
          : 'warn'
        : '';
    const ringKey = `${ring.mode}|${lowCtxRingAttr}|${pctRound}|${dash}|${strokeColor}|${ringTitle}`;

    if (!ringBtn) {
      ringBtn = document.createElement('button');
      ringBtn.type = 'button';
      ringBtn.className = 'ag-cs-context-ring';
      ringBtn.setAttribute('data-ag-no-i18n', '');
      ringBtn.setAttribute('data-ring-mode', ring.mode);
      if (lowCtxRingAttr) ringBtn.setAttribute('data-ctx-low', lowCtxRingAttr);
      ringBtn.setAttribute('title', ringTitle);
      ringBtn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="${r}" fill="none" stroke="var(--ag-cs-heat-empty)" stroke-width="2.2"/><circle class="ag-cs-ring-fill" cx="8" cy="8" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-dasharray="${dash} ${circ.toFixed(2)}" stroke-linecap="round"/></svg><span>${pctRound}%</span>`;
      ringBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const targetTab = cfg.ringMode === 'quota' ? 'quotas' : 'breakdown';
        openContextPopover(ringBtn, resolveCardConvoData(card, d), targetTab);
      });
      footer.appendChild(ringBtn);
      ringBtn.setAttribute('data-ag-cs-ring-key', ringKey);
    } else if (ringBtn.getAttribute('data-ag-cs-ring-key') !== ringKey) {
      ringBtn.setAttribute('data-ag-cs-ring-key', ringKey);
      ringBtn.setAttribute('data-ring-mode', ring.mode);
      if (lowCtxRingAttr) ringBtn.setAttribute('data-ctx-low', lowCtxRingAttr);
      else ringBtn.removeAttribute('data-ctx-low');
      ringBtn.setAttribute('title', ringTitle);
      const fillCircle = ringBtn.querySelector('.ag-cs-ring-fill');
      const pctSpan = ringBtn.querySelector('span');
      if (fillCircle) {
        fillCircle.setAttribute('stroke', strokeColor);
        fillCircle.setAttribute('stroke-dasharray', `${dash} ${circ.toFixed(2)}`);
      }
      if (pctSpan) pctSpan.textContent = `${pctRound}%`;
    }
  }

  // ── Legacy Settings Dialog Cleanup (settings now live in right Aux Pane) ──
  const SETTINGS_SEC_ID = 'ag-cs-settings-sec';

  // ── Plugin Detail Page On-Demand Translation ───────────────────────────

  const PAGE_TRANSLATE_BTN_CLS = 'ag-cs-page-translate-btn';
  const PAGE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
  const PAGE_TRANSLATE_FALLBACK_URL = 'https://api.mymemory.translated.net/get';
  const PAGE_TRANSLATE_MAX_ENCODED_LEN = 1500;
  const PAGE_TRANSLATE_MAX_BATCH_ITEMS = 25;
  const PAGE_TRANSLATE_MYMEMORY_MAX_LEN = 450;
  const PAGE_TRANSLATE_TIMEOUT_MS = 20000;
  const PAGE_TRANSLATE_CACHE_LIMIT = 2000;
  let googleTranslateCooldownUntil = 0;
  const PAGE_TRANSLATE_SKIP_TAGS = new Set([
    'CODE',
    'PRE',
    'KBD',
    'SAMP',
    'VAR',
    'SVG',
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEXTAREA',
    'INPUT',
    'SELECT',
    'OPTION',
  ]);

  const pageTranslateNodeMeta = new WeakMap();
  const pageTranslateTextCache = new Map();
  const pageTranslateActiveNodes = new Set();
  const pageTranslateState = {
    btn: null,
    status: 'idle', // 'idle' | 'loading' | 'translated' | 'error'
    kind: 'page', // 'page' | 'skills'
    pageKey: '',
    lang: '',
    errorMsg: '',
    errorTimer: null,
    abortCtrl: null,
    reqSeq: 0,
  };
  const SKILLS_HEADING_RE = /^(?:skills|技能|スキル)$/i;
  let nextSkillsSectionSeq = 1;
  const skillsSectionIdMap = new WeakMap();

  function getSkillsSectionId(root) {
    let id = skillsSectionIdMap.get(root);
    if (!id) {
      id = nextSkillsSectionSeq++;
      skillsSectionIdMap.set(root, id);
    }
    return id;
  }

  function hasActiveTranslatedNodesIn(scopeRoot) {
    if (!scopeRoot) return false;
    for (const node of Array.from(pageTranslateActiveNodes)) {
      if (!node || !node.isConnected) {
        pageTranslateActiveNodes.delete(node);
        continue;
      }
      if (nodeContains(scopeRoot, node)) return true;
    }
    return false;
  }

  function getPageTranslateTarget(lang) {
    if (lang === 'zh-CN') return 'zh-CN';
    if (lang === 'zh-TW') return 'zh-TW';
    if (lang === 'yue') return 'zh-TW';
    if (lang === 'ja') return 'ja';
    return '';
  }

  function getPageTranslateStrings(lang) {
    if (lang === 'zh-TW') {
      return {
        translate: '翻譯此頁',
        translateSkills: '翻譯說明',
        showOriginal: '顯示原文',
        loading: '翻譯中…',
        error: '翻譯失敗，請檢查網絡',
        empty: '暫無可翻譯英文',
        tipTranslate: '使用 Google 翻譯此頁英文內容（不消耗模型額度）',
        tipTranslateSkills: '使用 Google 翻譯技能英文說明（不消耗模型額度）',
        tipOriginal: '切回英文原文',
      };
    }
    if (lang === 'yue') {
      return {
        translate: '翻譯呢頁',
        translateSkills: '翻譯說明',
        showOriginal: '顯示原文',
        loading: '翻譯緊…',
        error: '翻譯失敗，請檢查網絡',
        empty: '暫無可翻譯英文',
        tipTranslate: '用 Google 翻譯呢頁英文內容（唔扣模型額度）',
        tipTranslateSkills: '用 Google 翻譯技能英文說明（唔扣模型額度）',
        tipOriginal: '切返英文原文',
      };
    }
    if (lang === 'ja') {
      return {
        translate: 'このページを翻訳',
        translateSkills: '説明を翻訳',
        showOriginal: '原文を表示',
        loading: '翻訳中…',
        error: '翻訳に失敗しました',
        empty: '翻訳対象の英語なし',
        tipTranslate: 'Google 翻訳でこのページの英語を翻訳（トークン消費なし）',
        tipTranslateSkills: 'Google 翻訳でスキルの英語説明を翻訳（トークン消費なし）',
        tipOriginal: '英語の原文に戻す',
      };
    }
    return {
      translate: '翻译此页',
      translateSkills: '翻译说明',
      showOriginal: '显示原文',
      loading: '翻译中…',
      error: '翻译失败，请检查网络',
      empty: '暂无可翻译英文',
      tipTranslate: '使用谷歌翻译此页英文内容（不消耗模型额度）',
      tipTranslateSkills: '使用谷歌翻译技能英文说明（不消耗模型额度）',
      tipOriginal: '切回英文原文',
    };
  }

  function normalizeTranslateSource(raw) {
    return String(raw || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isTranslatableEnglishText(raw) {
    if (typeof raw !== 'string') return false;
    const trimmed = normalizeTranslateSource(raw);
    if (trimmed.length < 2) return false;
    if (
      /^(?:https?:\/\/|mailto:|\/|~\/|\.\.?\/|@[a-z0-9._-]+\/[a-z0-9._-]+|--?[a-z0-9-]+|[A-Z0-9_]{2,}|v?\d+(?:\.\d+)+)$/i.test(
        trimmed
      )
    ) {
      return false;
    }
    if (!/[A-Za-z]{2,}/.test(trimmed)) return false;
    const cjkMatches = trimmed.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g);
    const latinMatches = trimmed.match(/[A-Za-z]/g);
    if (cjkMatches && cjkMatches.length > 0 && (!latinMatches || latinMatches.length < cjkMatches.length * 2)) {
      return false;
    }
    if (!/\s/.test(trimmed)) {
      if (/[_./:\\@#]/.test(trimmed)) return false;
      if (/^[a-z]+[A-Z]/.test(trimmed)) return false;
      if (trimmed.length <= 3) return false;
    }
    return true;
  }

  function preserveOuterWhitespace(original, translated) {
    const lead = original.match(/^\s*/)?.[0] || '';
    const tail = original.match(/\s*$/)?.[0] || '';
    return lead + String(translated || '').trim() + tail;
  }

  function resolvePluginDetailMount(detailRoot, titleEl, tablist) {
    if (detailRoot && titleEl) {
      let cur = titleEl.parentElement;
      let steps = 0;
      while (cur && cur !== detailRoot && steps < 4) {
        const btns = Array.from(cur.querySelectorAll?.('button') || []).filter(
          (b) =>
            b &&
            !b.classList?.contains(PAGE_TRANSLATE_BTN_CLS) &&
            (!tablist || !tablist.contains(b)) &&
            !titleEl.contains(b)
        );
        if (btns.length > 0) {
          const actionBtn = btns[0];
          let slot = actionBtn;
          while (slot && slot.parentElement && slot.parentElement !== cur) {
            slot = slot.parentElement;
          }
          if (slot === actionBtn) {
            return { mountParent: cur, beforeNode: actionBtn, inHeader: true, inActionGroup: false };
          }
          if (slot && slot.parentElement === cur) {
            return { mountParent: slot, beforeNode: slot.firstChild, inHeader: true, inActionGroup: true };
          }
        }
        cur = cur.parentElement;
        steps += 1;
      }
    }
    return { mountParent: tablist, beforeNode: null, inHeader: false, inActionGroup: false };
  }

  function isElementHiddenForTranslate(el) {
    if (!el) return true;
    if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') return true;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
      } catch {}
    }
    return false;
  }

  function isElementTreeHiddenForTranslate(el) {
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (isElementHiddenForTranslate(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function findSkillsSectionContext({ dialogOnly = false } = {}) {
    const roots = dialogOnly
      ? Array.from(document.querySelectorAll('[role="dialog"]')).filter(
          (d) => d && d.isConnected && !isElementTreeHiddenForTranslate(d)
        )
      : [document];

    for (const scope of roots) {
      const expandBtns = scope.querySelectorAll?.('button[aria-expanded]') || [];
      for (const btn of expandBtns) {
        if (!btn || !btn.isConnected) continue;
        if (btn.getAttribute('aria-expanded') !== 'true') continue;
        if (btn.closest?.('.md-divider-spacing')) continue;
        if (isElementTreeHiddenForTranslate(btn)) continue;

        const heading = btn.querySelector?.('h2, h3, h4') || null;
        const headingText = (heading?.textContent || '').trim();
        if (!SKILLS_HEADING_RE.test(headingText)) continue;

        const headerRow = btn.parentElement;
        if (!headerRow || !headerRow.isConnected) continue;

        let sectionRoot = null;
        let listBox = null;
        let cur = headerRow;
        for (let depth = 0; depth < 3 && cur && cur.parentElement; depth += 1) {
          const nextSib = cur.nextElementSibling;
          if (nextSib && !isElementHiddenForTranslate(nextSib)) {
            sectionRoot = cur.parentElement;
            listBox = nextSib;
            break;
          }
          cur = cur.parentElement;
        }
        if (!sectionRoot || !listBox) continue;

        const hasSkillItems = Boolean(
          listBox.querySelector?.('[data-tooltip-id$="-name"], .text-muted-foreground, .border-b')
        );
        if (!hasSkillItems) continue;

        const countBadge = (btn.querySelector?.('span')?.textContent || '').trim();
        const sectionId = getSkillsSectionId(sectionRoot);
        return {
          kind: 'skills',
          tablist: btn,
          bodySection: listBox,
          detailRoot: listBox,
          tabpanel: listBox,
          activeTabId: countBadge,
          pageKey: `skills|${sectionId}|${countBadge}`,
          mountParent: headerRow,
          beforeNode: null,
          inHeader: false,
          inActionGroup: false,
          inSection: true,
        };
      }

      if (!dialogOnly && /\/customizations(?:[/?#]|$)/i.test(String(location?.pathname || ''))) {
        const headings = scope.querySelectorAll?.('h2, h3') || [];
        for (const heading of headings) {
          if (!heading || !heading.isConnected) continue;
          if (heading.closest?.('button[aria-expanded], .md-divider-spacing')) continue;
          if (isElementTreeHiddenForTranslate(heading)) continue;
          const headingText = (heading.textContent || '').trim();
          if (!SKILLS_HEADING_RE.test(headingText)) continue;

          const headerRow = heading.parentElement;
          if (!headerRow || !headerRow.isConnected) continue;

          let sectionRoot = null;
          let listBox = null;
          let cur = headerRow;
          for (let depth = 0; depth < 3 && cur && cur.parentElement; depth += 1) {
            const nextSib = cur.nextElementSibling;
            if (
              nextSib &&
              !isElementHiddenForTranslate(nextSib) &&
              nextSib.querySelector?.('[data-tooltip-id$="-name"]')
            ) {
              sectionRoot = cur.parentElement;
              listBox = nextSib;
              break;
            }
            cur = cur.parentElement;
          }
          if (!sectionRoot || !listBox) continue;

          const sectionId = getSkillsSectionId(sectionRoot);
          return {
            kind: 'skills',
            tablist: heading,
            bodySection: listBox,
            detailRoot: listBox,
            tabpanel: listBox,
            activeTabId: 'customizations',
            pageKey: `skills|${sectionId}|customizations`,
            mountParent: headerRow,
            beforeNode: null,
            inHeader: false,
            inActionGroup: false,
            inSection: true,
          };
        }
      }
    }

    return null;
  }

  function findPluginDetailContext() {
    const dialogSkills = findSkillsSectionContext({ dialogOnly: true });
    if (dialogSkills) return dialogSkills;

    const firstTab = document.querySelector('[role="tablist"] button[id^="plugin-detail-tab-"]');
    if (firstTab && firstTab.isConnected && !isElementTreeHiddenForTranslate(firstTab)) {
      const tablist = firstTab.closest?.('[role="tablist"]') || firstTab.parentElement || null;
      if (tablist && tablist.isConnected) {
        const bodySection = tablist.parentElement || null;
        const detailRoot = bodySection?.parentElement || bodySection || tablist;
        const tabpanel =
          document.getElementById('plugin-detail-tabpanel') ||
          detailRoot.querySelector?.('#plugin-detail-tabpanel, [role="tabpanel"]') ||
          null;
        const activeTabBtn = tablist.querySelector?.('[role="tab"][aria-selected="true"]') || firstTab;
        const activeTabId = activeTabBtn?.id || '';
        const titleEl = detailRoot.querySelector?.('h1') || null;
        const pageKey = `${(titleEl?.textContent || '').trim()}|${activeTabId}`;
        const mount = resolvePluginDetailMount(detailRoot, titleEl, tablist);
        return { kind: 'page', tablist, bodySection, detailRoot, tabpanel, activeTabId, pageKey, inSection: false, ...mount };
      }
    }

    const pluginsNav = document.querySelector('nav[data-testid="plugins-tabs"]');
    if (pluginsNav && pluginsNav.isConnected && pluginsNav.parentElement && !isElementTreeHiddenForTranslate(pluginsNav)) {
      const headerRow = pluginsNav.parentElement;
      let detailRoot = headerRow.parentElement || headerRow;
      let up = 0;
      while (
        detailRoot &&
        detailRoot.parentElement &&
        detailRoot.parentElement !== document.body &&
        detailRoot.parentElement !== document.documentElement &&
        up < 4
      ) {
        const len = (detailRoot.textContent || '').trim().length;
        const hasCards = Boolean(detailRoot.querySelector?.('h2, h3, p'));
        if (hasCards && len > 180) break;
        detailRoot = detailRoot.parentElement;
        up += 1;
      }
      const activeNavBtn =
        pluginsNav.querySelector?.('[aria-selected="true"], [aria-current="page"], [data-state="active"]') ||
        pluginsNav.querySelector?.('button') ||
        null;
      const activeTabId = (activeNavBtn?.textContent || '').trim();
      const pageKey = `marketplace|${activeTabId}`;
      return {
        kind: 'page',
        tablist: pluginsNav,
        bodySection: detailRoot,
        detailRoot,
        tabpanel: null,
        activeTabId,
        pageKey,
        mountParent: headerRow,
        beforeNode: pluginsNav,
        inHeader: true,
        inActionGroup: false,
        inSection: false,
      };
    }

    const pageSkills = findSkillsSectionContext({ dialogOnly: false });
    if (pageSkills) return pageSkills;

    return null;
  }

  function collectTranslatableTextNodes(ctx) {
    if (!ctx?.detailRoot) return [];
    const isSkills = ctx.kind === 'skills';
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        const meta = pageTranslateNodeMeta.get(node);
        const orig = meta ? meta.original : node.nodeValue;
        if (isTranslatableEnglishText(orig)) {
          if (isSkills) {
            const norm = normalizeTranslateSource(orig);
            if (!/\s/.test(norm) && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(norm)) return;
          }
          out.push(node);
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (PAGE_TRANSLATE_SKIP_TAGS.has(tag)) return;
      if (
        node === ctx.tablist ||
        node.classList?.contains(PAGE_TRANSLATE_BTN_CLS) ||
        node.hasAttribute?.('data-ag-no-i18n') ||
        node.getAttribute?.('translate') === 'no' ||
        node.classList?.contains('notranslate') ||
        node.getAttribute?.('role') === 'tablist' ||
        node.getAttribute?.('role') === 'tab'
      ) {
        return;
      }
      if (isSkills) {
        const tipId = node.getAttribute?.('data-tooltip-id') || '';
        if (/-name$/i.test(tipId)) return;
        if (tag === 'SPAN' && node.classList?.contains('font-medium') && node.classList?.contains('truncate')) return;
        if (tag === 'BUTTON') return;
      }
      if (isElementHiddenForTranslate(node)) return;
      const inPanel = ctx.tabpanel ? nodeContains(ctx.tabpanel, node) : false;
      const inBody = ctx.bodySection ? nodeContains(ctx.bodySection, node) : false;
      // Preserve plugin proper-noun title and top header action buttons/badges.
      if (tag === 'H1' && !inPanel) return;
      if (tag === 'BUTTON' && !inBody) return;
      const children = node.childNodes || node.children;
      if (!children || !children.length) return;
      for (let i = 0; i < children.length; i++) {
        walk(children[i]);
      }
    };
    walk(ctx.detailRoot);
    return out;
  }

  function restorePageTranslationNodes(scopeRoot = null) {
    for (const node of Array.from(pageTranslateActiveNodes)) {
      if (!node || !node.isConnected) {
        pageTranslateActiveNodes.delete(node);
        continue;
      }
      if (scopeRoot && !nodeContains(scopeRoot, node)) continue;
      const meta = pageTranslateNodeMeta.get(node);
      if (meta && typeof meta.original === 'string') {
        try {
          node.nodeValue = meta.original;
        } catch {}
      }
      pageTranslateActiveNodes.delete(node);
    }
  }

  function setPageTranslateCache(cacheKey, value) {
    if (pageTranslateTextCache.size >= PAGE_TRANSLATE_CACHE_LIMIT) {
      const oldestKey = pageTranslateTextCache.keys().next().value;
      if (oldestKey !== undefined) pageTranslateTextCache.delete(oldestKey);
    }
    pageTranslateTextCache.set(cacheKey, value);
  }

  async function fetchGoogleTranslateText(text, targetLang, signal) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch_unavailable');
    }
    const url = `${PAGE_TRANSLATE_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(
      text
    )}`;
    const res = await fetch(url, { method: 'GET', signal });
    if (!res.ok) {
      if (res.status === 429 || res.status === 403) {
        googleTranslateCooldownUntil = Date.now() + 10 * 60 * 1000;
      }
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('invalid_translate_payload');
    }
    return data[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
  }

  async function fetchMyMemoryTranslateText(text, targetLang, signal) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch_unavailable');
    }
    const tl = targetLang === 'zh-TW' ? 'zh-TW' : targetLang === 'ja' ? 'ja' : 'zh-CN';
    const url = `${PAGE_TRANSLATE_FALLBACK_URL}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent('en|' + tl)}`;
    const res = await fetch(url, { method: 'GET', signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const out = data?.responseData?.translatedText;
    if (
      data?.quotaFinished === true ||
      typeof out !== 'string' ||
      !out.trim() ||
      /^MYMEMORY WARNING:/i.test(out) ||
      /^QUERY LENGTH LIMIT EXCEEDED/i.test(out)
    ) {
      throw new Error('fallback_translate_failed');
    }
    return out;
  }

  async function translateBatchViaMyMemory(batch, targetLang, signal) {
    // MyMemory caps q at ~500 raw chars; split into small chunks and run with bounded concurrency.
    const chunks = [];
    let cur = [];
    let curLen = 0;
    for (const item of batch) {
      const trimmed = item.length > PAGE_TRANSLATE_MYMEMORY_MAX_LEN ? item.slice(0, PAGE_TRANSLATE_MYMEMORY_MAX_LEN) : item;
      const addLen = trimmed.length + (cur.length > 0 ? 1 : 0);
      if (cur.length > 0 && curLen + addLen > PAGE_TRANSLATE_MYMEMORY_MAX_LEN) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push({ orig: item, q: trimmed });
      curLen += trimmed.length + (cur.length > 1 ? 1 : 0);
    }
    if (cur.length > 0) chunks.push(cur);

    let nextIdx = 0;
    const workerCount = Math.min(3, chunks.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIdx < chunks.length) {
        if (signal?.aborted) throw new Error('aborted');
        const chunk = chunks[nextIdx++];
        if (chunk.length === 1) {
          const translated = await fetchMyMemoryTranslateText(chunk[0].q, targetLang, signal);
          setPageTranslateCache(`${targetLang}\0${chunk[0].orig}`, translated);
          continue;
        }
        const joined = chunk.map((c) => c.q).join('\n');
        const translatedBlock = await fetchMyMemoryTranslateText(joined, targetLang, signal);
        const lines = translatedBlock.split('\n');
        if (lines.length === chunk.length) {
          for (let i = 0; i < chunk.length; i++) {
            setPageTranslateCache(`${targetLang}\0${chunk[i].orig}`, lines[i]);
          }
        } else {
          for (const entry of chunk) {
            if (signal?.aborted) throw new Error('aborted');
            const single = await fetchMyMemoryTranslateText(entry.q, targetLang, signal);
            setPageTranslateCache(`${targetLang}\0${entry.orig}`, single);
          }
        }
      }
    });
    await Promise.all(workers);
  }

  async function translateTextsInBatches(uniqueTexts, targetLang, signal) {
    const batches = [];
    let current = [];
    let currentEncodedLen = 0;
    for (const text of uniqueTexts) {
      const encLen = encodeURIComponent(text).length + 3; // + %0A
      if (
        current.length > 0 &&
        (current.length >= PAGE_TRANSLATE_MAX_BATCH_ITEMS || currentEncodedLen + encLen > PAGE_TRANSLATE_MAX_ENCODED_LEN)
      ) {
        batches.push(current);
        current = [];
        currentEncodedLen = 0;
      }
      current.push(text);
      currentEncodedLen += encLen;
    }
    if (current.length > 0) batches.push(current);

    for (const batch of batches) {
      if (signal?.aborted) throw new Error('aborted');
      const useFallbackDirect = Date.now() < googleTranslateCooldownUntil;
      if (useFallbackDirect) {
        await translateBatchViaMyMemory(batch, targetLang, signal);
        continue;
      }
      try {
        if (batch.length === 1) {
          const translated = await fetchGoogleTranslateText(batch[0], targetLang, signal);
          setPageTranslateCache(`${targetLang}\0${batch[0]}`, translated);
          continue;
        }
        const joined = batch.join('\n');
        const translatedBlock = await fetchGoogleTranslateText(joined, targetLang, signal);
        const lines = translatedBlock.split('\n');
        if (lines.length === batch.length) {
          for (let i = 0; i < batch.length; i++) {
            setPageTranslateCache(`${targetLang}\0${batch[i]}`, lines[i]);
          }
        } else {
          for (const item of batch) {
            if (signal?.aborted) throw new Error('aborted');
            const single = await fetchGoogleTranslateText(item, targetLang, signal);
            setPageTranslateCache(`${targetLang}\0${item}`, single);
          }
        }
      } catch (err) {
        if (signal?.aborted || err?.message === 'aborted') throw err;
        // Fall back to MyMemory when Google Translate rate-limits (HTTP 429) or fails.
        await translateBatchViaMyMemory(batch, targetLang, signal);
      }
    }
  }

  function applyCachedTranslationsToNodes(nodes, targetLang) {
    let applied = 0;
    for (const node of nodes) {
      if (!node || !node.isConnected) continue;
      let meta = pageTranslateNodeMeta.get(node);
      if (!meta) {
        meta = { original: node.nodeValue || '', translations: new Map() };
        pageTranslateNodeMeta.set(node, meta);
      }
      const norm = normalizeTranslateSource(meta.original);
      const translated = meta.translations.get(targetLang) || pageTranslateTextCache.get(`${targetLang}\0${norm}`);
      if (typeof translated === 'string' && translated.trim()) {
        meta.translations.set(targetLang, translated);
        const nextVal = preserveOuterWhitespace(meta.original, translated);
        if (node.nodeValue !== nextVal) {
          node.nodeValue = nextVal;
        }
        pageTranslateActiveNodes.add(node);
        applied += 1;
      }
    }
    return applied;
  }

  function clearPageTranslateErrorTimer() {
    if (pageTranslateState.errorTimer) {
      clearTimeout(pageTranslateState.errorTimer);
      pageTranslateState.errorTimer = null;
    }
  }

  function abortPageTranslateRequest() {
    if (pageTranslateState.abortCtrl) {
      try {
        pageTranslateState.abortCtrl.abort();
      } catch {}
      pageTranslateState.abortCtrl = null;
    }
  }

  function renderPageTranslateButton() {
    const btn = pageTranslateState.btn;
    if (!btn || !btn.isConnected) return;
    const lang = getLang();
    const s = getPageTranslateStrings(lang);
    const status = pageTranslateState.status;
    const isSkills = pageTranslateState.kind === 'skills';
    const label =
      status === 'loading'
        ? s.loading
        : status === 'translated'
        ? s.showOriginal
        : status === 'error'
        ? pageTranslateState.errorMsg || s.error
        : isSkills
        ? s.translateSkills
        : s.translate;
    const title = status === 'translated' ? s.tipOriginal : isSkills ? s.tipTranslateSkills : s.tipTranslate;
    const renderKey = `${status}|${lang}|${pageTranslateState.kind}|${label}|${title}`;
    if (btn.getAttribute('data-ag-cs-pt-key') === renderKey) return;
    btn.setAttribute('data-ag-cs-pt-key', renderKey);

    btn.classList.toggle('is-loading', status === 'loading');
    btn.classList.toggle('is-translated', status === 'translated');
    btn.classList.toggle('is-error', status === 'error');
    btn.disabled = status === 'loading';
    btn.setAttribute('aria-busy', status === 'loading' ? 'true' : 'false');
    btn.setAttribute('aria-pressed', status === 'translated' ? 'true' : 'false');
    btn.title = title;

    const iconSvg =
      status === 'loading'
        ? '<svg class="ag-cs-pt-ico ag-cs-pt-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.6" stroke-opacity="0.28"/><path d="M13.5 8a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
        : '<svg class="ag-cs-pt-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4h6.5M5.75 2.5V4m2.1 0c-.5 2.3-1.8 4.2-4.35 5.6m.95-3.4c.85 1.35 2.05 2.45 3.45 3.2M9.2 13.5l2.25-6.2h.7l2.25 6.2m-4.2-1.8h3.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.innerHTML = `${iconSvg}<span class="ag-cs-pt-label">${escapeHtml(label)}</span>`;
  }

  function showPageTranslateTransientError(msg) {
    clearPageTranslateErrorTimer();
    pageTranslateState.status = 'error';
    pageTranslateState.errorMsg = msg;
    renderPageTranslateButton();
    pageTranslateState.errorTimer = setTimeout(() => {
      pageTranslateState.errorTimer = null;
      if (destroyed) return;
      if (pageTranslateState.status === 'error') {
        pageTranslateState.status = 'idle';
        pageTranslateState.errorMsg = '';
        renderPageTranslateButton();
      }
    }, 3000);
  }

  async function onPageTranslateButtonClick(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (destroyed || pageTranslateState.status === 'loading') return;
    const lang = getLang();
    const targetLang = getPageTranslateTarget(lang);
    if (!targetLang) return;
    const ctx = findPluginDetailContext();
    if (!ctx) return;
    const s = getPageTranslateStrings(lang);

    if (pageTranslateState.status === 'translated') {
      restorePageTranslationNodes(ctx.detailRoot);
      pageTranslateState.status = 'idle';
      pageTranslateState.errorMsg = '';
      renderPageTranslateButton();
      return;
    }

    const nodes = collectTranslatableTextNodes(ctx);
    if (!nodes.length) {
      showPageTranslateTransientError(s.empty);
      return;
    }

    const missingSet = new Set();
    for (const node of nodes) {
      let meta = pageTranslateNodeMeta.get(node);
      if (!meta) {
        meta = { original: node.nodeValue || '', translations: new Map() };
        pageTranslateNodeMeta.set(node, meta);
      }
      const norm = normalizeTranslateSource(meta.original);
      if (!norm) continue;
      if (!meta.translations.has(targetLang) && !pageTranslateTextCache.has(`${targetLang}\0${norm}`)) {
        missingSet.add(norm);
      }
    }

    if (missingSet.size === 0) {
      applyCachedTranslationsToNodes(nodes, targetLang);
      clearPageTranslateErrorTimer();
      pageTranslateState.status = 'translated';
      pageTranslateState.errorMsg = '';
      renderPageTranslateButton();
      return;
    }

    clearPageTranslateErrorTimer();
    abortPageTranslateRequest();
    const seq = ++pageTranslateState.reqSeq;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    pageTranslateState.abortCtrl = ctrl;
    pageTranslateState.status = 'loading';
    pageTranslateState.errorMsg = '';
    renderPageTranslateButton();

    const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), PAGE_TRANSLATE_TIMEOUT_MS) : null;
    try {
      await translateTextsInBatches(Array.from(missingSet), targetLang, ctrl?.signal);
      if (destroyed || seq !== pageTranslateState.reqSeq) return;
      const liveCtx = findPluginDetailContext();
      if (!liveCtx || liveCtx.pageKey !== ctx.pageKey) {
        pageTranslateState.status = 'idle';
        renderPageTranslateButton();
        return;
      }
      const applied = applyCachedTranslationsToNodes(collectTranslatableTextNodes(liveCtx), targetLang);
      pageTranslateState.status = applied > 0 ? 'translated' : 'idle';
      renderPageTranslateButton();
    } catch {
      if (destroyed || seq !== pageTranslateState.reqSeq) return;
      showPageTranslateTransientError(s.error);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (pageTranslateState.abortCtrl === ctrl) {
        pageTranslateState.abortCtrl = null;
      }
    }
  }

  function teardownPageTranslate() {
    pageTranslateState.reqSeq += 1;
    abortPageTranslateRequest();
    clearPageTranslateErrorTimer();
    restorePageTranslationNodes();
    if (pageTranslateState.btn) {
      try {
        pageTranslateState.btn.remove();
      } catch {}
      pageTranslateState.btn = null;
    }
    pageTranslateState.status = 'idle';
    pageTranslateState.kind = 'page';
    pageTranslateState.pageKey = '';
    pageTranslateState.errorMsg = '';
  }

  function syncPluginDetailTranslateButton() {
    const lang = getLang();
    const targetLang = cfg.pluginPageTranslate === false ? '' : getPageTranslateTarget(lang);
    const ctx = targetLang ? findPluginDetailContext() : null;

    if (!targetLang || !ctx || !ctx.mountParent) {
      if (pageTranslateState.btn || pageTranslateActiveNodes.size > 0) {
        teardownPageTranslate();
      }
      return;
    }

    if (pageTranslateState.lang && pageTranslateState.lang !== lang) {
      pageTranslateState.reqSeq += 1;
      abortPageTranslateRequest();
      clearPageTranslateErrorTimer();
      restorePageTranslationNodes();
      pageTranslateState.status = 'idle';
      pageTranslateState.errorMsg = '';
    }
    pageTranslateState.lang = lang;

    if (pageTranslateState.pageKey && pageTranslateState.pageKey !== ctx.pageKey) {
      pageTranslateState.reqSeq += 1;
      abortPageTranslateRequest();
      clearPageTranslateErrorTimer();
      pageTranslateState.status = hasActiveTranslatedNodesIn(ctx.detailRoot) ? 'translated' : 'idle';
      pageTranslateState.errorMsg = '';
    }
    pageTranslateState.pageKey = ctx.pageKey;
    pageTranslateState.kind = ctx.kind || 'page';

    let btn = pageTranslateState.btn;
    const needRemount = !btn || !btn.isConnected || btn.parentElement !== ctx.mountParent;
    if (needRemount) {
      if (btn) {
        try {
          btn.remove();
        } catch {}
      }
      document.querySelectorAll('.' + PAGE_TRANSLATE_BTN_CLS).forEach((el) => el.remove());
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = PAGE_TRANSLATE_BTN_CLS;
      btn.setAttribute('data-ag-no-i18n', '1');
      btn.addEventListener('click', onPageTranslateButtonClick);
      if (ctx.beforeNode && ctx.beforeNode.parentElement === ctx.mountParent) {
        ctx.mountParent.insertBefore(btn, ctx.beforeNode);
      } else {
        ctx.mountParent.appendChild(btn);
      }
      pageTranslateState.btn = btn;
    }
    btn.classList.toggle('is-header', Boolean(ctx.inHeader));
    btn.classList.toggle('is-in-action-group', Boolean(ctx.inActionGroup));
    btn.classList.toggle('is-section', Boolean(ctx.inSection));

    renderPageTranslateButton();
  }

  function ensureSettingsSection() {
    const legacy = document.getElementById(SETTINGS_SEC_ID);
    if (legacy) legacy.remove();
  }

  // ── Main Synchronization Loop & Global Event Handlers ──────────────────
  let syncQueued = false;
  let syncTimer = null;
  let syncIsRaf = false;

  function cancelScheduledSync() {
    if (syncTimer === null) return;
    try {
      if (syncIsRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(syncTimer);
      } else {
        clearTimeout(syncTimer);
      }
    } catch {}
    syncTimer = null;
    syncQueued = false;
  }

  // ── Chat File Link Right-Click Context Menu ────────────────────────────
  const FILE_MENU_CLS = 'ag-cs-file-menu';
  const FILE_TOAST_CLS = 'ag-cs-file-toast';
  let openFileMenu = null;
  let fileToastEl = null;
  let fileToastTimer = null;
  const pendingFileActions = new Map();
  let nextFileActionId = 0;

  function clearFileLinkToast() {
    if (fileToastTimer) {
      clearTimeout(fileToastTimer);
      fileToastTimer = null;
    }
    if (fileToastEl) {
      try {
        fileToastEl.remove();
      } catch {}
      fileToastEl = null;
    }
  }

  function showFileLinkToast(message, isError = false) {
    clearFileLinkToast();
    if (!message || !document.body) return;
    const el = document.createElement('div');
    el.className = FILE_TOAST_CLS + (isError ? ' is-error' : '');
    el.setAttribute('data-ag-no-i18n', '1');
    el.setAttribute('role', 'status');
    el.textContent = String(message);
    document.body.appendChild(el);
    fileToastEl = el;
    fileToastTimer = setTimeout(() => {
      clearFileLinkToast();
    }, 2000);
  }

  function closeFileLinkMenu() {
    if (openFileMenu) {
      try {
        openFileMenu.remove();
      } catch {}
      openFileMenu = null;
    }
  }

  function decodeLocalFileUriForDisplay(rawUri) {
    if (typeof rawUri !== 'string') return null;
    const trimmed = rawUri.trim();
    if (!/^file:\/\//i.test(trimmed)) return null;
    const noFrag = trimmed.split('#')[0].split('?')[0];
    let parsed;
    try {
      parsed = new URL(noFrag);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'file:') return null;
    const host = String(parsed.hostname || '').toLowerCase();
    if (host && host !== 'localhost') return null;
    let decoded = '';
    try {
      decoded = decodeURIComponent(parsed.pathname || '');
    } catch {
      return null;
    }
    if (!decoded || /[\x00-\x1f\x7f]/.test(decoded) || /^[\\/]{2}/.test(decoded)) return null;
    const isWinPath = /^\/[A-Za-z]:(?:\/|$)/.test(decoded);
    const fullPath = isWinPath ? decoded.slice(1).replace(/\//g, '\\') : decoded;
    const sep = isWinPath ? '\\' : '/';
    const cleanNoTrail = fullPath.length > 3 ? fullPath.replace(/[\\/]+$/, '') : fullPath;
    const idx = cleanNoTrail.lastIndexOf(sep);
    const baseName = idx >= 0 ? cleanNoTrail.slice(idx + 1) : cleanNoTrail;
    const dirName = idx >= 0 ? cleanNoTrail.slice(0, idx) : '';
    return { fullPath, baseName: baseName || fullPath, dirName, uri: trimmed };
  }

  function extractHrefFromFiberNode(el) {
    if (!el || typeof el !== 'object') return '';
    let fiberKey = '';
    try {
      const keys = Object.keys(el);
      for (let i = 0; i < keys.length; i += 1) {
        if (keys[i].startsWith('__reactFiber')) {
          fiberKey = keys[i];
          break;
        }
      }
    } catch {
      return '';
    }
    if (!fiberKey) return '';
    let f = el[fiberKey];
    for (let depth = 0; depth < 8 && f; depth += 1, f = f.return) {
      const mp = f.memoizedProps;
      if (!mp || typeof mp !== 'object') continue;
      if (typeof mp.href === 'string' && /^file:\/\//i.test(mp.href.trim())) {
        return mp.href.trim();
      }
      const nodeHref = mp.node?.properties?.href;
      if (typeof nodeHref === 'string' && /^file:\/\//i.test(nodeHref.trim())) {
        return nodeHref.trim();
      }
    }
    return '';
  }

  function extractLocalFileLinkFromTarget(target) {
    const el = target && target.nodeType === 1 ? target : target?.parentElement;
    if (!el || typeof el.closest !== 'function') return null;
    if (isOwnPluginNode(el) || !el.closest('[data-testid="conversation-view"]')) return null;

    // 1. Direct <a href="file://...">
    const anchor = el.closest('a[href]');
    if (anchor) {
      const href = String(anchor.getAttribute('href') || '').trim();
      if (/^file:\/\//i.test(href)) {
        return decodeLocalFileUriForDisplay(href);
      }
    }

    // 2. Antigravity file mention pill (<bdi class="context-scope-mention"> or inline quotable wrapper)
    const mention = el.closest('bdi.context-scope-mention, [data-quotable-inline="true"], .context-scope-mention');
    if (mention) {
      const fiberHref = extractHrefFromFiberNode(mention) || extractHrefFromFiberNode(mention.parentElement);
      if (fiberHref) {
        return decodeLocalFileUriForDisplay(fiberHref);
      }
    }

    // 3. Fallback: clickable inline file pill inside conversation view whose React fiber carries a file:// href
    const conv = el.closest('[data-testid="conversation-view"]');
    if (conv) {
      let cur = el;
      for (let depth = 0; depth < 3 && cur && cur !== conv; depth += 1, cur = cur.parentElement) {
        const directHref = String(cur.getAttribute?.('data-href') || cur.getAttribute?.('href') || '').trim();
        if (/^file:\/\//i.test(directHref)) {
          return decodeLocalFileUriForDisplay(directHref);
        }
        const fHref = extractHrefFromFiberNode(cur);
        if (fHref) {
          return decodeLocalFileUriForDisplay(fHref);
        }
      }
    }
    return null;
  }

  async function copyPathToClipboard(text) {
    const ui = uiText(getLang());
    let copied = false;
    try {
      if (typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {}
    if (destroyed || cfg.fileLinkContextMenu === false) return;
    if (!copied && document.body) {
      const ta = document.createElement('textarea');
      const focused = document.activeElement;
      const selection = document.getSelection?.();
      const ranges = Array.from({ length: selection?.rangeCount || 0 }, (_, i) => selection.getRangeAt(i).cloneRange());
      try {
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
      } catch {} finally {
        ta.remove();
        focused?.focus?.({ preventScroll: true });
        if (selection && ranges.length) {
          selection.removeAllRanges();
          for (const range of ranges) selection.addRange(range);
        }
      }
    }
    showFileLinkToast(copied ? ui.fileMenuCopied : ui.fileMenuCopyFailed, !copied);
  }

  function openFileLinkContextMenu(info, clientX, clientY) {
    closeFileLinkMenu();
    if (!info || !document.body) return;
    const lang = getLang();
    const ui = uiText(lang);
    const copyLabel = ui.fileMenuCopyPath || 'Copy Full Path';
    const openLabel = ui.fileMenuOpen || 'Open file';
    const revealLabel = ui.fileMenuReveal || 'Show in folder';

    const menu = document.createElement('div');
    menu.className = FILE_MENU_CLS;
    menu.setAttribute('data-ag-no-i18n', '1');
    menu.setAttribute('role', 'menu');

    const head = document.createElement('div');
    head.className = 'ag-cs-file-menu-head';
    const nameEl = document.createElement('div');
    nameEl.className = 'ag-cs-file-menu-name';
    nameEl.textContent = info.baseName;
    nameEl.title = info.fullPath;
    head.appendChild(nameEl);
    if (info.dirName) {
      const dirEl = document.createElement('div');
      dirEl.className = 'ag-cs-file-menu-dir';
      dirEl.textContent = info.dirName;
      dirEl.title = info.dirName;
      head.appendChild(dirEl);
    }
    menu.appendChild(head);

    const makeItem = (label, svgPath, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ag-cs-file-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML =
        '<svg class="ag-cs-file-menu-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        svgPath +
        '</svg>' +
        '<span></span>';
      btn.querySelector('span').textContent = label;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeFileLinkMenu();
        onClick();
      });
      return btn;
    };

    const requestFileAction = (mode) => {
      if (destroyed || cfg.fileLinkContextMenu === false) return;
      const send = window[cfg.binding];
      if (typeof send !== 'function') {
        showFileLinkToast(ui.fileMenuActionUnavailable || 'File action unavailable', true);
        return;
      }
      const requestId = `file-${Date.now()}-${++nextFileActionId}`;
      const timer = setTimeout(() => {
        pendingFileActions.delete(requestId);
        if (!destroyed && cfg.fileLinkContextMenu !== false) showFileLinkToast(ui.fileMenuActionFailed || 'File action failed', true);
      }, 15000);
      pendingFileActions.set(requestId, { mode, timer });
      send(JSON.stringify({ action: 'fileLinkAction', mode, uri: info.uri, requestId }));
    };
    menu.appendChild(makeItem(openLabel,
      '<path d="M9.5 2.25H4.25A1.25 1.25 0 0 0 3 3.5v9a1.25 1.25 0 0 0 1.25 1.25h7.5A1.25 1.25 0 0 0 13 12.5V5.75L9.5 2.25z"/><path d="M9.5 2.25v3.5H13"/>',
      () => requestFileAction('open')));
    menu.appendChild(makeItem(revealLabel,
      '<path d="M2.25 4.25A1.25 1.25 0 0 1 3.5 3h2.8a1.25 1.25 0 0 1 .95.44l.9 1.06a1.25 1.25 0 0 0 .95.44h3.4a1.25 1.25 0 0 1 1.25 1.25v5.56A1.25 1.25 0 0 1 12.5 13H3.5a1.25 1.25 0 0 1-1.25-1.25V4.25z"/>',
      () => requestFileAction('reveal')));

    menu.appendChild(
      makeItem(
        copyLabel,
        '<rect x="5.25" y="5.25" width="8" height="8" rx="1.25"/><path d="M3.25 10.75A1.25 1.25 0 0 1 2 9.5v-6A1.25 1.25 0 0 1 3.25 2.25h6A1.25 1.25 0 0 1 10.5 3.5"/>',
        () => copyPathToClipboard(info.fullPath)
      )
    );

    menu.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    document.body.appendChild(menu);
    openFileMenu = menu;

    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const rect = menu.getBoundingClientRect();
    const x = Math.max(8, Math.min(vw - rect.width - 8, clientX));
    const y = Math.max(8, Math.min(vh - rect.height - 8, clientY));
    menu.style.left = Math.round(x) + 'px';
    menu.style.top = Math.round(y) + 'px';
  }

  function onDocContextMenu(ev) {
    if (destroyed || cfg.fileLinkContextMenu === false) {
      if (openFileMenu) closeFileLinkMenu();
      return;
    }
    if (openFileMenu && nodeContains(openFileMenu, ev.target)) return;
    const info = extractLocalFileLinkFromTarget(ev.target);
    if (!info) {
      if (openFileMenu) closeFileLinkMenu();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    openFileLinkContextMenu(info, ev.clientX, ev.clientY);
  }

  function isOwnPluginNode(target) {
    const el = target && target.closest ? target : target?.parentElement;
    if (!el || !el.closest) return false;
    return Boolean(
      el.closest(
        '.ag-cs-pinned-dock, .ag-cs-dock-toolbar-btn, .ag-cs-home-panel-seat, .ag-cs-ripple-host, .ag-cs-crab, .ag-cs-inline-stats, .ag-cs-periodic-trigger, .ag-cs-orch-switch, .ag-cs-ps-backdrop, .ag-cs-ps-drawer, .ag-cs-context-ring, .ag-cs-um-ctx-proxy, .ag-cs-ctx-popover, .ag-cs-effort-popover, .ag-cs-smooth-caret, .ag-cs-compact-hint, .ag-cs-turn-bar, .ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar, .ag-cs-hud-footer-chip, .ag-cs-page-translate-btn, .ag-cs-file-menu, .ag-cs-file-toast, .ag-cs-script-chat-card, #' +
          SETTINGS_SEC_ID +
          ', #ag-claude-studio-css, #ag-claude-style-css'
      )
    );
  }

  function runSync() {
    if (destroyed) return;
    if (openPopover && (!openPopover.isConnected || !openPopoverAnchor || !openPopoverAnchor.isConnected)) {
      closeContextPopover();
    }
    if (openEffortPop && (!openEffortPop.isConnected || !openEffortAnchor || !openEffortAnchor.isConnected)) {
      closeEffortPopover();
    }
    applyRootAttrs();
    const inHero = Boolean(document.querySelector('.agy-home [data-testid="home-greeting"]'));
    syncGreeting(inHero);
    if (inHero && cfg.homeLayout === 'studio') {
      renderHomePanel();
    } else {
      unmountPanelSeat();
    }
    syncRipple();
    syncComposers();
    syncPinnedStudioDock();
    syncPluginDetailTranslateButton();
    ensureSettingsSection();
  }

  function scheduleSync() {
    if (destroyed || syncQueued) return;
    syncQueued = true;
    if (!document.hidden && typeof requestAnimationFrame === 'function') {
      syncIsRaf = true;
      syncTimer = requestAnimationFrame(() => {
        syncTimer = null;
        syncQueued = false;
        runSync();
      });
    } else {
      syncIsRaf = false;
      syncTimer = setTimeout(() => {
        syncTimer = null;
        syncQueued = false;
        runSync();
      }, 50);
    }
  }

  function onStoreChanged() {
    if (sideQuestionRestoreActive) {
      const liveCid = resolveActiveConversationIdForHost('', findHostReduxStore());
      if (
        sideQuestionRestoreActive.conversationId &&
        liveCid &&
        !sameCascadeId(liveCid, sideQuestionRestoreActive.conversationId)
      ) {
        cancelSideQuestionRestore();
      }
    }
    const inHero = Boolean(document.querySelector('.agy-home'));
    if (inHero && cfg.homeLayout === 'studio') {
      refreshUsageRollup(false);
    }
    scheduleSync();
  }

  let allowNativeModelMenuDepth = 0;

  function withNativeModelMenuBypass(modelBtn, fn) {
    allowNativeModelMenuDepth += 1;
    if (modelBtn) {
      try {
        modelBtn._agCsAllowNativeModelMenu = true;
      } catch {}
    }
    try {
      return typeof fn === 'function' ? fn() : undefined;
    } finally {
      allowNativeModelMenuDepth = Math.max(0, allowNativeModelMenuDepth - 1);
      if (modelBtn) {
        try {
          delete modelBtn._agCsAllowNativeModelMenu;
        } catch {}
      }
    }
  }

  function isNativeModelMenuBypassed(ev, modelBtn) {
    if (allowNativeModelMenuDepth > 0) return true;
    if (ev && ev._agCsAllowNativeModelMenu === true) return true;
    if (modelBtn && modelBtn._agCsAllowNativeModelMenu === true) return true;
    return false;
  }

  function findClickedEffortBadge(ev) {
    if (!isEffortSliderEnabled()) return null;
    const t = ev?.target;
    if (!t || !t.closest) return null;
    const badge = t.closest('[data-testid="model-selector-trigger"] .ag-cs-effort-badge, [data-testid="model-selector-trigger"] [data-ag-cs-effort]');
    if (!badge) return null;
    const modelBtn = badge.closest('[data-testid="model-selector-trigger"]');
    if (isModelButtonLocked(modelBtn)) return null;
    return badge;
  }

  function findInterceptedModelTrigger(ev) {
    if (cfg.periodicSelector === false || !periodicCore) return null;
    if (!isEffortSliderEnabled()) return null;
    if (ev && typeof ev.button === 'number' && ev.button !== 0) return null;
    const t = ev?.target;
    if (!t || !t.closest) return null;
    if (
      isEffortSliderEnabled() &&
      t.closest('[data-testid="model-selector-trigger"] .ag-cs-effort-badge, [data-testid="model-selector-trigger"] [data-ag-cs-effort]')
    ) {
      return null;
    }
    const modelBtn = t.closest('[data-testid="model-selector-trigger"]');
    if (!modelBtn) return null;
    if (isNativeModelMenuBypassed(ev, modelBtn)) return null;
    return modelBtn;
  }

  function openPeriodicFromModelTrigger(modelBtn, opts = {}) {
    if (!modelBtn || isModelButtonLocked(modelBtn)) return;
    const card = modelBtn.closest ? modelBtn.closest('.surface-composer-card') : null;
    const triggerBtn = card?.querySelector?.('.ag-cs-periodic-trigger') || document.querySelector('.ag-cs-periodic-trigger');
    openPeriodicSelector(triggerBtn, modelBtn, opts);
  }

  function onDocPointerDown(ev) {
    const effortBadge = findClickedEffortBadge(ev);
    if (effortBadge) {
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      ev.preventDefault();
      return;
    }
    if (openPopover && !nodeContains(openPopover, ev.target) && (!openPopoverAnchor || !nodeContains(openPopoverAnchor, ev.target))) {
      closeContextPopover();
    }
    if (openEffortPop && !nodeContains(openEffortPop, ev.target) && (!openEffortAnchor || !nodeContains(openEffortAnchor, ev.target))) {
      closeEffortPopover();
    }
    if (openFileMenu && !nodeContains(openFileMenu, ev.target)) {
      closeFileLinkMenu();
    }
    const interceptedModelBtn = findInterceptedModelTrigger(ev);
    if (interceptedModelBtn) {
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      ev.preventDefault();
      return;
    }
    if (crabState.root) {
      crabState.stage.quietSince = Date.now();
      if (crabState.stage.asleep) {
        crabState.stage.asleep = false;
        crabState.stage.waking = !motionReduced();
        stepCrab();
      }
    }
    if (anySmoothCaretVisible || (ev?.target?.closest && ev.target.closest('[data-testid="agent-input-box"]'))) {
      queueSmoothCaret(false);
    }
  }

  function onDocMouseDown(ev) {
    const effortBadge = findClickedEffortBadge(ev);
    if (effortBadge) {
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      ev.preventDefault();
      return;
    }
    const interceptedModelBtn = findInterceptedModelTrigger(ev);
    if (interceptedModelBtn) {
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  }

  const submitSyncTimers = new Set();

  function markUserSubmitted() {
    lastUserSubmitAt = Date.now();
    scheduleSync();
    for (const delay of [350, 1100]) {
      const id = setTimeout(() => {
        submitSyncTimers.delete(id);
        if (!destroyed) scheduleSync();
      }, delay);
      submitSyncTimers.add(id);
    }
  }

  function onDocClick(ev) {
    const effortBadge = findClickedEffortBadge(ev);
    if (effortBadge) {
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      ev.preventDefault();
      const modelBtn = effortBadge.closest('[data-testid="model-selector-trigger"]');
      openEffortPopover(effortBadge, modelBtn);
      return;
    }
    const interceptedModelBtn = findInterceptedModelTrigger(ev);
    if (interceptedModelBtn) {
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      ev.preventDefault();
      if (openEffortPop) closeEffortPopover();
      openPeriodicFromModelTrigger(interceptedModelBtn);
      return;
    }
    const modelBtn = ev?.target?.closest ? ev.target.closest('[data-testid="model-selector-trigger"]') : null;
    if (modelBtn && openEffortPop) {
      closeEffortPopover();
    }
    const submitBtn = ev?.target?.closest ? ev.target.closest('button') : null;
    if (submitBtn && submitBtn.closest && submitBtn.closest('[data-testid="agent-input-box"]')) {
      const tid = String(submitBtn.getAttribute('data-testid') || '');
      const bType = String(submitBtn.getAttribute('type') || '');
      const aria = String(submitBtn.getAttribute('aria-label') || '');
      if (bType === 'submit' || /send|submit/i.test(tid) || /send|submit|发送|傳送|送信/i.test(aria)) {
        markUserSubmitted();
      }
    }
    if (
      ev?.target?.closest &&
      ev.target.closest('[data-side-panel-strip], [data-testid="toggle-aux-sidebar"]')
    ) {
      if (sideQuestionRestoreActive && !internalSideQuestionClick && !pinnedDock.internalToggleClick) {
        if (ev.target.closest('[data-testid="toggle-aux-sidebar"]')) {
          cancelSideQuestionRestore();
        } else {
          const tabEl = ev.target.closest('[data-tab-id], button, [role="tab"]');
          const clickedTabId =
            tabEl?.getAttribute?.('data-tab-id') ||
            tabEl?.closest?.('[data-tab-id]')?.getAttribute?.('data-tab-id') ||
            '';
          if (clickedTabId !== sideQuestionRestoreActive.tabId) {
            cancelSideQuestionRestore();
          }
        }
      }
      scheduleSync();
      const id = setTimeout(() => {
        submitSyncTimers.delete(id);
        if (!destroyed) scheduleSync();
      }, 60);
      submitSyncTimers.add(id);
    }
  }

  function onDocKeyDown(ev) {
    if (ev.key === 'Escape') {
      if (openPsDrawer) closePeriodicSelector();
      if (openPopover) closeContextPopover();
      if (openEffortPop) closeEffortPopover();
      if (openFileMenu) closeFileLinkMenu();
      return;
    }
    if (
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey &&
      !ev.isComposing &&
      (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp')
    ) {
      const interceptedModelBtn = findInterceptedModelTrigger(ev);
      if (interceptedModelBtn) {
        ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        ev.preventDefault();
        if (ev.repeat) return;
        const keepOpen = ev.key === 'ArrowDown' || ev.key === 'ArrowUp';
        openPeriodicFromModelTrigger(interceptedModelBtn, { keepOpen });
        return;
      }
    }
    if (
      ev.key === 'Enter' &&
      !ev.shiftKey &&
      !ev.isComposing &&
      ev.target?.closest &&
      ev.target.closest('[data-testid="agent-input-box"]')
    ) {
      markUserSubmitted();
    }
  }

  let popoverDraftRaf = 0;
  let popoverDraftTimer = 0;

  function flushLiveDraftPopoverUpdate() {
    popoverDraftRaf = 0;
    popoverDraftTimer = 0;
    if (destroyed || !openPopover || !openPopover.isConnected) return;
    const latest =
      activeTrajCache.get(openPopoverCascadeId)?.data ||
      openPopoverAnchor?.closest?.('.surface-composer-card')?._agCsLastData ||
      null;
    const card =
      openPopoverAnchor?.closest?.('.surface-composer-card') ||
      document.querySelector('[data-testid="agent-input-box"] .surface-composer-card');
    const { ring, draftEst } = getRingTelemetryForCard(card, latest);
    const draft = Number(draftEst.tokens || 0);
    const hasDraft = draft > 0;
    const isLowCtx = Boolean((latest?.calls > 0 || ring.usedTokens > 0) && ring.contextRemainingPct <= 20);
    const curLowCtxAttr = isLowCtx ? (ring.contextRemainingPct <= 10 ? 'danger' : 'warn') : '';
    const usedHero = openPopover.querySelector('[data-ag-live-used]');
    if (
      activeHudTab === 'breakdown' &&
      usedHero &&
      Boolean(openPopover._agCsHadDraft) === hasDraft &&
      (openPopover._agCsLowCtxAttr || '') === curLowCtxAttr
    ) {
      const lang = getLang();
      const ui = uiText(lang);
      const totalW = ring.maxTokens || 256000;
      const pctOf = (v) => Math.max(0, Math.min(100, (v / totalW) * 100)).toFixed(2);
      const remStr = `${formatCompactK(ring.remainingTokens)} / ${formatCompactK(totalW)} (${ring.contextRemainingPct.toFixed(1)}%)`;
      const usedStr = `${formatCompactK(ring.usedTokens)} (${ring.contextUsedPct.toFixed(1)}%)`;
      const remHero = openPopover.querySelector('[data-ag-live-rem-hero]');
      const draftSeg = openPopover.querySelector('[data-ag-live-draft-seg]');
      const kpiRemV = openPopover.querySelector('[data-ag-live-kpi-rem-v]');
      const kpiRemSub = openPopover.querySelector('[data-ag-live-kpi-rem-sub]');
      const draftLabel = openPopover.querySelector('[data-ag-live-draft-label]');
      const draftVal = openPopover.querySelector('[data-ag-live-draft-val]');
      const remVal = openPopover.querySelector('[data-ag-live-rem-val]');

      if (remHero) {
        remHero.style.color = ring.color;
        remHero.textContent = `${ui.remAvailLabel || 'Remaining'} ${remStr}`;
      }
      usedHero.textContent = `${ui.usedWord || 'Used'} ${usedStr}${hasDraft ? ` · ${ui.draftWord || 'Draft'} +${formatCompactK(draft)}` : ''}`;
      if (draftSeg) draftSeg.style.width = `${pctOf(draft)}%`;
      if (kpiRemV) {
        kpiRemV.style.color = ring.color;
        kpiRemV.innerHTML = `${formatCompactK(ring.remainingTokens)} <small>(${ring.contextRemainingPct.toFixed(1)}%)</small>`;
      }
      if (kpiRemSub) {
        kpiRemSub.textContent = `${ui.usedWord || 'Used'} ${formatCompactK(ring.usedTokens)} / ${formatCompactK(totalW)}`;
      }
      if (draftLabel) {
        draftLabel.textContent =
          typeof ui.liveDraftN === 'function' ? ui.liveDraftN(draftEst.chars) : `Live Draft (${draftEst.chars} chars)`;
      }
      if (draftVal) {
        draftVal.innerHTML = `${formatCompactK(draft)} <small>(${((draft / totalW) * 100).toFixed(1)}%)</small>`;
      }
      if (remVal) {
        remVal.innerHTML = `${formatCompactK(ring.remainingTokens)} <small>(${((ring.remainingTokens / totalW) * 100).toFixed(1)}%)</small>`;
      }
      return;
    }
    renderContextPopoverContent(openPopover, latest, openPopoverCascadeId);
    if (openPopoverAnchor) positionPopoverAboveAnchor(openPopover, openPopoverAnchor);
  }

  function scheduleLiveDraftPopoverUpdate() {
    if (popoverDraftRaf || popoverDraftTimer || destroyed) return;
    if (typeof requestAnimationFrame === 'function') {
      popoverDraftRaf = requestAnimationFrame(flushLiveDraftPopoverUpdate);
    } else {
      popoverDraftTimer = setTimeout(flushLiveDraftPopoverUpdate, 16);
    }
  }

  function getFocusedComposerEditor() {
    const activeEl = document.activeElement;
    if (!activeEl || !activeEl.closest) return null;
    const ed = activeEl.closest('[data-testid="agent-input-box"] [contenteditable="true"]');
    return ed || null;
  }

  function onDocCaretEvent(ev) {
    const type = ev?.type || '';
    const isTyping = type === 'input' || type === 'keyup' || type === 'compositionupdate' || type === 'compositionend';
    const immediate = type === 'focusin' || type === 'mouseup' || type === 'transitionend';
    const activeEd = getFocusedComposerEditor();

    if (type === 'scroll') {
      if (!activeEd) {
        if (anySmoothCaretVisible) queueSmoothCaret(false, false);
        return;
      }
      const target = ev?.target;
      const affectsEditor =
        target === document ||
        target === document.documentElement ||
        target === document.body ||
        target === activeEd ||
        (target && typeof target.contains === 'function' && target.contains(activeEd)) ||
        (typeof activeEd.contains === 'function' && activeEd.contains(target));
      if (!affectsEditor) return;
      queueSmoothCaret(false, false);
      return;
    }

    if (type === 'selectionchange' || type === 'keyup' || type === 'mouseup') {
      if (!activeEd && !anySmoothCaretVisible) return;
    }

    if (type === 'focusin') {
      const targetInInput = Boolean(ev?.target?.closest && ev.target.closest('[data-testid="agent-input-box"]'));
      if (!activeEd && !targetInInput && !anySmoothCaretVisible) return;
    }

    queueSmoothCaret(isTyping, immediate);
    if (type === 'input') {
      if (ev?.target?.closest && ev.target.closest('[data-testid="agent-input-box"]')) {
        scheduleSync();
      }
      if (openPopover && openPopover.isConnected) {
        scheduleLiveDraftPopoverUpdate();
      }
    }
  }

  function onDocTransitionEnd(ev) {
    if (ev?.target?.closest && ev.target.closest('[data-testid="agent-input-box"]')) {
      queueSmoothCaret(false, true);
    }
  }

  function onWindowResize() {
    if (destroyed || pinnedDock.dispatchingHostResize) return;
    if (openFileMenu) closeFileLinkMenu();
    if (openPopover && openPopover.isConnected && openPopoverAnchor && openPopoverAnchor.isConnected) {
      positionPopoverAboveAnchor(openPopover, openPopoverAnchor);
    }
    if (openEffortPop && openEffortPop.isConnected) {
      positionEffortPopover(openEffortPop, openEffortAnchor || openEffortModelBtn);
      if (typeof openEffortPop._syncEffortKnob === 'function') {
        openEffortPop._syncEffortKnob(true);
      }
    }
    syncPinnedStudioDock();
  }

  function isDockStateAttrMutation(m) {
    if (!m || m.type !== 'attributes') return false;
    const attr = m.attributeName;
    if (
      attr !== 'data-aux-pane-open' &&
      attr !== 'data-active-tab-id' &&
      attr !== 'data-cascade-id' &&
      attr !== 'data-visible' &&
      attr !== 'data-split-overlaid' &&
      attr !== 'data-split-transition'
    ) {
      return false;
    }
    const targetEl = m.target && typeof m.target.closest === 'function' ? m.target : m.target?.parentElement;
    if (!targetEl || typeof targetEl.closest !== 'function') return false;
    if (attr === 'data-split-transition') {
      return Boolean(targetEl.matches?.('[data-testid="aux-pane-split"]'));
    }
    if (attr === 'data-split-overlaid') {
      return Boolean(targetEl.parentElement?.matches?.('[data-testid="aux-pane-split"]'));
    }
    if (attr === 'data-aux-pane-open') {
      return Boolean(
        targetEl.hasAttribute?.('data-aux-pane-open') ||
          targetEl.closest('[data-testid="aux-pane-split"], [data-aux-pane-open]')
      );
    }
    if (attr === 'data-cascade-id') {
      return Boolean(
        targetEl.matches?.('[data-testid="conversation-view"], [data-testid="agent-input-box"]') ||
          targetEl.closest('[data-testid="conversation-view"]')
      );
    }
    if (attr === 'data-visible') {
      return Boolean(
        targetEl.matches?.('[data-testid="sidecar-iframe-slot"], [data-testid="conversation-view"]')
      );
    }
    return Boolean(
      targetEl.hasAttribute?.('data-side-panel-strip') ||
        targetEl.closest('[data-side-panel-strip], [data-testid="aux-pane-split"]')
    );
  }

  function isIgnorableMutation(m) {
    if (isOwnPluginNode(m.target)) return true;
    if (m.type === 'attributes' && m.target !== document.body && m.target !== document.documentElement) {
      return !isDockStateAttrMutation(m);
    }
    const targetEl = m.target && typeof m.target.closest === 'function' ? m.target : m.target?.parentElement;
    if (m.type === 'characterData') {
      if (!targetEl || typeof targetEl.closest !== 'function') return true;
      return !targetEl.closest('[data-testid="conversation-view"], [data-testid="agent-input-box"]');
    }
    if (
      m.type === 'childList' &&
      targetEl &&
      typeof targetEl.closest === 'function' &&
      targetEl.closest('.monaco-editor, .xterm') &&
      !targetEl.closest('[data-testid="agent-input-box"]')
    ) {
      return true;
    }
    return false;
  }

  let dockSyncHandle = 0;
  let dockSyncIsRaf = false;
  let dockSyncQueued = false;
  function cancelScheduledDockSync() {
    if (dockSyncHandle) {
      if (dockSyncIsRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(dockSyncHandle);
      } else {
        clearTimeout(dockSyncHandle);
      }
      dockSyncHandle = 0;
    }
    dockSyncIsRaf = false;
    dockSyncQueued = false;
  }
  function scheduleDockSync() {
    if (destroyed || dockSyncQueued || syncQueued) return;
    dockSyncQueued = true;
    if (!document.hidden && typeof requestAnimationFrame === 'function') {
      dockSyncIsRaf = true;
      dockSyncHandle = requestAnimationFrame(() => {
        dockSyncHandle = 0;
        dockSyncIsRaf = false;
        dockSyncQueued = false;
        syncPinnedStudioDock();
      });
    } else {
      dockSyncIsRaf = false;
      dockSyncHandle = setTimeout(() => {
        dockSyncHandle = 0;
        dockSyncQueued = false;
        syncPinnedStudioDock();
      }, 50);
    }
  }

  let charDataThrottleTimer = null;
  const observer = new MutationObserver((mutations) => {
    if (mutations.length === 0) return;
    let hasRelevant = false;
    let hasNonCharData = false;
    let hasDockAttrOnly = false;
    for (let i = 0; i < mutations.length; i += 1) {
      const m = mutations[i];
      if (isIgnorableMutation(m)) continue;
      if (isDockStateAttrMutation(m)) {
        hasDockAttrOnly = true;
        if (sideQuestionRestoreActive && m.target) {
          if (m.attributeName === 'data-active-tab-id') {
            const curTab = m.target.getAttribute('data-active-tab-id') || '';
            if (curTab === sideQuestionRestoreActive.tabId) {
              sideQuestionRestoreActive.sawTargetActive = true;
            } else if (curTab && curTab !== sideQuestionRestoreActive.tabId) {
              cancelSideQuestionRestore();
            }
          } else if (m.attributeName === 'data-aux-pane-open') {
            const auxOpen = m.target.getAttribute('data-aux-pane-open');
            if (auxOpen === 'false' && sideQuestionRestoreActive.sawTargetActive) {
              cancelSideQuestionRestore();
            }
          }
        }
        continue;
      }
      hasRelevant = true;
      if (m.type !== 'characterData') {
        hasNonCharData = true;
        break;
      }
    }
    if (hasRelevant && hasNonCharData) {
      cancelScheduledDockSync();
      scheduleSync();
      return;
    }
    if (hasDockAttrOnly) {
      scheduleDockSync();
    }
    if (!hasRelevant) return;
    if (!charDataThrottleTimer) {
      charDataThrottleTimer = setTimeout(() => {
        charDataThrottleTimer = null;
        if (!destroyed) scheduleSync();
      }, 250);
    }
  });

  const DOC_LISTENERS = [
    ['pointerdown', onDocPointerDown],
    ['mousedown', onDocMouseDown],
    ['click', onDocClick],
    ['contextmenu', onDocContextMenu],
    ['keydown', onDocKeyDown],
    ['keyup', onDocCaretEvent],
    ['mouseup', onDocCaretEvent],
    ['input', onDocCaretEvent],
    ['selectionchange', onDocCaretEvent],
    ['focusin', onDocCaretEvent],
    ['focusout', onDocCaretEvent],
    ['scroll', onDocCaretEvent],
    ['compositionupdate', onDocCaretEvent],
    ['compositionend', onDocCaretEvent],
    ['transitionend', onDocTransitionEnd],
  ];

  let pollTimer = null;
  let coreTornDown = false;
  function teardownCore() {
    if (coreTornDown) return;
    coreTornDown = true;
    destroyed = true;
    cancelScheduledSync();
    cancelScheduledDockSync();
    cancelPendingEffortBadgeRaf();
    detachAllConvoSyncIframes();
    cachedHostReduxStore = null;
    cachedHostReduxRootEl = null;
    cachedHostReduxProviderFiber = null;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (charDataThrottleTimer) {
      clearTimeout(charDataThrottleTimer);
      charDataThrottleTimer = null;
    }
    if (storeDebounce) {
      clearTimeout(storeDebounce);
      storeDebounce = null;
    }
    for (const id of submitSyncTimers) clearTimeout(id);
    submitSyncTimers.clear();
    cancelSideQuestionRestore();
    if (caretRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(caretRaf);
      caretRaf = 0;
    }
    if (popoverDraftRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(popoverDraftRaf);
      popoverDraftRaf = 0;
    }
    if (popoverDraftTimer) {
      clearTimeout(popoverDraftTimer);
      popoverDraftTimer = 0;
    }
    if (storeUnsub) {
      try {
        storeUnsub();
      } catch {}
      storeUnsub = null;
    }
    unwatchAllAgentStateProviders();
    try {
      observer.disconnect();
    } catch {}
    for (const [evName, handler] of DOC_LISTENERS) {
      try {
        document.removeEventListener(evName, handler, true);
      } catch {}
    }
    if (typeof window.removeEventListener === 'function') {
      try {
        window.removeEventListener('resize', onWindowResize);
      } catch {}
    }
    if (Array.isArray(globalThis.__agCsCleanups)) {
      const idx = globalThis.__agCsCleanups.indexOf(teardownCore);
      if (idx >= 0) globalThis.__agCsCleanups.splice(idx, 1);
    }
  }

  globalThis.__agCsCleanups = Array.isArray(globalThis.__agCsCleanups) ? globalThis.__agCsCleanups : [];
  globalThis.__agCsCleanups.push(teardownCore);

  let lifecycleStarted = false;
  function startLifecycle() {
    if (destroyed || lifecycleStarted || !document.documentElement) return;
    lifecycleStarted = true;
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-aux-pane-open', 'data-active-tab-id', 'data-cascade-id', 'data-visible', 'data-split-overlaid', 'data-split-transition'],
    });
    for (const [evName, handler] of DOC_LISTENERS) {
      document.addEventListener(evName, handler, true);
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', onWindowResize);
    }

    pollTimer = setInterval(() => {
      if (destroyed) return;
      applyRootAttrs();
      if (document.querySelector('.agy-home') && cfg.homeLayout === 'studio') {
        refreshUsageRollup(false);
      }
      if (document.querySelector('[data-testid="conversation-view"], [data-testid="agent-input-box"]')) {
        scheduleSync();
      }
    }, Math.max(1000, Number(cfg.pollIntervalMs) || 2500));

    ensureHooks(true);
    applyRootAttrs();
    runSync();
    if (document.querySelector('.agy-home') && cfg.homeLayout === 'studio') {
      refreshUsageRollup(false);
    }
  }

  // ── In-Chat Local Script Output Card (0-Token, Never Triggers AI Turn) ──
  let scriptChatCardEl = null;
  let scriptChatResizeHandler = null;
  let scriptChatKeyHandler = null;

  function closeScriptOutputCard() {
    if (scriptChatResizeHandler) {
      window.removeEventListener('resize', scriptChatResizeHandler);
      scriptChatResizeHandler = null;
    }
    if (scriptChatKeyHandler) {
      document.removeEventListener('keydown', scriptChatKeyHandler, true);
      scriptChatKeyHandler = null;
    }
    if (scriptChatCardEl) {
      try {
        scriptChatCardEl.remove();
      } catch {}
      scriptChatCardEl = null;
    }
  }

  function positionScriptOutputCard() {
    if (!scriptChatCardEl || !scriptChatCardEl.isConnected) return;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const ib = document.querySelector('[data-testid="agent-input-box"]');
    const conv = document.querySelector('[data-testid="conversation-view"]');
    const ibRect = ib && typeof ib.getBoundingClientRect === 'function' ? ib.getBoundingClientRect() : null;
    const convRect = conv && typeof conv.getBoundingClientRect === 'function' ? conv.getBoundingClientRect() : null;

    let left;
    let width;
    let bottom;
    let maxHeight;

    if (ibRect && ibRect.width > 220 && ibRect.top > 140) {
      width = Math.min(Math.max(ibRect.width, 420), vw - 32);
      left = Math.max(16, Math.min(vw - width - 16, ibRect.left + (ibRect.width - width) / 2));
      bottom = Math.max(16, vh - ibRect.top + 12);
      maxHeight = Math.max(180, Math.min(Math.round(vh * 0.56), Math.round(ibRect.top - 84)));
    } else if (convRect && convRect.width > 260) {
      width = Math.min(760, convRect.width - 32);
      left = Math.max(16, Math.min(vw - width - 16, convRect.left + (convRect.width - width) / 2));
      bottom = 24;
      maxHeight = Math.max(200, Math.round(vh * 0.6));
    } else {
      width = Math.min(740, vw - 32);
      left = Math.max(16, Math.round((vw - width) / 2));
      bottom = 24;
      maxHeight = Math.max(200, Math.round(vh * 0.6));
    }

    scriptChatCardEl.style.left = Math.round(left) + 'px';
    scriptChatCardEl.style.width = Math.round(width) + 'px';
    scriptChatCardEl.style.bottom = Math.round(bottom) + 'px';
    scriptChatCardEl.style.maxHeight = Math.round(maxHeight) + 'px';
  }

  function appendInlineRichText(parent, text) {
    const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const tok = m[0];
      if (tok.startsWith('**') && tok.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = tok.slice(2, -2);
        parent.appendChild(strong);
      } else if (tok.startsWith('`') && tok.endsWith('`')) {
        const code = document.createElement('code');
        code.className = 'ag-cs-script-md-code';
        code.textContent = tok.slice(1, -1);
        parent.appendChild(code);
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderScriptOutputBody(container, payload) {
    const combined = String(payload?.combined || '').trim();
    const stderrIdx = combined.indexOf('[stderr]\n');
    const mainText = stderrIdx >= 0 ? combined.slice(0, stderrIdx).trim() : combined;
    const stderrText = stderrIdx >= 0 ? combined.slice(stderrIdx + '[stderr]\n'.length).trim() : '';

    if (mainText) {
      const lines = mainText.split(/\r?\n/);
      let curList = null;
      const flushList = () => {
        if (curList) {
          container.appendChild(curList);
          curList = null;
        }
      };
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          flushList();
          continue;
        }
        const hMatch = line.match(/^#{1,4}\s+(.+)$/);
        if (hMatch) {
          flushList();
          const h = document.createElement('div');
          h.className = 'ag-cs-script-md-h';
          appendInlineRichText(h, hMatch[1].trim());
          container.appendChild(h);
          continue;
        }
        const liMatch = line.match(/^\s*[-*•]\s+(.+)$/);
        if (liMatch) {
          if (!curList) {
            curList = document.createElement('ul');
            curList.className = 'ag-cs-script-md-list';
          }
          const li = document.createElement('li');
          appendInlineRichText(li, liMatch[1]);
          curList.appendChild(li);
          continue;
        }
        if (curList && /^\s{2,}/.test(rawLine) && curList.lastElementChild) {
          curList.lastElementChild.appendChild(document.createElement('br'));
          appendInlineRichText(curList.lastElementChild, line.trim());
          continue;
        }
        flushList();
        const p = document.createElement('p');
        p.className = 'ag-cs-script-md-p';
        appendInlineRichText(p, line);
        container.appendChild(p);
      }
      flushList();
    }

    if (stderrText) {
      const pre = document.createElement('pre');
      pre.className = 'ag-cs-script-md-stderr';
      pre.textContent = stderrText;
      container.appendChild(pre);
    }

    if (!mainText && !stderrText) {
      const empty = document.createElement('p');
      empty.className = 'ag-cs-script-md-p';
      empty.textContent = '(empty output)';
      container.appendChild(empty);
    }
  }

  function showScriptOutputInChat(payload) {
    if (destroyed || !document.body) return { ok: false, status: 'not_ready' };
    closeScriptOutputCard();

    const lang = getLang();
    const isEn = lang === 'en';
    const isJa = lang === 'ja';
    const isTrad = lang === 'zh-TW' || lang === 'yue';
    const copyLabel = isEn ? 'Copy' : isJa ? 'コピー' : isTrad ? '複製' : '复制';
    const copiedLabel = isEn ? 'Copied' : isJa ? 'コピー済み' : isTrad ? '已複製' : '已复制';
    const collapseLabel = isEn ? 'Collapse' : isJa ? '折りたたむ' : '收起';
    const expandLabel = isEn ? 'Expand' : isJa ? '展開' : isTrad ? '展開' : '展开';

    const ok = Boolean(payload?.ok);
    const durMs = Number(payload?.durationMs || 0);
    const exitCode = payload?.exitCode ?? (ok ? 0 : 1);
    const statusText = ok
      ? (isEn ? `OK · ${(durMs / 1000).toFixed(1)}s` : isJa ? `成功 · ${(durMs / 1000).toFixed(1)}s` : `成功 · ${(durMs / 1000).toFixed(1)}s`)
      : (isEn ? `Exit ${exitCode}` : isJa ? `終了 ${exitCode}` : isTrad ? `失敗 (${exitCode})` : `失败 (${exitCode})`);

    const card = document.createElement('div');
    card.className = 'ag-cs-script-chat-card';
    card.setAttribute('data-ag-no-i18n', '1');
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', String(payload?.name || 'Script Output'));

    const head = document.createElement('div');
    head.className = 'ag-cs-script-chat-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ag-cs-script-chat-title-wrap';
    const dot = document.createElement('span');
    dot.className = 'ag-cs-script-chat-dot' + (ok ? '' : ' is-err');
    const nameEl = document.createElement('span');
    nameEl.className = 'ag-cs-script-chat-name';
    nameEl.textContent = String(payload?.name || 'Script Output');
    const meta = document.createElement('span');
    meta.className = 'ag-cs-script-chat-meta' + (ok ? '' : ' is-err');
    meta.textContent = statusText;
    titleWrap.append(dot, nameEl, meta);

    const actions = document.createElement('div');
    actions.className = 'ag-cs-script-chat-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ag-cs-script-chat-btn';
    copyBtn.textContent = copyLabel;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(payload?.combined || ''));
        copyBtn.textContent = copiedLabel;
        setTimeout(() => {
          if (copyBtn.isConnected) copyBtn.textContent = copyLabel;
        }, 1400);
      } catch {}
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ag-cs-script-chat-btn';
    toggleBtn.textContent = collapseLabel;
    toggleBtn.addEventListener('click', () => {
      const nextCollapsed = !card.classList.contains('is-collapsed');
      card.classList.toggle('is-collapsed', nextCollapsed);
      toggleBtn.textContent = nextCollapsed ? expandLabel : collapseLabel;
      positionScriptOutputCard();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ag-cs-script-chat-btn is-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', closeScriptOutputCard);

    actions.append(copyBtn, toggleBtn, closeBtn);
    head.append(titleWrap, actions);

    const body = document.createElement('div');
    body.className = 'ag-cs-script-chat-body';
    renderScriptOutputBody(body, payload);

    card.append(head, body);
    document.body.appendChild(card);
    scriptChatCardEl = card;
    positionScriptOutputCard();

    scriptChatResizeHandler = () => positionScriptOutputCard();
    window.addEventListener('resize', scriptChatResizeHandler);
    scriptChatKeyHandler = (ev) => {
      if (ev.key === 'Escape') closeScriptOutputCard();
    };
    document.addEventListener('keydown', scriptChatKeyHandler, true);

    return { ok: true };
  }

  window.__agClaudeStudio = {
    version: VERSION,
    codeHash: CODE_HASH,
    onFileLinkActionResult(result) {
      if (destroyed || cfg.fileLinkContextMenu === false) return;
      const requestId = String(result?.requestId || '');
      const pending = pendingFileActions.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingFileActions.delete(requestId);
      const text = uiText(getLang());
      showFileLinkToast(result.ok
        ? (pending.mode === 'open' ? (text.fileMenuOpened || 'File opened') : (text.fileMenuRevealed || 'Shown in folder'))
        : (text.fileMenuActionFailed || 'File action failed'), !result.ok);
    },
    refreshConfig(next) {
      if (next && typeof next === 'object') {
        runtimeInitConfig = { ...runtimeInitConfig, ...next };
        cfg = loadSettings(runtimeInitConfig);
      } else {
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS_KEY) || '{}');
          cfg = { ...runtimeInitConfig, ...cfg, ...saved };
        } catch {}
      }
      applyRootAttrs();
      if (cfg.fileLinkContextMenu === false) {
        if (openFileMenu) closeFileLinkMenu();
        for (const pending of pendingFileActions.values()) clearTimeout(pending.timer);
        pendingFileActions.clear();
        clearFileLinkToast();
      }
      refreshOpenEffortPopover();
      refreshOpenPeriodicSelector();
      runSync();
      scheduleSync();
    },
    openPeriodicSelector(triggerBtn, modelBtn) {
      openPeriodicSelector(triggerBtn, modelBtn);
    },
    withNativeModelMenuBypass(modelBtn, fn) {
      return withNativeModelMenuBypass(modelBtn, fn);
    },
    openEffortPopover(badgeEl, modelBtn) {
      const b = badgeEl || document.querySelector('[data-testid="model-selector-trigger"] .ag-cs-effort-badge, [data-testid="model-selector-trigger"] [data-ag-cs-effort]');
      const m = modelBtn || b?.closest?.('[data-testid="model-selector-trigger"]') || document.querySelector('[data-testid="model-selector-trigger"]');
      openEffortPopover(b, m);
    },
    openContextPopover(anchorEl, tab) {
      const cands = Array.from(
        document.querySelectorAll('.ag-cs-context-ring, .ag-cs-inline-stats, .ag-cs-hud-footer-chip, .ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar')
      );
      const a =
        anchorEl ||
        cands.find((el) => {
          const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
          return r && r.width > 0 && r.height > 0;
        }) ||
        cands[0];
      const card = a?.closest?.('.surface-composer-card');
      const ib = a?.closest?.('[data-testid="agent-input-box"]') || document.querySelector('[data-testid="agent-input-box"]');
      const cid = resolveCascadeId(ib);
      const data = (cid && activeTrajCache.get(cid)?.data) || card?._agCsLastData || null;
      if (a) openContextPopover(a, data, tab || 'breakdown');
    },
    openStudioPane(opts) {
      return openStudioPane(opts);
    },
    openRightSidecarPane(target, opts) {
      return openRightSidecarPane(target, opts);
    },
    setPinnedDockCollapsed(next) {
      setPinnedDockCollapsed(next);
    },
    showScriptOutputInChat(payload) {
      return showScriptOutputInChat(payload);
    },
    closeScriptOutputCard() {
      closeScriptOutputCard();
    },
    fillBtwCommand(scopeEl, opts) {
      return fillBtwCommand(scopeEl, opts);
    },
    fillCompactCommand(scopeEl) {
      return fillCompactCommand(scopeEl);
    },
    getSideQuestionsState(conversationId) {
      return getSideQuestionsState(conversationId);
    },
    openSideQuestion(opts) {
      return openSideQuestion(opts);
    },
    getState() {
      return {
        cfg: { ...cfg },
        usageRecordsCount: usageRecords.size,
        hasPanel: Boolean(panelEl && panelEl.isConnected),
        hasRipple: Boolean(rippleMount && rippleMount.canvas.isConnected),
        hasCrab: Boolean(crabState.root && crabState.root.isConnected),
        hasPinnedDock: Boolean(pinnedDock.el && pinnedDock.el.isConnected),
        pinnedDockCollapsed: Boolean(pinnedDock.collapsed),
        pinnedDockSolo: Boolean(pinnedDock.soloMode),
        pinnedDockAuxMaximized: Boolean(pinnedDock.auxMaximized),
        hasSmoothCaret: Boolean(document.querySelector('.ag-cs-smooth-caret')),
        hasEffortPopover: Boolean(openEffortPop && openEffortPop.isConnected),
        hasContextPopover: Boolean(openPopover && openPopover.isConnected),
        hasPeriodicSelector: Boolean(openPsDrawer && openPsDrawer.isConnected),
      };
    },
    destroy() {
      for (const pending of pendingFileActions.values()) clearTimeout(pending.timer);
      pendingFileActions.clear();
      teardownCore();
      for (const fn of [
        teardownPinnedStudioDock,
        closePeriodicSelector,
        closeContextPopover,
        closeEffortPopover,
        closeFileLinkMenu,
        clearFileLinkToast,
        closeScriptOutputCard,
        teardownSmoothCarets,
        clearTurnBadges,
        unmountRipple,
        unmountPanelSeat,
        unmountCrab,
        cleanupUsageMonitorFooterSplit,
        cleanupLegacyAuroraArtifacts,
        restoreGreetings,
        teardownPageTranslate,
        () => {
          for (const unsub of Array.from(lexCompactUnsubs)) {
            try {
              if (typeof unsub === 'function') unsub();
            } catch {}
          }
          lexCompactUnsubs.clear();
        },
        () => domTranslator && typeof domTranslator.destroy === 'function' && domTranslator.destroy(),
      ]) {
        try {
          fn();
        } catch {}
      }
      document.querySelectorAll('[data-ag-cs-placeholder]').forEach((el) => el.removeAttribute('data-ag-cs-placeholder'));
      document.querySelectorAll('[data-ag-cs-effort]').forEach((el) => {
        el.removeAttribute('data-ag-cs-effort');
        el.classList.remove('ag-cs-effort-badge');
      });
      document.querySelectorAll('[data-ag-cs-has-effort]').forEach((el) => {
        el.removeAttribute('data-ag-cs-has-effort');
        el.style?.removeProperty?.('--ag-cs-effort-cut');
      });
      document.querySelectorAll('[data-ag-cs-inline-model-wrap]').forEach((el) => {
        el.removeAttribute('data-ag-cs-inline-model-wrap');
      });
      document.querySelectorAll('[data-ag-cs-queued], [data-ag-cs-takeover]').forEach((el) => {
        el.removeAttribute('data-ag-cs-queued');
        el.removeAttribute('data-ag-cs-takeover');
        el.style.removeProperty('margin-bottom');
      });
      document.querySelectorAll('[data-ag-cs-rim]').forEach((el) => {
        el.removeAttribute('data-ag-cs-rim');
        el.style.removeProperty('--ag-cs-rim-color');
      });
      if (psSyncState.timer) {
        clearTimeout(psSyncState.timer);
        psSyncState.timer = null;
      }
      try {
        delete window.__agCsOnPeriodicSyncResult;
      } catch {}
      document.getElementById(PERIODIC_DYNAMIC_STYLE_ID)?.remove();
      document
        .querySelectorAll(
          '.ag-cs-pinned-dock, .ag-cs-inline-stats, .ag-cs-periodic-trigger, .ag-cs-orch-switch, .ag-cs-ps-backdrop, .ag-cs-ps-drawer, .ag-cs-context-ring, .ag-cs-um-ctx-proxy, .ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar, .ag-cs-hud-rim-progress, .ag-cs-hud-footer-chip, .ag-cs-compact-hint, .ag-cs-page-translate-btn, .ag-cs-file-menu, .ag-cs-file-toast, .ag-cs-script-chat-card, #' +
            SETTINGS_SEC_ID
        )
        .forEach((el) => el.remove());
      const html = document.documentElement;
      if (html) {
        for (const attr of [
          'data-ag-cs-style',
          'data-ag-cs-palette',
          'data-ag-cs-glass',
          'data-ag-cs-home',
          'data-ag-cs-composer',
          'data-ag-cs-logo-ink',
          'data-ag-cs-gemini-loader',
          'data-ag-cs-sidebar',
          'data-ag-cs-sidebar-compact',
          'data-ag-cs-hud-compact',
          'data-ag-cs-effort-slider',
          'data-ag-cs-effort-accent',
          'data-ag-cs-periodic',
          'data-ag-cs-lang',
          'data-ag-cs-cjk',
        ]) {
          html.removeAttribute(attr);
        }
      }
    },
  };

  if (document.documentElement) {
    startLifecycle();
  } else if (typeof document.addEventListener === 'function') {
    const onReady = () => {
      if (document.documentElement) {
        document.removeEventListener('readystatechange', onReady);
        document.removeEventListener('DOMContentLoaded', onReady);
        startLifecycle();
      }
    };
    document.addEventListener('readystatechange', onReady);
    document.addEventListener('DOMContentLoaded', onReady);
  }
});
