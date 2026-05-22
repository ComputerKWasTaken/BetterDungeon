// Ultrascripts Scripture Module Test Suite — AI Dungeon Library
//
// Behavior-focused widget test suite. Loads curated manifests that exercise
// every supported widget type, plus scenarios for invalid configs, value
// transitions, and edge cases. Pair with input-modifier.js + output-modifier.js.
//
// Surfaces written:
//   ultrascripts:state:scripture   - widget manifest + history + ack envelope (script -> BD)
//   ultrascripts:in:scripture      - script's view of BD's inbox (read-only here)
//   ultrascripts:test:scripture    - human-readable trace with scenario, values, events
//
// Commands:
//   /scripture display      - stat/bar/counter/progress/taggroup/divider/icon/badge/text
//   /scripture interactive  - radio/stepper/confirm/chipselect/button/toggle/select/slider/input/textarea
//   /scripture containers   - accordion/tabs/dropdown/sortable
//   /scripture invalid      - broken configs (module should skip with a warning)
//   /scripture transitions  - animated value changes across turns
//   /scripture edge         - empty lists, long labels, missing values, 0-width bars
//   /scripture custom       - raw HTML widgets (tables, lists, code, formatted text, images, grids)
//   /scripture panels       - panel widgets with title/items/content layouts
//   /scripture value <id> <val>  - manually set a widget's value
//   /scripture ack          - force-ack all pending widget events
//   /scripture clear        - unmount all widgets
//   /scripture reset        - reset suite state

// ---------- state ----------

state.scriptureTest = state.scriptureTest || {
  runId: null,
  turn: 0,
  scenario: null,           // 'display' | 'interactive' | 'containers' | 'invalid' | 'transitions' | 'edge' | 'custom' | 'panels'
  ackSeq: 0,
  lastSeqSeen: 0,
  observedEvents: [],
  consumedCommands: {},
  events: [],
  // value overrides set by /scripture value <id> <val>
  overrides: {},
  // transition scenario phase
  transitionIdx: 0,
};

// ---------- scenario manifests ----------

var SCR_DISPLAY_MANIFEST = {
  widgets: [
    { id: 'hp',      type: 'stat',     align: 'left',   label: 'HP',       value: '87',  color: 'red'    },
    { id: 'mp',      type: 'stat',     align: 'left',   label: 'MP',       value: '23',  color: 'blue'   },
    { id: 'xp',      type: 'bar',      align: 'left',   label: 'XP',       value: 60,    max: 100, color: 'purple' },
    { id: 'shield',  type: 'bar',      align: 'center', label: 'Shield',   value: 12,    max: 100, color: 'cyan', showValue: false },
    { id: 'gold',    type: 'counter',  align: 'left',   label: 'Gold',     value: 137,   icon: '💰' },
    { id: 'rep',     type: 'counter',  align: 'right',  label: 'Reputation', value: -3,  color: 'red' },
    { id: 'quest',   type: 'progress', align: 'center', label: 'Quest',    value: 65,    max: 100 },
    { id: 'loadout', type: 'progress', align: 'right',  label: 'Loadout',  value: 100,   max: 100, color: 'green' },
    { id: 'status',  type: 'taggroup', align: 'center', label: 'Status',
      items: [
        { label: 'Poisoned', color: 'green', icon: '🩸' },
        { label: 'Blessed',  color: 'yellow', icon: '✨' },
        { label: 'Invisible', color: 'purple' },
      ] },
    { id: 'sep1',    type: 'divider',  align: 'center' },
    { id: 'sep2',    type: 'divider',  align: 'center', label: 'Section Break' },
    { id: 'hero',    type: 'icon',     align: 'left',   icon: '⚔️', text: 'Warrior', color: 'orange' },
    { id: 'rare',    type: 'badge',    align: 'right',  text: 'Rare Drop', variant: 'outline', color: 'purple' },
    { id: 'note',    type: 'text',     align: 'center', text: 'The dungeon grows darker...' },
  ],
};

