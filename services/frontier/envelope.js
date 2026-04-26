// services/frontier/envelope.js
//
// Pure helpers for the Full Frontier request/response envelope. This file
// intentionally has no Core or DOM dependencies so the dispatcher, tests, and
// future modules can share one definition of v1 envelope behavior.

(function () {
  if (window.Frontier?.envelope) return;

  const PROTOCOL_VERSION = 1;
  const OUT_CARD_TITLE = 'frontier:out';
  const IN_CARD_PREFIX = 'frontier:in:';

  const TERMINAL_STATUSES = new Set(['ok', 'err', 'timeout']);
  const RESERVED_ERROR_CODES = new Set([
    'unknown_module',
    'unknown_op',
    'invalid_args',
    'consent_denied',
    'rate_limit',
    'timeout',
    'handler_threw',
    'scheme_blocked',
    'unsafe_replay_blocked',
  ]);

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function parseJson(value) {
    if (isObject(value)) return { ok: true, value };
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, value: null, error: 'empty_json' };
    }
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch (err) {
      return { ok: false, value: null, error: err?.message || 'invalid_json' };
    }
  }

  function responseCardTitle(moduleId) {
    return IN_CARD_PREFIX + String(moduleId || '');
  }

  function moduleIdFromResponseTitle(title) {
    if (typeof title !== 'string' || !title.startsWith(IN_CARD_PREFIX)) return null;
    const moduleId = title.slice(IN_CARD_PREFIX.length);
    return moduleId || null;
  }

  function normalizeRequestEnvelope(value) {
    const parsed = parseJson(value);
    const errors = [];
    if (!parsed.ok || !isObject(parsed.value)) {
      return { valid: false, envelope: { v: PROTOCOL_VERSION, requests: [], acks: [] }, errors: [parsed.error || 'invalid_envelope'] };
    }

    const raw = parsed.value;
    if (raw.v !== PROTOCOL_VERSION) {
      return { valid: false, envelope: { v: raw.v, requests: [], acks: [] }, errors: [`unsupported_version:${raw.v}`] };
    }

    const requests = [];
    if (Array.isArray(raw.requests)) {
      for (const item of raw.requests) {
        const normalized = normalizeRequest(item);
        if (normalized.valid) requests.push(normalized.request);
        else errors.push(...normalized.errors);
      }
    } else if (raw.requests !== undefined) {
      errors.push('requests_not_array');
    }

    const acks = [];
    if (Array.isArray(raw.acks)) {
      for (const ack of raw.acks) {
        if (typeof ack === 'string' && ack) acks.push(ack);
      }
    } else if (raw.acks !== undefined) {
      errors.push('acks_not_array');
    }

    return {
      valid: errors.length === 0,
      envelope: { v: PROTOCOL_VERSION, requests, acks },
      errors,
    };
  }

  function normalizeRequest(value) {
    const errors = [];
    if (!isObject(value)) {
      return { valid: false, request: null, errors: ['request_not_object'] };
    }

    const request = {
      id: typeof value.id === 'string' ? value.id : '',
      module: typeof value.module === 'string' ? value.module : '',
      op: typeof value.op === 'string' ? value.op : '',
      args: value.args === undefined ? {} : cloneJson(value.args),
      ts: Number.isFinite(Number(value.ts)) ? Number(value.ts) : Date.now(),
    };

    if (!request.id) errors.push('request_missing_id');
    if (!request.module) errors.push(`request_missing_module:${request.id || '?'}`);
    if (!request.op) errors.push(`request_missing_op:${request.id || '?'}`);
    if (request.args === null && value.args !== null) errors.push(`request_args_not_json:${request.id || '?'}`);

    return { valid: errors.length === 0, request, errors };
  }

  function normalizeResponseEnvelope(value) {
    const parsed = parseJson(value);
    if (!parsed.ok || !isObject(parsed.value) || parsed.value.v !== PROTOCOL_VERSION) {
      return { v: PROTOCOL_VERSION, responses: {} };
    }

    const responses = {};
    const rawResponses = isObject(parsed.value.responses) ? parsed.value.responses : {};
    for (const [id, response] of Object.entries(rawResponses)) {
      if (typeof id !== 'string' || !id || !isObject(response)) continue;
      responses[id] = { ...response };
    }
    return { v: PROTOCOL_VERSION, responses };
  }

  function createResponseEnvelope() {
    return { v: PROTOCOL_VERSION, responses: {} };
  }

  function pendingResponse(meta = {}) {
    const now = Date.now();
    return {
      status: 'pending',
      startedAt: meta.startedAt || now,
      startedLiveCount: Number.isFinite(Number(meta.liveCount)) ? Number(meta.liveCount) : undefined,
    };
  }

  function okResponse(data, meta = {}) {
    const now = Date.now();
    return {
      status: 'ok',
      data: cloneJson(data),
      completedAt: meta.completedAt || now,
      completedLiveCount: Number.isFinite(Number(meta.liveCount)) ? Number(meta.liveCount) : undefined,
    };
  }

  function errorResponse(error, meta = {}) {
    const normalized = normalizeError(error);
    const now = Date.now();
    const status = normalized.code === 'timeout' ? 'timeout' : 'err';
    return {
      status,
      error: normalized,
      completedAt: meta.completedAt || now,
      completedLiveCount: Number.isFinite(Number(meta.liveCount)) ? Number(meta.liveCount) : undefined,
    };
  }

  function normalizeError(error) {
    if (isObject(error)) {
      const code = typeof error.code === 'string' && error.code
        ? error.code
        : 'handler_threw';
      const out = {
        ...cloneJson(error),
        code,
        message: typeof error.message === 'string' ? error.message : code,
      };
      return out;
    }

    if (error instanceof Error) {
      return {
        code: 'handler_threw',
        message: error.message || 'Handler threw',
      };
    }

    if (typeof error === 'string' && error) {
      return { code: 'handler_threw', message: error };
    }

    return { code: 'handler_threw', message: 'Handler threw' };
  }

  function isTerminalResponse(response) {
    return isObject(response) && TERMINAL_STATUSES.has(response.status);
  }

  function responseSortValue(response) {
    if (!isObject(response)) return 0;
    return Number(response.completedAt || response.startedAt || 0) || 0;
  }

  function pruneTerminalResponses(envelope, opts = {}) {
    if (!isObject(envelope) || !isObject(envelope.responses)) return envelope;
    const maxBytes = Number(opts.maxBytes || 0);
    if (!maxBytes || maxBytes <= 0) return envelope;

    let json = JSON.stringify(envelope);
    if (json.length <= maxBytes) return envelope;

    const terminalIds = Object.entries(envelope.responses)
      .filter(([, response]) => isTerminalResponse(response))
      .sort((a, b) => responseSortValue(a[1]) - responseSortValue(b[1]))
      .map(([id]) => id);

    while (json.length > maxBytes && terminalIds.length) {
      delete envelope.responses[terminalIds.shift()];
      json = JSON.stringify(envelope);
    }
    return envelope;
  }

  window.Frontier = window.Frontier || {};
  window.Frontier.envelope = {
    PROTOCOL_VERSION,
    OUT_CARD_TITLE,
    IN_CARD_PREFIX,
    RESERVED_ERROR_CODES,
    responseCardTitle,
    moduleIdFromResponseTitle,
    normalizeRequestEnvelope,
    normalizeRequest,
    normalizeResponseEnvelope,
    createResponseEnvelope,
    pendingResponse,
    okResponse,
    errorResponse,
    normalizeError,
    isTerminalResponse,
    pruneTerminalResponses,
  };
})();
