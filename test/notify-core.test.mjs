import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const cdp = require(path.join(ROOT_DIR, 'cdp.js'));
const notifyCore = require(path.join(ROOT_DIR, 'notify-core.js'));

test('notifyCore.resolveNotifyDataDir prioritizes test override, PLUGIN_DATA, and skips unresolved placeholders', () => {
  const overridden = notifyCore.resolveNotifyDataDir({
    AGY_CLAUDE_STUDIO_NOTIFY_DATA_DIR: '/tmp/override-notify',
    PLUGIN_DATA: '/tmp/hook-data',
  });
  assert.equal(overridden, path.resolve('/tmp/override-notify'));

  const fromHook = notifyCore.resolveNotifyDataDir({
    PLUGIN_DATA: '/tmp/plugin-data-dir',
    ANTIGRAVITY_EXECUTABLE_DATA_DIR: '/tmp/sidecar_data/agy-claude-studio/studio',
  });
  assert.equal(fromHook, path.resolve('/tmp/plugin-data-dir'));

  const skippedPlaceholder = notifyCore.resolveNotifyDataDir(
    {
      PLUGIN_DATA: '${PLUGIN_DATA}',
      AGY_CLAUDE_STUDIO_PLUGIN_DATA: '${AGY_CLAUDE_STUDIO_PLUGIN_DATA}',
    },
    '/tmp/fallback-dir'
  );
  assert.equal(skippedPlaceholder, path.resolve('/tmp/fallback-dir'));

  const fromSidecarEnv = notifyCore.resolveNotifyDataDir({
    ANTIGRAVITY_EXECUTABLE_DATA_DIR: path.join(os.tmpdir(), 'ag-test', 'sidecar_data', 'agy-claude-studio', 'studio'),
    ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:42000',
  });
  assert.equal(
    fromSidecarEnv,
    path.join(os.tmpdir(), 'ag-test', 'plugin_data', 'agy-claude-studio')
  );
});

test('notifyCore.sanitizeNotifyConfig clamps bounds, guards URL schemes, and merges cleanly', () => {
  const clean = notifyCore.sanitizeNotifyConfig({
    enabled: true,
    channel: 'invalid-channel',
    minDurationSec: 99999,
    cooldownSec: -5,
    channels: {
      serverchan: { sendKey: '  SCT123456  ', apiUrl: 'javascript:alert(1)' },
      bark: { serverUrl: 'file:///etc/passwd', deviceKey: 'bark-key-1' },
      ntfy: { serverUrl: 'https://ntfy.example.com/', topic: ' agy ' },
      webhook: { webhookUrl: 'http://127.0.0.1:9000/hook', authHeader: ' Bearer tok ' },
    },
  });

  assert.equal(clean.enabled, true);
  assert.equal(clean.channel, 'serverchan');
  assert.equal(clean.minDurationSec, 3600);
  assert.equal(clean.cooldownSec, 0);
  assert.equal(clean.channels.serverchan.sendKey, 'SCT123456');
  assert.equal(clean.channels.serverchan.apiUrl, '');
  assert.equal(clean.channels.bark.serverUrl, 'https://api.day.app');
  assert.equal(clean.channels.bark.deviceKey, 'bark-key-1');
  assert.equal(clean.channels.ntfy.topic, 'agy');
  assert.equal(clean.channels.webhook.webhookUrl, 'http://127.0.0.1:9000/hook');
  assert.equal(clean.channels.webhook.authHeader, 'Bearer tok');

  // Merging partial config preserves sibling channel credentials
  const merged = notifyCore.sanitizeNotifyConfig(
    {
      channel: 'bark',
      channels: {
        bark: { deviceKey: 'bark-key-2' },
      },
    },
    clean
  );
  assert.equal(merged.channel, 'bark');
  assert.equal(merged.channels.serverchan.sendKey, 'SCT123456');
  assert.equal(merged.channels.bark.deviceKey, 'bark-key-2');
});

