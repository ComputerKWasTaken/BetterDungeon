// modules/sdk/module.js
//
// Frontier BetterDungeon SDK module. Exposes BetterDungeon-facing metadata
// that does not belong in Frontier heartbeat discovery.

(function () {
  if (window.FrontierSdkModule) return;

  const SDK_VERSION = '1.0.0';
  const FRONTIER_PROTOCOL = 1;
  const FRONTIER_CLIENT = 'BetterDungeon';
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

  function getManifest() {
    try {
      return chrome?.runtime?.getManifest?.() || null;
    } catch {
      return null;
    }
  }

  function getBetterDungeonVersion() {
    return getManifest()?.version || 'unknown';
  }

  function getCore() {
    return window.Frontier?.core || null;
  }

  function getFrontierProtocol(ctx) {
    const core = getCore();
    if (typeof core?.getProtocolVersion === 'function') {
      return core.getProtocolVersion();
    }
    return FRONTIER_PROTOCOL;
  }

  function getFrontierClientName() {
    const core = getCore();
    if (typeof core?.getClientName === 'function') {
      return core.getClientName();
    }
    return FRONTIER_CLIENT;
  }

  function versionOp(args = {}) {
    normalizeArgs(args);
    return {
      sdkVersion: SDK_VERSION,
      betterDungeonVersion: getBetterDungeonVersion(),
      frontierProtocol: getFrontierProtocol(),
      frontierClient: getFrontierClientName(),
    };
  }

  const FrontierSdkModule = {
    id: 'sdk',
    version: SDK_VERSION,
    label: 'BetterDungeon SDK',
    description: 'Exposes BetterDungeon-facing metadata that complements heartbeat instead of duplicating it.',

    ops: {
      version: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: versionOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'SDK mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        sdkVersion: SDK_VERSION,
        betterDungeonVersion: getBetterDungeonVersion(),
        ops: Object.keys(this.ops),
      };
    },
  };

  window.FrontierSdkModule = FrontierSdkModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierSdkModule);
  } else {
    console.warn('[SDK] Frontier registry not available; SDK module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierSdkModule;
  }
})();
