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
  storage: {
    local: { get(_key, callback) { callback({}); } },
    sync: { get(_key, callback) { callback({}); } },
  },
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
  assert.equal(refetches, 2);
  assert.equal(calls.length, 1, 'deletion must not evict or modify a live StoryCard entity');

  const creation = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'story_card_create',
    proposal: { adventureId: '101' },
    verified: { id: 'card-2', title: 'New card' },
  });
  assert.equal(creation.ok, true);
  assert.equal(creation.deferred, true);
  assert.equal(refetches, 3);
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

async function testMemoryHydrationAndRouting() {
  const state = {
    storySummary: 'Keep this field',
    memories: [
      { __typename: 'Memory', actionIds: ['memory-1'], text: 'Before one', lastRelevantActionId: 8 },
      { __typename: 'Memory', actionIds: ['memory-2'], text: 'Before two', lastRelevantActionId: 9 },
    ],
  };
  const writes = [];
  let refetches = 0;
  window.BetterDungeonApolloCache = {
    async readEntity() {
      return { available: true, data: { state: clone(state) }, error: null };
    },
    async modifyEntity(payload) {
      writes.push(payload);
      return { available: true, data: { changed: true }, error: null };
    },
    async refetchActive() {
      refetches++;
      return { available: true, data: { refetched: true }, error: null };
    },
  };

  const updated = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'memory_update',
    proposal: { adventureId: '101', memoryId: 'memory-1', before: 'Before one' },
    verified: { id: 'memory-1', text: 'After one' },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.refetch.ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].fields.state, {
    storySummary: 'Keep this field',
    memories: [
      { __typename: 'Memory', actionIds: ['memory-1'], text: 'After one', lastRelevantActionId: 8 },
      { __typename: 'Memory', actionIds: ['memory-2'], text: 'Before two', lastRelevantActionId: 9 },
    ],
  });

  const writesBeforeMismatch = writes.length;
  const mismatch = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'memory_update',
    proposal: { adventureId: '101', memoryId: 'memory-1', before: 'Stale text' },
    verified: { id: 'memory-1', text: 'Should not write' },
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /Memory Bank.*pre-write text/);
  assert.equal(writes.length, writesBeforeMismatch);

  const deletion = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'memory_delete',
    proposal: { adventureId: '101', memoryId: 'memory-2', before: 'Before two' },
    verified: null,
  });
  assert.equal(deletion.ok, true);
  assert.deepEqual(writes[1].fields.state.memories, [
    { __typename: 'Memory', actionIds: ['memory-1'], text: 'Before one', lastRelevantActionId: 8 },
  ]);
  assert.equal(writes[1].fields.state.storySummary, 'Keep this field');
  assert.equal(refetches, 2);

  let unknownWrites = 0;
  window.BetterDungeonApolloCache.modifyEntity = async () => {
    unknownWrites++;
    return { available: true, data: { changed: true }, error: null };
  };
  const unknown = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'unsupported_kind',
    proposal: { adventureId: '101', field: 'memory' },
    verified: { id: '101', memory: 'Should not hydrate' },
  });
  assert.equal(unknown.attempted, false);
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /unsupported.*hydration was not attempted/i);
  assert.equal(unknownWrites, 0);

  window.BetterDungeonApolloCache.readEntity = async () => ({
    available: true,
    data: { state: clone(state) },
    error: null,
  });
  window.BetterDungeonApolloCache.modifyEntity = async () => ({
    available: true,
    data: { changed: true },
    error: null,
  });
  window.BetterDungeonApolloCache.refetchActive = async () => ({
    available: false,
    data: null,
    error: { message: 'active refetch unavailable' },
  });
  const refetchFailure = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'memory_update',
    proposal: { adventureId: '101', memoryId: 'memory-1', before: 'Before one' },
    verified: { id: 'memory-1', text: 'After refetch failure' },
  });
  assert.equal(refetchFailure.ok, true);
  assert.equal(refetchFailure.refetch.ok, false);
  assert.match(refetchFailure.refetch.reason, /active refetch unavailable/);
}

