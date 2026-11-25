import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scriptsCore = require('../scripts-core.js');
const i18nCore = require('../i18n-core.js');
const i18nLocales = require('../i18n-locales.js');
const studioMain = await import('../sidecars/studio/main.mjs');

test('scripts-core parses args, CRUDs entries in scripts.json, and executes scripts with shell:false', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-scripts-'));
  try {
    assert.deepEqual(scriptsCore.parseArgsInput('--bvid BV1abc "hello world" --push'), [
      '--bvid',
      'BV1abc',
      'hello world',
      '--push',
    ]);

    const demoScript = path.join(tmpDir, 'hello.mjs');
    fs.writeFileSync(
      demoScript,
      'console.log("GREETING:" + process.argv.slice(2).join("|"));\n',
      'utf8'
    );

    const added = scriptsCore.upsertCustomScript(tmpDir, {
      name: 'Demo Echo',
      scriptPath: demoScript,
      args: '--flag "two words"',
      timeoutSec: 15,
    });
    assert.equal(added.ok, true);
    assert.equal(added.scripts.length, 1);
    const id = added.script.id;

    const runRes = await scriptsCore.runCustomScript(tmpDir, id);
    assert.equal(runRes.ok, true);
    assert.equal(runRes.exitCode, 0);
    assert.match(runRes.stdout, /GREETING:--flag\|two words/);
    assert.match(runRes.summary, /GREETING:--flag\|two words/);

    const reloaded = scriptsCore.readScriptsConfig(tmpDir);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].lastExitCode, 0);
    assert.ok(reloaded[0].lastRunAt);

    const delRes = scriptsCore.deleteCustomScript(tmpDir, id);
    assert.equal(delRes.ok, true);
    assert.equal(delRes.scripts.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getLiveTasksApi queries ConversationService and tail GetCascadeTrajectorySteps for step activity details', async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    if (url.includes('GetAllCascadeTrajectories')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          trajectorySummaries: {
            'run-1': { stepCount: 250, status: 'CASCADE_RUN_STATUS_RUNNING' },
            'sub-1': {
              stepCount: 14,
              status: 'CASCADE_RUN_STATUS_RUNNING',
              trajectoryMetadata: { subagentSpec: { typeName: 'browser', role: 'GitHub Settings Inspector' } },
            },
            'sub-2': {
              stepCount: 9,
              status: 'CASCADE_RUN_STATUS_IDLE',
              latestExecutorTerminationReason: 'EXECUTOR_TERMINATION_REASON_USER_CANCELED',
              trajectoryMetadata: { subagentSpec: { typeName: 'worker', role: 'Swarm Worker (i18n-sonnet)' }, agentScript: { name: 'i18n-sonnet' } },
            },
          },
        }),
      };
    }
    if (url.includes('GetCascadeTrajectorySteps')) {
      assert.equal(body.stepOffset, 238);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          steps: [
            {
              type: 'CORTEX_STEP_TYPE_VIEW_FILE',
              status: 'CORTEX_STEP_STATUS_RUNNING',
              viewFile: { absolutePathUri: 'file:///d:/repo/sidecars/studio/main.mjs', startLine: 9, endLine: 39 },
              metadata: { createdAt: '2026-11-25T02:00:00Z' },
            },
          ],
        }),
      };
    }
    if (body.parentConversationId === 'run-1') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          conversations: [
            { id: 'sub-1', state: { runState: 'RUN_STATE_RUNNING' } },
            { id: 'sub-2', state: { runState: 'RUN_STATE_IDLE' } },
          ],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        conversations: [
          {
            id: 'run-1',
            annotations: { title: 'Refactor Studio Sidecar' },
            state: { runState: 'RUN_STATE_RUNNING', updateTime: '2026-11-25T02:00:00Z' },
          },
          {
            id: 'idle-1',
            annotations: { title: 'Release Notes' },
            state: { runState: 'RUN_STATE_IDLE', updateTime: '2026-11-25T01:00:00Z' },
          },
        ],
      }),
    };
  };

  const res = await studioMain.getLiveTasksApi({
    env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:9999', ANTIGRAVITY_CSRF_TOKEN: 'tok-test' },
    fetchFn: mockFetch,
    allowCdpFallback: false,
  });
  assert.equal(res.ok, true);
  assert.equal(res.available, true);
  assert.equal(res.source, 'conversation_service');
  assert.equal(res.running.length, 1);
  assert.equal(res.running[0].title, 'Refactor Studio Sidecar');
  assert.equal(res.running[0].subagentCount, 2);
  assert.equal(res.running[0].activeSubagentCount, 1);
  assert.equal(res.running[0].stepCount, 250);
  assert.equal(res.running[0].activity?.kind, 'reading_file');
  assert.equal(res.running[0].activity?.detail, 'main.mjs:10-40');
  assert.equal(res.running[0].subagents.length, 2);
  assert.equal(res.running[0].subagents[0].kind, 'subagent');
  assert.equal(res.running[0].subagents[0].title, 'GitHub Settings Inspector');
  assert.equal(res.running[0].subagents[0].state, 'running');
  assert.equal(res.running[0].subagents[0].stepCount, 14);
  assert.equal(res.running[0].subagents[1].kind, 'swarm');
  assert.equal(res.running[0].subagents[1].title, '@i18n-sonnet');
  assert.equal(res.running[0].subagents[1].state, 'stopped');
  assert.equal(res.running[0].subagents[1].stepCount, 9);
  assert.equal(res.recent.length, 1);
  assert.equal(calls.length, 4);

  // Parallel tool batch progress ignores bookkeeping steps and reports [done/total]
  const batchAct = studioMain.classifyLiveStepActivity([
    { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', status: 'CORTEX_STEP_STATUS_DONE', plannerResponse: { toolCalls: [{ name: 'update_focus' }, { name: 'read_file' }, { name: 'read_file' }, { name: 'read_file' }] } },
    { type: 'CORTEX_STEP_TYPE_GENERIC', status: 'CORTEX_STEP_STATUS_DONE', metadata: { toolCall: { name: 'update_focus' } } },
    { type: 'CORTEX_STEP_TYPE_VIEW_FILE', status: 'CORTEX_STEP_STATUS_DONE', viewFile: { absolutePathUri: 'file:///d:/repo/a.js', startLine: 0, endLine: 49 } },
    { type: 'CORTEX_STEP_TYPE_VIEW_FILE', status: 'CORTEX_STEP_STATUS_DONE', viewFile: { absolutePathUri: 'file:///d:/repo/b.js', startLine: 99, endLine: 199 } },
    { type: 'CORTEX_STEP_TYPE_VIEW_FILE', status: 'CORTEX_STEP_STATUS_RUNNING', viewFile: { absolutePathUri: 'file:///d:/repo/c.js', startLine: 0, endLine: 19 } },
  ]);
  assert.equal(batchAct.kind, 'reading_file');
  assert.deepEqual(batchAct.batch, { done: 2, total: 3 });
  assert.equal(batchAct.detail, 'a.js:1-50, b.js:100-200');

  const thinkingAct = studioMain.classifyLiveStepActivity([
    { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', status: 'CORTEX_STEP_STATUS_GENERATING', plannerResponse: { thinking: 'analyzing...' } },
  ]);
  assert.equal(thinkingAct.kind, 'thinking');

  const cmdAct = studioMain.classifyLiveStepActivity([
    { type: 'CORTEX_STEP_TYPE_GENERIC', status: 'CORTEX_STEP_STATUS_RUNNING', metadata: { toolCall: { name: 'run_command', argumentsJson: JSON.stringify({ toolSummary: 'Run unit tests' }) } } },
  ]);
  assert.equal(cmdAct.kind, 'running_command');
  assert.equal(cmdAct.detail, 'Run unit tests');

  const unavailable = await studioMain.getLiveTasksApi({
    env: {},
    fetchFn: mockFetch,
    allowCdpFallback: false,
  });
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.available, false);
});

