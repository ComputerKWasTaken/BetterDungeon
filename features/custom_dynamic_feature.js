// BetterDungeon - Custom Dynamic
// Bridges popup/storage state to the main-world Custom Dynamic router.
// Functionality directly inspired by Zoocata's PRISM
// https://play.aidungeon.com/profile/Zoocata_

class CustomDynamicFeature {
  static id = 'customDynamic';
  static catalogSchemaVersion = 2;
  static versionRefreshTtlMs = 10 * 60 * 1000;

  constructor() {
    this.enabled = true;
    this.namespace = 'betterdungeon-custom-dynamic-v1';
    this.configStorageKey = 'betterDungeon_customDynamicConfig';
    this.runtimeStorageKey = 'betterDungeon_customDynamicRuntime';

    this.defaultConfig = {
      enabled: true,
      turnInterval: 1,
      pool: []
    };

    this.defaultRuntime = {
      lastModelId: '',
      lastModelLabel: '',
      lastVersionName: '',
      lastVersionLabel: '',
      turnsOnModel: 0,
      lastRoutedAt: '',
      visibleVersionsSchemaVersion: CustomDynamicFeature.catalogSchemaVersion,
      visibleVersions: [],
      visibleVersionsRefreshedAt: ''
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
    void this.refreshVisibleVersions();
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
      return;
    }

    if (data.type === 'switch-model' && data.payload) {
      void this.switchModelVersion(data.payload).then((result) => {
        window.postMessage({
          namespace: this.namespace,
          direction: 'extension-to-page',
          type: 'switch-model-result',
          payload: {
            requestId: data.payload.requestId,
            ...result
          }
        }, window.location.origin);
      });
    }
  }

  handleStorageChanged(changes, areaName) {
    if (!this.enabled) return;
    const configChanged = areaName === 'sync' && changes?.[this.configStorageKey];
    const runtimeChanged = areaName === 'local' && changes?.[this.runtimeStorageKey];
    if (configChanged || runtimeChanged) void this.postState();
  }

  async persistRuntimeEvent(event) {
    if (event.kind !== 'selection-state' || !event.modelId) return;

    const result = await this.storageGet('local', this.runtimeStorageKey);
    const runtime = this.normalizeRuntime(result?.[this.runtimeStorageKey]);
    const timestamp = new Date().toISOString();

    runtime.lastModelId = this.cleanModelName(event.modelId);
    runtime.lastModelLabel = this.cleanModelName(event.label || event.modelId);
    runtime.lastVersionName = this.cleanModelName(event.versionName || event.modelId);
    runtime.lastVersionLabel = this.cleanModelName(event.versionLabel || event.versionName || event.modelId);
    runtime.turnsOnModel = this.clampInteger(event.turnsOnModel, 1, 0, 1000000);
    runtime.lastRoutedAt = timestamp;

    await this.storageSet('local', { [this.runtimeStorageKey]: runtime });
  }

  async switchModelVersion(payload = {}) {
    const versionName = this.cleanModelName(payload.versionName || payload.modelId || '');
    if (!versionName) {
      return { success: false, error: 'No AI Dungeon model version was provided.' };
    }

    const gql = await this.waitForGqlCredentials(1000);
    if (!gql) {
      return { success: false, error: 'AI Dungeon GraphQL is not ready.' };
    }

    try {
      await gql.saveSettings({ storyAiVersionName: versionName }, { timeoutMs: 5000 });
      return { success: true, mechanism: 'graphql-settings', versionName };
    } catch (error) {
      return {
        success: false,
        error: error?.message || String(error)
      };
    }
  }

