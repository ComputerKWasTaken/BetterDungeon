// Aura Cards - Ultrascripts AI Module example
//
// Aura Cards is a sidecar rebuild of the core Auto-Cards idea. It watches
// normal gameplay, asks Ultrascripts's AI module to extract durable lore as
// structured JSON, and then creates or updates story cards without making the
// story model stop and write cards.
//
// Setup:
//   1. Enable BetterDungeon -> Ultrascripts.
//   2. Enable the AI module and save an OpenRouter key.
//   3. Paste this file into the AI Dungeon Library tab.
//   4. Paste output.js into the Output Modifier tab.
//   5. Start/resume an adventure. Aura Cards is enabled by default.

var AURA_CARDS_MODEL = '';

var AURA_CONFIG_CARD_TITLE = 'Configure Aura Cards';
var AURA_TRACE_CARD_TITLE = 'Aura Cards Trace';
var AURA_CARD_TYPE = 'Aura';
var AURA_METADATA_MARKER = 'Aura Cards metadata:';
var AURA_MEMORY_MARKER = 'Memories:';

var AURA_DEFAULT_BANNED_TITLES = [
  'North', 'East', 'South', 'West',
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'You', 'Your', 'The Player', 'Player', 'Story', 'Recent Story',
  'World Lore', 'Memories', 'Author Note', 'Authors Note',
  'Configure Aura Cards', 'Aura Cards Trace',
  'ultrascripts:out', 'ultrascripts:heartbeat', 'ultrascripts:in:ai'
];

var AURA_DEFAULT_CONFIG = {
  enabled: true,
  cooldownTurns: 4,
  lookbackActions: 18,
  maxCardsPerSweep: 5,
  maxConcurrentRequests: 2,
  minConfidence: 0.5,
  entryLimit: 900,
  memoryLimit: 3200,
  maxPendingTurns: 14,
  showTrace: true,
  model: '',
  bannedTitles: AURA_DEFAULT_BANNED_TITLES.slice()
};

function auraCardsState() {
  var s = state.auraCards;
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  state.auraCards = s;

  s.v = 1;
  s.runId = s.runId || null;
  s.turn = auraStateNumber(s.turn, 0);
  s.seq = auraStateNumber(s.seq, 0);
  s.outSeq = auraStateNumber(s.outSeq, 0);
  s.cooldown = auraStateNumber(s.cooldown, 0);
  s.lastSweepLiveKey = auraStateNumber(s.lastSweepLiveKey, 0);
  s.lastStorySig = s.lastStorySig || '';
  s.phase = s.phase || 'boot';
  s.pending = auraPlainObject(s.pending);
  s.requestMeta = auraPlainObject(s.requestMeta);
  s.completed = auraPlainObject(s.completed);
  s.acked = auraPlainObject(s.acked);
  s.ackAttempts = auraPlainObject(s.ackAttempts);
  s.events = Array.isArray(s.events) ? s.events : [];
  s.index = auraPlainObject(s.index);
  s.lastConfig = auraPlainObjectOrNull(s.lastConfig);
  s.stats = auraPlainObject(s.stats);
  auraEnsureStats(s.stats);
  s._acks = Array.isArray(s._acks) ? s._acks : [];

  return s;
}

function auraPlainObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
}

function auraPlainObjectOrNull(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : null;
}

function auraStateNumber(value, fallback) {
  var n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function auraEnsureStats(stats) {
  var defaults = { created: 0, updated: 0, compressed: 0, skipped: 0, failed: 0, queued: 0 };
  for (var key in defaults) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
    if (typeof stats[key] !== 'number' || !Number.isFinite(stats[key])) {
      stats[key] = defaults[key];
    }
  }
}

function auraNow() {
  return Date.now ? Date.now() : new Date().getTime();
}

function auraIso() {
  try {
    return new Date(auraNow()).toISOString();
  } catch (err) {
    return String(auraNow());
  }
}

function auraRunId() {
  var s = auraCardsState();
  if (!s.runId) s.runId = 'aura-cards-' + auraNow().toString(36);
  return s.runId;
}

function auraCards() {
  return auraHasCardArray() ? storyCards : [];
}

function auraHasCardArray() {
  return (typeof storyCards !== 'undefined' && Array.isArray(storyCards));
}

function auraLiveKey() {
  return String(((typeof history !== 'undefined' && Array.isArray(history)) ? history.length : 0) + 1);
}

function auraLog(event, detail) {
  var s = auraCardsState();
  s.events.push({
    at: auraIso(),
    turn: s.turn,
    liveKey: auraLiveKey(),
    event: String(event || ''),
    detail: auraLimit(String(detail || ''), 500)
  });
  while (s.events.length > 80) s.events.shift();
}

