// services/frontier/ws-stream.js
//
// Frontier content-script-side transport. Runs at document-start in the
// ISOLATED world. Listens for postMessages from the page-world ws-interceptor,
// maintains per-adventure card/action state, and broadcasts DOM CustomEvents
// for Core and modules to consume.
//
// Runs alongside ws-interceptor.js, which lives in the MAIN world. The two
// communicate via window.postMessage with a shared `BD_FRONTIER_WS` marker.
//
// Emitted DOM events (dispatched on `document`):
//   frontier:cards:full        detail: { cards: Card[] }
//     Fires once on first card snapshot; subsequent changes use :diff.
//   frontier:cards:diff        detail: { added: Card[], updated: Card[], removed: Card[] }
//   frontier:actions:change    detail: { actions: Action[], changed: Action[] }
//     Fires on EVERY actionUpdates frame (including no-op edits).
//   frontier:tail:change       detail: { tail: string|null, prev: string|null }
//     Tail = max(id where undoneAt === null). Advances on new turns and retry;
//     retreats on undo / rewind.
//   frontier:livecount:change  detail: { liveCount: number, prev: number }
//     Live count = count of non-undone actions. This is the ordinal Scripture
//     and similar modules use to look up history[liveCount]. See
//     02-protocol.md#live-count-history-convention.
//
// Debug API (available in DevTools console as window.Frontier.ws):
//   getCards()     -> Map<cardId, Card>
//   getActions()   -> Map<id, Action>
//   getTail()      -> string | null
//   getLiveCount() -> number
//   getState()     -> internal snapshot (for debugging only; do not write)
//
// See:
//   - Project Management/frontier/01-architecture.md (data flow)
//   - Project Management/frontier/02-protocol.md (payload semantics)

