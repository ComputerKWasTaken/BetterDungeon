// modules/geolocation/module.js
//
// Frontier geolocation module. Gives AI Dungeon scripts a guarded way to ask
// for the user's current location through the browser's native geolocation API.

(function () {
  if (window.FrontierGeolocationModule) return;

  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const DEFAULT_MAXIMUM_AGE_MS = 0;
  const MAX_MAXIMUM_AGE_MS = 3600000;

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeArgs(args, allowEmpty = true) {
    if (args === undefined || args === null) return {};
    if (allowEmpty && args === '') return {};
    if (typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }
    return args;
  }

  function normalizeOptions(args) {
    const normalized = normalizeArgs(args, true);
    return {
      enableHighAccuracy: !!normalized.highAccuracy,
      timeout: clampNumber(normalized.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS),
      maximumAge: clampNumber(normalized.maximumAgeMs, DEFAULT_MAXIMUM_AGE_MS, 0, MAX_MAXIMUM_AGE_MS),
    };
  }

  function geolocationApi() {
    return typeof navigator !== 'undefined' ? navigator.geolocation : null;
  }

  function permissionsApi() {
    return typeof navigator !== 'undefined' ? navigator.permissions : null;
  }

  async function getPermissionState() {
    const permissions = permissionsApi();
    if (!permissions || typeof permissions.query !== 'function') {
      return 'unknown';
    }

    try {
      const status = await permissions.query({ name: 'geolocation' });
      return status?.state || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function wrapPosition(position, permissionState) {
    const coords = position?.coords || {};
    const timestamp = Number(position?.timestamp || Date.now());
    return {
      latitude: typeof coords.latitude === 'number' ? coords.latitude : null,
      longitude: typeof coords.longitude === 'number' ? coords.longitude : null,
      accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : null,
      altitude: typeof coords.altitude === 'number' ? coords.altitude : null,
      altitudeAccuracy: typeof coords.altitudeAccuracy === 'number' ? coords.altitudeAccuracy : null,
      heading: typeof coords.heading === 'number' ? coords.heading : null,
      speed: typeof coords.speed === 'number' ? coords.speed : null,
      timestamp,
      iso: new Date(timestamp).toISOString(),
      permissionState,
    };
  }

  function mapPositionError(err) {
    const code = Number(err?.code || 0);
    if (code === 1) {
      return {
        code: 'permission_denied',
        message: err?.message || 'User denied geolocation',
      };
    }
    if (code === 2) {
      return {
        code: 'position_unavailable',
        message: err?.message || 'Position is unavailable',
      };
    }
    if (code === 3) {
      return {
        code: 'timeout',
        message: err?.message || 'Geolocation request timed out',
      };
    }
    return {
      code: 'geolocation_failed',
      message: err?.message || 'Geolocation request failed',
    };
  }

  function getCurrentPosition(options) {
    const geo = geolocationApi();
    if (!geo || typeof geo.getCurrentPosition !== 'function') {
      return Promise.reject({
        code: 'unavailable',
        message: 'Geolocation is not available in this browser context',
      });
    }

    return new Promise((resolve, reject) => {
      geo.getCurrentPosition(resolve, (err) => reject(mapPositionError(err)), options);
    });
  }

  async function permissionOp(args = {}) {
    normalizeArgs(args, true);
    const supported = !!geolocationApi();
    const permissionState = supported ? await getPermissionState() : 'unsupported';
    return {
      supported,
      permissionState,
    };
  }

  async function getCurrentOp(args = {}, ctx) {
    const options = normalizeOptions(args);
    const beforePermission = await getPermissionState();

    if (beforePermission === 'denied') {
      throw {
        code: 'permission_denied',
        message: 'Geolocation permission is denied',
      };
    }

    const position = await getCurrentPosition(options);
    const afterPermission = await getPermissionState();
    const payload = wrapPosition(position, afterPermission);

    ctx?.log?.(
      'debug',
      'Geolocation completed',
      payload.latitude,
      payload.longitude,
      payload.accuracy
    );

    return payload;
  }

  const FrontierGeolocationModule = {
    id: 'geolocation',
    version: '1.0.0',
    label: 'Geolocation',
    description: 'Provides current-location and geolocation-permission helpers for Frontier scripts.',

    ops: {
      permission: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: permissionOp,
      },
      getCurrent: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS,
        handler: getCurrentOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'Geolocation mounted');
    },

    unmount() {
      this._ctx = null;
    },

    async inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        supported: !!geolocationApi(),
        permissionState: await getPermissionState(),
      };
    },
  };

  window.FrontierGeolocationModule = FrontierGeolocationModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierGeolocationModule);
  } else {
    console.warn('[Geolocation] Frontier registry not available; module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierGeolocationModule;
  }
})();
