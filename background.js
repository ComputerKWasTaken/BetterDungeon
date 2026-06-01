// BetterDungeon background worker.
//
// Hosts privileged operations that content scripts should not perform inside
// the page context. Phase 5 uses this for WebFetch so Ultrascripts ops can access
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

  const WEBFETCH_MESSAGE = 'ULTRASCRIPTS_WEBFETCH_FETCH';
  const AI_MESSAGE = 'ULTRASCRIPTS_AI_REQUEST';
  const LEGACY_PROVIDER_AI_MESSAGE = 'ULTRASCRIPTS_PROVIDER_AI_REQUEST';
  const SDK_MESSAGE = 'ULTRASCRIPTS_SDK_REQUEST';
  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const DEFAULT_MAX_BODY_BYTES = 50000;
  const MAX_BODY_BYTES = 100000;
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  const AI_STORAGE_KEYS = {
    openrouterKey: 'ultrascripts_ai_openrouter_api_key',
    openrouterDefaultModel: 'ultrascripts_ai_openrouter_default_model',
    costControls: 'ultrascripts_ai_cost_controls',
    legacyBudget: 'ultrascripts_ai_budget',
    costUsage: 'ultrascripts_ai_cost_usage',
    legacyOpenrouterKey: 'ultrascripts_provider_ai_openrouter_api_key',
    legacyOpenrouterDefaultModel: 'ultrascripts_provider_ai_openrouter_default_model',
  };
  const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  const OPENROUTER_TITLE = 'BetterDungeon Ultrascripts';
  const OPENROUTER_FREE_ROUTER_MODEL_ID = 'openrouter/free';
  const AI_DUMMY_MODEL_ID = 'betterdungeon/dummy:free';
  const AI_DEFAULT_TIMEOUT_MS = 30000;
  const AI_MAX_TIMEOUT_MS = 60000;
  const AI_MAX_RESPONSE_BYTES = 1500000;
  const AI_DEFAULT_MODEL_LIMIT = 30;
  const AI_MAX_MODEL_LIMIT = 100;
  const AI_DEFAULT_COST_CONTROLS = {
    freeModelsOnly: true,
    advancedOpen: false,
    maxPromptPricePerMillion: 0,
    maxCompletionPricePerMillion: 0,
    perCallEstimateCap: 0,
    dailySpendCap: 0,
    monthlySpendCap: 0,
  };
  const SDK_SYNC_STORAGE_KEYS = {
    features: 'betterDungeonFeatures',
    ultrascriptsModules: 'ultrascripts_enabled_modules',
    ultrascriptsDebug: 'ultrascripts_debug',
    scriptureWidgetDisplay: 'ultrascripts_mod_scripture_widget_display',
    webfetchAllowlist: 'ultrascripts_webfetch_allowlist',
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
  };
  const SDK_ULTRASCRIPTS_MODULES = [
    'scripture',
    'webfetch',
    'clock',
    'sdk',
    'geolocation',
    'weather',
    'network',
    'system',
    'ai',
  ];
  const SDK_DEFAULT_SCRIPTURE_WIDGET_DISPLAY = {
    size: 'normal',
    maxHeight: 'medium',
    layout: 'balanced',
  };

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

  function normalizeAiError(error) {
    if (error && typeof error === 'object') {
      return {
        ...error,
        code: typeof error.code === 'string' && error.code ? error.code : 'ai_failed',
        message: typeof error.message === 'string' ? error.message : 'AI failed',
      };
    }
    return { code: 'ai_failed', message: String(error || 'AI failed') };
  }

  function aiDebug(event, detail = {}) {
    try {
      console.info('[BetterDungeon/AI]', event, detail);
    } catch { /* noop */ }
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function clampInteger(value, fallback, min, max) {
    return Math.round(clampNumber(value, fallback, min, max));
  }

  function clampMoney(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n * 1000000) / 1000000));
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

  function storageSet(areaName, items) {
    const area = storageArea(areaName);
    if (!area?.set) return Promise.resolve();

    return new Promise((resolve) => {
      try {
        const maybePromise = area.set(items, () => resolve());
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(() => resolve(), () => resolve());
        }
      } catch {
        try {
          const maybePromise = area.set(items);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(() => resolve(), () => resolve());
          } else {
            resolve();
          }
        } catch {
          resolve();
        }
      }
    });
  }

  async function getAiConfig() {
    const keys = Object.values(AI_STORAGE_KEYS);
    const result = await storageGet('local', keys);
    return {
      openrouterKey: String(result?.[AI_STORAGE_KEYS.openrouterKey] || result?.[AI_STORAGE_KEYS.legacyOpenrouterKey] || '').trim(),
      openrouterDefaultModel: String(result?.[AI_STORAGE_KEYS.openrouterDefaultModel] || result?.[AI_STORAGE_KEYS.legacyOpenrouterDefaultModel] || OPENROUTER_FREE_ROUTER_MODEL_ID).trim(),
      costControls: normalizeAiCostControls(result?.[AI_STORAGE_KEYS.costControls] || result?.[AI_STORAGE_KEYS.legacyBudget]),
    };
  }

  function normalizeAiCostControls(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      freeModelsOnly: raw.freeModelsOnly !== false,
      advancedOpen: raw.advancedOpen === true,
      maxPromptPricePerMillion: clampMoney(raw.maxPromptPricePerMillion, AI_DEFAULT_COST_CONTROLS.maxPromptPricePerMillion, 0, 1000),
      maxCompletionPricePerMillion: clampMoney(raw.maxCompletionPricePerMillion, AI_DEFAULT_COST_CONTROLS.maxCompletionPricePerMillion, 0, 1000),
      perCallEstimateCap: clampMoney(raw.perCallEstimateCap, AI_DEFAULT_COST_CONTROLS.perCallEstimateCap, 0, 1000),
      dailySpendCap: clampMoney(raw.dailySpendCap, AI_DEFAULT_COST_CONTROLS.dailySpendCap, 0, 1000),
      monthlySpendCap: clampMoney(raw.monthlySpendCap, AI_DEFAULT_COST_CONTROLS.monthlySpendCap, 0, 1000),
    };
  }

  function normalizeSdkFeatures(raw) {
    return { ...SDK_DEFAULT_FEATURES, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  function normalizeSdkUltrascriptsModules(raw) {
    const out = {};
    const saved = raw && typeof raw === 'object' ? raw : {};
    for (let i = 0; i < SDK_ULTRASCRIPTS_MODULES.length; i++) {
      out[SDK_ULTRASCRIPTS_MODULES[i]] = true;
    }
    for (const [key, value] of Object.entries(saved)) {
      const normalizedKey = key === 'providerAI' ? 'ai' : key;
      if (SDK_ULTRASCRIPTS_MODULES.includes(normalizedKey)) out[normalizedKey] = !!value;
    }
    return out;
  }

  function normalizeSdkScriptureDisplay(raw) {
    const display = raw && typeof raw === 'object' ? raw : {};
    const size = ['compact', 'normal', 'comfortable', 'large'].includes(String(display.size || '').toLowerCase())
      ? String(display.size).toLowerCase()
      : SDK_DEFAULT_SCRIPTURE_WIDGET_DISPLAY.size;
    const maxHeight = ['short', 'medium', 'tall'].includes(String(display.maxHeight || '').toLowerCase())
      ? String(display.maxHeight).toLowerCase()
      : SDK_DEFAULT_SCRIPTURE_WIDGET_DISPLAY.maxHeight;
    const layout = ['balanced', 'stacked'].includes(String(display.layout || '').toLowerCase())
      ? String(display.layout).toLowerCase()
      : SDK_DEFAULT_SCRIPTURE_WIDGET_DISPLAY.layout;
    return { size, maxHeight, layout };
  }

  function summarizeSdkWebFetchAllowlist(raw) {
    const entries = raw && typeof raw === 'object' ? Object.entries(raw) : [];
    let allowCount = 0;
    let denyCount = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i][1];
      if (!entry || typeof entry !== 'object') continue;
      if (entry.decision === 'allow') allowCount++;
      else if (entry.decision === 'deny') denyCount++;
    }
    return {
      savedOriginCount: allowCount + denyCount,
      allowCount,
      denyCount,
    };
  }

  async function getSdkConfigSnapshot() {
    const syncResult = await storageGet('sync', Object.values(SDK_SYNC_STORAGE_KEYS));
    const aiConfig = await getAiConfig();
    const dummyModel = isDummyAiModel(aiConfig.openrouterDefaultModel);
    return {
      features: normalizeSdkFeatures(syncResult[SDK_SYNC_STORAGE_KEYS.features]),
      ultrascripts: {
        debug: !!syncResult[SDK_SYNC_STORAGE_KEYS.ultrascriptsDebug],
        modulePreferences: normalizeSdkUltrascriptsModules(syncResult[SDK_SYNC_STORAGE_KEYS.ultrascriptsModules]),
        scriptureDisplay: normalizeSdkScriptureDisplay(syncResult[SDK_SYNC_STORAGE_KEYS.scriptureWidgetDisplay]),
        webfetch: summarizeSdkWebFetchAllowlist(syncResult[SDK_SYNC_STORAGE_KEYS.webfetchAllowlist]),
        ai: {
          configured: !!aiConfig.openrouterKey || dummyModel,
          defaultModel: aiConfig.openrouterDefaultModel || null,
          costControls: normalizeAiCostControls(aiConfig.costControls),
          dummyModel,
        },
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
      'HTTP-Referer': extensionRuntime.getURL('popup.html'),
      'X-OpenRouter-Title': OPENROUTER_TITLE,
    };
  }

  async function openRouterFetch(path, options = {}, timeoutMs = AI_DEFAULT_TIMEOUT_MS) {
    const limit = clampNumber(timeoutMs, AI_DEFAULT_TIMEOUT_MS, 1000, AI_MAX_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    const startedAt = Date.now();
    const trace = options.trace && typeof options.trace === 'object' ? options.trace : {};
    const method = String(options.method || 'GET').toUpperCase();
    aiDebug('fetch:start', {
      ...trace,
      path,
      method,
      timeoutMs: limit,
    });
    const { trace: _trace, ...fetchOptions } = options;

    try {
      const response = await fetch(OPENROUTER_BASE_URL + path, {
        ...fetchOptions,
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      aiDebug('fetch:response', {
        ...trace,
        path,
        method,
        status: response.status,
        ok: response.ok,
        elapsedMs: Date.now() - startedAt,
      });
      return response;
    } catch (err) {
      aiDebug('fetch:error', {
        ...trace,
        path,
        method,
        elapsedMs: Date.now() - startedAt,
        name: err?.name || null,
        message: err?.message || String(err || ''),
      });
      if (err?.name === 'AbortError') {
        throw { code: 'timeout', message: `AI timed out after ${limit} ms`, provider: 'openrouter' };
      }
      throw { code: 'ai_failed', message: err?.message || 'AI request failed', provider: 'openrouter' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function readProviderJson(response) {
    const body = await readBodyBytes(response, AI_MAX_RESPONSE_BYTES);
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

  function priceToNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function hasModelPricing(model) {
    const pricing = model?.pricing;
    if (!pricing || typeof pricing !== 'object') return false;
    const prompt = Number(pricing.prompt);
    const completion = Number(pricing.completion);
    const request = pricing.request === undefined || pricing.request === null ? 0 : Number(pricing.request);
    return (
      Number.isFinite(prompt) &&
      prompt >= 0 &&
      Number.isFinite(completion) &&
      completion >= 0 &&
      Number.isFinite(request) &&
      request >= 0
    );
  }

  function pricePerMillion(model, key) {
    return priceToNumber(model?.pricing?.[key]) * 1000000;
  }

  function isFreeModel(model) {
    return (
      priceToNumber(model?.pricing?.prompt) === 0 &&
      priceToNumber(model?.pricing?.completion) === 0 &&
      priceToNumber(model?.pricing?.request) === 0
    );
  }

  function dateKey(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function monthKey(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 7);
  }

  function normalizeCostUsage(value = {}) {
    const raw = value && typeof value === 'object' ? value : {};
    const now = Date.now();
    const today = dateKey(now);
    const month = monthKey(now);
    return {
      date: today,
      month,
      dailySpend: raw.date === today ? clampMoney(raw.dailySpend, 0, 0, 1000000) : 0,
      monthlySpend: raw.month === month ? clampMoney(raw.monthlySpend, 0, 0, 1000000) : 0,
    };
  }

  async function getCostUsage() {
    const result = await storageGet('local', AI_STORAGE_KEYS.costUsage);
    return normalizeCostUsage(result?.[AI_STORAGE_KEYS.costUsage]);
  }

  async function recordCostUsage(cost) {
    if (!cost) return;
    const usage = await getCostUsage();
    const next = {
      ...usage,
      dailySpend: clampMoney(usage.dailySpend + cost, 0, 0, 1000000),
      monthlySpend: clampMoney(usage.monthlySpend + cost, 0, 0, 1000000),
    };
    await storageSet('local', { [AI_STORAGE_KEYS.costUsage]: next });
  }

  function estimateTokens(messages) {
    const chars = Array.isArray(messages)
      ? messages.reduce((total, message) => total + String(message?.content || '').length, 0)
      : 0;
    return Math.max(1, Math.ceil(chars / 4));
  }

  function estimateRequestCost(model, request) {
    const promptTokens = estimateTokens(request.messages);
    const completionTokens = clampInteger(request.maxTokens, 512, 1, 4096);
    const promptCost = promptTokens * priceToNumber(model?.pricing?.prompt);
    const completionCost = completionTokens * priceToNumber(model?.pricing?.completion);
    return promptCost + completionCost + priceToNumber(model?.pricing?.request);
  }

  function actualRequestCost(model, usage) {
    const promptTokens = typeof usage?.promptTokens === 'number' ? usage.promptTokens : 0;
    const completionTokens = typeof usage?.completionTokens === 'number' ? usage.completionTokens : 0;
    return (
      promptTokens * priceToNumber(model?.pricing?.prompt) +
      completionTokens * priceToNumber(model?.pricing?.completion) +
      priceToNumber(model?.pricing?.request)
    );
  }

  function findModel(models, modelId) {
    const requested = String(modelId || '').trim().toLowerCase();
    if (!requested) return null;
    const found = models.find((model) => String(model?.id || '').toLowerCase() === requested) || null;
    if (requested === OPENROUTER_FREE_ROUTER_MODEL_ID && (!found || !hasModelPricing(found))) {
      return found ? { ...openRouterFreeRouterModel(), ...found, pricing: openRouterFreeRouterModel().pricing } : openRouterFreeRouterModel();
    }
    return found;
  }

  function openRouterFreeRouterModel() {
    return {
      id: OPENROUTER_FREE_ROUTER_MODEL_ID,
      name: 'OpenRouter Free Router',
      canonical_slug: OPENROUTER_FREE_ROUTER_MODEL_ID,
      context_length: null,
      architecture: {
        input_modalities: ['text'],
        output_modalities: ['text'],
      },
      pricing: {
        prompt: '0',
        completion: '0',
        request: '0',
      },
    };
  }

  async function enforceAiCostControls(request, config, model) {
    const controls = normalizeAiCostControls(config?.costControls);
    if (!model) {
      throw {
        code: 'model_not_found',
        message: `Configured OpenRouter model '${request.model}' was not found; choose a different default model in BetterDungeon settings`,
        provider: 'openrouter',
      };
    }
    const needsPricing =
      controls.freeModelsOnly ||
      controls.maxPromptPricePerMillion > 0 ||
      controls.maxCompletionPricePerMillion > 0 ||
      controls.perCallEstimateCap > 0 ||
      controls.dailySpendCap > 0 ||
      controls.monthlySpendCap > 0;
    if (needsPricing && !hasModelPricing(model)) {
      throw {
        code: 'cost_control',
        message: `OpenRouter pricing is unavailable for '${model.id}', so AI cost controls cannot verify the request`,
        provider: 'openrouter',
      };
    }

    if (controls.freeModelsOnly && !isFreeModel(model)) {
      throw {
        code: 'cost_control',
        message: `AI cost controls allow free models only. Disable that setting to use '${model.id}'.`,
        provider: 'openrouter',
      };
    }

    const promptPrice = pricePerMillion(model, 'prompt');
    if (controls.maxPromptPricePerMillion > 0 && promptPrice > controls.maxPromptPricePerMillion) {
      throw {
        code: 'cost_control',
        message: `Model input price $${promptPrice.toFixed(2)}/1M exceeds your $${controls.maxPromptPricePerMillion.toFixed(2)}/1M cap`,
        provider: 'openrouter',
      };
    }

    const completionPrice = pricePerMillion(model, 'completion');
    if (controls.maxCompletionPricePerMillion > 0 && completionPrice > controls.maxCompletionPricePerMillion) {
      throw {
        code: 'cost_control',
        message: `Model output price $${completionPrice.toFixed(2)}/1M exceeds your $${controls.maxCompletionPricePerMillion.toFixed(2)}/1M cap`,
        provider: 'openrouter',
      };
    }

    const estimatedCost = estimateRequestCost(model, request);
    if (controls.perCallEstimateCap > 0 && estimatedCost > controls.perCallEstimateCap) {
      throw {
        code: 'cost_control',
        message: `Estimated AI cost $${estimatedCost.toFixed(4)} exceeds your per-call $${controls.perCallEstimateCap.toFixed(2)} cap`,
        provider: 'openrouter',
      };
    }

    const usage = await getCostUsage();
    if (controls.dailySpendCap > 0 && usage.dailySpend + estimatedCost > controls.dailySpendCap) {
      throw {
        code: 'cost_control',
        message: `Estimated AI cost would exceed your daily $${controls.dailySpendCap.toFixed(2)} cap`,
        provider: 'openrouter',
      };
    }
    if (controls.monthlySpendCap > 0 && usage.monthlySpend + estimatedCost > controls.monthlySpendCap) {
      throw {
        code: 'cost_control',
        message: `Estimated AI cost would exceed your monthly $${controls.monthlySpendCap.toFixed(2)} cap`,
        provider: 'openrouter',
      };
    }
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
      throw { code: 'ai_failed', message: 'OpenRouter returned invalid key metadata', provider: 'openrouter' };
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
      throw { code: 'ai_failed', message: 'OpenRouter returned invalid JSON', provider: 'openrouter' };
    }

    return {
      models: Array.isArray(body.payload.data) ? body.payload.data : [],
      truncated: body.truncated,
    };
  }

  async function handleOpenRouterModels(request, config) {
    const timeoutMs = clampNumber(request.timeoutMs, AI_DEFAULT_TIMEOUT_MS, 1000, AI_MAX_TIMEOUT_MS);
    const limit = Math.round(clampNumber(request.limit, AI_DEFAULT_MODEL_LIMIT, 0, AI_MAX_MODEL_LIMIT));
    const query = String(request.query || '').trim().toLowerCase();
    const fetched = await fetchOpenRouterModels(config, timeoutMs);
    const freeRouter = openRouterFreeRouterModel();
    const allModels = fetched.models.some((model) => String(model?.id || '').toLowerCase() === OPENROUTER_FREE_ROUTER_MODEL_ID)
      ? fetched.models.map((model) => String(model?.id || '').toLowerCase() === OPENROUTER_FREE_ROUTER_MODEL_ID && !hasModelPricing(model)
          ? { ...freeRouter, ...model, pricing: freeRouter.pricing }
          : model)
      : [freeRouter, ...fetched.models];
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
    const timeoutMs = clampNumber(request.timeoutMs, AI_DEFAULT_TIMEOUT_MS, 1000, AI_MAX_TIMEOUT_MS);
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
    const trace = {
      requestId: request?.requestId || null,
      op: 'chat',
      provider: 'openrouter',
    };
    const startedAt = Date.now();
    const apiKey = requireOpenRouterKey(config);
    const timeoutMs = clampNumber(request.timeoutMs, AI_DEFAULT_TIMEOUT_MS, 1000, AI_MAX_TIMEOUT_MS);
    const model = String(config.openrouterDefaultModel || '').trim();
    aiDebug('chat:start', {
      ...trace,
      model,
      timeoutMs,
      messageCount: Array.isArray(request.messages) ? request.messages.length : 0,
      maxTokens: request.maxTokens || null,
      hasResponseFormat: !!request.responseFormat,
    });
    if (!model) {
      throw {
        code: 'invalid_args',
        message: 'Configure a default OpenRouter model in BetterDungeon settings before using ai.chat',
        provider: 'openrouter',
      };
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw { code: 'invalid_args', message: 'messages must be a non-empty array', provider: 'openrouter' };
    }
    aiDebug('chat:models-fetch:start', { ...trace, model });
    const models = (await fetchOpenRouterModels(config, timeoutMs)).models;
    aiDebug('chat:models-fetch:done', { ...trace, model, modelCount: models.length });
    const modelMeta = findModel(models, model);
    await enforceAiCostControls({ ...request, model }, config, modelMeta);
    aiDebug('chat:cost-controls:ok', { ...trace, model });

    const body = {
      model,
      messages: request.messages,
      stream: false,
    };
    if (typeof request.temperature === 'number') body.temperature = request.temperature;
    if (typeof request.maxTokens === 'number') body.max_tokens = request.maxTokens;
    if (request.responseFormat && typeof request.responseFormat === 'object') {
      body.response_format = request.responseFormat;
      body.provider = { require_parameters: true };
    }
    if (Array.isArray(request.stop) || typeof request.stop === 'string') {
      body.stop = request.stop;
    }

    const response = await openRouterFetch('/chat/completions', {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify(body),
      trace: { ...trace, model },
    }, timeoutMs);
    aiDebug('chat:provider-response:start-read', {
      ...trace,
      model,
      status: response.status,
      ok: response.ok,
    });
    const responseBody = await readProviderJson(response);
    aiDebug('chat:provider-response:read', {
      ...trace,
      model,
      status: response.status,
      ok: response.ok,
      returnedBytes: responseBody.returnedBytes,
      truncated: responseBody.truncated,
      elapsedMs: Date.now() - startedAt,
    });

    if (!response.ok) {
      throw providerStatusError(response, responseBody.payload, responseBody.text, responseBody.truncated);
    }
    if (!responseBody.payload || typeof responseBody.payload !== 'object') {
      throw { code: 'ai_failed', message: 'OpenRouter returned invalid JSON', provider: 'openrouter' };
    }

    const normalized = normalizeOpenRouterChat(responseBody.payload, model);
    await recordCostUsage(actualRequestCost(modelMeta, normalized.usage));
    aiDebug('chat:done', {
      ...trace,
      model: normalized.model || model,
      id: normalized.id || null,
      textLength: typeof normalized.text === 'string' ? normalized.text.length : null,
      finishReason: normalized.finishReason || null,
      elapsedMs: Date.now() - startedAt,
    });
    return normalized;
  }

  function isDummyAiModel(model) {
    return String(model || '').trim().toLowerCase() === AI_DUMMY_MODEL_ID;
  }

  function normalizeDummyModel() {
    return {
      id: AI_DUMMY_MODEL_ID,
      name: 'BetterDungeon Dummy (free)',
      canonicalSlug: 'betterdungeon/dummy',
      contextLength: 32768,
      created: null,
      inputModalities: ['text'],
      outputModalities: ['text'],
      pricing: { prompt: '0', completion: '0', request: '0' },
    };
  }

  function dummyKeyInfo() {
    return {
      usage: 0,
      usageDaily: 0,
      usageWeekly: 0,
      usageMonthly: 0,
      byokUsage: 0,
      limit: null,
      limitRemaining: null,
      limitReset: null,
      freeTier: true,
      provisioningKey: false,
      managementKey: false,
      includeByokInLimit: null,
      expiresAt: null,
      rateLimit: null,
    };
  }

  function dummyChatText(request) {
    const formatType = String(request?.responseFormat?.type || '').trim();
    if (formatType === 'json_object') return '{"status":"online"}';
    if (formatType === 'json_schema') return '{"status":"online"}';

    const last = Array.isArray(request?.messages)
      ? request.messages.slice().reverse().find((message) => message?.role === 'user')
      : null;
    const content = String(last?.content || '').toLowerCase();
    if (content.includes('ultrascripts ai module is online')) {
      return 'Ultrascripts AI module is online.';
    }
    return 'BetterDungeon dummy AI response.';
  }

  function handleDummyModels(request, config) {
    const limit = Math.round(clampNumber(request.limit, AI_DEFAULT_MODEL_LIMIT, 0, AI_MAX_MODEL_LIMIT));
    const query = String(request.query || '').trim().toLowerCase();
    const model = normalizeDummyModel();
    const matches = !query || model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query);
    const models = matches && limit > 0 ? [model] : [];
    return {
      provider: 'openrouter',
      configured: true,
      dummy: true,
      defaultModel: config.openrouterDefaultModel || AI_DUMMY_MODEL_ID,
      source: 'betterdungeon:dummy',
      count: matches ? 1 : 0,
      totalCount: 1,
      returned: models.length,
      truncated: false,
      models,
    };
  }

  function handleDummyTestConnection(request, config) {
    const models = handleDummyModels({ ...request, limit: 0 }, config);
    return {
      provider: 'openrouter',
      configured: true,
      dummy: true,
      ok: true,
      defaultModel: config.openrouterDefaultModel || AI_DUMMY_MODEL_ID,
      modelCount: models.totalCount,
      source: models.source,
      key: dummyKeyInfo(),
      checkedAt: Date.now(),
      checkedAtIso: new Date().toISOString(),
    };
  }

  function handleDummyChat(request, config) {
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw { code: 'invalid_args', message: 'messages must be a non-empty array', provider: 'openrouter' };
    }
    const text = dummyChatText(request);
    return {
      provider: 'openrouter',
      dummy: true,
      model: config.openrouterDefaultModel || AI_DUMMY_MODEL_ID,
      id: `bd-dummy-${Date.now().toString(36)}`,
      created: Math.floor(Date.now() / 1000),
      object: 'chat.completion',
      text,
      message: {
        role: 'assistant',
        content: text,
      },
      finishReason: 'stop',
      nativeFinishReason: 'stop',
      usage: {
        promptTokens: estimateTokens(request.messages),
        completionTokens: Math.max(1, Math.ceil(text.length / 4)),
        totalTokens: estimateTokens(request.messages) + Math.max(1, Math.ceil(text.length / 4)),
        raw: null,
      },
    };
  }

  async function handleAi(request = {}) {
    const provider = String(request.provider || 'openrouter').trim().toLowerCase();
    const op = String(request.op || '').trim();

    if (provider !== 'openrouter') {
      throw { code: 'invalid_args', message: `provider '${provider || '(empty)'}' is not supported`, provider };
    }
    if (op !== 'chat' && op !== 'models' && op !== 'testConnection') {
      throw { code: 'invalid_args', message: `AI op '${op || '(empty)'}' is not supported`, provider };
    }

    const config = await getAiConfig();
    if (isDummyAiModel(config.openrouterDefaultModel)) {
      if (op === 'chat') return handleDummyChat(request, config);
      if (op === 'models') return handleDummyModels(request, config);
      return handleDummyTestConnection(request, config);
    }
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
    if (!message || (message.type !== AI_MESSAGE && message.type !== LEGACY_PROVIDER_AI_MESSAGE)) return false;

    const startedAt = Date.now();
    const request = message.request || {};
    aiDebug('runtime:request', {
      requestId: request.requestId || null,
      type: message.type,
      op: request.op || null,
      provider: request.provider || null,
      timeoutMs: request.timeoutMs || null,
    });
    handleAi(message.request)
      .then((data) => {
        aiDebug('runtime:response:ok', {
          requestId: request.requestId || null,
          op: request.op || null,
          elapsedMs: Date.now() - startedAt,
          resultKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [],
        });
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        const normalized = normalizeAiError(error);
        aiDebug('runtime:response:error', {
          requestId: request.requestId || null,
          op: request.op || null,
          elapsedMs: Date.now() - startedAt,
          errorCode: normalized.code || null,
          message: normalized.message || '',
        });
        sendResponse({ ok: false, error: normalized });
      });
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
