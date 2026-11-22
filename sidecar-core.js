(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsSidecarCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const SWARM_URL_PREFIX = 'plugin://swarm--';

  // User-generated content & identifiers in Swarm Board sidecar:
  // protected from prose translation while still allowing nested buttons/controls.
  const SWARM_CONTENT_SELECTORS = Object.freeze([
    '.msg-body',
    '.msg-author',
    '.msg-to',
    '.chip-name',
    '.node-label',
    '.ov-who',
    '#swarm-title',
    '#ov-frame',
    '#raw',
    '.o2-goal b',
    '.o2-goal p',
    '.o2-runt',
    '.o2-runnote',
    '.o2-runsum',
    '.o2-tht b',
    '.o2-tt',
    '.o2-askb b',
    '.o2-askl',
    '.o2-rcap',
    '.o2-mauth',
    '.o2-mrole',
    '.o2-mnow',
    '.o2-sttxt',
    '.gif-modal-title',
  ]);

  // Timestamp containers in Swarm Board sidecar: relative time rules only.
  const SWARM_NAME_SELECTORS = Object.freeze(['.ts', '.o2-mts', '.o2-rwhen']);

  // Allow translating <option> labels inside Swarm's native <select> filters.
  const SWARM_CONTROL_SELECTORS = Object.freeze(['select option']);

  const SWARM_EXTRA_RULES = Object.freeze({
    'zh-CN': [
      ['^From ([^\\s]+)$', '', '来自 $1'],
      ['^To ([^\\s]+)$', '', '发给 $1'],
      ['^#([^\\s]+) is archived: this addresses nobody$', '', '#$1 已归档：此消息不会送达任何人'],
      ['^Everyone in #([^\\s]+)$', '', '#$1 中的所有人'],
      ['^Posted in #([^\\s]+); click to show only #([^\\s]+)$', '', '发布于 #$1；点击仅显示 #$2'],
    ],
    'zh-TW': [
      ['^From ([^\\s]+)$', '', '來自 $1'],
      ['^To ([^\\s]+)$', '', '發給 $1'],
      ['^#([^\\s]+) is archived: this addresses nobody$', '', '#$1 已封存：此訊息不會送達任何人'],
      ['^Everyone in #([^\\s]+)$', '', '#$1 中的所有人'],
      ['^Posted in #([^\\s]+); click to show only #([^\\s]+)$', '', '發佈於 #$1；點擊僅顯示 #$2'],
    ],
    yue: [
      ['^From ([^\\s]+)$', '', '來自 $1'],
      ['^To ([^\\s]+)$', '', '發畀 $1'],
      ['^#([^\\s]+) is archived: this addresses nobody$', '', '#$1 已經封存：呢條訊息唔會送到畀任何人'],
      ['^Everyone in #([^\\s]+)$', '', '#$1 入面所有人'],
      ['^Posted in #([^\\s]+); click to show only #([^\\s]+)$', '', '發喺 #$1；撳一下淨係睇 #$2'],
    ],
    ja: [
      ['^From ([^\\s]+)$', '', '送信者: $1'],
      ['^To ([^\\s]+)$', '', '宛先: $1'],
      ['^#([^\\s]+) is archived: this addresses nobody$', '', '#$1 はアーカイブ済みのため誰にも届きません'],
      ['^Everyone in #([^\\s]+)$', '', '#$1 の全員'],
      ['^Posted in #([^\\s]+); click to show only #([^\\s]+)$', '', '#$1 に投稿；クリックで #$2 のみ表示'],
    ],
  });

  function isSidecarLocation(loc) {
    if (!loc || typeof loc !== 'object') return false;
    const protocol = typeof loc.protocol === 'string' ? loc.protocol.toLowerCase() : '';
    const href = typeof loc.href === 'string' ? loc.href.toLowerCase() : '';
    return protocol === 'plugin:' || href.startsWith('plugin://');
  }

  function isSwarmSidecarUrl(url) {
    return typeof url === 'string' && url.toLowerCase().startsWith(SWARM_URL_PREFIX);
  }

  function getSwarmExtraRules(lang) {
    return SWARM_EXTRA_RULES[lang] || [];
  }

  function mountSidecar(initialConfig) {
    const VERSION = 2;
    const CODE_HASH = initialConfig?.codeHash || '';
    const win = typeof window !== 'undefined' ? window : globalThis;
    const doc = typeof document !== 'undefined' ? document : null;
    const i18nCore = globalThis.__agCsI18nCore;
    const i18nLocales = globalThis.__agCsLocales;

    if (
      win.__agClaudeStudio &&
      win.__agClaudeStudio.sidecar === true &&
      win.__agClaudeStudio.version === VERSION &&
      (!CODE_HASH || win.__agClaudeStudio.codeHash === CODE_HASH)
    ) {
      win.__agClaudeStudio.refreshConfig(initialConfig);
      return win.__agClaudeStudio;
    }

    if (win.__agClaudeStudio && typeof win.__agClaudeStudio.destroy === 'function') {
      try {
        win.__agClaudeStudio.destroy();
      } catch {}
      delete win.__agClaudeStudio;
    }
    if (win.__agClaudeStyle && typeof win.__agClaudeStyle.destroy === 'function') {
      try {
        win.__agClaudeStyle.destroy();
      } catch {}
      delete win.__agClaudeStyle;
    }
    if (win.__agCsI18n && typeof win.__agCsI18n.destroy === 'function') {
      try {
        win.__agCsI18n.destroy();
      } catch {}
      delete win.__agCsI18n;
    }

    const normalize =
      i18nCore && typeof i18nCore.normalizeLanguage === 'function'
        ? i18nCore.normalizeLanguage
        : (v) => (typeof v === 'string' && v ? v : 'zh-CN');

    const domTranslator =
      i18nCore && i18nLocales && typeof i18nCore.createDomTranslator === 'function'
        ? i18nCore.createDomTranslator(i18nLocales.resolveLocaleBundle, {
            content: SWARM_CONTENT_SELECTORS,
            names: SWARM_NAME_SELECTORS,
            controls: SWARM_CONTROL_SELECTORS,
            extraRules: getSwarmExtraRules,
          })
        : null;

    if (domTranslator) {
      win.__agCsI18n = domTranslator;
    }

    let currentLang = normalize(initialConfig?.language, 'zh-CN');

    function applyLang(lang) {
      currentLang = normalize(lang, 'zh-CN');
      if (doc?.documentElement) {
        doc.documentElement.setAttribute('data-ag-cs-lang', currentLang);
      }
      if (domTranslator && doc) {
        domTranslator.setLanguage(currentLang, doc);
      }
    }

    applyLang(currentLang);

    const api = {
      version: VERSION,
      codeHash: CODE_HASH,
      sidecar: true,
      refreshConfig(next) {
        if (next && typeof next === 'object' && Object.prototype.hasOwnProperty.call(next, 'language')) {
          applyLang(next.language);
        }
      },
      getState() {
        return {
          mounted: true,
          sidecar: true,
          language: currentLang,
        };
      },
      destroy() {
        if (domTranslator) {
          try {
            domTranslator.destroy();
          } catch {}
        }
        if (doc?.documentElement) {
          doc.documentElement.removeAttribute('data-ag-cs-lang');
          doc.documentElement.removeAttribute('data-ag-cs-cjk');
        }
        if (win.__agCsI18n === domTranslator) {
          delete win.__agCsI18n;
        }
        if (win.__agClaudeStudio === api) {
          delete win.__agClaudeStudio;
        }
      },
    };

    win.__agClaudeStudio = api;
    return api;
  }

  return {
    SWARM_URL_PREFIX,
    SWARM_CONTENT_SELECTORS,
    SWARM_NAME_SELECTORS,
    SWARM_CONTROL_SELECTORS,
    SWARM_EXTRA_RULES,
    isSidecarLocation,
    isSwarmSidecarUrl,
    getSwarmExtraRules,
    mountSidecar,
  };
});
