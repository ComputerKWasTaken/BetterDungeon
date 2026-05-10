// Chronos V2 - Frontier multi-module example
//
// Chronos V2 is a direct-tracking time and weather engine for AI Dungeon.
// It showcases several Frontier modules working together:
//   - Scripture: interactive dashboard widgets.
//   - Clock: real-world time initialization and manual sync.
//   - Weather: optional real current-weather lookups.
//
// Setup:
//   1. Enable BetterDungeon -> Frontier.
//   2. Enable Scripture, Clock, and Weather as desired.
//   3. Paste this file into the AI Dungeon Library tab.
//   4. Paste input.js, context.js, and output.js into their tabs.
//   5. Start or resume the adventure. Chronos V2 is enabled by default.

var CHRONOS_CONFIG_CARD_TITLE = 'Configure Chronos V2';
var CHRONOS_TRACE_CARD_TITLE = 'Chronos V2 Trace';
var CHRONOS_COMMANDS_CARD_TITLE = 'Chronos V2 Commands';
var CHRONOS_CARD_TYPE = 'Chronos';
var CHRONOS_SCRIPTURE_STATE_CARD = 'frontier:state:scripture';

var CHRONOS_DEFAULT_CONFIG = {
  enabled: true,
  minutesPerTurn: 2,
  timeMode: 'simulated',
  useClockStart: true,
  weatherMode: 'simulated',
  place: '',
  temperatureUnit: 'F',
  showContext: true,
  widgetHistoryLimit: 80,
  wakeHour: 7,
  weatherRefreshTurns: 30,
  weatherChangeCooldown: 15,
  maxPendingTurns: 12,
  timeZone: '',
  showTrace: true
};

var CHRONOS_COMMANDS_ENTRY = [
  '--- Status ---',
  ':time - Show current time and status',
  ':date - Show current date and season',
  ':weather - Show weather status',
  ':chronos - Full Chronos status',
  '',
  '--- Time Control ---',
  ':advance <N> <unit> - Advance time, e.g. :advance 3 hours',
  ':sleep - Sleep until the configured wake hour',
  ':settime <HH:MM> - Set story time',
  ':setdate <day> <month> <year> - Set story date',
  ':pause - Pause automatic time advancement',
  ':resume - Resume automatic time advancement',
  '',
  '--- Weather ---',
  ':setweather <condition> - Set simulated weather',
  '',
  '--- System ---',
  ':chronos help - Show this command list',
  ':chronos reset - Reset Chronos V2 state'
].join('\n');

var CHRONOS_MONTHS = [
  { name: 'January', days: 31 },
  { name: 'February', days: 28 },
  { name: 'March', days: 31 },
  { name: 'April', days: 30 },
  { name: 'May', days: 31 },
  { name: 'June', days: 30 },
  { name: 'July', days: 31 },
  { name: 'August', days: 31 },
  { name: 'September', days: 30 },
  { name: 'October', days: 31 },
  { name: 'November', days: 30 },
  { name: 'December', days: 31 }
];

var CHRONOS_WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

var CHRONOS_PHASES = [
  { name: 'Midnight', start: 0, end: 4, color: 'purple' },
  { name: 'Dawn', start: 4, end: 6, color: 'orange' },
  { name: 'Morning', start: 6, end: 12, color: 'yellow' },
  { name: 'Afternoon', start: 12, end: 17, color: 'cyan' },
  { name: 'Evening', start: 17, end: 21, color: 'orange' },
  { name: 'Night', start: 21, end: 24, color: 'blue' }
];

var CHRONOS_WEATHER = {
  clear: { label: 'Clear', color: 'yellow' },
  partly_cloudy: { label: 'Partly cloudy', color: 'cyan' },
  cloudy: { label: 'Cloudy', color: 'blue' },
  overcast: { label: 'Overcast', color: 'purple' },
  light_rain: { label: 'Light rain', color: 'blue' },
  rain: { label: 'Rain', color: 'blue' },
  heavy_rain: { label: 'Heavy rain', color: 'purple' },
  thunderstorm: { label: 'Thunderstorm', color: 'purple' },
  fog: { label: 'Fog', color: 'cyan' },
  windy: { label: 'Windy', color: 'cyan' },
  light_snow: { label: 'Light snow', color: 'blue' },
  snow: { label: 'Snow', color: 'cyan' },
  heavy_snow: { label: 'Heavy snow', color: 'purple' }
};

