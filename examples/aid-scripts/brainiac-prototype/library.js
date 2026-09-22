// ============================================================
// LIBRARY - Brainiac Prototype
// ============================================================
// Requires BetterDungeon Ultrascripts and its AI module. Paste the companion
// files into AI Dungeon's Input, Context, and Output modifier panes.

globalThis.bd = globalThis.bd || {};
var bd = globalThis.bd;

var BRAINIAC_CONFIG_CARD = 'Configure Brainiac';
var BRAINIAC_BRAIN_CARD = 'Brainiac Brain';
var BRAINIAC_MAX_BRAIN_CHARS = 3000;
var BRAINIAC_MAX_PROMPT_CHARS = 12000;
var BRAINIAC_STATUS_RETRY_TURNS = 2;

globalThis.Brainiac = function Brainiac(hook, inputText) {
  var text = inputText;
  state.brainiac = state.brainiac || {};
  var runtime = state.brainiac;
  brainiacInitializeState(runtime);

  bd.us = brainiacCreateUltrascriptsSdk();
  var us = bd.us;

  brainiacEnsureCards(us);
  var enabled = brainiacReadEnabled(us);

  us.observeHeartbeat(hook);
  us.tick();

  var runtimeOnline = us.available();
  var aiPresent = runtimeOnline && us.has('ai', 'status') && us.has('ai', 'query');

  if (!aiPresent) {
    runtime.aiReady = false;
    runtime.aiStatusKnown = true;
    runtime.statusRequestId = null;
    runtime.query = null;
  }

  brainiacConsumeStatusResponse(us, runtime);
  brainiacConsumeQueryResponse(us, runtime, enabled);

  if (hook === 'input' && !runtimeOnline) {
    brainiacWriteConfig(us, enabled, 'Waiting for Ultrascripts');
    state.message = brainiacSetupHelp('Waiting for Ultrascripts');
    us.commit();
    return { text: null, stop: true };
  }

  if (enabled && aiPresent) {
    brainiacMaybeRequestStatus(us, runtime);
  }

  if (hook === 'context') {
    runtime.capturedContext = typeof text === 'string' ? text : '';
    var brain = brainiacReadBrain(us);
    if (enabled && runtime.aiReady && brain.trim()) {
      text = runtime.capturedContext + brainiacContextSuffix(brain);
    }
  }

  if (hook === 'output' && enabled && runtime.aiReady && aiPresent && !runtime.query) {
    var previousBrain = brainiacReadBrain(us);
    var prompt = brainiacBuildPrompt(runtime.capturedContext, text, previousBrain);
    if (prompt) {
      var queryId = us.call('ai', 'query', {
        prompt: prompt,
        thinking: 'medium',
        output: { type: 'text' }
      });
      runtime.query = {
        id: queryId,
        brainText: previousBrain,
        requestedAtLiveCount: us.liveCount()
      };
    }
  }

  var status = brainiacStatus(runtimeOnline, aiPresent, enabled, runtime);
  brainiacNotifyAiSetup(runtime, enabled, aiPresent, status);
  brainiacWriteConfig(us, enabled, status);
  us.commit();
  return { text: text };
};

function brainiacInitializeState(runtime) {
  if (typeof runtime.aiReady !== 'boolean') runtime.aiReady = false;
  if (typeof runtime.aiStatusKnown !== 'boolean') runtime.aiStatusKnown = false;
  if (typeof runtime.statusRequestId !== 'string') runtime.statusRequestId = null;
  if (!runtime.query || typeof runtime.query !== 'object') runtime.query = null;
  if (typeof runtime.capturedContext !== 'string') runtime.capturedContext = '';
  if (!Number.isFinite(Number(runtime.nextStatusLiveCount))) runtime.nextStatusLiveCount = 0;
}

function brainiacEnsureCards(us) {
  if (!us.findCard(BRAINIAC_CONFIG_CARD)) {
    us.upsertCard(BRAINIAC_CONFIG_CARD, brainiacConfigText(true, 'Waiting for Ultrascripts'));
  }
  if (!us.findCard(BRAINIAC_BRAIN_CARD)) {
    us.upsertCard(BRAINIAC_BRAIN_CARD, '');
  }
}

function brainiacReadEnabled(us) {
  var raw = us.cardText(us.findCard(BRAINIAC_CONFIG_CARD));
  var match = /^\s*Enabled\s*:\s*(true|false)\s*$/im.exec(raw || '');
  return !match || match[1].toLowerCase() === 'true';
}

function brainiacReadBrain(us) {
  return us.cardText(us.findCard(BRAINIAC_BRAIN_CARD));
}

