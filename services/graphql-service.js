// BetterDungeon - GraphQL Service
// Shared authenticated GraphQL replay helper for AI Dungeon requests.

(function () {
  if (typeof window === 'undefined' || window.BetterDungeonGQL) return;

  class BetterDungeonGQLService {
    constructor() {
      this.debug = false;
      this.identityCache = new Map();
    }

    static FORBIDDEN_REPLAY_HEADERS = new Set([
      'host',
      'origin',
      'referer',
      'user-agent',
      'connection',
      'accept-encoding',
      'content-length',
      'cookie',
    ]);

    static QUERIES = {
      adventureIdentity: `query GetBetterDungeonAdventureIdentity($shortId: String) {
        adventure(shortId: $shortId) {
          id
          shortId
          scenarioId
          actionCount
          __typename
        }
      }`,

      storyCards: `query GetBetterDungeonStoryCards($shortId: String) {
        adventure(shortId: $shortId) {
          id
          shortId
          storyCardCount
          storyCards {
            id
            type
            title
            description
            keys
            value
            deletedAt
            updatedAt
            useForCharacterCreation
            __typename
          }
          __typename
        }
      }`,

      scenarioStart: `query BetterDungeonScenarioStartViewGetScenario($shortId: String, $viewPublished: Boolean) {
        scenario(shortId: $shortId, viewPublished: $viewPublished) {
          id
          type
          shortId
          title
          description
          advancedDescription
          image
          parentScenario {
            id
            __typename
          }
          deletedAt
          editedAt
          publishedUpdatedAt
          state(viewPublished: $viewPublished) {
            prompt
            plotEssentials
            authorsNote
            instructions
            storySummary
            __typename
          }
          options(viewPublished: $viewPublished) {
            id
            shortId
            title
            parentScenarioId
            deletedAt
            __typename
          }
          storyCards(viewPublished: $viewPublished) {
            id
            type
            keys
            value
            title
            useForCharacterCreation
            description
            updatedAt
            deletedAt
            __typename
          }
          __typename
        }
      }`,

      aiVisibleVersions: `query GetBetterDungeonAiVersions {
        aiVisibleVersions {
          success
          message
          visibleTextVersions {
            id
            type
            versionName
            access
            release
            aiDetails
            aiSettings
            available
            engineNameEngine {
              engineName
              availableSettings
              available
              __typename
            }
            __typename
          }
          __typename
        }
      }`,
    };

    static MUTATIONS = {
      saveSettings: `mutation useSettingsSaveSettings($settings: JSONObject!, $adventureShortId: String) {
        saveSettings(settings: $settings, adventureShortId: $adventureShortId) {
          success
          message
          user {
            id
            settings
            __typename
          }
          __typename
        }
      }`,
    };

    log(...args) {
      if (this.debug) console.log('[BetterDungeonGQL]', ...args);
    }

    getWs() {
      return window.Ultrascripts?.ws || null;
    }

    getBaseCredentials() {
      const ws = this.getWs();
      const base = ws?.getBaseCredentials ? ws.getBaseCredentials() : null;
      if (!base) {
        throw new Error('Waiting for AI Dungeon GraphQL credentials. Interact with the page or reload, then try again.');
      }
      return base;
    }

    hasBaseCredentials() {
      const ws = this.getWs();
      return !!(ws?.hasBaseCredentials ? ws.hasBaseCredentials() : ws?.getBaseCredentials?.());
    }

    restoreReplayHeaders(capturedHeaders) {
      const out = {};
      if (capturedHeaders && typeof capturedHeaders === 'object') {
        for (const key of Object.keys(capturedHeaders)) {
          if (BetterDungeonGQLService.FORBIDDEN_REPLAY_HEADERS.has(key.toLowerCase())) continue;
          out[key] = capturedHeaders[key];
        }
      }

      const hasContentType = Object.keys(out).some(key => key.toLowerCase() === 'content-type');
      if (!hasContentType) out['Content-Type'] = 'application/json';
      return out;
    }

    isSafeEndpoint(url) {
      if (!url || typeof url !== 'string') return false;
      try {
        const parsed = new URL(url, window.location.origin);
        const host = parsed.hostname.toLowerCase();
        return (
          (host === 'aidungeon.com' || host.endsWith('.aidungeon.com')) &&
          parsed.pathname.toLowerCase().endsWith('/graphql')
        );
      } catch {
        return false;
      }
    }

    endpointFromBase(base) {
      const endpoint = base?.url || 'https://api.aidungeon.com/graphql';
      if (!this.isSafeEndpoint(endpoint)) {
        throw new Error(`Refusing unsafe GraphQL endpoint: ${endpoint}`);
      }
      return endpoint;
    }

    async request(operationName, variables, query, options = {}) {
      const response = await this.requestBatch([{ operationName, variables, query }], options);
      return Array.isArray(response) ? response[0] : response;
    }

    async requestBatch(items, options = {}) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('requestBatch requires at least one GraphQL operation.');
      }

      const base = this.getBaseCredentials();
      const endpoint = this.endpointFromBase(base);
      const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const body = JSON.stringify(items.map(item => ({
        operationName: item.operationName,
        variables: item.variables || {},
        query: item.query,
      })));

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: this.restoreReplayHeaders(base.headers),
          body,
          signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          throw new Error(`GraphQL HTTP ${response.status}: ${text.slice(0, 300)}`);
        }

        let parsed = null;
        try {
          parsed = JSON.parse(text || 'null');
        } catch (error) {
          throw new Error(`GraphQL returned invalid JSON: ${error?.message || error}`);
        }

        const results = Array.isArray(parsed) ? parsed : [parsed];
        const errored = results.find(item => Array.isArray(item?.errors) && item.errors.length > 0);
        if (errored) {
          const first = errored.errors[0];
          throw new Error(`GraphQL ${errored.operationName || 'operation'} failed: ${first?.message || JSON.stringify(errored.errors).slice(0, 300)}`);
        }

        return parsed;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    getShortIdFromUrl() {
      const match = window.location.pathname.match(/\/(?:adventure|adventures|play)\/([^/]+)/);
      return match ? match[1] : null;
    }

    getScenarioShortIdFromUrl() {
      const match = window.location.pathname.match(/\/scenario\/([^/]+)/);
      return match ? match[1] : null;
    }

    async getScenarioStart(shortId = null, options = {}) {
      const resolvedShortId = shortId || this.getScenarioShortIdFromUrl();
      if (!resolvedShortId) {
        throw new Error('Scenario shortId is unknown. Open a scenario start page first.');
      }

      const result = await this.request(
        'BetterDungeonScenarioStartViewGetScenario',
        {
          shortId: resolvedShortId,
          viewPublished: options.viewPublished !== false,
        },
        BetterDungeonGQLService.QUERIES.scenarioStart,
        options
      );
      const scenario = result?.data?.scenario;
      if (!scenario?.id) {
        throw new Error(`Scenario lookup returned no data for ${resolvedShortId}.`);
      }
      return scenario;
    }

    isNumericId(value) {
      return typeof value === 'string' && /^\d+$/.test(value);
    }

    async getAdventureIdentity(shortId = null, options = {}) {
      const ws = this.getWs();
      const resolvedShortId = shortId || ws?.getAdventureShortId?.() || this.getShortIdFromUrl();
      if (!resolvedShortId) {
        throw new Error('Adventure shortId is unknown. Open an adventure first.');
      }

      const wsAdventureId = ws?.getAdventureId?.();
      const cached = this.identityCache.get(resolvedShortId);
      if (cached && (cached.adventureId || cached.id)) {
        return cached;
      }

      if (this.isNumericId(wsAdventureId)) {
        const identity = {
          adventureId: wsAdventureId,
          id: wsAdventureId,
          shortId: resolvedShortId,
          scenarioId: null,
          actionCount: null,
          source: 'ws',
        };
        this.identityCache.set(resolvedShortId, identity);
        return identity;
      }

      const result = await this.request(
        'GetBetterDungeonAdventureIdentity',
        { shortId: resolvedShortId },
        BetterDungeonGQLService.QUERIES.adventureIdentity,
        options
      );
      const adventure = result?.data?.adventure;
      if (!adventure?.id) {
        throw new Error(`Adventure identity lookup returned no id for ${resolvedShortId}.`);
      }

      const identity = {
        adventureId: String(adventure.id),
        id: String(adventure.id),
        shortId: adventure.shortId || resolvedShortId,
        scenarioId: adventure.scenarioId || null,
        actionCount: Number.isFinite(adventure.actionCount) ? adventure.actionCount : null,
        source: 'graphql',
      };
      this.identityCache.set(resolvedShortId, identity);
      return identity;
    }

    async getAiVisibleVersions(options = {}) {
      const result = await this.request(
        'GetBetterDungeonAiVersions',
        {},
        BetterDungeonGQLService.QUERIES.aiVisibleVersions,
        options
      );
      const payload = result?.data?.aiVisibleVersions || {};
      if (payload.success === false) {
        throw new Error(payload.message || 'AI Dungeon could not load its current model catalog.');
      }
      if (!Array.isArray(payload.visibleTextVersions)) {
        throw new Error('AI Dungeon returned no visible text model catalog.');
      }
      const textVersions = payload.visibleTextVersions;
      const seen = new Set();
      const out = [];
      for (const version of textVersions) {
        const key = String(version?.versionName || version?.id || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(version);
      }
      return out;
    }

    async saveSettings(settings, options = {}) {
      if (!settings || typeof settings !== 'object') {
        throw new Error('saveSettings requires a settings object.');
      }

      const result = await this.request(
        'useSettingsSaveSettings',
        {
          settings,
          adventureShortId: options.adventureShortId || null,
        },
        BetterDungeonGQLService.MUTATIONS.saveSettings,
        options
      );

      const response = result?.data?.saveSettings;
      if (!response?.success) {
        throw new Error(response?.message || 'AI Dungeon rejected user settings.');
      }
      return response;
    }

    waitForActionUpdate(predicate, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          document.removeEventListener('ultrascripts:actions:change', onActions);
          document.removeEventListener('ultrascripts:tail:change', onTail);
          document.removeEventListener('ultrascripts:livecount:change', onLiveCount);
          fn(value);
        };

        const evaluate = (detail) => {
          try {
            if (predicate(detail)) finish(resolve, detail);
          } catch (error) {
            finish(reject, error);
          }
        };

        const onActions = (event) => evaluate({ ...(event.detail || {}), source: 'actions:change' });
        const onTail = (event) => evaluate({ ...(event.detail || {}), source: 'tail:change' });
        const onLiveCount = (event) => evaluate({ ...(event.detail || {}), source: 'livecount:change' });
        const timer = setTimeout(() => {
          finish(reject, new Error(`Timed out waiting for action update after ${timeoutMs} ms.`));
        }, timeoutMs);

        document.addEventListener('ultrascripts:actions:change', onActions);
        document.addEventListener('ultrascripts:tail:change', onTail);
        document.addEventListener('ultrascripts:livecount:change', onLiveCount);

        const ws = this.getWs();
        const currentActions = ws?.getActions?.();
        if (currentActions) {
          evaluate({
            source: 'initial',
            actions: Array.from(currentActions.values()),
            changed: [],
            tail: ws?.getTail?.() || null,
            liveCount: ws?.getLiveCount?.() || 0,
          });
        }
      });
    }
  }

  window.BetterDungeonGQLService = BetterDungeonGQLService;
  window.BetterDungeonGQL = new BetterDungeonGQLService();
})();