var CHRONOS_TRANSITIONS = {
  Spring: {
    clear: [['clear', 4], ['partly_cloudy', 3], ['light_rain', 1], ['windy', 1]],
    partly_cloudy: [['clear', 3], ['partly_cloudy', 3], ['cloudy', 2], ['light_rain', 1]],
    cloudy: [['partly_cloudy', 2], ['cloudy', 3], ['overcast', 2], ['light_rain', 2]],
    overcast: [['cloudy', 3], ['overcast', 3], ['light_rain', 2], ['rain', 1]],
    light_rain: [['partly_cloudy', 2], ['cloudy', 2], ['light_rain', 3], ['rain', 2]],
    rain: [['light_rain', 3], ['rain', 3], ['heavy_rain', 1], ['cloudy', 2]],
    heavy_rain: [['rain', 4], ['heavy_rain', 2], ['overcast', 2]],
    thunderstorm: [['rain', 3], ['heavy_rain', 2], ['overcast', 3]],
    fog: [['partly_cloudy', 3], ['cloudy', 3], ['fog', 2]],
    windy: [['clear', 3], ['partly_cloudy', 2], ['windy', 2], ['cloudy', 1]],
    light_snow: [['cloudy', 3], ['light_rain', 3], ['light_snow', 1]],
    snow: [['light_snow', 2], ['cloudy', 3], ['light_rain', 3]],
    heavy_snow: [['snow', 2], ['overcast', 3], ['rain', 3]]
  },
  Summer: {
    clear: [['clear', 5], ['partly_cloudy', 2], ['thunderstorm', 1]],
    partly_cloudy: [['clear', 3], ['partly_cloudy', 3], ['cloudy', 1], ['thunderstorm', 1]],
    cloudy: [['partly_cloudy', 3], ['cloudy', 3], ['thunderstorm', 2]],
    overcast: [['cloudy', 3], ['overcast', 2], ['heavy_rain', 1], ['thunderstorm', 2]],
    light_rain: [['partly_cloudy', 2], ['light_rain', 3], ['rain', 2], ['thunderstorm', 1]],
    rain: [['light_rain', 2], ['rain', 3], ['heavy_rain', 2], ['thunderstorm', 2]],
    heavy_rain: [['rain', 3], ['heavy_rain', 2], ['thunderstorm', 3]],
    thunderstorm: [['rain', 2], ['heavy_rain', 2], ['thunderstorm', 2], ['partly_cloudy', 2]],
    fog: [['clear', 3], ['partly_cloudy', 3], ['fog', 1]],
    windy: [['clear', 3], ['partly_cloudy', 3], ['windy', 1]],
    light_snow: [['cloudy', 4], ['partly_cloudy', 4]],
    snow: [['light_rain', 4], ['cloudy', 4]],
    heavy_snow: [['rain', 4], ['cloudy', 4]]
  },
  Autumn: {
    clear: [['clear', 3], ['partly_cloudy', 3], ['cloudy', 2], ['fog', 1]],
    partly_cloudy: [['clear', 2], ['partly_cloudy', 3], ['cloudy', 3], ['light_rain', 1]],
    cloudy: [['partly_cloudy', 2], ['cloudy', 3], ['overcast', 2], ['rain', 1], ['fog', 1]],
    overcast: [['cloudy', 2], ['overcast', 3], ['rain', 2], ['fog', 1]],
    light_rain: [['cloudy', 2], ['light_rain', 3], ['rain', 3]],
    rain: [['light_rain', 2], ['rain', 4], ['heavy_rain', 2]],
    heavy_rain: [['rain', 4], ['heavy_rain', 3], ['overcast', 2]],
    thunderstorm: [['rain', 4], ['overcast', 3], ['cloudy', 2]],
    fog: [['cloudy', 3], ['fog', 3], ['overcast', 2]],
    windy: [['clear', 2], ['partly_cloudy', 2], ['windy', 3], ['cloudy', 1]],
    light_snow: [['cloudy', 3], ['light_snow', 2], ['snow', 1]],
    snow: [['light_snow', 3], ['snow', 2], ['overcast', 2]],
    heavy_snow: [['snow', 3], ['overcast', 3]]
  },
  Winter: {
    clear: [['clear', 3], ['partly_cloudy', 2], ['cloudy', 2], ['light_snow', 1], ['fog', 1]],
    partly_cloudy: [['clear', 2], ['partly_cloudy', 3], ['cloudy', 3], ['light_snow', 1]],
    cloudy: [['partly_cloudy', 2], ['cloudy', 3], ['overcast', 2], ['light_snow', 2]],
    overcast: [['cloudy', 2], ['overcast', 3], ['snow', 2], ['light_snow', 2]],
    light_rain: [['cloudy', 2], ['light_rain', 2], ['light_snow', 3]],
    rain: [['light_rain', 2], ['rain', 2], ['snow', 2], ['cloudy', 2]],
    heavy_rain: [['rain', 3], ['heavy_snow', 2], ['overcast', 2]],
    thunderstorm: [['heavy_snow', 3], ['overcast', 3], ['snow', 2]],
    fog: [['cloudy', 3], ['fog', 3], ['light_snow', 1], ['overcast', 2]],
    windy: [['partly_cloudy', 2], ['cloudy', 2], ['windy', 3], ['light_snow', 1]],
    light_snow: [['light_snow', 3], ['snow', 3], ['cloudy', 2]],
    snow: [['snow', 4], ['heavy_snow', 2], ['light_snow', 2], ['overcast', 1]],
    heavy_snow: [['heavy_snow', 3], ['snow', 4], ['overcast', 2]]
  }
};

function chronosV2Input(text) {
  var s = chronosState();
  if (!s) return text;
  var cfg = chronosEnsureConfigCard();
  chronosEnsureCommandsCard();

  var trimmed = chronosClean(text);
  if (!trimmed || trimmed.charAt(0) !== ':') return text;

  var result = chronosHandleCommand(trimmed, cfg);
  if (!result) return text;

  s.pendingOutput = result;
  s.isCommand = true;
  s.commandLiveKey = chronosLiveKey();
  return ' ';
}

function chronosV2Context(text) {
  var s = chronosState();
  if (!s) return text;
  var cfg = chronosEnsureConfigCard();
  chronosEnsureCommandsCard();

  chronosTick('context', text, cfg);

  if (!cfg.enabled || !cfg.showContext || s.isCommand) return text;
  var cleaned = String(text || '').replace(/\[Chronos:[^\]]+\]\n?/g, '');
  var line = chronosContextLine(cfg);
  if (!line) return cleaned;

  if (typeof info !== 'undefined' && info && info.memoryLength && info.maxChars) {
    var memory = cleaned.slice(0, info.memoryLength);
    var body = cleaned.slice(info.memoryLength);
    body = (line + '\n' + body).slice(-(info.maxChars - info.memoryLength));
    return memory + body;
  }

  return line + '\n' + cleaned;
}

function chronosV2Output(text) {
  var s = chronosState();
  if (!s) return text;
  var cfg = chronosEnsureConfigCard();

  chronosTick('output', text, cfg);

  if (s.isCommand && s.pendingOutput) {
    var output = s.pendingOutput;
    s.pendingOutput = '';
    s.isCommand = false;
    s.commandLiveKey = '';
    chronosPublishScripture(cfg);
    chronosWriteTrace(cfg);
    return output;
  }

  return text;
}

function chronosTick(hook, text, cfg) {
  var s = chronosState();
  s.turn += hook === 'context' ? 1 : 0;
  s.phase = hook || 'tick';

  try {
    chronosPollResponses(cfg);
    chronosReapStalePending(cfg);
    chronosProcessWidgetEvents(cfg);
    chronosMaybeInitializeClock(cfg);
    chronosMaybeAdvanceTime(hook, cfg);
    chronosMaybeRefreshWeather(cfg);
    chronosPublishScripture(cfg);
    chronosWriteOut();
    chronosWriteTrace(cfg);
    chronosPruneRuntimeState(cfg);
  } catch (err) {
    s.status = 'Chronos script error';
    chronosLog('error', err && err.message ? err.message : String(err));
  }
}

function chronosState() {
  if (typeof state === 'undefined' || !state || typeof state !== 'object') return null;
  var s = state.chronosV2;
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
  state.chronosV2 = s;

  s.v = 2;
  s.runId = s.runId || ('chronos-v2-' + chronosNow().toString(36));
  s.turn = chronosNumber(s.turn, 0);
  s.seq = chronosNumber(s.seq, 0);
  s.outSeq = chronosNumber(s.outSeq, 0);
  s.timeRevision = chronosNumber(s.timeRevision, 0);
  s.widgetAckSeq = chronosNumber(s.widgetAckSeq, 0);
  s.lastAdvancedLiveKey = s.lastAdvancedLiveKey || '';
  s.commandLiveKey = s.commandLiveKey || '';
  s.pendingOutput = s.pendingOutput || '';
  s.isCommand = !!s.isCommand;
  s.paused = !!s.paused;
  s.clockStartAttempted = !!s.clockStartAttempted;
  s.clockStarted = !!s.clockStarted;
  s.status = s.status || 'Ready';
  s.pending = chronosPlainObject(s.pending);
  s.requestMeta = chronosPlainObject(s.requestMeta);
  s.completed = chronosPlainObject(s.completed);
  s.acked = chronosPlainObject(s.acked);
  s.ackAttempts = chronosPlainObject(s.ackAttempts);
  s._acks = Array.isArray(s._acks) ? s._acks : [];
  s.events = Array.isArray(s.events) ? s.events : [];
  s.history = chronosPlainObject(s.history);
  s.lastConfig = chronosPlainObjectOrNull(s.lastConfig);
  s.clock = chronosPlainObject(s.clock);
  s.realAnchor = chronosPlainObjectOrNull(s.realAnchor);

  if (!s.time || typeof s.time !== 'object' || Array.isArray(s.time)) {
    s.time = { year: 2026, month: 6, day: 1, hour: 7, minute: 0 };
  }
  s.time.year = chronosClampInt(s.time.year, 1, 9999, 2026);
  s.time.month = chronosClampInt(s.time.month, 1, 12, 6);
  s.time.day = chronosClampInt(s.time.day, 1, chronosDaysInMonth(s.time.year, s.time.month), 1);
  s.time.hour = chronosClampInt(s.time.hour, 0, 23, 7);
  s.time.minute = chronosClampInt(s.time.minute, 0, 59, 0);

  if (!s.weather || typeof s.weather !== 'object' || Array.isArray(s.weather)) {
    s.weather = {};
  }
  s.weather.condition = CHRONOS_WEATHER[s.weather.condition] ? s.weather.condition : 'clear';
  s.weather.label = s.weather.label || CHRONOS_WEATHER[s.weather.condition].label;
  s.weather.temperatureF = chronosNumber(s.weather.temperatureF, 70);
  s.weather.targetF = chronosNumber(s.weather.targetF, s.weather.temperatureF);
  s.weather.lastChangeTurn = chronosNumber(s.weather.lastChangeTurn, 0);
  s.weather.lastRealTurn = chronosNumber(s.weather.lastRealTurn, -9999);
  s.weather.source = s.weather.source || 'simulated';
  s.weather.locationLabel = s.weather.locationLabel || '';
  s.weather.observedAt = s.weather.observedAt || '';

  return s;
}

