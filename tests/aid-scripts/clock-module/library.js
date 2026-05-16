// Frontier Clock Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Frontier Clock module through every public op and a
// representative set of error paths. Pair with output-modifier.js.
//
// Surfaces written:
//   frontier:out                  - request envelope queue (script -> BD)
//   frontier:in:clock             - response envelope (BD -> script)
//   frontier:test:clock           - human-readable trace card with results

// ---------- state ----------

state.frontierClockTest = state.frontierClockTest || {
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

var FCLK_STEPS = [
  {
    label: 'now-default',
    module: 'clock',
    op: 'now',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && typeof r.iso === 'string' && r.iso.length > 0 &&
        typeof r.epoch === 'number' && r.epoch > 0 &&
        typeof r.timezone === 'string');
    }
  },
  {
    label: 'now-with-tz',
    module: 'clock',
    op: 'now',
    args: function () { return { timezone: 'America/New_York' }; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && typeof r.iso === 'string' && r.timezone === 'America/New_York');
    }
  },
  {
    label: 'tz-list',
    module: 'clock',
    op: 'tz',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && Array.isArray(r.timezones) && r.timezones.length > 0 &&
        r.timezones.indexOf('UTC') !== -1);
    }
  },
  {
    label: 'format-default',
    module: 'clock',
    op: 'format',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && typeof r.formatted === 'string' && r.formatted.length > 0 &&
        typeof r.pattern === 'string');
    }
  },
  {
    label: 'format-custom-pattern',
    module: 'clock',
    op: 'format',
    args: function () { return { pattern: 'YYYY-MM-DD HH:mm:ss' }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.formatted !== 'string') return false;
      // Should match pattern like 2025-01-15 14:30:00
      return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.formatted);
    }
  },
  {
    label: 'format-with-tz',
    module: 'clock',
    op: 'format',
    args: function () { return { pattern: 'HH:mm', timezone: 'Europe/London' }; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.formatted !== 'string') return false;
      return /^\d{2}:\d{2}$/.test(r.formatted);
    }
  },
  {
    label: 'err-bad-timezone',
    module: 'clock',
    op: 'now',
    args: function () { return { timezone: 'Not/A/Timezone' }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-bad-format-tz',
    module: 'clock',
    op: 'format',
    args: function () { return { timezone: 'Fake/Zone', pattern: 'YYYY' }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-unknown-op',
    module: 'clock',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  },
  {
    label: 'err-unknown-module',
    module: 'definitelyNotAModule',
    op: 'now',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

// ---------- helpers ----------

function fclkNow() { return Date.now ? Date.now() : new Date().getTime(); }

function fclkState() { return state.frontierClockTest; }

function fclkRunId() {
  var s = fclkState();
  if (!s.runId) s.runId = 'frontier-clock-' + fclkNow().toString(36);
  return s.runId;
}

function fclkCards() { return Array.isArray(storyCards) ? storyCards : []; }

function fclkFindCard(title) {
  var cards = fclkCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function fclkCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function fclkReadJson(title) {
  var f = fclkFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(fclkCardText(f.card) || '{}'); } catch (e) { return null; }
}

function fclkWriteCard(title, value, type) {
  var f = fclkFindCard(title);
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

function fclkLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function fclkLog(event, detail) {
  var s = fclkState();
  s.events.push({ at: fclkNow(), turn: s.turn, liveKey: fclkLiveKey(), event: event, detail: detail || '' });
  while (s.events.length > 60) s.events.shift();
}

function fclkHeartbeat() { return fclkReadJson('frontier:heartbeat'); }

function fclkHasOp(moduleId, opName) {
  var hb = fclkHeartbeat();
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

function fclkPendingArray() {
  var s = fclkState(), out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function fclkWriteOut() {
  var s = fclkState();
  var payload = {
    v: 1,
    requests: fclkPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: fclkNow()
  };
  s._acks = [];
  fclkWriteCard('frontier:out', JSON.stringify(payload), 'Frontier');
}

function fclkQueueAck(requestId, reason) {
  var s = fclkState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  fclkLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function fclkQueueRequest(label, moduleId, opName, args) {
  var s = fclkState();
  var id = fclkLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: fclkNow()
  };
  s.steps[label] = id;
  fclkLog('queued', id + ' -> ' + moduleId + '.' + opName);
  fclkWriteOut();
  return id;
}

function fclkIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function fclkPollResponses() {
  var s = fclkState();
  var seen = {};
  var modules = [];
  for (var i = 0; i < FCLK_STEPS.length; i++) {
    var name = FCLK_STEPS[i].module;
    if (name && !seen[name]) { seen[name] = true; modules.push(name); }
  }
  var found = false;
  for (var m = 0; m < modules.length; m++) {
    var card = fclkReadJson('frontier:in:' + modules[m]);
    if (!card || !card.responses) continue;
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!fclkIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: modules[m], seenAt: fclkNow()
        };
        fclkLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = fclkQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) fclkWriteOut();
}

// ---------- driver ----------

function fclkCurrentStepIndex() {
  var s = fclkState();
  for (var i = 0; i < FCLK_STEPS.length; i++) {
    var step = FCLK_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FCLK_STEPS.length;
}

function fclkAdvance() {
  var s = fclkState();

  if (!fclkHasOp('clock', 'now') || !fclkHasOp('clock', 'tz') || !fclkHasOp('clock', 'format')) {
    s.phase = 'waiting for clock heartbeat';
    return;
  }

  var idx = fclkCurrentStepIndex();
  if (idx >= FCLK_STEPS.length) {
    s.phase = fclkAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FCLK_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    fclkQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function fclkStepResult(step) {
  var s = fclkState();
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
    out.preview = {};
    if (done.data.iso) out.preview.iso = done.data.iso;
    if (done.data.formatted) out.preview.formatted = done.data.formatted;
    if (done.data.timezone) out.preview.timezone = done.data.timezone;
    if (Array.isArray(done.data.timezones)) out.preview.timezoneCount = done.data.timezones.length;
  }

  return out;
}

function fclkAllChecksPass() {
  for (var i = 0; i < FCLK_STEPS.length; i++) {
    var r = fclkStepResult(FCLK_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function fclkWriteTrace() {
  var s = fclkState();
  var results = {};
  var counts = { total: FCLK_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FCLK_STEPS.length; i++) {
    var step = FCLK_STEPS[i];
    var r = fclkStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = fclkHeartbeat();
  var trace = {
    v: 1,
    runId: fclkRunId(),
    turn: s.turn,
    liveKey: fclkLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.frontier && hb.frontier.protocol,
      clockAdvertised: fclkHasOp('clock', 'now') && fclkHasOp('clock', 'tz') && fclkHasOp('clock', 'format')
    },
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  fclkWriteCard('frontier:test:clock', JSON.stringify(trace, null, 2), 'Frontier Test');
}

// ---------- reset / commands ----------

function fclkTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function fclkRecentSources(outputText) {
  var src = [{ id: 'output:' + fclkState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function fclkConsumeCommand(kind, outputText, needles) {
  var s = fclkState();
  var sources = fclkRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!fclkTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = fclkNow();
    return true;
  }
  return false;
}

function fclkResetSuite() {
  state.frontierClockTest = {
    runId: 'frontier-clock-' + fclkNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  fclkWriteCard('frontier:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Frontier');
  fclkWriteTrace();
}

// ---------- public entry point ----------

function frontierClockTestStep(outputText) {
  var s = fclkState();
  fclkRunId();
  s.turn += 1;

  if (fclkConsumeCommand('reset', outputText, ['clock test reset', 'frontier clock reset', '[[clock-test:reset]]'])) {
    fclkResetSuite();
    return true;
  }

  fclkPollResponses();
  fclkAdvance();
  fclkWriteTrace();
  return true;
}