var SCR_INTERACTIVE_MANIFEST = {
  widgets: [
    { id: 'attack',  type: 'button',   align: 'left',   text: 'Attack',   value: 'strike' },
    { id: 'defend',  type: 'toggle',   align: 'left',   label: 'Defend',   value: true },
    { id: 'mode',    type: 'select',   align: 'center', label: 'Mode',
      options: [
        { value: 'auto',   label: 'Auto' },
        { value: 'manual', label: 'Manual' },
      ], value: 'manual' },
    { id: 'volume',  type: 'slider',   align: 'right',  label: 'Volume',   value: 70 },
    { id: 'name',    type: 'input',    align: 'center', label: 'Name',     value: 'Aldric' },
    { id: 'bio',     type: 'textarea', align: 'center', label: 'Bio',      value: 'A knight from the northern reach.' },
    { id: 'stance',  type: 'radio',    align: 'left',   label: 'Stance',
      options: [
        { value: 'aggro', label: 'Aggressive' },
        { value: 'def',   label: 'Defensive' },
        { value: 'sneak', label: 'Sneaky' },
      ], value: 'def' },
    { id: 'level',   type: 'stepper',  align: 'right',  label: 'Level',    value: 12, min: 1, max: 99 },
    { id: 'rest',    type: 'confirm',  align: 'right',  text: 'Rest here' },
    { id: 'party',   type: 'chipselect', align: 'center', label: 'Party',
      options: [
        { value: 'a', label: 'Aldric' },
        { value: 'k', label: 'Kira' },
        { value: 'l', label: 'Lyra' },
        { value: 't', label: 'Thorne' },
      ], value: ['a', 'k'] },
  ],
};

var SCR_CONTAINERS_MANIFEST = {
  widgets: [
    { id: 'inv',     type: 'accordion', align: 'left',
      items: [
        { id: 'weap',  label: 'Weapons',  content: 'Flame Blade, Oak Shield' },
        { id: 'pot',   label: 'Potions',  content: 'Health x3, Mana x1' },
        { id: 'scroll',label: 'Scrolls',  content: 'Fireball, Identify' },
      ], value: 'weap' },
    { id: 'info',    type: 'tabs',      align: 'center',
      items: [
        { id: 'stats', label: 'Stats',    content: 'HP 87/100 · MP 23/100 · Level 12' },
        { id: 'skills',label: 'Skills',   content: 'Fireball Lv5 · Shield Lv4 · Heal Lv2' },
        { id: 'perks', label: 'Perks',    content: 'Night Vision · Fire Affinity · Iron Will' },
      ], value: 'stats' },
    { id: 'actions', type: 'dropdown',  align: 'right', label: 'Actions',
      items: [
        { label: 'Inspect', icon: '🔍' },
        { label: 'Talk',    icon: '💬' },
        { divider: true },
        { label: 'Attack',  icon: '🗡️', danger: true },
      ] },
    { id: 'prio',    type: 'sortable',  align: 'left',   label: 'Priority',
      items: [
        { id: 'atk', label: 'Attack' },
        { id: 'def', label: 'Defend' },
        { id: 'spell', label: 'Cast Spell' },
        { id: 'item', label: 'Use Item' },
      ], value: ['atk', 'def', 'spell', 'item'] },
  ],
};

var SCR_INVALID_MANIFEST = {
  widgets: [
    // These should render
    { id: 'ok',      type: 'stat',     align: 'left',   label: 'OK',       value: '42' },
    { id: 'ok2',     type: 'progress', align: 'center', label: 'Quest',    value: 50, max: 100 },
    // These should be skipped with a console warning
    { id: 'badmax',  type: 'progress', align: 'center', label: 'BadMax',   value: 50, max: -1 },
    { id: 'badtype', type: 'notatype', align: 'right',  label: 'BadType',  value: 'x' },
    { id: 'nostep',  type: 'stepper',  align: 'right',  label: 'NoStep',   value: 'abc' },
  ],
};

var SCR_TRANSITIONS_MANIFEST = {
  widgets: [
    { id: 'hp',      type: 'stat',     align: 'left',   label: 'HP' },
    { id: 'xp',      type: 'bar',      align: 'center', label: 'XP',       max: 200 },
    { id: 'gold',    type: 'counter',  align: 'right',  label: 'Gold' },
    { id: 'quest',   type: 'progress', align: 'center', label: 'Quest',    max: 100 },
  ],
};

