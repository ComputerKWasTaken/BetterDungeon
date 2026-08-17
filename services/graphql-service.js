// BetterDungeon - GraphQL Service
// Shared authenticated GraphQL replay helper for AI Dungeon requests.

(function () {
  if (typeof window === 'undefined' || window.BetterDungeonGQL) return;

  class BetterDungeonGQLService {
    constructor() {
      this.debug = false;
      this.identityCache = new Map();
      this.scenarioIdentityState = new Map();
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

      navigatorAdventureContext: `query GetBetterDungeonNavigatorContext($shortId: String) {
        adventure(shortId: $shortId) {
          id
          shortId
          title
          actionCount
          editedAt
          thirdPerson
          memory
          authorsNote
          instructions
          state {
            instructions
            storySummary
            __typename
          }
          __typename
        }
      }`,

      navigatorRecentMemories: `query NavigatorRecentMemories($shortId: String) {
  recentMemories(shortId: $shortId)
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

      navigatorAdventurePlot: `mutation UpdateAdventurePlot($input: AdventurePlotInput) {
        updateAdventurePlot(input: $input) {
          adventure {
            id
            shortId
            thirdPerson
            memory
            authorsNote
            editedAt
            __typename
          }
          message
          success
          __typename
        }
      }`,

      navigatorAdventureState: `mutation UpdateAdventureState($input: AdventureStateInput) {
        updateAdventureState(input: $input) {
          adventure {
            id
            shortId
            state {
              instructions
              storySummary
              storyCardStoryInformation
              storyCardInstructions
              imageStyle
              __typename
            }
            editedAt
            __typename
          }
          message
          success
          __typename
        }
      }`,

      navigatorStoryCardUpsert: `mutation UseAutoSaveStoryCard($input: UpdateStoryCardInput!) {
        updateStoryCard(input: $input) {
          success
          message
          storyCard {
            id
            type
            title
            description
            keys
            value
            useForCharacterCreation
            updatedAt
            deletedAt
            __typename
          }
          __typename
        }
      }`,

      navigatorStoryCardDelete: `mutation UseDeleteStoryCard($input: DeleteStoryCardInput!) {
        deleteStoryCard(input: $input) {
          success
          message
          storyCard {
            id
            deletedAt
            __typename
          }
          __typename
        }
      }`,

      navigatorEditMemory: `mutation NavigatorEditMemory($input: EditMemoryInput!) {
  editMemory(input: $input) {
    code
    success
    message
    memory
  }
}`,

      navigatorDeleteMemory: `mutation NavigatorDeleteMemory($input: DeleteMemoryInput!) {
  deleteMemory(input: $input) {
    code
    success
    message
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
        this.resolveScenarioIdInBackground(resolvedShortId, cached);
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
        this.resolveScenarioIdInBackground(resolvedShortId, identity);
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

    resolveScenarioIdInBackground(shortId, identity = null) {
      const resolvedShortId = shortId || identity?.shortId;
      if (!resolvedShortId) return;
      const cached = identity || this.identityCache.get(resolvedShortId);
      if (!cached || cached.scenarioId || this.scenarioIdentityState.get(resolvedShortId)?.attempted) return;

      this.scenarioIdentityState.set(resolvedShortId, { attempted: true });
      void (async () => {
        try {
          const result = await this.request(
            'GetBetterDungeonAdventureIdentity',
            { shortId: resolvedShortId },
            BetterDungeonGQLService.QUERIES.adventureIdentity,
            { timeoutMs: 10000 }
          );
          const adventure = result?.data?.adventure;
          if (adventure?.scenarioId) cached.scenarioId = adventure.scenarioId;
        } catch (error) {
          this.log('Background scenario identity lookup failed:', error);
        }
      })();
    }

    async getNavigatorAdventureContext(shortId = null, options = {}) {
      const ws = this.getWs();
      const resolvedShortId = shortId || ws?.getAdventureShortId?.() || this.getShortIdFromUrl();
      if (!resolvedShortId) {
        throw new Error('Adventure shortId is unknown. Open an adventure first.');
      }

      const result = await this.request(
        'GetBetterDungeonNavigatorContext',
        { shortId: resolvedShortId },
        BetterDungeonGQLService.QUERIES.navigatorAdventureContext,
        options
      );
      const adventure = result?.data?.adventure;
      if (!adventure?.id) {
        throw new Error(`Navigator context lookup returned no adventure for ${resolvedShortId}.`);
      }

      const stateInstructions = this.normalizeInstructionText(adventure.state?.instructions);
      const flatInstructions = this.normalizeInstructionText(adventure.instructions);
      const hasStateInstructions = !!adventure.state && Object.prototype.hasOwnProperty.call(adventure.state, 'instructions');

      return {
        id: String(adventure.id),
        shortId: adventure.shortId || resolvedShortId,
        title: typeof adventure.title === 'string' ? adventure.title : '',
        actionCount: Number.isFinite(adventure.actionCount) ? adventure.actionCount : null,
        editedAt: typeof adventure.editedAt === 'string' ? adventure.editedAt : null,
        thirdPerson: typeof adventure.thirdPerson === 'boolean' ? adventure.thirdPerson : null,
        memory: typeof adventure.memory === 'string' ? adventure.memory : '',
        authorsNote: typeof adventure.authorsNote === 'string' ? adventure.authorsNote : '',
        instructions: hasStateInstructions ? stateInstructions : flatInstructions,
        instructionsSource: hasStateInstructions ? 'state' : (flatInstructions ? 'flat' : 'none'),
        storySummary: typeof adventure.state?.storySummary === 'string' ? adventure.state.storySummary : '',
      };
    }

    async getNavigatorStoryCards(shortId = null, options = {}) {
      const ws = this.getWs();
      const resolvedShortId = shortId || ws?.getAdventureShortId?.() || this.getShortIdFromUrl();
      if (!resolvedShortId) {
        throw new Error('Adventure shortId is unknown. Open an adventure first.');
      }

      const result = await this.request(
        'GetBetterDungeonStoryCards',
        { shortId: resolvedShortId },
        BetterDungeonGQLService.QUERIES.storyCards,
        options
      );
      const adventure = result?.data?.adventure;
      if (!adventure?.id || !Array.isArray(adventure.storyCards)) {
        throw new Error(`Story Card lookup returned no adventure data for ${resolvedShortId}.`);
      }
      return {
        id: String(adventure.id),
        shortId: adventure.shortId || resolvedShortId,
        storyCardCount: Number.isFinite(adventure.storyCardCount) ? adventure.storyCardCount : null,
        cards: adventure.storyCards,
      };
    }

    async getNavigatorRecentMemories(shortId = null, options = {}) {
      const ws = this.getWs();
      const resolvedShortId = shortId || ws?.getAdventureShortId?.() || this.getShortIdFromUrl();
      if (!resolvedShortId) throw new Error('Adventure shortId is unknown. Open an adventure first.');
      const result = await this.request(
        'NavigatorRecentMemories',
        { shortId: resolvedShortId },
        BetterDungeonGQLService.QUERIES.navigatorRecentMemories,
        options
      );
      if (result?.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
      const memories = result?.data?.recentMemories;
      if (!Array.isArray(memories)) throw new Error(`Recent Memory Bank lookup returned no list for ${resolvedShortId}.`);
      return memories;
    }

    async updateNavigatorAdventurePlot(shortId, changes, options = {}) {
      const resolvedShortId = String(shortId || '').trim();
      if (!resolvedShortId) throw new Error('Navigator plot update requires an adventure shortId.');
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        throw new Error('Navigator plot update requires a changes object.');
      }

      const input = { shortId: resolvedShortId };
      if (Object.prototype.hasOwnProperty.call(changes, 'memory')) input.memory = String(changes.memory ?? '');
      if (Object.prototype.hasOwnProperty.call(changes, 'authorsNote')) input.authorsNote = String(changes.authorsNote ?? '');
      if (Object.prototype.hasOwnProperty.call(changes, 'thirdPerson')) input.thirdPerson = changes.thirdPerson === true;
      if (Object.keys(input).length === 1) throw new Error('Navigator plot update has no supported changes.');

      const result = await this.request(
        'UpdateAdventurePlot',
        { input },
        BetterDungeonGQLService.MUTATIONS.navigatorAdventurePlot,
        options
      );
      const response = result?.data?.updateAdventurePlot;
      if (!response?.success || !response.adventure) {
        throw new Error(response?.message || 'AI Dungeon rejected the Plot Component update.');
      }
      return response;
    }

    async updateNavigatorAdventureState(shortId, state, options = {}) {
      const resolvedShortId = String(shortId || '').trim();
      if (!resolvedShortId) throw new Error('Navigator state update requires an adventure shortId.');
      if (!state || typeof state !== 'object' || Array.isArray(state) || !Object.keys(state).length) {
        throw new Error('Navigator state update requires a non-empty state object.');
      }

      const result = await this.request(
        'UpdateAdventureState',
        { input: { shortId: resolvedShortId, state } },
        BetterDungeonGQLService.MUTATIONS.navigatorAdventureState,
        options
      );
      const response = result?.data?.updateAdventureState;
      if (!response?.success || !response.adventure) {
        throw new Error(response?.message || 'AI Dungeon rejected the adventure state update.');
      }
      return response;
    }

    async updateNavigatorStoryCard(shortId, card, options = {}) {
      const resolvedShortId = String(shortId || '').trim();
      if (!resolvedShortId) throw new Error('Navigator Story Card update requires an adventure shortId.');
      if (!card || typeof card !== 'object' || Array.isArray(card)) {
        throw new Error('Navigator Story Card update requires a complete card record.');
      }

      const input = {
        id: String(card.id || ''),
        shortId: resolvedShortId,
        contentType: 'adventure',
        type: String(card.type ?? ''),
        title: String(card.title ?? ''),
        description: String(card.description ?? ''),
        keys: String(card.keys ?? ''),
        value: String(card.value ?? ''),
        useForCharacterCreation: card.useForCharacterCreation === true,
      };
      if (!input.id) throw new Error('Navigator Story Card update requires a stable card ID.');

      const result = await this.request(
        'UseAutoSaveStoryCard',
        { input },
        BetterDungeonGQLService.MUTATIONS.navigatorStoryCardUpsert,
        options
      );
      const response = result?.data?.updateStoryCard;
      if (!response?.success || !response.storyCard) {
        throw new Error(response?.message || 'AI Dungeon rejected the Story Card update.');
      }
      return response;
    }

    async deleteNavigatorStoryCard(shortId, id, options = {}) {
      const resolvedShortId = String(shortId || '').trim();
      const resolvedId = String(id || '').trim();
      if (!resolvedShortId || !resolvedId) {
        throw new Error('Navigator Story Card deletion requires an adventure shortId and card ID.');
      }

      const result = await this.request(
        'UseDeleteStoryCard',
        { input: { id: resolvedId, shortId: resolvedShortId, contentType: 'adventure' } },
        BetterDungeonGQLService.MUTATIONS.navigatorStoryCardDelete,
        options
      );
      const response = result?.data?.deleteStoryCard;
      if (!response?.success || String(response.storyCard?.id || '') !== resolvedId) {
        throw new Error(response?.message || 'AI Dungeon rejected the Story Card deletion.');
      }
      return response;
    }

    async editNavigatorMemory(shortId, actionId, text, options = {}) {
      const resolvedShortId = String(shortId || '').trim();
      const resolvedActionId = String(actionId || '').trim();
      if (!resolvedShortId || !resolvedActionId) throw new Error('Navigator Memory Bank edit requires an adventure short ID and memory ID.');
      const result = await this.request(
        'NavigatorEditMemory',
        { input: { adventureId: resolvedShortId, actionId: resolvedActionId, text: String(text ?? '') } },
        BetterDungeonGQLService.MUTATIONS.navigatorEditMemory,
        options
      );
      if (result?.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
      const response = result?.data?.editMemory;
      if (!response?.success) throw new Error(response?.message || 'AI Dungeon rejected the Memory Bank edit.');
      return response;
    }

    async deleteNavigatorMemory(shortId, actionId, options = {}) {
      const resolvedShortId = String(shortId || '').trim();
      const resolvedActionId = String(actionId || '').trim();
      if (!resolvedShortId || !resolvedActionId) throw new Error('Navigator Memory Bank deletion requires an adventure short ID and memory ID.');
      const result = await this.request(
        'NavigatorDeleteMemory',
        { input: { adventureId: resolvedShortId, actionId: resolvedActionId } },
        BetterDungeonGQLService.MUTATIONS.navigatorDeleteMemory,
        options
      );
      if (result?.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
      const response = result?.data?.deleteMemory;
      if (!response?.success) throw new Error(response?.message || 'AI Dungeon rejected the Memory Bank deletion.');
      return response;
    }

    normalizeInstructionText(value) {
      if (typeof value === 'string') return value.trim() ? value : '';
      if (Array.isArray(value)) {
        return value
          .map(item => this.normalizeInstructionText(item))
          .filter(Boolean)
          .join('\n');
      }
      if (!value || typeof value !== 'object') return '';

      if (Object.prototype.hasOwnProperty.call(value, 'custom')) {
        return this.normalizeInstructionText(value.custom);
      }

      const preferredKeys = ['custom', 'aiInstructions', 'instructions', 'text', 'content', 'value', 'prompt'];
      for (const key of preferredKeys) {
        const normalized = this.normalizeInstructionText(value[key]);
        if (normalized) return normalized;
      }

      const normalizedValues = Object.entries(value)
        .filter(([key]) => key !== 'type')
        .map(([, item]) => this.normalizeInstructionText(item))
        .filter(Boolean);
      return normalizedValues.join('\n');
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
