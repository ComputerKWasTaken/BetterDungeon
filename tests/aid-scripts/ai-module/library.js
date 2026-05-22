// Ultrascripts AI Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Ultrascripts AI module through every public op and a
// representative set of error paths. Pair with output-modifier.js.
//
// Surfaces written:
//   ultrascripts:out                  - request envelope queue (script -> BD)
//   ultrascripts:in:ai                - response envelope (BD -> script, canonical id)
//   ultrascripts:in:providerAI        - response envelope (BD -> script, alias path)
//   ultrascripts:test:ai              - human-readable trace card with results
//
// Before running:
//   1. Open BetterDungeon -> Ultrascripts and enable Ultrascripts + the AI module.
//   2. In Ultrascripts -> AI, save an OpenRouter API key.
//   3. Optionally edit ULTRASCRIPTS_AI_TEST_MODEL below; otherwise a free model
//      is used.

var ULTRASCRIPTS_AI_TEST_MODEL = 'inclusionai/ring-2.6-1t:free';

// ---------- state ----------

state.ultrascriptsAiTest = state.ultrascriptsAiTest || {
  runId: null,
  turn: 0,
  seq: 0,
  outSeq: 0,
  pending: {},      // id -> request
  completed: {},    // id -> { status, data, error, module, label }
  acked: {},
  ackAttempts: {},
  steps: {},        // label -> requestId
  replayResets: {}, // label -> count of times we re-queued after unsafe_replay_blocked
  events: [],
  consumedCommands: {},
  phase: 'boot'
};

// ---------- test plan ----------
//
// Each step queues one Ultrascripts request and records it under a stable label
// so the trace can call out exactly what failed. `module` is either the
// canonical id 'ai' or the alias 'providerAI' so we exercise alias routing.

var FAI_STEPS = [
  {
    label: 'testConnection',
    module: 'ai',
    op: 'testConnection',
    args: function () { return { provider: 'openrouter', timeoutMs: 30000 }; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && r.provider === 'openrouter' && r.ok === true &&
        r.configured === true && typeof r.modelCount === 'number' &&
        r.key && typeof r.key === 'object');
    }
  },
  {
    label: 'models',
    module: 'ai',
    op: 'models',
    // Fetch a small page so the chat steps can pick a real, currently-listed
    // model rather than a hard-coded one that may have rotated out of the
    // OpenRouter free tier.
    args: function () { return { provider: 'openrouter', query: ':free', limit: 20, timeoutMs: 30000 }; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && r.provider === 'openrouter' && r.configured === true &&
        Array.isArray(r.models) && typeof r.totalCount === 'number');
    }
  },
  {
    label: 'chat-canonical',
    module: 'ai',
    op: 'chat',
    args: function () { return faiChatArgs(faiPickChatModel()); },
    expect: 'ok',
    validate: faiValidChat
  },
  {
    label: 'chat-via-alias',
    module: 'providerAI',
    op: 'chat',
    args: function () { return faiChatArgs(faiPickChatModel()); },
    expect: 'ok',
    validate: faiValidChat
  },
  {
    label: 'chat-json-object',
    module: 'ai',
    op: 'chat',
    args: function () { return faiJsonObjectArgs(faiPickChatModel()); },
    expect: 'ok',
    validate: faiValidJsonObjectChat
  },
  {
    label: 'chat-json-schema',
    module: 'ai',
    op: 'chat',
    args: function () { return faiJsonSchemaArgs(faiPickChatModel()); },
    expect: 'ok',
    validate: faiValidJsonSchemaChat
  },
  {
    label: 'err-empty-messages',
    module: 'ai',
    op: 'chat',
    args: function () { return { provider: 'openrouter', messages: [] }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-bad-response-format',
    module: 'ai',
    op: 'chat',
    args: function () {
      return {
        provider: 'openrouter',
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'bad schema name!',
            schema: { type: 'object' }
          }
        }
      };
    },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-oversized-content',
    module: 'ai',
    op: 'chat',
    args: function () {
      return {
        provider: 'openrouter',
        messages: [{ role: 'user', content: faiRepeat('x', 8001) }]
      };
    },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-bad-temperature',
    module: 'ai',
    op: 'chat',
    args: function () {
      return {
        provider: 'openrouter',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 99
      };
    },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-bad-provider',
    module: 'ai',
    op: 'testConnection',
    args: function () { return { provider: 'not-a-provider' }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-unknown-op',
    module: 'ai',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  },
  {
    label: 'err-unknown-module',
    module: 'definitelyNotAModule',
    op: 'chat',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

// ---------- helpers ----------

function faiNow() { return Date.now ? Date.now() : new Date().getTime(); }

function faiRunId() {
  var s = state.ultrascriptsAiTest;
  if (!s.runId) s.runId = 'ultrascripts-ai-' + faiNow().toString(36);
  return s.runId;
}

function faiCards() { return Array.isArray(storyCards) ? storyCards : []; }

function faiFindCard(title) {
  var cards = faiCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function faiCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function faiReadJson(title) {
  var f = faiFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(faiCardText(f.card) || '{}'); } catch (e) { return null; }
}

function faiWriteCard(title, value, type) {
  var f = faiFindCard(title);
  var cardType = type || 'Ultrascripts';

  if (f.card && f.index >= 0 && typeof updateStoryCard === 'function') {
    updateStoryCard(
      f.index,
      f.card.keys || f.card.key || title,
      value,
      f.card.type || cardType
    );
    return true;
  }
  if (typeof addStoryCard === 'function') {
    addStoryCard(title, value, cardType);
    return true;
  }
  return false;
}

function faiLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function faiLog(event, detail) {
  var s = state.ultrascriptsAiTest;
  s.events.push({
    at: faiNow(), turn: s.turn, liveKey: faiLiveKey(),
    event: event, detail: detail || ''
  });
  while (s.events.length > 80) s.events.shift();
}

function faiHeartbeat() { return faiReadJson('ultrascripts:heartbeat'); }

function faiHasOp(moduleId, opName) {
  var hb = faiHeartbeat();
  if (!hb || !hb.ultrascripts || hb.ultrascripts.protocol !== 1) return false;
  var mods = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    if (!m || m.id !== moduleId) continue;
    var ops = Array.isArray(m.ops) ? m.ops : [];
    return ops.indexOf(opName) !== -1;
  }
  return false;
}

