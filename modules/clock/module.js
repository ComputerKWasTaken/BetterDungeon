// modules/clock/module.js
//
// Frontier Phase 6 reference ops module. Exposes deterministic time helpers
// that AI Dungeon scripts can call without any external permissions.

(function () {
  if (window.FrontierClockModule) return;

  const DEFAULT_FORMAT_TIME_ZONE = 'UTC';
  const MAX_DATE_TS = 8640000000000000;

  const FORMAT_TOKEN_RE = /(\[[^\]]*])|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a|ZZ|Z/g;
  const formatterCache = new Map();

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function getSystemTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  function normalizeTimeZone(value, fallback) {
    const raw = value === undefined || value === null || value === '' ? fallback : value;
    const timeZone = String(raw || '').trim();
    if (!timeZone) throw invalidArgs('timeZone is required');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
      return timeZone;
    } catch {
      throw invalidArgs(`timeZone '${timeZone}' is not a valid IANA time zone`);
    }
  }

  function parseTimestamp(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;

    let ts = null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      ts = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return fallback;
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        ts = Number(trimmed);
      } else {
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed)) ts = parsed;
      }
    }

    if (!Number.isFinite(ts)) {
      throw invalidArgs('ts must be a unix timestamp in ms or an ISO date string');
    }
    if (Math.abs(ts) > MAX_DATE_TS) {
      throw invalidArgs('ts is outside the supported JavaScript Date range');
    }
    return Math.trunc(ts);
  }

  function getFormatter(locale, options) {
    const key = locale + '|' + JSON.stringify(options);
    if (!formatterCache.has(key)) {
      formatterCache.set(key, new Intl.DateTimeFormat(locale, options));
    }
    return formatterCache.get(key);
  }

  function partsToMap(parts) {
    const out = Object.create(null);
    for (const part of parts) {
      if (part && part.type && !(part.type in out)) out[part.type] = part.value;
    }
    return out;
  }

  function getClockParts(ts, timeZone) {
    const base = partsToMap(getFormatter('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(ts));

    return {
      year: base.year,
      month: base.month,
      day: base.day,
      hour24: base.hour,
      minute: base.minute,
      second: base.second,
      weekdayShort: getFormatter('en-US', { timeZone, weekday: 'short' }).format(ts),
      weekdayLong: getFormatter('en-US', { timeZone, weekday: 'long' }).format(ts),
      monthShort: getFormatter('en-US', { timeZone, month: 'short' }).format(ts),
      monthLong: getFormatter('en-US', { timeZone, month: 'long' }).format(ts),
    };
  }

  function parseOffsetLabel(label) {
    if (!label || label === 'GMT' || label === 'UTC') {
      return { offsetMinutes: 0, offset: '+00:00', offsetCompact: '+0000' };
    }

    const match = String(label).match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) {
      return { offsetMinutes: 0, offset: '+00:00', offsetCompact: '+0000' };
    }

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const total = sign * ((hours * 60) + minutes);
    const absTotal = Math.abs(total);
    const absHours = String(Math.floor(absTotal / 60)).padStart(2, '0');
    const absMinutes = String(absTotal % 60).padStart(2, '0');
    const prefix = total < 0 ? '-' : '+';

    return {
      offsetMinutes: total,
      offset: prefix + absHours + ':' + absMinutes,
      offsetCompact: prefix + absHours + absMinutes,
    };
  }

  function getOffsetInfo(ts, timeZone) {
    const label = getFormatter('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(ts).find((part) => part.type === 'timeZoneName')?.value || 'GMT';

    return parseOffsetLabel(label);
  }

  function formatPattern(ts, timeZone, pattern) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw invalidArgs('format is required');
    }

    const parts = getClockParts(ts, timeZone);
    const offsetInfo = getOffsetInfo(ts, timeZone);
    const hour24Number = Number(parts.hour24);
    const hour12Number = hour24Number % 12 || 12;

    const values = {
      YYYY: parts.year,
      YY: parts.year.slice(-2),
      MMMM: parts.monthLong,
      MMM: parts.monthShort,
      MM: parts.month,
      M: String(Number(parts.month)),
      DD: parts.day,
      D: String(Number(parts.day)),
      dddd: parts.weekdayLong,
      ddd: parts.weekdayShort,
      HH: parts.hour24,
      H: String(hour24Number),
      hh: String(hour12Number).padStart(2, '0'),
      h: String(hour12Number),
      mm: parts.minute,
      m: String(Number(parts.minute)),
      ss: parts.second,
      s: String(Number(parts.second)),
      A: hour24Number >= 12 ? 'PM' : 'AM',
      a: hour24Number >= 12 ? 'pm' : 'am',
      Z: offsetInfo.offset,
      ZZ: offsetInfo.offsetCompact,
    };

    return pattern.replace(FORMAT_TOKEN_RE, (token, escaped) => {
      if (escaped) return escaped.slice(1, -1);
      return Object.prototype.hasOwnProperty.call(values, token) ? values[token] : token;
    });
  }

  function buildClockPayload(ts, timeZone) {
    const offsetInfo = getOffsetInfo(ts, timeZone);
    return {
      ts,
      iso: new Date(ts).toISOString(),
      timeZone,
      offsetMinutes: offsetInfo.offsetMinutes,
      offset: offsetInfo.offset,
      offsetCompact: offsetInfo.offsetCompact,
      local: formatPattern(ts, timeZone, 'YYYY-MM-DD HH:mm:ss Z'),
      date: formatPattern(ts, timeZone, 'YYYY-MM-DD'),
      time: formatPattern(ts, timeZone, 'HH:mm:ss'),
    };
  }

  function nowOp(args = {}) {
    if (args && (typeof args !== 'object' || Array.isArray(args))) {
      throw invalidArgs('args must be an object');
    }

    const systemTimeZone = getSystemTimeZone();
    const timeZone = normalizeTimeZone(args.timeZone ?? args.tz, systemTimeZone);
    const ts = parseTimestamp(args.ts, Date.now());

    return {
      ...buildClockPayload(ts, timeZone),
      systemTimeZone,
    };
  }

  function tzOp(args = {}) {
    if (args && (typeof args !== 'object' || Array.isArray(args))) {
      throw invalidArgs('args must be an object');
    }

    const systemTimeZone = getSystemTimeZone();
    const timeZone = normalizeTimeZone(args.timeZone ?? args.tz, systemTimeZone);
    const ts = parseTimestamp(args.ts, Date.now());

    return {
      requestedTimeZone: args.timeZone ?? args.tz ?? null,
      systemTimeZone,
      ...buildClockPayload(ts, timeZone),
    };
  }

  function formatOp(args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }

    const ts = parseTimestamp(args.ts, Date.now());
    const timeZone = normalizeTimeZone(args.timeZone ?? args.tz, DEFAULT_FORMAT_TIME_ZONE);
    return formatPattern(ts, timeZone, args.format);
  }

  const FrontierClockModule = {
    id: 'clock',
    version: '1.0.0',
    label: 'Clock',
    description: 'Provides deterministic current-time, time-zone, and formatting helpers for Frontier scripts.',

    ops: {
      now: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: nowOp,
      },
      tz: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: tzOp,
      },
      format: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: formatOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'Clock mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        systemTimeZone: getSystemTimeZone(),
      };
    },
  };

  window.FrontierClockModule = FrontierClockModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierClockModule);
  } else {
    console.warn('[Clock] Frontier registry not available; clock module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierClockModule;
  }
})();
