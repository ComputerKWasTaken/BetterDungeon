// modules/ai/module.js
//
// Ultrascripts AI placeholder. The generation backend is intentionally absent
// while the module is rebuilt.

(function () {
  if (window.UltrascriptsAIModule) return;

  const STATUS = Object.freeze({
    backend: null,
    ready: false,
    available: false,
    phase: 'rebuild',
    reason: 'ai_module_rebuild',
    message: 'The AI module is being rebuilt and has no callable generation backend right now.',
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
      checkedAtIso: new Date().toISOString(),
    };
  }

  const UltrascriptsAIModule = {
    id: 'ai',
    version: '0.1.0-rebuild',
    label: 'AI',
    description: 'Placeholder while the Ultrascripts AI module is rebuilt.',

    ops: {
      status: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: statusOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'AI placeholder mounted');
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
