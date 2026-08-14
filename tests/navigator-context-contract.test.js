'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
global.window = global;
global.location = { href: 'https://play.aidungeon.com/adventure/demo', origin: 'https://play.aidungeon.com' };

function load(relativePath) {
  const filename = path.join(ROOT, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('services/navigator/primer.js');
load('services/adventure-read-service.js');
load('services/navigator/context.js');
load('services/navigator/mutations.js');

function action(id, text) {
  return { id: String(id), text, type: 'do', undoneAt: null, createdAt: `2026-01-${id}` };
}

function adventure(actionCount) {
  return {
    id: '42',
    shortId: 'demo',
    title: 'Navigator Quest',
    actionCount,
    thirdPerson: false,
    editedAt: '2026-01-01',
    memory: 'A silver key.',
    authorsNote: 'Keep tension high.',
    instructions: 'Use vivid prose.',
    state: {
      instructions: 'Use vivid prose.',
      memories: ['A memory entry.'],
      storySummary: 'At the sealed gate.',
      lastSummarizedActionId: '8',
      lastMemoryActionId: '9',
    },
  };
}

function configure(apollo, gqlAdventure, wsActions) {
  window.BetterDungeonApolloCache = {
    readAdventure: async () => apollo,
  };
  window.BetterDungeonGQL = {
    getNavigatorAdventureContext: async () => gqlAdventure,
    getNavigatorStoryCards: async () => ({ id: '42', shortId: 'demo', storyCardCount: 0, cards: [] }),
  };
  window.Ultrascripts = {
    ws: {
      getAdventureShortId: () => 'demo',
      getAdventureId: () => '42',
      getActions: () => new Map(wsActions.map(item => [item.id, item])),
      getCards: () => new Map(),
    },
  };
  window.storyCardCache = { getCardArray: () => [] };
}

async function testIncompleteHistory() {
  configure(
    { available: false, data: null, error: { code: 'unavailable', message: 'Apollo unavailable' } },
    adventure(291),
    []
  );
  const snapshot = await new window.NavigatorContext('demo').build();
  assert.equal(snapshot.partial, true);
  assert.match(snapshot.systemInstruction, /history is incomplete/i);
  assert.match(snapshot.systemInstruction, /NOT seeing the whole story/i);
  assert.match(snapshot.systemInstruction, /authoritative total 291/i);
}

async function testApolloCompleteHistoryAndDiagnostics() {
  const actions = Array.from({ length: 3 }, (_, index) => action(index + 1, `Action ${index + 1}`));
  const current = adventure(3);
  configure({
    available: true,
    data: {
      adventure: current,
      state: current.state,
      storyCards: [],
      actions,
    },
    error: null,
  }, null, []);
  const snapshot = await new window.NavigatorContext('demo').build();
  assert.equal(snapshot.partial, false);
  assert.match(snapshot.systemInstruction, /Memory Bank: 1 memories, \d+ characters/);
  assert.match(snapshot.systemInstruction, /summary lag latest=3, lastSummarized=8, lastMemory=9/);
  assert.equal(snapshot.summary.memoryBankCount, 1);
  assert.equal(snapshot.summary.historyIncomplete, false);
}

async function testGraphqlFallbackDiagnosticsUnavailable() {
  const current = adventure(2);
  configure(
    { available: false, data: null, error: { code: 'not_found', message: 'Cache cold' } },
    current,
    [action(1, 'One'), action(2, 'Two')]
  );
  const snapshot = await new window.NavigatorContext('demo').build();
  assert.equal(snapshot.partial, false);
  assert.match(snapshot.systemInstruction, /Memory Bank and summary lag: unavailable/i);
  assert.doesNotMatch(snapshot.systemInstruction, /Snapshot warnings:.*Apollo/i);
}

async function testAuthoritativeCardGate() {
  const mutations = new window.NavigatorMutations('demo');
  const card = { id: 'card-1', type: 'lore', title: 'Card', keys: 'card', value: 'Entry' };
  const base = {
    shortId: 'demo',
    adventureId: '42',
    adventure: { id: '42', shortId: 'demo', memory: '', authorsNote: '', thirdPerson: false, instructions: '', storySummary: '' },
    cards: [card],
  };
  const proposal = mutations.createProposal('propose_story_card_update', {
    id: 'card-1',
    changes: { title: 'Apollo Card' },
  }, { index: { ...base, source: 'apollo', authoritativeSource: true } });
  assert.equal(proposal.changes[0].before, 'Card');
  await assert.rejects(
    Promise.resolve().then(() => mutations.createProposal('propose_story_card_update', {
      id: 'card-1',
      changes: { title: 'Cache Card' },
    }, { index: { ...base, source: 'cache', authoritativeSource: false } })),
    error => error?.code === 'unavailable'
  );
}

async function main() {
  await testIncompleteHistory();
  await testApolloCompleteHistoryAndDiagnostics();
  await testGraphqlFallbackDiagnosticsUnavailable();
  await testAuthoritativeCardGate();
  console.log('Desktop Navigator context contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
