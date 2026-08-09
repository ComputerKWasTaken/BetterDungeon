// modules/ai/gemini-backend.js
//
// Content-side Gemini provider adapter. Transport and secret storage stay in the
// extension background worker; this file only registers a provider with the
// provider-agnostic AI executor.

(function () {
  if (window.UltrascriptsAIGeminiBackend) return;

  const MESSAGE_TYPE = 'ULTRASCRIPTS_AI_GEMINI';
  const CHAT_PORT_NAME = 'BETTERDUNGEON_AI_CHAT_GEMINI_V1';

  function runtime() {
    if (typeof browser !== 'undefined' && browser?.runtime?.sendMessage) return browser.runtime;
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) return chrome.runtime;
    return null;
  }

  function unwrapResponse(response) {
    if (response?.ok) return response.data;
    throw response?.error || { code: 'backend_failed', message: 'Gemini backend request failed' };
  }

  function sendGeminiMessage(request) {
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
            message: lastError.message || 'Gemini backend request failed',
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

  function streamGeminiChat(task, controls = {}) {
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
        backend: 'gemini',
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
        message: err?.message || 'Gemini chat transport is unavailable.',
        retryable: true,
        backend: 'gemini',
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
          backend: 'gemini',
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
              console.error('[GeminiBackend] Chat delta consumer failed:', err);
            }
          }
          return;
        }
        if (message.type === 'complete') {
          const result = message.result && typeof message.result === 'object' ? message.result : {};
          if (result.status) state.status = normalizeStatus(result.status);
          settle('resolve', {
            provider: 'gemini',
            backend: 'gemini',
            generatedAtIso: result.generatedAtIso,
            model: result.model,
            providerModel: result.providerModel,
            usage: result.usage,
            thinking: result.thinking,
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
            message: 'Gemini chat request failed.',
            retryable: true,
            backend: 'gemini',
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
          message: runtimeError || 'Gemini chat connection closed before completion.',
          retryable: true,
          backend: 'gemini',
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
          message: 'Gemini chat request could not be started.',
          retryable: true,
          backend: 'gemini',
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
      message: 'Gemini backend status has not been checked yet.',
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
      state.status = normalizeStatus(await sendGeminiMessage({ op: 'status' }));
    } catch (err) {
      state.status = {
        ready: false,
        available: false,
        reason: err?.code || 'ai_backend_status_failed',
        config: null,
        message: err?.message || 'Gemini backend status check failed.',
      };
    }
    return state.status;
  }

  const provider = {
    id: 'gemini',
    label: 'Gemini',
    supports: { text: true, json: true, thinking: true },
    status: () => state.status,
    query: async (task) => {
      const result = await sendGeminiMessage({ op: 'query', task });
      if (result?.status) state.status = normalizeStatus(result.status);
      return {
        provider: 'gemini',
        backend: 'gemini',
        generatedAtIso: result?.generatedAtIso,
        model: result?.model,
        providerModel: result?.providerModel,
        usage: result?.usage,
        thinking: result?.thinking,
        fallback: result?.fallback,
        text: result?.text,
        json: result?.json,
      };
    },
    streamChat: streamGeminiChat,
    refreshStatus,
  };

  const api = {
    provider,
    backend: provider,
    refreshStatus,
    register() {
      const executor = window.UltrascriptsAIExecutor;
      if (!executor?.registerProvider) return false;
      executor.registerProvider(provider);
      refreshStatus();
      return true;
    },
  };

  window.UltrascriptsAIGeminiBackend = api;
  api.register();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
