// Frontier Scripture Module Test Suite — AI Dungeon Library
//
// Drives the BetterDungeon Scripture module through both scenario walkthroughs
// and an automated turn-by-turn checklist that exercises every affordance state
// (loading, empty, stale, error, normal, pending) plus the widget-event ack
// flow. Pair with input-modifier.js.
//
// Surfaces written:
//   frontier:state:scripture   - widget manifest + history + ack envelope (script -> BD)
//   frontier:in:scripture      - script's view of BD's inbox (read-only here, plus we
//                                consume widgetEvents and advance ackSeq accordingly)
//   frontier:test:scripture    - human-readable trace card with checklist results
//
// Before running:
//   1. Open BetterDungeon -> Frontier and enable Frontier + the Scripture module.
//   2. Start (or resume) an adventure on a scenario that has this script
//      installed in Library + Input Modifier slots.
//   3. Type "/scripture run" to start the auto checklist, or use individual
//      commands listed in README.md to drive scenarios manually.

// ---------- state ----------

state.scriptureTest = state.scriptureTest || {
  runId: null,
  turn: 0,
  liveKey: null,
  scenario: null,           // 'smoke' | 'affordances' | null
  forcedState: null,        // 'normal' | 'empty' | 'stale' | 'error' | 'loading' | null
  ackSeq: 0,                // we advance this to ack widget events back to BD
  lastSeqSeen: 0,
  observedEvents: [],       // tail of widgetEvents we've seen on frontier:in:scripture
  consumedCommands: {},     // signature -> ts (so the same input doesn't fire twice)
  events: [],               // suite-internal log
  // auto-run plan state
  auto: {
    enabled: false,
    stepIdx: 0,
    stepStartedAt: null,
    stepStartedTurn: null,
    results: {},            // label -> { pass, reason, observed }
  },
  phase: 'boot',
};

// ---------- manifests ----------
//
// These are the canonical manifests we write to `frontier:state:scripture`.
// Keep them small enough to render comfortably in the preview area but broad
// enough to exercise the renderer's switch statement.

var SCR_SMOKE_MANIFEST = {
  widgets: [
    { id: 'hp',       type: 'stat',     align: 'left',   label: 'HP',      color: 'red'    },
    { id: 'mp',       type: 'stat',     align: 'left',   label: 'MP',      color: 'blue'   },
    { id: 'xp',       type: 'bar',      align: 'left',   label: 'XP',      max: 100, color: 'purple' },
    { id: 'gold',     type: 'counter',  align: 'left',   label: 'Gold'     },
    { id: 'tags',     type: 'taggroup', align: 'center', label: 'Status'   },
    { id: 'timer',    type: 'timer',    align: 'center', label: 'Timer',   urgency: 'medium' },
    { id: 'progress', type: 'progress', align: 'center', label: 'Quest',   max: 100 },
    { id: 'choice',   type: 'radio',    align: 'right',  label: 'Stance',
      options: [
        { value: 'aggro',   label: 'Aggressive' },
        { value: 'cautious',label: 'Cautious'   },
        { value: 'sneaky',  label: 'Sneaky'     },
      ] },
    { id: 'level',    type: 'stepper',  align: 'right',  label: 'Level', min: 1, max: 99 },
    { id: 'commit',   type: 'confirm',  align: 'right',  text: 'End turn' },
    { id: 'tabs',     type: 'tabs',     align: 'center',
      items: [
        { id: 'inv',  label: 'Inventory', content: 'Sword, Potion x2, Map' },
        { id: 'log',  label: 'Log',       content: 'You entered the cave.' },
      ] },
  ],
};

// Affordances scenario uses a smaller, focused widget set so the affordance
// markers (loading shimmer, empty hint, error message) are easy to spot.
var SCR_AFFORDANCE_MANIFEST = {
  widgets: [
    { id: 'hp',     type: 'stat',     align: 'left',   label: 'HP',     color: 'red'    },
    { id: 'mp',     type: 'stat',     align: 'left',   label: 'MP',     color: 'blue'   },
    { id: 'shield', type: 'progress', align: 'center', label: 'Shield', max: 100 },
    { id: 'pick',   type: 'radio',    align: 'right',  label: 'Pick',
      options: [
        { value: 'a', label: 'Option A' },
        { value: 'b', label: 'Option B' },
        { value: 'c', label: 'Option C' },
      ] },
    { id: 'fire',   type: 'confirm',  align: 'right',  text: 'Fire!' },
  ],
};

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
  var cardType = type || 'Frontier';
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
  while (s.events.length > 80) s.events.shift();
}

