'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const PROTOTYPE = path.join(ROOT, 'examples', 'aid-scripts', 'brainiac-prototype');
const librarySource = fs.readFileSync(path.join(PROTOTYPE, 'library.js'), 'utf8');
const inputSource = fs.readFileSync(path.join(PROTOTYPE, 'input.js'), 'utf8');
const contextSource = fs.readFileSync(path.join(PROTOTYPE, 'context.js'), 'utf8');
const outputSource = fs.readFileSync(path.join(PROTOTYPE, 'output.js'), 'utf8');
const readmeSource = fs.readFileSync(path.join(PROTOTYPE, 'README.md'), 'utf8');

const CONFIG_CARD = 'Configure Brainiac';
const BRAIN_CARD = 'Brainiac Brain';
const HEARTBEAT_CARD = 'ultrascripts:heartbeat';
const OUT_CARD = 'ultrascripts:out';
const AI_INBOX_CARD = 'ultrascripts:in:ai';

function createHarness({ runtime = true } = {}) {
  const sandbox = {
    state: {},
    storyCards: [],
    history: [],
    info: { actionCount: 0 },
    text: '',
    stop: false,
    console,
    log() {},
  };

  sandbox.addStoryCard = (keys, entry, type = 'Custom') => {
    if (sandbox.storyCards.some(card => card.keys === keys)) return false;
    sandbox.storyCards.push({
      id: String(sandbox.storyCards.length + 1),
      title: keys,
      keys,
      entry,
      type,
    });
    return sandbox.storyCards.length;
  };

  sandbox.updateStoryCard = (index, keys, entry, type) => {
    const card = sandbox.storyCards[Number(index)];
    if (!card) throw new Error(`Missing Story Card at index ${index}`);
    card.keys = keys;
    card.entry = entry;
    card.type = type;
  };

  vm.createContext(sandbox);
  vm.runInContext(librarySource, sandbox, { filename: 'brainiac-prototype/library.js' });

  const api = {
    sandbox,
    call(hook, text) {
      sandbox.text = text;
      return sandbox.Brainiac(hook, text);
    },
    card(title) {
      return sandbox.storyCards.find(card => card.title === title || card.keys === title) || null;
    },
    cardText(title) {
      return api.card(title)?.entry ?? '';
    },
    setCard(title, entry, type = 'Ultrascripts') {
      const card = api.card(title);
      if (card) {
        card.entry = entry;
        return card;
      }
      sandbox.addStoryCard(title, entry, type);
      return api.card(title);
    },
    setInbox(responses) {
      api.setCard(AI_INBOX_CARD, JSON.stringify({ v: 1, responses }));
    },
    out() {
      const raw = api.cardText(OUT_CARD);
      return raw ? JSON.parse(raw) : { v: 1, requests: [], acks: [] };
    },
    requests(op) {
      return api.out().requests.filter(request => !op || request.op === op);
    },
    bumpHeartbeat() {
      const heartbeat = JSON.parse(api.cardText(HEARTBEAT_CARD));
      heartbeat.ultrascripts.beat += 1;
      heartbeat.turn += 1;
      sandbox.info.actionCount += 1;
      api.setCard(HEARTBEAT_CARD, JSON.stringify(heartbeat));
    },
  };

  if (runtime) {
    api.setCard(HEARTBEAT_CARD, JSON.stringify({
      ultrascripts: {
        protocol: 1,
        enabled: true,
        client: 'BetterDungeon',
        beat: 1,
      },
      turn: 0,
      modules: [{ id: 'ai', ops: ['status', 'query'] }],
    }));
  }

  return api;
}

function terminal(data, extras = {}) {
  return {
    status: 'ok',
    data,
    completedAt: Date.now(),
    completedLiveCount: 0,
    ...extras,
  };
}

function makeReady(api) {
  const firstInput = api.call('input', 'You test the old gate.');
  assert.equal(firstInput.stop, undefined);

  const statusRequests = api.requests('status');
  assert.equal(statusRequests.length, 1, 'startup should queue one ai.status request');
  const statusId = statusRequests[0].id;

  api.setInbox({
    [statusId]: terminal({
      ready: true,
      available: true,
      supports: { text: true, json: true, thinking: true },
    }),
  });
  api.call('context', 'INITIAL CONTEXT');
  api.setInbox({});
  assert.equal(api.sandbox.state.brainiac.aiReady, true);
  return statusId;
}

assert.match(contextSource, /^\/\/ @cache-compatible\r?\n/);
assert.match(inputSource, /Brainiac\('input', text\)/);
assert.match(contextSource, /Brainiac\('context', text\)/);
assert.match(outputSource, /Brainiac\('output', text\)/);
assert.match(readmeSource, /at most one `ai\.query` request at a time/i);

{
  const api = createHarness({ runtime: false });
  const result = api.call('input', 'You walk onward.');
  assert.equal(result.text, null);
  assert.equal(result.stop, true);
  assert.match(api.sandbox.state.message, /download and install BetterDungeon/i);
  assert.match(api.sandbox.state.message, /enable Ultrascripts/i);
  assert.match(api.cardText(CONFIG_CARD), /Status: Waiting for Ultrascripts/);
  assert.match(api.cardText(CONFIG_CARD), /Next step:.*BetterDungeon.*enable Ultrascripts/i);
  assert.ok(api.card(BRAIN_CARD), 'Brainiac should create its Brain Card during setup');
}