function auraFindCard(title) {
  var cards = auraCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function auraFindCardLoose(title) {
  var key = auraTitleKey(title);
  if (!key) return { card: null, index: -1 };
  var cards = auraCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (auraTitleKey(c.title) === key) return { card: c, index: i };
    var keys = String(c.keys || c.key || '').split(',');
    for (var j = 0; j < keys.length; j++) {
      if (auraTitleKey(keys[j]) === key) return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function auraCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function auraReadJsonCard(title) {
  var found = auraFindCard(title);
  if (!found.card) return null;
  try {
    return JSON.parse(auraCardText(found.card) || '{}');
  } catch (err) {
    return null;
  }
}

function auraWriteCard(title, entry, type, keys, description, targetCard) {
  var found = targetCard ? { card: targetCard, index: auraCards().indexOf(targetCard) } : auraFindCard(title);
  var card = found.card;
  if (!card && typeof addStoryCard === 'function') {
    addStoryCard(title, entry || '', type || AURA_CARD_TYPE);
    found = auraFindCard(title);
    card = found.card;
  }
  if (!card && auraHasCardArray()) {
    card = { title: title, keys: keys || title, entry: entry || '', type: type || AURA_CARD_TYPE, description: description || '' };
    auraCards().push(card);
  }
  if (!card) return null;

  card.title = title;
  card.keys = keys || title;
  card.entry = entry || '';
  card.type = type || card.type || AURA_CARD_TYPE;
  if (description !== undefined) card.description = description || '';
  return card;
}

function auraDeleteCard(title) {
  var found = auraFindCard(title);
  if (!found.card || found.index < 0) return false;
  if (typeof removeStoryCard === 'function') {
    removeStoryCard(found.index);
  } else if (auraHasCardArray()) {
    auraCards().splice(found.index, 1);
  } else {
    return false;
  }
  return true;
}

function auraLimit(str, limit) {
  str = String(str || '');
  limit = Math.max(0, Number(limit || 0));
  if (str.length <= limit) return str;
  if (limit <= 3) return str.slice(0, limit);
  return str.slice(0, limit - 3).replace(/\s+\S*$/, '') + '...';
}

function auraCleanSpaces(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function auraTitleKey(title) {
  return auraCleanSpaces(title).toLowerCase();
}

function auraHash(str) {
  str = String(str || '');
  var hash = 2166136261;
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function auraUniqueStrings(values, limit) {
  values = Array.isArray(values) ? values : [];
  var out = [];
  var seen = {};
  for (var i = 0; i < values.length; i++) {
    var value = auraCleanSpaces(values[i]).replace(/^,+|,+$/g, '');
    var key = value.toLowerCase();
    if (!value || seen[key]) continue;
    seen[key] = true;
    out.push(value);
    if (limit && out.length >= limit) break;
  }
  return out;
}

function auraDefaultConfigText() {
  return JSON.stringify(AURA_DEFAULT_CONFIG, null, 2);
}

function auraEnsureConfigCard() {
  var s = auraCardsState();
  var found = auraFindCard(AURA_CONFIG_CARD_TITLE);
  var description = [
    'Aura Cards uses Ultrascripts AI sidecar calls to maintain story cards.',
    'Edit the JSON entry to tune usage or set "enabled": false to pause.',
    'The Output Modifier returns story text unchanged; all AI work happens through ultrascripts:out.'
  ].join('\n');

  if (!found.card) {
    auraWriteCard(
      AURA_CONFIG_CARD_TITLE,
      auraDefaultConfigText(),
      AURA_CARD_TYPE,
      'Aura Cards Configuration',
      description
    );
    auraLog('config-created', 'Created the Configure Aura Cards story card');
    s.lastConfig = auraCloneConfig(AURA_DEFAULT_CONFIG);
    return auraCloneConfig(s.lastConfig);
  }

  found.card.keys = found.card.keys || 'Aura Cards Configuration';
  found.card.type = found.card.type || AURA_CARD_TYPE;
  found.card.description = found.card.description || description;

  var parsed = null;
  try {
    parsed = JSON.parse(found.card.entry || found.card.value || '{}');
  } catch (err) {
    auraLog('config-invalid', 'Could not parse config JSON; using the last valid config until fixed');
    return auraCloneConfig(s.lastConfig || AURA_DEFAULT_CONFIG);
  }

  if (parsed && parsed.reset === true) {
    found.card.entry = auraDefaultConfigText();
    auraLog('config-reset', 'Reset Aura Cards config to defaults');
    s.lastConfig = auraCloneConfig(AURA_DEFAULT_CONFIG);
    return auraCloneConfig(s.lastConfig);
  }

  var cfg = auraNormalizeConfig(parsed);
  var normalizedText = JSON.stringify(cfg, null, 2);
  if ((found.card.entry || found.card.value || '').trim() !== normalizedText.trim()) {
    found.card.entry = normalizedText;
    auraLog('config-normalized', 'Refreshed Aura Cards config fields');
  }
  s.lastConfig = auraCloneConfig(cfg);
  return cfg;
}

function auraCloneConfig(config) {
  return JSON.parse(JSON.stringify(config || AURA_DEFAULT_CONFIG));
}

function auraNormalizeConfig(raw) {
  var cfg = auraCloneConfig(AURA_DEFAULT_CONFIG);
  raw = raw && typeof raw === 'object' ? raw : {};

  cfg.enabled = auraBool(raw.enabled, cfg.enabled);
  cfg.cooldownTurns = auraClampInt(raw.cooldownTurns, 1, 200, cfg.cooldownTurns);
  cfg.lookbackActions = auraClampInt(raw.lookbackActions, 4, 60, cfg.lookbackActions);
  cfg.maxCardsPerSweep = auraClampInt(raw.maxCardsPerSweep, 1, 12, cfg.maxCardsPerSweep);
  cfg.maxConcurrentRequests = auraClampInt(raw.maxConcurrentRequests, 1, 4, cfg.maxConcurrentRequests);
  cfg.minConfidence = auraClampNumber(raw.minConfidence, 0, 1, cfg.minConfidence);
  cfg.entryLimit = auraClampInt(raw.entryLimit, 300, 2000, cfg.entryLimit);
  cfg.memoryLimit = auraClampInt(raw.memoryLimit, 800, 9900, cfg.memoryLimit);
  cfg.maxPendingTurns = auraClampInt(raw.maxPendingTurns, 3, 60, cfg.maxPendingTurns);
  cfg.showTrace = auraBool(raw.showTrace, cfg.showTrace);
  cfg.model = auraCleanSpaces(raw.model || AURA_CARDS_MODEL || '');
  cfg.bannedTitles = auraUniqueStrings(
    AURA_DEFAULT_BANNED_TITLES.concat(auraCoerceStringArray(raw.bannedTitles)),
    400
  );

  return cfg;
}

function auraClampInt(value, min, max, fallback) {
  var n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  n = Math.round(n);
  return Math.max(min, Math.min(max, n));
}

function auraClampNumber(value, min, max, fallback) {
  var n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function auraBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    var normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

function auraHeartbeat() {
  return auraReadJsonCard('ultrascripts:heartbeat');
}

function auraHasOp(moduleId, opName) {
  var hb = auraHeartbeat();
  if (!hb || !hb.ultrascripts || hb.ultrascripts.protocol !== 1) {
    return false;
  }
  var modules = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < modules.length; i++) {
    var m = modules[i];
    if (!m || m.id !== moduleId) continue;
    var ops = Array.isArray(m.ops) ? m.ops : [];
    return ops.indexOf(opName) !== -1;
  }
  return false;
}

function auraPendingArray() {
  var s = auraCardsState();
  var out = [];
  for (var id in s.pending) {
    if (!Object.prototype.hasOwnProperty.call(s.pending, id)) continue;
    out.push(s.pending[id]);
  }
  return out;
}

function auraWriteOut() {
  var s = auraCardsState();
  var payload = {
    v: 1,
    requests: auraPendingArray(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: auraNow()
  };
  s._acks = [];
  auraWriteCard('ultrascripts:out', JSON.stringify(payload), 'Ultrascripts', 'ultrascripts:out', '');
}

function auraQueueAck(requestId, reason) {
  var s = auraCardsState();
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;

  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks = s._acks || [];
  s._acks.push(requestId);
  auraLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function auraQueueAiRequest(kind, args, meta) {
  var s = auraCardsState();
  var id = auraLiveKey() + '-aura-' + (++s.seq);
  s.pending[id] = {
    id: id,
    module: 'ai',
    op: 'chat',
    args: args,
    ts: auraNow()
  };
  s.requestMeta[id] = meta || {};
  s.requestMeta[id].kind = kind;
  s.requestMeta[id].queuedTurn = s.turn;
  s.requestMeta[id].queuedAt = auraIso();
  s.stats.queued++;
  auraLog('queued', id + ' -> ai.chat (' + kind + ')');
  auraWriteOut();
  return id;
}

function auraIsTerminal(response) {
  return response && (response.status === 'ok' || response.status === 'err' || response.status === 'timeout');
}

function auraPollResponses(cfg) {
  var s = auraCardsState();
  var card = auraReadJsonCard('ultrascripts:in:ai');
  var wroteAck = false;
  if (!card || !card.responses) return;

  for (var requestId in card.responses) {
    if (!Object.prototype.hasOwnProperty.call(card.responses, requestId)) continue;
    if (!s.pending[requestId] && !s.requestMeta[requestId] && !s.completed[requestId]) continue;

    var response = card.responses[requestId];
    if (!auraIsTerminal(response)) continue;

    if (!s.completed[requestId]) {
      s.completed[requestId] = {
        status: response.status,
        error: response.error || null,
        seenAt: auraIso()
      };
      auraProcessAiResponse(requestId, response, cfg);
    }

    delete s.pending[requestId];
    delete s.requestMeta[requestId];
    if (!s.acked[requestId] || Number(s.ackAttempts[requestId] || 0) < 6) {
      wroteAck = auraQueueAck(requestId, 'terminal') || wroteAck;
    }
  }

  if (wroteAck) auraWriteOut();
}

function auraReapStalePending(cfg) {
  var s = auraCardsState();
  var maxTurns = cfg.maxPendingTurns || AURA_DEFAULT_CONFIG.maxPendingTurns;
  var changed = false;
  for (var id in s.pending) {
    if (!Object.prototype.hasOwnProperty.call(s.pending, id)) continue;
    var meta = s.requestMeta[id] || {};
    var queuedTurn = Number(meta.queuedTurn || s.turn);
    if (s.turn - queuedTurn <= maxTurns) continue;
    auraLog('stale-pending', id + ' expired after ' + (s.turn - queuedTurn) + ' turns');
    s.completed[id] = {
      status: 'local-timeout',
      error: { code: 'local_timeout', message: 'Aura Cards stopped waiting for this request.' },
      seenAt: auraIso()
    };
    delete s.pending[id];
    delete s.requestMeta[id];
    changed = true;
  }
  if (changed) auraWriteOut();
}

function auraPruneRuntimeState() {
  var s = auraCardsState();
  var protect = {};
  var pendingIds = Object.keys(s.pending || {});
  for (var i = 0; i < pendingIds.length; i++) protect[pendingIds[i]] = true;

  auraPruneObject(s.completed, 80, protect);
  auraPruneObject(s.acked, 120, protect);
  auraPruneObject(s.ackAttempts, 120, protect);

  var metaIds = Object.keys(s.requestMeta || {});
  for (var j = 0; j < metaIds.length; j++) {
    if (!s.pending[metaIds[j]]) delete s.requestMeta[metaIds[j]];
  }

  auraPruneObject(s.index, 500, {});
  if (s.events.length > 80) s.events.splice(0, s.events.length - 80);
}

function auraPruneObject(obj, max, protect) {
  if (!obj || typeof obj !== 'object') return;
  var keys = Object.keys(obj);
  var excess = keys.length - max;
  for (var i = 0; excess > 0 && i < keys.length; i++) {
    var key = keys[i];
    if (protect && protect[key]) continue;
    delete obj[key];
    excess--;
  }
}

function auraProcessAiResponse(requestId, response, cfg) {
  var s = auraCardsState();
  var meta = s.requestMeta[requestId] || {};

  if (!cfg.enabled) {
    auraLog('response-ignored', requestId + ' ignored because Aura Cards is disabled');
    return;
  }

  if (response.status !== 'ok') {
    var err = response.error || {};
    if (err.code === 'unsafe_replay_blocked') {
      auraLog('replay-blocked', requestId + ' was blocked after a reload; Aura will retry later');
    } else {
      auraLog('ai-error', requestId + ' -> ' + (err.code || response.status));
      s.stats.failed++;
    }
    return;
  }

  var parsed = auraParseAiJson(response.data);
  if (!parsed) {
    auraLog('bad-json', requestId + ' returned non-JSON text');
    s.stats.failed++;
    return;
  }

  if (meta.kind === 'compress') {
    auraApplyCompression(parsed, meta, cfg);
  } else {
    auraApplySweep(parsed, meta, cfg);
  }
}

function auraAiText(data) {
  if (!data) return '';
  if (typeof data.text === 'string') return data.text;
  if (data.message && typeof data.message.content === 'string') return data.message.content;
  return '';
}

function auraParseAiJson(data) {
  var text = auraAiText(data).trim();
  if (!text) return null;

  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(text);
  } catch (err) {
    var jsonText = auraFirstValidJsonObject(text);
    if (jsonText === '') return null;
    try {
      return JSON.parse(jsonText);
    } catch (err2) {
      return null;
    }
  }
}

function auraFirstValidJsonObject(text) {
  var candidates = auraJsonObjectCandidates(text);
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (err) {
      var relaxed = candidate.replace(/,\s*([}\]])/g, '$1');
      try {
        JSON.parse(relaxed);
        return relaxed;
      } catch (err2) {
        // Keep trying later balanced objects.
      }
    }
  }
  return '';
}

function auraJsonObjectCandidates(text) {
  text = String(text || '');
  var candidates = [];
  var depth = 0;
  var inString = false;
  var escaped = false;
  var start = -1;

  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function auraApplySweep(parsed, meta, cfg) {
  var s = auraCardsState();
  var cards = [];
  if (Array.isArray(parsed)) cards = parsed;
  else if (Array.isArray(parsed.cards)) cards = parsed.cards;
  else if (Array.isArray(parsed.operations)) cards = parsed.operations;
  else if (parsed.card && typeof parsed.card === 'object') cards = [parsed.card];
  var created = 0;
  var updated = 0;
  var skipped = 0;

  for (var i = 0; i < cards.length && i < cfg.maxCardsPerSweep; i++) {
    var normalized = auraNormalizeCandidate(cards[i], cfg);
    if (!normalized) {
      skipped++;
      continue;
    }

    var result = auraUpsertAuraCard(normalized, cfg, meta);
    if (result === 'created') created++;
    else if (result === 'updated') updated++;
    else skipped++;
  }

  s.stats.created += created;
  s.stats.updated += updated;
  s.stats.skipped += skipped;
  s.phase = 'sweep applied';
  auraLog('sweep-applied', 'created=' + created + ', updated=' + updated + ', skipped=' + skipped);
}

function auraNormalizeCandidate(raw, cfg) {
  if (!raw || typeof raw !== 'object') return null;
  var mode = auraTitleKey(raw.mode || raw.action || '');
  if (mode === 'skip' || mode === 'ignore') return null;

  var title = auraNormalizeTitle(auraFirstValue(raw, ['title', 'name', 'entity', 'cardTitle']));
  if (!title) return null;
  if (auraIsBannedTitle(title, cfg)) return null;

  var rawConfidence = auraFirstValue(raw, ['confidence', 'score', 'relevance']);
  var confidence = rawConfidence === undefined ? 0.75 : auraClampNumber(rawConfidence, 0, 1, 0);
  if (confidence < cfg.minConfidence) return null;

  var kind = auraNormalizeKind(auraFirstValue(raw, ['kind', 'type', 'category']));
  var keys = auraCoerceStringArray(auraFirstValue(raw, ['keys', 'triggers', 'aliases']));
  keys = auraUniqueStrings([title].concat(keys), 6).map(auraNormalizeKey).filter(function (key) {
    return key.length >= 2 && key.length <= 60 && !auraIsBannedTitle(key, cfg);
  });
  if (!keys.length) keys = [title];

  var memory = auraCleanMemory(auraFirstValue(raw, ['memory', 'memories', 'fact', 'facts']));
  var entry = auraCleanEntry(auraFirstValue(raw, ['entry', 'description', 'summary', 'lore']), title, cfg.entryLimit, memory);
  if (!entry) return null;

  var reason = auraLimit(auraCleanSpaces(auraFirstValue(raw, ['reason', 'rationale', 'notes']) || ''), 220);

  return {
    title: title,
    titleKey: auraTitleKey(title),
    kind: kind,
    type: auraKindToType(kind),
    keys: keys,
    entry: entry,
    memory: memory,
    confidence: confidence,
    reason: reason
  };
}

function auraFirstValue(obj, names) {
  for (var i = 0; i < names.length; i++) {
    if (Object.prototype.hasOwnProperty.call(obj, names[i]) && obj[names[i]] !== undefined && obj[names[i]] !== null) {
      return obj[names[i]];
    }
  }
  return undefined;
}

function auraCoerceText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(auraCoerceText).filter(Boolean).join('; ');
  if (typeof value === 'object') return '';
  return String(value);
}

function auraCoerceStringArray(value) {
  if (Array.isArray(value)) return value.map(auraCoerceText);
  if (typeof value === 'string') return value.split(/[,;|]/);
  return [];
}

function auraNormalizeTitle(title) {
  title = auraCleanSpaces(auraCoerceText(title))
    .replace(/[{}[\]<>#*_`"\\]/g, '')
    .replace(/\s*[.!?;:]+\s*$/g, '')
    .trim();
  if (title.length < 3 || title.length > 90) return '';
  if (!/[A-Za-z]/.test(title)) return '';

  var lettersOnly = title.replace(/[^A-Za-z]/g, '');
  var wholeTitleIsAllCaps = lettersOnly.length > 4 && lettersOnly === lettersOnly.toUpperCase();
  var words = title.split(' ');
  for (var i = 0; i < words.length; i++) {
    if (!words[i]) continue;
    var lower = words[i].toLowerCase();
    if (i > 0 && auraMinorWords()[lower]) {
      words[i] = lower;
    } else if (!wholeTitleIsAllCaps && /^[A-Z]{2,4}$/.test(words[i])) {
      words[i] = words[i];
    } else {
      var base = (wholeTitleIsAllCaps || /^[A-Z]{5,}$/.test(words[i])) ? lower : words[i];
      words[i] = base.charAt(0).toUpperCase() + base.slice(1);
    }
  }
  return words.join(' ');
}

function auraNormalizeKey(key) {
  return auraCleanSpaces(auraCoerceText(key))
    .replace(/[{}[\]<>#*_`"\\]/g, '')
    .replace(/\s*[.!?;:]+\s*$/g, '')
    .trim();
}

function auraMinorWords() {
  return {
    a: true, an: true, and: true, as: true, at: true, but: true, by: true,
    for: true, from: true, in: true, into: true, nor: true, of: true,
    on: true, or: true, over: true, the: true, to: true, under: true,
    with: true, without: true
  };
}

function auraIsBannedTitle(title, cfg) {
  var key = auraTitleKey(title);
  if (!key) return true;
  if (key.indexOf('ultrascripts:') === 0 || key.indexOf('aura cards') !== -1) return true;
  var bans = cfg.bannedTitles || [];
  for (var i = 0; i < bans.length; i++) {
    if (auraTitleKey(bans[i]) === key) return true;
  }
  return false;
}

function auraNormalizeKind(kind) {
  kind = auraTitleKey(kind);
  if (kind === 'person' || kind === 'npc') return 'character';
  if (kind === 'place') return 'location';
  if (kind === 'organization' || kind === 'group') return 'faction';
  if (kind === 'object' || kind === 'artifact') return 'item';
  if (kind === 'plot' || kind === 'event') return 'event';
  if (kind === 'concept' || kind === 'custom') return kind;
  if (kind === 'character' || kind === 'location' || kind === 'faction' || kind === 'item') return kind;
  return 'other';
}

function auraKindToType(kind) {
  if (kind === 'character') return 'Character';
  if (kind === 'location') return 'Location';
  if (kind === 'faction') return 'Faction';
  return 'Custom';
}

function auraCleanEntry(entry, title, limit, fallbackMemory) {
  entry = auraCoerceText(entry)
    .replace(/^```[\s\S]*?\n/i, '')
    .replace(/```$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  entry = entry.replace(/^\{[^}]*\}\s*/, '').trim();
  if (entry.length < 40 && fallbackMemory) {
    entry = fallbackMemory;
  }
  if (entry.length < 40) return '';
  if (entry.toLowerCase().indexOf(title.toLowerCase()) === -1) {
    entry = title + ' is ' + entry.charAt(0).toLowerCase() + entry.slice(1);
  }
  return auraLimit(entry, limit);
}

function auraCleanMemory(memory) {
  memory = auraCleanSpaces(auraCoerceText(memory)).replace(/^-+\s*/, '');
  if (memory.length < 20) return '';
  return auraLimit(memory, 500);
}

function auraFormatEntry(title, entry) {
  return '{title: ' + title + '}\n' + entry.trim();
}

function auraUpsertAuraCard(cardPlan, cfg, meta) {
  var existingAura = auraFindAuraCard(cardPlan.title);
  var blocking = auraFindCardLoose(cardPlan.title);

  if (!existingAura.card && blocking.card && !auraIsAuraCard(blocking.card)) {
    auraLog('skip-existing-card', cardPlan.title + ' already exists as a non-Aura card');
    return 'skipped';
  }

  var now = auraIso();
  var memoryLines = [];
  var metadata = {
    aura: true,
    version: 1,
    title: cardPlan.title,
    kind: cardPlan.kind,
    confidence: cardPlan.confidence,
    lastSeenTurn: Number(meta.liveKey || auraLiveKey()),
    updatedAt: now,
    memoryLimit: cfg.memoryLimit,
    reason: cardPlan.reason
  };

  if (existingAura.card) {
    metadata = auraMergeObjects(auraReadAuraMetadata(existingAura.card), metadata);
    memoryLines = auraReadAuraMemories(existingAura.card);
    if (cardPlan.memory) memoryLines = auraAppendMemory(memoryLines, cardPlan.memory);
  } else if (cardPlan.memory) {
    memoryLines = auraAppendMemory(memoryLines, cardPlan.memory);
  }

  var keys = existingAura.card
    ? auraUniqueStrings(String(existingAura.card.keys || '').split(',').concat(cardPlan.keys), 8)
    : cardPlan.keys;

  var description = auraBuildAuraDescription(metadata, memoryLines);
  var written = auraWriteCard(
    cardPlan.title,
    auraFormatEntry(cardPlan.title, cardPlan.entry),
    cardPlan.type,
    keys.join(', '),
    description,
    existingAura.card
  );
  if (!written) {
    auraLog('write-failed', cardPlan.title);
    return 'skipped';
  }

  auraCardsState().index[cardPlan.titleKey] = {
    title: cardPlan.title,
    kind: cardPlan.kind,
    lastSeenTurn: metadata.lastSeenTurn,
    updatedAt: now
  };

  return existingAura.card ? 'updated' : 'created';
}

function auraMergeObjects(a, b) {
  a = a && typeof a === 'object' ? a : {};
  b = b && typeof b === 'object' ? b : {};
  var out = {};
  var key;
  for (key in a) if (Object.prototype.hasOwnProperty.call(a, key)) out[key] = a[key];
  for (key in b) if (Object.prototype.hasOwnProperty.call(b, key)) out[key] = b[key];
  return out;
}

function auraFindAuraCard(title) {
  var key = auraTitleKey(title);
  var cards = auraCards();
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (!card || !auraIsAuraCard(card)) continue;
    var metadata = auraReadAuraMetadata(card);
    if (auraTitleKey(metadata.title || card.title) === key) {
      return { card: card, index: i };
    }
    if (auraCardHasKey(card, key)) {
      return { card: card, index: i };
    }
  }
  return { card: null, index: -1 };
}

function auraCardHasKey(card, key) {
  if (!card || !key) return false;
  var values = [card.title].concat(String(card.keys || card.key || '').split(','));
  for (var i = 0; i < values.length; i++) {
    if (auraTitleKey(values[i]) === key) return true;
  }
  return false;
}

function auraIsAuraCard(card) {
  return !!(card && String(card.description || '').indexOf(AURA_METADATA_MARKER) !== -1);
}

function auraReadAuraMetadata(card) {
  var description = String(card && card.description || '');
  var start = description.indexOf(AURA_METADATA_MARKER);
  if (start === -1) return {};
  start += AURA_METADATA_MARKER.length;
  var rest = description.slice(start).trim();
  var firstBrace = rest.indexOf('{');
  if (firstBrace === -1) return {};
  var jsonText = auraFirstValidJsonObject(rest.slice(firstBrace));
  if (!jsonText) return {};
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    return {};
  }
}

function auraReadAuraMemories(card) {
  var description = String(card && card.description || '');
  var memoryStart = description.indexOf(AURA_MEMORY_MARKER);
  if (memoryStart === -1) return [];
  var text = description.slice(memoryStart + AURA_MEMORY_MARKER.length);
  return text.split('\n').map(function (line) {
    return auraCleanSpaces(line.replace(/^-+\s*/, ''));
  }).filter(function (line) {
    return line.length > 0;
  });
}

function auraBuildAuraDescription(metadata, memoryLines) {
  return [
    AURA_METADATA_MARKER,
    JSON.stringify(metadata, null, 2),
    '',
    AURA_MEMORY_MARKER,
    memoryLines.length ? '- ' + memoryLines.join('\n- ') : ''
  ].join('\n').trim();
}

function auraAppendMemory(memoryLines, newMemory) {
  var lines = memoryLines.slice();
  newMemory = auraCleanMemory(newMemory);
  if (!newMemory) return lines;

  for (var i = 0; i < lines.length; i++) {
    if (auraSimilar(lines[i], newMemory) > 0.78) return lines;
  }
  lines.push(newMemory);
  while (lines.length > 80) lines.shift();
  return lines;
}

function auraSimilar(a, b) {
  a = auraTitleKey(a);
  b = auraTitleKey(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.9;

  var aw = auraWordSet(a);
  var bw = auraWordSet(b);
  var shared = 0;
  var total = 0;
  var word;
  for (word in aw) {
    if (!Object.prototype.hasOwnProperty.call(aw, word)) continue;
    total++;
    if (bw[word]) shared++;
  }
  for (word in bw) {
    if (!Object.prototype.hasOwnProperty.call(bw, word)) continue;
    if (!aw[word]) total++;
  }
  return total ? shared / total : 0;
}

function auraWordSet(text) {
  var out = {};
  var words = String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  for (var i = 0; i < words.length; i++) out[words[i]] = true;
  return out;
}

function auraRecentStory(outputText, cfg) {
  var pieces = [];
  var entries = (typeof history !== 'undefined' && Array.isArray(history)) ? history : [];
  var start = Math.max(0, entries.length - cfg.lookbackActions);

  for (var i = start; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry) continue;
    var body = auraCleanSpaces(String(entry.text || entry.rawText || ''));
    if (!body) continue;
    pieces.push('[' + i + ' ' + String(entry.type || 'action') + '] ' + body);
  }

  var out = auraCleanSpaces(outputText || '');
  if (out) pieces.push('[latest output] ' + out);

  return auraLimit(pieces.join('\n'), 5200);
}

function auraExistingCardsBrief(cfg) {
  var cards = auraCards();
  var rows = [];

  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c || !c.title) continue;
    if (String(c.title).indexOf('ultrascripts:') === 0) continue;
    if (c.title === AURA_CONFIG_CARD_TITLE || c.title === AURA_TRACE_CARD_TITLE) continue;

    var source = auraIsAuraCard(c) ? 'Aura' : 'User';
    rows.push({
      source: source,
      title: auraLimit(c.title, 80),
      type: auraLimit(c.type || 'Custom', 40),
      keys: auraLimit(c.keys || '', 100),
      entry: auraLimit(auraCleanSpaces(c.entry || c.value || ''), source === 'Aura' ? 360 : 180)
    });
  }

  rows.sort(function (a, b) {
    if (a.source === b.source) return 0;
    return a.source === 'Aura' ? -1 : 1;
  });

  return auraLimit(JSON.stringify(rows.slice(0, 36), null, 2), 3500);
}

function auraBuildSweepArgs(recentStory, cfg) {
  var user = [
    'RECENT ADVENTURE TEXT:',
    recentStory,
    '',
    'EXISTING STORY CARDS:',
    auraExistingCardsBrief(cfg),
    '',
    'BANNED TITLES:',
    cfg.bannedTitles.join(', '),
    '',
    'AURA CARD CONTRACT:',
    'Return up to ' + cfg.maxCardsPerSweep + ' high-value card operations.',
    'Create cards for durable entities that improve object permanence: named characters, important places, factions, artifacts, recurring threats, active mysteries, rules of magic/technology, and relationships.',
    'Update existing Aura cards when the recent text adds durable facts. Preserve stable old facts; fold in new facts naturally.',
    'Protect user-authored cards. If a non-Aura card already covers the title or trigger, skip it.',
    'Do not create cards for generic nouns, directions, weekdays, UI/config cards, player commands, temporary poses, single-scene clothing, momentary emotions, or ordinary actions.',
    'Use exact proper names from the story. Do not rename, merge, or over-generalize entities.',
    'Entry field: write 2-5 concise third-person sentences, no title header, no markdown, no bullets, no future plot prophecy.',
    'Every entry must name the title in the first sentence and focus on facts that would still matter ten turns later.',
    'Keys field: include the title first, then 1-5 short trigger phrases or aliases that should summon the card.',
    'Memory field: write one compact durable fact learned from the recent text, or an empty string.',
    'Confidence: use 0.5-1.0 for worthwhile cards. Use skip with low confidence when unsure.'
  ].join('\n');

  var args = {
    provider: 'openrouter',
    messages: [
      {
        role: 'system',
        content: auraSweepSystemPrompt()
      },
      { role: 'user', content: auraLimit(user, 7900) }
    ],
    maxTokens: 2600,
    temperature: 0.15,
    timeoutMs: 60000,
    responseFormat: auraSweepResponseFormat()
  };
  if (cfg.model) args.model = cfg.model;
  return args;
}

function auraSweepSystemPrompt() {
  return [
    'You are Aura Cards, a sidecar lore curator for AI Dungeon.',
    'Your job is object permanence: maintain a living reference of the adventure without interrupting play.',
    'You are not the narrator, not the player, and not the story model.',
    'Never continue the scene, address the player, or add prose outside JSON.',
    'Favor useful recall over exhaustive extraction. A card should help the next model generation remember who, what, where, or why.',
    'Be faithful to supplied text. You may lightly infer category and aliases, but do not invent secret backstory, motives, powers, relationships, or outcomes.',
    'Use concrete, reusable card text. Avoid vague phrasing such as "is important", "plays a role", or "is mysterious" unless the story provides the specific reason.',
    'Return only compact JSON matching the schema.'
  ].join(' ');
}

function auraSweepResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'aura_cards_sweep',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cards: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                mode: { type: 'string', enum: ['create', 'update', 'skip'] },
                title: { type: 'string' },
                kind: { type: 'string', enum: ['character', 'location', 'faction', 'item', 'concept', 'event', 'other'] },
                keys: { type: 'array', items: { type: 'string' } },
                entry: { type: 'string' },
                memory: { type: 'string' },
                reason: { type: 'string' },
                confidence: { type: 'number' }
              },
              required: ['mode', 'title', 'kind', 'keys', 'entry', 'memory', 'reason', 'confidence']
            }
          },
          notes: { type: 'string' }
        },
        required: ['cards', 'notes']
      }
    }
  };
}

