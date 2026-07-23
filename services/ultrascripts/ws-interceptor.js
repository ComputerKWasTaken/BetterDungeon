// services/ultrascripts/ws-interceptor.js
//
// Ultrascripts page-world WebSocket shim. Runs at document-start in the MAIN world,
// BEFORE AI Dungeon's bundle constructs its Apollo subscription socket. Captures
// subscription payloads Ultrascripts cares about and forwards them to the
// content-script side via window.postMessage.
//
// Symmetrically captures session baseCredentials (GraphQL URL & Auth headers)
// from any successful GraphQL request to let the isolated world perform
// programmatic writes without relying on complex template snooping.
//

(function () {
  if (window.__ultrascriptsWsInstalled) return;
  window.__ultrascriptsWsInstalled = true;

  const NativeWebSocket = window.WebSocket;
  const ORIGIN = window.location.origin;

  const debug = {
    installed: true,
    installedAt: Date.now(),
    nativeWebSocketName: NativeWebSocket.name || 'WebSocket',
    frames: { open: 0, cards: 0, 'cards:hydrate': 0, 'cards:upsert': 0, 'cards:enrich': 0, context: 0, actions: 0, 'actions:hydrate': 0, 'adventure:change': 0, 'scenario:start': 0, hello: 0, baseCredentials: 0 },
    urls: new Set(),
    baseCredentials: null,
    cardEnrichment: Object.create(null),
    http: { fetch: { total: 0 } },
  };
  window.__Ultrascripts = window.__Ultrascripts || {};
  window.__Ultrascripts.shim = debug;

  function post(kind, payload) {
    try {
      window.postMessage({ source: 'BD_ULTRASCRIPTS_WS', kind, payload }, ORIGIN);
      if (kind in debug.frames) debug.frames[kind]++;
    } catch (err) {
      console.warn('[Ultrascripts/ws-interceptor] postMessage failed', err);
    }
  }

  class UltrascriptsWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);

      const urlStr = typeof url === 'string'
        ? url
        : (url && typeof url.toString === 'function' ? url.toString() : '');

      const isGraphQL = urlStr.includes('graphql');

      if (urlStr) debug.urls.add(urlStr);
      if (isGraphQL) post('open', { url: urlStr });

      this.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type !== 'next' && msg.type !== 'data') return;

        const data = msg.payload?.data ?? msg.data;
        if (!data || typeof data !== 'object') return;

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

  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    if (NativeWebSocket[key] !== undefined) {
      UltrascriptsWebSocket[key] = NativeWebSocket[key];
    }
  }

  window.WebSocket = UltrascriptsWebSocket;

  // ---------- Helpers for general credentials capture ----------

  function snapshotHeaders(headersInit) {
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

  function updateBaseCredentials(url, method, headers) {
    const nextHeaders = snapshotHeaders(headers);
    const getAuth = (h) => h && (h['authorization'] || h['Authorization'] || h['AUTHORIZATION']);
    const auth = getAuth(nextHeaders);
    const prevAuth = getAuth(debug.baseCredentials?.headers);
    if (!debug.baseCredentials || (auth && auth !== prevAuth)) {
      debug.baseCredentials = {
        url,
        method,
        headers: nextHeaders,
        capturedAt: Date.now()
      };
      post('baseCredentials', debug.baseCredentials);
    }
  }

  function looksLikeCard(x) {
    return x && typeof x === 'object' &&
           typeof x.id !== 'undefined' &&
           (typeof x.title === 'string' || typeof x.value === 'string');
  }
  function looksLikeCardArray(arr) {
    if (arr.length === 0) return true;
    return looksLikeCard(arr[0]);
  }
  function looksLikeAction(x) {
    if (!x || typeof x !== 'object') return false;
    if (typeof x.id !== 'string' && typeof x.id !== 'number') return false;
    return typeof x.text === 'string' || typeof x.type === 'string' || 'undoneAt' in x;
  }
  function looksLikeActionArray(arr) {
    if (arr.length === 0) return false;
    return looksLikeAction(arr[0]);
  }

  function harvestEnrichment(cardLike) {
    const id = cardLike.id;
    const prev = debug.cardEnrichment[id] || {};
    const next = {
      ...prev,
      ...(typeof cardLike.shortId === 'string' ? { shortId: cardLike.shortId } : {}),
      ...(typeof cardLike.contentType === 'string' ? { contentType: cardLike.contentType } : {}),
    };
    const changed = Object.keys(next).some(k => next[k] !== prev[k]);
    if (!changed) return;
    debug.cardEnrichment[id] = next;
    post('cards:enrich', { id, ...next });
  }

  // ---------- scan responses ----------

  function scanAndForwardScenarioStart(root) {
    const items = Array.isArray(root) ? root : [root];
    for (const item of items) {
      const scenario = item?.data?.scenario;
      if (!scenario || typeof scenario !== 'object') continue;
      if (typeof scenario.shortId !== 'string' || typeof scenario.id === 'undefined') continue;
      if (!('state' in scenario) || !('options' in scenario) || !('storyCards' in scenario)) continue;
      post('scenario:start', scenario);
    }
  }

  // Scans response trees for story cards or other entities
  function scanAndForwardCards(root, maxDepth = 6) {
    if (!root || typeof root !== 'object') return;
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

      if (Array.isArray(node.storyCards) && looksLikeCardArray(node.storyCards)) {
        const advId = typeof node.adventureId === 'string' ? node.adventureId : undefined;
        post('cards:hydrate', advId ? { storyCards: node.storyCards, adventureId: advId }
                                    : { storyCards: node.storyCards });
      }
      if (node.storyCard && typeof node.storyCard === 'object' && looksLikeCard(node.storyCard)) {
        post('cards:upsert', { storyCards: [node.storyCard] });
      }

      const actionArr = Array.isArray(node.actions) ? node.actions
                      : Array.isArray(node.actionWindow) ? node.actionWindow
                      : null;
      if (actionArr && looksLikeActionArray(actionArr)) {
        post('actions:hydrate', { actions: actionArr });
      }

      const hasAdvId = typeof node.adventureId === 'string' ? node.adventureId
                     : (typeof node.id === 'string' && (Array.isArray(node.storyCards) || actionArr) ? node.id : null);
      if (!adventureEmitted && hasAdvId) {
        const shortId = typeof node.shortId === 'string' ? node.shortId
                      : (typeof node.publicId === 'string' ? node.publicId : null);
        post('adventure:change', { adventureId: hasAdvId, shortId });
        adventureEmitted = true;
      }

      if (inCardScope && (typeof node.id === 'string' || typeof node.id === 'number') &&
          (typeof node.shortId === 'string' || typeof node.contentType === 'string')) {
        const normId = typeof node.id === 'string' ? node.id : String(node.id);
        harvestEnrichment({ ...node, id: normId });
      }

      for (const k of Object.keys(node)) {
        const v = node[k];
        if (!v || typeof v !== 'object') continue;
        const childScope = inCardScope || k === 'storyCard' || k === 'storyCards';
        stack.push({ node: v, depth: depth + 1, inCardScope: childScope });
      }
    }
  }

  // ---------- fetch shim ----------

  const NativeFetch = window.fetch;
  window.fetch = function ultrascriptsFetch(input, init) {
    debug.http.fetch.total = (debug.http.fetch.total || 0) + 1;
    const url = typeof input === 'string' ? input : (input?.url || '');
    const isGraphQL = typeof url === 'string' && url.includes('/graphql');
    if (!isGraphQL) return NativeFetch.call(this, input, init);

    const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();

    const promise = NativeFetch.call(this, input, init);
    return promise.then(async (response) => {
      if (!response.ok) return response;
      try {
        const cloned = response.clone();
        const respText = await cloned.text();
        let respJson = null;
        try { respJson = JSON.parse(respText); } catch { /* non-JSON */ }

        if (respJson) {
          scanAndForwardScenarioStart(respJson);
          scanAndForwardCards(respJson);
          updateBaseCredentials(url, method, init?.headers);
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn('[Ultrascripts/ws-interceptor] fetch post-processing failed', err);
        }
      }
      return response;
    }).catch((err) => {
      throw err;
    });
  };

  // ---------- XMLHttpRequest shim ----------

  const XHRProto = XMLHttpRequest.prototype;
  const nativeXHROpen = XHRProto.open;
  const nativeXHRSend = XHRProto.send;
  const nativeXHRSetHeader = XHRProto.setRequestHeader;

  XHRProto.open = function ultrascriptsXHROpen(method, url, ...rest) {
    this.__ultrascripts = {
      method: typeof method === 'string' ? method.toUpperCase() : 'GET',
      url: typeof url === 'string' ? url : (url && url.toString ? url.toString() : ''),
      headers: Object.create(null),
    };
    return nativeXHROpen.call(this, method, url, ...rest);
  };

  XHRProto.setRequestHeader = function ultrascriptsXHRSetHeader(name, value) {
    if (this.__ultrascripts) this.__ultrascripts.headers[name] = value;
    return nativeXHRSetHeader.call(this, name, value);
  };

  XHRProto.send = function ultrascriptsXHRSend(body) {
    const meta = this.__ultrascripts;
    if (!meta) return nativeXHRSend.call(this, body);

    const isGraphQL = meta.url.includes('/graphql') || meta.url.includes('graphql');
    if (isGraphQL) {
      const xhr = this;
      const onDone = () => {
        if (xhr.readyState !== 4) return;
        xhr.removeEventListener('readystatechange', onDone);
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          let respJson = null;
          try { respJson = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
          if (respJson) {
            scanAndForwardScenarioStart(respJson);
            scanAndForwardCards(respJson);
            updateBaseCredentials(meta.url, meta.method, meta.headers);
          }
        } catch (err) {
          console.warn('[Ultrascripts/ws-interceptor] XHR post-processing failed', err);
        }
      };
      this.addEventListener('readystatechange', onDone);
    }

    return nativeXHRSend.call(this, body);
  };

  post('hello', { t: Date.now() });
})();
