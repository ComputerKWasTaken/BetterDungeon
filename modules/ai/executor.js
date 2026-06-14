// modules/ai/executor.js
//
// Backend-agnostic execution layer for Ultrascripts AI requests. It validates
// public query args, creates normalized query tasks, and adapts backend results
// into the public response contract. Provider transport lives elsewhere.

(function () {
  if (window.UltrascriptsAIExecutor) return;

  const VERSION = '0.1.0-executor';
  const PROMPT_MAX_CHARS = 12000;
  const OUTPUT_TYPES = Object.freeze(['text', 'json']);

  const state = {
    backend: null,
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      throw invalidArgs('value must be JSON-serializable');
    }
  }

  function invalidArgs(message, extra = {}) {
    return { code: 'invalid_args', message, ...extra };
  }

  function invalidResponse(message, extra = {}) {
    return { code: 'invalid_response', message, retryable: false, ...extra };
  }

  function normalizeArgs(args) {
    if (args === undefined || args === null) return {};
    if (!isObject(args)) throw invalidArgs('args must be an object');
    return args;
  }

  function normalizeOutput(output) {
    if (output === undefined || output === null) return { type: 'text' };
    if (typeof output === 'string') output = { type: output };
    if (!isObject(output)) throw invalidArgs('output must be an object or output type string');

    const type = output.type === undefined ? 'text' : output.type;
    if (typeof type !== 'string' || OUTPUT_TYPES.indexOf(type) === -1) {
      throw invalidArgs(`output.type must be one of: ${OUTPUT_TYPES.join(', ')}`);
    }

    const normalized = { type };
    if (output.schema !== undefined) {
      if (type !== 'json') throw invalidArgs('output.schema is only valid when output.type is json');
      if (!isObject(output.schema)) throw invalidArgs('output.schema must be a JSON object');
      normalized.schema = cloneJson(output.schema);
    }
    return normalized;
  }

  function normalizeQuery(args) {
    const normalized = normalizeArgs(args);
    if (typeof normalized.prompt !== 'string' || !normalized.prompt.trim()) {
      throw invalidArgs('prompt is required and must be a non-empty string');
    }
    if (normalized.prompt.length > PROMPT_MAX_CHARS) {
      throw invalidArgs(`prompt must be ${PROMPT_MAX_CHARS} characters or less`, {
        maxChars: PROMPT_MAX_CHARS,
        actualChars: normalized.prompt.length,
      });
    }

    return {
      prompt: normalized.prompt,
      promptChars: normalized.prompt.length,
      output: normalizeOutput(normalized.output),
    };
  }

  function createTask(args, meta = {}) {
    const query = normalizeQuery(args);
    const output = cloneJson(query.output);
    const task = {
      v: 1,
      id: typeof meta.requestId === 'string' && meta.requestId ? meta.requestId : null,
      module: 'ai',
      op: 'query',
      createdAtIso: new Date().toISOString(),
      prompt: query.prompt,
      promptChars: query.promptChars,
      output,
      responseContract: {
        type: output.type,
      },
    };
    if (output.schema) task.responseContract.schema = cloneJson(output.schema);
    return task;
  }

  function normalizeSupports(value) {
    const supports = isObject(value) ? value : {};
    return {
      text: supports.text === true,
      json: supports.json === true,
    };
  }

  function backendInfo() {
    const backend = state.backend;
    if (!backend) return null;
    return {
      id: backend.id || 'custom',
      label: backend.label || backend.id || 'Custom',
      supports: normalizeSupports(backend.supports),
    };
  }

  function status() {
    const backend = backendInfo();
    const supports = backend ? backend.supports : { text: false, json: false };
    const ready = !!(state.backend && typeof state.backend.query === 'function' && (supports.text || supports.json));
    return {
      backend: backend ? backend.id : null,
      ready,
      available: ready,
      phase: ready ? 'live' : 'executor',
      reason: ready ? null : 'ai_backend_not_configured',
      supports,
      contract: {
        ops: ['status', 'query'],
        outputTypes: [...OUTPUT_TYPES],
        asyncOnly: true,
      },
      executor: {
        version: VERSION,
        promptMaxChars: PROMPT_MAX_CHARS,
        backendConfigured: !!backend,
      },
      message: ready
        ? 'AI querying is available.'
        : 'The AI execution layer is available, but no callable generation backend is configured right now.',
    };
  }

  function normalizeTextResult(result) {
    if (typeof result?.text === 'string') return result.text;
    if (typeof result === 'string') return result;
    throw invalidResponse('AI backend did not return text output');
  }

  function normalizeJsonResult(result) {
    if (result && result.json !== undefined) return cloneJson(result.json);
    if (typeof result?.text === 'string') {
      try {
        return JSON.parse(result.text);
      } catch (err) {
        throw invalidResponse('AI backend returned invalid JSON text', {
          detail: err?.message || 'invalid_json',
        });
      }
    }
    throw invalidResponse('AI backend did not return JSON output');
  }

  function normalizeBackendResult(result, task) {
    const base = {
      backend: result?.backend || backendInfo()?.id || null,
      outputType: task.output.type,
      promptChars: task.promptChars,
      generatedAtIso: result?.generatedAtIso || new Date().toISOString(),
    };

    if (task.output.type === 'json') {
      return { ...base, json: normalizeJsonResult(result) };
    }
    return { ...base, text: normalizeTextResult(result) };
  }

  function setBackend(backend) {
    if (!isObject(backend)) throw new TypeError('backend must be an object');
    if (typeof backend.query !== 'function') throw new TypeError('backend.query(task) is required');
    state.backend = {
      ...backend,
      supports: normalizeSupports(backend.supports),
    };
    return status();
  }

  function clearBackend() {
    state.backend = null;
    return status();
  }

  async function query(args, meta = {}) {
    const task = createTask(args, meta);
    if (!state.backend) {
      throw {
        code: 'not_configured',
        message: 'No AI backend is configured yet.',
        retryable: false,
        backend: null,
        phase: status().phase,
        task: {
          id: task.id,
          outputType: task.output.type,
          promptChars: task.promptChars,
        },
      };
    }

    const supports = normalizeSupports(state.backend.supports);
    if (supports[task.output.type] !== true) {
      throw {
        code: 'unavailable',
        message: `The configured AI backend does not support ${task.output.type} output.`,
        retryable: false,
        backend: backendInfo()?.id || null,
        outputType: task.output.type,
      };
    }

    const result = await state.backend.query(cloneJson(task));
    return normalizeBackendResult(result, task);
  }

  const executor = {
    VERSION,
    PROMPT_MAX_CHARS,
    OUTPUT_TYPES,
    createTask,
    query,
    status,
    setBackend,
    clearBackend,
    inspect: () => ({
      ...status(),
      hasBackend: !!state.backend,
    }),
  };

  window.UltrascriptsAIExecutor = executor;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = executor;
  }
})();