  async refreshVisibleVersions(options = {}) {
    const runtimeResult = await this.storageGet('local', this.runtimeStorageKey);
    const runtime = this.normalizeRuntime(runtimeResult?.[this.runtimeStorageKey]);
    const refreshedAt = Date.parse(runtime.visibleVersionsRefreshedAt || '');
    if (!options.force && runtime.visibleVersions.length && Number.isFinite(refreshedAt) && Date.now() - refreshedAt < CustomDynamicFeature.versionRefreshTtlMs) {
      return runtime.visibleVersions;
    }

    const gql = await this.waitForGqlCredentials(8000);
    if (!gql) {
      if (options.force) {
        throw new Error('Open AI Dungeon and wait for the page to finish loading, then refresh models again.');
      }
      return runtime.visibleVersions;
    }

    try {
      const versions = await gql.getAiVisibleVersions({ timeoutMs: 15000 });
      const visibleVersions = this.harmonizeModelFamilies(versions
        .map((version) => this.normalizeVisibleVersion(version))
        .filter((version) => version.versionName && version.modelId && version.modelTitle)
        .filter((version) => !version.type || version.type.toLowerCase() === 'text')
        .filter((version) => version.available !== false)
        .filter((version) => !version.isDeprecated));

      const updated = this.normalizeRuntime((await this.storageGet('local', this.runtimeStorageKey))?.[this.runtimeStorageKey]);
      updated.visibleVersions = this.sortVisibleVersions(this.dedupeVisibleVersions(visibleVersions));
      updated.visibleVersionsSchemaVersion = CustomDynamicFeature.catalogSchemaVersion;
      updated.visibleVersionsRefreshedAt = new Date().toISOString();
      await this.storageSet('local', { [this.runtimeStorageKey]: updated });
      return updated.visibleVersions;
    } catch (error) {
      if (options.force) throw error;
      return runtime.visibleVersions;
    }
  }

  normalizeVisibleVersion(version) {
    const engineName = this.cleanModelName(version?.engineNameEngine?.engineName || '');
    const versionName = this.cleanModelName(version?.versionName || '');
    const modelTitle = this.cleanModelName(
      version?.aiDetails?.title
      || version?.aiDetails?.displayName
      || version?.aiDetails?.name
      || this.prettifyVersionName(engineName)
    );
    const versionTitle = this.cleanModelName(
      version?.aiDetails?.versionTitle
      || version?.aiDetails?.version
      || versionName
    );
    const aliases = this.collectVersionAliases(version);
    return {
      modelId: engineName || modelTitle || versionName,
      modelTitle: modelTitle || engineName || versionName,
      versionName,
      versionTitle,
      modelOrder: this.orderNumber(version?.aiDetails?.engineOrder),
      versionOrder: this.orderNumber(version?.aiDetails?.versionOrder),
      type: this.cleanModelName(version?.type || ''),
      available: version?.available !== false,
      isDeprecated: this.isDeprecatedVersion(version),
      aliases: aliases.slice(0, 24)
    };
  }

  collectVersionAliases(version) {
    const strings = [];
    const push = (value) => {
      const cleaned = this.cleanModelName(value);
      if (cleaned && !strings.some((item) => this.sameModel(item, cleaned))) strings.push(cleaned);
    };

    push(version?.aiDetails?.displayName);
    push(version?.aiDetails?.name);
    push(version?.aiDetails?.title);
    push(version?.aiDetails?.label);
    push(version?.aiDetails?.versionTitle);
    push(version?.aiDetails?.version);
    push(version?.aiDetails?.modelName);
    if (Array.isArray(version?.aiDetails?.tags)) {
      version.aiDetails.tags.forEach(push);
    }
    push(version?.aiSettings?.displayName);
    push(version?.aiSettings?.name);
    push(version?.engineNameEngine?.engineName);
    push(version?.versionName);
    return strings;
  }

  isDeprecatedVersion(version) {
    return Boolean(version?.aiSettings?.isDeprecatedModel)
      || Boolean(version?.aiSettings?.isDeprecatedVersion)
      || /deprecated/i.test(String(version?.aiDetails?.shortDescription || ''));
  }