function brainiacConfigText(enabled, status) {
  var lines = [
    'Brainiac uses the Ultrascripts AI module to maintain a rolling editorial memory for this adventure.',
    '',
    'Enabled: ' + (enabled ? 'true' : 'false'),
    'Status: ' + status
  ];
  var help = brainiacSetupHelp(status);
  if (help) lines.push('', 'Next step: ' + help);
  return lines.join('\n');
}

function brainiacWriteConfig(us, enabled, status) {
  var next = brainiacConfigText(enabled, status);
  var current = us.cardText(us.findCard(BRAINIAC_CONFIG_CARD));
  if (current !== next) us.upsertCard(BRAINIAC_CONFIG_CARD, next);
}

function brainiacStatus(runtimeOnline, aiPresent, enabled, runtime) {
  if (!runtimeOnline) return 'Waiting for Ultrascripts';
  if (!enabled) return 'Ready';
  if (!aiPresent || !runtime.aiReady) return 'AI unavailable';
  if (runtime.query) return 'Thinking';
  return 'Ready';
}

function brainiacSetupHelp(status) {
  if (status === 'Waiting for Ultrascripts') {
    return 'Download and install BetterDungeon if you do not have it, or open BetterDungeon and enable Ultrascripts.';
  }
  if (status === 'AI unavailable') {
    return 'Open BetterDungeon, enable the Ultrascripts AI module, and configure its provider, model, and API key.';
  }
  return '';
}

function brainiacNotifyAiSetup(runtime, enabled, aiPresent, status) {
  var provenUnavailable = !aiPresent || (runtime.aiStatusKnown && !runtime.aiReady);
  if (!enabled || status !== 'AI unavailable' || !provenUnavailable) {
    if (status === 'Ready' || !enabled) runtime.lastSetupNotice = null;
    return;
  }
  if (runtime.lastSetupNotice === 'AI unavailable') return;
  state.message = 'Brainiac found Ultrascripts, but the AI module is not ready. ' + brainiacSetupHelp('AI unavailable') + ' Normal AI Dungeon play will continue without Brainiac until it is ready.';
  runtime.lastSetupNotice = 'AI unavailable';
}

function brainiacMaybeRequestStatus(us, runtime) {
  if (runtime.aiReady || runtime.statusRequestId) return;
  if (us.liveCount() < Number(runtime.nextStatusLiveCount || 0)) return;
  runtime.statusRequestId = us.call('ai', 'status', {});
}

function brainiacConsumeStatusResponse(us, runtime) {
  if (!runtime.statusRequestId) return;
  var response = us.result('ai', runtime.statusRequestId);
  if (!response) return;

  runtime.statusRequestId = null;
  var data = response.status === 'ok' ? response.data : null;
  runtime.aiReady = !!(data && data.ready === true && data.supports && data.supports.text === true);
  runtime.aiStatusKnown = true;
  runtime.nextStatusLiveCount = runtime.aiReady
    ? 0
    : us.liveCount() + BRAINIAC_STATUS_RETRY_TURNS;
}

function brainiacConsumeQueryResponse(us, runtime, enabled) {
  if (!runtime.query || !runtime.query.id) return;
  var response = us.result('ai', runtime.query.id);
  if (!response) return;

  var request = runtime.query;
  runtime.query = null;

  if (!enabled) return;

  if (response.status !== 'ok') {
    runtime.aiReady = false;
    runtime.aiStatusKnown = true;
    runtime.nextStatusLiveCount = us.liveCount() + BRAINIAC_STATUS_RETRY_TURNS;
    return;
  }

  var data = response.data;
  var revisedBrain = data && typeof data.text === 'string' ? data.text.trim() : '';
  if (!revisedBrain || revisedBrain.length > BRAINIAC_MAX_BRAIN_CHARS) return;

  var currentBrain = brainiacReadBrain(us);
  if (currentBrain !== request.brainText) return;

  us.upsertCard(BRAINIAC_BRAIN_CARD, revisedBrain);
}

function brainiacContextSuffix(brain) {
  return [
    '',
    '',
    '<brainiac-editorial-memory>',
    'Quietly internalize this editable editorial memory. Preserve the story\'s natural prose; use it as gentle guidance rather than a checklist or a response to quote.',
    brain,
    '</brainiac-editorial-memory>'
  ].join('\n');
}