function auraFindCompressionTarget(cfg) {
  var cards = auraCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!auraIsAuraCard(c)) continue;
    var metadata = auraReadAuraMetadata(c);
    var title = metadata.title || c.title;
    if (auraHasPendingKind('compress', auraTitleKey(title))) continue;
    var memories = auraReadAuraMemories(c);
    var text = memories.join(' ');
    if (text.length > cfg.memoryLimit) return { card: c, index: i, memories: memories };
  }
  return null;
}

function auraBuildCompressionArgs(target, cfg) {
  var metadata = auraReadAuraMetadata(target.card);
  var title = metadata.title || target.card.title;
  var user = [
    'TITLE: ' + title,
    '',
    'CURRENT ENTRY:',
    auraLimit(auraCleanSpaces(target.card.entry || ''), 1000),
    '',
    'MEMORY BANK TO COMPRESS:',
    target.memories.map(function (m) { return '- ' + m; }).join('\n'),
    '',
    'COMPRESSION CONTRACT:',
    'Condense the bank into 4-10 durable memory facts for this one card.',
    'Keep names, relationships, locations, causes, consequences, promises, threats, and unresolved mysteries.',
    'Merge duplicate facts and discard temporary scene business.',
    'Write in past tense when referring to past events.',
    'Do not invent new facts or resolve unknowns.'
  ].join('\n');

  var args = {
    provider: 'openrouter',
    messages: [
      {
        role: 'system',
        content: [
          'You compress AI Dungeon story-card memory for long-term continuity.',
          'Preserve durable facts and remove duplicate or temporary details.',
          'Return only JSON matching the schema.'
        ].join(' ')
      },
      { role: 'user', content: auraLimit(user, 7900) }
    ],
    maxTokens: 1000,
    temperature: 0,
    timeoutMs: 60000,
    responseFormat: auraCompressionResponseFormat()
  };
  if (cfg.model) args.model = cfg.model;
  return args;
}

function auraCompressionResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'aura_cards_memory',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memory: { type: 'string' }
        },
        required: ['memory']
      }
    }
  };
}

function auraApplyCompression(parsed, meta, cfg) {
  var s = auraCardsState();
  var title = meta.title || '';
  var found = auraFindAuraCard(title);
  if (!found.card) {
    auraLog('compression-missing', title);
    s.stats.failed++;
    return;
  }

  var memory = auraCleanSpaces(parsed.memory || '');
  if (!memory) {
    auraLog('compression-empty', title);
    s.stats.failed++;
    return;
  }

  var lines = memory.split(/(?:\n|;\s+)/).map(function (line) {
    return auraCleanSpaces(line.replace(/^-+\s*/, ''));
  }).filter(function (line) {
    return line.length > 0;
  });
  if (!lines.length) lines = [auraLimit(memory, cfg.memoryLimit)];
  while (lines.join(' ').length > cfg.memoryLimit && lines.length > 1) {
    lines.shift();
  }
  if (lines.join(' ').length > cfg.memoryLimit) {
    lines = [auraLimit(lines.join(' '), cfg.memoryLimit)];
  }

  var metadata = auraReadAuraMetadata(found.card);
  metadata.compressedAt = auraIso();
  found.card.description = auraBuildAuraDescription(metadata, lines);
  s.stats.compressed++;
  s.phase = 'memory compressed';
  auraLog('memory-compressed', title);
}

