// modules/sdk/module.js
//
// Frontier BetterDungeon SDK module. Exposes BetterDungeon-facing metadata
// that does not belong in Frontier heartbeat discovery.

(function () {
  if (window.FrontierSdkModule) return;

  const SDK_VERSION = '1.0.0';
  const FRONTIER_PROTOCOL = 1;
  const FRONTIER_CLIENT = 'BetterDungeon';
  const SDK_MESSAGE = 'FRONTIER_SDK_REQUEST';
  const STORAGE_KEYS = {
    features: 'betterDungeonFeatures',
    frontierModules: 'frontier_enabled_modules',
    frontierDebug: 'frontier_debug',
    scriptureWidgetDisplay: 'frontier_mod_scripture_widget_display',
    webfetchAllowlist: 'frontier_webfetch_allowlist',
    aiOpenRouterKey: 'frontier_ai_openrouter_api_key',
    aiOpenRouterDefaultModel: 'frontier_ai_openrouter_default_model',
    aiCostControls: 'frontier_ai_cost_controls',
    legacyAiBudget: 'frontier_ai_budget',
    legacyProviderAiOpenRouterKey: 'frontier_provider_ai_openrouter_api_key',
    legacyProviderAiOpenRouterDefaultModel: 'frontier_provider_ai_openrouter_default_model',
  };
  const DEFAULT_FEATURES = {
    frontier: true,
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
  const FRONTIER_MODULES = [
    'scripture',
    'webfetch',
    'clock',
    'sdk',
    'geolocation',
    'weather',
    'network',
    'system',
    'ai',
  ];
  const DEFAULT_SCRIPTURE_WIDGET_DISPLAY = {
    size: 'normal',
    maxHeight: 'medium',
    layout: 'balanced',
  };
  const DEFAULT_AI_COST_CONTROLS = {
    freeModelsOnly: true,
    advancedOpen: false,
    maxPromptPricePerMillion: 0,
    maxCompletionPricePerMillion: 0,
    perCallEstimateCap: 0,
    dailySpendCap: 0,
    monthlySpendCap: 0,
  };

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

  function getStorageArea() {
    if (typeof browser !== 'undefined' && browser?.storage?.sync) return browser.storage.sync;
    if (typeof chrome !== 'undefined' && chrome?.storage?.sync) return chrome.storage.sync;
    return null;
  }

  function getLocalStorageArea() {
    if (typeof browser !== 'undefined' && browser?.storage?.local) return browser.storage.local;
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) return chrome.storage.local;
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

  function localStorageGet(keys) {
    return storageAreaGet(getLocalStorageArea(), keys);
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

  function normalizeFeatures(raw) {
    return { ...DEFAULT_FEATURES, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  function normalizeFrontierModules(raw) {
    const out = {};
    const saved = raw && typeof raw === 'object' ? raw : {};
    for (let i = 0; i < FRONTIER_MODULES.length; i++) {
      out[FRONTIER_MODULES[i]] = true;
    }
    for (const [key, value] of Object.entries(saved)) {
      const normalizedKey = key === 'providerAI' ? 'ai' : key;
      if (FRONTIER_MODULES.includes(normalizedKey)) out[normalizedKey] = !!value;
    }
    return out;
  }

  function normalizeScriptureDisplay(raw) {
    const display = raw && typeof raw === 'object' ? raw : {};
    const size = ['compact', 'normal', 'comfortable', 'large'].includes(String(display.size || '').toLowerCase())
      ? String(display.size).toLowerCase()
      : DEFAULT_SCRIPTURE_WIDGET_DISPLAY.size;
    const maxHeight = ['short', 'medium', 'tall'].includes(String(display.maxHeight || '').toLowerCase())
      ? String(display.maxHeight).toLowerCase()
      : DEFAULT_SCRIPTURE_WIDGET_DISPLAY.maxHeight;
    const layout = ['balanced', 'stacked'].includes(String(display.layout || '').toLowerCase())
      ? String(display.layout).toLowerCase()
      : DEFAULT_SCRIPTURE_WIDGET_DISPLAY.layout;
    return { size, maxHeight, layout };
  }

  function clampMoney(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, 1000);
  }

  function normalizeAiCostControls(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      freeModelsOnly: value.freeModelsOnly !== false,
      advancedOpen: value.advancedOpen === true,
      maxPromptPricePerMillion: clampMoney(value.maxPromptPricePerMillion, DEFAULT_AI_COST_CONTROLS.maxPromptPricePerMillion),
      maxCompletionPricePerMillion: clampMoney(value.maxCompletionPricePerMillion, DEFAULT_AI_COST_CONTROLS.maxCompletionPricePerMillion),
      perCallEstimateCap: clampMoney(value.perCallEstimateCap, DEFAULT_AI_COST_CONTROLS.perCallEstimateCap),
      dailySpendCap: clampMoney(value.dailySpendCap, DEFAULT_AI_COST_CONTROLS.dailySpendCap),
      monthlySpendCap: clampMoney(value.monthlySpendCap, DEFAULT_AI_COST_CONTROLS.monthlySpendCap),
    };
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
        frontierProtocol: getFrontierProtocol(ctx),
        frontierClient: getFrontierClientName(),
        features: normalizeFeatures(backgroundConfig.features),
        frontier: {
          ...((backgroundConfig.frontier && typeof backgroundConfig.frontier === 'object') ? backgroundConfig.frontier : {}),
          enabled: normalizeFeatures(backgroundConfig.features).frontier !== false,
          runtimeEnabled: typeof getCore()?.isEnabled === 'function' ? !!getCore().isEnabled() : !!getCore()?.inspect?.()?.enabled,
        },
      };
    }

    const syncResult = await storageGet([
      STORAGE_KEYS.features,
      STORAGE_KEYS.frontierModules,
      STORAGE_KEYS.frontierDebug,
      STORAGE_KEYS.scriptureWidgetDisplay,
      STORAGE_KEYS.webfetchAllowlist,
    ]);
    const localResult = await localStorageGet([
      STORAGE_KEYS.aiOpenRouterKey,
      STORAGE_KEYS.aiOpenRouterDefaultModel,
      STORAGE_KEYS.aiCostControls,
      STORAGE_KEYS.legacyAiBudget,
      STORAGE_KEYS.legacyProviderAiOpenRouterKey,
      STORAGE_KEYS.legacyProviderAiOpenRouterDefaultModel,
    ]);

    const features = normalizeFeatures(syncResult[STORAGE_KEYS.features]);
    const frontierModules = normalizeFrontierModules(syncResult[STORAGE_KEYS.frontierModules]);
    const scriptureDisplay = normalizeScriptureDisplay(syncResult[STORAGE_KEYS.scriptureWidgetDisplay]);
    const aiCostControls = normalizeAiCostControls(
      localResult[STORAGE_KEYS.aiCostControls] || localResult[STORAGE_KEYS.legacyAiBudget]
    );
    const currentKey = String(localResult[STORAGE_KEYS.aiOpenRouterKey] || '').trim();
    const legacyKey = String(localResult[STORAGE_KEYS.legacyProviderAiOpenRouterKey] || '').trim();
    const currentModel = String(localResult[STORAGE_KEYS.aiOpenRouterDefaultModel] || '').trim();
    const legacyModel = String(localResult[STORAGE_KEYS.legacyProviderAiOpenRouterDefaultModel] || '').trim();

    return {
      sdkVersion: SDK_VERSION,
      betterDungeonVersion: getBetterDungeonVersion(),
      frontierProtocol: getFrontierProtocol(ctx),
      frontierClient: getFrontierClientName(),
      features,
      frontier: {
        enabled: features.frontier !== false,
        runtimeEnabled: typeof getCore()?.isEnabled === 'function' ? !!getCore().isEnabled() : !!getCore()?.inspect?.()?.enabled,
        debug: !!syncResult[STORAGE_KEYS.frontierDebug],
        modulePreferences: frontierModules,
        scriptureDisplay,
        webfetch: summarizeWebFetchAllowlist(syncResult[STORAGE_KEYS.webfetchAllowlist]),
        ai: {
          configured: !!(currentKey || legacyKey),
          defaultModel: currentModel || legacyModel || null,
          costControls: aiCostControls,
        },
      },
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
