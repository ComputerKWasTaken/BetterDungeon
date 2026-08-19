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
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/mutations.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/primer.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/context.js'), 'utf8'));

async function run() {
  const session = new window.NavigatorSession('demo');
  await session.settingsReady;
  const settings = session.getSettings();
  assert.equal(settings.readOnly, false, 'explicit per-adventure read-only off beats global on');
  assert.equal(settings.contextCap, undefined, 'stored per-adventure cap is ignored');
  assert.deepEqual(settings.contextSections, ['plot', 'history', 'cards']);
  assert.deepEqual(
    session.normalizeSettings({ includeMemoryBank: false, historyMode: 'floor' }).contextSections,
    ['plot', 'history', 'cards']
  );
  assert.deepEqual(
    session.normalizeSettings({ contextSections: ['memory', 'unknown', 'memory'] }).contextSections,
    ['memory']
  );
  assert.equal(session.normalizeSettings({ contextSections: 'memory' }).contextSections, undefined);
  assert.equal(settings.toolRounds, undefined, 'stored tool-round settings are ignored');
  assert.equal(settings.global, undefined, 'effective settings do not expose global defaults');
  assert.equal(settings.overrides, undefined, 'effective settings do not expose adventure overrides');
  const legacySession = new window.NavigatorSession('legacy');
  await legacySession.settingsReady;
  assert.equal(legacySession.getSettings().readOnly, true, 'legacy global read-only remains the fallback');
  local.set('betterDungeon_navigator_adventure_mutation', { readOnly: true });
  const mutations = new window.NavigatorMutations('mutation');
  assert.equal(await mutations.readOnlyEnabled(), true, 'per-adventure read-only is enforced');
  local.set('betterDungeon_navigator_adventure_mutation', { readOnly: false });
  assert.equal(await mutations.readOnlyEnabled(), false, 'adventure read-only overrides legacy sync value');
  chrome.runtime.id = null;
  await assert.rejects(
    mutations.readOnlyEnabled(),
    error => error?.code === 'extension_context_invalid'
      && error.message === 'The extension was reloaded. Reload this page before applying changes.'
  );
  chrome.runtime.id = 'navigator-options-contract';
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
  assert.equal(reloadedSettings.global, undefined);
  assert.equal(reloadedSettings.overrides, undefined);
  assert.equal(window.NavigatorSession.CHARS_PER_TOKEN, 3);
  assert.equal(window.NavigatorSession.DEFAULT_CONTEXT_CAP_TOKENS, undefined);
  assert.equal(window.NavigatorSession.MIN_CONTEXT_CAP_TOKENS, undefined);
  assert.equal(session.normalizeSettings({ contextCap: 50000 }).contextCap, undefined, 'stored cap is not normalized');
  assert.match(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /maxInputChars: Number\.isSafeInteger\(limits\.maxInputChars\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /providerMaxInputChars|effectiveInputChars|getProviderMaxInputChars/);
  assert.match(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /peakInputChars = Math\.max\(peakInputChars, projected\)/);
  const snapshot = await new window.NavigatorContext('demo').build({
    maxChars: 100000,
    contextSections: ['plot', 'history', 'cards'],
  });
  assert.doesNotMatch(snapshot.systemInstruction, /MEMORY BANK\n/);
  assert.match(snapshot.systemInstruction, /Memory Bank: omitted by user setting/);
  assert.match(snapshot.systemInstruction, /search_memory_bank and get_memory/);
  assert.equal(snapshot.segments.memoryBank.truncatedReason, 'user setting');
  assert.equal(snapshot.segments.recentActions.truncatedReason, null);
  assert.equal(snapshot.segments.recentActions.coverage.omittedReason, null);
  const defaultSnapshot = await new window.NavigatorContext('demo').build({ maxChars: 100000 });
  assert.match(defaultSnapshot.systemInstruction, /entries\. summary lag latest=/);
  assert.deepEqual(
    defaultSnapshot.summary.settings.contextSections,
    ['plot', 'history', 'memory', 'cards'],
    'context selection defaults to all sections'
  );
  for (const [key, heading, tool] of [
    ['plot', 'PLOT COMPONENTS', 'no retrieval tool exists for Plot Components'],
    ['history', 'RECENT STORY ACTIONS', 'search_story_history'],
    ['memory', 'MEMORY BANK', 'search_memory_bank'],
    ['cards', 'STORY CARD DIRECTORY', 'search_story_cards'],
  ]) {
    const selected = ['plot', 'history', 'memory', 'cards'].filter(section => section !== key);
    const omitted = await new window.NavigatorContext('demo').build({
      maxChars: 100000,
      contextSections: selected,
    });
    assert.doesNotMatch(omitted.systemInstruction, new RegExp(`${heading}\\n`));
    assert.match(omitted.systemInstruction, /omitted by user setting/);
    assert.match(omitted.systemInstruction, new RegExp(tool));
    const segment = {
      plot: omitted.segments.plotComponents,
      history: omitted.segments.recentActions,
      memory: omitted.segments.memoryBank,
      cards: omitted.segments.storyCardDirectory,
    }[key];
    assert.equal(segment.includedChars, 0);
    assert.equal(segment.truncatedReason, 'user setting');
  }
  const identityOnly = await new window.NavigatorContext('demo').build({
    maxChars: 100000,
    contextSections: [],
  });
  assert.match(identityOnly.systemInstruction, /IDENTITY\nTitle: Options/);
  for (const heading of ['PLOT COMPONENTS', 'RECENT STORY ACTIONS', 'MEMORY BANK', 'STORY CARD DIRECTORY']) {
    assert.doesNotMatch(identityOnly.systemInstruction, new RegExp(`${heading}\\n`));
  }
  assert.equal(identityOnly.segments.plotComponents.includedChars, 0);
  assert.equal(identityOnly.segments.recentActions.includedChars, 0);
  assert.equal(identityOnly.segments.memoryBank.includedChars, 0);
  assert.equal(identityOnly.segments.storyCardDirectory.includedChars, 0);
  const originalAdventureData = adventureData;
  adventureData = {
    ...adventureData,
    plot: { instructions: 'Plot '.repeat(3000) },
    actions: Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1),
      type: 'do',
      text: `Action ${index + 1} ${'history '.repeat(30)}`,
    })),
  };
  const allSectionsBudget = await new window.NavigatorContext('demo').build({
    maxChars: 12000,
    contextSections: ['plot', 'history', 'memory', 'cards'],
  });
  const historyOnlyBudget = await new window.NavigatorContext('demo').build({
    maxChars: 12000,
    contextSections: ['history'],
  });
  assert.ok(
    historyOnlyBudget.segments.recentActions.includedChars >
      allSectionsBudget.segments.recentActions.includedChars,
    'disabling plot/cards/memory frees budget for history'
  );
  adventureData = originalAdventureData;

  adventureData = { ...adventureData, state: { memories: null } };
  const unavailable = await new window.NavigatorContext('demo').build({
    maxChars: 100000,
    contextSections: ['plot', 'history', 'cards'],
  });
  assert.match(unavailable.systemInstruction, /Memory Bank and summary lag: unavailable from the GraphQL fallback reader/);
  assert.doesNotMatch(unavailable.systemInstruction, /search_memory_bank/);
  assert.equal(unavailable.segments.memoryBank.truncatedReason, 'user setting');

  adventureData = {
    ...adventureData,
    state: { memories: ['Memory '.repeat(3000)] },
    actions: adventureData.actions.map(action => ({ ...action, text: 'Action '.repeat(500) })),
  };
  const clippedFloor = await new window.NavigatorContext('demo').build({
    maxChars: 9000,
    contextSections: ['plot', 'history', 'memory', 'cards'],
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
  assert.match(featureSource, /if \(event === 'reset'\) \{[\s\S]*?this\.renderTranscript\(\);[\s\S]*?if \(this\.inspectionPanel && !this\.inspectionPanel\.hidden\) \{\s*this\.renderRequestInspection\(\);\s*\}\s*\}/);
  assert.match(featureSource, /header\.querySelector\('\.bd-navigator-settings'\)\.addEventListener\('click', \(\) => \{\s*settings\.hidden = !settings\.hidden;\s*inspection\.hidden = true;/);
  assert.equal((featureSource.match(/<input[^>]*data-nav-setting="/g) || []).length, 2);
  assert.match(featureSource, /input type="range"[\s\S]*data-nav-setting="thinkingLevel"/);
  assert.match(featureSource, /input type="checkbox" data-nav-setting="readOnly"/);
  assert.match(featureSource, /fieldset class="bd-navigator-context-sections"/);
  assert.match(featureSource, /data-nav-context-section="plot"[\s\S]*data-nav-context-section="history"[\s\S]*data-nav-context-section="memory"[\s\S]*data-nav-context-section="cards"/);
  assert.doesNotMatch(featureSource, /fieldset[^>]*data-nav-setting="contextSections"/);
  assert.match(featureSource, /updateThinkingLevelLabel\(Number\(event\.target\.value\)\)/);
  assert.match(featureSource, /thinking\.disabled = supported\.length === 0/);
  assert.doesNotMatch(featureSource, /includeMemoryBank|historyMode|Inherit global default/);
  assert.match(featureSource, /search_memory_bank[\s\S]*get_memory[\s\S]*search_story_history[\s\S]*get_story_actions/);
  assert.match(featureSource, /Used \$\{tools\.length\} Memory Bank tools/);
  assert.match(featureSource, /Used \$\{tools\.length\} story history tools/);
  assert.match(featureSource, /Used \$\{tools\.length\} Navigator read tools/);
  assert.match(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /this turn\\'s read-tool budget/);
  assert.match(featureSource, /value === undefined \? '\(nothing was sent\)'/);
  assert.match(featureSource, /` \| Error: \$\{inspection\.error\.message\}`/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'), /navigator-tool-rounds|toolRounds/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8'), /navigator-context-cap|contextCap/);
  const popupJs = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  assert.doesNotMatch(popupHtml, /navigator-tool-rounds|navigator-context-cap|characters\)/);
  for (const id of ['navigator-read-only', 'navigator-thinking-level', 'navigator-memory-bank', 'navigator-history-mode']) {
    assert.doesNotMatch(popupHtml, new RegExp(`id="${id}"`));
    assert.doesNotMatch(popupJs, new RegExp(id));
  }
  assert.doesNotMatch(popupJs, /betterDungeon_navigator_(read_only|thinking_level|defaults)/);
  assert.doesNotMatch(popupHtml, /navigator-option-select/);
  console.log('Navigator options contract tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
