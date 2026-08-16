// BetterDungeon adventure read service
//
// Feature-agnostic normalized adventure reads. Apollo is preferred, while
// existing GraphQL and live-page readers remain explicit fallback sources.

(function () {
  'use strict';

  if (window.BetterDungeonAdventureRead) return;

  function stringValue(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  function numericId(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function collectionValues(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value.values === 'function') {
      try { return Array.from(value.values()); } catch { return []; }
    }
    return [];
  }

  function normalizeInstructions(value) {
    if (typeof value === 'string') return value.trim() ? value : '';
    if (Array.isArray(value)) return value.map(normalizeInstructions).filter(Boolean).join('\n');
    if (!value || typeof value !== 'object') return '';
    if (Object.prototype.hasOwnProperty.call(value, 'custom')) return normalizeInstructions(value.custom);
    const preferred = ['custom', 'aiInstructions', 'instructions', 'text', 'content', 'value', 'prompt'];
    for (const key of preferred) {
      const normalized = normalizeInstructions(value[key]);
      if (normalized) return normalized;
    }
    return Object.entries(value)
      .filter(([key]) => key !== 'type')
      .map(([, item]) => normalizeInstructions(item))
      .filter(Boolean)
      .join('\n');
  }

  function normalizeCard(card) {
    if (!card || card.deletedAt) return null;
    const id = card.id == null ? null : String(card.id);
    const keys = Array.isArray(card.keys) ? card.keys.join(',') : stringValue(card.keys);
    return {
      id,
      type: String(card.type || 'other').toLowerCase(),
      title: String(card.title || card.name || keys || (id ? `Story Card ${id}` : 'Untitled Story Card')),
      description: stringValue(card.description),
      keys,
      value: stringValue(card.value ?? card.entryText ?? card.description),
      triggers: Array.isArray(card.triggers)
        ? card.triggers.map(item => stringValue(item).trim().toLowerCase()).filter(Boolean)
        : keys.split(',').map(item => item.trim().toLowerCase()).filter(Boolean),
      updatedAt: card.updatedAt || null,
      useForCharacterCreation: card.useForCharacterCreation === true,
    };
  }

  function normalizeCards(cards) {
    const seen = new Set();
    return collectionValues(cards).map(normalizeCard).filter(card => {
      if (!card || (card.id && seen.has(card.id))) return false;
      if (card.id) seen.add(card.id);
      return true;
    });
  }

  function normalizeAction(action) {
    const id = numericId(action?.id);
    const text = stringValue(action?.text).trim();
    if (id === null || action?.undoneAt != null || !text) return null;
    return {
      id: String(action.id),
      text,
      type: action.type || null,
      undoneAt: action.undoneAt ?? null,
      createdAt: action.createdAt || null,
    };
  }

  function normalizeActions(actions) {
    return collectionValues(actions)
      .map(normalizeAction)
      .filter(Boolean)
      .sort((left, right) => numericId(left.id) - numericId(right.id));
  }

  function issue(section, source, error, userVisible = true) {
    return {
      section,
      source,
      code: error?.code || 'unavailable',
      message: stringValue(error?.message || error || 'Reader unavailable'),
      userVisible,
    };
  }

  function isNotFound(error) {
    return error?.code === 'not_found';
  }

  function isAborted(signal) {
    return signal?.aborted === true;
  }

  function abortError() {
    return { name: 'AbortError', code: 'aborted', message: 'Adventure read was aborted.' };
  }

  function requireShortId(shortId, ws) {
    return shortId || ws?.getAdventureShortId?.() || null;
  }

  function liveCards(ws) {
    const direct = normalizeCards(ws?.getCards?.());
    if (direct.length) return { cards: direct, source: 'ws' };
    return { cards: normalizeCards(window.storyCardCache?.getCardArray?.()), source: 'storyCardCache' };
  }

  function mergeActions(apolloActions, ws) {
    const merged = new Map();
    normalizeActions(apolloActions).forEach(action => merged.set(numericId(action.id), action));
    for (const rawAction of collectionValues(ws?.getActions?.())) {
      const id = numericId(rawAction?.id);
      if (id === null) continue;
      if (rawAction?.undoneAt != null) {
        merged.delete(id);
        continue;
      }
      const action = normalizeAction(rawAction);
      if (action) merged.set(id, action);
    }
    return Array.from(merged.values()).sort((left, right) => numericId(left.id) - numericId(right.id));
  }

  let latestAction = { id: null, source: 'unavailable', shortId: null };
  let latestAdventureShortId = null;
  let latestRefreshPromise = null;
  let latestRefreshShortId = null;
  let latestRefreshAt = 0;
  let latestGeneration = 0;
  const LATEST_REFRESH_FLOOR_MS = 500;

  function updateLatestAction(actions, source, shortId) {
    let latestId = null;
    let latestNumericId = -Infinity;
    for (const action of actions || []) {
      const numeric = numericId(action?.id);
      if (numeric !== null && numeric > latestNumericId) {
        latestNumericId = numeric;
        latestId = String(action.id);
      }
    }
    if (latestAdventureShortId && latestAdventureShortId !== shortId) return latestAction;
    latestAdventureShortId = shortId || null;
    latestAction = {
      id: latestId,
      source: latestId === null ? 'unavailable' : (source || 'unavailable'),
      shortId: shortId || null,
    };
    return latestAction;
  }

  function getLatestActionId() {
    return { ...latestAction };
  }

  function normalizeApollo(data, shortId) {
    const adventure = data?.adventure || {};
    const state = data?.state || adventure.state || {};
    const hasStateInstructions = Object.prototype.hasOwnProperty.call(state, 'instructions');
    const stateInstructions = normalizeInstructions(state.instructions);
    const flatInstructions = normalizeInstructions(adventure.instructions);
    return {
      identity: {
        id: adventure.id == null ? null : String(adventure.id),
        shortId: adventure.shortId || shortId || null,
        title: typeof adventure.title === 'string' ? adventure.title : '',
        actionCount: Number.isFinite(adventure.actionCount) ? adventure.actionCount : null,
        storyCardCount: Number.isFinite(adventure.storyCardCount) ? adventure.storyCardCount : null,
        thirdPerson: typeof adventure.thirdPerson === 'boolean' ? adventure.thirdPerson : null,
        editedAt: typeof adventure.editedAt === 'string' ? adventure.editedAt : null,
      },
      plot: {
        instructions: hasStateInstructions ? stateInstructions : flatInstructions,
        instructionsSource: hasStateInstructions ? 'state' : (flatInstructions ? 'flat' : 'none'),
        memory: stringValue(adventure.memory),
        authorsNote: stringValue(adventure.authorsNote),
        storySummary: stringValue(state.storySummary || adventure.storySummary),
      },
      state: {
        memories: Array.isArray(state.memories) ? state.memories.slice() : [],
        lastSummarizedActionId: state.lastSummarizedActionId ?? null,
        lastMemoryActionId: state.lastMemoryActionId ?? null,
        available: true,
      },
      storyCards: normalizeCards(data.storyCards),
      actions: normalizeActions(data.actions),
    };
  }

  function normalizeGraphql(adventure, shortId) {
    if (!adventure) return null;
    return {
      identity: {
        id: adventure.id == null ? null : String(adventure.id),
        shortId: adventure.shortId || shortId || null,
        title: adventure.title || '',
        actionCount: Number.isFinite(adventure.actionCount) ? adventure.actionCount : null,
        storyCardCount: Number.isFinite(adventure.storyCardCount) ? adventure.storyCardCount : null,
        thirdPerson: typeof adventure.thirdPerson === 'boolean' ? adventure.thirdPerson : null,
        editedAt: adventure.editedAt || null,
      },
      plot: {
        instructions: adventure.instructions || '',
        instructionsSource: adventure.instructionsSource || 'none',
        memory: adventure.memory || '',
        authorsNote: adventure.authorsNote || '',
        storySummary: adventure.storySummary || '',
      },
      state: {
        memories: null,
        lastSummarizedActionId: null,
        lastMemoryActionId: null,
        available: false,
      },
      storyCards: [],
      actions: [],
    };
  }

  async function readAdventure(options = {}, internal = {}) {
    const signal = options.signal || null;
    const ws = window.Ultrascripts?.ws || null;
    const shortId = requireShortId(options.shortId, ws);
    if (!shortId) throw new Error('Adventure shortId is unknown. Open an adventure first.');
    if (isAborted(signal)) throw abortError();

    const provenance = {
      identity: {},
      plot: {},
      state: {},
      storyCards: { source: null, fallback: [] },
      actions: { source: null, fallback: [] },
    };
    const degradations = [];
    const fallbacks = [];
    const apollo = window.BetterDungeonApolloCache;
    let apolloResult = null;
    let apolloSnapshot = null;
    let apolloNotFound = false;
    if (apollo?.readAdventure) {
      apolloResult = await apollo.readAdventure({ shortId });
      if (apolloResult.available && apolloResult.data) {
        apolloSnapshot = normalizeApollo(apolloResult.data, shortId);
      } else if (isNotFound(apolloResult.error)) {
        apolloNotFound = true;
      } else if (apolloResult.error) {
        degradations.push(issue('adventure', 'apollo', apolloResult.error));
      }
      if (!apolloSnapshot) {
        fallbacks.push({ section: 'adventure', from: 'apollo', reason: apolloResult.error?.code || 'unavailable' });
      }
    } else {
      apolloResult = { available: false, error: { code: 'unavailable', message: 'Apollo reader service is unavailable.' } };
      degradations.push(issue('adventure', 'apollo', apolloResult.error));
      fallbacks.push({ section: 'adventure', from: 'apollo', reason: 'service-unavailable' });
    }
    if (isAborted(signal)) throw abortError();

    const gql = window.BetterDungeonGQL;
    let graphqlAdventure = null;
    if (!apolloSnapshot && gql?.getNavigatorAdventureContext) {
      try {
        graphqlAdventure = normalizeGraphql(await gql.getNavigatorAdventureContext(shortId, { signal }), shortId);
      } catch (error) {
        if (error?.name === 'AbortError') throw abortError();
        degradations.push(issue('adventure', 'graphql', error));
      }
    }
    const base = apolloSnapshot || graphqlAdventure || normalizeGraphql(null, shortId) || {
      identity: { id: null, shortId, title: '', actionCount: null, storyCardCount: null, thirdPerson: null, editedAt: null },
      plot: { instructions: '', instructionsSource: 'none', memory: '', authorsNote: '', storySummary: '' },
      state: { memories: null, lastSummarizedActionId: null, lastMemoryActionId: null, available: false },
      storyCards: [], actions: [],
    };
    const baseSource = apolloSnapshot ? 'apollo' : (graphqlAdventure ? 'graphql' : 'unavailable');
    for (const key of Object.keys(base.identity)) provenance.identity[key] = baseSource;
    for (const key of Object.keys(base.plot)) provenance.plot[key] = baseSource;
    for (const key of Object.keys(base.state)) {
      provenance.state[key] = apolloSnapshot ? 'apollo' : (base.state.available ? 'graphql' : 'unavailable');
    }
    if (!apolloSnapshot && !base.state.available) {
      provenance.state.fallback = 'GraphQL does not select Memory Bank or summary-lag fields.';
    }

    let cards = null;
    if (!internal.actionsOnly && !internal.cardsOnly) {
      cards = apolloSnapshot?.storyCards || null;
      if (cards) {
        provenance.storyCards.source = 'apollo';
      } else if (gql?.getNavigatorStoryCards) {
        try {
          const result = await gql.getNavigatorStoryCards(shortId, { signal });
          cards = normalizeCards(result?.cards);
          provenance.storyCards.source = 'graphql';
          fallbacks.push({
            section: 'storyCards',
            from: apolloSnapshot ? 'apollo' : 'unavailable',
            to: 'graphql',
            normalNotFound: apolloNotFound,
          });
        } catch (error) {
          if (error?.name === 'AbortError') throw abortError();
          if (!isNotFound(error)) degradations.push(issue('storyCards', 'graphql', error));
        }
      }
      if (!cards) {
        const live = liveCards(ws);
        cards = live.cards;
        provenance.storyCards.source = live.source;
        provenance.storyCards.fallback = [
          apolloSnapshot ? 'apollo' : 'unavailable',
          gql?.getNavigatorStoryCards ? 'graphql' : null,
        ].filter(Boolean);
        fallbacks.push({
          section: 'storyCards',
          from: gql?.getNavigatorStoryCards ? 'graphql' : (apolloSnapshot ? 'apollo' : 'unavailable'),
          to: live.source,
          normalNotFound: apolloNotFound,
        });
      }
    } else if (internal.cardsOnly) {
      cards = apolloSnapshot?.storyCards || [];
      provenance.storyCards.source = apolloSnapshot ? 'apollo' : 'unavailable';
    } else {
      cards = [];
      provenance.storyCards.source = 'not_read';
    }

    const apolloAvailable = Boolean(apolloSnapshot && apolloResult?.available);
    const apolloRetryable = !internal.cardsOnly
      && !apolloAvailable
      && apolloNotFound
      && Boolean(apollo?.readAdventure);
    const actions = internal.cardsOnly ? [] : mergeActions(apolloAvailable ? apolloSnapshot.actions : [], ws);
    provenance.actions.source = internal.cardsOnly ? 'not_read' : (apolloAvailable ? 'apollo+ws' : 'ws');
    if (!internal.cardsOnly && !apolloAvailable) {
      provenance.actions.fallback = ['apollo'];
      fallbacks.push({ section: 'actions', from: 'apollo', to: 'ws', normalNotFound: apolloNotFound });
    }
    const total = base.identity.actionCount;
    const apolloHistoryDegraded = !internal.cardsOnly && !apolloAvailable &&
      apolloResult?.error?.code !== 'not_found';
    const actionGap = !internal.cardsOnly && Number.isFinite(total) && actions.length !== total;
    const historyIncomplete = apolloHistoryDegraded;
    const plotAvailable = ['instructions', 'memory', 'authorsNote', 'storySummary']
      .filter(key => stringValue(base.plot[key]).trim()).length;
    const stateAvailable = base.state.available ? 3 : 0;
    const coverage = {
      identity: {
        authoritativeTotal: 1,
        available: base.identity.id ? 1 : 0,
        included: base.identity.id ? 1 : 0,
        omitted: base.identity.id ? 0 : 1,
        omittedReason: base.identity.id ? null : 'unavailable',
      },
      plot: {
        authoritativeTotal: 4,
        available: plotAvailable,
        included: plotAvailable,
        omitted: 4 - plotAvailable,
        omittedReason: plotAvailable === 4 ? null : 'unavailable',
      },
      state: {
        authoritativeTotal: 3,
        available: stateAvailable,
        included: stateAvailable,
        omitted: 3 - stateAvailable,
        omittedReason: stateAvailable === 3 ? null : 'unavailable',
      },
      actions: {
        authoritativeTotal: Number.isFinite(total) ? total : null,
        available: actions.length,
        included: actions.length,
        omitted: 0,
        incomplete: historyIncomplete,
        availabilityGap: actionGap,
        discrepancyNote: actionGap
          ? `Advertised actionCount ${total} differs from ${actions.length} retained normalized actions; actionCount and retained entities are not directly comparable after undo filtering.`
          : null,
      },
      storyCards: {
        authoritativeTotal: Number.isFinite(base.identity.storyCardCount)
          ? base.identity.storyCardCount
          : cards.length,
        available: cards.length,
        included: cards.length,
        omitted: 0,
        incomplete: false,
        omittedReason: null,
      },
    };
    const canUpdateLatestAction = !internal.cardsOnly && (
      options._latestGeneration === undefined
      || options._latestGeneration === latestGeneration
    );
    if (canUpdateLatestAction) {
      updateLatestAction(actions, provenance.actions.source, shortId);
    }
    return {
      identity: base.identity,
      plot: base.plot,
      state: base.state,
      storyCards: cards,
      actions,
      provenance,
      coverage,
      fallbacks,
      degradations,
      historyIncomplete,
      apolloRetryable,
      sourceDegraded: degradations.length > 0,
    };
  }

  async function readActions(options = {}) {
    const snapshot = await readAdventure(options, { actionsOnly: true });
    return {
      actions: snapshot.actions,
      coverage: snapshot.coverage.actions,
      provenance: snapshot.provenance.actions,
      historyIncomplete: snapshot.historyIncomplete,
      fallbacks: snapshot.fallbacks.filter(item => item.section === 'actions'),
      degradations: snapshot.degradations.filter(item => item.section === 'actions'),
    };
  }

  async function readCards(options = {}) {
    const snapshot = await readAdventure(options, { cardsOnly: true });
    return {
      cards: snapshot.storyCards,
      coverage: snapshot.coverage.storyCards,
      provenance: snapshot.provenance.storyCards,
      fallbacks: snapshot.fallbacks.filter(item => item.section === 'storyCards'),
      degradations: snapshot.degradations.filter(item => item.section === 'storyCards'),
    };
  }

  async function refreshLatestActionId(options = {}) {
    const shortId = options.shortId || window.Ultrascripts?.ws?.getAdventureShortId?.() || null;
    if (!shortId) {
      latestAction = { id: null, source: 'unavailable', shortId: null };
      return getLatestActionId();
    }
    if (!latestAdventureShortId) latestAdventureShortId = shortId;
    const force = options.force === true;
    const now = Date.now();
    if (latestRefreshPromise && latestRefreshShortId === shortId) return latestRefreshPromise;
    if (!force && latestRefreshShortId === shortId && now - latestRefreshAt < LATEST_REFRESH_FLOOR_MS) {
      return getLatestActionId();
    }
    const generation = latestGeneration;
    latestRefreshShortId = shortId;
    latestRefreshAt = now;
    const promise = readActions({
      shortId,
      signal: options.signal || null,
      _latestGeneration: generation,
    }).then(result => {
      if (generation === latestGeneration && latestAdventureShortId === shortId) {
        updateLatestAction(result.actions, result.provenance?.source, shortId);
      }
      return getLatestActionId();
    });
    latestRefreshPromise = promise;
    promise.finally(() => {
      if (latestRefreshPromise === promise) latestRefreshPromise = null;
    }).catch(() => {});
    return promise;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('ultrascripts:adventure:change', (event) => {
      latestGeneration++;
      latestRefreshPromise = null;
      latestRefreshShortId = null;
      latestRefreshAt = 0;
      latestAdventureShortId = event.detail?.shortId || null;
      latestAction = { id: null, source: 'unavailable', shortId: event.detail?.shortId || null };
      if (event.detail?.shortId) {
        refreshLatestActionId({ shortId: event.detail.shortId, force: true }).catch(() => {});
      }
    });
  }

  window.BetterDungeonAdventureRead = {
    readAdventure,
    readActions,
    getLatestActionId,
    refreshLatestActionId,
    readCards,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.BetterDungeonAdventureRead;
  }
}());