  harmonizeModelFamilies(versions) {
    const families = new Map();
    for (const version of versions) {
      const key = this.canonicalModelName(version.modelId);
      if (!key || families.has(key)) continue;
      families.set(key, {
        modelTitle: version.modelTitle,
        modelOrder: version.modelOrder
      });
    }

    return versions.map((version) => {
      const family = families.get(this.canonicalModelName(version.modelId));
      return family ? {
        ...version,
        modelTitle: family.modelTitle,
        modelOrder: family.modelOrder
      } : version;
    });
  }

  dedupeVisibleVersions(versions) {
    const seen = new Set();
    const out = [];
    for (const version of versions) {
      const key = this.canonicalModelName(version.versionName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(version);
    }
    return out;
  }

  sortVisibleVersions(versions) {
    return [...versions].sort((left, right) =>
      left.modelOrder - right.modelOrder
      || left.modelTitle.localeCompare(right.modelTitle)
      || left.versionOrder - right.versionOrder
      || left.versionTitle.localeCompare(right.versionTitle)
    );
  }

  prettifyVersionName(value) {
    return this.cleanModelName(value)
      .replace(/\b\d+\.\d+\.\d+\b/g, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  async waitForGqlCredentials(timeoutMs = 0) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
      const gql = window.BetterDungeonGQL;
      if (gql?.hasBaseCredentials?.()) return gql;
      if (!timeoutMs || Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  normalizeConfig(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      ...this.defaultConfig,
      enabled: true,
      turnInterval: this.clampInteger(raw.turnInterval, this.defaultConfig.turnInterval, 1, 20),
      pool: Array.isArray(raw.pool)
        ? raw.pool.map((model) => ({
          enabled: model?.enabled !== false,
          modelId: this.cleanModelName(model?.modelId || model?.id || ''),
          label: this.cleanModelName(model?.label || model?.modelId || model?.id || ''),
          versionName: this.cleanModelName(model?.versionName || model?.modelId || model?.id || ''),
          versionLabel: this.cleanModelName(model?.versionLabel || model?.versionName || model?.modelId || model?.id || ''),
          weight: this.clampNumber(model?.weight, 1, 0.01, 100)
        })).filter((model) => model.modelId)
        : []
    };
  }

  normalizeRuntime(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const hasCurrentCatalog = Number(raw.visibleVersionsSchemaVersion) === CustomDynamicFeature.catalogSchemaVersion;
    return {
      lastModelId: this.cleanModelName(raw.lastModelId || ''),
      lastModelLabel: this.cleanModelName(raw.lastModelLabel || raw.lastModelId || ''),
      lastVersionName: this.cleanModelName(raw.lastVersionName || raw.lastModelId || ''),
      lastVersionLabel: this.cleanModelName(raw.lastVersionLabel || raw.lastVersionName || raw.lastModelId || ''),
      turnsOnModel: this.clampInteger(raw.turnsOnModel, 0, 0, 1000000),
      lastRoutedAt: this.cleanModelName(raw.lastRoutedAt || ''),
      visibleVersionsSchemaVersion: CustomDynamicFeature.catalogSchemaVersion,
      visibleVersions: hasCurrentCatalog && Array.isArray(raw.visibleVersions) ? raw.visibleVersions : [],
      visibleVersionsRefreshedAt: hasCurrentCatalog
        ? this.cleanModelName(raw.visibleVersionsRefreshedAt || '')
        : ''
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

  canonicalModelName(value) {
    return this.cleanModelName(value)
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/[\u00A0\u202F]/g, ' ')
      .replace(/[\u2010-\u2015]/g, '-')
      .toLowerCase();
  }

  sameModel(left, right) {
    const a = this.canonicalModelName(left);
    const b = this.canonicalModelName(right);
    if (!a || !b) return false;
    return a === b || a.replace(/[^a-z0-9]+/g, '') === b.replace(/[^a-z0-9]+/g, '');
  }

  clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  clampInteger(value, fallback, min, max) {
    return Math.round(this.clampNumber(value, fallback, min, max));
  }

  orderNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
  }
}

if (typeof window !== 'undefined') {
  window.CustomDynamicFeature = CustomDynamicFeature;
}
