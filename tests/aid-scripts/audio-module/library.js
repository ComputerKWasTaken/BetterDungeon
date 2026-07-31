// Ultrascripts Audio Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Ultrascripts Audio module through its declarative
// state-card contract and its read-only `state` op. Pair with
// output-modifier.js.
//
// The Audio module is state-driven: the script writes desired playback to
// `ultrascripts:state:audio` and never gets a per-cue response. So each step
// here writes a state payload, then calls `audio.state` and asserts that the
// reported playback matches what was declared. Sound itself is verified by
// ear — this suite verifies the contract plumbing.
//
// Surfaces written:
//   ultrascripts:state:audio          - declarative audio state (script -> BD)
//   ultrascripts:out                  - request envelope queue (script -> BD)
//   ultrascripts:in:audio             - response envelope (BD -> script)
//   ultrascripts:test:audio           - human-readable trace card with results

// ---------- state ----------

state.ultrascriptsAudioTest = state.ultrascriptsAudioTest || {
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
//
// Each step optionally writes an audio state payload before issuing its
// request. The request is always `audio.state` (except the error-path steps),
// and `validate` receives the op's response data.

var FAUD_STEPS = [
  {
    label: 'baseline-state-op',
    module: 'audio',
    op: 'state',
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && typeof r.vocabularyVersion === 'number' &&
        Array.isArray(r.cues) && r.cues.length > 0 &&
        r.cues.indexOf('music.lofi.chill') !== -1);
    }
  },
  {
    label: 'music-and-prime',
    module: 'audio',
    op: 'state',
    audioState: {
      v: 1,
      music: { cue: 'music.lofi.chill', intensity: 0.7 },
      oneshots: [{ seq: 1, cue: 'sfx.chime' }]
    },
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      // Music bed declared; the first-seen one-shot seq is primed, not replayed.
      return !!(r && r.playback && r.playback.music &&
        r.playback.music.cue === 'music.lofi.chill' &&
        Number(r.oneshotAckSeq) >= 1);
    }
  },
  {
    label: 'ambience-layer',
    module: 'audio',
    op: 'state',
    audioState: {
      v: 1,
      music: { cue: 'music.lofi.chill', intensity: 0.7 },
      ambience: [{ cue: 'weather.rain.light', gain: 0.5 }],
      oneshots: [{ seq: 1, cue: 'sfx.chime' }]
    },
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      if (!r || !r.playback || !Array.isArray(r.playback.ambience)) return false;
      for (var i = 0; i < r.playback.ambience.length; i++) {
        if (r.playback.ambience[i] && r.playback.ambience[i].cue === 'weather.rain.light') return true;
      }
      return false;
    }
  },
  {
    label: 'oneshot-advances-seq',
    module: 'audio',
    op: 'state',
    audioState: {
      v: 1,
      music: { cue: 'music.lofi.chill', intensity: 0.7 },
      ambience: [{ cue: 'weather.rain.light', gain: 0.5 }],
      oneshots: [{ seq: 1, cue: 'sfx.chime' }, { seq: 2, cue: 'sfx.door.close' }]
    },
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && Number(r.oneshotAckSeq) >= 2);
    }
  },
  {
    label: 'unknown-cue-cascades',
    module: 'audio',
    op: 'state',
    audioState: {
      v: 1,
      music: { cue: 'music.some.future.subgenre', intensity: 0.5 }
    },
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      // Unknown music cue must cascade to the family default, never fail.
      return !!(r && r.playback && r.playback.music &&
        r.playback.music.cue === 'music.calm');
    }
  },
  {
    label: 'clear-state-silences',
    module: 'audio',
    op: 'state',
    audioState: {
      v: 1,
      music: null,
      ambience: []
    },
    args: function () { return {}; },
    expect: 'ok',
    validate: function (r) {
      return !!(r && r.playback && r.playback.music === null &&
        Array.isArray(r.playback.ambience) && r.playback.ambience.length === 0);
    }
  },
  {
    label: 'err-unknown-op',
    module: 'audio',
    op: 'thisOpDoesNotExist',
    args: function () { return {}; },
    expect: 'err',
    errorCode: 'unknown_op'
  }
];

// ---------- helpers ----------

function faudNow() { return Date.now ? Date.now() : new Date().getTime(); }

function faudState() { return state.ultrascriptsAudioTest; }

function faudRunId() {
  var s = faudState();
  if (!s.runId) s.runId = 'ultrascripts-audio-' + faudNow().toString(36);
  return s.runId;
}

function faudCards() { return Array.isArray(storyCards) ? storyCards : []; }

function faudFindCard(title) {
  var cards = faudCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function faudCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function faudReadJson(title) {
  var f = faudFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(faudCardText(f.card) || '{}'); } catch (e) { return null; }
}

