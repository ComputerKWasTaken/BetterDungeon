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
    cards: new Map(),       // cardId -> Card (as delivered)
    actions: new Map(),     // id -> Action (as delivered)
    tail: null,             // string | null
    liveCount: 0,           // number
    firstCards: true,       // tracks whether we've emitted cards:full yet
    helloReceived: false,   // MAIN-world interceptor handshake
  };

  // ---------- helpers ----------

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (err) {
      console.warn(TAG, 'emit failed for', name, err);
    }
  }

  // ---------- handlers ----------

  function onCards(payload) {
    const cards = payload?.storyCards;
    if (!Array.isArray(cards)) return;

    const added = [];
    const updated = [];
    const removed = [];
    const seen = new Set();

    for (const c of cards) {
      if (!c || c.id == null) continue;
      seen.add(c.id);
      const prev = state.cards.get(c.id);
      if (!prev) {
        added.push(c);
      } else if (
        prev.value !== c.value ||
        prev.title !== c.title ||
        prev.keys !== c.keys ||
        prev.type !== c.type
      ) {
        updated.push(c);
      }
      state.cards.set(c.id, c);
    }
    for (const id of [...state.cards.keys()]) {
      if (!seen.has(id)) {
        removed.push(state.cards.get(id));
        state.cards.delete(id);
      }
    }

    if (state.firstCards) {
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
          onCards(msg.payload);
          break;
        case 'context':
          onContext(msg.payload);
          break;
        case 'actions':
          onActions(msg.payload);
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
    getState: () => ({
      cards: state.cards.size,
      actions: state.actions.size,
      tail: state.tail,
      liveCount: state.liveCount,
      helloReceived: state.helloReceived,
    }),
  };
})();
