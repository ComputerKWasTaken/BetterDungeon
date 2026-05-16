// Frontier WebFetch Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Frontier WebFetch module through every public op and
// a representative set of error paths. Pair with output-modifier.js.
//
// Surfaces written:
//   frontier:out                  - request envelope queue (script -> BD)
//   frontier:in:webfetch          - response envelope (BD -> script)
//   frontier:test:webfetch        - human-readable trace card with results
//
// Note: The webfetch module requires user consent for each origin. If consent
// is denied, the suite validates the denial error shape. Steps that hit real
// URLs also require an internet connection.

// ---------- state ----------

state.frontierWebFetchTest = state.frontierWebFetchTest || {
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

var FWEB_STEPS = [
  {
    label: 'fetch-json',
    module: 'webfetch',
    op: 'fetch',
    args: function () { return { url: 'https://httpbin.org/json' }; },
    expect: 'ok-or-consent',
    validate: function (r) {
      if (!r) return false;
      if (typeof r.status !== 'number') return false;
      if (r.status < 100 || r.status >= 600) return false;
      if (typeof r.body !== 'string' || r.body.length === 0) return false;
      if (typeof r.url !== 'string') return false;
      return true;
    }
  },
  {
    label: 'fetch-head',
    module: 'webfetch',
    op: 'fetch',
    args: function () { return { url: 'https://httpbin.org/get', method: 'HEAD' }; },
    expect: 'ok-or-consent',
    validate: function (r) {
      if (!r) return false;
      if (typeof r.status !== 'number') return false;
      // HEAD response should have headers but minimal/no body
      if (typeof r.headers !== 'object') return false;
      return true;
    }
  },
  {
    label: 'fetch-with-headers',
    module: 'webfetch',
    op: 'fetch',
    args: function () {
      return {
        url: 'https://httpbin.org/headers',
        headers: { 'X-Test-Header': 'frontier-test' }
      };
    },
    expect: 'ok-or-consent',
    validate: function (r) {
      if (!r || typeof r.status !== 'number') return false;
      if (typeof r.body !== 'string') return false;
      return true;
    }
  },
  {
    label: 'search',
    module: 'webfetch',
    op: 'search',
    args: function () { return { query: 'AI Dungeon game' }; },
    expect: 'ok-or-consent',
    validate: function (r) {
      if (!r) return false;
      if (!Array.isArray(r.results)) return false;
      if (r.results.length > 0) {
        var first = r.results[0];
        if (!first || typeof first.title !== 'string') return false;
        if (typeof first.url !== 'string') return false;
      }
      return true;
    }
  },
  {
    label: 'err-blocked-localhost',
    module: 'webfetch',
    op: 'fetch',
    args: function () { return { url: 'http://localhost:8080/test' }; },
    expect: 'err',
    errorCode: 'scheme_blocked',
    validateErr: function (err) {
      if (!err || typeof err.code !== 'string') return false;
      // Could be scheme_blocked or handler_threw depending on validation order
      return err.code === 'scheme_blocked' || err.code === 'invalid_args';
    }
  },
  {
    label: 'err-blocked-private-ip',
    module: 'webfetch',
    op: 'fetch',
    args: function () { return { url: 'http://192.168.1.1/' }; },
    expect: 'err',
    validateErr: function (err) {
      if (!err || typeof err.code !== 'string') return false;
      return err.code === 'scheme_blocked' || err.code === 'invalid_args';
    }
  },
  {
    label: 'err-no-url',
    module: 'webfetch',
    op: 'fetch',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-bad-method',
    module: 'webfetch',
    op: 'fetch',
    args: function () { return { url: 'https://example.com', method: 'POST' }; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-no-query',
    module: 'webfetch',
    op: 'search',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'invalid_args'
  },
  {
    label: 'err-unknown-op',
    module: 'webfetch',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  },
  {
    label: 'err-unknown-module',
    module: 'definitelyNotAModule',
    op: 'fetch',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

// ---------- helpers ----------

function fwebNow() { return Date.now ? Date.now() : new Date().getTime(); }

function fwebState() { return state.frontierWebFetchTest; }

function fwebRunId() {
  var s = fwebState();
  if (!s.runId) s.runId = 'frontier-webfetch-' + fwebNow().toString(36);
  return s.runId;
}

function fwebCards() { return Array.isArray(storyCards) ? storyCards : []; }

function fwebFindCard(title) {
  var cards = fwebCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function fwebCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function fwebReadJson(title) {
  var f = fwebFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(fwebCardText(f.card) || '{}'); } catch (e) { return null; }
}

function fwebWriteCard(title, value, type) {
  var f = fwebFindCard(title);
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

function fwebLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function fwebLog(event, detail) {
  var s = fwebState();
  s.events.push({ at: fwebNow(), turn: s.turn, liveKey: fwebLiveKey(), event: event, detail: detail || '' });
  while (s.events.length > 60) s.events.shift();
}

function fwebHeartbeat() { return fwebReadJson('frontier:heartbeat'); }

function fwebHasOp(moduleId, opName) {
  var hb = fwebHeartbeat();
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

function fwebPendingArray() {
  var s = fwebState(), out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function fwebWriteOut() {
  var s = fwebState();
  var payload = {
    v: 1,
    requests: fwebPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: fwebNow()
  };
  s._acks = [];
  fwebWriteCard('frontier:out', JSON.stringify(payload), 'Frontier');
}

function fwebQueueAck(requestId, reason) {
  var s = fwebState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  fwebLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function fwebQueueRequest(label, moduleId, opName, args) {
  var s = fwebState();
  var id = fwebLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: fwebNow()
  };
  s.steps[label] = id;
  fwebLog('queued', id + ' -> ' + moduleId + '.' + opName);
  fwebWriteOut();
  return id;
}

function fwebIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function fwebPollResponses() {
  var s = fwebState();
  var seen = {};
  var modules = [];
  for (var i = 0; i < FWEB_STEPS.length; i++) {
    var name = FWEB_STEPS[i].module;
    if (name && !seen[name]) { seen[name] = true; modules.push(name); }
  }
  var found = false;
  for (var m = 0; m < modules.length; m++) {
    var card = fwebReadJson('frontier:in:' + modules[m]);
    if (!card || !card.responses) continue;
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!fwebIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: modules[m], seenAt: fwebNow()
        };
        fwebLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = fwebQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) fwebWriteOut();
}

// ---------- driver ----------

function fwebCurrentStepIndex() {
  var s = fwebState();
  for (var i = 0; i < FWEB_STEPS.length; i++) {
    var step = FWEB_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FWEB_STEPS.length;
}

function fwebAdvance() {
  var s = fwebState();

  if (!fwebHasOp('webfetch', 'fetch') || !fwebHasOp('webfetch', 'search')) {
    s.phase = 'waiting for webfetch heartbeat';
    return;
  }

  var idx = fwebCurrentStepIndex();
  if (idx >= FWEB_STEPS.length) {
    s.phase = fwebAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FWEB_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    fwebQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function fwebStepResult(step) {
  var s = fwebState();
  var rid = s.steps[step.label];
  if (!rid) return { state: 'pending' };
  var done = s.completed[rid];
  if (!done) return { state: 'inflight', requestId: rid };

  var pass = false, reason = '';

  if (step.expect === 'ok-or-consent') {
    // Steps hitting real URLs: accept ok with valid shape, or consent_denied/rate_limit errors
    if (done.status === 'ok') {
      pass = typeof step.validate === 'function' && !!step.validate(done.data);
      if (!pass) reason = 'validate failed (ok path)';
    } else if (done.status === 'err') {
      var code = done.error && done.error.code;
      // Consent denied or rate limited are acceptable non-ok outcomes
      pass = code === 'consent_denied' || code === 'rate_limit';
      if (!pass) reason = 'unexpected error: code=' + code;
    } else {
      reason = 'status=' + done.status;
    }
  } else if (step.expect === 'err' && step.errorCode) {
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
      httpStatus: done.data.status || null,
      url: done.data.url || null,
      bodyLength: typeof done.data.body === 'string' ? done.data.body.length : null,
      resultCount: Array.isArray(done.data.results) ? done.data.results.length : null
    };
  }

  return out;
}

function fwebAllChecksPass() {
  for (var i = 0; i < FWEB_STEPS.length; i++) {
    var r = fwebStepResult(FWEB_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function fwebWriteTrace() {
  var s = fwebState();
  var results = {};
  var counts = { total: FWEB_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FWEB_STEPS.length; i++) {
    var step = FWEB_STEPS[i];
    var r = fwebStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = fwebHeartbeat();
  var trace = {
    v: 1,
    runId: fwebRunId(),
    turn: s.turn,
    liveKey: fwebLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.frontier && hb.frontier.protocol,
      webfetchAdvertised: fwebHasOp('webfetch', 'fetch') && fwebHasOp('webfetch', 'search')
    },
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  fwebWriteCard('frontier:test:webfetch', JSON.stringify(trace, null, 2), 'Frontier Test');
}

// ---------- reset / commands ----------

function fwebTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function fwebRecentSources(outputText) {
  var src = [{ id: 'output:' + fwebState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function fwebConsumeCommand(kind, outputText, needles) {
  var s = fwebState();
  var sources = fwebRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!fwebTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = fwebNow();
    return true;
  }
  return false;
}

function fwebResetSuite() {
  state.frontierWebFetchTest = {
    runId: 'frontier-webfetch-' + fwebNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  fwebWriteCard('frontier:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Frontier');
  fwebWriteTrace();
}

// ---------- public entry point ----------

function frontierWebFetchTestStep(outputText) {
  var s = fwebState();
  fwebRunId();
  s.turn += 1;

  if (fwebConsumeCommand('reset', outputText, ['webfetch test reset', 'frontier webfetch reset', '[[webfetch-test:reset]]'])) {
    fwebResetSuite();
    return true;
  }

  fwebPollResponses();
  fwebAdvance();
  fwebWriteTrace();
  return true;
}