function brainiacBuildPrompt(contextText, outputText, brainText) {
  var instructions = [
    'You are Brainiac, an auxiliary editorial mind for an ongoing interactive story.',
    'Revise the existing brain using the supplied story evidence.',
    'Keep the player-edited existing brain authoritative: retain its intended facts, corrections, priorities, and guidance unless newer story evidence clearly updates a temporary detail.',
    'Notice only what currently matters for continuity, logic, character understanding, motivations, unresolved developments, and coherent future storytelling.',
    'Keep guidance gentle. Do not write the next story response, imitate story prose, or force a fixed plot.',
    'Return only one concise natural-language brain note. Use no JSON, code fences, preamble, headings, or commentary.',
    'The complete response must be no more than ' + BRAINIAC_MAX_BRAIN_CHARS + ' characters.'
  ].join('\n');

  var brain = typeof brainText === 'string' && brainText.trim()
    ? brainText
    : '(No brain has been written yet.)';
  var output = typeof outputText === 'string' ? outputText : '';
  var context = typeof contextText === 'string' ? contextText : '';

  var beforeContext = [
    instructions,
    '',
    '<existing-brain>',
    brain,
    '</existing-brain>',
    '',
    '<story-context>'
  ].join('\n');
  var afterContext = [
    '</story-context>',
    '',
    '<latest-story-output>',
    output,
    '</latest-story-output>',
    '',
    'Revised brain:'
  ].join('\n');

  var contextBudget = BRAINIAC_MAX_PROMPT_CHARS - beforeContext.length - afterContext.length - 2;
  if (contextBudget < 0) return null;

  var fittedContext = brainiacTrimMiddle(context, contextBudget);
  var prompt = beforeContext + '\n' + fittedContext + '\n' + afterContext;
  return prompt.length <= BRAINIAC_MAX_PROMPT_CHARS ? prompt : null;
}

function brainiacTrimMiddle(text, maxChars) {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;

  var marker = '\n[...older context omitted to fit the Brainiac request...]\n';
  if (maxChars <= marker.length) return text.slice(text.length - maxChars);

  var remaining = maxChars - marker.length;
  var headChars = Math.floor(remaining * 0.35);
  var tailChars = remaining - headChars;
  return text.slice(0, headChars) + marker + text.slice(text.length - tailChars);
}