function auraQueueCompressionIfNeeded(cfg) {
  var target = auraFindCompressionTarget(cfg);
  if (!target) return false;
  var metadata = auraReadAuraMetadata(target.card);
  var title = metadata.title || target.card.title;
  auraQueueAiRequest('compress', auraBuildCompressionArgs(target, cfg), {
    title: title,
    titleKey: auraTitleKey(title),
    liveKey: auraLiveKey()
  });
  auraCardsState().phase = 'queueing memory compression';
  return true;
}

function auraQueueSweepIfNeeded(outputText, cfg) {
  var s = auraCardsState();
  var liveKey = Number(auraLiveKey());
  var recentStory = auraRecentStory(outputText, cfg);
  var storySig = auraHash(recentStory);

  if (recentStory.length < 240) {
    s.phase = 'waiting for more story';
    return false;
  }
  if (storySig === s.lastStorySig || liveKey === s.lastSweepLiveKey) {
    s.phase = 'waiting for new story';
    return false;
  }

  auraQueueAiRequest('sweep', auraBuildSweepArgs(recentStory, cfg), {
    liveKey: liveKey,
    storySig: storySig
  });
  s.lastSweepLiveKey = liveKey;
  s.lastStorySig = storySig;
  s.cooldown = cfg.cooldownTurns;
  s.phase = 'queueing sweep';
  return true;
}