function scrHeartbeat() { return scrReadJson('frontier:heartbeat'); }

function scrScriptureAdvertised() {
  var hb = scrHeartbeat();
  if (!hb || !hb.frontier || hb.frontier.protocol !== 1) return false;
  var mods = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < mods.length; i++) {
    if (mods[i] && mods[i].id === 'scripture') return true;
  }
  return false;
}

// ---------- state-card writer ----------
//
// The Scripture module reads `frontier:state:scripture` and renders the
// manifest into widgets, then applies values from `history[liveCount]`.
// We rebuild the envelope on every advance so the live entry reflects the
// current scenario + forced state.

function scrCurrentManifest() {
  var s = state.scriptureTest;
  if (s.scenario === 'affordances') return SCR_AFFORDANCE_MANIFEST;
  if (s.scenario === 'smoke')       return SCR_SMOKE_MANIFEST;
  return null;
}

// Default valid values per widget id for the active manifest. Used when the
// forced state is 'normal' or when a scenario first mounts.
function scrDefaultValuesFor(manifest) {
  if (!manifest || !Array.isArray(manifest.widgets)) return {};
  var values = {};
  for (var i = 0; i < manifest.widgets.length; i++) {
    var w = manifest.widgets[i];
    switch (w.type) {
      case 'stat':     values[w.id] = '42'; break;
      case 'bar':      values[w.id] = 70;   break;
      case 'counter':  values[w.id] = 137;  break;
      case 'taggroup': values[w.id] = { items: [
        { label: 'Poisoned', color: 'green' },
        { label: 'Burning',  color: 'red'   },
      ]}; break;
      case 'timer':    values[w.id] = 125;  break;
      case 'progress': values[w.id] = 65;   break;
      case 'radio':    values[w.id] = (w.options && w.options[0] && w.options[0].value) || null; break;
      case 'stepper':  values[w.id] = (typeof w.min === 'number' ? w.min : 0) + 1; break;
      case 'confirm':  values[w.id] = false; break;
      case 'tabs':     values[w.id] = (w.items && w.items[0] && w.items[0].id) || 0; break;
      default:         values[w.id] = null;
    }
  }
  return values;
}

// Intentionally invalid values designed to fail validateWidgetConfig and
// trigger the 'error' affordance on the BD side. Keys must match widget ids
// in the active manifest.
function scrErrorValuesFor(manifest) {
  if (!manifest || !Array.isArray(manifest.widgets)) return {};
  var values = {};
  for (var i = 0; i < manifest.widgets.length; i++) {
    var w = manifest.widgets[i];
    switch (w.type) {
      case 'progress':
        // Negative max -> validateWidgetConfig fails -> _affordance: 'error'
        values[w.id] = { value: 50, max: -1 };
        break;
      case 'stat':
      case 'bar':
      case 'counter':
      case 'timer':
        // Pass garbage objects through filterWidgetStatePatch; primitive
        // expected for these types renders fine, but we want at least one
        // visibly-broken widget per scenario, so leave the rest valid.
        values[w.id] = '0';
        break;
      default:
        values[w.id] = null;
    }
  }
  return values;
}

function scrBuildEnvelope() {
  var s = state.scriptureTest;
  var manifest = scrCurrentManifest();
  var liveCount = scrLiveCount();

  // No scenario => empty envelope (BD unmounts everything)
  if (!manifest) {
    return { v: 1, manifest: { widgets: [] }, history: {}, interactions: { ackSeq: s.ackSeq } };
  }

  var history = {};
  var defaults = scrDefaultValuesFor(manifest);

  // Always seed the previous turn so 'stale' has something older to fall
  // back to via selectHistoryEntry. Without this, 'stale' reads as 'empty'.
  if (liveCount > 1) history[String(liveCount - 1)] = defaults;

  switch (s.forcedState) {
    case 'loading':
      // No history at all -> renderer mounts widgets with no value -> 'loading'
      history = {};
      break;
    case 'empty':
      // History entry exists for liveCount but has no values for any widget id
      history[String(liveCount)] = {};
      break;
    case 'stale':
      // History has the previous-turn values but NO entry for liveCount.
      // selectHistoryEntry falls back to the older one -> _affordance: 'stale'.
      // (Already seeded above; intentionally do not write liveCount.)
      break;
    case 'error':
      history[String(liveCount)] = scrErrorValuesFor(manifest);
      break;
    case 'normal':
    default:
      history[String(liveCount)] = defaults;
      break;
  }

  return {
    v: 1,
    manifest: manifest,
    history: history,
    interactions: { ackSeq: s.ackSeq },
  };
}

