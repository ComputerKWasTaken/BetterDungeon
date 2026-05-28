// ============================================================
// LIBRARY - Ultrascripts Required Template
// ============================================================
// Paste this file into AI Dungeon's Library script, then paste the companion
// Input, Context, and Output modifier files into their matching hooks.

globalThis.bd = globalThis.bd || {};
var bd = globalThis.bd;

globalThis.UltrascriptsRequiredTemplate = function UltrascriptsRequiredTemplate(hook, inputText) {
  var text = inputText;
  var stop = false;

  var CONFIG = {
    commandPrefix: ':us-required',
    publishWidgets: true,
    addContextNote: false,
    requestClock: true,
    requestSdkConfig: true,
    requireUltrascripts: true,
    requiredCapabilities: [
      { module: 'scripture' },
      { module: 'sdk', op: 'config' }
    ]
  };

  state.ultrascriptsRequiredTemplate = state.ultrascriptsRequiredTemplate || {};
  var templateState = state.ultrascriptsRequiredTemplate;
  bd.us = createUltrascriptsSdk();
  var us = bd.us;

  us.tick();

  if (hook === 'input') {
    var command = readTemplateCommand(text, CONFIG.commandPrefix);
    if (command) {
      var handled = handleTemplateCommand(command, us);
      text = handled.text;
      stop = handled.stop;
      us.commit();
      return stop ? { text: text, stop: true } : { text: text };
    }
  }

  if (CONFIG.requireUltrascripts && !us.available()) {
    us.commit();
    return blockRequiredTemplate(hook, text, 'This scenario requires BetterDungeon with Ultrascripts enabled.');
  }

  var missing = getMissingRequiredCapabilities(us, CONFIG.requiredCapabilities);
  if (missing.length) {
    us.commit();
    return blockRequiredTemplate(
      hook,
      text,
      'This scenario requires these Ultrascripts capabilities: ' + missing.join(', ') + '.'
    );
  }

  var cfg = us.latest('sdk', 'config');
  var clock = us.latest('clock', 'now');

  if (CONFIG.requestSdkConfig && us.available() && us.has('sdk', 'config') && !templateState.requestedSdkConfig) {
    templateState.requestedSdkConfig = true;
    us.call('sdk', 'config');
  }

  if (CONFIG.requestClock && us.available() && us.has('clock', 'now') && templateState.lastClockRequestLiveCount !== us.liveCount()) {
    templateState.lastClockRequestLiveCount = us.liveCount();
    us.call('clock', 'now');
  }

  if (hook === 'context') {
    consumeTemplateWidgetEvents(us, templateState);
    if (CONFIG.publishWidgets && us.available() && us.has('scripture')) {
      publishTemplateDashboard(us, cfg, clock);
    }
    if (CONFIG.addContextNote) {
      text += '\n[Ultrascripts template status: ' + buildStatusLine(us, cfg, clock) + ']';
    }
  }

  if (hook === 'output') templateState.lastOutputLiveCount = us.liveCount();

  us.commit();
  return stop ? { text: text, stop: true } : { text: text };
};

