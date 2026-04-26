// modules/provider-ai/module.js
//
// Frontier Provider AI module. Provides bounded, user-configured hosted model
// calls through a background-worker bridge so scripts never see API keys.

(function () {
  if (window.FrontierProviderAIModule) return;

  const PROVIDER_AI_MESSAGE = 'FRONTIER_PROVIDER_AI_REQUEST';
  const SUPPORTED_PROVIDER = 'openrouter';

  const DEFAULT_TIMEOUT_MS = 30000;
  const MIN_TIMEOUT_MS = 5000;
  const MAX_TIMEOUT_MS = 60000;
  const DEFAULT_MAX_TOKENS = 512;
  const MAX_TOKENS = 4096;
  const MAX_MESSAGES = 20;
  const MAX_MESSAGE_CHARS = 8000;
  const MAX_TOTAL_CHARS = 24000;
  const MAX_MODEL_CHARS = 160;
  const MAX_QUERY_CHARS = 120;
  const MAX_STOP_SEQUENCES = 4;
  const MAX_STOP_CHARS = 200;

  const RATE_WINDOW_MS = 60000;
  const RATE_LIMITS = {
    chat: 6,
    models: 12,
    testConnection: 12,
  };

  const rateBuckets = new Map();

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function normalizeArgs(args) {
    if (args === undefined || args === null) return {};
    if (typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }
    return args;
  }

  function normalizeProvider(value) {
    const provider = String(value || SUPPORTED_PROVIDER).trim().toLowerCase();
    if (provider !== SUPPORTED_PROVIDER) {
      throw invalidArgs(`provider '${provider || '(empty)'}' is not supported`);
    }
    return provider;
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeTimeoutMs(value) {
    return Math.round(clampNumber(value, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
  }

  function normalizeModel(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw invalidArgs('model must be a string');
    const model = value.trim();
    if (!model) return null;
    if (model.length > MAX_MODEL_CHARS) {
      throw invalidArgs(`model must be ${MAX_MODEL_CHARS} characters or fewer`);
    }
    return model;
  }

  function normalizeQuery(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') throw invalidArgs('query must be a string');
    const query = value.trim();
    if (query.length > MAX_QUERY_CHARS) {
      throw invalidArgs(`query must be ${MAX_QUERY_CHARS} characters or fewer`);
    }
    return query;
  }

  function normalizeLimit(value) {
    return Math.round(clampNumber(value, 30, 0, 100));
  }

  function normalizeTemperature(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 2) {
      throw invalidArgs('temperature must be a number between 0 and 2');
    }
    return n;
  }

  function normalizeMaxTokens(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_MAX_TOKENS;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOKENS) {
      throw invalidArgs(`maxTokens must be an integer between 1 and ${MAX_TOKENS}`);
    }
    return n;
  }

  function normalizeResponseFormat(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw invalidArgs('responseFormat must be an object');
    }
    const type = String(value.type || '').trim();
    if (type !== 'json_object' && type !== 'text') {
      throw invalidArgs("responseFormat.type must be 'json_object' or 'text'");
    }
    return { type };
  }

  function normalizeStop(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const values = Array.isArray(value) ? value : [value];
    if (values.length > MAX_STOP_SEQUENCES) {
      throw invalidArgs(`stop may include at most ${MAX_STOP_SEQUENCES} sequences`);
    }
    const out = values.map((item) => {
      if (typeof item !== 'string') throw invalidArgs('stop sequences must be strings');
      if (item.length > MAX_STOP_CHARS) {
        throw invalidArgs(`stop sequences must be ${MAX_STOP_CHARS} characters or fewer`);
      }
      return item;
    });
    return Array.isArray(value) ? out : out[0];
  }

  function normalizeMessageContent(content, index) {
    if (typeof content !== 'string') {
      throw invalidArgs(`messages[${index}].content must be a string`);
    }
    if (!content) {
      throw invalidArgs(`messages[${index}].content is required`);
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      throw invalidArgs(`messages[${index}].content must be ${MAX_MESSAGE_CHARS} characters or fewer`);
    }
    return content;
  }

  function normalizeMessages(value) {
    if (!Array.isArray(value) || value.length === 0) {
      throw invalidArgs('messages must be a non-empty array');
    }
    if (value.length > MAX_MESSAGES) {
      throw invalidArgs(`messages may include at most ${MAX_MESSAGES} items`);
    }

    let totalChars = 0;
    const out = value.map((message, index) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw invalidArgs(`messages[${index}] must be an object`);
      }
      const role = String(message.role || '').trim();
      if (role !== 'system' && role !== 'user' && role !== 'assistant') {
        throw invalidArgs(`messages[${index}].role must be system, user, or assistant`);
      }
      const content = normalizeMessageContent(message.content, index);
      totalChars += content.length;
      if (totalChars > MAX_TOTAL_CHARS) {
        throw invalidArgs(`messages total content must be ${MAX_TOTAL_CHARS} characters or fewer`);
      }
      return { role, content };
    });

    return out;
  }

  function rateKey(ctx, op) {
    const adventure = ctx?.adventureShortId || ctx?.getAdventureId?.() || 'global';
    return `${adventure}:${op}`;
  }

  function checkRateLimit(ctx, op) {
    const limit = RATE_LIMITS[op] || 6;
    const key = rateKey(ctx, op);
    const now = Date.now();
    const bucket = (rateBuckets.get(key) || []).filter((at) => now - at < RATE_WINDOW_MS);

    if (bucket.length >= limit) {
      const retryAfterMs = Math.max(1000, RATE_WINDOW_MS - (now - bucket[0]));
      rateBuckets.set(key, bucket);
      throw {
        code: 'rate_limit',
        message: `Provider AI ${op} is limited to ${limit} requests per minute for this adventure`,
        retryAfterMs,
      };
    }

    bucket.push(now);
    rateBuckets.set(key, bucket);
  }

  function unwrapBackgroundResponse(response) {
    if (response?.ok) return response.data;
    throw response?.error || { code: 'provider_ai_failed', message: 'Provider AI background request failed' };
  }

  function backgroundRequest(request) {
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) {
      return browser.runtime
        .sendMessage({ type: PROVIDER_AI_MESSAGE, request })
        .then((response) => unwrapBackgroundResponse(response));
    }

    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
    if (!runtime?.sendMessage) {
      return Promise.reject({ code: 'provider_ai_unavailable', message: 'Extension runtime is unavailable' });
    }

    return new Promise((resolve, reject) => {
      runtime.sendMessage({ type: PROVIDER_AI_MESSAGE, request }, (response) => {
        const lastError = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (lastError) {
          reject({ code: 'provider_ai_unavailable', message: lastError.message || 'Provider AI background request failed' });
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

  async function chatOp(args = {}, ctx) {
    const normalized = normalizeArgs(args);
    const request = {
      provider: normalizeProvider(normalized.provider),
      op: 'chat',
      model: normalizeModel(normalized.model),
      messages: normalizeMessages(normalized.messages),
      temperature: normalizeTemperature(normalized.temperature),
      maxTokens: normalizeMaxTokens(normalized.maxTokens),
      responseFormat: normalizeResponseFormat(normalized.responseFormat),
      stop: normalizeStop(normalized.stop),
      timeoutMs: normalizeTimeoutMs(normalized.timeoutMs),
    };

    checkRateLimit(ctx, 'chat');
    return backgroundRequest(request);
  }

  async function modelsOp(args = {}, ctx) {
    const normalized = normalizeArgs(args);
    const request = {
      provider: normalizeProvider(normalized.provider),
      op: 'models',
      query: normalizeQuery(normalized.query),
      limit: normalizeLimit(normalized.limit),
      timeoutMs: normalizeTimeoutMs(normalized.timeoutMs),
    };

    checkRateLimit(ctx, 'models');
    return backgroundRequest(request);
  }

  async function testConnectionOp(args = {}, ctx) {
    const normalized = normalizeArgs(args);
    const request = {
      provider: normalizeProvider(normalized.provider),
      op: 'testConnection',
      timeoutMs: normalizeTimeoutMs(normalized.timeoutMs),
    };

    checkRateLimit(ctx, 'testConnection');
    return backgroundRequest(request);
  }

  function resetRateLimitsForAdventure(ctx) {
    const adventure = ctx?.adventureShortId || ctx?.getAdventureId?.() || '';
    if (!adventure) return;
    for (const key of [...rateBuckets.keys()]) {
      if (key.startsWith(`${adventure}:`)) rateBuckets.delete(key);
    }
  }

  const FrontierProviderAIModule = {
    id: 'providerAI',
    version: '1.0.0',
    label: 'Provider AI',
    description: 'Provides bounded hosted-model calls through user-configured OpenRouter credentials.',

    ops: {
      chat: {
        idempotent: 'unsafe',
        timeoutMs: MAX_TIMEOUT_MS + 5000,
        handler: chatOp,
      },
      models: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS + 5000,
        handler: modelsOp,
      },
      testConnection: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS + 5000,
        handler: testConnectionOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'Provider AI mounted');
    },

    unmount() {
      this._ctx = null;
    },

    onAdventureChange(_shortId, ctx) {
      resetRateLimitsForAdventure(ctx || this._ctx);
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        provider: SUPPORTED_PROVIDER,
        limits: {
          maxMessages: MAX_MESSAGES,
          maxMessageChars: MAX_MESSAGE_CHARS,
          maxTotalChars: MAX_TOTAL_CHARS,
          maxTokens: MAX_TOKENS,
          chatPerMinute: RATE_LIMITS.chat,
        },
      };
    },
  };

  window.FrontierProviderAIModule = FrontierProviderAIModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierProviderAIModule);
  } else {
    console.warn('[ProviderAI] Frontier registry not available; Provider AI module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierProviderAIModule;
  }
})();
