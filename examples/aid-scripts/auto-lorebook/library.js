// Auto-Lorebook Builder — AI Dungeon Library
//
// Each AI generation, this script asks the Frontier AI module to extract
// named entities from recent history using a strict JSON schema, then
// auto-creates story cards for new entities. AID's context selector picks
// up those cards on subsequent turns, so the world builds its own lore as
// you play.
//
// Surfaces written:
//   frontier:out             - request envelope queue (script -> BD)
//   frontier:in:ai           - response envelope (BD -> script)
//   lorebook:status          - human-readable status card with stats
//   <Entity Name>            - one story card per discovered entity
//
// Pair with output-modifier.js. Requires the BetterDungeon extension with
// Frontier + AI module enabled and an OpenRouter key configured.

// ---------- configuration ----------

// Skip extraction unless this many turns have elapsed since the last run.
// Each run costs one chat completion; 2 strikes a reasonable balance for
// most scenarios. Bump higher to save money; set to 1 for maximum coverage.
var LORE_RUN_EVERY_N_TURNS = 2;

// How many recent history entries to feed the extractor. Longer windows
// catch more lore but cost more tokens.
var LORE_HISTORY_WINDOW = 6;

// Per-entity description cap. Keep tight so cards remain readable and AID's
// context selector can pull several without blowing context.
var LORE_DESCRIPTION_MAX_CHARS = 280;

// Per-extraction maxTokens budget for the AI call.
var LORE_MAX_TOKENS = 800;

// Override to pin a specific OpenRouter model. Leave blank to use the
// default configured in BetterDungeon's Frontier panel.
var LORE_MODEL = '';

// Optional: ignore entities whose name matches any of these (case-insensitive).
// Keeps protagonist/narrator out of the lorebook.
var LORE_IGNORE_NAMES = ['you', 'i', 'me', 'myself', 'the player'];

// ---------- state ----------

state.autoLorebook = state.autoLorebook || {
  runId: 'lorebook-' + (Date.now ? Date.now() : new Date().getTime()).toString(36),
  turn: 0,
  seq: 0,
  outSeq: 0,
  pendingId: null,        // id of the in-flight extraction request, if any
  lastRunTurn: -999,
  lastSummary: null,      // { addedAt, added: [...], skipped: [...] }
  totals: { person: 0, place: 0, item: 0, faction: 0, concept: 0, other: 0 },
  acked: {},
  ackAttempts: {},
  consumedCommands: {},
  events: []
};

// ---------- card helpers ----------

function loreCards() { return Array.isArray(storyCards) ? storyCards : []; }

function loreFindCard(title) {
  var cards = loreCards();
  var needle = String(title || '').trim().toLowerCase();
  if (!needle) return { card: null, index: -1 };
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    var t = String(c.title || c.keys || c.key || '').trim().toLowerCase();
    if (t === needle) return { card: c, index: i };
  }
  return { card: null, index: -1 };
}

function loreReadJson(title) {
  var f = loreFindCard(title);
  if (!f.card) return null;
  var raw = f.card.value || f.card.entry || f.card.description || '';
  try { return JSON.parse(raw || '{}'); } catch (e) { return null; }
}

function loreWriteCard(title, value, type, keys) {
  var f = loreFindCard(title);
  var cardType = type || 'Lore';
  var k = keys || title;

  if (f.card && f.index >= 0 && typeof updateStoryCard === 'function') {
    updateStoryCard(f.index, f.card.keys || f.card.key || k, value, f.card.type || cardType);
    return 'updated';
  }
  if (typeof addStoryCard === 'function') {
    addStoryCard(title, value, cardType);
    return 'created';
  }
  return 'failed';
}

function loreNow() { return Date.now ? Date.now() : new Date().getTime(); }

function loreLiveKey() {
  return String((Array.isArray(history) ? history.length : 0) + 1);
}

function loreLog(event, detail) {
  var s = state.autoLorebook;
  s.events.push({
    at: loreNow(), turn: s.turn, liveKey: loreLiveKey(),
    event: event, detail: detail || ''
  });
  while (s.events.length > 60) s.events.shift();
}

// ---------- frontier protocol ----------

function loreHeartbeat() { return loreReadJson('frontier:heartbeat'); }

