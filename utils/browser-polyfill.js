// BetterDungeon - Browser Polyfill
// Provides cross-browser compatibility between Chrome and Firefox
// Firefox uses the `browser.*` namespace with Promise-based APIs,
// while Chrome uses `chrome.*` with callback-based APIs.
// This polyfill ensures `chrome.*` works uniformly on both browsers.
//
// Firefox provides its own partial `chrome.*` shim for MV3, but it is
// incomplete (e.g., storage callbacks receive wrong arguments). When the
// native `browser` namespace is detected we therefore always replace
// `chrome` with our own wrapper built on top of `browser.*`.

(function () {
  'use strict';

  // Detect Firefox: the `browser` namespace with a valid runtime id is the
  // canonical indicator. If it is absent we are on a Chromium browser where
  // the native `chrome.*` API is already correct — nothing to do.
  if (typeof browser === 'undefined' || !browser.runtime || !browser.runtime.id) {
    return;
  }

  // Helper: wraps a Promise-based browser.* method so it also accepts
  // a trailing callback, matching the Chrome callback style.
  // If no callback is provided, the original Promise is returned.
  function promiseToCallback(fn, thisArg) {
    return function (...args) {
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        const callback = args.pop();
        fn.apply(thisArg, args).then(
          (result) => callback(result),
          (error) => {
            // Mimic chrome.runtime.lastError behavior
            try {
              globalThis.chrome.runtime._lastError = { message: error.message };
            } catch (_) { /* ignore */ }
            callback(undefined);
            try {
              globalThis.chrome.runtime._lastError = undefined;
            } catch (_) { /* ignore */ }
          }
        );
      } else {
        return fn.apply(thisArg, args);
      }
    };
  }

  // Build a wrapper that wraps an entire browser.* namespace object,
  // converting Promise-returning methods to also accept callbacks.
  // Firefox may expose API methods on the prototype rather than as own
  // properties, so we walk the full prototype chain to discover them.
  function wrapNamespace(source) {
    if (!source) return source;

    const wrapped = {};
    const seen = new Set();

    // Collect all enumerable string keys from the source and its prototypes
    for (const key in source) {
      if (seen.has(key)) continue;
      seen.add(key);

      const value = source[key];

      // Preserve event-style objects (onMessage, onChanged, etc.) as-is
      if (value && typeof value === 'object' && typeof value.addListener === 'function') {
        wrapped[key] = value;
      } else if (typeof value === 'function') {
        wrapped[key] = promiseToCallback(value, source);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively wrap nested objects (e.g., storage.sync, storage.local)
        wrapped[key] = wrapNamespace(value);
      } else {
        wrapped[key] = value;
      }
    }

    return wrapped;
  }

  // Build the polyfilled chrome object from browser.*
  const polyfilled = {};

  // runtime namespace
  if (browser.runtime) {
    polyfilled.runtime = wrapNamespace(browser.runtime);

    // Directly expose non-function properties via getters
    Object.defineProperty(polyfilled.runtime, 'id', {
      get: function () { return browser.runtime.id; },
      configurable: true
    });

    // lastError: readable from browser.runtime, writable for error handling
    let _lastError = undefined;
    Object.defineProperty(polyfilled.runtime, 'lastError', {
      get: function () { return _lastError || browser.runtime.lastError; },
      set: function (val) { _lastError = val; },
      configurable: true
    });

    // Alias used by the error handler in promiseToCallback
    Object.defineProperty(polyfilled.runtime, '_lastError', {
      get: function () { return _lastError; },
      set: function (val) { _lastError = val; },
      configurable: true
    });

    // onMessage needs the native event object for sendResponse pattern
    if (browser.runtime.onMessage) {
      polyfilled.runtime.onMessage = browser.runtime.onMessage;
    }
  }

  // storage namespace
  if (browser.storage) {
    polyfilled.storage = {};
    if (browser.storage.sync) {
      polyfilled.storage.sync = wrapNamespace(browser.storage.sync);
    }
    if (browser.storage.local) {
      polyfilled.storage.local = wrapNamespace(browser.storage.local);
    }
    if (browser.storage.onChanged) {
      polyfilled.storage.onChanged = browser.storage.onChanged;
    }
  }

  // tabs namespace
  if (browser.tabs) {
    polyfilled.tabs = wrapNamespace(browser.tabs);
  }

  // Replace the global chrome object with our properly wrapped version
  globalThis.chrome = polyfilled;
})();
