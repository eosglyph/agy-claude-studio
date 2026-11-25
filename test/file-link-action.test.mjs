import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    cfg: { fileLinkContextMenu: true }, destroyed: false, isOwnPluginNode: () => false,
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
    assert.equal(buttons.length, 1);
    buttons[0].handlers.click(event);
    await new Promise(setImmediate);
    assert.equal(copied.at(-1), expected);
    assert.equal(body.children[0].attrs.role, 'status');
    api.clearFileLinkToast();
  }
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

test('chat file copy skips late toast and fallback after teardown', async () => {
  const { api, context, body } = makeMenuContext();
  let rejectCopy;
  context.navigator.clipboard.writeText = () => new Promise((_, reject) => { rejectCopy = reject; });
  const event = contextEvent({ href: 'file:///home/user/notes.md' });
  api.onDocContextMenu(event);
  body.children[0].children.find((child) => child.tag === 'button').handlers.click(event);
  context.destroyed = true;
  rejectCopy(new Error('clipboard unavailable'));
  await new Promise(setImmediate);
  assert.equal(body.children.length, 0);
});
