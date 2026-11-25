(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsPeriodicCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const PERIODIC_ELEMENTS = Object.freeze([
    // Row 1
    { row: 1, col: 1, num: 1, symbol: 'H', name: 'Hydrogen' },
    { row: 1, col: 18, num: 2, symbol: 'He', name: 'Helium' },

    // Row 2
    { row: 2, col: 1, num: 3, symbol: 'Li', name: 'Lithium' },
    { row: 2, col: 2, num: 4, symbol: 'Be', name: 'Beryllium' },
    { row: 2, col: 13, num: 5, symbol: 'B', name: 'Boron' },
    { row: 2, col: 14, num: 6, symbol: 'C', name: 'Carbon' },
    { row: 2, col: 15, num: 7, symbol: 'N', name: 'Nitrogen' },
    { row: 2, col: 16, num: 8, symbol: 'O', name: 'Oxygen' },
    { row: 2, col: 17, num: 9, symbol: 'F', name: 'Fluorine' },
    { row: 2, col: 18, num: 10, symbol: 'Ne', name: 'Neon' },

    // Row 3
    { row: 3, col: 1, num: 11, symbol: 'Na', name: 'Sodium' },
    { row: 3, col: 2, num: 12, symbol: 'Mg', name: 'Magnesium' },
    { row: 3, col: 13, num: 13, symbol: 'Al', name: 'Aluminum' },
    { row: 3, col: 14, num: 14, symbol: 'Si', name: 'Silicon' },
    { row: 3, col: 15, num: 15, symbol: 'P', name: 'Phosphorus' },
    { row: 3, col: 16, num: 16, symbol: 'S', name: 'Sulfur' },
    { row: 3, col: 17, num: 17, symbol: 'Cl', name: 'Chlorine' },
    { row: 3, col: 18, num: 18, symbol: 'Ar', name: 'Argon' },

    // Row 4
    { row: 4, col: 1, num: 19, symbol: 'K', name: 'Potassium' },
    { row: 4, col: 2, num: 20, symbol: 'Ca', name: 'Calcium' },
    { row: 4, col: 3, num: 21, symbol: 'Sc', name: 'Scandium' },
    { row: 4, col: 4, num: 22, symbol: 'Ti', name: 'Titanium' },
    { row: 4, col: 5, num: 23, symbol: 'V', name: 'Vanadium' },
    { row: 4, col: 6, num: 24, symbol: 'Cr', name: 'Chromium' },
    { row: 4, col: 7, num: 25, symbol: 'Mn', name: 'Manganese' },
    { row: 4, col: 8, num: 26, symbol: 'Fe', name: 'Iron' },
    { row: 4, col: 9, num: 27, symbol: 'Co', name: 'Cobalt' },
    { row: 4, col: 10, num: 28, symbol: 'Ni', name: 'Nickel' },
    { row: 4, col: 11, num: 29, symbol: 'Cu', name: 'Copper' },
    { row: 4, col: 12, num: 30, symbol: 'Zn', name: 'Zinc' },
    { row: 4, col: 13, num: 31, symbol: 'Ga', name: 'Gallium' },
    { row: 4, col: 14, num: 32, symbol: 'Ge', name: 'Germanium' },
    { row: 4, col: 15, num: 33, symbol: 'As', name: 'Arsenic' },
    { row: 4, col: 16, num: 34, symbol: 'Se', name: 'Selenium' },
    { row: 4, col: 17, num: 35, symbol: 'Br', name: 'Bromine' },
    { row: 4, col: 18, num: 36, symbol: 'Kr', name: 'Krypton' },

    // Row 5
    { row: 5, col: 1, num: 37, symbol: 'Rb', name: 'Rubidium' },
    { row: 5, col: 2, num: 38, symbol: 'Sr', name: 'Strontium' },
    { row: 5, col: 3, num: 39, symbol: 'Y', name: 'Yttrium' },
    { row: 5, col: 4, num: 40, symbol: 'Zr', name: 'Zirconium' },
    { row: 5, col: 5, num: 41, symbol: 'Nb', name: 'Niobium' },
    { row: 5, col: 6, num: 42, symbol: 'Mo', name: 'Molybdenum' },
    { row: 5, col: 7, num: 43, symbol: 'Tc', name: 'Technetium' },
    { row: 5, col: 8, num: 44, symbol: 'Ru', name: 'Ruthenium' },
    { row: 5, col: 9, num: 45, symbol: 'Rh', name: 'Rhodium' },
    { row: 5, col: 10, num: 46, symbol: 'Pd', name: 'Palladium' },
    { row: 5, col: 11, num: 47, symbol: 'Ag', name: 'Silver' },
    { row: 5, col: 12, num: 48, symbol: 'Cd', name: 'Cadmium' },
    { row: 5, col: 13, num: 49, symbol: 'In', name: 'Indium' },
    { row: 5, col: 14, num: 50, symbol: 'Sn', name: 'Tin' },
    { row: 5, col: 15, num: 51, symbol: 'Sb', name: 'Antimony' },
    { row: 5, col: 16, num: 52, symbol: 'Te', name: 'Tellurium' },
    { row: 5, col: 17, num: 53, symbol: 'I', name: 'Iodine' },
    { row: 5, col: 18, num: 54, symbol: 'Xe', name: 'Xenon' },

    // Row 6 (faded)
    { row: 6, col: 1, num: 55, symbol: 'Cs', name: 'Cesium', faded: true },
    { row: 6, col: 2, num: 56, symbol: 'Ba', name: 'Barium', faded: true },
    { row: 6, col: 3, num: '', symbol: '57-71', name: 'Lanthanides', isRange: true, faded: true },
    { row: 6, col: 4, num: 72, symbol: 'Hf', name: 'Hafnium', faded: true },
    { row: 6, col: 5, num: 73, symbol: 'Ta', name: 'Tantalum', faded: true },
    { row: 6, col: 6, num: 74, symbol: 'W', name: 'Tungsten', faded: true },
    { row: 6, col: 7, num: 75, symbol: 'Re', name: 'Rhenium', faded: true },
    { row: 6, col: 8, num: 76, symbol: 'Os', name: 'Osmium', faded: true },
    { row: 6, col: 9, num: 77, symbol: 'Ir', name: 'Iridium', faded: true },
    { row: 6, col: 10, num: 78, symbol: 'Pt', name: 'Platinum', faded: true },
    { row: 6, col: 11, num: 79, symbol: 'Au', name: 'Gold', faded: true },
    { row: 6, col: 12, num: 80, symbol: 'Hg', name: 'Mercury', faded: true },
    { row: 6, col: 13, num: 81, symbol: 'Tl', name: 'Thallium', faded: true },
    { row: 6, col: 14, num: 82, symbol: 'Pb', name: 'Lead', faded: true },
    { row: 6, col: 15, num: 83, symbol: 'Bi', name: 'Bismuth', faded: true },
    { row: 6, col: 16, num: 84, symbol: 'Po', name: 'Polonium', faded: true },
    { row: 6, col: 17, num: 85, symbol: 'At', name: 'Astatine', faded: true },
    { row: 6, col: 18, num: 86, symbol: 'Rn', name: 'Radon', faded: true },
  ]);

  const ELEMENT_BY_NAME = new Map();
  const ELEMENT_BY_SYMBOL = new Map();
  for (const el of PERIODIC_ELEMENTS) {
    if (!el.isRange && el.name) ELEMENT_BY_NAME.set(el.name.toLowerCase(), el);
    if (el.symbol) ELEMENT_BY_SYMBOL.set(el.symbol, el);
  }

  const GEMINI4_SPECS = Object.freeze({
    H: {
      title: 'Gemini 4 Hydrogen',
      slug: 'gemini-4-hydrogen',
      theme: 'hydrogen',
      isHero: false,
      isNew: false,
      paid: false,
      desc: 'An efficient model with cutting-edge intelligence for fast, dependable execution across coding, agentic workflows, and multimodal knowledge work.',
      context: '1M input · 64K output',
      pricing: 'All context lengths • Input: $1.50 / Output: $7.50',
      released: 'Released Nov 12, 2026',
    },
    C: {
      title: 'Gemini 4 Carbon',
      slug: 'gemini-4-carbon',
      theme: 'carbon',
      isHero: false,
      isNew: false,
      paid: true,
      desc: 'Our most intelligent frontier model built for sustained long-horizon agentic tasks across coding, knowledge work, and science.',
      context: '1M input · 32K output',
      pricing: 'All context lengths • Input: $2.00 / Output: $10.00 through Nov 30, 2026',
      released: 'Released Nov 10, 2026',
    },
    Ne: {
      title: 'Gemini 4 Neon',
      slug: 'gemini-4-neon',
      theme: 'neon',
      isHero: true,
      isNew: true,
      paid: false,
      desc: 'Frontier-level intelligence with fast end-to-end task completion across complex software engineering, analytical, and science workflows.',
      context: '1M input · 64K output',
      pricing: 'All context lengths • Input: $3.00 / Output: $15.00',
      released: 'Released Nov 18, 2026',
    },
    Ar: {
      title: 'Gemini 4 Argon',
      slug: 'gemini-4-argon',
      theme: 'argon',
      isHero: false,
      isNew: false,
      paid: false,
      desc: 'A highly capable model, built to solve complex problems with depth and precision across real-world software engineering and knowledge work.',
      context: '1M input · 32K output',
      pricing: 'All context lengths • Input: $2.00 / Output: $10.00 through Nov 30, 2026',
      released: 'Released Oct 13, 2026',
    },
  });

  let dynamicSpecs = null;

  function setDynamicSpecs(nextSpecs) {
    if (!nextSpecs || typeof nextSpecs !== 'object') {
      dynamicSpecs = null;
      return;
    }
    const clean = Object.create(null);
    for (const [sym, spec] of Object.entries(nextSpecs)) {
      if (!/^[A-Z][a-z]?$/.test(sym) || !spec || typeof spec !== 'object') continue;
      clean[sym] = { ...spec };
    }
    dynamicSpecs = Object.keys(clean).length ? clean : null;
  }

  function getEffectiveSpecs() {
    if (!dynamicSpecs) return GEMINI4_SPECS;
    return { ...GEMINI4_SPECS, ...dynamicSpecs };
  }

  function getSpec(symbol) {
    if (!symbol) return null;
    if (dynamicSpecs && Object.prototype.hasOwnProperty.call(dynamicSpecs, symbol)) {
      return dynamicSpecs[symbol];
    }
    return GEMINI4_SPECS[symbol] || null;
  }

  const EFFORT_DISPLAY_MAP = {
    none: 'None',
    off: 'Off',
    minimal: 'Minimal',
    light: 'Light',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
    extra: 'Extra',
    max: 'Max',
    ultra: 'Ultra',
  };

  const EFFORT_ORDER = {
    none: 0,
    off: 0,
    minimal: 1,
    light: 2,
    low: 3,
    medium: 4,
    high: 5,
    xhigh: 6,
    extra: 6,
    max: 7,
    ultra: 8,
  };

  function parseOptionEffort(label) {
    const raw = String(label || '').trim();
    const m = raw.match(
      /^(.+?)\s*(?:\((None|Off|Minimal|Light|Low|Medium|High|Extra|XHigh|Max|Ultra)\)|\s+(None|Off|Minimal|Light|Low|Medium|High|Extra|XHigh|Max|Ultra))\s*$/i
    );
    if (!m) {
      return { base: raw, effortId: '', effortDisplay: '' };
    }
    const rawEff = (m[2] || m[3] || '').toLowerCase();
    const effortId = rawEff === 'extra' ? 'xhigh' : rawEff;
    const effortDisplay = EFFORT_DISPLAY_MAP[rawEff] || m[2] || m[3] || rawEff;
    return {
      base: m[1].trim(),
      effortId,
      effortDisplay,
    };
  }

  function matchGemini4Element(baseName) {
    const raw = String(baseName || '').trim();
    const m = raw.match(/^gemini\s+4\s+([a-z]+)\b/i);
    if (!m) return null;
    return ELEMENT_BY_NAME.get(m[1].toLowerCase()) || null;
  }

  function parseOrchestratorOption(opt) {
    if (!opt || opt.disabled) return null;
    const label = String(opt.label || opt.modelId || '').trim();
    const modelId = String(opt.modelId || '').trim();
    const combined = `${label} ${modelId}`.toLowerCase();
    if (!/\borchestrator\b/.test(combined)) return null;

    let elementEl = null;
    const parenMatch = label.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const inner = parenMatch[1].trim().toLowerCase();
      elementEl = ELEMENT_BY_NAME.get(inner) || null;
    }
    if (!elementEl && modelId) {
      const idMatch = modelId.toLowerCase().match(/orchestrator[-_\s]+([a-z]+)\b/);
      if (idMatch) {
        elementEl = ELEMENT_BY_NAME.get(idMatch[1]) || null;
      }
    }
    return {
      option: opt,
      label,
      modelId,
      elementSymbol: elementEl ? elementEl.symbol : '',
      elementName: elementEl ? elementEl.name : '',
    };
  }

  function resolveOrchestratorState(modelOptions, selectedModel, preferredEffortId) {
    const opts = Array.isArray(modelOptions) ? modelOptions : [];
    const bySymbol = Object.create(null);
    const all = [];
    for (const opt of opts) {
      const parsed = parseOrchestratorOption(opt);
      if (!parsed) continue;
      all.push(parsed);
      if (parsed.elementSymbol && !bySymbol[parsed.elementSymbol]) {
        bySymbol[parsed.elementSymbol] = parsed;
      }
    }

    const activeOrch = all.find((entry) => isSameOption(entry.option, selectedModel)) || null;
    const isOrchestrator = Boolean(activeOrch);

    let activeSymbol = activeOrch ? activeOrch.elementSymbol : '';
    if (!activeSymbol && selectedModel) {
      const parsedSel = parseOptionEffort(selectedModel.label || selectedModel.modelId || '');
      const el = matchGemini4Element(parsedSel.base || selectedModel.label || '');
      if (el) activeSymbol = el.symbol;
    }

    const defaultEntry = bySymbol.Ne || bySymbol.C || bySymbol.Ar || all[0] || null;
    const matchingOrchEntry = (activeSymbol && bySymbol[activeSymbol]) || defaultEntry;

    let matchingStandardOption = null;
    if (isOrchestrator) {
      const grouped = groupModelOptions(opts, selectedModel);
      const targetFam =
        (activeSymbol && grouped.bySymbol[activeSymbol]) ||
        grouped.bySymbol.Ne ||
        grouped.families.find((f) => f.category === 'gemini4') ||
        grouped.families.find((f) => f.category !== 'orchestrator') ||
        null;
      const picked = targetFam ? pickPreferredVariant(targetFam, preferredEffortId) : null;
      matchingStandardOption = picked ? picked.option : null;
    }

    return {
      available: all.length > 0,
      isOrchestrator,
      activeSymbol,
      activeOption: activeOrch ? activeOrch.option : null,
      bySymbol,
      all,
      defaultOption: defaultEntry ? defaultEntry.option : null,
      matchingOrchestratorOption: matchingOrchEntry ? matchingOrchEntry.option : null,
      matchingOrchestratorSymbol: matchingOrchEntry ? matchingOrchEntry.elementSymbol : '',
      matchingStandardOption,
    };
  }

  function resolveOrchestratorPlanner(orchestratorPlanners, orchestratorPick, orchestratorDefaultPlanner) {
    const planners = Array.isArray(orchestratorPlanners) ? orchestratorPlanners.filter((p) => p && !p.disabled) : [];
    const pickVal = orchestratorPick && typeof orchestratorPick === 'object' ? orchestratorPick.model : orchestratorPick;
    if (pickVal !== undefined && pickVal !== null && pickVal !== 0) {
      const hit = planners.find((p) => p.value === pickVal || p.modelId === pickVal);
      if (hit) return hit;
    }
    if (orchestratorDefaultPlanner && !orchestratorDefaultPlanner.disabled) {
      const matchedDefault = planners.find((p) => isSameOption(p, orchestratorDefaultPlanner));
      return matchedDefault || orchestratorDefaultPlanner;
    }
    return planners[0] || null;
  }

  function findMatchingOrchestratorPlanner(orchestratorPlanners, targetOption, preferredEffortId) {
    const planners = Array.isArray(orchestratorPlanners) ? orchestratorPlanners.filter((p) => p && !p.disabled) : [];
    if (!planners.length || !targetOption) return null;

    const exact = planners.find((p) => isSameOption(p, targetOption));
    if (exact) return exact;

    const parsedTarget = parseOptionEffort(targetOption.label || targetOption.modelId || '');
    const targetBase = (parsedTarget.base || '').toLowerCase();
    const desiredEffort = String(parsedTarget.effortId || preferredEffortId || '').toLowerCase();

    if (targetBase) {
      const sameFamily = planners.filter((p) => parseOptionEffort(p.label || p.modelId || '').base.toLowerCase() === targetBase);
      if (sameFamily.length) {
        if (desiredEffort) {
          const effHit = sameFamily.find((p) => parseOptionEffort(p.label || '').effortId === desiredEffort);
          if (effHit) return effHit;
        }
        return (
          sameFamily.find((p) => parseOptionEffort(p.label || '').effortId === 'high') ||
          sameFamily.find((p) => parseOptionEffort(p.label || '').effortId === 'medium') ||
          sameFamily[0]
        );
      }
    }

    const el = matchGemini4Element(targetBase || targetOption.label || '');
    if (el) {
      const elMatches = planners.filter((p) => {
        const pe = matchGemini4Element(parseOptionEffort(p.label || '').base || p.label || '');
        return pe && pe.symbol === el.symbol;
      });
      if (elMatches.length) {
        if (desiredEffort) {
          const effHit = elMatches.find((p) => parseOptionEffort(p.label || '').effortId === desiredEffort);
          if (effHit) return effHit;
        }
        return elMatches.find((p) => parseOptionEffort(p.label || '').effortId === 'high') || elMatches[0];
      }
    }

    return null;
  }

  function computeOrchestratorToggleTarget(
    modelOptions,
    selectedModel,
    preferredEffortId,
    fallbackStandardOption,
    activePlannerOption
  ) {
    const state = resolveOrchestratorState(modelOptions, selectedModel, preferredEffortId);
    if (!state.available) {
      return { available: false, nextOrchestrator: false, targetOption: null, state };
    }
    if (state.isOrchestrator) {
      const opts = Array.isArray(modelOptions) ? modelOptions : [];
      let target = null;
      if (activePlannerOption) {
        target = opts.find((o) => o && !o.disabled && isSameOption(o, activePlannerOption)) || null;
      }
      if (!target) target = state.matchingStandardOption;
      if (!target && fallbackStandardOption) {
        target = opts.find((o) => o && !o.disabled && isSameOption(o, fallbackStandardOption)) || null;
      }
      return {
        available: Boolean(target),
        nextOrchestrator: false,
        targetOption: target,
        state,
      };
    }
    return {
      available: Boolean(state.matchingOrchestratorOption),
      nextOrchestrator: true,
      targetOption: state.matchingOrchestratorOption,
      state,
    };
  }

  function classifyCategory(baseName, elementEl) {
    if (elementEl) return 'gemini4';
    const lower = String(baseName || '').toLowerCase();
    if (/\borchestrator\b/.test(lower)) return 'orchestrator';
    if (/\bgemini\b/.test(lower)) return 'gemini';
    if (/\bclaude\b/.test(lower)) return 'claude';
    return 'other';
  }

  function slugFromBaseName(baseName) {
    return String(baseName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function isSameOption(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.value !== undefined && b.value !== undefined && a.value === b.value) return true;
    if (a.modelId && b.modelId && a.modelId === b.modelId) return true;
    if (a.label && b.label && a.label === b.label) return true;
    return false;
  }

  function groupModelOptions(modelOptions, selectedModel) {
    const opts = Array.isArray(modelOptions) ? modelOptions : [];
    const familyMap = new Map();
    const families = [];
    const disabledBySymbol = Object.create(null);

    for (const opt of opts) {
      if (!opt) continue;
      const label = String(opt.label || opt.modelId || '').trim();
      if (!label) continue;
      const parsed = parseOptionEffort(label);
      const baseName = parsed.base || label;
      if (opt.disabled) {
        const disabledEl = matchGemini4Element(baseName);
        if (disabledEl && !disabledBySymbol[disabledEl.symbol]) {
          disabledBySymbol[disabledEl.symbol] = {
            baseName,
            tagTitle: String(opt.tagTitle || '').trim(),
            tagDescription: String(opt.tagDescription || '').trim(),
            modelId: String(opt.modelId || ''),
          };
        }
        continue;
      }
      const key = baseName.toLowerCase();
      let fam = familyMap.get(key);
      if (!fam) {
        const elementEl = matchGemini4Element(baseName);
        const elementSymbol = elementEl ? elementEl.symbol : '';
        const spec = elementSymbol ? getSpec(elementSymbol) : null;
        fam = {
          id: slugFromBaseName(baseName) || key,
          baseName,
          category: classifyCategory(baseName, elementEl),
          elementSymbol,
          variants: [],
          isSelected: false,
          selectedEffortId: '',
          selectedOption: null,
          tagTitle: String(opt.tagTitle || '').trim(),
          tagDescription: String(opt.tagDescription || '').trim(),
          modelIdBase: spec?.slug || slugFromBaseName(baseName),
          spec,
          inAntigravity: true,
        };
        familyMap.set(key, fam);
        families.push(fam);
      }

      if (!fam.tagTitle && opt.tagTitle) fam.tagTitle = String(opt.tagTitle).trim();
      if (!fam.tagDescription && opt.tagDescription) fam.tagDescription = String(opt.tagDescription).trim();

      const variant = {
        effortId: parsed.effortId || 'default',
        effortDisplay: parsed.effortDisplay || '',
        label,
        modelId: String(opt.modelId || ''),
        option: opt,
      };
      fam.variants.push(variant);

      if (isSameOption(opt, selectedModel)) {
        fam.isSelected = true;
        fam.selectedEffortId = variant.effortId;
        fam.selectedOption = opt;
      }
    }

    for (const fam of families) {
      fam.variants.sort((a, b) => {
        const oa = Object.prototype.hasOwnProperty.call(EFFORT_ORDER, a.effortId) ? EFFORT_ORDER[a.effortId] : 99;
        const ob = Object.prototype.hasOwnProperty.call(EFFORT_ORDER, b.effortId) ? EFFORT_ORDER[b.effortId] : 99;
        return oa - ob;
      });
    }

    const bySymbol = Object.create(null);
    for (const fam of families) {
      if (fam.elementSymbol && !bySymbol[fam.elementSymbol]) {
        bySymbol[fam.elementSymbol] = fam;
      }
    }

    const orchBySymbol = Object.create(null);
    let selectedOrchSymbol = '';
    for (const opt of opts) {
      const parsedOrch = parseOrchestratorOption(opt);
      if (!parsedOrch || !parsedOrch.elementSymbol) continue;
      if (!orchBySymbol[parsedOrch.elementSymbol]) {
        orchBySymbol[parsedOrch.elementSymbol] = parsedOrch.option;
      }
      if (isSameOption(parsedOrch.option, selectedModel)) {
        selectedOrchSymbol = parsedOrch.elementSymbol;
      }
    }

    const tiles = PERIODIC_ELEMENTS.map((el) => {
      const fam = !el.isRange && el.symbol ? bySymbol[el.symbol] || null : null;
      const spec = !el.isRange && el.symbol ? getSpec(el.symbol) : null;
      const disabledInfo = !fam && !el.isRange && el.symbol ? disabledBySymbol[el.symbol] || null : null;
      const orchestratorOption = !el.isRange && el.symbol ? orchBySymbol[el.symbol] || null : null;
      const isOrchestratorSelected = Boolean(orchestratorOption && selectedOrchSymbol === el.symbol);
      const isAvailableInHost = Boolean(fam);
      const isDisabledInHost = Boolean(disabledInfo);
      const isLaunched = Boolean(fam || disabledInfo || spec);
      const isPreviewOnly = Boolean((spec || disabledInfo) && !fam);
      const isSubscriptionLocked = Boolean((spec || disabledInfo) && !fam && (disabledInfo || spec?.paid));
      const theme = spec ? spec.theme : isLaunched ? 'hydrogen' : '';
      return {
        ...el,
        family: fam,
        spec,
        disabledInfo,
        orchestratorOption,
        isOrchestratorSelected,
        theme,
        isLaunched,
        isAvailableInHost,
        isDisabledInHost,
        isPreviewOnly,
        isSubscriptionLocked,
        isHero: Boolean(spec?.isHero),
        isNew: Boolean(spec?.isNew || fam?.tagTitle === 'New'),
        isSelected: Boolean(fam?.isSelected || isOrchestratorSelected),
      };
    });

    let releasedCount = 0;
    let availableCount = 0;
    for (const t of tiles) {
      if (t.isLaunched) releasedCount++;
      if (t.isAvailableInHost) availableCount++;
    }

    return {
      families,
      bySymbol,
      tiles,
      releasedCount,
      availableCount,
    };
  }

  function pickPreferredVariant(family, currentEffortId) {
    if (!family || !Array.isArray(family.variants) || family.variants.length === 0) return null;
    if (family.selectedOption) {
      const exact = family.variants.find((v) => isSameOption(v.option, family.selectedOption));
      if (exact) return exact;
    }
    const cur = String(currentEffortId || '').toLowerCase();
    if (cur) {
      const hit = family.variants.find((v) => v.effortId === cur);
      if (hit) return hit;
    }
    const highHit = family.variants.find((v) => v.effortId === 'high');
    if (highHit) return highHit;
    const medHit = family.variants.find((v) => v.effortId === 'medium');
    if (medHit) return medHit;
    return family.variants[0];
  }

  function filterModelFamilies(families, tabId, query) {
    const list = Array.isArray(families) ? families : [];
    const tab = String(tabId || 'all').toLowerCase();
    const q = String(query || '').trim().toLowerCase();

    return list.filter((fam) => {
      if (tab === 'gemini') {
        if (fam.category !== 'gemini4' && fam.category !== 'gemini') return false;
      } else if (tab === 'orchestrator') {
        if (fam.category !== 'orchestrator') return false;
      } else if (tab === 'claude') {
        if (fam.category !== 'claude') return false;
      } else if (tab === 'other') {
        if (fam.category !== 'other') return false;
      }

      if (!q) return true;
      const haystack = [
        fam.baseName,
        fam.modelIdBase,
        fam.tagDescription,
        fam.spec?.title,
        fam.spec?.slug,
        fam.spec?.desc,
        ...fam.variants.map((v) => `${v.label} ${v.modelId}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  function buildPeriodicSyncPrompt(lang) {
    const l = String(lang || '').trim();
    const knownSymbols = Object.keys(getEffectiveSpecs()).join(', ');
    if (/^zh/i.test(l) || l === 'yue') {
      return [
        '请帮我更新 Antigravity 的 Gemini 4 元素周期表模型选择器：',
        '1. 使用内置浏览器打开 Google AI Studio（https://aistudio.google.com/），点开模型选择面板中的「The Periodic Table of Gemini 4」元素周期表；',
        `2. 分别在浅色与深色主题下检查所有已点亮元素（当前已收录：${knownSymbols}），抓取所有新增元素以及已有元素的变动信息：元素符号、原子序数、模型名称与 slug、是否 New / 3D 翻转主推（isHero）、是否付费/订阅限制（paid）、简介、上下文窗口、计费价格、发布日期，以及每个新元素在明暗主题下的专属色（--tile-bg、--tile-edge-lip、--tile-symbol-ink、--tile-num-ink、--tile-pip）；`,
        '3. 如果本机已克隆 `agy-claude-studio` 源码仓库（例如当前工作区），优先更新仓库中的 periodic-core.js（GEMINI4_SPECS）与 style.css（.ag-cs-ps-theme-<name> 明暗两套配色），运行 node --test test/*.test.mjs，再将更新后的文件同步到原生插件目录 `~/.gemini/config/plugins/agy-claude-studio/`；',
        '4. 如果本机仅安装了原生插件或独立安装包，则直接更新插件目录中的 periodic-core.js 与 style.css 即可自动触发热更新生效。',
      ].join('\n');
    }
    return [
      'Please update my Antigravity Gemini 4 Periodic Table model selector:',
      '1. Use the built-in browser to open Google AI Studio (https://aistudio.google.com/) and open "The Periodic Table of Gemini 4" model picker.',
      `2. Inspect every lit element tile under both light and dark themes (currently recorded: ${knownSymbols}) and extract all newly released elements and any updates to existing ones: element symbol, atomic number, model title and slug, New / 3D hero flip flag (isHero), paid/subscription lock flag (paid), description, context window, pricing, release date, and light/dark theme tile colors (--tile-bg, --tile-edge-lip, --tile-symbol-ink, --tile-num-ink, --tile-pip).`,
      '3. If a local `agy-claude-studio` source repository is available (such as the active workspace), update GEMINI4_SPECS in its periodic-core.js and add/update the corresponding light and dark .ag-cs-ps-theme-<name> rules in style.css, run `node --test test/*.test.mjs`, then deploy the updated files to `~/.gemini/config/plugins/agy-claude-studio/`.',
      '4. Otherwise, directly update periodic-core.js and style.css inside the installed `agy-claude-studio` plugin directory to trigger hot-reload.',
    ].join('\n');
  }

  return {
    PERIODIC_ELEMENTS,
    GEMINI4_SPECS,
    setDynamicSpecs,
    getEffectiveSpecs,
    getSpec,
    parseOptionEffort,
    matchGemini4Element,
    parseOrchestratorOption,
    resolveOrchestratorState,
    resolveOrchestratorPlanner,
    findMatchingOrchestratorPlanner,
    computeOrchestratorToggleTarget,
    groupModelOptions,
    pickPreferredVariant,
    filterModelFamilies,
    buildPeriodicSyncPrompt,
  };
});
