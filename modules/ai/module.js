// modules/ai/module.js
//
// Ultrascripts AI module wrapper. Public ops delegate into the separated
// backend-agnostic executor layer backed by Gemini.

(function () {
  if (window.UltrascriptsAIModule) return;

  function executor() {
    const aiExecutor = window.UltrascriptsAIExecutor;
    if (!aiExecutor) {
      throw {
        code: 'unavailable',
        message: 'AI executor is not loaded.',
        retryable: true,
      };
    }
    return aiExecutor;
  }

  async function statusOp(args = {}) {
    if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
      throw { code: 'invalid_args', message: 'args must be an object' };
    }
    await geminiBackend()?.refreshStatus?.();
    return {
      ...executor().status(),
      checkedAtIso: new Date().toISOString(),
    };
  }

  function queryOp(args = {}, _ctx, request = {}) {
    return executor().query(args, { requestId: request.id || null });
  }

  function geminiBackend() {
    return window.UltrascriptsAIGeminiBackend || null;
  }

  const UltrascriptsAIModule = {
    id: 'ai',
    version: '0.5.0-gemini-meta',
    label: 'AI',
    description: 'Asynchronous AI query executor backed by Gemini.',

    ops: {
      status: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: statusOp,
      },
      query: {
        idempotent: 'unsafe',
        timeoutMs: 120000,
        handler: queryOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      geminiBackend()?.register?.();
      ctx.log('debug', 'AI executor mounted with Gemini backend');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        executor: window.UltrascriptsAIExecutor?.inspect?.() || null,
        gemini: geminiBackend()?.backend?.status?.() || null,
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
