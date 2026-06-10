// Ultrascripts AI Module Test Suite - AI Dungeon Library
//
// Drives the native BetterDungeon Ultrascripts AI module through its public
// query/status API. Pair with output-modifier.js.
//
// Surfaces written:
//   ultrascripts:out      - request envelope queue (script -> BD)
//   ultrascripts:in:ai    - response envelope (BD -> script)
//   ultrascripts:test:ai  - human-readable trace card with results
//
// Before running:
//   1. Open BetterDungeon -> Ultrascripts and enable Ultrascripts + the AI module.
//   2. Open an AI Dungeon adventure and take one normal turn so GraphQL
//      credentials and Story Cards hydrate.

state.ultrascriptsAiTest = state.ultrascriptsAiTest || {
  runId: null,
  turn: 0,
  seq: 0,
  outSeq: 0,
  pending: {},
  completed: {},
  acked: {},
  ackAttempts: {},
  steps: {},
  replayResets: {},
  events: [],
  consumedCommands: {},
  phase: 'boot'
};

var FAI_BACKEND = 'aid-story-card-generator';

var FAI_STEPS = [
  {
    label: 'status',
    module: 'ai',
    op: 'status',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      return !!(
        r &&
        r.backend === FAI_BACKEND &&
        typeof r.ready === 'boolean' &&
        r.hasGraphqlCredentials === true &&
        typeof r.adventureShortId === 'string' &&
        r.adventureShortId.length > 0
      );
    }
  },
  {
    label: 'query-plain',
    module: 'ai',
    op: 'query',
    args: function () {
      return {
        systemPrompt: 'Answer as a concise BetterDungeon transport health check. Return one short sentence only.',
        prompt: 'Reply with one short sentence saying the Ultrascripts AI module is online.',
        context: 'This is a BetterDungeon native query transport test.',
        temperature: 0,
        timeoutMs: 120000
      };
    },
    expect: 'ok',
    validate: faiValidQuery
  },
  {
    label: 'query-xml',
    module: 'ai',
    op: 'query',
    args: function () {
      return {
        prompt: 'Return exactly this XML and nothing else: <result><status>online</status></result>',
        context: { test: 'ultrascripts-ai-xml' },
        includeStorySummary: false,
        temperature: 0,
        timeoutMs: 120000
      };
    },
    expect: 'ok',
    validate: faiValidXmlQuery
  },
  {
    label: 'err-empty-prompt',
    module: 'ai',
    op: 'query',
    args: function () { return { prompt: '' }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-oversized-prompt',
    module: 'ai',
    op: 'query',
    args: function () { return { prompt: faiRepeat('x', 6001) }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-bad-temperature',
    module: 'ai',
    op: 'query',
    args: function () {
      return {
        prompt: 'hi',
        temperature: 99
      };
    },
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
    op: 'query',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

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
    at: faiNow(),
    turn: s.turn,
    liveKey: faiLiveKey(),
    event: event,
    detail: detail || ''
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
  var s = state.ultrascriptsAiTest;
  var out = [];
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
    id: id,
    module: moduleId,
    op: opName,
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
  var modules = ['ai', 'definitelyNotAModule'];
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
          status: r.status,
          data: r.data || null,
          error: r.error || null,
          module: modules[m],
          seenAt: faiNow()
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

function faiValidQuery(r) {
  return !!(
    r &&
    r.backend === FAI_BACKEND &&
    typeof r.text === 'string' &&
    r.text.length > 0 &&
    typeof r.generatedAtIso === 'string' &&
    typeof r.shellCardId === 'string' &&
    typeof r.systemPromptChars === 'number' &&
    typeof r.promptChars === 'number' &&
    typeof r.contextChars === 'number'
  );
}

function faiValidXmlQuery(r) {
  var text = String((r && r.text) || '').trim().toLowerCase();
  return faiValidQuery(r) &&
    text.indexOf('<status>online</status>') !== -1 &&
    text.indexOf('<result') !== -1 &&
    text.indexOf('</result>') !== -1;
}

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
    turn: 0,
    seq: 0,
    outSeq: 0,
    pending: {},
    completed: {},
    acked: {},
    ackAttempts: {},
    steps: {},
    replayResets: {},
    events: [],
    consumedCommands: {},
    phase: 'reset'
  };
  faiWriteCard('ultrascripts:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Ultrascripts');
  faiWriteTrace();
}

function faiCurrentStepIndex() {
  var s = state.ultrascriptsAiTest;
  for (var i = 0; i < FAI_STEPS.length; i++) {
    var step = FAI_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FAI_STEPS.length;
}

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

  if (!faiHasOp('ai', 'query') || !faiHasOp('ai', 'status')) {
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

  var pass = false;
  var reason = '';
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
    state: 'done',
    requestId: rid,
    status: done.status,
    error: done.error || null,
    pass: pass,
    reason: reason,
    expect: step.expect,
    expectedCode: step.errorCode || null,
    module: done.module
  };

  if (step.op === 'query' && done.status === 'ok' && done.data) {
    var text = typeof done.data.text === 'string' ? done.data.text : '';
    out.preview = {
      backend: done.data.backend || null,
      textLength: text.length,
      textSample: text.length > 200 ? text.slice(0, 200) + '...' : text,
      shellCardId: done.data.shellCardId || null
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
      aiAdvertised: faiHasOp('ai', 'query') && faiHasOp('ai', 'status')
    },
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