function chronosPlainObject(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
}

function chronosPlainObjectOrNull(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value : null;
}

function chronosNumber(value, fallback) {
  var n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function chronosClampInt(value, min, max, fallback) {
  var n = Math.round(Number(value));
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(min, Math.min(max, n));
}

function chronosClampNumber(value, min, max, fallback) {
  var n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(min, Math.min(max, n));
}

function chronosBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    var normalized = value.toLowerCase().trim();
    if (normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

function chronosNow() {
  return Date.now ? Date.now() : new Date().getTime();
}

function chronosIso() {
  try {
    return new Date(chronosNow()).toISOString();
  } catch (err) {
    return String(chronosNow());
  }
}

function chronosClean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function chronosLimit(text, limit) {
  text = String(text || '');
  limit = Math.max(0, Number(limit || 0));
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return text.slice(0, limit - 3).replace(/\s+\S*$/, '') + '...';
}

function chronosCards() {
  return (typeof storyCards !== 'undefined' && Array.isArray(storyCards)) ? storyCards : [];
}

function chronosFindCard(title) {
  var cards = chronosCards();
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (!card) continue;
    if (card.title === title || card.keys === title || card.key === title) {
      return { card: card, index: i };
    }
  }
  return { card: null, index: -1 };
}

function chronosCardText(card) {
  if (!card) return '';
  return card.value || card.entry || card.description || '';
}

function chronosReadJsonCard(title) {
  var found = chronosFindCard(title);
  if (!found.card) return null;
  try {
    return JSON.parse(chronosCardText(found.card) || '{}');
  } catch (err) {
    return null;
  }
}

function chronosWriteCard(title, entry, type, keys, description) {
  var found = chronosFindCard(title);
  var card = found.card;
  if (!card && typeof addStoryCard === 'function') {
    addStoryCard(title, entry || '', type || CHRONOS_CARD_TYPE);
    found = chronosFindCard(title);
    card = found.card;
  }
  if (!card && chronosCards()) {
    card = {
      title: title,
      keys: keys || title,
      key: keys || title,
      entry: entry || '',
      value: entry || '',
      type: type || CHRONOS_CARD_TYPE,
      description: description || ''
    };
    chronosCards().push(card);
  }
  if (!card) return null;

  card.title = title;
  card.keys = keys || title;
  card.key = keys || title;
  card.entry = entry || '';
  card.value = entry || '';
  card.type = type || card.type || CHRONOS_CARD_TYPE;
  if (description !== undefined) card.description = description || '';
  return card;
}

function chronosDeleteCard(title) {
  var found = chronosFindCard(title);
  if (!found.card || found.index < 0) return false;
  if (typeof removeStoryCard === 'function') {
    removeStoryCard(found.index);
    return true;
  }
  chronosCards().splice(found.index, 1);
  return true;
}

function chronosEnsureConfigCard() {
  var s = chronosState();
  var found = chronosFindCard(CHRONOS_CONFIG_CARD_TITLE);
  var cfg = null;

  if (found.card) {
    try {
      cfg = chronosNormalizeConfig(JSON.parse(chronosCardText(found.card) || '{}'));
      s.lastConfig = chronosClone(cfg);
      s.configError = '';
    } catch (err) {
      cfg = s.lastConfig ? chronosNormalizeConfig(s.lastConfig) : chronosNormalizeConfig({});
      s.configError = 'Config JSON is malformed; keeping last valid settings.';
    }
  } else {
    cfg = chronosNormalizeConfig({});
    s.lastConfig = chronosClone(cfg);
    chronosWriteConfigCard(cfg);
  }

  return cfg;
}

function chronosWriteConfigCard(cfg) {
  cfg = chronosNormalizeConfig(cfg || {});
  chronosState().lastConfig = chronosClone(cfg);
  chronosWriteCard(
    CHRONOS_CONFIG_CARD_TITLE,
    JSON.stringify(cfg, null, 2),
    CHRONOS_CARD_TYPE,
    CHRONOS_CONFIG_CARD_TITLE,
    [
      'Editable JSON settings for Chronos V2.',
      'Widgets can update these settings for you.',
      'Real weather uses the manual place string; keep weatherMode simulated for faster fantasy pacing.'
    ].join('\n')
  );
}

function chronosNormalizeConfig(raw) {
  raw = chronosPlainObject(raw);
  var cfg = chronosClone(CHRONOS_DEFAULT_CONFIG);
  cfg.enabled = chronosBool(raw.enabled, cfg.enabled);
  cfg.minutesPerTurn = chronosClampInt(raw.minutesPerTurn, 0, 240, cfg.minutesPerTurn);
  cfg.timeMode = raw.timeMode === 'realElapsed' ? 'realElapsed' : 'simulated';
  cfg.useClockStart = chronosBool(raw.useClockStart, cfg.useClockStart);
  cfg.weatherMode = raw.weatherMode === 'real' ? 'real' : 'simulated';
  cfg.place = chronosLimit(chronosClean(raw.place), 100);
  cfg.temperatureUnit = String(raw.temperatureUnit || cfg.temperatureUnit).toUpperCase() === 'C' ? 'C' : 'F';
  cfg.showContext = chronosBool(raw.showContext, cfg.showContext);
  cfg.widgetHistoryLimit = chronosClampInt(raw.widgetHistoryLimit, 5, 200, cfg.widgetHistoryLimit);
  cfg.wakeHour = chronosClampInt(raw.wakeHour, 0, 23, cfg.wakeHour);
  cfg.weatherRefreshTurns = chronosClampInt(raw.weatherRefreshTurns, 2, 500, cfg.weatherRefreshTurns);
  cfg.weatherChangeCooldown = chronosClampInt(raw.weatherChangeCooldown, 1, 500, cfg.weatherChangeCooldown);
  cfg.maxPendingTurns = chronosClampInt(raw.maxPendingTurns, 3, 80, cfg.maxPendingTurns);
  cfg.timeZone = chronosLimit(chronosClean(raw.timeZone), 80);
  cfg.showTrace = chronosBool(raw.showTrace, cfg.showTrace);
  return cfg;
}

function chronosEnsureCommandsCard() {
  if (!chronosFindCard(CHRONOS_COMMANDS_CARD_TITLE).card) {
    chronosWriteCard(
      CHRONOS_COMMANDS_CARD_TITLE,
      CHRONOS_COMMANDS_ENTRY,
      CHRONOS_CARD_TYPE,
      CHRONOS_COMMANDS_CARD_TITLE,
      'Fallback chat commands for Chronos V2.'
    );
  }
}

function chronosClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return {};
  }
}

