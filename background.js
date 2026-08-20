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
  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
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
  function normalizeError(error) {
    if (error && typeof error === 'object') {
      const normalized = {
        code: typeof error.code === 'string' ? error.code : 'webfetch_failed',
        message: typeof error.message === 'string' ? error.message : 'WebFetch failed',
      };
      for (const key of ['retryable', 'status', 'statusText', 'retryAfterMs', 'backend', 'service', 'phase', 'task', 'detail', 'model', 'providerReason']) {
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

  async function handleSdk(request = {}) {
    const op = String(request.op || '').trim();
    if (op !== 'config') {
      throw { code: 'invalid_args', message: `SDK op '${op || '(empty)'}' is not supported` };
    }
    return getSdkConfigSnapshot();
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



})();

if (typeof importScripts === 'function') {
  try {
    importScripts('background-ai-openai-compatible.js');
  } catch (error) {
    console.error('[BetterDungeon/background] Failed to load AI runtime:', error);
  }
}
