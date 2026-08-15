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
load('services/navigator/session.js');

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
  const current = adventure(291);
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
  assert.match(snapshot.systemInstruction, /Action-count reference differs from retained normalized actions/);
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

async function testPlotUnavailableAndEmpty() {
  configure(
    { available: false, data: null, error: { code: 'unavailable', message: 'Apollo unavailable' } },
    null,
    []
  );
  window.BetterDungeonGQL.getNavigatorAdventureContext = async () => {
    throw { code: 'unavailable', message: 'GraphQL unavailable' };
  };
  window.BetterDungeonGQL.getNavigatorStoryCards = async () => {
    throw { code: 'unavailable', message: 'GraphQL unavailable' };
  };
  const unavailable = await new window.NavigatorContext('demo').build();
  assert.equal(unavailable.summary.plotAvailable, false);
  assert.equal(unavailable.summary.plotPopulated, 0);
  assert.match(unavailable.systemInstruction, /AI Instructions:\n\(unavailable\)/);
  assert.equal(unavailable.segments.plotComponents.fields.instructions.unavailable, true);

  const empty = adventure(0);
  empty.instructions = '';
  empty.memory = '';
  empty.authorsNote = '';
  empty.storySummary = '';
  empty.state.instructions = '';
  empty.state.storySummary = '';
  configure({
    available: true,
    data: { adventure: empty, state: empty.state, storyCards: [], actions: [] },
    error: null,
  }, null, []);
  const emptySnapshot = await new window.NavigatorContext('demo').build();
  assert.equal(emptySnapshot.summary.plotAvailable, true);
  assert.equal(emptySnapshot.summary.plotPopulated, 0);
  assert.match(emptySnapshot.systemInstruction, /AI Instructions:\n\(empty\)/);
  assert.equal(emptySnapshot.segments.plotComponents.fields.instructions.empty, true);
  assert.equal(emptySnapshot.segments.plotComponents.fields.instructions.unavailable, false);
}

async function testDynamicAllocator() {
  const current = adventure(20);
  current.instructions = 'Rule one. Rule two.\n\nRule three continues with a long paragraph.';
  current.memory = 'Persistent fact '.repeat(120);
  current.authorsNote = 'Scene note '.repeat(60);
  current.storySummary = 'Summary sentence. '.repeat(180);
  current.state.instructions = current.instructions;
  current.state.storySummary = current.storySummary;
  current.state.memories = Array.from({ length: 15 }, (_, index) => `Memory ${index + 1}: ${'detail '.repeat(18)}`);
  const actions = Array.from({ length: 20 }, (_, index) => action(index + 1, `Action ${index + 1}: ${'story '.repeat(20)}`));
  const cards = Array.from({ length: 12 }, (_, index) => ({ id: `card-${index}`, type: 'lore', title: `Card ${index}` }));
  configure({
    available: true,
    data: { adventure: current, state: current.state, storyCards: cards, actions },
    error: null,
  }, null, []);
  const small = await new window.NavigatorContext('demo').build({ maxChars: 20000 });
  assert.ok(small.systemInstruction.length <= 20000);
  assert.match(small.systemInstruction, /MEMORY BANK/);
  assert.match(small.systemInstruction, /returned \d+ of 15 entries/);
  assert.equal(small.partial, true);
  assert.match(small.systemInstruction, /Action 20/);
  assert.ok(small.segments.memoryBank.truncated || small.segments.recentActions.truncated || small.segments.storyCardDirectory.truncated);
  const generous = await new window.NavigatorContext('demo').build({ maxChars: 100000 });
  assert.ok(generous.systemInstruction.length <= 100000);
  assert.match(generous.systemInstruction, /Rule one\. Rule two\.\n\nRule three/);
  assert.equal(generous.segments.plotComponents.fields.instructions.truncated, false);
  assert.equal(generous.segments.plotComponents.fields.storySummary.truncated, false);
  assert.equal(generous.segments.memoryBank.truncated, false);
}

function testStructuredToolResultBudgeting() {
  const trim = window.NavigatorSession.prototype.trimToolResults;
  const results = trim.call({}, [
    { id: 'a', name: 'get_story_card', result: { data: 'a'.repeat(500) } },
    { id: 'b', name: 'get_story_card', result: { data: 'b'.repeat(500) } },
  ], 300);
  assert.equal(results.length, 2);
  assert.ok(results.every(item => item.result?.error?.code === 'context_budget_omitted'));
}

async function main() {
  await testIncompleteHistory();
  await testApolloCompleteHistoryAndDiagnostics();
  await testGraphqlFallbackDiagnosticsUnavailable();
  await testAuthoritativeCardGate();
  await testPlotUnavailableAndEmpty();
  await testDynamicAllocator();
  testStructuredToolResultBudgeting();
  console.log('Desktop Navigator context contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
