// ============================================================
// LIBRARY - Ultrascripts Required Template
// ============================================================
// Paste this file into AI Dungeon's Library script, then paste the companion
// Input, Context, and Output modifier files into their matching hooks.
//
// This template is "requires Ultrascripts": the scenario's core flow depends
// on BetterDungeon and the listed Ultrascripts modules being available.

globalThis.bd = globalThis.bd || {};
var bd = globalThis.bd;

globalThis.UltrascriptsRequiredTemplate = function UltrascriptsRequiredTemplate(hook, inputText) {
  var text = inputText;

  var CONFIG = {
    commandPrefix: '/us-required',
    publishWidgets: true,
    addContextNote: false,
    requestClock: true,
    requestSdkConfig: true,
    requestAiStatus: true,
    requireUltrascripts: true,
    requiredCapabilities: [
      { module: 'widget' },
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
      var handled = handleTemplateCommand(command, us, templateState);
      text = handled.text;
      us.commit();
      return { text: text };
    }
  }

  var runtimeOnline = us.available();

  if (CONFIG.requireUltrascripts && !runtimeOnline) {
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
  var aiStatus = us.latest('ai', 'status');

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

  if (
    CONFIG.requestAiStatus &&
    runtimeOnline &&
    us.has('ai', 'status') &&
    !aiStatus &&
    templateState.lastAiStatusRequestLiveCount !== us.liveCount()
  ) {
    templateState.lastAiStatusRequestLiveCount = us.liveCount();
    us.call('ai', 'status');
  }

  if (hook === 'context') {
    consumeTemplateWidgetEvents(us, templateState);

    if (CONFIG.publishWidgets && runtimeOnline && us.has('widget')) {
      publishTemplateDashboard(us, cfg, clock, aiStatus);
    }

    if (CONFIG.addContextNote) {
      text += '\n[Ultrascripts template status: ' + buildStatusLine(us, cfg, clock, aiStatus) + ']';
    }
  }

  if (hook === 'output') {
    templateState.lastOutputLiveCount = us.liveCount();
    tickRequiredTemplateTest(us, templateState, CONFIG);
  }

  us.commit();
  return { text: text };
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
        log('Ultrascripts required template could not update story card: updateStoryCard is unavailable.');
      }
    } else if (typeof addStoryCard === 'function') {
      addStoryCard(title, value, 'Ultrascripts');
    } else if (typeof log === 'function') {
      log('Ultrascripts required template could not add story card: addStoryCard is unavailable.');
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
    state.ultrascriptsRequiredTemplate = {};
    state.__ultrascriptsRequiredSdk = {};
    state.ultrascriptsRequiredTemplateTest = null;
    state.message = 'Ultrascripts required template state reset.';
    return { text: 'I pause for a moment while the required scenario state resets.' };
  }

  if (command.name === 'status') {
    state.message = buildStatusLine(us, us.latest('sdk', 'config'), us.latest('clock', 'now'), us.latest('ai', 'status'));
    return { text: 'I check the required scenario status.' };
  }

  if (command.name === 'test') {
    var sub = (command.args && command.args[0] || 'start').toLowerCase();
    if (sub === 'reset') {
      state.ultrascriptsRequiredTemplateTest = null;
      state.message = 'Required template test suite reset.';
      return { text: 'I reset the required template test suite.' };
    }
    if (sub === 'status') {
      var tState = state.ultrascriptsRequiredTemplateTest;
      if (!tState || !tState.started) {
        state.message = 'Required template test suite has not been started. Use /us-required test to begin.';
      } else {
        state.message = 'Required template test: ' + tState.phase + ' (' + tState.completedSteps + '/' + tState.totalSteps + ' steps, ' + tState.passCount + ' passed, ' + tState.failCount + ' failed).';
      }
      return { text: 'I check the required template test status.' };
    }
    state.ultrascriptsRequiredTemplateTest = createRequiredTemplateTestState();
    state.ultrascriptsRequiredTemplateTest.started = true;
    state.message = 'Required template test suite started. It will run one step per turn. Check the ultrascripts:test:required-template card for results.';
    return { text: 'I start the required template test suite. One step will run each turn.' };
  }

  state.message = 'Unknown required template command. Try /us-required status, /us-required test, or /us-required reset.';
  return { text: 'I try an unknown required scenario command.' };
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
    return { text: 'I pause because this scenario requires Ultrascripts before it can continue.' };
  }

  if (hook === 'context') {
    return { text: '[Ultrascripts required: ' + fullMessage + ']\n' + (text || '') };
  }

  return { text: text };
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

