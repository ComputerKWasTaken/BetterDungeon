// Ultrascripts AI Contract Test Suite - AI Dungeon Library
//
// Verifies that the AI module exposes the Phase 1 status/query contract while
// the backend remains unconfigured. Pair with output-modifier.js.

state.ultrascriptsAiTest = state.ultrascriptsAiTest || {
  runId: null,
  turn: 0,
  seq: 0,
  outSeq: 0,
  pending: {},
  completed: {},
  acked: {},
  ackAttempts: {},
  statusRequestId: null,
  textQueryRequestId: null,
  jsonQueryRequestId: null,
  events: [],
  phase: 'boot'
};

var FAI_LEGACY_OPS = ['chat', 'models', 'testConnection'];

function faiNow() { return Date.now ? Date.now() : new Date().getTime(); }

function faiRunId() {
  var s = state.ultrascriptsAiTest;
  if (!s.runId) s.runId = 'ultrascripts-ai-contract-' + faiNow().toString(36);
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
  while (s.events.length > 60) s.events.shift();
}

function faiHeartbeat() { return faiReadJson('ultrascripts:heartbeat'); }

function faiAiModule() {
  var hb = faiHeartbeat();
  var mods = hb && Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < mods.length; i++) {
    if (mods[i] && mods[i].id === 'ai') return mods[i];
  }
  return null;
}

function faiHasModule(moduleId) {
  var hb = faiHeartbeat();
  var mods = hb && Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < mods.length; i++) {
    if (mods[i] && mods[i].id === moduleId) return true;
  }
  return false;
}

function faiAiOps() {
  var mod = faiAiModule();
  return mod && Array.isArray(mod.ops) ? mod.ops : [];
}

function faiHasOp(opName) {
  return faiAiOps().indexOf(opName) !== -1;
}

