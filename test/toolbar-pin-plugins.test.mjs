import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdp = require('../src/cdp.js');

function makeTempDir(prefix) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('pinnedToolbarPlugins config sanitizer, validator, and plugin logo loader enforce security boundaries', () => {
  assert.deepEqual(
    cdp.sanitizePinnedToolbarPlugins([
      ' usage-monitor/panel/ ',
      'swarm/swarm_board',
      'usage-monitor/panel',
      '../evil/escape',
      'bad space/id',
      'no-slash',
      '',
      null,
    ]),
    ['usage-monitor/panel', 'swarm/swarm_board']
  );

  assert.equal(cdp.validateConfigSetting('pinnedToolbarPlugins', ['usage-monitor/panel', 'swarm/swarm_board']), true);
  assert.equal(cdp.validateConfigSetting('pinnedToolbarPlugins', ['invalid']), false);
  assert.equal(cdp.validateConfigSetting('pinnedToolbarPlugins', 'usage-monitor/panel'), false);
  assert.equal(
    cdp.validateConfigSetting(
      'pinnedToolbarPlugins',
      Array.from({ length: 13 }, (_, i) => `plugin-${i}/panel`)
    ),
    false
  );

  const sanitized = cdp.sanitizeConfig({
    pinnedToolbarPlugins: ['usage-monitor/panel/', 'swarm/swarm_board', 'bad'],
  });
  assert.deepEqual(sanitized.pinnedToolbarPlugins, ['usage-monitor/panel', 'swarm/swarm_board']);

  // Verify readPluginLogoDataUri & readPinnedPluginIcons with SVG, PNG, and path traversal rejection
  const tmpRoot = makeTempDir('agy-cs-pin-icons-');
  try {
    const userRoot = path.join(tmpRoot, 'user-plugins');
    const builtinRoot = path.join(tmpRoot, 'builtin-plugins');

    // 1. User plugin with assets/logo.svg
    fs.mkdirSync(path.join(userRoot, 'usage-monitor', 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(userRoot, 'usage-monitor', 'plugin.json'),
      JSON.stringify({ name: 'usage-monitor', logo: 'assets/logo.svg' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(userRoot, 'usage-monitor', 'assets', 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
      'utf8'
    );

    // 2. Builtin plugin with custom PNG logo
    fs.mkdirSync(path.join(builtinRoot, 'swarm', 'img'), { recursive: true });
    fs.writeFileSync(
      path.join(builtinRoot, 'swarm', 'plugin.json'),
      JSON.stringify({ name: 'swarm', logo: 'img/bee.png' }),
      'utf8'
    );
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(path.join(builtinRoot, 'swarm', 'img', 'bee.png'), fakePng);

    // 3. Traversal attempt in plugin.json must be rejected
    fs.mkdirSync(path.join(userRoot, 'evil-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'secret.svg'), '<svg>secret</svg>', 'utf8');
    fs.writeFileSync(
      path.join(userRoot, 'evil-plugin', 'plugin.json'),
      JSON.stringify({ name: 'evil-plugin', logo: '../../secret.svg' }),
      'utf8'
    );

    const icons = cdp.readPinnedPluginIcons(
      ['usage-monitor/panel', 'swarm/swarm_board', 'evil-plugin/panel'],
      { pluginRoots: [userRoot, builtinRoot] }
    );
    assert.ok(icons['usage-monitor/panel']?.startsWith('data:image/svg+xml;charset=utf-8,'));
    assert.ok(icons['usage-monitor/panel']?.includes('%3Csvg'));
    assert.equal(icons['swarm/swarm_board'], `data:image/png;base64,${fakePng.toString('base64')}`);
    assert.equal(icons['evil-plugin/panel'], undefined, 'Must reject logo paths escaping plugin dir');
    assert.equal(cdp.readPluginLogoDataUri('../evil', { pluginRoots: [userRoot] }), '');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Plugins submenu pin buttons pin/unpin to titlebar without closing menu, support 3-state toggle, deduplicate collapsed Studio button, and clean up on REMOVE_EXPRESSION', () => {
  const makeEl = (tag, { id = '', className = '', attrs = {}, text = '', rect = null } = {}) => {
    const styleProps = new Map();
    const classes = new Set((className || '').split(/\s+/).filter(Boolean));
    const listeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      id,
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); for (const c of String(v || '').split(/\s+/).filter(Boolean)) classes.add(c); },
      attrs: new Map(Object.entries(attrs)),
      children: [],
      get childNodes() { return this.children; },
      parentElement: null,
      textContent: text,
      innerHTML: '',
      clicks: 0,
      get src() { return this.attrs.get('src') || ''; },
      set src(v) { this.attrs.set('src', String(v)); },
      get isConnected() {
        let cur = this;
        while (cur) {
          if (cur === docEl) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      get firstElementChild() { return this.children[0] || null; },
      get lastElementChild() { return this.children[this.children.length - 1] || null; },
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx >= 0 ? this.parentElement.children[idx + 1] || null : null;
      },
      style: {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
        removeProperty(k) { styleProps.delete(k); },
      },
      classList: {
        add(...cs) { for (const c of cs) if (c) classes.add(c); },
        remove(...cs) { for (const c of cs) classes.delete(c); },
        toggle(c, force) {
          const on = force === undefined ? !classes.has(c) : Boolean(force);
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
        contains(c) { return classes.has(c); },
      },
      getBoundingClientRect() {
        return rect || { left: 0, top: 0, width: 1200, height: 700, right: 1200, bottom: 700 };
      },
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      setAttribute(k, v) { this.attrs.set(k, String(v)); },
      removeAttribute(k) { this.attrs.delete(k); },
      hasAttribute(k) { return this.attrs.has(k); },
      appendChild(c) {
        if (c.parentElement) c.remove();
        c.parentElement = this;
        this.children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentElement) c.remove();
        c.parentElement = this;
        const idx = ref ? this.children.indexOf(ref) : -1;
        if (idx >= 0) this.children.splice(idx, 0, c);
        else this.children.push(c);
        return c;
      },
      append(...nodes) { for (const n of nodes) this.appendChild(n); },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
        }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type);
        if (!arr) return;
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      dispatchEvent(ev) {
        ev.target = ev.target || this;
        let cur = this;
        while (cur) {
          ev.currentTarget = cur;
          for (const fn of [...(listeners.get(ev.type) || [])]) {
            fn(ev);
            if (ev._immediateStopped) break;
          }
          if (ev._stopped || ev._immediateStopped) break;
          cur = cur.parentElement;
        }
      },
      click() {
        this.clicks++;
        const ev = {
          type: 'click',
          _stopped: false,
          _immediateStopped: false,
          preventDefault() {},
          stopPropagation() { this._stopped = true; },
          stopImmediatePropagation() { this._immediateStopped = true; this._stopped = true; },
        };
        this.dispatchEvent(ev);
      },
      matches(sel) {
        const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
        return parts.some((p) => {
          if (p.startsWith('.')) return classes.has(p.slice(1));
          if (p.startsWith('#')) return this.id === p.slice(1);
          if (p === '[data-testid="aux-pane-split"]') return this.getAttribute('data-testid') === 'aux-pane-split';
          if (p === '[data-testid="pane-titlebar-toolbar"]') return this.getAttribute('data-testid') === 'pane-titlebar-toolbar';
          if (p === '[data-testid="sidecar-iframe-slot"]') return this.getAttribute('data-testid') === 'sidecar-iframe-slot';
          if (p === '[data-testid="conversation-view"]') return this.getAttribute('data-testid') === 'conversation-view';
          return false;
        });
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
        const out = [];
        const matchOne = (c, p) => {
          if (p === '[role="menu"] [role="menuitem"]') {
            return c.getAttribute('role') === 'menuitem' && c.parentElement?.getAttribute('role') === 'menu';
          }
          if (p === '[data-testid="sidecar-iframe-slot"] iframe') {
            return c.tagName === 'IFRAME' && c.parentElement?.getAttribute('data-testid') === 'sidecar-iframe-slot';
          }
          if (p === 'iframe[src*="agy-claude-studio--studio"]') {
            return c.tagName === 'IFRAME' && String(c.getAttribute('src') || '').includes('agy-claude-studio--studio');
          }
          if (p.startsWith('.')) return c.classList.contains(p.slice(1));
          if (p.startsWith('#')) return c.id === p.slice(1);
          if (p === 'img') return c.tagName === 'IMG';
          if (p === 'button') return c.tagName === 'BUTTON';
          if (p === 'iframe') return c.tagName === 'IFRAME';
          if (p.startsWith('[data-testid="') && p.endsWith('"]')) {
            return c.getAttribute('data-testid') === p.slice(14, -2);
          }
          if (p === '[data-aux-pane-open]') return c.hasAttribute('data-aux-pane-open');
          if (p === '[data-side-panel-strip]') return c.hasAttribute('data-side-panel-strip');
          if (p === '[data-ag-cs-dock-open]') return c.hasAttribute('data-ag-cs-dock-open');
          if (p === '[data-ag-cs-dock-solo]') return c.hasAttribute('data-ag-cs-dock-solo');
          if (p === '[data-ag-cs-dock-aux-max]') return c.hasAttribute('data-ag-cs-dock-aux-max');
          if (p === '[data-ag-cs-docked-slot]') return c.hasAttribute('data-ag-cs-docked-slot');
          if (p === '[data-ag-cs-dock-hidden]') return c.hasAttribute('data-ag-cs-dock-hidden');
          return false;
        };
        const walk = (n) => {
          for (const c of n.children) {
            if (parts.some((p) => matchOne(c, p))) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    return el;
  };

  const docEl = makeEl('html');
  const head = docEl.appendChild(makeEl('head'));
  const body = docEl.appendChild(makeEl('body', { className: 'theme-standalone' }));
  const root = body.appendChild(makeEl('div', { id: 'root' }));
  const sheet = root.appendChild(makeEl('div', { className: 'agy-sheet' }));
  const split = sheet.appendChild(makeEl('div', { attrs: { 'data-testid': 'aux-pane-split', 'data-split-root': 'true' } }));
  const leftCol = split.appendChild(makeEl('div', { rect: { left: 0, top: 0, width: 900, height: 700, right: 900, bottom: 700 } }));
  const toolbar = leftCol.appendChild(makeEl('div', { attrs: { 'data-testid': 'pane-titlebar-toolbar' }, rect: { left: 0, top: 0, width: 900, height: 40, right: 900, bottom: 40 } }));
  const capsuleHost = toolbar.appendChild(makeEl('div', { className: 'wm-capsule-host' }));
  const nativeBtnGroup = toolbar.appendChild(makeEl('div', { className: 'flex items-center gap-1' }));
  nativeBtnGroup.appendChild(makeEl('button', { attrs: { 'data-testid': 'titlebar-more-actions' } }));
  leftCol.appendChild(makeEl('div', { attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }));

  const auxPane = split.appendChild(makeEl('div', { attrs: { 'data-aux-pane-open': 'false' } }));
  const toggleAuxBtn = auxPane.appendChild(makeEl('button', { attrs: { 'data-testid': 'toggle-aux-sidebar' } }));
  toggleAuxBtn.addEventListener('click', () => {
    const next = auxPane.getAttribute('data-aux-pane-open') !== 'true';
    auxPane.setAttribute('data-aux-pane-open', next ? 'true' : 'false');
  });
  const strip = auxPane.appendChild(makeEl('div', { attrs: { 'data-side-panel-strip': '', 'data-active-tab-id': '' } }));

  // Studio live iframe slot for pinned dock tests
  const overlay = sheet.appendChild(makeEl('div', { className: 'overlay-slots' }));
  const studioSlot = overlay.appendChild(makeEl('div', { attrs: { 'data-testid': 'sidecar-iframe-slot', 'data-sidecar-id': 'agy-claude-studio/studio' } }));
  studioSlot.appendChild(makeEl('iframe', { attrs: { src: 'plugin://agy-claude-studio--studio-123/?token=abc&conversationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }));

  // Plugins submenu portal
  const submenu = body.appendChild(makeEl('div', { attrs: { role: 'menu' } }));
  const umSvgUri = 'data:image/svg+xml;charset=utf-8,%3Csvg%3Eum%3C/svg%3E';
  const studioSvgUri = 'data:image/svg+xml;charset=utf-8,%3Csvg%3Estudio%3C/svg%3E';

  const makeMenuItem = (label, sidecarId, iconUri) => {
    const item = submenu.appendChild(makeEl('div', { attrs: { role: 'menuitem' } }));
    const iconSpan = item.appendChild(makeEl('span'));
    iconSpan.appendChild(makeEl('img', { attrs: { src: iconUri } }));
    item.appendChild(makeEl('span', { text: label }));
    item.__reactFiber$test = {
      memoizedProps: {
        children: [{ props: { sidecarId } }],
      },
    };
    return item;
  };

  let menuItemActivated = 0;
  const studioMenuItem = makeMenuItem('Claude Studio', 'agy-claude-studio/studio', studioSvgUri);
  const umMenuItem = makeMenuItem('Usage Monitor', 'usage-monitor/panel', umSvgUri);
  umMenuItem.addEventListener('click', () => { menuItemActivated += 1; });

  const staleSidecarCalls = [];
  const sidecarLinkCalls = [];
  root.__reactContainer$test = {
    current: {
      child: {
        memoizedProps: {
          value: {
            cascadeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            resolveSidecarLink: (t) => (/usage-monitor\/panel|agy-claude-studio\/studio/.test(t) ? { title: t } : null),
            onSidecarLinkClick: (t) => { staleSidecarCalls.push(t); },
          },
        },
        sibling: {
          memoizedProps: {
            value: {
              cascadeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              resolveSidecarLink: (t) => (/usage-monitor\/panel|agy-claude-studio\/studio/.test(t) ? { title: t } : null),
              onSidecarLinkClick: (t) => {
                sidecarLinkCalls.push(t);
                if (t.startsWith('usage-monitor/panel')) {
                  auxPane.setAttribute('data-aux-pane-open', 'true');
                  strip.setAttribute('data-active-tab-id', 'sidecar__usage-monitor/panel__/');
                }
              },
            },
          },
          sibling: {
            memoizedProps: {
              value: {
                plugins: [
                  {
                    name: 'usage-monitor',
                    displayName: 'Usage & Speed Monitor',
                    disabled: false,
                    sidecars: [
                      {
                        sidecarId: 'usage-monitor/panel',
                        config: {
                          hasWebUi: true,
                          disabled: false,
                          uiConfig: { displayName: 'Usage Monitor', views: [{ entrypoint: 1, path: '/', title: 'Usage Monitor' }] },
                        },
                      },
                    ],
                  },
                  {
                    name: 'agy-claude-studio',
                    displayName: 'Claude Studio',
                    disabled: false,
                    sidecars: [
                      {
                        sidecarId: 'agy-claude-studio/studio',
                        config: {
                          hasWebUi: true,
                          disabled: false,
                          uiConfig: { displayName: 'Claude Studio', views: [{ entrypoint: 1, path: '/', title: 'Claude Studio' }] },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
  };

  const doc = {
    documentElement: docEl,
    head,
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    title: 'Test - Antigravity',
    getElementById: (id) => (id === 'root' ? root : null),
    querySelector: (sel) => docEl.querySelector(sel),
    querySelectorAll: (sel) => docEl.querySelectorAll(sel),
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
  };

  const storage = new Map();
  const bindingCalls = [];
  const timers = new Set();
  const sandbox = {
    document: doc,
    location: { href: 'https://127.0.0.1:2015/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', protocol: 'https:', hostname: '127.0.0.1', pathname: '/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { const id = setTimeout(() => fn(Date.now()), 5); timers.add(id); return id; },
    cancelAnimationFrame: (id) => { timers.delete(id); clearTimeout(id); },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 1,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl, URL,
    console,
  };
  sandbox[cdp.SETTING_BINDING] = (raw) => { bindingCalls.push(JSON.parse(raw)); };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(
      cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, pinRightPane: 'studio', pinnedToolbarPlugins: [] }),
      sandbox
    );

    // 1. Submenu items receive pin buttons
    const umPinBtn = umMenuItem.querySelector('.ag-cs-menu-pin-btn');
    const studioPinBtn = studioMenuItem.querySelector('.ag-cs-menu-pin-btn');
    assert.ok(umPinBtn, 'Usage Monitor menuitem should have pin button');
    assert.ok(studioPinBtn, 'Claude Studio menuitem should have pin button');
    assert.equal(umPinBtn.classList.contains('is-pinned'), false);

    // 2. Clicking Usage Monitor pin button pins it WITHOUT activating the menuitem
    umPinBtn.click();
    assert.equal(menuItemActivated, 0, 'Pin button click must not bubble to menuitem');
    assert.equal(umPinBtn.classList.contains('is-pinned'), true);
    assert.deepEqual(Array.from(sandbox.window.__agClaudeStudio.getPinnedToolbarPlugins()), ['usage-monitor/panel']);
    assert.equal(bindingCalls.length, 1);
    assert.deepEqual(bindingCalls[0], { key: 'pinnedToolbarPlugins', value: ['usage-monitor/panel'] });

    // Toolbar group mounts left of native button group with captured icon
    const pinGroup = toolbar.querySelector('.ag-cs-toolbar-pin-group');
    assert.ok(pinGroup, 'Toolbar pin group should mount');
    assert.equal(toolbar.children[0], capsuleHost);
    assert.equal(toolbar.children[1], pinGroup);
    assert.equal(toolbar.children[2], nativeBtnGroup);

    const umToolbarBtn = pinGroup.querySelector('.ag-cs-toolbar-pin-btn');
    assert.ok(umToolbarBtn);
    assert.equal(umToolbarBtn.getAttribute('data-ag-cs-sidecar-id'), 'usage-monitor/panel');
    assert.equal(umToolbarBtn.getAttribute('title'), 'Usage Monitor');
    assert.equal(umToolbarBtn.querySelector('img')?.src, umSvgUri);
    assert.equal(umToolbarBtn.classList.contains('is-active'), false);

    // 3. 3-state click: (a) unopened -> opens via ACTIVE conversation's sidecar bridge (not stale cached bridge!)
    umToolbarBtn.click();
    assert.deepEqual(staleSidecarCalls, [], 'Must NOT open sidecar on stale background conversation bridge');
    assert.deepEqual(sidecarLinkCalls, ['usage-monitor/panel/']);
    assert.equal(auxPane.getAttribute('data-aux-pane-open'), 'true');
    sandbox.window.__agClaudeStudio.refreshConfig();
    assert.equal(umToolbarBtn.classList.contains('is-active'), true, 'Active highlight should light up when Usage Monitor tab is active');

    // (b) active -> clicking again closes aux pane
    umToolbarBtn.click();
    assert.equal(auxPane.getAttribute('data-aux-pane-open'), 'false', 'Clicking active pinned plugin should collapse aux pane');

    // (c) tab already exists (alongside a close button with aria-label) but another tab is active -> clicking switches to tab, NOT close button!
    auxPane.setAttribute('data-aux-pane-open', 'true');
    strip.setAttribute('data-active-tab-id', 'browser__other');
    const umCloseBtn = strip.appendChild(makeEl('button', { attrs: { 'aria-label': '关闭 Usage Monitor' } }));
    umCloseBtn.__reactFiber$test = { memoizedProps: { tab: { id: 'sidecar__usage-monitor/panel__/', content: { sidecarView: { sidecarId: 'usage-monitor/panel' } } } } };
    const existingUmTab = strip.appendChild(makeEl('button', { attrs: { 'data-tab-id': 'sidecar__usage-monitor/panel__/' } }));
    umToolbarBtn.click();
    assert.equal(umCloseBtn.clicks, 0, 'Must never click tab close button');
    assert.equal(existingUmTab.clicks, 1, 'Should switch to existing sidecar tab when another tab is active');

    // 4. Pinning Claude Studio deduplicates collapsed dock toolbar button while keeping dock collapsed at 0px
    studioPinBtn.click();
    assert.deepEqual(Array.from(sandbox.window.__agClaudeStudio.getPinnedToolbarPlugins()), ['usage-monitor/panel', 'agy-claude-studio/studio']);
    sandbox.window.__agClaudeStudio.setPinnedDockCollapsed(true);
    assert.equal(toolbar.querySelector('.ag-cs-dock-toolbar-btn'), null, 'Collapsed dock sparkle button must not duplicate pinned Claude Studio toolbar icon');
    assert.equal(split.style.getPropertyValue('--ag-cs-dock-w'), '0px', 'Collapsed dock should still shrink to 0px');

    const studioToolbarBtn = pinGroup.children.find((el) => el.getAttribute('data-ag-cs-sidecar-id') === 'agy-claude-studio/studio');
    assert.ok(studioToolbarBtn);
    assert.equal(studioToolbarBtn.classList.contains('is-active'), false);
    // Clicking pinned Claude Studio icon expands collapsed Studio dock, and clicking again collapses it
    studioToolbarBtn.click();
    assert.equal(sandbox.window.__agClaudeStudio.getState().pinnedDockCollapsed, false);
    assert.equal(studioToolbarBtn.classList.contains('is-active'), true);
    studioToolbarBtn.click();
    assert.equal(sandbox.window.__agClaudeStudio.getState().pinnedDockCollapsed, true);
    assert.equal(studioToolbarBtn.classList.contains('is-active'), false);

    // 5. Unpinning removes button from toolbar
    umPinBtn.click();
    assert.deepEqual(Array.from(sandbox.window.__agClaudeStudio.getPinnedToolbarPlugins()), ['agy-claude-studio/studio']);
    assert.equal(pinGroup.children.length, 1);

    // 6. REMOVE_EXPRESSION removes toolbar group and menu pin buttons cleanly
    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
    assert.equal(docEl.querySelector('.ag-cs-toolbar-pin-group'), null);
    assert.equal(docEl.querySelector('.ag-cs-menu-pin-btn'), null);
  } finally {
    for (const id of timers) clearTimeout(id);
  }
});
