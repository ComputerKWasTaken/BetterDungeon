// modules/ai/module.js
//
// Ultrascripts AI module contract. The public surface is present, but the
// generation backend is intentionally absent until Phase 3 of the rebuild.

(function () {
  if (window.UltrascriptsAIModule) return;

  const PROMPT_MAX_CHARS = 12000;
  const OUTPUT_TYPES = Object.freeze(['text', 'json']);

  const STATUS = Object.freeze({
    backend: null,
    ready: false,
    available: false,
    phase: 'contract',
    reason: 'ai_backend_not_configured',
    supports: Object.freeze({
      text: false,
      json: false,
    }),
    contract: Object.freeze({
      ops: Object.freeze(['status', 'query']),
      outputTypes: OUTPUT_TYPES,
      asyncOnly: true,
    }),
    message: 'The AI module contract is available, but no callable generation backend is configured right now.',
  });

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

  function statusOp(args = {}) {
    normalizeArgs(args);
    return {
      ...STATUS,
      supports: { ...STATUS.supports },
      contract: {
        ops: [...STATUS.contract.ops],
        outputTypes: [...STATUS.contract.outputTypes],
        asyncOnly: STATUS.contract.asyncOnly,
      },
      checkedAtIso: new Date().toISOString(),
    };
  }

  function normalizeOutput(output) {
    if (output === undefined || output === null) return { type: 'text' };
    if (typeof output === 'string') return { type: output };
    if (typeof output !== 'object' || Array.isArray(output)) {
      throw invalidArgs('output must be an object or output type string');
    }

    const type = output.type === undefined ? 'text' : output.type;
    if (typeof type !== 'string' || OUTPUT_TYPES.indexOf(type) === -1) {
      throw invalidArgs(`output.type must be one of: ${OUTPUT_TYPES.join(', ')}`);
    }

    const normalized = { type };
    if (output.schema !== undefined) {
      if (type !== 'json') throw invalidArgs('output.schema is only valid when output.type is json');
      if (typeof output.schema !== 'object' || output.schema === null || Array.isArray(output.schema)) {
        throw invalidArgs('output.schema must be a JSON object');
      }
      normalized.schema = output.schema;
    }
    return normalized;
  }

  function queryOp(args = {}) {
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
    normalizeOutput(normalized.output);

    throw {
      code: 'not_configured',
      message: 'No AI backend is configured yet.',
      retryable: false,
      backend: null,
      phase: STATUS.phase,
    };
  }

  const UltrascriptsAIModule = {
    id: 'ai',
    version: '0.2.0-contract',
    label: 'AI',
    description: 'Asynchronous AI query contract. Backend connection is pending.',

    ops: {
      status: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: statusOp,
      },
      query: {
        idempotent: 'unsafe',
        timeoutMs: 1000,
        handler: queryOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'AI contract mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        ...STATUS,
      };
    },
  };

  window.UltrascriptsAIModule = UltrascriptsAIModule;

  if (window.Ultrascripts?.registry) {
    window.Ultrascripts.registry.register(UltrascriptsAIModule);
  } else {
    console.warn('[UltrascriptsAI] Ultrascripts registry not available; AI module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UltrascriptsAIModule;
  }
})();
