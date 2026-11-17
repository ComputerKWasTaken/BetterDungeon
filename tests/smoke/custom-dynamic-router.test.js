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

function loadRouter() {
  const sent = [];
  const nativeCalls = [];
  const listeners = {};
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
    console,
    URL,
    Headers,
    Request,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout
  };
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
  return { windowStub, sent, nativeCalls, dispatch, postState, bridgeMessages };
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

test('model switcher selector targets the current trigger labels, not the popover', () => {
  assert.match(routerSource, /aria-label="Open Model Switcher"/, 'current "Open Model Switcher" trigger label is matched');
  assert.match(routerSource, /aria-label\^="Open Model Switcher, current model:"/, 'trigger label carrying the current model is matched');
  assert.match(routerSource, /button\[aria-label="Model Switcher"\]/, 'legacy label is restricted to buttons so the popover container is not treated as the switcher');
});