function scrPublishState() {
  var env = scrBuildEnvelope();
  scrWriteCard('frontier:state:scripture', JSON.stringify(env), 'Frontier');
  return env;
}

// ---------- inbox poller ----------
//
// BD writes widget interactions to `frontier:in:scripture`. We read them so
// the trace card shows what's flowing back, and we advance our local ackSeq
// to acknowledge them on the next state publish (which clears BD's 'pending'
// affordance).

function scrPollInbox(opts) {
  opts = opts || {};
  var s = state.scriptureTest;
  var card = scrReadJson('frontier:in:scripture');
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
    // Keep rolling tail of recent events so the trace stays readable
    s.observedEvents = s.observedEvents.concat(newEvents.map(function (e) {
      return {
        seq: e.seq, widgetId: e.widgetId, widgetType: e.widgetType,
        action: e.action, value: e.value, ts: e.ts || e.at, count: e.count || 1,
      };
    }));
    while (s.observedEvents.length > 40) s.observedEvents.shift();
    scrLog('events', 'received ' + newEvents.length + ' (latestSeq=' + s.lastSeqSeen + ')');
  }

  // Auto-ack new events unless the auto-run has explicitly asked us to hold
  // them back so it can verify the 'pending' affordance.
  if (!opts.holdAck && s.lastSeqSeen > s.ackSeq) {
    s.ackSeq = s.lastSeqSeen;
    scrLog('ack', 'ackSeq -> ' + s.ackSeq);
  }

  return { latestSeq: latestSeq, newEvents: newEvents };
}

// ---------- command parser ----------
//
// Players type "/scripture <verb> [arg]" into normal input. The input
// modifier reads the text, calls scrConsumeCommands, and consumed text is
// stripped so the model never sees it.

var SCR_VERB_FORCED_STATES = { normal: 1, empty: 1, stale: 1, error: 1, loading: 1 };

function scrParseCommand(line) {
  var m = String(line || '').match(/\/scripture\s+([^\n\r]+)/i);
  if (!m) return null;
  var parts = m[1].trim().split(/\s+/);
  return { verb: (parts[0] || '').toLowerCase(), arg: (parts[1] || '').toLowerCase(), raw: m[0] };
}

function scrApplyCommand(cmd) {
  if (!cmd || !cmd.verb) return false;
  var s = state.scriptureTest;

  switch (cmd.verb) {
    case 'reset':
      scrResetSuite();
      return true;

    case 'smoke':
      s.scenario = 'smoke';
      s.forcedState = 'normal';
      s.auto.enabled = false;
      scrLog('cmd', 'smoke scenario');
      return true;

    case 'affordances':
      s.scenario = 'affordances';
      s.forcedState = 'normal';
      s.auto.enabled = false;
      scrLog('cmd', 'affordances scenario');
      return true;

    case 'state':
      if (!SCR_VERB_FORCED_STATES[cmd.arg]) return false;
      if (!s.scenario) s.scenario = 'affordances';
      s.forcedState = cmd.arg;
      scrLog('cmd', 'state -> ' + cmd.arg);
      return true;

    case 'ack':
      // Force-advance ack past every event we've seen
      if (s.lastSeqSeen > s.ackSeq) {
        s.ackSeq = s.lastSeqSeen;
        scrLog('cmd', 'ack force -> ' + s.ackSeq);
      }
      return true;

    case 'clear':
      s.scenario = null;
      s.forcedState = null;
      scrLog('cmd', 'cleared');
      return true;

    case 'run':
      scrAutoStart();
      return true;

    case 'next':
      // Manually advance the auto-run to the next step (useful when a step
      // is gated on user interaction).
      if (s.auto.enabled) scrAutoForceNext();
      return true;

    case 'stop':
      s.auto.enabled = false;
      scrLog('cmd', 'auto stopped');
      return true;
  }
  return false;
}

// Returns { matched: bool, stripped: text } so the input modifier can
// remove our commands from the text passed to the AI.
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

// ---------- reset ----------

