// Ultrascripts System Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Ultrascripts System module through every public op and a
// representative set of error paths. Pair with output-modifier.js.
//
// Surfaces written:
//   ultrascripts:out                  - request envelope queue (script -> BD)
//   ultrascripts:in:system            - response envelope (BD -> script)
//   ultrascripts:test:system          - human-readable trace card with results

// ---------- state ----------

state.ultrascriptsSystemTest = state.ultrascriptsSystemTest || {
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

var FSYS_STEPS = [
  {
    label: 'info',
    module: 'system',
    op: 'info',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || typeof r.deviceClass !== 'string') return false;
      var validClasses = ['desktop', 'tablet', 'mobile', 'unknown'];
      if (validClasses.indexOf(r.deviceClass) === -1) return false;
      if (!r.platform || typeof r.platform !== 'object') return false;
      if (typeof r.platform.family !== 'string') return false;
      if (!r.browser || typeof r.browser !== 'object') return false;
      if (typeof r.browser.name !== 'string') return false;
      if (!r.locale || typeof r.locale !== 'object') return false;
      if (!r.screen || typeof r.screen !== 'object') return false;
      if (!r.hardware || typeof r.hardware !== 'object') return false;
      if (!r.preferences || typeof r.preferences !== 'object') return false;
      if (typeof r.checkedAt !== 'number' || typeof r.checkedAtIso !== 'string') return false;
      return true;
    }
  },
  {
    label: 'info-platform-detail',
    module: 'system',
    op: 'info',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !r.platform) return false;
      var validFamilies = ['windows', 'macos', 'linux', 'android', 'ios', 'chromeos', 'unknown'];
      if (validFamilies.indexOf(r.platform.family) === -1) return false;
      if (typeof r.platform.mobile !== 'boolean') return false;
      return true;
    }
  },
  {
    label: 'info-browser-detail',
    module: 'system',
    op: 'info',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !r.browser) return false;
      var validBrowsers = ['chromium', 'firefox', 'safari', 'edge', 'opera', 'unknown'];
      if (validBrowsers.indexOf(r.browser.name) === -1) return false;
      if (typeof r.browser.userAgentDataSupported !== 'boolean') return false;
      return true;
    }
  },
  {
    label: 'info-screen-detail',
    module: 'system',
    op: 'info',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !r.screen) return false;
      // At least width and height should be present numbers or null
      var s = r.screen;
      if (s.width !== null && typeof s.width !== 'number') return false;
      if (s.height !== null && typeof s.height !== 'number') return false;
      return true;
    }
  },
  {
    label: 'power',
    module: 'system',
    op: 'power',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r) return false;
      if (typeof r.supported !== 'boolean') return false;
      if (typeof r.checkedAt !== 'number' || typeof r.checkedAtIso !== 'string') return false;
      if (r.supported) {
        // If battery is supported, state must be one of known values
        var validStates = ['charging', 'discharging', 'charged', 'unknown'];
        if (typeof r.state !== 'string' || validStates.indexOf(r.state) === -1) return false;
      }
      return true;
    }
  },
  {
    label: 'err-unknown-op',
    module: 'system',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  },
  {
    label: 'err-unknown-module',
    module: 'definitelyNotAModule',
    op: 'info',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_module'
  }
];

// ---------- helpers ----------

function fsysNow() { return Date.now ? Date.now() : new Date().getTime(); }

function fsysState() { return state.ultrascriptsSystemTest; }

function fsysRunId() {
  var s = fsysState();
  if (!s.runId) s.runId = 'ultrascripts-system-' + fsysNow().toString(36);
  return s.runId;
}

function fsysCards() { return Array.isArray(storyCards) ? storyCards : []; }

function fsysFindCard(title) {
  var cards = fsysCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function fsysCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function fsysReadJson(title) {
  var f = fsysFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(fsysCardText(f.card) || '{}'); } catch (e) { return null; }
}