function loreAiAvailable() {
  var hb = loreHeartbeat();
  if (!hb || !hb.frontier || hb.frontier.protocol !== 1 || hb.frontier.profile !== 'full') return false;
  var mods = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    if (!m || m.id !== 'ai') continue;
    var ops = Array.isArray(m.ops) ? m.ops : [];
    return ops.indexOf('chat') !== -1;
  }
  return false;
}

function lorePendingRequests() {
  var s = state.autoLorebook;
  if (!s.pendingId || !s._pendingRequest) return [];
  return [s._pendingRequest];
}

function loreWriteOut() {
  var s = state.autoLorebook;
  var payload = {
    v: 1,
    requests: lorePendingRequests(),
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: loreNow()
  };
  s._acks = [];
  loreWriteCard('frontier:out', JSON.stringify(payload), 'Frontier');
}

function loreQueueAck(requestId, reason) {
  var s = state.autoLorebook;
  s._acks = s._acks || [];
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  loreLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' - ' + reason : ''));
  return true;
}

function loreQueueExtraction(messages) {
  var s = state.autoLorebook;
  if (s.pendingId) return s.pendingId;
  var id = loreLiveKey() + '-lore-' + (++s.seq);
  var args = {
    provider: 'openrouter',
    messages: messages,
    maxTokens: LORE_MAX_TOKENS,
    temperature: 0.2,
    timeoutMs: 60000,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'lorebook_entities',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['entities'],
          properties: {
            entities: {
              type: 'array',
              // Strict JSON schema mode requires every listed property to be
              // present in `required`. Empty arrays are fine for `aliases`.
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'kind', 'description', 'aliases'],
                properties: {
                  name: { type: 'string', description: 'Canonical proper noun as it appears in the story.' },
                  kind: { type: 'string', enum: ['person', 'place', 'item', 'faction', 'concept'] },
                  description: { type: 'string', description: 'One or two sentences grounded only in what the story has revealed so far.' },
                  aliases: { type: 'array', items: { type: 'string' }, description: 'Other names the entity is referred to by; empty array if none.' }
                }
              }
            }
          }
        }
      }
    }
  };
  if (LORE_MODEL) args.model = LORE_MODEL;

  s.pendingId = id;
  s._pendingRequest = { id: id, module: 'ai', op: 'chat', args: args, ts: loreNow() };
  s.lastRunTurn = s.turn;
  loreLog('queued', id + ' -> ai.chat (extraction)');
  loreWriteOut();
  return id;
}

function loreIsTerminal(r) {
  return r && (r.status === 'ok' || r.status === 'err' || r.status === 'timeout');
}

function lorePollResponse() {
  var s = state.autoLorebook;
  if (!s.pendingId) return;
  var card = loreReadJson('frontier:in:ai');
  if (!card || !card.responses) return;

  var response = card.responses[s.pendingId];
  if (!loreIsTerminal(response)) return;

  loreLog('completed', s.pendingId + ' -> ' + response.status);
  loreQueueAck(s.pendingId, 'terminal');

  if (response.status === 'ok') {
    loreApplyExtraction(response.data);
  } else {
    s.lastSummary = {
      addedAt: loreNow(),
      added: [],
      skipped: [],
      error: response.error || { code: 'unknown', message: 'extraction failed' }
    };
  }

  s.pendingId = null;
  s._pendingRequest = null;
  loreWriteOut();
}

// ---------- extraction prompt ----------

// Recent history is the source of truth for "what the story has actually
// revealed". Don't include speculative model knowledge — the schema's
// description field reinforces this, and the system prompt repeats it.
function loreRecentText() {
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - LORE_HISTORY_WINDOW);
  var lines = [];
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    var t = String(e.text || e.rawText || '').trim();
    if (t) lines.push(t);
  }
  // Hard-clamp so we never blow MAX_MESSAGE_CHARS (8000).
  var joined = lines.join('\n\n');
  if (joined.length > 7000) joined = joined.slice(joined.length - 7000);
  return joined;
}