// Phases for the transitions scenario. Each turn advances to the next phase.
var SCR_TRANSITION_PHASES = [
  { hp: '87',  xp: 20,   gold: 0,    quest: 5   },
  { hp: '64',  xp: 60,   gold: 12,   quest: 33  },
  { hp: '42',  xp: 120,  gold: 55,   quest: 67  },
  { hp: '12',  xp: 180,  gold: 128,  quest: 92  },
  { hp: '0',   xp: 200,  gold: 250,  quest: 100 },
  { hp: '100', xp: 0,    gold: 0,    quest: 0   },
];

var SCR_EDGE_MANIFEST = {
  widgets: [
    { id: 'empty',   type: 'taggroup', align: 'left',   label: 'Empty Tags', items: [] },
    { id: 'long',    type: 'stat',     align: 'center', label: 'Very Long Label That Might Overflow', value: '99' },
    { id: 'zero',    type: 'bar',      align: 'center', label: 'Zero Bar', value: 0, max: 100 },
    { id: 'full',    type: 'bar',      align: 'center', label: 'Full Bar', value: 100, max: 100 },
    { id: 'neg',     type: 'bar',      align: 'right',  label: 'Negative', value: -20, max: 100 },
    { id: 'over',    type: 'bar',      align: 'right',  label: 'Over Max', value: 150, max: 100 },
    { id: 'noval',   type: 'stat',     align: 'left',   label: 'No Value' },
    { id: 'nolabel', type: 'counter',  align: 'right',  value: 7 },
    { id: 'onetag',  type: 'taggroup', align: 'center', items: [{ label: 'Solo' }] },
    { id: 'plain',   type: 'divider',  align: 'center' },
    { id: 'txt',     type: 'text',     align: 'center', text: '' },
    { id: 'ico',     type: 'icon',     align: 'left' },
  ],
};

var SCR_CUSTOM_MANIFEST = {
  widgets: [
    { id: 'loot',    type: 'custom', align: 'left',   html: '<h3>Loot Table</h3><table><tr><th>Item</th><th>Rarity</th><th>Qty</th></tr><tr><td>Iron Sword</td><td>Common</td><td>1</td></tr><tr><td>Health Potion</td><td>Uncommon</td><td>3</td></tr><tr><td>Ancient Relic</td><td><mark>Legendary</mark></td><td>1</td></tr></table>' },
    { id: 'notes',   type: 'custom', align: 'center', html: '<p><strong>Quest Update:</strong> The <em>Seal of Valor</em> has been recovered.</p><blockquote>"Beware the shadows beneath the cathedral." — <a href="#">Old Man Hemlock</a></blockquote><hr><p>Current objective: <u>Find the hidden vault</u></p>' },
    { id: 'rules',   type: 'custom', align: 'right',  html: '<h4>Combat Rules</h4><ol><li>Roll <code>1d20</code> for initiative</li><li>Apply <strong>flanking</strong> bonus if adjacent</li><li><s>Critical fails heal enemies</s> <em>(house-ruled out)</em></li></ol>' },
    { id: 'spell',   type: 'custom', align: 'center', html: '<pre><code>function castFireball() {\n  return dmg(8d6, "fire");\n}</code></pre>' },
    { id: 'plaindiv', type: 'divider', align: 'center' },
    { id: 'summary', type: 'custom', align: 'left',   html: '<ul><li>HP: <strong>87/100</strong></li><li>MP: <strong>23/50</strong></li><li>Gold: <strong>1,337</strong></li></ul>' },
    { id: 'diceimg', type: 'custom', align: 'center', html: '<p style="margin:0 0 6px;font-size:10px;color:var(--bd-text-muted);text-transform:uppercase;letter-spacing:0.5px;">Embedded Image</p><img src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2764%27 height=%2764%27%3E%3Crect width=%2764%27 height=%2764%27 fill=%27%238b5cf6%27 rx=%2712%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 dominant-baseline=%27central%27 text-anchor=%27middle%27 fill=%27white%27 font-size=%2728%27%3E%F0%9F%8E%B2%3C/text%3E%3C/svg%3E" alt="Dice" style="max-width:64px;border-radius:8px;display:block;margin:0 auto;">' },
    { id: 'stylegrid', type: 'custom', align: 'right',  html: '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;"><div style="background:rgba(139,92,246,0.15);padding:4px 8px;border-radius:6px;text-align:center;"><strong>STR</strong><br>18</div><div style="background:rgba(34,197,94,0.15);padding:4px 8px;border-radius:6px;text-align:center;"><strong>DEX</strong><br>14</div><div style="background:rgba(59,130,246,0.15);padding:4px 8px;border-radius:6px;text-align:center;"><strong>CON</strong><br>16</div><div style="background:rgba(239,68,68,0.15);padding:4px 8px;border-radius:6px;text-align:center;"><strong>INT</strong><br>12</div></div>' },
  ],
};