function createUltrascriptsSdk() {
  state.__ultrascriptsRequiredSdk = state.__ultrascriptsRequiredSdk || {};
  var store = state.__ultrascriptsRequiredSdk;
  store.pendingRequests = store.pendingRequests || [];
  store.pendingAcks = store.pendingAcks || [];
  store.results = store.results || {};
  store.reqCounter = Number(store.reqCounter || 0);

  function findCard(title) {
    var cards = (typeof storyCards !== 'undefined' && Array.isArray(storyCards)) ? storyCards : [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i] && cards[i].title === title) return cards[i];
    }
    return null;
  }

  function upsertCard(title, value) {
    var card = findCard(title);
    if (card) card.value = value;
    else if (typeof addStoryCard === 'function') addStoryCard(title, value);
  }

  function parseCard(title) {
    var card = findCard(title);
    if (!card) return null;
    try { return JSON.parse(card.value || '{}'); } catch (e) { return null; }
  }

  function liveCount() {
    if (typeof info !== 'undefined' && info && Number.isFinite(Number(info.actionCount))) return Number(info.actionCount);
    return 0;
  }

  function heartbeat() {
    var hb = parseCard('ultrascripts:heartbeat');
    if (!hb || !hb.ultrascripts || hb.ultrascripts.protocol !== 1) return null;
    if (hb.ultrascripts.client !== 'BetterDungeon') return null;
    return hb;
  }

  function has(moduleId, opName) {
    var hb = heartbeat();
    var mods = (hb && Array.isArray(hb.modules)) ? hb.modules : [];
    for (var i = 0; i < mods.length; i++) {
      var mod = mods[i];
      if (!mod || mod.id !== moduleId) continue;
      if (!opName) return true;
      var ops = Array.isArray(mod.ops) ? mod.ops : [];
      return ops.indexOf(opName) !== -1;
    }
    return false;
  }

  function rememberResult(moduleId, requestId, response) {
    store.results[moduleId] = store.results[moduleId] || {};
    store.results[moduleId][requestId] = response;
  }

  function tick() {
    var hb = heartbeat();
    var mods = (hb && Array.isArray(hb.modules)) ? hb.modules : [];
    for (var i = 0; i < mods.length; i++) {
      var moduleId = mods[i] && mods[i].id;
      if (!moduleId) continue;
      var card = parseCard('ultrascripts:in:' + moduleId);
      if (!card || !card.responses) continue;
      for (var requestId in card.responses) {
        if (!Object.prototype.hasOwnProperty.call(card.responses, requestId)) continue;
        var response = card.responses[requestId];
        if (response && (response.status === 'ok' || response.status === 'err' || response.status === 'timeout')) {
          rememberResult(moduleId, requestId, response);
          if (store.pendingAcks.indexOf(requestId) === -1) store.pendingAcks.push(requestId);
        }
      }
    }
  }

  function call(moduleId, opName, args) {
    store.reqCounter += 1;
    var requestId = moduleId + '.' + opName + '#' + liveCount() + '.' + store.reqCounter;
    store.pendingRequests.push({ id: requestId, module: moduleId, op: opName, args: args || {}, ts: Date.now() });
    return requestId;
  }

  function latest(moduleId, opName) {
    var bucket = store.results[moduleId];
    if (!bucket) return null;
    var prefix = opName ? (moduleId + '.' + opName + '#') : null;
    var best = null;
    for (var requestId in bucket) {
      if (!Object.prototype.hasOwnProperty.call(bucket, requestId)) continue;
      if (prefix && requestId.indexOf(prefix) !== 0) continue;
      var response = bucket[requestId];
      if (!best || Number(response.completedLiveCount || 0) > Number(best.completedLiveCount || 0)) best = response;
    }
    return best;
  }

  function defineScripture(manifest) {
    var existing = parseCard('ultrascripts:state:scripture');
    store.scripture = {
      v: 1,
      manifest: manifest,
      history: existing && existing.history ? existing.history : {},
      interactions: existing && existing.interactions ? existing.interactions : { ackSeq: 0 }
    };
  }

  function publishScripture(values) {
    if (!store.scripture) return;
    store.scripture.history[liveCount()] = values;
    upsertCard('ultrascripts:state:scripture', JSON.stringify(store.scripture));
  }

  function scriptureEvents() {
    var card = parseCard('ultrascripts:in:scripture');
    var events = (card && card.widgetEvents && card.widgetEvents.events) || [];
    var ackSeq = (store.scripture && store.scripture.interactions && store.scripture.interactions.ackSeq) || 0;
    return events.filter(function (event) { return event && Number(event.seq || 0) > ackSeq; });
  }

  function ackScripture(seq) {
    if (!store.scripture) return;
    store.scripture.interactions = store.scripture.interactions || {};
    store.scripture.interactions.ackSeq = Math.max(Number(store.scripture.interactions.ackSeq || 0), Number(seq || 0));
  }

  function commit() {
    if (store.pendingRequests.length === 0 && store.pendingAcks.length === 0) return;
    upsertCard('ultrascripts:out', JSON.stringify({ v: 1, requests: store.pendingRequests, acks: store.pendingAcks }));
    store.pendingRequests = [];
    store.pendingAcks = [];
  }

  return {
    liveCount: liveCount,
    heartbeat: heartbeat,
    available: function () { return !!heartbeat(); },
    has: has,
    tick: tick,
    call: call,
    latest: latest,
    defineScripture: defineScripture,
    publishScripture: publishScripture,
    scriptureEvents: scriptureEvents,
    ackScripture: ackScripture,
    commit: commit
  };
}

