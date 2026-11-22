(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsEffortCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  // ── 1. Effort Ladder & Detent Math (Nwflower/dsh-claude-style) ─────────────
  const EFFORT_STRENGTH = Object.freeze({
    none: 0,
    off: 0,
    minimal: 1,
    light: 2,
    low: 3,
    medium: 4,
    high: 5,
    on: 5,
    xhigh: 6,
    max: 7,
    ultra: 8,
  });

  function resolveEffortLang(langOrZh) {
    if (langOrZh === true) return 'zh-CN';
    if (langOrZh === false || langOrZh === null) return 'en';
    if (langOrZh === 'zh-TW' || langOrZh === 'yue' || langOrZh === 'en' || langOrZh === 'ja') return langOrZh;
    return 'zh-CN';
  }

  function pickEffortText(map, langOrZh, fallback = '') {
    const l = resolveEffortLang(langOrZh);
    if (!map) return fallback;
    if (map[l] !== undefined) return map[l];
    if (l === 'yue' && map['zh-TW'] !== undefined) return map['zh-TW'];
    return map['zh-CN'] !== undefined ? map['zh-CN'] : (map.en !== undefined ? map.en : fallback);
  }

  const EFFORT_TIERS = [
    {
      id: 'low',
      display: 'Low',
      tint: '#9d9eff',
      rgb: [157, 158, 255],
      zhEffort: '低推理',
      enEffort: 'Low reasoning',
      labels: { 'zh-CN': '低推理', 'zh-TW': '低推理', yue: '低推理', en: 'Low reasoning', ja: '低推論' },
      zhDesc: '极速响应 · 适合快速问答与轻量指令',
      enDesc: 'Fastest responses · Ideal for quick edits & simple tasks',
      descs: {
        'zh-CN': '极速响应 · 适合快速问答与轻量指令',
        'zh-TW': '極速回應 · 適合快速問答與輕量指令',
        yue: '極速回覆 · 適合快問快答同簡單指令',
        en: 'Fastest responses · Ideal for quick edits & simple tasks',
        ja: '最速レスポンス · 簡単な編集や軽微な質問向け',
      },
    },
    {
      id: 'medium',
      display: 'Medium',
      tint: '#6d6eff',
      rgb: [109, 110, 255],
      zhEffort: '中推理',
      enEffort: 'Medium reasoning',
      labels: { 'zh-CN': '中推理', 'zh-TW': '中推理', yue: '中推理', en: 'Medium reasoning', ja: '中推論' },
      zhDesc: '均衡推理 · 兼顾响应速度与思考深度',
      enDesc: 'Balanced reasoning · Optimal speed and intelligence',
      descs: {
        'zh-CN': '均衡推理 · 兼顾响应速度与思考深度',
        'zh-TW': '均衡推理 · 兼顧回應速度與思考深度',
        yue: '均衡推理 · 兼顧反應速度同思考深度',
        en: 'Balanced reasoning · Optimal speed and intelligence',
        ja: 'バランス重視 · 応答速度と思考の深さを両立',
      },
    },
    {
      id: 'high',
      display: 'High',
      tint: '#5254ff',
      rgb: [82, 84, 255],
      zhEffort: '高推理',
      enEffort: 'High reasoning',
      labels: { 'zh-CN': '高推理', 'zh-TW': '高推理', yue: '高推理', en: 'High reasoning', ja: '高推論' },
      zhDesc: '深度思考 · 适合复杂编码与多步调试',
      enDesc: 'Deep reasoning · Best for complex code & multi-step tasks',
      descs: {
        'zh-CN': '深度思考 · 适合复杂编码与多步调试',
        'zh-TW': '深度思考 · 適合複雜程式與多步驟除錯',
        yue: '深度思考 · 適合複雜寫碼同多步除錯',
        en: 'Deep reasoning · Best for complex code & multi-step tasks',
        ja: '深い推論 · 複雑な実装や多段階デバッグ向け',
      },
    },
    {
      id: 'xhigh',
      display: 'XHigh',
      tint: '#a359ff',
      rgb: [163, 89, 255],
      zhEffort: '超强推理',
      enEffort: 'Extra-high reasoning',
      labels: { 'zh-CN': '超强推理', 'zh-TW': '超強推理', yue: '超強推理', en: 'Extra-high reasoning', ja: '超高推論' },
      zhDesc: '超强推理 · 扩展思考预算与架构推演',
      enDesc: 'Extra-high effort · Extended reasoning & verification',
      descs: {
        'zh-CN': '超强推理 · 扩展思考预算与架构推演',
        'zh-TW': '超強推理 · 擴充思考預算與架構推演',
        yue: '超強推理 · 加大思考空間同架構推演',
        en: 'Extra-high effort · Extended reasoning & verification',
        ja: '超高負荷 · 思考バジェット拡張と設計検証',
      },
    },
    {
      id: 'max',
      display: 'Max',
      tint: '#a359ff',
      rgb: [163, 89, 255],
      zhEffort: '极限推理',
      enEffort: 'Max reasoning',
      labels: { 'zh-CN': '极限推理', 'zh-TW': '極限推理', yue: '極限推理', en: 'Max reasoning', ja: '最大推論' },
      zhDesc: '极限推理 · 最大化思考深度与自我校验',
      enDesc: 'Maximum intelligence · Unbounded deep reasoning',
      descs: {
        'zh-CN': '极限推理 · 最大化思考深度与自我校验',
        'zh-TW': '極限推理 · 最大化思考深度與自我驗證',
        yue: '極限推理 · 去盡思考深度同自我覆檢',
        en: 'Maximum intelligence · Unbounded deep reasoning',
        ja: '最高性能 · 思考の深さと自己検証を最大化',
      },
    },
  ];
  const EFFORT_BY_ID = Object.fromEntries(EFFORT_TIERS.map((t) => [t.id, t]));

  const DETENT = 0.8;
  const DRAG_THRESHOLD_PX = 3;

  function parseModelLabelEffort(label) {
    const raw = String(label || '').trim();
    const m = raw.match(/^(.+?)\s*(?:\((None|Off|Minimal|Light|Low|Medium|High|Extra|XHigh|Max|Ultra)\)|\s+(None|Off|Minimal|Light|Low|Medium|High|Extra|XHigh|Max|Ultra))\s*$/i);
    if (!m) return { base: raw, effort: '' };
    const rawEff = (m[2] || m[3] || '').toLowerCase();
    return {
      base: m[1].trim(),
      effort: rawEff === 'extra' ? 'xhigh' : rawEff,
    };
  }

  function orderEffortSteps(steps) {
    const list = Array.isArray(steps) ? steps.slice() : [];
    list.sort((a, b) => {
      const sa = Object.prototype.hasOwnProperty.call(EFFORT_STRENGTH, a.id) ? EFFORT_STRENGTH[a.id] : 99;
      const sb = Object.prototype.hasOwnProperty.call(EFFORT_STRENGTH, b.id) ? EFFORT_STRENGTH[b.id] : 99;
      return sa - sb;
    });
    return list;
  }

  function resolveClaudeEffortSteps(modelOptions, selectedLabel, badgeEffort) {
    const parsed = parseModelLabelEffort(selectedLabel);
    const rawBadge = String(badgeEffort || '').trim().toLowerCase();
    const preferExtra = rawBadge === 'extra' || (!rawBadge && /\bextra\b/i.test(String(selectedLabel || '')));
    const normBadge = preferExtra ? 'xhigh' : rawBadge;
    const currentEffort = (EFFORT_BY_ID[normBadge] ? normBadge : '') || parsed.effort || 'high';
    const baseName = parsed.base || 'Model';

    const optionByEffort = new Map();
    if (Array.isArray(modelOptions)) {
      for (const opt of modelOptions) {
        if (!opt || opt.disabled) continue;
        const p = parseModelLabelEffort(opt.label);
        if (p.effort && p.base.toLowerCase() === baseName.toLowerCase() && !optionByEffort.has(p.effort)) {
          optionByEffort.set(p.effort, opt);
        }
      }
    }

    let steps = [];
    if (optionByEffort.size >= 2) {
      for (const [id, opt] of optionByEffort.entries()) {
        const meta = EFFORT_BY_ID[id] || {
          id,
          display: id.charAt(0).toUpperCase() + id.slice(1),
          tint: '#8b7ad0',
          rgb: [139, 122, 208],
          zhEffort: id,
          enEffort: id,
          zhDesc: '',
          enDesc: '',
        };
        const step = { ...meta, option: opt };
        if (preferExtra && id === 'xhigh') step.display = 'Extra';
        steps.push(step);
      }
      steps = orderEffortSteps(steps);
    }
    if (steps.length < 2) {
      const fallbackIds = currentEffort === 'max' ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high', 'xhigh'];
      steps = fallbackIds.map((id) => {
        const step = { ...EFFORT_BY_ID[id], option: optionByEffort.get(id) || null };
        if (preferExtra && id === 'xhigh') step.display = 'Extra';
        return step;
      });
    }

    let selectedIdx = steps.findIndex((s) => s.id === currentEffort);
    if (selectedIdx < 0) selectedIdx = Math.max(0, steps.length - 1);
    return { baseName, steps, selectedIdx };
  }

  function dampTravel(x, span, stepCount) {
    if (stepCount < 2 || span <= 0) return Math.max(0, Math.min(span || 0, x));
    const clamped = Math.max(0, Math.min(span, x));
    const seg = span / (stepCount - 1);
    const index = Math.floor(clamped / seg);
    if (index >= stepCount - 1) return span;
    const t = (clamped - index * seg) / seg;
    return (index + t - (DETENT * Math.sin(2 * Math.PI * t)) / (2 * Math.PI)) * seg;
  }

  function nearestStepIndex(x, span, stepCount) {
    if (stepCount <= 0) return -1;
    if (stepCount === 1) return 0;
    const ratio = span <= 0 ? 0 : Math.max(0, Math.min(1, x / span));
    return Math.max(0, Math.min(stepCount - 1, Math.round(ratio * (stepCount - 1))));
  }

  function computeEffortTintPercent(stepCount, index) {
    if (stepCount < 2 || index < 0) return null;
    const ratio = Math.max(0, Math.min(1, index / (stepCount - 1)));
    return Math.round(ratio * 100);
  }

  // ── 2. Top-Rung 5-Row Dot Matrix Field (dsh-claude-style/matrix-field.ts) ──
  const BAND_H = 26;
  const FIELD_ROWS = 5;
  const FLASH_S = 1.45;
  const FLOW_S = 4.0;
  const SURFACE_S = 0.15;
  const FLOW_CLUSTERS = 9;
  const FLOW_ROW_SHIFT = 0.03;
  const FLOW_JITTER = 0.05;
  const PEAK_APEX_SHARE = 62;
  const PEAK_SHARE_SPREAD = 22;
  const GLOW_PEAK = 0.9;
  const FLOW_PEAK = 0.95;

  function sampleCubicBezier(p1x, p1y, p2x, p2y, x) {
    const cx = Math.max(0, Math.min(1, x));
    if (cx <= 0) return 0;
    if (cx >= 1) return 1;
    const evalX = (u) => {
      const m = 1 - u;
      return 3 * m * m * u * p1x + 3 * m * u * u * p2x + u * u * u;
    };
    const evalY = (u) => {
      const m = 1 - u;
      return 3 * m * m * u * p1y + 3 * m * u * u * p2y + u * u * u;
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) * 0.5;
      if (evalX(mid) < cx) lo = mid;
      else hi = mid;
    }
    return evalY((lo + hi) * 0.5);
  }

  function easeInOut(t) {
    return sampleCubicBezier(0.42, 0, 0.58, 1, t);
  }

  function easeStandard(t) {
    return sampleCubicBezier(0.25, 0.1, 0.25, 1, t);
  }

  function cellUnit(r, c, seed) {
    let h = Math.imul(r + 1, 0x9e3779b1) ^ Math.imul(c + 1, 0x85ebca6b) ^ Math.imul(seed + 1, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  function smoothstep(edge0, edge1, value) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function flowStrength(r, c, fx) {
    const cluster = Math.min(FLOW_CLUSTERS - 1, Math.floor(fx * FLOW_CLUSTERS));
    const coarse = cellUnit(cluster, r, 6);
    const fine = cellUnit(r, c, 7);
    const gate = coarse * 0.4 + fine * 0.6;
    return 0.04 + smoothstep(0.46, 0.58, gate) * 0.92;
  }

  function cellFade(fx) {
    if (fx <= 0.05) return 0;
    if (fx >= 0.75) return 1;
    const t = (fx - 0.05) / 0.7;
    return t * t * (3 - 2 * t);
  }

  function solveField(wDev, dpr) {
    const safeDpr = Math.max(1, dpr || 1);
    const gap = Math.max(1, Math.round(1 * safeDpr));
    const margin = Math.max(1, Math.round(0.5 * safeDpr));
    const heightDev = Math.round(BAND_H * safeDpr);
    const size = Math.max(3, Math.floor((heightDev - 2 * margin - (FIELD_ROWS - 1) * gap) / FIELD_ROWS));
    const cols = Math.max(1, Math.floor((wDev + gap) / (size + gap)));
    const restX = wDev - (cols * size + (cols - 1) * gap);
    const restY = heightDev - (FIELD_ROWS * size + (FIELD_ROWS - 1) * gap);
    const left = Math.floor(restX / 2);
    const top = Math.floor(restY / 2);
    const blocks = [];
    for (let r = 0; r < FIELD_ROWS; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const fx = cols > 1 ? c / (cols - 1) : 1;
        blocks.push({
          x: left + c * (size + gap),
          y: top + r * (size + gap),
          size,
          peak: (100 - (PEAK_APEX_SHARE - cellUnit(r, c, 1) * PEAK_SHARE_SPREAD)) / 100,
          flashDelay: cellUnit(r, c, 2) * FLASH_S * 0.95 + FLASH_S * 0.21,
          flashDur: FLASH_S * (0.92 + cellUnit(r, c, 3) * 0.16),
          entrance: (1 - fx) * FLASH_S * 0.31 + cellUnit(r, c, 4) * FLASH_S * 0.055,
          flowOffset: fx * FLOW_S + r * FLOW_S * FLOW_ROW_SHIFT + cellUnit(r, c, 5) * FLOW_S * FLOW_JITTER,
          flowStrength: flowStrength(r, c, fx),
          fade: cellFade(fx),
        });
      }
    }
    return { widthDev: wDev, heightDev, dpr: safeDpr, blocks };
  }

  function flashEnvelope(p) {
    if (p < 0.14) return 0;
    if (p < 0.2) return easeInOut((p - 0.14) / 0.06);
    if (p <= 0.34) return 1;
    if (p >= 1) return 0;
    return 1 - easeInOut((p - 0.34) / 0.66);
  }

  function arrivalPhase(t, entrance) {
    return (t - entrance) / SURFACE_S;
  }

  function arrivalRise(phase) {
    if (phase <= 0) return 0;
    if (phase >= 1) return 1;
    return easeStandard(phase);
  }

  function arrivalGlow(phase) {
    if (phase <= 0 || phase >= 1) return 0;
    if (phase < 0.3) return GLOW_PEAK * easeStandard(phase / 0.3);
    return GLOW_PEAK * (1 - easeStandard((phase - 0.3) / 0.7));
  }

  function flowEnvelope(p, strength) {
    const peak = strength * FLOW_PEAK;
    if (p < 0.03) return peak * (p / 0.03);
    if (p < 0.06) return peak * (1 - (p - 0.03) / 0.03);
    return 0;
  }

  function flashAt(block, t) {
    let p = ((t - block.flashDelay) / block.flashDur) % 1;
    if (p < 0) p += 1;
    return block.peak * flashEnvelope(p);
  }

  function flowAt(block, t) {
    let p = ((t + block.flowOffset) / FLOW_S) % 1;
    if (p < 0) p += 1;
    return flowEnvelope(p, block.flowStrength);
  }

  function composeBlockColour(accent, flash, flashShare, glow, flow, out) {
    const target = out || [0, 0, 0];
    const over = glow + flow - glow * flow;
    for (let ch = 0; ch < 3; ch += 1) {
      const lit = accent[ch] + (flash[ch] - accent[ch]) * flashShare;
      target[ch] = lit + (flash[ch] - lit) * over;
    }
    return target;
  }

  // ── 3. Effort Labels & Style Normalization ────────────────────────────────
  function effortTierLabel(tier, langOrZh) {
    if (!tier) return '';
    return pickEffortText(tier.labels, langOrZh, resolveEffortLang(langOrZh) === 'en' ? tier.enEffort : tier.zhEffort);
  }

  function effortTierDesc(tier, langOrZh) {
    if (!tier) return '';
    return pickEffortText(tier.descs, langOrZh, resolveEffortLang(langOrZh) === 'en' ? tier.enDesc : tier.zhDesc);
  }

  function effortSubtitle(effortId, langOrZh) {
    const id = String(effortId || '').toLowerCase();
    const tier = EFFORT_BY_ID[id];
    if (tier) return effortTierLabel(tier, langOrZh);
    if (id === 'off' || id === 'none') {
      return pickEffortText({ 'zh-CN': '关闭推理', 'zh-TW': '關閉推理', yue: '熄咗推理', en: 'Reasoning off', ja: '推論オフ' }, langOrZh);
    }
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : pickEffortText({ 'zh-CN': '默认', 'zh-TW': '預設', yue: '預設', en: 'Default', ja: 'デフォルト' }, langOrZh);
  }

  /**
   * Normalize configured effort slider style identifier.
   * Supports 'claude' (Claude Code) and 'chatgpt' (Codex).
   */
  function normalizeEffortStyle(style) {
    const raw = typeof style === 'string' ? style.trim().toLowerCase() : '';
    if (raw === 'chatgpt' || raw === 'codex') return 'chatgpt';
    return 'claude';
  }

  const CODEX_TRACK_HEIGHT = 28;
  const CODEX_KNOB_SIZE = CODEX_TRACK_HEIGHT;
  const CODEX_KNOB_RADIUS = CODEX_KNOB_SIZE / 2;
  const CODEX_GOLDEN_RATIO = 0.6180339887498949;
  const CODEX_MIN_HEIGHT_SLOTS = 3;
  const CODEX_ENERGY_START = 1 / 3;
  const CODEX_ENERGY_END = 2 / 3;
  const CODEX_COLOR_BLUE = [77, 147, 248];
  const CODEX_COLOR_VIOLET = [147, 51, 234];
  const CODEX_COLOR_DEEP = [76, 29, 149];
  const CODEX_COLOR_TEXT_VIOLET = [139, 92, 246];
  const CODEX_STAR_COUNT = 22;
  const CODEX_STARFIELD_DURATION_FIXED = 2;
  const CODEX_STARFIELD_DURATION_SPREAD = 0.08;
  const CODEX_STARFIELD_MIN = 0.5;
  const CODEX_MOTION = Object.freeze({
    K: 20,
    A: 120,
    k: 40,
    amax: 240,
    vmax: 6,
    epsX: 0.0015,
    epsV: 0.02,
  });

  function codexClamp01(value) {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
  }

  function codexClampAbs(value, limit) {
    if (value > limit) return limit;
    return value < -limit ? -limit : value;
  }

  function codexIndexFromPct(pct, count) {
    if (count <= 1) return 0;
    return Math.max(0, Math.min(count - 1, Math.round(codexClamp01(pct) * (count - 1))));
  }

  function codexPctFromIndex(index, count) {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    const safe = Math.max(0, Math.min(count - 1, index));
    return safe / (count - 1);
  }

  function codexStarHash01(index, salt) {
    const value = ((index + 1) * salt * 2654435761) % 4294967296;
    return ((value >>> 8) % 1000) / 1000;
  }

  /**
   * Build deterministic low-discrepancy starfield positions separated in vertical slots.
   */
  function codexBuildParticles(count = CODEX_STAR_COUNT) {
    const total = Math.max(1, Math.round(count));
    const out = [];
    for (let i = 0; i < total; i += 1) {
      out.push({ y: 0, phase: ((i + 1) * CODEX_GOLDEN_RATIO) % 1 });
    }
    const byPhase = out.map((_, i) => i).sort((a, b) => out[a].phase - out[b].phase);
    let slots = null;
    for (let salt = 71; salt < 4000 && slots === null; salt += 1) {
      const candidate = out.map((_, i) => i).sort((a, b) => {
        const ha = codexStarHash01(a, salt);
        const hb = codexStarHash01(b, salt);
        return ha === hb ? a - b : ha - hb;
      });
      let ok = true;
      for (let k = 1; k < total && ok; k += 1) {
        if (Math.abs(candidate[k] - candidate[k - 1]) < CODEX_MIN_HEIGHT_SLOTS) ok = false;
      }
      if (ok) slots = candidate;
    }
    if (slots === null) {
      slots = out.map((_, i) => (i * 5) % total);
    }
    for (let rank = 0; rank < total; rank += 1) {
      out[byPhase[rank]].y = total > 1 ? 8 + (slots[rank] / (total - 1)) * 84 : 50;
    }
    return out;
  }

  const CODEX_PARTICLES = codexBuildParticles(CODEX_STAR_COUNT);

  function codexMixColor(from, to, t) {
    const k = codexClamp01(t);
    return [
      Math.round(from[0] + (to[0] - from[0]) * k),
      Math.round(from[1] + (to[1] - from[1]) * k),
      Math.round(from[2] + (to[2] - from[2]) * k),
    ];
  }

  function codexRgbOf(color) {
    return `rgb(${color[0]},${color[1]},${color[2]})`;
  }

  function codexIsOffLevel(level) {
    if (!level) return false;
    const candidates = typeof level === 'string' ? [level] : [level.id, level.key, level.name, level.label];
    for (let i = 0; i < candidates.length; i += 1) {
      if (typeof candidates[i] !== 'string') continue;
      const flat = candidates[i].replace(/\s+/g, '').toLowerCase();
      if (flat === 'off' || flat === 'none' || flat === '关闭' || flat === '關閉' || flat === '无' || flat === '冇' || flat === 'オフ') return true;
    }
    return false;
  }

  function codexEnergyFor(pct) {
    return codexClamp01((codexClamp01(pct) - CODEX_ENERGY_START) / (1 - CODEX_ENERGY_START));
  }

  function codexFillColorFor(pct) {
    const t = codexClamp01(pct);
    if (t <= CODEX_ENERGY_START) return codexRgbOf(CODEX_COLOR_BLUE);
    if (t <= CODEX_ENERGY_END) {
      return codexRgbOf(codexMixColor(CODEX_COLOR_BLUE, CODEX_COLOR_VIOLET, (t - CODEX_ENERGY_START) / (CODEX_ENERGY_END - CODEX_ENERGY_START)));
    }
    return codexRgbOf(codexMixColor(CODEX_COLOR_VIOLET, CODEX_COLOR_DEEP, (t - CODEX_ENERGY_END) / (1 - CODEX_ENERGY_END)));
  }

  function codexFillBackgroundFor(pct) {
    return `linear-gradient(90deg, ${codexRgbOf(CODEX_COLOR_BLUE)}, ${codexFillColorFor(pct)})`;
  }

  function codexValueColorFor(pct, level) {
    if (codexIsOffLevel(level)) return '';
    return codexRgbOf(codexMixColor(CODEX_COLOR_BLUE, CODEX_COLOR_TEXT_VIOLET, codexEnergyFor(pct)));
  }

  function codexSpeedFor(pct) {
    return Math.min(2, Math.max(0.55, 3 * codexClamp01(pct) - 1));
  }

  function codexParticleCountFor(pct) {
    return Math.round(codexEnergyFor(pct) * CODEX_PARTICLES.length);
  }

  function codexStarBrightnessFor(index) {
    return CODEX_STARFIELD_MIN + (1 - CODEX_STARFIELD_MIN) * codexStarHash01(index, 61);
  }

  function codexStarDurationFor(index) {
    const spread = 1 - CODEX_STARFIELD_DURATION_SPREAD + 2 * CODEX_STARFIELD_DURATION_SPREAD * codexStarHash01(index, 29);
    return CODEX_STARFIELD_DURATION_FIXED * spread;
  }

  function codexStarDelayFor(index, duration, particles = CODEX_PARTICLES) {
    const particle = particles[index];
    const phase = particle && typeof particle.phase === 'number' ? particle.phase : 0;
    const jitter = codexStarHash01(index, 53) * 0.03;
    return -((phase + jitter) % 1) * duration;
  }

  function codexStarLayerOpacityFor(pct) {
    return 0.6 + 0.4 * codexEnergyFor(pct);
  }

  function codexStarProgressFor(pct, count) {
    const anchor = count > 1 ? codexPctFromIndex(1, count) : 0;
    const span = 1 - anchor;
    return span > 1e-6 ? codexClamp01((codexClamp01(pct) - anchor) / span) : codexClamp01(pct);
  }

  function codexParticleReveal(index, progress, total = CODEX_STAR_COUNT) {
    const threshold = index / Math.max(1, total);
    return codexClamp01((codexClamp01(progress) - threshold) / 0.22);
  }

  function codexKnobOffsetOf(pct) {
    const t = Math.round(codexClamp01(pct) * 10000) / 10000;
    return `calc(${CODEX_KNOB_RADIUS}px + ${t} * (100% - ${CODEX_KNOB_RADIUS * 2}px))`;
  }

  function codexMotionSettled(m, p = CODEX_MOTION) {
    return Math.abs(m.target - m.x) < p.epsX && Math.abs(m.v) < p.epsV;
  }

  /**
   * Advance one frame of the brake-prediction + velocity-tracking motion controller.
   */
  function codexMotionStep(m, dt, p = CODEX_MOTION) {
    const e = m.target - m.x;
    let vAbs = p.K * Math.abs(e);
    const brake = Math.sqrt(2 * p.A * Math.abs(e));
    if (brake < vAbs) vAbs = brake;
    if (vAbs > p.vmax) vAbs = p.vmax;
    const vDesired = e > 0 ? vAbs : (e < 0 ? -vAbs : 0);
    m.a = codexClampAbs(p.k * (vDesired - m.v), p.amax);
    m.v = codexClampAbs(m.v + m.a * dt, p.vmax);
    if (e !== 0 && Math.abs(m.v * dt) >= Math.abs(e)) {
      m.x = m.target;
      m.v = 0;
      m.a = 0;
      return m;
    }
    const xRaw = m.x + m.v * dt;
    const xClamped = xRaw < 0 ? 0 : (xRaw > 1 ? 1 : xRaw);
    if (xClamped !== xRaw && ((xClamped === 0 && m.v < 0) || (xClamped === 1 && m.v > 0))) {
      m.v = 0;
      m.a = 0;
    }
    m.x = xClamped;
    if (codexMotionSettled(m, p)) {
      m.x = m.target;
      m.v = 0;
      m.a = 0;
    }
    return m;
  }

  return {
    normalizeEffortStyle,
    CODEX_TRACK_HEIGHT,
    CODEX_KNOB_SIZE,
    CODEX_KNOB_RADIUS,
    CODEX_GOLDEN_RATIO,
    CODEX_MIN_HEIGHT_SLOTS,
    CODEX_ENERGY_START,
    CODEX_ENERGY_END,
    CODEX_COLOR_BLUE,
    CODEX_COLOR_VIOLET,
    CODEX_COLOR_DEEP,
    CODEX_COLOR_TEXT_VIOLET,
    CODEX_STAR_COUNT,
    CODEX_STARFIELD_DURATION_FIXED,
    CODEX_STARFIELD_DURATION_SPREAD,
    CODEX_STARFIELD_MIN,
    CODEX_MOTION,
    CODEX_PARTICLES,
    codexClamp01,
    codexClampAbs,
    codexIndexFromPct,
    codexPctFromIndex,
    codexStarHash01,
    codexBuildParticles,
    codexMixColor,
    codexRgbOf,
    codexIsOffLevel,
    codexEnergyFor,
    codexFillColorFor,
    codexFillBackgroundFor,
    codexValueColorFor,
    codexSpeedFor,
    codexParticleCountFor,
    codexStarBrightnessFor,
    codexStarDurationFor,
    codexStarDelayFor,
    codexStarLayerOpacityFor,
    codexStarProgressFor,
    codexParticleReveal,
    codexKnobOffsetOf,
    codexMotionSettled,
    codexMotionStep,
    EFFORT_STRENGTH,
    EFFORT_TIERS,
    EFFORT_BY_ID,
    effortSubtitle,
    effortTierLabel,
    effortTierDesc,
    DETENT,
    DRAG_THRESHOLD_PX,
    parseModelLabelEffort,
    orderEffortSteps,
    resolveClaudeEffortSteps,
    dampTravel,
    nearestStepIndex,
    computeEffortTintPercent,
    BAND_H,
    FIELD_ROWS,
    FLASH_S,
    FLOW_S,
    SURFACE_S,
    cellUnit,
    flowStrength,
    cellFade,
    solveField,
    flashEnvelope,
    arrivalPhase,
    arrivalRise,
    arrivalGlow,
    flowEnvelope,
    flashAt,
    flowAt,
    composeBlockColour,
  };
});
