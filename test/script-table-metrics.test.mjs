import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const metricsMod = await import('../scripts/ops/check-repo-metrics.mjs');

function createMiniDocument() {
  const makeNode = (tagName) => {
    const el = {
      tagName: tagName.toUpperCase(),
      className: '',
      children: [],
      _text: '',
      get textContent() {
        if (this.children.length === 0) return this._text;
        return this.children.map((c) => c.textContent).join('');
      },
      set textContent(v) {
        this._text = String(v ?? '');
        this.children = [];
      },
      get lastElementChild() {
        for (let i = this.children.length - 1; i >= 0; i -= 1) {
          if (this.children[i].tagName !== '#TEXT') return this.children[i];
        }
        return null;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
    return el;
  };
  return {
    createElement: (tag) => makeNode(tag),
    createTextNode: (text) => ({ tagName: '#TEXT', textContent: String(text ?? '') }),
  };
}

function loadScriptBodyRenderer() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'ui-runtime.js'), 'utf8');
  const start = src.indexOf('function appendInlineRichText(');
  const end = src.indexOf('function showScriptOutputInChat(');
  assert.ok(start > 0 && end > start, 'Expected script markdown renderer slice in src/ui-runtime.js');
  const slice = src.slice(start, end);
  const document = createMiniDocument();
  const sandbox = { document };
  vm.createContext(sandbox);
  vm.runInContext(
    `${slice}\nthis.__exports = { parseMdTableRow, parseMdTableAlign, renderScriptOutputBody };`,
    sandbox
  );
  return { document, ...sandbox.__exports };
}

test('check-repo-metrics parses Bilibili URLs, deduplicates BVids, and renders Markdown tables with totals', () => {
  const cli = metricsMod.parseCliArgs([
    '--repo',
    'eosglyph/agy-claude-studio',
    '--bvid',
    'BV1hiyDzdE3b,https://www.bilibili.com/video/BV11e1NzWEEz/?spm=test,BV1pSyUzuEeL',
    'BV11e1NzWEEz',
  ]);
  assert.equal(cli.repo, 'eosglyph/agy-claude-studio');
  assert.deepEqual(cli.bvids, ['BV1hiyDzdE3b', 'BV11e1NzWEEz', 'BV1pSyUzuEeL']);

  const report = metricsMod.formatMetricsReport({
    repo: 'eosglyph/agy-claude-studio',
    gh: { stars: 9, forks: 1, issues: 2, releaseDownloads: 24, latestTag: 'v2.3.0', source: 'api' },
    prevGh: { stars: 7, forks: 1, issues: 1, releaseDownloads: 16, latestTag: 'v2.2.3' },
    biliResults: [
      {
        ok: true,
        bvid: 'BV1hiyDzdE3b',
        title: '如果 Antigravity | 原生美学套件',
        view: 1500,
        like: 30,
        coin: 6,
        favorite: 68,
        reply: 20,
      },
      {
        ok: true,
        bvid: 'BV11e1NzWEEz',
        title: 'Claude Studio v2.3.0 宣传片',
        view: 320,
        like: 25,
        coin: 10,
        favorite: 40,
        reply: 8,
      },
      {
        ok: false,
        bvid: 'BV1bad000000',
        error: 'HTTP 404',
      },
    ],
    prevBiliMap: {
      BV1hiyDzdE3b: { view: 1490, like: 29, coin: 5, favorite: 65, reply: 19 },
    },
  });

  assert.match(report, /^📊 eosglyph\/agy-claude-studio · ★ 9 \(\+2\) \| Fork 1 \(±0\) \| 下载 24 \(\+8\) \| B站 2 稿 播放 1,820/);
  assert.match(report, /\| 指标 \| 当前 \| 较上次 \| 备注 \|/);
  assert.match(report, /\| Stars \| \*\*9\*\* \| \+2 \| `eosglyph\/agy-claude-studio` \|/);
  assert.match(report, /\| 视频 \| 播放 \| 点赞 \| 投币 \| 收藏 \| 评论 \|/);
  assert.match(report, /如果 Antigravity \\\| 原生美学套件/);
  assert.match(report, /Claude Studio v2\.3\.0 宣传片/);
  assert.match(report, /320 \(新\)/);
  assert.match(report, /`BV1bad000000`（获取失败：HTTP 404）/);
  assert.match(report, /\| \*\*合计（2 稿）\*\* \| \*\*1,820\*\* \| \*\*55\*\* \| \*\*16\*\* \| \*\*108\*\* \| \*\*28\*\* \|/);
});

test('renderScriptOutputBody renders GFM Markdown tables with alignment, escaped pipes, and inline formatting', () => {
  const { document, parseMdTableRow, parseMdTableAlign, renderScriptOutputBody } = loadScriptBodyRenderer();

  assert.deepEqual(Array.from(parseMdTableRow('| A \\| B | **10** | `BV1` |')), ['A | B', '**10**', '`BV1`']);
  assert.deepEqual(Array.from(parseMdTableAlign('| --- | :---: | ---: |')), ['left', 'center', 'right']);
  assert.equal(parseMdTableAlign('| not | a | sep |'), null);

  const md = [
    '📊 概览',
    '',
    '### 数据表格',
    '| 指标 | 状态 | 当前 |',
    '| --- | :---: | ---: |',
    '| Stars \\| 仓库 | `OK` | **9** (+2) |',
    '| Forks | `OK` | 1 |',
    '',
    '- 附注项',
  ].join('\n');

  const container = document.createElement('div');
  renderScriptOutputBody(container, { combined: md });

  const tableWrap = container.children.find((c) => c.className === 'ag-cs-script-md-table-wrap');
  assert.ok(tableWrap, 'Expected table wrapper element');
  const table = tableWrap.children[0];
  assert.equal(table.tagName, 'TABLE');
  assert.equal(table.className, 'ag-cs-script-md-table');

  const [thead, tbody] = table.children;
  const ths = thead.children[0].children;
  assert.equal(ths.length, 3);
  assert.equal(ths[0].className, '');
  assert.equal(ths[1].className, 'is-center');
  assert.equal(ths[2].className, 'is-right');

  assert.equal(tbody.children.length, 2);
  const firstRowTds = tbody.children[0].children;
  assert.equal(firstRowTds[0].textContent, 'Stars | 仓库');
  assert.equal(firstRowTds[1].children[0].tagName, 'CODE');
  assert.equal(firstRowTds[2].children[0].tagName, 'STRONG');
  assert.equal(firstRowTds[2].className, 'is-right');

  const list = container.children.find((c) => c.className === 'ag-cs-script-md-list');
  assert.ok(list, 'Expected list after table');

  const css = fs.readFileSync(path.join(REPO_ROOT, 'src', 'style.css'), 'utf8');
  assert.match(css, /\.ag-cs-script-md-table-wrap\s*\{/);
  assert.match(css, /\.ag-cs-script-md-table\s*\{/);
});