test('notifyCore.readTranscriptTailSummary computes turn duration, strips code blocks, and handles >64KB logs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cs-transcript-'));
  try {
    const smallFile = path.join(tmpDir, 'small.jsonl');
    const nowMs = Date.parse('2026-11-24T12:01:00Z');
    const lines = [
      JSON.stringify({
        step_index: 1,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-11-24T12:00:15Z',
        content: '帮我修复登录页报错',
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-24T12:00:55Z',
        content:
          '已定位到 Token 过期刷新竞态问题：\n```js\nrefreshToken();\n```\n详情见 [auth.js](file:///src/auth.js)。\n全部单元测试已通过，可直接验证上线。',
      }),
    ];
    fs.writeFileSync(smallFile, lines.join('\n') + '\n', 'utf8');

    const res = notifyCore.readTranscriptTailSummary(smallFile, { nowMs, maxSummaryLen: 180 });
    assert.equal(res.durationSec, 45);
    assert.equal(res.truncatedBeforeUserInput, false);
    assert.equal(res.lastUserInputFromTranscript, '帮我修复登录页报错');
    assert.ok(res.summary.includes('[代码]'));
    assert.ok(!res.summary.includes('refreshToken();'));
    assert.ok(res.summary.includes('auth.js'));
    assert.ok(!res.summary.includes('file:///src/auth.js'));
    assert.ok(res.summary.includes('全部单元测试已通过'));

    // Large file > 64KB where USER_INPUT fell out of tail window
    const largeFile = path.join(tmpDir, 'large.jsonl');
    const filler = 'x'.repeat(2048);
    const largeLines = [
      JSON.stringify({
        step_index: 1,
        type: 'USER_INPUT',
        created_at: '2026-11-24T11:50:00Z',
        content: '长任务开始',
      }),
    ];
    for (let i = 0; i < 40; i++) {
      largeLines.push(JSON.stringify({ step_index: i + 2, type: 'TOOL_RESULT', content: filler }));
    }
    largeLines.push(
      JSON.stringify({
        step_index: 99,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-24T12:00:50Z',
        content: '第一段总览说明。\n\n中间过程细节很多' + 'A'.repeat(240) + '\n\n最后结论：全部构建与校验已完成。',
      })
    );
    fs.writeFileSync(largeFile, largeLines.join('\n') + '\n', 'utf8');

    const largeRes = notifyCore.readTranscriptTailSummary(largeFile, { maxBytes: 4096, nowMs, maxSummaryLen: 120 });
    assert.equal(largeRes.durationSec, null);
    assert.equal(largeRes.truncatedBeforeUserInput, true);
    assert.ok(largeRes.summary.includes('第一段总览说明'));
    assert.ok(largeRes.summary.includes('最后结论'));
    assert.ok(largeRes.summary.length <= 122);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('notifyCore.shouldSendNotification enforces filtering, error bypass, null duration pass, and cooldowns', () => {
  const baseCfg = notifyCore.sanitizeNotifyConfig({
    enabled: true,
    channel: 'serverchan',
    minDurationSec: 15,
    cooldownSec: 20,
    onlyFullyIdle: true,
    notifyOnError: true,
    skipUserCanceled: true,
    channels: { serverchan: { sendKey: 'SCT-TEST' } },
  });
  const now = 1_700_000_000_000;

  assert.equal(
    notifyCore.shouldSendNotification({ terminationReason: 'NO_TOOL_CALL', fullyIdle: true }, { ...baseCfg, enabled: false }, {}, now, 30).reason,
    'disabled'
  );
  assert.equal(
    notifyCore.shouldSendNotification({ terminationReason: 'NO_TOOL_CALL', fullyIdle: true }, { ...baseCfg, channels: { serverchan: { sendKey: '', apiUrl: '' } } }, {}, now, 30).reason,
    'not_configured'
  );
  assert.equal(
    notifyCore.shouldSendNotification({ terminationReason: 'USER_CANCELED', fullyIdle: true }, baseCfg, {}, now, 30).reason,
    'user_canceled'
  );
  assert.equal(
    notifyCore.shouldSendNotification({ terminationReason: 'NO_TOOL_CALL', fullyIdle: false }, baseCfg, {}, now, 30).reason,
    'not_fully_idle'
  );
  assert.equal(
    notifyCore.shouldSendNotification({ terminationReason: 'NO_TOOL_CALL', fullyIdle: true }, baseCfg, {}, now, 8).reason,
    'below_min_duration'
  );
  // durationSec === null (truncated large file) should still notify
  assert.equal(
    notifyCore.shouldSendNotification({ terminationReason: 'NO_TOOL_CALL', fullyIdle: true }, baseCfg, {}, now, null).send,
    true
  );

  // Cooldown per conversationId
  const state = { lastSentByConv: { 'conv-a': now - 5000 } };
  assert.equal(
    notifyCore.shouldSendNotification({ conversationId: 'conv-a', terminationReason: 'NO_TOOL_CALL', fullyIdle: true }, baseCfg, state, now, 30).reason,
    'cooldown'
  );
  assert.equal(
    notifyCore.shouldSendNotification({ conversationId: 'conv-b', terminationReason: 'NO_TOOL_CALL', fullyIdle: true }, baseCfg, state, now, 30).send,
    true
  );

  // ERROR bypasses fullyIdle: false, minDurationSec, and cooldown
  assert.equal(
    notifyCore.shouldSendNotification({ conversationId: 'conv-a', terminationReason: 'ERROR', error: 'Boom', fullyIdle: false }, baseCfg, state, now, 2).send,
    true
  );
  assert.equal(
    notifyCore.shouldSendNotification({ conversationId: 'conv-a', terminationReason: 'ERROR', error: 'Boom' }, { ...baseCfg, notifyOnError: false }, state, now, 2).reason,
    'error_muted'
  );
});

test('notifyCore builds and delivers all 8 channels cleanly including UTF-8 ntfy JSON and error interpretation', async () => {
  const msg = notifyCore.buildNotificationMessage(
    {
      workspacePaths: ['/tmp/my-app'],
      terminationReason: 'NO_TOOL_CALL',
      lastUserInput: '构建生产包',
      conversationId: 'c1',
    },
    { durationSec: 75, summary: '构建完成，产物已输出。' },
    notifyCore.DEFAULT_NOTIFY_CONFIG
  );
  assert.equal(msg.title, '✅ [my-app] 任务完成 (1m15s)');
  assert.ok(msg.body.includes('需求：构建生产包'));
  assert.ok(msg.body.includes('构建完成'));

  // ServerChan Turbo vs ServerChan3
  const scTurbo = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({
      enabled: true,
      channel: 'serverchan',
      channels: { serverchan: { sendKey: 'SCT999ABC' } },
    }),
    msg
  );
  assert.equal(scTurbo.url, 'https://sctapi.ftqq.com/SCT999ABC.send');

  const sc3 = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({
      enabled: true,
      channel: 'serverchan',
      channels: { serverchan: { sendKey: 'sctp1234tXYZ' } },
    }),
    msg
  );
  assert.equal(sc3.url, 'https://1234.push.ft07.com/send/sctp1234tXYZ.send');

  // Bark, ntfy (JSON body with UTF-8/emoji, pure ASCII headers), Feishu, DingTalk, WeCom, Telegram, Webhook
  const barkReq = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({
      enabled: true,
      channel: 'bark',
      channels: { bark: { deviceKey: 'bk1', serverUrl: 'https://bark.example.com/', group: 'Work', sound: 'bell' } },
    }),
    msg
  );
  assert.equal(barkReq.url, 'https://bark.example.com/push');
  assert.equal(JSON.parse(barkReq.body).device_key, 'bk1');

  const ntfyReq = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({
      enabled: true,
      channel: 'ntfy',
      channels: { ntfy: { topic: 'agy-test', serverUrl: 'https://ntfy.sh', token: 'tk_abc' } },
    }),
    msg
  );
  assert.equal(ntfyReq.url, 'https://ntfy.sh/');
  assert.equal(ntfyReq.headers.Authorization, 'Bearer tk_abc');
  for (const v of Object.values(ntfyReq.headers)) {
    assert.ok(/^[\x00-\x7f]*$/.test(String(v)), 'ntfy headers must remain pure ASCII');
  }
  assert.equal(JSON.parse(ntfyReq.body).title, msg.title);

  const feishuReq = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({ channel: 'feishu', channels: { feishu: { webhookUrl: 'https://open.feishu.cn/hook/1' } } }),
    msg
  );
  assert.equal(JSON.parse(feishuReq.body).msg_type, 'text');

  const dingReq = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({ channel: 'dingtalk', channels: { dingtalk: { webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=1' } } }),
    msg
  );
  assert.equal(JSON.parse(dingReq.body).msgtype, 'markdown');

  const wecomReq = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({ channel: 'wecom', channels: { wecom: { webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1' } } }),
    msg
  );
  assert.equal(JSON.parse(wecomReq.body).msgtype, 'markdown');

  const tgReq = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({ channel: 'telegram', channels: { telegram: { botToken: '123:ABC', chatId: '-1001' } } }),
    msg
  );
  assert.equal(tgReq.url, 'https://api.telegram.org/bot123%3AABC/sendMessage');
  assert.equal(JSON.parse(tgReq.body).chat_id, '-1001');

  const whReq = notifyCore.buildChannelRequest(
    notifyCore.sanitizeNotifyConfig({ channel: 'webhook', channels: { webhook: { webhookUrl: 'https://example.com/hook', authHeader: 'Bearer x' } } }),
    msg
  );
  assert.equal(whReq.headers.Authorization, 'Bearer x');
  assert.equal(JSON.parse(whReq.body).workspace, 'my-app');

  // deliverNotification interprets channel JSON errors & HTTP errors
  const scCfg = notifyCore.sanitizeNotifyConfig({
    enabled: true,
    channel: 'serverchan',
    channels: { serverchan: { sendKey: 'SCT-TEST' } },
  });
  const okRes = await notifyCore.deliverNotification(scCfg, msg, {
    fetchFn: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ errno: 0 }); } }),
  });
  assert.equal(okRes.ok, true);

  const errRes = await notifyCore.deliverNotification(scCfg, msg, {
    fetchFn: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ errno: 40001, errmsg: 'bad sendkey' }); } }),
  });
  assert.equal(errRes.ok, false);
  assert.equal(errRes.error, 'bad sendkey');
});

