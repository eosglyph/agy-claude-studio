// Zero-dependency mobile push notification core for Claude Studio (agy-claude-studio).
// Node-only (Stop hook + local studio sidecar). Never bundled or injected into renderer pages.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cdp = require('./cdp.js');

const CHANNEL_LIST = [
  'serverchan',
  'bark',
  'ntfy',
  'feishu',
  'dingtalk',
  'wecom',
  'telegram',
  'webhook',
];

const DEFAULT_NOTIFY_CONFIG = {
  enabled: false,
  channel: 'serverchan',
  minDurationSec: 15,
  cooldownSec: 20,
  onlyFullyIdle: true,
  notifyOnError: true,
  skipUserCanceled: true,
  includeSummary: true,
  channels: {
    serverchan: { sendKey: '', apiUrl: '', fullMarkdown: true },
    bark: { serverUrl: 'https://api.day.app', deviceKey: '', group: 'Claude Studio', sound: '' },
    ntfy: { serverUrl: 'https://ntfy.sh', topic: '', token: '' },
    feishu: { webhookUrl: '' },
    dingtalk: { webhookUrl: '' },
    wecom: { webhookUrl: '' },
    telegram: { botToken: '', chatId: '', apiBase: 'https://api.telegram.org' },
    webhook: { webhookUrl: '', authHeader: '' },
  },
};

function isUnresolvedVar(raw) {
  const s = String(raw || '').trim();
  return !s || s.includes('${');
}

function resolveNotifyDataDir(env = process.env, fallbackDir = null) {
  const testOverride = String(env?.AGY_CLAUDE_STUDIO_NOTIFY_DATA_DIR || '').trim();
  if (!isUnresolvedVar(testOverride)) {
    return path.resolve(testOverride);
  }
  const hookPluginData = String(env?.PLUGIN_DATA || '').trim();
  if (!isUnresolvedVar(hookPluginData)) {
    return path.resolve(hookPluginData);
  }
  const explicitPluginData = String(
    env?.AGY_CLAUDE_STUDIO_PLUGIN_DATA || env?.AGY_CLAUDE_STYLE_PLUGIN_DATA || ''
  ).trim();
  if (!isUnresolvedVar(explicitPluginData)) {
    return path.resolve(explicitPluginData);
  }
  const cdpResolved = cdp.resolvePluginDataDir(env);
  if (cdpResolved) {
    return cdpResolved;
  }
  if (fallbackDir) {
    return path.resolve(String(fallbackDir));
  }
  return path.join(os.homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-claude-studio');
}

function getNotifyConfigPath(dataDir) {
  const dir = dataDir ? path.resolve(String(dataDir)) : resolveNotifyDataDir();
  return path.join(dir, 'notify.json');
}

function getNotifyStatePath(dataDir) {
  const dir = dataDir ? path.resolve(String(dataDir)) : resolveNotifyDataDir();
  return path.join(dir, 'notify-state.json');
}

function isValidHttpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  try {
    const parsed = new URL(s);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeString(raw, maxLen = 1024) {
  if (raw === undefined || raw === null) return '';
  return String(raw).trim().slice(0, maxLen);
}

function sanitizeUrlField(raw, defaultUrl = '') {
  const s = sanitizeString(raw, 2048);
  if (!s) return defaultUrl;
  return isValidHttpUrl(s) ? s : defaultUrl;
}

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFY_CONFIG));
}

