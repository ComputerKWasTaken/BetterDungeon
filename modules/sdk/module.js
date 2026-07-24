// modules/sdk/module.js
//
// Ultrascripts BetterDungeon SDK module. Exposes BetterDungeon-facing metadata
// that does not belong in Ultrascripts heartbeat discovery.

(function () {
  if (window.UltrascriptsSdkModule) return;

  const SDK_VERSION = '1.0.0';
  const ULTRASCRIPTS_PROTOCOL = 1;
  const ULTRASCRIPTS_CLIENT = 'BetterDungeon';
  const SDK_MESSAGE = 'ULTRASCRIPTS_SDK_REQUEST';
  const STORAGE_KEYS = {
    features: 'betterDungeonFeatures',
    ultrascriptsModules: 'ultrascripts_enabled_modules',
    ultrascriptsDebug: 'ultrascripts_debug',
    webfetchAllowlist: 'ultrascripts_webfetch_allowlist',
  };
  const DEFAULT_FEATURES = {
    ultrascripts: true,
    markdown: true,
    command: true,
    try: true,
    triggerHighlight: true,
    hotkey: true,
    favoriteInstructions: true,
    inputModeColor: true,
    characterPreset: true,
    autoSee: false,
    notes: true,
    storyCardModalDock: true,
    inputHistory: true,
    textToSpeech: false,
  };
  const ULTRASCRIPTS_MODULES = [
    'widget',
    'webfetch',
    'clock',
    'sdk',
    'weather',
    'network',
    'system',
    'ai',
  ];
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
    return window.Ultrascripts?.core || null;
  }

  function getStorageArea() {
    if (typeof browser !== 'undefined' && browser?.storage?.sync) return browser.storage.sync;
    if (typeof chrome !== 'undefined' && chrome?.storage?.sync) return chrome.storage.sync;
    return null;
  }

  function getRuntime() {
    if (typeof browser !== 'undefined' && browser?.runtime) return browser.runtime;
    if (typeof chrome !== 'undefined' && chrome?.runtime) return chrome.runtime;
    return null;
  }

  function storageAreaGet(area, keys) {
    if (!area?.get) return Promise.resolve({});
    try {
      const maybePromise = area.get(keys);
      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise.then((result) => result || {}).catch(() => ({}));
      }
    } catch {
      // Fall back to callback form below.
    }

    return new Promise((resolve) => {
      try {
        area.get(keys, (result) => resolve(result || {}));
      } catch {
        resolve({});
      }
    });
  }

  function storageGet(keys) {
    return storageAreaGet(getStorageArea(), keys);
  }

  function backgroundRequest(request) {
    const runtime = getRuntime();
    if (!runtime?.sendMessage) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const maybePromise = runtime.sendMessage({ type: SDK_MESSAGE, request }, (response) => {
          const lastError =
            (typeof chrome !== 'undefined' && chrome?.runtime?.lastError)
            || (typeof browser !== 'undefined' && browser?.runtime?.lastError)
            || null;
          if (lastError) {
            resolve(null);
            return;
          }
          resolve(response?.ok ? (response.data || null) : null);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(
            (response) => resolve(response?.ok ? (response.data || null) : null),
            () => resolve(null),
          );
        }
      } catch {
        resolve(null);
      }
    });
  }

  function getUltrascriptsProtocol(ctx) {
    const core = getCore();
    if (typeof core?.getProtocolVersion === 'function') {
      return core.getProtocolVersion();
    }
    return ULTRASCRIPTS_PROTOCOL;
  }

  function getUltrascriptsClientName() {
    const core = getCore();
    if (typeof core?.getClientName === 'function') {
      return core.getClientName();
    }
    return ULTRASCRIPTS_CLIENT;
  }

  function versionOp(args = {}) {
    normalizeArgs(args);
    return {
      sdkVersion: SDK_VERSION,
      betterDungeonVersion: getBetterDungeonVersion(),
      ultrascriptsProtocol: getUltrascriptsProtocol(),
      ultrascriptsClient: getUltrascriptsClientName(),
    };
  }

  function normalizeFeatures(raw) {
    return { ...DEFAULT_FEATURES, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  function normalizeUltrascriptsModules(raw) {
    const out = {};
    const saved = raw && typeof raw === 'object' ? raw : {};
    for (let i = 0; i < ULTRASCRIPTS_MODULES.length; i++) {
      out[ULTRASCRIPTS_MODULES[i]] = true;
    }
    for (const [key, value] of Object.entries(saved)) {
      if (ULTRASCRIPTS_MODULES.includes(key)) out[key] = !!value;
    }
    return out;
  }

  function summarizeWebFetchAllowlist(raw) {
    const entries = raw && typeof raw === 'object' ? Object.entries(raw) : [];
    let allowCount = 0;
    let denyCount = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i][1];
      if (!entry || typeof entry !== 'object') continue;
      if (entry.decision === 'allow') allowCount++;
      else if (entry.decision === 'deny') denyCount++;
    }
    return {
      savedOriginCount: allowCount + denyCount,
      allowCount,
      denyCount,
    };
  }

  async function configOp(args = {}, ctx) {
    normalizeArgs(args);

    const backgroundConfig = await backgroundRequest({ op: 'config' });
    if (backgroundConfig && typeof backgroundConfig === 'object') {
      return {
        sdkVersion: SDK_VERSION,
        betterDungeonVersion: getBetterDungeonVersion(),
        ultrascriptsProtocol: getUltrascriptsProtocol(ctx),
        ultrascriptsClient: getUltrascriptsClientName(),
        features: normalizeFeatures(backgroundConfig.features),
        ultrascripts: {
          ...((backgroundConfig.ultrascripts && typeof backgroundConfig.ultrascripts === 'object') ? backgroundConfig.ultrascripts : {}),
          enabled: normalizeFeatures(backgroundConfig.features).ultrascripts !== false,
          runtimeEnabled: typeof getCore()?.isEnabled === 'function' ? !!getCore().isEnabled() : !!getCore()?.inspect?.()?.enabled,
        },
      };
    }

    const syncResult = await storageGet([
      STORAGE_KEYS.features,
      STORAGE_KEYS.ultrascriptsModules,
      STORAGE_KEYS.ultrascriptsDebug,
      STORAGE_KEYS.webfetchAllowlist,
    ]);

    const features = normalizeFeatures(syncResult[STORAGE_KEYS.features]);
    const ultrascriptsModules = normalizeUltrascriptsModules(syncResult[STORAGE_KEYS.ultrascriptsModules]);

    return {
      sdkVersion: SDK_VERSION,
      betterDungeonVersion: getBetterDungeonVersion(),
      ultrascriptsProtocol: getUltrascriptsProtocol(ctx),
      ultrascriptsClient: getUltrascriptsClientName(),
      features,
      ultrascripts: {
        enabled: features.ultrascripts !== false,
        runtimeEnabled: typeof getCore()?.isEnabled === 'function' ? !!getCore().isEnabled() : !!getCore()?.inspect?.()?.enabled,
        debug: !!syncResult[STORAGE_KEYS.ultrascriptsDebug],
        modulePreferences: ultrascriptsModules,
        webfetch: summarizeWebFetchAllowlist(syncResult[STORAGE_KEYS.webfetchAllowlist]),
      },
    };
  }

  const UltrascriptsSdkModule = {
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
      config: {
        idempotent: 'safe',
        timeoutMs: 1500,
        handler: configOp,
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

  window.UltrascriptsSdkModule = UltrascriptsSdkModule;

  if (window.Ultrascripts?.registry) {
    window.Ultrascripts.registry.register(UltrascriptsSdkModule);
  } else {
    console.warn('[SDK] Ultrascripts registry not available; SDK module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UltrascriptsSdkModule;
  }
})();
