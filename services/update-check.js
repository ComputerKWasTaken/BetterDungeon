// BetterDungeon - GitHub Release Update Check
// Notifies manual installs (unpacked extension ZIPs and the Android APK) when
// a newer release is published on GitHub. Store-managed installs auto-update
// through their storefront and never contact GitHub.

(function () {
  'use strict';

  if (globalThis.BetterDungeonUpdateCheck) return;

  var RELEASES_API_URL = 'https://api.github.com/repos/ComputerKWasTaken/BetterDungeon/releases/latest';
  var RELEASES_PAGE_URL = 'https://github.com/ComputerKWasTaken/BetterDungeon/releases';
  var STORAGE_KEY = 'betterDungeonUpdateCheck';
  var MESSAGE_TYPE = 'BETTERDUNGEON_UPDATE_CHECK';
  var CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
  var FAILURE_RETRY_MS = 60 * 60 * 1000;
  var REQUEST_TIMEOUT_MS = 10000;

  var inflightCheck = null;

  function runtimeApi() {
    if (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest) return chrome;
    if (typeof browser !== 'undefined' && browser?.runtime?.getManifest) return browser;
    return null;
  }

  function storageArea() {
    var api = runtimeApi();
    return api?.storage?.local || null;
  }

  function getManifest() {
    try {
      return runtimeApi()?.runtime?.getManifest?.() || {};
    } catch (error) {
      return {};
    }
  }

  function currentVersion() {
    return String(getManifest().version || '0.0.0');
  }

  // Firefox permanent installs are always signed by AMO and auto-update from
  // the listing even without a manifest update_url, so any Gecko runtime is
  // treated as store-managed. `browser` only exists on Firefox; the WebView
  // polyfill defines `chrome` only.
  function isGeckoRuntime() {
    return typeof browser !== 'undefined' &&
      typeof browser.runtime?.getBrowserInfo === 'function';
  }

  function storeUpdateUrl(manifest) {
    return manifest.update_url ||
      manifest.browser_specific_settings?.gecko?.update_url ||
      manifest.applications?.gecko?.update_url ||
      '';
  }

  function getInstallContext() {
    var platform = globalThis.BetterDungeonPlatform;
    if (platform?.kind === 'android-webview') {
      return { manual: true, channel: 'android' };
    }
    var manifest = getManifest();
    if (storeUpdateUrl(manifest) || isGeckoRuntime()) {
      return { manual: false, channel: 'store' };
    }
    return { manual: true, channel: 'extension' };
  }

  function parseVersion(value) {
    var match = String(value || '').trim().match(/^v?(\d+(?:\.\d+)*)/i);
    if (!match) return null;
    return match[1].split('.').map(function (part) { return Number(part); });
  }

  // Positive when `a` is newer than `b`; tolerant of v-prefixes, missing
  // segments (2.0 == 2.0.0), and pre-release suffixes (2.1.0-beta < 2.1.0).
  function compareVersions(a, b) {
    var pa = parseVersion(a);
    var pb = parseVersion(b);
    if (!pa || !pb) return 0;
    var length = Math.max(pa.length, pb.length);
    for (var i = 0; i < length; i++) {
      var diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff;
    }
    var aPre = /-/i.test(String(a));
    var bPre = /-/i.test(String(b));
    if (aPre !== bPre) return aPre ? -1 : 1;
    return 0;
  }

  function storageRead() {
    var area = storageArea();
    if (!area) return Promise.resolve({});
    return new Promise(function (resolve) {
      var settled = false;
      var done = function (result) {
        if (settled) return;
        settled = true;
        var state = result && result[STORAGE_KEY];
        resolve(state && typeof state === 'object' ? state : {});
      };
      try {
        var maybePromise = area.get(STORAGE_KEY, done);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done, function () { done({}); });
        }
      } catch (error) {
        try {
          var fallback = area.get(STORAGE_KEY);
          if (fallback && typeof fallback.then === 'function') {
            fallback.then(done, function () { done({}); });
          } else {
            done({});
          }
        } catch (innerError) {
          done({});
        }
      }
    });
  }

  function storageWrite(state) {
    var area = storageArea();
    if (!area) return Promise.resolve();
    return new Promise(function (resolve) {
      var payload = {};
      payload[STORAGE_KEY] = state;
      var settled = false;
      var done = function () {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        var maybePromise = area.set(payload, done);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done, done);
        }
      } catch (error) {
        try {
          var fallback = area.set(payload);
          if (fallback && typeof fallback.then === 'function') {
            fallback.then(done, done);
          } else {
            done();
          }
        } catch (innerError) {
          done();
        }
      }
    });
  }

  function pickAssetUrl(assets, channel) {
    if (!Array.isArray(assets)) return '';
    var extension = channel === 'android' ? '.apk' : '.zip';
    for (var i = 0; i < assets.length; i++) {
      var url = assets[i]?.browser_download_url;
      if (typeof url === 'string' && url.toLowerCase().endsWith(extension)) {
        return url;
      }
    }
    return '';
  }

  function toStatus(state, context) {
    var updateAvailable = !!state.latestVersion &&
      compareVersions(state.latestVersion, currentVersion()) > 0;
    return {
      enabled: state.enabled !== false,
      manual: context.manual,
      channel: context.channel,
      currentVersion: currentVersion(),
      updateAvailable: updateAvailable,
      latestVersion: state.latestVersion || '',
      releaseName: state.releaseName || '',
      releaseUrl: state.releaseUrl || RELEASES_PAGE_URL,
      downloadUrl: state.downloadUrl || '',
      dismissedVersion: state.dismissedVersion || '',
      lastCheckedAt: state.lastCheckedAt || 0,
      shouldNotify: context.manual && state.enabled !== false &&
        updateAvailable && state.dismissedVersion !== state.latestVersion
    };
  }

  async function getStatus() {
    var state = await storageRead();
    return toStatus(state, getInstallContext());
  }

  async function fetchLatestRelease(state) {
    var headers = { 'Accept': 'application/vnd.github+json' };
    if (state.etag) headers['If-None-Match'] = state.etag;

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    }

    try {
      var response = await fetch(RELEASES_API_URL, {
        method: 'GET',
        headers: headers,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller ? controller.signal : undefined
      });

      if (response.status === 304) {
        return { state: state, notModified: true };
      }
      if (!response.ok) {
        throw { code: 'request_failed', message: 'GitHub Releases returned HTTP ' + response.status };
      }

      var release = await response.json();
      var context = getInstallContext();
      state.etag = response.headers.get('etag') || state.etag || '';
      state.latestVersion = String(release?.tag_name || '').replace(/^v/i, '');
      state.releaseName = typeof release?.name === 'string' ? release.name : '';
      state.releaseUrl = typeof release?.html_url === 'string' && release.html_url
        ? release.html_url
        : RELEASES_PAGE_URL;
      state.downloadUrl = pickAssetUrl(release?.assets, context.channel);
      return { state: state, notModified: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Runs one check unconditionally. `reason` records what triggered it.
  async function checkNow(reason) {
    if (inflightCheck) return inflightCheck;
    inflightCheck = (async function () {
      var state = await storageRead();
      var context = getInstallContext();
      if (!context.manual) {
        state.manualInstall = false;
        state.lastAttemptAt = Date.now();
        state.nextRetryAt = Date.now() + CHECK_INTERVAL_MS;
        await storageWrite(state);
        return toStatus(state, context);
      }
      state.manualInstall = true;
      state.lastAttemptAt = Date.now();
      try {
        var result = await fetchLatestRelease(state);
        state = result.state;
        state.lastCheckedAt = Date.now();
        state.nextRetryAt = Date.now() + CHECK_INTERVAL_MS;
        state.lastError = '';
      } catch (error) {
        state.nextRetryAt = Date.now() + FAILURE_RETRY_MS;
        state.lastError = String(error?.message || error || 'check failed');
      }
      await storageWrite(state);
      return toStatus(state, context);
    })();
    try {
      return await inflightCheck;
    } finally {
      inflightCheck = null;
    }
  }

  // Automatic entry point: honors the opt-out toggle and the retry schedule.
  async function checkIfDue() {
    var state = await storageRead();
    var context = getInstallContext();
    if (state.enabled === false) return toStatus(state, context);
    var due = Number(state.nextRetryAt || 0);
    if (due && Date.now() < due) return toStatus(state, context);
    return checkNow('scheduled');
  }

  async function dismiss(version) {
    var state = await storageRead();
    state.dismissedVersion = String(version || state.latestVersion || '');
    await storageWrite(state);
    return toStatus(state, getInstallContext());
  }

  async function setEnabled(enabled) {
    var state = await storageRead();
    state.enabled = enabled !== false;
    await storageWrite(state);
    return toStatus(state, getInstallContext());
  }

  globalThis.BetterDungeonUpdateCheck = Object.freeze({
    MESSAGE_TYPE: MESSAGE_TYPE,
    RELEASES_PAGE_URL: RELEASES_PAGE_URL,
    compareVersions: compareVersions,
    getInstallContext: getInstallContext,
    getStatus: getStatus,
    checkNow: checkNow,
    checkIfDue: checkIfDue,
    dismiss: dismiss,
    setEnabled: setEnabled
  });
})();
