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
          },
        }),
      };
    }
    if (url.includes('GetCascadeTrajectorySteps')) {
      assert.equal(body.stepOffset, 240);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          steps: [
            {
              type: 'CORTEX_STEP_TYPE_VIEW_FILE',
              status: 'CORTEX_STEP_STATUS_RUNNING',
              viewFile: { absolutePathUri: 'file:///d:/repo/sidecars/studio/main.mjs' },
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
  assert.equal(res.running[0].activity?.detail, 'main.mjs');
  assert.equal(res.recent.length, 1);
  assert.equal(calls.length, 4);

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
