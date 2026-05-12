// modules/sdk/module.js
//
// Frontier BetterDungeon SDK module. Exposes stable BetterDungeon and Frontier
// runtime metadata so scripts can discover capabilities without hand-parsing
// heartbeat cards or reaching for extension internals.

(function () {
  if (window.FrontierSdkModule) return;

  const SDK_VERSION = '1.0.0';
  const FRONTIER_PROTOCOL = 1;
  const FRONTIER_CLIENT = 'BetterDungeon';
  const HEARTBEAT_CARD_TITLE = 'frontier:heartbeat';
  const HEARTBEAT_FRESH_TURN_DELTA = 2;

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

  function getRegistryModules() {
    const list = window.Frontier?.registry?.list?.();
    return Array.isArray(list) ? list : [];
  }

  function numberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function parseHeartbeat(ctx) {
    const card = ctx?.getCardByTitle?.(HEARTBEAT_CARD_TITLE);
    if (!card || typeof card.value !== 'string' || !card.value.length) return null;
    try {
      return JSON.parse(card.value);
    } catch {
      return null;
    }
  }

  function getFrontierProtocol(ctx) {
    const core = getCore();
    if (typeof core?.getProtocolVersion === 'function') {
      return core.getProtocolVersion();
    }
    return Number(parseHeartbeat(ctx)?.frontier?.protocol) || FRONTIER_PROTOCOL;
  }

  function getFrontierClientName() {
    const core = getCore();
    if (typeof core?.getClientName === 'function') {
      return core.getClientName();
    }
    return FRONTIER_CLIENT;
  }

  function isFrontierEnabled() {
    const core = getCore();
    if (typeof core?.isEnabled === 'function') {
      return !!core.isEnabled();
    }
    return !!core?.inspect?.()?.enabled;
  }

  function getHeartbeatModuleIds(heartbeat) {
    const modules = Array.isArray(heartbeat?.modules) ? heartbeat.modules : [];
    return modules
      .map((module) => String(module?.id || '').trim())
      .filter(Boolean);
  }

  function detectBrowserFamily() {
    const ua = String(navigator?.userAgent || '').toLowerCase();
    if (ua.includes('firefox') || ua.includes('fxios')) return 'firefox';
    if (ua.includes('edg/')) return 'edge';
    if (ua.includes('opr/') || ua.includes('opera')) return 'opera';
    if (ua.includes('chrome') || ua.includes('chromium') || ua.includes('crios')) return 'chromium';
    if (ua.includes('safari')) return 'safari';
    return 'unknown';
  }

  function detectMobileLike() {
    const userAgentDataMobile = navigator?.userAgentData?.mobile;
    if (typeof userAgentDataMobile === 'boolean') return userAgentDataMobile;
    const ua = String(navigator?.userAgent || '').toLowerCase();
    return /android|iphone|ipod|mobile/.test(ua);
  }

  function normalizeModuleInfo(module) {
    return {
      id: module.id,
      aliases: Array.isArray(module.aliases) ? module.aliases.slice() : [],
      label: module.label || module.id,
      version: module.version || null,
      enabled: !!module.enabled,
      mounted: !!module.mounted,
      stateNames: Array.isArray(module.stateNames) ? module.stateNames.slice() : [],
      ops: Array.isArray(module.ops) ? module.ops.slice() : [],
    };
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

  function capabilitiesOp(args = {}, ctx) {
    normalizeArgs(args);

    const modules = getRegistryModules();
    const mountedModules = modules.filter((module) => module.mounted);
    const enabledModules = modules.filter((module) => module.enabled);

    return {
      sdkVersion: SDK_VERSION,
      betterDungeonVersion: getBetterDungeonVersion(),
      frontierProtocol: getFrontierProtocol(ctx),
      frontierClient: getFrontierClientName(),
      helperGroups: ['sdk'],
      methods: ['version', 'capabilities', 'modules', 'frontier'],
      modules: mountedModules.map((module) => module.id),
      enabledModules: enabledModules.map((module) => module.id),
      availableModules: modules.map((module) => module.id),
      opsModules: mountedModules
        .filter((module) => Array.isArray(module.ops) && module.ops.length > 0)
        .map((module) => module.id),
      stateModules: mountedModules
        .filter((module) => Array.isArray(module.stateNames) && module.stateNames.length > 0)
        .map((module) => module.id),
      features: {
        frontier: isFrontierEnabled(),
        sdk: true,
        scriptureWidgets: mountedModules.some((module) => module.id === 'scripture'),
        providerAI: mountedModules.some((module) => module.id === 'ai'),
        webfetchConsent: mountedModules.some((module) => module.id === 'webfetch'),
        moduleToggles: true,
      },
      platform: {
        browserFamily: detectBrowserFamily(),
        mobileLike: detectMobileLike(),
      },
    };
  }

  function modulesOp(args = {}) {
    normalizeArgs(args);
    return {
      modules: getRegistryModules().map(normalizeModuleInfo),
    };
  }

  function frontierOp(args = {}, ctx) {
    normalizeArgs(args);

    const heartbeat = parseHeartbeat(ctx);
    const turn = Number(ctx?.getLiveCount?.() || 0);
    const heartbeatTurn = numberOrNull(heartbeat?.turn);
    const heartbeatTurnDelta = heartbeatTurn === null ? null : Math.max(0, turn - heartbeatTurn);
    const advertisedModules = getHeartbeatModuleIds(heartbeat);
    const activeModules = getRegistryModules()
      .filter((module) => module.mounted)
      .map((module) => module.id);

    return {
      protocol: getFrontierProtocol(ctx),
      client: getFrontierClientName(),
      enabled: isFrontierEnabled(),
      turn,
      heartbeatPresent: !!heartbeat,
      heartbeatFresh: heartbeatTurnDelta === null ? !!heartbeat : heartbeatTurnDelta <= HEARTBEAT_FRESH_TURN_DELTA,
      heartbeatTurn,
      heartbeatTurnDelta,
      heartbeatWrittenAt: typeof heartbeat?.writtenAt === 'string' ? heartbeat.writtenAt : null,
      moduleCount: activeModules.length,
      modules: activeModules,
      advertisedModules,
    };
  }

  const FrontierSdkModule = {
    id: 'sdk',
    version: SDK_VERSION,
    label: 'BetterDungeon SDK',
    description: 'Exposes stable BetterDungeon and Frontier capability metadata to scripts.',

    ops: {
      version: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: versionOp,
      },
      capabilities: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: capabilitiesOp,
      },
      modules: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: modulesOp,
      },
      frontier: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: frontierOp,
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
