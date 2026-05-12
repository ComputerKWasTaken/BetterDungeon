// Frontier SDK Module Test Suite - AI Dungeon Library
//
// Drives the BetterDungeon Frontier SDK module through its current public op
// and appends the returned data to story text through the paired output
// modifier.
//
// Surfaces written:
//   frontier:out       - request envelope queue (script -> BD)
//   frontier:in:sdk    - response envelope (BD -> script)
//   frontier:test:sdk  - human-readable trace card with results

state.frontierSdkTest = state.frontierSdkTest || {
  runId: null,
  turn: 0,
  seq: 0,
  outSeq: 0,
  phase: 'boot',
  pending: {},
  completed: {},
  acked: {},
  ackAttempts: {},
  steps: {},
  events: [],
  consumedCommands: {}
};

var FSDK_STEPS = [
  { label: 'version', module: 'sdk', op: 'version', args: function () { return {}; } }
];

function fsdkNow() {
  return Date.now ? Date.now() : new Date().getTime();
}

function fsdkState() {
  return state.frontierSdkTest;
}

function fsdkRunId() {
  var s = fsdkState();
  if (!s.runId) s.runId = 'frontier-sdk-' + fsdkNow().toString(36);
  return s.runId;
}

function fsdkCards() {
  return Array.isArray(storyCards) ? storyCards : [];
}

function fsdkFindCard(title) {
  var cards = fsdkCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function fsdkCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function fsdkReadJson(title) {
  var found = fsdkFindCard(title);
  if (!found.card) return null;
  try { return JSON.parse(fsdkCardText(found.card) || '{}'); } catch (e) { return null; }
}

function fsdkWriteCard(title, value, type) {
  var found = fsdkFindCard(title);
  var cardType = type || 'Frontier';

  if (found.card && found.index >= 0 && typeof updateStoryCard === 'function') {
    updateStoryCard(
      found.index,
      found.card.keys || found.card.key || title,
      value,
      found.card.type || cardType
    );
    return true;
  }

  if (typeof addStoryCard === 'function') {
    addStoryCard(title, value, cardType);
    return true;
  }

  return false;
}

function fsdkLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function fsdkLog(event, detail) {
  var s = fsdkState();
  s.events.push({
    at: fsdkNow(),
    turn: s.turn,
    liveKey: fsdkLiveKey(),
    event: event,
    detail: detail || ''
  });
  while (s.events.length > 60) s.events.shift();
}

function fsdkHeartbeat() {
  return fsdkReadJson('frontier:heartbeat');
}

function fsdkHeartbeatModule(moduleId) {
  var hb = fsdkHeartbeat();
  var modules = hb && Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < modules.length; i++) {
    var mod = modules[i];
    if (mod && mod.id === moduleId) return mod;
  }
  return null;
}

function fsdkHasOp(moduleId, opName) {
  var mod = fsdkHeartbeatModule(moduleId);
  var ops = mod && Array.isArray(mod.ops) ? mod.ops : [];
  return ops.indexOf(opName) !== -1;
}