function publishTemplateDashboard(us, cfg, clock, aiStatus) {
  var modules = [];
  ['widget', 'clock', 'sdk', 'ai', 'webfetch', 'weather', 'network', 'system'].forEach(function (id) {
    if (us.has(id)) modules.push(id);
  });

  var aiReady = !!(aiStatus && aiStatus.status === 'ok' && aiStatus.data && aiStatus.data.ready);
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
    runtime: 'BetterDungeon Ultrascripts required and online',
    turn: us.liveCount(),
    clock: clockText,
    modules: { items: modules.length ? modules : ['none'] },
    ai: { text: aiReady ? 'configured' : 'not configured', color: aiReady ? '#22c55e' : '#f59e0b' }
  });
}

function buildStatusLine(us, cfg, clock, aiStatus) {
  var runtime = us.available() ? 'online' : 'missing';
  var sdk = cfg && cfg.status === 'ok' ? 'config loaded' : (us.has('sdk', 'config') ? 'config pending' : 'sdk unavailable');
  var clockText = clock && clock.status === 'ok' && clock.data ? (clock.data.local || clock.data.iso || 'ready') : 'pending';
  var ai = aiStatus && aiStatus.status === 'ok' && aiStatus.data && aiStatus.data.ready ? 'ai ready' : (us.has('ai', 'status') ? 'ai pending' : 'ai unavailable');
  return 'Required Ultrascripts ' + runtime + '; ' + sdk + '; clock ' + clockText + '; ' + ai + '.';
}

// ============================================================
// REQUIRED TEMPLATE TEST SUITE
// ============================================================
// Self-test system for the Ultrascripts Required Template. Verifies
// the SDK helper API surface, widget publishing, command parsing,
// dashboard rendering, and required-capability gating. Triggered
// with `/us-required test`. One step runs per output-hook turn.
// Results are written to the `ultrascripts:test:required-template`
// story card.
//
// Commands:
//   /us-required test         - start the test suite
//   /us-required test status  - show current test progress
//   /us-required test reset   - clear test state and stop