function chronosLiveKey() {
  if (typeof history !== 'undefined' && Array.isArray(history)) {
    return String(history.length + 1);
  }
  if (typeof info !== 'undefined' && info && info.actionCount !== undefined) {
    return String(Number(info.actionCount || 0) + 1);
  }
  return '1';
}

function chronosLog(event, detail) {
  var s = chronosState();
  s.events.push({
    at: chronosIso(),
    liveKey: chronosLiveKey(),
    event: chronosLimit(event, 40),
    detail: chronosLimit(detail, 240)
  });
  while (s.events.length > 60) s.events.shift();
}

function chronosIsLeapYear(year) {
  year = Number(year);
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function chronosDaysInMonth(year, month) {
  if (month === 2 && chronosIsLeapYear(year)) return 29;
  return CHRONOS_MONTHS[Math.max(0, Math.min(11, month - 1))].days;
}

function chronosGetMonthName(month) {
  return CHRONOS_MONTHS[Math.max(0, Math.min(11, Number(month || 1) - 1))].name;
}

function chronosGetWeekday() {
  var t = chronosState().time;
  try {
    return CHRONOS_WEEKDAYS[new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
  } catch (err) {
    return CHRONOS_WEEKDAYS[0];
  }
}

function chronosGetSeason() {
  var month = chronosState().time.month;
  if (month >= 3 && month <= 5) return 'Spring';
  if (month >= 6 && month <= 8) return 'Summer';
  if (month >= 9 && month <= 11) return 'Autumn';
  return 'Winter';
}

function chronosGetPhase() {
  var hour = chronosState().time.hour;
  for (var i = 0; i < CHRONOS_PHASES.length; i++) {
    var phase = CHRONOS_PHASES[i];
    if (hour >= phase.start && hour < phase.end) return phase;
  }
  return CHRONOS_PHASES[0];
}

function chronosTimeString(use12Hour) {
  var t = chronosState().time;
  var minute = String(t.minute).padStart(2, '0');
  if (!use12Hour) return String(t.hour).padStart(2, '0') + ':' + minute;
  var suffix = t.hour >= 12 ? 'PM' : 'AM';
  var hour = t.hour % 12 || 12;
  return hour + ':' + minute + ' ' + suffix;
}

function chronosReadableTime() {
  return chronosTimeString(true).replace(' AM', 'am').replace(' PM', 'pm');
}

function chronosDateString() {
  var t = chronosState().time;
  return chronosGetWeekday() + ', ' + chronosGetMonthName(t.month) + ' ' + t.day + ', ' + t.year;
}

function chronosSnapshot() {
  var t = chronosState().time;
  return { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute };
}

function chronosRestoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  chronosSetDate(snapshot.day, snapshot.month, snapshot.year);
  chronosSetTime(snapshot.hour, snapshot.minute);
}

function chronosAdvanceTime(minutes) {
  var s = chronosState();
  var t = s.time;
  var total = (t.hour * 60) + t.minute + Math.round(Number(minutes || 0));
  while (total < 0) {
    total += 1440;
    t.day -= 1;
    if (t.day < 1) {
      t.month -= 1;
      if (t.month < 1) {
        t.month = 12;
        t.year = Math.max(1, t.year - 1);
      }
      t.day = chronosDaysInMonth(t.year, t.month);
    }
  }
  while (total >= 1440) {
    total -= 1440;
    t.day += 1;
    var days = chronosDaysInMonth(t.year, t.month);
    if (t.day > days) {
      t.day = 1;
      t.month += 1;
      if (t.month > 12) {
        t.month = 1;
        t.year += 1;
      }
    }
  }
  t.hour = Math.floor(total / 60);
  t.minute = total % 60;
  s.timeRevision += 1;
  chronosResetRealAnchor();
}

function chronosSetTime(hour, minute) {
  var s = chronosState();
  s.time.hour = chronosClampInt(hour, 0, 23, s.time.hour);
  s.time.minute = chronosClampInt(minute, 0, 59, s.time.minute);
  s.timeRevision += 1;
  chronosResetRealAnchor();
}

function chronosSetDate(day, month, year) {
  var s = chronosState();
  var y = chronosClampInt(year, 1, 9999, s.time.year);
  var m = chronosClampInt(month, 1, 12, s.time.month);
  var d = chronosClampInt(day, 1, chronosDaysInMonth(y, m), s.time.day);
  s.time.year = y;
  s.time.month = m;
  s.time.day = d;
  s.timeRevision += 1;
  chronosResetRealAnchor();
}

function chronosMinutesUntilWake(wakeHour) {
  var t = chronosState().time;
  var target = chronosClampInt(wakeHour, 0, 23, 7) * 60;
  var now = (t.hour * 60) + t.minute;
  var delta = target - now;
  if (delta <= 0) delta += 1440;
  return delta;
}

function chronosMaybeAdvanceTime(hook, cfg) {
  var s = chronosState();
  if (!cfg.enabled || hook !== 'context') return;

  var liveKey = chronosLiveKey();
  if (s.history[liveKey] && Number(liveKey) < Number(s.lastAdvancedLiveKey || 0)) {
    chronosRestoreSnapshot(s.history[liveKey]);
    return;
  }

  if (s.lastAdvancedLiveKey === liveKey || s.isCommand || s.paused) {
    if (!s.history[liveKey]) s.history[liveKey] = chronosSnapshot();
    return;
  }

  if (cfg.timeMode === 'realElapsed') {
    chronosApplyRealElapsed();
  } else {
    chronosAdvanceTime(cfg.minutesPerTurn);
    chronosSimulateWeather(cfg);
  }

  s.lastAdvancedLiveKey = liveKey;
  s.history[liveKey] = chronosSnapshot();
}

function chronosResetRealAnchor() {
  var s = chronosState();
  s.realAnchor = { ts: chronosNow(), time: chronosSnapshot() };
}

function chronosApplyRealElapsed() {
  var s = chronosState();
  if (!s.realAnchor || !s.realAnchor.time) chronosResetRealAnchor();
  var elapsed = Math.max(0, Math.floor((chronosNow() - Number(s.realAnchor.ts || chronosNow())) / 60000));
  chronosRestoreSnapshot(s.realAnchor.time);
  if (elapsed > 0) {
    var oldRevision = s.timeRevision;
    chronosAdvanceTime(elapsed);
    s.timeRevision = oldRevision;
  }
}

function chronosBaseTargetF() {
  var season = chronosGetSeason();
  var base = season === 'Winter' ? 35 : season === 'Spring' ? 60 : season === 'Summer' ? 82 : 55;
  var hour = chronosState().time.hour;
  var daily = hour < 5 ? -8 : hour < 9 ? -3 : hour < 16 ? 6 : hour < 21 ? 1 : -5;
  var condition = chronosState().weather.condition;
  var weather = condition.indexOf('snow') !== -1 ? -10 :
    condition.indexOf('rain') !== -1 ? -5 :
    condition === 'clear' ? 4 :
    condition === 'cloudy' || condition === 'overcast' ? -2 : 0;
  return base + daily + weather;
}

function chronosSimulateWeather(cfg) {
  var s = chronosState();
  if (cfg.weatherMode !== 'simulated') return;
  s.weather.source = 'simulated';
  if (!s.weather.targetF || Math.abs(s.weather.temperatureF - s.weather.targetF) < 1) {
    s.weather.targetF = chronosBaseTargetF() + Math.round((Math.random() * 10) - 5);
  }

  s.weather.temperatureF += (s.weather.targetF - s.weather.temperatureF) * 0.25;
  s.weather.temperatureF = Math.round(s.weather.temperatureF);

  if (s.turn - s.weather.lastChangeTurn >= cfg.weatherChangeCooldown) {
    chronosRollWeather();
    s.weather.lastChangeTurn = s.turn;
    s.weather.targetF = chronosBaseTargetF() + Math.round((Math.random() * 10) - 5);
  }
}

function chronosRollWeather() {
  var s = chronosState();
  var season = chronosGetSeason();
  var table = CHRONOS_TRANSITIONS[season] || CHRONOS_TRANSITIONS.Spring;
  var options = table[s.weather.condition] || table.clear;
  var total = 0;
  for (var i = 0; i < options.length; i++) total += options[i][1];
  var roll = Math.random() * total;
  for (var j = 0; j < options.length; j++) {
    roll -= options[j][1];
    if (roll <= 0) {
      s.weather.condition = options[j][0];
      s.weather.label = CHRONOS_WEATHER[s.weather.condition].label;
      return;
    }
  }
}

function chronosTemperatureString(cfg) {
  var f = Math.round(chronosState().weather.temperatureF);
  if (cfg.temperatureUnit === 'C') return Math.round((f - 32) * 5 / 9) + ' C';
  return f + ' F';
}

function chronosWeatherLine(cfg) {
  var s = chronosState();
  var source = s.weather.source === 'real' ? 'real' : 'sim';
  return s.weather.label + ', ' + chronosTemperatureString(cfg) + ' (' + source + ')';
}

function chronosContextLine(cfg) {
  var s = chronosState();
  if (!cfg.enabled) return '';
  return '[Chronos V2: Current story date is ' + chronosDateString() + '. Current story time is ' +
    chronosTimeString(true) + ' (' + chronosGetPhase().name + '). Season: ' + chronosGetSeason() +
    '. Weather: ' + chronosWeatherLine(cfg) + '. Use these as the current scene environment unless the story says otherwise.]';
}

function chronosHandleCommand(input, cfg) {
  var parts = input.slice(1).split(/\s+/);
  var cmd = String(parts.shift() || '').toLowerCase();
  var args = parts;
  if (cmd === 'timeskip' || cmd === 'skip') cmd = 'advance';

  if (cmd === 'time') return '\n' + chronosStatusLine(cfg);
  if (cmd === 'date') return '\nDate: ' + chronosDateString() + ' (' + chronosGetSeason() + ')';
  if (cmd === 'weather') return '\nWeather: ' + chronosWeatherLine(cfg);
  if (cmd === 'pause') {
    chronosState().paused = true;
    return '\nChronos V2 paused.';
  }
  if (cmd === 'resume') {
    chronosState().paused = false;
    chronosResetRealAnchor();
    return '\nChronos V2 resumed.';
  }
  if (cmd === 'sleep') {
    var sleepMinutes = chronosMinutesUntilWake(cfg.wakeHour);
    chronosAdvanceTime(sleepMinutes);
    chronosSimulateWeather(cfg);
    return '\nYou sleep until ' + chronosTimeString(true) + ' on ' + chronosDateString() + '.';
  }
  if (cmd === 'advance') return chronosCommandAdvance(args, cfg);
  if (cmd === 'settime') return chronosCommandSetTime(args);
  if (cmd === 'setdate') return chronosCommandSetDate(args);
  if (cmd === 'setweather') return chronosCommandSetWeather(args, cfg);
  if (cmd === 'chronos') return chronosCommandSystem(args, cfg);
  return null;
}

function chronosCommandAdvance(args, cfg) {
  var amount = Number(args[0]);
  var unit = String(args[1] || 'minutes').toLowerCase();
  if (!Number.isFinite(amount)) return '\nUsage: :advance <N> <minutes|hours|days>';
  var minutes = amount;
  if (unit.indexOf('hour') === 0 || unit === 'h') minutes = amount * 60;
  if (unit.indexOf('day') === 0 || unit === 'd') minutes = amount * 1440;
  chronosAdvanceTime(minutes);
  chronosSimulateWeather(cfg);
  return '\nAdvanced ' + amount + ' ' + unit + '. Current time: ' + chronosStatusLine(cfg);
}

function chronosCommandSetTime(args) {
  var raw = String(args[0] || '');
  var match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '\nUsage: :settime <HH:MM>';
  chronosSetTime(Number(match[1]), Number(match[2]));
  return '\nTime set to ' + chronosTimeString(true) + '.';
}

function chronosCommandSetDate(args) {
  if (args.length < 3) return '\nUsage: :setdate <day> <month> <year>';
  chronosSetDate(Number(args[0]), Number(args[1]), Number(args[2]));
  return '\nDate set to ' + chronosDateString() + '.';
}

function chronosCommandSetWeather(args, cfg) {
  var key = chronosWeatherKey(args.join(' '));
  if (!CHRONOS_WEATHER[key]) {
    return '\nUnknown weather. Try clear, partly_cloudy, cloudy, overcast, rain, thunderstorm, fog, windy, or snow.';
  }
  var s = chronosState();
  s.weather.condition = key;
  s.weather.label = CHRONOS_WEATHER[key].label;
  s.weather.source = 'simulated';
  s.weather.targetF = chronosBaseTargetF();
  cfg.weatherMode = 'simulated';
  chronosWriteConfigCard(cfg);
  return '\nWeather set to ' + chronosWeatherLine(cfg) + '.';
}

function chronosCommandSystem(args, cfg) {
  var sub = String(args[0] || '').toLowerCase();
  if (sub === 'help') return '\n' + CHRONOS_COMMANDS_ENTRY;
  if (sub === 'reset') {
    state.chronosV2 = null;
    chronosDeleteCard(CHRONOS_TRACE_CARD_TITLE);
    chronosWriteConfigCard(CHRONOS_DEFAULT_CONFIG);
    return '\nChronos V2 reset to defaults.';
  }
  return '\n' + chronosStatusLine(cfg) + '\nMode: ' + cfg.timeMode + ', weather: ' +
    cfg.weatherMode + ', paused: ' + (chronosState().paused ? 'yes' : 'no') + '.';
}

function chronosWeatherKey(text) {
  var raw = chronosClean(text).toLowerCase().replace(/[\s-]+/g, '_');
  var aliases = {
    clear_skies: 'clear',
    drizzle: 'light_rain',
    light_rain: 'light_rain',
    raining: 'rain',
    storm: 'thunderstorm',
    storms: 'thunderstorm',
    snowy: 'snow',
    blizzard: 'heavy_snow'
  };
  return aliases[raw] || raw;
}

function chronosStatusLine(cfg) {
  return chronosDateString() + ', ' + chronosTimeString(true) + ' - ' +
    chronosGetPhase().name + '. Weather: ' + chronosWeatherLine(cfg) + '.';
}

function chronosHeartbeat() {
  return chronosReadJsonCard('frontier:heartbeat');
}

function chronosHasStateModule(moduleId) {
  var hb = chronosHeartbeat();
  if (!hb || !hb.frontier || hb.frontier.protocol !== 1) return false;
  var modules = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < modules.length; i++) {
    var m = modules[i];
    if (m && m.id === moduleId) return true;
  }
  return false;
}

