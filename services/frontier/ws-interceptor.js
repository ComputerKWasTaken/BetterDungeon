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

  // MAIN-world debug bridge. Lets DevTools console (which runs in MAIN world)
  // verify the shim without switching execution contexts. Counts are cheap and
  // useful for confirming frames are flowing without enabling any noisy logs.
  const debug = {
    installed: true,
    installedAt: Date.now(),
    nativeWebSocketName: NativeWebSocket.name || 'WebSocket',
    frames: { open: 0, cards: 0, context: 0, actions: 0, hello: 0 },
    // Diagnostic surface. Populated lazily as frames arrive — useful for
    // confirming channel names and URLs during Phase 1 smoke tests. Safe to
    // leave enabled; memory footprint is bounded (urls deduped, opKeys is a
    // small counter map).
    urls: new Set(),
    opKeys: Object.create(null),  // subscription op name -> frame count
    sampleFrames: Object.create(null), // op name -> first payload (for shape inspection)
  };
  window.__Frontier = window.__Frontier || {};
  window.__Frontier.shim = debug;

  function post(kind, payload) {
    try {
      window.postMessage({ source: 'BD_FRONTIER_WS', kind, payload }, ORIGIN);
      if (kind in debug.frames) debug.frames[kind]++;
    } catch (err) {
      // postMessage throws only for non-structured-cloneable payloads. We feed
      // it parsed JSON, so this is a programmer error if it ever fires.
      console.warn('[Frontier/ws-interceptor] postMessage failed', err);
    }
  }

  class FrontierWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);

      // Per the WebSocket spec, `url` may be either a string or a URL object.
      // Normalize to string once so downstream checks (includes, Set storage)
      // behave uniformly. URL.toString() returns the same form as the string
      // constructor argument would have.
      const urlStr = typeof url === 'string'
        ? url
        : (url && typeof url.toString === 'function' ? url.toString() : '');

      // Record every URL for diagnostic purposes — lets us see any AID WS
      // endpoint we might not be instrumenting yet (e.g. a dedicated cards
      // channel on a non-graphql URL). Cheap: urls is a Set.
      if (urlStr) debug.urls.add(urlStr);

      // Attach a listener to every socket for diagnostic accounting, but only
      // forward frames to the content-script side for sockets whose URL looks
      // like a GraphQL subscription endpoint. Non-GraphQL traffic is still
      // counted in opKeys so we can discover new channels.
      const isGraphQL = urlStr.includes('graphql');
      if (isGraphQL) post('open', { url: urlStr });

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

        // Diagnostic: count every top-level op name we see, and stash the
        // first payload sample per op for shape inspection. Bounded memory.
        for (const opName of Object.keys(data)) {
          debug.opKeys[opName] = (debug.opKeys[opName] || 0) + 1;
          if (!(opName in debug.sampleFrames)) {
            debug.sampleFrames[opName] = data[opName];
          }
        }

        if (!isGraphQL) return;

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
