// modules/webfetch/module.js
//
// Gives AI Dungeon scripts a bounded, credential-free way to read small public
// HTTPS resources through BetterDungeon.

(function () {
  if (window.UltrascriptsWebFetchModule) return;

  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const DEFAULT_MAX_BODY_BYTES = 50000;
  const MAX_BODY_BYTES = 100000;
  const DEFAULT_RATE_LIMIT_PER_MINUTE = 20;
  const RATE_WINDOW_MS = 60000;
  const MAX_URL_CHARS = 8192;
  const MAX_HEADER_COUNT = 20;
  const MAX_HEADER_NAME_CHARS = 128;
  const MAX_HEADER_VALUE_CHARS = 2048;
  const MAX_HEADER_TOTAL_CHARS = 8192;

  const SAFE_METHODS = new Set(['GET', 'HEAD']);
  const BLOCKED_REQUEST_HEADERS = new Set([
    'accept-encoding',
    'authorization',
    'connection',
    'content-length',
    'cookie',
    'forwarded',
    'host',
    'origin',
    'proxy-authorization',
    'referer',
    'referrer',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'user-agent',
    'via',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
  ]);
  const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

  const rateBuckets = new Map(); // origin -> timestamp[]

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function normalizeUrl(value) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw invalidArgs('url is required');
    }
    if (value.length > MAX_URL_CHARS) {
      throw invalidArgs(`url must not exceed ${MAX_URL_CHARS} characters`);
    }

    let url;
    try {
      url = new URL(value);
    } catch {
      throw invalidArgs('url must be an absolute URL');
    }

    if (url.protocol !== 'https:') {
      throw { code: 'scheme_blocked', message: 'WebFetch only supports HTTPS URLs' };
    }
    if (url.username || url.password) {
      throw { code: 'credentials_blocked', message: 'URLs containing credentials are blocked' };
    }

    assertAllowedHost(url.hostname);
    return url;
  }

  function assertAllowedHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host) throw invalidArgs('url hostname is required');

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === 'local' ||
      host.endsWith('.local')
    ) {
      throw { code: 'host_blocked', message: `Host '${hostname}' is blocked` };
    }

    if (host.includes(':')) {
      if (ipv6IsBlocked(host)) {
        throw { code: 'host_blocked', message: `Host '${hostname}' is blocked` };
      }
      return;
    }

    if (ipv4IsBlocked(host)) {
      throw { code: 'host_blocked', message: `Host '${hostname}' is blocked` };
    }
  }

  function parseIpv4(host) {
    const match = String(host || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    if (parts.some((n) => n < 0 || n > 255)) {
      throw invalidArgs('url contains an invalid IPv4 host');
    }
    return parts;
  }

  function ipv4IsBlocked(host) {
    const parts = parseIpv4(host);
    if (!parts) return false;
    const [a, b, c] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  function parseIpv6(host) {
    let source = String(host || '').toLowerCase();
    if (source.includes('%')) throw invalidArgs('IPv6 zone identifiers are blocked');

    let ipv4Tail = null;
    const lastColon = source.lastIndexOf(':');
    if (source.includes('.') && lastColon >= 0) {
      ipv4Tail = parseIpv4(source.slice(lastColon + 1));
      if (!ipv4Tail) throw invalidArgs('url contains an invalid IPv6 host');
      source = `${source.slice(0, lastColon)}:${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`;
    }

    if ((source.match(/::/g) || []).length > 1) {
      throw invalidArgs('url contains an invalid IPv6 host');
    }

    const halves = source.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
      throw invalidArgs('url contains an invalid IPv6 host');
    }

    const groups = halves.length === 2
      ? [...left, ...Array(missing).fill('0'), ...right]
      : left;
    if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
      throw invalidArgs('url contains an invalid IPv6 host');
    }
    return { groups: groups.map((part) => parseInt(part, 16)), ipv4Tail };
  }

  function ipv6IsBlocked(host) {
    const parsed = parseIpv6(host);
    const groups = parsed.groups;
    const globalUnicast = (groups[0] & 0xe000) === 0x2000;
    const protocolAssignments = groups[0] === 0x2001 && groups[1] < 0x0200;
    const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8;
    const sixToFour = groups[0] === 0x2002;
    const documentationV2 = groups[0] === 0x3fff && (groups[1] & 0xf000) === 0;
    return (
      !globalUnicast ||
      protocolAssignments ||
      documentation ||
      sixToFour ||
      documentationV2
    );
  }

  function normalizeMethod(value) {
    const method = String(value || 'GET').toUpperCase();
    if (!SAFE_METHODS.has(method)) {
      throw invalidArgs(`method '${method}' is not supported; use GET or HEAD`);
    }
    return method;
  }

  function sanitizeHeaders(value) {
    if (value === undefined || value === null) return { headers: {}, stripped: [] };
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw invalidArgs('headers must be an object');
    }

    const entries = Object.entries(value);
    if (entries.length > MAX_HEADER_COUNT) {
      throw invalidArgs(`headers must not contain more than ${MAX_HEADER_COUNT} entries`);
    }

    const headers = {};
    const stripped = [];
    let totalChars = 0;
    for (const [rawName, rawValue] of entries) {
      const name = String(rawName || '').trim();
      if (!name || !HEADER_NAME_PATTERN.test(name) || name.length > MAX_HEADER_NAME_CHARS) {
        throw invalidArgs(`header name '${name || '(empty)'}' is invalid or too long`);
      }

      const lower = name.toLowerCase();
      if (rawValue === undefined || rawValue === null) continue;

      const headerValue = String(rawValue);
      if (headerValue.length > MAX_HEADER_VALUE_CHARS || /[\r\n]/.test(headerValue)) {
        throw invalidArgs(`header '${name}' has an invalid or oversized value`);
      }
      totalChars += name.length + headerValue.length;
      if (totalChars > MAX_HEADER_TOTAL_CHARS) {
        throw invalidArgs(`headers must not exceed ${MAX_HEADER_TOTAL_CHARS} combined characters`);
      }
      if (
        BLOCKED_REQUEST_HEADERS.has(lower) ||
        lower.startsWith('sec-') ||
        lower.startsWith('proxy-')
      ) {
        stripped.push(name);
        continue;
      }
      headers[name] = headerValue;
    }
    return { headers, stripped };
  }

  function prepareFetchArgs(args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }

    const url = normalizeUrl(args.url);
    const method = normalizeMethod(args.method);
    const sanitized = sanitizeHeaders(args.headers);
    if (args.body !== undefined && args.body !== null) {
      throw invalidArgs(`${method} requests cannot include a body`);
    }

    return {
      url: url.href,
      origin: url.origin,
      method,
      headers: sanitized.headers,
      strippedRequestHeaders: sanitized.stripped,
      timeoutMs: clampNumber(args.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS),
      maxBodyBytes: clampNumber(args.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 1024, MAX_BODY_BYTES),
    };
  }

  function checkRateLimit(origin, limit = DEFAULT_RATE_LIMIT_PER_MINUTE) {
    const now = Date.now();
    for (const [savedOrigin, savedBucket] of rateBuckets.entries()) {
      while (savedBucket.length && now - savedBucket[0] >= RATE_WINDOW_MS) savedBucket.shift();
      if (!savedBucket.length) rateBuckets.delete(savedOrigin);
    }
    while (!rateBuckets.has(origin) && rateBuckets.size >= 256) {
      rateBuckets.delete(rateBuckets.keys().next().value);
    }
    const bucket = rateBuckets.get(origin) || [];

    if (bucket.length >= limit) {
      const retryAfterMs = Math.max(1, RATE_WINDOW_MS - (now - bucket[0]));
      throw {
        code: 'rate_limit',
        message: `Rate limit exceeded for ${origin}`,
        retryAfterMs,
        limit,
      };
    }

    bucket.push(now);
    rateBuckets.set(origin, bucket);
  }

  function backgroundFetch(request) {
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) {
      return browser.runtime
        .sendMessage({ type: 'ULTRASCRIPTS_WEBFETCH_FETCH', request })
        .then((response) => unwrapBackgroundResponse(response));
    }

    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
    if (!runtime?.sendMessage) {
      return Promise.reject({ code: 'webfetch_unavailable', message: 'Extension runtime is unavailable' });
    }

    const message = { type: 'ULTRASCRIPTS_WEBFETCH_FETCH', request };
    return new Promise((resolve, reject) => {
      runtime.sendMessage(message, (response) => {
        const lastError = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (lastError) {
          reject({ code: 'webfetch_unavailable', message: lastError.message || 'Background fetch failed' });
          return;
        }
        try {
          resolve(unwrapBackgroundResponse(response));
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  function unwrapBackgroundResponse(response) {
    if (response?.ok) return response.data;
    throw response?.error || { code: 'webfetch_failed', message: 'Background fetch failed' };
  }

  async function fetchOp(args, ctx) {
    const prepared = prepareFetchArgs(args);
    checkRateLimit(prepared.origin, DEFAULT_RATE_LIMIT_PER_MINUTE);

    const response = await backgroundFetch({
      url: prepared.url,
      method: prepared.method,
      headers: prepared.headers,
      timeoutMs: prepared.timeoutMs,
      maxBodyBytes: prepared.maxBodyBytes,
    });

    ctx?.log?.('debug', 'WebFetch completed', prepared.method, prepared.origin, response.status);
    return {
      ...response,
      request: {
        url: prepared.url,
        origin: prepared.origin,
        method: prepared.method,
        strippedHeaders: prepared.strippedRequestHeaders,
      },
    };
  }

  const UltrascriptsWebFetchModule = {
    id: 'webfetch',
    version: '1.0.0',
    label: 'WebFetch',
    description: 'Reads bounded public HTTPS resources without cookies, credentials, or origin prompts.',

    ops: {
      fetch: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS,
        handler: fetchOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'WebFetch mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        rateBuckets: [...rateBuckets.entries()].map(([origin, bucket]) => ({ origin, count: bucket.length })),
      };
    },
  };

  window.UltrascriptsWebFetchModule = UltrascriptsWebFetchModule;

  if (window.Ultrascripts?.registry) {
    window.Ultrascripts.registry.register(UltrascriptsWebFetchModule);
  } else {
    console.warn('[WebFetch] Ultrascripts registry not available; module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UltrascriptsWebFetchModule;
  }
})();