function readTemplateCommand(text, prefix) {
  var raw = String(text || '').trim();
  var normalized = raw.replace(/^>\s*You(?:\s+say)?\s*"?/i, '').replace(/[".]\s*$/g, '').trim();
  if (normalized.indexOf(prefix) !== 0) return null;
  var parts = normalized.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  return { name: (parts.shift() || 'status').toLowerCase(), args: parts };
}

function handleTemplateCommand(command, us) {
  if (command.name === 'reset') {
    state.ultrascriptsRequiredTemplate = {};
    state.__ultrascriptsRequiredSdk = {};
    state.message = 'Ultrascripts required template state reset.';
    return { text: null, stop: true };
  }
  if (command.name === 'status') {
    state.message = buildStatusLine(us, us.latest('sdk', 'config'), us.latest('clock', 'now'));
    return { text: null, stop: true };
  }
  state.message = 'Unknown required template command. Try :us-required status or :us-required reset.';
  return { text: null, stop: true };
}

function getMissingRequiredCapabilities(us, requiredCapabilities) {
  var missing = [];
  for (var i = 0; i < requiredCapabilities.length; i++) {
    var requirement = requiredCapabilities[i];
    if (!requirement || !requirement.module) continue;
    if (!us.has(requirement.module, requirement.op)) {
      missing.push(requirement.op ? requirement.module + '.' + requirement.op : requirement.module);
    }
  }
  return missing;
}

function blockRequiredTemplate(hook, text, message) {
  var fullMessage = message + ' Install/enable BetterDungeon or use an Enhanced with Ultrascripts script instead.';
  state.message = fullMessage;

  if (hook === 'input') {
    return { text: null, stop: true };
  }

  if (hook === 'context') {
    return { text: '[Ultrascripts required: ' + fullMessage + ']\n' + (text || '') };
  }

  return { text: text };
}

function consumeTemplateWidgetEvents(us, templateState) {
  var events = us.scriptureEvents();
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event) continue;
    templateState.lastWidgetEvent = { widgetId: event.widgetId, action: event.action, value: event.value, seq: event.seq };
    us.ackScripture(event.seq);
  }
}

function publishTemplateDashboard(us, cfg, clock) {
  var modules = [];
  ['scripture', 'clock', 'sdk', 'ai', 'webfetch', 'weather', 'geolocation', 'network', 'system'].forEach(function (id) {
    if (us.has(id)) modules.push(id);
  });

  var aiReady = !!(cfg && cfg.status === 'ok' && cfg.data && cfg.data.ultrascripts && cfg.data.ultrascripts.ai && cfg.data.ultrascripts.ai.configured);
  var clockText = clock && clock.status === 'ok' && clock.data
    ? (clock.data.local || clock.data.iso || 'Clock ready')
    : (us.has('clock', 'now') ? 'Waiting for clock...' : 'Clock unavailable');

  us.defineScripture({
    widgets: [
      { id: 'runtime', type: 'text', label: 'Runtime' },
      { id: 'turn', type: 'stat', label: 'Live Count', color: '#60a5fa' },
      { id: 'clock', type: 'text', label: 'Clock' },
      { id: 'modules', type: 'taggroup', label: 'Mounted Modules' },
      { id: 'ai', type: 'badge', label: 'AI Module', color: aiReady ? '#22c55e' : '#f59e0b' }
    ]
  });

  us.publishScripture({
    runtime: 'BetterDungeon Ultrascripts required and online',
    turn: us.liveCount(),
    clock: clockText,
    modules: { items: modules.length ? modules : ['none'] },
    ai: { text: aiReady ? 'configured' : 'not configured', color: aiReady ? '#22c55e' : '#f59e0b' }
  });
}

function buildStatusLine(us, cfg, clock) {
  var runtime = us.available() ? 'online' : 'missing';
  var sdk = cfg && cfg.status === 'ok' ? 'config loaded' : (us.has('sdk', 'config') ? 'config pending' : 'sdk unavailable');
  var clockText = clock && clock.status === 'ok' && clock.data ? (clock.data.local || clock.data.iso || 'ready') : 'pending';
  return 'Required Ultrascripts ' + runtime + '; ' + sdk + '; clock ' + clockText + '.';
}
