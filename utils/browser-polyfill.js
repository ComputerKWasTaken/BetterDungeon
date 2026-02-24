// BetterDungeon - Browser Polyfill
// Provides cross-browser compatibility between Chrome and Firefox
// Firefox uses the `browser.*` namespace with Promise-based APIs,
// while Chrome uses `chrome.*` with callback-based APIs.
// This polyfill ensures `chrome.*` works uniformly on both browsers.

(function () {
  'use strict';

  // If chrome is already fully defined (Chromium browsers), no polyfill needed
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    return;
  }

  // If browser namespace exists (Firefox), wrap it to provide chrome-compatible API
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) {

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
              if (typeof chrome !== 'undefined') {
                chrome.runtime.lastError = { message: error.message };
              }
              callback(undefined);
              if (typeof chrome !== 'undefined') {
                chrome.runtime.lastError = undefined;
              }
            }
          );
        } else {
          return fn.apply(thisArg, args);
        }
      };
    }

    // Build a proxy that wraps an entire browser.* namespace object,
    // converting Promise-returning methods to also accept callbacks.
    function wrapNamespace(source) {
      if (!source) return source;

      const wrapped = {};

      for (const key of Object.keys(source)) {
        const value = source[key];

        if (typeof value === 'function') {
          wrapped[key] = promiseToCallback(value, source);
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Recursively wrap nested objects (e.g., storage.sync, storage.local)
          wrapped[key] = wrapNamespace(value);
        } else {
          wrapped[key] = value;
        }
      }

      // Preserve event listeners (onMessage, onChanged, etc.)
      // These use addListener/removeListener pattern and don't need wrapping
      for (const key of Object.keys(source)) {
        const value = source[key];
        if (value && typeof value === 'object' && typeof value.addListener === 'function') {
          wrapped[key] = value;
        }
      }

      return wrapped;
    }

    // Only polyfill if chrome is not already set
    if (typeof globalThis.chrome === 'undefined' || !globalThis.chrome.runtime) {
      const polyfilled = {};

      // runtime namespace
      if (browser.runtime) {
        polyfilled.runtime = wrapNamespace(browser.runtime);

        // Directly expose non-function properties
        Object.defineProperty(polyfilled.runtime, 'id', {
          get: function () { return browser.runtime.id; }
        });
        Object.defineProperty(polyfilled.runtime, 'lastError', {
          get: function () { return browser.runtime.lastError; },
          set: function (val) { /* allow setting for polyfill error handling */ }
        });

        // onMessage needs special handling for sendResponse pattern
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

      // Set the global chrome object
      globalThis.chrome = polyfilled;
    }
  }
})();
