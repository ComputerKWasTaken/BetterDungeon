// BetterDungeon Custom Dynamic router.
// Runs in the page's MAIN world so it can inspect and adjust AI Dungeon requests.
// Functionality directly inspired by Zoocata's PRISM
// https://play.aidungeon.com/profile/Zoocata_

(function () {
  'use strict';

  if (window.__BetterDungeonCustomDynamicRouter) return;
  window.__BetterDungeonCustomDynamicRouter = true;

  const NAMESPACE = 'betterdungeon-custom-dynamic-v1';
  const TO_PAGE = 'extension-to-page';
  const FROM_PAGE = 'page-to-extension';

  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const NativeXHR = window.XMLHttpRequest;

  const state = {
    config: normalizeConfig(null),
    lastModelId: '',
    lastModelLabel: '',
    lastVersionName: '',
    lastVersionLabel: '',
    turnsOnModel: 0,
    requestCounter: 0,
    switchRequestCounter: 0
  };
  const pendingSwitches = new Map();

  const MODEL_KEY_RE = /^(?:model|modelid|model_id|aimodel|ai_model|storymodel|story_model|textmodel|text_model|providerModel|storyAiVersionName|aiVersionName|modelVersion|modelVersionName|versionName)$/i;
  const ACTION_KEY_RE = /^(?:action|actiontype|action_type|input|text|prompt|userinput|user_input|storyinput|story_input|command|message|mode|type)$/i;
  const ACTION_VALUE_RE = /^(?:continue|do|say|story|see|take[_ -]?action|retry|regenerate)$/i;
  const GENERATION_OPERATION_RE = /(?:generate|continue|retry|take.?action|submit.?action|perform.?action|create.?action|send.?action|story.?action|add.?action|adventure.?action|actionRequest|retryAction)/i;
  const URL_GENERATION_RE = /(?:generate|continue|retry|take.?action|story.?action|actions?\/(?:create|add|send)|(?:create|add|send)\/?actions?)/i;
  window.addEventListener('message', handleBridgeMessage, false);
  installFetchHook();
  installXhrHook();
  postToExtension('ready');

  function handleBridgeMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.namespace !== NAMESPACE || data.direction !== TO_PAGE) return;

    if (data.type === 'state') {
      state.config = normalizeConfig(data.payload?.config);
      const runtime = normalizeRuntime(data.payload?.runtime);
      state.lastModelId = String(runtime.lastModelId || state.lastModelId || '');
      state.lastModelLabel = String(runtime.lastModelLabel || state.lastModelLabel || '');
      state.lastVersionName = String(runtime.lastVersionName || state.lastVersionName || '');
      state.lastVersionLabel = String(runtime.lastVersionLabel || state.lastVersionLabel || '');
      state.turnsOnModel = Number.isInteger(runtime.turnsOnModel)
        ? runtime.turnsOnModel
        : state.turnsOnModel;
      return;
    }

    if (data.type === 'switch-model-result' && data.payload?.requestId) {
      const pending = pendingSwitches.get(data.payload.requestId);
      if (!pending) return;
      pendingSwitches.delete(data.payload.requestId);
      clearTimeout(pending.timeoutId);
      pending.resolve(data.payload);
      return;
    }

  }

  function installFetchHook() {
    if (!nativeFetch) return;

    window.fetch = async function betterDungeonCustomDynamicFetch(input, init) {
      const url = resolveUrl(input);
      if (!state.config || !isAiDungeonUrl(url)) {
        return nativeFetch(input, init);
      }

      let envelope;
      try {
        envelope = await readFetchEnvelope(input, init);
      } catch (error) {
        log('warn', 'Could not inspect an AI Dungeon request.', { error: String(error) });
        return nativeFetch(input, init);
      }

      const inspection = inspectRequest(envelope.url, envelope.method, envelope.bodyText);

      if (!inspection.isGeneration) {
        return nativeFetch(input, init);
      }

      if (!state.config.enabled) {
        return nativeFetch(input, init);
      }

      const selection = selectModel();
      if (!selection) {
        log('warn', 'Generation detected, but Custom Dynamic has no enabled pool models.', summarizeInspection(inspection));
        return nativeFetch(input, init);
      }

      const requestId = ++state.requestCounter;
      const targetVersion = selection.versionName || selection.modelId;
      let routedInput = input;
      let routedInit = init;

      try {
        const direct = rewriteEnvelopeModel(envelope, inspection, targetVersion);
        if (!selection.needsSwitch) {
          rememberSelectedModel(selection);
          if (!direct.changed) return nativeFetch(input, init);
          const rebuilt = rebuildFetch(input, init, envelope, direct.bodyText);
          return nativeFetch(rebuilt.input, rebuilt.init);
        }

        let mechanism = await applyGraphqlSwitch(selection);
        if (mechanism !== 'none' && direct.changed) {
          const rebuilt = rebuildFetch(input, init, envelope, direct.bodyText);
          routedInput = rebuilt.input;
          routedInit = rebuilt.init;
          mechanism = `${mechanism}+request-body`;
        }

        if (mechanism === 'none' && direct.changed) {
          const rebuilt = rebuildFetch(input, init, envelope, direct.bodyText);
          routedInput = rebuilt.input;
          routedInit = rebuilt.init;
          mechanism = 'request-body';
        }

        if (mechanism === 'none') {
          const details = {
            requestId,
            selectedModel: selection.modelId,
            selectedVersion: targetVersion,
            ...summarizeInspection(inspection)
          };
          log('warn', 'Custom Dynamic could not switch models; generation will use the current AI Dungeon model.', details);
          return nativeFetch(input, init);
        }

        rememberSelectedModel(selection);
        return nativeFetch(routedInput, routedInit);
      } catch (error) {
        log('error', 'Custom Dynamic routing failed.', {
          requestId,
          selectedModel: selection.modelId,
          error: String(error)
        });
        return nativeFetch(input, init);
      }
    };
  }

  function installXhrHook() {
    if (!NativeXHR?.prototype) return;

    const nativeOpen = NativeXHR.prototype.open;
    const nativeSend = NativeXHR.prototype.send;
    NativeXHR.prototype.open = function betterDungeonCustomDynamicOpen(method, url, ...rest) {
      this.__bdCustomDynamic = {
        method: String(method || 'GET').toUpperCase(),
        url: resolveUrl(url)
      };
      return nativeOpen.call(this, method, url, ...rest);
    };

    NativeXHR.prototype.send = function betterDungeonCustomDynamicSend(body) {
      const meta = this.__bdCustomDynamic || { method: 'GET', url: '' };
      if (!state.config || !isAiDungeonUrl(meta.url) || typeof body !== 'string') {
        return nativeSend.call(this, body);
      }

      const inspection = inspectRequest(meta.url, meta.method, body);

      if (!inspection.isGeneration) {
        return nativeSend.call(this, body);
      }

      if (!state.config.enabled) return nativeSend.call(this, body);

      const selection = selectModel();
      if (!selection) return nativeSend.call(this, body);

      const targetVersion = selection.versionName || selection.modelId;
      const direct = rewriteEnvelopeModel({ bodyText: body }, inspection, targetVersion);

      if (!selection.needsSwitch) {
        rememberSelectedModel(selection);
        return nativeSend.call(this, direct.changed ? direct.bodyText : body);
      }

      const xhr = this;
      void (async () => {
        let mechanism = await applyGraphqlSwitch(selection);
        let routedBody = body;

        if (direct.changed) {
          routedBody = direct.bodyText;
          mechanism = mechanism === 'none'
            ? 'request-body'
            : `${mechanism}+request-body`;
        }

        return { mechanism, routedBody };
      })()
        .then(({ mechanism, routedBody }) => {
          if (mechanism === 'none') {
            log('warn', 'Custom Dynamic could not switch models; the XHR generation will use the current AI Dungeon model.', {
              selectedModel: selection.modelId,
              selectedVersion: targetVersion
            });
            nativeSend.call(xhr, body);
            return;
          }
          rememberSelectedModel(selection);
          nativeSend.call(xhr, routedBody);
        })
        .catch((error) => {
          log('error', 'Custom Dynamic XHR routing failed.', { error: String(error) });
          nativeSend.call(xhr, body);
        });
      return undefined;
    };
  }

  function applyGraphqlSwitch(selection) {
    const versionName = cleanModelName(selection?.versionName || selection?.modelId || '');
    if (!versionName) return Promise.resolve('none');

    const requestId = `switch-${Date.now()}-${++state.switchRequestCounter}`;
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingSwitches.delete(requestId);
        resolve('none');
      }, 6500);

      pendingSwitches.set(requestId, {
        timeoutId,
        resolve: (payload) => resolve(payload?.success ? (payload.mechanism || 'graphql-settings') : 'none')
      });

      postToExtension('switch-model', {
        requestId,
        modelId: selection.modelId,
        label: selection.label,
        versionName
      });
    });
  }

  async function readFetchEnvelope(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = resolveUrl(request ? request.url : input);
    const method = String(init?.method || request?.method || 'GET').toUpperCase();
    let bodyText = null;

    if (typeof init?.body === 'string') {
      bodyText = init.body;
    } else if (init?.body instanceof URLSearchParams) {
      bodyText = init.body.toString();
    } else if (request && method !== 'GET' && method !== 'HEAD') {
      try {
        bodyText = await request.clone().text();
      } catch {
        bodyText = null;
      }
    }

    return {
      url,
      method,
      bodyText
    };
  }

  function rebuildFetch(input, init, envelope, bodyText) {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');

    if (input instanceof Request) {
      return {
        input: new Request(input, {
          ...(init || {}),
          method: envelope.method,
          headers,
          body: bodyText
        }),
        init: undefined
      };
    }

    return {
      input,
      init: {
        ...(init || {}),
        method: envelope.method,
        headers,
        body: bodyText
      }
    };
  }

  function inspectRequest(url, method, bodyText) {
    const parsedBody = parseBody(bodyText);
    const parsed = parsedBody.data;
    const operation = parsed ? findOperationName(parsed) : '';
    const modelFields = parsed ? findModelFields(parsed) : [];
    const actionSignals = parsed ? findActionSignals(parsed) : [];
    let generationScore = 0;

    if (URL_GENERATION_RE.test(url)) generationScore += 4;
    if (GENERATION_OPERATION_RE.test(operation)) generationScore += 6;
    if (actionSignals.some((item) => ACTION_VALUE_RE.test(String(item.value || '')))) generationScore += 3;
    if (actionSignals.some((item) => /input|prompt|command|message|text/i.test(item.key))) generationScore += 1;

    return {
      url,
      method,
      bodyText,
      bodyFormat: parsedBody.format,
      parsed,
      operation,
      modelFields,
      generationScore,
      isGeneration: generationScore >= 5
    };
  }

  function parseBody(bodyText) {
    if (!bodyText || typeof bodyText !== 'string') return { data: null, format: 'none' };
    const trimmed = bodyText.trim();
    if (!trimmed) return { data: null, format: 'none' };
    try {
      return { data: JSON.parse(trimmed), format: 'json' };
    } catch {
      // Some clients wrap GraphQL payloads in form data. We can inspect these,
      // but request-body rewriting is intentionally limited to JSON bodies.
      try {
        const params = new URLSearchParams(trimmed);
        const data = {};
        let count = 0;
        for (const [key, value] of params.entries()) {
          data[key] = tryJson(value);
          count += 1;
        }
        return count ? { data, format: 'form' } : { data: null, format: 'none' };
      } catch {
        return { data: null, format: 'none' };
      }
    }
  }

  function tryJson(value) {
    try { return JSON.parse(value); } catch { return value; }
  }

  function findOperationName(root) {
    const direct = root && typeof root === 'object' ? root.operationName : null;
    if (typeof direct === 'string' && direct) return direct;

    const query = root && typeof root === 'object' && typeof root.query === 'string' ? root.query : '';
    const queryMatch = /\b(?:mutation|query)\s+([A-Za-z0-9_]+)/.exec(query);
    if (queryMatch) return queryMatch[1];

    let found = '';
    walk(root, [], (key, value) => {
      if (found || typeof value !== 'string') return;
      if (/^(?:operationName|operation|type|event|name)$/i.test(key) && GENERATION_OPERATION_RE.test(value)) {
        found = value;
      }
    });
    return found;
  }

  function findModelFields(root) {
    const results = [];
    walk(root, [], (key, value, path) => {
      if (MODEL_KEY_RE.test(key) && ['string', 'number'].includes(typeof value)) {
        results.push({ key, value: String(value), pathArray: [...path] });
      }
    });
    return results;
  }

  function findActionSignals(root) {
    const results = [];
    walk(root, [], (key, value) => {
      if (!ACTION_KEY_RE.test(key)) return;
      if (!['string', 'number', 'boolean'].includes(typeof value)) return;
      results.push({ key, value: String(value) });
    });
    return results.slice(0, 40);
  }

  function selectModel() {
    const candidates = (state.config.pool || [])
      .filter((model) => model.enabled !== false && model.modelId)
      .map((model) => ({
        ...model,
        versionName: cleanModelName(model.versionName || model.modelId),
        score: Math.max(0.01, Number(model.weight) || 1)
      }));

    if (!candidates.length) return null;

    const active = candidates.find((model) =>
      sameModel(model.modelId, state.lastModelId)
      && sameModel(model.versionName, state.lastVersionName || state.lastModelId)
    );
    const turnInterval = state.config.turnInterval;
    if (active && state.turnsOnModel > 0 && state.turnsOnModel < turnInterval) {
      return {
        ...active,
        needsSwitch: false,
        turnsOnModel: state.turnsOnModel + 1
      };
    }

    const selected = randomWeighted(candidates);
    const alreadyActive = active && sameModel(selected.versionName, active.versionName);
    return {
      ...selected,
      needsSwitch: !alreadyActive,
      turnsOnModel: 1
    };
  }

  function randomWeighted(items) {
    const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.score) || 0), 0);
    if (total <= 0) return items[Math.floor(Math.random() * items.length)];
    let cursor = Math.random() * total;
    for (const item of items) {
      cursor -= Math.max(0, Number(item.score) || 0);
      if (cursor <= 0) return item;
    }
    return items[items.length - 1];
  }

  function rewriteEnvelopeModel(envelope, inspection, modelId) {
    if (inspection.bodyFormat !== 'json' || !inspection.parsed || !inspection.modelFields.length) {
      return { changed: false, bodyText: envelope.bodyText };
    }

    const writableFields = selectWritableModelFields(inspection.modelFields);
    if (!writableFields.length) return { changed: false, bodyText: envelope.bodyText };

    const cloned = structuredCloneSafe(inspection.parsed);
    let changed = false;
    for (const field of writableFields) {
      if (setAtPath(cloned, field.pathArray, modelId)) changed = true;
    }

    return {
      changed,
      bodyText: changed ? JSON.stringify(cloned) : envelope.bodyText
    };
  }

  function selectWritableModelFields(fields) {
    const poolIds = new Set((state.config?.pool || []).flatMap((model) => [
      canonicalModelName(model.modelId),
      canonicalModelName(model.versionName)
    ]).filter(Boolean));
    const safe = fields.filter((field) => !/(?:image|embedding|memory|summary|summarizer|moderation|safety|voice|audio|narration)/i.test(field.key));
    const currentPoolValue = safe.filter((field) => poolIds.has(canonicalModelName(field.value)));
    if (currentPoolValue.length) return currentPoolValue.slice(0, 1);
    const storyLike = safe.filter((field) => /(?:story|text|ai|provider).*model|model.*(?:story|text|ai|provider)/i.test(field.key));
    if (storyLike.length) return storyLike.slice(0, 1);
    return safe.length === 1 ? safe : [];
  }

  function rememberSelectedModel(selection) {
    state.lastModelId = cleanModelName(selection.modelId);
    state.lastModelLabel = cleanModelName(selection.label || selection.modelId);
    state.lastVersionName = cleanModelName(selection.versionName || selection.modelId);
    state.lastVersionLabel = cleanModelName(selection.versionLabel || selection.versionName || selection.modelId);
    state.turnsOnModel = clampInteger(selection.turnsOnModel, 1, 1, 1000000);
    emitRuntime({
      kind: 'selection-state',
      modelId: state.lastModelId,
      label: state.lastModelLabel,
      versionName: state.lastVersionName,
      versionLabel: state.lastVersionLabel,
      turnsOnModel: state.turnsOnModel
    });
  }

  function walk(value, path, visitor, depth = 0) {
    if (depth > 14 || value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index], visitor, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key];
      visitor(key, child, nextPath);
      walk(child, nextPath, visitor, depth + 1);
    }
  }

  function setAtPath(root, path, value) {
    if (!root || !Array.isArray(path) || !path.length) return false;
    let cursor = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      const segment = path[index];
      if (cursor == null || typeof cursor !== 'object' || !(segment in cursor)) return false;
      cursor = cursor[segment];
    }
    const final = path[path.length - 1];
    if (cursor == null || typeof cursor !== 'object' || !(final in cursor)) return false;
    cursor[final] = value;
    return true;
  }

  function normalizeConfig(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      enabled: Boolean(raw.enabled),
      turnInterval: clampInteger(raw.turnInterval, 1, 1, 20),
      pool: Array.isArray(raw.pool) ? raw.pool.map((model) => ({
        enabled: model?.enabled !== false,
        modelId: cleanModelName(model?.modelId || model?.id || ''),
        label: cleanModelName(model?.label || model?.modelId || model?.id || ''),
        versionName: cleanModelName(model?.versionName || model?.modelId || model?.id || ''),
        versionLabel: cleanModelName(model?.versionLabel || model?.versionName || model?.modelId || model?.id || ''),
        weight: clampNumber(model?.weight, 1, 0.01, 100)
      })).filter((model) => model.modelId) : []
    };
  }

  function normalizeRuntime(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      lastModelId: cleanModelName(raw.lastModelId || ''),
      lastModelLabel: cleanModelName(raw.lastModelLabel || raw.lastModelId || ''),
      lastVersionName: cleanModelName(raw.lastVersionName || raw.lastModelId || ''),
      lastVersionLabel: cleanModelName(raw.lastVersionLabel || raw.lastVersionName || raw.lastModelId || ''),
      turnsOnModel: clampInteger(raw.turnsOnModel, 0, 0, 1000000)
    };
  }

  function cleanModelName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function canonicalModelName(value) {
    return cleanModelName(value)
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/[\u00A0\u202F]/g, ' ')
      .replace(/[\u2010-\u2015]/g, '-')
      .toLowerCase();
  }

  function sameModel(left, right) {
    const a = canonicalModelName(left);
    const b = canonicalModelName(right);
    if (!a || !b) return false;
    return a === b || a.replace(/[^a-z0-9]+/g, '') === b.replace(/[^a-z0-9]+/g, '');
  }

  function resolveUrl(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input || '');
      return new URL(raw, window.location.href).href;
    } catch {
      return String(input || '');
    }
  }

  function isAiDungeonUrl(url) {
    try {
      const host = new URL(url, window.location.href).hostname.toLowerCase();
      return host === 'aidungeon.com' || host.endsWith('.aidungeon.com')
        || host === 'aidungeon.io' || host.endsWith('.aidungeon.io')
        || host === 'latitude.io' || host.endsWith('.latitude.io');
    } catch {
      return false;
    }
  }

  function summarizeInspection(inspection) {
    return {
      url: inspection.url,
      method: inspection.method,
      operation: inspection.operation,
      generationScore: inspection.generationScore
    };
  }

  function structuredCloneSafe(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function clampInteger(value, fallback, min, max) {
    return Math.round(clampNumber(value, fallback, min, max));
  }

  function log(level, message, details = null) {
    if (!['warn', 'error'].includes(level)) return;
    console[level]('[BetterDungeon Custom Dynamic]', message, details || '');
  }

  function emitRuntime(payload) {
    postToExtension('runtime-event', payload);
  }

  function postToExtension(type, payload = null) {
    window.postMessage({
      namespace: NAMESPACE,
      direction: FROM_PAGE,
      type,
      payload
    }, window.location.origin);
  }
})();