function auraPendingCount() {
  var s = auraCardsState();
  var count = 0;
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) count++;
  }
  return count;
}

function auraHasPendingKind(kind, key) {
  var s = auraCardsState();
  for (var id in s.pending) {
    if (!Object.prototype.hasOwnProperty.call(s.pending, id)) continue;
    var meta = s.requestMeta[id] || {};
    if (meta.kind !== kind) continue;
    if (key === undefined || meta.titleKey === key || meta.storySig === key) return true;
  }
  return false;
}

function auraDrive(outputText, cfg) {
  var s = auraCardsState();

  if (!cfg.enabled) {
    s.phase = 'disabled';
    return;
  }

  if (!auraHasOp('ai', 'chat')) {
    s.phase = 'waiting for Ultrascripts AI heartbeat';
    return;
  }

  if (auraPendingCount() >= cfg.maxConcurrentRequests) {
    s.phase = 'awaiting AI responses';
    return;
  }

  if (auraQueueCompressionIfNeeded(cfg)) return;

  if (s.cooldown > 0) {
    s.cooldown--;
    s.phase = 'cooldown ' + s.cooldown;
    return;
  }

  auraQueueSweepIfNeeded(outputText, cfg);
}

function auraWriteTrace(cfg) {
  if (!cfg.showTrace) {
    auraDeleteCard(AURA_TRACE_CARD_TITLE);
    return;
  }

  var s = auraCardsState();
  var trace = {
    v: 1,
    runId: auraRunId(),
    turn: s.turn,
    liveKey: auraLiveKey(),
    phase: s.phase,
    enabled: cfg.enabled,
    aiChatAdvertised: auraHasOp('ai', 'chat'),
    model: cfg.model || '(BetterDungeon default)',
    cooldown: s.cooldown,
    maxConcurrentRequests: cfg.maxConcurrentRequests,
    pendingCount: auraPendingCount(),
    pendingIds: Object.keys(s.pending || {}),
    stats: s.stats,
    knownAuraCards: Object.keys(s.index || {}).length,
    events: s.events.slice(-30)
  };

  auraWriteCard(
    AURA_TRACE_CARD_TITLE,
    JSON.stringify(trace, null, 2),
    AURA_CARD_TYPE,
    'Aura Cards Trace',
    'Runtime trace for the Aura Cards example.'
  );
}

function auraCardsStep(outputText) {
  var s = auraCardsState();
  auraRunId();
  s.turn += 1;

  var cfg = auraEnsureConfigCard();
  try {
    auraPollResponses(cfg);
    auraReapStalePending(cfg);
    auraDrive(outputText, cfg);
    auraPruneRuntimeState();
  } catch (err) {
    s.phase = 'script error';
    s.stats.failed++;
    auraLog('script-error', err && err.message ? err.message : String(err));
  }
  auraWriteTrace(cfg);
  return true;
}
