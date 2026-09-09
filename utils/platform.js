// BetterDungeon - shared platform contract
// Android supplies an immutable native configuration before this file runs.
// Browser contexts fall back to the extension defaults below.

(function () {
  'use strict';

  if (globalThis.BetterDungeonPlatform) return;

  const browserCapabilities = {
    nativeBridge: false,
    nativeAiTransport: false,
    nativeWebFetch: false,
    popupBridge: false,
    physicalBack: false,
    touchControls: false,
    imeViewportHandling: false,
    caretScrollFix: false,
    storageAreasAliased: false,
    embeddedLoginRestricted: false,
    nativeAssetDataUri: false,
    androidSettings: false,
    longWebViewTransitions: false,
    draggableWidgetControl: false
  };

  const browserFeatures = [
    'ultrascripts',
    'command',
    'try',
    'triggerHighlight',
    'hotkey',
    'favoriteInstructions',
    'inputModeColor',
    'characterPreset',
    'autoSee',
    'storyCardAnalytics',
    'notes',
    'storyCardModalDock',
    'inputHistory',
    'customDynamic',
    'navigator'
  ];

  const safeAndroidCapabilities = {
    ...browserCapabilities,
    nativeBridge: true,
    nativeAiTransport: true,
    nativeWebFetch: true,
    popupBridge: true,
    physicalBack: true,
    touchControls: true,
    imeViewportHandling: true,
    caretScrollFix: true,
    storageAreasAliased: true,
    embeddedLoginRestricted: true,
    nativeAssetDataUri: true,
    androidSettings: true,
    longWebViewTransitions: true,
    draggableWidgetControl: true
  };

  const safeAndroidFeatures = browserFeatures.filter(
    feature => feature !== 'hotkey' && feature !== 'storyCardModalDock'
  );

  function parseNativeConfig() {
    let candidate = globalThis.__betterDungeonNativePlatformConfig;
    if (!candidate && globalThis.BetterDungeonBridge?.getPlatformConfig) {
      try {
        candidate = globalThis.BetterDungeonBridge.getPlatformConfig();
      } catch (error) {
        console.warn('[BetterDungeon] Unable to read native platform configuration:', error);
      }
    }

    if (!candidate) return null;
    try {
      const parsed = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
      return parsed && parsed.kind === 'android-webview' ? parsed : null;
    } catch (error) {
      console.warn('[BetterDungeon] Invalid native platform configuration:', error);
      return { kind: 'android-webview' };
    }
  }

  const nativeConfig = parseNativeConfig();
  const isAndroid = nativeConfig?.kind === 'android-webview';
  const capabilities = Object.freeze({
    ...(isAndroid ? safeAndroidCapabilities : browserCapabilities),
    ...(nativeConfig?.capabilities || {})
  });
  const supportedFeatures = Object.freeze(
    Array.isArray(nativeConfig?.supportedFeatures)
      ? [...new Set(nativeConfig.supportedFeatures.filter(value => typeof value === 'string'))]
      : [...(isAndroid ? safeAndroidFeatures : browserFeatures)]
  );

  let readyPromise;
  function whenReady() {
    if (!isAndroid || !capabilities.popupBridge || location.protocol !== 'file:') {
      return Promise.resolve();
    }
    if (globalThis.__bdPopupBridgeReady) return Promise.resolve();
    if (!readyPromise) {
      readyPromise = new Promise(resolve => {
        globalThis.addEventListener('betterdungeon:popup-bridge-ready', resolve, { once: true });
      });
    }
    return readyPromise;
  }

  function chromeArea(name) {
    return globalThis.chrome?.storage?.[name];
  }

  function storageCall(areaName, method, value) {
    return new Promise((resolve, reject) => {
      const area = chromeArea(areaName);
      if (!area || typeof area[method] !== 'function') {
        reject(new Error(`Storage area ${areaName}.${method} is unavailable`));
        return;
      }
      let settled = false;
      const callback = result => {
        if (settled) return;
        settled = true;
        const error = globalThis.chrome?.runtime?.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else resolve(result);
      };
      try {
        const result = area[method](value, callback);
        if (result?.then) result.then(callback, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  function runtimeSend(message) {
    return whenReady().then(() => new Promise((resolve, reject) => {
      const sendMessage = globalThis.chrome?.runtime?.sendMessage;
      if (typeof sendMessage !== 'function') {
        reject(new Error('Runtime messaging is unavailable'));
        return;
      }
      let settled = false;
      const callback = response => {
        if (settled) return;
        settled = true;
        const error = globalThis.chrome?.runtime?.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else resolve(response);
      };
      try {
        const result = sendMessage.call(globalThis.chrome.runtime, message, callback);
        if (result?.then) result.then(callback, reject);
      } catch (error) {
        reject(error);
      }
    }));
  }

  const platform = Object.freeze({
    kind: isAndroid ? 'android-webview' : 'browser',
    formFactor: isAndroid ? 'mobile' : 'desktop',
    capabilities,
    supportedFeatures,
    has: capability => capabilities[capability] === true,
    supportsFeature: feature => supportedFeatures.includes(feature),
    whenReady,
    storage: Object.freeze({
      get: (area, keys) => storageCall(area, 'get', keys),
      set: (area, values) => storageCall(area, 'set', values),
      remove: (area, keys) => storageCall(area, 'remove', keys)
    }),
    runtime: Object.freeze({ sendMessage: runtimeSend })
  });

  globalThis.BetterDungeonPlatform = platform;
  if (globalThis.document?.documentElement) {
    document.documentElement.dataset.bdPlatform = platform.kind;
    document.documentElement.dataset.bdFormFactor = platform.formFactor;
  }
})();