function faiPendingArray() {
  var s = state.ultrascriptsAiTest, out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function faiWriteOut() {
  var s = state.ultrascriptsAiTest;
  var payload = {
    v: 1,
    requests: faiPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: faiNow()
  };
  s._acks = [];
  faiWriteCard('ultrascripts:out', JSON.stringify(payload), 'Ultrascripts');
}

function faiQueueAck(requestId, reason) {
  var s = state.ultrascriptsAiTest;
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  faiLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function faiQueueRequest(label, moduleId, opName, args) {
  var s = state.ultrascriptsAiTest;
  var id = faiLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: faiNow()
  };
  s.steps[label] = id;
  faiLog('queued', id + ' -> ' + moduleId + '.' + opName);
  faiWriteOut();
  return id;
}

function faiIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function faiPollResponses() {
  var s = state.ultrascriptsAiTest;
  // Responses come back on `ultrascripts:in:<request.module>`, where
  // `<request.module>` is whatever name the script sent — including the
  // intentionally bogus name in the unknown-module test. Build the poll set
  // from the plan so every step is reachable.
  var seen = {};
  var modules = [];
  for (var i = 0; i < FAI_STEPS.length; i++) {
    var name = FAI_STEPS[i].module;
    if (name && !seen[name]) { seen[name] = true; modules.push(name); }
  }
  var found = false;
  for (var m = 0; m < modules.length; m++) {
    var card = faiReadJson('ultrascripts:in:' + modules[m]);
    if (!card || !card.responses) continue;
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!faiIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: modules[m], seenAt: faiNow()
        };
        faiLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = faiQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) faiWriteOut();
}

function faiRepeat(ch, count) {
  var out = '';
  for (var i = 0; i < count; i++) out += ch;
  return out;
}

function faiTestModel() { return String(ULTRASCRIPTS_AI_TEST_MODEL || '').trim(); }

// Pick a chat model dynamically: first prefer a `:free` model from the live
// `models` response, then any model from that response, and finally the
// configured default. This keeps the suite green as OpenRouter rotates its
// free-tier inventory.
function faiPickChatModel() {
  var s = state.ultrascriptsAiTest;
  var rid = s.steps && s.steps['models'];
  var done = rid && s.completed[rid];
  var list = done && done.data && Array.isArray(done.data.models) ? done.data.models : [];

  function modelId(m) {
    if (!m) return '';
    if (typeof m === 'string') return m;
    return String(m.id || m.slug || m.name || '');
  }

  for (var i = 0; i < list.length; i++) {
    var id = modelId(list[i]);
    if (id && id.indexOf(':free') !== -1) return id;
  }
  for (var j = 0; j < list.length; j++) {
    var id2 = modelId(list[j]);
    if (id2) return id2;
  }
  return faiTestModel();
}

