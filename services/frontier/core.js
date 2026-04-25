// services/frontier/core.js
//
// Frontier Core — the public API surface that modules consume.
//
// Responsibilities:
//   * Bridge DOM CustomEvents from ws-stream.js into a clean on/off listener API.
//   * Maintain lightweight derived state (adventureId, tail, liveCount) for
//     module consumption, with adventure-boundary events.
//   * Dispatch state-card changes to modules via onStateChange (Phase 2).
//   * Provide card lookup helpers (getCard, getState) that parse typed Frontier
//     state cards.
//   * Provide a write helper (writeCard) that delegates to the write queue.
//   * Emit the frontier:heartbeat card on adventure enter.
//   * Host the module registry and run the heartbeat on adventure enter.
//
// Exposure (per the Hybrid API decision):
//   * window.Frontier.core   — read-only inspection surface for DevTools.
//   * module.mount(ctx)      — ctx object passed to every registered module
//                              with the full API. Modules should NOT reach
//                              through window.Frontier; ctx is the contract.
//
// See:
//   - Project Management/frontier/01-architecture.md (Core layer)
//   - Project Management/frontier/03-modules.md (module contract)

(function () {
  if (window.Frontier?.core) return;

  const TAG = '[Frontier/core]';
  const HEARTBEAT_DELAY_MS = 750;
  const STATE_CARD_PREFIX = 'frontier:state:';
  const HEARTBEAT_CARD_TITLE = 'frontier:heartbeat';
  const HEARTBEAT_ARCHIVE_PREFIX = 'frontier:archived:heartbeat:';
  const PROTOCOL_VERSION = 1;

  // ---------- internal state ----------

  const listeners = new Map(); // eventName -> Set<handler>
  const state = {
    adventureId: null,
    tail: null,
    liveCount: 0,
    started: false,
    enabled: false,
    heartbeatTimer: null,
    heartbeatPending: false, // guards against overlapping heartbeat creates
    heartbeatQueuedAfterHydration: false,
    heartbeatForceAfterHydration: false,
    heartbeatCardId: null,
    cardsHydrated: false,
    aiService: null,       // AIDungeonService instance, injected by main.js
    debugEnabled: false,   // gated by frontier_debug in chrome.storage.sync
    stateCache: new Map(), // name -> parsed JSON from frontier:state:<name>
  };

  const getRegistry = () => window.Frontier?.registry || null;
  const getWs = () => window.Frontier?.ws || null;

  // ---------- debug mode (Phase 2) ----------

  function loadDebugSetting() {
    try {
      const api = typeof browser !== 'undefined' ? browser : chrome;
      api?.storage?.sync?.get?.('frontier_debug', (result) => {
        state.debugEnabled = !!result?.frontier_debug;
      });
      api?.storage?.onChanged?.addListener?.((changes, area) => {
        if (area === 'sync' && changes.frontier_debug) {
          state.debugEnabled = !!changes.frontier_debug.newValue;
        }
      });
    } catch { /* storage unavailable */ }
  }

  function setDebug(enabled) {
    state.debugEnabled = !!enabled;
    try {
      const api = typeof browser !== 'undefined' ? browser : chrome;
      api?.storage?.sync?.set?.({ frontier_debug: state.debugEnabled });
    } catch { /* storage unavailable */ }
  }

  // ---------- event bus ----------

  function on(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`${TAG} on('${eventName}', handler): handler must be a function`);
    }
    let bucket = listeners.get(eventName);
    if (!bucket) { bucket = new Set(); listeners.set(eventName, bucket); }
    bucket.add(handler);
    return () => off(eventName, handler);
  }

  function off(eventName, handler) {
    const bucket = listeners.get(eventName);
    if (bucket) bucket.delete(handler);
  }

  function emit(eventName, detail) {
    const bucket = listeners.get(eventName);
    if (!bucket) return;
    for (const handler of bucket) {
      try { handler(detail); }
      catch (err) { console.warn(TAG, `listener for '${eventName}' threw`, err); }
    }
  }

  // ---------- card lookup helpers ----------

  function getCardByTitle(title) {
    const ws = getWs();
    if (!ws?.getCards) return null;
    for (const card of ws.getCards().values()) {
      if (card?.title === title) return card;
    }
    return null;
  }

  // Parse a `frontier:state:<name>` card value as JSON. Returns null if the
  // card is missing or its value is not valid JSON. Modules treat null as
  // "no state yet" and should render a default view.
  function getState(name) {
    const card = getCardByTitle(STATE_CARD_PREFIX + name);
    if (!card || typeof card.value !== 'string' || card.value.length === 0) return null;
    try { return JSON.parse(card.value); }
    catch (err) {
      console.warn(TAG, `getState('${name}'): card value is not JSON`, err);
      return null;
    }
  }

  // ---------- state-card dispatch (Phase 2) ----------
  //
  // Scans card arrays for frontier:state:* titles, parses their values,
  // caches the parsed result, and dispatches onStateChange to modules whose
  // stateNames include the extracted name.

  function processStateCards(cards) {
    if (!Array.isArray(cards)) return;
    for (const card of cards) {
      if (!card?.title?.startsWith(STATE_CARD_PREFIX)) continue;
      const name = card.title.slice(STATE_CARD_PREFIX.length);
      if (!name) continue;
      let parsed = null;
      if (typeof card.value === 'string' && card.value.length > 0) {
        try { parsed = JSON.parse(card.value); }
        catch { continue; } // unparseable — skip
      }
      state.stateCache.set(name, parsed);
      dispatchStateChange(name, parsed);
    }
  }

  function processRemovedStateCards(cards) {
    if (!Array.isArray(cards)) return;
    for (const card of cards) {
      if (!card?.title?.startsWith(STATE_CARD_PREFIX)) continue;
      const name = card.title.slice(STATE_CARD_PREFIX.length);
      if (!name) continue;
      state.stateCache.delete(name);
      dispatchStateChange(name, null);
    }
  }

  function dispatchStateChange(name, parsed) {
    const registry = getRegistry();
    if (!registry?._forEachMounted) return;
    registry._forEachMounted((def, ctx) => {
      if (Array.isArray(def.stateNames) && def.stateNames.includes(name)) {
        try {
          def.onStateChange?.(name, parsed, ctx);
        } catch (err) {
          console.warn(TAG, `onStateChange('${name}') threw in '${def.id}'`, err);
        }
      }
    });
  }

  // Called on livecount:change. Re-dispatches cached state to modules that
  // declared tracksLiveCount: true so they re-read history[liveCount].
  function dispatchLiveCountRefresh() {
    const registry = getRegistry();
    if (!registry?._forEachMounted) return;
    registry._forEachMounted((def, ctx) => {
      if (!def.tracksLiveCount) return;
      if (!Array.isArray(def.stateNames)) return;
      for (const name of def.stateNames) {
        const cached = state.stateCache.get(name);
        if (cached !== undefined) {
          try {
            def.onStateChange?.(name, cached, ctx);
          } catch (err) {
            console.warn(TAG, `onStateChange('${name}') [liveCount] threw in '${def.id}'`, err);
          }
        }
      }
    });
  }

  // Replays cached state to a specific module (e.g. on enable). Called by
  // module-registry.js when a module is freshly enabled so it doesn't have
  // to wait for the next card change.
  function replayStateToModule(def, ctx) {
    if (!Array.isArray(def.stateNames)) return;
    for (const name of def.stateNames) {
      const cached = state.stateCache.get(name);
      if (cached !== undefined) {
        try {
          def.onStateChange?.(name, cached, ctx);
        } catch (err) {
          console.warn(TAG, `state replay for '${name}' threw in '${def.id}'`, err);
        }
      }
    }
  }

  // ---------- adventure-boundary detection ----------
  //
  // Phase 1: ws-stream.js handles boundary detection via HTTP hydration and
  // URL polling, emitting frontier:adventure:change. Core subscribes here.
  // Phase 2: also notifies mounted modules via onAdventureChange and clears
  // the stateCache so new adventure cards hydrate cleanly.

  function onAdventureChange(detail) {
    const id = detail?.adventureId ?? null;
    const prevId = state.adventureId;
    if (id === prevId) return;

    state.adventureId = id;
    state.stateCache.clear();
    state.cardsHydrated = false;
    state.heartbeatQueuedAfterHydration = false;
    state.heartbeatForceAfterHydration = false;
    state.heartbeatCardId = null;

    if (prevId) emit('adventure:leave', { adventureId: prevId });
    if (id) {
      emit('adventure:enter', { adventureId: id, prevId, shortId: detail?.shortId });
      scheduleHeartbeat();
    }

    // Notify mounted modules of the adventure boundary.
    const registry = getRegistry();
    const shortId = detail?.shortId ?? null;
    registry?._forEachMounted?.((def, ctx) => {
      try { def.onAdventureChange?.(shortId, ctx); }
      catch (err) { console.warn(TAG, `onAdventureChange threw in '${def.id}'`, err); }
    });
  }

  // ---------- heartbeat (Phase 2 — single frontier:heartbeat card) ----------
  //
  // Writes a single frontier:heartbeat card matching the protocol spec from
  // 02-protocol.md. Contains frontier identity, turn counter for staleness
  // detection, and the list of currently mounted modules with their ops.

  function getHeartbeatCards() {
    const ws = getWs();
    if (!ws?.getCards) return [];
    return [...ws.getCards().values()].filter(card => card?.title === HEARTBEAT_CARD_TITLE);
  }

  function heartbeatWrittenAt(card) {
    if (!card || typeof card.value !== 'string') return 0;
    try {
      const parsed = JSON.parse(card.value);
      const t = Date.parse(parsed?.writtenAt || '');
      return Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  }

  function heartbeatScore(card) {
    let score = 0;
    if (card?.type === 'frontier') score += 1000;
    if (typeof card?.value === 'string') {
      try {
        const parsed = JSON.parse(card.value);
        if (parsed?.frontier?.protocol === PROTOCOL_VERSION) score += 1000;
        if (parsed?.frontier?.client === 'BetterDungeon') score += 500;
      } catch { /* not a heartbeat-shaped value */ }
    }
    return score;
  }

  function chooseHeartbeatCard(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return null;
    if (state.heartbeatCardId) {
      const remembered = cards.find(card => String(card?.id) === String(state.heartbeatCardId));
      if (remembered) return remembered;
    }
    return [...cards].sort((a, b) => {
      const scoreDiff = heartbeatScore(b) - heartbeatScore(a);
      if (scoreDiff) return scoreDiff;
      const timeDiff = heartbeatWrittenAt(b) - heartbeatWrittenAt(a);
      if (timeDiff) return timeDiff;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    })[0] || null;
  }

  function refreshHeartbeatCardIndex() {
    const cards = getHeartbeatCards();
    const canonical = chooseHeartbeatCard(cards);
    state.heartbeatCardId = canonical?.id != null ? String(canonical.id) : null;
    return {
      cards,
      canonical,
      duplicates: canonical
        ? cards.filter(card => String(card?.id) !== String(canonical.id))
        : [],
    };
  }

  function deferHeartbeatUntilCards(force) {
    state.heartbeatQueuedAfterHydration = true;
    state.heartbeatForceAfterHydration = state.heartbeatForceAfterHydration || !!force;
  }

  function makeArchivedHeartbeatValue(card, canonicalId) {
    return JSON.stringify({
      frontier: {
        protocol: PROTOCOL_VERSION,
        client: 'BetterDungeon',
        archived: true,
        reason: 'duplicate_heartbeat',
        canonicalId: canonicalId || null,
      },
      originalTitle: HEARTBEAT_CARD_TITLE,
      originalId: card?.id != null ? String(card.id) : null,
      archivedAt: new Date().toISOString(),
    });
  }

  async function archiveHeartbeatDuplicates(duplicates, canonicalId) {
    if (!Array.isArray(duplicates) || duplicates.length === 0) return;
    for (const card of duplicates) {
      if (!card?.id) continue;
      const id = String(card.id);
      try {
        await writeCard(
          HEARTBEAT_ARCHIVE_PREFIX + id,
          makeArchivedHeartbeatValue(card, canonicalId),
          {
            id,
            type: 'frontier',
            keys: '',
            description: 'Archived duplicate Frontier heartbeat card.',
          },
        );
      } catch (err) {
        console.warn(TAG, `failed to archive duplicate heartbeat '${id}'`, err?.message || err);
      }
    }
  }

  function scheduleHeartbeat() {
    if (!state.enabled) return;
    if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
    state.heartbeatTimer = setTimeout(runHeartbeat, HEARTBEAT_DELAY_MS);
  }

  async function runHeartbeat(force = false) {
    state.heartbeatTimer = null;
    if (!state.enabled && !force) return;
    if (!state.cardsHydrated) {
      deferHeartbeatUntilCards(force);
      return;
    }
    // Guard: only one heartbeat write in flight at a time. Without this,
    // rapid triggers (adventure:enter + mutation:template) can fire multiple
    // creates before the first server echo returns the card's ID, producing
    // duplicate cards. If another trigger fires while pending, the debounce
    // timer will retry after this write completes.
    if (state.heartbeatPending) {
      scheduleHeartbeat();
      return;
    }
    const instance = state.aiService;
    if (!instance || typeof instance.upsertStoryCard !== 'function') return;

    const ws = getWs();
    const anyTemplate = ws?.getMutationTemplates ? Object.keys(ws.getMutationTemplates()) : [];
    if (anyTemplate.length === 0) return;

    const registry = getRegistry();
    const modulesList = registry ? registry.list() : [];
    const heartbeatPlan = refreshHeartbeatCardIndex();

    const heartbeat = {
      frontier: {
        protocol: PROTOCOL_VERSION,
        profile: 'full',
        enabled: state.enabled,
        client: 'BetterDungeon',
        clientVersion: (chrome?.runtime?.getManifest?.() || {}).version || 'unknown',
      },
      turn: state.liveCount,
      modules: modulesList
        .filter(m => m.mounted)
        .map(m => ({
          id: m.id,
          version: m.version || null,
          stateNames: m.stateNames || [],
          ops: m.ops || [],
        })),
      writtenAt: new Date().toISOString(),
    };

    state.heartbeatPending = true;
    try {
      const opts = { type: 'frontier' };
      if (heartbeatPlan.canonical?.id != null) {
        opts.id = String(heartbeatPlan.canonical.id);
      }
      const result = await writeCard(HEARTBEAT_CARD_TITLE, JSON.stringify(heartbeat), opts);
      const card = result?.storyCard && typeof result.storyCard === 'object'
        ? result.storyCard
        : result;
      if (card?.id != null) {
        state.heartbeatCardId = String(card.id);
      } else if (opts.id != null) {
        state.heartbeatCardId = String(opts.id);
      }

      const duplicates = heartbeatPlan.duplicates
        .filter(card => String(card?.id) !== String(state.heartbeatCardId));
      if (duplicates.length) {
        await archiveHeartbeatDuplicates(duplicates, state.heartbeatCardId);
        refreshHeartbeatCardIndex();
      }
    } catch (err) {
      console.warn(TAG, 'heartbeat write failed', err?.message || err);
    } finally {
      state.heartbeatPending = false;
    }
  }

  // ---------- upstream wiring (DOM events from ws-stream.js) ----------

  function bootstrap() {
    if (state.started) return;
    state.started = true;

    loadDebugSetting();

    // --- Card events ---

    document.addEventListener('frontier:cards:full', (e) => {
      emit('cards:full', e.detail);
      state.cardsHydrated = true;
      refreshHeartbeatCardIndex();
      // Scan initial card snapshot for state cards.
      processStateCards(e.detail?.cards);
      const force = state.heartbeatForceAfterHydration;
      state.heartbeatQueuedAfterHydration = false;
      state.heartbeatForceAfterHydration = false;
      if (force) {
        runHeartbeat(true).catch((err) => {
          console.warn(TAG, 'deferred heartbeat write failed', err?.message || err);
        });
      } else if (state.enabled) {
        scheduleHeartbeat();
      }
    });

    document.addEventListener('frontier:cards:diff', (e) => {
      emit('cards:diff', e.detail);
      const heartbeatChanges = [
        ...(e.detail?.added || []),
        ...(e.detail?.updated || []),
        ...(e.detail?.removed || []),
      ].some(card => card?.title === HEARTBEAT_CARD_TITLE || String(card?.title || '').startsWith(HEARTBEAT_ARCHIVE_PREFIX));
      if (heartbeatChanges) refreshHeartbeatCardIndex();
      // Scan changed cards (added + updated) for state card changes.
      const changed = [
        ...(e.detail?.added || []),
        ...(e.detail?.updated || []),
      ];
      if (changed.length) processStateCards(changed);
      processRemovedStateCards(e.detail?.removed);
    });

    // --- Action events ---

    document.addEventListener('frontier:actions:change', (e) => {
      emit('actions:change', e.detail);
    });

    document.addEventListener('frontier:tail:change', (e) => {
      state.tail = e.detail?.tail ?? null;
      emit('tail:change', e.detail);
    });

    document.addEventListener('frontier:livecount:change', (e) => {
      state.liveCount = e.detail?.liveCount ?? 0;
      emit('livecount:change', e.detail);
      // Re-dispatch cached state to tracksLiveCount modules.
      dispatchLiveCountRefresh();
    });

    // --- Template events ---

    document.addEventListener('frontier:mutation:template', (e) => {
      emit('mutation:template', e.detail);
      if (state.adventureId) scheduleHeartbeat();
    });

    // --- Adventure boundary ---

    document.addEventListener('frontier:adventure:change', (e) => {
      onAdventureChange(e.detail);
    });

    console.log(TAG, 'started');
  }

  // ---------- write helper ----------

  function getWriteQueue() {
    return window.Frontier?.writeQueue || null;
  }

  async function writeCard(title, value, opts = {}) {
    // Immediate local dispatch for state cards. The write queue's optimistic
    // echo updates ws-stream's card map, but ws-stream's diff then sees "no
    // change" when the server echo arrives — so cards:diff never fires. By
    // dispatching here, modules get notified synchronously on writes without
    // waiting for the server round-trip. If the write fails and rolls back,
    // the next WS echo with the old value will trigger a corrective dispatch.
    if (title.startsWith(STATE_CARD_PREFIX) && typeof value === 'string' && value.length > 0) {
      const name = title.slice(STATE_CARD_PREFIX.length);
      if (name) {
        try {
          const parsed = JSON.parse(value);
          state.stateCache.set(name, parsed);
          dispatchStateChange(name, parsed);
        } catch { /* non-JSON — skip local dispatch */ }
      }
    }

    const wq = getWriteQueue();
    if (wq) return wq.enqueue(title, value, opts);
    const instance = state.aiService;
    if (!instance?.upsertStoryCard) {
      throw new Error(`${TAG} writeCard: AIDungeonService not injected.`);
    }
    return instance.upsertStoryCard(title, value, opts);
  }

  function setAIService(service) {
    state.aiService = service;
    const wq = getWriteQueue();
    if (wq && service && typeof service.upsertStoryCard === 'function') {
      wq.setWriteFn((title, value, opts) => service.upsertStoryCard(title, value, opts));
    }
  }

  function setEnabled(enabled) {
    state.enabled = !!enabled;
    if (!state.enabled && state.heartbeatTimer) {
      clearTimeout(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.enabled && state.adventureId) scheduleHeartbeat();
    if (!state.enabled && state.adventureId) {
      runHeartbeat(true).catch((err) => {
        console.warn(TAG, 'disabled heartbeat write failed', err?.message || err);
      });
    }
  }

  // ---------- module context factory (Phase 2 — expanded) ----------
  //
  // Each module's mount(ctx) receives one of these. The context is scoped
  // per-module so Core can scope logs and auto-clean listeners on unmount.
  // Full interface per 03-modules.md FrontierContext.

  function makeModuleCtx(moduleDef) {
    const moduleListeners = [];
    const moduleId = moduleDef.id;

    function ctxOn(eventName, handler) {
      const offFn = on(eventName, handler);
      moduleListeners.push(offFn);
      return offFn;
    }

    function ctxTearDown() {
      while (moduleListeners.length) {
        try { moduleListeners.pop()(); } catch { /* noop */ }
      }
    }

    // Per-module storage backed by chrome.storage.sync. Keys are namespaced
    // as `frontier_mod_<id>_<key>` to prevent collisions.
    const storagePrefix = `frontier_mod_${moduleId}_`;
    const api = typeof browser !== 'undefined' ? browser : chrome;

    const storage = {
      async get(key, fallback) {
        const fullKey = storagePrefix + key;
        try {
          const result = await api.storage.sync.get(fullKey);
          return fullKey in result ? result[fullKey] : (fallback !== undefined ? fallback : undefined);
        } catch { return fallback !== undefined ? fallback : undefined; }
      },
      async set(key, value) {
        try { await api.storage.sync.set({ [storagePrefix + key]: value }); }
        catch (err) { console.warn(TAG, `storage.set failed for '${moduleId}'`, err); }
      },
      async remove(key) {
        try { await api.storage.sync.remove(storagePrefix + key); }
        catch (err) { console.warn(TAG, `storage.remove failed for '${moduleId}'`, err); }
      },
    };

    return {
      id: moduleId,
      on: ctxOn,
      getState,
      getCardByTitle,

      // Adventure state.
      get adventureShortId() { return getWs()?.getAdventureShortId?.() ?? null; },
      getAdventureId: () => state.adventureId,
      getActions: () => {
        const ws = getWs();
        return ws?.getActions ? [...ws.getActions().values()] : [];
      },
      getCurrentActionId: () => state.tail,
      getTail: () => state.tail,
      getLiveCount: () => state.liveCount,

      // Write (delegates to write queue).
      writeCard,

      // Advanced ops helpers. Normal op handlers should return/throw; these
      // exist for handlers that need to settle a request outside the call
      // stack that received it.
      respond(requestId, data) {
        return window.Frontier?.opsDispatcher?.respond?.(requestId, data);
      },
      respondError(requestId, err) {
        return window.Frontier?.opsDispatcher?.respondError?.(requestId, err);
      },

      // Structured logging. 'debug' level gated by frontier_debug toggle.
      log(level, ...args) {
        if (level === 'debug' && !state.debugEnabled) return;
        const method = level === 'debug' ? 'log' : (level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'log'));
        console[method](`[${moduleId}]`, ...args);
      },

      // Per-module persistent storage.
      storage,

      _tearDown: ctxTearDown,
    };
  }

  // ---------- public API ----------

  const core = {
    on, off,
    getState,
    getCardByTitle,
    getAdventureId: () => state.adventureId,
    getTail: () => state.tail,
    getLiveCount: () => state.liveCount,
    writeCard,
    setAIService,
    setEnabled,
    setDebug,
    // Internal hooks used by module-registry.js.
    _makeModuleCtx: makeModuleCtx,
    _replayStateToModule: replayStateToModule,
    _emit: emit,
    _scheduleHeartbeat: scheduleHeartbeat,
    // Read-only inspection.
    inspect: () => ({
      started: state.started,
      enabled: state.enabled,
      adventureId: state.adventureId,
      tail: state.tail,
      liveCount: state.liveCount,
      cardsHydrated: state.cardsHydrated,
      heartbeatPending: state.heartbeatPending,
      heartbeatQueuedAfterHydration: state.heartbeatQueuedAfterHydration,
      heartbeatCardId: state.heartbeatCardId,
      heartbeatCards: getHeartbeatCards().map(card => ({ id: card.id, type: card.type, writtenAt: heartbeatWrittenAt(card) || null })),
      debugEnabled: state.debugEnabled,
      stateCacheKeys: [...state.stateCache.keys()],
      listeners: [...listeners.keys()].map(k => ({ event: k, count: listeners.get(k).size })),
      writeQueue: getWriteQueue()?.inspect?.() || null,
      opsDispatcher: window.Frontier?.opsDispatcher?.inspect?.() || null,
    }),
  };

  window.Frontier = window.Frontier || {};
  window.Frontier.core = core;

  bootstrap();
})();
