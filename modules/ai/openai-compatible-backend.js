// modules/ai/openai-compatible-backend.js
//
// Content-side adapter for BetterDungeon's single remote AI protocol. Secrets,
// endpoint profiles, HTTP requests, and streaming aggregation stay in the
// privileged background worker.

(function () {
  if (window.UltrascriptsAIOpenAICompatibleBackend) return;

  const MESSAGE_TYPE = 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE';
  const CHAT_PORT_NAME = 'BETTERDUNGEON_AI_CHAT_OPENAI_COMPATIBLE_V1';
  const PROVIDER_ID = 'openai-compatible';
  const CONFIG_STORAGE_KEY = 'ultrascripts_ai_endpoint_config_v1';

  function runtime() {
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) return browser.runtime;
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) return chrome.runtime;
    return null;
  }

  function backendError(message) {
    return { code: 'backend_failed', message, retryable: true, backend: PROVIDER_ID };
  }

  function unwrapResponse(response) {
    if (response?.ok) return response.data;
    throw response?.error || backendError('OpenAI-compatible backend request failed.');
  }

  function sendMessage(request) {
    const rt = runtime();
    if (!rt?.sendMessage) {
      return Promise.reject({
        code: 'unavailable',
        message: 'Extension runtime is unavailable.',
        retryable: true,
        backend: PROVIDER_ID,
      });
    }

    const message = { type: MESSAGE_TYPE, request };
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) {
      return browser.runtime.sendMessage(message).then(unwrapResponse);
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          reject({
            code: 'unavailable',
            message: lastError.message || 'OpenAI-compatible backend request failed.',
            retryable: true,
            backend: PROVIDER_ID,
          });
          return;
        }
        try {
          resolve(unwrapResponse(response));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function runtimeAvailable(rt) {
    try {
      return !!(rt?.id && rt?.connect);
    } catch {
      return false;
    }
  }

  function createRequestId(task) {
    if (typeof task?.id === 'string' && task.id) return task.id;
    return `betterdungeon-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const state = {
    status: {
      ready: false,
      available: false,
      reason: 'ai_backend_status_unknown',
      config: { service: 'gemini' },
      message: 'OpenAI-compatible backend status has not been checked yet.',
    },
  };

  function normalizeStatus(status) {
    const raw = status && typeof status === 'object' ? status : {};
    return {
      ready: raw.ready === true,
      available: raw.available === true,
      reason: typeof raw.reason === 'string' ? raw.reason : null,
      config: raw.config && typeof raw.config === 'object' ? raw.config : null,
      message: typeof raw.message === 'string' ? raw.message : '',
    };
  }

  function resultEnvelope(result) {
    const raw = result && typeof result === 'object' ? result : {};
    return {
      provider: PROVIDER_ID,
      backend: PROVIDER_ID,
      service: raw.service,
      generatedAtIso: raw.generatedAtIso,
      model: raw.model,
      providerModel: raw.providerModel,
      thinking: raw.thinking,
      usage: raw.usage,
      fallback: raw.fallback,
      text: raw.text,
      json: raw.json,
      toolCalls: raw.toolCalls,
      continuation: raw.continuation,
    };
  }

  async function refreshStatus() {
    try {
      state.status = normalizeStatus(await sendMessage({ op: 'status' }));
    } catch (error) {
      state.status = {
        ready: false,
        available: false,
        reason: error?.code || 'ai_backend_status_failed',
        config: null,
        message: error?.message || 'OpenAI-compatible backend status check failed.',
      };
    }
    return state.status;
  }

  function streamChat(task, controls = {}) {
    const rt = runtime();
    if (!runtimeAvailable(rt)) {
      return Promise.reject({
        code: 'unavailable',
        message: 'Extension runtime is unavailable.',
        retryable: true,
        backend: PROVIDER_ID,
      });
    }
    if (controls.signal?.aborted) {
      return Promise.reject({
        code: 'aborted',
        message: 'AI chat request was aborted.',
        retryable: false,
        backend: PROVIDER_ID,
      });
    }

    const requestId = createRequestId(task);
    let port;
    try {
      port = rt.connect({ name: CHAT_PORT_NAME });
    } catch (error) {
      return Promise.reject({
        code: 'unavailable',
        message: error?.message || 'OpenAI-compatible chat transport is unavailable.',
        retryable: true,
        backend: PROVIDER_ID,
      });
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const chatTask = { ...task, id: requestId };

      const safeDisconnect = () => {
        try { port.disconnect(); } catch { /* noop */ }
      };
      const cleanup = () => {
        try { port.onMessage.removeListener(onPortMessage); } catch { /* noop */ }
        try { port.onDisconnect.removeListener(onDisconnect); } catch { /* noop */ }
        try { controls.signal?.removeEventListener('abort', onAbort); } catch { /* noop */ }
        window.removeEventListener('pagehide', onPageExit);
        window.removeEventListener('beforeunload', onPageExit);
      };
      const settle = (kind, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        safeDisconnect();
        if (kind === 'resolve') resolve(value);
        else reject(value);
      };
      const safePost = (message) => {
        if (settled) return false;
        try {
          port.postMessage(message);
          return true;
        } catch {
          return false;
        }
      };
      const abort = () => {
        if (settled) return;
        safePost({ v: 1, type: 'abort', requestId });
        settle('reject', {
          code: 'aborted',
          message: 'AI chat request was aborted.',
          retryable: false,
          backend: PROVIDER_ID,
        });
      };

      function onAbort() { abort(); }
      function onPageExit() { abort(); }
      function onPortMessage(message) {
        if (settled || !message || message.v !== 1 || message.requestId !== requestId) return;
        if (message.type === 'keepalive') return;
        if (message.type === 'stage') {
          if ((message.stage === 'connected' || message.stage === 'streaming') && typeof controls.onStage === 'function') {
            try { controls.onStage(message.stage); } catch (error) {
              console.error('[OpenAICompatibleBackend] Chat stage consumer failed:', error);
            }
          }
          return;
        }
        if (message.type === 'delta') {
          if (typeof message.text === 'string' && message.text && typeof controls.onDelta === 'function') {
            try {
              controls.onDelta({
                text: message.text,
                sequence: Number.isSafeInteger(message.sequence) ? message.sequence : null,
              });
            } catch (error) {
              console.error('[OpenAICompatibleBackend] Chat delta consumer failed:', error);
            }
          }
          return;
        }
        if (message.type === 'complete') {
          const result = message.result && typeof message.result === 'object' ? message.result : {};
          if (result.status) state.status = normalizeStatus(result.status);
          settle('resolve', resultEnvelope(result));
          return;
        }
        if (message.type === 'error') {
          settle('reject', message.error || backendError('OpenAI-compatible chat request failed.'));
        }
      }
      function onDisconnect(disconnectedPort) {
        if (settled) return;
        let runtimeError = null;
        try {
          runtimeError = disconnectedPort?.error?.message || chrome.runtime?.lastError?.message || null;
        } catch {
          runtimeError = disconnectedPort?.error?.message || null;
        }
        settle('reject', {
          code: 'unavailable',
          message: runtimeError || 'OpenAI-compatible chat connection closed before completion.',
          retryable: true,
          backend: PROVIDER_ID,
        });
      }

      port.onMessage.addListener(onPortMessage);
      port.onDisconnect.addListener(onDisconnect);
      controls.signal?.addEventListener('abort', onAbort, { once: true });
      window.addEventListener('pagehide', onPageExit, { once: true });
      window.addEventListener('beforeunload', onPageExit, { once: true });

      if (!safePost({ v: 1, type: 'start', requestId, task: chatTask })) {
        settle('reject', {
          code: 'unavailable',
          message: 'OpenAI-compatible chat request could not be started.',
          retryable: true,
          backend: PROVIDER_ID,
        });
      }
    });
  }

  const provider = {
    id: PROVIDER_ID,
    label: 'OpenAI-Compatible',
    supports: () => ({
      text: true,
      json: true,
      thinking: state.status?.config?.service === 'gemini',
    }),
    status: () => state.status,
    query: async (task) => {
      const result = await sendMessage({ op: 'query', task });
      if (result?.status) state.status = normalizeStatus(result.status);
      return resultEnvelope(result);
    },
    streamChat,
    refreshStatus,
  };

  function watchEndpointConfig() {
    const storage =
      (typeof browser !== 'undefined' && browser?.storage) ? browser.storage :
      (typeof chrome !== 'undefined' && chrome?.storage) ? chrome.storage : null;
    try {
      storage?.onChanged?.addListener((changes, areaName) => {
        if (areaName === 'local' && changes?.[CONFIG_STORAGE_KEY]) refreshStatus();
      });
    } catch { /* noop */ }
  }

  const api = {
    provider,
    backend: provider,
    refreshStatus,
    register() {
      const executor = window.UltrascriptsAIExecutor;
      if (!executor?.registerProvider) return false;
      executor.registerProvider(provider, { default: true });
      refreshStatus();
      watchEndpointConfig();
      return true;
    },
  };

  window.UltrascriptsAIOpenAICompatibleBackend = api;
  api.register();

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