var SCR_PANELS_MANIFEST = {
  widgets: [
    { id: 'stats',   type: 'panel', align: 'left',   title: 'Character Stats',
      items: [
        { label: 'Strength',     value: 18, color: 'var(--bd-accent-light)' },
        { label: 'Dexterity',    value: 14, color: 'var(--bd-success-light)' },
        { label: 'Constitution', value: 16, color: 'var(--bd-info-light)' },
        { label: 'Intelligence', value: 12 },
        { label: 'Wisdom',       value: 10 },
        { label: 'Charisma',     value: 8,  color: 'var(--bd-error-light)' },
      ] },
    { id: 'inv',     type: 'panel', align: 'center', title: 'Inventory',
      items: [
        { label: 'Health Potion', value: 'x3' },
        { label: 'Iron Sword',    value: 'Equipped' },
        { label: 'Torch',         value: 'x5' },
        { label: 'Rope (50ft)',   value: 'x1' },
        { label: 'Gold',          value: 1337, color: 'var(--bd-warning-light)' },
      ] },
    { id: 'spells',  type: 'panel', align: 'right',  title: 'Spell Slots',
      items: [
        { label: '1st Level', value: '2 / 3' },
        { label: '2nd Level', value: '1 / 2' },
        { label: '3rd Level', value: '0 / 1' },
      ] },
    { id: 'plain',   type: 'divider', align: 'center' },
    { id: 'simple',  type: 'panel', align: 'left',   content: 'A plain text panel with no title or items. Useful for flavor text or short descriptions.' },
  ],
};

function scrManifestFor(scenario) {
  switch (scenario) {
    case 'display':      return SCR_DISPLAY_MANIFEST;
    case 'interactive':  return SCR_INTERACTIVE_MANIFEST;
    case 'containers':   return SCR_CONTAINERS_MANIFEST;
    case 'invalid':      return SCR_INVALID_MANIFEST;
    case 'transitions':  return SCR_TRANSITIONS_MANIFEST;
    case 'edge':         return SCR_EDGE_MANIFEST;
    case 'custom':       return SCR_CUSTOM_MANIFEST;
    case 'panels':       return SCR_PANELS_MANIFEST;
  }
  return null;
}

// ---------- value helpers ----------

