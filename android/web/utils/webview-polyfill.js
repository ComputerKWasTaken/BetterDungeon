// BetterDungeon - WebView Polyfill
// Replaces chrome.* extension APIs with Android WebView equivalents.
//
// Storage:    Routes through @JavascriptInterface → SharedPreferences
// Runtime:    getURL() returns file:///android_asset/ paths; onMessage uses a
//             simple in-page event bus (CustomEvent on window)
// Tabs:       query() returns a fake "current tab"; sendMessage() dispatches
//             through the same event bus

(function () {
  'use strict';

  // ── Storage Change Listeners ──────────────────────────────────────
  // Track storage.onChanged listeners for cross-feature reactivity

  var storageChangeListeners = [];

  function fireStorageChanged(changes, areaName) {
    for (var i = 0; i < storageChangeListeners.length; i++) {
      try {
        storageChangeListeners[i](changes, areaName);
      } catch (err) {
        console.error('[WebView Polyfill] storage.onChanged listener error:', err);
      }
    }
  }

  // ── Storage Bridge ──────────────────────────────────────────────────
  // Uses the native BetterDungeonBridge exposed via @JavascriptInterface

  function createStorageArea(areaName) {
    return {
      get: function (keys, callback) {
        function doGet() {
          // Normalise keys to an array
          var keyList;
          if (typeof keys === 'string') {
            keyList = [keys];
          } else if (Array.isArray(keys)) {
            keyList = keys;
          } else if (keys === null || keys === undefined) {
            // Get everything
            keyList = null;
          } else if (typeof keys === 'object') {
            keyList = Object.keys(keys);
          } else {
            keyList = [];
          }

          var result = {};

          if (keyList === null) {
            // Get all stored data
            var allDataJson = window.BetterDungeonBridge.storageGetAll();
            try {
              result = JSON.parse(allDataJson || '{}');
            } catch (e) {
              result = {};
            }
          } else {
            for (var i = 0; i < keyList.length; i++) {
              var key = keyList[i];
              var raw = window.BetterDungeonBridge.storageGet(key);
              if (raw !== null && raw !== undefined && raw !== '') {
                try {
                  result[key] = JSON.parse(raw);
                } catch (e) {
                  result[key] = raw;
                }
              } else if (typeof keys === 'object' && !Array.isArray(keys) && keys !== null) {
                // Use default value from the keys object
                result[key] = keys[key];
              }
            }
          }

          return result;
        }

        // Support both callback style and Promise style (Manifest V3)
        if (typeof callback === 'function') {
          try {
            callback(doGet());
          } catch (err) {
            console.error('[WebView Polyfill] storage.get error:', err);
            callback({});
          }
          return;
        }

        // Return a Promise when no callback is provided
        return new Promise(function (resolve) {
          try {
            resolve(doGet());
          } catch (err) {
            console.error('[WebView Polyfill] storage.get error:', err);
            resolve({});
          }
        });
      },

      set: function (items, callback) {
        function doSet() {
          var changes = {};
          var itemKeys = Object.keys(items);
          for (var i = 0; i < itemKeys.length; i++) {
            var key = itemKeys[i];
            var newValue = items[key];

            // Read old value for onChanged notification
            var oldValue;
            try {
              var oldRaw = window.BetterDungeonBridge.storageGet(key);
              if (oldRaw !== null && oldRaw !== undefined && oldRaw !== '') {
                oldValue = JSON.parse(oldRaw);
              }
            } catch (e) { /* old value unavailable */ }

            window.BetterDungeonBridge.storageSet(key, JSON.stringify(newValue));

            changes[key] = { newValue: newValue };
            if (oldValue !== undefined) {
              changes[key].oldValue = oldValue;
            }
          }

          // Notify storage.onChanged listeners
          if (Object.keys(changes).length > 0) {
            fireStorageChanged(changes, areaName);
          }
        }

        // Support both callback style and Promise style (Manifest V3)
        if (typeof callback === 'function') {
          try {
            doSet();
            callback();
          } catch (err) {
            console.error('[WebView Polyfill] storage.set error:', err);
            callback();
          }
          return;
        }

        // Return a Promise when no callback is provided
        return new Promise(function (resolve) {
          try {
            doSet();
            resolve();
          } catch (err) {
            console.error('[WebView Polyfill] storage.set error:', err);
            resolve();
          }
        });
      },

      remove: function (keys, callback) {
        function doRemove() {
          var keyList = typeof keys === 'string' ? [keys] : keys;
          for (var i = 0; i < keyList.length; i++) {
            window.BetterDungeonBridge.storageRemove(keyList[i]);
          }
        }

        // Support both callback style and Promise style (Manifest V3)
        if (typeof callback === 'function') {
          try {
            doRemove();
            callback();
          } catch (err) {
            console.error('[WebView Polyfill] storage.remove error:', err);
            callback();
          }
          return;
        }

        // Return a Promise when no callback is provided
        return new Promise(function (resolve) {
          try {
            doRemove();
            resolve();
          } catch (err) {
            console.error('[WebView Polyfill] storage.remove error:', err);
            resolve();
          }
        });
      }
    };
  }

  // ── Message Bus ─────────────────────────────────────────────────────
  // In-page event bus replacing chrome.runtime.onMessage / chrome.tabs.sendMessage

  var messageListeners = [];
  var connectListeners = [];

  var onMessageAPI = {
    addListener: function (listener) {
      if (typeof listener === 'function' && messageListeners.indexOf(listener) === -1) {
        messageListeners.push(listener);
      }
    },
    removeListener: function (listener) {
      var idx = messageListeners.indexOf(listener);
      if (idx !== -1) {
        messageListeners.splice(idx, 1);
      }
    },
    hasListener: function (listener) {
      return messageListeners.indexOf(listener) !== -1;
    }
  };

  function dispatchMessage(message, sender) {
    sender = sender || { id: 'betterdungeon-android' };

    for (var i = 0; i < messageListeners.length; i++) {
      try {
        var sendResponse = (function () {
          var called = false;
          return function (response) {
            if (!called) {
              called = true;
              // Store for popup retrieval
              window.__bdLastResponse = response;
            }
          };
        })();

        var result = messageListeners[i](message, sender, sendResponse);

        // If listener returns true, it will call sendResponse asynchronously
        if (result === true) {
          // The listener will call sendResponse later
        }
      } catch (err) {
        console.error('[WebView Polyfill] Message listener error:', err);
      }
    }
  }

  // ── Build the polyfilled chrome object ──────────────────────────────

  var syncStorageArea = createStorageArea('sync');
  var localStorageArea = createStorageArea('local');

  var AI_MESSAGE = 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE';
  var AI_DEFAULT_TIMEOUT_MS = 120000;
  var WEBFETCH_MESSAGE = 'ULTRASCRIPTS_WEBFETCH_FETCH';
  var SDK_MESSAGE = 'ULTRASCRIPTS_SDK_REQUEST';
  var SDK_SYNC_STORAGE_KEYS = {
    features: 'betterDungeonFeatures',
    moduleStates: 'ultrascripts_enabled_modules',
    debug: 'ultrascripts_debug'
  };

  var onConnectAPI = {
    addListener: function (listener) {
      if (typeof listener === 'function' && connectListeners.indexOf(listener) === -1) {
        connectListeners.push(listener);
      }
    },
    removeListener: function (listener) {
      var idx = connectListeners.indexOf(listener);
      if (idx !== -1) connectListeners.splice(idx, 1);
    },
    hasListener: function (listener) {
      return connectListeners.indexOf(listener) !== -1;
    }
  };

  function createPortEvent(listeners) {
    return {
      addListener: function (listener) {
        if (typeof listener === 'function' && listeners.indexOf(listener) === -1) listeners.push(listener);
      },
      removeListener: function (listener) {
        var idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
      },
      hasListener: function (listener) {
        return listeners.indexOf(listener) !== -1;
      }
    };
  }

  function runtimeConnect(connectInfo) {
    var name = connectInfo && typeof connectInfo.name === 'string' ? connectInfo.name : '';
    var state = { disconnected: false };
    var clientMessageListeners = [];
    var clientDisconnectListeners = [];
    var runtimeMessageListeners = [];
    var runtimeDisconnectListeners = [];
    var clientPort;
    var runtimePort;

    function dispatchPortMessage(listeners, message, targetPort) {
      if (state.disconnected) return;
      var snapshot = listeners.slice();
      Promise.resolve().then(function () {
        if (state.disconnected) return;
        snapshot.forEach(function (listener) {
          try { listener(message, targetPort); }
          catch (err) { console.error('[WebView Polyfill] Port listener failed:', err); }
        });
      });
    }

    function disconnect() {
      if (state.disconnected) return;
      state.disconnected = true;
      clientDisconnectListeners.slice().forEach(function (listener) {
        try { listener(clientPort); } catch (err) { console.error('[WebView Polyfill] Port disconnect listener failed:', err); }
      });
      runtimeDisconnectListeners.slice().forEach(function (listener) {
        try { listener(runtimePort); } catch (err) { console.error('[WebView Polyfill] Port disconnect listener failed:', err); }
      });
    }

    clientPort = {
      name: name,
      error: null,
      onMessage: createPortEvent(clientMessageListeners),
      onDisconnect: createPortEvent(clientDisconnectListeners),
      postMessage: function (message) {
        if (state.disconnected) throw new Error('Attempting to use a disconnected port object');
        dispatchPortMessage(runtimeMessageListeners, message, runtimePort);
      },
      disconnect: disconnect
    };
    runtimePort = {
      name: name,
      error: null,
      sender: { id: 'betterdungeon-android' },
      onMessage: createPortEvent(runtimeMessageListeners),
      onDisconnect: createPortEvent(runtimeDisconnectListeners),
      postMessage: function (message) {
        if (state.disconnected) throw new Error('Attempting to use a disconnected port object');
        dispatchPortMessage(clientMessageListeners, message, clientPort);
      },
      disconnect: disconnect
    };

    connectListeners.slice().forEach(function (listener) {
      try { listener(runtimePort); }
      catch (err) { console.error('[WebView Polyfill] runtime.onConnect listener failed:', err); }
    });
    return clientPort;
  }
  var SDK_DEFAULT_FEATURES = {
    ultrascripts: true,
    command: true,
    try: true,
    triggerHighlight: true,
    favoriteInstructions: true,
    inputModeColor: true,
    characterPreset: true,
    autoSee: false,
    notes: true,
    inputHistory: true,
    textToSpeech: false,
    customDynamic: false,
    navigator: true
  };
  var SDK_ULTRASCRIPTS_MODULES = [
    'widget',
    'webfetch',
    'clock',
    'sdk',
    'audio',
    'weather',
    'network',
    'system',
    'ai'
  ];
  var nativeWebFetchSequence = 0;
  var nativeWebFetchPending = {};
  var nativeAiSequence = 0;
  var nativeAiPending = {};
  var geminiRuntimeState = {
    lastResolvedModel: null,
    lastProviderModel: null,
    lastResolvedAtIso: null,
    lastFallbackMode: null,
    lastAttemptedModels: []
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeRuntimeError(error) {
    if (error && typeof error === 'object') {
      return {
        code: typeof error.code === 'string' ? error.code : 'mobile_runtime_failed',
        message: typeof error.message === 'string' ? error.message : String(error),
        retryable: error.retryable === true,
        status: error.status,
        statusText: error.statusText,
        retryAfterMs: error.retryAfterMs,
        detail: error.detail,
        backend: error.backend,
        model: error.model,
        providerReason: error.providerReason
      };
    }
    return { code: 'mobile_runtime_failed', message: String(error || 'Mobile runtime request failed') };
  }

  function storageGetPromise(area, keys) {
    return Promise.resolve(area.get(keys));
  }

  function storageSetPromise(area, data) {
    return Promise.resolve(area.set(data));
  }

  function createNativeAiStream(onCancel) {
    var chunks = [];
    var waiters = [];
    var closed = false;
    var failure = null;
    var locked = false;

    function settleWaiters() {
      while (waiters.length && chunks.length) {
        waiters.shift().resolve({ done: false, value: chunks.shift() });
      }
      if (!waiters.length) return;
      if (failure) {
        while (waiters.length) waiters.shift().reject(failure);
      } else if (closed) {
        while (waiters.length) waiters.shift().resolve({ done: true, value: undefined });
      }
    }

    return {
      enqueue: function (chunk) {
        if (closed || failure) return;
        chunks.push(chunk);
        settleWaiters();
      },
      close: function () {
        if (closed || failure) return;
        closed = true;
        settleWaiters();
      },
      fail: function (error) {
        if (closed || failure) return;
        failure = error;
        settleWaiters();
      },
      body: {
        getReader: function () {
          if (locked) throw new TypeError('AI response stream is already locked');
          locked = true;
          return {
            read: function () {
              if (chunks.length) return Promise.resolve({ done: false, value: chunks.shift() });
              if (failure) return Promise.reject(failure);
              if (closed) return Promise.resolve({ done: true, value: undefined });
              return new Promise(function (resolve, reject) { waiters.push({ resolve: resolve, reject: reject }); });
            },
            cancel: function () {
              if (typeof onCancel === 'function') onCancel();
              closed = true;
              settleWaiters();
              return Promise.resolve();
            }
          };
        }
      }
    };
  }

  function decodeBase64Bytes(value) {
    var binary = atob(String(value || ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  window.__bdNativeAiTransportEvent = function (requestId, rawEvent) {
    var id = String(requestId || '');
    var pending = nativeAiPending[id];
    if (!pending) return;
    var event;
    try { event = typeof rawEvent === 'string' ? JSON.parse(rawEvent) : rawEvent; }
    catch (err) { event = { type: 'error', error: { code: 'invalid_response', message: 'Native AI transport returned invalid JSON.' } }; }

    if (event && event.type === 'response') {
      if (pending.responseStarted) return;
      pending.responseStarted = true;
      var headers = event.headers && typeof event.headers === 'object' ? event.headers : {};
      var response = {
        status: Number(event.status || 0),
        statusText: String(event.statusText || ''),
        headers: {
          get: function (name) { return headers[String(name || '').toLowerCase()] || null; }
        },
        body: pending.stream.body,
        text: async function () {
          var reader = pending.stream.body.getReader();
          var decoder = new TextDecoder('utf-8');
          var text = '';
          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            text += decoder.decode(chunk.value, { stream: true });
          }
          return text + decoder.decode();
        }
      };
      response.ok = response.status >= 200 && response.status < 300;
      response.json = async function () { return JSON.parse(await response.text()); };
      pending.resolve(response);
      return;
    }
    if (event && event.type === 'chunk') {
      try { pending.stream.enqueue(decodeBase64Bytes(event.data)); }
      catch (err) { pending.stream.fail(err); }
      return;
    }
    if (event && event.type === 'complete') {
      pending.stream.close();
      pending.cleanup();
      delete nativeAiPending[id];
      return;
    }
    if (event && event.type === 'error') {
      var error = normalizeRuntimeError(event.error || { code: 'network_failed', message: 'Native AI transport failed.' });
      if (!pending.responseStarted) pending.reject(error);
      else pending.stream.fail(error);
      pending.cleanup();
      delete nativeAiPending[id];
    }
  };

  function nativeAiFetch(url, options) {
    options = options || {};
    if (!window.BetterDungeonBridge || typeof window.BetterDungeonBridge.aiFetch !== 'function') {
      return Promise.reject({ code: 'unavailable', message: 'Native AI transport is unavailable.', retryable: true });
    }
    if (options.signal && options.signal.aborted) {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    }
    var requestId = 'ai-' + Date.now().toString(36) + '-' + (++nativeAiSequence).toString(36);
    return new Promise(function (resolve, reject) {
      var abortHandler = function () {
        try { window.BetterDungeonBridge.aiCancel(requestId); } catch (e) { /* noop */ }
        var pending = nativeAiPending[requestId];
        if (!pending) return;
        var error = new DOMException('The operation was aborted.', 'AbortError');
        if (!pending.responseStarted) pending.reject(error);
        else pending.stream.fail(error);
        pending.cleanup();
        delete nativeAiPending[requestId];
      };
      var stream = createNativeAiStream(function () {
        try { window.BetterDungeonBridge.aiCancel(requestId); } catch (e) { /* noop */ }
      });
      var cleanup = function () {
        try { options.signal && options.signal.removeEventListener('abort', abortHandler); } catch (e) { /* noop */ }
      };
      nativeAiPending[requestId] = {
        resolve: resolve,
        reject: reject,
        stream: stream,
        responseStarted: false,
        cleanup: cleanup
      };
      if (options.signal) options.signal.addEventListener('abort', abortHandler, { once: true });
      try {
        window.BetterDungeonBridge.aiFetch(JSON.stringify({
          url: String(url || ''),
          method: String(options.method || 'POST'),
          headers: options.headers || {},
          body: options.body === undefined ? '' : String(options.body),
          timeoutMs: AI_DEFAULT_TIMEOUT_MS
        }), requestId);
      } catch (err) {
        cleanup();
        delete nativeAiPending[requestId];
        reject({ code: 'unavailable', message: err && err.message ? err.message : 'Native AI transport could not start.', retryable: true });
      }
    });
  }

  window.__bdNativeAiFetch = nativeAiFetch;

  function handleWebFetch(request) {
    request = request || {};
    if (!window.BetterDungeonBridge || typeof window.BetterDungeonBridge.webFetch !== 'function') {
      return Promise.reject({ code: 'webfetch_unavailable', message: 'Native WebFetch bridge is unavailable.' });
    }

    var requestId = 'webfetch-' + Date.now().toString(36) + '-' + (++nativeWebFetchSequence).toString(36);
    var requestedTimeoutMs = Number(request.timeoutMs);
    var timeoutMs = Number.isFinite(requestedTimeoutMs)
      ? Math.max(1000, Math.min(requestedTimeoutMs, 30000))
      : 15000;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete nativeWebFetchPending[requestId];
        reject({ code: 'timeout', message: 'WebFetch request timed out.' });
      }, timeoutMs + 1000);
      nativeWebFetchPending[requestId] = { resolve: resolve, reject: reject, timer: timer };

      try {
        window.BetterDungeonBridge.webFetch(JSON.stringify(request), requestId);
      } catch (error) {
        clearTimeout(timer);
        delete nativeWebFetchPending[requestId];
        reject({ code: 'webfetch_unavailable', message: (error && error.message) || 'Native WebFetch bridge failed.' });
      }
    });
  }

  async function handleSdk(request) {
    request = request || {};
    var op = String(request.op || '').trim();
    if (op !== 'config') throw { code: 'invalid_args', message: "SDK op '" + (op || '(empty)') + "' is not supported" };
    var sync = await storageGetPromise(syncStorageArea, Object.keys(SDK_SYNC_STORAGE_KEYS).map(function (k) {
      return SDK_SYNC_STORAGE_KEYS[k];
    }));
    var savedFeatures = isObject(sync[SDK_SYNC_STORAGE_KEYS.features]) ? sync[SDK_SYNC_STORAGE_KEYS.features] : {};
    var savedModules = isObject(sync[SDK_SYNC_STORAGE_KEYS.moduleStates]) ? sync[SDK_SYNC_STORAGE_KEYS.moduleStates] : {};
    var features = Object.assign({}, SDK_DEFAULT_FEATURES, savedFeatures);
    var modulePreferences = {};
    SDK_ULTRASCRIPTS_MODULES.forEach(function (moduleId) {
      modulePreferences[moduleId] = savedModules[moduleId] !== false;
    });
    return {
      features: features,
      ultrascripts: {
        debug: sync[SDK_SYNC_STORAGE_KEYS.debug] === true,
        modulePreferences: modulePreferences
      }
    };
  }

  function handleRuntimeMessage(message) {
    if (!message || typeof message !== 'object') return null;
    if (message.type === AI_MESSAGE && window.__bdAiRuntime?.handle) {
      return window.__bdAiRuntime.handle(message.request);
    }
    if (message.type === WEBFETCH_MESSAGE) return handleWebFetch(message.request);
    if (message.type === SDK_MESSAGE) return handleSdk(message.request);
    return null;
  }

  function runtimeSendMessage(message, callback) {
    var handled = handleRuntimeMessage(message);
    polyfilledChrome.runtime.lastError = undefined;
    if (handled) {
      return Promise.resolve(handled)
        .then(function (data) {
          var response = { ok: true, data: data };
          polyfilledChrome.runtime.lastError = undefined;
          if (typeof callback === 'function') callback(response);
          return response;
        })
        .catch(function (error) {
          var response = { ok: false, error: normalizeRuntimeError(error) };
          polyfilledChrome.runtime.lastError = undefined;
          if (typeof callback === 'function') callback(response);
          return response;
        });
    }
    window.__bdLastResponse = undefined;
    dispatchMessage(message, { id: 'betterdungeon-android' });
    return new Promise(function (resolve) {
      setTimeout(function () {
        var response = window.__bdLastResponse;
        if (typeof callback === 'function') callback(response);
        resolve(response);
      }, 50);
    });
  }

  function getAppVersion() {
    try {
      if (window.BetterDungeonBridge &&
          typeof window.BetterDungeonBridge.getAppVersion === 'function') {
        var version = window.BetterDungeonBridge.getAppVersion();
        if (version) return String(version);
      }
    } catch (e) {
      console.warn('[WebView Polyfill] Failed to get app version:', e);
    }
    return '0.0.0';
  }

  var polyfilledChrome = {
    runtime: {
      id: 'betterdungeon-android',
      lastError: undefined,
      getManifest: function () {
        return {
          name: 'BetterDungeon',
          version: getAppVersion()
        };
      },
      getURL: function (path) {
        // In the main WebView (https:// origin), file:/// URLs are blocked
        // by the browser security model. For image assets, use the native
        // bridge to return a base64 data URI instead.
        if (window.location.protocol === 'https:' &&
            window.BetterDungeonBridge &&
            typeof window.BetterDungeonBridge.getAssetDataUri === 'function' &&
            /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(path)) {
          try {
            var dataUri = window.BetterDungeonBridge.getAssetDataUri(path);
            if (dataUri) return dataUri;
          } catch (e) {
            console.warn('[WebView Polyfill] Failed to get data URI for:', path);
          }
        }
        return 'file:///android_asset/betterdungeon/' + path;
      },
      sendMessage: function (messageOrExtensionId, messageOrCallback, optionsOrCallback, maybeCallback) {
        var message = typeof messageOrExtensionId === 'string' ? messageOrCallback : messageOrExtensionId;
        var callback = typeof messageOrCallback === 'function'
          ? messageOrCallback
          : (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback);
        return runtimeSendMessage(message, callback);
      },
      connect: runtimeConnect,
      onConnect: onConnectAPI,
      onMessage: onMessageAPI
    },
    storage: {
      sync: syncStorageArea,
      local: localStorageArea,
      onChanged: {
        addListener: function (listener) {
          if (typeof listener === 'function' && storageChangeListeners.indexOf(listener) === -1) {
            storageChangeListeners.push(listener);
          }
        },
        removeListener: function (listener) {
          var idx = storageChangeListeners.indexOf(listener);
          if (idx !== -1) {
            storageChangeListeners.splice(idx, 1);
          }
        },
        hasListener: function (listener) {
          return storageChangeListeners.indexOf(listener) !== -1;
        }
      }
    },
    tabs: {
      query: function (queryInfo, callback) {
        // Always return a fake "current tab"
        var fakeTabs = [{
          id: 1,
          url: window.location.href,
          active: true,
          currentWindow: true
        }];
        if (typeof callback === 'function') {
          callback(fakeTabs);
        }
        return Promise.resolve(fakeTabs);
      },
      sendMessage: function (tabId, message, callbackOrOptions, maybeCallback) {
        var callback = typeof callbackOrOptions === 'function' ? callbackOrOptions : maybeCallback;

        // Reset last response
        window.__bdLastResponse = undefined;

        // Dispatch the message through the event bus
        dispatchMessage(message, { id: 'betterdungeon-android', tab: { id: tabId } });

        // Return a Promise and invoke the callback when ready
        return new Promise(function (resolve) {
          setTimeout(function () {
            var response = window.__bdLastResponse;
            if (typeof callback === 'function') {
              callback(response);
            }
            resolve(response);
          }, 50);
        });
      },
      create: function (props, callback) {
        // Open URL in system browser
        if (props && props.url) {
          try {
            window.BetterDungeonBridge.openExternalUrl(props.url);
          } catch (e) {
            window.open(props.url, '_blank');
          }
        }
        if (typeof callback === 'function') {
          callback({ id: 2, url: props ? props.url : '' });
        }
      }
    }
  };

  // Install the polyfill
  try {
    Object.defineProperty(globalThis, 'chrome', {
      value: polyfilledChrome,
      writable: true,
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    try {
      globalThis.chrome = polyfilledChrome;
    } catch (e2) {
      window.chrome = polyfilledChrome;
    }
  }

  // Expose the in-page message dispatch function globally
  window.__bdDispatchMessage = dispatchMessage;

  // Cross-WebView dispatch: sendResponse routes back through the native bridge
  // instead of setting a global. Handles both sync and async message handlers.
  window.__bdDispatchMessageFromPopup = function (message, requestId) {
    var sender = { id: 'betterdungeon-popup' };

    var handled = handleRuntimeMessage(message);
    if (handled) {
      Promise.resolve(handled)
        .then(function (data) {
          window.BetterDungeonBridge.sendResponseToPopup(
            JSON.stringify({ ok: true, data: data }),
            requestId
          );
        })
        .catch(function (error) {
          window.BetterDungeonBridge.sendResponseToPopup(
            JSON.stringify({ ok: false, error: normalizeRuntimeError(error) }),
            requestId
          );
        });
      return;
    }

    for (var i = 0; i < messageListeners.length; i++) {
      try {
        var sendResponse = (function () {
          var called = false;
          return function (response) {
            if (!called) {
              called = true;
              try {
                window.BetterDungeonBridge.sendResponseToPopup(
                  JSON.stringify(response),
                  requestId
                );
              } catch (e) {
                console.error('[WebView Polyfill] Failed to send response to popup:', e);
              }
            }
          };
        })();

        var result = messageListeners[i](message, sender, sendResponse);
        // If listener returns true it will call sendResponse asynchronously —
        // the bridge callback handles that automatically.
      } catch (err) {
        console.error('[WebView Polyfill] Message listener error:', err);
      }
    }
  };

  console.log('[WebView Polyfill] Chrome API polyfill installed for Android WebView');
})();
