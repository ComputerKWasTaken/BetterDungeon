'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = fs.existsSync(path.join(ROOT, 'services'))
  ? ROOT
  : path.join(ROOT, 'app', 'src', 'main', 'assets', 'betterdungeon');

global.window = global;
global.location = { href: 'https://play.aidungeon.com/adventure/hydration', pathname: '/adventure/hydration' };
global.chrome = {
  runtime: { id: 'hydration-test', lastError: null },
  storage: { sync: { get(_key, callback) { callback({}); } } },
};
window.Ultrascripts = { ws: { getAdventureShortId: () => 'hydration' } };

function load(relativePath) {
  const filename = path.join(ASSETS, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function index() {
  return {
    shortId: 'hydration',
    adventureId: '101',
    source: 'graphql',
    adventure: {
      id: '101',
      shortId: 'hydration',
      memory: 'Before',
      authorsNote: '',
      instructions: 'Instructions',
      storySummary: 'Summary',
      thirdPerson: false,
    },
    cards: [],
  };
}

function installGraphql(live, { verifyNoop = false } = {}) {
  window.BetterDungeonGQL = {
    async getNavigatorAdventureContext() { return clone(live); },
    async updateNavigatorAdventurePlot(_shortId, changes) {
      if (!verifyNoop) Object.assign(live, changes);
    },
    async updateNavigatorAdventureState() {},
  };
}

async function applyPlot(mutations, content) {
  const snapshot = index();
  snapshot.adventure.memory = (await mutations.readAdventure()).memory;
  const proposal = await mutations.createProposal('propose_plot_component_change', {
    component: 'plot_essentials',
    content,
  }, { index: snapshot });
  proposal.status = 'applying';
  return { proposal, result: mutations.apply(proposal) };
}

async function testConfirmedHydrationAndFailure() {
  const live = {
    id: '101',
    shortId: 'hydration',
    memory: 'Before',
    authorsNote: '',
    instructions: 'Instructions',
    storySummary: 'Summary',
    thirdPerson: false,
  };
  const mutations = new window.NavigatorMutations('hydration');
  const calls = [];
  window.BetterDungeonApolloCache = {
    async modifyEntity(payload) {
      calls.push(payload);
      return { available: true, data: { changed: true }, error: null };
    },
    async readEntity() {
      return {
        available: true,
        data: {
          type: 'lore',
          title: 'Before title',
          description: 'Before notes',
          keys: 'Before triggers',
          value: 'Before entry',
          useForCharacterCreation: false,
        },
        error: null,
      };
    },
    async readEntity() {
      return { available: true, data: { state: { instructions: { type: 'aiInstructions' } } }, error: null };
    },
  };
  installGraphql(live);
  const applied = await applyPlot(mutations, 'Confirmed by server');
  const result = await applied.result;
  assert.equal(result.hydration.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].typename, 'Adventure');
  assert.equal(calls[0].fields.memory, 'Confirmed by server');

  const instruction = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: { adventureId: '101', field: 'instructions' },
    verified: { id: '101', instructions: 'Confirmed instructions' },
  });
  assert.equal(instruction.ok, true);
  assert.deepEqual(calls[1].fields.state, {
    instructions: { type: 'aiInstructions', custom: 'Confirmed instructions' },
  });
  window.BetterDungeonApolloCache.readEntity = async () => ({
    available: true,
    data: { state: {} },
    error: null,
  });
  const defaultInstruction = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: { adventureId: '101', field: 'instructions' },
    verified: { id: '101', instructions: 'Defaulted instructions' },
  });
  assert.equal(defaultInstruction.ok, true);
  assert.deepEqual(calls[2].fields.state, {
    instructions: { type: 'custom', custom: 'Defaulted instructions' },
  });

  const summary = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: { adventureId: '101', field: 'storySummary' },
    verified: { id: '101', storySummary: 'Confirmed summary', title: 'Must not copy' },
  });
  assert.equal(summary.ok, true);
  assert.equal(calls[3].fields.title, undefined);
  assert.equal(calls[3].fields.state.storySummary, 'Confirmed summary');

  const missingRoot = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: { adventureId: '101', field: 'memory' },
    verified: { id: '101', editedAt: 'server-bumped-only' },
  });
  assert.equal(missingRoot.ok, false);
  assert.match(missingRoot.reason, /confirmed 'memory' unavailable/);
  assert.equal(calls.length, 4, 'missing root confirmation must not write editedAt alone');

  window.BetterDungeonApolloCache.modifyEntity = async () => {
    throw new Error('cache write failed');
  };
  const failedHydration = await applyPlot(mutations, 'Second confirmed value');
  const failedResult = await failedHydration.result;
  assert.equal(failedResult.appliedAtIso != null, true);
  assert.equal(failedResult.hydration.ok, false);
  assert.equal(live.memory, 'Second confirmed value');
}