function scrDefaultValuesFor(manifest, scenario) {
  if (!manifest || !Array.isArray(manifest.widgets)) return {};
  var values = {};

  if (scenario === 'transitions') {
    var phase = SCR_TRANSITION_PHASES[0] || {};
    for (var i = 0; i < manifest.widgets.length; i++) {
      var w = manifest.widgets[i];
      values[w.id] = phase[w.id] !== undefined ? phase[w.id] : null;
    }
    return values;
  }

  for (var i = 0; i < manifest.widgets.length; i++) {
    var w = manifest.widgets[i];
    // Prefer inline value if present, else type defaults
    if (w.value !== undefined) {
      values[w.id] = w.value;
      continue;
    }
    switch (w.type) {
      case 'stat':     values[w.id] = '42'; break;
      case 'bar':      values[w.id] = 50; break;
      case 'counter':  values[w.id] = 0; break;
      case 'progress': values[w.id] = 0; break;
      case 'taggroup': values[w.id] = { items: [] }; break;
      case 'radio':    values[w.id] = (w.options && w.options[0] && w.options[0].value) || null; break;
      case 'stepper':  values[w.id] = (typeof w.min === 'number' ? w.min : 0); break;
      case 'confirm':  values[w.id] = false; break;
      case 'chipselect': values[w.id] = []; break;
      case 'toggle':   values[w.id] = false; break;
      case 'select':   values[w.id] = (w.options && w.options[0] && w.options[0].value) || null; break;
      case 'slider':   values[w.id] = 50; break;
      case 'input':    values[w.id] = ''; break;
      case 'textarea': values[w.id] = ''; break;
      case 'button':   values[w.id] = null; break;
      case 'accordion':values[w.id] = (w.items && w.items[0] && w.items[0].id) || 0; break;
      case 'tabs':     values[w.id] = (w.items && w.items[0] && w.items[0].id) || 0; break;
      case 'dropdown': values[w.id] = null; break;
      case 'sortable': values[w.id] = (w.items || []).map(function(it) { return String(it.id || it.value || it.label); }); break;
      default:         values[w.id] = null;
    }
  }
  return values;
}

// ---------- helpers ----------

function scrNow() { return Date.now ? Date.now() : new Date().getTime(); }

function scrRunId() {
  var s = state.scriptureTest;
  if (!s.runId) s.runId = 'scripture-' + scrNow().toString(36);
  return s.runId;
}

function scrCards() { return Array.isArray(storyCards) ? storyCards : []; }

function scrFindCard(title) {
  var cards = scrCards();
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (!c) continue;
    if (c.title === title || c.keys === title || c.key === title) {
      return { card: c, index: i };
    }
  }
  return { card: null, index: -1 };
}

function scrCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function scrReadJson(title) {
  var f = scrFindCard(title);
  if (!f.card) return null;
  try { return JSON.parse(scrCardText(f.card) || '{}'); } catch (e) { return null; }
}

function scrWriteCard(title, value, type) {
  var f = scrFindCard(title);
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

function scrLiveCount() {
  return (Array.isArray(history) ? history.length : 0) + 1;
}

function scrLog(event, detail) {
  var s = state.scriptureTest;
  s.events.push({
    at: scrNow(), turn: s.turn, liveCount: scrLiveCount(),
    event: event, detail: detail || '',
  });
  while (s.events.length > 40) s.events.shift();
}

function scrHeartbeat() { return scrReadJson('ultrascripts:heartbeat'); }

function scrScriptureAdvertised() {
  var hb = scrHeartbeat();
  if (!hb || !hb.ultrascripts || hb.ultrascripts.protocol !== 1) return false;
  var mods = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < mods.length; i++) {
    if (mods[i] && mods[i].id === 'scripture') return true;
  }
  return false;
}

// ---------- envelope builder ----------

function scrCurrentValues(manifest, scenario) {
  var s = state.scriptureTest;
  var defaults = scrDefaultValuesFor(manifest, scenario);
  var overrides = s.overrides || {};
  var values = {};
  for (var k in defaults) values[k] = overrides[k] !== undefined ? overrides[k] : defaults[k];
  // Transitions scenario: apply current phase values (overrides still win)
  if (scenario === 'transitions') {
    var phase = SCR_TRANSITION_PHASES[s.transitionIdx % SCR_TRANSITION_PHASES.length] || {};
    for (var k in phase) {
      if (overrides[k] === undefined) values[k] = phase[k];
    }
  }
  return values;
}

function scrBuildEnvelope() {
  var s = state.scriptureTest;
  var manifest = scrManifestFor(s.scenario);
  var liveCount = scrLiveCount();

  if (!manifest) {
    return { v: 1, manifest: { widgets: [] }, history: {}, interactions: { ackSeq: s.ackSeq } };
  }

  var history = {};
  history[String(liveCount)] = scrCurrentValues(manifest, s.scenario);

  return {
    v: 1,
    manifest: manifest,
    history: history,
    interactions: { ackSeq: s.ackSeq },
  };
}