function sanitizeNotifyConfig(raw, base = DEFAULT_NOTIFY_CONFIG) {
  const safeBase = base && typeof base === 'object' ? base : DEFAULT_NOTIFY_CONFIG;
  const out = cloneDefaultConfig();

  // Seed from base first
  if (safeBase !== DEFAULT_NOTIFY_CONFIG) {
    const seeded = sanitizeNotifyConfig(safeBase, DEFAULT_NOTIFY_CONFIG);
    Object.assign(out, seeded);
    out.channels = JSON.parse(JSON.stringify(seeded.channels));
  }

  if (!raw || typeof raw !== 'object') return out;

  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.channel === 'string' && CHANNEL_LIST.includes(raw.channel.trim())) {
    out.channel = raw.channel.trim();
  }
  if (raw.minDurationSec !== undefined) {
    out.minDurationSec = clampInt(raw.minDurationSec, out.minDurationSec, 0, 3600);
  }
  if (raw.cooldownSec !== undefined) {
    out.cooldownSec = clampInt(raw.cooldownSec, out.cooldownSec, 0, 3600);
  }
  if (typeof raw.onlyFullyIdle === 'boolean') out.onlyFullyIdle = raw.onlyFullyIdle;
  if (typeof raw.notifyOnError === 'boolean') out.notifyOnError = raw.notifyOnError;
  if (typeof raw.skipUserCanceled === 'boolean') out.skipUserCanceled = raw.skipUserCanceled;
  if (typeof raw.includeSummary === 'boolean') out.includeSummary = raw.includeSummary;

  const rawChannels = raw.channels && typeof raw.channels === 'object' ? raw.channels : {};
  const has = (obj, k) => obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k);

  if (has(rawChannels, 'serverchan')) {
    const src = rawChannels.serverchan;
    if (has(src, 'sendKey')) out.channels.serverchan.sendKey = sanitizeString(src.sendKey, 512);
    if (has(src, 'apiUrl')) out.channels.serverchan.apiUrl = sanitizeUrlField(src.apiUrl, '');
    if (typeof src?.fullMarkdown === 'boolean') out.channels.serverchan.fullMarkdown = src.fullMarkdown;
  }
  if (has(rawChannels, 'bark')) {
    const src = rawChannels.bark;
    if (has(src, 'serverUrl')) out.channels.bark.serverUrl = sanitizeUrlField(src.serverUrl, DEFAULT_NOTIFY_CONFIG.channels.bark.serverUrl);
    if (has(src, 'deviceKey')) out.channels.bark.deviceKey = sanitizeString(src.deviceKey, 512);
    if (has(src, 'group')) out.channels.bark.group = sanitizeString(src.group, 128);
    if (has(src, 'sound')) out.channels.bark.sound = sanitizeString(src.sound, 128);
  }
  if (has(rawChannels, 'ntfy')) {
    const src = rawChannels.ntfy;
    if (has(src, 'serverUrl')) out.channels.ntfy.serverUrl = sanitizeUrlField(src.serverUrl, DEFAULT_NOTIFY_CONFIG.channels.ntfy.serverUrl);
    if (has(src, 'topic')) out.channels.ntfy.topic = sanitizeString(src.topic, 256);
    if (has(src, 'token')) out.channels.ntfy.token = sanitizeString(src.token, 512);
  }
  if (has(rawChannels, 'feishu')) {
    const src = rawChannels.feishu;
    if (has(src, 'webhookUrl')) out.channels.feishu.webhookUrl = sanitizeUrlField(src.webhookUrl, '');
  }
  if (has(rawChannels, 'dingtalk')) {
    const src = rawChannels.dingtalk;
    if (has(src, 'webhookUrl')) out.channels.dingtalk.webhookUrl = sanitizeUrlField(src.webhookUrl, '');
  }
  if (has(rawChannels, 'wecom')) {
    const src = rawChannels.wecom;
    if (has(src, 'webhookUrl')) out.channels.wecom.webhookUrl = sanitizeUrlField(src.webhookUrl, '');
  }
  if (has(rawChannels, 'telegram')) {
    const src = rawChannels.telegram;
    if (has(src, 'botToken')) out.channels.telegram.botToken = sanitizeString(src.botToken, 512);
    if (has(src, 'chatId')) out.channels.telegram.chatId = sanitizeString(src.chatId, 256);
    if (has(src, 'apiBase')) out.channels.telegram.apiBase = sanitizeUrlField(src.apiBase, DEFAULT_NOTIFY_CONFIG.channels.telegram.apiBase);
  }
  if (has(rawChannels, 'webhook')) {
    const src = rawChannels.webhook;
    if (has(src, 'webhookUrl')) out.channels.webhook.webhookUrl = sanitizeUrlField(src.webhookUrl, '');
    if (has(src, 'authHeader')) out.channels.webhook.authHeader = sanitizeString(src.authHeader, 1024);
  }

  return out;
}