function chronosHasOp(moduleId, op) {
  var hb = chronosHeartbeat();
  if (!hb || !hb.frontier || hb.frontier.protocol !== 1 || hb.frontier.profile !== 'full') return false;
  var modules = Array.isArray(hb.modules) ? hb.modules : [];
  for (var i = 0; i < modules.length; i++) {
    var m = modules[i];
    if (m && m.id === moduleId && Array.isArray(m.ops) && m.ops.indexOf(op) !== -1) return true;
  }
  return false;
}

function chronosPendingArray() {
  var s = chronosState();
  var out = [];
  for (var id in s.pending) {
    if (Object.prototype.hasOwnProperty.call(s.pending, id)) out.push(s.pending[id]);
  }
  return out;
}

function chronosWriteOut() {
  var s = chronosState();
  var pending = chronosPendingArray();
  if (!pending.length && !s._acks.length) return;
  var payload = {
    v: 1,
    requests: pending,
    acks: s._acks || [],
    debugSeq: ++s.outSeq,
    debugWrittenAt: chronosNow()
  };
  s._acks = [];
  chronosWriteCard('frontier:out', JSON.stringify(payload), 'Frontier', 'frontier:out', '');
}

function chronosQueueAck(requestId, reason) {
  var s = chronosState();
  var attempts = Number(s.ackAttempts[requestId] || 0);
  if (attempts >= 6) return false;
  s.acked[requestId] = true;
  s.ackAttempts[requestId] = attempts + 1;
  s._acks.push(requestId);
  chronosLog(attempts === 0 ? 'ack' : 'ack-retry', requestId + (reason ? ' ' + reason : ''));
  return true;
}