function faudWriteCard(title, value, type) {
  var f = faudFindCard(title);
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

function faudLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function faudLog(event, detail) {
  var s = faudState();
  s.events.push({ at: faudNow(), turn: s.turn, liveKey: faudLiveKey(), event: event, detail: detail || '' });
  while (s.events.length > 60) s.events.shift();
}

function faudHeartbeat() { return faudReadJson('ultrascripts:heartbeat'); }

function faudHasOp(moduleId, opName) {
  var hb = faudHeartbeat();
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

function faudPendingArray() {
  var s = faudState(), out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function faudWriteOut() {
  var s = faudState();
  var payload = {
    v: 1,
    requests: faudPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: faudNow()
  };
  s._acks = [];
  faudWriteCard('ultrascripts:out', JSON.stringify(payload), 'Ultrascripts');
}

function faudQueueAck(requestId, reason) {
  var s = faudState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  faudLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function faudQueueRequest(label, moduleId, opName, args) {
  var s = faudState();
  var id = faudLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id, module: moduleId, op: opName,
    args: args === undefined ? {} : args,
    ts: faudNow()
  };
  s.steps[label] = id;
  faudLog('queued', id + ' -> ' + moduleId + '.' + opName);
  faudWriteOut();
  return id;
}

function faudIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function faudPollResponses() {
  var s = faudState();
  var found = false;
  var card = faudReadJson('ultrascripts:in:audio');
  if (card && card.responses) {
    for (var rid in card.responses) {
      if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
      var r = card.responses[rid];
      if (!faudIsTerminal(r)) continue;
      if (!s.completed[rid]) {
        s.completed[rid] = {
          status: r.status, data: r.data || null, error: r.error || null,
          module: 'audio', seenAt: faudNow()
        };
        faudLog('completed', rid + ' -> ' + r.status);
      }
      delete s.pending[rid];
      if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
        found = faudQueueAck(rid, 'terminal') || found;
      }
    }
  }
  if (found) faudWriteOut();
}

// ---------- driver ----------

function faudCurrentStepIndex() {
  var s = faudState();
  for (var i = 0; i < FAUD_STEPS.length; i++) {
    var step = FAUD_STEPS[i];
    var rid = s.steps[step.label];
    if (!rid) return i;
    if (!s.completed[rid]) return i;
  }
  return FAUD_STEPS.length;
}

function faudAdvance() {
  var s = faudState();

  if (!faudHasOp('audio', 'state')) {
    s.phase = 'waiting for audio heartbeat';
    return;
  }

  var idx = faudCurrentStepIndex();
  if (idx >= FAUD_STEPS.length) {
    s.phase = faudAllChecksPass() ? 'complete' : 'complete-with-failures';
    return;
  }

  var step = FAUD_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    if (step.audioState) {
      faudWriteCard('ultrascripts:state:audio', JSON.stringify(step.audioState), 'Ultrascripts');
      faudLog('state-written', step.label);
    }
    var args;
    try { args = step.args(); } catch (e) { args = {}; }
    faudQueueRequest(step.label, step.module, step.op, args);
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function faudStepResult(step) {
  var s = faudState();
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
      music: done.data.playback && done.data.playback.music,
      ambienceCount: done.data.playback && Array.isArray(done.data.playback.ambience)
        ? done.data.playback.ambience.length : null,
      oneshotAckSeq: done.data.oneshotAckSeq,
      contextState: done.data.playback && done.data.playback.contextState
    };
  }

  return out;
}

function faudAllChecksPass() {
  for (var i = 0; i < FAUD_STEPS.length; i++) {
    var r = faudStepResult(FAUD_STEPS[i]);
    if (r.state !== 'done' || !r.pass) return false;
  }
  return true;
}

function faudWriteTrace() {
  var s = faudState();
  var results = {};
  var counts = { total: FAUD_STEPS.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < FAUD_STEPS.length; i++) {
    var step = FAUD_STEPS[i];
    var r = faudStepResult(step);
    results[step.label] = r;
    if (r.state !== 'done') counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }

  var hb = faudHeartbeat();
  var trace = {
    v: 1,
    runId: faudRunId(),
    turn: s.turn,
    liveKey: faudLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.ultrascripts && hb.ultrascripts.protocol,
      audioAdvertised: faudHasOp('audio', 'state')
    },
    counts: counts,
    checksPass: counts.pending === 0 && counts.fail === 0,
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  faudWriteCard('ultrascripts:test:audio', JSON.stringify(trace, null, 2), 'Ultrascripts Test');
}

// ---------- reset / commands ----------

function faudTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function faudRecentSources(outputText) {
  var src = [{ id: 'output:' + faudState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    src.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  return src;
}

function faudConsumeCommand(kind, outputText, needles) {
  var s = faudState();
  var sources = faudRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!faudTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = faudNow();
    return true;
  }
  return false;
}

function faudResetSuite() {
  state.ultrascriptsAudioTest = {
    runId: 'ultrascripts-audio-' + faudNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pending: {}, completed: {}, acked: {}, ackAttempts: {},
    steps: {}, events: [], consumedCommands: {},
    phase: 'reset'
  };
  faudWriteCard('ultrascripts:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Ultrascripts');
  faudWriteCard('ultrascripts:state:audio', JSON.stringify({ v: 1, music: null, ambience: [] }), 'Ultrascripts');
  faudWriteTrace();
}

// ---------- public entry point ----------

function ultrascriptsAudioTestStep(outputText) {
  var s = faudState();
  faudRunId();
  s.turn += 1;

  if (faudConsumeCommand('reset', outputText, ['audio test reset', 'ultrascripts audio reset', '[[audio-test:reset]]'])) {
    faudResetSuite();
    return true;
  }

  faudPollResponses();
  faudAdvance();
  faudWriteTrace();
  return true;
}
