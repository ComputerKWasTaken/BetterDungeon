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

function assertEnvelope(result) {
  assert.deepEqual(Object.keys(result).sort(), ['available', 'data', 'error']);
  assert.equal(typeof result.available, 'boolean');
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'data'));
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'error'));
  if (result.available) assert.equal(result.error, null);
}

function testWiring() {
  if (ASSETS !== ROOT) {
    const source = fs.readFileSync(path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'computerk', 'betterdungeon', 'InjectionEngine.kt'), 'utf8');
    assert.match(source, /"services\/apollo-bridge\.js"/);
    assert.match(source, /"services\/apollo-cache-service\.js"/);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const bridgeEntry = manifest.content_scripts.find((entry) =>
    entry.world === 'MAIN' && entry.run_at === 'document_start' && entry.js.includes('services/apollo-bridge.js')
  );
  assert.ok(bridgeEntry);
  const isolatedEntry = manifest.content_scripts.find((entry) =>
    entry.js.includes('services/apollo-cache-service.js')
  );
  assert.ok(isolatedEntry);
  assert.notEqual(bridgeEntry.world, isolatedEntry.world);
}

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
  assertEnvelope(result);
  assert.equal(result.data.adventure.title, 'Apollo Quest');
  assert.equal(result.data.state.storySummary, 'The hero reached the gate.');
  assert.equal(result.data.state.storyCards, undefined);
  assert.deepEqual(result.data.storyCards.map(card => card.id), [2, 3, 1]);
  assert.deepEqual(result.data.actions.map(action => action.id), ['2', '10']);
  assert.equal(result.data.actions[0].text, 'Two');

  const status = await window.BetterDungeonApolloCache.status();
  const entity = await window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42 });
  const refetched = await window.BetterDungeonApolloCache.refetchActive();
  assertEnvelope(status);
  assertEnvelope(entity);
  assertEnvelope(refetched);
  assert.equal(entity.data.title, 'Apollo Quest');
  assert.equal(refetched.data.refetched, true);
  const isAvailable = window.BetterDungeonApolloCache.isAvailable;
  assert.equal(await isAvailable(), true);
}

async function testMemoInvalidation() {
  await window.__BD_APOLLO_BRIDGE__.request('modifyEntity', {
    typename: 'Adventure', id: 42, fields: { title: 'Apollo Quest' },
  });
  extractCalls = 0;
  await window.__BD_APOLLO_BRIDGE__.request('readEntity', { typename: 'Adventure', id: 42 });
  await window.__BD_APOLLO_BRIDGE__.request('readEntity', { typename: 'Adventure', id: 42 });
  assert.equal(extractCalls, 1);

  const modifiedResult = await window.BetterDungeonApolloCache.modifyEntity({
    typename: 'Adventure', id: 42, fields: { title: 'Changed' },
  });
  assertEnvelope(modifiedResult);
  assert.equal(modifiedResult.data.changed, true);
  const modified = await window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42 });
  assertEnvelope(modified);
  assert.equal(extractCalls, 2);

  const evicted = await window.BetterDungeonApolloCache.evictEntity({ typename: 'StoryCard', id: 3 });
  assertEnvelope(evicted);
  assert.equal(evicted.data.evicted, true);
  await window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42 });
  assert.equal(extractCalls, 3);
}

async function testRelayPairingAndTimeout() {
  delete window.__BD_APOLLO_BRIDGE__;
  const first = window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42 });
  const second = window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42, fields: ['title'] });
  const results = await Promise.all([first, second]);
  results.forEach(assertEnvelope);
  assert.equal(results[0].data.title, 'Changed');
  assert.equal(results[1].data.title, 'Changed');
  assert.deepEqual(results[1].data, { __typename: 'Adventure', title: 'Changed' });

  listeners.set('message', []);
  const started = Date.now();
  const timedOut = await window.BetterDungeonApolloCache.status();
  assertEnvelope(timedOut);
  assert.equal(timedOut.available, false);
  assert.equal(timedOut.data.available, false);
  assert.match(timedOut.error.message, /timed out/i);
  const shortCircuited = await window.BetterDungeonApolloCache.readAdventure({ shortId: 'demo' });
  assertEnvelope(shortCircuited);
  assert.ok(Date.now() - started < 100);

  window.__BD_APOLLO_BRIDGE__ = {
    request: async () => ({ ok: true, data: { available: true, recordCount: 579 } }),
  };
  const recovered = await window.BetterDungeonApolloCache.status();
  assertEnvelope(recovered);
  assert.equal(recovered.available, true);
  assert.deepEqual(recovered.data, { available: true, recordCount: 579 });

  window.__BD_APOLLO_BRIDGE__ = {
    request: async () => ({ ok: false, error: { code: 'unavailable', message: 'offline' } }),
  };
  const failures = await Promise.all([
    window.BetterDungeonApolloCache.status(),
    window.BetterDungeonApolloCache.readEntity({ typename: 'Adventure', id: 42 }),
    window.BetterDungeonApolloCache.readAdventure({ shortId: 'demo' }),
    window.BetterDungeonApolloCache.modifyEntity({ typename: 'Adventure', id: 42, fields: { title: 'x' } }),
    window.BetterDungeonApolloCache.evictEntity({ typename: 'StoryCard', id: 3 }),
    window.BetterDungeonApolloCache.refetchActive(),
  ]);
  failures.forEach(assertEnvelope);
  assert.equal(await window.BetterDungeonApolloCache.isAvailable(), false);
}

async function main() {
  testWiring();
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
