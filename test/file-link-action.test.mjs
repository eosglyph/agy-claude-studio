import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdp = require('../cdp.js');
const runtime = readFileSync(new URL('../ui-runtime.js', import.meta.url), 'utf8');
const fileMenu = runtime.slice(runtime.indexOf("  const FILE_MENU_CLS ="), runtime.indexOf('  function isOwnPluginNode('));

function makeMenuContext() {
  const copied = [];
  const makeElement = (tag) => ({
    tag, children: [], style: {}, attrs: {}, handlers: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    appendChild(child) { this.children.push(child); child.parent = this; },
    querySelector() { return this.label ||= {}; },
    addEventListener(type, handler) { this.handlers[type] = handler; },
    getBoundingClientRect() { return { width: 100, height: 60 }; },
    remove() { this.parent.children = this.parent.children.filter((child) => child !== this); },
  });
  const body = makeElement('body');
  const context = vm.createContext({
    URL, document: { body, createElement: makeElement }, window: {},
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
    getLang: () => 'en', uiText: () => ({ fileMenuCopied: 'Copied' }),
    setTimeout: () => 1, clearTimeout() {},
    cfg: { fileLinkContextMenu: true, binding: '__binding' }, destroyed: false, isOwnPluginNode: () => false,
    nodeContains: () => false,
  });
  const api = vm.runInContext(fileMenu + '\n({ onDocContextMenu, closeFileLinkMenu, clearFileLinkToast })', context);
  return { api, context, body, copied };
}

function contextEvent({ href = '', fiberHref = '', inConversation = true } = {}) {
  const target = {
    nodeType: 1, getAttribute: () => href,
    closest(selector) {
      if (selector === 'a[href]') return href ? this : null;
      if (selector.includes('context-scope-mention')) return fiberHref ? this : null;
      return inConversation ? {} : null;
    },
    __reactFiberTest: { memoizedProps: { href: fiberHref } },
  };
  return { target, clientX: 10, clientY: 10, preventDefault() { this.prevented = true; }, stopPropagation() {} };
}

test('chat file context menu only copies the local path from a link or mention', async () => {
  const { api, body, copied } = makeMenuContext();
  for (const [input, expected] of [
    [{ href: 'file:///c%3A/Users/Project%20Notes/test.md#L10-L20' }, 'c:\\Users\\Project Notes\\test.md'],
    [{ fiberHref: 'file:///home/user/notes.md' }, '/home/user/notes.md'],
  ]) {
    const event = contextEvent(input);
    api.onDocContextMenu(event);
    assert.equal(event.prevented, true);
    const menu = body.children[0];
    const buttons = menu.children.filter((child) => child.tag === 'button');
    assert.equal(buttons.length, 3);
    buttons[2].handlers.click(event);
    await new Promise(setImmediate);
    assert.equal(copied.at(-1), expected);
    assert.equal(body.children[0].attrs.role, 'status');
    api.clearFileLinkToast();
  }
});

test('local file actions reject remote and executable paths and construct platform-safe launch arguments', () => {
  for (const value of [
    'file://evil.example/share/report.pdf',
    'file:////server/share/report.pdf',
    'file:///C:/Temp/%22%2Fselect%2Cbad.txt',
  ]) {
    assert.equal(cdp.resolveLocalFileUri(value, 'win32'), null);
  }
  assert.equal(cdp.resolveLocalFileUri('file:////server/share/report.pdf', 'linux'), null);
  const fsApi = { realpathSync: x => x, statSync: () => ({ isDirectory: () => false, isFile: () => true }) };
  const uri = 'file:///C:/Temp/Project%20Notes/报告,1.pdf';
  const windows = cdp.prepareLocalFileAction({ mode: 'reveal', target: uri, platform: 'win32' });
  assert.equal(windows.options.env.AGY_FILE_URI, uri);
  assert.equal(windows.args.some(arg => arg.includes(uri)), false);
  const mac = cdp.prepareLocalFileAction({
    mode: 'reveal', target: 'file:///Users/alice/report.pdf', platform: 'darwin', fsApi,
  });
  assert.deepEqual(mac.args, ['-R', '/Users/alice/report.pdf']);
  const linux = cdp.prepareLocalFileAction({
    mode: 'reveal', target: 'file:///home/alice/docs/report.pdf', platform: 'linux', fsApi,
  });
  assert.deepEqual(linux.args, ['/home/alice/docs']);
});

test('macOS reveal selects packages and open checks the resolved target', () => {
  const fsApi = { realpathSync: () => '/fixtures/Example.APP', statSync: () => ({ isDirectory: () => true }) };
  const opts = { target: 'file:///fixtures/report.pdf', platform: 'darwin', fsApi };
  assert.equal(cdp.prepareLocalFileAction({ ...opts, mode: 'open' }).reason, 'blocked-extension');
  assert.deepEqual(cdp.prepareLocalFileAction({ ...opts, mode: 'reveal' }).args, ['-R', '/fixtures/Example.APP']);
  for (const uri of ['file:///C:/a%09b.pdf', 'file:///C:/a\tb.pdf', 'file:///C:/a.pdf:data', 'file:///C:/a%22.pdf']) assert.equal(cdp.resolveLocalFileUri(uri, 'win32'), null);
});

