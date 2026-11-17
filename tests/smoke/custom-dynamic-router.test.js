'use strict';

// Regression checks for the Custom Dynamic main-world router
// (services/custom-dynamic-router.js). AI Dungeon's current client submits
// actions with `mutation ActionRequest` and then polls `CheckActionRequest`
// while generation is processing (and can fire `CancelActionRequest`).
// All three names match the router's generation operation pattern via
// "actionRequest", but only the submission is a new turn: treating polls
// as generation advanced turnsOnModel several times per story turn and
// could switch the adventure's model mid-generation. These checks load the
// real router into a stubbed page world and pin the bridge behaviour.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const routerSource = fs.readFileSync(path.join(root, 'services/custom-dynamic-router.js'), 'utf8');
const ORIGIN = 'https://play.aidungeon.com';
const GRAPHQL_URL = 'https://api.aidungeon.com/graphql';

// Minimal fake DOM, just enough for the router's indicator code: attribute
// access, tree mutation, text, and the selector shapes the router issues
// (tag, [attr], [attr="v"], [attr*="v" i], :not([attr]), comma lists).
function matchSimpleSelector(el, part) {
  if (!part) return false;
  let rest = part;
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest);
  if (tag) {
    if (el.tagName !== tag[0].toUpperCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  while (rest.length) {
    if (rest.startsWith(':not(')) {
      const end = rest.indexOf(')');
      if (matchSimpleSelector(el, rest.slice(5, end))) return false;
      rest = rest.slice(end + 1);
      continue;
    }
    const bracket = /^\[\s*([a-zA-Z-]+)\s*(?:(\*?=)\s*"([^"]*)"\s*(i)?)?\s*\]/.exec(rest);
    if (!bracket) return false;
    const [, name, op, value, ci] = bracket;
    const actual = el.getAttribute(name);
    if (!op) {
      if (actual === null) return false;
    } else if (op === '=') {
      if (actual !== value) return false;
    } else if (op === '*=') {
      if (actual === null) return false;
      const hay = ci ? actual.toLowerCase() : actual;
      const needle = ci ? value.toLowerCase() : value;
      if (!hay.includes(needle)) return false;
    }
    rest = rest.slice(bracket[0].length);
  }
  return true;
}

function matchesSelector(el, selector) {
  return selector.split(',').some((part) => matchSimpleSelector(el, part.trim()));
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this.ownText = '';
  }

  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children) { children.forEach((child) => this.appendChild(child)); }

  remove() {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.ownText = String(value);
    this.children = [];
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (matchesSelector(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  closest(selector) {
    let el = this;
    while (el) {
      if (matchesSelector(el, selector)) return el;
      el = el.parent;
    }
    return null;
  }
}

function createFakeDocument(children = []) {
  const documentElement = new FakeEl('html');
  const head = new FakeEl('head');
  documentElement.appendChild(head);
  children.forEach((child) => documentElement.appendChild(child));
  const doc = {
    documentElement,
    head,
    createElement: (tag) => new FakeEl(tag),
    getElementById: (id) => {
      let found = null;
      const walk = (el) => {
        if (found) return;
        if (el.id === id || el.getAttribute('id') === id) { found = el; return; }
        el.children.forEach(walk);
      };
      walk(documentElement);
      return found;
    },
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    querySelector: (selector) => documentElement.querySelectorAll(selector)[0] || null
  };
  return doc;
}

function fakeEl(tag, attrs = {}, text = '') {
  const node = new FakeEl(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text) node.textContent = text;
  return node;
}

function loadRouter({ document: fakeDocument } = {}) {
  const sent = [];
  const nativeCalls = [];
  const listeners = {};
  const logs = [];
  const capture = (level) => (...args) => logs.push({ level, text: args.map(String).join(' ') });
  const consoleStub = { info: capture('info'), warn: capture('warn'), error: capture('error'), log: capture('log') };
  const windowStub = {
    location: { origin: ORIGIN, href: `${ORIGIN}/adventure/test/play` },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: () => {},
    postMessage: (message) => { sent.push(message); },
    fetch: async (input, init) => {
      nativeCalls.push({ input, init });
      return { ok: true, native: true };
    },
    XMLHttpRequest: undefined
  };
  const sandbox = {
    window: windowStub,
    console: consoleStub,
    URL,
    Headers,
    Request,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout
  };
  if (fakeDocument) sandbox.document = fakeDocument;
  vm.createContext(sandbox);
  vm.runInContext(routerSource, sandbox, { filename: 'services/custom-dynamic-router.js' });

  const dispatch = (data) => listeners.message({ source: windowStub, origin: ORIGIN, data });
  const postState = ({ config, runtime } = {}) => dispatch({
    namespace: 'betterdungeon-custom-dynamic-v1',
    direction: 'extension-to-page',
    type: 'state',
    payload: {
      config: config || {
        enabled: true,
        turnInterval: 5,
        pool: [{ enabled: true, modelId: 'Model A', label: 'Model A', versionName: 'ver-a', versionLabel: 'Ver A', weight: 1 }]
      },
      runtime: runtime || { lastModelId: 'Model A', lastModelLabel: 'Model A', lastVersionName: 'ver-a', lastVersionLabel: 'Ver A', turnsOnModel: 1 },
      indicatorLogoUrl: ''
    }
  });
  const bridgeMessages = (type) => sent.filter((m) => m.type === type);
  return { windowStub, sent, nativeCalls, dispatch, postState, bridgeMessages, logs };
}

function postActiveState(dispatch) {
  dispatch({
    namespace: 'betterdungeon-custom-dynamic-v1',
    direction: 'extension-to-page',
    type: 'state',
    payload: {
      config: {
        enabled: true,
        turnInterval: 2,
        pool: [{ enabled: true, modelId: 'Model A', label: 'Model A', versionName: 'ver-a', versionLabel: 'Ver A', weight: 1 }]
      },
      runtime: { lastModelId: 'Model A', lastModelLabel: 'Model A', lastVersionName: 'ver-a', lastVersionLabel: 'Ver A', turnsOnModel: 1 },
      indicatorLogoUrl: 'chrome-extension://bd-test/icons/better-dynamic-logo.png'
    }
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function gqlBody(operationName, input) {
  return JSON.stringify({ operationName, variables: { input } });
}

test('router announces ready on load', () => {
  const { bridgeMessages } = loadRouter();
  assert.equal(bridgeMessages('ready').length, 1);
});

test('CheckActionRequest polls pass through untouched and do not advance turn state', async () => {
  const { windowStub, nativeCalls, postState, bridgeMessages } = loadRouter();
  postState();
  const body = gqlBody('CheckActionRequest', { actionRequestKey: 'req-1' });
  await windowStub.fetch(GRAPHQL_URL, { method: 'POST', body });
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].init.body, body, 'poll body must be forwarded unchanged');
  assert.equal(bridgeMessages('runtime-event').length, 0, 'polls must not emit selection state');
  assert.equal(bridgeMessages('switch-model').length, 0, 'polls must not trigger a model switch');
});

test('CancelActionRequest passes through untouched', async () => {
  const { windowStub, nativeCalls, postState, bridgeMessages } = loadRouter();
  postState();
  const body = gqlBody('CancelActionRequest', { actionRequestKey: 'req-1' });
  await windowStub.fetch(GRAPHQL_URL, { method: 'POST', body });
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].init.body, body);
  assert.equal(bridgeMessages('runtime-event').length, 0);
  assert.equal(bridgeMessages('switch-model').length, 0);
});

test('ActionRequest submissions still route and advance the turn counter once', async () => {
  const { windowStub, nativeCalls, postState, bridgeMessages } = loadRouter();
  postState();
  const body = gqlBody('ActionRequest', { type: 'story', text: 'The knight enters.', storyAiVersionName: 'ver-a' });
  await windowStub.fetch(GRAPHQL_URL, { method: 'POST', body });
  assert.equal(nativeCalls.length, 1);
  const forwarded = JSON.parse(nativeCalls[0].init.body);
  assert.equal(forwarded.variables.input.storyAiVersionName, 'ver-a');
  const events = bridgeMessages('runtime-event');
  assert.equal(events.length, 1, 'one submission emits exactly one selection-state event');
  assert.equal(events[0].payload.turnsOnModel, 2);
  assert.equal(bridgeMessages('switch-model').length, 0, 'staying on the active model needs no switch');
});

test('ActionRequest needing a different model switches through the bridge and rewrites the payload version', async () => {
  const { windowStub, nativeCalls, postState, dispatch, bridgeMessages } = loadRouter();
  postState({
    runtime: { lastModelId: 'Other Model', lastModelLabel: 'Other Model', lastVersionName: 'ver-other', lastVersionLabel: 'Ver Other', turnsOnModel: 3 }
  });
  const body = gqlBody('ActionRequest', { type: 'continue', storyAiVersionName: 'ver-other' });
  const pending = windowStub.fetch(GRAPHQL_URL, { method: 'POST', body });
  await flush();
  await flush();
  const switches = bridgeMessages('switch-model');
  assert.equal(switches.length, 1, 'a switch request is posted to the extension');
  assert.equal(switches[0].payload.versionName, 'ver-a');
  dispatch({
    namespace: 'betterdungeon-custom-dynamic-v1',
    direction: 'extension-to-page',
    type: 'switch-model-result',
    payload: { requestId: switches[0].payload.requestId, success: true, mechanism: 'graphql-settings' }
  });
  await pending;
  assert.equal(nativeCalls.length, 1);
  const forwarded = JSON.parse(nativeCalls[0].init.body);
  assert.equal(forwarded.variables.input.storyAiVersionName, 'ver-a', 'payload version is rewritten to the routed version');
  const events = bridgeMessages('runtime-event');
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.versionName, 'ver-a');
});

