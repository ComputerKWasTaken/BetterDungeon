// BetterDungeon - Navigator Settings
//
// Owns the versioned Navigator settings object and the legacy read-only
// compatibility key. This service deliberately exposes no module imports so it
// can be loaded directly by the extension content-script manifest.

(function () {
  if (typeof window === 'undefined' || window.NavigatorSettings) return;

  const STORAGE_KEY = 'betterDungeon_navigator_settings';
  const LEGACY_READ_ONLY_KEY = 'betterDungeon_navigator_read_only';
  const VERSION = 1;
  const MAX_OUTPUT_TOKENS_CEILING = 12288;
  const DEFAULTS = Object.freeze({
    version: VERSION,
    readOnly: false,
    thinkingLevel: 'low',
    contextProfile: 'standard',
    contextChars: 46000,
    storyCardMode: 'directory',
    sendReasoningToCustom: false,
  });
  const THINKING_LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high']);
  const CONTEXT_PROFILES = Object.freeze(['standard', 'extended', 'max', 'custom']);
  const STORY_CARD_MODES = Object.freeze(['directory', 'hybrid', 'full']);
  const listeners = new Set();

  function storage() {
    return typeof chrome !== 'undefined' && chrome.storage?.sync ? chrome.storage.sync : null;
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function booleanOrDefault(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function enumOrDefault(value, values, fallback) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return values.includes(normalized) ? normalized : fallback;
  }

  function integerOrDefault(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  function normalize(raw, legacyReadOnly) {
    const source = isObject(raw) ? raw : {};
    const legacy = legacyReadOnly === true;
    return {
      version: VERSION,
      // The legacy key remains the top-priority safety gate during migration.
      readOnly: legacy || booleanOrDefault(source.readOnly, DEFAULTS.readOnly),
      thinkingLevel: enumOrDefault(source.thinkingLevel, THINKING_LEVELS, DEFAULTS.thinkingLevel),
      contextProfile: enumOrDefault(source.contextProfile, CONTEXT_PROFILES, DEFAULTS.contextProfile),
      contextChars: integerOrDefault(source.contextChars, DEFAULTS.contextChars),
      storyCardMode: enumOrDefault(source.storyCardMode, STORY_CARD_MODES, DEFAULTS.storyCardMode),
      sendReasoningToCustom: booleanOrDefault(source.sendReasoningToCustom, DEFAULTS.sendReasoningToCustom),
    };
  }

  function get(keys) {
    const area = storage();
    if (!area?.get) return Promise.reject(new Error('Navigator settings storage is unavailable.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('Navigator settings storage timed out.')), 2000);
      try {
        area.get(keys, result => finish(resolve, result || {}));
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function set(values) {
    const area = storage();
    if (!area?.set) return Promise.resolve();
    return new Promise(resolve => {
      try {
        const result = area.set(values, resolve);
        if (result?.then) result.then(resolve).catch(resolve);
      } catch {
        resolve();
      }
    });
  }

  async function load() {
    const result = await get([STORAGE_KEY, LEGACY_READ_ONLY_KEY]);
    const settings = normalize(result[STORAGE_KEY], result[LEGACY_READ_ONLY_KEY]);
    const stored = isObject(result[STORAGE_KEY]) ? result[STORAGE_KEY] : null;
    const needsWrite = !stored ||
      JSON.stringify(stored) !== JSON.stringify(settings) ||
      result[LEGACY_READ_ONLY_KEY] !== settings.readOnly;
    if (needsWrite) await set({
      [STORAGE_KEY]: settings,
      [LEGACY_READ_ONLY_KEY]: settings.readOnly,
    });
    return settings;
  }

  async function save(patch) {
    const current = await load();
    const settings = normalize({ ...current, ...(isObject(patch) ? patch : {}) });
    await set({
      [STORAGE_KEY]: settings,
      [LEGACY_READ_ONLY_KEY]: settings.readOnly,
    });
    return settings;
  }

  function watch(listener) {
    if (typeof listener === 'function') listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function outputTokensFor(level, profile = {}) {
    const base = { off: 2048, minimal: 2048, low: 3072, medium: 6144, high: 12288 };
    const requested = base[enumOrDefault(level, THINKING_LEVELS, DEFAULTS.thinkingLevel)] || base.low;
    const ceiling = Number.isSafeInteger(profile.maxOutputTokensCeiling) && profile.maxOutputTokensCeiling > 0
      ? profile.maxOutputTokensCeiling
      : MAX_OUTPUT_TOKENS_CEILING;
    return Math.min(requested, ceiling);
  }

  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'sync' || (!changes?.[STORAGE_KEY] && !changes?.[LEGACY_READ_ONLY_KEY])) return;
      load().then(settings => {
        for (const listener of listeners) {
          try { listener(settings); } catch { /* noop */ }
        }
      }).catch(() => {});
    });
  } catch {
    /* noop */
  }

  const api = {
    STORAGE_KEY,
    LEGACY_READ_ONLY_KEY,
    VERSION,
    MAX_OUTPUT_TOKENS_CEILING,
    DEFAULTS,
    THINKING_LEVELS,
    outputTokensFor,
    normalize,
    load,
    save,
    watch,
  };
  window.NavigatorSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