function faiChatArgs(model) {
  var args = {
    provider: 'openrouter',
    messages: [
      { role: 'system', content: 'Reply with one short plain sentence.' },
      { role: 'user', content: 'Say that the Ultrascripts AI module is online.' }
    ],
    // Reasoning models can spend hundreds of tokens thinking before emitting
    // any visible content. Keep the budget high enough that a "say one short
    // sentence" reply has room to surface.
    maxTokens: 1024,
    temperature: 0,
    timeoutMs: 60000
  };
  var m = String(model || faiTestModel() || '').trim();
  if (m) args.model = m;
  return args;
}

function faiJsonObjectArgs(model) {
  var args = faiChatArgs(model);
  args.messages = [
    { role: 'system', content: 'Reply only with compact JSON.' },
    { role: 'user', content: 'Return {"status":"online"} and no prose.' }
  ];
  args.responseFormat = { type: 'json_object' };
  return args;
}

function faiJsonSchemaArgs(model) {
  var args = faiChatArgs(model);
  args.messages = [
    { role: 'system', content: 'Reply only with JSON matching the requested schema.' },
    { role: 'user', content: 'Report that Ultrascripts AI is online.' }
  ];
  args.responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'ultrascripts_ai_status',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['online']
          }
        },
        required: ['status'],
        additionalProperties: false
      }
    }
  };
  return args;
}

// Validate the chat response envelope shape only, not the model's word count.
// Reasoning models (e.g. inclusionai/ring-*) legitimately return empty
// `text` / `message.content` when their reasoning budget exhausts maxTokens
// before any visible content is emitted — that's a model-tuning concern,
// not a Ultrascripts transport or AI-module bug.
function faiValidChat(r) {
  return !!(
    r && r.provider === 'openrouter' &&
    typeof r.model === 'string' && r.model.length > 0 &&
    typeof r.text === 'string' &&
    r.message && r.message.role === 'assistant' &&
    typeof r.message.content === 'string'
  );
}

function faiParseJsonText(r) {
  if (!r || typeof r.text !== 'string' || !r.text.trim()) return null;
  try { return JSON.parse(r.text); } catch (e) { return null; }
}

function faiValidJsonObjectChat(r) {
  return faiValidChat(r) && !!faiParseJsonText(r);
}

function faiValidJsonSchemaChat(r) {
  var parsed = faiParseJsonText(r);
  return faiValidChat(r) && !!parsed && parsed.status === 'online';
}