var REQUIRED_TEMPLATE_TEST_STEPS = [
  {
    label: 'api-surface',
    desc: 'All 15 SDK helper functions exist and are callable',
    run: function (us) {
      var expected = ['findCard', 'upsertCard', 'parseCard', 'liveCount', 'heartbeat',
        'available', 'has', 'tick', 'call', 'latest',
        'defineWidget', 'publishWidget', 'widgetEvents', 'ackWidget', 'commit'];
      var missing = [];
      for (var i = 0; i < expected.length; i++) {
        if (typeof us[expected[i]] !== 'function') missing.push(expected[i]);
      }
      if (missing.length) return { pass: false, reason: 'missing functions: ' + missing.join(', ') };
      return { pass: true, detail: expected.length + ' functions verified' };
    }
  },
  {
    label: 'heartbeat-detect',
    desc: 'available() returns a boolean matching heartbeat card presence',
    run: function (us) {
      var avail = us.available();
      var hb = us.heartbeat();
      if (typeof avail !== 'boolean') return { pass: false, reason: 'available() did not return a boolean' };
      if (avail !== !!hb) return { pass: false, reason: 'available()=' + avail + ' but heartbeat present=' + !!hb };
      return { pass: true, detail: 'available=' + avail };
    }
  },
  {
    label: 'has-detection',
    desc: 'has() returns a boolean for module capability queries',
    run: function (us) {
      var hasWidget = us.has('widget');
      var hasFake = us.has('definitelyNotAModule');
      if (typeof hasWidget !== 'boolean') return { pass: false, reason: 'has(widget) did not return a boolean' };
      if (hasFake !== false) return { pass: false, reason: 'has(nonexistent) should return false' };
      return { pass: true, detail: 'has(widget)=' + hasWidget };
    }
  },
  {
    label: 'live-count',
    desc: 'liveCount() returns a non-negative finite number',
    run: function (us) {
      var lc = us.liveCount();
      if (typeof lc !== 'number' || !isFinite(lc) || lc < 0) {
        return { pass: false, reason: 'liveCount() returned ' + lc };
      }
      return { pass: true, detail: 'liveCount=' + lc };
    }
  },
  {
    label: 'call-queue',
    desc: 'call() returns a string requestId and queues a pending request',
    run: function (us) {
      var store = state.__ultrascriptsRequiredSdk;
      var beforeLen = store.pendingRequests.length;
      var reqId = us.call('test-probe', 'ping', { value: 1 });
      var afterLen = store.pendingRequests.length;
      if (afterLen > beforeLen) store.pendingRequests.pop();
      if (typeof reqId !== 'string' || !reqId) return { pass: false, reason: 'call() did not return a string requestId' };
      if (afterLen !== beforeLen + 1) return { pass: false, reason: 'pendingRequests grew by ' + (afterLen - beforeLen) + ', expected 1' };
      return { pass: true, detail: 'requestId=' + reqId };
    }
  },
  {
    label: 'latest-no-result',
    desc: 'latest() returns null for a module with no responses',
    run: function (us) {
      var result = us.latest('definitelyNoResults', 'noop');
      if (result !== null) return { pass: false, reason: 'latest() should return null, got ' + typeof result };
      return { pass: true };
    }
  },
  {
    label: 'tick-no-crash',
    desc: 'tick() runs without throwing an error',
    run: function (us) {
      try { us.tick(); } catch (e) {
        return { pass: false, reason: 'tick() threw: ' + (e && e.message ? e.message : String(e)) };
      }
      return { pass: true };
    }
  },
  {
    label: 'widget-define',
    desc: 'defineWidget() sets store.widget with the provided manifest',
    run: function (us) {
      var store = state.__ultrascriptsRequiredSdk;
      var saved = store.widget;
      try {
        us.defineWidget({ widgets: [{ id: 'testWidget', type: 'text', label: 'Test' }] });
        if (!store.widget || !store.widget.manifest) return { pass: false, reason: 'store.widget.manifest not set' };
        if (!store.widget.manifest.widgets || store.widget.manifest.widgets.length !== 1) {
          return { pass: false, reason: 'manifest.widgets not stored correctly' };
        }
        return { pass: true, detail: 'manifest with ' + store.widget.manifest.widgets.length + ' widget(s) stored' };
      } finally { store.widget = saved; }
    }
  },
  {
    label: 'widget-publish',
    desc: 'publishWidget() writes history entry and updates state card',
    run: function (us) {
      var store = state.__ultrascriptsRequiredSdk;
      var saved = store.widget;
      try {
        us.defineWidget({ widgets: [{ id: 'probe', type: 'stat', label: 'Probe' }] });
        us.publishWidget({ probe: 42 });
        var lc = us.liveCount();
        if (!store.widget.history || !store.widget.history[lc]) {
          return { pass: false, reason: 'history entry for liveCount ' + lc + ' not found' };
        }
        if (store.widget.history[lc].probe !== 42) return { pass: false, reason: 'history value mismatch' };
        return { pass: true, detail: 'history[' + lc + '].probe=42' };
      } finally { store.widget = saved; }
    }
  },
  {
    label: 'widget-events',
    desc: 'widgetEvents() returns an array (possibly empty)',
    run: function (us) {
      var events = us.widgetEvents();
      if (!Array.isArray(events)) return { pass: false, reason: 'widgetEvents() did not return an array' };
      return { pass: true, detail: events.length + ' event(s)' };
    }
  },
  {
    label: 'widget-ack',
    desc: 'ackWidget() updates the interaction ackSeq',
    run: function (us) {
      var store = state.__ultrascriptsRequiredSdk;
      var saved = store.widget;
      try {
        us.defineWidget({ widgets: [{ id: 'ackTest', type: 'text', label: 'Ack' }] });
        var beforeSeq = (store.widget.interactions && store.widget.interactions.ackSeq) || 0;
        us.ackWidget(999);
        var afterSeq = (store.widget.interactions && store.widget.interactions.ackSeq) || 0;
        if (afterSeq < 999) return { pass: false, reason: 'ackSeq=' + afterSeq + ', expected >= 999' };
        return { pass: true, detail: 'ackSeq ' + beforeSeq + ' -> ' + afterSeq };
      } finally { store.widget = saved; }
    }
  },
  {
    label: 'command-parse-valid',
    desc: 'readTemplateCommand parses a valid /us-required command',
    run: function () {
      var cmd = readTemplateCommand('/us-required status', '/us-required');
      if (!cmd) return { pass: false, reason: 'returned null for valid command' };
      if (cmd.name !== 'status') return { pass: false, reason: 'name=' + cmd.name + ', expected status' };
      return { pass: true, detail: 'name=' + cmd.name };
    }
  },
  {
    label: 'command-parse-say',
    desc: 'readTemplateCommand strips say-action formatting',
    run: function () {
      var cmd = readTemplateCommand('> You say "/us-required test"', '/us-required');
      if (!cmd) return { pass: false, reason: 'returned null for say-formatted command' };
      if (cmd.name !== 'test') return { pass: false, reason: 'name=' + cmd.name + ', expected test' };
      return { pass: true, detail: 'name=' + cmd.name };
    }
  },
  {
    label: 'command-parse-invalid',
    desc: 'readTemplateCommand returns null for non-matching input',
    run: function () {
      var cmd = readTemplateCommand('I walk north.', '/us-required');
      if (cmd !== null) return { pass: false, reason: 'should return null for non-command text' };
      return { pass: true };
    }
  },
  {
    label: 'status-line',
    desc: 'buildStatusLine returns a non-empty descriptive string',
    run: function (us) {
      var line = buildStatusLine(us, us.latest('sdk', 'config'), us.latest('clock', 'now'), us.latest('ai', 'status'));
      if (typeof line !== 'string' || !line) return { pass: false, reason: 'returned empty or non-string' };
      if (line.indexOf('Required Ultrascripts') === -1) return { pass: false, reason: 'missing "Required Ultrascripts" prefix' };
      return { pass: true, detail: line };
    }
  },
  {
    label: 'dashboard-render',
    desc: 'publishTemplateDashboard writes a widget state card with valid types',
    run: function (us) {
      var store = state.__ultrascriptsRequiredSdk;
      var saved = store.widget;
      try {
        publishTemplateDashboard(us, us.latest('sdk', 'config'), us.latest('clock', 'now'), us.latest('ai', 'status'));
        if (!store.widget || !store.widget.manifest) return { pass: false, reason: 'store.widget.manifest not set after dashboard publish' };
        var widgets = store.widget.manifest.widgets || [];
        if (widgets.length < 3) return { pass: false, reason: 'expected at least 3 dashboard widgets, got ' + widgets.length };
        var validTypes = ['stat', 'bar', 'text', 'panel', 'custom', 'badge', 'list', 'icon', 'counter',
          'button', 'toggle', 'select', 'slider', 'input', 'textarea', 'progress', 'taggroup', 'divider',
          'radio', 'stepper', 'confirm', 'chipselect', 'accordion', 'tabs', 'dropdown', 'sortable'];
        for (var i = 0; i < widgets.length; i++) {
          if (validTypes.indexOf(widgets[i].type) === -1) {
            return { pass: false, reason: 'widget "' + widgets[i].id + '" has invalid type "' + widgets[i].type + '"' };
          }
        }
        return { pass: true, detail: widgets.length + ' dashboard widgets with valid types' };
      } finally { store.widget = saved; }
    }
  },
  {
    label: 'required-gating',
    desc: 'getMissingRequiredCapabilities detects missing modules correctly',
    run: function (us) {
      var fakeReqs = [
        { module: 'widget' },
        { module: 'sdk', op: 'config' },
        { module: 'definitelyNotAModule' },
        { module: 'anotherFake', op: 'noop' }
      ];
      var missing = getMissingRequiredCapabilities(us, fakeReqs);
      if (!Array.isArray(missing)) return { pass: false, reason: 'getMissingRequiredCapabilities did not return an array' };
      // The fake modules should always be in the missing list
      if (missing.indexOf('definitelyNotAModule') === -1) {
        return { pass: false, reason: 'definitelyNotAModule should be in missing list' };
      }
      if (missing.indexOf('anotherFake.noop') === -1) {
        return { pass: false, reason: 'anotherFake.noop should be in missing list' };
      }
      return { pass: true, detail: 'missing=' + missing.join(',') };
    }
  },
  {
    label: 'block-input',
    desc: 'blockRequiredTemplate returns placeholder text for input hook',
    run: function () {
      var result = blockRequiredTemplate('input', 'original text', 'Test requirement message');
      if (!result || typeof result.text !== 'string') return { pass: false, reason: 'did not return { text: string }' };
      if (result.text === 'original text') return { pass: false, reason: 'should replace text with placeholder for input hook' };
      if (typeof state.message !== 'string' || !state.message) return { pass: false, reason: 'state.message not set' };
      return { pass: true, detail: 'text="' + result.text + '"' };
    }
  },
  {
    label: 'block-context',
    desc: 'blockRequiredTemplate prepends warning for context hook',
    run: function () {
      var result = blockRequiredTemplate('context', 'original context', 'Test requirement message');
      if (!result || typeof result.text !== 'string') return { pass: false, reason: 'did not return { text: string }' };
      if (result.text.indexOf('original context') === -1) return { pass: false, reason: 'should preserve original context text' };
      if (result.text.indexOf('[Ultrascripts required:') === -1) return { pass: false, reason: 'should prepend warning prefix' };
      return { pass: true, detail: 'prepended warning to context' };
    }
  },
  {
    label: 'block-output',
    desc: 'blockRequiredTemplate passes text through for output hook',
    run: function () {
      var result = blockRequiredTemplate('output', 'original output', 'Test requirement message');
      if (!result || result.text !== 'original output') return { pass: false, reason: 'should pass text through unchanged for output hook' };
      return { pass: true };
    }
  }
];