test('i18n-core translates split React text nodes like ["No ", "automations", " yet"] and reverts losslessly', () => {
  const prevNodeFilter = globalThis.NodeFilter;
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  try {
    const mkText = (val, parent) => ({ nodeType: 3, nodeValue: val, parentElement: parent, isConnected: true });
    const p = {
      nodeType: 1,
      tagName: 'P',
      childNodes: [],
      parentElement: null,
      isConnected: true,
      matches: () => false,
      closest: () => null,
      getAttribute: () => null,
      setAttribute: () => {},
      querySelectorAll: () => [],
    };
    const t1 = mkText('No ', p);
    const t2 = mkText('automations', p);
    const t3 = mkText(' yet', p);
    p.childNodes.push(t1, t2, t3);

    const nodes = [p, t1, t2, t3];
    const doc = {
      nodeType: 9,
      body: p,
      createTreeWalker: () => {
        let idx = -1;
        return {
          currentNode: null,
          nextNode() {
            idx += 1;
            if (idx >= nodes.length) return false;
            this.currentNode = nodes[idx];
            return true;
          },
        };
      },
    };
    p.ownerDocument = doc;

    const bundle = i18nLocales.resolveLocaleBundle('zh-CN');
    const tr = i18nCore.createDomTranslator(() => bundle);
    tr.setLanguage('zh-CN', doc);
    assert.equal(t1.nodeValue + t2.nodeValue + t3.nodeValue, '暂无自动化任务');
    assert.equal(t2.nodeValue, '');
    assert.equal(t3.nodeValue, '');

    tr.destroy();
    assert.equal(t1.nodeValue, 'No ');
    assert.equal(t2.nodeValue, 'automations');
    assert.equal(t3.nodeValue, ' yet');
  } finally {
    if (prevNodeFilter === undefined) delete globalThis.NodeFilter;
    else globalThis.NodeFilter = prevNodeFilter;
  }
});