function faiLegacyOpsAdvertised() {
  var found = [];
  for (var i = 0; i < FAI_LEGACY_OPS.length; i++) {
    if (faiHasOp(FAI_LEGACY_OPS[i])) found.push(FAI_LEGACY_OPS[i]);
  }
  return found;
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

function faiQueueStatus() {
  var s = state.ultrascriptsAiTest;
  if (s.statusRequestId) return;
  var id = faiLiveKey() + '-ai-status-' + (++s.seq);
  s.statusRequestId = id;
  s.pending[id] = {
    id: id,
    module: 'ai',
    op: 'status',
    args: {},
    ts: faiNow()
  };
  faiLog('queued', id + ' -> ai.status');
  faiWriteOut();
}

function faiQueueQuery(kind) {
  var s = state.ultrascriptsAiTest;
  var key = kind === 'json' ? 'jsonQueryRequestId' : 'textQueryRequestId';
  if (s[key]) return;
  var id = faiLiveKey() + '-ai-query-' + kind + '-' + (++s.seq);
  s[key] = id;
  s.pending[id] = {
    id: id,
    module: 'ai',
    op: 'query',
    args: kind === 'json'
      ? {
        prompt: 'Return JSON only: {"ok": true}.',
        output: { type: 'json' }
      }
      : {
        prompt: 'Return one short plain-text sentence.',
        output: { type: 'text' }
      },
    ts: faiNow()
  };
  faiLog('queued', id + ' -> ai.query(' + kind + ')');
  faiWriteOut();
}

function faiIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function faiPollResponses() {
  var s = state.ultrascriptsAiTest;
  var card = faiReadJson('ultrascripts:in:ai');
  if (!card || !card.responses) return;

  var found = false;
  for (var rid in card.responses) {
    if (!Object.prototype.hasOwnProperty.call(card.responses, rid)) continue;
    var r = card.responses[rid];
    if (!faiIsTerminal(r)) continue;
    if (!s.completed[rid]) {
      s.completed[rid] = {
        status: r.status,
        data: r.data || null,
        error: r.error || null,
        seenAt: faiNow()
      };
      faiLog('completed', rid + ' -> ' + r.status);
    }
    delete s.pending[rid];
    if (!s.acked[rid] || Number(s.ackAttempts[rid] || 0) < 6) {
      found = faiQueueAck(rid, 'terminal') || found;
    }
  }
  if (found) faiWriteOut();
}

function faiStatusData() {
  var s = state.ultrascriptsAiTest;
  var done = s.statusRequestId ? s.completed[s.statusRequestId] : null;
  return done && done.status === 'ok' ? done.data : null;
}

function faiStatusPass() {
  var data = faiStatusData();
  return !!(
    data &&
    data.ready === false &&
    data.available === false &&
    data.phase === 'contract' &&
    data.reason === 'ai_backend_not_configured' &&
    data.contract &&
    Array.isArray(data.contract.ops) &&
    data.contract.ops.indexOf('status') !== -1 &&
    data.contract.ops.indexOf('query') !== -1
  );
}

function faiQueryPass(kind) {
  var s = state.ultrascriptsAiTest;
  var id = kind === 'json' ? s.jsonQueryRequestId : s.textQueryRequestId;
  var done = id ? s.completed[id] : null;
  return !!(
    done &&
    done.status === 'err' &&
    done.error &&
    done.error.code === 'not_configured' &&
    done.error.retryable === false
  );
}

function faiResetSuite() {
  state.ultrascriptsAiTest = {
    runId: 'ultrascripts-ai-contract-' + faiNow().toString(36),
    turn: 0,
    seq: 0,
    outSeq: 0,
    pending: {},
    completed: {},
    acked: {},
    ackAttempts: {},
    statusRequestId: null,
    textQueryRequestId: null,
    jsonQueryRequestId: null,
    events: [],
    phase: 'reset'
  };
  faiWriteCard('ultrascripts:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Ultrascripts');
  faiWriteTrace();
}

function faiConsumeReset(outputText) {
  var hay = String(outputText || '').toLowerCase();
  return hay.indexOf('ai test reset') !== -1 ||
    hay.indexOf('ultrascripts ai reset') !== -1 ||
    hay.indexOf('[[ai-test:reset]]') !== -1;
}

function faiAdvance() {
  var s = state.ultrascriptsAiTest;
  var ai = faiAiModule();
  var legacyOps = faiLegacyOpsAdvertised();

  if (!ai) {
    s.phase = 'waiting for ai heartbeat';
    return;
  }
  if (!faiHasOp('status') || !faiHasOp('query') || legacyOps.length > 0) {
    s.phase = 'heartbeat contract mismatch';
    return;
  }
  if (!s.statusRequestId) {
    s.phase = 'queueing status';
    faiQueueStatus();
    return;
  }
  if (!s.completed[s.statusRequestId]) {
    s.phase = 'awaiting status';
    return;
  }
  if (!s.textQueryRequestId) {
    s.phase = 'queueing text query';
    faiQueueQuery('text');
    return;
  }
  if (!s.completed[s.textQueryRequestId]) {
    s.phase = 'awaiting text query';
    return;
  }
  if (!s.jsonQueryRequestId) {
    s.phase = 'queueing json query';
    faiQueueQuery('json');
    return;
  }
  if (!s.completed[s.jsonQueryRequestId]) {
    s.phase = 'awaiting json query';
    return;
  }
  s.phase = faiStatusPass() && faiQueryPass('text') && faiQueryPass('json') ? 'complete' : 'complete-with-failures';
}

function faiWriteTrace() {
  var s = state.ultrascriptsAiTest;
  var hb = faiHeartbeat();
  var ai = faiAiModule();
  var legacyOps = faiLegacyOpsAdvertised();
  var statusData = faiStatusData();
  var statusDone = !!(s.statusRequestId && s.completed[s.statusRequestId]);
  var statusPass = faiStatusPass();
  var textQueryDone = !!(s.textQueryRequestId && s.completed[s.textQueryRequestId]);
  var textQueryPass = faiQueryPass('text');
  var jsonQueryDone = !!(s.jsonQueryRequestId && s.completed[s.jsonQueryRequestId]);
  var jsonQueryPass = faiQueryPass('json');
  var providerAliasAdvertised = faiHasModule('providerAI');
  var heartbeatPass = !!ai && !providerAliasAdvertised && faiHasOp('status') && faiHasOp('query') && legacyOps.length === 0;
  var counts = {
    total: 4,
    pass: (heartbeatPass ? 1 : 0) + (statusPass ? 1 : 0) + (textQueryPass ? 1 : 0) + (jsonQueryPass ? 1 : 0),
    fail: (heartbeatPass || !ai ? 0 : 1) + (statusDone && !statusPass ? 1 : 0) + (textQueryDone && !textQueryPass ? 1 : 0) + (jsonQueryDone && !jsonQueryPass ? 1 : 0),
    pending: (!ai ? 1 : 0) + (!statusDone ? 1 : 0) + (!textQueryDone ? 1 : 0) + (!jsonQueryDone ? 1 : 0)
  };

  var trace = {
    v: 1,
    runId: faiRunId(),
    turn: s.turn,
    liveKey: faiLiveKey(),
    phase: s.phase,
    heartbeat: {
      present: !!hb,
      protocol: hb && hb.ultrascripts && hb.ultrascripts.protocol,
      aiAdvertised: !!ai,
      providerAliasAdvertised: providerAliasAdvertised,
      aiOps: faiAiOps(),
      legacyOpsAdvertised: legacyOps,
      pass: heartbeatPass
    },
    status: {
      requestId: s.statusRequestId,
      terminal: statusDone,
      data: statusData,
      pass: statusPass
    },
    textQuery: {
      requestId: s.textQueryRequestId,
      terminal: textQueryDone,
      response: s.textQueryRequestId ? s.completed[s.textQueryRequestId] || null : null,
      pass: textQueryPass
    },
    jsonQuery: {
      requestId: s.jsonQueryRequestId,
      terminal: jsonQueryDone,
      response: s.jsonQueryRequestId ? s.completed[s.jsonQueryRequestId] || null : null,
      pass: jsonQueryPass
    },
    counts: counts,
    checksPass: heartbeatPass && statusPass && textQueryPass && jsonQueryPass,
    pendingIds: Object.keys(s.pending),
    ackAttempts: s.ackAttempts,
    events: s.events
  };
  faiWriteCard('ultrascripts:test:ai', JSON.stringify(trace, null, 2), 'Ultrascripts Test');
}

function ultrascriptsAiTestStep(outputText) {
  var s = state.ultrascriptsAiTest;
  faiRunId();
  s.turn += 1;

  if (faiConsumeReset(outputText)) {
    faiResetSuite();
    return true;
  }

  faiPollResponses();
  faiAdvance();
  faiWriteTrace();
  return true;
}