function createTextarea(value) {
  let current = value;
  let setterCalls = 0;
  const textarea = {
    ownerDocument: { activeElement: null },
    events: [],
    focusCalls: 0,
    blurCalls: 0,
    dispatchEvent(event) {
      this.events.push(event.type);
    },
    focus() {
      this.focusCalls++;
    },
    blur() {
      this.blurCalls++;
    },
  };
  const prototype = {};
  Object.defineProperty(prototype, 'value', {
    get() {
      return current;
    },
    set(next) {
      setterCalls++;
      current = next;
    },
  });
  Object.setPrototypeOf(textarea, prototype);
  return {
    textarea,
    get value() {
      return current;
    },
    get setterCalls() {
      return setterCalls;
    },
  };
}

function installPlotEditorServices(editors) {
  window.betterDungeonInstance = {
    aiDungeonService: {
      findAIInstructionsTextarea() {
        return editors.instructions || null;
      },
      findPlotEssentialsTextarea() {
        return editors.memory || null;
      },
      findAuthorsNoteTextarea() {
        return editors.authorsNote || null;
      },
      _findTextareaByComponentHeading(heading) {
        return heading === 'Story Summary' ? editors.storySummary || null : null;
      },
    },
  };
}

function authoritativePlot() {
  return {
    id: '101',
    shortId: 'hydration',
    instructions: 'Instructions',
    memory: 'After',
    authorsNote: 'Author note',
    storySummary: 'Summary',
  };
}

async function testPlotEditorSiblingSafety() {
  const matching = {
    instructions: createTextarea('Instructions'),
    memory: createTextarea('Before'),
    authorsNote: createTextarea('Author note'),
    storySummary: createTextarea('Summary'),
  };
  let authoritativeReads = 0;
  window.BetterDungeonGQL = {
    async getNavigatorAdventureContext() {
      authoritativeReads++;
      return authoritativePlot();
    },
  };
  window.BetterDungeonApolloCache = {
    async modifyEntity() {
      return { available: true, data: { changed: true }, error: null };
    },
    async refetchActive() {
      return { available: true, data: { refetched: true }, error: null };
    },
  };
  installPlotEditorServices(Object.fromEntries(
    Object.entries(matching).map(([field, entry]) => [field, entry.textarea]),
  ));
  const filled = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: {
      shortId: 'hydration',
      adventureId: '101',
      field: 'memory',
      before: 'Before',
      after: 'After',
    },
    verified: authoritativePlot(),
  });
  assert.equal(filled.ok, true);
  assert.equal(filled.editor.ok, true);
  assert.equal(authoritativeReads, 1);
  assert.equal(matching.memory.setterCalls, 1);

  const divergent = {
    instructions: createTextarea('Stale instructions'),
    memory: createTextarea('Before'),
    authorsNote: createTextarea('Author note'),
    storySummary: createTextarea('Summary'),
  };
  installPlotEditorServices(Object.fromEntries(
    Object.entries(divergent).map(([field, entry]) => [field, entry.textarea]),
  ));
  const skippedDivergence = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: {
      shortId: 'hydration',
      adventureId: '101',
      field: 'memory',
      before: 'Before',
      after: 'After',
    },
    verified: authoritativePlot(),
  });
  assert.equal(skippedDivergence.ok, true);
  assert.equal(skippedDivergence.editor.ok, false);
  assert.match(skippedDivergence.editor.reason, /differs from the server.*provoking a save/);
  assert.equal(divergent.memory.setterCalls, 0);

  const unavailable = createTextarea('Before');
  installPlotEditorServices({ memory: unavailable.textarea });
  window.BetterDungeonGQL = {
    async getNavigatorAdventureContext() {
      throw new Error('authoritative read unavailable');
    },
  };
  const skippedUnavailable = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: {
      shortId: 'hydration',
      adventureId: '101',
      field: 'memory',
      before: 'Before',
      after: 'After',
    },
    verified: authoritativePlot(),
  });
  assert.equal(skippedUnavailable.ok, true);
  assert.equal(skippedUnavailable.editor.ok, false);
  assert.match(skippedUnavailable.editor.reason, /authoritative adventure read failed/);
  assert.equal(unavailable.setterCalls, 0);
}

