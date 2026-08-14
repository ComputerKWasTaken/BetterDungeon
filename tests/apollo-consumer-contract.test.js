'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSETS = fs.existsSync(path.join(REPO_ROOT, 'services'))
  ? REPO_ROOT
  : path.join(REPO_ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon');

global.window = global;
global.location = {
  hostname: 'play.aidungeon.com',
  pathname: '/adventure/demo',
};
const listeners = new Map();
global.document = {
  addEventListener(name, handler) {
    listeners.set(name, handler);
  },
  removeEventListener() {},
};
global.chrome = {
  storage: {
    sync: {
      get(_key, callback) { callback({}); },
      set() {},
    },
    onChanged: { addListener() {} },
  },
};

function load(relativePath) {
  const filename = path.join(ASSETS, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

function card(id, title) {
  return { id, title, type: 'character', keys: title, value: `${title} value` };
}

async function testScannerApolloFirstAndFallbacks() {
  const scannerPath = 'services/story-card-scanner.js';
  load(scannerPath);
  const scanner = new window.StoryCardScanner();
  window.storyCardCache = {
    getCardArray: () => [],
    importCards() {},
    setTrigger() {},
  };
  window.Ultrascripts = {
    ws: {
      getAdventureShortId: () => 'demo',
      getCards: () => new Map(),
    },
  };
  let readerCalls = 0;
  let graphqlCalls = 0;
  window.BetterDungeonAdventureRead = {
    readAdventure: async () => {
      readerCalls++;
      return {
        storyCards: [card('apollo-1', 'Apollo Card')],
        provenance: { storyCards: { source: 'apollo' } },
      };
    },
  };
  window.BetterDungeonGQL = {
    request: async () => {
      graphqlCalls++;
      return { data: { adventure: { storyCards: [card('gql-1', 'GraphQL Card')] } } };
    },
  };
  const apolloResult = await scanner.scanAllCards();
  assert.equal(apolloResult.source, 'apollo');
  assert.equal(apolloResult.scannedCount, 1);
  assert.equal(readerCalls, 1);
  assert.equal(graphqlCalls, 0);

  window.BetterDungeonAdventureRead = {
    readAdventure: async () => ({
      storyCards: [],
      provenance: { storyCards: { source: 'unavailable' } },
    }),
  };
  const fallbackResult = await scanner.scanAllCards();
  assert.equal(fallbackResult.source, 'graphql');
  assert.equal(graphqlCalls, 1);
}

async function testUltrascriptsHistoryCompatibility() {
  window.Ultrascripts = {
    ws: {
      getAdventureShortId: () => 'demo',
      getActions: () => new Map([['1', { id: '1', text: 'live' }]]),
      getCards: () => new Map(),
    },
  };
  window.BetterDungeonAdventureRead = {
    readActions: async () => ({
      actions: [{ id: '1', text: 'full' }, { id: '2', text: 'history' }],
      coverage: { authoritativeTotal: 2, available: 2, included: 2, omitted: 0, incomplete: false },
      provenance: { source: 'apollo+ws' },
      historyIncomplete: false,
      fallbacks: [],
      degradations: [],
    }),
  };
  load('services/ultrascripts/core.js');
  const ctx = window.Ultrascripts.core._makeModuleCtx({ id: 'consumer-test' });
  assert.deepEqual(ctx.getActions(), [{ id: '1', text: 'live' }]);
  const history = await ctx.getHistory();
  assert.deepEqual(history.actions.map(action => action.id), ['1', '2']);
  assert.equal(history.complete, true);

  window.BetterDungeonAdventureRead.readActions = async () => ({
    actions: [{ id: '1', text: 'live' }],
    coverage: { authoritativeTotal: 2, available: 1, included: 1, omitted: 0, incomplete: true },
    provenance: { source: 'ws' },
    historyIncomplete: true,
    fallbacks: [{ section: 'actions', from: 'apollo', to: 'ws' }],
    degradations: [],
  });
  const degraded = await ctx.getHistory();
  assert.equal(degraded.complete, false);
  assert.equal(degraded.historyIncomplete, true);
  assert.equal(degraded.coverage.incomplete, true);
}

function testAutoSeeWarmTail() {
  load('features/auto_see_feature.js');
  const feature = new window.AutoSeeFeature();
  window.Ultrascripts.ws = {
    getAdventureShortId: () => 'demo',
    getActions: () => new Map(),
    getTail: () => null,
    getLiveCount: () => 0,
  };
  let refreshes = 0;
  window.BetterDungeonAdventureRead = {
    getLatestActionId: () => ({ id: '219', source: 'apollo+ws', shortId: 'demo' }),
    refreshLatestActionId: () => {
      refreshes++;
      return Promise.resolve();
    },
  };
  const warm = feature.getActionBaseline();
  assert.equal(warm.tail, '219');
  assert.equal(warm.tailNum, 219);
  assert.equal(refreshes, 0);

  window.BetterDungeonAdventureRead.getLatestActionId = () => ({
    id: null,
    source: 'unavailable',
    shortId: 'demo',
  });
  const cold = feature.getActionBaseline();
  assert.equal(cold.tail, null);
  assert.equal(cold.tailNum, -Infinity);
  assert.equal(refreshes, 1);
}

async function main() {
  await testScannerApolloFirstAndFallbacks();
  await testUltrascriptsHistoryCompatibility();
  testAutoSeeWarmTail();
  console.log('Apollo consumer contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
