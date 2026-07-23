// BetterDungeon - Custom Dynamic
// Bridges popup/storage state to the main-world Custom Dynamic router.
// Functionality directly inspired by Zoocata's PRISM
// https://play.aidungeon.com/profile/Zoocata_

class CustomDynamicFeature {
  static id = 'customDynamic';
  static versionRefreshTtlMs = 10 * 60 * 1000;

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
      roundRobinCursor: 0,
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

  async refreshVisibleVersions(options = {}) {
    const runtimeResult = await this.storageGet('local', this.runtimeStorageKey);
    const runtime = this.normalizeRuntime(runtimeResult?.[this.runtimeStorageKey]);
    const refreshedAt = Date.parse(runtime.visibleVersionsRefreshedAt || '');
    if (!options.force && runtime.visibleVersions.length && Number.isFinite(refreshedAt) && Date.now() - refreshedAt < CustomDynamicFeature.versionRefreshTtlMs) {
      return runtime.visibleVersions;
    }

    const gql = await this.waitForGqlCredentials(8000);
    if (!gql) return runtime.visibleVersions;

    try {
      const versions = await gql.getAiVisibleVersions({ timeoutMs: 15000, includeDeprecated: true });
      const visibleVersions = versions
        .map((version) => this.normalizeVisibleVersion(version))
        .filter((version) => version.versionName && version.modelId)
        .filter((version) => !version.type || version.type.toLowerCase() === 'text')
        .filter((version) => version.available !== false);

      const updated = this.normalizeRuntime((await this.storageGet('local', this.runtimeStorageKey))?.[this.runtimeStorageKey]);
      updated.visibleVersions = this.dedupeVisibleVersions(visibleVersions);
      updated.visibleVersionsRefreshedAt = new Date().toISOString();
      await this.storageSet('local', { [this.runtimeStorageKey]: updated });
      return updated.visibleVersions;
    } catch (error) {
      await this.appendRuntimeLog('warn', 'Could not refresh AI Dungeon model versions.', {
        error: error?.message || String(error)
      });
      return runtime.visibleVersions;
    }
  }

  normalizeVisibleVersion(version) {
    const aliases = this.collectVersionAliases(version);
    return {
      modelId: this.displayNameFromVersion(version, aliases),
      versionName: this.cleanModelName(version?.versionName || ''),
      type: this.cleanModelName(version?.type || ''),
      available: version?.available !== false,
      isDeprecated: this.isDeprecatedVersion(version),
      aliases: aliases.slice(0, 24)
    };
  }

  displayNameFromVersion(version, aliases) {
    const preferred = aliases.find((item) => item && !this.looksLikeVersionSlug(item));
    if (preferred) return preferred;
    return this.prettifyVersionName(version?.versionName || version?.id || '');
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
    push(version?.aiDetails?.modelName);
    if (Array.isArray(version?.aiDetails?.tags)) {
      version.aiDetails.tags.forEach(push);
    }
    push(version?.aiSettings?.displayName);
    push(version?.aiSettings?.name);
    push(version?.engineNameEngine?.engineDetails?.displayName);
    push(version?.engineNameEngine?.engineDetails?.name);
    push(version?.engineNameEngine?.engineName);
    push(version?.versionName);
    return strings;
  }

  isDeprecatedVersion(version) {
    return Boolean(version?.aiSettings?.isDeprecatedModel)
      || /deprecated/i.test(String(version?.aiDetails?.shortDescription || ''));
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

  findVisibleVersionForModel(modelId, versions = []) {
    const model = this.cleanModelName(modelId);
    if (!model) return null;

    for (const version of versions) {
      const aliases = [version.modelId, version.versionName, ...(version.aliases || [])];
      if (aliases.some((alias) => this.sameModel(alias, model))) return version;
    }

    let best = null;
    let bestScore = 0;
    const modelTokens = this.modelTokens(model);
    for (const version of versions) {
      const versionTokens = this.modelTokens([version.modelId, version.versionName, ...(version.aliases || [])].join(' '));
      if (!modelTokens.length || !versionTokens.length) continue;
      const hits = modelTokens.filter((token) => versionTokens.includes(token)).length;
      const score = hits / modelTokens.length;
      if (score > bestScore) {
        best = version;
        bestScore = score;
      }
    }
    return bestScore >= 0.66 ? best : null;
  }

  modelTokens(value) {
    const raw = this.canonicalModelName(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => !['ai', 'model', 'models', 'version', 'dynamic'].includes(token));
    if (raw.includes('gemma')) return raw.filter((token) => token !== '4');
    return raw;
  }

  looksLikeVersionSlug(value) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(String(value || '').trim());
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

  async appendRuntimeLog(level, message, details = null) {
    const result = await this.storageGet('local', this.runtimeStorageKey);
    const runtime = this.normalizeRuntime(result?.[this.runtimeStorageKey]);
    runtime.logs.unshift({
      at: new Date().toISOString(),
      level,
      message,
      details
    });
    runtime.logs = runtime.logs.slice(0, 160);
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
      roundRobinCursor: Number.isInteger(raw.roundRobinCursor) ? raw.roundRobinCursor : 0,
      visibleVersions: Array.isArray(raw.visibleVersions) ? raw.visibleVersions : [],
      visibleVersionsRefreshedAt: this.cleanModelName(raw.visibleVersionsRefreshedAt || '')
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
}

if (typeof window !== 'undefined') {
  window.CustomDynamicFeature = CustomDynamicFeature;
}
