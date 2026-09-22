// modules/ai/module.js
//
// Ultrascripts AI module wrapper. Public ops delegate into the provider-neutral
// executor; provider adapters register independently.

(function () {
  if (window.UltrascriptsAIModule) return;

  function executor() {
    const aiExecutor = window.BetterDungeonAI;
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
    const status = await executor().refreshStatus({ consumer: 'ultrascripts' });
    return {
      ...status,
      checkedAtIso: new Date().toISOString(),
    };
  }

  // Each mounted adventure runs one AI Dungeon script environment. Request IDs
  // are not script identities: using them as lock keys would allow overlap.
  let querying = false;
  async function queryOp(args = {}, _ctx, request = {}) {
    if (querying) throw { code: 'busy', message: 'This script already has an AI request in progress.', retryable: true };
    querying = true;
    try {
      return await executor().query(args, {
        requestId: request.id || null,
        consumer: 'ultrascripts',
      });
    } finally { querying = false; }
  }

  const UltrascriptsAIModule = {
    id: 'ai',
    version: '1.0.0',
    label: 'AI',
    description: 'Asynchronous AI query executor using the configured provider.',

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
      const selected = executor().resolveProvider('ultrascripts');
      ctx.log('debug', 'AI executor mounted', {
        provider: selected.provider,
        selection: selected.selection,
      });
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        executor: window.UltrascriptsAIExecutor?.inspect?.() || null,
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
