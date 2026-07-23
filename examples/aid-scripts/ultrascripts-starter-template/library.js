// ============================================================
// LIBRARY - Ultrascripts Starter Template
// ============================================================
// Paste this file into AI Dungeon's Library script, then paste the companion
// Input, Context, and Output modifier files into their matching hooks.
//
// This template is "enhanced with Ultrascripts": the adventure still works
// without BetterDungeon, while BetterDungeon players get widgets and module
// responses when the runtime is available.

globalThis.bd = globalThis.bd || {};
var bd = globalThis.bd;

globalThis.UltrascriptsTemplate = function UltrascriptsTemplate(hook, inputText) {
  var text = inputText;

  var CONFIG = {
    commandPrefix: ':us-template',
    publishWidgets: true,
    addContextNote: false,
    requestClock: true,
    requestSdkConfig: true,
    requireUltrascripts: false
  };

  state.ultrascriptsTemplate = state.ultrascriptsTemplate || {};
  var templateState = state.ultrascriptsTemplate;
  bd.us = createUltrascriptsSdk();
  var us = bd.us;

  us.tick();

  if (hook === 'input') {
    var command = readTemplateCommand(text, CONFIG.commandPrefix);
    if (command) {
      var handled = handleTemplateCommand(command, us, templateState);
      text = handled.text;
      us.commit();
      return { text: text };
    }
  }

  var runtimeOnline = us.available();

  if (CONFIG.requireUltrascripts && !runtimeOnline) {
    state.message = 'This scenario requires BetterDungeon with Ultrascripts enabled.';
    return { text: text };
  }

  var cfg = us.latest('sdk', 'config');
  var clock = us.latest('clock', 'now');

  if (
    CONFIG.requestSdkConfig &&
    runtimeOnline &&
    us.has('sdk', 'config') &&
    !cfg &&
    templateState.lastSdkConfigRequestLiveCount !== us.liveCount()
  ) {
    templateState.lastSdkConfigRequestLiveCount = us.liveCount();
    us.call('sdk', 'config');
  }

  if (
    CONFIG.requestClock &&
    runtimeOnline &&
    us.has('clock', 'now') &&
    templateState.lastClockRequestLiveCount !== us.liveCount()
  ) {
    templateState.lastClockRequestLiveCount = us.liveCount();
    us.call('clock', 'now');
  }

  if (hook === 'context') {
    consumeTemplateWidgetEvents(us, templateState);

    if (CONFIG.publishWidgets && runtimeOnline && us.has('widget')) {
      publishTemplateDashboard(us, cfg, clock);
    }

    if (CONFIG.addContextNote) {
      text += '\n[Ultrascripts template status: ' + buildStatusLine(us, cfg, clock) + ']';
    }
  }

  if (hook === 'output') {
    templateState.lastOutputLiveCount = us.liveCount();
  }

  us.commit();
  return { text: text };
};

