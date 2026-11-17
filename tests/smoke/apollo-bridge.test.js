'use strict';

// Regression checks for two silent-degradation risks found in the 2026-11-17
// Ultrascripts audit:
//  1. apollo-bridge readAdventure collected story cards only from
//     adventure.storyCards / adventure.state.storyCards ref arrays. AI
//     Dungeon's current GetAdventure selects both as @client fields derived
//     from Adventure.storyCardSnapshot, so a cache extract may only carry
//     the cards under storyCardSnapshot.storyCards (refs or inline objects).
//  2. ws-interceptor captured base credentials from init.headers only; a
//     fetch(input) call with headers on the Request object captured an
//     empty header set, silently breaking replay writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const bridgeSource = fs.readFileSync(path.join(root, 'services/apollo-bridge.js'), 'utf8');
const interceptorSource = fs.readFileSync(path.join(root, 'services/ultrascripts/ws-interceptor.js'), 'utf8');

function loadBridge(extract) {
  const client = {
    cache: {
      extract: () => extract,
      modify: () => false,
      evict: () => false,
      gc: () => {},
    },
    queryManager: {},
  };
  const fiber = { memoizedProps: { value: { client } }, child: null, sibling: null };
  const rootEl = { '__reactContainer$test': fiber };
  const context = {
    console,
    Promise,
    JSON,
    Object,
    Array,
    Set,
    Map,
    Date,
    document: { getElementById: (id) => (id === '__next' ? rootEl : null) },
    location: { origin: 'https://play.aidungeon.com', href: 'https://play.aidungeon.com/adventure/adv1/x/play' },
    addEventListener() {},
    postMessage() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(bridgeSource, context, { filename: 'services/apollo-bridge.js' });
  return context.__BD_APOLLO_BRIDGE__;
}

test('readAdventure collects cards from storyCardSnapshot (current @client-derived shape)', async () => {
  const extract = {
    ROOT_QUERY: { 'adventure({"shortId":"adv1"})': { __ref: 'Adventure:adv-id' } },
    'Adventure:adv-id': {
      __typename: 'Adventure', id: 'adv-id', shortId: 'adv1', storyCardCount: 2,
      state: { __typename: 'ContentState', instructions: 'be nice' },
      storyCardSnapshot: {
        stateRevision: 3,
        storyCards: [
          { __ref: 'StoryCard:c1' },
          { id: 'c2', title: 'Inline Card', value: 'v2', keys: 'k2', type: 'Lore' },
        ],
      },
    },
    'StoryCard:c1': { __typename: 'StoryCard', id: 'c1', title: 'Ref Card', value: 'v1', keys: 'k1', type: 'Lore' },
    'Action:1': { __typename: 'Action', id: '1', text: 'hello', type: 'story', undoneAt: null, createdAt: '2026-11-17T00:00:00Z', adventureId: 'adv-id' },
  };
  const bridge = loadBridge(extract);
  const result = await bridge.request('readAdventure', { shortId: 'adv1' });
  assert.equal(result.ok, true);
  const titles = result.data.storyCards.map((c) => c.title).sort();
  assert.deepEqual(titles, ['Inline Card', 'Ref Card']);
  assert.equal(result.data.actions.length, 1);
  assert.equal(result.data.adventure.id, 'adv-id');
});

test('readAdventure still collects legacy ref-array cards without duplicating snapshot refs', async () => {
  const extract = {
    ROOT_QUERY: { 'adventure({"shortId":"adv1"})': { __ref: 'Adventure:adv-id' } },
    'Adventure:adv-id': {
      __typename: 'Adventure', id: 'adv-id', shortId: 'adv1', storyCardCount: 1,
      storyCards: [{ __ref: 'StoryCard:c1' }],
      state: { __ref: 'ContentState:adv-id' },
      storyCardSnapshot: { stateRevision: 1, storyCards: [{ __ref: 'StoryCard:c1' }] },
    },
    'ContentState:adv-id': { __typename: 'ContentState', storyCards: [{ __ref: 'StoryCard:c1' }] },
    'StoryCard:c1': { __typename: 'StoryCard', id: 'c1', title: 'Only Card', value: 'v1', keys: 'k1', type: 'Lore' },
  };
  const bridge = loadBridge(extract);
  const result = await bridge.request('readAdventure', { shortId: 'adv1' });
  assert.equal(result.ok, true);
  assert.equal(result.data.storyCards.length, 1);
  assert.equal(result.data.storyCards[0].title, 'Only Card');
});

function loadInterceptor() {
  const posted = [];
  class FakeWebSocket {
    constructor(url, protocols) { this.url = url; this.protocols = protocols; }
    addEventListener() {}
  }
  class FakeXHR {}
  const nativeFetch = async () => ({
    ok: true,
    clone() { return { text: async () => JSON.stringify({ data: { ok: true } }) }; },
  });
  const context = {
    console,
    Promise,
    JSON,
    Object,
    Array,
    Set,
    WeakSet,
    Map,
    Date,
    Headers,
    WebSocket: FakeWebSocket,
    XMLHttpRequest: FakeXHR,
    fetch: nativeFetch,
    location: { origin: 'https://play.aidungeon.com' },
    postMessage(msg) { posted.push(msg); },
    addEventListener() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(interceptorSource, context, { filename: 'services/ultrascripts/ws-interceptor.js' });
  return { context, posted };
}

test('ws-interceptor captures Authorization from a Request-object fetch (no init)', async () => {
  const { context, posted } = loadInterceptor();
  const request = {
    url: 'https://api.aidungeon.com/graphql',
    method: 'POST',
    headers: new Headers({ authorization: 'Bearer TESTTOKEN', 'content-type': 'application/json' }),
  };
  await context.fetch(request);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const creds = posted.filter((m) => m.kind === 'baseCredentials');
  assert.equal(creds.length, 1);
  assert.equal(creds[0].payload.headers.authorization, 'Bearer TESTTOKEN');
});

test('ws-interceptor still captures Authorization from init headers', async () => {
  const { context, posted } = loadInterceptor();
  await context.fetch('https://api.aidungeon.com/graphql', {
    method: 'POST',
    headers: { authorization: 'Bearer INITTOKEN' },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const creds = posted.filter((m) => m.kind === 'baseCredentials');
  assert.equal(creds.length, 1);
  assert.equal(creds[0].payload.headers.authorization, 'Bearer INITTOKEN');
});
