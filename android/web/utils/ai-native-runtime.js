// BetterDungeon Mobile - OpenAI-compatible native AI runtime.

(function () {
  'use strict';
  if (window.__BetterDungeonOpenAICompatibleRuntime) return;
  window.__BetterDungeonOpenAICompatibleRuntime = true;

  const runtime = chrome.runtime;
  const fetch = window.__bdNativeAiFetch;
  if (!runtime?.onMessage?.addListener) return;

  const MESSAGE_TYPE = 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE';
  const CHAT_PORT_NAME = 'BETTERDUNGEON_AI_CHAT_OPENAI_COMPATIBLE_V1';
  const PROVIDER_ID = 'openai-compatible';
  const CONFIG_KEY = 'ultrascripts_ai_endpoint_config_v1';
  const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
  const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
  const FALLBACK_MODELS = Object.freeze([
    DEFAULT_MODEL,
    'gemini-3.1-flash-lite',
    'gemma-4-31b-it',
    'gemma-4-26b-a4b-it',
  ]);
  const DEFAULT_INPUT_CAP_TOKENS = 128000;
  const DEFAULT_LIMITS = Object.freeze({
    maxInputTokens: DEFAULT_INPUT_CAP_TOKENS,
    maxInputChars: DEFAULT_INPUT_CAP_TOKENS * 3,
    maxOutputTokens: 2048,
  });
  const CHARS_PER_TOKEN = 3;
  const MIN_INPUT_CAP_TOKENS = 4000;
  const MAX_INPUT_CAP_TOKENS = 2000000;
  const MAX_DISCOVERED_OUTPUT_TOKENS = 16384;
  const CAPABILITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const CAPABILITY_FAILURE_TTL_MS = 5 * 60 * 1000;
  const CAPABILITY_STATUS_WAIT_MS = 1000;
  const CAPABILITY_CACHE_KEY = 'ultrascripts_ai_capability_cache_v1';
  const LEGACY_LOCAL_KEYS = Object.freeze([
    'ultrascripts_ai_gemini_api_key',
    'ultrascripts_ai_gemini_model',
    'ultrascripts_ai_gemini_model_mode',
    'ultrascripts_ai_openai_base_url',
    'ultrascripts_ai_openai_api_key',
    'ultrascripts_ai_openai_model',
  ]);
  const LEGACY_SYNC_KEYS = Object.freeze(['ultrascripts_ai_default_provider']);
  const SERVICES = Object.freeze(['gemini', 'openrouter', 'custom']);
  const THINKING_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high']);
  const OUTPUT_TYPES = Object.freeze(['text', 'json']);
  const TIMEOUT_MS = 120000;
  const KEEPALIVE_MS = 20000;
  const START_TIMEOUT_MS = 5000;
  const TERMINAL_GRACE_MS = 1000;
  const PROMPT_MAX_CHARS = 12000;
  const activePorts = new Set();
  const runtimeState = {
    service: null,
    lastModel: null,
    lastProviderModel: null,
    lastResolvedAtIso: null,
    lastFallbackMode: null,
    lastAttemptedModels: [],
  };
  const capabilityCache = new Map();
  let capabilityHydrationPromise = null;
  const capabilityRefreshPromises = new Map();
  let capabilityGeneration = 0;

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function normalizeError(error) {
    if (!isObject(error)) return { code: 'backend_failed', message: String(error || 'AI request failed.') };
    const out = {
      code: typeof error.code === 'string' ? error.code : 'backend_failed',
      message: typeof error.message === 'string' ? error.message : 'AI request failed.',
    };
    for (const key of [
      'retryable', 'status', 'statusText', 'retryAfterMs', 'backend', 'service',
      'phase', 'task', 'detail', 'model', 'providerReason',
    ]) {
      if (error[key] !== undefined) out[key] = cloneJson(error[key]);
    }
    return out;
  }

  function storageArea(name) {
    const api =
      (typeof browser !== 'undefined' && browser?.storage) ? browser :
      (typeof chrome !== 'undefined' && chrome?.storage) ? chrome : null;
    return api?.storage?.[name] || null;
  }

  function storageCall(areaName, method, value, fallback) {
    const area = storageArea(areaName);
    if (!area?.[method]) return Promise.resolve(fallback);
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        const lastError =
          (typeof chrome !== 'undefined' && chrome.runtime?.lastError) ||
          (typeof browser !== 'undefined' && browser.runtime?.lastError) || null;
        if (lastError) reject(lastError);
        else resolve(result === undefined ? fallback : result);
      };
      try {
        const maybePromise = area[method](value, done);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done, reject);
        }
      } catch (error) {
        try {
          const maybePromise = area[method](value);
          if (maybePromise && typeof maybePromise.then === 'function') maybePromise.then(done, reject);
          else done(fallback);
        } catch (innerError) {
          reject(innerError);
        }
      }
    });
  }

  const storageGet = (area, keys) => storageCall(area, 'get', keys, {});
  const storageSet = (area, value) => storageCall(area, 'set', value, undefined);
  const storageRemove = (area, keys) => storageCall(area, 'remove', keys, undefined);

  let cleanupPromise = null;
  function cleanLegacyStorage() {
    if (!cleanupPromise) {
      cleanupPromise = Promise.all([
        storageRemove('local', LEGACY_LOCAL_KEYS),
        storageRemove('sync', LEGACY_SYNC_KEYS),
      ]).then(() => undefined);
    }
    return cleanupPromise;
  }

  function defaultConfig() {
    return {
      version: 1,
      activeService: 'gemini',
      inputCapTokens: 0,
      profiles: {
        gemini: { apiKey: '', modelMode: 'auto', model: DEFAULT_MODEL },
        openrouter: { apiKey: '', model: '' },
        custom: { baseUrl: '', apiKey: '', model: '' },
      },
    };
  }

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeCap(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? Math.min(MAX_INPUT_CAP_TOKENS, Math.max(MIN_INPUT_CAP_TOKENS, Math.floor(number)))
      : 0;
  }

  function normalizeBaseUrl(value) {
    return trim(value).replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  }

  function normalizeConfig(value) {
    const defaults = defaultConfig();
    const raw = isObject(value) ? value : {};
    const profiles = isObject(raw.profiles) ? raw.profiles : {};
    const gemini = isObject(profiles.gemini) ? profiles.gemini : {};
    const openrouter = isObject(profiles.openrouter) ? profiles.openrouter : {};
    const custom = isObject(profiles.custom) ? profiles.custom : {};
    const activeService = SERVICES.includes(raw.activeService) ? raw.activeService : 'gemini';
    const legacyCaps = [gemini.maxInputTokens, openrouter.maxInputTokens, custom.maxInputTokens].map(normalizeCap);
    return {
      version: 1,
      activeService,
      inputCapTokens: normalizeCap(raw.inputCapTokens) ||
        legacyCaps[SERVICES.indexOf(activeService)] || legacyCaps.find(Boolean) || 0,
      profiles: {
        gemini: {
          apiKey: trim(gemini.apiKey),
          modelMode: gemini.modelMode === 'manual' ? 'manual' : 'auto',
          model: trim(gemini.model).replace(/^models\//, '') ||
            (gemini.modelMode === 'manual' ? '' : defaults.profiles.gemini.model),
        },
        openrouter: {
          apiKey: trim(openrouter.apiKey),
          model: trim(openrouter.model),
        },
        custom: {
          baseUrl: normalizeBaseUrl(custom.baseUrl),
          apiKey: trim(custom.apiKey),
          model: trim(custom.model),
        },
      },
    };
  }

  async function getConfig() {
    await cleanLegacyStorage();
    const local = await storageGet('local', CONFIG_KEY);
    const raw = local?.[CONFIG_KEY];
    const config = normalizeConfig(raw);
    if (isObject(raw) && (raw.inputCapTokens === undefined ||
      Object.values(raw.profiles || {}).some(profile => profile?.maxInputTokens !== undefined))) {
      await storageSet('local', { [CONFIG_KEY]: config });
    }
    return config;
  }

  async function saveConfig(value) {
    await cleanLegacyStorage();
    const local = await storageGet('local', CONFIG_KEY);
    const previous = normalizeConfig(local?.[CONFIG_KEY]);
    const update = isObject(value) ? value : {};
    const updateProfiles = isObject(update.profiles) ? update.profiles : {};
    const merged = cloneJson(previous);
    if (SERVICES.includes(update.activeService)) merged.activeService = update.activeService;
    if (update.inputCapTokens !== undefined) merged.inputCapTokens = update.inputCapTokens;
    for (const service of SERVICES) {
      if (!isObject(updateProfiles[service])) continue;
      for (const [key, fieldValue] of Object.entries(updateProfiles[service])) {
        if (fieldValue !== undefined) merged.profiles[service][key] = fieldValue;
      }
    }
    const config = normalizeConfig(merged);
    await storageSet('local', { [CONFIG_KEY]: config });
    resetRuntimeState();
    return config;
  }

  function settingsFor(config) {
    const service = config.activeService;
    const profile = config.profiles[service];
    if (service === 'gemini') {
      const modelMode = profile.modelMode;
      return {
        service,
        inputCapTokens: config.inputCapTokens,
        profile,
        baseUrl: GEMINI_BASE_URL,
        apiKey: profile.apiKey,
        model: modelMode === 'auto' ? DEFAULT_MODEL : profile.model,
        modelMode,
        keyConfigured: !!profile.apiKey,
        configured: !!profile.apiKey && (modelMode === 'auto' || !!profile.model),
      };
    }
    if (service === 'openrouter') {
      return {
        service,
        inputCapTokens: config.inputCapTokens,
        profile,
        baseUrl: OPENROUTER_BASE_URL,
        apiKey: profile.apiKey,
        model: profile.model,
        modelMode: 'manual',
        keyConfigured: !!profile.apiKey,
        configured: !!(profile.apiKey && profile.model),
      };
    }
    const https = /^https:\/\/[^\s/$.?#].*/i.test(profile.baseUrl);
    return {
      service,
      inputCapTokens: config.inputCapTokens,
      profile,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      modelMode: 'manual',
      keyConfigured: !!profile.apiKey,
      configured: !!(https && profile.model),
    };
  }

  function modelsFor(settings) {
    return settings.service === 'gemini' && settings.modelMode === 'auto'
      ? [...FALLBACK_MODELS]
      : [settings.model];
  }

  function capabilityEntry(model, cache) {
    const name = String(model || '').replace(/^models\//, '').toLowerCase();
    const key = Object.keys(cache?.entries || {}).find(candidate =>
      name === candidate || name.startsWith(`${candidate}-`)
    );
    return key ? { ...cache.entries[key], model: key } : null;
  }

  function limitsFromCapability(entry, settings) {
    const inputCap = normalizeCap(settings?.inputCapTokens) || DEFAULT_INPUT_CAP_TOKENS;
    if (!entry) {
      return {
        ...DEFAULT_LIMITS,
        maxInputTokens: inputCap,
        maxInputChars: inputCap * CHARS_PER_TOKEN,
        model: null,
        source: 'default',
        discoveryTimestamp: null,
      };
    }
    const maxOutputTokens = entry.outputDiscovered
      ? Math.min(MAX_DISCOVERED_OUTPUT_TOKENS, Math.max(1, entry.outputTokens))
      : DEFAULT_LIMITS.maxOutputTokens;
    return {
      maxInputTokens: inputCap,
      maxOutputTokens,
      maxInputChars: inputCap * CHARS_PER_TOKEN,
      model: entry.model,
      source: entry.outputDiscovered ? 'discovered' : 'partial',
    };
  }

  function resolveLimits(models, settings) {
    const cache = capabilityCache.get(settings?.service);
    const resolved = models.map(model => limitsFromCapability(capabilityEntry(model, cache), settings));
    const maxInputChars = resolved[0]?.maxInputChars || DEFAULT_LIMITS.maxInputChars;
    const maxInputTokens = resolved[0]?.maxInputTokens || DEFAULT_LIMITS.maxInputTokens;
    const maxOutputTokens = Math.min(...resolved.map(item => item.maxOutputTokens));
    const bindingIndexes = resolved
      .map((item, index) => item.maxInputChars === maxInputChars && item.maxOutputTokens === maxOutputTokens ? index : -1)
      .filter(index => index >= 0);
    return {
      maxInputChars,
      maxOutputTokens,
      model: models.length === 1 ? (resolved[0].model || models[0]) : (bindingIndexes.length ? resolved[bindingIndexes[0]].model : null),
      maxInputTokens,
      source: resolved.every(item => item.source === 'discovered') ? 'discovered'
        : resolved.some(item => item.source === 'partial') ? 'partial' : 'default',
      discoveryTimestamp: cache?.fetchedAtIso || null,
    };
  }

  function parseCapabilities(service, payload) {
    const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.models) ? payload.models : []));
    const entries = {};
    for (const row of rows) {
      const model = trim(row?.id || row?.name).replace(/^models\//, '');
      if (!model) continue;
      const outputTokens = Number(row.outputTokenLimit || row.top_provider?.max_completion_tokens || row.max_completion_tokens || 0);
      const thinking = service === 'gemini' && typeof row.thinking === 'boolean' ? row.thinking :
        service === 'openrouter' && Array.isArray(row.supported_parameters)
          ? row.supported_parameters.includes('reasoning') : undefined;
      if (!outputTokens && thinking === undefined) continue;
      const entry = {
        outputTokens,
        outputDiscovered: outputTokens > 0,
      };
      if (thinking !== undefined) entry.thinking = thinking;
      entries[model.toLowerCase()] = entry;
    }
    return entries;
  }

  function hydrateCapabilities() {
    if (!capabilityHydrationPromise) {
      capabilityHydrationPromise = storageGet('local', CAPABILITY_CACHE_KEY).then(stored => {
        for (const [service, value] of Object.entries(stored?.[CAPABILITY_CACHE_KEY] || {})) {
          if (value?.entries && Number.isFinite(value.fetchedAtMs)) capabilityCache.set(service, value);
        }
      }).catch(() => {}).then(() => undefined);
    }
    return capabilityHydrationPromise;
  }

  function refreshCapabilities(settings) {
    if (!settings.configured) return Promise.resolve(null);
    return hydrateCapabilities().then(() => {
      const now = Date.now();
      const existing = capabilityCache.get(settings.service);
      if (existing?.refreshing) return capabilityRefreshPromises.get(settings.service) || null;
      const ttl = existing?.failed ? CAPABILITY_FAILURE_TTL_MS : CAPABILITY_CACHE_TTL_MS;
      if (existing && now - existing.fetchedAtMs < ttl) return null;
      const cache = existing || { entries: {}, fetchedAtMs: 0, fetchedAtIso: null };
      cache.refreshing = true;
      capabilityCache.set(settings.service, cache);
      const generation = capabilityGeneration;
      const url = settings.service === 'gemini'
        ? `${GEMINI_BASE_URL.replace(/\/openai$/, '')}/models`
        : settings.service === 'openrouter'
          ? `${OPENROUTER_BASE_URL}/models`
          : `${settings.baseUrl}/models`;
      const request = fetch(url, {
        method: 'GET',
        headers: settings.service === 'gemini'
          ? { 'x-goog-api-key': settings.apiKey }
          : settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
        credentials: 'omit',
        cache: 'no-store',
      }).then(async response => {
        if (!response?.ok) throw new Error('Capability discovery failed.');
        const payload = await response.json();
        if (generation !== capabilityGeneration) return;
        const fetchedAtIso = new Date().toISOString();
        capabilityCache.set(settings.service, {
          entries: parseCapabilities(settings.service, payload),
          fetchedAtMs: Date.now(),
          fetchedAtIso,
        });
        persistCapabilityCache();
      }).catch(() => {
        if (generation !== capabilityGeneration) return;
        capabilityCache.set(settings.service, { entries: {}, fetchedAtMs: Date.now(), fetchedAtIso: null, failed: true });
        persistCapabilityCache();
      }).finally(() => {
        if (capabilityRefreshPromises.get(settings.service) === request) {
          capabilityRefreshPromises.delete(settings.service);
        }
      });
      capabilityRefreshPromises.set(settings.service, request);
      return request;
    });
  }

  function waitForCapability(promise) {
    if (!promise) return Promise.resolve(false);
    return Promise.race([
      promise.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), CAPABILITY_STATUS_WAIT_MS)),
    ]);
  }

  async function ensureCapabilities(settings) {
    await hydrateCapabilities();
    const refreshPromise = refreshCapabilities(settings);
    const cache = capabilityCache.get(settings.service);
    const hasEntry = modelsFor(settings).some(model => capabilityEntry(model, cache));
    if (hasEntry || !refreshPromise) return false;
    return !(await waitForCapability(refreshPromise)) &&
      !modelsFor(settings).some(model => capabilityEntry(model, capabilityCache.get(settings.service)));
  }

  function capabilityPending(settings) {
    const cache = capabilityCache.get(settings.service);
    return settings.configured && cache?.refreshing === true &&
      !modelsFor(settings).some(model => capabilityEntry(model, cache));
  }

  function persistCapabilityCache() {
    const value = {};
    for (const [service, entry] of capabilityCache) value[service] = entry;
    storageSet('local', { [CAPABILITY_CACHE_KEY]: value }).catch(() => {});
  }

  function thinkingLevelsFor(settings) {
    const cache = capabilityCache.get(settings.service);
    const entries = modelsFor(settings).map(model => capabilityEntry(model, cache)).filter(Boolean);
    if (!entries.length) return settings.service === 'gemini' ? [...THINKING_LEVELS] : [];
    return entries.some(entry => entry.thinking) ? [...THINKING_LEVELS] : [];
  }

  function resetRuntimeState() {
    capabilityCache.clear();
    capabilityHydrationPromise = null;
    capabilityRefreshPromises.clear();
    capabilityGeneration += 1;
    runtimeState.service = null;
    runtimeState.lastModel = null;
    runtimeState.lastProviderModel = null;
    runtimeState.lastResolvedAtIso = null;
    runtimeState.lastFallbackMode = null;
    runtimeState.lastAttemptedModels = [];
  }

  function rememberSuccess(settings, result) {
    runtimeState.service = settings.service;
    runtimeState.lastModel = result.model || null;
    runtimeState.lastProviderModel = result.providerModel || null;
    runtimeState.lastResolvedAtIso = result.generatedAtIso || new Date().toISOString();
    runtimeState.lastFallbackMode = result.fallback?.mode || settings.modelMode;
    runtimeState.lastAttemptedModels = [...(result.fallback?.attemptedModels || [result.model])];
  }

  function publicConfig(config, settings, unresolved = false) {
    const profile = config.profiles[settings.service];
    const fallbackChain = settings.service === 'gemini' && settings.modelMode === 'auto' ? [...FALLBACK_MODELS] : [settings.model];
    return {
      provider: PROVIDER_ID,
      backend: PROVIDER_ID,
      service: settings.service,
      api: 'chat-completions',
      stateless: true,
      keyConfigured: settings.keyConfigured,
      baseUrl: settings.baseUrl,
      baseUrlLocked: settings.service !== 'custom',
      modelMode: settings.modelMode,
      model: settings.model,
      inputCapTokens: config.inputCapTokens,
      selectedModel: settings.model,
      thinkingDefault: AI_DEFAULT_THINKING_LEVEL,
      thinkingLevels: thinkingLevelsFor(settings),
      activeModel: runtimeState.service === settings.service ? runtimeState.lastModel : null,
      lastResolvedModel: runtimeState.service === settings.service ? runtimeState.lastModel : null,
      lastProviderModel: runtimeState.service === settings.service ? runtimeState.lastProviderModel : null,
      lastResolvedAtIso: runtimeState.service === settings.service ? runtimeState.lastResolvedAtIso : null,
      fallbackChain,
      limits: {
        ...resolveLimits(fallbackChain, settings),
        resolved: !unresolved,
        resolution: unresolved ? 'pending' : 'settled',
      },
      lastAttemptedModels: runtimeState.service === settings.service ? [...runtimeState.lastAttemptedModels] : [],
      profiles: {
        gemini: {
          keyConfigured: !!config.profiles.gemini.apiKey,
          modelMode: config.profiles.gemini.modelMode,
          model: config.profiles.gemini.model,
          baseUrl: GEMINI_BASE_URL,
        },
        openrouter: {
          keyConfigured: !!config.profiles.openrouter.apiKey,
          model: config.profiles.openrouter.model,
          baseUrl: OPENROUTER_BASE_URL,
        },
        custom: {
          keyConfigured: !!config.profiles.custom.apiKey,
          model: config.profiles.custom.model,
          baseUrl: config.profiles.custom.baseUrl,
        },
      },
      profile: {
        ...profile,
        apiKey: undefined,
        keyConfigured: settings.keyConfigured,
      },
    };
  }

  function statusSnapshot(config, settings = settingsFor(config), unresolved = false) {
    unresolved ||= capabilityPending(settings);
    const ready = settings.configured;
    const reason = ready ? null : 'ai_backend_not_configured';
    return {
      provider: PROVIDER_ID,
      backend: PROVIDER_ID,
      service: settings.service,
      ready,
      available: ready,
      reason,
      supports: { text: true, json: true, thinking: thinkingLevelsFor(settings).length > 0 },
      limits: { ...resolveLimits(modelsFor(settings), settings), resolved: !unresolved, resolution: unresolved ? 'pending' : 'settled' },
      config: publicConfig(config, settings, unresolved),
      message: ready
        ? `${settings.service} is configured through the OpenAI-compatible endpoint.`
        : `Configure the ${settings.service} profile to enable AI queries.`,
    };
  }

  async function status(config, settings = settingsFor(config)) {
    const unresolved = settings.configured ? await ensureCapabilities(settings) : false;
    return statusSnapshot(config, settings, unresolved);
  }

  function normalizeThinking(value) {
    if (value === undefined || value === null) return { level: AI_DEFAULT_THINKING_LEVEL };
    const raw = typeof value === 'string' ? value : value?.level;
    const level = trim(raw || AI_DEFAULT_THINKING_LEVEL).toLowerCase();
    if (!THINKING_LEVELS.includes(level)) {
      throw { code: 'invalid_args', message: `thinking.level must be one of: ${THINKING_LEVELS.join(', ')}`, retryable: false };
    }
    return { level };
  }

  const AI_DEFAULT_THINKING_LEVEL = 'minimal';

  function normalizeTask(task) {
    if (!isObject(task) || typeof task.prompt !== 'string' || !task.prompt.trim()) {
      throw { code: 'invalid_args', message: 'prompt is required', retryable: false };
    }
    if (task.prompt.length > PROMPT_MAX_CHARS) {
      throw { code: 'invalid_args', message: `prompt must be ${PROMPT_MAX_CHARS} characters or less`, retryable: false };
    }
    const output = isObject(task.output) ? task.output : { type: 'text' };
    const type = output.type || 'text';
    if (!OUTPUT_TYPES.includes(type)) {
      throw { code: 'invalid_args', message: `output.type must be one of: ${OUTPUT_TYPES.join(', ')}`, retryable: false };
    }
    if (type === 'json' && !isObject(output.schema)) {
      throw { code: 'invalid_args', message: 'output.schema is required when output.type is json', retryable: false };
    }
    return {
      id: typeof task.id === 'string' ? task.id : null,
      prompt: task.prompt,
      promptChars: Number(task.promptChars || task.prompt.length),
      thinking: normalizeThinking(task.thinking),
      output: { type, schema: output.schema ? cloneJson(output.schema) : undefined },
    };
  }

  function normalizeTools(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 16) {
      throw { code: 'invalid_args', message: 'tools must contain at most 16 entries', retryable: false };
    }
    return value.map((tool, index) => {
      if (!isObject(tool) || !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name || '') ||
          typeof tool.description !== 'string' || !tool.description.trim() || !isObject(tool.parameters)) {
        throw { code: 'invalid_args', message: `tools[${index}] is invalid`, retryable: false };
      }
      return { name: tool.name, description: tool.description.trim(), parameters: cloneJson(tool.parameters) };
    });
  }

  function normalizeToolResults(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 16) {
      throw { code: 'invalid_args', message: 'toolResults must contain at most 16 entries', retryable: false };
    }
    return value.map((result, index) => {
      if (!isObject(result) || !trim(result.callId) || !/^[a-z][a-z0-9_]{0,63}$/.test(result.name || '')) {
        throw { code: 'invalid_args', message: `toolResults[${index}] is invalid`, retryable: false };
      }
      return { callId: trim(result.callId), name: result.name, result: cloneJson(result.result), isError: result.isError === true };
    });
  }

  function normalizeContinuation(value) {
    if (value === undefined || value === null) return null;
    if (!isObject(value) || value.provider !== PROVIDER_ID || !SERVICES.includes(value.service) || !Array.isArray(value.messages)) {
      throw { code: 'invalid_args', message: 'OpenAI-compatible continuation state is invalid.', retryable: false };
    }
    return cloneJson(value);
  }

  function normalizeChatTask(task) {
    if (!isObject(task) || task.op !== 'chat') {
      throw { code: 'invalid_args', message: 'chat task op must be chat', retryable: false };
    }
    if (typeof task.systemInstruction !== 'string' || !task.systemInstruction.trim()) {
      throw { code: 'invalid_args', message: 'systemInstruction is required', retryable: false };
    }
    if (!Array.isArray(task.messages) || !task.messages.length) {
      throw { code: 'invalid_args', message: 'messages must be a non-empty array', retryable: false };
    }
    const messages = task.messages.map((message, index) => {
      if (!isObject(message) || !['user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string' || !message.content.trim()) {
        throw { code: 'invalid_args', message: `messages[${index}] is invalid`, retryable: false };
      }
      return { role: message.role, content: message.content };
    });
    if (messages.at(-1)?.role !== 'user') {
      throw { code: 'invalid_args', message: 'the final chat message must have role user', retryable: false };
    }
    const maxInputChars = Number(task.budget?.maxInputChars);
    const maxOutputTokens = Number(task.budget?.maxOutputTokens);
    if (!Number.isSafeInteger(maxInputChars) || maxInputChars <= 0 ||
        !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      throw { code: 'invalid_args', message: 'chat budget must contain positive integers', retryable: false };
    }
    const tools = normalizeTools(task.tools);
    const toolResults = normalizeToolResults(task.toolResults);
    const continuation = normalizeContinuation(task.continuation);
    if (toolResults.length && !continuation) {
      throw { code: 'invalid_args', message: 'continuation is required with toolResults', retryable: false };
    }
    const inputChars = task.systemInstruction.length + messages.reduce((n, message) => n + message.content.length, 0) +
      JSON.stringify(tools).length + JSON.stringify(toolResults).length + JSON.stringify(continuation || '').length;
    if (inputChars > maxInputChars) {
      throw { code: 'invalid_args', message: `chat input must be ${maxInputChars} characters or less`, retryable: false };
    }
    return {
      id: trim(task.id) || null,
      messages,
      systemInstruction: task.systemInstruction,
      systemInstructionChars: task.systemInstruction.length,
      inputChars,
      messageCount: messages.length,
      budget: { maxInputChars, maxOutputTokens },
      thinking: normalizeThinking(task.thinking),
      tools,
      toolResults,
      continuation,
    };
  }

  function schemaInstruction(schema) {
    return `Respond with one JSON object conforming to this JSON schema. Output only JSON.\nSchema: ${JSON.stringify(schema)}`;
  }

  function applyThinking(payload, settings, model, thinking) {
    if (settings.service !== 'gemini') return null;
    const requestedLevel = normalizeThinking(thinking).level;
    if (/^gemma-/i.test(model)) {
      if (requestedLevel !== 'minimal') {
        payload.extra_body = {
          ...(payload.extra_body || {}),
          google: {
            ...(payload.extra_body?.google || {}),
            thinking_config: { thinking_level: 'high' },
          },
        };
      }
      return {
        requestedLevel,
        appliedLevel: requestedLevel === 'minimal' ? null : 'high',
        family: 'gemma-4',
        applied: requestedLevel !== 'minimal',
        defaulted: requestedLevel === AI_DEFAULT_THINKING_LEVEL,
        toggle: true,
      };
    }
    payload.reasoning_effort = requestedLevel;
    return {
      requestedLevel,
      appliedLevel: requestedLevel,
      family: 'gemini',
      applied: true,
      defaulted: requestedLevel === AI_DEFAULT_THINKING_LEVEL,
    };
  }

  function queryPayload(task, settings, model) {
    const messages = [];
    if (task.output.type === 'json' && settings.service !== 'gemini') {
      messages.push({ role: 'system', content: schemaInstruction(task.output.schema) });
    }
    messages.push({ role: 'user', content: task.prompt });
    const payload = { model, messages, stream: false };
    if (task.output.type === 'json') {
      payload.response_format = settings.service === 'gemini'
        ? { type: 'json_schema', json_schema: { name: 'betterdungeon_response', schema: cloneJson(task.output.schema) } }
        : { type: 'json_object' };
    }
    const thinking = applyThinking(payload, settings, model, task.thinking);
    return { payload, thinking };
  }

  function chatPayload(task, settings, model) {
    const continuationMessages = [];
    if (task.continuation) {
      if (task.continuation.service !== settings.service) {
        throw { code: 'invalid_args', message: 'Continuation belongs to a different endpoint service.', retryable: false };
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
      payload.tools = task.tools.map(tool => ({ type: 'function', function: cloneJson(tool) }));
      payload.tool_choice = 'auto';
    }
    const thinking = applyThinking(payload, settings, model, task.thinking);
    return { payload, thinking, continuationMessages };
  }

  function requestHeaders(settings) {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    return headers;
  }

  function retryAfterMs(response) {
    const value = response?.headers?.get?.('retry-after');
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(value);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
  }

  function blockedError(detail, model, service, code = 'safety_blocked') {
    return {
      code,
      message: code === 'prohibited_content'
        ? 'Gemini rejected the request as prohibited content.'
        : 'The selected service blocked the request with a content filter.',
      retryable: false,
      backend: PROVIDER_ID,
      service,
      providerReason: code === 'prohibited_content' ? 'PROHIBITED_CONTENT' : 'content_filter',
      detail,
      model,
    };
  }

  function httpError(response, bodyText, model, settings) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText || '{}'); } catch { /* noop */ }
    const detail = parsed?.error?.message || parsed?.error?.status ||
      (typeof parsed?.error === 'string' ? parsed.error : '') || response.statusText || `HTTP ${response.status}`;
    const statusText = `${parsed?.error?.status || ''} ${detail}`;
    const base = {
      status: response.status,
      statusText: response.statusText,
      retryAfterMs: retryAfterMs(response),
      backend: PROVIDER_ID,
      service: settings.service,
      detail,
      model,
    };
    if (/PROHIBITED_CONTENT/i.test(statusText)) return { ...base, ...blockedError(detail, model, settings.service, 'prohibited_content') };
    if (/content_filter|SAFETY|content management policy/i.test(statusText)) {
      return { ...base, ...blockedError(detail, model, settings.service) };
    }
    if (response.status === 401 || response.status === 403) {
      return { ...base, code: 'auth_failed', message: `${settings.service} API credentials were rejected.`, retryable: false };
    }
    if (response.status === 404) return { ...base, code: 'invalid_args', message: `Endpoint or model not found: ${detail}`, retryable: false };
    if (response.status === 429) return { ...base, code: 'rate_limit', message: `${settings.service} rate limit reached.`, retryable: true };
    if (response.status === 400) return { ...base, code: 'invalid_args', message: detail, retryable: false };
    if (response.status >= 500) return { ...base, code: 'backend_failed', message: `${settings.service} service failed.`, retryable: true };
    return { ...base, code: 'backend_failed', message: detail, retryable: false };
  }

  function notConfigured(settings) {
    return {
      code: 'not_configured',
      message: `The ${settings.service} endpoint profile is incomplete.`,
      retryable: false,
      backend: PROVIDER_ID,
      service: settings.service,
    };
  }

  async function fetchWithTimeout(url, init, signal) {
    const controller = signal ? null : new AbortController();
    const requestSignal = signal || controller.signal;
    const timer = setTimeout(() => controller?.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: requestSignal });
    } finally {
      clearTimeout(timer);
    }
  }

  function resultBase(settings, model, providerModel, usage, thinking, attemptedModels) {
    const generatedAtIso = new Date().toISOString();
    return {
      provider: PROVIDER_ID,
      backend: PROVIDER_ID,
      service: settings.service,
      generatedAtIso,
      model,
      providerModel: providerModel || model,
      usage: usage || null,
      thinking,
      fallback: {
        mode: settings.modelMode,
        attemptedModels: [...attemptedModels],
        selectedModel: attemptedModels[0],
        resolvedModel: model,
        steppedDown: attemptedModels.length > 1,
      },
    };
  }

  async function queryAttempt(settings, task, model, attemptedModels) {
    const info = queryPayload(task, settings, model);
    let response;
    try {
      response = await fetchWithTimeout(`${settings.baseUrl}/chat/completions`, {
        method: 'POST', headers: requestHeaders(settings), body: JSON.stringify(info.payload),
        credentials: 'omit', cache: 'no-store',
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw { code: 'timeout', message: `OpenAI-compatible query timed out after ${TIMEOUT_MS} ms.`, retryable: true, backend: PROVIDER_ID, service: settings.service, model };
      }
      throw { code: 'backend_failed', message: error?.message || 'OpenAI-compatible request failed.', retryable: true, backend: PROVIDER_ID, service: settings.service, model };
    }
    const bodyText = await response.text();
    if (!response.ok) throw httpError(response, bodyText, model, settings);
    let data;
    try { data = JSON.parse(bodyText || '{}'); } catch (error) {
      throw { code: 'invalid_response', message: 'OpenAI-compatible provider returned invalid JSON.', retryable: false, backend: PROVIDER_ID, service: settings.service, detail: error?.message, model };
    }
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    if (choice?.finish_reason === 'content_filter') throw blockedError('content_filter', model, settings.service);
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!text) throw { code: 'invalid_response', message: 'OpenAI-compatible provider returned no message content.', retryable: false, backend: PROVIDER_ID, service: settings.service, model };
    const finishReason = trim(choice?.finish_reason) || null;
    const base = resultBase(settings, model, data?.model, data?.usage, info.thinking, attemptedModels);
    const result = task.output.type === 'json'
      ? (() => {
          try { return { ...base, json: JSON.parse(text), text, finishReason, outputTruncated: finishReason === 'length' }; }
          catch (error) { throw { code: 'invalid_response', message: 'OpenAI-compatible provider returned invalid JSON text.', retryable: false, backend: PROVIDER_ID, service: settings.service, detail: error?.message, model }; }
        })()
      : { ...base, text, finishReason, outputTruncated: finishReason === 'length' };
    rememberSuccess(settings, result);
    return result;
  }

  async function callQuery(config, task) {
    const settings = settingsFor(config);
    if (!settings.configured) throw notConfigured(settings);
    const attempted = [];
    const models = modelsFor(settings);
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      attempted.push(model);
      try {
        const result = await queryAttempt(settings, task, model, attempted);
        result.status = statusSnapshot(config, settings);
        return result;
      } catch (error) {
        if (!(error?.code === 'rate_limit' && settings.service === 'gemini' && settings.modelMode === 'auto' && index < models.length - 1)) throw error;
      }
    }
    throw { code: 'rate_limit', message: 'All automatic Gemini models are rate limited.', retryable: true, backend: PROVIDER_ID, service: 'gemini' };
  }

  function takeSseFrame(buffer) {
    const match = /\r?\n\r?\n/.exec(buffer);
    if (!match) return null;
    return { frame: buffer.slice(0, match.index), rest: buffer.slice(match.index + match[0].length) };
  }

  function parseSseFrame(frame) {
    const data = String(frame || '').split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data) return null;
    if (data.trim() === '[DONE]') return { done: true };
    try { return { event: JSON.parse(data) }; }
    catch (error) { throw { code: 'invalid_response', message: 'OpenAI-compatible stream returned malformed JSON.', retryable: false, backend: PROVIDER_ID, detail: error?.message }; }
  }

  function mergeOpaque(target, source) {
    if (!isObject(source)) return target;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (isObject(value)) {
        target[key] = mergeOpaque(isObject(target[key]) ? target[key] : {}, value);
      } else if (Array.isArray(value)) {
        target[key] = cloneJson(value);
      } else {
        target[key] = value;
      }
    }
    return target;
  }

  function mergeToolCall(target, part) {
    const opaque = cloneJson(part || {});
    delete opaque.index;
    delete opaque.function;
    mergeOpaque(target, opaque);
    if (isObject(part?.function)) {
      if (!isObject(target.function)) target.function = {};
      const functionOpaque = cloneJson(part.function);
      delete functionOpaque.name;
      delete functionOpaque.arguments;
      mergeOpaque(target.function, functionOpaque);
      if (typeof part.function.name === 'string') target.function.name = `${target.function.name || ''}${part.function.name}`;
      if (typeof part.function.arguments === 'string') {
        const existing = target.function.arguments || '';
        const incoming = part.function.arguments;
        const parsedExisting = (() => {
          try { return JSON.parse(existing); } catch { return undefined; }
        })();
        const parsedIncoming = (() => {
          try { return JSON.parse(incoming); } catch { return undefined; }
        })();
        if (isObject(parsedIncoming)) {
          target.function.arguments = isObject(parsedExisting)
            && JSON.stringify(parsedExisting) === JSON.stringify(parsedIncoming)
            ? existing
            : incoming;
        } else if (isObject(parsedExisting)) {
          target.function.arguments = existing;
        } else {
          target.function.arguments = `${existing}${incoming}`;
        }
      }
    }
    return target;
  }

  async function readStream(response, model, settings, onDelta) {
    if (!response?.body?.getReader) throw { code: 'invalid_response', message: 'OpenAI-compatible provider did not return a readable stream.', retryable: false, backend: PROVIDER_ID, service: settings.service, model };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let sequence = 0;
    let providerModel = model;
    let usage = null;
    let finishReason = null;
    let sawDone = false;
    const assistantMessage = { role: 'assistant', content: null, tool_calls: [] };
    const toolCalls = new Map();
    const toolCallAliases = new Map();
    let toolCallOrder = 0;

    const handle = (event) => {
      if (!isObject(event)) return;
      if (event.error) {
        const detail = event.error?.message || event.error?.status || 'OpenAI-compatible stream failed.';
        if (/PROHIBITED_CONTENT/i.test(detail)) throw blockedError(detail, model, settings.service, 'prohibited_content');
        if (/content_filter|SAFETY/i.test(detail)) throw blockedError(detail, model, settings.service);
        throw { code: 'backend_failed', message: detail, retryable: true, backend: PROVIDER_ID, service: settings.service, detail, model };
      }
      if (trim(event.model)) providerModel = event.model;
      if (isObject(event.usage)) usage = cloneJson(event.usage);
      const choice = Array.isArray(event.choices) ? event.choices[0] : null;
      if (!choice) return;
      if (trim(choice.finish_reason)) finishReason = choice.finish_reason;
      const delta = isObject(choice.delta) ? choice.delta : {};
      const opaqueDelta = cloneJson(delta);
      delete opaqueDelta.content;
      delete opaqueDelta.tool_calls;
      delete opaqueDelta.role;
      mergeOpaque(assistantMessage, opaqueDelta);
      if (typeof delta.role === 'string') assistantMessage.role = delta.role;
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        assistantMessage.content = text;
        sequence += 1;
        onDelta(delta.content, sequence);
      }
      const parts = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      parts.forEach((part, order) => {
        const id = trim(part?.id);
        const index = Number.isSafeInteger(part?.index) ? part.index : null;
        const candidates = [
          id ? `id:${id}` : null,
          index === null ? null : `index:${index}`,
        ].filter(Boolean);
        const known = candidates.find(candidate => toolCallAliases.has(candidate));
        const key = (known ? toolCallAliases.get(known) : null)
          || candidates[0]
          || `position:${order}`;
        if (!toolCalls.has(key)) {
          toolCalls.set(key, { order: toolCallOrder++, call: {} });
        }
        for (const candidate of candidates) toolCallAliases.set(candidate, key);
        const entry = toolCalls.get(key);
        entry.call = mergeToolCall(entry.call, part);
      });
    };

    const drain = (flush = false) => {
      let next;
      while ((next = takeSseFrame(buffer))) {
        buffer = next.rest;
        const parsed = parseSseFrame(next.frame);
        if (parsed?.done) sawDone = true;
        else if (parsed?.event) handle(parsed.event);
      }
      if (flush && buffer.trim()) {
        const parsed = parseSseFrame(buffer);
        buffer = '';
        if (parsed?.done) sawDone = true;
        else if (parsed?.event) handle(parsed.event);
      }
    };

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        drain();
      }
      buffer += decoder.decode();
      drain(true);
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }
    if (finishReason === 'content_filter') throw blockedError(finishReason, model, settings.service);
    const fullCalls = Array.from(toolCalls.values())
      .sort((a, b) => a.order - b.order)
      .map(entry => entry.call);
    assistantMessage.tool_calls = fullCalls;
    if (!fullCalls.length) delete assistantMessage.tool_calls;
    const publicCalls = fullCalls.map((call, index) => {
      let args;
      try { args = JSON.parse(call?.function?.arguments || '{}'); }
      catch (error) { throw { code: 'invalid_response', message: `OpenAI-compatible provider returned invalid arguments for tool call ${index + 1}.`, retryable: true, backend: PROVIDER_ID, service: settings.service, detail: error?.message, model }; }
      if (!trim(call.id) || !trim(call?.function?.name) || !isObject(args)) {
        throw { code: 'invalid_response', message: 'OpenAI-compatible provider returned a malformed tool call.', retryable: false, backend: PROVIDER_ID, service: settings.service, model };
      }
      return { id: call.id, name: call.function.name, arguments: args };
    });
    if (!text && !publicCalls.length) {
      throw { code: 'invalid_response', message: sawDone ? 'OpenAI-compatible provider returned no streamed output.' : 'OpenAI-compatible stream closed before completion.', retryable: !sawDone, backend: PROVIDER_ID, service: settings.service, model };
    }
    return {
      text,
      toolCalls: publicCalls,
      assistantMessage,
      providerModel,
      usage,
      finishReason,
      outputTruncated: finishReason === 'length',
    };
  }

  async function chatAttempt(config, settings, task, session, model, attempted, onDelta) {
    const info = chatPayload(task, settings, model);
    let response;
    try {
      response = await fetchWithTimeout(`${settings.baseUrl}/chat/completions`, {
        method: 'POST', headers: requestHeaders(settings), body: JSON.stringify(info.payload),
        credentials: 'omit', cache: 'no-store',
      }, session.controller.signal);
    } catch (error) {
      if (session.controller.signal.aborted) {
        const timeout = session.abortReason === 'timeout';
        throw { code: timeout ? 'timeout' : 'aborted', message: timeout ? `OpenAI-compatible chat timed out after ${TIMEOUT_MS} ms.` : 'AI chat request was aborted.', retryable: timeout, backend: PROVIDER_ID, service: settings.service, model };
      }
      throw { code: 'backend_failed', message: error?.message || 'OpenAI-compatible chat request failed.', retryable: true, backend: PROVIDER_ID, service: settings.service, model };
    }
    if (!response.ok) throw httpError(response, await response.text(), model, settings);
    let streamed;
    try {
      streamed = await readStream(response, model, settings, onDelta);
    } catch (error) {
      if (session.controller.signal.aborted) {
        const timeout = session.abortReason === 'timeout';
        throw {
          code: timeout ? 'timeout' : 'aborted',
          message: timeout ? `OpenAI-compatible chat timed out after ${TIMEOUT_MS} ms.` : 'AI chat request was aborted.',
          retryable: timeout,
          backend: PROVIDER_ID,
          service: settings.service,
          model,
        };
      }
      throw error;
    }
    const base = resultBase(settings, model, streamed.providerModel, streamed.usage, info.thinking, attempted);
    const result = {
      ...base,
      text: streamed.text,
      toolCalls: streamed.toolCalls,
      finishReason: streamed.finishReason,
      outputTruncated: streamed.outputTruncated,
      continuation: streamed.toolCalls.length ? {
        provider: PROVIDER_ID,
        service: settings.service,
        messages: [...info.continuationMessages, cloneJson(streamed.assistantMessage)],
      } : null,
    };
    rememberSuccess(settings, result);
    result.status = statusSnapshot(config, settings);
    return result;
  }

  async function callChatStream(config, task, session, onDelta) {
    const settings = settingsFor(config);
    if (!settings.configured) throw notConfigured(settings);
    const models = modelsFor(settings);
    const attempted = [];
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      attempted.push(model);
      try {
        return await chatAttempt(config, settings, task, session, model, attempted, onDelta);
      } catch (error) {
        if (!(error?.code === 'rate_limit' && settings.service === 'gemini' && settings.modelMode === 'auto' && index < models.length - 1)) throw error;
      }
    }
    throw { code: 'rate_limit', message: 'All automatic Gemini models are rate limited.', retryable: true, backend: PROVIDER_ID, service: 'gemini' };
  }

  async function handle(request = {}) {
    const op = trim(request.op);
    if (op === 'settings:set') {
      const config = await saveConfig(request.config);
      return await status(config);
    }
    const config = await getConfig();
    if (op === 'settings:get' || op === 'status') return await status(config);
    if (op === 'test') {
      return callQuery(config, normalizeTask({
        id: 'popup-test',
        prompt: 'Reply with exactly: BetterDungeon AI ready',
        output: { type: 'text' },
        thinking: { level: 'minimal' },
      }));
    }
    if (op === 'query') return callQuery(config, normalizeTask(request.task));
    throw { code: 'invalid_args', message: `AI op '${op || '(empty)'}' is not supported`, retryable: false };
  }

  function handlePort(port) {
    try {
      if (port?.sender?.id && port.sender.id !== runtime.id) return void port.disconnect();
    } catch {
      try { port.disconnect(); } catch { /* noop */ }
      return;
    }
    const session = {
      requestId: null, started: false, terminal: false, closed: false,
      controller: null, abortReason: null, keepaliveTimer: null, terminalTimer: null, startTimer: null,
    };
    activePorts.add(port);
    const safePost = message => {
      if (session.closed) return false;
      try { port.postMessage(message); return true; } catch { return false; }
    };
    const clearTimers = () => {
      clearTimeout(session.startTimer);
      clearTimeout(session.terminalTimer);
      clearInterval(session.keepaliveTimer);
    };
    const teardown = (reason, disconnect = true) => {
      if (session.closed) return;
      session.closed = true;
      clearTimers();
      if (session.controller && !session.controller.signal.aborted) {
        session.abortReason ||= reason;
        session.controller.abort();
      }
      try { port.onMessage.removeListener(onMessage); } catch { /* noop */ }
      try { port.onDisconnect.removeListener(onDisconnect); } catch { /* noop */ }
      activePorts.delete(port);
      if (disconnect) try { port.disconnect(); } catch { /* noop */ }
    };
    const terminal = (type, payload) => {
      if (session.closed || session.terminal) return;
      session.terminal = true;
      clearInterval(session.keepaliveTimer);
      if (!safePost({ v: 1, type, requestId: session.requestId, ...payload })) return teardown(`${type}-post-failed`);
      session.terminalTimer = setTimeout(() => teardown(`${type}-grace-expired`), TERMINAL_GRACE_MS);
    };
    function onDisconnect() { teardown('disconnect', false); }
    function onMessage(message) {
      if (session.closed || !message || message.v !== 1) return;
      if (message.type === 'abort') {
        if (session.started && message.requestId === session.requestId) {
          session.abortReason = 'caller';
          session.controller?.abort();
          teardown('abort');
        }
        return;
      }
      if (message.type !== 'start' || session.started) {
        if (session.started) terminal('error', { error: normalizeError({ code: 'invalid_args', message: 'Chat port already has an active request.', retryable: false }) });
        return;
      }
      session.requestId = trim(message.requestId);
      if (!session.requestId) return teardown('invalid-request-id');
      let task;
      try {
        task = normalizeChatTask(message.task);
        if (task.id && task.id !== session.requestId) throw { code: 'invalid_args', message: 'Chat request id does not match the task id.', retryable: false };
      } catch (error) {
        session.started = true;
        return terminal('error', { error: normalizeError(error) });
      }
      session.started = true;
      session.controller = new AbortController();
      clearTimeout(session.startTimer);
      session.keepaliveTimer = setInterval(() => {
        if (!safePost({ v: 1, type: 'keepalive', requestId: session.requestId })) teardown('keepalive-post-failed');
      }, KEEPALIVE_MS);
      const timeout = setTimeout(() => {
        session.abortReason = 'timeout';
        session.controller.abort();
      }, TIMEOUT_MS);
      getConfig()
        .then(config => callChatStream(config, task, session, (text, sequence) => {
          if (!session.closed && !session.terminal && !safePost({ v: 1, type: 'delta', requestId: session.requestId, sequence, text })) teardown('delta-post-failed');
        }))
        .then(result => { clearTimeout(timeout); if (!session.closed) terminal('complete', { result }); })
        .catch(error => { clearTimeout(timeout); if (!session.closed) terminal('error', { error: normalizeError(error) }); });
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    session.startTimer = setTimeout(() => teardown('start-timeout'), START_TIMEOUT_MS);
  }

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPE) return false;
    handle(message.request)
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  });
  runtime.onConnect?.addListener(port => {
    if (port?.name === CHAT_PORT_NAME) handlePort(port);
  });

  window.__bdAiRuntime = Object.freeze({ handle });
  cleanLegacyStorage().catch(() => {});
})();