test('only the live main default world can request file actions', async () => {
  const handlers = new Map();
  const page = { url: 'https://localhost/c/01234567-89ab-cdef-0123-456789abcdef', title: 'Chat', type: 'page', webSocketDebuggerUrl: 'test' };
  const frame = { id: 'top', url: page.url };
  const allowed = cdp.trackBindingSource({ on: (k, cb) => handlers.set(k, cb), send: async () => ({ frameTree: { frame } }) }, page);
  assert.equal(await allowed(1), false);
  for (const [id, frameId, isDefault] of [[1, 'top', true], [2, 'sub', true], [3, 'top', false]]) handlers.get('Runtime.executionContextCreated')({ context: { id, auxData: { frameId, isDefault } } });
  assert.deepEqual(await Promise.all([1, 2, 3].map(id => allowed(id))), [true, false, false]);
  frame.url = "https://localhost/preview"; assert.equal(await allowed(1), false);
  frame.url = 'https://example.test/'; assert.equal(await allowed(1), false);
  frame.url = page.url; handlers.get('Runtime.executionContextsCleared')(); assert.equal(await allowed(1), false);
});

test('Windows native policy validates literal filenames without launching Explorer', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agy-link-'));
  try {
    const file = path.join(dir, '报告, notes.pdf'); const script = path.join(dir, 'notes.ps1');
    for (const p of [file, script]) writeFileSync(p, 'fixture');
    const args = cdp.prepareLocalFileAction({ mode: 'open', target: pathToFileURL(file).href, platform: 'win32' });
    const env = { ...args.options.env, AGY_SCRIPT: pathToFileURL(script).href };
    const probe = 'Add-Type -LiteralPath $env:AGY_FILE_HELPER -ErrorAction Stop; $t=[AgyClaudeStudio.WindowsFileAction]; if (!$t::Validate($env:AGY_FILE_URI,"open") -or $t::Validate($env:AGY_SCRIPT,"open") -or !$t::Validate($env:AGY_SCRIPT,"reveal")) {exit 1}';
    execFileSync(args.bin, [...args.args.slice(0,-1), probe], { env, windowsHide: true });
    const helperSrc = readFileSync(new URL('../scripts/WindowsFileAction.cs', import.meta.url), 'utf8');
    assert.ok(helperSrc.includes('ILFindLastID'), 'Windows reveal must select child PIDL via ILFindLastID for Win11 Explorer');
    assert.ok(helperSrc.includes('AllowSetForegroundWindow'), 'Windows reveal must allow Explorer foreground activation');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('chat file context menu preserves native handling outside chat or when disabled', () => {
  const { api, context, body } = makeMenuContext();
  for (const input of [
    { href: 'file:///home/user/notes.md', inConversation: false },
    { href: 'file://remote.example/share/notes.md' },
    { href: 'file:////remote.example/share/notes.md' },
    { href: 'file:///C:/notes%00.md' },
    { href: 'https://example.test/notes.md' },
  ]) {
    const event = contextEvent(input);
    api.onDocContextMenu(event);
    assert.equal(event.prevented, undefined);
  }
  context.cfg.fileLinkContextMenu = false;
  const event = contextEvent({ href: 'file:///home/user/notes.md' });
  api.onDocContextMenu(event);
  assert.equal(event.prevented, undefined);
  assert.equal(body.children.length, 0);
  assert.equal(cdp.sanitizeConfig({ fileLinkContextMenu: false }).fileLinkContextMenu, false);
  assert.equal(cdp.validateConfigSetting('fileLinkContextMenu', 'yes'), false);
});

test('chat file open and reveal actions dispatch only the selected local file URI', () => {
  const { api, context, body } = makeMenuContext();
  let request;
  context.window.__binding = (payload) => { request = JSON.parse(payload); };
  const event = contextEvent({ href: 'file:///home/user/notes.md' });
  api.onDocContextMenu(event);
  const buttons = body.children[0].children.filter((child) => child.tag === 'button');
  buttons[0].handlers.click(event);
  assert.equal(request.action, 'fileLinkAction');
  assert.equal(request.mode, 'open');
  assert.equal(request.uri, 'file:///home/user/notes.md');
  api.onDocContextMenu(contextEvent({ href: 'file:///home/user/notes.md' }));
  const revealButtons = body.children[0].children.filter((child) => child.tag === 'button');
  revealButtons[1].handlers.click(event);
  assert.equal(request.mode, 'reveal');
});

test('Windows explorer.exe /select fast reveal validates local paths, handles spaces/#L fragments, and rejects commas or symlinks', () => {
  const okFs = {
    lstatSync: () => ({ isSymbolicLink: () => false }),
  };
  const cmd = cdp.buildWindowsExplorerRevealCommand(
    'file:///d%3A/AGENT/workspace/AGENT%20UI/agy-claude-style/ui-runtime.js#L7512-L7517',
    { fsApi: okFs, env: { WINDIR: 'C:\\Windows' } }
  );
  assert.ok(cmd);
  assert.equal(cmd.bin, 'C:\\Windows\\explorer.exe');
  assert.deepEqual(cmd.args, ['/select,"D:\\AGENT\\workspace\\AGENT UI\\agy-claude-style\\ui-runtime.js"']);
  assert.equal(cmd.options.windowsVerbatimArguments, true);

  // Commas must fall back to SHOpenFolderAndSelectItems (return null here).
  assert.equal(
    cdp.buildWindowsExplorerRevealCommand('file:///C:/Temp/报告,1.pdf', { fsApi: okFs }),
    null
  );
  // Reserved device names, quotes, UNC paths, and symlinks must be rejected.
  for (const bad of [
    'file:///C:/Temp/CON.txt',
    'file:///C:/Temp/bad%22name.js',
    'file:////server/share/cdp.js',
    'file:///C:/Temp/trailing./cdp.js',
  ]) {
    assert.equal(cdp.buildWindowsExplorerRevealCommand(bad, { fsApi: okFs }), null);
  }
  const symlinkFs = {
    lstatSync: (p) => ({ isSymbolicLink: () => p.endsWith('link.js') }),
  };
  assert.equal(
    cdp.buildWindowsExplorerRevealCommand('file:///C:/Temp/link.js', { fsApi: symlinkFs }),
    null
  );
});

test('turning off file actions cancels pending timers and ignores late replies after re-enable', () => {
  const { api, context, body } = makeMenuContext();
  const cleared = [];
  Object.assign(context, { clearTimeout: t => cleared.push(t), runtimeInitConfig: {}, loadSettings: c => c,
    applyRootAttrs() {}, refreshOpenEffortPopover() {}, refreshOpenPeriodicSelector() {}, runSync() {}, scheduleSync() {} });
  const methods = runtime.slice(runtime.indexOf('    onFileLinkActionResult(result)'), runtime.indexOf('    openPeriodicSelector(triggerBtn', runtime.indexOf('    onFileLinkActionResult(result)')));
  const controller = vm.runInContext('({' + methods + '})', context);
  let request;
  context.window.__binding = p => { request = JSON.parse(p); };
  const event = contextEvent({ href: 'file:///home/user/notes.md' });
  api.onDocContextMenu(event);
  body.children[0].children.filter(c => c.tag === 'button')[0].handlers.click(event);
  controller.refreshConfig({ fileLinkContextMenu: false });
  assert.ok(cleared.length);
  controller.refreshConfig({ fileLinkContextMenu: true });
  controller.onFileLinkActionResult({ ...request, ok: true });
  assert.equal(body.children.length, 0);
});

test('all watcher implementations have the same document extension policy', () => {
  const native = readFileSync(new URL('../scripts/WindowsFileAction.cs', import.meta.url), 'utf8').split('Allowed =')[1].split('};')[0];
  const swift = readFileSync(new URL('../installer/macos/Watcher/main.swift', import.meta.url), 'utf8').split('let allowed: Set<String> = [')[1].split(']')[0];
  const expected = [...cdp.SAFE_OPEN_FILE_EXTS].sort();
  assert.deepEqual([...native.matchAll(/"(\.[a-z0-9]+)"/g)].map(m => m[1]).sort(), expected);
  assert.deepEqual([...swift.matchAll(/"([a-z0-9]+)"/g)].map(m => '.' + m[1]).sort(), expected);
});

test('chat file copy skips late toast and fallback after teardown', async () => {
  const { api, context, body } = makeMenuContext();
  let rejectCopy;
  context.navigator.clipboard.writeText = () => new Promise((_, reject) => { rejectCopy = reject; });
  const event = contextEvent({ href: 'file:///home/user/notes.md' });
  api.onDocContextMenu(event);
  body.children[0].children.filter((child) => child.tag === 'button')[2].handlers.click(event);
  context.destroyed = true;
  rejectCopy(new Error('clipboard unavailable'));
  await new Promise(setImmediate);
  assert.equal(body.children.length, 0);
});

test('Windows precompiled native file helper caches cleanly and rejects disallowed open extensions without PowerShell compile overhead', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agy-fast-helper-'));
  try {
    const exePath = await cdp.ensureWindowsFileActionExeAsync(dir);
    assert.ok(exePath && exePath.endsWith('.exe'));
    const script = path.join(dir, 'blocked.ps1');
    writeFileSync(script, 'Write-Output 1');
    const t0 = Date.now();
    const res = await cdp.openLocalFileActionAsync({
      mode: 'open',
      target: pathToFileURL(script).href,
      platform: 'win32',
      cacheDir: dir,
    });
    const elapsedMs = Date.now() - t0;
    assert.equal(res.ok, false);
    assert.ok(elapsedMs < 1500, `Cached native helper should reject quickly, took ${elapsedMs}ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
