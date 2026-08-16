'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ASSET_ROOT = fs.existsSync(path.join(ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon'))
  ? path.join(ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon')
  : ROOT;
global.window = global;
global.chrome = { runtime: { id: 'retrieval-test' }, storage: { onChanged: { addListener() {} } } };

function load(relativePath) {
  const filename = path.join(ASSET_ROOT, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('services/navigator/tools.js');
load('services/navigator/session.js');

function indexFixture() {
  return {
    source: 'apollo',
    adventureId: '42',
    shortId: 'demo',
    capturedAtIso: '2026-08-10T12:00:00.000Z',
    cards: [
      { id: 'entry-card', type: 'lore', title: 'Quiet Place', keys: 'gate', value: 'A hidden gate with a dragon sigil.', description: 'Lore about the gate.' },
      { id: 'title-card', type: 'character', title: 'Dragon Keeper', keys: 'keeper', value: 'A person who knows the gate.', description: 'A dragon-related character.' },
      { id: 'type-card', type: 'dragon', title: 'Other Card', keys: 'other', value: 'A plain entry.', description: 'Notes mentioning dragon.' },
    ],
    actions: [
      { id: '1', type: 'do', text: 'The party entered the old hall.' },
      { id: '2', type: 'say', text: `A ${'quiet '.repeat(180)}dragon waited beneath the gate.` },
      { id: '3', type: 'story', text: 'The gate opened.' },
    ],
    memories: [
      { index: 0, text: 'The party seeks the silver key.' },
      { index: 1, text: 'The dragon guards the sealed gate.' },
    ],
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

async function testHistoryAndMemoryRetrieval() {
  const index = indexFixture();
  const tools = new window.NavigatorTools('demo');
  const history = await tools.execute('search_story_history', { query: 'dragon', limit: 1 }, { index });
  assert.equal(history.data.totalMatches, 1);
  assert.equal(history.data.actions[0].index, 1);
  assert.match(history.data.actions[0].preview, /dragon/);
  assert.ok(history.data.actions[0].preview.length < index.actions[1].text.length);

  const windowed = await tools.execute('get_story_actions', { fromIndex: 1, count: 20, direction: 'around' }, { index });
  assert.ok(windowed.data.actions.length <= 20);
  assert.equal(windowed.data.clippedByCount, true);
  const longIndex = {
    ...index,
    actions: Array.from({ length: 20 }, (_, actionIndex) => ({
      id: String(actionIndex),
      type: 'story',
      text: 'long action '.repeat(100),
    })),
  };
  const clipped = await tools.execute('get_story_actions', { fromIndex: 10, count: 20, direction: 'around' }, { index: longIndex });
  assert.equal(clipped.data.clippedByChars, true);
  await expectCode(tools.execute('get_story_actions', { count: 2 }, { index }), 'invalid_tool_args');
  await expectCode(tools.execute('get_story_actions', { actionId: '1', fromIndex: 1 }, { index }), 'invalid_tool_args');

  const memories = await tools.execute('search_memory_bank', { query: 'gate', limit: 1 }, { index });
  assert.equal(memories.data.totalMatches, 1);
  assert.equal(memories.data.memories[0].index, 1);
  const memory = await tools.execute('get_memory', { index: 1 }, { index });
  assert.equal(memory.data.truncated, false);
  await expectCode(tools.execute('search_memory_bank', { query: 'gate', extra: true }, { index }), 'invalid_tool_args');
}

async function testCardRankingAndTruncation() {
  const index = indexFixture();
  const tools = new window.NavigatorTools('demo');
  const ranked = await tools.execute('search_story_cards', { query: 'dragon', limit: 3 }, { index });
  assert.deepEqual(ranked.data.cards.map(card => card.id), ['title-card', 'type-card', 'entry-card']);
  const filtered = await tools.execute('search_story_cards', { query: 'dragon', fields: ['notes'] }, { index });
  assert.deepEqual(filtered.data.cards.map(card => card.id), ['title-card', 'type-card']);
  const longIndex = { ...index, memories: [{ index: 0, text: 'x'.repeat(5000) }] };
  const memory = await tools.execute('get_memory', { index: 0 }, { index: longIndex });
  assert.equal(memory.data.truncated, true);
  assert.ok(memory.data.text.length <= 4000);
  await expectCode(tools.execute('get_memory', { index: 0, bad: true }, { index }), 'invalid_tool_args');
}

async function testPerTurnDeduplication() {
  const session = new window.NavigatorSession('demo');
  session.tools = new window.NavigatorTools('demo');
  const memo = new Map();
  const calls = [{ id: 'call-1', name: 'search_memory_bank', arguments: { limit: 1, query: 'gate' } }];
  const snapshot = { index: indexFixture() };
  const first = await session.executeToolCalls(calls, new AbortController().signal, 4000, 'message', snapshot, memo, 1);
  const second = await session.executeToolCalls(
    [{ id: 'call-2', name: 'search_memory_bank', arguments: { query: 'gate', limit: 1 } }],
    new AbortController().signal,
    4000,
    'message',
    snapshot,
    memo,
    2
  );
  assert.equal(first.results[0].result.ok, true);
  assert.equal(second.results[0].result.error.code, 'tool_already_read');
  assert.match(second.results[0].result.error.message, /round 1/);
}

async function run() {
  await testHistoryAndMemoryRetrieval();
  await testCardRankingAndTruncation();
  await testPerTurnDeduplication();
  console.log('Navigator retrieval contract tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
