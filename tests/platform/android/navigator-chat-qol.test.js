'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { composeAndroidRuntime } = require('../../harness/android-runtime');

const ROOT = composeAndroidRuntime();
const stored = {};
const syncStored = {};
let lastPersisted = null;

global.window = global;
global.chrome = {
  runtime: { id: 'navigator-test', lastError: null },
  storage: {
    local: {
      get(key, callback) {
        if (Array.isArray(key)) {
          callback(Object.fromEntries(key.filter(item => item in stored).map(item => [item, stored[item]])));
          return;
        }
        callback(typeof key === 'string' && key in stored ? { [key]: stored[key] } : {});
      },
      set(value, callback) {
        Object.assign(stored, value);
        lastPersisted = value;
        callback?.();
      },
    },
    sync: {
      get(key, callback) {
        if (Array.isArray(key)) {
          callback(Object.fromEntries(key.filter(item => item in syncStored).map(item => [item, syncStored[item]])));
          return;
        }
        callback(typeof key === 'string' && key in syncStored ? { [key]: syncStored[key] } : {});
      },
      set(_value, callback) { callback?.(); },
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
  },
};

vm.runInThisContext(
  fs.readFileSync(path.join(ROOT, 'services', 'navigator', 'session.js'), 'utf8'),
  { filename: 'services/navigator/session.js' }
);

(async () => {
  const session = new window.NavigatorSession('qol-test');
  await session.settingsReady;
  assert.equal(session.getSettings().changeMode, 'automatic');
  assert.equal(session.getPermissionState().changeMode, 'automatic');

  session.messages = [];
  const trailOwner = session.addMessage({ role: 'assistant', status: 'pending', content: '' });
  const first = session.startToolActivity(trailOwner.id, {
    id: 'tool-1',
    name: 'search_story_cards',
    arguments: { query: 'dragon', rawSecret: 'RAW_ARGUMENT_SECRET' },
  }, 1);
  session.finishToolActivity(trailOwner.id, first.id, {
    isError: false,
    result: {
      ok: true,
      data: {
        returned: 2,
        totalMatches: 4,
        cards: [{ title: 'RESULT_CONTENT_SECRET', value: 'RESULT_BODY_SECRET' }],
      },
    },
  });
  const second = session.startToolActivity(trailOwner.id, {
    id: 'tool-2',
    name: 'get_memory',
    arguments: { index: 0, rawSecret: 'SECOND_ARGUMENT_SECRET' },
  }, 2);
  session.finishToolActivity(trailOwner.id, second.id, {
    isError: false,
    result: { ok: true, data: { index: 0, text: 'MEMORY_BODY_SECRET' } },
  });
  const repeated = session.startToolActivity(trailOwner.id, {
    id: 'tool-1',
    name: 'search_story_cards',
    arguments: { query: 'dragon' },
  }, 3);
  session.finishToolActivity(trailOwner.id, repeated.id, {
    isError: true,
    result: { ok: false, error: { code: 'tool_already_read', message: 'ERROR_DETAIL_SECRET' } },
  });

  const activityJson = JSON.stringify(trailOwner.toolActivityTrail);
  assert.doesNotMatch(activityJson, /RAW_ARGUMENT_SECRET|SECOND_ARGUMENT_SECRET|RESULT_CONTENT_SECRET|RESULT_BODY_SECRET|MEMORY_BODY_SECRET|ERROR_DETAIL_SECRET/);
  assert.deepEqual(trailOwner.toolActivityTrail.map(activity => activity.name), ['search_story_cards', 'get_memory', 'search_story_cards']);
  assert.equal(trailOwner.toolActivityTrail[0].summary.query, 'dragon');
  assert.equal(trailOwner.toolActivityTrail[0].summary.resultCount, 2);
  assert.equal(trailOwner.toolActivityTrail[0].summary.resultTotal, 4);
  assert.ok(Number.isFinite(trailOwner.toolActivityTrail[0].durationMs));
  assert.equal(trailOwner.toolActivityTrail[1].summary.target, 'Memory Bank entry #1');
  assert.equal(trailOwner.toolActivityTrail[2].status, 'error');
  assert.equal(trailOwner.toolActivityTrail[2].errorCode, 'tool_already_read');

  session.persist();
  const persistedJson = JSON.stringify(lastPersisted);
  assert.doesNotMatch(persistedJson, /RAW_ARGUMENT_SECRET|SECOND_ARGUMENT_SECRET|RESULT_CONTENT_SECRET|RESULT_BODY_SECRET|MEMORY_BODY_SECRET|ERROR_DETAIL_SECRET/);
  assert.match(persistedJson, /toolActivityTrail/);

  session.tools = {
    definitions: () => [
      { name: 'search_story_cards' },
      { name: 'get_story_card' },
      { name: 'search_story_history' },
      { name: 'get_story_actions' },
      { name: 'search_memory_bank' },
      { name: 'get_memory' },
    ],
  };
  session.mutations = { definitions: () => [{ name: 'propose_plot_component_change' }] };
  session.setChangeMode('automatic');
  assert.deepEqual(
    session.getToolDefinitions().map(tool => tool.name),
    ['search_story_cards', 'get_story_card', 'search_story_history', 'get_story_actions', 'search_memory_bank', 'get_memory', 'propose_plot_component_change']
  );
  session.setChangeMode('none');
  assert.deepEqual(
    session.getToolDefinitions().map(tool => tool.name),
    ['search_story_cards', 'get_story_card', 'search_story_history', 'get_story_actions', 'search_memory_bank', 'get_memory']
  );
  session.setChangeMode('automatic');
  const fullPlotGuidance = session.buildToolGuidance([
    { name: 'search_story_cards' },
  ]);
  assert.match(fullPlotGuidance, /Do not call a read tool/);
  assert.doesNotMatch(fullPlotGuidance, /get_plot_components/);

  let applyCalls = 0;
  let proposalCounter = 0;
  session.refreshContext = async () => null;
  session.mutations = {
    definitions: () => [{ name: 'propose_plot_component_change' }, { name: 'propose_story_card_delete' }],
    async createProposal(name) {
      proposalCounter += 1;
      return {
        id: `proposal-${proposalCounter}`,
        status: 'pending',
        kind: name.includes('delete') ? 'story_card_delete' : 'plot_component',
        action: name.includes('delete') ? 'delete' : 'modify',
        irreversible: name.includes('delete'),
        targetLabel: 'Test target',
        changes: [],
      };
    },
    async apply() {
      applyCalls += 1;
      return { appliedAtIso: '2026-08-30T00:00:00.000Z' };
    },
  };
  session.messages = [];
  const mutationOwner = session.addMessage({ role: 'assistant', status: 'pending', content: '' });
  const snapshot = { index: { shortId: 'qol-test' } };
  const signal = new AbortController().signal;

  const automaticEdit = await session.executeToolCalls(
    [{ id: 'change-1', name: 'propose_plot_component_change', arguments: {} }],
    signal, 50000, mutationOwner.id, snapshot, new Map(), 1
  );
  assert.equal(automaticEdit.results[0].result.data.status, 'applied');
  assert.equal(applyCalls, 1);

  const automaticDelete = await session.executeToolCalls(
    [{ id: 'change-2', name: 'propose_story_card_delete', arguments: {} }],
    signal, 50000, mutationOwner.id, snapshot, new Map(), 2
  );
  assert.equal(automaticDelete.results[0].result.data.status, 'pending_approval');
  assert.equal(applyCalls, 1, 'Automatic mode must not apply permanent deletion');

  session.setChangeMode('proposed');
  const proposedEdit = await session.executeToolCalls(
    [{ id: 'change-3', name: 'propose_plot_component_change', arguments: {} }],
    signal, 50000, mutationOwner.id, snapshot, new Map(), 3
  );
  assert.equal(proposedEdit.results[0].result.data.status, 'pending_approval');
  assert.equal(applyCalls, 1);

  session.beginRequestInspection();
  session.lastRequestInspection.snapshot = { partial: false, warnings: [], sections: { coverage: 'Complete' } };
  session.lastRequestInspection.conversation = { messages: [{ role: 'user', content: 'Inspect me' }], truncated: false, omittedMessages: 0 };
  const inspectedRound = session.retainInspectionRound({
    round: 0,
    systemInstruction: 'SYSTEM',
    messages: [{ role: 'user', content: 'Inspect me' }],
    tools: [{ name: 'search_story_cards' }],
    projectedInputChars: 100,
  });
  session.updateInspectionRound(inspectedRound, {
    activity: [{ name: 'search_story_cards', status: 'success', summary: { resultCount: 1 } }],
    responseMeta: { outputTruncated: false },
  });
  session.finishRequestInspection({ peakInputChars: 100, toolRounds: 1, toolsDropped: false }, null);
  const inspection = session.getLastRequestInspection();
  assert.equal(inspection.status, 'complete');
  assert.equal(inspection.rounds[0].activity[0].name, 'search_story_cards');
  assert.equal(inspection.conversation.messages[0].content, 'Inspect me');

  stored[`betterDungeon_navigator_adventure_${encodeURIComponent('legacy-none')}`] = { readOnly: true, applyMode: 'auto' };
  const legacyNone = new window.NavigatorSession('legacy-none');
  await legacyNone.settingsReady;
  assert.equal(legacyNone.getSettings().changeMode, 'none');
  legacyNone.destroy();

  stored[`betterDungeon_navigator_adventure_${encodeURIComponent('legacy-review')}`] = { readOnly: false, applyMode: 'review' };
  const legacyReview = new window.NavigatorSession('legacy-review');
  await legacyReview.settingsReady;
  assert.equal(legacyReview.getSettings().changeMode, 'proposed');
  legacyReview.destroy();

  syncStored.betterDungeon_navigator_defaults = { changeMode: 'proposed' };
  const inheritedDefault = new window.NavigatorSession('inherited-default');
  await inheritedDefault.settingsReady;
  assert.equal(inheritedDefault.getSettings().changeMode, 'proposed', 'adventures without a local mode must inherit canonical defaults');
  assert.equal(stored[`betterDungeon_navigator_adventure_${encodeURIComponent('inherited-default')}`]?.changeMode, undefined);
  inheritedDefault.destroy();

  session.destroy();
  console.log('Navigator chat quality-of-life tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
