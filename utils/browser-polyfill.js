// BetterDungeon - Browser Polyfill
// Provides cross-browser compatibility between Chrome and Firefox.
//
// Firefox uses the `browser.*` namespace with Promise-based APIs, while
// Chrome uses `chrome.*` with callback-based APIs.  Firefox also provides
// its own partial `chrome.*` shim for MV3, but it has known issues:
//   - storage.sync.get() may pass `undefined` to the callback instead of `{}`
//   - The shim's `chrome` global in content scripts is non-overridable
//
// This polyfill uses a layered strategy:
//   1. Try to replace `chrome` entirely with a proper wrapper around `browser.*`
//   2. If that fails (content-script sandbox), monkey-patch the individual
//      methods on Firefox's existing `chrome` object to normalise behaviour
//   3. As a final safety net, storage.js also guards against `undefined` results

(function () {
  'use strict';

  // Only activate on Firefox (native `browser` namespace present)
  if (typeof browser === 'undefined' || !browser.runtime || !browser.runtime.id) {
    return;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  // Wraps a Promise-returning function so it also accepts a trailing callback.
  function promiseToCallback(fn, thisArg) {
    return function (...args) {
      const lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        const callback = args.pop();
        fn.apply(thisArg, args).then(
          function (result) { callback(result); },
          function (err) {
            // Surface errors via chrome.runtime.lastError so callers can detect them
            try {
              if (globalThis.chrome && globalThis.chrome.runtime) {
                globalThis.chrome.runtime.lastError = { message: err ? err.message || String(err) : 'Unknown error' };
              }
            } catch (_) { /* runtime may be frozen */ }
            callback(undefined);
            try {
              if (globalThis.chrome && globalThis.chrome.runtime) {
                globalThis.chrome.runtime.lastError = undefined;
              }
            } catch (_) { /* ignore */ }
          }
        );
      } else {
        return fn.apply(thisArg, args);
      }
    };
  }

  // Recursively wraps a browser.* namespace object.
  function wrapNamespace(source) {
    if (!source) return source;

    var wrapped = {};
    var seen = {};

    for (var key in source) {
      if (seen[key]) continue;
      seen[key] = true;

      var value = source[key];

      // Event objects (onMessage, onChanged, …) — keep as-is
      if (value && typeof value === 'object' && typeof value.addListener === 'function') {
        wrapped[key] = value;
      } else if (typeof value === 'function') {
        wrapped[key] = promiseToCallback(value, source);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        wrapped[key] = wrapNamespace(value);
      } else {
        wrapped[key] = value;
      }
    }

    return wrapped;
  }

  // ── Strategy 1 — Full replacement ───────────────────────────────────
  // Build a complete `chrome` object from `browser.*` and try to install it.

  function buildPolyfilledChrome() {
    var polyfilled = {};

    // runtime
    if (browser.runtime) {
      polyfilled.runtime = wrapNamespace(browser.runtime);
      Object.defineProperty(polyfilled.runtime, 'id', {
        get: function () { return browser.runtime.id; },
        configurable: true
      });
      Object.defineProperty(polyfilled.runtime, 'lastError', {
        get: function () { return browser.runtime.lastError; },
        configurable: true
      });
      if (browser.runtime.onMessage) {
        polyfilled.runtime.onMessage = browser.runtime.onMessage;
      }
    }

    // storage
    if (browser.storage) {
      polyfilled.storage = {};
      if (browser.storage.sync)  polyfilled.storage.sync  = wrapNamespace(browser.storage.sync);
      if (browser.storage.local) polyfilled.storage.local = wrapNamespace(browser.storage.local);
      if (browser.storage.onChanged) polyfilled.storage.onChanged = browser.storage.onChanged;
    }

    // tabs
    if (browser.tabs) {
      polyfilled.tabs = wrapNamespace(browser.tabs);
    }

    return polyfilled;
  }

  var polyfilled = buildPolyfilledChrome();
  var overrideSucceeded = false;

  // Attempt 1a: Object.defineProperty
  try {
    Object.defineProperty(globalThis, 'chrome', {
      value: polyfilled,
      writable: true,
      configurable: true,
      enumerable: true
    });
    // Verify it took effect
    if (globalThis.chrome === polyfilled) {
      overrideSucceeded = true;
    }
  } catch (_) { /* non-configurable */ }

  // Attempt 1b: plain assignment
  if (!overrideSucceeded) {
    try {
      globalThis.chrome = polyfilled;
      if (globalThis.chrome === polyfilled) {
        overrideSucceeded = true;
      }
    } catch (_) { /* non-writable */ }
  }

  if (overrideSucceeded) {
    return; // Full replacement worked — done.
  }

  // ── Strategy 2 — Monkey-patch existing chrome.* ─────────────────────
  // The global `chrome` is locked by Firefox's content-script sandbox.
  // Patch individual methods to route through the native `browser.*` APIs,
  // which are Promise-based and work correctly.

  // Patch a storage area (sync or local)
  function patchStorageArea(chromeArea, browserArea) {
    if (!chromeArea || !browserArea) return;

    try {
      chromeArea.get = function (keys, callback) {
        if (typeof callback === 'function') {
          browserArea.get(keys).then(
            function (result) { callback(result || {}); },
            function () { callback({}); }
          );
        } else {
          return browserArea.get(keys);
        }
      };
    } catch (_) { /* frozen property */ }

    try {
      chromeArea.set = function (items, callback) {
        if (typeof callback === 'function') {
          browserArea.set(items).then(
            function () { callback(); },
            function () { callback(); }
          );
        } else {
          return browserArea.set(items);
        }
      };
    } catch (_) { /* frozen property */ }

    try {
      chromeArea.remove = function (keys, callback) {
        if (typeof callback === 'function') {
          browserArea.remove(keys).then(
            function () { callback(); },
            function () { callback(); }
          );
        } else {
          return browserArea.remove(keys);
        }
      };
    } catch (_) { /* frozen property */ }
  }

  if (typeof chrome !== 'undefined') {
    // Patch storage
    if (chrome.storage && browser.storage) {
      patchStorageArea(chrome.storage.sync,  browser.storage.sync);
      patchStorageArea(chrome.storage.local, browser.storage.local);
    }

    // Patch runtime.getURL
    if (chrome.runtime && browser.runtime) {
      try {
        chrome.runtime.getURL = function (path) {
          return browser.runtime.getURL(path);
        };
      } catch (_) { /* frozen */ }
    }

    // Patch tabs
    if (chrome.tabs && browser.tabs) {
      try {
        chrome.tabs.query = function (queryInfo, callback) {
          if (typeof callback === 'function') {
            browser.tabs.query(queryInfo).then(
              function (result) { callback(result); },
              function () { callback([]); }
            );
          } else {
            return browser.tabs.query(queryInfo);
          }
        };
      } catch (_) { /* frozen */ }

      try {
        chrome.tabs.sendMessage = function (tabId, message, callbackOrOptions, maybeCallback) {
          // Handle both (tabId, msg, callback) and (tabId, msg, options, callback)
          var callback = typeof callbackOrOptions === 'function' ? callbackOrOptions : maybeCallback;
          var options  = typeof callbackOrOptions === 'object' ? callbackOrOptions : undefined;
          if (typeof callback === 'function') {
            var args = options ? [tabId, message, options] : [tabId, message];
            browser.tabs.sendMessage.apply(browser.tabs, args).then(
              function (result) { callback(result); },
              function () { callback(undefined); }
            );
          } else {
            var sendArgs = options ? [tabId, message, options] : [tabId, message];
            return browser.tabs.sendMessage.apply(browser.tabs, sendArgs);
          }
        };
      } catch (_) { /* frozen */ }

      try {
        chrome.tabs.create = function (props, callback) {
          if (typeof callback === 'function') {
            browser.tabs.create(props).then(
              function (tab) { callback(tab); },
              function () { callback(undefined); }
            );
          } else {
            return browser.tabs.create(props);
          }
        };
      } catch (_) { /* frozen */ }
    }
  }
})();
