// services/ultrascripts/ws-stream.js
//
// Ultrascripts content-script-side transport. Runs at document-start in the
// ISOLATED world. Listens for postMessages from the page-world ws-interceptor,
// maintains per-adventure card/action state, and broadcasts DOM CustomEvents
// for Core and modules to consume.
//

(function () {
  if (window.Ultrascripts?.ws) return;

  const TAG = '[Ultrascripts/ws-stream]';
  const ORIGIN = window.location.origin;

  const state = {
    cards: new Map(),       // cardId -> Card (as delivered, enriched as we learn more)
    actions: new Map(),     // id -> Action (as delivered)
    tail: null,             // string | null
    liveCount: 0,           // number
    firstCards: true,       // tracks whether we've emitted cards:full yet
    helloReceived: false,   // MAIN-world interceptor handshake
    adventureId: null,      // string | null — the current adventure's id
    adventureShortId: null, // string | null — the current adventure's URL slug
    urlPollTimer: null,     // interval id for SPA navigation detection
    lastUrlPath: null,      // tracks pathname for change detection
    enrichment: Object.create(null),
    baseCredentials: null,  // holds { url, method, headers, capturedAt }
  };

  // ---------- helpers ----------

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (err) {
      console.warn(TAG, 'emit failed for', name, err);
    }
  }

  // ---------- adventure-boundary management ----------

  const ADVENTURE_URL_RE = /\/(?:adventures?|play|scenarios?)\/([A-Za-z0-9_-]{8,20})/;

  function parseShortIdFromUrl() {
    try {
      const m = window.location.pathname.match(ADVENTURE_URL_RE);
      if (m) return m[1];
    } catch { /* location access denied */ }
    return null;
  }

  function onAdventureBoundary(adventureId, shortId) {
    if (!adventureId || adventureId === state.adventureId) return;

    const prevId = state.adventureId;
    state.adventureId = adventureId;
    state.adventureShortId = shortId || parseShortIdFromUrl();

    state.cards = new Map();
    state.actions = new Map();
    state.tail = null;
    state.liveCount = 0;
    state.firstCards = true;
    state.enrichment = Object.create(null);

    emit('ultrascripts:adventure:change', {
      adventureId,
      prevAdventureId: prevId,
      shortId: state.adventureShortId,
    });
  }

  function startUrlPoll() {
    if (state.urlPollTimer) return;
    state.lastUrlPath = window.location.pathname;
    state.urlPollTimer = setInterval(() => {
      const current = window.location.pathname;
      if (current === state.lastUrlPath) return;
      
      const newShortId = parseShortIdFromUrl();
      state.lastUrlPath = current;

      if (newShortId && newShortId !== state.adventureShortId) {
        state.adventureShortId = newShortId;
        if (!state.adventureId) {
          onAdventureBoundary(newShortId, newShortId);
        }
      }
      if (!newShortId && state.adventureId) {
        const prevId = state.adventureId;
        state.adventureId = null;
        state.adventureShortId = null;
        state.cards = new Map();
        state.actions = new Map();
        state.tail = null;
        state.liveCount = 0;
        state.firstCards = true;
        state.enrichment = Object.create(null);
        emit('ultrascripts:adventure:change', {
          adventureId: null,
          prevAdventureId: prevId,
          shortId: null,
        });
      }
    }, 1000);
  }

  startUrlPoll();

  // ---------- handlers ----------

  function onCards(payload) {
    applyCardsPayload(payload, { snapshot: true });
  }

  // Delta updates
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
      emit('ultrascripts:cards:full', { cards: [...state.cards.values()] });
    } else if (added.length || updated.length || removed.length) {
      emit('ultrascripts:cards:diff', { added, updated, removed });
    }
  }

  function onContext(_payload) {}

  function onCardsEnrich(detail) {
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
      emit('ultrascripts:cards:enrich', { id: detail.id, card: updated, fields: merged });
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

    emit('ultrascripts:actions:change', {
      actions: incoming,
      changed,
      key: payload?.key ?? null,
      type: payload?.type ?? null,
      retriedActionId: payload?.retriedActionId ?? null,
      cachedOutputs: payload?.cachedOutputs || [],
    });

    const prevTail = state.tail;
    if (newTail !== prevTail) {
      state.tail = newTail;
      emit('ultrascripts:tail:change', { tail: newTail, prev: prevTail });
    }

    const prevLive = state.liveCount;
    if (liveCount !== prevLive) {
      state.liveCount = liveCount;
      emit('ultrascripts:livecount:change', { liveCount, prev: prevLive });
    }
  }

  // ---------- message router ----------

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== ORIGIN) return;
    const msg = event.data;
    if (!msg || msg.source !== 'BD_ULTRASCRIPTS_WS') return;

    try {
      switch (msg.kind) {
        case 'hello':
          state.helloReceived = true;
          break;
        case 'open':
          break;
        case 'cards':
        case 'cards:hydrate':
          onCards(msg.payload);
          break;
        case 'cards:upsert':
          onCardsUpsert(msg.payload);
          break;
        case 'cards:enrich':
          onCardsEnrich(msg.payload);
          break;
        case 'context':
          onContext(msg.payload);
          break;
        case 'actions':
          onActions(msg.payload);
          break;
        case 'actions:hydrate':
          onActions(msg.payload);
          break;
        case 'adventure:change':
          if (msg.payload?.adventureId) {
            onAdventureBoundary(msg.payload.adventureId, msg.payload.shortId);
          }
          break;
        case 'baseCredentials':
          if (msg.payload) {
            state.baseCredentials = msg.payload;
            emit('ultrascripts:baseCredentials:change', msg.payload);
          }
          break;
        default:
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
  // (window.__ultrascriptsWsInstalled) prevents double-install when both paths
  // succeed on modern browsers.
  try {
    const api = typeof browser !== 'undefined'
      ? browser
      : (typeof chrome !== 'undefined' ? chrome : null);
    const url = api?.runtime?.getURL?.('services/ultrascripts/ws-interceptor.js');
    if (url) {
      const scriptEl = document.createElement('script');
      scriptEl.src = url;
      scriptEl.async = false;
      (document.head || document.documentElement).appendChild(scriptEl);
      scriptEl.addEventListener('load', () => scriptEl.remove());
      scriptEl.addEventListener('error', () => scriptEl.remove());
    }
  } catch (err) {
    console.warn(TAG, 'fallback interceptor injection failed', err);
  }

  // ---------- public API ----------

  window.Ultrascripts = window.Ultrascripts || {};
  window.Ultrascripts.ws = {
    getCards: () => new Map(state.cards),
    getActions: () => new Map(state.actions),
    getTail: () => state.tail,
    getLiveCount: () => state.liveCount,

    getEnrichment: (cardId) => state.enrichment[cardId] ? { ...state.enrichment[cardId] } : null,
    getAllEnrichment: () => {
      const out = {};
      for (const id of Object.keys(state.enrichment)) out[id] = { ...state.enrichment[id] };
      return out;
    },

    getAdventureShortId: () => {
      if (state.adventureShortId) return state.adventureShortId;
      for (const card of state.cards.values()) {
        const e = state.enrichment[card.id];
        if (e?.shortId) return e.shortId;
      }
      return parseShortIdFromUrl();
    },

    getAdventureId: () => state.adventureId,

    getState: () => {
      return {
        cards: state.cards.size,
        actions: state.actions.size,
        tail: state.tail,
        liveCount: state.liveCount,
        helloReceived: state.helloReceived,
        adventureId: state.adventureId,
        adventureShortId: state.adventureShortId || parseShortIdFromUrl(),
        enrichedCards: Object.keys(state.enrichment).length,
      };
    },

    hasBaseCredentials: () => !!state.baseCredentials,
    getBaseCredentials: () => state.baseCredentials,

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