function fsdkPendingArray() {
  var s = fsdkState();
  var out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function fsdkWriteOut() {
  var s = fsdkState();
  var payload = {
    v: 1,
    requests: fsdkPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: fsdkNow()
  };
  s._acks = [];
  fsdkWriteCard('frontier:out', JSON.stringify(payload), 'Frontier');
}

function fsdkQueueAck(requestId, reason) {
  var s = fsdkState();
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  fsdkLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function fsdkQueueRequest(label, moduleId, opName, args) {
  var s = fsdkState();
  var id = fsdkLiveKey() + '-' + label + '-' + (++s.seq);
  if (s.pending[id] || s.completed[id]) return id;
  s.pending[id] = {
    id: id,
    module: moduleId,
    op: opName,
    args: args === undefined ? {} : args,
    ts: fsdkNow()
  };
  s.steps[label] = id;
  fsdkLog('queued', id + ' -> ' + moduleId + '.' + opName);
  fsdkWriteOut();
  return id;
}

function fsdkIsTerminal(response) {
  return response && (response.status === 'ok' || response.status === 'err' || response.status === 'timeout');
}

function fsdkPollResponses() {
  var s = fsdkState();
  var card = fsdkReadJson('frontier:in:sdk');
  var found = false;
  if (!card || !card.responses) return;

  for (var requestId in card.responses) {
    if (!Object.prototype.hasOwnProperty.call(card.responses, requestId)) continue;
    var response = card.responses[requestId];
    if (!fsdkIsTerminal(response)) continue;

    if (!s.completed[requestId]) {
      s.completed[requestId] = {
        status: response.status,
        data: response.data || null,
        error: response.error || null,
        completedLiveCount: response.completedLiveCount || null,
        seenAt: fsdkNow()
      };
      fsdkLog('completed', requestId + ' -> ' + response.status);
    }

    delete s.pending[requestId];
    if (!s.acked[requestId] || Number(s.ackAttempts[requestId] || 0) < 6) {
      found = fsdkQueueAck(requestId, 'terminal') || found;
    }
  }

  if (found) fsdkWriteOut();
}

function fsdkCurrentStepIndex() {
  var s = fsdkState();
  for (var i = 0; i < FSDK_STEPS.length; i++) {
    var step = FSDK_STEPS[i];
    var requestId = s.steps[step.label];
    if (!requestId) return i;
    if (!s.completed[requestId]) return i;
  }
  return FSDK_STEPS.length;
}

function fsdkAdvance() {
  var s = fsdkState();

  if (!fsdkHasOp('sdk', 'version')) {
    s.phase = 'waiting for sdk heartbeat';
    return;
  }

  var idx = fsdkCurrentStepIndex();
  if (idx >= FSDK_STEPS.length) {
    s.phase = 'complete';
    return;
  }

  var step = FSDK_STEPS[idx];
  if (!s.steps[step.label]) {
    s.phase = 'queueing ' + step.label;
    fsdkQueueRequest(step.label, step.module, step.op, step.args());
  } else {
    s.phase = 'awaiting ' + step.label;
  }
}

function fsdkPretty(value, limit) {
  var max = typeof limit === 'number' && limit > 0 ? limit : 1500;
  var text = '';
  try { text = JSON.stringify(value, null, 2); } catch (e) { text = String(value); }
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n... [truncated]';
}

function fsdkStepResult(step) {
  var s = fsdkState();
  var requestId = s.steps[step.label];
  if (!requestId) return { state: 'pending' };
  var completed = s.completed[requestId];
  if (!completed) return { state: 'inflight', requestId: requestId };
  return {
    state: 'done',
    requestId: requestId,
    status: completed.status,
    data: completed.data,
    error: completed.error
  };
}

function fsdkWriteTrace() {
  var s = fsdkState();
  var results = {};
  for (var i = 0; i < FSDK_STEPS.length; i++) {
    var step = FSDK_STEPS[i];
    results[step.label] = fsdkStepResult(step);
  }

  var trace = {
    v: 1,
    runId: fsdkRunId(),
    turn: s.turn,
    liveKey: fsdkLiveKey(),
    phase: s.phase,
    heartbeat: fsdkHeartbeat(),
    results: results,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };

  fsdkWriteCard('frontier:test:sdk', JSON.stringify(trace, null, 2), 'Frontier Test');
}

function fsdkRecentSources(outputText) {
  var src = [{ id: 'output:' + fsdkState().turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 6);
  for (var i = start; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry) continue;
    src.push({ id: 'history:' + i, text: String(entry.text || '') + '\n' + String(entry.rawText || '') });
  }
  return src;
}

function fsdkTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function fsdkConsumeCommand(kind, outputText, needles) {
  var s = fsdkState();
  var sources = fsdkRecentSources(outputText);
  for (var i = 0; i < sources.length; i++) {
    var src = sources[i];
    if (!fsdkTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = fsdkNow();
    return true;
  }
  return false;
}

function fsdkResetSuite() {
  state.frontierSdkTest = {
    runId: 'frontier-sdk-' + fsdkNow().toString(36),
    turn: 0,
    seq: 0,
    outSeq: 0,
    phase: 'reset',
    pending: {},
    completed: {},
    acked: {},
    ackAttempts: {},
    steps: {},
    events: [],
    consumedCommands: {}
  };
  fsdkWriteCard('frontier:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Frontier');
  fsdkWriteTrace();
}

function fsdkRenderStoryBlock() {
  var s = fsdkState();
  var lines = [];
  var hb = fsdkHeartbeat();
  lines.push('[Frontier SDK Test]');
  lines.push('phase: ' + s.phase);
  lines.push('heartbeat: ' + (hb ? 'present' : 'missing'));
  lines.push('sdk version op advertised: ' + (fsdkHasOp('sdk', 'version') ? 'yes' : 'no'));

  for (var i = 0; i < FSDK_STEPS.length; i++) {
    var step = FSDK_STEPS[i];
    var result = fsdkStepResult(step);
    if (result.state === 'pending') {
      lines.push(step.label + ': pending');
      continue;
    }
    if (result.state === 'inflight') {
      lines.push(step.label + ': waiting (' + result.requestId + ')');
      continue;
    }

    lines.push(step.label + ': ' + result.status);
    if (result.status === 'ok') {
      lines.push(fsdkPretty(result.data, 1200));
    } else {
      lines.push(fsdkPretty(result.error || { code: 'unknown_error' }, 600));
    }
  }

  lines.push('trace card: frontier:test:sdk');
  return lines.join('\n');
}

function frontierSdkTestStep(outputText) {
  var s = fsdkState();
  fsdkRunId();
  s.turn += 1;

  if (fsdkConsumeCommand('reset', outputText, ['sdk test reset', 'frontier sdk reset', '[[sdk-test:reset]]'])) {
    fsdkResetSuite();
  }

  fsdkPollResponses();
  fsdkAdvance();
  fsdkWriteTrace();
  return fsdkRenderStoryBlock();
}
