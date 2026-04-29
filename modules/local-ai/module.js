// modules/local-ai/module.js
//
// Frontier Local AI scaffold. This intentionally leaves the runtime bridge
// unimplemented so the final desktop/mobile backend can be filled in later.
// This is really just meant to be the core interface for the local AI module, so 
// that we can swap out the runtime bridge later.

(function () {
  if (window.FrontierLocalAIModule) return;

  function normalizeArgs(args) {
    if (args === undefined || args === null) return {};
    if (typeof args !== 'object' || Array.isArray(args)) {
      throw { code: 'invalid_args', message: 'args must be an object' };
    }
    return args;
  }

  function notImplemented(op) {
    return {
      code: 'not_implemented',
      message: `Local AI ${op} is scaffolded but no runtime backend has been implemented yet.`,
      module: 'localAI',
      op,
    };
  }

  async function chatOp(args = {}) {
    normalizeArgs(args);
    throw notImplemented('chat');
  }

  async function modelsOp(args = {}) {
    normalizeArgs(args);
    throw notImplemented('models');
  }

  async function testConnectionOp(args = {}) {
    normalizeArgs(args);
    throw notImplemented('testConnection');
  }

  const FrontierLocalAIModule = {
    id: 'localAI',
    version: '0.1.0',
    label: 'Local AI',
    description: 'Scaffold for future local model runtime calls.',
    defaultEnabled: false,

    ops: {
      chat: {
        idempotent: 'unsafe',
        timeoutMs: 30000,
        handler: chatOp,
      },
      models: {
        idempotent: 'safe',
        timeoutMs: 10000,
        handler: modelsOp,
      },
      testConnection: {
        idempotent: 'safe',
        timeoutMs: 10000,
        handler: testConnectionOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'Local AI scaffold mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        scaffolded: true,
        ops: Object.keys(this.ops),
        TODO: [
          'Choose desktop runtime bridge',
          'Choose mobile runtime adapter',
          'Implement settings-backed background calls',
          'Add model download/listing behavior',
        ],
      };
    },
  };

  window.FrontierLocalAIModule = FrontierLocalAIModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierLocalAIModule);
  } else {
    console.warn('[LocalAI] Frontier registry not available; Local AI scaffold not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierLocalAIModule;
  }
})();