function isChannelConfigured(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  const ch = cfg.channel;
  const creds = cfg.channels?.[ch];
  if (!creds || typeof creds !== 'object') return false;
  switch (ch) {
    case 'serverchan':
      return Boolean(String(creds.sendKey || '').trim() || isValidHttpUrl(creds.apiUrl));
    case 'bark':
      return Boolean(isValidHttpUrl(creds.serverUrl) && String(creds.deviceKey || '').trim());
    case 'ntfy':
      return Boolean(isValidHttpUrl(creds.serverUrl) && String(creds.topic || '').trim());
    case 'feishu':
    case 'dingtalk':
    case 'wecom':
    case 'webhook':
      return Boolean(isValidHttpUrl(creds.webhookUrl));
    case 'telegram':
      return Boolean(
        String(creds.botToken || '').trim() &&
          String(creds.chatId || '').trim() &&
          isValidHttpUrl(creds.apiBase)
      );
    default:
      return false;
  }
}

function readNotifyConfig(dataDir) {
  const filePath = getNotifyConfigPath(dataDir);
  try {
    if (!fs.existsSync(filePath)) return cloneDefaultConfig();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitizeNotifyConfig(raw, DEFAULT_NOTIFY_CONFIG);
  } catch {
    return cloneDefaultConfig();
  }
}

function writeNotifyConfig(dataDir, raw, mergeExisting = true) {
  const filePath = getNotifyConfigPath(dataDir);
  const base = mergeExisting ? readNotifyConfig(dataDir) : DEFAULT_NOTIFY_CONFIG;
  const sanitized = sanitizeNotifyConfig(raw, base);
  cdp.atomicWriteFileSync(filePath, JSON.stringify(sanitized, null, 2) + '\n');
  return {
    config: sanitized,
    configured: isChannelConfigured(sanitized),
    path: filePath,
  };
}

function getNotifyStatusSummary(dataDir) {
  const cfg = readNotifyConfig(dataDir);
  return {
    enabled: Boolean(cfg.enabled),
    channel: cfg.channel,
    minDurationSec: cfg.minDurationSec,
    configured: isChannelConfigured(cfg),
  };
}

function readNotifyState(dataDir) {
  const filePath = getNotifyStatePath(dataDir);
  try {
    if (!fs.existsSync(filePath)) return { lastSentByConv: {} };
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const map = {};
    if (raw && raw.lastSentByConv && typeof raw.lastSentByConv === 'object') {
      for (const [k, v] of Object.entries(raw.lastSentByConv)) {
        const ts = Number(v);
        if (k && Number.isFinite(ts) && ts > 0) map[k] = ts;
      }
    }
    return { lastSentByConv: map };
  } catch {
    return { lastSentByConv: {} };
  }
}

function recordNotifySent(dataDir, conversationId, nowMs = Date.now()) {
  const filePath = getNotifyStatePath(dataDir);
  const state = readNotifyState(dataDir);
  const map = { ...state.lastSentByConv };
  const convId = String(conversationId || '').trim();
  if (convId) {
    map[convId] = nowMs;
  }
  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  const next = {
    lastSentAt: nowMs,
    lastSentByConv: Object.fromEntries(entries),
  };
  try {
    cdp.atomicWriteFileSync(filePath, JSON.stringify(next, null, 2) + '\n');
  } catch {}
  return next;
}

const SERVERCHAN_MAX_DESP_BYTES = 28 * 1024;

function clipText(str, maxLen) {
  const s = String(str || '').trim();
  if (s.length <= maxLen) return s;
  if (maxLen <= 1) return s.slice(0, maxLen);
  return `${s.slice(0, maxLen - 1).trimEnd()}…`;
}