async function testPlotEditorHydration() {
  window.BetterDungeonGQL = {
    async getNavigatorAdventureContext() {
      return authoritativePlot();
    },
  };
  const success = createTextarea('Before');
  const filled = window.BetterDungeonAdventureWriteHydration.fillEditorTextarea(
    success.textarea,
    'Before',
    'After',
  );
  assert.deepEqual(filled, { attempted: true, ok: true });
  assert.equal(success.value, 'After');
  assert.equal(success.setterCalls, 1);
  assert.deepEqual(success.textarea.events, ['input', 'change']);
  assert.equal(success.textarea.focusCalls, 0);
  assert.equal(success.textarea.blurCalls, 0);

  const mismatch = createTextarea('Different');
  const skippedMismatch = window.BetterDungeonAdventureWriteHydration.fillEditorTextarea(
    mismatch.textarea,
    'Before',
    'After',
  );
  assert.equal(skippedMismatch.ok, false);
  assert.match(skippedMismatch.reason, /different or unsaved text/);
  assert.equal(mismatch.setterCalls, 0);
  assert.deepEqual(mismatch.textarea.events, []);

  const active = createTextarea('Before');
  active.textarea.ownerDocument.activeElement = active.textarea;
  const skippedActive = window.BetterDungeonAdventureWriteHydration.fillEditorTextarea(
    active.textarea,
    'Before',
    'After',
  );
  assert.equal(skippedActive.ok, false);
  assert.match(skippedActive.reason, /active/);
  assert.equal(active.setterCalls, 0);
  assert.deepEqual(active.textarea.events, []);

  const previousInstance = window.betterDungeonInstance;
  const editorMismatch = createTextarea('Unsaved text');
  window.betterDungeonInstance = {
    aiDungeonService: {
      findPlotEssentialsTextarea() {
        return editorMismatch.textarea;
      },
    },
  };
  window.BetterDungeonApolloCache = {
    async modifyEntity() {
      return { available: true, data: { changed: true }, error: null };
    },
    async refetchActive() {
      return { available: true, data: { refetched: true }, error: null };
    },
  };
  const hydration = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'plot_component',
    proposal: {
      adventureId: '101',
      field: 'memory',
      before: 'Before',
      after: 'After',
    },
    verified: { id: '101', memory: 'After' },
  });
  assert.equal(hydration.ok, true);
  assert.equal(hydration.refetch.ok, true);
  assert.equal(hydration.editor.ok, false);
  assert.match(hydration.editor.reason, /different or unsaved text/);
  assert.equal(editorMismatch.setterCalls, 0);

  let locatorCalls = 0;
  window.betterDungeonInstance = {
    aiDungeonService: {
      findPlotEssentialsTextarea() {
        locatorCalls++;
        return success.textarea;
      },
    },
  };
  const nonPlot = await window.BetterDungeonAdventureWriteHydration.hydrateVerifiedMutation({
    kind: 'third_person',
    proposal: {
      adventureId: '101',
      field: 'thirdPerson',
      before: false,
      after: true,
    },
    verified: { id: '101', thirdPerson: true },
  });
  assert.equal(nonPlot.ok, true);
  assert.equal(nonPlot.editor, undefined);
  assert.equal(locatorCalls, 0);
  if (previousInstance === undefined) delete window.betterDungeonInstance;
  else window.betterDungeonInstance = previousInstance;
}

function testCardFieldMapParity() {
  const hydrationFields = window.BetterDungeonAdventureWriteHydration.cardBeforeFields;
  const mutationFields = window.NavigatorMutations.cardFields;
  const mutationByLabel = Object.fromEntries(Object.values(mutationFields).map(config => [config.label, config.field]));
  assert.deepEqual(hydrationFields, mutationByLabel);
}

async function main() {
  load('services/adventure-write-hydration.js');
  load('services/navigator/mutations.js');
  testCardFieldMapParity();
  await testConfirmedHydrationAndFailure();
  await testFailedVerificationAndUnavailableApollo();
  await testCardEditAndDeletionDecision();
  await testMemoryHydrationAndRouting();
  await testPlotEditorSiblingSafety();
  await testPlotEditorHydration();
  console.log('Adventure write hydration contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
