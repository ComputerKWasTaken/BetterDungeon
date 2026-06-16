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
  const SDK_MESSAGE = 'ULTRASCRIPTS_SDK_REQUEST';
  const GEMINI_MESSAGE = 'ULTRASCRIPTS_AI_GEMINI';
  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const GEMINI_DEFAULT_TIMEOUT_MS = 120000;
  const GEMINI_PROMPT_MAX_CHARS = 12000;
  const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';
  const GEMINI_DEFAULT_MODEL_MODE = 'auto';
  const GEMINI_DEFAULT_THINKING_LEVEL = 'minimal';
  const GEMINI_THINKING_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high']);
  const GEMINI_OUTPUT_TYPES = Object.freeze(['text', 'json']);
  const GEMINI_AUTO_STEPDOWN_MODELS = Object.freeze([
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemma-4-31b-it',
    'gemma-4-26b-a4b-it',
  ]);
  const GEMINI_STORAGE_KEYS = {
    apiKey: 'ultrascripts_ai_gemini_api_key',
    model: 'ultrascripts_ai_gemini_model',
    modelMode: 'ultrascripts_ai_gemini_model_mode',
  };
  const DEFAULT_MAX_BODY_BYTES = 50000;
  const MAX_BODY_BYTES = 100000;
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  const SDK_SYNC_STORAGE_KEYS = {
    features: 'betterDungeonFeatures',
    ultrascriptsModules: 'ultrascripts_enabled_modules',
    ultrascriptsDebug: 'ultrascripts_debug',
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
    'widget',
    'webfetch',
    'clock',
    'sdk',
    'geolocation',
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
  const geminiRuntimeState = {
    lastResolvedModel: null,
    lastProviderModel: null,
    lastResolvedAtIso: null,
    lastFallbackMode: null,
    lastAttemptedModels: [],
  };

  function normalizeError(error) {
    if (error && typeof error === 'object') {
      const normalized = {
        code: typeof error.code === 'string' ? error.code : 'webfetch_failed',
        message: typeof error.message === 'string' ? error.message : 'WebFetch failed',
      };
      for (const key of ['retryable', 'status', 'statusText', 'retryAfterMs', 'backend', 'phase', 'task', 'detail']) {
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
    return {
      features: normalizeSdkFeatures(syncResult[SDK_SYNC_STORAGE_KEYS.features]),
      ultrascripts: {
        debug: !!syncResult[SDK_SYNC_STORAGE_KEYS.ultrascriptsDebug],
        modulePreferences: normalizeSdkUltrascriptsModules(syncResult[SDK_SYNC_STORAGE_KEYS.ultrascriptsModules]),
        webfetch: summarizeSdkWebFetchAllowlist(syncResult[SDK_SYNC_STORAGE_KEYS.webfetchAllowlist]),
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

  function geminiThinkingBudget(model, level) {
    const id = String(model || '').toLowerCase();
    if (level === 'minimal') return 0;
    if (level === 'low') return id.indexOf('flash-lite') !== -1 ? 512 : 1024;
    if (level === 'medium') return -1;
    return 8192;
  }

  function geminiThinkingConfigForModel(model, thinking) {
    const level = normalizeGeminiThinking(thinking).level;
    const family = geminiThinkingFamily(model);
    if (family === 'gemini-3' || family === 'gemini-3-pro') {
      const appliedLevel = family === 'gemini-3-pro' && level === 'minimal' ? 'low' : level;
      return {
        config: { thinkingLevel: appliedLevel },
        appliedLevel,
        appliedBudget: null,
        family,
      };
    }
    if (family === 'gemini-2.5') {
      const appliedBudget = geminiThinkingBudget(model, level);
      return {
        config: { thinkingBudget: appliedBudget },
        appliedLevel: null,
        appliedBudget,
        family,
      };
    }
    // Gemma 4 exposes thinking as an on/off toggle in the Gemini API:
    // omit thinkingConfig for off, or send thinkingLevel: "high" for on.
    if (family === 'gemma-4' && level !== 'minimal') {
      return {
        config: { thinkingLevel: 'high' },
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
      contents: [
        {
          role: 'user',
          parts: [{ text: task.prompt }],
        },
      ],
    };
    const generationConfig = {};

    if (task.output.type === 'json') {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseJsonSchema = task.output.schema;
    }

    const thinking = geminiThinkingConfigForModel(model, task.thinking);
    if (thinking.config) generationConfig.thinkingConfig = thinking.config;

    if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;

    return { payload, thinking };
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

  function geminiHttpError(status, statusText, bodyText) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText || '{}'); } catch { parsed = null; }
    const providerMessage = parsed?.error?.message || statusText || `HTTP ${status}`;
    const base = {
      status,
      statusText,
      backend: 'gemini',
      detail: providerMessage,
    };

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

  function extractGeminiText(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    if (!candidates.length) {
      const blockReason = data?.promptFeedback?.blockReason || null;
      throw {
        code: blockReason ? 'blocked' : 'invalid_response',
        message: blockReason ? `Gemini blocked the prompt: ${blockReason}` : 'Gemini returned no candidates.',
        retryable: false,
        backend: 'gemini',
      };
    }

    const candidate = candidates[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map(part => (!part?.thought && typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('');

    if (!text) {
      const finishReason = candidate?.finishReason || data?.promptFeedback?.blockReason || null;
      throw {
        code: finishReason && finishReason !== 'STOP' ? 'blocked' : 'invalid_response',
        message: finishReason
          ? `Gemini returned no text output (${finishReason}).`
          : 'Gemini returned no text output.',
        retryable: false,
        backend: 'gemini',
      };
    }

    return text;
  }

  async function callGeminiGenerateContent(settings, task) {
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_DEFAULT_TIMEOUT_MS);
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent`;
      const payloadInfo = geminiPayload(task, currentModel);

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
          signal: controller.signal,
        });

        const bodyText = await response.text();
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

        const text = extractGeminiText(data);
        const base = {
          backend: 'gemini',
          generatedAtIso: new Date().toISOString(),
          model: currentModel,
          providerModel: data?.modelVersion || currentModel,
          usage: data?.usageMetadata || null,
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
      } finally {
        clearTimeout(timer);
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
      return callGeminiGenerateContent(settings, task);
    }
    if (op === 'query') {
      const task = normalizeGeminiTask(request.task);
      return callGeminiGenerateContent(settings, task);
    }

    throw { code: 'invalid_args', message: `Gemini op '${op || '(empty)'}' is not supported`, retryable: false };
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

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== GEMINI_MESSAGE) return false;

    handleGemini(message.request)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  });

})();
