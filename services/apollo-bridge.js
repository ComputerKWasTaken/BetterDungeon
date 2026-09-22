// services/apollo-bridge.js
//
// Page-world Apollo cache bridge. The isolated extension world cannot access
// React fibers or the page's Apollo client, so this file exposes only bounded,
// structured-cloneable operations over window.postMessage.
//
// readAdventure returns { adventure, state, storyCards, actions }. The
// adventure and state copies omit their unresolved storyCards ref arrays;
// resolved cards are provided in the top-level storyCards array.

(function () {
  'use strict';

  if (window.__bdApolloBridgeInstalled) return;
  window.__bdApolloBridgeInstalled = true;

  const SOURCE_REQUEST = 'BD_APOLLO_REQ';
  const SOURCE_RESPONSE = 'BD_APOLLO_RES';
  const ORIGIN = window.location?.origin || '';
  const MAX_FIBERS = 50000;
  const EXTRACT_TTL_MS = 25;
  const ALLOWED_OPS = new Set([
    'status',
    'readEntity',
    'readAdventure',
    'modifyEntity',
    'evictEntity',
    'refetchActive',
  ]);

  const state = {
    client: null,
    root: null,
    rootKey: '',
    href: '',
    extract: null,
    extractAt: 0,
  };

  function unavailable(message = 'Apollo client unavailable') {
    return { code: 'unavailable', message };
  }

  function plain(value) {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function rootInfo() {
    const root = document.getElementById('__next');
    if (!root) return { root: null, key: '' };
    const key = Object.keys(root).find((name) =>
      name.startsWith('__reactContainer') || name.startsWith('__reactFiber')
    ) || '';
    return { root, key };
  }

  function findClient(root, key) {
    if (!root || !key) return null;
    const start = root[key];
    if (!start || typeof start !== 'object') return null;
    const stack = [start];
    const seen = new Set();
    let visited = 0;
    while (stack.length && visited < MAX_FIBERS) {
      const fiber = stack.pop();
      if (!fiber || typeof fiber !== 'object' || seen.has(fiber)) continue;
      seen.add(fiber);
      visited++;
      const candidates = [
        fiber.memoizedProps?.value?.client,
        fiber.memoizedProps?.client,
      ];
      for (const candidate of candidates) {
        if (candidate?.cache && candidate?.queryManager) return candidate;
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
  }

  function invalidateExtract() {
    state.extract = null;
    state.extractAt = 0;
  }

  function discover(force = false) {
    try {
      const info = rootInfo();
      const href = window.location?.href || '';
      const changed = force || info.root !== state.root || info.key !== state.rootKey || href !== state.href;
      if (!changed && state.client) return state.client;
      state.root = info.root;
      state.rootKey = info.key;
      state.href = href;
      state.client = findClient(info.root, info.key);
      invalidateExtract();
      return state.client;
    } catch {
      state.client = null;
      invalidateExtract();
      return null;
    }
  }

  function getClient() {
    try {
      return discover(false);
    } catch {
      return discover(true);
    }
  }

  function getExtract() {
    const client = getClient();
    if (!client) return null;
    const now = Date.now();
    if (state.extract && now - state.extractAt <= EXTRACT_TTL_MS) return state.extract;
    try {
      state.extract = client.cache.extract();
      state.extractAt = now;
      return state.extract;
    } catch {
      state.client = null;
      invalidateExtract();
      return null;
    }
  }

  function entityKey(typename, id) {
    return `${String(typename)}:${String(id)}`;
  }

  function readEntity(payload, extract) {
    const typename = payload?.typename;
    const id = payload?.id;
    if (!typename || id === undefined || id === null) {
      return { error: { code: 'invalid_args', message: 'typename and id are required' } };
    }
    const record = extract?.[entityKey(typename, id)];
    if (!record) return { error: { code: 'not_found', message: 'Entity not found' } };
    if (!Array.isArray(payload.fields) || payload.fields.length === 0) {
      return { data: plain(record) };
    }
    const filtered = { __typename: record.__typename || String(typename) };
    for (const field of payload.fields) {
      if (typeof field === 'string' && Object.prototype.hasOwnProperty.call(record, field)) {
        filtered[field] = record[field];
      }
    }
    return { data: plain(filtered) };
  }

  function resolveRef(value, extract) {
    if (value && typeof value === 'object' && typeof value.__ref === 'string') {
      return extract[value.__ref] || null;
    }
    return value;
  }

  function readAdventure(payload, extract) {
    const shortId = typeof payload?.shortId === 'string' ? payload.shortId : '';
    if (!shortId) return { error: { code: 'invalid_args', message: 'shortId is required' } };
    const root = extract?.ROOT_QUERY;
    const ref = root?.[`adventure(${JSON.stringify({ shortId })})`];
    const adventureKey = ref?.__ref;
    const adventure = adventureKey ? extract[adventureKey] : null;
    if (!adventure) return { error: { code: 'not_found', message: 'Adventure not found' } };

    const cards = [];
    const cardKeys = new Set();
    const collectCards = (items) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const key = item?.__ref;
        if (!key || cardKeys.has(key)) continue;
        cardKeys.add(key);
        const card = extract[key];
        if (card) cards.push(plain(card));
      }
    };
    collectCards(adventure.storyCards);
    collectCards(adventure.state?.storyCards);

    const adventureId = String(adventure.id);
    const actions = Object.entries(extract)
      .filter(([key, value]) => key.startsWith('Action:') && String(value?.adventureId) === adventureId)
      .map(([, value]) => ({
        id: value.id,
        text: value.text,
        type: value.type,
        undoneAt: value.undoneAt,
        createdAt: value.createdAt,
      }))
      .sort((left, right) => Number(left.id) - Number(right.id));

    const adventureCopy = plain(adventure) || {};
    const stateCopy = plain(adventure.state) || {};
    delete adventureCopy.storyCards;
    delete stateCopy.storyCards;
    return {
      data: {
        adventure: adventureCopy,
        state: stateCopy,
        storyCards: cards,
        actions: plain(actions) || [],
      },
    };
  }

  async function execute(op, payload) {
    if (!ALLOWED_OPS.has(op)) return { error: { code: 'unknown_op', message: `Unsupported Apollo operation: ${op}` } };
    const client = getClient();
    if (!client) return { error: unavailable() };
    if (op === 'status') {
      const extract = getExtract();
      return { data: { available: !!extract, recordCount: extract ? Object.keys(extract).length : 0 } };
    }
    if (op === 'readEntity') {
      const result = readEntity(payload, getExtract());
      return result;
    }
    if (op === 'readAdventure') {
      return readAdventure(payload, getExtract());
    }
    if (op === 'modifyEntity') {
      const typename = payload?.typename;
      const id = payload?.id;
      const fields = payload?.fields;
      if (!typename || id === undefined || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return { error: { code: 'invalid_args', message: 'typename, id, and fields are required' } };
      }
      const fieldValues = {};
      for (const [field, value] of Object.entries(fields)) fieldValues[field] = () => plain(value);
      const changed = client.cache.modify({ id: entityKey(typename, id), fields: fieldValues });
      invalidateExtract();
      return { data: { changed: !!changed } };
    }
    if (op === 'evictEntity') {
      const typename = payload?.typename;
      const id = payload?.id;
      if (!typename || id === undefined) {
        return { error: { code: 'invalid_args', message: 'typename and id are required' } };
      }
      const evicted = client.cache.evict({ id: entityKey(typename, id) });
      if (payload.gc === true && typeof client.cache.gc === 'function') client.cache.gc();
      invalidateExtract();
      return { data: { evicted: !!evicted } };
    }
    if (op === 'refetchActive') {
      if (typeof client.refetchQueries === 'function') {
        await client.refetchQueries({ include: 'active' });
      } else if (typeof client.queryManager?.refetchObservableQueries === 'function') {
        await client.queryManager.refetchObservableQueries({ include: 'active' });
      } else {
        return { error: { code: 'unsupported', message: 'Active query refetch is unavailable' } };
      }
      invalidateExtract();
      return { data: { refetched: true } };
    }
    return { error: { code: 'unknown_op', message: `Unsupported Apollo operation: ${op}` } };
  }

  function response(id, result) {
    const message = { source: SOURCE_RESPONSE, id, ok: !result.error };
    if (result.error) message.error = plain(result.error);
    else message.data = plain(result.data);
    return message;
  }

  window.__BD_APOLLO_BRIDGE__ = {
    request(op, payload) {
      return execute(op, payload).then((result) => {
        if (result.error) return { ok: false, error: plain(result.error) };
        return { ok: true, data: plain(result.data) };
      }).catch((error) => ({ ok: false, error: { code: 'unavailable', message: String(error?.message || error) } }));
    },
  };

  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window || event.origin !== ORIGIN) return;
      const message = event.data;
      if (!message || message.source !== SOURCE_REQUEST || !message.id || typeof message.op !== 'string') return;
      Promise.resolve(execute(message.op, message.payload)).then((result) => {
        window.postMessage(response(message.id, result), ORIGIN);
      }).catch((error) => {
        window.postMessage(response(message.id, { error: unavailable(String(error?.message || error)) }), ORIGIN);
      });
    } catch {
      // The bridge must never throw into the host page.
    }
  }, false);
}());