(function () {
  if (window.Frontier?.ws) return;

  const TAG = '[Frontier/ws-stream]';
  const ORIGIN = window.location.origin;

  const state = {
    cards: new Map(),       // cardId -> Card (as delivered, enriched as we learn more)
    actions: new Map(),     // id -> Action (as delivered)
    tail: null,             // string | null
    liveCount: 0,           // number
    firstCards: true,       // tracks whether we've emitted cards:full yet
    helloReceived: false,   // MAIN-world interceptor handshake
    // Adventure-boundary tracking (Phase 1).
    adventureId: null,      // string | null — the current adventure's id
    adventureShortId: null, // string | null — the current adventure's URL slug
    urlPollTimer: null,     // interval id for SPA navigation detection
    lastUrlPath: null,      // tracks pathname for change detection
    // Template cache keyed by op name (latest wins; use mutationsByCard for
    // per-card precision). This mirrors the MAIN-world debug.mutations.
    mutations: Object.create(null),
    // Per-card-id template cache. Indexed as mutationsByCard[cardId][opName].
    // Kept for diagnostics/observability; no longer required for write
    // correctness now that we know shortId is per-adventure (see enrichment
    // comment below).
    mutationsByCard: Object.create(null),
    // Enrichment data learned from captured mutations. Keyed by card id.
    //
    // CRITICAL (empirically confirmed 2026-04-20): the `shortId` field in
    // AID's SaveQueueStoryCard input is the ADVENTURE's URL slug (e.g.
    // "nGgG3mHvbLrp" for aidungeon.com/adventure/nGgG3mHvbLrp), NOT a
    // per-card identifier. All cards in the same adventure share the same
    // shortId. `contentType: "adventure"` qualifies this — it says the
    // content scope is the adventure with the given shortId.
    //
    // Practical consequence: once we've captured ONE mutation in an
    // adventure, we have everything we need to write to EVERY card in it.
    // The per-card indexing is kept for diagnostics/observability only.
    enrichment: Object.create(null),
  };

  // ---------- helpers ----------

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (err) {
      console.warn(TAG, 'emit failed for', name, err);
    }
  }

  // ---------- adventure-boundary management (Phase 1) ----------

  // Resolve the adventure's shortId from a URL pathname. Expanded regex
  // covers /adventure/<slug>, /adventures/<slug>, /play/<slug>, and
  // /scenario(s)/<slug>.
  const ADVENTURE_URL_RE = /\/(?:adventures?|play|scenarios?)\/([A-Za-z0-9_-]{8,20})/;

  function parseShortIdFromUrl() {
    try {
      const m = window.location.pathname.match(ADVENTURE_URL_RE);
      if (m) return m[1];
    } catch { /* location access denied or path malformed */ }
    return null;
  }

  // Called when we detect a new adventure (from HTTP hydration, WS payload,
  // or URL change). Resets all per-adventure state so downstream consumers
  // never see stale data from the previous adventure.
  function onAdventureBoundary(adventureId, shortId) {
    if (!adventureId || adventureId === state.adventureId) return;

    const prevId = state.adventureId;
    state.adventureId = adventureId;
    state.adventureShortId = shortId || parseShortIdFromUrl();

    // Clear per-adventure state.
    state.cards = new Map();
    state.actions = new Map();
    state.tail = null;
    state.liveCount = 0;
    state.firstCards = true;
    state.enrichment = Object.create(null);
    // NOTE: state.mutations and state.mutationsByCard are intentionally
    // preserved. Templates are per-op, not per-adventure; a fresh adventure
    // will refresh them as AID's autosave runs.

    emit('frontier:adventure:change', {
      adventureId,
      prevAdventureId: prevId,
      shortId: state.adventureShortId,
    });
    console.log(TAG, 'adventure boundary:', prevId, '→', adventureId);
  }

  // SPA URL poll. AI Dungeon is a single-page app; URL changes happen via
  // history.pushState without triggering popstate. A lightweight interval
  // poll catches navigations that don't produce an immediate HTTP response
  // with adventureId (e.g. navigating back to the homepage).
  function startUrlPoll() {
    if (state.urlPollTimer) return;
    state.lastUrlPath = window.location.pathname;
    state.urlPollTimer = setInterval(() => {
      const current = window.location.pathname;
      if (current === state.lastUrlPath) return;
      state.lastUrlPath = current;

      const newShortId = parseShortIdFromUrl();
      if (newShortId && newShortId !== state.adventureShortId) {
        // We detected a URL change to a different adventure. The full
        // boundary reset will happen when the GetAdventure HTTP response
        // arrives (with the real adventureId). But if we left a non-adventure
        // page, we should note that we're no longer in an adventure.
      }
      if (!newShortId && state.adventureId) {
        // Left an adventure page (went to homepage, explore, etc.).
        // Clear adventure context so modules don't act on stale data.
        const prevId = state.adventureId;
        state.adventureId = null;
        state.adventureShortId = null;
        state.cards = new Map();
        state.actions = new Map();
        state.tail = null;
        state.liveCount = 0;
        state.firstCards = true;
        state.enrichment = Object.create(null);
        emit('frontier:adventure:change', {
          adventureId: null,
          prevAdventureId: prevId,
          shortId: null,
        });
        console.log(TAG, 'left adventure (URL poll):', prevId);
      }
    }, 1000);
  }

  startUrlPoll();

  // ---------- handlers ----------

  // Full-snapshot handler. Used for the adventureStoryCardsUpdate WS
  // subscription AND for HTTP hydrations (GetAdventure, etc.). Cards not in
  // the incoming list are removed — treat as authoritative.
  function onCards(payload) {
    applyCardsPayload(payload, { snapshot: true });
  }

  // Partial-delta handler. Used for mutation response echoes
  // (SaveQueueStoryCard → response.storyCard is a single updated card).
  // Must NOT remove other cards; this is an upsert.
  function onCardsUpsert(payload) {
    applyCardsPayload(payload, { snapshot: false });
  }

  function applyCardsPayload(payload, { snapshot }) {
    const cards = payload?.storyCards;
    if (!Array.isArray(cards)) return;

    const added = [];
    const updated = [];
    const removed = [];
    const seen = new Set();

    for (const c of cards) {
      if (!c || c.id == null) continue;
      seen.add(c.id);
      // Merge any previously-harvested enrichment (shortId, contentType, ...)
      // onto the incoming card before storing. Keeps downstream readers from
      // needing to consult the enrichment index separately.
      const enriched = state.enrichment[c.id]
        ? { ...c, ...state.enrichment[c.id] }
        : c;
      const prev = state.cards.get(c.id);
      if (!prev) {
        added.push(enriched);
      } else if (
        prev.value !== enriched.value ||
        prev.title !== enriched.title ||
        prev.keys !== enriched.keys ||
        prev.type !== enriched.type
      ) {
        updated.push(enriched);
      }
      state.cards.set(c.id, enriched);
    }
    if (snapshot) {
      for (const id of [...state.cards.keys()]) {
        if (!seen.has(id)) {
          removed.push(state.cards.get(id));
          state.cards.delete(id);
        }
      }
    }

    if (state.firstCards && snapshot) {
      state.firstCards = false;
      emit('frontier:cards:full', { cards: [...state.cards.values()] });
    } else if (added.length || updated.length || removed.length) {
      emit('frontier:cards:diff', { added, updated, removed });
    }
  }

  function onContext(_payload) {
    // contextUpdate is a supplementary early signal. The authoritative tail is
    // derived from actions[] in onActions, because contextUpdate does not fire
    // on undo/restore/delete/rewind (see 02-protocol.md event-to-channel matrix).
    // We intentionally do not emit anything here in Lite; Full Frontier may.
  }

  function onMutation(template) {
    // Template shape documented in ws-interceptor.js. Maintain both indexes:
    // by op (latest wins), and by card-id-plus-op (persistent per card).
    if (!template || typeof template !== 'object' || typeof template.op !== 'string') return;
    const prev = state.mutations[template.op];
    state.mutations[template.op] = template;

    // The interceptor attaches _cardId when it can extract input.id from
    // the template body. Index by that so write paths can find the right
    // template for any card they've ever seen edited.
    const cardId = template._cardId;
    if (cardId) {
      if (!state.mutationsByCard[cardId]) state.mutationsByCard[cardId] = Object.create(null);
      state.mutationsByCard[cardId][template.op] = template;
    }

    const firstTime = !prev;
    emit('frontier:mutation:template', { op: template.op, firstTime, cardId, template });
  }

  function onCardsEnrich(detail) {
    // Merge shortId/contentType (and any future fields the interceptor
    // surfaces) into both the enrichment index AND the live card snapshot.
    // Doing both means downstream consumers that read from state.cards see
    // the enriched data without needing to know about the enrichment channel.
    if (!detail || typeof detail.id !== 'string') return;
    const prev = state.enrichment[detail.id] || {};
    const merged = { ...prev };
    if (typeof detail.shortId === 'string') merged.shortId = detail.shortId;
    if (typeof detail.contentType === 'string') merged.contentType = detail.contentType;
    state.enrichment[detail.id] = merged;

    const card = state.cards.get(detail.id);
    if (card) {
      const updated = { ...card, ...merged };
      state.cards.set(detail.id, updated);
      emit('frontier:cards:enrich', { id: detail.id, card: updated, fields: merged });
    }
  }

  function onActions(payload) {
    const incoming = payload?.actions;
    if (!Array.isArray(incoming)) return;

    const changed = [];
    for (const a of incoming) {
      if (!a || a.id == null) continue;
      const prev = state.actions.get(a.id);
      state.actions.set(a.id, a);
      if (
        !prev ||
        prev.text !== a.text ||
        prev.undoneAt !== a.undoneAt ||
        prev.retriedActionId !== a.retriedActionId
      ) {
        changed.push(a);
      }
    }

    // Recompute derived quantities from the full accumulated actions map, not
    // just this frame. actionUpdates typically sends only a recent window.
    let newTail = null;
    let newTailNum = -Infinity;
    let liveCount = 0;
    for (const a of state.actions.values()) {
      if (a.undoneAt == null) {
        liveCount++;
        const n = Number(a.id);
        if (Number.isFinite(n) && n > newTailNum) {
          newTailNum = n;
          newTail = a.id;
        }
      }
    }

    emit('frontier:actions:change', { actions: incoming, changed });

    const prevTail = state.tail;
    if (newTail !== prevTail) {
      state.tail = newTail;
      emit('frontier:tail:change', { tail: newTail, prev: prevTail });
    }

    const prevLive = state.liveCount;
    if (liveCount !== prevLive) {
      state.liveCount = liveCount;
      emit('frontier:livecount:change', { liveCount, prev: prevLive });
    }
  }

  // ---------- message router ----------

  window.addEventListener('message', (event) => {
    // Only accept same-origin messages posted by our own page-world shim.
    if (event.source !== window) return;
    if (event.origin !== ORIGIN) return;
    const msg = event.data;
    if (!msg || msg.source !== 'BD_FRONTIER_WS') return;

    try {
      switch (msg.kind) {
        case 'hello':
          state.helloReceived = true;
          break;
        case 'open':
          // Informational. Reserved for future adventure-boundary detection.
          break;
        case 'cards':
        case 'cards:hydrate':
          // WS subscription frame OR HTTP full-hydration (GetAdventure):
          // authoritative, full snapshot semantics.
          onCards(msg.payload);
          break;
        case 'cards:upsert':
          // HTTP mutation echo: partial delta, no removal.
          onCardsUpsert(msg.payload);
          break;
        case 'cards:enrich':
          // shortId/contentType discovered from any response; merge into
          // the snapshot card and the enrichment index.
          onCardsEnrich(msg.payload);
          break;
        case 'context':
          onContext(msg.payload);
          break;
        case 'actions':
          onActions(msg.payload);
          break;
        case 'actions:hydrate':
          // HTTP-delivered actions (Phase 1). Same handler as WS-pushed
          // actions — populates tail/liveCount on initial page load.
          onActions(msg.payload);
          break;
        case 'adventure:change':
          // Adventure-boundary signal from HTTP hydration (Phase 1).
          // Resets all per-adventure state and emits frontier:adventure:change.
          if (msg.payload?.adventureId) {
            onAdventureBoundary(msg.payload.adventureId, msg.payload.shortId);
          }
          break;
        case 'mutation':
          onMutation(msg.payload);
          break;
        default:
          // Unknown kinds are ignored silently so the interceptor can add new
          // ones without forcing a lockstep ws-stream update.
          break;
      }
    } catch (err) {
      console.warn(TAG, 'handler threw for kind', msg.kind, err);
    }
  });

  // ---------- fallback injection ----------
  //
  // Most modern browsers accept `"world": "MAIN"` in MV3 content_scripts and the
  // primary ws-interceptor.js path is active. On browsers that don't (older
  // Firefox, some Android WebView versions), we inject the interceptor via a
  // <script> tag at document-start. The interceptor's own install guard
  // (window.__frontierWsInstalled) prevents double-install when both paths
  // succeed on modern browsers.
  //
  // This is wrapped in a try/catch because chrome.runtime.getURL can throw if
  // the extension context is invalidated mid-navigation.
  try {
    const api = typeof browser !== 'undefined' ? browser : chrome;
    const url = api?.runtime?.getURL?.('services/frontier/ws-interceptor.js');
    if (url) {
      const scriptEl = document.createElement('script');
      scriptEl.src = url;
      scriptEl.async = false;
      (document.head || document.documentElement).appendChild(scriptEl);
      // Clean up the DOM node once the browser has kicked off the fetch. The
      // installed shim on window persists independent of the element.
      scriptEl.addEventListener('load', () => scriptEl.remove());
      scriptEl.addEventListener('error', () => scriptEl.remove());
    }
  } catch (err) {
    console.warn(TAG, 'fallback interceptor injection failed', err);
  }

  // ---------- public API ----------

  window.Frontier = window.Frontier || {};
  window.Frontier.ws = {
    getCards: () => new Map(state.cards),
    getActions: () => new Map(state.actions),
    getTail: () => state.tail,
    getLiveCount: () => state.liveCount,

    // Op-keyed template lookup. Returns the most recently captured template
    // for any card under this op. Use getMutationTemplateForCard for writes.
    getMutationTemplate: (opName) => state.mutations[opName] || null,
    getMutationTemplates: () => ({ ...state.mutations }),

    // Per-card template lookup. Returns the template captured specifically
    // for the given card id (and optional op), ensuring shortId/contentType
    // match the target. Preferred over getMutationTemplate for replays.
    getMutationTemplateForCard: (cardId, opName) => {
      const ops = state.mutationsByCard[cardId];
      if (!ops) return null;
      if (opName) return ops[opName] || null;
      // Return the first template we have if no op specified — caller can
      // inspect .op on the returned object.
      const firstOp = Object.keys(ops)[0];
      return firstOp ? ops[firstOp] : null;
    },
    getMutationTemplatesForCard: (cardId) => ({ ...(state.mutationsByCard[cardId] || {}) }),
    getAllCardsWithTemplates: () => Object.keys(state.mutationsByCard),

    // Enrichment lookup. Returns { shortId?, contentType? } for the card id,
    // or null if we haven't learned any enrichment fields for it yet.
    // Note: shortId is per-adventure, not per-card — two cards from the
    // same adventure will return the same shortId.
    getEnrichment: (cardId) => state.enrichment[cardId] ? { ...state.enrichment[cardId] } : null,
    getAllEnrichment: () => {
      const out = {};
      for (const id of Object.keys(state.enrichment)) out[id] = { ...state.enrichment[id] };
      return out;
    },

    // Returns the adventure's shortId — the URL slug identifying the current
    // adventure. All writes need this as the `shortId` field in their
    // SaveQueueStoryCard input. Resolution order:
    //   1. Explicitly tracked adventureShortId (set from HTTP hydration or
    //      adventure:change events — most reliable).
    //   2. Any card currently in the snapshot that has harvested enrichment
    //      (captured from a prior SaveQueueStoryCard mutation).
    //   3. URL path parsing (expanded regex: /adventure(s)?/, /play/,
    //      /scenario(s)?/).
    // Returns null only when all three fail — typically means no mutation has
    // been captured yet AND we're not on an adventure URL.
    getAdventureShortId: () => {
      // 1. Explicitly set from boundary detection.
      if (state.adventureShortId) return state.adventureShortId;
      // 2. Enrichment fallback.
      for (const card of state.cards.values()) {
        const e = state.enrichment[card.id];
        if (e?.shortId) return e.shortId;
      }
      // 3. URL parse fallback (hardened regex).
      return parseShortIdFromUrl();
    },

    // Returns the current adventure id (the database id, not the URL slug).
    getAdventureId: () => state.adventureId,

    // Pretty-printed diagnostic dumps for devtools inspection.
    dumpTemplates: () => {
      const rows = [];
      for (const cardId of Object.keys(state.mutationsByCard)) {
        for (const op of Object.keys(state.mutationsByCard[cardId])) {
          const t = state.mutationsByCard[cardId][op];
          rows.push({
            cardId, op, transport: t.transport || 'fetch',
            capturedAt: new Date(t.capturedAt).toISOString(),
          });
        }
      }
      console.table(rows);
      return rows;
    },
    dumpCardsWithoutShortId: () => {
      const rows = [];
      for (const card of state.cards.values()) {
        if (!card.shortId) rows.push({ id: card.id, title: card.title, type: card.type });
      }
      console.table(rows);
      return rows;
    },

    getState: () => {
      return {
        cards: state.cards.size,
        actions: state.actions.size,
        tail: state.tail,
        liveCount: state.liveCount,
        helloReceived: state.helloReceived,
        adventureId: state.adventureId,
        adventureShortId: state.adventureShortId || parseShortIdFromUrl(),
        mutationTemplates: Object.keys(state.mutations),
        cardsWithTemplates: Object.keys(state.mutationsByCard).length,
        enrichedCards: Object.keys(state.enrichment).length,
      };
    },

    // --- Write queue support (Phase 1) ---
    // Optimistic echo: merge a write into the card map immediately so
    // downstream consumers see the update before the server round-trips.
    // Called by write-queue.js; not intended for direct module use.
    _optimisticCardSet: (id, card) => {
      state.cards.set(id, card);
    },
    _optimisticCardRollback: (id, prev) => {
      if (prev) state.cards.set(id, prev);
      else state.cards.delete(id);
    },
    _getCardById: (id) => state.cards.get(id) || null,
  };
})();
