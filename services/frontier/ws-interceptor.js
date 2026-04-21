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
    frames: { open: 0, cards: 0, 'cards:hydrate': 0, 'cards:upsert': 0, 'cards:enrich': 0, context: 0, actions: 0, 'actions:hydrate': 0, 'adventure:change': 0, hello: 0, mutation: 0 },
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
  // Phase 1 diagnostic: captures the key set of any response node that
  // contains adventureId. Lets us discover the exact field names AID uses
  // for actions in HTTP responses (e.g. `actionWindow` vs `actions`).
  debug.adventureNodeKeys = null;

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

      // Capture outbound WS frames as a fallback mutation-template path.
      // graphql-ws (modern protocol) uses { type: 'subscribe', payload: { query, variables, operationName } }
      // for queries, mutations, AND subscriptions alike. If AID sends card
      // mutations over WS instead of HTTP, this is where we catch them.
      if (isGraphQL) {
        const nativeSend = this.send.bind(this);
        this.send = (data) => {
          try {
            if (typeof data === 'string' && data.length < 20000) {
              let parsed;
              try { parsed = JSON.parse(data); } catch { parsed = null; }
              if (parsed && (parsed.type === 'subscribe' || parsed.type === 'start')) {
                const opName = parsed.payload?.operationName ||
                  (typeof parsed.payload?.query === 'string'
                    ? (parsed.payload.query.match(/\b(?:mutation|query|subscription)\s+(\w+)/) || [])[1]
                    : null);
                if (opName) {
                  debug.wsOps = debug.wsOps || Object.create(null);
                  debug.wsOps[opName] = (debug.wsOps[opName] || 0) + 1;
                  if (isTrackedOp(opName)) {
                    // Stash a WS-flavored template. The replay path in
                    // AIDungeonService is HTTP-only; a WS-only AID would need
                    // a WS replay path instead. For now we still stash it so
                    // we can at least see the shape.
                    const template = {
                      op: opName,
                      url: urlStr,
                      method: 'WS',
                      headers: {},
                      body: data,
                      response: null,
                      capturedAt: Date.now(),
                      transport: 'ws',
                    };
                    storeTemplate(template);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[Frontier/ws-interceptor] outbound WS capture failed', err);
          }
          return nativeSend(data);
        };
      }

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

  // ---------- fetch shim for GraphQL mutation template capture ----------
  //
  // Card mutations (updateStoryCard, createStoryCard, removeStoryCard) travel
  // as HTTP POSTs to /graphql, not over the WS subscription channel. BD needs
  // to replay these mutations from the isolated world to write cards
  // programmatically, but Apollo's mutation strings and auth headers are
  // embedded in AID's minified bundle. Rather than reverse-engineer them,
  // we passively capture the first successful specimen of each mutation and
  // expose it as a reusable template.
  //
  // What we store per operation:
  //   - url:         the full request URL
  //   - method:      always 'POST' for GraphQL
  //   - headers:     a sanitized snapshot of request headers (Authorization,
  //                  content-type, etc.) so BD can match AID's auth scheme
  //   - body:        the raw request body as a string (GraphQL query + vars)
  //   - response:    the parsed response body (for shape validation)
  //   - capturedAt:  timestamp of the capture
  //
  // The data is exposed via window.__Frontier.shim.mutations AND posted to
  // ws-stream.js via a 'mutation' kind so the isolated world can build its
  // own template cache without having to cross-world-read the MAIN state.

  // AID's actual card-mutation op names (confirmed empirically):
  //   - SaveQueueStoryCard    — the update path (used when you edit a card)
  //   - UseAutoSaveStoryCard  — toggle-autosave path (not used for content writes)
  //   - Create*StoryCard / Remove*StoryCard — not yet observed, names TBD
  //
  // We cast a wide net here: any op whose name ends in "StoryCard" is worth
  // capturing as a template, and the consumer (AIDungeonService.upsertStoryCard)
  // picks the specific ones it knows how to use. Cheap, and future-proofs us
  // against AID renames.
  const isTrackedOp = (name) => typeof name === 'string' && /StoryCard$/.test(name);
  // Template storage is two-level:
  //   debug.mutations[opName] — latest template for this op (legacy path).
  //   debug.mutationsByCard[id][opName] — per-card-id templates, the preferred
  //     lookup path for writes so editing card A then card B leaves BOTH
  //     usable, rather than having B's template clobber A's.
  // Both are populated on every capture so older consumers keep working.
  debug.mutations = Object.create(null);
  debug.mutationsByCard = Object.create(null);

  // Card enrichment store: id -> { shortId?, contentType?, ... }. Populated
  // opportunistically from any GraphQL response that exposes these fields.
  // Forwarded to ws-stream which merges them into the card snapshot. Bounded
  // growth — one entry per card id ever seen.
  debug.cardEnrichment = Object.create(null);

  // Diagnostic counters. Let us see whether AID is using fetch or XHR and
  // which op names it's emitting. Bounded memory: opNames is a Set, counters
  // are integers.
  debug.http = {
    fetch: { total: 0, graphql: 0, posts: 0, opNames: new Set() },
    xhr:   { total: 0, graphql: 0, posts: 0, opNames: new Set() },
    lastFetchSampleBody: null,  // first /graphql POST body seen, for shape inspection
    lastXhrSampleBody: null,
  };

  const NativeFetch = window.fetch;

  // Extract the GraphQL operation name from a request body. graphql-http batch
  // requests wrap a single op in an array; non-batched requests are a bare
  // object. We only inspect bodies that look like JSON; Apollo's persisted-
  // query format also includes the operationName field directly.
  function detectOpName(bodyText) {
    if (typeof bodyText !== 'string' || bodyText.length === 0) return null;
    let parsed;
    try { parsed = JSON.parse(bodyText); } catch { return null; }
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!first || typeof first !== 'object') return null;
    // operationName is the canonical field. Fall back to a loose query-string
    // match (e.g. "mutation UpdateStoryCard") if operationName is absent.
    if (typeof first.operationName === 'string') return first.operationName;
    if (typeof first.query === 'string') {
      const m = first.query.match(/\b(?:mutation|query|subscription)\s+(\w+)/);
      if (m) return m[1];
    }
    return null;
  }

  // Walk a JSON tree (depth-limited for performance) and forward any
  // storyCards-shaped arrays we find as a cards hydration event. This is how
  // we populate the card snapshot on adventures whose server-side script does
  // not continuously write cards — the adventureStoryCardsUpdate subscription
  // only fires on server-originated writes, so absent that channel we depend
  // on HTTP responses (GetAdventure on load, SaveQueueStoryCard echoes on
  // edit, etc.) to seed and maintain state.
  //
  // Recognizes these shapes:
  //   1. { storyCards: [Card, ...], adventureId?: "..." }  — top-level hit
  //   2. A single storyCard object under `.storyCard` — used by mutation
  //      responses, forwarded as a one-element delta.
  //   3. { actions: [Action, ...] } — action array (e.g. GetAdventure),
  //      forwarded as `actions:hydrate` so ws-stream populates tail/liveCount.
  //   4. Adventure-level metadata (adventureId + shortId) — forwarded as
  //      `adventure:change` for boundary detection.
  function scanAndForwardCards(root, maxDepth = 6) {
    if (!root || typeof root !== 'object') return;
    // inCardScope: true once the walk has descended through a `storyCard` or
    // `storyCards` field. Enrichment harvesting is gated on this because AID
    // response trees contain many OTHER entities that share the
    // {id, shortId, contentType} shape (Scenario, Adventure, content index
    // items on the home/explore pages, etc.). Without scope-gating, we polluted
    // the enrichment index with hundreds of scenario ids — see the 437-entry
    // bug where every harvested `contentType` was `'scenario'`.
    //
    // adventureEmitted: prevents emitting duplicate adventure:change events
    // when multiple subtrees of the same HTTP response carry adventureId.
    let adventureEmitted = false;
    const stack = [{ node: root, depth: 0, inCardScope: false }];
    const seen = new WeakSet();
    while (stack.length) {
      const { node, depth, inCardScope } = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      if (depth > maxDepth) continue;

      if (Array.isArray(node)) {
        for (const v of node) {
          if (v && typeof v === 'object') stack.push({ node: v, depth: depth + 1, inCardScope });
        }
        continue;
      }

      // storyCards array at this node? This is authoritative-shaped data
      // (e.g. GetAdventure response) — treat as a full snapshot hydration.
      if (Array.isArray(node.storyCards) && looksLikeCardArray(node.storyCards)) {
        const advId = typeof node.adventureId === 'string' ? node.adventureId : undefined;
        post('cards:hydrate', advId ? { storyCards: node.storyCards, adventureId: advId }
                                    : { storyCards: node.storyCards });
      }
      // Single storyCard object (mutation response echo). Partial delta —
      // must NOT remove other cards.
      if (node.storyCard && typeof node.storyCard === 'object' && looksLikeCard(node.storyCard)) {
        post('cards:upsert', { storyCards: [node.storyCard] });
      }

      // --- Action-stream HTTP hydration (Phase 1) ---
      // GetAdventure and similar responses carry the full actions[] array.
      // Forward them so ws-stream can populate tail/liveCount on page load
      // without waiting for the first WS actionUpdates frame.
      // AID may use `actions` or `actionWindow` depending on the query.
      const actionArr = Array.isArray(node.actions) ? node.actions
                      : Array.isArray(node.actionWindow) ? node.actionWindow
                      : null;
      if (actionArr && looksLikeActionArray(actionArr)) {
        post('actions:hydrate', { actions: actionArr });
      }

      // --- Adventure-boundary detection (Phase 1) ---
      // Emit a dedicated adventure:change event when we discover adventure
      // identity from HTTP responses (e.g. GetAdventure). This lets ws-stream
      // reset stale state decisively. We look for adventureId + shortId at
      // nodes that also carry storyCards or actions (scoping prevents false
      // positives from scenario/explore page objects).
      if (!adventureEmitted && typeof node.adventureId === 'string' &&
          (Array.isArray(node.storyCards) || actionArr)) {
        const shortId = typeof node.shortId === 'string' ? node.shortId : null;
        post('adventure:change', { adventureId: node.adventureId, shortId });
        adventureEmitted = true;
        // Diagnostic: capture the key set of this adventure node so we can
        // see exactly what fields AID includes (e.g. actions vs actionWindow).
        if (!debug.adventureNodeKeys) {
          debug.adventureNodeKeys = Object.keys(node);
        }
      }

      // Enrichment harvest. Only when we're already under a story-card subtree
      // — otherwise any entity with a shortId (Scenario, Adventure, etc.)
      // would pollute the index. See the comment on inCardScope above.
      // Accept both string and numeric ids (parallel to the coerceId logic
      // in storeTemplate) so any future AID serialization variant that emits
      // numeric ids in response bodies still gets indexed under a string key.
      if (inCardScope && (typeof node.id === 'string' || typeof node.id === 'number') &&
          (typeof node.shortId === 'string' || typeof node.contentType === 'string')) {
        const normId = typeof node.id === 'string' ? node.id : String(node.id);
        harvestEnrichment({ ...node, id: normId });
      }

      for (const k of Object.keys(node)) {
        const v = node[k];
        if (!v || typeof v !== 'object') continue;
        // Enter card scope when descending through a storyCard(s) field.
        // Scope is sticky: once inside, children inherit it so nested
        // per-card metadata (e.g. `__typename`, `createdAt` wrappers) still
        // qualify. Top-level scope is only entered via these two field names
        // because those are AID's canonical paths for card payloads.
        const childScope = inCardScope || k === 'storyCard' || k === 'storyCards';
        stack.push({ node: v, depth: depth + 1, inCardScope: childScope });
      }
    }
  }

  function harvestEnrichment(cardLike) {
    const id = cardLike.id;
    const prev = debug.cardEnrichment[id] || {};
    const next = {
      ...prev,
      ...(typeof cardLike.shortId === 'string' ? { shortId: cardLike.shortId } : {}),
      ...(typeof cardLike.contentType === 'string' ? { contentType: cardLike.contentType } : {}),
    };
    // Only forward if something actually changed (new field or changed value).
    const changed = Object.keys(next).some(k => next[k] !== prev[k]);
    if (!changed) return;
    debug.cardEnrichment[id] = next;
    post('cards:enrich', { id, ...next });
  }

  // Centralize template storage so fetch, xhr, and WS outbound paths all
  // write into both indexes consistently. Extracts input.id from the body
  // so we can index by card id — crucial because shortId is per-card and
  // not recoverable from GetAdventure.
  function storeTemplate(template) {
    const opName = template?.op;
    if (!opName) return;
    debug.mutations[opName] = template;

    // Parse the outbound body to extract (a) the card id for per-card
    // indexing and (b) shortId/contentType for enrichment. AID's response
    // selection-sets for StoryCard mutations exclude shortId, so the
    // request body is the ONLY reliable place to harvest it. Without this,
    // enrichment would be permanently empty for cards the user has
    // only observed being edited (not freshly loaded from GetAdventure).
    let cardId = null;
    try {
      const parsed = typeof template.body === 'string' ? JSON.parse(template.body) : template.body;
      const op = Array.isArray(parsed) ? parsed[0] : parsed;
      const input = op?.variables?.input;
      // Coerce numeric card ids to strings for consistent indexing. AID's
      // current traffic is uniformly string, but some client code paths
      // (internal or future) may send numbers — a mismatch here would
      // silently skip per-card indexing for those mutations.
      const coerceId = (v) => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : null));
      if (input && typeof input === 'object') {
        cardId = coerceId(input.id);
        // Harvest enrichment directly from the mutation input — same code
        // path the response scanner uses, so downstream behavior is uniform.
        if (cardId && (typeof input.shortId === 'string' || typeof input.contentType === 'string')) {
          // Pass a normalized copy so the enrichment index always stores
          // string ids (matches the rest of our state).
          harvestEnrichment({ ...input, id: cardId });
        }
      } else {
        cardId = coerceId(op?.variables?.id);
      }
    } catch { /* swallow — template just lacks card id (e.g. create op) */ }

    if (cardId) {
      if (!debug.mutationsByCard[cardId]) debug.mutationsByCard[cardId] = Object.create(null);
      debug.mutationsByCard[cardId][opName] = template;
      template._cardId = cardId; // helps the isolated-world side build its index
    }
    post('mutation', template);
  }

  function looksLikeCard(x) {
    return x && typeof x === 'object' &&
           typeof x.id !== 'undefined' &&
           (typeof x.title === 'string' || typeof x.value === 'string');
  }
  function looksLikeCardArray(arr) {
    if (arr.length === 0) return true; // empty array is harmless to forward
    return looksLikeCard(arr[0]);
  }

  // Action-array recognition for HTTP hydration (Phase 1). AID action objects
  // always have { id } and typically include { type, text, undoneAt }. However,
  // when actionStorage is "s3" (common), GetAdventure responses carry action
  // stubs WITHOUT text — just { id, type, undoneAt, ... }. We accept any
  // object with id + at least one action-like field. First element only.
  function looksLikeAction(x) {
    if (!x || typeof x !== 'object') return false;
    if (typeof x.id !== 'string' && typeof x.id !== 'number') return false;
    // Accept if it has text, type, or undoneAt (any action-like field).
    return typeof x.text === 'string' ||
           typeof x.type === 'string' ||
           'undoneAt' in x;
  }
  function looksLikeActionArray(arr) {
    if (arr.length === 0) return false; // empty actions[] is not useful
    return looksLikeAction(arr[0]);
  }

  function snapshotHeaders(headersInit) {
    // headersInit may be a plain object, a Headers instance, or an array of
    // [k, v] pairs. Normalize to a simple object. We intentionally capture
    // Authorization and cookies (though cookies are typically not sent via
    // fetch headers but via the credentials mode). The isolated-world side
    // will apply `credentials: 'include'` which cookie-attaches automatically.
    const out = Object.create(null);
    if (!headersInit) return out;
    if (headersInit instanceof Headers) {
      headersInit.forEach((v, k) => { out[k] = v; });
    } else if (Array.isArray(headersInit)) {
      for (const [k, v] of headersInit) out[k] = v;
    } else if (typeof headersInit === 'object') {
      for (const k of Object.keys(headersInit)) out[k] = headersInit[k];
    }
    return out;
  }

  window.fetch = function frontierFetch(input, init) {
    debug.http.fetch.total++;
    const url = typeof input === 'string' ? input : (input?.url || '');
    const isGraphQL = typeof url === 'string' && url.includes('/graphql');
    if (!isGraphQL) return NativeFetch.call(this, input, init);

    debug.http.fetch.graphql++;
    const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : null;
    if (method === 'POST') {
      debug.http.fetch.posts++;
      if (!debug.http.lastFetchSampleBody && bodyText) {
        // Keep only the first sample, truncated, to cap memory and avoid
        // logging PII repeatedly.
        debug.http.lastFetchSampleBody = bodyText.slice(0, 500);
      }
    }
    const opName = method === 'POST' ? detectOpName(bodyText) : null;
    if (opName) debug.http.fetch.opNames.add(opName);

    // Invoke the native fetch. All /graphql responses get a response-scan
    // (for card hydration); tracked ops additionally get template capture.
    const promise = NativeFetch.call(this, input, init);

    return promise.then(async (response) => {
      if (!response.ok) return response;
      try {
        // Clone-and-parse is safe: the caller's response reference is
        // untouched. We parse once and reuse for both hydration + template
        // capture to avoid a double JSON parse.
        const cloned = response.clone();
        const respText = await cloned.text();
        let respJson = null;
        try { respJson = JSON.parse(respText); } catch { /* non-JSON */ }

        if (respJson) scanAndForwardCards(respJson);

        if (opName && isTrackedOp(opName) && respJson) {
          const template = {
            op: opName,
            url,
            method,
            headers: snapshotHeaders(init?.headers),
            body: bodyText,
            response: respJson,
            capturedAt: Date.now(),
          };
          storeTemplate(template);
        }
      } catch (err) {
        // AbortError is expected during SPA navigation — AID cancels in-flight
        // fetches when the user navigates away. Silence it.
        if (err?.name !== 'AbortError') {
          console.warn('[Frontier/ws-interceptor] fetch post-processing failed', err);
        }
      }
      return response;
    }).catch((err) => {
      // Network error or abort — propagate unchanged. Don't swallow.
      throw err;
    });
  };

  // ---------- XMLHttpRequest shim (fallback for non-fetch clients) ----------
  //
  // Apollo Client typically uses fetch, but some AID builds and some
  // React-Native-Web variants fall through to XMLHttpRequest for POSTs. We
  // instrument XHR symmetrically with fetch so mutation capture works
  // regardless of which transport AID picked.
  //
  // We wrap two prototype methods: open() to capture URL+method, and send()
  // to capture the body. Response body is captured via a one-shot
  // readystatechange listener on completion.

  const XHRProto = XMLHttpRequest.prototype;
  const nativeXHROpen = XHRProto.open;
  const nativeXHRSend = XHRProto.send;
  const nativeXHRSetHeader = XHRProto.setRequestHeader;

  XHRProto.open = function frontierXHROpen(method, url, ...rest) {
    this.__frontier = {
      method: typeof method === 'string' ? method.toUpperCase() : 'GET',
      url: typeof url === 'string' ? url : (url && url.toString ? url.toString() : ''),
      headers: Object.create(null),
      body: null,
    };
    return nativeXHROpen.call(this, method, url, ...rest);
  };

  XHRProto.setRequestHeader = function frontierXHRSetHeader(name, value) {
    if (this.__frontier) this.__frontier.headers[name] = value;
    return nativeXHRSetHeader.call(this, name, value);
  };

  XHRProto.send = function frontierXHRSend(body) {
    debug.http.xhr.total++;
    const meta = this.__frontier;
    if (!meta) return nativeXHRSend.call(this, body);

    const isGraphQL = meta.url.includes('/graphql');
    if (isGraphQL) {
      debug.http.xhr.graphql++;
      if (meta.method === 'POST') {
        debug.http.xhr.posts++;
        const bodyText = typeof body === 'string' ? body : null;
        meta.body = bodyText;
        if (!debug.http.lastXhrSampleBody && bodyText) {
          debug.http.lastXhrSampleBody = bodyText.slice(0, 500);
        }
        const opName = detectOpName(bodyText);
        if (opName) {
          debug.http.xhr.opNames.add(opName);
          meta.opName = opName;
        }
      }
    }

    // All /graphql XHR responses get post-processed for card hydration;
    // tracked ops additionally get template capture.
    if (isGraphQL) {
      const xhr = this;
      const onDone = () => {
        if (xhr.readyState !== 4) return;
        xhr.removeEventListener('readystatechange', onDone);
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          let respJson = null;
          try { respJson = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
          if (respJson) scanAndForwardCards(respJson);
          if (meta.opName && isTrackedOp(meta.opName) && respJson) {
            const template = {
              op: meta.opName,
              url: meta.url,
              method: meta.method,
              headers: { ...meta.headers },
              body: meta.body,
              response: respJson,
              capturedAt: Date.now(),
              transport: 'xhr',
            };
            storeTemplate(template);
          }
        } catch (err) {
          console.warn('[Frontier/ws-interceptor] XHR post-processing failed', err);
        }
      };
      this.addEventListener('readystatechange', onDone);
    }

    return nativeXHRSend.call(this, body);
  };

  // Handshake signal so ws-stream.js can confirm MAIN-world installation and
  // skip its fallback injection. Sent synchronously at install time; by the
  // time any page script runs, this has already been queued.
  post('hello', { t: Date.now() });
})();