test('model switcher matching is tolerant and predicate-based, not exact-label', () => {
  assert.match(routerSource, /aria-label\*="model switcher" i/, 'candidates are gathered with a case-insensitive substring selector');
  assert.match(routerSource, /function isModelSwitcherTrigger/, 'a predicate makes the final trigger call');
  assert.match(routerSource, /role === 'dialog'/, 'popover containers are excluded by role');
});

test('state receipt is logged once per distinct state signature', () => {
  const { postState, logs } = loadRouter();
  postState();
  postState();
  const stateLogs = logs.filter((entry) => entry.text.includes('State received:'));
  assert.equal(stateLogs.length, 1, 'identical repeat state posts do not re-log');
  assert.match(stateLogs[0].text, /enabled=true, pool=1 model\(s\), turnInterval=5/);
  postState({
    config: {
      enabled: true,
      turnInterval: 2,
      pool: [
        { enabled: true, modelId: 'Model A', label: 'Model A', versionName: 'ver-a', versionLabel: 'Ver A', weight: 1 },
        { enabled: true, modelId: 'Model B', label: 'Model B', versionName: 'ver-b', versionLabel: 'Ver B', weight: 1 }
      ]
    }
  });
  assert.equal(logs.filter((entry) => entry.text.includes('State received:')).length, 2, 'a changed state signature logs again');
});

