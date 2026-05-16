// Frontier Geolocation Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Frontier Geolocation module through its public ops
// and error paths. Pair with output-modifier.js.
//
// Surfaces written:
//   frontier:out                  - request envelope queue (script -> BD)
//   frontier:in:geolocation       - response envelope (BD -> script)
//   frontier:test:geolocation     - human-readable trace card with results
//
// Note: The geolocation module depends on browser geolocation APIs and user
// permission. The `getCurrent` op may return a permission error if the user
// has not granted location access — that is expected behavior. The suite
// validates the response shape regardless of whether permission was granted.

// ---------- state ----------

state.frontierGeoTest = state.frontierGeoTest || {
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

var FGEO_STEPS = [
  {
    label: 'permission',
    module: 'geolocation',
    op: 'permission',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.state !== 'string') return false;
      var validStates = ['granted', 'denied', 'prompt', 'unavailable'];
      if (validStates.indexOf(r.state) === -1) return false;
      if (typeof r.checkedAt !== 'number' || typeof r.checkedAtIso !== 'string') return false;
      return true;
    }
  },
  {
    label: 'getCurrent',
    module: 'geolocation',
    op: 'getCurrent',
    args: function () { return { timeoutMs: 15000 }; },
    // This step accepts both ok and err because the user may not have granted
    // permission. We validate the shape of whichever response we get.
    expect: 'ok-or-err',
    validate: function (r) {
      // ok shape: position with latitude, longitude, accuracy, timestamp
      if (r && typeof r.latitude === 'number' && typeof r.longitude === 'number') {
        return typeof r.accuracy === 'number' && typeof r.timestamp === 'number';
      }
      return false;
    },
    validateErr: function (err) {
      if (!err || typeof err.code !== 'string') return false;
      // Known error codes from the module
      var validCodes = ['permission_denied', 'position_unavailable', 'timeout', 'geolocation_unavailable', 'invalid_args'];
      return validCodes.indexOf(err.code) !== -1;
    }
  },
  {
    label: 'getCurrent-high-accuracy',
    module: 'geolocation',
    op: 'getCurrent',
    args: function () { return { enableHighAccuracy: true, timeoutMs: 20000 }; },
    expect: 'ok-or-err',
    validate: function (r) {
      if (r && typeof r.latitude === 'number' && typeof r.longitude === 'number') {
        return typeof r.accuracy === 'number';
      }
      return false;
    },
    validateErr: function (err) {
      if (!err || typeof err.code !== 'string') return false;
      var validCodes = ['permission_denied', 'position_unavailable', 'timeout', 'geolocation_unavailable', 'invalid_args'];
      return validCodes.indexOf(err.code) !== -1;
    }
  },
  {
    label: 'err-unknown-op',
    module: 'geolocation',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  },
  {
    label: 'err-unknown-module',
    module: 'definitelyNotAModule',
    op: 'permission',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

// ---------- helpers ----------

function fgeoNow() { return Date.now ? Date.now() : new Date().getTime(); }

function fgeoState() { return state.frontierGeoTest; }

function fgeoRunId() {
  var s = fgeoState();
  if (!s.runId) s.runId = 'frontier-geo-' + fgeoNow().toString(36);
  return s.runId;
}

function fgeoCards() { return Array.isArray(storyCards) ? storyCards : []; }

function fgeoFindCard(title) {
  var cards = fgeoCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function fgeoCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function fgeoReadJson(title) {
  var f = fgeoFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(fgeoCardText(f.card) || '{}'); } catch (e) { return null; }
}

function fgeoWriteCard(title, value, type) {
  var f = fgeoFindCard(title);
  var cardType = type || 'Frontier';
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

function fgeoLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function fgeoLog(event, detail) {
  var s = fgeoState();
  s.events.push({ at: fgeoNow(), turn: s.turn, liveKey: fgeoLiveKey(), event: event, detail: detail || '' });
  while (s.events.length > 60) s.events.shift();
}

function fgeoHeartbeat() { return fgeoReadJson('frontier:heartbeat'); }

function fgeoHasOp(moduleId, opName) {
  var hb = fgeoHeartbeat();
  if (!hb || !hb.frontier || hb.frontier.protocol !== 1) return false;
  var mods = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    if (!m || m.id !== moduleId) continue;
    var ops = Array.isArray(m.ops) ? m.ops : [];
    return ops.indexOf(opName) !== -1;
  }
  return false;
}

function fgeoPendingArray() {
  var s = fgeoState(), out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function fgeoWriteOut() {
  var s = fgeoState();
  var payload = {
    v: 1,
    requests: fgeoPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: fgeoNow()
  };
  s._acks = [];
  fgeoWriteCard('frontier:out', JSON.stringify(payload), 'Frontier');
}

function fgeoQueueAck(requestId, reason) {
  var s = fgeoState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  fgeoLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function fgeoQueueRequest(label, moduleId, opName, args) {
  var s = fgeoState();
  var id = fgeoLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: fgeoNow()
  };
  s.steps[label] = id;
  fgeoLog('queued', id + ' -> ' + moduleId + '.' + opName);
  fgeoWriteOut();
  return id;
}

function fgeoIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function fgeoPollResponses() {
  var s = fgeoState();
  var seen = {};
  var modules = [];
  for (var i = 0; i < FGEO_STEPS.length; i++) {
    var name = FGEO_STEPS[i].module;
    if (name && !seen[name]) { seen[name] = true; modules.push(name); }
  }
  var found = false;
  for (var m = 0; m < modules.length; m++) {
    var card = fgeoReadJson('frontier:in:' + modules[m]);
    if (!card || !card.responses) continue;
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!fgeoIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: modules[m], seenAt: fgeoNow()
        };
        fgeoLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = fgeoQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) fgeoWriteOut();
}

// ---------- driver ----------

function fgeoCurrentStepIndex() {
  var s = fgeoState();
  for (var i = 0; i < FGEO_STEPS.length; i++) {
    var step = FGEO_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FGEO_STEPS.length;
}

function fgeoAdvance() {
  var s = fgeoState();

  if (!fgeoHasOp('geolocation', 'permission') || !fgeoHasOp('geolocation', 'getCurrent')) {
    s.phase = 'waiting for geolocation heartbeat';
    return;
  }

  var idx = fgeoCurrentStepIndex();
  if (idx >= FGEO_STEPS.length) {
    s.phase = fgeoAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FGEO_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    fgeoQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function fgeoStepResult(step) {
  var s = fgeoState();
  var rid = s.steps[step.label];
  if (!rid) return { state: 'pending' };
  var done = s.completed[rid];
  if (!done) return { state: 'inflight', requestId: rid };

  var pass = false, reason = '';

  if (step.expect === 'ok-or-err') {
    // Accept both ok and err as long as the shape is valid
    if (done.status === 'ok') {
      pass = typeof step.validate === 'function' && !!step.validate(done.data);
      if (!pass) reason = 'validate failed (ok path)';
    } else if (done.status === 'err') {
      pass = typeof step.validateErr === 'function' && !!step.validateErr(done.error);
      if (!pass) reason = 'validateErr failed: code=' + (done.error && done.error.code);
    } else {
      reason = 'status=' + done.status;
    }
  } else if (step.expect === 'ok') {
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
      state: done.data.state || null,
      latitude: done.data.latitude || null,
      longitude: done.data.longitude || null,
      accuracy: done.data.accuracy || null
    };
  }

  return out;
}

function fgeoAllChecksPass() {
  for (var i = 0; i < FGEO_STEPS.length; i++) {
    var r = fgeoStepResult(FGEO_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function fgeoWriteTrace() {
  var s = fgeoState();
  var results = {};
  var counts = { total: FGEO_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FGEO_STEPS.length; i++) {
    var step = FGEO_STEPS[i];
    var r = fgeoStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = fgeoHeartbeat();
  var trace = {
    v: 1,
    runId: fgeoRunId(),
    turn: s.turn,
    liveKey: fgeoLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.frontier && hb.frontier.protocol,
      geolocationAdvertised: fgeoHasOp('geolocation', 'permission') && fgeoHasOp('geolocation', 'getCurrent')
    },
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  fgeoWriteCard('frontier:test:geolocation', JSON.stringify(trace, null, 2), 'Frontier Test');
}

// ---------- reset / commands ----------

function fgeoTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function fgeoRecentSources(outputText) {
  var src = [{ id: 'output:' + fgeoState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function fgeoConsumeCommand(kind, outputText, needles) {
  var s = fgeoState();
  var sources = fgeoRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!fgeoTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = fgeoNow();
    return true;
  }
  return false;
}

function fgeoResetSuite() {
  state.frontierGeoTest = {
    runId: 'frontier-geo-' + fgeoNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  fgeoWriteCard('frontier:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Frontier');
  fgeoWriteTrace();
}

// ---------- public entry point ----------

function frontierGeoTestStep(outputText) {
  var s = fgeoState();
  fgeoRunId();
  s.turn += 1;

  if (fgeoConsumeCommand('reset', outputText, ['geo test reset', 'frontier geo reset', '[[geo-test:reset]]'])) {
    fgeoResetSuite();
    return true;
  }

  fgeoPollResponses();
  fgeoAdvance();
  fgeoWriteTrace();
  return true;
}