function chronosHasPendingKind(kind, key) {
  var s = chronosState();
  for (var id in s.pending) {
    if (!Object.prototype.hasOwnProperty.call(s.pending, id)) continue;
    var meta = s.requestMeta[id] || {};
    if (meta.kind === kind && (key === undefined || meta.key === key)) return true;
  }
  return false;
}

function chronosQueueRequest(moduleId, op, args, meta) {
  var s = chronosState();
  meta = meta || {};
  if (meta.kind && chronosHasPendingKind(meta.kind, meta.key)) return '';
  if (!chronosHasOp(moduleId, op)) return '';
  var id = chronosLiveKey() + '-' + moduleId + '-' + (++s.seq);
  s.pending[id] = {
    id: id,
    module: moduleId,
    op: op,
    args: args || {},
    ts: chronosNow()
  };
  s.requestMeta[id] = meta;
  s.requestMeta[id].module = moduleId;
  s.requestMeta[id].op = op;
  s.requestMeta[id].queuedTurn = s.turn;
  s.requestMeta[id].timeRevision = s.timeRevision;
  s.status = 'Queued ' + moduleId + '.' + op;
  chronosLog('queued', id + ' ' + moduleId + '.' + op);
  return id;
}

function chronosIsTerminal(response) {
  return response && (response.status === 'ok' || response.status === 'err' || response.status === 'timeout');
}

function chronosPollResponses(cfg) {
  chronosPollModule('clock', cfg);
  chronosPollModule('weather', cfg);
}

function chronosPollModule(moduleId, cfg) {
  var s = chronosState();
  var card = chronosReadJsonCard('frontier:in:' + moduleId);
  if (!card || !card.responses) return;
  var wroteAck = false;
  for (var requestId in card.responses) {
    if (!Object.prototype.hasOwnProperty.call(card.responses, requestId)) continue;
    if (!s.pending[requestId] && !s.requestMeta[requestId] && !s.completed[requestId]) continue;
    var response = card.responses[requestId];
    if (!chronosIsTerminal(response)) continue;

    if (!s.completed[requestId]) {
      s.completed[requestId] = {
        status: response.status,
        error: response.error || null,
        seenAt: chronosIso()
      };
      chronosProcessResponse(requestId, response, cfg);
    }

    delete s.pending[requestId];
    delete s.requestMeta[requestId];
    if (!s.acked[requestId] || Number(s.ackAttempts[requestId] || 0) < 6) {
      wroteAck = chronosQueueAck(requestId, 'terminal') || wroteAck;
    }
  }
  if (wroteAck) chronosWriteOut();
}

function chronosProcessResponse(requestId, response, cfg) {
  var s = chronosState();
  var meta = s.requestMeta[requestId] || {};
  if (response.status !== 'ok') {
    var err = response.error || {};
    s.status = meta.kind + ' failed: ' + (err.code || response.status);
    chronosLog('response-error', s.status);
    return;
  }

  if (meta.kind === 'clockStart' || meta.kind === 'clockSync') chronosApplyClockResponse(response.data, meta);
  if (meta.kind === 'weatherCurrent') chronosApplyWeatherResponse(response.data, cfg);
}

function chronosReapStalePending(cfg) {
  var s = chronosState();
  var changed = false;
  for (var id in s.pending) {
    if (!Object.prototype.hasOwnProperty.call(s.pending, id)) continue;
    var meta = s.requestMeta[id] || {};
    if (s.turn - Number(meta.queuedTurn || s.turn) <= cfg.maxPendingTurns) continue;
    s.completed[id] = {
      status: 'local-timeout',
      error: { code: 'local_timeout', message: 'Chronos stopped waiting for this request.' },
      seenAt: chronosIso()
    };
    delete s.pending[id];
    delete s.requestMeta[id];
    changed = true;
    chronosLog('local-timeout', id);
  }
  if (changed) s.status = 'Timed out waiting for Frontier response';
}

function chronosMaybeInitializeClock(cfg) {
  var s = chronosState();
  if (!cfg.enabled || !cfg.useClockStart || s.clockStartAttempted || s.clockStarted) return;
  if (!chronosHasOp('clock', 'now')) return;
  s.clockStartAttempted = true;
  var args = {};
  if (cfg.timeZone) args.timeZone = cfg.timeZone;
  chronosQueueRequest('clock', 'now', args, { kind: 'clockStart', key: 'start' });
}

