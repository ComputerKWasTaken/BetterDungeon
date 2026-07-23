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
    runtime: {},
    lastModelId: '',
    roundRobinCursor: 0,
    requestCounter: 0,
    domSwitching: false
  };

  const MODEL_KEY_RE = /^(?:model|modelid|model_id|aimodel|ai_model|storymodel|story_model|textmodel|text_model|providerModel)$/i;
  const ACTION_KEY_RE = /^(?:action|actiontype|action_type|input|text|prompt|userinput|user_input|storyinput|story_input|command|message|mode|type)$/i;
  const ACTION_VALUE_RE = /^(?:continue|do|say|story|see|take[_ -]?action|retry|regenerate)$/i;
  const GENERATION_OPERATION_RE = /(?:generate|continue|retry|take.?action|submit.?action|perform.?action|create.?action|send.?action|story.?action|add.?action|adventure.?action|actionRequest|retryAction)/i;
  const MODEL_OPERATION_RE = /(?:model|settings|configuration|preference|update.?adventure|save.?settings)/i;
  const URL_GENERATION_RE = /(?:generate|continue|retry|take.?action|story.?action|actions?\/(?:create|add|send)|(?:create|add|send)\/?actions?)/i;
  const UI_CONFIRM_PREFIX_RE = /^Confirm selection:\s*(.+)$/i;
  const UI_AVAILABLE_MODELS_RE = /^Available AI models$/i;
  const UI_MODEL_STATUS_RE = /,\s*(?=(?:currently selected|selected|available|unavailable|staged for selection|not staged|locked|disabled|current)\b)/i;
  const UI_NON_MODEL_RE = /^(?:feature|capability|context|beta testing|dialogue|reasoning|description|romance|combat|model features)\s*:/i;
  window.addEventListener('message', handleBridgeMessage, false);
  installSilentSwitchStyle();
  installFetchHook();
  installXhrHook();
  postToExtension('ready');

  function handleBridgeMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.namespace !== NAMESPACE || data.direction !== TO_PAGE) return;

    if (data.type === 'state') {
      state.config = normalizeConfig(data.payload?.config);
      state.runtime = normalizeRuntime(data.payload?.runtime);
      state.lastModelId = String(state.runtime.lastModelId || state.lastModelId || '');
      state.roundRobinCursor = Number.isInteger(state.runtime.roundRobinCursor)
        ? state.runtime.roundRobinCursor
        : 0;
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
        maybeLearnAdapter(envelope, inspection);
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
      let routedInput = input;
      let routedInit = init;
      let mechanism = 'none';

      try {
        if (state.config.switchMode !== 'ui') {
          const direct = rewriteEnvelopeModel(envelope, inspection, selection.modelId);
          if (direct.changed) {
            const rebuilt = rebuildFetch(input, init, envelope, direct.bodyText);
            routedInput = rebuilt.input;
            routedInit = rebuilt.init;
            mechanism = 'request-body';
          }
        }

        if (mechanism === 'none') {
          mechanism = await applyExternalSwitch(selection.modelId, inspection);
        }

        if (mechanism === 'none') {
          const details = { requestId, selectedModel: selection.modelId, ...summarizeInspection(inspection) };
          if (!state.config.failOpen) {
            log('error', 'Custom Dynamic could not switch models for this generation.', details);
            throw new Error('Custom Dynamic could not switch models for this generation.');
          }
          log('warn', 'Custom Dynamic could not switch models; generation will use the current AI Dungeon model.', details);
          return nativeFetch(input, init);
        }

        rememberSelectedModel(selection.modelId, mechanism);
        log('info', 'Custom Dynamic routed a generation.', {
          requestId,
          selectedModel: selection.modelId,
          label: selection.label,
          mechanism
        });

        return nativeFetch(routedInput, routedInit);
      } catch (error) {
        log('error', 'Custom Dynamic routing failed.', {
          requestId,
          selectedModel: selection.modelId,
          error: String(error)
        });
        if (state.config.failOpen) return nativeFetch(input, init);
        throw error;
      }
    };
  }

  function installXhrHook() {
    if (!NativeXHR?.prototype) return;

    const nativeOpen = NativeXHR.prototype.open;
    const nativeSend = NativeXHR.prototype.send;
    const nativeSetRequestHeader = NativeXHR.prototype.setRequestHeader;

    NativeXHR.prototype.open = function betterDungeonCustomDynamicOpen(method, url, ...rest) {
      this.__bdCustomDynamic = {
        method: String(method || 'GET').toUpperCase(),
        url: resolveUrl(url),
        headers: {}
      };
      return nativeOpen.call(this, method, url, ...rest);
    };

    NativeXHR.prototype.setRequestHeader = function betterDungeonCustomDynamicSetHeader(name, value) {
      if (this.__bdCustomDynamic) this.__bdCustomDynamic.headers[String(name)] = String(value);
      return nativeSetRequestHeader.call(this, name, value);
    };

    NativeXHR.prototype.send = function betterDungeonCustomDynamicSend(body) {
      const meta = this.__bdCustomDynamic || { method: 'GET', url: '', headers: {} };
      if (!state.config || !isAiDungeonUrl(meta.url) || typeof body !== 'string') {
        return nativeSend.call(this, body);
      }

      const inspection = inspectRequest(meta.url, meta.method, body);

      if (!inspection.isGeneration) {
        maybeLearnAdapter({
          url: meta.url,
          method: meta.method,
          bodyText: body,
          safeHeaders: sanitizeHeaders(meta.headers || {})
        }, inspection);
        return nativeSend.call(this, body);
      }

      if (!state.config.enabled) return nativeSend.call(this, body);

      const selection = selectModel();
      if (!selection) return nativeSend.call(this, body);

      const direct = state.config.switchMode !== 'ui'
        ? rewriteEnvelopeModel({ bodyText: body }, inspection, selection.modelId)
        : { changed: false, bodyText: body };

      if (direct.changed) {
        rememberSelectedModel(selection.modelId, 'request-body');
        log('info', 'Custom Dynamic routed an XHR generation.', {
          selectedModel: selection.modelId,
          mechanism: 'request-body'
        });
        return nativeSend.call(this, direct.bodyText);
      }

      if (state.config.switchMode === 'request-body') {
        if (state.config.failOpen) return nativeSend.call(this, body);
        try { this.abort(); } catch { /* noop */ }
        return undefined;
      }

      const xhr = this;
      void applyExternalSwitch(selection.modelId, inspection)
        .then((mechanism) => {
          if (mechanism === 'none') {
            if (state.config.failOpen) nativeSend.call(xhr, body);
            else {
              try { xhr.abort(); } catch { /* noop */ }
            }
            return;
          }
          rememberSelectedModel(selection.modelId, mechanism);
          nativeSend.call(xhr, body);
        })
        .catch((error) => {
          log('error', 'Custom Dynamic XHR routing failed.', { error: String(error) });
          if (state.config.failOpen) nativeSend.call(xhr, body);
          else {
            try { xhr.abort(); } catch { /* noop */ }
          }
        });
      return undefined;
    };
  }

  async function applyExternalSwitch(modelId, inspection) {
    const mode = state.config.switchMode || 'auto';
    if (mode === 'request-body') return 'none';

    if (mode === 'auto' || mode === 'learned-request') {
      const learned = await applyLearnedAdapter(modelId, inspection);
      if (learned) return 'learned-request';
      if (mode === 'learned-request') return 'none';
    }

    if (mode === 'auto' || mode === 'ui') {
      const ui = await applyDomSwitch(modelId);
      if (ui) return 'ui';
    }

    return 'none';
  }

  function installSilentSwitchStyle() {
    const append = () => {
      if (document.getElementById('bd-custom-dynamic-silent-style')) return true;
      const host = document.head || document.documentElement;
      if (!host) return false;
      const style = document.createElement('style');
      style.id = 'bd-custom-dynamic-silent-style';
      style.textContent = `
        html[data-bd-custom-dynamic-switching="true"] [data-floating-ui-focusable][role="dialog"],
        html[data-bd-custom-dynamic-switching="true"] [role="dialog"][aria-labelledby="model-switcher-title"],
        html[data-bd-custom-dynamic-switching="true"] [aria-label="Menu"][role="menu"],
        html[data-bd-custom-dynamic-switching="true"] [data-radix-popper-content-wrapper],
        html[data-bd-custom-dynamic-switching="true"] [data-state="open"] {
          opacity: 0 !important;
          pointer-events: none !important;
          transition: none !important;
          animation: none !important;
        }
      `;
      host.appendChild(style);
      return true;
    };

    if (append()) return;
    const observer = new MutationObserver(() => {
      if (append()) observer.disconnect();
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  async function applyDomSwitch(modelId) {
    const targetModel = String(modelId || '').trim();
    if (!targetModel || state.domSwitching) return false;

    const switcher = findModelSwitcherButton();
    if (switcherDisplaysModel(switcher, targetModel)) {
      return true;
    }

    if (!switcher) {
      log('warn', 'AI Dungeon model switcher was not found.', { modelId: targetModel });
      return false;
    }

    state.domSwitching = true;
    document.documentElement?.setAttribute('data-bd-custom-dynamic-switching', 'true');

    try {
      const opened = await ensureModelSwitcherOpen(switcher);
      if (!opened) {
        log('warn', 'AI Dungeon model switcher did not open.', { modelId: targetModel });
        return false;
      }

      await expandShowMoreModels();
      let target = findModelTarget(targetModel);
      if (!target) {
        await wait(120);
        target = findModelTarget(targetModel);
      }

      if (!target) {
        log('warn', 'Pool model was not found in the AI Dungeon model switcher.', {
          modelId: targetModel,
          visibleModels: getVisibleModelNames()
        });
        closeModelSwitcherIfPossible();
        return false;
      }

      activateElement(target.element);
      const confirmed = await waitFor(() => {
        const confirm = findConfirmationButton();
        const confirmModel = modelIdFromAriaLabel(confirm?.getAttribute('aria-label'));
        return confirm && sameModel(confirmModel, target.modelId) ? confirm : null;
      }, 2500);

      if (!confirmed) {
        log('warn', 'AI Dungeon did not expose a confirmation button for the staged model.', {
          modelId: targetModel,
          matchedModel: target.modelId
        });
        closeModelSwitcherIfPossible();
        return false;
      }

      activateElement(confirmed);
      const verified = await waitFor(() => {
        if (switcherDisplaysModel(findModelSwitcherButton(), target.modelId)) return 'active-label';
        if (!findConfirmationButton() && !document.querySelector('[aria-label="Available AI models"]')) return 'picker-closed';
        return null;
      }, 3500);
      if (!verified) {
        log('warn', 'Model selection was clicked but could not be verified before generation.', {
          modelId: targetModel,
          matchedModel: target.modelId
        });
        return false;
      }
      if (verified === 'picker-closed') {
        log('info', 'Model selection was confirmed; the picker closed before the active label updated.', {
          modelId: targetModel,
          matchedModel: target.modelId
        });
      }

      return true;
    } catch (error) {
      log('error', 'AI Dungeon UI model switch failed.', { modelId: targetModel, error: String(error) });
      return false;
    } finally {
      await wait(120);
      document.documentElement?.removeAttribute('data-bd-custom-dynamic-switching');
      state.domSwitching = false;
    }
  }

  function findModelSwitcherButton() {
    return document.querySelector('button[aria-label="Model Switcher"], [role="button"][aria-label="Model Switcher"], [aria-label="Model Switcher"]');
  }

  function switcherDisplaysModel(switcher, modelId) {
    if (!switcher || !modelId) return false;
    const imgAlt = switcher.querySelector?.('img[alt]')?.getAttribute('alt');
    if (sameModel(imgAlt, modelId)) return true;
    const label = switcher.getAttribute?.('aria-label') || switcher.textContent || '';
    return sameModel(label, modelId) || canonicalModelName(label).includes(canonicalModelName(modelId));
  }

  async function ensureModelSwitcherOpen(switcher) {
    if (document.querySelector('[aria-label="Available AI models"]')) return true;
    activateElement(switcher);
    return Boolean(await waitFor(() => document.querySelector('[aria-label="Available AI models"]'), 3500));
  }

  async function expandShowMoreModels() {
    const showMore = document.querySelector('[aria-label="Show more AI models"]');
    if (!showMore) return;
    if (String(showMore.getAttribute('aria-expanded') || '').toLowerCase() === 'true') return;
    activateElement(showMore);
    await wait(120);
  }

  function findModelTarget(modelId) {
    const target = canonicalModelName(modelId);
    if (!target) return null;
    const list = document.querySelector('[aria-label="Available AI models"]');
    if (!list) return null;

    const items = Array.from(list.querySelectorAll('[role="listitem"]'));
    for (const element of items) {
      const name = modelIdFromChoiceElement(element);
      if (name && sameModel(name, target)) return { element, modelId: name };
    }

    for (const element of items) {
      const name = modelIdFromChoiceElement(element);
      if (!name) continue;
      const normalized = canonicalModelName(name);
      if (normalized.startsWith(target) || target.startsWith(normalized)) {
        return { element, modelId: name };
      }
    }
    return null;
  }

  function findConfirmationButton() {
    return document.querySelector('[aria-label^="Confirm selection:"]');
  }

  function closeModelSwitcherIfPossible() {
    const switcher = findModelSwitcherButton();
    if (switcher && document.querySelector('[aria-label="Available AI models"]')) {
      activateElement(switcher);
      return;
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true }));
  }

  function activateElement(element) {
    if (!element) return;
    try { element.focus({ preventScroll: true }); } catch { element.focus?.(); }
    const common = { bubbles: true, cancelable: true, composed: true, view: window };
    try {
      if (typeof PointerEvent === 'function') {
        element.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
        element.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
      }
      element.dispatchEvent(new MouseEvent('mousedown', { ...common, buttons: 1 }));
      element.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
      element.click?.();
    } catch {
      try { element.click?.(); } catch { /* noop */ }
    }
  }

  function modelIdFromAriaLabel(value) {
    const match = UI_CONFIRM_PREFIX_RE.exec(String(value || '').trim());
    return cleanModelName(match ? match[1] : '');
  }

  function modelIdFromChoiceElement(element) {
    if (!(element instanceof Element)) return '';
    if (String(element.getAttribute('role') || '').toLowerCase() !== 'listitem') return '';

    let list = element.parentElement;
    while (list && list !== document.body) {
      if (UI_AVAILABLE_MODELS_RE.test(String(list.getAttribute?.('aria-label') || '').trim())) break;
      list = list.parentElement;
    }
    if (!list || list === document.body) return '';

    const label = cleanModelName(element.getAttribute('aria-label'));
    if (!label || UI_NON_MODEL_RE.test(label)) return '';
    return cleanModelName(label.replace(UI_MODEL_STATUS_RE, '|').split('|')[0]);
  }

  function getVisibleModelNames() {
    const list = document.querySelector('[aria-label="Available AI models"]');
    if (!list) return [];
    return Array.from(list.querySelectorAll('[role="listitem"]'))
      .map(modelIdFromChoiceElement)
      .filter(Boolean)
      .slice(0, 80);
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

    const headers = new Headers(init?.headers || request?.headers || undefined);
    return {
      url,
      method,
      bodyText,
      safeHeaders: sanitizeHeaders(headers),
      contentType: headers.get('content-type') || ''
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
    const actionType = inferActionType(actionSignals, operation, url);
    let generationScore = 0;

    if (URL_GENERATION_RE.test(url)) generationScore += 4;
    if (GENERATION_OPERATION_RE.test(operation)) generationScore += 6;
    if (actionSignals.some((item) => ACTION_VALUE_RE.test(String(item.value || '')))) generationScore += 3;
    if (actionSignals.some((item) => /input|prompt|command|message|text/i.test(item.key))) generationScore += 1;

    for (const pattern of state.config?.generationUrlPatterns || []) {
      try {
        if (new RegExp(pattern, 'i').test(url)) generationScore += 8;
      } catch {
        // Invalid saved expressions are ignored by the page hook.
      }
    }

    return {
      url,
      method,
      bodyText,
      bodyFormat: parsedBody.format,
      parsed,
      operation,
      modelFields,
      actionSignals,
      actionType,
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
      if (/^(?:operationName|operation|type|event|name)$/i.test(key) && (GENERATION_OPERATION_RE.test(value) || MODEL_OPERATION_RE.test(value))) {
        found = value;
      }
    });
    return found;
  }

  function findModelFields(root) {
    const configuredPaths = new Set(state.config?.modelPaths || []);
    const results = [];
    walk(root, [], (key, value, path) => {
      const fullPath = pathToString(path);
      if ((MODEL_KEY_RE.test(key) || configuredPaths.has(fullPath)) && ['string', 'number'].includes(typeof value)) {
        results.push({ key, value: String(value), path: fullPath, pathArray: [...path] });
      }
    });
    return results;
  }

  function findActionSignals(root) {
    const results = [];
    walk(root, [], (key, value, path) => {
      if (!ACTION_KEY_RE.test(key)) return;
      if (!['string', 'number', 'boolean'].includes(typeof value)) return;
      results.push({ key, value: String(value), path: pathToString(path) });
    });
    return results.slice(0, 40);
  }

  function inferActionType(signals, operation, url) {
    const combined = `${operation} ${url} ${signals.map((item) => `${item.key}:${item.value}`).join(' ')}`.toLowerCase();
    if (/\bcontinue\b/.test(combined)) return 'continue';
    if (/\bsay\b|dialogue|dialog/.test(combined)) return 'say';
    if (/\bdo\b|take.?action|perform.?action/.test(combined)) return 'do';
    if (/\bstory\b/.test(combined)) return 'story';
    if (/\bsee\b/.test(combined)) return 'see';
    if (/retry|regenerate/.test(combined)) return 'retry';
    return 'action';
  }

  function selectModel() {
    const candidates = (state.config.pool || [])
      .filter((model) => model.enabled !== false && model.modelId)
      .map((model) => ({
        ...model,
        score: Math.max(0.01, Number(model.weight) || 1)
      }));

    if (!candidates.length) return null;

    if (state.config.routingMode === 'round-robin') {
      const selected = candidates[state.roundRobinCursor % candidates.length];
      state.roundRobinCursor = (state.roundRobinCursor + 1) % Number.MAX_SAFE_INTEGER;
      emitRuntime({ kind: 'round-robin-cursor', cursor: state.roundRobinCursor });
      return selected;
    }

    if (state.config.routingMode === 'avoid-last') {
      const eligible = candidates.length > 1
        ? candidates.filter((item) => !sameModel(item.modelId, state.lastModelId))
        : candidates;
      return randomWeighted(eligible.length ? eligible : candidates);
    }

    const weighted = candidates.map((item) => {
      if (sameModel(item.modelId, state.lastModelId) && candidates.length > 1) {
        return { ...item, score: item.score * state.config.repeatPenalty };
      }
      return item;
    });
    return randomWeighted(weighted);
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
    const configured = new Set(state.config?.modelPaths || []);
    const poolIds = new Set((state.config?.pool || []).map((model) => canonicalModelName(model.modelId)));
    const safe = fields.filter((field) => !/(?:image|embedding|memory|summary|summarizer|moderation|safety|voice|audio|narration)/i.test(`${field.key} ${field.path}`));
    const forced = safe.filter((field) => configured.has(field.path));
    if (forced.length) return forced;
    const currentPoolValue = safe.filter((field) => poolIds.has(canonicalModelName(field.value)));
    if (currentPoolValue.length) return currentPoolValue.slice(0, 1);
    const storyLike = safe.filter((field) => /(?:story|text|ai|provider).*model|model.*(?:story|text|ai|provider)/i.test(`${field.key} ${field.path}`));
    if (storyLike.length) return storyLike.slice(0, 1);
    return safe.length === 1 ? safe : [];
  }

  async function applyLearnedAdapter(modelId, inspection) {
    if (!nativeFetch) return false;
    const adapter = state.runtime?.adapter;
    if (!adapter || !adapter.url || !adapter.body || !Array.isArray(adapter.modelPathArray)) return false;
    if (!isAiDungeonUrl(adapter.url)) return false;

    const body = structuredCloneSafe(adapter.body);
    if (!setAtPath(body, adapter.modelPathArray, modelId)) return false;
    copyIdentityFields(inspection?.parsed, body);

    const response = await nativeFetch(adapter.url, {
      method: adapter.method || 'POST',
      headers: adapter.safeHeaders || { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      log('warn', 'Learned model-switch request was rejected.', { modelId, status: response.status });
      return false;
    }
    return true;
  }

  function maybeLearnAdapter(envelope, inspection) {
    if (!inspection.parsed || inspection.isGeneration || !inspection.modelFields.length) return;
    if (!MODEL_OPERATION_RE.test(inspection.operation) && !MODEL_OPERATION_RE.test(envelope.url)) return;

    const field = selectWritableModelFields(inspection.modelFields)[0] || inspection.modelFields[0];
    if (!field) return;

    emitRuntime({
      kind: 'adapter-learned',
      adapter: {
        url: envelope.url,
        method: envelope.method || 'POST',
        safeHeaders: envelope.safeHeaders || { 'content-type': 'application/json' },
        body: inspection.parsed,
        modelPath: field.path,
        modelPathArray: field.pathArray,
        observedModelId: field.value,
        operation: inspection.operation || ''
      }
    });
  }

  function copyIdentityFields(source, target) {
    if (!source || !target) return;
    const sourceFields = findIdentityFields(source);
    const targetFields = findIdentityFields(target);
    for (const targetField of targetFields) {
      const sourceField = sourceFields.find((field) => field.normalizedKey === targetField.normalizedKey);
      if (sourceField) setAtPath(target, targetField.pathArray, sourceField.value);
    }
  }

  function findIdentityFields(root) {
    const results = [];
    walk(root, [], (key, value, path) => {
      if (!/^(?:adventure|game|story|session|scenario|content)[_-]?id$/i.test(key)) return;
      if (!['string', 'number'].includes(typeof value)) return;
      results.push({
        normalizedKey: String(key).replace(/_/g, '').toLowerCase(),
        value,
        pathArray: [...path]
      });
    });
    return results;
  }

  function rememberSelectedModel(modelId, mechanism) {
    state.lastModelId = modelId;
    emitRuntime({ kind: 'last-model', modelId, mechanism });
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

  function pathToString(path) {
    return path.map((segment) => typeof segment === 'number' ? `[${segment}]` : String(segment)).join('.').replace(/\.\[/g, '[');
  }

  function sanitizeHeaders(headersInit) {
    const headers = headersInit instanceof Headers ? headersInit : new Headers(headersInit || undefined);
    const safe = {};
    headers.forEach((value, key) => {
      if (/^(?:authorization|cookie|x-api-key|proxy-authorization)$/i.test(key)) return;
      if (/^(?:content-type|accept|x-client-version|x-requested-with)$/i.test(key)) safe[key] = value;
    });
    if (!safe['content-type']) safe['content-type'] = 'application/json';
    return safe;
  }

  function normalizeConfig(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      enabled: Boolean(raw.enabled),
      routingMode: ['weighted-random', 'round-robin', 'avoid-last'].includes(raw.routingMode)
        ? raw.routingMode
        : 'weighted-random',
      switchMode: ['auto', 'request-body', 'learned-request', 'ui'].includes(raw.switchMode)
        ? raw.switchMode
        : 'auto',
      repeatPenalty: clampNumber(raw.repeatPenalty, 0.2, 0, 1),
      failOpen: raw.failOpen !== false,
      debug: Boolean(raw.debug),
      generationUrlPatterns: Array.isArray(raw.generationUrlPatterns) ? raw.generationUrlPatterns.filter(Boolean) : [],
      modelPaths: Array.isArray(raw.modelPaths) ? raw.modelPaths.filter(Boolean) : [],
      pool: Array.isArray(raw.pool) ? raw.pool.map((model) => ({
        enabled: model?.enabled !== false,
        modelId: cleanModelName(model?.modelId || model?.id || ''),
        label: cleanModelName(model?.label || model?.modelId || model?.id || ''),
        weight: clampNumber(model?.weight, 1, 0.01, 100)
      })).filter((model) => model.modelId) : []
    };
  }

  function normalizeRuntime(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return {
      adapter: raw.adapter && typeof raw.adapter === 'object' ? raw.adapter : null,
      lastModelId: cleanModelName(raw.lastModelId || ''),
      roundRobinCursor: Number.isInteger(raw.roundRobinCursor) ? raw.roundRobinCursor : 0
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
      generationScore: inspection.generationScore,
      actionType: inspection.actionType,
      modelPaths: inspection.modelFields.map((field) => field.path)
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

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(test, timeoutMs = 1000) {
    const deadline = performance.now() + Math.max(50, timeoutMs);
    while (performance.now() < deadline) {
      const value = test();
      if (value) return value;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return null;
  }

  function log(level, message, details = null) {
    if (state.config?.debug) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'debug';
      console[method]('[BetterDungeon Custom Dynamic]', message, details || '');
    }
    emitRuntime({ kind: 'log', level, message, details });
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
