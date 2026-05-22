// Ultrascripts Network Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Ultrascripts Network module through its public op and
// error paths. Pair with output-modifier.js.
//
// Surfaces written:
//   ultrascripts:out                  - request envelope queue (script -> BD)
//   ultrascripts:in:network           - response envelope (BD -> script)
//   ultrascripts:test:network         - human-readable trace card with results

// ---------- state ----------

state.ultrascriptsNetworkTest = state.ultrascriptsNetworkTest || {
  runId: null,
  turn: 0,
  seq: 0,
  outSeq: 0,
  pending: {},
  completed: {},
  acked: {},
  ackAttempts: {},
  steps: {},
  events: [],
  consumedCommands: {},
  phase: 'boot'
};

// ---------- test plan ----------

var FNET_STEPS = [
  {
    label: 'status',
    module: 'network',
    op: 'status',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.online !== 'boolean') return false;
      var validQualities = ['offline', 'constrained', 'limited', 'good', 'unknown'];
      if (typeof r.quality !== 'string' || validQualities.indexOf(r.quality) === -1) return false;
      if (typeof r.checkedAt !== 'number' || typeof r.checkedAtIso !== 'string') return false;
      return true;
    }
  },
  {
    label: 'status-online-check',
    module: 'network',
    op: 'status',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      // Running in AI Dungeon means we must be online
      return !!(r && r.online === true);
    }
  },
  {
    label: 'status-connection-detail',
    module: 'network',
    op: 'status',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !r.connection || typeof r.connection !== 'object') return false;
      // Connection object should exist with type/downlink/rtt/effectiveType fields (or nulls)
      return true;
    }
  },
  {
    label: 'err-unknown-op',
    module: 'network',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  },
  {
    label: 'err-unknown-module',
    module: 'definitelyNotAModule',
    op: 'status',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

// ---------- helpers ----------

function fnetNow() { return Date.now ? Date.now() : new Date().getTime(); }

function fnetState() { return state.ultrascriptsNetworkTest; }

function fnetRunId() {
  var s = fnetState();
  if (!s.runId) s.runId = 'ultrascripts-network-' + fnetNow().toString(36);
  return s.runId;
}

function fnetCards() { return Array.isArray(storyCards) ? storyCards : []; }

function fnetFindCard(title) {
  var cards = fnetCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function fnetCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function fnetReadJson(title) {
  var f = fnetFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(fnetCardText(f.card) || '{}'); } catch (e) { return null; }
}

function fnetWriteCard(title, value, type) {
  var f = fnetFindCard(title);
  var cardType = type || 'Ultrascripts';
  if (f.card && f.index >= 0 && typeof updateStoryCard === 'function') {
    updateStoryCard(f.index, f.card.keys || f.card.key || title, value, f.card.type || cardType);
    return true;
  }
  if (typeof addStoryCard === 'function') {
    addStoryCard(title, value, cardType);
    return true;
  }
  return false;
}

function fnetLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function fnetLog(event, detail) {
  var s = fnetState();
  s.events.push({ at: fnetNow(), turn: s.turn, liveKey: fnetLiveKey(), event: event, detail: detail || '' });
  while (s.events.length > 60) s.events.shift();
}

function fnetHeartbeat() { return fnetReadJson('ultrascripts:heartbeat'); }

function fnetHasOp(moduleId, opName) {
  var hb = fnetHeartbeat();
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

function fnetPendingArray() {
  var s = fnetState(), out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function fnetWriteOut() {
  var s = fnetState();
  var payload = {
    v: 1,
    requests: fnetPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: fnetNow()
  };
  s._acks = [];
  fnetWriteCard('ultrascripts:out', JSON.stringify(payload), 'Ultrascripts');
}

function fnetQueueAck(requestId, reason) {
  var s = fnetState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  fnetLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function fnetQueueRequest(label, moduleId, opName, args) {
  var s = fnetState();
  var id = fnetLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: fnetNow()
  };
  s.steps[label] = id;
  fnetLog('queued', id + ' -> ' + moduleId + '.' + opName);
  fnetWriteOut();
  return id;
}

function fnetIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function fnetPollResponses() {
  var s = fnetState();
  var seen = {};
  var modules = [];
  for (var i = 0; i < FNET_STEPS.length; i++) {
    var name = FNET_STEPS[i].module;
    if (name && !seen[name]) { seen[name] = true; modules.push(name); }
  }
  var found = false;
  for (var m = 0; m < modules.length; m++) {
    var card = fnetReadJson('ultrascripts:in:' + modules[m]);
    if (!card || !card.responses) continue;
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!fnetIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: modules[m], seenAt: fnetNow()
        };
        fnetLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = fnetQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) fnetWriteOut();
}

// ---------- driver ----------

function fnetCurrentStepIndex() {
  var s = fnetState();
  for (var i = 0; i < FNET_STEPS.length; i++) {
    var step = FNET_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FNET_STEPS.length;
}

function fnetAdvance() {
  var s = fnetState();

  if (!fnetHasOp('network', 'status')) {
    s.phase = 'waiting for network heartbeat';
    return;
  }

  var idx = fnetCurrentStepIndex();
  if (idx >= FNET_STEPS.length) {
    s.phase = fnetAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FNET_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    fnetQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function fnetStepResult(step) {
  var s = fnetState();
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

  if (done.status === 'ok' && done.data) {
    out.preview = {
      online: done.data.online,
      quality: done.data.quality || null,
      effectiveType: done.data.connection ? done.data.connection.effectiveType : null
    };
  }

  return out;
}

function fnetAllChecksPass() {
  for (var i = 0; i < FNET_STEPS.length; i++) {
    var r = fnetStepResult(FNET_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function fnetWriteTrace() {
  var s = fnetState();
  var results = {};
  var counts = { total: FNET_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FNET_STEPS.length; i++) {
    var step = FNET_STEPS[i];
    var r = fnetStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = fnetHeartbeat();
  var trace = {
    v: 1,
    runId: fnetRunId(),
    turn: s.turn,
    liveKey: fnetLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.ultrascripts && hb.ultrascripts.protocol,
      networkAdvertised: fnetHasOp('network', 'status')
    },
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  fnetWriteCard('ultrascripts:test:network', JSON.stringify(trace, null, 2), 'Ultrascripts Test');
}

// ---------- reset / commands ----------

function fnetTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function fnetRecentSources(outputText) {
  var src = [{ id: 'output:' + fnetState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function fnetConsumeCommand(kind, outputText, needles) {
  var s = fnetState();
  var sources = fnetRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!fnetTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = fnetNow();
    return true;
  }
  return false;
}

function fnetResetSuite() {
  state.ultrascriptsNetworkTest = {
    runId: 'ultrascripts-network-' + fnetNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  fnetWriteCard('ultrascripts:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Ultrascripts');
  fnetWriteTrace();
}

// ---------- public entry point ----------

function ultrascriptsNetworkTestStep(outputText) {
  var s = fnetState();
  fnetRunId();
  s.turn += 1;

  if (fnetConsumeCommand('reset', outputText, ['network test reset', 'ultrascripts network reset', '[[network-test:reset]]'])) {
    fnetResetSuite();
    return true;
  }

  fnetPollResponses();
  fnetAdvance();
  fnetWriteTrace();
  return true;
}
