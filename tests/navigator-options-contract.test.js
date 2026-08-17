'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const sync = new Map([
  ['betterDungeon_navigator_read_only', true],
  ['betterDungeon_navigator_thinking_level', 'medium'],
  ['betterDungeon_navigator_defaults', { contextCap: 90000, toolRounds: 8 }],
]);
const local = new Map([
  ['betterDungeon_navigator_adventure_demo', {
    readOnly: false,
    contextCap: 20000,
    includeMemoryBank: false,
    historyMode: 'floor',
  }],
]);
let failReads = false;
const storageListeners = [];
let adventureData = {
  identity: { id: '42', shortId: 'demo', title: 'Options', actionCount: 40, thirdPerson: false },
  plot: { instructions: 'Use prose.' },
  actions: Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), type: 'do', text: `Action ${index + 1}` })),
  storyCards: [],
  state: { memories: ['Hidden memory'] },
  coverage: { actions: { authoritativeTotal: 20, available: 20 }, storyCards: { authoritativeTotal: 0 } },
  provenance: { plot: { instructions: 'apollo' }, actions: { source: 'apollo' }, storyCards: { source: 'apollo' } },
};
const area = store => ({
  get(keys, callback) {
    if (failReads) {
      chrome.runtime.lastError = { message: 'simulated settings read failure' };
      callback({});
      chrome.runtime.lastError = null;
      return;
    }
    const requested = Array.isArray(keys) ? keys : [keys];
    callback(Object.fromEntries(requested.filter(key => store.has(key)).map(key => [key, store.get(key)])));
  },
  set(values, callback) {
    for (const [key, value] of Object.entries(values)) store.set(key, value);
    callback?.();
  },
});

global.window = global;
window.NavigatorPrimer = { TEXT: 'You are Navigator.' };
window.BetterDungeonAdventureRead = {
  readAdventure: async () => adventureData,
};
global.chrome = {
  runtime: { id: 'options-test', lastError: null },
  storage: {
    sync: area(sync),
    local: area(local),
    onChanged: {
      addListener(listener) { storageListeners.push(listener); },
      removeListener() {},
    },
  },
};
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/primer.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/context.js'), 'utf8'));