function fsysWriteCard(title, value, type) {
  var f = fsysFindCard(title);
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

function fsysLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function fsysLog(event, detail) {
  var s = fsysState();
  s.events.push({ at: fsysNow(), turn: s.turn, liveKey: fsysLiveKey(), event: event, detail: detail || '' });
  while (s.events.length > 60) s.events.shift();
}

function fsysHeartbeat() { return fsysReadJson('ultrascripts:heartbeat'); }

function fsysHasOp(moduleId, opName) {
  var hb = fsysHeartbeat();
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

function fsysPendingArray() {
  var s = fsysState(), out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function fsysWriteOut() {
  var s = fsysState();
  var payload = {
    v: 1,
    requests: fsysPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: fsysNow()
  };
  s._acks = [];
  fsysWriteCard('ultrascripts:out', JSON.stringify(payload), 'Ultrascripts');
}

function fsysQueueAck(requestId, reason) {
  var s = fsysState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  fsysLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function fsysQueueRequest(label, moduleId, opName, args) {
  var s = fsysState();
  var id = fsysLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: fsysNow()
  };
  s.steps[label] = id;
  fsysLog('queued', id + ' -> ' + moduleId + '.' + opName);
  fsysWriteOut();
  return id;
}

function fsysIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function fsysPollResponses() {
  var s = fsysState();
  var seen = {};
  var modules = [];
  for (var i = 0; i < FSYS_STEPS.length; i++) {
    var name = FSYS_STEPS[i].module;
    if (name && !seen[name]) { seen[name] = true; modules.push(name); }
  }
  var found = false;
  for (var m = 0; m < modules.length; m++) {
    var card = fsysReadJson('ultrascripts:in:' + modules[m]);
    if (!card || !card.responses) continue;
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!fsysIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: modules[m], seenAt: fsysNow()
        };
        fsysLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = fsysQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) fsysWriteOut();
}

// ---------- driver ----------

function fsysCurrentStepIndex() {
  var s = fsysState();
  for (var i = 0; i < FSYS_STEPS.length; i++) {
    var step = FSYS_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FSYS_STEPS.length;
}

function fsysAdvance() {
  var s = fsysState();

  if (!fsysHasOp('system', 'info') || !fsysHasOp('system', 'power')) {
    s.phase = 'waiting for system heartbeat';
    return;
  }

  var idx = fsysCurrentStepIndex();
  if (idx >= FSYS_STEPS.length) {
    s.phase = fsysAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FSYS_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    fsysQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function fsysStepResult(step) {
  var s = fsysState();
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
      deviceClass: done.data.deviceClass || null,
      platformFamily: done.data.platform ? done.data.platform.family : null,
      browserName: done.data.browser ? done.data.browser.name : null,
      supported: done.data.supported,
      state: done.data.state || null
    };
  }

  return out;
}

function fsysAllChecksPass() {
  for (var i = 0; i < FSYS_STEPS.length; i++) {
    var r = fsysStepResult(FSYS_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function fsysWriteTrace() {
  var s = fsysState();
  var results = {};
  var counts = { total: FSYS_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FSYS_STEPS.length; i++) {
    var step = FSYS_STEPS[i];
    var r = fsysStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = fsysHeartbeat();
  var trace = {
    v: 1,
    runId: fsysRunId(),
    turn: s.turn,
    liveKey: fsysLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.ultrascripts && hb.ultrascripts.protocol,
      systemAdvertised: fsysHasOp('system', 'info') && fsysHasOp('system', 'power')
    },
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  fsysWriteCard('ultrascripts:test:system', JSON.stringify(trace, null, 2), 'Ultrascripts Test');
}

// ---------- reset / commands ----------

function fsysTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function fsysRecentSources(outputText) {
  var src = [{ id: 'output:' + fsysState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function fsysConsumeCommand(kind, outputText, needles) {
  var s = fsysState();
  var sources = fsysRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!fsysTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = fsysNow();
    return true;
  }
  return false;
}

function fsysResetSuite() {
  state.ultrascriptsSystemTest = {
    runId: 'ultrascripts-system-' + fsysNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  fsysWriteCard('ultrascripts:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Ultrascripts');
  fsysWriteTrace();
}

// ---------- public entry point ----------

function ultrascriptsSystemTestStep(outputText) {
  var s = fsysState();
  fsysRunId();
  s.turn += 1;

  if (fsysConsumeCommand('reset', outputText, ['system test reset', 'ultrascripts system reset', '[[system-test:reset]]'])) {
    fsysResetSuite();
    return true;
  }

  fsysPollResponses();
  fsysAdvance();
  fsysWriteTrace();
  return true;
}