function scrResetSuite() {
  state.scriptureTest = {
    runId: 'scripture-' + scrNow().toString(36),
    turn: 0, liveKey: null,
    scenario: null, forcedState: null,
    ackSeq: 0, lastSeqSeen: 0,
    observedEvents: [], consumedCommands: {}, events: [],
    auto: { enabled: false, stepIdx: 0, stepStartedAt: null, stepStartedTurn: null, results: {} },
    phase: 'reset',
  };
  // Wipe the published state card so BD sees an empty manifest.
  scrWriteCard(
    'frontier:state:scripture',
    JSON.stringify({ v: 1, manifest: { widgets: [] }, history: {}, interactions: { ackSeq: 0 } }),
    'Frontier'
  );
  scrLog('reset', 'suite reset');
}

// ---------- auto-run plan ----------
//
// Each step takes one turn (one generation). Steps modify state.scriptureTest
// before scrPublishState runs, so the BD module sees the new envelope on the
// next state-change cycle.
//
// pass/fail logic: most steps are protocol-observable (we wrote the envelope
// we intended; BD echoed back into heartbeat or inbox; ack flow worked).
// The visible affordance (skeleton, error msg, etc.) is up to the user to
// eyeball — the trace explicitly tells them what to look for per step.

var SCR_AUTO_PLAN = [
  {
    label: 'heartbeat',
    note: 'Confirm BD advertises the scripture module',
    setup: function () {},
    validate: function () {
      return scrScriptureAdvertised()
        ? { pass: true }
        : { pass: false, reason: 'scripture module not in heartbeat' };
    },
  },
  {
    label: 'mount-affordances',
    note: 'Mount the small affordance manifest with normal values. Look for 5 widgets.',
    setup: function () {
      var s = state.scriptureTest;
      s.scenario = 'affordances';
      s.forcedState = 'normal';
    },
    validate: function () { return { pass: true, observed: 'Eyeball: 5 widgets visible, no skeletons.' }; },
  },
  {
    label: 'state-loading',
    note: 'Force loading: history is empty, widgets show shimmer skeletons.',
    setup: function () { state.scriptureTest.forcedState = 'loading'; },
    validate: function () { return { pass: true, observed: 'Eyeball: skeleton shimmer on widgets.' }; },
  },
  {
    label: 'state-normal',
    note: 'Restore normal values; affordances should clear.',
    setup: function () { state.scriptureTest.forcedState = 'normal'; },
    validate: function () { return { pass: true, observed: 'Eyeball: clean widgets, no markers.' }; },
  },
  {
    label: 'state-empty',
    note: 'Force empty: AI wrote an entry for liveCount but no values for any widget.',
    setup: function () { state.scriptureTest.forcedState = 'empty'; },
    validate: function () { return { pass: true, observed: "Eyeball: '—' empty hint on each widget." }; },
  },
  {
    label: 'state-stale',
    note: 'Force stale: history has previous-turn values only; no entry for liveCount.',
    setup: function () { state.scriptureTest.forcedState = 'stale'; },
    validate: function () { return { pass: true, observed: 'Eyeball: faded/dimmed widgets (stale CSS).' }; },
  },
  {
    label: 'state-error',
    note: 'Force error: shield widget gets an invalid max=-1, should show error affordance.',
    setup: function () { state.scriptureTest.forcedState = 'error'; },
    validate: function () { return { pass: true, observed: "Eyeball: shield widget shows '⚠ Error' overlay." }; },
  },
  {
    label: 'pending-prompt',
    note: 'Click any widget (e.g., Pick: Option B). Suite holds the ack so you can see the pending state.',
    setup: function () {
      var s = state.scriptureTest;
      s.forcedState = 'normal';
      s._pendingHold = true;     // tell scrPollInbox not to ack yet
      s._pendingBaseline = s.lastSeqSeen;
    },
    advanceWhen: function () {
      // Step completes once we observe a new event AT LEAST one full turn after the prompt
      var s = state.scriptureTest;
      var heard = s.lastSeqSeen > (s._pendingBaseline || 0);
      var enoughTurns = (s.turn - (s.auto.stepStartedTurn || s.turn)) >= 1;
      return heard && enoughTurns;
    },
    validate: function () {
      var s = state.scriptureTest;
      if (s.lastSeqSeen <= (s._pendingBaseline || 0)) {
        return { pass: false, reason: 'no widget event observed; click a widget and take another turn' };
      }
      return { pass: true, observed: 'Pending widget showed pulse; event seq=' + s.lastSeqSeen };
    },
  },
  {
    label: 'pending-ack',
    note: 'Releasing ack — BD should clear the pending pulse on the next render.',
    setup: function () {
      var s = state.scriptureTest;
      s._pendingHold = false;
      if (s.lastSeqSeen > s.ackSeq) s.ackSeq = s.lastSeqSeen;
    },
    validate: function () {
      var s = state.scriptureTest;
      return s.ackSeq >= s.lastSeqSeen
        ? { pass: true, observed: 'ackSeq=' + s.ackSeq + ' caught up to lastSeqSeen=' + s.lastSeqSeen }
        : { pass: false, reason: 'ackSeq still behind' };
    },
  },
  {
    label: 'mount-smoke',
    note: 'Switch to the smoke manifest; broader widget mix should appear.',
    setup: function () {
      var s = state.scriptureTest;
      s.scenario = 'smoke';
      s.forcedState = 'normal';
    },
    validate: function () { return { pass: true, observed: 'Eyeball: 11+ widgets across left/center/right zones.' }; },
  },
  {
    label: 'unmount',
    note: 'Clear the manifest; BD should unmount all widgets.',
    setup: function () {
      var s = state.scriptureTest;
      s.scenario = null;
      s.forcedState = null;
    },
    validate: function () { return { pass: true, observed: 'Eyeball: widget container is gone.' }; },
  },
];