function scrPublishState() {
  var env = scrBuildEnvelope();
  scrWriteCard('ultrascripts:state:scripture', JSON.stringify(env), 'Ultrascripts');
  return env;
}

// ---------- inbox poller ----------

function scrPollInbox() {
  var s = state.scriptureTest;
  var card = scrReadJson('ultrascripts:in:scripture');
  if (!card) return { latestSeq: 0, newEvents: [] };

  var widgetEvents = card.widgetEvents || {};
  var events = Array.isArray(widgetEvents.events) ? widgetEvents.events : [];
  var latestSeq = Math.max(Number(widgetEvents.latestSeq || 0), s.lastSeqSeen);

  var newEvents = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    var seq = Number(e && e.seq || 0);
    if (!seq || seq <= s.lastSeqSeen) continue;
    newEvents.push(e);
  }

  if (newEvents.length) {
    s.lastSeqSeen = Math.max.apply(null, newEvents.map(function (e) { return Number(e.seq || 0); }).concat([s.lastSeqSeen]));
    s.observedEvents = s.observedEvents.concat(newEvents.map(function (e) {
      return {
        seq: e.seq, widgetId: e.widgetId, widgetType: e.widgetType,
        action: e.action, value: e.value, ts: e.ts || e.at,
      };
    }));
    while (s.observedEvents.length > 20) s.observedEvents.shift();
    scrLog('events', 'received ' + newEvents.length + ' (seq=' + s.lastSeqSeen + ')');
  }

  if (s.lastSeqSeen > s.ackSeq) {
    s.ackSeq = s.lastSeqSeen;
    scrLog('ack', 'ackSeq -> ' + s.ackSeq);
  }

  return { latestSeq: latestSeq, newEvents: newEvents };
}

// ---------- command parser ----------

function scrParseCommand(line) {
  var m = String(line || '').match(/\/scripture\s+([^\n\r]+)/i);
  if (!m) return null;
  var parts = m[1].trim().split(/\s+/);
  return { verb: (parts[0] || '').toLowerCase(), args: parts.slice(1), raw: m[0] };
}

function scrApplyCommand(cmd) {
  if (!cmd || !cmd.verb) return false;
  var s = state.scriptureTest;
  var args = cmd.args || [];

  switch (cmd.verb) {
    case 'reset':
      state.scriptureTest = {
        runId: 'scripture-' + scrNow().toString(36),
        turn: 0, scenario: null,
        ackSeq: 0, lastSeqSeen: 0,
        observedEvents: [], consumedCommands: {}, events: [],
        overrides: {}, transitionIdx: 0,
      };
      scrWriteCard(
        'ultrascripts:state:scripture',
        JSON.stringify({ v: 1, manifest: { widgets: [] }, history: {}, interactions: { ackSeq: 0 } }),
        'Ultrascripts'
      );
      scrLog('cmd', 'reset');
      return true;

    case 'display':
    case 'interactive':
    case 'containers':
    case 'invalid':
    case 'transitions':
    case 'edge':
    case 'custom':
    case 'panels':
      s.scenario = cmd.verb;
      s.overrides = {};
      scrLog('cmd', cmd.verb + ' scenario');
      return true;

    case 'value':
      if (args.length >= 2) {
        var id = args[0];
        var raw = args.slice(1).join(' ');
        var val = raw;
        if (/^-?\d+$/.test(raw)) val = Number(raw);
        else if (raw === 'true') val = true;
        else if (raw === 'false') val = false;
        else if (raw === 'null') val = null;
        else if (raw.startsWith('[') && raw.endsWith(']')) {
          try { val = JSON.parse(raw); } catch (e) {}
        }
        s.overrides[id] = val;
        scrLog('cmd', 'set ' + id + ' = ' + JSON.stringify(val));
      }
      return true;

    case 'next':
      if (s.scenario === 'transitions') {
        s.transitionIdx = (s.transitionIdx + 1) % SCR_TRANSITION_PHASES.length;
        scrLog('cmd', 'transition phase -> ' + s.transitionIdx);
      }
      return true;

    case 'ack':
      if (s.lastSeqSeen > s.ackSeq) {
        s.ackSeq = s.lastSeqSeen;
        scrLog('cmd', 'ack -> ' + s.ackSeq);
      }
      return true;

    case 'clear':
      s.scenario = null;
      s.overrides = {};
      scrLog('cmd', 'cleared');
      return true;
  }
  return false;
}