async function testFailedVerificationAndUnavailableApollo() {
  const live = {
    id: '101',
    shortId: 'hydration',
    memory: 'Before',
    authorsNote: '',
    instructions: 'Instructions',
    storySummary: 'Summary',
    thirdPerson: false,
  };
  const mutations = new window.NavigatorMutations('hydration');
  let cacheWrites = 0;
  window.BetterDungeonApolloCache = {
    async modifyEntity() {
      cacheWrites++;
      return { available: true, data: { changed: true }, error: null };
    },
  };
  installGraphql(live, { verifyNoop: true });
  const failed = await applyPlot(mutations, 'Not confirmed');
  await assert.rejects(failed.result, error => error?.code === 'verification_failed');
  assert.equal(cacheWrites, 0);

  installGraphql(live);
  delete window.BetterDungeonApolloCache;
  const unaffected = await applyPlot(mutations, 'Apollo unavailable');
  const result = await unaffected.result;
  assert.equal(result.appliedAtIso != null, true);
  assert.equal(result.hydration.attempted, false);
  assert.equal(live.memory, 'Apollo unavailable');
}

async function testCardEditAndDeletionDecision() {
  const calls = [];
  let refetches = 0;
  window.BetterDungeonApolloCache = {
    async modifyEntity(payload) {
      calls.push(payload);
      return { available: true, data: { changed: true }, error: null };
    },
    async readEntity() {
      return {
        available: true,
        data: {
          type: 'lore',
          title: 'Before title',
          description: 'Before notes',
          keys: 'Before triggers',
          value: 'Before entry',
          useForCharacterCreation: false,
        },
        error: null,
      };
    },
    async refetchActive() {
      refetches++;
      return { available: true, data: { refetched: true }, error: null };
    },
  };
  const update = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'story_card_update',
    proposal: {
      cardId: 'card-1',
      changes: [
        { label: 'Type', before: 'lore' },
        { label: 'Name', before: 'Before title' },
        { label: 'Triggers', before: 'Before triggers' },
        { label: 'Entry', before: 'Before entry' },
        { label: 'Notes', before: 'Before notes' },
      ],
    },
    verified: {
      id: 'card-1',
      title: 'Confirmed title',
      value: 'Confirmed entry',
      deletedAt: null,
    },
  });
  assert.equal(update.ok, true);
  assert.equal(calls[0].typename, 'StoryCard');
  assert.equal(calls[0].fields.title, 'Confirmed title');

  let modifyCalls = 0;
  window.BetterDungeonApolloCache.readEntity = async () => ({
    available: true,
    data: {
      type: 'lore',
      title: 'Other adventure card',
      description: 'Other notes',
      keys: 'Other triggers',
      value: 'Other entry',
      useForCharacterCreation: false,
    },
    error: null,
  });
  window.BetterDungeonApolloCache.modifyEntity = async () => {
    modifyCalls++;
    return { available: true, data: { changed: true }, error: null };
  };
  const collision = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'story_card_update',
    proposal: {
      cardId: 'card-1',
      changes: [{ label: 'Name', before: 'Before title' }],
    },
    verified: { id: 'card-1', title: 'New title' },
  });
  assert.equal(collision.ok, false);
  assert.match(collision.reason, /does not match the pre-write card.*skipped/);
  assert.equal(modifyCalls, 0);

  window.BetterDungeonApolloCache.readEntity = async () => ({
    available: false,
    data: null,
    error: null,
  });
  const missing = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'story_card_update',
    proposal: {
      cardId: 'card-1',
      changes: [{ label: 'Name', before: 'Before title' }],
    },
    verified: { id: 'card-1', title: 'New title' },
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /is missing.*skipped/);

  const deletion = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'story_card_delete',
    proposal: { cardId: 'card-1' },
    verified: null,
  });
  assert.equal(deletion.ok, true);
  assert.equal(deletion.deferred, true);
  assert.equal(refetches, 1);
  assert.equal(calls.length, 1, 'deletion must not evict or modify a live StoryCard entity');

  const creation = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'story_card_create',
    proposal: { adventureId: '101' },
    verified: { id: 'card-2', title: 'New card' },
  });
  assert.equal(creation.ok, true);
  assert.equal(creation.deferred, true);
  assert.equal(refetches, 2);
  assert.equal(calls.length, 1, 'creation must not modify a non-existent StoryCard entity');

  delete window.BetterDungeonApolloCache.refetchActive;
  const deferredCreation = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'story_card_create',
    proposal: { adventureId: '101' },
    verified: { id: 'card-3', title: 'Deferred card' },
  });
  assert.equal(deferredCreation.ok, false);
  assert.equal(deferredCreation.deferred, true);
}

async function main() {
  load('services/adventure-write-hydration.js');
  load('services/navigator/mutations.js');
  await testConfirmedHydrationAndFailure();
  await testFailedVerificationAndUnavailableApollo();
  await testCardEditAndDeletionDecision();
  console.log('Adventure write hydration contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