test('notify.json isolates secrets from config.json & renderer injection, and Stop hook runs non-blockingly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cs-notify-e2e-'));
  try {
    const secretKey = 'SUPER_SECRET_KEY_DO_NOT_LEAK';
    notifyCore.writeNotifyConfig(tmpDir, {
      enabled: true,
      channel: 'serverchan',
      minDurationSec: 0,
      channels: { serverchan: { sendKey: secretKey } },
    });

    assert.equal(fs.existsSync(path.join(tmpDir, 'notify.json')), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'config.json')), false);

    const summary = notifyCore.getNotifyStatusSummary(tmpDir);
    assert.deepEqual(summary, {
      enabled: true,
      channel: 'serverchan',
      minDurationSec: 0,
      configured: true,
    });
    assert.equal(JSON.stringify(summary).includes(secretKey), false);

    const injectedExpr = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
    assert.equal(injectedExpr.includes(secretKey), false);
    assert.equal(cdp.RUNTIME_PARTS.includes('notify-core.js'), false);

    // Validate hooks.json contract
    const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'hooks.json'), 'utf8'));
    const stopList = hooksJson['claude-studio-notify']?.Stop;
    assert.ok(Array.isArray(stopList) && stopList.length === 1);
    assert.equal(stopList[0].type, 'command');
    assert.equal(stopList[0].command, 'node ./scripts/notify-stop.mjs');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'scripts', 'notify-stop.mjs')));

    // Start local HTTP server to verify detached hook delivery end-to-end
    const received = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          received.push({
            auth: req.headers.authorization || '',
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });

    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const addr = server.address();
      notifyCore.writeNotifyConfig(
        tmpDir,
        {
          enabled: true,
          channel: 'webhook',
          minDurationSec: 15,
          channels: {
            webhook: {
              webhookUrl: `http://127.0.0.1:${addr.port}/hook`,
              authHeader: 'Bearer unit-test',
            },
          },
        },
        false
      );

      // 1) Skipped USER_CANCELED outputs {} immediately and triggers nothing
      const skipped = spawnSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'notify-stop.mjs')], {
        input: JSON.stringify({
          conversationId: 'conv-cancel',
          terminationReason: 'USER_CANCELED',
          fullyIdle: true,
        }),
        env: { ...process.env, AGY_CLAUDE_STUDIO_NOTIFY_DATA_DIR: tmpDir },
        encoding: 'utf8',
      });
      assert.equal(skipped.status, 0);
      assert.deepEqual(JSON.parse(skipped.stdout.trim()), {});
      assert.equal(received.length, 0);

      // 2) Valid long turn spawns detached worker & delivers to localhost HTTP server
      const transcriptPath = path.join(tmpDir, 'session.jsonl');
      const now = Date.now();
      fs.writeFileSync(
        transcriptPath,
        [
          JSON.stringify({
            type: 'USER_INPUT',
            source: 'USER_EXPLICIT',
            created_at: new Date(now - 25000).toISOString(),
            content: '跑完测试并构建',
          }),
          JSON.stringify({
            type: 'PLANNER_RESPONSE',
            created_at: new Date(now - 1000).toISOString(),
            content: '全部测试通过！',
          }),
        ].join('\n') + '\n',
        'utf8'
      );

      const triggered = spawnSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'notify-stop.mjs')], {
        input: JSON.stringify({
          conversationId: 'conv-done',
          workspacePaths: ['/tmp/studio-repo'],
          transcriptPath,
          lastUserInput: '跑完测试并构建',
          terminationReason: 'NO_TOOL_CALL',
          fullyIdle: true,
        }),
        env: { ...process.env, AGY_CLAUDE_STUDIO_NOTIFY_DATA_DIR: tmpDir },
        encoding: 'utf8',
      });
      assert.equal(triggered.status, 0);
      assert.deepEqual(JSON.parse(triggered.stdout.trim()), {});

      const deadline = Date.now() + 5000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.equal(received.length, 1, 'Detached worker should deliver HTTP webhook');
      assert.equal(received[0].auth, 'Bearer unit-test');
      assert.ok(received[0].body.title.includes('[studio-repo]'));
      assert.ok(received[0].body.body.includes('全部测试通过'));
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ServerChan fullMarkdown sends full Markdown up to ~28KB with title<=32, short<=64, noip=1, while other channels stay concise', async () => {
  const longMd = `# 变更总结\n\n${'- 完成第 N 项检查并验证通过，保留完整 Markdown 代码块与细节说明。\n'.repeat(420)}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-notify-sc-full-'));
  try {
    const transcriptPath = path.join(tmpDir, 'long.jsonl');
    const now = Date.now();
    fs.writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: 'USER_INPUT', source: 'USER_EXPLICIT', created_at: new Date(now - 35000).toISOString(), content: '生成一份完整发版检查报告' }),
        JSON.stringify({ type: 'PLANNER_RESPONSE', created_at: new Date(now - 1000).toISOString(), content: longMd }),
      ].join('\n') + '\n',
      'utf8'
    );

    const summaryInfo = notifyCore.readTranscriptTailSummary(transcriptPath, { nowMs: now });
    assert.ok(summaryInfo.fullReply.includes('# 变更总结'));
    assert.ok(Buffer.byteLength(summaryInfo.fullReply, 'utf8') <= 28 * 1024);

    // 1) ServerChan with fullMarkdown=true (default)
    const scCfg = notifyCore.sanitizeNotifyConfig({
      enabled: true,
      channel: 'serverchan',
      channels: { serverchan: { sendKey: 'SCT123456', fullMarkdown: true } },
    });
    const scMsg = notifyCore.buildNotificationMessage(
      { workspacePaths: ['/tmp/very-long-workspace-directory-name-for-title-clip'], lastUserInput: '生成一份完整发版检查报告', terminationReason: 'NO_TOOL_CALL' },
      summaryInfo,
      scCfg
    );
    const scReq = notifyCore.buildChannelRequest(scCfg, scMsg);
    const scPayload = JSON.parse(scReq.body);
    assert.ok(scPayload.title.length <= 32, 'ServerChan title must be <= 32 chars');
    assert.ok(scPayload.short.length <= 64, 'ServerChan short preview must be <= 64 chars');
    assert.equal(scPayload.noip, 1);
    assert.ok(scPayload.desp.includes('# 变更总结'), 'ServerChan fullMarkdown sends full Markdown desp');
    assert.ok(Buffer.byteLength(scPayload.desp, 'utf8') <= 28 * 1024, 'ServerChan desp stays within 28KB safe ceiling');
    assert.ok(scPayload.desp.length > 5000, 'Full Markdown desp should preserve multi-KB content');

    // 2) ServerChan with fullMarkdown=false falls back to concise summary
    const scShortCfg = notifyCore.sanitizeNotifyConfig({
      enabled: true,
      channel: 'serverchan',
      channels: { serverchan: { sendKey: 'SCT123456', fullMarkdown: false } },
    });
    const scShortMsg = notifyCore.buildNotificationMessage(
      { workspacePaths: ['/tmp/demo'], lastUserInput: '生成报告', terminationReason: 'NO_TOOL_CALL' },
      summaryInfo,
      scShortCfg
    );
    assert.equal(scShortMsg.fullBody, '');
    const scShortPayload = JSON.parse(notifyCore.buildChannelRequest(scShortCfg, scShortMsg).body);
    assert.ok(scShortPayload.desp.length < 400, 'Disabling fullMarkdown keeps desp concise');

    // 3) Non-ServerChan channels (e.g. Bark) NEVER get fullBody
    const barkCfg = notifyCore.sanitizeNotifyConfig({
      enabled: true,
      channel: 'bark',
      channels: { bark: { deviceKey: 'dev-1' } },
    });
    const barkMsg = notifyCore.buildNotificationMessage(
      { workspacePaths: ['/tmp/demo'], lastUserInput: '生成报告', terminationReason: 'NO_TOOL_CALL' },
      summaryInfo,
      barkCfg
    );
    assert.equal(barkMsg.fullBody, '');
    const barkPayload = JSON.parse(notifyCore.buildChannelRequest(barkCfg, barkMsg).body);
    assert.ok(barkPayload.body.length < 400, 'Bark stays strictly concise');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