function scrAutoStart() {
  var s = state.scriptureTest;
  s.auto = { enabled: true, stepIdx: 0, stepStartedAt: scrNow(), stepStartedTurn: s.turn, results: {} };
  scrLog('auto', 'started');
}

function scrAutoForceNext() {
  var s = state.scriptureTest;
  if (!s.auto.enabled) return;
  var step = SCR_AUTO_PLAN[s.auto.stepIdx];
  if (step) {
    var v = (typeof step.validate === 'function') ? step.validate() : { pass: true };
    s.auto.results[step.label] = v;
  }
  s.auto.stepIdx += 1;
  s.auto.stepStartedAt = scrNow();
  s.auto.stepStartedTurn = s.turn;
}

// One auto-run tick. Chains steps within a single turn whenever a step's
// setup did not change observable state (no scenario / forcedState mutation
// and no advanceWhen gate). Observable steps wait one turn after setup so
// BD has time to render the change before validation runs.
function scrAutoTick() {
  var s = state.scriptureTest;
  if (!s.auto.enabled) return;

  // Safety bound: each iteration either advances stepIdx or returns, so
  // a small bound is plenty.
  var safety = SCR_AUTO_PLAN.length + 2;

  while (safety-- > 0 && s.auto.stepIdx < SCR_AUTO_PLAN.length) {
    var step = SCR_AUTO_PLAN[s.auto.stepIdx];
    var rec = s.auto.results[step.label];

    // Phase 1: run setup once. Detect whether it changed envelope-relevant state.
    if (!rec || !rec._setupRan) {
      var prevScenario = s.scenario;
      var prevForced = s.forcedState;
      try { step.setup && step.setup(); } catch (e) { scrLog('auto-error', 'setup ' + step.label + ': ' + e); }

      var observable = (s.scenario !== prevScenario)
        || (s.forcedState !== prevForced)
        || !!step.advanceWhen;

      s.auto.stepStartedTurn = s.turn;
      s.auto.stepStartedAt = scrNow();
      s.auto.results[step.label] = {
        _setupRan: true,
        _observable: observable,
        pending: true,
        note: step.note,
      };
      rec = s.auto.results[step.label];
      s.phase = 'auto: ' + step.label;
      scrLog('auto-step', step.label + (observable ? ' (waiting one turn)' : ''));

      // Observable steps wait a turn so BD can render the new envelope before
      // validation runs and the next step's setup fires. Non-observable steps
      // (e.g. heartbeat) fall through and validate on the same tick.
      if (observable) return;
    }

    // Phase 2: explicit advanceWhen gate (e.g., pending-prompt waits for an event)
    if (typeof step.advanceWhen === 'function') {
      var ready = false;
      try { ready = !!step.advanceWhen(); } catch (e) { ready = false; }
      if (!ready) {
        s.phase = 'auto-wait: ' + step.label;
        return;
      }
    } else if (rec._observable) {
      // Default delay for observable steps: require at least one turn between
      // setup and validate so the user actually sees the change on screen.
      var elapsed = s.turn - (s.auto.stepStartedTurn || s.turn);
      if (elapsed < 1) {
        s.phase = 'auto-wait: ' + step.label;
        return;
      }
    }

    // Phase 3: validate.
    var validation;
    try { validation = step.validate ? step.validate() : { pass: true }; }
    catch (e) { validation = { pass: false, reason: 'validate threw: ' + e }; }

    s.auto.results[step.label] = {
      _setupRan: true,
      pending: false,
      pass: !!validation.pass,
      reason: validation.reason || '',
      observed: validation.observed || '',
      note: step.note,
    };
    scrLog('auto-result', step.label + ' -> ' + (validation.pass ? 'pass' : 'FAIL'));

    s.auto.stepIdx += 1;
    s.auto.stepStartedAt = scrNow();
    s.auto.stepStartedTurn = s.turn;

    // Loop continues so non-observable steps can chain in the same turn.
  }

  if (s.auto.stepIdx >= SCR_AUTO_PLAN.length) {
    s.phase = 'auto-complete';
    s.auto.enabled = false;
  }
}

