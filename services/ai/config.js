// Shared configuration and routing catalog. No credentials belong in diagnostics.
(function (root) {
  'use strict';
  const KEY = 'betterdungeon_ai_config_v2';
  const LEGACY_KEY = 'ultrascripts_ai_endpoint_config_v1';
  const consumers = ['navigator', 'ultrascripts', 'characterPresets', 'ambience'];
  const flash = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const gemma = ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
  const mistral = [
    { id: 'mistral-large-2512', label: 'Mistral Large 3', context: 256000, tpm: 250000, rps: 1 },
    { id: 'ministral-14b-2512', label: 'Ministral 3 14B', context: 256000, tpm: 937500, rps: 0.5 },
    { id: 'ministral-8b-2512', label: 'Ministral 3 8B', context: 256000, tpm: 625000, rps: 3.13 },
    { id: 'ministral-3b-2512', label: 'Ministral 3 3B', context: 256000, tpm: 1300000, rps: 12.5 },
  ];
  const urls = { gemini: 'https://generativelanguage.googleapis.com/v1beta', openrouter: 'https://openrouter.ai/api/v1', mistral: 'https://api.mistral.ai/v1' };
  const trim = v => typeof v === 'string' ? v.trim() : '';
  const consumerId = v => v === 'character-presets' || v === 'characterpresets' ? 'characterPresets' : consumers.includes(v) ? v : 'ultrascripts';
  function normalize(raw = {}) {
    const a = raw.advanced || {}, p = a.profiles || {};
    const profile = name => ({ apiKey: trim(p[name]?.apiKey), model: trim(p[name]?.model) });
    const cap = Number(a.inputCapTokens || 0);
    return {
      version: 2,
      simple: { apiKey: trim(raw.simple?.apiKey), quotaStrategy: raw.simple?.quotaStrategy === 'shared' ? 'shared' : 'separated' },
      advanced: {
        enabled: a.enabled === true,
        activeService: ['openrouter', 'mistral', 'custom'].includes(a.activeService) ? a.activeService : 'openrouter',
        inputCapTokens: Number.isSafeInteger(cap) && cap >= 0 && cap <= 2000000 ? cap : 0,
        profiles: {
          openrouter: profile('openrouter'),
          mistral: { ...profile('mistral'), modelMode: p.mistral?.modelMode === 'pinned' ? 'pinned' : 'auto' },
          custom: { ...profile('custom'), baseUrl: trim(p.custom?.baseUrl).replace(/\/+$/, '') },
        },
      },
      routing: Object.fromEntries(consumers.map(c => [c, raw.routing?.[c] === 'advanced' ? 'advanced' : 'simple'])),
    };
  }
  function migrate(old = {}) {
    const enabled = ['openrouter', 'custom'].includes(old.activeService);
    return normalize({
      simple: { apiKey: old.profiles?.gemini?.apiKey },
      advanced: { enabled, activeService: old.activeService, inputCapTokens: old.inputCapTokens, profiles: old.profiles },
      routing: Object.fromEntries(consumers.map(c => [c, enabled ? 'advanced' : 'simple'])),
    });
  }
  function publicConfig(config) {
    const copy = normalize(config);
    for (const profile of [copy.simple, ...Object.values(copy.advanced.profiles)]) {
      profile.keyConfigured = !!profile.apiKey;
      delete profile.apiKey;
    }
    return copy;
  }
  function settings(config, tier) {
    if (tier === 'simple') return { tier, service: 'gemini', apiKey: config.simple.apiKey, baseUrl: urls.gemini, configured: !!config.simple.apiKey };
    const service = config.advanced.activeService;
    const p = config.advanced.profiles[service];
    const baseUrl = urls[service] || p.baseUrl;
    let validUrl = false;
    try { const u = new URL(baseUrl); validUrl = u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; } catch { /* invalid configuration */ }
    return { ...p, tier, service, baseUrl, configured: validUrl && (service === 'custom' || !!p.apiKey) && (service === 'mistral' && p.modelMode === 'auto' || !!p.model) };
  }
  function models(config, tier, consumer, estimatedTokens) {
    if (tier === 'advanced') {
      const s = settings(config, tier);
      return s.service === 'mistral' && s.modelMode === 'auto' ? mistral.map(m => m.id) : [s.model];
    }
    const utility = ['characterPresets', 'ambience'].includes(consumerId(consumer));
    const preferred = utility ? gemma : flash;
    const fallback = utility ? flash : gemma;
    return [...preferred, ...(config.simple.quotaStrategy === 'shared' ? fallback : [])]
      .filter(id => !(consumerId(consumer) === 'navigator' && gemma.includes(id) && estimatedTokens > 12000));
  }
  const availabilityErrors = new Set(['not_configured', 'auth_failed', 'rate_limit', 'provider_limit', 'timeout', 'network_failed', 'backend_failed', 'unavailable', 'invalid_response', 'model_unavailable']);
  function redactError(error, config) {
    let message = String(error?.message || 'AI request failed.');
    for (const p of [config?.simple, ...Object.values(config?.advanced?.profiles || {})]) {
      if (p?.apiKey) message = message.split(p.apiKey).join('[redacted]');
    }
    return { code: error?.code || 'backend_failed', message, retryable: availabilityErrors.has(error?.code),
      ...(Number.isFinite(error?.retryAfterMs) ? { retryAfterMs: error.retryAfterMs } : {}),
      ...(error?.attemptedModels ? { attemptedModels: error.attemptedModels } : {}) };
  }
  const api = { KEY, LEGACY_KEY, consumers, flash, gemma, mistral, urls, normalize, migrate, publicConfig, consumerId, settings, models, availabilityErrors, redactError };
  for (const value of [flash, gemma, consumers, ...mistral, mistral, urls]) Object.freeze(value);
  root.BetterDungeonAIConfig = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
