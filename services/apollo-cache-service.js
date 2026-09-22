// services/apollo-cache-service.js
//
// Public API envelope: every operation except isAvailable() resolves to
// { available, data, error }. Successful payloads are always in data and
// have error === null; unavailable operations retain a safe fallback in data.

(function () {
  'use strict';

  if (window.BetterDungeonApolloCache) return;

  const REQUEST_SOURCE = 'BD_APOLLO_REQ';
  const RESPONSE_SOURCE = 'BD_APOLLO_RES';
  const ORIGIN = window.location?.origin || '';
  const TIMEOUT_MS = Number(window.__BD_APOLLO_CACHE_TIMEOUT_MS) || 2200;
  const NEGATIVE_CACHE_MS = 3000;
  const NO_BRIDGE = {};
  let requestCounter = 0;
  let unavailableUntil = 0;
  let unavailableHref = window.location?.href || '';
  let unavailableBridge = null;
  let hasNegativeCache = false;
  const pending = new Map();

  function unavailable(message = 'Apollo client unavailable') {
    return { available: false, data: null, error: { code: 'unavailable', message } };
  }

  function clearNegativeCache() {
    unavailableUntil = 0;
    unavailableBridge = null;
    hasNegativeCache = false;
  }

  function negativeCacheResult() {
    const href = window.location?.href || '';
    if (href !== unavailableHref) {
      unavailableHref = href;
      clearNegativeCache();
    }
    const currentBridge = window.__BD_APOLLO_BRIDGE__ || NO_BRIDGE;
    if (hasNegativeCache && currentBridge !== unavailableBridge) clearNegativeCache();
    if (!hasNegativeCache) return null;
    return Date.now() < unavailableUntil ? unavailable('Apollo client unavailable (cached)') : null;
  }

  function recordResult(result, bridge = NO_BRIDGE) {
    if (result.available) clearNegativeCache();
    else if (result.error?.code === 'unavailable') {
      unavailableUntil = Date.now() + NEGATIVE_CACHE_MS;
      unavailableBridge = bridge;
      hasNegativeCache = true;
    }
    return result;
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
      entry.resolve(recordResult(
        message.ok
          ? { available: true, data: message.data, error: null }
          : { available: false, data: null, error: message.error || { code: 'unavailable', message: 'Apollo request failed' } },
        entry.bridge,
      ));
    }, false);
  }

  function request(op, payload) {
    const cached = negativeCacheResult();
    if (cached) return Promise.resolve(cached);
    const direct = window.__BD_APOLLO_BRIDGE__;
    const bridge = direct || NO_BRIDGE;
    if (direct && typeof direct.request === 'function') {
      return Promise.resolve(direct.request(op, payload)).then((result) => {
        if (result?.ok) return recordResult({ available: true, data: result.data, error: null });
        return recordResult({
          available: false,
          data: null,
          error: result?.error || { code: 'unavailable', message: 'Apollo request failed' },
        }, bridge);
      }).catch((error) => recordResult(unavailable(error?.message), bridge));
    }
    if (typeof window.postMessage !== 'function' || typeof window.addEventListener !== 'function') {
      return Promise.resolve(recordResult(unavailable('Apollo relay unavailable'), bridge));
    }
    installListener();
    const id = `bd-apollo-${++requestCounter}`;
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pending.delete(id);
        resolve(recordResult(unavailable('Apollo request timed out'), bridge));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, timeoutId, bridge });
      try {
        window.postMessage({ source: REQUEST_SOURCE, id, op, payload }, ORIGIN);
      } catch (error) {
        clearTimeout(timeoutId);
        pending.delete(id);
        resolve(recordResult(unavailable(error?.message), bridge));
      }
    });
  }

  function dataResult(result, fallback = null) {
    return {
      available: result.available === true,
      data: result.available ? result.data : fallback,
      error: result.available ? null : result.error,
    };
  }

  function status() {
    return request('status').then((result) => dataResult(result, { available: false, recordCount: 0 }));
  }

  window.BetterDungeonApolloCache = {
    isAvailable() {
      return status().then((result) => result.available === true && result.data?.available === true);
    },
    status,
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