function clipUtf8Bytes(str, maxBytes, suffix = '\n\n> *(内容过长，已按 Server酱 32KB 上限自动截断，完整内容请回到电脑查看)*') {
  const s = String(str || '');
  if (!s || Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const budget = Math.max(0, maxBytes - suffixBytes);
  if (budget <= 0) return '';
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(s.slice(0, mid), 'utf8') <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  let end = lo;
  if (end > 0) {
    const code = s.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return `${s.slice(0, end).trimEnd()}${suffix}`;
}

function summarizeReplyText(raw, maxLen = 180) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/```[\s\S]*?```/g, '\n[代码]\n');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');

  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+\.\s+)/, '')
        .replace(/[*_~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);

  // Deduplicate adjacent [代码] / [图片] markers
  const deduped = [];
  for (const line of lines) {
    if ((line === '[代码]' || line === '[图片]') && deduped[deduped.length - 1] === line) {
      continue;
    }
    deduped.push(line);
  }

  const joined = deduped.join('\n').trim();
  if (!joined) return '';
  if (joined.length <= maxLen) return joined;

  if (deduped.length >= 2) {
    const half = Math.max(24, Math.floor((maxLen - 3) / 2));
    const head = clipText(deduped[0], half);
    const tail = clipText(deduped[deduped.length - 1], maxLen - 3 - head.length);
    return `${head}\n…\n${tail}`;
  }

  const single = deduped[0];
  const half = Math.max(20, Math.floor((maxLen - 3) / 2));
  const head = clipText(single, half);
  const tailRaw = single.slice(Math.max(0, single.length - (maxLen - 3 - head.length))).trimStart();
  return `${head} … ${tailRaw}`;
}

