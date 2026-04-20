// services/frontier/ws-interceptor.js
//
// Frontier page-world WebSocket shim. Runs at document-start in the MAIN world,
// BEFORE AI Dungeon's bundle constructs its Apollo subscription socket. Captures
// the three subscription payloads Frontier cares about and forwards them to the
// content-script side via window.postMessage.
//
// Correctness-critical constraints:
//   * MUST install before any page JS runs. Otherwise Apollo captures the
//     native `WebSocket` reference at module-evaluation time and our shim is
//     invisible to it. Achieved via manifest content_script run_at=document_start
//     + world=MAIN, with a <script>-tag fallback injected by ws-stream.js.
//   * MUST be `class extends NativeWebSocket`, not a function wrapper. Apollo
//     Client (graphql-ws) uses `instanceof WebSocket` internally; a function
//     wrapper fails those checks silently and produces zero subscription frames.
//   * MUST be idempotent. ws-stream.js may also inject us via <script> tag as a
//     fallback path; the window.__frontierWsInstalled guard prevents double-install.
//   * MUST NOT leak references to the content-script side's objects. Everything
//     posted is plain JSON (structured-clonable primitives + arrays + objects).
//
// See:
//   - Project Management/frontier/01-architecture.md (transport layer)
//   - BetterDungeon/services/frontier/ACTION_IDS.md (payload shapes)

(function () {
  if (window.__frontierWsInstalled) return;
  window.__frontierWsInstalled = true;

  const NativeWebSocket = window.WebSocket;
  const ORIGIN = window.location.origin;

  function post(kind, payload) {
    try {
      window.postMessage({ source: 'BD_FRONTIER_WS', kind, payload }, ORIGIN);
    } catch (err) {
      // postMessage throws only for non-structured-cloneable payloads. We feed
      // it parsed JSON, so this is a programmer error if it ever fires.
      console.warn('[Frontier/ws-interceptor] postMessage failed', err);
    }
  }

  class FrontierWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);

      // Only instrument the GraphQL subscription socket. AID may open other
      // sockets (e.g. analytics) that we do not care about.
      if (typeof url !== 'string' || !url.includes('graphql')) return;

      post('open', { url });

      this.addEventListener('message', (event) => {
        // event.data is a string frame from the graphql-ws protocol. Non-JSON
        // frames (keepalive pings, legacy 'ka' messages) are silently skipped.
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        // graphql-ws spec: subscription payloads arrive with type='next'.
        // Legacy subscriptions-transport-ws: type='data'. Support both.
        if (msg.type !== 'next' && msg.type !== 'data') return;

        const data = msg.payload?.data ?? msg.data;
        if (!data || typeof data !== 'object') return;

        if (data.adventureStoryCardsUpdate) {
          post('cards', data.adventureStoryCardsUpdate);
        }
        if (data.contextUpdate) {
          post('context', data.contextUpdate);
        }
        if (data.actionUpdates) {
          post('actions', data.actionUpdates);
        }
      });
    }
  }

  // Preserve static state constants. Some libraries (not Apollo, but others
  // that may share the page) read WebSocket.OPEN etc. as numeric literals.
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    if (NativeWebSocket[key] !== undefined) {
      FrontierWebSocket[key] = NativeWebSocket[key];
    }
  }

  window.WebSocket = FrontierWebSocket;

  // Handshake signal so ws-stream.js can confirm MAIN-world installation and
  // skip its fallback injection. Sent synchronously at install time; by the
  // time any page script runs, this has already been queued.
  post('hello', { t: Date.now() });
})();