async function run() {
  const session = new window.NavigatorSession('demo');
  await session.settingsReady;
  const settings = session.getSettings();
  assert.equal(settings.readOnly, false, 'explicit per-adventure read-only off beats global on');
  assert.equal(settings.contextCap, undefined, 'stored per-adventure cap is ignored');
  assert.equal(settings.includeMemoryBank, false);
  assert.equal(settings.historyMode, 'floor');
  assert.equal(settings.toolRounds, undefined, 'stored tool-round settings are ignored');
  assert.equal(settings.global.readOnly, true, 'global read-only is reported in global defaults');
  await session.clearAdventureSetting('readOnly');
  assert.equal(session.getSettings().readOnly, true, 'clearing override inherits global read-only');
  session.providerStatus = { limits: { maxInputChars: 150000 } };
  sync.set('betterDungeon_navigator_defaults', { contextCap: 120000, toolRounds: 8 });
  let reloadedSettings = null;
  const unsubscribeSettings = session.subscribe((event, payload) => {
    if (event === 'settings') reloadedSettings = payload;
  });
  for (const listener of storageListeners) {
    listener({
      betterDungeon_navigator_defaults: {
        oldValue: { contextCap: 90000, toolRounds: 8 },
        newValue: { contextCap: 120000, toolRounds: 8 },
      },
    }, 'sync');
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  unsubscribeSettings();
  assert.equal(reloadedSettings.contextCap, undefined, 'stored global cap is ignored');
  assert.equal(reloadedSettings.overrides.contextCap, undefined, 'cleared adventure cap remains inherited');
  assert.equal(window.NavigatorSession.CHARS_PER_TOKEN, 3);
  assert.equal(window.NavigatorSession.DEFAULT_CONTEXT_CAP_TOKENS, undefined);
  assert.equal(window.NavigatorSession.MIN_CONTEXT_CAP_TOKENS, undefined);
  assert.equal(session.normalizeSettings({ contextCap: 50000 }).contextCap, undefined, 'stored cap is not normalized');
  assert.match(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /maxInputChars: Number\.isSafeInteger\(limits\.maxInputChars\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /providerMaxInputChars|effectiveInputChars|getProviderMaxInputChars/);
  assert.match(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /peakInputChars = Math\.max\(peakInputChars, projected\)/);
  const snapshot = await new window.NavigatorContext('demo').build({
    maxChars: 100000,
    includeMemoryBank: false,
    historyMode: 'floor',
  });
  assert.match(snapshot.systemInstruction, /Full history omitted by user setting/);
  assert.match(snapshot.systemInstruction, /Memory Bank: omitted by user setting/);
  assert.doesNotMatch(snapshot.systemInstruction, /reduced for total budget/);
  assert.equal(snapshot.segments.memoryBank.truncatedReason, 'user setting');
  assert.equal(snapshot.segments.recentActions.truncatedReason, null);
  assert.equal(snapshot.segments.recentActions.coverage.omittedReason, 'user setting');

  adventureData = { ...adventureData, state: { memories: null } };
  const unavailable = await new window.NavigatorContext('demo').build({
    maxChars: 100000,
    includeMemoryBank: false,
    historyMode: 'full',
  });
  assert.match(unavailable.systemInstruction, /Memory Bank and summary lag: unavailable/);
  assert.doesNotMatch(unavailable.systemInstruction, /search_memory_bank/);
  assert.equal(unavailable.segments.memoryBank.truncatedReason, null);

  adventureData = {
    ...adventureData,
    state: { memories: ['Memory '.repeat(3000)] },
    actions: adventureData.actions.map(action => ({ ...action, text: 'Action '.repeat(500) })),
  };
  const clippedFloor = await new window.NavigatorContext('demo').build({
    maxChars: 9000,
    includeMemoryBank: true,
    historyMode: 'floor',
  });
  assert.equal(clippedFloor.segments.recentActions.truncatedReason, 'total budget');
  assert.equal(clippedFloor.segments.recentActions.coverage.omittedReason, 'total budget');

  failReads = true;
  await session.loadSettings();
  failReads = false;
  assert.equal(session.getSettings().contextCap, undefined, 'failed settings read retains cap-free settings');
  assert.equal(session.getSettings().readOnly, true, 'failed settings read keeps read-only fail-safe');
  session.providerStatus = { limits: { maxInputChars: 50000 } };
  assert.equal(session.normalizeSettings({ contextCap: 0 }).contextCap, undefined, 'zero stored cap is ignored');
  const sessionSource = fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8');
  assert.doesNotMatch(sessionSource, /Math\.min\(providerMaxInputChars, userCap/);
  assert.match(sessionSource, /roundLimit = MAX_TOOL_ROUNDS/);
  assert.doesNotMatch(sessionSource, /effectiveSettings\.toolRounds/);
  session.adventureSettings = { readOnly: false, toolRounds: 2 };
  session.effectiveSettings = { ...session.effectiveSettings, readOnly: false, toolRounds: 2 };
  session.readOnly = false;
  session.mutations = { definitions: () => [{ name: 'propose_edit' }] };
  assert.equal(session.getPermissionState().readOnly, false, 'explicit read-only force-off clears the effective badge');
  assert.ok(session.getToolDefinitions().some(tool => tool.name === 'propose_edit'), 'force-off keeps mutation proposals available');
  assert.equal(session.normalizeSettings({ toolRounds: 0 }).toolRounds, undefined, 'tool-round settings are not normalized');
  let chatCalls = 0;
  const chatBudgets = [];
  window.UltrascriptsAIExecutor = {
    refreshStatus: async () => ({ ready: true, limits: { maxInputChars: 50000 } }),
    chat: async args => {
      chatCalls += 1;
      chatBudgets.push(args.budget);
      return {
        text: chatCalls === 1 ? 'Answer preserved.' : '',
        continuation: `continuation-${chatCalls}`,
        toolCalls: [{ name: 'propose_edit', arguments: { text: 'draft' } }],
      };
    },
  };
  session.contextReader = {
    build: async () => ({
      systemInstruction: 'Context',
      snapshot: {},
      index: {},
      partial: false,
      summary: {},
      segments: {},
    }),
  };
  session.tools = { definitions: () => [] };
  session.mutations = {
    definitions: () => [{ name: 'propose_edit', description: 'draft', parameters: {} }],
    createProposal: () => ({ id: 'proposal-1', kind: 'edit', targetLabel: 'draft' }),
  };
  await session.runTurn('exercise round cap');
  const limitedMessage = session.messages[session.messages.length - 1];
  assert.equal(chatCalls, 7, 'fixed six-round cap stops before a seventh tool execution');
  assert.equal(chatBudgets[0].maxInputChars, 50000, 'Navigator uses provider input limits for its ledger');
  assert.match(limitedMessage.content, /Answer preserved\./);
  assert.match(limitedMessage.content, /6-round tool limit/);
  assert.equal(limitedMessage.status, 'complete');
  const contextSource = fs.readFileSync(path.join(ROOT, 'services/navigator/context.js'), 'utf8');
  assert.match(contextSource, /preview: adventureSnapshot\.provenance\?\.actions\?\.source === 'ws'/);
  const sessionSourceAfterTurn = fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8');
  assert.match(sessionSourceAfterTurn, /preview: summary\.preview === true/);
  session.contextSnapshot = { summary: { preview: true, apolloRetryable: true } };
  assert.equal(session.getContextSummary().apolloRetryable, true, 'retry flag is surfaced through the session summary');
  assert.equal(session.isApolloPreviewRetryable(), true, 'retry decision reads the session summary value');
  session.contextSnapshot = { summary: { preview: true, apolloRetryable: false } };
  assert.equal(session.isApolloPreviewRetryable(), false, 'authoritative summary stops preview retries');
  const readSource = fs.readFileSync(path.join(ROOT, 'services/adventure-read-service.js'), 'utf8');
  let apolloReads = 0;
  const readSandbox = {
    window: {
      BetterDungeonApolloCache: {
        readAdventure: async () => {
          apolloReads += 1;
          return apolloReads === 1
            ? { available: false, error: { code: 'not_found' } }
            : {
                available: true,
                data: {
                  adventure: { id: '42', shortId: 'demo', actionCount: 1 },
                  actions: [{ id: '1', text: 'Authoritative action' }],
                  storyCards: [],
                  state: { memories: [] },
                },
              };
        },
      },
      Ultrascripts: { ws: { getAdventureShortId: () => 'demo', getActions: () => [] } },
    },
  };
  vm.runInNewContext(readSource, readSandbox);
  const previewRead = await readSandbox.window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  const authoritativeRead = await readSandbox.window.BetterDungeonAdventureRead.readAdventure({ shortId: 'demo' });
  assert.equal(previewRead.apolloRetryable, true, 'cold Apollo not-found is retryable preview state');
  assert.equal(authoritativeRead.apolloRetryable, false, 'reachable Apollo ends preview state');
  assert.equal(authoritativeRead.provenance.actions.source, 'apollo+ws');
  assert.match(readSource, /apolloRetryable = !internal\.cardsOnly[\s\S]*apolloNotFound[\s\S]*apollo\?\.readAdventure/);
  const featureSource = fs.readFileSync(path.join(ROOT, 'features/navigator_feature.js'), 'utf8');
  assert.match(featureSource, /for \(const delay of \[250, 500, 1000\]\)/);
  assert.match(featureSource, /isApolloPreviewRetryable/);
  assert.match(featureSource, /this\.session !== session \|\| session\.isBusy/);
  assert.doesNotMatch(featureSource, /bd-navigator-settings-note|bd-navigator-cost|peak input characters|tokens, estimate/);
  assert.doesNotMatch(featureSource, /bd-navigator-subtitle|updateSubtitle|bd-navigator-empty-note|Navigator reads a budgeted snapshot/);
  assert.doesNotMatch(featureSource, /contextCap|clearAdventureSetting\('contextCap'\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'), /navigator-tool-rounds|toolRounds/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'), /navigator-context-cap|contextCap/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8'), /navigator-tool-rounds|navigator-context-cap|characters\)/);
  console.log('Navigator options contract tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