function readTranscriptTailSummary(
  transcriptPath,
  { maxBytes = 65536, nowMs = Date.now(), maxSummaryLen = 180 } = {}
) {
  const empty = {
    durationSec: null,
    truncatedBeforeUserInput: false,
    summary: '',
    fullReply: '',
    lastUserInputFromTranscript: '',
  };
  if (!transcriptPath || typeof transcriptPath !== 'string') return empty;

  let fd = null;
  try {
    if (!fs.existsSync(transcriptPath)) return empty;
    fd = fs.openSync(transcriptPath, 'r');
    const stat = fs.fstatSync(fd);
    const size = Number(stat.size || 0);
    if (size <= 0) return empty;

    const toRead = Math.min(size, Math.max(1024, maxBytes));
    const offset = size - toRead;
    const buf = Buffer.allocUnsafe(toRead);
    const bytesRead = fs.readSync(fd, buf, 0, toRead, offset);
    let text = buf.subarray(0, bytesRead).toString('utf8');

    if (offset > 0) {
      const firstNl = text.indexOf('\n');
      text = firstNl >= 0 ? text.slice(firstNl + 1) : '';
    }

    const rawLines = text.split(/\r?\n/);
    const entries = [];
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{') continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {}
    }

    let userInputMs = null;
    let lastUserInputFromTranscript = '';
    let replyText = '';

    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (!e || typeof e !== 'object') continue;
      if (!replyText && e.type === 'PLANNER_RESPONSE' && typeof e.content === 'string' && e.content.trim()) {
        replyText = e.content;
      }
      if (userInputMs === null && (e.type === 'USER_INPUT' || e.source === 'USER_EXPLICIT')) {
        if (e.created_at) {
          const parsedTs = Date.parse(String(e.created_at));
          if (Number.isFinite(parsedTs)) {
            userInputMs = parsedTs;
          }
        }
        if (typeof e.content === 'string' && e.content.trim()) {
          lastUserInputFromTranscript = e.content.trim();
        }
      }
      if (replyText && userInputMs !== null) break;
    }

    const durationSec =
      userInputMs !== null ? Math.max(0, Math.round((nowMs - userInputMs) / 1000)) : null;

    return {
      durationSec,
      truncatedBeforeUserInput: size > toRead && userInputMs === null,
      summary: summarizeReplyText(replyText, maxSummaryLen),
      fullReply: clipUtf8Bytes(String(replyText || '').trim(), SERVERCHAN_MAX_DESP_BYTES),
      lastUserInputFromTranscript,
    };
  } catch {
    return empty;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function shouldSendNotification(payload, cfg, state, nowMs = Date.now(), durationSec = null) {
  if (!cfg?.enabled) {
    return { send: false, reason: 'disabled' };
  }
  if (!isChannelConfigured(cfg)) {
    return { send: false, reason: 'not_configured' };
  }

  const terminationReason = String(payload?.terminationReason || '').toUpperCase();
  const isError =
    terminationReason === 'ERROR' || Boolean(payload?.error && String(payload.error).trim());

  if (terminationReason === 'USER_CANCELED' && cfg.skipUserCanceled !== false) {
    return { send: false, reason: 'user_canceled' };
  }
  if (isError && !cfg.notifyOnError) {
    return { send: false, reason: 'error_muted' };
  }
  if (!isError && cfg.onlyFullyIdle !== false && payload?.fullyIdle === false) {
    return { send: false, reason: 'not_fully_idle' };
  }
  if (
    !isError &&
    cfg.minDurationSec > 0 &&
    typeof durationSec === 'number' &&
    durationSec < cfg.minDurationSec
  ) {
    return { send: false, reason: 'below_min_duration', durationSec };
  }

  const convId = String(payload?.conversationId || '').trim();
  const lastSentAt =
    convId && state?.lastSentByConv ? Number(state.lastSentByConv[convId] || 0) : 0;
  if (
    !isError &&
    cfg.cooldownSec > 0 &&
    convId &&
    lastSentAt > 0 &&
    nowMs - lastSentAt < cfg.cooldownSec * 1000
  ) {
    return { send: false, reason: 'cooldown' };
  }

  return { send: true, isError, durationSec };
}

function formatDuration(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '';
  const total = Math.round(sec);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m${s}s`;
}

function buildNotificationMessage(payload, summaryInfo = {}, cfg = DEFAULT_NOTIFY_CONFIG) {
  const wsRaw =
    (Array.isArray(payload?.workspacePaths) && payload.workspacePaths[0]) || payload?.cwd || '';
  const workspace = wsRaw ? path.basename(String(wsRaw)) || String(wsRaw) : 'Antigravity';
  const terminationReason = String(payload?.terminationReason || '').toUpperCase();
  const isError =
    terminationReason === 'ERROR' || Boolean(payload?.error && String(payload.error).trim());
  const isWarn =
    !isError &&
    (terminationReason === 'MAX_INVOCATIONS' ||
      terminationReason === 'MAX_TOKEN_BUDGET_EXCEEDED' ||
      terminationReason === 'MAX_FORCED_INVOCATIONS');
  const level = isError ? 'error' : isWarn ? 'warn' : 'info';

  const durationSec = typeof summaryInfo?.durationSec === 'number' ? summaryInfo.durationSec : null;
  const durStr = formatDuration(durationSec);
  const durSuffix = durStr ? ` (${durStr})` : '';

  const title = isError
    ? `❌ [${workspace}] 执行异常${durSuffix}`
    : isWarn
    ? `⚠️ [${workspace}] 任务暂停${durSuffix}`
    : `✅ [${workspace}] 任务完成${durSuffix}`;

  const rawPrompt = String(
    payload?.lastUserInput || summaryInfo?.lastUserInputFromTranscript || ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  const promptLine = rawPrompt ? `需求：${clipText(rawPrompt, 80)}` : '';

  let detailLine = '';
  if (isError && payload?.error && String(payload.error).trim()) {
    detailLine = `错误：${clipText(String(payload.error).replace(/\s+/g, ' ').trim(), 240)}`;
  } else if (cfg?.includeSummary !== false && summaryInfo?.summary) {
    detailLine = String(summaryInfo.summary).trim();
  }

  const parts = [];
  if (promptLine) parts.push(promptLine);
  if (detailLine) parts.push(detailLine);
  const body = parts.length > 0 ? parts.join('\n\n') : '任务已结束，请回到电脑查看结果。';

  const short = clipText(
    String(detailLine || summaryInfo?.summary || body)
      .replace(/\s+/g, ' ')
      .trim(),
    64
  );

  let fullBody = '';
  const wantServerChanFull =
    cfg?.channel === 'serverchan' &&
    cfg?.channels?.serverchan?.fullMarkdown !== false &&
    cfg?.includeSummary !== false &&
    !isError &&
    Boolean(summaryInfo?.fullReply && String(summaryInfo.fullReply).trim());
  if (wantServerChanFull) {
    const fullParts = [];
    if (promptLine) fullParts.push(`> ${promptLine}`);
    fullParts.push(String(summaryInfo.fullReply).trim());
    fullBody = clipUtf8Bytes(fullParts.join('\n\n'), SERVERCHAN_MAX_DESP_BYTES);
  }

  return {
    title,
    body,
    short,
    fullBody,
    level,
    workspace,
    durationSec,
    terminationReason,
    conversationId: String(payload?.conversationId || ''),
    timestamp: new Date().toISOString(),
  };
}

function buildChannelRequest(cfg, msg) {
  if (!cfg || !isChannelConfigured(cfg)) {
    throw new Error('Notification channel is not configured');
  }
  const ch = cfg.channel;
  const creds = cfg.channels[ch] || {};
  const title = String(msg?.title || 'Claude Studio Notification');
  const body = String(msg?.body || '');
  const level = String(msg?.level || 'info');

  switch (ch) {
    case 'serverchan': {
      let url = '';
      if (isValidHttpUrl(creds.apiUrl)) {
        url = creds.apiUrl;
      } else {
        const key = String(creds.sendKey || '').trim();
        const sc3Match = /^sctp(\d+)t/i.exec(key);
        url = sc3Match
          ? `https://${sc3Match[1]}.push.ft07.com/send/${encodeURIComponent(key)}.send`
          : `https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`;
      }
      const scTitle = clipText(title, 32);
      const useFull = creds.fullMarkdown !== false && Boolean(msg?.fullBody && String(msg.fullBody).trim());
      const desp = clipUtf8Bytes(useFull ? String(msg.fullBody) : body, SERVERCHAN_MAX_DESP_BYTES);
      const scShort = clipText(
        String(msg?.short || body)
          .replace(/\s+/g, ' ')
          .trim(),
        64
      );
      const payload = { title: scTitle, desp, noip: 1 };
      if (scShort) payload.short = scShort;
      return {
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      };
    }

    case 'bark': {
      const base = String(creds.serverUrl || 'https://api.day.app').replace(/\/+$/, '');
      const payload = {
        device_key: String(creds.deviceKey || '').trim(),
        title,
        body,
      };
      if (creds.group) payload.group = String(creds.group).trim();
      if (creds.sound) payload.sound = String(creds.sound).trim();
      return {
        url: `${base}/push`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      };
    }

    case 'ntfy': {
      const base = String(creds.serverUrl || 'https://ntfy.sh').replace(/\/+$/, '');
      const headers = { 'Content-Type': 'application/json; charset=utf-8' };
      const token = String(creds.token || '').trim();
      if (token) {
        headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }
      // Always use ntfy JSON publish endpoint so UTF-8/emoji titles never trigger fetch ByteString errors.
      const payload = {
        topic: String(creds.topic || '').trim(),
        title,
        message: body,
        priority: level === 'error' ? 4 : 3,
        tags: [level === 'error' ? 'x' : level === 'warn' ? 'warning' : 'white_check_mark'],
      };
      return {
        url: `${base}/`,
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      };
    }

    case 'feishu': {
      return {
        url: creds.webhookUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msg_type: 'text',
          content: { text: body ? `${title}\n${body}` : title },
        }),
      };
    }

    case 'dingtalk': {
      return {
        url: creds.webhookUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            title,
            text: `### ${title}\n\n${body}`,
          },
        }),
      };
    }

    case 'wecom': {
      return {
        url: creds.webhookUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            content: `**${title}**\n${body}`,
          },
        }),
      };
    }

    case 'telegram': {
      const base = String(creds.apiBase || 'https://api.telegram.org').replace(/\/+$/, '');
      const token = String(creds.botToken || '').trim();
      return {
        url: `${base}/bot${encodeURIComponent(token)}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          chat_id: String(creds.chatId || '').trim(),
          text: body ? `${title}\n\n${body}` : title,
        }),
      };
    }

    case 'webhook': {
      const headers = { 'Content-Type': 'application/json; charset=utf-8' };
      const auth = String(creds.authHeader || '').trim();
      if (auth) headers.Authorization = auth;
      return {
        url: creds.webhookUrl,
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          body,
          level,
          workspace: msg?.workspace || '',
          durationSec: msg?.durationSec ?? null,
          terminationReason: msg?.terminationReason || '',
          conversationId: msg?.conversationId || '',
          timestamp: msg?.timestamp || new Date().toISOString(),
        }),
      };
    }

    default:
      throw new Error(`Unsupported channel: ${ch}`);
  }
}

function interpretChannelResponse(channel, resStatus, jsonBody) {
  if (!jsonBody || typeof jsonBody !== 'object') {
    return { ok: true };
  }
  switch (channel) {
    case 'serverchan': {
      const errno = jsonBody.errno ?? jsonBody.code;
      if (errno !== undefined && Number(errno) !== 0) {
        return { ok: false, error: jsonBody.errmsg || jsonBody.message || `errno ${errno}` };
      }
      return { ok: true };
    }
    case 'bark': {
      if (jsonBody.code !== undefined && Number(jsonBody.code) !== 200) {
        return { ok: false, error: jsonBody.message || `code ${jsonBody.code}` };
      }
      return { ok: true };
    }
    case 'feishu': {
      const code = jsonBody.code ?? jsonBody.StatusCode;
      if (code !== undefined && Number(code) !== 0) {
        return { ok: false, error: jsonBody.msg || jsonBody.StatusMessage || `code ${code}` };
      }
      return { ok: true };
    }
    case 'dingtalk':
    case 'wecom': {
      if (jsonBody.errcode !== undefined && Number(jsonBody.errcode) !== 0) {
        return { ok: false, error: jsonBody.errmsg || `errcode ${jsonBody.errcode}` };
      }
      return { ok: true };
    }
    case 'telegram': {
      if (jsonBody.ok === false) {
        return { ok: false, error: jsonBody.description || `HTTP ${resStatus}` };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

async function deliverNotification(
  cfg,
  msg,
  { fetchFn = typeof fetch === 'function' ? fetch : null, timeoutMs = 5000 } = {}
) {
  const startedAt = Date.now();
  const channel = cfg?.channel || 'unknown';
  if (!fetchFn) {
    return { ok: false, channel, status: 0, error: 'fetch unavailable', latencyMs: 0 };
  }
  let reqSpec;
  try {
    reqSpec = buildChannelRequest(cfg, msg);
  } catch (err) {
    return {
      ok: false,
      channel,
      status: 0,
      error: err?.message || 'invalid channel config',
      latencyMs: Date.now() - startedAt,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 5000));
  timer.unref?.();

  try {
    const res = await fetchFn(reqSpec.url, {
      method: reqSpec.method,
      headers: reqSpec.headers,
      body: reqSpec.body,
      signal: controller.signal,
    });

    let rawText = '';
    try {
      rawText = await res.text();
    } catch {}

    let parsedJson = null;
    if (rawText && (rawText.trim().startsWith('{') || rawText.trim().startsWith('['))) {
      try {
        parsedJson = JSON.parse(rawText);
      } catch {}
    }

    if (!res.ok) {
      const apiErr = parsedJson?.error || parsedJson?.errmsg || parsedJson?.message || parsedJson?.description;
      return {
        ok: false,
        channel,
        status: res.status,
        error: apiErr ? String(apiErr) : `HTTP ${res.status}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    const interpreted = interpretChannelResponse(channel, res.status, parsedJson);
    if (!interpreted.ok) {
      return {
        ok: false,
        channel,
        status: res.status,
        error: interpreted.error,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      ok: true,
      channel,
      status: res.status,
      error: '',
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      channel,
      status: 0,
      error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'network error',
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  CHANNEL_LIST,
  DEFAULT_NOTIFY_CONFIG,
  resolveNotifyDataDir,
  getNotifyConfigPath,
  getNotifyStatePath,
  isValidHttpUrl,
  sanitizeNotifyConfig,
  isChannelConfigured,
  readNotifyConfig,
  writeNotifyConfig,
  getNotifyStatusSummary,
  readNotifyState,
  recordNotifySent,
  summarizeReplyText,
  readTranscriptTailSummary,
  shouldSendNotification,
  formatDuration,
  buildNotificationMessage,
  buildChannelRequest,
  deliverNotification,
};
