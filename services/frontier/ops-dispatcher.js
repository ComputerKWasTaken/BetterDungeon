// services/frontier/ops-dispatcher.js
//
// Full Frontier ops dispatcher. Consumes the script-written `frontier:out`
// request queue, routes requests to mounted module ops, and writes responses
// to `frontier:in:<module>` cards through Core's write queue.

(function () {
  if (window.Frontier?.opsDispatcher) return;

  const TAG = '[Frontier/ops]';
  const SESSION_KEY = 'frontier:ops:inflight';
  const DEFAULT_TIMEOUT_MS = 30000;
  const RESPONSE_TTL_TURNS = 10;
  const RESPONSE_CARD_MAX_BYTES = 120000;

  const state = {
    started: false,
    core: null,
    currentAdventureShortId: null,
    processed: new Map(),     // requestId -> { module, completedLiveCount }
    inflight: new Map(),      // requestId -> { request, startedAt, startedLiveCount }
    responseCache: new Map(), // moduleId -> response envelope
    acked: new Set(),         // request ids the script has acked this session
    lastOutValue: null,       // diagnostic only; `frontier:out` processing is idempotent
    metrics: {
      outCardsSeen: 0,
      requestsSeen: 0,
      dispatched: 0,
      skippedDuplicate: 0,
      acks: 0,
      pendingWrites: 0,
      terminalWrites: 0,
      errors: 0,
    },
  };

  function envelope() {
    return window.Frontier?.envelope;
  }

  function registry() {
    return window.Frontier?.registry;
  }

  function now() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function currentLiveCount() {
    return Number(state.core?.getLiveCount?.() || 0);
  }

  function currentAdventureShortId() {
    return window.Frontier?.ws?.getAdventureShortId?.() || state.currentAdventureShortId || null;
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function log(level, ...args) {
    if (level === 'debug' && !state.core?.inspect?.()?.debugEnabled) return;
    const method = level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'log');
    console[method](TAG, ...args);
  }

  // ---------- session mirror ----------

  function readSessionMirror(shortId) {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.adventureShortId !== shortId) return;

      if (Array.isArray(parsed.processed)) {
        for (const item of parsed.processed) {
          if (typeof item === 'string') {
            state.processed.set(item, { completedLiveCount: currentLiveCount() });
          } else if (item && typeof item.id === 'string') {
            state.processed.set(item.id, {
              module: item.module || null,
              completedLiveCount: Number(item.completedLiveCount || 0),
            });
          }
        }
      }
    } catch (err) {
      console.warn(TAG, 'failed to read session mirror', err);
    }
  }

  function writeSessionMirror() {
    try {
      const shortId = currentAdventureShortId();
      if (!shortId) return;
      const processed = [...state.processed.entries()]
        .slice(-200)
        .map(([id, meta]) => ({
          id,
          module: meta?.module || null,
          completedLiveCount: meta?.completedLiveCount || 0,
        }));
      const inflight = {};
      for (const [id, meta] of state.inflight) {
        inflight[id] = {
          module: meta.request?.module || null,
          op: meta.request?.op || null,
          startedAt: meta.startedAt,
          startedLiveCount: meta.startedLiveCount,
        };
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        adventureShortId: shortId,
        processed,
        inflight,
      }));
    } catch (err) {
      console.warn(TAG, 'failed to write session mirror', err);
    }
  }

  function clearSessionMirror() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
  }

  function resetForAdventure(shortId) {
    state.currentAdventureShortId = shortId || null;
    state.processed.clear();
    state.inflight.clear();
    state.responseCache.clear();
    state.acked.clear();
    state.lastOutValue = null;
    if (shortId) readSessionMirror(shortId);
    else clearSessionMirror();
  }

  // ---------- card cache ----------

  function cardValue(card) {
    return card?.value ?? card?.entry ?? card?.description ?? '';
  }

  function syncResponseCard(card) {
    const env = envelope();
    const moduleId = env?.moduleIdFromResponseTitle?.(card?.title);
    if (!moduleId || !env) return;
    const responseEnvelope = env.normalizeResponseEnvelope(cardValue(card));
    let removedAcked = false;
    for (const requestId of state.acked) {
      if (responseEnvelope.responses && requestId in responseEnvelope.responses) {
        delete responseEnvelope.responses[requestId];
        removedAcked = true;
      }
    }
    state.responseCache.set(moduleId, responseEnvelope);
    if (removedAcked) {
      writeResponseEnvelope(moduleId).catch((err) => {
        console.warn(TAG, `failed to rewrite acked response card for '${moduleId}'`, err);
      });
    }
  }

  function removeResponseCard(card) {
    const moduleId = envelope()?.moduleIdFromResponseTitle?.(card?.title);
    if (moduleId) state.responseCache.delete(moduleId);
  }

  function getResponseEnvelope(moduleId) {
    const env = envelope();
    if (!env) return { v: 1, responses: {} };
    let cached = state.responseCache.get(moduleId);
    if (!cached) {
      const card = state.core?.getCardByTitle?.(env.responseCardTitle(moduleId));
      cached = env.normalizeResponseEnvelope(cardValue(card));
      state.responseCache.set(moduleId, cached);
    }
    return cached;
  }

  async function writeResponseEnvelope(moduleId) {
    const env = envelope();
    const responseEnvelope = getResponseEnvelope(moduleId);
    env.pruneTerminalResponses(responseEnvelope, { maxBytes: RESPONSE_CARD_MAX_BYTES });
    const title = env.responseCardTitle(moduleId);
    await state.core.writeCard(title, JSON.stringify(responseEnvelope), { type: 'frontier' });
  }

  async function setResponse(moduleId, requestId, response, writeKind) {
    const responseEnvelope = getResponseEnvelope(moduleId);
    responseEnvelope.responses[requestId] = response;
    state.responseCache.set(moduleId, responseEnvelope);

    try {
      await writeResponseEnvelope(moduleId);
      if (writeKind === 'pending') state.metrics.pendingWrites++;
      if (writeKind === 'terminal') state.metrics.terminalWrites++;
    } catch (err) {
      state.metrics.errors++;
      console.warn(TAG, `failed to write response for '${requestId}'`, err);
    }
  }

  function getExistingResponse(moduleId, requestId) {
    return getResponseEnvelope(moduleId).responses[requestId] || null;
  }

  function responseIsTerminal(moduleId, requestId) {
    return !!envelope()?.isTerminalResponse?.(getExistingResponse(moduleId, requestId));
  }

  async function deleteAckedResponse(requestId) {
    let changed = false;
    const writes = [];

    state.acked.add(requestId);

    const env = envelope();
    const cards = window.Frontier?.ws?.getCards?.();
    if (cards && env) {
      for (const card of cards.values()) {
        const moduleId = env.moduleIdFromResponseTitle(card?.title);
        if (!moduleId || state.responseCache.has(moduleId)) continue;
        state.responseCache.set(moduleId, env.normalizeResponseEnvelope(cardValue(card)));
      }
    }

    for (const [moduleId, responseEnvelope] of state.responseCache) {
      if (responseEnvelope.responses && requestId in responseEnvelope.responses) {
        delete responseEnvelope.responses[requestId];
        changed = true;
        writes.push(writeResponseEnvelope(moduleId));
      }
    }
    if (changed) {
      state.metrics.acks++;
      await Promise.allSettled(writes);
    }
  }

  async function handleAcks(acks) {
    if (!Array.isArray(acks) || !acks.length) return;
    for (const requestId of acks) {
      if (typeof requestId !== 'string' || !requestId) continue;
      await deleteAckedResponse(requestId);
    }
  }

  // ---------- routing ----------

  function findMountedModule(moduleId) {
    let found = null;
    registry()?._forEachMounted?.((def, ctx) => {
      if (!found && def?.id === moduleId) found = { def, ctx };
    });
    return found;
  }

  function getOpDescriptor(def, opName) {
    const raw = def?.ops?.[opName];
    if (typeof raw === 'function') {
      return { handler: raw, idempotent: 'safe', timeoutMs: DEFAULT_TIMEOUT_MS };
    }
    if (raw && typeof raw === 'object' && typeof raw.handler === 'function') {
      return {
        handler: raw.handler,
        idempotent: raw.idempotent || 'safe',
        timeoutMs: Number(raw.timeoutMs || DEFAULT_TIMEOUT_MS),
      };
    }
    return null;
  }

  function withTimeout(promise, timeoutMs, requestId) {
    const limit = Number(timeoutMs || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(limit) || limit <= 0) return promise;

    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject({ code: 'timeout', message: `Operation timed out after ${limit} ms`, requestId });
      }, limit);
    });

    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function finalizeRequest(request, response) {
    if (state.processed.has(request.id)) return;
    await setResponse(request.module, request.id, response, 'terminal');
    state.inflight.delete(request.id);
    state.processed.set(request.id, {
      module: request.module,
      completedLiveCount: currentLiveCount(),
    });
    writeSessionMirror();
  }

  async function respond(requestId, data) {
    const meta = state.inflight.get(requestId);
    if (!meta?.request) {
      console.warn(TAG, `respond('${requestId}') ignored; request is not in flight`);
      return;
    }
    const response = envelope().okResponse(data, { liveCount: currentLiveCount() });
    await finalizeRequest(meta.request, response);
  }

  async function respondError(requestId, error) {
    const meta = state.inflight.get(requestId);
    if (!meta?.request) {
      console.warn(TAG, `respondError('${requestId}') ignored; request is not in flight`);
      return;
    }
    const response = envelope().errorResponse(error, { liveCount: currentLiveCount() });
    await finalizeRequest(meta.request, response);
  }

  async function dispatchRequest(request) {
    const env = envelope();
    state.metrics.requestsSeen++;

    if (state.processed.has(request.id) || state.inflight.has(request.id)) {
      state.metrics.skippedDuplicate++;
      return;
    }

    const existing = getExistingResponse(request.module, request.id);
    if (env.isTerminalResponse(existing)) {
      state.processed.set(request.id, {
        module: request.module,
        completedLiveCount: Number(existing.completedLiveCount || currentLiveCount()),
      });
      writeSessionMirror();
      state.metrics.skippedDuplicate++;
      return;
    }

    const startedAt = now();
    const startedLiveCount = currentLiveCount();
    state.inflight.set(request.id, { request, startedAt, startedLiveCount });
    writeSessionMirror();

    await setResponse(
      request.module,
      request.id,
      env.pendingResponse({ startedAt, liveCount: startedLiveCount }),
      'pending'
    );

    const mounted = findMountedModule(request.module);
    if (!mounted) {
      await finalizeRequest(
        request,
        env.errorResponse({
          code: 'unknown_module',
          message: `Module '${request.module}' is not registered or not enabled`,
        }, { liveCount: currentLiveCount() })
      );
      return;
    }

    const descriptor = getOpDescriptor(mounted.def, request.op);
    if (!descriptor) {
      await finalizeRequest(
        request,
        env.errorResponse({
          code: 'unknown_op',
          message: `Module '${request.module}' does not expose op '${request.op}'`,
        }, { liveCount: currentLiveCount() })
      );
      return;
    }

    state.metrics.dispatched++;
    try {
      const result = await withTimeout(
        Promise.resolve().then(() => descriptor.handler(cloneJson(request.args), mounted.ctx, request)),
        descriptor.timeoutMs,
        request.id
      );

      if (!responseIsTerminal(request.module, request.id)) {
        await finalizeRequest(request, env.okResponse(result, { liveCount: currentLiveCount() }));
      }
    } catch (err) {
      if (!responseIsTerminal(request.module, request.id)) {
        await finalizeRequest(request, env.errorResponse(err, { liveCount: currentLiveCount() }));
      }
    }
  }

  async function handleOutCard(card) {
    const env = envelope();
    if (!env || !card) return;
    const value = cardValue(card);
    state.lastOutValue = value;
    state.metrics.outCardsSeen++;

    const parsed = env.normalizeRequestEnvelope(value);
    if (parsed.errors.length) {
      log('warn', 'frontier:out contained envelope warnings:', parsed.errors);
    }
    if (parsed.envelope.v !== env.PROTOCOL_VERSION) return;

    await handleAcks(parsed.envelope.acks);
    for (const request of parsed.envelope.requests) {
      dispatchRequest(request);
    }
  }

  function processCards(cards, removed = false) {
    if (!Array.isArray(cards)) return;
    for (const card of cards) {
      if (!card?.title) continue;
      if (card.title === envelope()?.OUT_CARD_TITLE && !removed) {
        handleOutCard(card);
      } else if (card.title?.startsWith(envelope()?.IN_CARD_PREFIX || 'frontier:in:')) {
        if (removed) removeResponseCard(card);
        else syncResponseCard(card);
      }
    }
  }

  async function pruneByLiveCount() {
    const liveCount = currentLiveCount();
    const writes = [];

    for (const [moduleId, responseEnvelope] of state.responseCache) {
      let changed = false;
      for (const [requestId, response] of Object.entries(responseEnvelope.responses || {})) {
        if (!envelope().isTerminalResponse(response)) continue;
        const completedLiveCount = Number(response.completedLiveCount || 0);
        if (completedLiveCount > 0 && liveCount - completedLiveCount > RESPONSE_TTL_TURNS) {
          delete responseEnvelope.responses[requestId];
          changed = true;
        }
      }
      if (changed) writes.push(writeResponseEnvelope(moduleId));
    }

    for (const [requestId, meta] of [...state.processed.entries()]) {
      const completedLiveCount = Number(meta?.completedLiveCount || 0);
      if (completedLiveCount > 0 && liveCount - completedLiveCount > RESPONSE_TTL_TURNS) {
        state.processed.delete(requestId);
      }
    }

    if (writes.length) await Promise.allSettled(writes);
    writeSessionMirror();
  }

  function scanCurrentCards() {
    const cards = window.Frontier?.ws?.getCards?.();
    if (!cards) return;
    processCards([...cards.values()]);
  }

  function start(core) {
    if (state.started) return;
    if (!core || typeof core.on !== 'function') {
      throw new Error(`${TAG} start(core): Frontier Core is required`);
    }
    if (!envelope()) {
      throw new Error(`${TAG} start(core): Frontier envelope helpers are required`);
    }

    state.core = core;
    state.started = true;
    state.currentAdventureShortId = currentAdventureShortId();
    if (state.currentAdventureShortId) readSessionMirror(state.currentAdventureShortId);

    core.on('cards:full', (detail) => processCards(detail?.cards));
    core.on('cards:diff', (detail) => {
      processCards([...(detail?.added || []), ...(detail?.updated || [])]);
      processCards(detail?.removed, true);
    });
    core.on('adventure:enter', (detail) => resetForAdventure(detail?.shortId || currentAdventureShortId()));
    core.on('adventure:leave', () => resetForAdventure(null));
    core.on('livecount:change', () => {
      scanCurrentCards();
      pruneByLiveCount();
    });

    scanCurrentCards();
    console.log(TAG, 'started');
  }

  const opsDispatcher = {
    start,
    respond,
    respondError,
    inspect: () => ({
      started: state.started,
      adventureShortId: state.currentAdventureShortId,
      processed: [...state.processed.keys()],
      inflight: [...state.inflight.keys()],
      acked: [...state.acked.keys()],
      lastOutValue: state.lastOutValue,
      responseModules: [...state.responseCache.keys()],
      metrics: { ...state.metrics },
    }),
  };

  window.Frontier = window.Frontier || {};
  window.Frontier.opsDispatcher = opsDispatcher;
})();
