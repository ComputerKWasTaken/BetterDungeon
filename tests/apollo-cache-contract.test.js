'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = fs.existsSync(path.join(ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon'))
  ? path.join(ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon')
  : ROOT;
const listeners = new Map();
const extractData = {
  ROOT_QUERY: {
    'adventure({"shortId":"demo"})': { __ref: 'Adventure:42' },
  },
  'Adventure:42': {
    __typename: 'Adventure',
    id: 42,
    shortId: 'demo',
    title: 'Apollo Quest',
    memory: 'A silver key matters.',
    state: {
      memories: ['The gate opened.'],
      instructions: { type: 'custom', custom: 'Use vivid prose.' },
      storySummary: 'The hero reached the gate.',
      storyCards: [{ __ref: 'StoryCard:2' }, { __ref: 'StoryCard:1' }],
      storyCardInstructions: 'Use entries when relevant.',
      storyCardStoryInformation: 'World lore.',
      imageStyle: 'painted',
    },
    storyCards: [{ __ref: 'StoryCard:2' }, { __ref: 'StoryCard:3' }],
  },
  'StoryCard:1': { __typename: 'StoryCard', id: 1, title: 'First', value: 'One' },
  'StoryCard:2': { __typename: 'StoryCard', id: 2, title: 'Second', value: 'Two' },
  'StoryCard:3': { __typename: 'StoryCard', id: 3, title: 'Third', value: 'Three' },
  'Action:{"adventureId":"42","id":"10"}': {
    __typename: 'Action', id: '10', adventureId: 42, text: 'Ten', type: 'do', undoneAt: null, createdAt: '2026-01-02',
  },
  'Action:{"adventureId":"42","id":"2"}': {
    __typename: 'Action', id: '2', adventureId: 42, text: 'Two', type: 'say', undoneAt: null, createdAt: '2026-01-01',
  },
  'Action:{"adventureId":"99","id":"1"}': {
    __typename: 'Action', id: '1', adventureId: 99, text: 'Other', type: 'do', undoneAt: null, createdAt: '2026-01-01',
  },
};
let extractCalls = 0;
let root = { __reactContainer$test: null };

global.window = global;
global.location = { origin: 'https://play.aidungeon.com', href: 'https://play.aidungeon.com/adventure/demo' };
global.document = { getElementById: (id) => id === '__next' ? root : null };
global.addEventListener = (type, listener) => {
  const current = listeners.get(type) || [];
  current.push(listener);
  listeners.set(type, current);
};
global.removeEventListener = (type, listener) => {
  listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
};
global.postMessage = (data, targetOrigin) => {
  queueMicrotask(() => {
    for (const listener of (listeners.get('message') || []).slice()) {
      listener({ source: global, origin: targetOrigin, data });
    }
  });
};
global.__BD_APOLLO_CACHE_TIMEOUT_MS = 20;

const cache = {
  extract() {
    extractCalls++;
    return extractData;
  },
  modify({ id, fields }) {
    const record = extractData[id];
    if (!record) return false;
    for (const [field, getter] of Object.entries(fields)) record[field] = getter(record[field]);
    return true;
  },
  evict({ id }) {
    if (!extractData[id]) return false;
    delete extractData[id];
    return true;
  },
  gc() {},
};
const client = {
  cache,
  queryManager: {},
  refetchQueries: async () => [],
};
root.__reactContainer$test = {
  memoizedProps: { value: { client } },
};

function load(relativePath) {
  const filename = path.join(ASSETS, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('services/apollo-bridge.js');
load('services/apollo-cache-service.js');

async function testAllowlistingAndUnavailable() {
  const unknown = await window.__BD_APOLLO_BRIDGE__.request('unknown', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'unknown_op');

  root = { __reactContainer$missing: null };
  const unavailable = await window.__BD_APOLLO_BRIDGE__.request('status');
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'unavailable');
  root = { __reactContainer$test: { memoizedProps: { value: { client } } } };
}

async function testAdventureDenormalization() {
  const result = await window.BetterDungeonApolloCache.readAdventure({ shortId: 'demo' });
  assert.equal(result.adventure.title, 'Apollo Quest');
  assert.equal(result.state.storySummary, 'The hero reached the gate.');
  assert.deepEqual(result.storyCards.map(card => card.id), [2, 3, 1]);
  assert.deepEqual(result.actions.map(action => action.id), ['2', '10']);
  assert.equal(result.actions[0].text, 'Two');
}

async function testMemoInvalidation() {
  await window.__BD_APOLLO_BRIDGE__.request('modifyEntity', {
    typename: 'Adventure', id: 42, fields: { title: 'Apollo Quest' },
  });
  extractCalls = 0;
  await window.__BD_APOLLO_BRIDGE__.request('readEntity', { typename: 'Adventure', id: 42 });
  await window.__BD_APOLLO_BRIDGE__.request('readEntity', { typename: 'Adventure', id: 42 });
  assert.equal(extractCalls, 1);

  await window.BetterDungeonApolloCache.modifyEntity({
    typename: 'Adventure', id: 42, fields: { title: 'Changed' },
  });
  await window.__BD_APOLLO_BRIDGE__.request('readEntity', { typename: 'Adventure', id: 42 });
  assert.equal(extractCalls, 2);

  await window.BetterDungeonApolloCache.evictEntity({ typename: 'StoryCard', id: 3 });
  await window.__BD_APOLLO_BRIDGE__.request('readEntity', { typename: 'Adventure', id: 42 });
  assert.equal(extractCalls, 3);
}

async function testRelayPairingAndTimeout() {
  delete window.__BD_APOLLO_BRIDGE__;
  const first = window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42 });
  const second = window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42, fields: ['title'] });
  const results = await Promise.all([first, second]);
  assert.equal(results[0].title, 'Changed');
  assert.equal(results[1].title, 'Changed');
  assert.deepEqual(results[1], { __typename: 'Adventure', title: 'Changed' });

  listeners.set('message', []);
  const timedOut = await window.BetterDungeonApolloCache.status();
  assert.equal(timedOut.available, false);
  assert.equal(timedOut.error.code, 'unavailable');
  assert.match(timedOut.error.message, /timed out/i);
}

async function main() {
  await testAllowlistingAndUnavailable();
  await testAdventureDenormalization();
  await testMemoInvalidation();
  await testRelayPairingAndTimeout();
  console.log('Apollo cache foundation contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
