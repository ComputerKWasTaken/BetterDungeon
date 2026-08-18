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
  assert.deepEqual(snapshot.index.actions.map(item => item.id), ['1', '2', '3']);
  assert.deepEqual(snapshot.index.actions[0], { id: '1', type: 'do', text: 'Action 1' });
  assert.deepEqual(snapshot.index.memories, [{ index: 0, text: 'A memory entry.' }]);
}

async function testGraphqlFallbackDiagnosticsUnavailable() {
  const current = adventure(2);
  configure(
    { available: false, data: null, error: { code: 'not_found', message: 'Cache cold' } },
    current,
    [action(1, 'One'), action(2, 'Two')]
  );
  const snapshot = await new window.NavigatorContext('demo').build();
  assert.equal(snapshot.partial, true);
  assert.match(snapshot.systemInstruction, /Memory Bank and summary lag: unavailable/i);
  assert.match(snapshot.systemInstruction, /MEMORY BANK\n\(Memory Bank is unavailable/i);
  assert.doesNotMatch(snapshot.systemInstruction, /Snapshot warnings:.*Apollo/i);

  window.BetterDungeonGQL.getNavigatorRecentMemories = async () => [];
  const emptyFallback = await new window.NavigatorContext('demo').build();
  assert.match(emptyFallback.systemInstruction, /Memory Bank: 0 memories/);
  assert.doesNotMatch(emptyFallback.systemInstruction, /Memory Bank and summary lag: unavailable/i);
}

async function testAuthoritativeCardGate() {
  const mutations = new window.NavigatorMutations('demo');
  const card = { id: 'card-1', type: 'lore', title: 'Card', keys: 'card', value: 'Entry' };
  window.BetterDungeonGQL = {
    getNavigatorStoryCards: async () => ({ cards: [card] }),
  };
  const base = {
    shortId: 'demo',
    adventureId: '42',
    adventure: { id: '42', shortId: 'demo', memory: '', authorsNote: '', thirdPerson: false, instructions: '', storySummary: '' },
    cards: [card],
  };
  const proposal = await mutations.createProposal('propose_story_card_update', {
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
  empty.state.memories = [];
  empty.state.lastSummarizedActionId = '';
  empty.state.lastMemoryActionId = '';
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
  assert.equal(emptySnapshot.segments.memoryBank.includedChars, 0);
  assert.match(emptySnapshot.systemInstruction, /lastSummarized=unknown, lastMemory=unknown/);
}

async function testDynamicAllocator() {
  const current = adventure(20);
  current.instructions = 'Rule one. Rule two.\n\nRule three continues with a long paragraph.';
  current.memory = 'Persistent fact '.repeat(120);
  current.authorsNote = 'Scene note '.repeat(60);
  current.storySummary = 'Summary sentence. '.repeat(180);
  current.state.instructions = current.instructions;
  current.state.storySummary = current.storySummary;
  current.state.memories = Array.from({ length: 15 }, (_, index) => ({
    __typename: 'Memory',
    ...(index === 0 ? {} : { actionIds: ['1', '2'] }),
    text: `Memory ${index + 1}: ${'detail '.repeat(18)}`,
  }));
  const actions = Array.from({ length: 20 }, (_, index) => action(index + 1, `Action ${index + 1}: ${'story '.repeat(20)}`));
  const cards = Array.from({ length: 12 }, (_, index) => ({ id: `card-${index}`, type: 'lore', title: `Card ${index}` }));
  configure({
    available: true,
    data: { adventure: current, state: current.state, storyCards: cards, actions },
    error: null,
  }, null, []);
  // Primer VERSION 6 and Memory Bank proposal guidance require this headroom.
  const small = await new window.NavigatorContext('demo').build({ maxChars: 22000 });
  assert.ok(small.systemInstruction.length <= 22000);
  assert.match(small.systemInstruction, /MEMORY BANK\n/);
  assert.match(small.systemInstruction, /returned \d+ of 15 entries/);
  assert.match(small.systemInstruction, /Memory 1:/);
  assert.doesNotMatch(small.systemInstruction, /__typename|actionIds/);
  assert.equal(small.partial, true);
  assert.match(small.systemInstruction, /Action 20/);
  assert.ok(small.segments.memoryBank.truncated || small.segments.recentActions.truncated || small.segments.storyCardDirectory.truncated);
  assert.equal(small.segments.recentActions.floorIncluded, 10);
  assert.ok(small.segments.recentActions.coverage);
  assert.ok(small.segments.storyCardDirectory.coverage);
  assert.equal(small.segments.allocation.shrinkOrder[0], 'memory');
  assert.equal(small.segments.allocation.reasons[small.segments.allocation.shrinkOrder[0]], 'total budget');
  if (small.segments.memoryBank.truncated) {
    assert.equal(
      small.segments.memoryBank.truncatedReason,
      small.segments.allocation.reasons.memory
    );
    assert.match(
      small.systemInstruction,
      new RegExp(`Memory Bank:.*${small.segments.memoryBank.truncatedReason}`)
    );
  }
  const generous = await new window.NavigatorContext('demo').build({ maxChars: 100000 });
  assert.ok(generous.systemInstruction.length <= 100000);
  assert.match(generous.systemInstruction, /Rule one\. Rule two\.\n\nRule three/);
  assert.equal(generous.segments.plotComponents.fields.instructions.truncated, false);
  assert.equal(generous.segments.plotComponents.fields.storySummary.truncated, false);
  assert.equal(generous.segments.memoryBank.truncated, false);
  assert.ok(generous.segments.total.sourceChars >= generous.segments.total.includedChars, `${generous.segments.total.sourceChars} < ${generous.segments.total.includedChars}`);
  assert.equal(generous.systemInstruction.endsWith('=== END CURRENT ADVENTURE SNAPSHOT ==='), true);
  const boundary = await new window.NavigatorContext('demo').build({ maxChars: 22000 });
  assert.ok(boundary.systemInstruction.length <= 22000);
  assert.equal(boundary.systemInstruction.endsWith('=== END CURRENT ADVENTURE SNAPSHOT ==='), true);
  assert.notEqual(boundary.segments.plotComponents.fields.storySummary.boundary, 'hard');
  assert.ok(boundary.segments.plotComponents.fields.storySummary.maxChars > 160);
  for (const budget of [10000, 12000, 16000, 20000, 30000]) {
    const bounded = await new window.NavigatorContext('demo').build({ maxChars: budget });
    assert.ok(bounded.systemInstruction.length <= budget);
    assert.equal(bounded.systemInstruction.endsWith('=== END CURRENT ADVENTURE SNAPSHOT ==='), true);
  }
  const floor = await new window.NavigatorContext('demo').build({ maxChars: 9000 });
  assert.ok(floor.systemInstruction.length <= 9000);
  assert.equal(floor.systemInstruction.endsWith('=== END CURRENT ADVENTURE SNAPSHOT ==='), true);
  assert.match(floor.systemInstruction, /SNAPSHOT DEGRADED:/);
  assert.match(floor.systemInstruction, /IDENTITY\nTitle: Navigator Quest/);
  assert.match(floor.systemInstruction, /RECENT STORY ACTIONS/);
  assert.match(floor.systemInstruction, /search_story_history/);
  assert.match(floor.systemInstruction, /search_memory_bank/);
  assert.match(floor.systemInstruction, /search_story_cards/);
  assert.match(floor.systemInstruction, /You are Navigator, BetterDungeon/);
  assert.equal(floor.index.cards.length, 12);
  assert.equal(floor.index.actions.length, 20);
  assert.equal(floor.index.memories.length, 15);
  assert.ok(floor.segments.recentActions.floorIncluded > 0);
  for (const section of [floor.segments.plotComponents, floor.segments.memoryBank, floor.segments.storyCardDirectory]) {
    assert.equal(section.included, 0);
    assert.equal(section.includedChars, 0);
  }
  assert.doesNotMatch(floor.systemInstruction, /MEMORY BANK\n[\s\S]*\[Memory \d+\]/);
  const noHistory = await new window.NavigatorContext('demo').build({ maxChars: 500 });
  assert.equal(noHistory.segments.recentActions.included, 0);
  assert.equal(noHistory.segments.recentActions.includedChars, 0);
  for (const budget of [8000, 9000, 500]) {
    const hostile = await new window.NavigatorContext('demo').build({ maxChars: budget });
    assert.ok(hostile.systemInstruction.length <= budget);
    assert.equal(hostile.systemInstruction.endsWith('=== END CURRENT ADVENTURE SNAPSHOT ==='), true);
    assert.match(hostile.systemInstruction, /IDENTITY/);
    assert.match(hostile.systemInstruction, /SNAPSHOT DEGRADED:/);
  }
  let partialFloor = null;
  for (const budget of [500, 700, 900, 1100, 1300, 1500, 1800, 2200, 2600, 3000]) {
    const candidate = await new window.NavigatorContext('demo').build({ maxChars: budget });
    if (candidate.segments.recentActions.floorIncluded > 0 &&
      candidate.segments.recentActions.floorIncluded < 10) {
      partialFloor = candidate;
      break;
    }
  }
  assert.ok(partialFloor);
  assert.match(partialFloor.systemInstruction, /newest-10 floor served partially/);
  assert.equal(
    partialFloor.segments.recentActions.floorIncluded,
    [...partialFloor.systemInstruction.matchAll(/\[Action (?:1[1-9]|20)\b/g)].length
  );
}

async function testScaledDynamicCeilings() {
  const current = adventure(292);
  current.instructions = 'Instruction '.repeat(300);
  current.memory = 'Fact '.repeat(300);
  current.authorsNote = 'Note '.repeat(200);
  current.storySummary = 'Summary '.repeat(500);
  current.state.instructions = current.instructions;
  current.state.storySummary = current.storySummary;
  current.state.memories = Array.from({ length: 48 }, (_, index) => ({
    actionIds: [String(index)],
    text: `Memory ${index + 1}: ${'detail '.repeat(600)}`,
  }));
  const actions = Array.from({ length: 292 }, (_, index) => action(index + 1, `Action ${index + 1}: ${'story '.repeat(30)}`));
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

  const large = await new window.NavigatorContext('demo').build({ maxChars: 554119 });
  assert.ok(large.systemInstruction.length <= 554119);
  assert.equal(large.segments.memoryBank.included, 48);
  assert.ok(large.segments.recentActions.included > 31);
  assert.equal(large.segments.recentActions.coverage.included, large.segments.recentActions.included);
  assert.equal(large.segments.total.includedChars, large.systemInstruction.length);

  const sectionBound = await new window.NavigatorContext('demo').build({ maxChars: 200000 });
  assert.equal(sectionBound.segments.memoryBank.truncatedReason, 'section ceiling');
  assert.match(sectionBound.systemInstruction, /Memory Bank:.*reduced for section ceiling/);
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

function testNavigatorToolGuidanceAndAllowances() {
  const session = {
    isMutationTool: window.NavigatorSession.prototype.isMutationTool,
    buildToolGuidance: window.NavigatorSession.prototype.buildToolGuidance,
    getTurnAllowances: window.NavigatorSession.prototype.getTurnAllowances,
  };
  const read = [{ name: 'get_story_card' }];
  const proposal = [{ name: 'propose_story_card_create' }];
  const readGuidance = session.buildToolGuidance.call(session, read);
  const proposalGuidance = session.buildToolGuidance.call(session, proposal);
  const droppedGuidance = session.buildToolGuidance.call(session, [], { dropped: true });
  assert.match(readGuidance, /Every available tool is read-only/);
  assert.match(`snapshot${readGuidance}`, /^snapshot\n=== NAVIGATOR READ TOOLS ===/);
  assert.doesNotMatch(readGuidance, /CHANGE PROPOSALS/);
  assert.match(proposalGuidance, /CHANGE PROPOSALS/);
  assert.doesNotMatch(proposalGuidance, /every available tool is read-only/);
  assert.match(proposalGuidance, /Never claim a proposal was applied/);
  assert.match(proposalGuidance, /Third Person/);
  assert.match(proposalGuidance, /Memory Bank/);
  assert.match(proposalGuidance, /stable (?:card|memory) IDs/);
  assert.match(proposalGuidance, /cannot create/);
  assert.match(droppedGuidance, /lookups.*not represented by the tools below/);
  assert.equal(session.getTurnAllowances.call({}, 40000, false).toolResultAllowance, 0);
  assert.ok(session.getTurnAllowances.call({}, 300000, true).historyAllowance > 16000);
  assert.ok(session.getTurnAllowances.call({}, 300000, true).toolResultAllowance > 16000);
}

function testToolDropUsesInstructionOnly() {
  const source = fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8');
  const session = {
    isMutationTool: window.NavigatorSession.prototype.isMutationTool,
  };
  const guidance = window.NavigatorSession.prototype.buildToolGuidance.call(session, [], { dropped: true });
  assert.match(guidance, /lookups.*not represented by the tools below/);
  assert.doesNotMatch(source, /TOOL_DROP_NOTE/);
  assert.doesNotMatch(source, /context_budget_tools_dropped/);
}

async function testProposalResultFloor() {
  const proto = window.NavigatorSession.prototype;
  const owner = { proposals: [] };
  const runner = {
    tools: {
      execute: async () => ({ ok: true, data: 'read'.repeat(5000) }),
    },
    mutations: {
      createProposal: () => ({ id: 'proposal-1' }),
    },
    readOnly: false,
    isMutationTool: proto.isMutationTool,
    registerProposal: (_messageId, proposal) => owner.proposals.push(proposal),
    findMessage: () => owner,
    emit: () => {},
    schedulePersist: () => {},
  };
  const executed = await proto.executeToolCalls.call(runner, [
    { id: 'read-1', name: 'get_story_card', arguments: {} },
    { id: 'proposal-1', name: 'propose_story_card_create', arguments: {} },
  ], new AbortController().signal, 16000, 'message-1', {});
  assert.equal(executed.results.length, 2);
  assert.equal(executed.results[1].result.ok, true);
  assert.equal(executed.results[1].result.data.proposalId, 'proposal-1');
  assert.equal(owner.proposals.length, 1);
  assert.ok(executed.charsUsed > 0);
  const truncatedOwner = { proposals: [] };
  const truncated = await proto.executeToolCalls.call({
    ...runner,
    tools: { execute: async () => ({ ok: true, data: 'read' }) },
    registerProposal: (_messageId, proposal) => truncatedOwner.proposals.push(proposal),
  }, [
    { id: 'read-truncated', name: 'get_story_card', arguments: {} },
    { id: 'proposal-truncated', name: 'propose_story_card_create', arguments: {} },
  ], new AbortController().signal, 40000, 'message-1', {}, null, 1, { rejectMutations: true });
  assert.equal(truncated.results[0].result.ok, true);
  assert.equal(truncated.results[1].isError, true);
  assert.equal(truncated.results[1].result.error.code, 'output_truncated');
  assert.equal(truncatedOwner.proposals.length, 0);
  const exhaustedOwner = { proposals: [] };
  const exhausted = await proto.executeToolCalls.call({
    ...runner,
    registerProposal: (_messageId, proposal) => exhaustedOwner.proposals.push(proposal),
  }, [
    { id: 'proposal-2', name: 'propose_story_card_create', arguments: {} },
  ], new AbortController().signal, 0, 'message-1', {});
  assert.equal(exhausted.results.length, 0);
  assert.equal(exhaustedOwner.proposals.length, 0);
}


async function testRequestInspectionExecutorCapture() {
  const session = new window.NavigatorSession('inspection-adventure');
  await session.settingsReady;
  session.checkReady = async () => ({ ready: true, status: { model: 'inspection-model', thinkingLevels: ['low'], limits: { maxInputChars: 4000, maxOutputTokens: 2048 } } });
  session.buildTurnContext = async () => ({
    instruction: 'snapshot instruction',
    snapshot: { systemInstruction: 'snapshot instruction', summary: 'complete', segments: [], warnings: [], partial: false },
  });
  session.getToolDefinitions = () => [{ name: 'inspect_tool', parameters: { type: 'object', description: 'tool '.repeat(100) } }];
  session.executeToolCalls = async () => ({ results: [{ id: 'tool-1', name: 'inspect_tool', result: { ok: 'result '.repeat(1000) } }], exhausted: false });
  const received = [];
  let round = 0;
  window.UltrascriptsAIExecutor = {
    chat: async (request) => {
      received.push(request);
      if (round++ === 0) return { continuation: { id: 'next' }, toolCalls: [{ id: 'tool-1', name: 'inspect_tool', arguments: {} }] };
      return { toolCalls: [], meta: { provider: 'test' } };
    },
  };
  await session.send('Inspect this turn.');
  const inspection = session.getLastRequestInspection();
  assert.equal(received.length, 2);
  assert.equal(inspection.rounds.length, 2);
  inspection.rounds.forEach((captured, index) => {
    const request = received[index];
    assert.equal(captured.systemInstruction, request.systemInstruction);
    assert.deepEqual(captured.messages, request.messages);
    assert.deepEqual(captured.tools, request.tools);
    assert.deepEqual(captured.toolResults, request.toolResults);
    assert.deepEqual(captured.budget, request.budget);
  });
  assert.notEqual(inspection.rounds[0].systemInstruction, inspection.rounds[1].systemInstruction);
  session.persist();
  assert.doesNotMatch(JSON.stringify(session.getMessages()), /inspection-adventure|systemInstruction/);
  session.destroy();
}

function testRequestInspectionRetentionAndContract() {
  const proto = window.NavigatorSession.prototype;
  const owner = { emit() {}, lastRequestInspection: null, getLastRequestInspection: window.NavigatorSession.prototype.getLastRequestInspection };
  proto.beginRequestInspection.call(owner);
  assert.equal(proto.getLastRequestInspection.call(owner).rounds.length, 0);
  for (let round = 0; round < 3; round += 1) {
    proto.retainInspectionRound.call(owner, {
      round, systemInstruction: 's'.repeat(1_500_000), messages: [], tools: [], toolResults: [],
      continuationPresent: round > 0, budget: {}, thinking: { level: 'low' }, projectedInputChars: 1_500_000,
    });
  }
  const inspection = proto.getLastRequestInspection.call(owner);
  assert.ok(JSON.stringify(inspection).length <= window.NavigatorSession.MAX_INSPECTION_CHARS);
  assert.equal(inspection.rounds[0].round, 0);
  assert.equal(inspection.rounds.at(-1).round, 2);
  assert.ok(inspection.rounds.some(round => round.omitted === true));
  const oversized = { emit() {}, lastRequestInspection: null, getLastRequestInspection: window.NavigatorSession.prototype.getLastRequestInspection };
  proto.beginRequestInspection.call(oversized);
  proto.retainInspectionRound.call(oversized, { round: 0, systemInstruction: 'x'.repeat(window.NavigatorSession.MAX_INSPECTION_CHARS + 1000), messages: [], tools: [], toolResults: [], continuationPresent: false, budget: {}, thinking: {}, projectedInputChars: window.NavigatorSession.MAX_INSPECTION_CHARS + 1000 });
  const oversizedInspection = proto.getLastRequestInspection.call(oversized);
  assert.ok(JSON.stringify(oversizedInspection).length <= window.NavigatorSession.MAX_INSPECTION_CHARS);
  assert.equal(oversizedInspection.rounds[0].truncated, true);
  assert.match(oversizedInspection.rounds[0].systemInstruction, /Inspection text truncated/);
  const source = require('node:fs').readFileSync(require('node:path').join(ROOT, 'services/navigator/session.js'), 'utf8');
  assert.match(source, /const requestPayload =/);
  assert.match(source, /chat\(requestPayload/);
  assert.match(source, /getLastRequestInspection/);
  assert.doesNotMatch(source, /persist\([^)]*lastRequestInspection/);
}

async function main() {
  await testIncompleteHistory();
  await testApolloCompleteHistoryAndDiagnostics();
  await testGraphqlFallbackDiagnosticsUnavailable();
  await testAuthoritativeCardGate();
  await testPlotUnavailableAndEmpty();
  await testDynamicAllocator();
  await testScaledDynamicCeilings();
  testStructuredToolResultBudgeting();
  testNavigatorToolGuidanceAndAllowances();
  testToolDropUsesInstructionOnly();
  await testProposalResultFloor();
  await testRequestInspectionExecutorCapture();
  testRequestInspectionRetentionAndContract();
  console.log('Desktop Navigator context contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
