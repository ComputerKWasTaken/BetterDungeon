// modules/system/module.js
//
// Frontier system module. Exposes coarse device, browser, locale, display, and
// power hints so scripts can adapt without reaching for risky OS surfaces.

(function () {
  if (window.FrontierSystemModule) return;

  const DEVICE_CLASSES = {
    DESKTOP: 'desktop',
    TABLET: 'tablet',
    MOBILE: 'mobile',
    UNKNOWN: 'unknown',
  };

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function normalizeArgs(args) {
    if (args === undefined || args === null) return {};
    if (typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }
    return args;
  }

  function nav() {
    if (typeof navigator !== 'undefined') return navigator;
    return {};
  }

  function win() {
    if (typeof window !== 'undefined') return window;
    return {};
  }

  function numOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function strOrNull(value) {
    return typeof value === 'string' && value ? value : null;
  }

  function boolOrNull(value) {
    return typeof value === 'boolean' ? value : null;
  }

  function timestamp() {
    const checkedAt = Date.now();
    return {
      checkedAt,
      checkedAtIso: new Date(checkedAt).toISOString(),
    };
  }

  function matchMediaBool(query) {
    try {
      const matcher = win().matchMedia;
      if (typeof matcher !== 'function') return null;
      return !!matcher.call(win(), query).matches;
    } catch {
      return null;
    }
  }

  function getTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }

  function getUserAgentData() {
    const data = nav().userAgentData;
    if (!data || typeof data !== 'object') return null;
    return {
      platform: strOrNull(data.platform),
      mobile: boolOrNull(data.mobile),
      brands: Array.isArray(data.brands)
        ? data.brands.map((brand) => ({
          brand: strOrNull(brand.brand),
          version: strOrNull(brand.version),
        })).filter((brand) => brand.brand)
        : [],
    };
  }

  function detectPlatform(userAgentData) {
    const navigatorRef = nav();
    const ua = String(navigatorRef.userAgent || '');
    const uaLower = ua.toLowerCase();
    const rawPlatform = userAgentData?.platform || navigatorRef.platform || '';
    const platformLower = String(rawPlatform).toLowerCase();
    let family = 'unknown';

    if (/android/.test(uaLower) || platformLower === 'android') {
      family = 'android';
    } else if (/iphone|ipad|ipod/.test(uaLower) || /iphone|ipad|ipod/.test(platformLower)) {
      family = 'ios';
    } else if (/cros/.test(platformLower) || /cros/.test(uaLower)) {
      family = 'chromeos';
    } else if (/win/.test(platformLower) || /windows/.test(uaLower)) {
      family = 'windows';
    } else if (/mac/.test(platformLower) || /mac os/.test(uaLower)) {
      family = 'macos';
    } else if (/linux/.test(platformLower) || /linux/.test(uaLower)) {
      family = 'linux';
    }

    const mobile = typeof userAgentData?.mobile === 'boolean'
      ? userAgentData.mobile
      : /mobi|android|iphone|ipod/.test(uaLower);

    return {
      family,
      raw: strOrNull(rawPlatform),
      mobile,
    };
  }

  function detectBrowser(userAgentData) {
    const ua = String(nav().userAgent || '');
    const brands = userAgentData?.brands || [];
    const brandText = brands.map((brand) => brand.brand).join(' ').toLowerCase();
    let name = 'unknown';
    let version = null;

    function parseVersion(regex) {
      const match = ua.match(regex);
      return match ? match[1] : null;
    }

    if (/firefox|fxios/.test(ua.toLowerCase())) {
      name = 'firefox';
      version = parseVersion(/(?:Firefox|FxiOS)\/([0-9.]+)/);
    } else if (/edg\//i.test(ua) || brandText.includes('edge')) {
      name = 'edge';
      version = parseVersion(/Edg\/([0-9.]+)/);
    } else if (/opr\//i.test(ua) || brandText.includes('opera')) {
      name = 'opera';
      version = parseVersion(/OPR\/([0-9.]+)/);
    } else if (/chrome|chromium/i.test(ua) || brandText.includes('chromium') || brandText.includes('chrome')) {
      name = 'chromium';
      version = parseVersion(/(?:Chrome|CriOS)\/([0-9.]+)/);
    } else if (/safari/i.test(ua)) {
      name = 'safari';
      version = parseVersion(/Version\/([0-9.]+)/);
    }

    return {
      name,
      version,
      userAgentDataSupported: !!userAgentData,
      brands,
    };
  }

  function getScreenInfo() {
    const screenRef = win().screen || (typeof screen !== 'undefined' ? screen : {});
    const orientation = screenRef.orientation || {};

    return {
      width: numOrNull(screenRef.width),
      height: numOrNull(screenRef.height),
      availWidth: numOrNull(screenRef.availWidth),
      availHeight: numOrNull(screenRef.availHeight),
      colorDepth: numOrNull(screenRef.colorDepth),
      pixelDepth: numOrNull(screenRef.pixelDepth),
      orientationType: strOrNull(orientation.type),
      orientationAngle: numOrNull(orientation.angle),
      viewportWidth: numOrNull(win().innerWidth),
      viewportHeight: numOrNull(win().innerHeight),
      devicePixelRatio: numOrNull(win().devicePixelRatio),
    };
  }

  function getHardwareInfo() {
    return {
      logicalCores: numOrNull(nav().hardwareConcurrency),
      deviceMemoryGb: numOrNull(nav().deviceMemory),
      maxTouchPoints: numOrNull(nav().maxTouchPoints),
    };
  }

  function getLocaleInfo() {
    const navigatorRef = nav();
    const language = strOrNull(navigatorRef.language);
    const languages = Array.isArray(navigatorRef.languages)
      ? navigatorRef.languages.filter((item) => typeof item === 'string' && item)
      : [];

    return {
      language,
      languages,
      timeZone: getTimeZone(),
    };
  }

  function getPreferenceInfo() {
    return {
      reducedMotion: matchMediaBool('(prefers-reduced-motion: reduce)'),
      reducedData: matchMediaBool('(prefers-reduced-data: reduce)'),
      colorScheme: matchMediaBool('(prefers-color-scheme: dark)') === true ? 'dark'
        : matchMediaBool('(prefers-color-scheme: light)') === true ? 'light'
          : null,
      coarsePointer: matchMediaBool('(pointer: coarse)'),
      hover: matchMediaBool('(hover: hover)'),
    };
  }

  function classifyDevice(platform, screenInfo, hardware, preferences) {
    const shortestScreen = Math.min(
      screenInfo.width || screenInfo.viewportWidth || 0,
      screenInfo.height || screenInfo.viewportHeight || 0
    );
    const maxTouchPoints = hardware.maxTouchPoints || 0;
    const coarsePointer = preferences.coarsePointer === true;
    const hasTouch = maxTouchPoints > 0 || coarsePointer;
    const family = platform.family;

    if (family === 'ios') {
      if (shortestScreen >= 700 || /ipad/i.test(nav().userAgent || nav().platform || '')) {
        return DEVICE_CLASSES.TABLET;
      }
      return DEVICE_CLASSES.MOBILE;
    }

    if (family === 'android') {
      return shortestScreen >= 700 ? DEVICE_CLASSES.TABLET : DEVICE_CLASSES.MOBILE;
    }

    if (platform.mobile) return DEVICE_CLASSES.MOBILE;
    if (hasTouch && shortestScreen >= 700 && preferences.hover !== true) return DEVICE_CLASSES.TABLET;
    if (family === 'windows' || family === 'macos' || family === 'linux' || family === 'chromeos') {
      return DEVICE_CLASSES.DESKTOP;
    }

    return DEVICE_CLASSES.UNKNOWN;
  }

  function getExtensionInfo() {
    try {
      const runtime = chrome?.runtime;
      const manifest = typeof runtime?.getManifest === 'function' ? runtime.getManifest() : null;
      if (!manifest) return { available: false };
      return {
        available: true,
        name: strOrNull(manifest.name),
        version: strOrNull(manifest.version),
      };
    } catch {
      return { available: false };
    }
  }

  function normalizeSeconds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return value;
  }

  function buildInfoPayload() {
    const userAgentData = getUserAgentData();
    const platform = detectPlatform(userAgentData);
    const browser = detectBrowser(userAgentData);
    const screenInfo = getScreenInfo();
    const hardware = getHardwareInfo();
    const preferences = getPreferenceInfo();

    return {
      ...timestamp(),
      deviceClass: classifyDevice(platform, screenInfo, hardware, preferences),
      platform,
      browser,
      locale: getLocaleInfo(),
      screen: screenInfo,
      hardware,
      preferences,
      extension: getExtensionInfo(),
    };
  }

  function infoOp(args = {}) {
    normalizeArgs(args);
    return buildInfoPayload();
  }

  async function powerOp(args = {}) {
    normalizeArgs(args);
    const navigatorRef = nav();
    const base = timestamp();

    if (typeof navigatorRef.getBattery !== 'function') {
      return {
        ...base,
        supported: false,
      };
    }

    try {
      const battery = await navigatorRef.getBattery();
      const level = numOrNull(battery?.level);
      const charging = boolOrNull(battery?.charging);
      return {
        ...base,
        supported: true,
        charging,
        state: charging === true ? (level === 1 ? 'charged' : 'charging')
          : charging === false ? 'discharging'
            : 'unknown',
        level,
        levelPercent: level === null ? null : Math.round(level * 100),
        chargingTimeSec: normalizeSeconds(battery?.chargingTime),
        dischargingTimeSec: normalizeSeconds(battery?.dischargingTime),
      };
    } catch (err) {
      return {
        ...base,
        supported: false,
        reason: 'battery_unavailable',
        message: err?.message || 'Battery status is unavailable',
      };
    }
  }

  const FrontierSystemModule = {
    id: 'system',
    version: '1.0.0',
    label: 'System',
    description: 'Provides coarse device, browser, locale, display, and power hints for Frontier scripts.',

    ops: {
      info: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler: infoOp,
      },
      power: {
        idempotent: 'safe',
        timeoutMs: 1500,
        handler: powerOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'System mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        ...buildInfoPayload(),
      };
    },
  };

  window.FrontierSystemModule = FrontierSystemModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierSystemModule);
  } else {
    console.warn('[System] Frontier registry not available; system module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierSystemModule;
  }
})();
