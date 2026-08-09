// modules/ai/openai-backend.js
//
// Content-side OpenAI-compatible provider adapter. Transport and secret storage
// stay in the extension background worker; this file only registers a provider
// with the provider-agnostic AI executor and applies the stored default
// provider selection.

(function () {
  if (window.UltrascriptsAIOpenAIBackend) return;

  const MESSAGE_TYPE = 'ULTRASCRIPTS_AI_OPENAI';
  const CHAT_PORT_NAME = 'BETTERDUNGEON_AI_CHAT_OPENAI_V1';
  const DEFAULT_PROVIDER_STORAGE_KEY = 'ultrascripts_ai_default_provider';

  function runtime() {
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) return browser.runtime;
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) return chrome.runtime;
    return null;
  }

  function unwrapResponse(response) {
    if (response?.ok) return response.data;
    throw response?.error || { code: 'backend_failed', message: 'OpenAI backend request failed' };
  }

  function sendOpenAiMessage(request) {
    const rt = runtime();
    if (!rt?.sendMessage) {
      return Promise.reject({
        code: 'unavailable',
        message: 'Extension runtime is unavailable.',
        retryable: true,
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
            message: lastError.message || 'OpenAI backend request failed',
            retryable: true,
          });
          return;
        }
        try {
          resolve(unwrapResponse(response));
        } catch (err) {
          reject(err);
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

  function createChatRequestId(task) {
    if (typeof task?.id === 'string' && task.id) return task.id;
    return `betterdungeon-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function streamOpenAiChat(task, controls = {}) {
    const rt = runtime();
    if (!runtimeAvailable(rt)) {
      return Promise.reject({
        code: 'unavailable',
        message: 'Extension runtime is unavailable.',
        retryable: true,
      });
    }
    if (controls.signal?.aborted) {
      return Promise.reject({
        code: 'aborted',
        message: 'AI chat request was aborted.',
        retryable: false,
        backend: 'openai',
      });
    }

    const requestId = createChatRequestId(task);
    const chatTask = { ...task, id: requestId };
    let port;
    try {
      port = rt.connect({ name: CHAT_PORT_NAME });
    } catch (err) {
      return Promise.reject({
        code: 'unavailable',
        message: err?.message || 'OpenAI chat transport is unavailable.',
        retryable: true,
        backend: 'openai',
      });
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const safeDisconnect = () => {
        try { port.disconnect(); } catch { /* noop */ }
      };

      const cleanup = () => {
        try { port.onMessage.removeListener(onMessage); } catch { /* noop */ }
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
          backend: 'openai',
        });
      };

      function onAbort() {
        abort();
      }

      function onPageExit() {
        abort();
      }

      function onMessage(message) {
        if (settled || !message || message.v !== 1 || message.requestId !== requestId) return;
        if (message.type === 'keepalive') return;
        if (message.type === 'delta') {
          if (typeof message.text !== 'string' || !message.text) return;
          if (typeof controls.onDelta === 'function') {
            try {
              controls.onDelta({
                text: message.text,
                sequence: Number.isSafeInteger(message.sequence) ? message.sequence : null,
              });
            } catch (err) {
              console.error('[OpenAIBackend] Chat delta consumer failed:', err);
            }
          }
          return;
        }
        if (message.type === 'complete') {
          const result = message.result && typeof message.result === 'object' ? message.result : {};
          if (result.status) state.status = normalizeStatus(result.status);
          settle('resolve', {
            provider: 'openai',
            backend: 'openai',
            generatedAtIso: result.generatedAtIso,
            model: result.model,
            providerModel: result.providerModel,
            usage: result.usage,
            fallback: result.fallback,
            text: result.text,
            toolCalls: result.toolCalls,
            continuation: result.continuation,
          });
          return;
        }
        if (message.type === 'error') {
          settle('reject', message.error || {
            code: 'backend_failed',
            message: 'OpenAI chat request failed.',
            retryable: true,
            backend: 'openai',
          });
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
          message: runtimeError || 'OpenAI chat connection closed before completion.',
          retryable: true,
          backend: 'openai',
        });
      }

      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      controls.signal?.addEventListener('abort', onAbort, { once: true });
      window.addEventListener('pagehide', onPageExit, { once: true });
      window.addEventListener('beforeunload', onPageExit, { once: true });

      if (!safePost({ v: 1, type: 'start', requestId, task: chatTask })) {
        settle('reject', {
          code: 'unavailable',
          message: 'OpenAI chat request could not be started.',
          retryable: true,
          backend: 'openai',
        });
      }
    });
  }

  const state = {
    status: {
      ready: false,
      available: false,
      reason: 'ai_backend_status_unknown',
      config: null,
      message: 'OpenAI backend status has not been checked yet.',
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

  async function refreshStatus() {
    try {
      state.status = normalizeStatus(await sendOpenAiMessage({ op: 'status' }));
    } catch (err) {
      state.status = {
        ready: false,
        available: false,
        reason: err?.code || 'ai_backend_status_failed',
        config: null,
        message: err?.message || 'OpenAI backend status check failed.',
      };
    }
    return state.status;
  }

  const provider = {
    id: 'openai',
    label: 'OpenAI-Compatible',
    supports: { text: true, json: true, thinking: false },
    status: () => state.status,
    query: async (task) => {
      const result = await sendOpenAiMessage({ op: 'query', task });
      if (result?.status) state.status = normalizeStatus(result.status);
      return {
        provider: 'openai',
        backend: 'openai',
        generatedAtIso: result?.generatedAtIso,
        model: result?.model,
        providerModel: result?.providerModel,
        usage: result?.usage,
        fallback: result?.fallback,
        text: result?.text,
        json: result?.json,
      };
    },
    streamChat: streamOpenAiChat,
    refreshStatus,
  };

  function storageArea() {
    if (typeof browser !== 'undefined' && browser?.storage?.sync) return browser.storage;
    if (typeof chrome !== 'undefined' && chrome?.storage?.sync) return chrome.storage;
    return null;
  }

  function applyDefaultProvider(providerId) {
    const executor = window.UltrascriptsAIExecutor;
    if (!executor?.setDefaultProvider) return;
    const id = providerId === 'openai' ? 'openai' : 'gemini';
    try {
      executor.setDefaultProvider(id);
    } catch { /* provider not registered yet */ }
  }

  function watchDefaultProvider() {
    const storage = storageArea();
    if (!storage) return;
    try {
      storage.sync.get(DEFAULT_PROVIDER_STORAGE_KEY, (result) => {
        const stored = (result || {})[DEFAULT_PROVIDER_STORAGE_KEY];
        if (stored) applyDefaultProvider(stored);
      });
      storage.onChanged?.addListener((changes, areaName) => {
        if (areaName !== 'sync' || !changes[DEFAULT_PROVIDER_STORAGE_KEY]) return;
        applyDefaultProvider(changes[DEFAULT_PROVIDER_STORAGE_KEY].newValue);
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
      executor.registerProvider(provider);
      refreshStatus();
      watchDefaultProvider();
      return true;
    },
  };

  window.UltrascriptsAIOpenAIBackend = api;
  api.register();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