// Look at recent history + the current output to detect command tokens.
// Lets the user type things like "[[ai-test:reset]]" to manually reset.
function faiTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function faiRecentSources(outputText) {
  var src = [{ id: 'output:' + state.ultrascriptsAiTest.turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function faiConsumeCommand(kind, outputText, needles) {
  var s = state.ultrascriptsAiTest;
  var sources = faiRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!faiTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = faiNow();
    return true;
  }
  return false;
}

function faiResetSuite() {
  state.ultrascriptsAiTest = {
    runId: 'ultrascripts-ai-' + faiNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, replayResets: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  faiWriteCard('ultrascripts:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Ultrascripts');
  faiWriteTrace();
}

// ---------- driver ----------
//
// Runs the steps strictly in order: each step waits for the previous one to
// terminate before queueing the next request. This keeps response correlation
// trivial and makes failures obvious in the trace.

function faiCurrentStepIndex() {
  var s = state.ultrascriptsAiTest;
  for (var i = 0; i < FAI_STEPS.length; i++) {
    var step = FAI_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;                          // not yet queued
    if (!s.completed[rid]) return i;             // queued, awaiting response
  }
  return FAI_STEPS.length;
}

// If a step terminated with `unsafe_replay_blocked`, the user reloaded the
// page mid-flight and the dispatcher correctly refused to replay an unsafe
// op. That's a transient environmental failure, not a contract violation —
// recover by clearing the step's bookkeeping so it re-queues under a fresh
// request id on the next advance. Capped to avoid infinite loops if a real
// bug ever produces this code repeatedly.
var FAI_MAX_REPLAY_RESETS = 2;

function faiRecoverReplayBlocked() {
  var s = state.ultrascriptsAiTest;
  for (var i = 0; i < FAI_STEPS.length; i++) {
    var label = FAI_STEPS[i].label;
    var rid = s.steps[label];
    if (!rid) continue;
    var done = s.completed[rid];
    if (!done || done.status !== 'err') continue;
    if (!done.error || done.error.code !== 'unsafe_replay_blocked') continue;

    var attempts = Number(s.replayResets[label] || 0);
    if (attempts >= FAI_MAX_REPLAY_RESETS) continue;

    delete s.completed[rid];
    delete s.steps[label];
    s.replayResets[label] = attempts + 1;
    faiLog('replay-recover', label + ' re-queue after unsafe_replay_blocked (attempt ' + (attempts + 1) + ')');
  }
}

function faiAdvance() {
  var s = state.ultrascriptsAiTest;

  // Heartbeat gate: AI module must advertise all three real ops.
  if (!faiHasOp('ai', 'chat') || !faiHasOp('ai', 'models') || !faiHasOp('ai', 'testConnection')) {
    s.phase = 'waiting for ai heartbeat';
    return;
  }

  faiRecoverReplayBlocked();

  var idx = faiCurrentStepIndex();
  if (idx >= FAI_STEPS.length) {
    s.phase = faiAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FAI_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    faiQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function faiStepResult(step) {
  var s = state.ultrascriptsAiTest;
  var rid = s.steps[step.label];
  if (!rid) return { state: 'pending' };
  var done = s.completed[rid];
  if (!done) return { state: 'inflight', requestId: rid };

  var pass = false, reason = '';
  if (step.expect === 'ok') {
    pass = done.status === 'ok' && (typeof step.validate !== 'function' || !!step.validate(done.data));
    if (!pass) reason = done.status !== 'ok' ? ('status=' + done.status) : 'validate failed';
  } else if (step.expect === 'err') {
    pass = done.status === 'err' && done.error && done.error.code === step.errorCode;
    if (!pass) {
      reason = done.status !== 'err'
        ? ('status=' + done.status)
        : ('code=' + (done.error && done.error.code));
    }
  }

  var out = {
    state: 'done', requestId: rid, status: done.status,
    error: done.error || null, pass: pass, reason: reason,
    expect: step.expect, expectedCode: step.errorCode || null,
    module: done.module
  };

  // Surface a small chat preview when a chat call returns ok so the trace
  // immediately shows which model answered and what it actually said. This
  // makes "validate failed" diagnosable without re-instrumenting.
  if (step.op === 'chat' && done.status === 'ok' && done.data) {
    var text = typeof done.data.text === 'string' ? done.data.text : '';
    out.preview = {
      model: done.data.model || null,
      textLength: text.length,
      textSample: text.length > 200 ? text.slice(0, 200) + '...' : text,
      finishReason: done.data.finishReason || null
    };
  }

  return out;
}

function faiAllChecksPass() {
  for (var i = 0; i < FAI_STEPS.length; i++) {
    var r = faiStepResult(FAI_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function faiWriteTrace() {
  var s = state.ultrascriptsAiTest;
  var results = {};
  var counts = { total: FAI_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FAI_STEPS.length; i++) {
    var step = FAI_STEPS[i];
    var r = faiStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = faiHeartbeat();
  var trace = {
    v: 1,
    runId: faiRunId(),
    turn: s.turn,
    liveKey: faiLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.ultrascripts && hb.ultrascripts.protocol,
      aiAdvertised: faiHasOp('ai', 'chat') && faiHasOp('ai', 'models') && faiHasOp('ai', 'testConnection')
    },
    testModel: faiTestModel() || '(BetterDungeon default)',
    pickedChatModel: faiPickChatModel() || null,
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    replayResets: s.replayResets || {},
    events: s.events
  };
  faiWriteCard('ultrascripts:test:ai', JSON.stringify(trace, null, 2), 'Ultrascripts Test');
}

// ---------- public entry point ----------

function ultrascriptsAiTestStep(outputText) {
  var s = state.ultrascriptsAiTest;
  faiRunId();
  s.turn += 1;

  if (faiConsumeCommand('reset', outputText, ['ai test reset', 'ultrascripts ai reset', '[[ai-test:reset]]'])) {
    faiResetSuite();
    return true;
  }

  faiPollResponses();
  faiAdvance();
  faiWriteTrace();
  return true;
}
