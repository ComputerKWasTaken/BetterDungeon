// BetterDungeon - Custom Dynamic
// Bridges popup/storage state to the main-world Custom Dynamic router.
// Functionality directly inspired by Zoocata's PRISM
// https://play.aidungeon.com/profile/Zoocata_

class CustomDynamicFeature {
  static id = 'customDynamic';

  constructor() {
    this.enabled = true;
    this.namespace = 'betterdungeon-custom-dynamic-v1';
    this.configStorageKey = 'betterDungeon_customDynamicConfig';
    this.runtimeStorageKey = 'betterDungeon_customDynamicRuntime';

    this.defaultConfig = {
      enabled: true,
      routingMode: 'weighted-random',
      switchMode: 'auto',
      repeatPenalty: 0.2,
      failOpen: true,
      debug: false,
      generationUrlPatterns: [],
      modelPaths: [],
      pool: []
    };

    this.defaultRuntime = {
      adapter: null,
      logs: [],
      lastModelId: '',
      roundRobinCursor: 0
    };

    this.boundMessageHandler = this.handlePageMessage.bind(this);
    this.boundStorageHandler = this.handleStorageChanged.bind(this);
  }

  async init() {
    console.log('[CustomDynamic] Initializing Custom Dynamic feature...');
    this.enabled = true;
    window.addEventListener('message', this.boundMessageHandler, false);

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.boundStorageHandler);
    }

    await this.ensureInitialState();
    await this.postState();
  }

  destroy() {
    console.log('[CustomDynamic] Destroying Custom Dynamic feature...');
    this.enabled = false;
    window.removeEventListener('message', this.boundMessageHandler, false);

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.boundStorageHandler);
    }

    void this.postState({ forceDisabled: true });
  }

  async ensureInitialState() {
    const [configResult, runtimeResult] = await Promise.all([
      this.storageGet('sync', this.configStorageKey),
      this.storageGet('local', this.runtimeStorageKey)
    ]);

    if (!configResult?.[this.configStorageKey]) {
      await this.storageSet('sync', { [this.configStorageKey]: { ...this.defaultConfig } });
    }

    if (!runtimeResult?.[this.runtimeStorageKey]) {
      await this.storageSet('local', { [this.runtimeStorageKey]: { ...this.defaultRuntime } });
    }
  }

  async postState(options = {}) {
    const [configResult, runtimeResult] = await Promise.all([
      this.storageGet('sync', this.configStorageKey),
      this.storageGet('local', this.runtimeStorageKey)
    ]);

    const config = this.normalizeConfig(configResult?.[this.configStorageKey]);
    const runtime = this.normalizeRuntime(runtimeResult?.[this.runtimeStorageKey]);
    if (options.forceDisabled) config.enabled = false;

    window.postMessage({
      namespace: this.namespace,
      direction: 'extension-to-page',
      type: 'state',
      payload: { config, runtime }
    }, window.location.origin);
  }

  handlePageMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.namespace !== this.namespace || data.direction !== 'page-to-extension') return;

    if (data.type === 'ready') {
      void this.postState();
      return;
    }

    if (data.type === 'runtime-event' && data.payload) {
      void this.persistRuntimeEvent(data.payload);
    }
  }

  handleStorageChanged(changes, areaName) {
    if (!this.enabled) return;
    const configChanged = areaName === 'sync' && changes?.[this.configStorageKey];
    const runtimeChanged = areaName === 'local' && changes?.[this.runtimeStorageKey];
    if (configChanged || runtimeChanged) void this.postState();
  }

  async persistRuntimeEvent(event) {
    const result = await this.storageGet('local', this.runtimeStorageKey);
    const runtime = this.normalizeRuntime(result?.[this.runtimeStorageKey]);
    const timestamp = new Date().toISOString();

    if (event.kind === 'adapter-learned' && event.adapter) {
      runtime.adapter = {
        ...event.adapter,
        learnedAt: timestamp
      };
    }

    if (event.kind === 'round-robin-cursor' && Number.isInteger(event.cursor)) {
      runtime.roundRobinCursor = event.cursor;
    }

    if (event.kind === 'last-model' && event.modelId) {
      runtime.lastModelId = this.cleanModelName(event.modelId);
      runtime.lastMechanism = event.mechanism || runtime.lastMechanism || '';
      runtime.lastRoutedAt = timestamp;
    }

    if (event.kind === 'log') {
      runtime.logs.unshift({
        at: timestamp,
        level: event.level || 'info',
        message: String(event.message || ''),
        details: event.details || null
      });
      runtime.logs = runtime.logs.slice(0, 160);
    }

    await this.storageSet('local', { [this.runtimeStorageKey]: runtime });
  }

  normalizeConfig(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      ...this.defaultConfig,
      ...raw,
      enabled: true,
      routingMode: ['weighted-random', 'round-robin', 'avoid-last'].includes(raw.routingMode)
        ? raw.routingMode
        : this.defaultConfig.routingMode,
      switchMode: ['auto', 'request-body', 'learned-request', 'ui'].includes(raw.switchMode)
        ? raw.switchMode
        : this.defaultConfig.switchMode,
      repeatPenalty: this.clampNumber(raw.repeatPenalty, this.defaultConfig.repeatPenalty, 0, 1),
      failOpen: raw.failOpen !== false,
      debug: Boolean(raw.debug),
      generationUrlPatterns: Array.isArray(raw.generationUrlPatterns) ? raw.generationUrlPatterns.filter(Boolean) : [],
      modelPaths: Array.isArray(raw.modelPaths) ? raw.modelPaths.filter(Boolean) : [],
      pool: Array.isArray(raw.pool)
        ? raw.pool.map((model) => ({
        enabled: model?.enabled !== false,
        modelId: this.cleanModelName(model?.modelId || model?.id || ''),
        label: this.cleanModelName(model?.label || model?.modelId || model?.id || ''),
        weight: this.clampNumber(model?.weight, 1, 0.01, 100)
        })).filter((model) => model.modelId)
        : []
    };
  }

  normalizeRuntime(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      ...this.defaultRuntime,
      ...raw,
      logs: Array.isArray(raw.logs) ? raw.logs : [],
      lastModelId: this.cleanModelName(raw.lastModelId || ''),
      roundRobinCursor: Number.isInteger(raw.roundRobinCursor) ? raw.roundRobinCursor : 0
    };
  }

  storageGet(areaName, keys) {
    return new Promise((resolve) => {
      const area = this.getStorageArea(areaName);
      if (!area?.get) {
        resolve({});
        return;
      }

      try {
        const maybePromise = area.get(keys, (result) => resolve(result || {}));
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then((result) => resolve(result || {}), () => resolve({}));
        }
      } catch {
        try {
          const maybePromise = area.get(keys);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then((result) => resolve(result || {}), () => resolve({}));
          } else {
            resolve({});
          }
        } catch {
          resolve({});
        }
      }
    });
  }

  storageSet(areaName, data) {
    return new Promise((resolve) => {
      const area = this.getStorageArea(areaName);
      if (!area?.set) {
        resolve();
        return;
      }

      try {
        const maybePromise = area.set(data, () => resolve());
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, resolve);
        }
      } catch {
        try {
          const maybePromise = area.set(data);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(resolve, resolve);
          } else {
            resolve();
          }
        } catch {
          resolve();
        }
      }
    });
  }

  getStorageArea(areaName) {
    const api =
      (typeof browser !== 'undefined' && browser?.storage) ? browser :
      (typeof chrome !== 'undefined' && chrome?.storage) ? chrome :
      null;
    return api?.storage?.[areaName] || null;
  }

  cleanModelName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }
}

if (typeof window !== 'undefined') {
  window.CustomDynamicFeature = CustomDynamicFeature;
}
