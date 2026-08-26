'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const stored = {};
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
      get(_key, callback) { callback({}); },
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

  const user = session.addMessage({ role: 'user', content: 'Original question' });
  const assistant = session.addMessage({
    role: 'assistant',
    status: 'aborted',
    content: 'Partial answer',
    proposals: [{ id: 'proposal-1', status: 'pending' }],
  });
  assert.equal(session.getMessageActionState(user.id).editable, true);
  assert.equal(session.getMessageActionState(assistant.id).retryable, true);

  let retried = null;
  session.runTurn = async (text, options) => { retried = { text, options }; };
  assert.equal(await session.retryAssistantMessage(assistant.id), true);
  assert.deepEqual(retried, { text: 'Original question', options: { addUserMessage: false } });
  assert.equal(session.getMessages().length, 1);
  assert.equal(session.getMessages()[0].id, user.id);
  assert.equal(assistant.proposals[0].status, 'expired');

  const laterAssistant = session.addMessage({ role: 'assistant', content: 'Old answer' });
  const laterUser = session.addMessage({ role: 'user', content: 'Follow-up' });
  session.addMessage({ role: 'assistant', content: 'Follow-up answer' });
  let replacement = null;
  session.send = async text => { replacement = text; };
  assert.equal(await session.replaceFromUserMessage(laterUser.id, 'Edited follow-up'), true);
  assert.equal(replacement, 'Edited follow-up');
  assert.deepEqual(session.getMessages().map(message => message.id), [user.id, laterAssistant.id]);

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

  const blocked = session.addMessage({
    role: 'assistant',
    status: 'error',
    error: { code: 'safety_blocked', message: 'Blocked' },
  });
  assert.equal(session.getMessageActionState(blocked.id).retryable, false);

  session.tools = {
    definitions: () => [
      { name: 'get_plot_components' },
      { name: 'search_story_cards' },
      { name: 'get_story_card' },
      { name: 'search_story_history' },
      { name: 'get_story_actions' },
      { name: 'search_memory_bank' },
      { name: 'get_memory' },
    ],
  };
  session.mutations = { definitions: () => [{ name: 'propose_plot_component_change' }] };
  session.readOnly = false;
  session.effectiveSettings.contextSections = ['plot'];
  const fullPlotSnapshot = {
    segments: { plotComponents: { truncated: false, sourceChars: 120, includedChars: 120 } },
  };
  assert.deepEqual(
    session.getToolDefinitions(fullPlotSnapshot).map(tool => tool.name),
    ['propose_plot_component_change']
  );
  const truncatedPlotSnapshot = {
    segments: { plotComponents: { truncated: true, sourceChars: 120, includedChars: 60 } },
  };
  assert.deepEqual(
    session.getToolDefinitions(truncatedPlotSnapshot).map(tool => tool.name),
    ['get_plot_components', 'propose_plot_component_change']
  );
  session.effectiveSettings.contextSections = [];
  assert.deepEqual(
    session.getToolDefinitions(truncatedPlotSnapshot).map(tool => tool.name),
    ['propose_plot_component_change']
  );
  const fullPlotGuidance = session.buildToolGuidance([
    { name: 'search_story_cards' },
  ]);
  assert.match(fullPlotGuidance, /Do not call a read tool/);
  assert.doesNotMatch(fullPlotGuidance, /get_plot_components/);

  session.destroy();
  console.log('Navigator chat quality-of-life tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
