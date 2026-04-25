// modules/webfetch/module.js
//
// Frontier Phase 5 reference ops module. Gives AI Dungeon scripts a guarded
// way to make real http/https requests through BetterDungeon.

(function () {
  if (window.FrontierWebFetchModule) return;

  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const DEFAULT_MAX_BODY_BYTES = 50000;
  const MAX_BODY_BYTES = 100000;
  const DEFAULT_RATE_LIMIT_PER_MINUTE = 20;
  const RATE_WINDOW_MS = 60000;

  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  const BLOCKED_REQUEST_HEADERS = new Set([
    'authorization',
    'cookie',
    'host',
    'origin',
    'referer',
    'user-agent',
    'connection',
    'content-length',
    'proxy-authorization',
    'x-forwarded-for',
    'x-real-ip',
  ]);

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

    let url;
    try {
      url = new URL(value);
    } catch {
      throw invalidArgs('url must be an absolute URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw { code: 'scheme_blocked', message: `Scheme '${url.protocol}' is blocked` };
    }

    assertAllowedHost(url.hostname);
    return url;
  }

  function assertAllowedHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) throw invalidArgs('url hostname is required');

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === 'local' ||
      host.endsWith('.local') ||
      host === '::' ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:0' ||
      host === '0:0:0:0:0:0:0:1'
    ) {
      throw { code: 'scheme_blocked', message: `Host '${hostname}' is blocked` };
    }

    if (host.includes(':')) {
      const firstSegment = host.split(':')[0];
      const firstHextet = parseInt(firstSegment || '0', 16);
      const uniqueLocal = firstHextet >= 0xfc00 && firstHextet <= 0xfdff;
      const linkLocal = firstHextet >= 0xfe80 && firstHextet <= 0xfebf;
      const mappedIpv4 = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);

      if (uniqueLocal || linkLocal || (mappedIpv4 && ipv4IsBlocked(mappedIpv4[1]))) {
        throw { code: 'scheme_blocked', message: `Host '${hostname}' is blocked` };
      }
      return;
    }

    if (ipv4IsBlocked(host)) {
      throw { code: 'scheme_blocked', message: `Host '${hostname}' is blocked` };
    }
  }

  function ipv4IsBlocked(host) {
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;

    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n < 0 || n > 255)) {
      throw invalidArgs('url contains an invalid IPv4 host');
    }

    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  function normalizeMethod(value) {
    const method = String(value || 'GET').toUpperCase();
    if (!SAFE_METHODS.has(method)) {
      throw invalidArgs(`method '${method}' is not supported in WebFetch v1`);
    }
    return method;
  }

  function sanitizeHeaders(value) {
    if (value === undefined || value === null) return { headers: {}, stripped: [] };
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw invalidArgs('headers must be an object');
    }

    const headers = {};
    const stripped = [];
    for (const [rawName, rawValue] of Object.entries(value)) {
      const name = String(rawName || '').trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (
        BLOCKED_REQUEST_HEADERS.has(lower) ||
        lower.startsWith('sec-') ||
        lower.startsWith('proxy-')
      ) {
        stripped.push(name);
        continue;
      }
      if (rawValue === undefined || rawValue === null) continue;
      headers[name] = String(rawValue);
    }
    return { headers, stripped };
  }

  function normalizeBody(body, method) {
    if (body === undefined || body === null) return undefined;
    throw invalidArgs(`${method} requests cannot include a body in WebFetch v1`);
  }

  function prepareFetchArgs(args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }

    const url = normalizeUrl(args.url);
    const method = normalizeMethod(args.method);
    const sanitized = sanitizeHeaders(args.headers);
    const body = normalizeBody(args.body, method);
    const timeoutMs = clampNumber(args.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
    const maxBodyBytes = clampNumber(args.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 1024, MAX_BODY_BYTES);

    return {
      url: url.href,
      origin: url.origin,
      method,
      headers: sanitized.headers,
      strippedRequestHeaders: sanitized.stripped,
      body,
      timeoutMs,
      maxBodyBytes,
    };
  }

  function checkRateLimit(origin, limit = DEFAULT_RATE_LIMIT_PER_MINUTE) {
    const now = Date.now();
    const bucket = rateBuckets.get(origin) || [];
    while (bucket.length && now - bucket[0] >= RATE_WINDOW_MS) bucket.shift();

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

  function consentBroker() {
    return window.FrontierWebFetchConsent;
  }

  async function ensureConsent(origin, details) {
    const broker = consentBroker();
    if (!broker || typeof broker.ensureAllowed !== 'function') {
      throw {
        code: 'consent_denied',
        message: 'WebFetch consent broker is unavailable',
      };
    }

    try {
      return await broker.ensureAllowed(origin, details);
    } catch (err) {
      if (err && typeof err === 'object' && typeof err.code === 'string') throw err;
      throw {
        code: 'consent_denied',
        message: err?.message ? `WebFetch consent check failed: ${err.message}` : 'WebFetch consent check failed',
      };
    }
  }

  function backgroundFetch(request) {
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) {
      return browser.runtime
        .sendMessage({ type: 'FRONTIER_WEBFETCH_FETCH', request })
        .then((response) => unwrapBackgroundResponse(response));
    }

    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
    if (!runtime?.sendMessage) {
      return Promise.reject({ code: 'webfetch_unavailable', message: 'Extension runtime is unavailable' });
    }

    const message = { type: 'FRONTIER_WEBFETCH_FETCH', request };
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

  async function fetchOp(args, ctx, request) {
    const prepared = prepareFetchArgs(args);
    await ensureConsent(prepared.origin, {
      url: prepared.url,
      method: prepared.method,
      requestId: request?.id || null,
    });
    checkRateLimit(prepared.origin, DEFAULT_RATE_LIMIT_PER_MINUTE);

    const response = await backgroundFetch({
      url: prepared.url,
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
      timeoutMs: prepared.timeoutMs,
      maxBodyBytes: prepared.maxBodyBytes,
    });

    ctx?.log?.('debug', 'WebFetch completed', prepared.method, prepared.url, response.status);
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

  function flattenDuckDuckGoTopics(topics, out = []) {
    if (!Array.isArray(topics)) return out;
    for (const item of topics) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item.Topics)) {
        flattenDuckDuckGoTopics(item.Topics, out);
        continue;
      }
      if (item.Text || item.FirstURL) {
        out.push({
          text: item.Text || '',
          url: item.FirstURL || '',
        });
      }
    }
    return out;
  }

  async function searchOp(args = {}, ctx, request) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }
    const query = String(args.query || '').trim();
    if (!query) throw invalidArgs('query is required');

    const maxResults = clampNumber(args.maxResults, 5, 1, 10);
    const url =
      'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' +
      encodeURIComponent(query);

    const response = await fetchOp({
      url,
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeoutMs: args.timeoutMs,
      maxBodyBytes: args.maxBodyBytes || 60000,
    }, ctx, request);

    let parsed = null;
    if (response.bodyEncoding === 'text' && response.body) {
      try { parsed = JSON.parse(response.body); }
      catch { parsed = null; }
    }

    const related = flattenDuckDuckGoTopics(parsed?.RelatedTopics).slice(0, maxResults);
    return {
      query,
      provider: 'duckduckgo',
      status: response.status,
      heading: parsed?.Heading || '',
      answer: parsed?.Answer || '',
      abstractText: parsed?.AbstractText || '',
      abstractUrl: parsed?.AbstractURL || '',
      related,
      source: response.url,
      truncated: response.truncated,
    };
  }

  const FrontierWebFetchModule = {
    id: 'webfetch',
    version: '1.0.0',
    label: 'WebFetch',
    description: 'Fetches http/https URLs for Frontier scripts with consent, rate limits, and response shaping.',

    ops: {
      fetch: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS,
        handler: fetchOp,
      },
      search: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS,
        handler: searchOp,
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

  window.FrontierWebFetchModule = FrontierWebFetchModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierWebFetchModule);
  } else {
    console.warn('[WebFetch] Frontier registry not available; module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierWebFetchModule;
  }
})();