function scrConsumeCommands(text) {
  var s = state.scriptureTest;
  var raw = String(text || '');
  if (!raw) return { matched: false, stripped: raw };
  var stripped = raw;
  var matchedAny = false;
  var pattern = /\/scripture\s+[^\n\r]*/gi;
  var match;
  while ((match = pattern.exec(raw)) !== null) {
    var line = match[0];
    var sig = 'cmd:' + line + ':' + s.turn;
    if (s.consumedCommands[sig]) continue;
    s.consumedCommands[sig] = scrNow();
    var parsed = scrParseCommand(line);
    if (parsed && scrApplyCommand(parsed)) {
      matchedAny = true;
      stripped = stripped.replace(line, '').replace(/[ \t]{2,}/g, ' ');
    }
  }
  return { matched: matchedAny, stripped: stripped.trim() };
}

// ---------- trace ----------

function scrSummarizeEnvelope(env) {
  if (!env) return null;
  var widgetCount = (env.manifest && Array.isArray(env.manifest.widgets)) ? env.manifest.widgets.length : 0;
  var historyKeys = env.history ? Object.keys(env.history) : [];
  var values = (env.history && historyKeys.length) ? env.history[historyKeys[0]] : {};
  return {
    widgetCount: widgetCount,
    historyKeys: historyKeys,
    ackSeq: env.interactions && env.interactions.ackSeq,
    values: values,
  };
}

function scrWriteTrace(envelope) {
  var s = state.scriptureTest;
  var hb = scrHeartbeat();
  var summary = scrSummarizeEnvelope(envelope);
  var manifest = scrManifestFor(s.scenario);

  var trace = {
    v: 2,
    runId: scrRunId(),
    turn: s.turn,
    liveCount: scrLiveCount(),
    phase: s.scenario || 'idle',
    scenario: s.scenario,
    transitionPhase: s.scenario === 'transitions'
      ? { idx: s.transitionIdx, total: SCR_TRANSITION_PHASES.length }
      : null,
    heartbeat: {
      present: !!hb,
      scriptureAdvertised: scrScriptureAdvertised(),
    },
    publishedEnvelope: summary,
    interactions: {
      ackSeq: s.ackSeq,
      lastSeqSeen: s.lastSeqSeen,
      recentEvents: s.observedEvents.slice(-6),
    },
    widgets: manifest
      ? manifest.widgets.map(function (w) {
        return { id: w.id, type: w.type, currentValue: summary.values && summary.values[w.id] };
      })
      : [],
    commands: [
      '/scripture display      - stat / bar / counter / progress / taggroup / divider / icon / badge / text',
      '/scripture interactive  - radio / stepper / confirm / chipselect / button / toggle / select / slider / input / textarea',
      '/scripture containers   - accordion / tabs / dropdown / sortable',
      '/scripture invalid      - broken configs (module should skip them)',
      '/scripture transitions  - animated value changes across turns',
      '/scripture edge         - empty lists, long labels, 0-width bars, etc.',
      '/scripture value <id> <val>  - manually set a widget value',
      '/scripture next         - advance transition to next phase',
      '/scripture ack          - force-ack pending events',
      '/scripture clear        - unmount all widgets',
      '/scripture reset        - reset suite state',
    ],
    events: s.events.slice(-12),
  };
  scrWriteCard('ultrascripts:test:scripture', JSON.stringify(trace, null, 2), 'Ultrascripts Test');
}

// ---------- public entry point ----------

function ultrascriptsScriptureTestStep(text) {
  var s = state.scriptureTest;
  scrRunId();
  s.turn += 1;

  scrPollInbox();

  // Auto-advance transition scenario each turn
  if (s.scenario === 'transitions') {
    s.transitionIdx = (s.transitionIdx + 1) % SCR_TRANSITION_PHASES.length;
  }

  var env = scrPublishState();
  scrWriteTrace(env);
  return true;
}
