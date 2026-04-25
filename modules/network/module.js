// modules/network/module.js
//
// Frontier network module. Exposes lightweight browser connectivity hints for
// scripts that want graceful offline or low-bandwidth behavior.

(function () {
  if (window.FrontierNetworkModule) return;

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

  function connectionApi() {
    if (typeof navigator === 'undefined') return null;
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }

  function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function stringOrNull(value) {
    return typeof value === 'string' && value ? value : null;
  }

  function boolOrNull(value) {
    return typeof value === 'boolean' ? value : null;
  }

  function classifyQuality(online, connection) {
    if (online === false) return 'offline';
    if (!connection) return 'unknown';

    const effectiveType = String(connection.effectiveType || '').toLowerCase();
    const saveData = connection.saveData === true;
    const downlink = numberOrNull(connection.downlink);
    const rtt = numberOrNull(connection.rtt);

    if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') return 'constrained';
    if (effectiveType === '3g') return 'limited';
    if (downlink !== null && downlink < 1) return 'limited';
    if (rtt !== null && rtt > 500) return 'limited';
    if (effectiveType === '4g' || (downlink !== null && downlink >= 5)) return 'good';

    return 'unknown';
  }

  function buildConnectionPayload() {
    const connection = connectionApi();
    const online = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : null;
    const ts = Date.now();

    return {
      online,
      quality: classifyQuality(online, connection),
      checkedAt: ts,
      checkedAtIso: new Date(ts).toISOString(),
      connectionSupported: !!connection,
      effectiveType: stringOrNull(connection?.effectiveType),
      type: stringOrNull(connection?.type),
      downlinkMbps: numberOrNull(connection?.downlink),
      downlinkMaxMbps: numberOrNull(connection?.downlinkMax),
      rttMs: numberOrNull(connection?.rtt),
      saveData: boolOrNull(connection?.saveData),
    };
  }

  function statusOp(args = {}) {
    normalizeArgs(args);
    return buildConnectionPayload();
  }

  const FrontierNetworkModule = {
    id: 'network',
    version: '1.0.0',
    label: 'Network',
    description: 'Provides online/offline and connection-quality hints for Frontier scripts.',

    ops: {
      status: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: statusOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'Network mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        ...buildConnectionPayload(),
      };
    },
  };

  window.FrontierNetworkModule = FrontierNetworkModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierNetworkModule);
  } else {
    console.warn('[Network] Frontier registry not available; network module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierNetworkModule;
  }
})();
