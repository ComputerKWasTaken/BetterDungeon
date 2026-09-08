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
  const MODEL_SWITCHER_SELECTOR = '[aria-label="Model Switcher"]';
  const INDICATOR_STYLE_ID = 'bd-custom-dynamic-indicator-style';
  const INDICATOR_ACTIVE_ATTRIBUTE = 'data-bd-custom-dynamic-active';
  const INDICATOR_ATTRIBUTE = 'data-bd-custom-dynamic-model-indicator';
  const INDICATOR_IMAGE_ATTRIBUTE = 'data-bd-custom-dynamic-model-image';
  const INDICATOR_LABEL_ATTRIBUTE = 'data-bd-custom-dynamic-model-label';
  const NATIVE_ICON_ATTRIBUTE = 'data-bd-custom-dynamic-native-model-icon';
  const SWITCHER_ATTRIBUTE = 'data-bd-custom-dynamic-model-switcher';
  const ORIGINAL_TITLE_ATTRIBUTE = 'data-bd-custom-dynamic-original-title';
  const ORIGINAL_TITLE_PRESENT_ATTRIBUTE = 'data-bd-custom-dynamic-original-title-present';

  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const NativeXHR = window.XMLHttpRequest;

  const state = {
    config: normalizeConfig(null),
    lastModelId: '',
    lastModelLabel: '',
    lastVersionName: '',
    lastVersionLabel: '',
    indicatorLogoUrl: '',
    turnsOnModel: 0,
    requestCounter: 0,
    switchRequestCounter: 0
  };
  const pendingSwitches = new Map();
  let indicatorSyncQueued = false;

  const MODEL_KEY_RE = /^(?:model|modelid|model_id|aimodel|ai_model|storymodel|story_model|textmodel|text_model|providerModel|storyAiVersionName|aiVersionName|modelVersion|modelVersionName|versionName)$/i;
  const ACTION_KEY_RE = /^(?:action|actiontype|action_type|input|text|prompt|userinput|user_input|storyinput|story_input|command|message|mode|type)$/i;
  const ACTION_VALUE_RE = /^(?:continue|do|say|story|guide|see|take[_ -]?action|retry|regenerate)$/i;
  const GENERATION_OPERATION_RE = /(?:generate|continue|retry|take.?action|submit.?action|perform.?action|create.?action|send.?action|story.?action|add.?action|adventure.?action|actionRequest|retryAction)/i;
  const URL_GENERATION_RE = /(?:generate|continue|retry|take.?action|story.?action|actions?\/(?:create|add|send)|(?:create|add|send)\/?actions?)/i;
  window.addEventListener('message', handleBridgeMessage, false);
  installRoutedModelIndicator();
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
      state.indicatorLogoUrl = normalizeIndicatorLogoUrl(data.payload?.indicatorLogoUrl);
      state.turnsOnModel = Number.isInteger(runtime.turnsOnModel)
        ? runtime.turnsOnModel
        : state.turnsOnModel;
      scheduleRoutedModelIndicatorSync();
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

  function installRoutedModelIndicator() {
    ensureRoutedModelIndicatorStyle();

    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      const observer = new MutationObserver((records) => {
        if (!document.getElementById(INDICATOR_STYLE_ID) || records.some(mutationTouchesModelSwitcher)) {
          scheduleRoutedModelIndicatorSync();
        }
      });
      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-label']
      });
    }

    scheduleRoutedModelIndicatorSync();
  }

  function ensureRoutedModelIndicatorStyle() {
    if (typeof document === 'undefined' || document.getElementById(INDICATOR_STYLE_ID)) return;
    const host = document.head || document.documentElement;
    if (!host) return;

    const style = document.createElement('style');
    style.id = INDICATOR_STYLE_ID;
    style.textContent = `
      html[${INDICATOR_ACTIVE_ATTRIBUTE}="true"] [${NATIVE_ICON_ATTRIBUTE}="true"] {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        background-image: none !important;
        mask-image: none !important;
        -webkit-mask-image: none !important;
      }

      [${SWITCHER_ATTRIBUTE}="true"] {
        position: relative !important;
        overflow: visible !important;
      }

      [${INDICATOR_ATTRIBUTE}="true"] {
        display: flex !important;
        position: absolute !important;
        inset: 0 !important;
        align-items: center !important;
        justify-content: center !important;
        width: 100% !important;
        height: 100% !important;
        pointer-events: none !important;
        overflow: visible !important;
        z-index: 101 !important;
      }

      [${INDICATOR_IMAGE_ATTRIBUTE}="true"] {
        display: block !important;
        width: 27px !important;
        height: 27px !important;
        border-radius: 7px !important;
        object-fit: cover !important;
        object-position: center !important;
        box-shadow: 0 2px 8px rgba(232, 133, 10, .28) !important;
      }

      [${INDICATOR_LABEL_ATTRIBUTE}="true"] {
        display: block !important;
        position: absolute !important;
        top: calc(100% + 7px) !important;
        right: 0 !important;
        max-width: min(280px, calc(100vw - 24px)) !important;
        padding: 6px 9px !important;
        box-sizing: border-box !important;
        border: 1px solid rgba(255, 255, 255, .13) !important;
        border-radius: 6px !important;
        background: rgba(15, 14, 17, .96) !important;
        box-shadow: 0 5px 18px rgba(0, 0, 0, .38) !important;
        color: #f4f4f5 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        line-height: 1.35 !important;
        letter-spacing: 0 !important;
        text-align: left !important;
        text-transform: none !important;
        white-space: nowrap !important;
        opacity: 0 !important;
        visibility: hidden !important;
        transform: translateY(-2px) !important;
        transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease !important;
        z-index: 2147483646 !important;
      }

      [${SWITCHER_ATTRIBUTE}="true"]:hover [${INDICATOR_LABEL_ATTRIBUTE}="true"],
      [${SWITCHER_ATTRIBUTE}="true"]:focus-visible [${INDICATOR_LABEL_ATTRIBUTE}="true"] {
        opacity: 1 !important;
        visibility: visible !important;
        transform: translateY(0) !important;
      }

    `;
    host.appendChild(style);
  }

  function scheduleRoutedModelIndicatorSync() {
    if (indicatorSyncQueued) return;
    indicatorSyncQueued = true;
    queueMicrotask(() => {
      indicatorSyncQueued = false;
      syncRoutedModelIndicator();
    });
  }

  function mutationTouchesModelSwitcher(record) {
    const target = record?.target;
    if (isModelSwitcherElement(target)
      || target?.hasAttribute?.(SWITCHER_ATTRIBUTE)
      || target?.closest?.(MODEL_SWITCHER_SELECTOR)) return true;
    for (const node of record?.addedNodes || []) {
      if (isModelSwitcherElement(node)
        || node?.closest?.(MODEL_SWITCHER_SELECTOR)
        || node?.querySelector?.(MODEL_SWITCHER_SELECTOR)) return true;
    }
    return false;
  }

  function isModelSwitcherElement(value) {
    return Boolean(value?.matches?.(MODEL_SWITCHER_SELECTOR));
  }

  function syncRoutedModelIndicator() {
    if (typeof document === 'undefined') return;
    ensureRoutedModelIndicatorStyle();

    const presentation = getRoutedModelPresentation();
    const active = Boolean(state.indicatorLogoUrl && presentation && isLastRoutedModelInPool());
    const root = document.documentElement;
    if (active) root?.setAttribute(INDICATOR_ACTIVE_ATTRIBUTE, 'true');
    else root?.removeAttribute(INDICATOR_ACTIVE_ATTRIBUTE);

    const switchers = Array.from(document.querySelectorAll(MODEL_SWITCHER_SELECTOR));
    const currentSwitchers = new Set(switchers);
    for (const markedSwitcher of document.querySelectorAll(`[${SWITCHER_ATTRIBUTE}="true"]`)) {
      if (!active || !currentSwitchers.has(markedSwitcher)) restoreModelSwitcher(markedSwitcher);
    }

    if (!active) {
      for (const nativeIcon of document.querySelectorAll(`[${NATIVE_ICON_ATTRIBUTE}="true"]`)) {
        nativeIcon.removeAttribute(NATIVE_ICON_ATTRIBUTE);
      }
      for (const indicator of document.querySelectorAll(`[${INDICATOR_ATTRIBUTE}="true"]`)) {
        indicator.remove();
      }
      return;
    }

    for (const switcher of switchers) {
      switcher.setAttribute(SWITCHER_ATTRIBUTE, 'true');
      rememberAndClearSwitcherTitle(switcher);

      const nativeIcon = findNativeModelIcon(switcher);
      let indicator = switcher.querySelector(`[${INDICATOR_ATTRIBUTE}="true"]`);
      if (!nativeIcon && !indicator) continue;
      if (nativeIcon) nativeIcon.setAttribute(NATIVE_ICON_ATTRIBUTE, 'true');

      if (!indicator) {
        indicator = document.createElement('span');
        indicator.setAttribute(INDICATOR_ATTRIBUTE, 'true');
        indicator.setAttribute('aria-hidden', 'true');

        const image = document.createElement('img');
        image.setAttribute(INDICATOR_IMAGE_ATTRIBUTE, 'true');
        image.setAttribute('alt', '');
        image.setAttribute('draggable', 'false');
        const label = document.createElement('span');
        label.setAttribute(INDICATOR_LABEL_ATTRIBUTE, 'true');
        indicator.append(image, label);
        switcher.appendChild(indicator);
      }

      const image = indicator.querySelector(`[${INDICATOR_IMAGE_ATTRIBUTE}="true"]`);
      const label = indicator.querySelector(`[${INDICATOR_LABEL_ATTRIBUTE}="true"]`);
      if (image && image.getAttribute('src') !== state.indicatorLogoUrl) {
        image.setAttribute('src', state.indicatorLogoUrl);
      }
      if (label && label.textContent !== presentation.description) label.textContent = presentation.description;
    }
  }

  function findNativeModelIcon(switcher) {
    const image = switcher?.querySelector?.(`img:not([${INDICATOR_IMAGE_ATTRIBUTE}])`);
    if (image) return image;

    const candidates = switcher?.querySelectorAll?.(
      `[aria-label][style*="mask-image"], [aria-label][style*="-webkit-mask-image"]`
    ) || [];
    return Array.from(candidates).find((element) => {
      if (element.closest?.(`[${INDICATOR_ATTRIBUTE}="true"]`)) return false;
      return !/^(?:Model Switcher|Undo change|Redo change|Settings|Game settings)$/i.test(
        cleanModelName(element.getAttribute?.('aria-label'))
      );
    }) || null;
  }

  function rememberAndClearSwitcherTitle(switcher) {
    if (!switcher.hasAttribute(ORIGINAL_TITLE_PRESENT_ATTRIBUTE)) {
      switcher.setAttribute(
        ORIGINAL_TITLE_PRESENT_ATTRIBUTE,
        switcher.hasAttribute('title') ? 'true' : 'false'
      );
      switcher.setAttribute(ORIGINAL_TITLE_ATTRIBUTE, switcher.getAttribute('title') || '');
    }
    switcher.removeAttribute('title');
  }

  function restoreModelSwitcher(switcher) {
    if (!switcher?.removeAttribute) return;
    const hadTitle = switcher.getAttribute(ORIGINAL_TITLE_PRESENT_ATTRIBUTE) === 'true';
    const originalTitle = switcher.getAttribute(ORIGINAL_TITLE_ATTRIBUTE) || '';
    if (hadTitle) switcher.setAttribute('title', originalTitle);
    else switcher.removeAttribute('title');
    switcher.removeAttribute(ORIGINAL_TITLE_ATTRIBUTE);
    switcher.removeAttribute(ORIGINAL_TITLE_PRESENT_ATTRIBUTE);
    switcher.removeAttribute(SWITCHER_ATTRIBUTE);
    for (const nativeIcon of switcher.querySelectorAll?.(`[${NATIVE_ICON_ATTRIBUTE}="true"]`) || []) {
      nativeIcon.removeAttribute(NATIVE_ICON_ATTRIBUTE);
    }
    for (const indicator of switcher.querySelectorAll?.(`[${INDICATOR_ATTRIBUTE}="true"]`) || []) {
      indicator.remove();
    }
  }

  function getRoutedModelPresentation() {
    const model = cleanModelName(state.lastModelLabel || state.lastModelId || '');
    const version = cleanModelName(state.lastVersionLabel || state.lastVersionName || '');
    if (!model && !version) return null;
    return {
      description: `Last routed: ${readableRoutedModelLabel(model, version)}`
    };
  }

  function normalizeIndicatorLogoUrl(value) {
    try {
      const raw = String(value || '');
      if (/^data:image\/(?:png|jpe?g|gif|svg\+xml|webp|x-icon);base64,/i.test(raw)) return raw;
      const url = new URL(raw);
      return ['chrome-extension:', 'moz-extension:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function isLastRoutedModelInPool() {
    if (!state.config?.enabled || !state.lastModelId) return false;
    return (state.config.pool || []).some((model) =>
      model.enabled !== false
      && sameModel(model.modelId, state.lastModelId)
      && sameModel(model.versionName || model.modelId, state.lastVersionName || state.lastModelId)
    );
  }

  function readableRoutedModelLabel(model, version) {
    const readableVersion = version && !/^v?\d+(?:\.\d+)*$/i.test(version) ? version : '';
    return cleanModelName(readableVersion || model || version || 'Custom Dynamic');
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
    scheduleRoutedModelIndicatorSync();
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