function brainiacCreateUltrascriptsSdk() {
  state.__brainiacUltrascripts = state.__brainiacUltrascripts || {};
  var store = state.__brainiacUltrascripts;
  store.pendingRequests = store.pendingRequests || [];
  store.pendingAcks = store.pendingAcks || [];
  store.results = store.results || {};
  store.reqCounter = Number(store.reqCounter || 0);
  if (typeof store.heartbeatAvailable !== 'boolean') store.heartbeatAvailable = false;

  function cards() {
    return typeof storyCards !== 'undefined' && Array.isArray(storyCards) ? storyCards : [];
  }

  function cardMatches(card, title) {
    if (!card) return false;
    if (card.title === title || card.key === title || card.keys === title) return true;
    return Array.isArray(card.keys) && card.keys.indexOf(title) !== -1;
  }

  function findCard(title) {
    var list = cards();
    for (var i = 0; i < list.length; i++) {
      if (cardMatches(list[i], title)) return list[i];
    }
    return null;
  }

  function findCardIndex(title) {
    var list = cards();
    for (var i = 0; i < list.length; i++) {
      if (cardMatches(list[i], title)) return i;
    }
    return -1;
  }

  function cardText(card) {
    if (!card) return '';
    if (card.value !== undefined && card.value !== null) return String(card.value);
    if (card.entry !== undefined && card.entry !== null) return String(card.entry);
    if (card.description !== undefined && card.description !== null) return String(card.description);
    return '';
  }

  function upsertCard(title, value) {
    var index = findCardIndex(title);
    if (index >= 0) {
      var card = cards()[index];
      if (cardText(card) === value) return;
      if (typeof updateStoryCard === 'function') {
        updateStoryCard(index, card.keys || card.key || card.title || title, value, card.type || 'Ultrascripts');
      }
      return;
    }
    if (typeof addStoryCard === 'function') addStoryCard(title, value, 'Ultrascripts');
  }

  function parseCard(title) {
    var card = findCard(title);
    if (!card) return null;
    try { return JSON.parse(cardText(card) || '{}'); } catch (error) { return null; }
  }

  function liveCount() {
    if (typeof info !== 'undefined' && info && Number.isFinite(Number(info.actionCount))) {
      return Number(info.actionCount);
    }
    return 0;
  }

  function heartbeatScore(heartbeat) {
    if (!heartbeat || !heartbeat.ultrascripts || heartbeat.ultrascripts.protocol !== 1) return -1;
    if (heartbeat.ultrascripts.client !== 'BetterDungeon' || heartbeat.ultrascripts.archived) return -1;
    var beat = Number(heartbeat.ultrascripts.beat);
    return Number.isFinite(beat) && beat >= 0 && Math.floor(beat) === beat ? beat : -1;
  }

  function heartbeat() {
    var list = cards();
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < list.length; i++) {
      if (!cardMatches(list[i], 'ultrascripts:heartbeat')) continue;
      try {
        var candidate = JSON.parse(cardText(list[i]) || '{}');
        var score = heartbeatScore(candidate);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      } catch (error) {}
    }
    return best;
  }

  function observeHeartbeat(hook) {
    if (hook !== 'input') return store.heartbeatAvailable;
    var current = heartbeat();
    var beat = heartbeatScore(current);
    var valid = !!(current && current.ultrascripts && current.ultrascripts.enabled && beat >= 0);
    if (!valid) {
      store.heartbeatAvailable = false;
      return false;
    }
    store.heartbeatAvailable = store.lastHeartbeatBeat === undefined ||
      store.lastHeartbeatBeat === null || beat !== store.lastHeartbeatBeat;
    store.lastHeartbeatBeat = beat;
    return store.heartbeatAvailable;
  }

  function moduleList(currentHeartbeat) {
    var raw = currentHeartbeat && currentHeartbeat.modules;
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'object') return [];
    var list = [];
    for (var id in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
      var moduleInfo = raw[id];
      if (moduleInfo && typeof moduleInfo === 'object') {
        if (!moduleInfo.id) moduleInfo.id = id;
        list.push(moduleInfo);
      } else if (moduleInfo) {
        list.push({ id: id, ops: [] });
      }
    }
    return list;
  }

  function opList(moduleInfo) {
    var raw = moduleInfo && (moduleInfo.ops || moduleInfo.operations || moduleInfo.capabilities);
    if (Array.isArray(raw)) {
      return raw.map(function (op) {
        return typeof op === 'string' ? op : (op && (op.id || op.name || op.op));
      }).filter(Boolean);
    }
    return raw && typeof raw === 'object' ? Object.keys(raw) : [];
  }

  function has(moduleId, opName) {
    var modules = moduleList(heartbeat());
    for (var i = 0; i < modules.length; i++) {
      var moduleInfo = modules[i];
      if (!moduleInfo || moduleInfo.id !== moduleId) continue;
      return !opName || opList(moduleInfo).indexOf(opName) !== -1;
    }
    return false;
  }

  function rememberResult(moduleId, requestId, response) {
    store.results[moduleId] = store.results[moduleId] || {};
    store.results[moduleId][requestId] = response;
    var ids = Object.keys(store.results[moduleId]);
    while (ids.length > 30) {
      delete store.results[moduleId][ids.shift()];
    }
  }

  function tick() {
    var modules = moduleList(heartbeat());
    for (var i = 0; i < modules.length; i++) {
      var moduleId = modules[i] && modules[i].id;
      if (!moduleId) continue;
      var inbox = parseCard('ultrascripts:in:' + moduleId);
      if (!inbox || !inbox.responses) continue;
      for (var requestId in inbox.responses) {
        if (!Object.prototype.hasOwnProperty.call(inbox.responses, requestId)) continue;
        var response = inbox.responses[requestId];
        if (!response || ['ok', 'err', 'timeout'].indexOf(response.status) === -1) continue;
        rememberResult(moduleId, requestId, response);
        if (store.pendingAcks.indexOf(requestId) === -1) store.pendingAcks.push(requestId);
      }
    }
  }

  function call(moduleId, opName, args) {
    store.reqCounter += 1;
    var requestId = moduleId + '.' + opName + '#' + liveCount() + '.' + store.reqCounter;
    store.pendingRequests.push({
      id: requestId,
      module: moduleId,
      op: opName,
      args: args || {},
      ts: Date.now()
    });
    return requestId;
  }

  function result(moduleId, requestId) {
    var bucket = store.results[moduleId];
    return bucket && bucket[requestId] ? bucket[requestId] : null;
  }

  function commit() {
    if (!store.pendingRequests.length && !store.pendingAcks.length) return;
    upsertCard('ultrascripts:out', JSON.stringify({
      v: 1,
      requests: store.pendingRequests,
      acks: store.pendingAcks
    }));
    store.pendingRequests = [];
    store.pendingAcks = [];
  }

  return {
    findCard: findCard,
    cardText: cardText,
    upsertCard: upsertCard,
    liveCount: liveCount,
    observeHeartbeat: observeHeartbeat,
    available: function () { return store.heartbeatAvailable && !!heartbeat(); },
    has: has,
    tick: tick,
    call: call,
    result: result,
    commit: commit
  };
}
