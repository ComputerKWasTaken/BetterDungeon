// modules/ai/gemini-backend.js
//
// Content-side Gemini backend adapter. Transport and secret storage stay in the
// extension background worker; this file only registers a backend with the
// provider-agnostic AI executor.

(function () {
  if (window.UltrascriptsAIGeminiBackend) return;

  const MESSAGE_TYPE = 'ULTRASCRIPTS_AI_GEMINI';

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

  const backend = {
    id: 'gemini',
    label: 'Gemini',
    supports: { text: true, json: true },
    status: () => state.status,
    query: async (task) => {
      const result = await sendGeminiMessage({ op: 'query', task });
      if (result?.status) state.status = normalizeStatus(result.status);
      return {
        backend: 'gemini',
        generatedAtIso: result?.generatedAtIso,
        model: result?.model,
        providerModel: result?.providerModel,
        usage: result?.usage,
        fallback: result?.fallback,
        text: result?.text,
        json: result?.json,
      };
    },
    refreshStatus,
  };

  const api = {
    backend,
    refreshStatus,
    register() {
      if (!window.UltrascriptsAIExecutor?.setBackend) return false;
      window.UltrascriptsAIExecutor.setBackend(backend);
      refreshStatus();
      return true;
    },
  };

  window.UltrascriptsAIGeminiBackend = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