test('generation with no enabling state passes through untouched and warns once', async () => {
  const { windowStub, nativeCalls, logs } = loadRouter();
  const body = gqlBody('ActionRequest', { type: 'story', text: 'Hello.', storyAiVersionName: 'ver-a' });
  await windowStub.fetch(GRAPHQL_URL, { method: 'POST', body });
  await windowStub.fetch(GRAPHQL_URL, { method: 'POST', body });
  assert.equal(nativeCalls.length, 2, 'both generations reach the native fetch');
  assert.equal(nativeCalls[0].init.body, body, 'bodies are forwarded unchanged while inactive');
  const warns = logs.filter((entry) => entry.level === 'warn' && entry.text.includes('Custom Dynamic inactive'));
  assert.equal(warns.length, 1, 'the inactive passthrough explains itself exactly once');
});

test('routed generations log the running turn count', async () => {
  const { windowStub, postState, logs } = loadRouter();
  postState();
  const body = gqlBody('ActionRequest', { type: 'story', text: 'The knight enters.', storyAiVersionName: 'ver-a' });
  await windowStub.fetch(GRAPHQL_URL, { method: 'POST', body });
  const routed = logs.filter((entry) => entry.level === 'info' && entry.text.includes('Routed generation:'));
  assert.equal(routed.length, 1);
  assert.match(routed[0].text, /turn 2 of 5 on this model/);
});

