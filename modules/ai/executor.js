// modules/ai/executor.js
//
// Backend-agnostic execution layer for Ultrascripts AI requests. It validates
// public query args, creates normalized query tasks, and adapts backend results
// into the public response contract. Provider transport lives elsewhere.

(function () {
  if (window.UltrascriptsAIExecutor) return;

  const VERSION = '0.5.0-provider-router';
  const PROMPT_MAX_CHARS = 12000;
  const OUTPUT_TYPES = Object.freeze(['text', 'json']);
  const THINKING_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high']);
  const DEFAULT_THINKING_LEVEL = 'minimal';

  const state = {
    providers: new Map(),
    providerOrder: [],
    defaultProviderId: null,
    consumerProviders: new Map(),
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      throw invalidArgs('value must be JSON-serializable');
    }
  }

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function invalidResponse(message, extra = {}) {
    return { code: 'invalid_response', message, retryable: false, ...extra };
  }

  function normalizeArgs(args) {
    if (args === undefined || args === null) return {};
    if (!isObject(args)) throw invalidArgs('args must be an object');
    return args;
  }

  function normalizeOutput(output) {
    if (output === undefined || output === null) return { type: 'text' };
    if (typeof output === 'string') output = { type: output };
    if (!isObject(output)) throw invalidArgs('output must be an object or output type string');

    const type = output.type === undefined ? 'text' : output.type;
    if (typeof type !== 'string' || OUTPUT_TYPES.indexOf(type) === -1) {
      throw invalidArgs(`output.type must be one of: ${OUTPUT_TYPES.join(', ')}`);
    }

    const normalized = { type };
    if (type === 'json' && output.schema === undefined) {
      throw invalidArgs('output.schema is required when output.type is json');
    }
    if (output.schema !== undefined) {
      if (type !== 'json') throw invalidArgs('output.schema is only valid when output.type is json');
      if (!isObject(output.schema)) throw invalidArgs('output.schema must be a JSON object');
      normalized.schema = cloneJson(output.schema);
    }
    return normalized;
  }

  function normalizeThinking(thinking) {
    if (thinking === undefined || thinking === null) return { level: DEFAULT_THINKING_LEVEL };
    if (typeof thinking === 'string') thinking = { level: thinking };
    if (!isObject(thinking)) throw invalidArgs('thinking must be a string or object');

    const rawLevel = thinking.level === undefined ? DEFAULT_THINKING_LEVEL : thinking.level;
    if (typeof rawLevel !== 'string') throw invalidArgs('thinking.level must be a string');

    const level = rawLevel.trim().toLowerCase();
    if (THINKING_LEVELS.indexOf(level) === -1) {
      throw invalidArgs(`thinking.level must be one of: ${THINKING_LEVELS.join(', ')}`);
    }
    return { level };
  }

  function normalizeQuery(args) {
    const normalized = normalizeArgs(args);
    if (typeof normalized.prompt !== 'string' || !normalized.prompt.trim()) {
      throw invalidArgs('prompt is required and must be a non-empty string');
    }
    if (normalized.prompt.length > PROMPT_MAX_CHARS) {
      throw invalidArgs(`prompt must be ${PROMPT_MAX_CHARS} characters or less`, {
        maxChars: PROMPT_MAX_CHARS,
        actualChars: normalized.prompt.length,
      });
    }

    return {
      prompt: normalized.prompt,
      promptChars: normalized.prompt.length,
      output: normalizeOutput(normalized.output),
      thinking: normalizeThinking(normalized.thinking),
    };
  }

  function createTask(args, meta = {}) {
    const query = normalizeQuery(args);
    const output = cloneJson(query.output);
    const task = {
      v: 1,
      id: typeof meta.requestId === 'string' && meta.requestId ? meta.requestId : null,
      module: 'ai',
      op: 'query',
      createdAtIso: new Date().toISOString(),
      prompt: query.prompt,
      promptChars: query.promptChars,
      output,
      thinking: cloneJson(query.thinking),
      responseContract: {
        type: output.type,
        thinking: cloneJson(query.thinking),
      },
    };
    if (output.schema) task.responseContract.schema = cloneJson(output.schema);
    return task;
  }

  function normalizeSupports(value) {
    const supports = isObject(value) ? value : {};
    return {
      text: supports.text === true,
      json: supports.json === true,
      thinking: supports.thinking === true,
    };
  }

  function normalizeId(value, label) {
    const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
      throw new TypeError(`${label} must be a stable lowercase id`);
    }
    return id;
  }

  function normalizeConsumer(value) {
    return normalizeId(value || 'default', 'consumer');
  }

  function normalizeProvider(provider) {
    if (!isObject(provider)) throw new TypeError('provider must be an object');
    if (typeof provider.query !== 'function') throw new TypeError('provider.query(task) is required');
    const id = normalizeId(provider.id, 'provider.id');
    return {
      ...provider,
      id,
      label: typeof provider.label === 'string' && provider.label.trim()
        ? provider.label.trim()
        : id,
      supports: normalizeSupports(provider.supports),
    };
  }

  function registerProvider(provider, options = {}) {
    const normalized = normalizeProvider(provider);
    const isNew = !state.providers.has(normalized.id);
    state.providers.set(normalized.id, normalized);
    if (isNew) state.providerOrder.push(normalized.id);
    if (!state.defaultProviderId || options.default === true) {
      state.defaultProviderId = normalized.id;
    }
    return providerStatus(normalized.id);
  }

  function unregisterProvider(providerId) {
    const id = normalizeId(providerId, 'provider id');
    const removed = state.providers.delete(id);
    if (!removed) return false;
    state.providerOrder = state.providerOrder.filter(candidate => candidate !== id);
    if (state.defaultProviderId === id) {
      state.defaultProviderId = state.providerOrder[0] || null;
    }
    for (const [consumer, selectedId] of state.consumerProviders.entries()) {
      if (selectedId === id) state.consumerProviders.delete(consumer);
    }
    return true;
  }

  function setDefaultProvider(providerId) {
    const id = normalizeId(providerId, 'provider id');
    if (!state.providers.has(id)) throw new TypeError(`AI provider '${id}' is not registered`);
    state.defaultProviderId = id;
    return providerStatus(id);
  }

  function setProviderForConsumer(consumer, providerId) {
    const consumerId = normalizeConsumer(consumer);
    if (providerId === undefined || providerId === null || providerId === '') {
      state.consumerProviders.delete(consumerId);
      return status({ consumer: consumerId });
    }
    const id = normalizeId(providerId, 'provider id');
    if (!state.providers.has(id)) throw new TypeError(`AI provider '${id}' is not registered`);
    state.consumerProviders.set(consumerId, id);
    return status({ consumer: consumerId });
  }

  function resolveProvider(consumer = 'default') {
    const consumerId = normalizeConsumer(consumer);
    const selectedId = state.consumerProviders.get(consumerId);
    if (selectedId && state.providers.has(selectedId)) {
      return { consumer: consumerId, provider: state.providers.get(selectedId), selection: 'consumer' };
    }
    if (state.defaultProviderId && state.providers.has(state.defaultProviderId)) {
      return { consumer: consumerId, provider: state.providers.get(state.defaultProviderId), selection: 'default' };
    }
    const fallbackId = state.providerOrder.find(id => state.providers.has(id));
    return {
      consumer: consumerId,
      provider: fallbackId ? state.providers.get(fallbackId) : null,
      selection: fallbackId ? 'fallback' : 'none',
    };
  }

  function providerStatus(providerId) {
    const provider = state.providers.get(providerId);
    if (!provider) return null;
    const rawStatus = typeof provider.status === 'function' ? provider.status() : null;
    const status = isObject(rawStatus) ? rawStatus : {};
    return {
      id: provider.id,
      label: provider.label,
      supports: normalizeSupports(provider.supports),
      status,
    };
  }

  function status(meta = {}) {
    const resolved = resolveProvider(meta.consumer);
    const provider = resolved.provider ? providerStatus(resolved.provider.id) : null;
    const supports = provider ? provider.supports : { text: false, json: false, thinking: false };
    const providerReady = provider?.status?.ready;
    const ready = !!(
      resolved.provider &&
      typeof resolved.provider.query === 'function' &&
      (supports.text || supports.json) &&
      (providerReady === undefined ? true : providerReady === true)
    );
    const reason = ready
      ? null
      : (provider?.status?.reason || 'ai_provider_not_configured');
    return {
      provider: provider ? provider.id : null,
      providerLabel: provider ? provider.label : null,
      backend: provider ? provider.id : null,
      backendLabel: provider ? provider.label : null,
      consumer: resolved.consumer,
      selection: resolved.selection,
      ready,
      available: ready,
      phase: ready ? 'live' : 'executor',
      reason,
      supports,
      config: provider?.status?.config || null,
      contract: {
        ops: ['status', 'query'],
        outputTypes: [...OUTPUT_TYPES],
        thinkingLevels: [...THINKING_LEVELS],
        defaultThinking: DEFAULT_THINKING_LEVEL,
        asyncOnly: true,
      },
      executor: {
        version: VERSION,
        promptMaxChars: PROMPT_MAX_CHARS,
        providerConfigured: !!provider,
        backendConfigured: !!provider,
      },
      message: provider?.status?.message || (
        ready
          ? 'AI querying is available.'
          : 'The AI execution layer is available, but no callable provider is configured right now.'
      ),
    };
  }

  async function refreshStatus(meta = {}) {
    const resolved = resolveProvider(meta.consumer);
    if (typeof resolved.provider?.refreshStatus === 'function') {
      await resolved.provider.refreshStatus();
    }
    return status({ consumer: resolved.consumer });
  }

  function normalizeTextResult(result) {
    if (typeof result?.text === 'string') return result.text;
    if (typeof result === 'string') return result;
    throw invalidResponse('AI backend did not return text output');
  }

  function normalizeJsonResult(result) {
    if (result && result.json !== undefined) return cloneJson(result.json);
    if (typeof result?.text === 'string') {
      try {
        return JSON.parse(result.text);
      } catch (err) {
        throw invalidResponse('AI backend returned invalid JSON text', {
          detail: err?.message || 'invalid_json',
        });
      }
    }
    throw invalidResponse('AI backend did not return JSON output');
  }

  function normalizeResultMeta(result, task, provider) {
    const providerId = result?.provider || result?.backend || provider?.id || null;
    const meta = {
      provider: providerId,
      providerLabel: provider?.label || null,
      backend: providerId,
      outputType: task.output.type,
      promptChars: task.promptChars,
      generatedAtIso: result?.generatedAtIso || new Date().toISOString(),
    };
    if (typeof result?.model === 'string') meta.model = result.model;
    if (typeof result?.providerModel === 'string') meta.providerModel = result.providerModel;
    if (result?.thinking) meta.thinking = cloneJson(result.thinking);
    if (result?.fallback) meta.fallback = cloneJson(result.fallback);
    if (result?.usage) meta.usage = cloneJson(result.usage);
    return meta;
  }

  function normalizeProviderResult(result, task, provider) {
    const meta = normalizeResultMeta(result, task, provider);

    if (task.output.type === 'json') {
      return { json: normalizeJsonResult(result), meta };
    }
    return { text: normalizeTextResult(result), meta };
  }

  function setBackend(backend) {
    return registerProvider(backend, { default: true });
  }

  function clearBackend() {
    if (state.defaultProviderId) unregisterProvider(state.defaultProviderId);
    return status();
  }

  async function query(args, meta = {}) {
    const task = createTask(args, meta);
    const resolved = resolveProvider(meta.consumer);
    const provider = resolved.provider;
    if (!provider) {
      throw {
        code: 'not_configured',
        message: 'No AI provider is configured yet.',
        retryable: false,
        provider: null,
        backend: null,
        phase: status({ consumer: resolved.consumer }).phase,
        task: {
          id: task.id,
          outputType: task.output.type,
          promptChars: task.promptChars,
        },
      };
    }

    const supports = normalizeSupports(provider.supports);
    if (supports[task.output.type] !== true) {
      throw {
        code: 'unavailable',
        message: `The selected AI provider does not support ${task.output.type} output.`,
        retryable: false,
        provider: provider.id,
        backend: provider.id,
        outputType: task.output.type,
      };
    }

    const result = await provider.query(cloneJson(task));
    return normalizeProviderResult(result, task, provider);
  }

  const executor = {
    VERSION,
    PROMPT_MAX_CHARS,
    OUTPUT_TYPES,
    createTask,
    query,
    status,
    refreshStatus,
    registerProvider,
    unregisterProvider,
    setDefaultProvider,
    setProviderForConsumer,
    resolveProvider: consumer => {
      const resolved = resolveProvider(consumer);
      return {
        consumer: resolved.consumer,
        provider: resolved.provider?.id || null,
        providerLabel: resolved.provider?.label || null,
        selection: resolved.selection,
      };
    },
    setBackend,
    clearBackend,
    inspect: () => ({
      ...status(),
      hasProvider: state.providers.size > 0,
      hasBackend: state.providers.size > 0,
      defaultProvider: state.defaultProviderId,
      providers: state.providerOrder
        .map(providerStatus)
        .filter(Boolean),
      consumerProviders: Object.fromEntries(state.consumerProviders),
    }),
  };

  window.UltrascriptsAIExecutor = executor;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = executor;
  }
})();