{
  const api = createHarness();
  const heartbeat = JSON.parse(api.cardText(HEARTBEAT_CARD));
  heartbeat.modules = [];
  api.setCard(HEARTBEAT_CARD, JSON.stringify(heartbeat));
  const input = api.call('input', 'You continue without the AI module.');
  assert.equal(input.text, 'You continue without the AI module.');
  assert.equal(input.stop, undefined);
  assert.equal(api.call('context', 'NO AI MODULE CONTEXT').text, 'NO AI MODULE CONTEXT');
  assert.match(api.cardText(CONFIG_CARD), /Status: AI unavailable/);
  assert.match(api.cardText(CONFIG_CARD), /enable the Ultrascripts AI module/i);
  assert.match(api.sandbox.state.message, /configure its provider, model, and API key/i);
}

{
  const api = createHarness();
  const input = api.call('input', 'You enter the observatory.');
  assert.equal(input.text, 'You enter the observatory.');
  assert.ok(api.card(CONFIG_CARD));
  assert.ok(api.card(BRAIN_CARD));
  assert.match(api.cardText(CONFIG_CARD), /Enabled: true/);

  const statusRequest = api.requests('status')[0];
  api.setInbox({
    [statusRequest.id]: terminal({
      ready: false,
      available: false,
      supports: { text: true, json: true, thinking: true },
    }),
  });
  const unchanged = 'AI UNAVAILABLE CONTEXT';
  const context = api.call('context', unchanged);
  assert.equal(context.text, unchanged, 'AI outage must continue without injected guidance');
  assert.match(api.cardText(CONFIG_CARD), /Status: AI unavailable/);
  assert.match(api.cardText(CONFIG_CARD), /configure its provider, model, and API key/i);
  assert.match(api.sandbox.state.message, /AI module is not ready/i);
  api.setInbox({});
  api.call('output', 'The telescope remains dark.');
  assert.equal(api.requests('query').length, 0, 'AI outage must not queue an analysis');
}