const INDICATOR_SELECTOR = '[data-bd-custom-dynamic-model-indicator="true"]';

async function indicatorDocument(children) {
  const document = createFakeDocument(children);
  const { dispatch } = loadRouter({ document });
  postActiveState(dispatch);
  await flush();
  return document;
}

test('indicator mounts on the current "Open Model Switcher, current model:" trigger', async () => {
  const trigger = fakeEl('button', { 'aria-label': 'Open Model Switcher, current model: Model A, Member tier' });
  await indicatorDocument([trigger]);
  assert.ok(trigger.querySelector(INDICATOR_SELECTOR), 'indicator mounted on the trigger');
  assert.equal(trigger.getAttribute('data-bd-custom-dynamic-model-switcher'), 'true');
});

test('indicator mounts on a lowercase role=button trigger', async () => {
  const trigger = fakeEl('div', { role: 'button', 'aria-label': 'open model switcher' });
  await indicatorDocument([trigger]);
  assert.ok(trigger.querySelector(INDICATOR_SELECTOR), 'case-drifted labels still match');
});

test('indicator mounts via the visible-text fallback when no aria-label matches', async () => {
  const trigger = fakeEl('button', {}, 'Model Switcher');
  await indicatorDocument([trigger]);
  assert.ok(trigger.querySelector(INDICATOR_SELECTOR), 'text-labelled triggers still match');
});

test('indicator does not mount on the popover container', async () => {
  const popover = fakeEl('div', { role: 'dialog', 'aria-label': 'Model Switcher' });
  await indicatorDocument([popover]);
  assert.equal(popover.querySelector(INDICATOR_SELECTOR), null, 'the popover is not the trigger');
});

test('indicator mounts even when the switcher has no recognisable native icon', async () => {
  // Regression: mounting used to be gated on finding the native model icon,
  // so switchers whose icon is an unrecognised SVG/ligature never got the
  // indicator even after a successful route.
  const trigger = fakeEl('button', { 'aria-label': 'Open Model Switcher' });
  await indicatorDocument([trigger]);
  assert.ok(trigger.querySelector(INDICATOR_SELECTOR), 'indicator mounts without a native icon to hide');
});

test('a routed model with no switcher on the page produces a one-time diagnostic', async () => {
  const document = createFakeDocument([]);
  const { dispatch, logs } = loadRouter({ document });
  postActiveState(dispatch);
  await flush();
  postActiveState(dispatch);
  await flush();
  const warns = logs.filter((entry) => entry.level === 'warn' && entry.text.includes('no Model Switcher trigger matched'));
  assert.equal(warns.length, 1);
});

test('popup: saving a pool enables the feature toggle, and a disabled feature with a pool warns', () => {
  const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  assert.match(popupSource, /saveFeatureState\('customDynamic', true\)/, 'saving an enabled pool turns the feature toggle on');
  assert.match(popupSource, /function warnIfCustomDynamicFeatureOff/, 'a saved pool under a disabled feature surfaces a warning');
});