function loreExtractionMessages() {
  var systemPrompt =
    'You are a careful lorebook archivist. Read the provided story excerpt and ' +
    'return only entities that the story has explicitly named or unambiguously ' +
    'introduced. Do not invent details or rely on outside knowledge. ' +
    'Use the canonical name as it appears in the text. Descriptions must be ' +
    'one or two sentences, grounded strictly in the excerpt. Skip pronouns, ' +
    'common nouns, and the player character.';
  var userPrompt =
    'Story excerpt:\n\n' + loreRecentText() +
    '\n\nReturn the entities as JSON matching the provided schema. Empty array ' +
    'is valid if nothing new and concrete was named.';
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

// ---------- applying extracted entities ----------

function loreShouldIgnore(name) {
  var n = String(name || '').trim().toLowerCase();
  if (!n) return true;
  for (var i = 0; i < LORE_IGNORE_NAMES.length; i++) {
    if (LORE_IGNORE_NAMES[i].toLowerCase() === n) return true;
  }
  return false;
}

function loreClampDescription(desc) {
  var d = String(desc || '').trim();
  if (!d) return '';
  if (d.length > LORE_DESCRIPTION_MAX_CHARS) {
    d = d.slice(0, LORE_DESCRIPTION_MAX_CHARS - 1) + '…';
  }
  return d;
}

function loreCardTypeFor(kind) {
  var k = String(kind || '').toLowerCase();
  if (k === 'person') return 'Character';
  if (k === 'place') return 'Location';
  if (k === 'item') return 'Item';
  if (k === 'faction') return 'Faction';
  if (k === 'concept') return 'Concept';
  return 'Lore';
}

function loreEntityKeys(entity) {
  var keys = [String(entity.name || '').trim()];
  if (Array.isArray(entity.aliases)) {
    for (var i = 0; i < entity.aliases.length; i++) {
      var a = String(entity.aliases[i] || '').trim();
      if (a && keys.indexOf(a) === -1) keys.push(a);
    }
  }
  return keys.join(', ');
}

function loreApplyExtraction(data) {
  var s = state.autoLorebook;
  var added = [];
  var skipped = [];

  // The AI module's chat op already parses OpenRouter's payload and exposes
  // `text` as the assistant's content. With responseFormat: json_schema and
  // strict: true, that text is guaranteed valid JSON matching our schema.
  var text = data && typeof data.text === 'string' ? data.text : '';
  var parsed = null;
  try { parsed = JSON.parse(text || '{}'); } catch (e) { parsed = null; }
  var entities = parsed && Array.isArray(parsed.entities) ? parsed.entities : [];

  for (var i = 0; i < entities.length; i++) {
    var entity = entities[i] || {};
    var name = String(entity.name || '').trim();
    var kind = String(entity.kind || '').toLowerCase();
    var description = loreClampDescription(entity.description);

    if (!name || !description) {
      skipped.push({ name: name, reason: 'missing fields' });
      continue;
    }
    if (loreShouldIgnore(name)) {
      skipped.push({ name: name, reason: 'ignored' });
      continue;
    }

    var existing = loreFindCard(name);
    if (existing.card) {
      // Don't overwrite cards the player or another script may have curated.
      // Just bump aliases by re-writing keys, leaving description alone.
      skipped.push({ name: name, reason: 'already exists' });
      continue;
    }

    var keys = loreEntityKeys(entity);
    var result = loreWriteCard(name, description, loreCardTypeFor(kind), keys);
    if (result === 'created') {
      added.push({ name: name, kind: kind });
      var bucket = (s.totals.hasOwnProperty(kind) ? kind : 'other');
      s.totals[bucket] = (s.totals[bucket] || 0) + 1;
      loreLog('lore-added', name + ' (' + kind + ')');
    } else {
      skipped.push({ name: name, reason: 'write-' + result });
    }
  }

  s.lastSummary = { addedAt: loreNow(), added: added, skipped: skipped, error: null };
}

// ---------- status card ----------

function loreWriteStatus() {
  var s = state.autoLorebook;
  var hb = loreHeartbeat();

  var lines = [];
  lines.push('Auto-Lorebook Builder');
  lines.push('Run: ' + s.runId);
  lines.push('Turn: ' + s.turn + ' (live key ' + loreLiveKey() + ')');
  lines.push('AI module: ' + (loreAiAvailable() ? 'ready' : 'unavailable'));
  if (hb && hb.frontier) {
    lines.push('Frontier: protocol ' + hb.frontier.protocol + ', profile ' + hb.frontier.profile);
  }
  lines.push('Last extraction at turn: ' + (s.lastRunTurn < 0 ? 'never' : s.lastRunTurn));
  lines.push('In flight: ' + (s.pendingId ? s.pendingId : 'none'));
  lines.push('');
  lines.push('Totals:');
  lines.push('  people:    ' + (s.totals.person || 0));
  lines.push('  places:    ' + (s.totals.place || 0));
  lines.push('  items:     ' + (s.totals.item || 0));
  lines.push('  factions:  ' + (s.totals.faction || 0));
  lines.push('  concepts:  ' + (s.totals.concept || 0));
  if (s.totals.other) lines.push('  other:     ' + s.totals.other);

  if (s.lastSummary) {
    lines.push('');
    if (s.lastSummary.error) {
      lines.push('Last run: error ' + (s.lastSummary.error.code || '') +
        ' - ' + (s.lastSummary.error.message || ''));
    } else {
      lines.push('Last run added ' + s.lastSummary.added.length + ', skipped ' + s.lastSummary.skipped.length + ':');
      for (var i = 0; i < s.lastSummary.added.length; i++) {
        var a = s.lastSummary.added[i];
        lines.push('  + ' + a.name + ' (' + a.kind + ')');
      }
      for (var j = 0; j < Math.min(s.lastSummary.skipped.length, 6); j++) {
        var k = s.lastSummary.skipped[j];
        lines.push('  - ' + k.name + ' [' + k.reason + ']');
      }
    }
  }

  loreWriteCard('lorebook:status', lines.join('\n'), 'Lorebook');
}

// ---------- driver ----------

function loreShouldKick() {
  var s = state.autoLorebook;
  if (!loreAiAvailable()) return false;
  if (s.pendingId) return false;
  if (!Array.isArray(history) || history.length === 0) return false;
  if (s.turn - s.lastRunTurn < LORE_RUN_EVERY_N_TURNS) return false;
  return true;
}

function loreReset() {
  state.autoLorebook = {
    runId: 'lorebook-' + loreNow().toString(36),
    turn: 0, seq: 0, outSeq: 0,
    pendingId: null,
    lastRunTurn: -999,
    lastSummary: null,
    totals: { person: 0, place: 0, item: 0, faction: 0, concept: 0, other: 0 },
    acked: {}, ackAttempts: {}, consumedCommands: {}, events: []
  };
  loreWriteCard('frontier:out', JSON.stringify({ v: 1, requests: [], acks: [] }), 'Frontier');
  loreWriteStatus();
}

function loreTextIncludes(text, needles) {
  var hay = String(text || '').toLowerCase();
  for (var i = 0; i < needles.length; i++) {
    if (hay.indexOf(needles[i]) !== -1) return true;
  }
  return false;
}

function loreConsumeCommand(kind, outputText, needles) {
  var s = state.autoLorebook;
  var sources = [{ id: 'output:' + s.turn, text: String(outputText || '') }];
  var entries = Array.isArray(history) ? history : [];
  var start = Math.max(0, entries.length - 4);
  for (var i = start; i < entries.length; i++) {
    var e = entries[i];
    if (!e) continue;
    sources.push({ id: 'history:' + i, text: String(e.text || '') + '\n' + String(e.rawText || '') });
  }
  for (var j = 0; j < sources.length; j++) {
    var src = sources[j];
    if (!loreTextIncludes(src.text, needles)) continue;
    var sig = kind + ':' + src.id + ':' + src.text.slice(0, 120);
    if (s.consumedCommands[sig]) return false;
    s.consumedCommands[sig] = loreNow();
    return true;
  }
  return false;
}

function autoLorebookStep(outputText) {
  var s = state.autoLorebook;
  s.turn += 1;

  if (loreConsumeCommand('reset', outputText, ['lorebook reset', '[[lorebook:reset]]'])) {
    loreReset();
    return true;
  }
  if (loreConsumeCommand('rebuild', outputText, ['lorebook rebuild', '[[lorebook:rebuild]]'])) {
    s.lastRunTurn = -999;
  }

  // Always pull whatever responses are waiting before deciding to kick a new
  // request — that way a freshly-completed extraction immediately frees the
  // pending slot for the next eligible turn.
  lorePollResponse();

  if (loreShouldKick()) {
    loreQueueExtraction(loreExtractionMessages());
  }

  loreWriteStatus();
  return true;
}
