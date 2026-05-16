// Frontier Weather Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Frontier Weather module through every public op and
// a representative set of error paths. Pair with output-modifier.js.
//
// Surfaces written:
//   frontier:out                  - request envelope queue (script -> BD)
//   frontier:in:weather           - response envelope (BD -> script)
//   frontier:test:weather         - human-readable trace card with results
//
// Note: The weather module calls the Open-Meteo API. These tests exercise real
// network calls, so they require an internet connection. Some steps may time
// out if the API is slow or rate-limiting.

// ---------- state ----------

state.frontierWeatherTest = state.frontierWeatherTest || {
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

var FWEA_STEPS = [
  {
    label: 'current-coords',
    module: 'weather',
    op: 'current',
    args: function () { return { lat: 40.7128, lon: -74.006 }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.temperature !== 'number') return false;
      if (typeof r.units !== 'object' || !r.units) return false;
      if (typeof r.location !== 'object' || !r.location) return false;
      if (typeof r.checkedAt !== 'number') return false;
      return true;
    }
  },
  {
    label: 'current-place',
    module: 'weather',
    op: 'current',
    args: function () { return { place: 'London' }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.temperature !== 'number') return false;
      if (!r.location || typeof r.location.name !== 'string') return false;
      return true;
    }
  },
  {
    label: 'current-units-imperial',
    module: 'weather',
    op: 'current',
    args: function () { return { lat: 48.8566, lon: 2.3522, units: 'imperial' }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.temperature !== 'number') return false;
      if (!r.units || r.units.temperature !== 'fahrenheit') return false;
      return true;
    }
  },
  {
    label: 'forecast-coords',
    module: 'weather',
    op: 'forecast',
    args: function () { return { lat: 35.6762, lon: 139.6503, days: 3 }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !Array.isArray(r.days)) return false;
      if (r.days.length < 1) return false;
      var day = r.days[0];
      if (!day || typeof day.temperatureMax !== 'number') return false;
      if (!day.date || typeof day.date !== 'string') return false;
      return true;
    }
  },
  {
    label: 'forecast-place',
    module: 'weather',
    op: 'forecast',
    args: function () { return { place: 'Tokyo', days: 5 }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !Array.isArray(r.days)) return false;
      if (r.days.length < 1) return false;
      if (!r.location || typeof r.location.name !== 'string') return false;
      return true;
    }
  },
  {
    label: 'forecast-imperial',
    module: 'weather',
    op: 'forecast',
    args: function () { return { lat: 40.7128, lon: -74.006, days: 2, units: 'imperial' }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !Array.isArray(r.days)) return false;
      if (!r.units || r.units.temperature !== 'fahrenheit') return false;
      return true;
    }
  },
  {
    label: 'err-no-location',
    module: 'weather',
    op: 'current',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-bad-place',
    module: 'weather',
    op: 'current',
    args: function () { return { place: 'xyzzy_not_a_real_place_99999' }; },
    expect: 'err',
    // Could be invalid_args or handler_threw depending on geocoding result
    validate: null,
    validateErr: function (err) {
      return !!(err && typeof err.code === 'string');
    }
  },
  {
    label: 'err-forecast-no-location',
    module: 'weather',
    op: 'forecast',
    args: function () { return { days: 3 }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-unknown-op',
    module: 'weather',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  },
  {
    label: 'err-unknown-module',
    module: 'definitelyNotAModule',
    op: 'current',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

// ---------- helpers ----------

function fweaNow() { return Date.now ? Date.now() : new Date().getTime(); }

function fweaState() { return state.frontierWeatherTest; }

function fweaRunId() {
  var s = fweaState();
  if (!s.runId) s.runId = 'frontier-weather-' + fweaNow().toString(36);
  return s.runId;
}

function fweaCards() { return Array.isArray(storyCards) ? storyCards : []; }

function fweaFindCard(title) {
  var cards = fweaCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function fweaCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function fweaReadJson(title) {
  var f = fweaFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(fweaCardText(f.card) || '{}'); } catch (e) { return null; }
}

function fweaWriteCard(title, value, type) {
  var f = fweaFindCard(title);
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

function fweaLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function fweaLog(event, detail) {
  var s = fweaState();
  s.events.push({ at: fweaNow(), turn: s.turn, liveKey: fweaLiveKey(), event: event, detail: detail || '' });
  while (s.events.length > 60) s.events.shift();
}

function fweaHeartbeat() { return fweaReadJson('frontier:heartbeat'); }

function fweaHasOp(moduleId, opName) {
  var hb = fweaHeartbeat();
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

function fweaPendingArray() {
  var s = fweaState(), out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function fweaWriteOut() {
  var s = fweaState();
  var payload = {
    v: 1,
    requests: fweaPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: fweaNow()
  };
  s._acks = [];
  fweaWriteCard('frontier:out', JSON.stringify(payload), 'Frontier');
}

function fweaQueueAck(requestId, reason) {
  var s = fweaState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  fweaLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function fweaQueueRequest(label, moduleId, opName, args) {
  var s = fweaState();
  var id = fweaLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: fweaNow()
  };
  s.steps[label] = id;
  fweaLog('queued', id + ' -> ' + moduleId + '.' + opName);
  fweaWriteOut();
  return id;
}

function fweaIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function fweaPollResponses() {
  var s = fweaState();
  var seen = {};
  var modules = [];
  for (var i = 0; i < FWEA_STEPS.length; i++) {
    var name = FWEA_STEPS[i].module;
    if (name && !seen[name]) { seen[name] = true; modules.push(name); }
  }
  var found = false;
  for (var m = 0; m < modules.length; m++) {
    var card = fweaReadJson('frontier:in:' + modules[m]);
    if (!card || !card.responses) continue;
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!fweaIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: modules[m], seenAt: fweaNow()
        };
        fweaLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = fweaQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) fweaWriteOut();
}

// ---------- driver ----------

function fweaCurrentStepIndex() {
  var s = fweaState();
  for (var i = 0; i < FWEA_STEPS.length; i++) {
    var step = FWEA_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FWEA_STEPS.length;
}

function fweaAdvance() {
  var s = fweaState();

  if (!fweaHasOp('weather', 'current') || !fweaHasOp('weather', 'forecast')) {
    s.phase = 'waiting for weather heartbeat';
    return;
  }

  var idx = fweaCurrentStepIndex();
  if (idx >= FWEA_STEPS.length) {
    s.phase = fweaAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FWEA_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    fweaQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function fweaStepResult(step) {
  var s = fweaState();
  var rid = s.steps[step.label];
  if (!rid) return { state: 'pending' };
  var done = s.completed[rid];
  if (!done) return { state: 'inflight', requestId: rid };

  var pass = false, reason = '';

  if (step.expect === 'err' && step.errorCode) {
    pass = done.status === 'err' && done.error && done.error.code === step.errorCode;
    if (!pass) {
      reason = done.status !== 'err'
        ? ('status=' + done.status)
        : ('code=' + (done.error && done.error.code));
    }
  } else if (step.expect === 'err' && typeof step.validateErr === 'function') {
    pass = done.status === 'err' && !!step.validateErr(done.error);
    if (!pass) {
      reason = done.status !== 'err'
        ? ('status=' + done.status)
        : 'validateErr failed: code=' + (done.error && done.error.code);
    }
  } else if (step.expect === 'ok') {
    pass = done.status === 'ok' && (typeof step.validate !== 'function' || !!step.validate(done.data));
    if (!pass) reason = done.status !== 'ok' ? ('status=' + done.status) : 'validate failed';
  }

  var out = {
    state: 'done', requestId: rid, status: done.status,
    error: done.error || null, pass: pass, reason: reason,
    expect: step.expect, expectedCode: step.errorCode || null,
    module: done.module
  };

  if (done.status === 'ok' && done.data) {
    out.preview = {
      temperature: done.data.temperature,
      locationName: done.data.location ? done.data.location.name : null,
      daysCount: Array.isArray(done.data.days) ? done.data.days.length : null,
      unitsTemp: done.data.units ? done.data.units.temperature : null
    };
  }

  return out;
}

function fweaAllChecksPass() {
  for (var i = 0; i < FWEA_STEPS.length; i++) {
    var r = fweaStepResult(FWEA_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function fweaWriteTrace() {
  var s = fweaState();
  var results = {};
  var counts = { total: FWEA_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FWEA_STEPS.length; i++) {
    var step = FWEA_STEPS[i];
    var r = fweaStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = fweaHeartbeat();
  var trace = {
    v: 1,
    runId: fweaRunId(),
    turn: s.turn,
    liveKey: fweaLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.frontier && hb.frontier.protocol,
      weatherAdvertised: fweaHasOp('weather', 'current') && fweaHasOp('weather', 'forecast')
    },
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  fweaWriteCard('frontier:test:weather', JSON.stringify(trace, null, 2), 'Frontier Test');
}

// ---------- reset / commands ----------

function fweaTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function fweaRecentSources(outputText) {
  var src = [{ id: 'output:' + fweaState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function fweaConsumeCommand(kind, outputText, needles) {
  var s = fweaState();
  var sources = fweaRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!fweaTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = fweaNow();
    return true;
  }
  return false;
}

function fweaResetSuite() {
  state.frontierWeatherTest = {
    runId: 'frontier-weather-' + fweaNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  fweaWriteCard('frontier:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Frontier');
  fweaWriteTrace();
}

// ---------- public entry point ----------

function frontierWeatherTestStep(outputText) {
  var s = fweaState();
  fweaRunId();
  s.turn += 1;

  if (fweaConsumeCommand('reset', outputText, ['weather test reset', 'frontier weather reset', '[[weather-test:reset]]'])) {
    fweaResetSuite();
    return true;
  }

  fweaPollResponses();
  fweaAdvance();
  fweaWriteTrace();
  return true;
}
