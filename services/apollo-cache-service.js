// services/apollo-cache-service.js

(function () {
  'use strict';

  if (window.BetterDungeonApolloCache) return;

  const REQUEST_SOURCE = 'BD_APOLLO_REQ';
  const RESPONSE_SOURCE = 'BD_APOLLO_RES';
  const ORIGIN = window.location?.origin || '';
  const TIMEOUT_MS = Number(window.__BD_APOLLO_CACHE_TIMEOUT_MS) || 2200;
  let requestCounter = 0;
  const pending = new Map();

  function unavailable(message = 'Apollo client unavailable') {
    return { available: false, data: null, error: { code: 'unavailable', message } };
  }

  function installListener() {
    if (window.__bdApolloCacheListenerInstalled) return;
    window.__bdApolloCacheListenerInstalled = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== ORIGIN) return;
      const message = event.data;
      if (!message || message.source !== RESPONSE_SOURCE || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timeoutId);
      entry.resolve(message.ok
        ? { available: true, data: message.data, error: null }
        : { available: false, data: null, error: message.error || { code: 'unavailable', message: 'Apollo request failed' } });
    }, false);
  }

  function request(op, payload) {
    const direct = window.__BD_APOLLO_BRIDGE__;
    if (direct && typeof direct.request === 'function') {
      return Promise.resolve(direct.request(op, payload)).then((result) => {
        if (result?.ok) return { available: true, data: result.data, error: null };
        return unavailable(result?.error?.message);
      }).catch((error) => unavailable(error?.message));
    }
    if (typeof window.postMessage !== 'function' || typeof window.addEventListener !== 'function') {
      return Promise.resolve(unavailable('Apollo relay unavailable'));
    }
    installListener();
    const id = `bd-apollo-${++requestCounter}`;
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pending.delete(id);
        resolve(unavailable('Apollo request timed out'));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, timeoutId });
      try {
        window.postMessage({ source: REQUEST_SOURCE, id, op, payload }, ORIGIN);
      } catch (error) {
        clearTimeout(timeoutId);
        pending.delete(id);
        resolve(unavailable(error?.message));
      }
    });
  }

  function dataResult(result, fallback = null) {
    return result.available
      ? result.data
      : { available: false, data: fallback, error: result.error };
  }

  window.BetterDungeonApolloCache = {
    isAvailable() {
      return this.status().then((result) => result.available === true);
    },
    status() {
      return request('status').then((result) => result.available
        ? { available: result.data?.available === true, recordCount: result.data?.recordCount || 0, error: null }
        : { available: false, recordCount: 0, error: result.error });
    },
    readEntity(payload) {
      return request('readEntity', payload).then((result) => dataResult(result));
    },
    readAdventure(payload) {
      return request('readAdventure', payload).then((result) => dataResult(result));
    },
    modifyEntity(payload) {
      return request('modifyEntity', payload).then((result) => dataResult(result, { changed: false }));
    },
    evictEntity(payload) {
      return request('evictEntity', payload).then((result) => dataResult(result, { evicted: false }));
    },
    refetchActive() {
      return request('refetchActive').then((result) => dataResult(result, { refetched: false }));
    },
  };
}());
