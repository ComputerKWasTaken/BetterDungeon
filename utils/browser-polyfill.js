// BetterDungeon - Browser Polyfill
// Provides cross-browser compatibility between Chrome and Firefox.
//
// Firefox uses the `browser.*` namespace with Promise-based APIs, while
// Chrome uses `chrome.*` with callback-based APIs. Firefox also provides
// its own partial `chrome.*` shim for MV3, but it has known issues:
//   - storage.sync.get() may pass `undefined` to the callback instead of `{}`
//   - The shim's `chrome` global in content scripts is non-overridable
//
// This polyfill uses a layered strategy:
//   1. Try to replace `chrome` with a wrapper around `browser.*`
//   2. If that fails, monkey-patch the individual methods used by BD
//   3. Keep storage.js guards as a final safety net for undefined results

(function () {
  'use strict';

  // Only activate on Firefox (native `browser` namespace present).
  if (typeof browser === 'undefined' || !browser.runtime || !browser.runtime.id) {
    return;
  }

  // Helpers

  var emulatedLastError = null;

  function lastErrorFrom(err) {
    return { message: err ? err.message || String(err) : 'Unknown error' };
  }

  function exposeLastError(runtime) {
    if (!runtime) return;

    try {
      Object.defineProperty(runtime, 'lastError', {
        get: function () {
          return emulatedLastError || (browser.runtime && browser.runtime.lastError) || undefined;
        },
        configurable: true
      });
    } catch (_) {
      // Some Firefox chrome.* objects are locked in content-script sandboxes.
    }
  }

  function tryAssignNativeLastError(value) {
    try {
      if (globalThis.chrome && globalThis.chrome.runtime) {
        globalThis.chrome.runtime.lastError = value;
      }
    } catch (_) {
      // Ignore locked native chrome.runtime.lastError.
    }
  }

  function withLastError(err, callback) {
    emulatedLastError = lastErrorFrom(err);
    tryAssignNativeLastError(emulatedLastError);

    try {
      callback();
    } finally {
      emulatedLastError = null;
      tryAssignNativeLastError(undefined);
    }
  }

  function invokeCallback(callback, args, err) {
    if (err) {
      withLastError(err, function () {
        callback.apply(undefined, args);
      });
    } else {
      callback.apply(undefined, args);
    }
  }

  // Wraps a Promise-returning function so it also accepts a trailing callback.
  function promiseToCallback(fn, thisArg) {
    return function (...args) {
      var lastArg = args[args.length - 1];
      if (typeof lastArg === 'function') {
        var callback = args.pop();
        Promise.resolve(fn.apply(thisArg, args)).then(
          function (result) {
            callback(result);
          },
          function (err) {
            // Match Chrome callback semantics: lastError is visible while the callback runs.
            invokeCallback(callback, [undefined], err);
          }
        );
      } else {
        return fn.apply(thisArg, args);
      }
    };
  }

  function addKey(keys, key) {
    if (
      key !== '__proto__' &&
      key !== 'constructor' &&
      key !== 'prototype' &&
      keys.indexOf(key) === -1
    ) {
      keys.push(key);
    }
  }

  function ownAndEnumerableKeys(source) {
    var keys = [];

    try {
      Object.getOwnPropertyNames(source).forEach(function (key) {
        addKey(keys, key);
      });
    } catch (_) {
      // Non-standard host object.
    }

    for (var key in source) {
      addKey(keys, key);
    }

    return keys;
  }

  // Recursively wraps a browser.* namespace object.
  function wrapNamespace(source) {
    if (!source) return source;

    var wrapped = {};
    var seen = {};
    var keys = ownAndEnumerableKeys(source);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (seen[key]) continue;
      seen[key] = true;

      var value;
      try {
        value = source[key];
      } catch (_) {
        continue;
      }

      // Event objects (onMessage, onChanged, etc.) should stay native.
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

  // Strategy 1 - Full replacement.
  // Build a complete `chrome` object from `browser.*` and try to install it.

  function buildPolyfilledChrome() {
    var polyfilled = wrapNamespace(browser);

    if (polyfilled.runtime && browser.runtime) {
      Object.defineProperty(polyfilled.runtime, 'id', {
        get: function () { return browser.runtime.id; },
        configurable: true
      });
      exposeLastError(polyfilled.runtime);
    }

    return polyfilled;
  }

  var polyfilled = buildPolyfilledChrome();
  var overrideSucceeded = false;

  // Attempt 1a: Object.defineProperty.
  try {
    Object.defineProperty(globalThis, 'chrome', {
      value: polyfilled,
      writable: true,
      configurable: true,
      enumerable: true
    });
    if (globalThis.chrome === polyfilled) {
      overrideSucceeded = true;
    }
  } catch (_) {
    // Non-configurable.
  }

  // Attempt 1b: plain assignment.
  if (!overrideSucceeded) {
    try {
      globalThis.chrome = polyfilled;
      if (globalThis.chrome === polyfilled) {
        overrideSucceeded = true;
      }
    } catch (_) {
      // Non-writable.
    }
  }

  if (overrideSucceeded) {
    return;
  }

  // Strategy 2 - Monkey-patch existing chrome.*.
  // The global `chrome` is locked by Firefox's content-script sandbox.
  // Patch individual methods to route through the native `browser.*` APIs.

  function patchStorageArea(chromeArea, browserArea) {
    if (!chromeArea || !browserArea) return;

    try {
      chromeArea.get = function (keys, callback) {
        if (typeof callback === 'function') {
          browserArea.get(keys).then(
            function (result) {
              callback(result || {});
            },
            function (err) {
              invokeCallback(callback, [{}], err);
            }
          );
        } else {
          return browserArea.get(keys);
        }
      };
    } catch (_) {
      // Frozen property.
    }

    try {
      chromeArea.set = function (items, callback) {
        if (typeof callback === 'function') {
          browserArea.set(items).then(
            function () {
              callback();
            },
            function (err) {
              invokeCallback(callback, [], err);
            }
          );
        } else {
          return browserArea.set(items);
        }
      };
    } catch (_) {
      // Frozen property.
    }

    try {
      chromeArea.remove = function (keys, callback) {
        if (typeof callback === 'function') {
          browserArea.remove(keys).then(
            function () {
              callback();
            },
            function (err) {
              invokeCallback(callback, [], err);
            }
          );
        } else {
          return browserArea.remove(keys);
        }
      };
    } catch (_) {
      // Frozen property.
    }
  }

  if (typeof chrome !== 'undefined') {
    if (chrome.runtime) {
      exposeLastError(chrome.runtime);
    }

    if (chrome.storage && browser.storage) {
      patchStorageArea(chrome.storage.sync, browser.storage.sync);
      patchStorageArea(chrome.storage.local, browser.storage.local);
    }

    if (chrome.runtime && browser.runtime) {
      try {
        chrome.runtime.getURL = function (path) {
          return browser.runtime.getURL(path);
        };
      } catch (_) {
        // Frozen property.
      }
    }

    if (chrome.tabs && browser.tabs) {
      try {
        chrome.tabs.query = function (queryInfo, callback) {
          if (typeof callback === 'function') {
            browser.tabs.query(queryInfo).then(
              function (result) {
                callback(result);
              },
              function (err) {
                invokeCallback(callback, [[]], err);
              }
            );
          } else {
            return browser.tabs.query(queryInfo);
          }
        };
      } catch (_) {
        // Frozen property.
      }

      try {
        chrome.tabs.sendMessage = function (tabId, message, callbackOrOptions, maybeCallback) {
          var callback = typeof callbackOrOptions === 'function' ? callbackOrOptions : maybeCallback;
          var options = typeof callbackOrOptions === 'object' ? callbackOrOptions : undefined;
          var args = options ? [tabId, message, options] : [tabId, message];

          if (typeof callback === 'function') {
            browser.tabs.sendMessage.apply(browser.tabs, args).then(
              function (result) {
                callback(result);
              },
              function (err) {
                invokeCallback(callback, [undefined], err);
              }
            );
          } else {
            return browser.tabs.sendMessage.apply(browser.tabs, args);
          }
        };
      } catch (_) {
        // Frozen property.
      }

      try {
        chrome.tabs.create = function (props, callback) {
          if (typeof callback === 'function') {
            browser.tabs.create(props).then(
              function (tab) {
                callback(tab);
              },
              function (err) {
                invokeCallback(callback, [undefined], err);
              }
            );
          } else {
            return browser.tabs.create(props);
          }
        };
      } catch (_) {
        // Frozen property.
      }
    }
  }
})();
