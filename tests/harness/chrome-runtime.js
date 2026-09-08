'use strict';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorageArea(initial = {}) {
  const values = new Map(Object.entries(clone(initial)));
  const select = keys => {
    if (keys == null) return Object.fromEntries(values);
    if (typeof keys === 'string') return values.has(keys) ? { [keys]: clone(values.get(keys)) } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => values.has(key)).map(key => [key, clone(values.get(key))]));
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, values.has(key) ? clone(values.get(key)) : fallback]));
  };
  return {
    get(keys, callback) {
      const result = select(keys);
      callback?.(result);
      return callback ? undefined : Promise.resolve(result);
    },
    set(items, callback) {
      Object.entries(clone(items)).forEach(([key, value]) => values.set(key, value));
      callback?.();
      return callback ? undefined : Promise.resolve();
    },
    remove(keys, callback) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
      callback?.();
      return callback ? undefined : Promise.resolve();
    },
    clear(callback) {
      values.clear();
      callback?.();
      return callback ? undefined : Promise.resolve();
    },
    snapshot: () => clone(Object.fromEntries(values)),
  };
}

function createEvent() {
  const listeners = new Set();
  return {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    hasListener: listener => listeners.has(listener),
    emit: (...args) => [...listeners].forEach(listener => listener(...args)),
    listenerCount: () => listeners.size,
  };
}

function createChromeRuntime({ local = {}, sync = {}, permissions = [] } = {}) {
  const onMessage = createEvent();
  const onConnect = createEvent();
  const granted = new Set(permissions);
  return {
    runtime: {
      id: 'betterdungeon-test',
      lastError: null,
      onMessage,
      onConnect,
      sendMessage(message, callback) {
        let response;
        onMessage.emit(message, { id: 'test-sender' }, value => { response = value; callback?.(value); });
        return callback ? undefined : Promise.resolve(response);
      },
    },
    storage: {
      local: createStorageArea(local),
      sync: createStorageArea(sync),
      onChanged: createEvent(),
    },
    permissions: {
      contains(request, callback) {
        const result = (request.permissions || []).every(value => granted.has(value));
        callback?.(result);
        return callback ? undefined : Promise.resolve(result);
      },
      request(request, callback) {
        (request.permissions || []).forEach(value => granted.add(value));
        callback?.(true);
        return callback ? undefined : Promise.resolve(true);
      },
    },
  };
}

module.exports = { createChromeRuntime, createEvent, createStorageArea };
