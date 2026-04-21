// services/frontier/core.js
//
// Frontier Core — the public API surface that modules consume.
//
// Responsibilities:
//   * Bridge DOM CustomEvents from ws-stream.js into a clean on/off listener API.
//   * Maintain lightweight derived state (adventureId, tail, liveCount) for
//     module consumption, with adventure-boundary events.
//   * Provide card lookup helpers (getCard, getState) that parse typed Frontier
//     state cards.
//   * Provide a write helper (writeCard) that delegates to AIDungeonService.
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
  const HEARTBEAT_DELAY_MS = 750; // debounce heartbeat after adventure:enter
  const STATE_CARD_PREFIX = 'frontier:state:';
  const MANIFEST_CARD_TITLE = 'frontier:manifest';
  const MODULES_CARD_TITLE = 'frontier:modules';
  const PROTOCOL_VERSION = 1;

  // ---------- internal state ----------

  const listeners = new Map(); // eventName -> Set<handler>
  const state = {
    adventureId: null,
    tail: null,
    liveCount: 0,
    started: false,
    heartbeatTimer: null,
    aiService: null,  // AIDungeonService instance, injected by main.js
  };

  // Module registry lookup is lazy so load-order between core.js and
  // module-registry.js doesn't matter. The registry attaches itself to
  // window.Frontier.registry when it loads.
  const getRegistry = () => window.Frontier?.registry || null;

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
    const ws = window.Frontier?.ws;
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

  // ---------- adventure-boundary detection ----------
  //
  // Phase 1: ws-stream.js now handles adventure-boundary detection via HTTP
  // hydration (GetAdventure responses) and SPA URL polling, emitting a
  // `frontier:adventure:change` CustomEvent. Core subscribes to that event
  // rather than trying to extract adventureId from individual subscription
  // payloads (which was fragile — action payloads don't always carry it).

  function onAdventureChange(detail) {
    const id = detail?.adventureId ?? null;
    const prevId = state.adventureId;
    if (id === prevId) return;

    state.adventureId = id;

    if (prevId) emit('adventure:leave', { adventureId: prevId });
    if (id) {
      emit('adventure:enter', { adventureId: id, prevId, shortId: detail?.shortId });
      scheduleHeartbeat();
    }
  }

  // ---------- heartbeat ----------
  //
  // When a new adventure is entered, BD writes two protocol-level metadata
  // cards so any AID-side Frontier script can discover BD's presence and
  // version:
  //   frontier:manifest  — BD identification + protocol version
  //   frontier:modules   — the list of currently enabled modules with their
  //                        declared stateNames
  //
  // This is best-effort: mutation templates may not be primed yet, in which
  // case the heartbeat silently defers. It will retry on the next adventure
  // enter or via a `frontier:mutation:template` event.

  function scheduleHeartbeat() {
    if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
    state.heartbeatTimer = setTimeout(runHeartbeat, HEARTBEAT_DELAY_MS);
  }

  async function runHeartbeat() {
    state.heartbeatTimer = null;
    const instance = state.aiService;
    if (!instance || typeof instance.upsertStoryCard !== 'function') {
      // AIDungeonService not injected yet. main.js wires this via setAIService().
      return;
    }

    // Defer if no usable template captured — the write would throw.
    // SaveQueueStoryCard is AID's update op (confirmed); create op name
    // unconfirmed, so we also defer if all our candidates are unprimed.
    const ws = window.Frontier?.ws;
    const anyTemplate = ws?.getMutationTemplates ? Object.keys(ws.getMutationTemplates()) : [];
    if (anyTemplate.length === 0) return;

    const manifest = {
      protocol: PROTOCOL_VERSION,
      client: 'BetterDungeon',
      clientVersion: (chrome?.runtime?.getManifest?.() || {}).version || 'unknown',
      writtenAt: new Date().toISOString(),
      adventureId: state.adventureId,
    };
    const registry = getRegistry();
    const modulesList = registry ? registry.list() : [];
    const modulesPayload = {
      protocol: PROTOCOL_VERSION,
      modules: modulesList.map(m => ({
        id: m.id,
        version: m.version || null,
        stateNames: m.stateNames || [],
      })),
      writtenAt: new Date().toISOString(),
    };

    try {
      await writeCard(MANIFEST_CARD_TITLE, JSON.stringify(manifest), { type: 'frontier' });
    } catch (err) {
      console.warn(TAG, 'heartbeat manifest write failed', err?.message || err);
    }
    try {
      await writeCard(MODULES_CARD_TITLE, JSON.stringify(modulesPayload), { type: 'frontier' });
    } catch (err) {
      console.warn(TAG, 'heartbeat modules write failed', err?.message || err);
    }
  }

  // ---------- upstream wiring (DOM events from ws-stream.js) ----------

  function bootstrap() {
    if (state.started) return;
    state.started = true;

    document.addEventListener('frontier:cards:full', (e) => {
      emit('cards:full', e.detail);
    });

    document.addEventListener('frontier:cards:diff', (e) => emit('cards:diff', e.detail));

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
    });

    document.addEventListener('frontier:mutation:template', (e) => {
      emit('mutation:template', e.detail);
      // A fresh template may enable a previously-deferred heartbeat.
      if (state.adventureId) scheduleHeartbeat();
    });

    // Phase 1: authoritative adventure-boundary signal from ws-stream.
    document.addEventListener('frontier:adventure:change', (e) => {
      onAdventureChange(e.detail);
    });

    console.log(TAG, 'started');
  }

  // ---------- write helper ----------

  // All card writes go through the write queue (Phase 1). The queue provides
  // per-card serialization, last-write-wins coalescing, exponential-backoff
  // retry, and optimistic local echo.
  function getWriteQueue() {
    return window.Frontier?.writeQueue || null;
  }

  async function writeCard(title, value, opts = {}) {
    const wq = getWriteQueue();
    if (wq) {
      return wq.enqueue(title, value, opts);
    }
    // Fallback: if write-queue.js didn't load, write directly.
    const instance = state.aiService;
    if (!instance?.upsertStoryCard) {
      throw new Error(`${TAG} writeCard: AIDungeonService not injected. Call Frontier.core.setAIService(service) first.`);
    }
    return instance.upsertStoryCard(title, value, opts);
  }

  function setAIService(service) {
    state.aiService = service;
    // Wire the write queue's underlying write function.
    const wq = getWriteQueue();
    if (wq && service && typeof service.upsertStoryCard === 'function') {
      wq.setWriteFn((title, value, opts) => service.upsertStoryCard(title, value, opts));
    }
  }

  // ---------- module context factory ----------

  // Each module's mount(ctx) receives one of these. Keeping the context
  // scoped per-module (with the module's `id` baked in) lets Core scope
  // logs and auto-clean listeners on unmount.
  function makeModuleCtx(moduleDef) {
    const moduleListeners = [];
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
    return {
      id: moduleDef.id,
      on: ctxOn,
      getState,
      getCardByTitle,
      getAdventureId: () => state.adventureId,
      getTail: () => state.tail,
      getLiveCount: () => state.liveCount,
      writeCard,
      log: (...args) => console.log(`[${moduleDef.id}]`, ...args),
      _tearDown: ctxTearDown, // called by registry on unmount
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
    // Internal hooks used by module-registry.js; not part of the stable
    // module API.
    _makeModuleCtx: makeModuleCtx,
    _emit: emit,
    // Read-only inspection.
    inspect: () => ({
      started: state.started,
      adventureId: state.adventureId,
      tail: state.tail,
      liveCount: state.liveCount,
      listeners: [...listeners.keys()].map(k => ({ event: k, count: listeners.get(k).size })),
      writeQueue: getWriteQueue()?.inspect?.() || null,
    }),
  };

  window.Frontier = window.Frontier || {};
  window.Frontier.core = core;

  bootstrap();
})();