function createRequiredTemplateTestState() {
  return {
    started: false,
    currentStep: 0,
    completedSteps: 0,
    totalSteps: REQUIRED_TEMPLATE_TEST_STEPS.length,
    passCount: 0,
    failCount: 0,
    phase: 'idle',
    results: {},
    events: [],
    startedAt: Date.now()
  };
}

function requiredTemplateTestNow() { return Date.now ? Date.now() : new Date().getTime(); }

function requiredTemplateTestLog(tState, event, detail) {
  tState.events.push({ at: requiredTemplateTestNow(), event: event, detail: detail || '' });
  while (tState.events.length > 30) tState.events.shift();
}

function tickRequiredTemplateTest(us, templateState, CONFIG) {
  var tState = state.ultrascriptsRequiredTemplateTest;
  if (!tState || !tState.started) return;
  if (tState.currentStep >= REQUIRED_TEMPLATE_TEST_STEPS.length) {
    tState.phase = tState.failCount === 0 ? 'complete' : 'complete-with-failures';
    writeRequiredTemplateTestTrace(tState, us);
    return;
  }

  var step = REQUIRED_TEMPLATE_TEST_STEPS[tState.currentStep];
  tState.phase = 'running ' + step.label;

  var result = { pass: false, reason: 'not run' };
  try {
    result = step.run(us, templateState, CONFIG) || result;
  } catch (e) {
    result = { pass: false, reason: 'threw: ' + (e && e.message ? e.message : String(e)) };
  }

  tState.results[step.label] = {
    pass: result.pass,
    reason: result.reason || '',
    detail: result.detail || null,
    ranAt: requiredTemplateTestNow()
  };

  if (result.pass) {
    tState.passCount++;
    requiredTemplateTestLog(tState, 'pass', step.label);
  } else {
    tState.failCount++;
    requiredTemplateTestLog(tState, 'fail', step.label + ': ' + (result.reason || ''));
  }

  tState.currentStep++;
  tState.completedSteps++;
  writeRequiredTemplateTestTrace(tState, us);
}