function chronosApplyClockResponse(data, meta) {
  var s = chronosState();
  if (!data || !data.date || !data.time) return;
  if (meta.kind === 'clockStart' && s.clockStarted) return;

  var dateParts = String(data.date).split('-');
  var timeParts = String(data.time).split(':');
  if (dateParts.length >= 3 && timeParts.length >= 2) {
    chronosSetDate(Number(dateParts[2]), Number(dateParts[1]), Number(dateParts[0]));
    chronosSetTime(Number(timeParts[0]), Number(timeParts[1]));
    s.clockStarted = true;
    s.clock = {
      timeZone: data.timeZone || '',
      systemTimeZone: data.systemTimeZone || '',
      lastSyncIso: data.iso || chronosIso()
    };
    chronosResetRealAnchor();
    s.status = meta.kind === 'clockStart' ? 'Clock initialized story time' : 'Clock synced story time';
    chronosLog('clock', s.status);
  }
}

function chronosMaybeRefreshWeather(cfg) {
  var s = chronosState();
  if (!cfg.enabled || cfg.weatherMode !== 'real') return;
  if (!chronosHasOp('weather', 'current')) return;
  if (chronosHasPendingKind('weatherCurrent', 'current')) return;
  if (s.turn - s.weather.lastRealTurn < cfg.weatherRefreshTurns) return;
  chronosQueueWeatherCurrent(cfg);
}

function chronosQueueWeatherCurrent(cfg) {
  var args = { units: cfg.temperatureUnit === 'F' ? 'imperial' : 'metric', timeoutMs: 15000 };
  var s = chronosState();
  if (cfg.place) {
    args.place = cfg.place;
  } else {
    s.status = 'Real weather needs a place';
    return '';
  }
  return chronosQueueRequest('weather', 'current', args, { kind: 'weatherCurrent', key: 'current' });
}

function chronosApplyWeatherResponse(data, cfg) {
  var s = chronosState();
  if (!data || !data.current) return;
  var current = data.current;
  s.weather.source = 'real';
  s.weather.condition = chronosConditionFromWeather(current.weather, current.weatherCode);
  s.weather.label = current.weather || CHRONOS_WEATHER[s.weather.condition].label;
  var temp = Number(current.temperature);
  if (Number.isFinite(temp)) {
    s.weather.temperatureF = cfg.temperatureUnit === 'C' ? ((temp * 9 / 5) + 32) : temp;
    s.weather.targetF = s.weather.temperatureF;
  }
  s.weather.observedAt = current.observedAt || '';
  s.weather.lastRealTurn = s.turn;
  s.weather.locationLabel = chronosLocationLabel(data.location);
  s.status = 'Real weather synced' + (s.weather.locationLabel ? ': ' + s.weather.locationLabel : '');
  chronosLog('weather', s.status);
}

function chronosConditionFromWeather(label, code) {
  var text = chronosClean(label).toLowerCase();
  if (text.indexOf('thunder') !== -1) return 'thunderstorm';
  if (text.indexOf('snow') !== -1) return text.indexOf('heavy') !== -1 ? 'heavy_snow' : 'snow';
  if (text.indexOf('rain') !== -1 || text.indexOf('drizzle') !== -1) return text.indexOf('heavy') !== -1 ? 'heavy_rain' : 'rain';
  if (text.indexOf('fog') !== -1 || text.indexOf('mist') !== -1) return 'fog';
  if (text.indexOf('overcast') !== -1) return 'overcast';
  if (text.indexOf('cloud') !== -1) return text.indexOf('part') !== -1 ? 'partly_cloudy' : 'cloudy';
  if (Number(code) >= 95) return 'thunderstorm';
  return 'clear';
}

function chronosLocationLabel(location) {
  if (!location) return '';
  var parts = [];
  if (location.name) parts.push(location.name);
  if (location.admin1) parts.push(location.admin1);
  if (location.country) parts.push(location.country);
  return parts.join(', ');
}

function chronosProcessWidgetEvents(cfg) {
  var s = chronosState();
  var card = chronosReadJsonCard('frontier:in:scripture');
  var widgetEvents = card && card.widgetEvents && Array.isArray(card.widgetEvents.events)
    ? card.widgetEvents.events
    : [];
  if (!widgetEvents.length) return;

  widgetEvents.sort(function (a, b) { return Number(a.seq || 0) - Number(b.seq || 0); });

  var changedConfig = false;
  var highest = s.widgetAckSeq;
  for (var i = 0; i < widgetEvents.length; i++) {
    var event = widgetEvents[i];
    var seq = Number(event.seq || 0);
    if (!Number.isFinite(seq) || seq <= s.widgetAckSeq) continue;
    if (!event.widgetId || String(event.widgetId).indexOf('chronos-') !== 0) continue;

    var changed = chronosHandleWidgetEvent(event, cfg);
    if (changed === null) continue;
    changedConfig = changedConfig || changed;
    highest = Math.max(highest, seq);
  }

  if (highest > s.widgetAckSeq) s.widgetAckSeq = highest;
  if (changedConfig) chronosWriteConfigCard(cfg);
}

function chronosHandleWidgetEvent(event, cfg) {
  var s = chronosState();
  var id = String(event.widgetId || '');
  var value = event.value;

  if (id === 'chronos-paused') {
    s.paused = !!value;
    s.status = s.paused ? 'Paused from widget' : 'Resumed from widget';
    chronosResetRealAnchor();
    return false;
  }
  if (id === 'chronos-advance-15') {
    chronosAdvanceTime(15);
    s.status = 'Advanced 15 minutes';
    return false;
  }
  if (id === 'chronos-advance-60') {
    chronosAdvanceTime(60);
    s.status = 'Advanced 1 hour';
    return false;
  }
  if (id === 'chronos-sleep') {
    chronosAdvanceTime(chronosMinutesUntilWake(cfg.wakeHour));
    chronosSimulateWeather(cfg);
    s.status = 'Slept until wake hour';
    return false;
  }
  if (id === 'chronos-real-time') {
    cfg.timeMode = value ? 'realElapsed' : 'simulated';
    chronosResetRealAnchor();
    s.status = cfg.timeMode === 'realElapsed' ? 'Real elapsed time enabled' : 'Simulated time enabled';
    return true;
  }
  if (id === 'chronos-weather-mode') {
    cfg.weatherMode = value === 'real' ? 'real' : 'simulated';
    s.status = cfg.weatherMode === 'real' ? 'Real weather enabled' : 'Simulated weather enabled';
    if (cfg.weatherMode === 'real') chronosQueueWeatherCurrent(cfg);
    return true;
  }
  if (id === 'chronos-place') {
    cfg.place = chronosLimit(chronosClean(value), 100);
    s.status = cfg.place ? 'Weather place set: ' + cfg.place : 'Weather place cleared';
    return true;
  }
  if (id === 'chronos-sync-clock') {
    var args = {};
    if (cfg.timeZone) args.timeZone = cfg.timeZone;
    chronosQueueRequest('clock', 'now', args, { kind: 'clockSync', key: 'sync' });
    return false;
  }
  if (id === 'chronos-sync') {
    var syncArgs = {};
    if (cfg.timeZone) syncArgs.timeZone = cfg.timeZone;
    var queued = false;
    queued = !!chronosQueueRequest('clock', 'now', syncArgs, { kind: 'clockSync', key: 'sync' }) || queued;
    if (cfg.weatherMode === 'real' || cfg.place) {
      queued = !!chronosQueueWeatherCurrent(cfg) || queued;
    }
    s.status = queued ? 'Sync queued' : 'Nothing available to sync';
    return false;
  }
  if (id === 'chronos-sync-weather') {
    cfg.weatherMode = 'real';
    chronosQueueWeatherCurrent(cfg);
    return true;
  }
  return null;
}