{
  const api = createHarness();
  makeReady(api);

  const firstContext = 'SYSTEM PREFIX\nWorld and recent story context.';
  const firstContextResult = api.call('context', firstContext);
  assert.equal(firstContextResult.text, firstContext, 'an empty brain should append nothing');

  const firstOutput = 'Mara finds a brass key beneath the telescope.';
  const firstOutputResult = api.call('output', firstOutput);
  assert.equal(firstOutputResult.text, firstOutput, 'Brainiac must never rewrite vanilla output');

  const firstQuery = api.requests('query')[0];
  assert.ok(firstQuery, 'the first completed output should queue an analysis');
  assert.equal(firstQuery.args.output.type, 'text');
  assert.equal(firstQuery.args.thinking, 'medium');
  assert.ok(firstQuery.args.prompt.length <= 12000);
  assert.match(firstQuery.args.prompt, /Mara finds a brass key/);
  assert.match(api.cardText(CONFIG_CARD), /Status: Thinking/);

  const pendingId = api.sandbox.state.brainiac.query.id;
  const requestCounter = api.sandbox.state.__brainiacUltrascripts.reqCounter;
  api.setInbox({});
  api.bumpHeartbeat();
  api.call('input', 'You hurry down the stairs.');
  api.call('context', 'A NEWER ASSEMBLED CONTEXT');
  api.call('output', 'Footsteps follow Mara into the archive.');
  assert.equal(api.sandbox.state.brainiac.query.id, pendingId);
  assert.equal(
    api.sandbox.state.__brainiacUltrascripts.reqCounter,
    requestCounter,
    'a newer output must not queue another request while one is pending'
  );

  const lateBrain = 'Mara possesses a brass key from the observatory. Footsteps now follow her toward the archive; preserve the pursuer\'s continuity and let the mystery develop naturally.';
  api.setInbox({ [pendingId]: terminal({ text: lateBrain }) });
  api.bumpHeartbeat();
  api.call('input', 'You listen at the archive door.');
  assert.equal(api.cardText(BRAIN_CARD), lateBrain, 'a late result should still update the rolling brain');
  assert.equal(api.sandbox.state.brainiac.query, null);

  const exactPrefix = 'CACHEABLE PREFIX\nRecent actions end here.';
  const guidedContext = api.call('context', exactPrefix);
  assert.equal(guidedContext.text.slice(0, exactPrefix.length), exactPrefix);
  assert.match(guidedContext.text.slice(exactPrefix.length), /<brainiac-editorial-memory>/);
  assert.match(guidedContext.text, /Mara possesses a brass key/);

  api.setInbox({});
  api.call('output', 'The archive door opens onto a room of star charts.');
  const secondQuery = api.requests('query')[0];
  assert.ok(secondQuery, 'the first output after completion should launch the catch-up request');
  assert.notEqual(secondQuery.id, pendingId);

  const playerBrain = 'Player correction: the brass key belongs to Ilyra, not Mara. Keep this fact authoritative.';
  api.setCard(BRAIN_CARD, playerBrain);
  api.setInbox({ [secondQuery.id]: terminal({ text: 'Incorrect replacement from the older request.' }) });
  api.bumpHeartbeat();
  api.call('input', 'You call for Ilyra.');
  assert.equal(api.cardText(BRAIN_CARD), playerBrain, 'a pending result must not overwrite a manual edit');

  api.setInbox({});
  api.call('context', 'CONTEXT AFTER PLAYER EDIT');
  api.call('output', 'Ilyra answers from behind a stack of charts.');
  const emptyQuery = api.requests('query')[0];
  assert.ok(emptyQuery);

  api.setInbox({ [emptyQuery.id]: terminal({ text: '   ' }) });
  api.bumpHeartbeat();
  api.call('input', 'You wait for her explanation.');
  assert.equal(api.cardText(BRAIN_CARD), playerBrain, 'empty responses must not replace the brain');

  api.setInbox({});
  api.call('context', 'CONTEXT BEFORE OVERSIZED RESPONSE');
  api.call('output', 'Ilyra admits she hid the key for safekeeping.');
  const oversizedQuery = api.requests('query')[0];
  assert.ok(oversizedQuery);

  api.setInbox({ [oversizedQuery.id]: terminal({ text: 'x'.repeat(3001) }) });
  api.bumpHeartbeat();
  api.call('input', 'You ask what it unlocks.');
  assert.equal(api.cardText(BRAIN_CARD), playerBrain, 'oversized responses must not replace the brain');

  api.setInbox({});
  api.call('context', 'CONTEXT BEFORE TIMEOUT');
  api.call('output', 'The lock is hidden somewhere beneath the city.');
  const timedOutQuery = api.requests('query')[0];
  assert.ok(timedOutQuery);

  api.setInbox({
    [timedOutQuery.id]: {
      status: 'timeout',
      error: { code: 'timeout', message: 'The analysis timed out.' },
      completedAt: Date.now(),
      completedLiveCount: api.sandbox.info.actionCount,
    },
  });
  api.bumpHeartbeat();
  api.call('input', 'You return to the observatory.');
  assert.equal(api.cardText(BRAIN_CARD), playerBrain, 'timeouts must not replace the brain');
  assert.equal(api.sandbox.state.brainiac.aiReady, false);
  assert.match(api.cardText(CONFIG_CARD), /Status: AI unavailable/);
  assert.equal(api.call('context', 'CONTEXT AFTER TIMEOUT').text, 'CONTEXT AFTER TIMEOUT');

  api.setInbox({});
  const config = api.cardText(CONFIG_CARD).replace(/Enabled:\s*true/i, 'Enabled: false');
  api.setCard(CONFIG_CARD, config);
  const disabledContext = 'DISABLED CONTEXT';
  assert.equal(api.call('context', disabledContext).text, disabledContext);
  const beforeDisabledOutput = api.sandbox.state.__brainiacUltrascripts.reqCounter;
  api.call('output', 'The story continues without Brainiac.');
  assert.equal(api.sandbox.state.__brainiacUltrascripts.reqCounter, beforeDisabledOutput);
  assert.match(api.cardText(CONFIG_CARD), /Enabled: false/);
}

{
  const api = createHarness();
  makeReady(api);
  api.call('context', 'CONTEXT BEFORE DISABLING');
  api.call('output', 'A storm gathers beyond the city walls.');
  const pending = api.requests('query')[0];
  assert.ok(pending);

  api.setCard(
    CONFIG_CARD,
    api.cardText(CONFIG_CARD).replace(/Enabled:\s*true/i, 'Enabled: false')
  );
  api.setInbox({ [pending.id]: terminal({ text: 'This result arrived after Brainiac was disabled.' }) });
  api.bumpHeartbeat();
  api.call('input', 'You close the shutters.');
  assert.equal(api.cardText(BRAIN_CARD), '', 'disabling Brainiac must discard a pending update');
}

{
  const api = createHarness();
  makeReady(api);
  const fullBrain = 'The lighthouse lens is cracked, and Nia is hiding that she caused it.';
  api.setCard(BRAIN_CARD, fullBrain);
  const hugeContext = `INSTRUCTIONS AT HEAD\n${'older context '.repeat(1800)}\nRECENT STORY AT TAIL`;
  const latestOutput = 'Nia hears the keeper climbing the lighthouse stairs.';
  api.call('context', hugeContext);
  api.call('output', latestOutput);
  const request = api.requests('query')[0];
  assert.ok(request);
  assert.ok(request.args.prompt.length <= 12000);
  assert.match(request.args.prompt, /INSTRUCTIONS AT HEAD/);
  assert.match(request.args.prompt, /RECENT STORY AT TAIL/);
  assert.match(request.args.prompt, /older context omitted/);
  assert.match(request.args.prompt, new RegExp(fullBrain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(request.args.prompt, new RegExp(latestOutput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log('Brainiac prototype contract tests passed');