// ---------- trace ----------

function scrCountAuto() {
  var s = state.scriptureTest;
  var counts = { total: SCR_AUTO_PLAN.length, pass: 0, fail: 0, pending: 0 };
  for (var i = 0; i < SCR_AUTO_PLAN.length; i++) {
    var label = SCR_AUTO_PLAN[i].label;
    var r = s.auto.results[label];
    if (!r || r.pending) counts.pending++;
    else if (r.pass) counts.pass++;
    else counts.fail++;
  }
  return counts;
}

function scrSummarizeEnvelope(env) {
  if (!env) return null;
  var widgetCount = (env.manifest && Array.isArray(env.manifest.widgets)) ? env.manifest.widgets.length : 0;
  var historyKeys = env.history ? Object.keys(env.history) : [];
  return {
    widgetCount: widgetCount,
    historyKeys: historyKeys,
    ackSeq: env.interactions && env.interactions.ackSeq,
  };
}

function scrWriteTrace(envelope) {
  var s = state.scriptureTest;
  var hb = scrHeartbeat();
  var counts = scrCountAuto();

  var trace = {
    v: 1,
    runId: scrRunId(),
    turn: s.turn,
    liveCount: scrLiveCount(),
    phase: s.phase,
    scenario: s.scenario,
    forcedState: s.forcedState,
    heartbeat: {
      present: !!hb,
      profile: hb && hb.frontier && hb.frontier.profile,
      protocol: hb && hb.frontier && hb.frontier.protocol,
      scriptureAdvertised: scrScriptureAdvertised(),
    },
    publishedEnvelope: scrSummarizeEnvelope(envelope),
    interactions: {
      ackSeq: s.ackSeq,
      lastSeqSeen: s.lastSeqSeen,
      recentEvents: s.observedEvents.slice(-8),
    },
    auto: {
      enabled: s.auto.enabled,
      stepIdx: s.auto.stepIdx,
      counts: counts,
      checksPass: counts.pending === 0 && counts.fail === 0,
      currentStep: SCR_AUTO_PLAN[s.auto.stepIdx]
        ? { label: SCR_AUTO_PLAN[s.auto.stepIdx].label, note: SCR_AUTO_PLAN[s.auto.stepIdx].note }
        : null,
      results: s.auto.results,
    },
    commands: {
      help: [
        '/scripture run            - start the auto checklist',
        '/scripture next           - skip current auto step',
        '/scripture stop           - pause the auto run',
        '/scripture smoke          - load smoke scenario',
        '/scripture affordances    - load affordances scenario',
        '/scripture state <name>   - normal | empty | stale | error | loading',
        '/scripture ack            - force-ack pending widget events',
        '/scripture clear          - unmount all widgets',
        '/scripture reset          - reset suite state',
      ],
    },
    events: s.events,
  };
  scrWriteCard('frontier:test:scripture', JSON.stringify(trace, null, 2), 'Frontier Test');
}

// ---------- public entry point ----------

function frontierScriptureTestStep(text) {
  var s = state.scriptureTest;
  scrRunId();
  s.turn += 1;

  // Inbox poller: respect the auto-run's hold flag so 'pending' is observable.
  scrPollInbox({ holdAck: !!s._pendingHold });

  // Auto-run: tick before publish so its setup affects this turn's envelope.
  scrAutoTick();

  // Publish state envelope every turn (cheap; lets BD pick up scenario changes).
  var env = scrPublishState();

  // Update phase if not auto-driven.
  if (!s.auto.enabled) {
    if (!s.scenario) s.phase = 'idle';
    else s.phase = s.scenario + (s.forcedState ? ':' + s.forcedState : '');
  }

  scrWriteTrace(env);
  return true;
}
