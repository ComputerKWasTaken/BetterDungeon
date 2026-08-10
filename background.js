// BetterDungeon background worker.
//
// Hosts privileged operations that content scripts should not perform inside
// the page context. Phase 5 uses this for WebFetch so Ultrascripts ops can access
// public HTTPS URLs without inheriting AI Dungeon page CORS.

(function () {
  if (globalThis.__BetterDungeonBackground) return;
  globalThis.__BetterDungeonBackground = true;

  const extensionRuntime =
    (typeof chrome !== 'undefined' && chrome.runtime) ||
    (typeof browser !== 'undefined' && browser.runtime) ||
    null;

  if (!extensionRuntime?.onMessage?.addListener) {
    console.warn('[BetterDungeon/background] Extension runtime is unavailable; background services disabled.');
    return;
  }

  const WEBFETCH_MESSAGE = 'ULTRASCRIPTS_WEBFETCH_FETCH';
  const SDK_MESSAGE = 'ULTRASCRIPTS_SDK_REQUEST';
  const GEMINI_MESSAGE = 'ULTRASCRIPTS_AI_GEMINI';
  const GEMINI_CHAT_PORT = 'BETTERDUNGEON_AI_CHAT_GEMINI_V1';
  const OPENAI_MESSAGE = 'ULTRASCRIPTS_AI_OPENAI';
  const OPENAI_CHAT_PORT = 'BETTERDUNGEON_AI_CHAT_OPENAI_V1';
  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const GEMINI_DEFAULT_TIMEOUT_MS = 120000;
  const GEMINI_CHAT_KEEPALIVE_MS = 20000;
  const GEMINI_CHAT_START_TIMEOUT_MS = 5000;
  const GEMINI_CHAT_TERMINAL_GRACE_MS = 1000;
  const GEMINI_PROMPT_MAX_CHARS = 12000;
  const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
  const GEMINI_DEFAULT_MODEL_MODE = 'auto';
  const GEMINI_DEFAULT_THINKING_LEVEL = 'minimal';
  const GEMINI_THINKING_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high']);
  const GEMINI_OUTPUT_TYPES = Object.freeze(['text', 'json']);
  const GEMINI_AUTO_STEPDOWN_MODELS = Object.freeze([
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemma-4-31b-it',
    'gemma-4-26b-a4b-it',
  ]);
  const GEMINI_STORAGE_KEYS = {
    apiKey: 'ultrascripts_ai_gemini_api_key',
    model: 'ultrascripts_ai_gemini_model',
    modelMode: 'ultrascripts_ai_gemini_model_mode',
  };
  const OPENAI_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
  const OPENAI_STORAGE_KEYS = {
    baseUrl: 'ultrascripts_ai_openai_base_url',
    apiKey: 'ultrascripts_ai_openai_api_key',
    model: 'ultrascripts_ai_openai_model',
  };
  const DEFAULT_MAX_BODY_BYTES = 50000;
  const MAX_BODY_BYTES = 100000;
  const MAX_WEBFETCH_REDIRECTS = 5;
  const MAX_WEBFETCH_URL_CHARS = 8192;
  const MAX_WEBFETCH_HEADER_COUNT = 20;
  const MAX_WEBFETCH_HEADER_NAME_CHARS = 128;
  const MAX_WEBFETCH_HEADER_VALUE_CHARS = 2048;
  const MAX_WEBFETCH_HEADER_TOTAL_CHARS = 8192;
  const WEBFETCH_DNR_BLOCK_RULE_ID = 910001;
  const WEBFETCH_DNR_ALLOW_RULE_ID = 910002;
  const SAFE_METHODS = new Set(['GET', 'HEAD']);

  const extensionApi =
    (typeof browser !== 'undefined' && browser?.declarativeNetRequest) ? browser :
    (typeof chrome !== 'undefined') ? chrome :
    null;
  const declarativeNetRequestApi = extensionApi?.declarativeNetRequest || null;
  const webRequestApi = extensionApi?.webRequest || null;
  let privilegedNetworkQueue = Promise.resolve();
  let webFetchGuardReady = Promise.resolve();

  const SDK_SYNC_STORAGE_KEYS = {
    features: 'betterDungeonFeatures',
    ultrascriptsModules: 'ultrascripts_enabled_modules',
    ultrascriptsDebug: 'ultrascripts_debug',
  };
  const SDK_DEFAULT_FEATURES = {
    ultrascripts: true,
    markdown: true,
    command: true,
    try: true,
    triggerHighlight: true,
    hotkey: true,
    favoriteInstructions: true,
    inputModeColor: true,
    characterPreset: true,
    autoSee: false,
    notes: true,
    storyCardModalDock: true,
    inputHistory: true,
    textToSpeech: false,
    customDynamic: false,
    navigator: true,
  };
  const SDK_ULTRASCRIPTS_MODULES = [
    'widget',
    'webfetch',
    'clock',
    'sdk',
    'weather',
    'network',
    'system',
    'ai',
  ];
  const BLOCKED_RESPONSE_HEADERS = new Set([
    'set-cookie',
    'set-cookie2',
    'authorization',
    'proxy-authorization',
  ]);
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
  const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
  const geminiRuntimeState = {
    lastResolvedModel: null,
    lastProviderModel: null,
    lastResolvedAtIso: null,
    lastFallbackMode: null,
    lastAttemptedModels: [],
  };
  const openaiRuntimeState = {
    lastModel: null,
    lastResolvedAtIso: null,
  };
  const activeAiChatPorts = new Set();

  function normalizeError(error) {
    if (error && typeof error === 'object') {
      const normalized = {
        code: typeof error.code === 'string' ? error.code : 'webfetch_failed',
        message: typeof error.message === 'string' ? error.message : 'WebFetch failed',
      };
      for (const key of ['retryable', 'status', 'statusText', 'retryAfterMs', 'backend', 'phase', 'task', 'detail', 'model', 'providerReason']) {
        if (error[key] !== undefined) normalized[key] = error[key];
      }
      return normalized;
    }
    return { code: 'webfetch_failed', message: String(error || 'WebFetch failed') };
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function withPrivilegedNetworkLock(task) {
    const run = privilegedNetworkQueue.then(task, task);
    privilegedNetworkQueue = run.catch(() => {});
    return run;
  }

  function updateSessionRules(update) {
    if (!declarativeNetRequestApi?.updateSessionRules) {
      return Promise.reject(new Error('declarativeNetRequest is unavailable'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const callback = () => {
        const lastError =
          (typeof chrome !== 'undefined' && chrome?.runtime?.lastError) ||
          (typeof browser !== 'undefined' && browser?.runtime?.lastError) ||
          null;
        finish(lastError ? new Error(lastError.message || 'Failed to update redirect guard') : null);
      };

      try {
        const maybePromise = declarativeNetRequestApi.updateSessionRules(update, callback);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(() => finish(), finish);
        }
      } catch (callbackError) {
        try {
          const maybePromise = declarativeNetRequestApi.updateSessionRules(update);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(() => finish(), finish);
          } else {
            finish();
          }
        } catch (promiseError) {
          finish(promiseError || callbackError);
        }
      }
    });
  }

  function webFetchNetworkUrl(url) {
    const value = url instanceof URL ? url.href : String(url || '');
    const hashIndex = value.indexOf('#');
    return hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  }

  function escapeDnrRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function removeWebFetchRedirectGuard() {
    if (!declarativeNetRequestApi?.updateSessionRules) return;
    await updateSessionRules({
      removeRuleIds: [WEBFETCH_DNR_BLOCK_RULE_ID, WEBFETCH_DNR_ALLOW_RULE_ID],
    });
  }

  async function installWebFetchRedirectGuard(url) {
    if (!declarativeNetRequestApi?.updateSessionRules || !webRequestApi?.onBeforeRedirect) {
      return false;
    }

    const networkUrl = webFetchNetworkUrl(url);
    const initiatorDomains = extensionRuntime?.id ? [String(extensionRuntime.id).toLowerCase()] : undefined;
    if (!initiatorDomains) return false;

    await updateSessionRules({
      removeRuleIds: [WEBFETCH_DNR_BLOCK_RULE_ID, WEBFETCH_DNR_ALLOW_RULE_ID],
      addRules: [
        {
          id: WEBFETCH_DNR_BLOCK_RULE_ID,
          priority: 1,
          action: { type: 'block' },
          condition: {
            regexFilter: '^https?://',
            initiatorDomains,
            resourceTypes: ['xmlhttprequest'],
          },
        },
        {
          id: WEBFETCH_DNR_ALLOW_RULE_ID,
          priority: 2,
          action: { type: 'allow' },
          condition: {
            regexFilter: `^${escapeDnrRegex(networkUrl)}$`,
            initiatorDomains,
            resourceTypes: ['xmlhttprequest'],
          },
        },
      ],
    });
    return true;
  }

  async function fetchWebFetchHop(url, options, timeoutMs) {
    let guarded = false;
    try {
      guarded = await installWebFetchRedirectGuard(url);
    } catch {
      guarded = false;
    }

    let redirectUrl = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const networkUrl = webFetchNetworkUrl(url);
    const redirectListener = (details) => {
      if (webFetchNetworkUrl(details?.url) !== networkUrl) return;
      if (typeof details?.tabId === 'number' && details.tabId !== -1) return;
      redirectUrl = typeof details?.redirectUrl === 'string' ? details.redirectUrl : null;
      controller.abort();
    };

    if (guarded) {
      webRequestApi.onBeforeRedirect.addListener(
        redirectListener,
        { urls: ['<all_urls>'], types: ['xmlhttprequest'] },
      );
    }

    try {
      const response = await fetch(url.href, {
        ...options,
        redirect: guarded ? 'follow' : 'manual',
        signal: controller.signal,
      });
      if (redirectUrl) return { redirectUrl };
      if (!guarded && response.type === 'opaqueredirect') {
        throw {
          code: 'redirect_unavailable',
          message: 'This browser did not expose redirect metadata for validation',
        };
      }
      return { response };
    } catch (error) {
      if (redirectUrl) return { redirectUrl };
      throw error;
    } finally {
      clearTimeout(timer);
      if (guarded) {
        try { webRequestApi.onBeforeRedirect.removeListener(redirectListener); } catch { /* noop */ }
        try { await removeWebFetchRedirectGuard(); } catch { /* noop */ }
      }
    }
  }

  // Session rules can survive service-worker suspension. Clear any interrupted
  // redirect guard immediately whenever the background runtime starts again.
  webFetchGuardReady = removeWebFetchRedirectGuard().catch(() => {});

  function isTextContentType(contentType) {
    const lower = String(contentType || '').toLowerCase();
    return (
      lower === '' ||
      lower.startsWith('text/') ||
      lower.includes('/json') ||
      lower.includes('+json') ||
      lower.includes('/xml') ||
      lower.includes('+xml')
    );
  }

  function invalidWebFetchArgs(message) {
    return { code: 'invalid_args', message };
  }

  function parseIpv4(host) {
    const match = String(host || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    if (parts.some((value) => value < 0 || value > 255)) {
      throw invalidWebFetchArgs('url contains an invalid IPv4 host');
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
    if (source.includes('%')) throw invalidWebFetchArgs('IPv6 zone identifiers are blocked');

    let ipv4Tail = null;
    const lastColon = source.lastIndexOf(':');
    if (source.includes('.') && lastColon >= 0) {
      ipv4Tail = parseIpv4(source.slice(lastColon + 1));
      if (!ipv4Tail) throw invalidWebFetchArgs('url contains an invalid IPv6 host');
      source = `${source.slice(0, lastColon)}:${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`;
    }

    if ((source.match(/::/g) || []).length > 1) {
      throw invalidWebFetchArgs('url contains an invalid IPv6 host');
    }
    const halves = source.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
      throw invalidWebFetchArgs('url contains an invalid IPv6 host');
    }
    const groups = halves.length === 2
      ? [...left, ...Array(missing).fill('0'), ...right]
      : left;
    if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
      throw invalidWebFetchArgs('url contains an invalid IPv6 host');
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

  function validateWebFetchUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) throw invalidWebFetchArgs('url is required');
    if (raw.length > MAX_WEBFETCH_URL_CHARS) {
      throw invalidWebFetchArgs(`url must not exceed ${MAX_WEBFETCH_URL_CHARS} characters`);
    }

    let url;
    try {
      url = new URL(raw);
    } catch {
      throw invalidWebFetchArgs('url must be an absolute URL');
    }
    if (url.protocol !== 'https:') {
      throw { code: 'scheme_blocked', message: 'WebFetch only supports HTTPS URLs' };
    }
    if (url.username || url.password) {
      throw { code: 'credentials_blocked', message: 'URLs containing credentials are blocked' };
    }

    const host = String(url.hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host) throw invalidWebFetchArgs('url hostname is required');
    if (host === 'localhost' || host.endsWith('.localhost') || host === 'local' || host.endsWith('.local')) {
      throw { code: 'host_blocked', message: `Host '${url.hostname}' is blocked` };
    }
    if ((host.includes(':') && ipv6IsBlocked(host)) || (!host.includes(':') && ipv4IsBlocked(host))) {
      throw { code: 'host_blocked', message: `Host '${url.hostname}' is blocked` };
    }
    return url;
  }

  function sanitizeWebFetchHeaders(value) {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw invalidWebFetchArgs('headers must be an object');
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_WEBFETCH_HEADER_COUNT) {
      throw invalidWebFetchArgs(`headers must not contain more than ${MAX_WEBFETCH_HEADER_COUNT} entries`);
    }

    const headers = {};
    let totalChars = 0;
    for (const [rawName, rawValue] of entries) {
      const name = String(rawName || '').trim();
      if (!name || !HEADER_NAME_PATTERN.test(name) || name.length > MAX_WEBFETCH_HEADER_NAME_CHARS) {
        throw invalidWebFetchArgs(`header name '${name || '(empty)'}' is invalid or too long`);
      }
      const lower = name.toLowerCase();
      if (rawValue === undefined || rawValue === null) continue;
      const headerValue = String(rawValue);
      if (headerValue.length > MAX_WEBFETCH_HEADER_VALUE_CHARS || /[\r\n]/.test(headerValue)) {
        throw invalidWebFetchArgs(`header '${name}' has an invalid or oversized value`);
      }
      totalChars += name.length + headerValue.length;
      if (totalChars > MAX_WEBFETCH_HEADER_TOTAL_CHARS) {
        throw invalidWebFetchArgs(`headers must not exceed ${MAX_WEBFETCH_HEADER_TOTAL_CHARS} combined characters`);
      }
      if (BLOCKED_REQUEST_HEADERS.has(lower) || lower.startsWith('sec-') || lower.startsWith('proxy-')) {
        continue;
      }
      headers[name] = headerValue;
    }
    return headers;
  }

  function urlOrigin(url) {
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`;
  }

  function concatBytes(chunks, totalLength) {
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  async function readBodyBytes(response, maxBodyBytes) {
    const contentLength = Number(response.headers.get('content-length') || 0);

    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = await response.arrayBuffer();
      const rawBytes = new Uint8Array(buffer);
      const truncated = rawBytes.length > maxBodyBytes;
      const bytes = truncated ? rawBytes.slice(0, maxBodyBytes) : rawBytes;
      return {
        bytes,
        totalBytes: rawBytes.length,
        returnedBytes: bytes.length,
        truncated,
      };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let returnedBytes = 0;
    let truncated = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        if (!chunk.length) continue;

        const remaining = maxBodyBytes - returnedBytes;
        if (remaining <= 0) {
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }

        if (chunk.length > remaining) {
          chunks.push(chunk.slice(0, remaining));
          returnedBytes += remaining;
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }

        chunks.push(chunk);
        returnedBytes += chunk.length;
      }
    } finally {
      try { reader.releaseLock?.(); } catch { /* noop */ }
    }

    return {
      bytes: concatBytes(chunks, returnedBytes),
      totalBytes: contentLength > 0 ? contentLength : returnedBytes,
      returnedBytes,
      truncated: truncated || (contentLength > 0 && contentLength > returnedBytes),
    };
  }

  async function handleWebFetchUnlocked(request = {}) {
    let url = validateWebFetchUrl(request.url);
    const method = String(request.method || 'GET').toUpperCase();
    let headers = sanitizeWebFetchHeaders(request.headers);
    const timeoutMs = clampNumber(request.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
    const maxBodyBytes = clampNumber(request.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 1024, MAX_BODY_BYTES);

    if (!SAFE_METHODS.has(method)) {
      throw { code: 'invalid_args', message: `method '${method}' is not supported; use GET or HEAD` };
    }
    if (request.body !== undefined && request.body !== null) {
      throw { code: 'invalid_args', message: `${method} requests cannot include a body` };
    }

    const deadline = Date.now() + timeoutMs;
    const visited = new Set([url.href]);
    let redirectCount = 0;

    try {
      let response;
      while (true) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw { code: 'timeout', message: `WebFetch timed out after ${timeoutMs} ms` };
        }
        const hop = await fetchWebFetchHop(url, {
          method,
          headers,
          credentials: 'omit',
          cache: 'no-store',
          referrer: '',
          referrerPolicy: 'no-referrer',
        }, remainingMs);

        response = hop.response || null;
        const redirectLocation = hop.redirectUrl || (
          response && REDIRECT_STATUSES.has(response.status)
            ? response.headers.get('location')
            : null
        );

        if (!hop.redirectUrl && (!response || !REDIRECT_STATUSES.has(response.status))) break;
        if (!redirectLocation) {
          throw { code: 'redirect_blocked', message: 'Redirect response did not include a readable Location header' };
        }
        if (redirectCount >= MAX_WEBFETCH_REDIRECTS) {
          throw { code: 'redirect_limit', message: `WebFetch exceeded ${MAX_WEBFETCH_REDIRECTS} redirects` };
        }

        const nextUrl = validateWebFetchUrl(new URL(redirectLocation, url).href);
        if (visited.has(nextUrl.href)) {
          throw { code: 'redirect_loop', message: 'WebFetch detected a redirect loop' };
        }
        if (urlOrigin(nextUrl) !== urlOrigin(url)) headers = {};
        url = nextUrl;
        visited.add(url.href);
        redirectCount++;
      }

      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        const lower = String(key || '').toLowerCase();
        if (!BLOCKED_RESPONSE_HEADERS.has(lower)) responseHeaders[key] = value;
      });

      const contentType = response.headers.get('content-type') || '';
      if (!isTextContentType(contentType)) {
        throw {
          code: 'content_type_blocked',
          message: `WebFetch only returns text-like content; received '${contentType || 'unknown'}'`,
        };
      }
      const body = method === 'HEAD'
        ? { bytes: new Uint8Array(0), totalBytes: 0, returnedBytes: 0, truncated: false }
        : await readBodyBytes(response, maxBodyBytes);

      return {
        url: response.url || url.href,
        redirected: redirectCount > 0,
        redirectCount,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: responseHeaders,
        contentType,
        bodyEncoding: 'text',
        body: method === 'HEAD' ? '' : new TextDecoder().decode(body.bytes),
        bytes: body.totalBytes,
        returnedBytes: body.returnedBytes,
        truncated: body.truncated,
      };
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw { code: 'timeout', message: `WebFetch timed out after ${timeoutMs} ms` };
      }
      if (err && typeof err === 'object' && typeof err.code === 'string') throw err;
      throw { code: 'webfetch_failed', message: err?.message || 'WebFetch failed' };
    }
  }

  function handleWebFetch(request = {}) {
    return withPrivilegedNetworkLock(async () => {
      await webFetchGuardReady;
      return handleWebFetchUnlocked(request);
    });
  }

  function storageArea(areaName) {
    const api =
      (typeof browser !== 'undefined' && browser?.storage) ? browser :
      (typeof chrome !== 'undefined' && chrome?.storage) ? chrome :
      null;
    return api?.storage?.[areaName] || null;
  }

  function storageGet(areaName, keys) {
    const area = storageArea(areaName);
    if (!area?.get) return Promise.resolve({});

    return new Promise((resolve) => {
      try {
        const maybePromise = area.get(keys, (result) => resolve(result || {}));
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then((result) => resolve(result || {}), () => resolve({}));
        }
      } catch {
        try {
          const maybePromise = area.get(keys);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then((result) => resolve(result || {}), () => resolve({}));
          } else {
            resolve({});
          }
        } catch {
          resolve({});
        }
      }
    });
  }

  function normalizeSdkFeatures(raw) {
    return { ...SDK_DEFAULT_FEATURES, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  function storageSet(areaName, data) {
    const area = storageArea(areaName);
    if (!area?.set) return Promise.resolve();

    return new Promise((resolve, reject) => {
      try {
        const maybePromise = area.set(data, () => {
          const lastError =
            (typeof chrome !== 'undefined' && chrome.runtime?.lastError) ||
            (typeof browser !== 'undefined' && browser.runtime?.lastError) ||
            null;
          if (lastError) reject(lastError);
          else resolve();
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        }
      } catch (err) {
        try {
          const maybePromise = area.set(data);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(resolve, reject);
          } else {
            resolve();
          }
        } catch (innerErr) {
          reject(innerErr);
        }
      }
    });
  }

  function normalizeSdkUltrascriptsModules(raw) {
    const out = {};
    const saved = raw && typeof raw === 'object' ? raw : {};
    for (let i = 0; i < SDK_ULTRASCRIPTS_MODULES.length; i++) {
      out[SDK_ULTRASCRIPTS_MODULES[i]] = true;
    }
    for (const [key, value] of Object.entries(saved)) {
      if (SDK_ULTRASCRIPTS_MODULES.includes(key)) out[key] = !!value;
    }
    return out;
  }

  async function getSdkConfigSnapshot() {
    const syncResult = await storageGet('sync', Object.values(SDK_SYNC_STORAGE_KEYS));
    return {
      features: normalizeSdkFeatures(syncResult[SDK_SYNC_STORAGE_KEYS.features]),
      ultrascripts: {
        debug: !!syncResult[SDK_SYNC_STORAGE_KEYS.ultrascriptsDebug],
        modulePreferences: normalizeSdkUltrascriptsModules(syncResult[SDK_SYNC_STORAGE_KEYS.ultrascriptsModules]),
      },
    };
  }

  function normalizeGeminiModel(value) {
    const model = String(value || GEMINI_DEFAULT_MODEL).trim().replace(/^models\//, '');
    return model || GEMINI_DEFAULT_MODEL;
  }

  function normalizeGeminiModelMode(value) {
    return String(value || '').trim().toLowerCase() === 'manual'
      ? 'manual'
      : GEMINI_DEFAULT_MODEL_MODE;
  }

  function normalizeGeminiFallbackChain(value) {
    const seen = new Set();
    const out = [];
    const raw = Array.isArray(value) ? value : GEMINI_AUTO_STEPDOWN_MODELS;
    for (let i = 0; i < raw.length; i++) {
      const model = normalizeGeminiModel(raw[i]);
      if (!model || seen.has(model)) continue;
      seen.add(model);
      out.push(model);
    }
    if (!out.length) out.push(GEMINI_DEFAULT_MODEL);
    return out;
  }

  async function getGeminiSettings() {
    const local = await storageGet('local', Object.values(GEMINI_STORAGE_KEYS));
    const apiKey = String(local[GEMINI_STORAGE_KEYS.apiKey] || '').trim();
    const modelMode = normalizeGeminiModelMode(local[GEMINI_STORAGE_KEYS.modelMode]);
    const model = normalizeGeminiModel(local[GEMINI_STORAGE_KEYS.model]);
    const fallbackChain = normalizeGeminiFallbackChain(GEMINI_AUTO_STEPDOWN_MODELS);
    return {
      apiKey,
      model,
      modelMode,
      fallbackChain,
      keyConfigured: !!apiKey,
    };
  }

  function geminiQueryModels(settings) {
    if (settings?.modelMode === 'manual') return [normalizeGeminiModel(settings?.model)];
    return normalizeGeminiFallbackChain(settings?.fallbackChain);
  }

  function geminiRememberSuccess(result) {
    geminiRuntimeState.lastResolvedModel = typeof result?.model === 'string' ? result.model : null;
    geminiRuntimeState.lastProviderModel =
      typeof result?.providerModel === 'string' ? result.providerModel : null;
    geminiRuntimeState.lastResolvedAtIso =
      typeof result?.generatedAtIso === 'string' ? result.generatedAtIso : new Date().toISOString();
    geminiRuntimeState.lastFallbackMode =
      typeof result?.fallback?.mode === 'string' ? result.fallback.mode : GEMINI_DEFAULT_MODEL_MODE;
    geminiRuntimeState.lastAttemptedModels = Array.isArray(result?.fallback?.attemptedModels)
      ? result.fallback.attemptedModels.filter(model => typeof model === 'string' && model)
      : [];
  }

  function geminiResetRuntimeState() {
    geminiRuntimeState.lastResolvedModel = null;
    geminiRuntimeState.lastProviderModel = null;
    geminiRuntimeState.lastResolvedAtIso = null;
    geminiRuntimeState.lastFallbackMode = null;
    geminiRuntimeState.lastAttemptedModels = [];
  }

  function geminiStatus(settings, actualModel = null) {
    const ready = !!settings?.keyConfigured;
    const models = geminiQueryModels(settings);
    const selectedModel = models[0] || GEMINI_DEFAULT_MODEL;
    const activeModel = actualModel || geminiRuntimeState.lastResolvedModel || null;
    return {
      backend: 'gemini',
      backendLabel: 'Gemini',
      ready,
      available: ready,
      reason: ready ? null : 'ai_backend_not_configured',
      supports: { text: true, json: true, thinking: true },
      config: {
        provider: 'gemini',
        api: 'interactions',
        apiVersion: 'v1',
        stateless: true,
        adjustableSafety: 'provider-default',
        keyConfigured: ready,
        modelMode: normalizeGeminiModelMode(settings?.modelMode),
        model: selectedModel,
        selectedModel,
        activeModel,
        fallbackModels: models,
        thinkingDefault: GEMINI_DEFAULT_THINKING_LEVEL,
        thinkingLevels: [...GEMINI_THINKING_LEVELS],
        lastResolvedModel: geminiRuntimeState.lastResolvedModel,
        lastProviderModel: geminiRuntimeState.lastProviderModel,
        lastResolvedAtIso: geminiRuntimeState.lastResolvedAtIso,
        lastFallbackMode: geminiRuntimeState.lastFallbackMode,
        lastAttemptedModels: [...geminiRuntimeState.lastAttemptedModels],
      },
      message: ready
        ? 'Gemini backend is configured.'
        : 'Add a Gemini API key in BetterDungeon to enable AI queries.',
    };
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeGeminiTask(task) {
    if (!isObject(task)) {
      throw { code: 'invalid_args', message: 'Gemini query task must be an object', retryable: false };
    }
    if (typeof task.prompt !== 'string' || !task.prompt.trim()) {
      throw { code: 'invalid_args', message: 'prompt is required', retryable: false };
    }
    if (task.prompt.length > GEMINI_PROMPT_MAX_CHARS) {
      throw {
        code: 'invalid_args',
        message: `prompt must be ${GEMINI_PROMPT_MAX_CHARS} characters or less`,
        retryable: false,
        maxChars: GEMINI_PROMPT_MAX_CHARS,
        actualChars: task.prompt.length,
      };
    }
    const output = isObject(task.output) ? task.output : { type: 'text' };
    const rawType = output.type === undefined ? 'text' : output.type;
    if (typeof rawType !== 'string' || GEMINI_OUTPUT_TYPES.indexOf(rawType) === -1) {
      throw {
        code: 'invalid_args',
        message: `output.type must be one of: ${GEMINI_OUTPUT_TYPES.join(', ')}`,
        retryable: false,
      };
    }
    const type = rawType;
    if (type === 'json' && !isObject(output.schema)) {
      throw {
        code: 'invalid_args',
        message: 'output.schema is required when output.type is json',
        retryable: false,
      };
    }
    return {
      id: typeof task.id === 'string' ? task.id : null,
      prompt: task.prompt,
      promptChars: Number(task.promptChars || task.prompt.length),
      thinking: normalizeGeminiThinking(task.thinking),
      output: {
        type,
        schema: output.schema ? cloneJson(output.schema) : undefined,
      },
    };
  }

  function normalizeChatFunctionTools(tools) {
    if (tools === undefined || tools === null) return [];
    if (!Array.isArray(tools) || tools.length > 16) {
      throw { code: 'invalid_args', message: 'tools must contain at most 16 entries', retryable: false };
    }
    return tools.map((tool, index) => {
      if (!isObject(tool) || typeof tool.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) {
        throw { code: 'invalid_args', message: `tools[${index}] is invalid`, retryable: false };
      }
      if (typeof tool.description !== 'string' || !tool.description.trim() || !isObject(tool.parameters)) {
        throw { code: 'invalid_args', message: `tools[${index}] declaration is incomplete`, retryable: false };
      }
      return {
        name: tool.name,
        description: tool.description.trim(),
        parameters: cloneJson(tool.parameters),
      };
    });
  }

  function normalizeChatToolResults(results) {
    if (results === undefined || results === null) return [];
    if (!Array.isArray(results) || results.length > 16) {
      throw { code: 'invalid_args', message: 'toolResults must contain at most 16 entries', retryable: false };
    }
    return results.map((result, index) => {
      if (!isObject(result) || typeof result.callId !== 'string' || !result.callId.trim()) {
        throw { code: 'invalid_args', message: `toolResults[${index}].callId is required`, retryable: false };
      }
      if (typeof result.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(result.name)) {
        throw { code: 'invalid_args', message: `toolResults[${index}].name is invalid`, retryable: false };
      }
      return {
        callId: result.callId.trim(),
        name: result.name,
        result: cloneJson(result.result),
        isError: result.isError === true,
      };
    });
  }

  function normalizeChatContinuation(value) {
    if (value === undefined || value === null) return null;
    if (!isObject(value) || typeof value.provider !== 'string' || !value.provider.trim()) {
      throw { code: 'invalid_args', message: 'continuation.provider is required', retryable: false };
    }
    return cloneJson(value);
  }

  function normalizeGeminiChatTask(task) {
    if (!isObject(task)) {
      throw { code: 'invalid_args', message: 'Gemini chat task must be an object', retryable: false };
    }
    if (task.op !== 'chat') {
      throw { code: 'invalid_args', message: 'Gemini chat task op must be chat', retryable: false };
    }
    if (typeof task.systemInstruction !== 'string' || !task.systemInstruction.trim()) {
      throw { code: 'invalid_args', message: 'systemInstruction is required', retryable: false };
    }
    if (!Array.isArray(task.messages) || task.messages.length === 0) {
      throw { code: 'invalid_args', message: 'messages must be a non-empty array', retryable: false };
    }

    const messages = task.messages.map((message, index) => {
      if (!isObject(message)) {
        throw { code: 'invalid_args', message: `messages[${index}] must be an object`, retryable: false };
      }
      if (message.role !== 'user' && message.role !== 'assistant') {
        throw {
          code: 'invalid_args',
          message: `messages[${index}].role must be user or assistant`,
          retryable: false,
        };
      }
      if (typeof message.content !== 'string' || !message.content.trim()) {
        throw {
          code: 'invalid_args',
          message: `messages[${index}].content must be a non-empty string`,
          retryable: false,
        };
      }
      return { role: message.role, content: message.content };
    });

    if (messages[messages.length - 1].role !== 'user') {
      throw { code: 'invalid_args', message: 'the final chat message must have role user', retryable: false };
    }
    if (!isObject(task.budget)) {
      throw { code: 'invalid_args', message: 'budget must be an object', retryable: false };
    }

    const maxInputChars = Number(task.budget.maxInputChars);
    const maxOutputTokens = Number(task.budget.maxOutputTokens);
    if (!Number.isSafeInteger(maxInputChars) || maxInputChars <= 0) {
      throw { code: 'invalid_args', message: 'budget.maxInputChars must be a positive integer', retryable: false };
    }
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      throw { code: 'invalid_args', message: 'budget.maxOutputTokens must be a positive integer', retryable: false };
    }

    const tools = normalizeChatFunctionTools(task.tools);
    const toolResults = normalizeChatToolResults(task.toolResults);
    const continuation = normalizeChatContinuation(task.continuation);
    if (toolResults.length && !continuation) {
      throw { code: 'invalid_args', message: 'continuation is required with toolResults', retryable: false };
    }
    const systemInstructionChars = task.systemInstruction.length;
    const messageChars = messages.reduce((total, message) => total + message.content.length, 0);
    const inputChars = systemInstructionChars + messageChars +
      JSON.stringify(tools).length + JSON.stringify(toolResults).length +
      (continuation ? JSON.stringify(continuation).length : 0);
    if (inputChars > maxInputChars) {
      throw {
        code: 'invalid_args',
        message: `chat input must be ${maxInputChars} characters or less`,
        retryable: false,
        maxChars: maxInputChars,
        actualChars: inputChars,
      };
    }

    return {
      id: typeof task.id === 'string' && task.id ? task.id : null,
      messages,
      systemInstruction: task.systemInstruction,
      systemInstructionChars,
      inputChars,
      messageCount: messages.length,
      budget: { maxInputChars, maxOutputTokens },
      thinking: normalizeGeminiThinking(task.thinking),
      tools,
      toolResults,
      continuation,
    };
  }

  function normalizeGeminiThinking(thinking) {
    if (thinking === undefined || thinking === null) return { level: GEMINI_DEFAULT_THINKING_LEVEL };
    if (typeof thinking === 'string') thinking = { level: thinking };
    if (!isObject(thinking)) {
      throw { code: 'invalid_args', message: 'thinking must be a string or object', retryable: false };
    }

    const rawLevel = thinking.level === undefined ? GEMINI_DEFAULT_THINKING_LEVEL : thinking.level;
    if (typeof rawLevel !== 'string') {
      throw { code: 'invalid_args', message: 'thinking.level must be a string', retryable: false };
    }

    const level = rawLevel.trim().toLowerCase();
    if (GEMINI_THINKING_LEVELS.indexOf(level) === -1) {
      throw {
        code: 'invalid_args',
        message: `thinking.level must be one of: ${GEMINI_THINKING_LEVELS.join(', ')}`,
        retryable: false,
      };
    }
    return { level };
  }

  function geminiThinkingFamily(model) {
    const id = String(model || '').trim().toLowerCase().replace(/^models\//, '');
    if (/^gemini-3\.1-pro(?:[.-]|$)/.test(id)) return 'gemini-3-pro';
    if (/^gemini-3(?:[.-]|$)/.test(id)) return 'gemini-3';
    if (/^gemini-2\.5(?:[.-]|$)/.test(id)) return 'gemini-2.5';
    if (/^gemma-4(?:[.-]|$)/.test(id)) return 'gemma-4';
    return 'unknown';
  }

  function geminiThinkingConfigForModel(model, thinking) {
    const level = normalizeGeminiThinking(thinking).level;
    const family = geminiThinkingFamily(model);
    if (family === 'gemini-3' || family === 'gemini-3-pro') {
      const appliedLevel = family === 'gemini-3-pro' && level === 'minimal' ? 'low' : level;
      return {
        config: { thinking_level: appliedLevel },
        appliedLevel,
        appliedBudget: null,
        family,
      };
    }
    if (family === 'gemini-2.5') {
      const appliedLevel = level === 'minimal' ? 'low' : level;
      return {
        config: { thinking_level: appliedLevel },
        appliedLevel,
        appliedBudget: null,
        family,
      };
    }
    // Gemma 4 exposes thinking as an on/off toggle in the Gemini API:
    // omit the Interactions setting for off, or send thinking_level: "high" for on.
    if (family === 'gemma-4' && level !== 'minimal') {
      return {
        config: { thinking_level: 'high' },
        appliedLevel: 'high',
        appliedBudget: null,
        family,
        toggle: true,
      };
    }
    return {
      config: null,
      appliedLevel: null,
      appliedBudget: null,
      family,
    };
  }

  function geminiPayload(task, model) {
    const payload = {
      model,
      input: task.prompt,
      store: false,
    };

    if (task.output.type === 'json') {
      payload.response_format = {
        type: 'text',
        mime_type: 'application/json',
        schema: task.output.schema,
      };
    }

    const thinking = geminiThinkingConfigForModel(model, task.thinking);
    if (thinking.config) payload.generation_config = thinking.config;

    return { payload, thinking };
  }

  function geminiChatPayload(task, model) {
    const thinking = geminiThinkingConfigForModel(model, task.thinking);
    const generationConfig = {
      max_output_tokens: task.budget.maxOutputTokens,
    };
    if (thinking.config) Object.assign(generationConfig, thinking.config);

    const continuationSteps = [];
    if (task.continuation) {
      if (task.continuation.provider !== 'gemini' || !Array.isArray(task.continuation.steps)) {
        throw { code: 'invalid_args', message: 'Gemini continuation state is invalid.', retryable: false };
      }
      continuationSteps.push(...cloneJson(task.continuation.steps));
    }
    for (const result of task.toolResults) {
      continuationSteps.push({
        type: 'function_result',
        name: result.name,
        call_id: result.callId,
        is_error: result.isError === true,
        result: [{ type: 'text', text: JSON.stringify(result.result) }],
      });
    }

    const input = task.messages.map(message => ({
      type: message.role === 'user' ? 'user_input' : 'model_output',
      content: [{ type: 'text', text: message.content }],
    }));
    input.push(...continuationSteps);

    const payload = {
      model,
      input,
      system_instruction: task.systemInstruction,
      generation_config: generationConfig,
      stream: true,
      store: false,
    };
    if (task.tools.length) {
      payload.tools = task.tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }

    return {
      payload,
      thinking,
      continuationSteps,
    };
  }

  function geminiThinkingMeta(task, model, thinking, options = {}) {
    const requestedLevel = normalizeGeminiThinking(task.thinking).level;
    const meta = {
      requestedLevel,
      applied: !!thinking?.config,
      family: thinking?.family || geminiThinkingFamily(model),
      defaulted: requestedLevel === GEMINI_DEFAULT_THINKING_LEVEL,
    };
    if (thinking?.appliedLevel) meta.appliedLevel = thinking.appliedLevel;
    if (Number.isFinite(thinking?.appliedBudget)) meta.appliedBudget = thinking.appliedBudget;
    if (thinking?.toggle) meta.toggle = true;
    if (options.fallbackReason) meta.fallbackReason = options.fallbackReason;
    return meta;
  }

  function geminiProviderReason(value) {
    const candidates = [];
    const collect = (candidate) => {
      if (typeof candidate === 'string' && candidate.trim()) candidates.push(candidate.trim());
    };
    collect(value?.error?.code);
    collect(value?.error?.status);
    collect(value?.error?.message);
    collect(value?.blockReason);
    collect(value?.block_reason);
    collect(value?.finishReason);
    collect(value?.finish_reason);
    collect(value?.incomplete_details?.reason);
    collect(value?.status);
    const steps = Array.isArray(value?.steps) ? value.steps : [];
    for (const step of steps) {
      collect(step?.error?.code);
      collect(step?.error?.message);
      collect(step?.block_reason);
      collect(step?.finish_reason);
      collect(step?.status);
    }
    const joined = candidates.join(' | ');
    if (/PROHIBITED_CONTENT/i.test(joined)) return 'PROHIBITED_CONTENT';
    if (/(^|\W)SAFETY($|\W)|SAFETY_FILTER|CONTENT_FILTER/i.test(joined)) return 'SAFETY';
    return candidates[0] || null;
  }

  function geminiBlockedError(reason, detail, model) {
    const prohibited = reason === 'PROHIBITED_CONTENT';
    return {
      code: prohibited ? 'prohibited_content' : 'safety_blocked',
      message: prohibited
        ? 'Gemini rejected the request under a non-adjustable content policy.'
        : 'Gemini blocked the request with an adjustable safety filter.',
      retryable: false,
      backend: 'gemini',
      providerReason: reason,
      detail: detail || reason,
      model,
    };
  }

  function geminiHttpError(status, statusText, bodyText) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText || '{}'); } catch { parsed = null; }
    const providerMessage = parsed?.error?.message || statusText || `HTTP ${status}`;
    const providerReason = geminiProviderReason(parsed);
    const base = {
      status,
      statusText,
      backend: 'gemini',
      detail: providerMessage,
    };

    if (providerReason === 'PROHIBITED_CONTENT' || providerReason === 'SAFETY') {
      return { ...base, ...geminiBlockedError(providerReason, providerMessage) };
    }

    if (status === 401 || status === 403) {
      return { ...base, code: 'auth_failed', message: 'Gemini API key was rejected.', retryable: false };
    }
    if (status === 429) {
      return { ...base, code: 'rate_limit', message: 'Gemini rate limit reached.', retryable: true };
    }
    if (status >= 500) {
      return { ...base, code: 'backend_failed', message: 'Gemini service failed.', retryable: true };
    }
    if (status === 400) {
      return { ...base, code: 'invalid_args', message: providerMessage, retryable: false };
    }
    return { ...base, code: 'backend_failed', message: providerMessage, retryable: status >= 500 };
  }

  function extractGeminiText(data, model) {
    const steps = Array.isArray(data?.steps) ? data.steps : [];
    const outputSteps = steps.filter(step => step?.type === 'model_output');
    const lastOutput = outputSteps[outputSteps.length - 1] || null;
    const content = Array.isArray(lastOutput?.content) ? lastOutput.content : [];
    const text = content
      .map(part => (part?.type === 'text' && typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('');

    if (!text) {
      const providerReason = geminiProviderReason(data);
      if (providerReason === 'PROHIBITED_CONTENT' || providerReason === 'SAFETY') {
        throw geminiBlockedError(providerReason, data?.error?.message, model);
      }
      throw {
        code: 'invalid_response',
        message: providerReason
          ? `Gemini returned no text output (${providerReason}).`
          : 'Gemini returned no model output text.',
        retryable: false,
        backend: 'gemini',
        providerReason,
        model,
      };
    }

    return text;
  }

  function geminiStreamError(event, model) {
    const providerReason = geminiProviderReason(event);
    const providerCode = String(event?.error?.code || providerReason || '').trim();
    const providerMessage = event?.error?.message || providerReason || 'Gemini stream failed.';
    if (providerReason === 'PROHIBITED_CONTENT' || providerReason === 'SAFETY') {
      return geminiBlockedError(providerReason, providerMessage, model);
    }
    if (providerCode === '429' || /RESOURCE_EXHAUSTED|RATE_LIMIT|TOO_MANY_REQUESTS/i.test(providerCode)) {
      return {
        code: 'rate_limit',
        message: 'Gemini rate limit reached.',
        retryable: true,
        backend: 'gemini',
        detail: providerMessage,
        model,
      };
    }
    if (providerCode === '401' || providerCode === '403' || /UNAUTHENTICATED|PERMISSION_DENIED|API_KEY/i.test(providerCode)) {
      return {
        code: 'auth_failed',
        message: 'Gemini API key was rejected.',
        retryable: false,
        backend: 'gemini',
        detail: providerMessage,
        model,
      };
    }
    if (/DEADLINE|GATEWAY_TIMEOUT|TIMEOUT/i.test(providerCode)) {
      return {
        code: 'timeout',
        message: providerMessage,
        retryable: true,
        backend: 'gemini',
        detail: providerMessage,
        model,
      };
    }
    if (providerCode === '400' || /INVALID_ARGUMENT|BAD_REQUEST/i.test(providerCode)) {
      return {
        code: 'invalid_args',
        message: providerMessage,
        retryable: false,
        backend: 'gemini',
        detail: providerMessage,
        model,
      };
    }
    return {
      code: 'backend_failed',
      message: providerMessage,
      retryable: true,
      backend: 'gemini',
      detail: providerMessage,
      model,
    };
  }

  function takeSseFrame(buffer) {
    const match = /(?:\r\n|\r|\n){2}/.exec(buffer);
    if (!match) return null;
    return {
      frame: buffer.slice(0, match.index),
      rest: buffer.slice(match.index + match[0].length),
    };
  }

  function parseSseFrame(frame) {
    const data = String(frame || '')
      .split(/\r\n|\r|\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return null;
    if (data.trim() === '[DONE]') return { done: true, event: null };
    try {
      return { done: false, event: JSON.parse(data) };
    } catch (err) {
      throw {
        code: 'invalid_response',
        message: 'Gemini returned an invalid streaming event.',
        retryable: false,
        backend: 'gemini',
        detail: err?.message || 'invalid_stream_json',
      };
    }
  }

  async function readGeminiInteractionStream(response, model, onDelta) {
    if (!response?.body?.getReader) {
      throw {
        code: 'invalid_response',
        message: 'Gemini did not return a readable stream.',
        retryable: false,
        backend: 'gemini',
        model,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const stepTypes = new Map();
    const streamedSteps = new Map();
    const streamedArgumentText = new Map();
    let buffer = '';
    let text = '';
    let sequence = 0;
    let completedInteraction = null;
    let providerModel = model;
    let interactionId = null;
    let observedProviderReason = null;
    let sawDone = false;
    let streamFinished = false;

    const emitText = (value) => {
      if (typeof value !== 'string' || !value) return;
      text += value;
      sequence += 1;
      onDelta(value, sequence);
    };

    const appendTextContent = (blocks, value) => {
      if (!Array.isArray(blocks) || typeof value !== 'string' || !value) return;
      const last = blocks[blocks.length - 1];
      if (last?.type === 'text' && typeof last.text === 'string') last.text += value;
      else blocks.push({ type: 'text', text: value });
    };

    const handleEvent = (event) => {
      if (!event || typeof event !== 'object') return;
      const eventType = String(event.event_type || event.type || '');
      const eventReason = geminiProviderReason(event);
      if (eventReason) observedProviderReason = eventReason;

      if (eventType === 'error') throw geminiStreamError(event, model);
      if (eventType === 'interaction.created') {
        interactionId = typeof event?.interaction?.id === 'string' ? event.interaction.id : interactionId;
        providerModel = typeof event?.interaction?.model === 'string' ? event.interaction.model : providerModel;
        return;
      }
      if (eventType === 'step.start') {
        if (Number.isSafeInteger(event.index) && typeof event?.step?.type === 'string') {
          const step = cloneJson(event.step);
          stepTypes.set(event.index, step.type);
          streamedSteps.set(event.index, step);
          if (step.type === 'function_call' && typeof step.arguments === 'string') {
            streamedArgumentText.set(event.index, step.arguments);
          }
          if (step.type === 'model_output' && Array.isArray(step.content)) {
            for (const block of step.content) {
              if (block?.type === 'text') emitText(block.text);
            }
          }
        }
        return;
      }
      if (eventType === 'step.stop') {
        if (Number.isSafeInteger(event.index)) stepTypes.delete(event.index);
        return;
      }
      if (eventType === 'step.delta') {
        const stepType = stepTypes.get(event.index);
        const step = streamedSteps.get(event.index);
        if (stepType === 'function_call') {
          const argumentChunk = typeof event?.delta?.partial_arguments === 'string'
            ? event.delta.partial_arguments
            : (typeof event?.delta?.arguments === 'string' ? event.delta.arguments : '');
          if (
            argumentChunk &&
            (event?.delta?.type === 'arguments' || event?.delta?.type === 'arguments_delta')
          ) {
            streamedArgumentText.set(
              event.index,
              `${streamedArgumentText.get(event.index) || ''}${argumentChunk}`
            );
          }
          return;
        }
        if (stepType === 'thought' && step) {
          if (event?.delta?.type === 'thought_signature' && typeof event.delta.signature === 'string') {
            step.signature = event.delta.signature;
          } else if (event?.delta?.type === 'thought_summary' && event.delta.content) {
            if (!Array.isArray(step.summary)) step.summary = [];
            const content = cloneJson(event.delta.content);
            if (content?.type === 'text' && typeof content.text === 'string') {
              appendTextContent(step.summary, content.text);
            } else if (content) {
              step.summary.push(content);
            }
          }
          return;
        }
        if (stepType === 'model_output' && step && event?.delta?.type === 'text') {
          if (!Array.isArray(step.content)) step.content = [];
          appendTextContent(step.content, event.delta.text);
          emitText(event.delta.text);
        }
        return;
      }
      if (eventType === 'interaction.completed') {
        completedInteraction = isObject(event.interaction) ? event.interaction : {};
        interactionId = typeof completedInteraction.id === 'string' ? completedInteraction.id : interactionId;
        providerModel = typeof completedInteraction.model === 'string'
          ? completedInteraction.model
          : providerModel;
      }
    };

    const drainFrames = (flush = false) => {
      let next;
      while ((next = takeSseFrame(buffer))) {
        buffer = next.rest;
        const parsed = parseSseFrame(next.frame);
        if (!parsed) continue;
        if (parsed.done) {
          sawDone = true;
          continue;
        }
        handleEvent(parsed.event);
      }
      if (flush && buffer.trim()) {
        const parsed = parseSseFrame(buffer);
        buffer = '';
        if (parsed?.done) sawDone = true;
        else if (parsed?.event) handleEvent(parsed.event);
      }
    };

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        drainFrames();
      }
      buffer += decoder.decode();
      drainFrames(true);
      streamFinished = true;
    } finally {
      if (!streamFinished) {
        try { await reader.cancel(); } catch { /* noop */ }
      }
      try { reader.releaseLock(); } catch { /* noop */ }
    }

    if (!completedInteraction) {
      throw {
        code: 'invalid_response',
        message: sawDone
          ? 'Gemini ended the stream without a completion event.'
          : 'Gemini stream closed before completion.',
        retryable: true,
        backend: 'gemini',
        model,
      };
    }

    const completedSteps = Array.isArray(completedInteraction.steps) && completedInteraction.steps.length
      ? cloneJson(completedInteraction.steps)
      : Array.from(streamedSteps.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([index, step]) => {
          const out = cloneJson(step);
          const argumentText = streamedArgumentText.get(index);
          if (out?.type === 'function_call' && typeof argumentText === 'string' && argumentText) {
            out.arguments = argumentText;
          }
          return out;
        });
    const functionSteps = completedSteps.filter(step => step?.type === 'function_call');
    const rawFunctionCalls = functionSteps.length
      ? functionSteps.map(step => ({
        id: step.id,
        name: step.name,
        arguments: step.arguments,
        argumentText: typeof step.arguments === 'string' ? step.arguments : '',
      }))
      : [];
    const toolCalls = rawFunctionCalls.map((call, index) => {
      let args = isObject(call.arguments) ? cloneJson(call.arguments) : null;
      if (!args) {
        try { args = JSON.parse(call.argumentText || '{}'); } catch (error) {
          throw {
            code: 'invalid_response',
            message: `Gemini returned invalid arguments for tool call ${index + 1}.`,
            retryable: false,
            backend: 'gemini',
            detail: error?.message || 'invalid_tool_arguments',
            model,
          };
        }
      }
      if (typeof call.id !== 'string' || !call.id || typeof call.name !== 'string' || !call.name || !isObject(args)) {
        throw {
          code: 'invalid_response',
          message: 'Gemini returned a malformed function call.',
          retryable: false,
          backend: 'gemini',
          model,
        };
      }
      return { id: call.id, name: call.name, arguments: args };
    });

    if (
      completedInteraction.status &&
      completedInteraction.status !== 'completed' &&
      !(completedInteraction.status === 'requires_action' && toolCalls.length)
    ) {
      throw geminiStreamError({
        error: completedInteraction.error,
        status: completedInteraction.status,
        incomplete_details: completedInteraction.incomplete_details,
      }, model);
    }
    if (observedProviderReason === 'PROHIBITED_CONTENT' || observedProviderReason === 'SAFETY') {
      throw geminiBlockedError(observedProviderReason, observedProviderReason, model);
    }
    if (!text && !toolCalls.length) {
      throw {
        code: 'invalid_response',
        message: observedProviderReason
          ? `Gemini returned no text output (${observedProviderReason}).`
          : 'Gemini returned no model output text.',
        retryable: false,
        backend: 'gemini',
        providerReason: observedProviderReason,
        model,
      };
    }
    if (toolCalls.length && !completedSteps.length) {
      throw {
        code: 'invalid_response',
        message: 'Gemini returned tool calls without the continuation steps required for a stateless follow-up.',
        retryable: false,
        backend: 'gemini',
        model,
      };
    }

    const continuationSteps = completedSteps.map(step => {
      if (step?.type !== 'function_call') return step;
      const call = toolCalls.find(candidate => candidate.id === step.id);
      return call ? { ...step, arguments: cloneJson(call.arguments) } : step;
    });
    if (
      toolCalls.length &&
      continuationSteps.some(step => step?.type === 'thought' && !String(step.signature || '').trim())
    ) {
      throw {
        code: 'invalid_response',
        message: 'Gemini omitted a thought signature required for a stateless tool follow-up.',
        retryable: false,
        backend: 'gemini',
        model,
      };
    }

    return {
      text,
      toolCalls,
      steps: continuationSteps,
      interactionId,
      providerModel,
      usage: completedInteraction.usage || null,
    };
  }

  async function callGeminiInteraction(settings, task) {
    if (!settings.keyConfigured) {
      throw {
        code: 'not_configured',
        message: 'No Gemini API key is configured.',
        retryable: false,
        backend: 'gemini',
      };
    }

    const models = geminiQueryModels(settings);
    let lastError = null;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const currentModel = models[modelIndex];
      const url = 'https://generativelanguage.googleapis.com/v1/interactions';
      const payloadInfo = geminiPayload(task, currentModel);

      try {
        const { response, bodyText } = await withPrivilegedNetworkLock(async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), GEMINI_DEFAULT_TIMEOUT_MS);
          try {
            const lockedResponse = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': settings.apiKey,
              },
              body: JSON.stringify(payloadInfo.payload),
              credentials: 'omit',
              cache: 'no-store',
              signal: controller.signal,
            });
            return { response: lockedResponse, bodyText: await lockedResponse.text() };
          } finally {
            clearTimeout(timer);
          }
        });
        if (!response.ok) {
          const err = geminiHttpError(response.status, response.statusText, bodyText);
          const retryAfter = response.headers.get('retry-after');
          if (retryAfter) {
            const seconds = Number(retryAfter);
            if (Number.isFinite(seconds)) err.retryAfterMs = Math.max(0, seconds * 1000);
          }
          err.model = currentModel;
          if (
            err.code === 'rate_limit' &&
            settings?.modelMode !== 'manual' &&
            modelIndex + 1 < models.length
          ) {
            lastError = err;
            continue;
          }
          throw err;
        }

        let data = null;
        try {
          data = JSON.parse(bodyText || '{}');
        } catch (err) {
          throw {
            code: 'invalid_response',
            message: 'Gemini returned invalid JSON.',
            retryable: false,
            backend: 'gemini',
            detail: err?.message || 'invalid_json',
            model: currentModel,
          };
        }

        const text = extractGeminiText(data, currentModel);
        const base = {
          backend: 'gemini',
          generatedAtIso: new Date().toISOString(),
          model: currentModel,
          providerModel: data?.model || currentModel,
          interactionId: typeof data?.id === 'string' ? data.id : null,
          usage: data?.usage || null,
          status: geminiStatus(settings, currentModel),
          thinking: geminiThinkingMeta(task, currentModel, payloadInfo.thinking),
          fallback: {
            mode: settings?.modelMode || GEMINI_DEFAULT_MODEL_MODE,
            attemptedModels: models.slice(0, modelIndex + 1),
          },
        };
        geminiRememberSuccess(base);

        if (task.output.type === 'json') {
          try {
            return { ...base, json: JSON.parse(text), text };
          } catch (err) {
            throw {
              code: 'invalid_response',
              message: 'Gemini returned invalid JSON text.',
              retryable: false,
              backend: 'gemini',
              detail: err?.message || 'invalid_json',
              model: currentModel,
            };
          }
        }

        return { ...base, text };
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw {
            code: 'timeout',
            message: `Gemini query timed out after ${GEMINI_DEFAULT_TIMEOUT_MS} ms.`,
            retryable: true,
            backend: 'gemini',
            model: currentModel,
          };
        }
        if (err?.code) throw err;
        throw {
          code: 'backend_failed',
          message: err?.message || 'Gemini request failed.',
          retryable: true,
          backend: 'gemini',
          model: currentModel,
        };
      }
    }

    throw lastError || {
      code: 'rate_limit',
      message: 'Gemini rate limit reached.',
      retryable: true,
      backend: 'gemini',
    };
  }

  function geminiAbortError(model) {
    return {
      code: 'aborted',
      message: 'AI chat request was aborted.',
      retryable: false,
      backend: 'gemini',
      model,
    };
  }

  function abortException() {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  }

  async function callGeminiChatStream(settings, task, session, onDelta) {
    if (!settings.keyConfigured) {
      throw {
        code: 'not_configured',
        message: 'No Gemini API key is configured.',
        retryable: false,
        backend: 'gemini',
      };
    }

    const models = geminiQueryModels(settings);
    let lastError = null;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const currentModel = models[modelIndex];
      const url = 'https://generativelanguage.googleapis.com/v1/interactions';
      const payloadInfo = geminiChatPayload(task, currentModel);
      let timedOut = false;

      try {
        const attempt = await withPrivilegedNetworkLock(async () => {
          if (session.controller.signal.aborted) throw abortException();
          const timer = setTimeout(() => {
            timedOut = true;
            if (!session.abortReason) session.abortReason = 'timeout';
            session.controller.abort();
          }, GEMINI_DEFAULT_TIMEOUT_MS);
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': settings.apiKey,
              },
              body: JSON.stringify(payloadInfo.payload),
              credentials: 'omit',
              cache: 'no-store',
              signal: session.controller.signal,
            });
            if (!response.ok) {
              return { response, bodyText: await response.text(), streamResult: null };
            }
            const streamResult = await readGeminiInteractionStream(response, currentModel, onDelta);
            return { response, bodyText: null, streamResult };
          } finally {
            clearTimeout(timer);
          }
        });

        if (!attempt.response.ok) {
          const err = geminiHttpError(
            attempt.response.status,
            attempt.response.statusText,
            attempt.bodyText,
          );
          const retryAfter = attempt.response.headers.get('retry-after');
          if (retryAfter) {
            const seconds = Number(retryAfter);
            if (Number.isFinite(seconds)) err.retryAfterMs = Math.max(0, seconds * 1000);
          }
          err.model = currentModel;
          if (
            err.code === 'rate_limit' &&
            settings?.modelMode !== 'manual' &&
            modelIndex + 1 < models.length
          ) {
            lastError = err;
            continue;
          }
          throw err;
        }

        const streamResult = attempt.streamResult;
        const base = {
          backend: 'gemini',
          generatedAtIso: new Date().toISOString(),
          model: currentModel,
          providerModel: streamResult.providerModel || currentModel,
          interactionId: streamResult.interactionId || null,
          usage: streamResult.usage || null,
          status: geminiStatus(settings, currentModel),
          thinking: geminiThinkingMeta(task, currentModel, payloadInfo.thinking),
          fallback: {
            mode: settings?.modelMode || GEMINI_DEFAULT_MODEL_MODE,
            attemptedModels: models.slice(0, modelIndex + 1),
          },
          text: streamResult.text,
          toolCalls: streamResult.toolCalls,
          continuation: streamResult.toolCalls.length ? {
            provider: 'gemini',
            steps: [
              ...payloadInfo.continuationSteps,
              ...streamResult.steps,
            ],
          } : null,
        };
        geminiRememberSuccess(base);
        return base;
      } catch (err) {
        if (err?.name === 'AbortError' || session.controller.signal.aborted) {
          if (timedOut || session.abortReason === 'timeout') {
            throw {
              code: 'timeout',
              message: `Gemini chat timed out after ${GEMINI_DEFAULT_TIMEOUT_MS} ms.`,
              retryable: true,
              backend: 'gemini',
              model: currentModel,
            };
          }
          throw geminiAbortError(currentModel);
        }
        if (err?.code) throw err;
        throw {
          code: 'backend_failed',
          message: err?.message || 'Gemini chat request failed.',
          retryable: true,
          backend: 'gemini',
          model: currentModel,
        };
      }
    }

    throw lastError || {
      code: 'rate_limit',
      message: 'Gemini rate limit reached.',
      retryable: true,
      backend: 'gemini',
    };
  }

  async function handleGemini(request = {}) {
    const op = String(request.op || '').trim();
    if (op === 'settings:set') {
      const next = {};
      if (request.apiKey !== undefined) {
        next[GEMINI_STORAGE_KEYS.apiKey] = String(request.apiKey || '').trim();
      }
      if (request.model !== undefined) {
        next[GEMINI_STORAGE_KEYS.model] = normalizeGeminiModel(request.model);
      }
      if (request.modelMode !== undefined) {
        next[GEMINI_STORAGE_KEYS.modelMode] = normalizeGeminiModelMode(request.modelMode);
      }
      await storageSet('local', next);
      geminiResetRuntimeState();
      return geminiStatus(await getGeminiSettings());
    }

    const settings = await getGeminiSettings();
    if (op === 'status') return geminiStatus(settings);
    if (op === 'test') {
      const task = normalizeGeminiTask({
        id: 'popup-test',
        prompt: 'Reply with exactly: BetterDungeon Gemini ready',
        output: { type: 'text' },
      });
      return callGeminiInteraction(settings, task);
    }
    if (op === 'query') {
      const task = normalizeGeminiTask(request.task);
      return callGeminiInteraction(settings, task);
    }

    throw { code: 'invalid_args', message: `Gemini op '${op || '(empty)'}' is not supported`, retryable: false };
  }

  function normalizeOpenAiBaseUrl(value) {
    let url = String(value || '').trim();
    if (!url) return '';
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/chat\/completions$/, '');
    if (!/^https?:\/\//i.test(url)) return '';
    return url;
  }

  function normalizeOpenAiModel(value) {
    return String(value || '').trim();
  }

  async function getOpenAiSettings() {
    const local = await storageGet('local', Object.values(OPENAI_STORAGE_KEYS));
    const baseUrl = normalizeOpenAiBaseUrl(local[OPENAI_STORAGE_KEYS.baseUrl]);
    const apiKey = String(local[OPENAI_STORAGE_KEYS.apiKey] || '').trim();
    const model = normalizeOpenAiModel(local[OPENAI_STORAGE_KEYS.model]);
    return {
      baseUrl,
      apiKey,
      model,
      keyConfigured: !!apiKey,
      configured: !!(baseUrl && model),
    };
  }

  function openaiRememberSuccess(result) {
    openaiRuntimeState.lastModel = typeof result?.model === 'string' ? result.model : null;
    openaiRuntimeState.lastResolvedAtIso =
      typeof result?.generatedAtIso === 'string' ? result.generatedAtIso : new Date().toISOString();
  }

  function openaiResetRuntimeState() {
    openaiRuntimeState.lastModel = null;
    openaiRuntimeState.lastResolvedAtIso = null;
  }

  function openaiStatus(settings) {
    const ready = !!settings?.configured;
    return {
      backend: 'openai',
      backendLabel: 'OpenAI-Compatible',
      ready,
      available: ready,
      reason: ready ? null : 'ai_backend_not_configured',
      supports: { text: true, json: true, thinking: false },
      config: {
        provider: 'openai',
        api: 'chat-completions',
        stateless: true,
        keyConfigured: !!settings?.keyConfigured,
        baseUrl: settings?.baseUrl || '',
        baseUrlConfigured: !!settings?.baseUrl,
        model: settings?.model || '',
        selectedModel: settings?.model || '',
        activeModel: openaiRuntimeState.lastModel,
        lastResolvedModel: openaiRuntimeState.lastModel,
        lastResolvedAtIso: openaiRuntimeState.lastResolvedAtIso,
      },
      message: ready
        ? 'OpenAI-compatible backend is configured.'
        : 'Add a base URL and model in BetterDungeon to enable the OpenAI-compatible backend.',
    };
  }

  function openaiJsonSchemaInstruction(schema) {
    return `Respond with a single JSON object that conforms to this JSON schema. Output only the JSON object with no surrounding prose or code fences.\nSchema: ${JSON.stringify(schema)}`;
  }

  function openaiPayload(task, model) {
    const messages = [];
    if (task.output.type === 'json' && task.output.schema) {
      messages.push({ role: 'system', content: openaiJsonSchemaInstruction(task.output.schema) });
    }
    messages.push({ role: 'user', content: task.prompt });

    const payload = { model, messages, stream: false };
    if (task.output.type === 'json') {
      payload.response_format = { type: 'json_object' };
    }
    return { payload };
  }

  function openaiChatPayload(task, model) {
    const continuationMessages = [];
    if (task.continuation) {
      if (task.continuation.provider !== 'openai' || !Array.isArray(task.continuation.messages)) {
        throw { code: 'invalid_args', message: 'OpenAI continuation state is invalid.', retryable: false };
      }
      continuationMessages.push(...cloneJson(task.continuation.messages));
    }
    for (const result of task.toolResults) {
      continuationMessages.push({
        role: 'tool',
        tool_call_id: result.callId,
        name: result.name,
        content: JSON.stringify(result.result),
      });
    }
    const payload = {
      model,
      messages: [
        { role: 'system', content: task.systemInstruction },
        ...task.messages.map(message => ({ role: message.role, content: message.content })),
        ...continuationMessages,
      ],
      max_tokens: task.budget.maxOutputTokens,
      stream: true,
    };
    if (task.tools.length) {
      payload.tools = task.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      payload.tool_choice = 'auto';
    }
    return {
      payload,
      continuationMessages,
    };
  }

  function openaiBlockedError(detail, model) {
    return {
      code: 'safety_blocked',
      message: 'The OpenAI-compatible provider blocked the request with a content filter.',
      retryable: false,
      backend: 'openai',
      providerReason: 'content_filter',
      detail: detail || 'content_filter',
      model,
    };
  }

  function openaiHttpError(status, statusText, bodyText, model) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText || '{}'); } catch { parsed = null; }
    const providerMessage =
      parsed?.error?.message ||
      (typeof parsed?.error === 'string' ? parsed.error : null) ||
      statusText ||
      `HTTP ${status}`;
    const base = {
      status,
      statusText,
      backend: 'openai',
      detail: providerMessage,
      model,
    };

    if (/content_filter|content management policy/i.test(providerMessage)) {
      return { ...base, ...openaiBlockedError(providerMessage, model) };
    }
    if (status === 401 || status === 403) {
      return { ...base, code: 'auth_failed', message: 'OpenAI-compatible API key was rejected.', retryable: false };
    }
    if (status === 404) {
      return { ...base, code: 'invalid_args', message: `Endpoint or model not found: ${providerMessage}`, retryable: false };
    }
    if (status === 429) {
      return { ...base, code: 'rate_limit', message: 'OpenAI-compatible rate limit reached.', retryable: true };
    }
    if (status >= 500) {
      return { ...base, code: 'backend_failed', message: 'OpenAI-compatible service failed.', retryable: true };
    }
    if (status === 400) {
      return { ...base, code: 'invalid_args', message: providerMessage, retryable: false };
    }
    return { ...base, code: 'backend_failed', message: providerMessage, retryable: status >= 500 };
  }

  function openaiNotConfiguredError() {
    return {
      code: 'not_configured',
      message: 'The OpenAI-compatible backend needs a base URL and model.',
      retryable: false,
      backend: 'openai',
    };
  }

  function openaiRequestHeaders(settings) {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    return headers;
  }

  function extractOpenAiText(data, model) {
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    if (choice?.finish_reason === 'content_filter') {
      throw openaiBlockedError(choice?.finish_reason, model);
    }
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!text) {
      throw {
        code: 'invalid_response',
        message: 'OpenAI-compatible provider returned no message content.',
        retryable: false,
        backend: 'openai',
        model,
      };
    }
    return text;
  }

  async function callOpenAiChatCompletion(settings, task) {
    if (!settings.configured) throw openaiNotConfiguredError();

    const model = settings.model;
    const url = `${settings.baseUrl}/chat/completions`;
    const payloadInfo = openaiPayload(task, model);

    try {
      const { response, bodyText } = await withPrivilegedNetworkLock(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GEMINI_DEFAULT_TIMEOUT_MS);
        try {
          const lockedResponse = await fetch(url, {
            method: 'POST',
            headers: openaiRequestHeaders(settings),
            body: JSON.stringify(payloadInfo.payload),
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
          });
          return { response: lockedResponse, bodyText: await lockedResponse.text() };
        } finally {
          clearTimeout(timer);
        }
      });

      if (!response.ok) {
        const err = openaiHttpError(response.status, response.statusText, bodyText, model);
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          if (Number.isFinite(seconds)) err.retryAfterMs = Math.max(0, seconds * 1000);
        }
        throw err;
      }

      let data = null;
      try {
        data = JSON.parse(bodyText || '{}');
      } catch (err) {
        throw {
          code: 'invalid_response',
          message: 'OpenAI-compatible provider returned invalid JSON.',
          retryable: false,
          backend: 'openai',
          detail: err?.message || 'invalid_json',
          model,
        };
      }

      const text = extractOpenAiText(data, model);
      const base = {
        backend: 'openai',
        generatedAtIso: new Date().toISOString(),
        model,
        providerModel: data?.model || model,
        usage: data?.usage || null,
      };
      openaiRememberSuccess(base);
      base.status = openaiStatus(settings);

      if (task.output.type === 'json') {
        try {
          return { ...base, json: JSON.parse(text), text };
        } catch (err) {
          throw {
            code: 'invalid_response',
            message: 'OpenAI-compatible provider returned invalid JSON text.',
            retryable: false,
            backend: 'openai',
            detail: err?.message || 'invalid_json',
            model,
          };
        }
      }

      return { ...base, text };
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw {
          code: 'timeout',
          message: `OpenAI-compatible query timed out after ${GEMINI_DEFAULT_TIMEOUT_MS} ms.`,
          retryable: true,
          backend: 'openai',
          model,
        };
      }
      if (err?.code) throw err;
      throw {
        code: 'backend_failed',
        message: err?.message || 'OpenAI-compatible request failed.',
        retryable: true,
        backend: 'openai',
        model,
      };
    }
  }

  async function readOpenAiChatStream(response, model, onDelta) {
    if (!response?.body?.getReader) {
      throw {
        code: 'invalid_response',
        message: 'OpenAI-compatible provider did not return a readable stream.',
        retryable: false,
        backend: 'openai',
        model,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let sequence = 0;
    let providerModel = model;
    let usage = null;
    let finishReason = null;
    const toolCallParts = new Map();
    let sawDone = false;
    let streamFinished = false;

    const handleEvent = (event) => {
      if (!event || typeof event !== 'object') return;
      if (event.error) {
        const providerMessage = event.error?.message || 'OpenAI-compatible stream failed.';
        throw {
          code: 'backend_failed',
          message: providerMessage,
          retryable: true,
          backend: 'openai',
          detail: providerMessage,
          model,
        };
      }
      if (typeof event.model === 'string' && event.model) providerModel = event.model;
      if (event.usage && typeof event.usage === 'object') usage = event.usage;
      const choice = Array.isArray(event.choices) ? event.choices[0] : null;
      if (!choice) return;
      if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const deltaToolCalls = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
      deltaToolCalls.forEach((part, order) => {
        const index = Number.isSafeInteger(part?.index) ? part.index : order;
        const current = toolCallParts.get(index) || { id: '', name: '', arguments: '' };
        if (typeof part?.id === 'string' && part.id) current.id = part.id;
        if (typeof part?.function?.name === 'string') current.name += part.function.name;
        if (typeof part?.function?.arguments === 'string') current.arguments += part.function.arguments;
        toolCallParts.set(index, current);
      });
      const delta = typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
      if (delta) {
        text += delta;
        sequence += 1;
        onDelta(delta, sequence);
      }
    };

    const drainFrames = (flush = false) => {
      let next;
      while ((next = takeSseFrame(buffer))) {
        buffer = next.rest;
        const parsed = parseSseFrame(next.frame);
        if (!parsed) continue;
        if (parsed.done) {
          sawDone = true;
          continue;
        }
        handleEvent(parsed.event);
      }
      if (flush && buffer.trim()) {
        const parsed = parseSseFrame(buffer);
        buffer = '';
        if (parsed?.done) sawDone = true;
        else if (parsed?.event) handleEvent(parsed.event);
      }
    };

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        drainFrames();
      }
      buffer += decoder.decode();
      drainFrames(true);
      streamFinished = true;
    } finally {
      if (!streamFinished) {
        try { await reader.cancel(); } catch { /* noop */ }
      }
      try { reader.releaseLock(); } catch { /* noop */ }
    }

    if (finishReason === 'content_filter') {
      throw openaiBlockedError(finishReason, model);
    }
    const toolCalls = Array.from(toolCallParts.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, call], index) => {
        let args;
        try { args = JSON.parse(call.arguments || '{}'); } catch (error) {
          throw {
            code: 'invalid_response',
            message: `OpenAI-compatible provider returned invalid arguments for tool call ${index + 1}.`,
            retryable: false,
            backend: 'openai',
            detail: error?.message || 'invalid_tool_arguments',
            model,
          };
        }
        if (!call.id || !call.name || !isObject(args)) {
          throw {
            code: 'invalid_response',
            message: 'OpenAI-compatible provider returned a malformed tool call.',
            retryable: false,
            backend: 'openai',
            model,
          };
        }
        return { id: call.id, name: call.name, arguments: args };
      });
    if (!text && !toolCalls.length) {
      throw {
        code: 'invalid_response',
        message: sawDone
          ? 'OpenAI-compatible provider returned no streamed text.'
          : 'OpenAI-compatible stream closed before completion.',
        retryable: !sawDone,
        backend: 'openai',
        model,
      };
    }

    return { text, toolCalls, providerModel, usage, finishReason };
  }

  async function callOpenAiChatStream(settings, task, session, onDelta) {
    if (!settings.configured) throw openaiNotConfiguredError();

    const model = settings.model;
    const url = `${settings.baseUrl}/chat/completions`;
    const payloadInfo = openaiChatPayload(task, model);
    let timedOut = false;

    try {
      const attempt = await withPrivilegedNetworkLock(async () => {
        if (session.controller.signal.aborted) throw abortException();
        const timer = setTimeout(() => {
          timedOut = true;
          if (!session.abortReason) session.abortReason = 'timeout';
          session.controller.abort();
        }, GEMINI_DEFAULT_TIMEOUT_MS);
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: openaiRequestHeaders(settings),
            body: JSON.stringify(payloadInfo.payload),
            credentials: 'omit',
            cache: 'no-store',
            signal: session.controller.signal,
          });
          if (!response.ok) {
            return { response, bodyText: await response.text(), streamResult: null };
          }
          const streamResult = await readOpenAiChatStream(response, model, onDelta);
          return { response, bodyText: null, streamResult };
        } finally {
          clearTimeout(timer);
        }
      });

      if (!attempt.response.ok) {
        const err = openaiHttpError(
          attempt.response.status,
          attempt.response.statusText,
          attempt.bodyText,
          model,
        );
        const retryAfter = attempt.response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          if (Number.isFinite(seconds)) err.retryAfterMs = Math.max(0, seconds * 1000);
        }
        throw err;
      }

      const streamResult = attempt.streamResult;
      const base = {
        backend: 'openai',
        generatedAtIso: new Date().toISOString(),
        model,
        providerModel: streamResult.providerModel || model,
        usage: streamResult.usage || null,
        status: openaiStatus(settings),
        text: streamResult.text,
        toolCalls: streamResult.toolCalls,
        continuation: streamResult.toolCalls.length ? {
          provider: 'openai',
          messages: [
            ...payloadInfo.continuationMessages,
            {
              role: 'assistant',
              content: streamResult.text || null,
              tool_calls: streamResult.toolCalls.map(call => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            },
          ],
        } : null,
      };
      openaiRememberSuccess(base);
      return base;
    } catch (err) {
      if (err?.name === 'AbortError' || session.controller.signal.aborted) {
        if (timedOut || session.abortReason === 'timeout') {
          throw {
            code: 'timeout',
            message: `OpenAI-compatible chat timed out after ${GEMINI_DEFAULT_TIMEOUT_MS} ms.`,
            retryable: true,
            backend: 'openai',
            model,
          };
        }
        throw {
          code: 'aborted',
          message: 'AI chat request was aborted.',
          retryable: false,
          backend: 'openai',
          model,
        };
      }
      if (err?.code) throw err;
      throw {
        code: 'backend_failed',
        message: err?.message || 'OpenAI-compatible chat request failed.',
        retryable: true,
        backend: 'openai',
        model,
      };
    }
  }

  async function handleOpenAi(request = {}) {
    const op = String(request.op || '').trim();
    if (op === 'settings:set') {
      const next = {};
      if (request.baseUrl !== undefined) {
        next[OPENAI_STORAGE_KEYS.baseUrl] = normalizeOpenAiBaseUrl(request.baseUrl);
      }
      if (request.apiKey !== undefined) {
        next[OPENAI_STORAGE_KEYS.apiKey] = String(request.apiKey || '').trim();
      }
      if (request.model !== undefined) {
        next[OPENAI_STORAGE_KEYS.model] = normalizeOpenAiModel(request.model);
      }
      await storageSet('local', next);
      openaiResetRuntimeState();
      return openaiStatus(await getOpenAiSettings());
    }

    const settings = await getOpenAiSettings();
    if (op === 'status') return openaiStatus(settings);
    if (op === 'test') {
      const task = normalizeGeminiTask({
        id: 'popup-test',
        prompt: 'Reply with exactly: BetterDungeon OpenAI ready',
        output: { type: 'text' },
      });
      return callOpenAiChatCompletion(settings, task);
    }
    if (op === 'query') {
      const task = normalizeGeminiTask(request.task);
      return callOpenAiChatCompletion(settings, task);
    }

    throw { code: 'invalid_args', message: `OpenAI op '${op || '(empty)'}' is not supported`, retryable: false };
  }

  async function handleSdk(request = {}) {
    const op = String(request.op || '').trim();
    if (op !== 'config') {
      throw { code: 'invalid_args', message: `SDK op '${op || '(empty)'}' is not supported` };
    }
    return getSdkConfigSnapshot();
  }

  function handleAiChatPort(port, driver) {
    try {
      if (port?.sender?.id && port.sender.id !== extensionRuntime.id) {
        port.disconnect();
        return;
      }
    } catch {
      try { port.disconnect(); } catch { /* noop */ }
      return;
    }

    const session = {
      requestId: null,
      started: false,
      terminal: false,
      closed: false,
      controller: null,
      abortReason: null,
      keepaliveTimer: null,
      terminalTimer: null,
      startTimer: null,
    };
    activeAiChatPorts.add(port);

    const safePost = (message) => {
      if (session.closed) return false;
      try {
        port.postMessage(message);
        return true;
      } catch {
        return false;
      }
    };

    const clearTimers = () => {
      if (session.startTimer) clearTimeout(session.startTimer);
      if (session.keepaliveTimer) clearInterval(session.keepaliveTimer);
      if (session.terminalTimer) clearTimeout(session.terminalTimer);
      session.startTimer = null;
      session.keepaliveTimer = null;
      session.terminalTimer = null;
    };

    const teardown = (reason, disconnect = true) => {
      if (session.closed) return;
      session.closed = true;
      clearTimers();
      if (session.controller && !session.controller.signal.aborted) {
        if (!session.abortReason) session.abortReason = reason;
        session.controller.abort();
      }
      try { port.onMessage.removeListener(onMessage); } catch { /* noop */ }
      try { port.onDisconnect.removeListener(onDisconnect); } catch { /* noop */ }
      activeAiChatPorts.delete(port);
      if (disconnect) {
        try { port.disconnect(); } catch { /* noop */ }
      }
      if (session.started) {
        console.log(`[${driver.logTag}] Stream closed`, {
          requestId: session.requestId,
          reason,
          activePorts: activeAiChatPorts.size,
        });
      }
    };

    const terminal = (type, payload) => {
      if (session.closed || session.terminal) return;
      session.terminal = true;
      if (session.keepaliveTimer) clearInterval(session.keepaliveTimer);
      session.keepaliveTimer = null;
      const posted = safePost({
        v: 1,
        type,
        requestId: session.requestId,
        ...payload,
      });
      if (!posted) {
        teardown(`${type}-post-failed`);
        return;
      }
      if (session.closed) return;
      session.terminalTimer = setTimeout(() => {
        teardown(`${type}-grace-expired`);
      }, GEMINI_CHAT_TERMINAL_GRACE_MS);
    };

    function onDisconnect() {
      try { void extensionRuntime.lastError; } catch { /* noop */ }
      teardown('disconnect', false);
    }

    function onMessage(message) {
      if (session.closed || !message || message.v !== 1) return;

      if (message.type === 'abort') {
        if (!session.started || message.requestId !== session.requestId) return;
        session.abortReason = 'caller';
        if (session.controller && !session.controller.signal.aborted) session.controller.abort();
        teardown('abort');
        return;
      }

      if (message.type !== 'start') {
        if (session.started) {
          terminal('error', {
            error: normalizeError({
              code: 'invalid_args',
              message: `${driver.label} chat message '${message.type || '(empty)'}' is not supported`,
              retryable: false,
            }),
          });
        }
        return;
      }

      if (session.started) {
        terminal('error', {
          error: normalizeError({
            code: 'invalid_args',
            message: `${driver.label} chat port already has an active request`,
            retryable: false,
          }),
        });
        return;
      }

      session.requestId = typeof message.requestId === 'string' && message.requestId
        ? message.requestId
        : null;
      if (!session.requestId) {
        teardown('invalid-request-id');
        return;
      }

      let task;
      try {
        task = driver.normalizeChatTask(message.task);
        if (task.id && task.id !== session.requestId) {
          throw {
            code: 'invalid_args',
            message: `${driver.label} chat request id does not match the task id`,
            retryable: false,
          };
        }
      } catch (err) {
        session.started = true;
        terminal('error', { error: normalizeError(err) });
        return;
      }

      session.started = true;
      session.controller = new AbortController();
      if (session.startTimer) clearTimeout(session.startTimer);
      session.startTimer = null;
      session.keepaliveTimer = setInterval(() => {
        if (!safePost({ v: 1, type: 'keepalive', requestId: session.requestId })) {
          teardown('keepalive-post-failed');
        }
      }, GEMINI_CHAT_KEEPALIVE_MS);
      console.log(`[${driver.logTag}] Stream started`, {
        requestId: session.requestId,
        activePorts: activeAiChatPorts.size,
      });

      driver.getSettings()
        .then(settings => driver.callChatStream(settings, task, session, (text, sequence) => {
          if (session.closed || session.terminal) return;
          if (!safePost({
            v: 1,
            type: 'delta',
            requestId: session.requestId,
            sequence,
            text,
          })) {
            teardown('delta-post-failed');
          }
        }))
        .then((result) => {
          if (session.closed) return;
          terminal('complete', { result });
        })
        .catch((error) => {
          if (session.closed) return;
          terminal('error', { error: normalizeError(error) });
        });
    }

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    session.startTimer = setTimeout(() => {
      teardown('start-timeout');
    }, GEMINI_CHAT_START_TIMEOUT_MS);
  }

  const AI_CHAT_PORT_DRIVERS = {
    [GEMINI_CHAT_PORT]: {
      label: 'Gemini',
      logTag: 'GeminiChat',
      normalizeChatTask: normalizeGeminiChatTask,
      getSettings: getGeminiSettings,
      callChatStream: callGeminiChatStream,
    },
    [OPENAI_CHAT_PORT]: {
      label: 'OpenAI-compatible',
      logTag: 'OpenAIChat',
      normalizeChatTask: normalizeGeminiChatTask,
      getSettings: getOpenAiSettings,
      callChatStream: callOpenAiChatStream,
    },
  };

  if (extensionRuntime.onConnect?.addListener) {
    extensionRuntime.onConnect.addListener((port) => {
      const driver = port ? AI_CHAT_PORT_DRIVERS[port.name] : null;
      if (!driver) return;
      handleAiChatPort(port, driver);
    });
  }

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== WEBFETCH_MESSAGE) return false;

    handleWebFetch(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  });

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== SDK_MESSAGE) return false;

    handleSdk(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  });

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== GEMINI_MESSAGE) return false;

    handleGemini(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  });

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== OPENAI_MESSAGE) return false;

    handleOpenAi(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  });

})();