function writeRequiredTemplateTestTrace(tState, us) {
  var trace = {
    v: 1,
    suite: 'ultrascripts-required-template',
    startedAt: tState.startedAt,
    turn: tState.completedSteps,
    phase: tState.phase,
    runtime: us.available() ? 'online' : 'offline',
    liveCount: us.liveCount(),
    counts: {
      total: tState.totalSteps,
      completed: tState.completedSteps,
      pass: tState.passCount,
      fail: tState.failCount
    },
    allPassed: tState.completedSteps === tState.totalSteps && tState.failCount === 0,
    results: tState.results,
    events: tState.events,
    commands: [
      '/us-required test         - start the test suite',
      '/us-required test status  - show current test progress',
      '/us-required test reset   - clear test state and stop',
      '/us-required status       - show runtime status',
      '/us-required reset        - reset all template state'
    ]
  };

  var card = us.findCard('ultrascripts:test:required-template');
  var cardText = JSON.stringify(trace, null, 2);
  if (card) {
    var idx = -1;
    var cards = (typeof storyCards !== 'undefined' && Array.isArray(storyCards)) ? storyCards : [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i] === card) { idx = i; break; }
    }
    if (idx >= 0 && typeof updateStoryCard === 'function') {
      updateStoryCard(idx, card.keys || card.key || 'ultrascripts:test:required-template', cardText, card.type || 'Ultrascripts');
    }
  } else if (typeof addStoryCard === 'function') {
    addStoryCard('ultrascripts:test:required-template', cardText, 'Ultrascripts');
  }
}
