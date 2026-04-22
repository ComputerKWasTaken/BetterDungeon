// modules/test/module.js
//
// Internal Phase 4 validation module. It gives the Full Frontier dispatcher a
// deliberately boring op to route before WebFetch/Clock add real capabilities.

(function () {
  if (window.FrontierTestModule) return;

  const FrontierTestModule = {
    id: 'test',
    version: '1.0.0',
    label: 'Frontier Test',
    description: 'Internal echo module for validating the Full Frontier ops channel.',
    defaultEnabled: false,

    ops: {
      echo(args, ctx, request) {
        return {
          got: args || {},
          requestId: request?.id || null,
          liveCount: ctx.getLiveCount(),
          adventureShortId: ctx.adventureShortId || null,
        };
      },

      delayEcho(args, ctx, request) {
        const requestedDelay = Number(args?.delayMs || 5000);
        const delayMs = Math.max(0, Math.min(30000, Number.isFinite(requestedDelay) ? requestedDelay : 5000));

        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              got: args || {},
              requestId: request?.id || null,
              delayedMs: delayMs,
              liveCount: ctx.getLiveCount(),
              adventureShortId: ctx.adventureShortId || null,
            });
          }, delayMs);
        });
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'Frontier Test mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return { mounted: !!this._ctx, ops: Object.keys(this.ops) };
    },
  };

  window.FrontierTestModule = FrontierTestModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierTestModule);
  } else {
    console.warn('[FrontierTest] Frontier registry not available; test module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierTestModule;
  }
})();
