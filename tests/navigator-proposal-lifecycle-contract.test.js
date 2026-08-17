'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
global.window = global;
global.location = { href: 'https://play.aidungeon.com/adventure/demo', origin: 'https://play.aidungeon.com' };

const storage = {};
let lastStored = null;
global.chrome = {
  runtime: { id: 'test-extension' },
  storage: {
    local: {
      get: (key, callback) => callback({ [key]: storage[key] || null }),
      set: value => {
        lastStored = value;
        Object.assign(storage, value);
      },
    },
    sync: {
      get: (key, callback) => callback({}),
      set: () => {},
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
};

function load(relativePath) {
  const filename = path.join(ROOT, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('services/navigator/mutations.js');
load('services/navigator/session.js');

function proposal(status = 'pending', overrides = {}) {
  return {
    id: 'proposal-1',
    kind: 'story_card_update',
    status,
    targetLabel: 'Card',
    reason: 'Keep the card current.',
    patch: { value: 'new value' },
    beforeFingerprint: 'private-fingerprint',
    before: 'private-before',
    after: 'private-after',
    changes: [{ label: 'Value', before: 'x'.repeat(5000), after: 'y'.repeat(5000) }],
    irreversible: false,
    error: null,
    ...overrides,
  };
}

async function testPersistedProjectionAndRestore() {
  const session = new window.NavigatorSession('demo');
  await session.settingsReady;
  session.messages = [
    { id: 'message-1', role: 'assistant', status: 'complete', content: 'Proposal ready.', proposals: [proposal('pending')] },
    { id: 'message-2', role: 'assistant', status: 'complete', content: 'Already applied.', proposals: [proposal('applied')] },
    { id: 'message-3', role: 'assistant', status: 'complete', content: 'Memory deletion ready.', proposals: [proposal('pending', {
      id: 'memory-proposal',
      kind: 'memory_delete',
      targetLabel: 'Memory memory-1',
      action: 'delete',
      memoryId: 'memory-1',
      irreversible: true,
    })] },
  ];
  session.persist();
  const persisted = lastStored.betterDungeon_navigator_session_demo.messages;
  const persistedProposal = persisted[0].proposals[0];
  assert.equal(persistedProposal.status, 'pending');
  assert.equal(persistedProposal.restored, true);
  assert.equal(persistedProposal.patch, undefined);
  assert.equal(persistedProposal.beforeFingerprint, undefined);
  assert.ok(persistedProposal.changes[0].before.includes('truncated for reload'));
  assert.ok(persistedProposal.changes[0].after.includes('truncated for reload'));
  assert.ok(JSON.stringify(persisted).length + persisted.reduce((sum, message) => sum + (message.content?.length || 0), 0) <= 120000);

  const restored = new window.NavigatorSession('demo');
  await restored.settingsReady;
  await restored.load();
  assert.equal(restored.messages[0].proposals[0].status, 'expired');
  assert.equal(restored.messages[1].proposals[0].status, 'applied');
  assert.equal(restored.messages[2].proposals[0].kind, 'memory_delete');
  assert.equal(restored.messages[2].proposals[0].irreversible, true);
  assert.equal(restored.messages[2].proposals[0].status, 'expired');
  assert.equal(restored.messages[0].proposals[0].restored, true);
  assert.equal(restored.rejectProposal('message-1', 'proposal-1'), false);
  assert.equal(await restored.applyProposal('message-1', 'proposal-1'), false);
  assert.equal(await restored.applyProposal('message-3', 'memory-proposal'), false);
}

async function testMutationRejectsRestoredProposal() {
  const mutations = new window.NavigatorMutations('demo');
  await assert.rejects(
    mutations.apply({ ...proposal('applying'), restored: true }),
    error => error?.code === 'invalid_proposal'
  );
}

function card(updatedAt, title = 'Card') {
  return { id: 'card-1', type: 'lore', title, description: '', keys: 'card', value: 'Entry', useForCharacterCreation: false, updatedAt };
}

function wireCard(updatedAt, title = '', value = '') {
  return {
    id: 'card-1',
    type: 'Ultrascripts',
    title,
    name: '',
    description: '',
    keys: ['card'],
    value,
    useForCharacterCreation: false,
    updatedAt,
  };
}

function mutationIndex() {
  return {
    shortId: 'demo',
    adventureId: '42',
    source: 'apollo',
    authoritativeSource: true,
    cards: [card('2026-01-01')],
    adventure: { id: '42', shortId: 'demo' },
  };
}

async function testContentOnlyConflictAndDrift() {
  const mutations = new window.NavigatorMutations('demo');
  let current = wireCard('2026-01-01');
  window.Ultrascripts = { ws: { getAdventureShortId: () => 'demo' } };
  window.BetterDungeonGQL = {
    getNavigatorStoryCards: async () => ({ cards: [current] }),
    updateNavigatorStoryCard: async (_shortId, desired) => { current = desired; },
  };
  const proposal = await mutations.createProposal('propose_story_card_update', {
    id: 'card-1',
    changes: { entry: 'Changed' },
  }, { index: mutationIndex() });
  assert.equal(proposal.changes.find(change => change.label === 'Entry').before, '');
  proposal.status = 'applying';
  current = wireCard('2026-02-02');
  const result = await mutations.apply(proposal);
  assert.ok(result.updatedAtDrift);
  assert.equal(result.updatedAtDrift.before, '2026-01-01');
  assert.equal(result.updatedAtDrift.current, '2026-02-02');

  const conflict = await mutations.createProposal('propose_story_card_update', {
    id: 'card-1',
    changes: { entry: 'Changed again' },
  }, { index: mutationIndex() });
  conflict.status = 'applying';
  current = wireCard('2026-03-01', 'Changed title');
  await assert.rejects(mutations.apply(conflict), error => error?.code === 'conflict');
}

async function testDeleteDrift() {
  const mutations = new window.NavigatorMutations('demo');
  let deleted = false;
  let current = wireCard('2026-01-01');
  window.Ultrascripts = { ws: { getAdventureShortId: () => 'demo' } };
  window.BetterDungeonGQL = {
    getNavigatorStoryCards: async () => ({ cards: deleted ? [] : [current] }),
    deleteNavigatorStoryCard: async () => { deleted = true; },
  };
  const proposal = await mutations.createProposal('propose_story_card_delete', {
    id: 'card-1',
  }, { index: mutationIndex() });
  proposal.status = 'applying';
  current = wireCard('2026-02-02');
  const result = await mutations.apply(proposal);
  assert.ok(result.updatedAtDrift);
}

async function testCreateProposalDoesNotReadCards() {
  const mutations = new window.NavigatorMutations('demo');
  let reads = 0;
  window.BetterDungeonGQL = {
    getNavigatorStoryCards: async () => {
      reads += 1;
      throw new Error('create proposals must not read cards');
    },
  };
  const result = await mutations.createProposal('propose_story_card_create', {
    type: 'lore',
    title: 'New Card',
    triggers: 'new',
    entry: 'Created entry',
    notes: '',
  }, { index: mutationIndex() });
  assert.equal(result.action, 'create');
  assert.equal(reads, 0);
}

async function main() {
  await testPersistedProjectionAndRestore();
  await testMutationRejectsRestoredProposal();
  await testContentOnlyConflictAndDrift();
  await testDeleteDrift();
  await testCreateProposalDoesNotReadCards();
  console.log('Navigator proposal lifecycle contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
