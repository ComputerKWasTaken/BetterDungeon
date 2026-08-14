'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSETS = fs.existsSync(path.join(REPO_ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon'))
  ? path.join(REPO_ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon')
  : REPO_ROOT;
const servicePath = path.join(ASSETS, 'services', 'adventure-read-service.js');

global.window = global;
global.location = { href: 'https://play.aidungeon.com/adventure/demo', origin: 'https://play.aidungeon.com' };
global.storyCardCache = { getCardArray: () => [] };
let storyCardReads = 0;

function load(relativePath) {
  const filename = path.join(ASSETS, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('services/adventure-read-service.js');

function action(id, text, extra = {}) {
  return { id: String(id), text, type: 'do', undoneAt: null, createdAt: `2026-01-${String(id).padStart(2, '0')}`, ...extra };
}

function card(id, title) {
  return { id: String(id), type: 'lore', title, keys: title.toLowerCase(), value: `${title} entry.` };
}

function configure({ apollo, adventure, cards, actions, wsCards, cachedCards } = {}) {
  window.BetterDungeonApolloCache = {
    readAdventure: async () => apollo || { available: true, data: { adventure, state: adventure?.state, storyCards: cards || [], actions: actions || [] }, error: null },
  };
  window.BetterDungeonGQL = {
    getNavigatorAdventureContext: async () => adventure,
    getNavigatorStoryCards: async () => {
      storyCardReads++;
      return { id: adventure?.id, shortId: 'demo', storyCardCount: (cards || []).length, cards: cards || [] };
    },
  };
  window.Ultrascripts = {
    ws: {
      getAdventureShortId: () => 'demo',
      getActions: () => new Map((actions || []).map(item => [String(item.id), item])),
      getCards: () => new Map((wsCards || []).map(item => [String(item.id), item])),
    },
  };
  window.storyCardCache = { getCardArray: () => cachedCards || [] };
}

async function testApolloFirstAndMerge() {
  const adventure = {
    id: '42', shortId: 'demo', title: 'Apollo Quest', actionCount: 291,
    memory: 'A key.', authorsNote: 'Stay tense.', instructions: 'Flat text.',
    thirdPerson: false, editedAt: '2026-01-01',
    state: {
      instructions: { custom: 'State instructions.' },
      memories: ['Memory one', 'Memory two'],
      storySummary: 'At the gate.',
      lastSummarizedActionId: '2',
      lastMemoryActionId: '1',
    },
  };
  configure({
    adventure,
    cards: [card(1, 'Apollo Card')],
    actions: [action(10, 'old text'), action(2, 'Apollo two'), action(5, 'stale undone'), action(7, 'Apollo seven')],
    wsCards: [],
    cachedCards: [],
  });
  window.Ultrascripts.ws.getActions = () => new Map([
    ['2', action(2, 'fresh WS text')],
    ['4', action(4, 'extra WS action')],
    ['5', action(5, 'undone', { undoneAt: '2026-01-05' })],
    ['7', action(7, '   ')],
    ['6', action(6, '   ')],
  ]);
  const snapshot = await window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  assert.equal(snapshot.provenance.actions.source, 'apollo+ws');
  assert.deepEqual(snapshot.actions.map(item => item.id), ['2', '4', '7', '10']);
  assert.equal(snapshot.actions[0].text, 'fresh WS text');
  assert.equal(snapshot.actions.find(item => item.id === '7').text, 'Apollo seven');
  assert.equal(snapshot.plot.instructions, 'State instructions.');
  assert.equal(snapshot.plot.instructionsSource, 'state');
  assert.deepEqual(snapshot.state.memories, ['Memory one', 'Memory two']);
  assert.equal(snapshot.coverage.actions.authoritativeTotal, 291);
  assert.equal(snapshot.coverage.actions.available, 4);
  assert.equal(snapshot.coverage.actions.availabilityGap, true);
  assert.equal(snapshot.historyIncomplete, false);
  storyCardReads = 0;
  const actionsOnly = await window.BetterDungeonAdventureRead.readActions({ shortId: 'demo' });
  assert.deepEqual(actionsOnly.actions, snapshot.actions);
  assert.deepEqual(actionsOnly.coverage, snapshot.coverage.actions);
  assert.equal(storyCardReads, 0);
}

async function testUnavailableAndNotFoundFallbacks() {
  const adventure = {
    id: '42', shortId: 'demo', title: 'GraphQL Quest', actionCount: 2,
    memory: 'Memory', authorsNote: '', instructions: 'Flat fallback.',
    state: { storySummary: 'Summary.' },
  };
  configure({
    apollo: { available: false, data: null, error: { code: 'unavailable', message: 'No client' } },
    adventure,
    cards: [card(1, 'GraphQL Card')],
    actions: [],
    wsCards: [],
    cachedCards: [],
  });
  window.Ultrascripts.ws.getActions = () => new Map([
    ['1', action(1, 'One')],
    ['2', action(2, 'Two')],
  ]);
  const unavailable = await window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  assert.equal(unavailable.provenance.plot.instructions, 'graphql');
  assert.equal(unavailable.state.memories, null);
  assert.equal(unavailable.provenance.state.memories, 'unavailable');
  assert.equal(unavailable.historyIncomplete, true);
  assert.equal(unavailable.coverage.actions.available, 2);
  assert.ok(unavailable.degradations.length > 0);

  configure({
    apollo: { available: false, data: null, error: { code: 'not_found', message: 'Not cached yet' } },
    adventure,
    cards: [card(1, 'GraphQL Card')],
    actions: [action(1, 'One'), action(2, 'Two')],
    wsCards: [],
    cachedCards: [],
  });
  const notFound = await window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  assert.equal(notFound.degradations.length, 0);
  assert.equal(notFound.sourceDegraded, false);
  assert.equal(notFound.historyIncomplete, false);
  assert.equal(notFound.provenance.storyCards.source, 'graphql');
}

async function testUnavailableProvenance() {
  const adventure = { id: '42', shortId: 'demo', title: 'Unavailable', actionCount: 0, state: {} };
  configure({
    apollo: { available: false, data: null, error: { code: 'unavailable', message: 'No client' } },
    adventure,
    cards: [],
    actions: [],
    wsCards: [card(9, 'Page Card')],
    cachedCards: [],
  });
  delete window.BetterDungeonGQL.getNavigatorAdventureContext;
  delete window.BetterDungeonGQL.getNavigatorStoryCards;
  const snapshot = await window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  assert.equal(snapshot.provenance.identity.title, 'unavailable');
  assert.equal(snapshot.provenance.plot.instructions, 'unavailable');
  assert.equal(snapshot.provenance.storyCards.source, 'ws');
  assert.equal(snapshot.fallbacks.find(item => item.section === 'storyCards').from, 'unavailable');
}

async function testStoryCardFallbackChain() {
  const adventure = { id: '42', shortId: 'demo', title: 'Cards', actionCount: 0, state: {} };
  configure({
    apollo: { available: false, data: null, error: { code: 'unavailable', message: 'No client' } },
    adventure,
    cards: [],
    actions: [],
    wsCards: [card(2, 'WS Card')],
    cachedCards: [card(3, 'Cached Card')],
  });
  window.BetterDungeonGQL.getNavigatorStoryCards = async () => {
    throw { code: 'unavailable', message: 'GraphQL unavailable' };
  };
  const wsSnapshot = await window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  assert.equal(wsSnapshot.provenance.storyCards.source, 'ws');
  assert.equal(wsSnapshot.storyCards[0].id, '2');

  window.Ultrascripts.ws.getCards = () => new Map();
  const cacheSnapshot = await window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  assert.equal(cacheSnapshot.provenance.storyCards.source, 'storyCardCache');
  assert.equal(cacheSnapshot.storyCards[0].id, '3');
}

function testWiringAndMirror() {
  const relative = 'services/adventure-read-service.js';
  const desktop = path.basename(REPO_ROOT) === 'BetterDungeon'
    ? path.join(REPO_ROOT, relative)
    : path.join(REPO_ROOT, '..', 'BetterDungeon', relative);
  const mobile = path.basename(REPO_ROOT) === 'BetterDungeon'
    ? path.join(REPO_ROOT, '..', 'BetterDungeon-Mobile', 'app', 'src', 'main', 'assets', 'betterdungeon', relative)
    : path.join(REPO_ROOT, relative);
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(hash(desktop), hash(mobile), 'desktop and Mobile reader files must match');
  if (ASSETS === REPO_ROOT) {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
    assert.ok(manifest.content_scripts.some(entry => entry.js.includes(relative)));
  } else {
    const injection = fs.readFileSync(path.join(REPO_ROOT, 'app', 'src', 'main', 'java', 'com', 'computerk', 'betterdungeon', 'InjectionEngine.kt'), 'utf8');
    assert.match(injection, /"services\/apollo-cache-service\.js",\s*"services\/adventure-read-service\.js"/s);
  }
}

async function main() {
  testWiringAndMirror();
  await testApolloFirstAndMerge();
  await testUnavailableAndNotFoundFallbacks();
  await testUnavailableProvenance();
  await testStoryCardFallbackChain();
  console.log('Adventure read contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