function chronosScriptureManifest() {
  return {
    widgets: [
      { id: 'chronos-clock', type: 'stat', label: 'Time', align: 'left', order: 1 },
      { id: 'chronos-phase', type: 'badge', label: 'Phase', align: 'center', order: 3 },
      { id: 'chronos-weather', type: 'stat', label: 'Sky', align: 'right', order: 4 },
      { id: 'chronos-paused', type: 'toggle', label: 'Pause', tooltip: 'Pause or resume automatic time progression.', risk: 'enhanced', order: 8 },
      { id: 'chronos-real-time', type: 'toggle', label: 'Real', tooltip: 'Use real elapsed minutes instead of minutes per turn.', risk: 'enhanced', order: 9 },
      { id: 'chronos-advance-15', type: 'button', text: '+15m', tooltip: 'Advance story time by 15 minutes.', value: 'advance-15', variant: 'secondary', risk: 'enhanced', order: 10 },
      { id: 'chronos-advance-60', type: 'button', text: '+1h', tooltip: 'Advance story time by 1 hour.', value: 'advance-60', variant: 'secondary', risk: 'enhanced', order: 11 },
      { id: 'chronos-sleep', type: 'button', text: 'Sleep', tooltip: 'Advance to the configured wake hour.', value: 'sleep', variant: 'primary', risk: 'enhanced', order: 12 },
      { id: 'chronos-sync', type: 'button', text: 'Sync', tooltip: 'Sync Clock, and real Weather when configured.', value: 'sync', risk: 'enhanced', order: 13 },
      {
        id: 'chronos-weather-mode',
        type: 'select',
        label: 'Wx',
        options: [
          { label: 'Sim', value: 'simulated' },
          { label: 'Real', value: 'real' }
        ],
        tooltip: 'Switch between simulated and real current weather.',
        risk: 'enhanced',
        order: 20
      },
      { id: 'chronos-place', type: 'input', label: 'Place', placeholder: 'City', maxLength: 100, tooltip: 'Manual place for real weather.', risk: 'enhanced', order: 21 }
    ]
  };
}

function chronosScriptureValues(cfg) {
  var s = chronosState();
  var phase = chronosGetPhase();
  var weather = CHRONOS_WEATHER[s.weather.condition] || CHRONOS_WEATHER.clear;
  var canWeather = !!cfg.place;
  var clockAvailable = chronosHasOp('clock', 'now');
  var weatherAvailable = chronosHasOp('weather', 'current');
  return {
    'chronos-clock': { value: chronosReadableTime(), color: 'cyan' },
    'chronos-phase': { text: phase.name, color: phase.color, variant: 'soft' },
    'chronos-weather': { value: chronosLimit((s.weather.label || weather.label) + ', ' + chronosTemperatureString(cfg), 26), color: 'cyan' },
    'chronos-paused': { value: !!s.paused },
    'chronos-real-time': { value: cfg.timeMode === 'realElapsed', disabled: !clockAvailable && !s.clockStarted },
    'chronos-advance-15': { disabled: !cfg.enabled },
    'chronos-advance-60': { disabled: !cfg.enabled },
    'chronos-sleep': { disabled: !cfg.enabled },
    'chronos-sync': { disabled: !clockAvailable && !(weatherAvailable && canWeather) },
    'chronos-weather-mode': { value: cfg.weatherMode },
    'chronos-place': { value: cfg.place || '' }
  };
}

function chronosPublishScripture(cfg) {
  if (!chronosHasStateModule('scripture')) return false;
  var s = chronosState();
  var liveKey = chronosLiveKey();
  var existing = chronosReadJsonCard(CHRONOS_SCRIPTURE_STATE_CARD);
  var historyMap = existing && existing.history && typeof existing.history === 'object' ? existing.history : {};
  historyMap[liveKey] = chronosScriptureValues(cfg);

  var keys = Object.keys(historyMap).sort(function (a, b) { return Number(a) - Number(b); });
  while (keys.length > cfg.widgetHistoryLimit) {
    delete historyMap[keys.shift()];
  }

  var payload = {
    v: 1,
    manifest: chronosScriptureManifest(),
    history: historyMap,
    interactions: { ackSeq: s.widgetAckSeq, widgetAckSeq: s.widgetAckSeq },
    widgetEvents: { ackSeq: s.widgetAckSeq },
    ack: { scripture: s.widgetAckSeq },
    meta: {
      source: 'Chronos V2',
      writtenAt: chronosIso(),
      liveKey: liveKey
    }
  };

  chronosWriteCard(CHRONOS_SCRIPTURE_STATE_CARD, JSON.stringify(payload), 'Frontier', CHRONOS_SCRIPTURE_STATE_CARD, '');
  return true;
}

function chronosWriteTrace(cfg) {
  if (!cfg || !cfg.showTrace) return;
  var s = chronosState();
  var trace = {
    v: 1,
    status: s.configError || s.status,
    enabled: cfg.enabled,
    time: chronosStatusLine(cfg),
    timeMode: cfg.timeMode,
    weatherMode: cfg.weatherMode,
    paused: s.paused,
    pendingIds: Object.keys(s.pending || {}),
    widgetAckSeq: s.widgetAckSeq,
    clock: s.clock || {},
    events: s.events.slice(-12)
  };
  chronosWriteCard(CHRONOS_TRACE_CARD_TITLE, JSON.stringify(trace, null, 2), CHRONOS_CARD_TYPE, CHRONOS_TRACE_CARD_TITLE, '');
}

function chronosPruneRuntimeState(cfg) {
  var s = chronosState();
  chronosPruneObject(s.completed, 80, s.pending);
  chronosPruneObject(s.acked, 120, s.pending);
  chronosPruneObject(s.ackAttempts, 120, s.pending);
  chronosPruneObject(s.history, cfg.widgetHistoryLimit + 20, {});
  var metaIds = Object.keys(s.requestMeta || {});
  for (var i = 0; i < metaIds.length; i++) {
    if (!s.pending[metaIds[i]]) delete s.requestMeta[metaIds[i]];
  }
}

function chronosPruneObject(obj, max, protect) {
  protect = protect || {};
  var keys = Object.keys(obj || {});
  if (keys.length <= max) return;
  keys.sort();
  while (keys.length > max) {
    var key = keys.shift();
    if (!protect[key]) delete obj[key];
  }
}