test('getConversationInspectorApi returns real environment, context breakdown, connectors, skills/rules, and outputs, and openInspectorFileApi enforces sandbox boundaries', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-insp-'));
  try {
    const wsDir = path.join(tmpDir, 'my-repo');
    fs.mkdirSync(path.join(wsDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, '.git', 'HEAD'), 'ref: refs/heads/feat/v2.2\n', 'utf8');
    fs.writeFileSync(path.join(wsDir, 'AGENTS.md'), '# Repo rules\n', 'utf8');

    const appDataDir = path.join(tmpDir, 'appdata');
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(path.join(appDataDir, 'mcp', 'agent-hud'), { recursive: true });
    fs.writeFileSync(path.join(appDataDir, 'mcp', 'agent-hud', 'get_hud.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(appDataDir, 'mcp', 'agent-hud', 'draft_hud.json'), '{}', 'utf8');
    // Stale uninstalled host with 0 tools should be ignored
    fs.mkdirSync(path.join(appDataDir, 'mcp', 'stale-uninstalled-host'), { recursive: true });

    fs.mkdirSync(path.join(configDir, 'skills', 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\n---\n', 'utf8');
    fs.mkdirSync(path.join(configDir, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'rules', 'GEMINI.md'), '# User rule\n', 'utf8');

    const convId = 'conv-inspector-test-1';
    const brainDir = path.join(appDataDir, 'brain', convId);
    fs.mkdirSync(path.join(brainDir, '.system_generated'), { recursive: true });
    fs.mkdirSync(path.join(brainDir, 'scratch'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, '.hidden.md'), 'secret', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'analysis_report.md'), '# Report\n', 'utf8');
    fs.writeFileSync(path.join(brainDir, 'danger.ps1'), 'echo bad\n', 'utf8');

    const wsUri = 'file:///' + wsDir.replace(/\\/g, '/').replace(/^\/+/, '');
    const mockFetch = async (url) => {
      if (url.includes('GetAllCascadeTrajectories')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            trajectorySummaries: {
              [convId]: {
                stepCount: 42,
                lastModifiedTime: '2026-11-25T15:00:00Z',
                annotations: { title: 'Test Chat' },
                workspaces: [{ workspaceFolderAbsoluteUri: wsUri, branchName: 'main' }],
              },
            },
          }),
        };
      }
      if (url.includes('GetCascadeTrajectoryGeneratorMetadata')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            generatorMetadata: [
              {
                chatModel: {
                  modelDisplayName: 'Gemini 4 Neon (High)',
                  usage: {
                    inputTokens: 2000,
                    cacheReadTokens: 132500,
                    responseOutputTokens: 500,
                  },
                  chatStartMetadata: {
                    contextWindowMetadata: {
                      estimatedTokensUsed: 120000,
                      maxContextTokens: 512000,
                      tokenBreakdown: {
                        groups: [
                          { name: 'Chat Messages', type: 'TOKEN_TYPE_CHAT_MESSAGES', numTokens: 100000, children: [{}, {}] },
                          { name: 'Tools', type: 'TOKEN_TYPE_TOOLS', numTokens: 12000, children: [{}] },
                          { name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 5000, children: [{}] },
                          { name: 'Mcp Tools', type: 'TOKEN_TYPE_MCP_TOOLS', numTokens: 3000, children: [{}] },
                        ],
                      },
                    },
                  },
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const res = await studioMain.getConversationInspectorApi({
      conversationId: convId,
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:9999', ANTIGRAVITY_CSRF_TOKEN: 'tok-test' },
      fetchFn: mockFetch,
      appDataDir,
      configDir,
    });

    assert.equal(res.ok, true);
    assert.equal(res.environment.workspaceName, 'my-repo');
    assert.equal(res.environment.branch, 'feat/v2.2', 'must read live .git/HEAD over stale LS branchName');
    assert.equal(res.context.available, true);
    assert.equal(res.context.usedTokens, 135000, 'must align total with billed prompt + response tokens');
    assert.equal(res.context.maxTokens, 512000);
    assert.equal(res.context.freeTokens, 377000);
    assert.equal(res.context.segments[0].tokens, 115000, 'calibration delta should be absorbed into messages so sum === usedTokens');
    assert.deepEqual(
      res.context.segments.map((s) => s.key),
      ['messages', 'mcpTools', 'systemTools', 'systemPrompt']
    );
    assert.equal(res.connectors.length, 1);
    assert.equal(res.connectors[0].name, 'agent-hud');
    assert.equal(res.connectors[0].toolCount, 2);
    assert.equal(res.mcpTools.length, 2);
    assert.equal(res.skills.length, 1);
    assert.equal(res.rules.length, 2);
    assert.ok(res.outputs.some((o) => o.name === 'analysis_report.md'));
    assert.ok(!res.outputs.some((o) => o.name.startsWith('.')));

    // openInspectorFileApi security checks
    const trav = studioMain.openInspectorFileApi(
      { path: path.join(wsDir, 'AGENTS.md'), conversationId: convId },
      { appDataDir, spawnFn: () => ({ unref() {} }) }
    );
    assert.equal(trav.ok, false);
    assert.equal(trav.error, 'path_not_allowed');

    const blocked = studioMain.openInspectorFileApi(
      { path: path.join(brainDir, 'danger.ps1'), conversationId: convId },
      { appDataDir, spawnFn: () => ({ unref() {} }) }
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'blocked_extension');

    let openedArgs = null;
    const allowed = studioMain.openInspectorFileApi(
      { path: path.join(brainDir, 'analysis_report.md'), conversationId: convId },
      {
        appDataDir,
        spawnFn: (cmd, args) => {
          openedArgs = { cmd, args };
          return { unref() {} };
        },
      }
    );
    assert.equal(allowed.ok, true);
    assert.ok(openedArgs && openedArgs.args[0].endsWith('analysis_report.md'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('performStudioSelfUpdate supports non-git release archive auto-upgrade while preserving PLUGIN_DATA', async () => {
  const { execFileSync } = await import('node:child_process');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-arch-'));
  try {
    const pluginDir = path.join(tmpDir, 'installed-plugin');
    const pluginDataDir = path.join(tmpDir, 'plugin_data');
    const releaseSrc = path.join(tmpDir, 'agy-claude-studio-2.2.0');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(pluginDataDir, { recursive: true });
    fs.mkdirSync(releaseSrc, { recursive: true });

    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.1.0' }), 'utf8');
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.1.0' }), 'utf8');
    fs.writeFileSync(path.join(pluginDir, 'marker.txt'), 'old-version', 'utf8');
    fs.writeFileSync(path.join(pluginDataDir, 'notify.json'), JSON.stringify({ enabled: true }), 'utf8');

    fs.writeFileSync(path.join(releaseSrc, 'plugin.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.0' }), 'utf8');
    fs.writeFileSync(path.join(releaseSrc, 'package.json'), JSON.stringify({ name: 'agy-claude-studio', version: '2.2.0' }), 'utf8');
    fs.writeFileSync(path.join(releaseSrc, 'marker.txt'), 'new-v2.2.0', 'utf8');

    const tarFile = path.join(tmpDir, 'v2.2.0.tar.gz');
    execFileSync('tar', ['-czf', tarFile, '-C', tmpDir, 'agy-claude-studio-2.2.0']);
    const tarBuf = fs.readFileSync(tarFile);

    let reinjected = false;
    const updRes = await studioMain.performStudioSelfUpdate({
      pluginDir,
      targetTag: 'v2.2.0',
      fetchFn: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => tarBuf.buffer.slice(tarBuf.byteOffset, tarBuf.byteOffset + tarBuf.byteLength),
      }),
      reinjectFn: async () => {
        reinjected = true;
      },
    });

    assert.equal(updRes.ok, true);
    assert.equal(updRes.mode, 'archive');
    assert.equal(updRes.version, '2.2.0');
    assert.equal(reinjected, true);
    assert.equal(fs.readFileSync(path.join(pluginDir, 'marker.txt'), 'utf8'), 'new-v2.2.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(pluginDataDir, 'notify.json'), 'utf8')).enabled, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Studio index.html inline script parses cleanly with zero syntax errors', () => {
  const html = fs.readFileSync(path.resolve('sidecars/studio/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1, 'Expected inline script block in sidecars/studio/index.html');
  for (const m of scripts) {
    assert.doesNotThrow(() => new Function(m[1]));
  }
});
