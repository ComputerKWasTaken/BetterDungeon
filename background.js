// BetterDungeon background worker.
//
// Hosts privileged operations that content scripts should not perform inside
// the page context. Phase 5 uses this for WebFetch so Frontier ops can access
// http/https URLs without inheriting AI Dungeon page CORS.

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

  const WEBFETCH_MESSAGE = 'FRONTIER_WEBFETCH_FETCH';
  const PROVIDER_AI_MESSAGE = 'FRONTIER_PROVIDER_AI_REQUEST';
  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const DEFAULT_MAX_BODY_BYTES = 50000;
  const MAX_BODY_BYTES = 100000;
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  const PROVIDER_AI_STORAGE_KEYS = {
    openrouterKey: 'frontier_provider_ai_openrouter_api_key',
    openrouterDefaultModel: 'frontier_provider_ai_openrouter_default_model',
  };
  const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  const OPENROUTER_TITLE = 'BetterDungeon Frontier';
  const PROVIDER_AI_DEFAULT_TIMEOUT_MS = 30000;
  const PROVIDER_AI_MAX_TIMEOUT_MS = 60000;
  const PROVIDER_AI_MAX_RESPONSE_BYTES = 1500000;
  const PROVIDER_AI_DEFAULT_MODEL_LIMIT = 30;
  const PROVIDER_AI_MAX_MODEL_LIMIT = 100;

  const BLOCKED_RESPONSE_HEADERS = new Set([
    'set-cookie',
    'set-cookie2',
    'authorization',
    'proxy-authorization',
  ]);

  function normalizeError(error) {
    if (error && typeof error === 'object') {
      return {
        code: typeof error.code === 'string' ? error.code : 'webfetch_failed',
        message: typeof error.message === 'string' ? error.message : 'WebFetch failed',
      };
    }
    return { code: 'webfetch_failed', message: String(error || 'WebFetch failed') };
  }

  function normalizeProviderAiError(error) {
    if (error && typeof error === 'object') {
      return {
        ...error,
        code: typeof error.code === 'string' && error.code ? error.code : 'provider_ai_failed',
        message: typeof error.message === 'string' ? error.message : 'Provider AI failed',
      };
    }
    return { code: 'provider_ai_failed', message: String(error || 'Provider AI failed') };
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function isTextContentType(contentType) {
    const lower = String(contentType || '').toLowerCase();
    return (
      lower.startsWith('text/') ||
      lower.includes('json') ||
      lower.includes('xml') ||
      lower.includes('javascript') ||
      lower.includes('svg') ||
      lower.includes('x-www-form-urlencoded')
    );
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
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

  async function handleWebFetch(request = {}) {
    const url = String(request.url || '');
    const method = String(request.method || 'GET').toUpperCase();
    const headers = request.headers && typeof request.headers === 'object'
      ? request.headers
      : {};
    const timeoutMs = clampNumber(request.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
    const maxBodyBytes = clampNumber(request.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 1024, MAX_BODY_BYTES);

    if (!SAFE_METHODS.has(method)) {
      throw { code: 'invalid_args', message: `method '${method}' is not supported in WebFetch v1` };
    }
    if (request.body !== undefined && request.body !== null) {
      throw { code: 'invalid_args', message: `${method} requests cannot include a body in WebFetch v1` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: request.body === undefined ? undefined : String(request.body),
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });

      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        const lower = String(key || '').toLowerCase();
        if (!BLOCKED_RESPONSE_HEADERS.has(lower)) responseHeaders[key] = value;
      });

      const contentType = response.headers.get('content-type') || '';
      const body = await readBodyBytes(response, maxBodyBytes);
      const bytes = body.bytes;
      const textLike = isTextContentType(contentType);

      return {
        url: response.url,
        redirected: response.redirected,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: responseHeaders,
        contentType,
        bodyEncoding: textLike ? 'text' : 'base64',
        body: textLike ? new TextDecoder().decode(bytes) : bytesToBase64(bytes),
        bytes: body.totalBytes,
        returnedBytes: body.returnedBytes,
        truncated: body.truncated,
      };
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw { code: 'timeout', message: `WebFetch timed out after ${timeoutMs} ms` };
      }
      throw { code: 'webfetch_failed', message: err?.message || 'WebFetch failed' };
    } finally {
      clearTimeout(timer);
    }
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

  async function getProviderAiConfig() {
    const keys = Object.values(PROVIDER_AI_STORAGE_KEYS);
    const result = await storageGet('local', keys);
    return {
      openrouterKey: String(result?.[PROVIDER_AI_STORAGE_KEYS.openrouterKey] || '').trim(),
      openrouterDefaultModel: String(result?.[PROVIDER_AI_STORAGE_KEYS.openrouterDefaultModel] || '').trim(),
    };
  }

  function requireOpenRouterKey(config) {
    const apiKey = String(config?.openrouterKey || '').trim();
    if (!apiKey) {
      throw {
        code: 'not_configured',
        message: 'OpenRouter API key is not configured in BetterDungeon settings',
        provider: 'openrouter',
      };
    }
    return apiKey;
  }

  function openRouterHeaders(apiKey) {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-OpenRouter-Title': OPENROUTER_TITLE,
    };
  }

  async function openRouterFetch(path, options = {}, timeoutMs = PROVIDER_AI_DEFAULT_TIMEOUT_MS) {
    const limit = clampNumber(timeoutMs, PROVIDER_AI_DEFAULT_TIMEOUT_MS, 1000, PROVIDER_AI_MAX_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);

    try {
      return await fetch(OPENROUTER_BASE_URL + path, {
        ...options,
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw { code: 'timeout', message: `Provider AI timed out after ${limit} ms`, provider: 'openrouter' };
      }
      throw { code: 'provider_ai_failed', message: err?.message || 'Provider AI request failed', provider: 'openrouter' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function readProviderJson(response) {
    const body = await readBodyBytes(response, PROVIDER_AI_MAX_RESPONSE_BYTES);
    const text = new TextDecoder().decode(body.bytes);
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = null; }
    } else {
      payload = {};
    }
    return {
      payload,
      text,
      truncated: body.truncated,
      returnedBytes: body.returnedBytes,
    };
  }

  function providerStatusError(response, payload, text, truncated) {
    const status = Number(response?.status || 0);
    const upstream = payload?.error && typeof payload.error === 'object'
      ? payload.error
      : (payload && typeof payload === 'object' ? payload : null);
    const upstreamCode = upstream?.code || upstream?.type || null;
    const message =
      upstream?.message ||
      String(text || '').slice(0, 240) ||
      `OpenRouter returned status ${status}`;

    let code = 'provider_error';
    if (status === 401 || status === 403) code = 'auth_failed';
    else if (status === 402) code = 'payment_required';
    else if (status === 408) code = 'timeout';
    else if (status === 429) code = 'rate_limit';

    return {
      code,
      message,
      provider: 'openrouter',
      status,
      upstreamCode: upstreamCode ? String(upstreamCode) : null,
      truncated: !!truncated,
    };
  }

  function normalizeOpenRouterContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return content == null ? '' : String(content);

    const parts = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part && typeof part === 'object') {
        if (typeof part.text === 'string') parts.push(part.text);
        else if (typeof part.content === 'string') parts.push(part.content);
      }
    }
    return parts.join('');
  }

  function normalizeOpenRouterUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    return {
      promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
      completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
      totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
      raw: usage,
    };
  }

  function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function boolOrNull(value) {
    return typeof value === 'boolean' ? value : null;
  }

  function stringOrNull(value) {
    return typeof value === 'string' && value ? value : null;
  }

  function normalizeOpenRouterKeyInfo(keyInfo) {
    const info = keyInfo && typeof keyInfo === 'object' ? keyInfo : {};
    const rateLimit = info.rate_limit && typeof info.rate_limit === 'object'
      ? {
          requests: numberOrNull(info.rate_limit.requests),
          interval: stringOrNull(info.rate_limit.interval),
        }
      : null;

    return {
      usage: numberOrNull(info.usage),
      usageDaily: numberOrNull(info.usage_daily),
      usageWeekly: numberOrNull(info.usage_weekly),
      usageMonthly: numberOrNull(info.usage_monthly),
      byokUsage: numberOrNull(info.byok_usage),
      limit: numberOrNull(info.limit),
      limitRemaining: numberOrNull(info.limit_remaining),
      limitReset: stringOrNull(info.limit_reset),
      freeTier: boolOrNull(info.is_free_tier),
      provisioningKey: boolOrNull(info.is_provisioning_key),
      managementKey: boolOrNull(info.is_management_key),
      includeByokInLimit: boolOrNull(info.include_byok_in_limit),
      expiresAt: stringOrNull(info.expires_at),
      rateLimit,
    };
  }

  function normalizeOpenRouterChat(payload, requestedModel) {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    const message = choice?.message || {};
    const content = normalizeOpenRouterContent(message.content);

    return {
      provider: 'openrouter',
      model: payload?.model || requestedModel || null,
      id: payload?.id || null,
      created: typeof payload?.created === 'number' ? payload.created : null,
      object: payload?.object || 'chat.completion',
      text: content,
      message: {
        role: message.role || 'assistant',
        content,
      },
      finishReason: choice?.finish_reason || null,
      nativeFinishReason: choice?.native_finish_reason || null,
      usage: normalizeOpenRouterUsage(payload?.usage),
    };
  }

  function normalizeOpenRouterModel(model) {
    return {
      id: model?.id || '',
      name: model?.name || model?.id || '',
      canonicalSlug: model?.canonical_slug || null,
      contextLength: typeof model?.context_length === 'number' ? model.context_length : null,
      created: typeof model?.created === 'number' ? model.created : null,
      inputModalities: Array.isArray(model?.architecture?.input_modalities)
        ? model.architecture.input_modalities.slice(0, 8)
        : [],
      outputModalities: Array.isArray(model?.architecture?.output_modalities)
        ? model.architecture.output_modalities.slice(0, 8)
        : [],
      pricing: model?.pricing && typeof model.pricing === 'object'
        ? {
            prompt: model.pricing.prompt || null,
            completion: model.pricing.completion || null,
            request: model.pricing.request || null,
          }
        : null,
    };
  }

  async function fetchOpenRouterKeyInfo(config, timeoutMs) {
    const apiKey = requireOpenRouterKey(config);
    const response = await openRouterFetch('/key', {
      method: 'GET',
      headers: openRouterHeaders(apiKey),
    }, timeoutMs);
    const body = await readProviderJson(response);

    if (!response.ok) {
      throw providerStatusError(response, body.payload, body.text, body.truncated);
    }
    if (!body.payload || typeof body.payload !== 'object') {
      throw { code: 'provider_ai_failed', message: 'OpenRouter returned invalid key metadata', provider: 'openrouter' };
    }

    return normalizeOpenRouterKeyInfo(body.payload.data);
  }

  async function fetchOpenRouterModels(config, timeoutMs) {
    const apiKey = requireOpenRouterKey(config);
    const response = await openRouterFetch('/models', {
      method: 'GET',
      headers: openRouterHeaders(apiKey),
    }, timeoutMs);
    const body = await readProviderJson(response);

    if (!response.ok) {
      throw providerStatusError(response, body.payload, body.text, body.truncated);
    }
    if (!body.payload || typeof body.payload !== 'object') {
      throw { code: 'provider_ai_failed', message: 'OpenRouter returned invalid JSON', provider: 'openrouter' };
    }

    return {
      models: Array.isArray(body.payload.data) ? body.payload.data : [],
      truncated: body.truncated,
    };
  }

  async function handleOpenRouterModels(request, config) {
    const timeoutMs = clampNumber(request.timeoutMs, PROVIDER_AI_DEFAULT_TIMEOUT_MS, 1000, PROVIDER_AI_MAX_TIMEOUT_MS);
    const limit = Math.round(clampNumber(request.limit, PROVIDER_AI_DEFAULT_MODEL_LIMIT, 0, PROVIDER_AI_MAX_MODEL_LIMIT));
    const query = String(request.query || '').trim().toLowerCase();
    const fetched = await fetchOpenRouterModels(config, timeoutMs);
    const allModels = fetched.models;
    const filtered = query
      ? allModels.filter((model) => {
          const id = String(model?.id || '').toLowerCase();
          const name = String(model?.name || '').toLowerCase();
          return id.includes(query) || name.includes(query);
        })
      : allModels;
    const selected = limit <= 0 ? [] : filtered.slice(0, limit).map(normalizeOpenRouterModel);

    return {
      provider: 'openrouter',
      configured: true,
      defaultModel: config.openrouterDefaultModel || null,
      source: OPENROUTER_BASE_URL + '/models',
      count: filtered.length,
      totalCount: allModels.length,
      returned: selected.length,
      truncated: filtered.length > selected.length || fetched.truncated,
      models: selected,
    };
  }

  async function handleOpenRouterTestConnection(request, config) {
    const timeoutMs = clampNumber(request.timeoutMs, PROVIDER_AI_DEFAULT_TIMEOUT_MS, 1000, PROVIDER_AI_MAX_TIMEOUT_MS);
    const key = await fetchOpenRouterKeyInfo(config, timeoutMs);
    const result = await handleOpenRouterModels({ ...request, limit: 0, timeoutMs }, config);
    return {
      provider: 'openrouter',
      configured: true,
      ok: true,
      defaultModel: config.openrouterDefaultModel || null,
      modelCount: result.totalCount,
      source: result.source,
      key,
      checkedAt: Date.now(),
      checkedAtIso: new Date().toISOString(),
    };
  }

  async function handleOpenRouterChat(request, config) {
    const apiKey = requireOpenRouterKey(config);
    const timeoutMs = clampNumber(request.timeoutMs, PROVIDER_AI_DEFAULT_TIMEOUT_MS, 1000, PROVIDER_AI_MAX_TIMEOUT_MS);
    const model = String(request.model || config.openrouterDefaultModel || '').trim();
    if (!model) {
      throw {
        code: 'invalid_args',
        message: 'model is required or configure a default OpenRouter model',
        provider: 'openrouter',
      };
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw { code: 'invalid_args', message: 'messages must be a non-empty array', provider: 'openrouter' };
    }

    const body = {
      model,
      messages: request.messages,
      stream: false,
    };
    if (typeof request.temperature === 'number') body.temperature = request.temperature;
    if (typeof request.maxTokens === 'number') body.max_tokens = request.maxTokens;
    if (request.responseFormat && typeof request.responseFormat === 'object') {
      body.response_format = request.responseFormat;
    }
    if (Array.isArray(request.stop) || typeof request.stop === 'string') {
      body.stop = request.stop;
    }

    const response = await openRouterFetch('/chat/completions', {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(body),
    }, timeoutMs);
    const responseBody = await readProviderJson(response);

    if (!response.ok) {
      throw providerStatusError(response, responseBody.payload, responseBody.text, responseBody.truncated);
    }
    if (!responseBody.payload || typeof responseBody.payload !== 'object') {
      throw { code: 'provider_ai_failed', message: 'OpenRouter returned invalid JSON', provider: 'openrouter' };
    }

    return normalizeOpenRouterChat(responseBody.payload, model);
  }

  async function handleProviderAi(request = {}) {
    const provider = String(request.provider || 'openrouter').trim().toLowerCase();
    const op = String(request.op || '').trim();

    if (provider !== 'openrouter') {
      throw { code: 'invalid_args', message: `provider '${provider || '(empty)'}' is not supported`, provider };
    }
    if (op !== 'chat' && op !== 'models' && op !== 'testConnection') {
      throw { code: 'invalid_args', message: `providerAI op '${op || '(empty)'}' is not supported`, provider };
    }

    const config = await getProviderAiConfig();
    if (op === 'chat') return handleOpenRouterChat(request, config);
    if (op === 'models') return handleOpenRouterModels(request, config);
    return handleOpenRouterTestConnection(request, config);
  }

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== WEBFETCH_MESSAGE) return false;

    handleWebFetch(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  });

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== PROVIDER_AI_MESSAGE) return false;

    handleProviderAi(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeProviderAiError(error) }));
    return true;
  });
})();