function createUltrascriptsSdk() {
  state.__ultrascriptsSdk = state.__ultrascriptsSdk || {};
  var store = state.__ultrascriptsSdk;
  store.pendingRequests = store.pendingRequests || [];
  store.pendingAcks = store.pendingAcks || [];
  store.results = store.results || {};
  store.reqCounter = Number(store.reqCounter || 0);

  function findCard(title) {
    var cards = (typeof storyCards !== 'undefined' && Array.isArray(storyCards)) ? storyCards : [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (cardMatches(card, title)) return card;
    }
    return null;
  }

  function findCardIndex(title) {
    var cards = (typeof storyCards !== 'undefined' && Array.isArray(storyCards)) ? storyCards : [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (cardMatches(card, title)) return i;
    }
    return -1;
  }

  function cardMatches(card, title) {
    if (!card) return false;
    if (card.title === title || card.key === title) return true;
    if (card.keys === title) return true;
    if (Array.isArray(card.keys) && card.keys.indexOf(title) !== -1) return true;
    return false;
  }

  function cardText(card) {
    if (!card) return '';
    if (card.value !== undefined && card.value !== null) return card.value;
    if (card.entry !== undefined && card.entry !== null) return card.entry;
    if (card.description !== undefined && card.description !== null) return card.description;
    return '';
  }

  function upsertCard(title, value) {
    var index = findCardIndex(title);
    if (index >= 0) {
      var card = storyCards[index];
      if (typeof updateStoryCard === 'function') {
        updateStoryCard(index, card.keys || card.key || card.title || title, value, card.type || 'Ultrascripts');
      } else if (typeof log === 'function') {
        log('Ultrascripts template could not update story card: updateStoryCard is unavailable.');
      }
    } else if (typeof addStoryCard === 'function') {
      addStoryCard(title, value, 'Ultrascripts');
    } else if (typeof log === 'function') {
      log('Ultrascripts template could not add story card: addStoryCard is unavailable.');
    }
  }

  function parseCard(title) {
    var card = findCard(title);
    if (!card) return null;
    try { return JSON.parse(cardText(card) || '{}'); } catch (e) { return null; }
  }

  function liveCount() {
    if (typeof info !== 'undefined' && info && Number.isFinite(Number(info.actionCount))) return Number(info.actionCount);
    return 0;
  }

  function heartbeat() {
    var cards = (typeof storyCards !== 'undefined' && Array.isArray(storyCards)) ? storyCards : [];
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!cardMatches(card, 'ultrascripts:heartbeat')) continue;
      try {
        var hb = JSON.parse(cardText(card) || '{}');
        var score = heartbeatScore(hb);
        if (score > bestScore) {
          best = hb;
          bestScore = score;
        }
      } catch (e) {}
    }
    return best;
  }

  function heartbeatScore(hb) {
    if (!hb || !hb.ultrascripts || hb.ultrascripts.protocol !== 1) return -1;
    if (hb.ultrascripts.client !== 'BetterDungeon' || hb.ultrascripts.archived) return -1;
    var moduleCount = moduleList(hb).length;
    var writtenAt = Date.parse(hb.writtenAt || '') || 0;
    return moduleCount * 10000000000000 + writtenAt;
  }

  function moduleList(hb) {
    var raw = hb && hb.modules;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      var list = [];
      for (var id in raw) {
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
    return [];
  }

  function opList(moduleInfo) {
    var raw = moduleInfo && (moduleInfo.ops || moduleInfo.operations || moduleInfo.capabilities);
    if (Array.isArray(raw)) {
      return raw.map(function (op) {
        return typeof op === 'string' ? op : (op && (op.id || op.name || op.op));
      }).filter(Boolean);
    }
    if (raw && typeof raw === 'object') return Object.keys(raw);
    return [];
  }

  function has(moduleId, opName) {
    var hb = heartbeat();
    var mods = moduleList(hb);
    for (var i = 0; i < mods.length; i++) {
      var mod = mods[i];
      if (!mod || mod.id !== moduleId) continue;
      if (!opName) return true;
      var ops = opList(mod);
      return ops.indexOf(opName) !== -1;
    }
    return false;
  }

  function rememberResult(moduleId, requestId, response) {
    store.results[moduleId] = store.results[moduleId] || {};
    store.results[moduleId][requestId] = response;

    var ids = Object.keys(store.results[moduleId]);
    if (ids.length > 40) {
      ids.sort(function (a, b) {
        var ra = store.results[moduleId][a] || {};
        var rb = store.results[moduleId][b] || {};
        return Number(ra.completedAt || 0) - Number(rb.completedAt || 0);
      });
      while (ids.length > 40) delete store.results[moduleId][ids.shift()];
    }
  }

  function tick() {
    var hb = heartbeat();
    var mods = moduleList(hb);
    for (var i = 0; i < mods.length; i++) {
      var moduleId = mods[i] && mods[i].id;
      if (!moduleId) continue;
      var card = parseCard('ultrascripts:in:' + moduleId);
      if (!card || !card.responses) continue;

      for (var requestId in card.responses) {
        if (!Object.prototype.hasOwnProperty.call(card.responses, requestId)) continue;
        var response = card.responses[requestId];
        if (!response) continue;
        if (response.status === 'ok' || response.status === 'err' || response.status === 'timeout') {
          rememberResult(moduleId, requestId, response);
          if (store.pendingAcks.indexOf(requestId) === -1) store.pendingAcks.push(requestId);
        }
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

  function latest(moduleId, opName) {
    var bucket = store.results[moduleId];
    if (!bucket) return null;
    var prefix = opName ? (moduleId + '.' + opName + '#') : null;
    var best = null;

    for (var requestId in bucket) {
      if (!Object.prototype.hasOwnProperty.call(bucket, requestId)) continue;
      if (prefix && requestId.indexOf(prefix) !== 0) continue;
      var response = bucket[requestId];
      var responseLiveCount = Number(response.completedLiveCount || 0);
      if (responseLiveCount > liveCount()) continue;
      if (!best) {
        best = response;
        continue;
      }
      var bestLiveCount = Number(best.completedLiveCount || 0);
      var responseTime = Number(response.completedAt || 0);
      var bestTime = Number(best.completedAt || 0);
      if (responseLiveCount > bestLiveCount || (responseLiveCount === bestLiveCount && responseTime > bestTime)) {
        best = response;
      }
    }
    return best;
  }

  function defineWidget(manifest) {
    var existing = parseCard('ultrascripts:state:widget');
    var interactions = store.widget && store.widget.interactions
      ? store.widget.interactions
      : (existing && existing.interactions ? existing.interactions : { ackSeq: 0 });
    store.widget = {
      v: 1,
      manifest: manifest,
      history: existing && existing.history ? existing.history : {},
      interactions: interactions
    };
  }

  function publishWidget(values) {
    if (!store.widget) return;
    store.widget.history[liveCount()] = values;
    upsertCard('ultrascripts:state:widget', JSON.stringify(store.widget));
  }

  function widgetEvents() {
    var card = parseCard('ultrascripts:in:widget');
    var events = (card && card.widgetEvents && card.widgetEvents.events) || [];
    var ackSeq = (store.widget && store.widget.interactions && store.widget.interactions.ackSeq) || 0;
    return events.filter(function (event) {
      return event && Number(event.seq || 0) > ackSeq;
    });
  }

  function ackWidget(seq) {
    if (!store.widget) return;
    store.widget.interactions = store.widget.interactions || {};
    store.widget.interactions.ackSeq = Math.max(
      Number(store.widget.interactions.ackSeq || 0),
      Number(seq || 0)
    );
    upsertCard('ultrascripts:state:widget', JSON.stringify(store.widget));
  }

  function commit() {
    if (store.pendingRequests.length === 0 && store.pendingAcks.length === 0) return;
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
    upsertCard: upsertCard,
    parseCard: parseCard,
    liveCount: liveCount,
    heartbeat: heartbeat,
    available: function () { return !!heartbeat(); },
    has: has,
    tick: tick,
    call: call,
    latest: latest,
    defineWidget: defineWidget,
    publishWidget: publishWidget,
    widgetEvents: widgetEvents,
    ackWidget: ackWidget,
    commit: commit
  };
}

function readTemplateCommand(text, prefix) {
  var raw = String(text || '').trim();
  var normalized = raw
    .replace(/^>\s*You(?:\s+say)?\s*"?/i, '')
    .replace(/[".]\s*$/g, '')
    .trim();

  if (normalized.indexOf(prefix) !== 0) return null;
  var rest = normalized.slice(prefix.length).trim();
  var parts = rest ? rest.split(/\s+/) : [];
  return {
    name: (parts.shift() || 'status').toLowerCase(),
    args: parts
  };
}

function handleTemplateCommand(command, us, templateState) {
  if (command.name === 'reset') {
    state.ultrascriptsTemplate = {};
    state.__ultrascriptsSdk = {};
    state.message = 'Ultrascripts template state reset.';
    return { text: 'I pause for a moment while the scenario state resets.' };
  }

  if (command.name === 'status') {
    state.message = buildStatusLine(us, us.latest('sdk', 'config'), us.latest('clock', 'now'));
    return { text: 'I check the scenario status.' };
  }

  state.message = 'Unknown template command. Try :us-template status or :us-template reset.';
  return { text: 'I try an unknown scenario command.' };
}

function consumeTemplateWidgetEvents(us, templateState) {
  var events = us.widgetEvents();
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (!event) continue;
    templateState.lastWidgetEvent = {
      widgetId: event.widgetId,
      action: event.action,
      value: event.value,
      seq: event.seq
    };
    us.ackWidget(event.seq);
  }
}

function publishTemplateDashboard(us, cfg, clock) {
  var modules = [];
  ['widget', 'clock', 'sdk', 'ai', 'webfetch', 'weather', 'geolocation', 'network', 'system'].forEach(function (id) {
    if (us.has(id)) modules.push(id);
  });

  var aiReady = !!(cfg && cfg.status === 'ok' && cfg.data && cfg.data.ultrascripts && cfg.data.ultrascripts.ai && cfg.data.ultrascripts.ai.configured);
  var clockText = clock && clock.status === 'ok' && clock.data
    ? (clock.data.local || clock.data.iso || 'Clock ready')
    : (us.has('clock', 'now') ? 'Waiting for clock...' : 'Clock unavailable');

  us.defineWidget({
    widgets: [
      { id: 'runtime', type: 'text', label: 'Runtime' },
      { id: 'turn', type: 'stat', label: 'Live Count', color: '#60a5fa' },
      { id: 'clock', type: 'text', label: 'Clock' },
      { id: 'modules', type: 'taggroup', label: 'Mounted Modules' },
      { id: 'ai', type: 'badge', label: 'AI Module', color: aiReady ? '#22c55e' : '#f59e0b' }
    ]
  });

  us.publishWidget({
    runtime: 'BetterDungeon Ultrascripts online',
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
  return 'Ultrascripts ' + runtime + '; ' + sdk + '; clock ' + clockText + '.';
}
