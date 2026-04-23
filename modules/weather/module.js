// modules/weather/module.js
//
// Frontier weather module. Provides streamlined current weather and forecast
// lookups without forcing scripts to hand-roll WebFetch calls.

(function () {
  if (window.FrontierWeatherModule) return;

  const DEFAULT_TIMEOUT_MS = 15000;
  const MAX_TIMEOUT_MS = 30000;
  const DEFAULT_FORECAST_DAYS = 3;
  const MAX_FORECAST_DAYS = 7;

  const WEATHER_LABELS = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgs('args must be an object');
    }
    return args;
  }

  function normalizeUnits(value) {
    const units = String(value || 'metric').trim().toLowerCase();
    if (units !== 'metric' && units !== 'imperial') {
      throw invalidArgs("units must be 'metric' or 'imperial'");
    }
    return {
      kind: units,
      temperatureUnit: units === 'imperial' ? 'fahrenheit' : 'celsius',
      windSpeedUnit: units === 'imperial' ? 'mph' : 'kmh',
      precipitationUnit: units === 'imperial' ? 'inch' : 'mm',
    };
  }

  function normalizeLatitude(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < -90 || n > 90) {
      throw invalidArgs('latitude must be a number between -90 and 90');
    }
    return n;
  }

  function normalizeLongitude(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < -180 || n > 180) {
      throw invalidArgs('longitude must be a number between -180 and 180');
    }
    return n;
  }

  function normalizeTimeoutMs(value) {
    return clampNumber(value, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
  }

  function backgroundFetch(request) {
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) {
      return browser.runtime
        .sendMessage({ type: 'FRONTIER_WEBFETCH_FETCH', request })
        .then((response) => unwrapBackgroundResponse(response));
    }

    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
    if (!runtime?.sendMessage) {
      return Promise.reject({ code: 'weather_unavailable', message: 'Extension runtime is unavailable' });
    }

    const message = { type: 'FRONTIER_WEBFETCH_FETCH', request };
    return new Promise((resolve, reject) => {
      runtime.sendMessage(message, (response) => {
        const lastError = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (lastError) {
          reject({ code: 'weather_unavailable', message: lastError.message || 'Background fetch failed' });
          return;
        }
        try {
          resolve(unwrapBackgroundResponse(response));
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  function unwrapBackgroundResponse(response) {
    if (response?.ok) return response.data;
    throw response?.error || { code: 'weather_failed', message: 'Background fetch failed' };
  }

  async function fetchJson(url, timeoutMs) {
    const response = await backgroundFetch({
      url,
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeoutMs,
      maxBodyBytes: 80000,
    });

    if (response.status < 200 || response.status >= 300) {
      throw {
        code: 'upstream_error',
        message: `Weather upstream returned status ${response.status}`,
        status: response.status,
      };
    }

    if (response.bodyEncoding !== 'text') {
      throw {
        code: 'weather_failed',
        message: 'Weather upstream returned a non-text response',
      };
    }

    try {
      return JSON.parse(response.body || '{}');
    } catch {
      throw {
        code: 'weather_failed',
        message: 'Weather upstream returned invalid JSON',
      };
    }
  }

  function buildLocationResult(coordinates, apiPayload) {
    return {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      name: coordinates.name || '',
      admin1: coordinates.admin1 || '',
      country: coordinates.country || '',
      timezone: apiPayload?.timezone || coordinates.timezone || '',
      elevation: typeof apiPayload?.elevation === 'number' ? apiPayload.elevation : null,
    };
  }

  async function resolveLocation(args, timeoutMs) {
    const hasLat = args.latitude !== undefined && args.latitude !== null && args.latitude !== '';
    const hasLon = args.longitude !== undefined && args.longitude !== null && args.longitude !== '';
    const place = String(args.place || '').trim();

    if (hasLat || hasLon) {
      if (!hasLat || !hasLon) {
        throw invalidArgs('latitude and longitude must be provided together');
      }
      return {
        latitude: normalizeLatitude(args.latitude),
        longitude: normalizeLongitude(args.longitude),
        name: '',
        admin1: '',
        country: '',
      };
    }

    if (!place) {
      throw invalidArgs('latitude/longitude or place is required');
    }

    const geocodeUrl =
      'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
      encodeURIComponent(place);
    const payload = await fetchJson(geocodeUrl, timeoutMs);
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (!first) {
      throw {
        code: 'not_found',
        message: `No weather location match found for '${place}'`,
      };
    }

    return {
      latitude: normalizeLatitude(first.latitude),
      longitude: normalizeLongitude(first.longitude),
      name: first.name || '',
      admin1: first.admin1 || '',
      country: first.country || '',
      timezone: first.timezone || '',
    };
  }

  function weatherLabel(code) {
    return WEATHER_LABELS[code] || 'Unknown';
  }

  function formatCurrentResult(location, payload, units) {
    const current = payload?.current || {};
    return {
      location: buildLocationResult(location, payload),
      units: units.kind,
      source: 'open-meteo',
      current: {
        observedAt: current.time || '',
        temperature: typeof current.temperature_2m === 'number' ? current.temperature_2m : null,
        apparentTemperature: typeof current.apparent_temperature === 'number' ? current.apparent_temperature : null,
        relativeHumidity: typeof current.relative_humidity_2m === 'number' ? current.relative_humidity_2m : null,
        windSpeed: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : null,
        windDirection: typeof current.wind_direction_10m === 'number' ? current.wind_direction_10m : null,
        isDay: current.is_day === 1,
        weatherCode: typeof current.weather_code === 'number' ? current.weather_code : null,
        weather: weatherLabel(current.weather_code),
      },
    };
  }

  function formatForecastResult(location, payload, units) {
    const daily = payload?.daily || {};
    const times = Array.isArray(daily.time) ? daily.time : [];
    const days = [];

    for (let i = 0; i < times.length; i += 1) {
      days.push({
        date: daily.time[i] || '',
        weatherCode: typeof daily.weather_code?.[i] === 'number' ? daily.weather_code[i] : null,
        weather: weatherLabel(daily.weather_code?.[i]),
        temperatureMax: typeof daily.temperature_2m_max?.[i] === 'number' ? daily.temperature_2m_max[i] : null,
        temperatureMin: typeof daily.temperature_2m_min?.[i] === 'number' ? daily.temperature_2m_min[i] : null,
        precipitationSum: typeof daily.precipitation_sum?.[i] === 'number' ? daily.precipitation_sum[i] : null,
        precipitationProbabilityMax: typeof daily.precipitation_probability_max?.[i] === 'number'
          ? daily.precipitation_probability_max[i]
          : null,
        windSpeedMax: typeof daily.wind_speed_10m_max?.[i] === 'number' ? daily.wind_speed_10m_max[i] : null,
        sunrise: daily.sunrise?.[i] || '',
        sunset: daily.sunset?.[i] || '',
      });
    }

    return {
      location: buildLocationResult(location, payload),
      units: units.kind,
      source: 'open-meteo',
      days,
    };
  }

  async function currentOp(args = {}, ctx) {
    const normalized = normalizeArgs(args);
    const timeoutMs = normalizeTimeoutMs(normalized.timeoutMs);
    const units = normalizeUnits(normalized.units);
    const location = await resolveLocation(normalized, timeoutMs);

    const url =
      'https://api.open-meteo.com/v1/forecast?' +
      'latitude=' + encodeURIComponent(location.latitude) +
      '&longitude=' + encodeURIComponent(location.longitude) +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day' +
      '&timezone=auto' +
      '&temperature_unit=' + encodeURIComponent(units.temperatureUnit) +
      '&wind_speed_unit=' + encodeURIComponent(units.windSpeedUnit) +
      '&precipitation_unit=' + encodeURIComponent(units.precipitationUnit);

    const payload = await fetchJson(url, timeoutMs);
    const result = formatCurrentResult(location, payload, units);
    ctx?.log?.('debug', 'Weather current completed', result.location.latitude, result.location.longitude);
    return result;
  }

  async function forecastOp(args = {}, ctx) {
    const normalized = normalizeArgs(args);
    const timeoutMs = normalizeTimeoutMs(normalized.timeoutMs);
    const units = normalizeUnits(normalized.units);
    const days = clampNumber(normalized.days, DEFAULT_FORECAST_DAYS, 1, MAX_FORECAST_DAYS);
    const location = await resolveLocation(normalized, timeoutMs);

    const url =
      'https://api.open-meteo.com/v1/forecast?' +
      'latitude=' + encodeURIComponent(location.latitude) +
      '&longitude=' + encodeURIComponent(location.longitude) +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset' +
      '&forecast_days=' + encodeURIComponent(days) +
      '&timezone=auto' +
      '&temperature_unit=' + encodeURIComponent(units.temperatureUnit) +
      '&wind_speed_unit=' + encodeURIComponent(units.windSpeedUnit) +
      '&precipitation_unit=' + encodeURIComponent(units.precipitationUnit);

    const payload = await fetchJson(url, timeoutMs);
    const result = formatForecastResult(location, payload, units);
    ctx?.log?.('debug', 'Weather forecast completed', result.location.latitude, result.location.longitude, days);
    return result;
  }

  const FrontierWeatherModule = {
    id: 'weather',
    version: '1.0.0',
    label: 'Weather',
    description: 'Provides streamlined current-weather and forecast lookups for Frontier scripts.',

    ops: {
      current: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS,
        handler: currentOp,
      },
      forecast: {
        idempotent: 'safe',
        timeoutMs: MAX_TIMEOUT_MS,
        handler: forecastOp,
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      ctx.log('debug', 'Weather mounted');
    },

    unmount() {
      this._ctx = null;
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        ops: Object.keys(this.ops),
        provider: 'open-meteo',
      };
    },
  };

  window.FrontierWeatherModule = FrontierWeatherModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(FrontierWeatherModule);
  } else {
    console.warn('[Weather] Frontier registry not available; weather module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrontierWeatherModule;
  }
})();
