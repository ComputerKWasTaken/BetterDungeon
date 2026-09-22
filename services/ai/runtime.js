// Provider runtime shared by the extension worker and Android's native transport.
(function (root) {
  'use strict';
  const C = root.BetterDungeonAIConfig;
  const MESSAGE = 'BETTERDUNGEON_AI';
  const PORT = 'BETTERDUNGEON_AI_CHAT_V2';
  const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
  const clone = v => JSON.parse(JSON.stringify(v));
  function sameStored(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameStored(a[key], b[key]));
  }
  function create({ storage, fetch: transport, now = Date.now }) {
    let migration, last = null;
    const STATE_KEY = 'betterdungeon_ai_runtime_state_v1';
    let stateWrites = Promise.resolve();
    const suppressed = new Map(), catalogs = new Map();
    function persistState() {
      const value = { last, suppressed: Object.fromEntries(suppressed) };
      stateWrites = stateWrites.catch(() => {}).then(() => storage.set({ [STATE_KEY]: value }));
      return stateWrites;
    }
    async function config() {
      if (!migration) migration = (async () => {
        const saved = await storage.get([C.KEY, C.LEGACY_KEY, STATE_KEY]);
        last = saved[STATE_KEY]?.last || null;
        for (const [model, value] of Object.entries(saved[STATE_KEY]?.suppressed || {})) {
          if (C.mistral.some(m => m.id === model) && Number.isFinite(value?.until) && value.until > now() - 900000) suppressed.set(model, value);
        }
        if (saved[C.KEY]) return;
        const migrated = C.migrate(saved[C.LEGACY_KEY]);
        await storage.set({ [C.KEY]: migrated });
        const written = (await storage.get(C.KEY))[C.KEY];
        if (!sameStored(written, migrated)) throw fail('storage_failed', 'AI settings could not be saved. Original settings were preserved.');
        if (saved[C.LEGACY_KEY]) await storage.remove(C.LEGACY_KEY);
      })().catch(e => { migration = null; throw e; });
      await migration;
      return C.normalize((await storage.get(C.KEY))[C.KEY]);
    }
    async function save(raw) {
      if (!raw || raw.version !== 2) throw fail('invalid_args', 'Invalid AI settings version.');
      const old = await config();
      const next = C.normalize(raw);
      // Omitted keys in popup/status snapshots mean preserve; an explicit empty string clears.
      if (raw.simple?.apiKey === undefined) next.simple.apiKey = old.simple.apiKey;
      for (const name of Object.keys(next.advanced.profiles)) {
        if (raw.advanced?.profiles?.[name]?.apiKey === undefined) next.advanced.profiles[name].apiKey = old.advanced.profiles[name].apiKey;
      }
      await storage.set({ [C.KEY]: next });
      if (!sameStored((await storage.get(C.KEY))[C.KEY], next)) throw fail('storage_failed', 'AI settings could not be saved.');
      suppressed.clear(); catalogs.clear(); last = null;
      // The configuration is already committed. A failed diagnostic-state reset
      // must not report the user's settings as unsaved.
      await persistState().catch(() => {});
      return next;
    }
    function status(c, consumer) {
      const id = C.consumerId(consumer);
      const tier = c.advanced.enabled && c.routing[id] === 'advanced' ? 'advanced' : 'simple';
      const s = C.settings(c, tier);
      const ready = !!(s.configured || tier === 'advanced' && c.simple.apiKey);
      const cap = tier === 'advanced' && c.advanced.inputCapTokens || 128000;
      return { ready, available: ready, reason: ready ? null : 'not_configured',
        message: ready ? 'BetterDungeon AI is ready.' : 'Open the AI tab in the BetterDungeon popup to configure a provider.',
        limits: { maxInputTokens: Math.min(cap, s.service === 'mistral' ? 240000 : 2000000), maxInputChars: Math.min(cap, s.service === 'mistral' ? 240000 : 2000000) * 3, maxOutputTokens: 2048, resolved: true },
        config: { ...C.publicConfig(c), service: s.service,
          thinkingLevels: tier === 'simple' ? ['minimal', 'low', 'medium', 'high'] : [] }, consumer: id, tier, last };
    }
    async function http(url, init, signal, parse) {
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      if (signal?.aborted) throw fail('aborted', 'AI request cancelled.');
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
      try {
        const response = await transport(url, { ...init, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
        if (!response.ok) {
          // Never echo provider error bodies: they can contain prompts or credentials.
          let body = {};
          try { body = JSON.parse(await response.text()); } catch { /* use status classification */ }
          const reason = String(body?.error?.message || body?.message || '').toLowerCase();
          let code = response.status === 429 ? 'rate_limit' : [401, 403].includes(response.status) ? 'auth_failed' : [404, 410].includes(response.status) ? 'model_unavailable' : response.status >= 500 ? 'backend_failed' : 'invalid_args';
          if (/safety|prohibited|content.policy|content.filter/.test(reason)) code = 'safety_blocked';
          if (response.status === 429 && /monthly|billing|spend|organization.wide/.test(reason)) code = 'provider_limit';
          if (/context.{0,30}(length|window)|maximum context|too many tokens/.test(reason)) code = 'context_limit';
          const retry = response.headers?.get('retry-after');
          const delay = retry == null ? undefined : Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - now();
          throw fail(code, `AI provider returned ${response.status} (${code}).`, { retryAfterMs: Number.isFinite(delay) ? Math.max(0, delay) : undefined });
        }
        return await parse(response);
      } catch (e) {
        if (timedOut) throw fail('timeout', 'AI request timed out.');
        if (signal?.aborted) throw fail('aborted', 'AI request cancelled.');
        if (e?.code) throw e;
        throw fail('network_failed', 'Could not reach the AI provider.');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
    async function discover(s, signal) {
      const cache = catalogs.get(s.apiKey);
      if (cache && cache.until > now()) return cache.models;
      const data = await http(`${s.baseUrl}/models`, { method: 'GET', headers: { Authorization: `Bearer ${s.apiKey}` } }, signal, async r => {
        try { return await r.json(); } catch { throw fail('invalid_response', 'Model discovery returned invalid JSON.'); }
      });
      if (!Array.isArray(data.data)) throw fail('invalid_response', 'Model discovery returned no model list.');
      const models = new Map(data.data.map(m => [m.id, m]));
      catalogs.set(s.apiKey, { until: now() + 3600000, models });
      return models;
    }
    function taskData(raw) {
      const chat = raw?.op === 'chat';
      let task;
      try { task = chat ? root.BetterDungeonAI.createChatTask(raw) : root.BetterDungeonAI.createTask(raw); }
      catch (e) { throw fail('invalid_args', e.message || 'Invalid AI request.'); }
      const continuation = task.continuation;
      if (continuation && (!['betterdungeon-ai', 'openai-compatible'].includes(continuation.provider) || !Array.isArray(continuation.messages))) throw fail('invalid_args', 'Invalid AI continuation.');
      const prior = clone(continuation?.messages || []);
      if (task.toolResults?.length) {
        const calls = prior.flatMap(m => m.tool_calls || []);
        for (const r of task.toolResults) {
          if (!calls.some(c => c.id === r.callId && c.function?.name === r.name)) throw fail('invalid_args', 'Tool result does not match a pending call.');
          prior.push({ role: 'tool', tool_call_id: r.callId, name: r.name, content: JSON.stringify(r.result ?? null) });
        }
      }
      const messages = chat ? [{ role: 'system', content: task.systemInstruction }, ...task.messages, ...prior] : [
        ...(task.output.type === 'json' ? [{ role: 'system', content: `Return only JSON matching this schema: ${JSON.stringify(task.output.schema)}` }] : []),
        { role: 'user', content: task.prompt },
      ];
      const outputTokens = chat ? task.budget.maxOutputTokens : 2048;
      const inputTokens = Math.ceil((JSON.stringify(messages).length + JSON.stringify(task.tools || []).length) / 3);
      return { task, chat, prior, messages, outputTokens, inputTokens, totalTokens: inputTokens + outputTokens, consumer: C.consumerId(raw.consumer) };
    }
    function payload(info, s, model, stream) {
      if (s.service !== 'gemini') {
        const messages = clone(info.messages);
        if (s.service === 'mistral') {
          // Mistral requires nine alphanumeric characters for tool call IDs.
          const ids = new Map();
          for (const m of messages) for (const call of m.tool_calls || []) {
            if (!ids.has(call.id)) ids.set(call.id, `bd${ids.size.toString().padStart(7, '0')}`);
            call.id = ids.get(call.id);
          }
          for (const m of messages) if (m.role === 'tool') m.tool_call_id = ids.get(m.tool_call_id) || m.tool_call_id;
        }
        const body = { model, messages, max_tokens: info.outputTokens, stream };
        if (stream) body.stream_options = { include_usage: true };
        if (info.task.tools?.length) { body.tools = info.task.tools.map(t => ({ type: 'function', function: t })); body.tool_choice = 'auto'; }
        if (info.task.output?.type === 'json') body.response_format = s.service === 'mistral'
          ? { type: 'json_schema', json_schema: { name: 'betterdungeon_response', schema: info.task.output.schema, strict: true } }
          : { type: 'json_object' };
        return body;
      }
      const contents = [];
      const continuation = info.task.continuation;
      const native = continuation?.service === 'gemini' && continuation.model === model && Array.isArray(continuation.nativeContents);
      const initial = info.chat ? info.task.messages : [{ role: 'user', content: info.task.prompt }];
      for (const m of initial) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      if (native) {
        contents.push(...clone(continuation.nativeContents));
        if (info.task.toolResults.length) contents.push({ role: 'user', parts: info.task.toolResults.map(r => ({ functionResponse: { id: r.callId, name: r.name, response: { result: r.result ?? null } } })) });
      } else if (info.prior.length) {
        // A different model cannot reuse Gemini thought signatures. Completed tool
        // work is supplied as context, never requested for execution a second time.
        contents.push({ role: 'user', parts: [{ text: `Previous assistant tool work and completed results (do not repeat completed actions):\n${JSON.stringify(info.prior)}` }] });
      }
      const generationConfig = { maxOutputTokens: info.outputTokens };
      if (info.task.output?.type === 'json') {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseJsonSchema = info.task.output.schema;
      }
      const level = info.task.thinking?.level || 'minimal';
      generationConfig.thinkingConfig = { thinkingLevel: C.gemma.includes(model) ? (level === 'minimal' ? 'minimal' : 'high') : level };
      const body = { contents, generationConfig };
      const system = info.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (info.task.tools?.length) body.tools = [{ functionDeclarations: info.task.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }];
      return body;
    }
    async function parseResponse(response, gemini, stream, onDelta) {
      let text = '', finishReason = '', usage, providerModel;
      const calls = new Map(), nativeParts = [];
      let sequence = 0, ended = false;
      function accept(data) {
        if (data.error) throw fail('backend_failed', 'AI provider interrupted its response.');
        providerModel = data.modelVersion || data.model || providerModel;
        usage = data.usageMetadata || data.usage || usage;
        const choice = gemini ? data.candidates?.[0] : data.choices?.[0];
        if (data.promptFeedback?.blockReason) throw fail('safety_blocked', 'The provider blocked this request.');
        if (!choice) return;
        finishReason = choice.finishReason || choice.finish_reason || finishReason;
        if (finishReason) ended = true;
        if (/SAFETY|PROHIBITED|BLOCKLIST|RECITATION|content_filter/i.test(finishReason)) throw fail('safety_blocked', 'The provider blocked this response.');
        let delta = '';
        if (gemini) {
          for (const part of choice.content?.parts || []) {
            nativeParts.push(part);
            if (typeof part.text === 'string' && !part.thought) delta += part.text;
            if (part.functionCall) {
              const c = part.functionCall;
              const id = c.id || `bdcall${calls.size.toString().padStart(3, '0')}`;
              calls.set(id, { id, name: c.name, arguments: c.args || {} });
            }
          }
        } else {
          const message = choice.delta || choice.message || {};
          delta = typeof message.content === 'string' ? message.content : '';
          for (const [index, c] of (message.tool_calls || []).entries()) {
            const key = c.index ?? index;
            const old = calls.get(key) || { id: '', name: '', rawArguments: '' };
            old.id += c.id || ''; old.name += c.function?.name || ''; old.rawArguments += c.function?.arguments || '';
            calls.set(key, old);
          }
        }
        text += delta;
        if (delta) onDelta?.(delta, ++sequence);
      }
      const decodeJSON = str => { try { return JSON.parse(str); } catch { throw fail('invalid_response', 'AI provider returned invalid JSON.'); } };
      if (!stream) accept(decodeJSON(await response.text()));
      else {
        const reader = response.body?.getReader();
        if (!reader) throw fail('invalid_response', 'AI provider returned no response stream.');
        const decoder = new TextDecoder(); let buffer = '', event = [];
        const line = value => {
          if (value === '') {
            if (event.length) { const data = event.join('\n'); event = []; if (data === '[DONE]') ended = true; else accept(decodeJSON(data)); }
          } else if (value.startsWith('data:')) event.push(value.slice(5).trimStart());
        };
        try {
          while (true) {
            const chunk = await reader.read();
            buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1); }
            if (chunk.done) { if (buffer) line(buffer.replace(/\r$/, '')); line(''); break; }
          }
        } finally { await reader.cancel().catch(() => {}); }
        if (!ended) throw fail('invalid_response', 'AI stream ended before completion.');
      }
      const toolCalls = [...calls.values()].map(c => ({ id: c.id, name: c.name, arguments: c.arguments || decodeJSON(c.rawArguments || '{}') }));
      if (toolCalls.some(c => !c.id || !/^[a-z][a-z0-9_]{0,63}$/.test(c.name) || !c.arguments || typeof c.arguments !== 'object' || Array.isArray(c.arguments))) throw fail('invalid_response', 'AI provider returned invalid tool calls.');
      if (!text && !toolCalls.length) throw fail('invalid_response', 'AI provider returned no usable output.');
      return { text, toolCalls, nativeParts, finishReason, usage, providerModel, outputTruncated: /MAX_TOKENS|length/i.test(finishReason) };
    }
    async function attempt(info, s, model, signal, onDelta) {
      if (!model || /[\s/?#]/.test(model) && s.service === 'gemini') throw fail('invalid_args', 'Invalid model identifier.');
      const context = s.service === 'mistral' && C.mistral.some(m => m.id === model) ? 256000 : s.service === 'gemini' ? (C.gemma.includes(model) ? 256000 : 1048576) : null;
      if (context && info.totalTokens > context - 1024) throw fail('context_limit', 'The request exceeds this model’s context window.');
      const body = payload(info, s, model, info.chat);
      const gemini = s.service === 'gemini';
      const url = gemini ? `${s.baseUrl}/models/${encodeURIComponent(model)}:${info.chat ? 'streamGenerateContent?alt=sse' : 'generateContent'}` : `${s.baseUrl}/chat/completions`;
      const headers = { 'Content-Type': 'application/json', ...(gemini ? { 'x-goog-api-key': s.apiKey } : s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) };
      const result = await http(url, { method: 'POST', headers, body: JSON.stringify(body) }, signal, response => parseResponse(response, gemini, info.chat, onDelta));
      result.thinking = { requestedLevel: info.task.thinking?.level || 'minimal', applied: gemini,
        appliedLevel: gemini ? body.generationConfig.thinkingConfig.thinkingLevel : null };
      if (info.task.output?.type === 'json') {
        try { result.json = JSON.parse(result.text); } catch { throw fail('invalid_response', 'AI provider did not return valid JSON.'); }
      }
      if (result.toolCalls.length) {
        const message = { role: 'assistant', content: result.text || null, tool_calls: result.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) };
        result.continuation = { provider: 'betterdungeon-ai', service: s.service, model, messages: [...info.prior, message] };
        if (gemini) {
          const initialCount = info.chat ? info.task.messages.length : 1;
          result.continuation.nativeContents = [...body.contents.slice(initialCount), { role: 'model', parts: result.nativeParts }];
        }
      }
      delete result.nativeParts;
      return result;
    }
    async function run(c, raw, controls = {}, forcedTier) {
      const info = taskData(raw), attempted = [];
      if (controls.diagnostic) {
        info.outputTokens = 64;
        info.totalTokens = info.inputTokens + info.outputTokens;
      }
      const primary = forcedTier || (c.advanced.enabled && c.routing[info.consumer] === 'advanced' ? 'advanced' : 'simple');
      let advancedFallback = false, emitted = false;
      const onDelta = (text, seq) => { emitted = true; controls.onDelta?.(text, seq); };
      async function lane(tier) {
        const s = C.settings(c, tier);
        if (!s.configured) throw fail('not_configured', `Configure ${tier === 'simple' ? 'Gemini' : 'the Advanced provider'} in the AI tab.`);
        if (tier === 'advanced' && c.advanced.inputCapTokens && info.inputTokens > c.advanced.inputCapTokens) throw fail('invalid_args', 'The request exceeds the configured Advanced input cap.');
        const autoMistral = s.service === 'mistral' && s.modelMode === 'auto';
        const catalog = s.service === 'mistral' ? await discover(s, controls.signal) : null;
        let lastError;
        for (const model of C.models(c, tier, info.consumer, info.totalTokens)) {
          if (controls.signal?.aborted) throw fail('aborted', 'AI request cancelled.');
          if (catalog && !catalog.has(model)) {
            lastError = fail('model_unavailable', 'The configured Mistral model is unavailable.');
            if (!autoMistral) throw lastError;
            continue;
          }
          const key = model;
          if (autoMistral && suppressed.get(key)?.until > now()) { lastError = fail('rate_limit', 'Mistral capacity is temporarily unavailable.'); continue; }
          attempted.push(model);
          try {
            const result = await attempt(info, s, model, controls.signal, onDelta);
            suppressed.delete(key);
            const completion = { consumer: info.consumer, providerTier: tier, provider: s.service, model, attemptedModels: [...attempted], advancedFallback };
            if (!controls.diagnostic) {
              last = completion;
              await persistState().catch(() => {});
            }
            return { ...result, ...completion, service: s.service, generatedAtIso: new Date(now()).toISOString(), fallback: { advancedToSimple: advancedFallback, attemptedModels: [...attempted] }, status: status(c, info.consumer) };
          } catch (e) {
            lastError = e;
            if (emitted) throw e; // Do not concatenate output from two different attempts.
            const cascade = ['rate_limit', 'model_unavailable'].includes(e.code) && (s.service === 'gemini' || autoMistral);
            if (!cascade) throw e;
            if (autoMistral) {
              const count = (suppressed.get(key)?.count || 0) + 1;
              suppressed.set(key, { count, until: now() + (e.retryAfterMs ?? Math.min(60000 * 2 ** (count - 1), 900000)) });
              await persistState().catch(() => {});
            }
          }
        }
        throw fail(lastError?.code || 'model_unavailable', `${s.service === 'mistral' ? 'Mistral' : 'Gemini'} capacity exhausted. Attempted: ${attempted.join(', ') || 'no eligible models'}.`, { attemptedModels: [...attempted] });
      }
      try { return await lane(primary); }
      catch (error) {
        if (!forcedTier && primary === 'advanced' && c.simple.apiKey && !emitted && C.availabilityErrors.has(error.code)) {
          advancedFallback = true;
          return lane('simple');
        }
        throw error;
      }
    }
    async function handle(request = {}, controls = {}) {
      let c, timer, controller;
      const parentSignal = controls.signal;
      const cancel = () => controller?.abort();
      let timedOut = false;
      try {
        c = await config();
        if (request.op === 'settings:set') return status(await save(request.config), request.consumer);
        if (request.op === 'status' || request.op === 'settings:get') {
          const value = status(c, request.consumer);
          value.consumers = Object.fromEntries(C.consumers.map(id => [id, status(c, id)]));
          return value;
        }
        controller = new AbortController();
        if (parentSignal?.aborted) controller.abort();
        parentSignal?.addEventListener('abort', cancel, { once: true });
        // One deadline includes discovery and every fallback, so a script timeout
        // cannot leave a chain of new provider requests running in the background.
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, request.op === 'test' ? 30000 : 115000);
        controls = { ...controls, signal: controller.signal };
        if (request.op === 'test') return await run(c, { prompt: 'Reply with exactly: BetterDungeon AI ready', output: { type: 'text' }, consumer: 'ultrascripts' }, { ...controls, diagnostic: true }, request.tier === 'advanced' ? 'advanced' : 'simple');
        if (request.op === 'query' || request.op === 'chat') return await run(c, { ...request.task, op: request.op }, controls);
        throw fail('invalid_args', 'Unsupported AI operation.');
      } catch (e) { throw C.redactError(timedOut ? fail('timeout', 'AI request timed out.') : e, c); }
      finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', cancel); }
    }
    return Object.freeze({ handle, config });
  }
  function install({ runtime, storage, fetch }) {
    const api = create({ storage, fetch });
    runtime.onMessage.addListener((m, sender, respond) => {
      if (![MESSAGE, 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE'].includes(m?.type)) return false;
      if (sender?.id && sender.id !== runtime.id) return false;
      api.handle(m.request).then(data => respond({ ok: true, data }), error => respond({ ok: false, error }));
      return true;
    });
    runtime.onConnect.addListener(port => {
      if (![PORT, 'BETTERDUNGEON_AI_CHAT_OPENAI_COMPATIBLE_V1'].includes(port.name)) return;
      if (port.sender?.id && port.sender.id !== runtime.id) return port.disconnect();
      const controller = new AbortController();
      let started = false, closed = false, requestId, keepalive;
      const post = data => { if (!closed) try { port.postMessage({ v: 1, requestId, ...data }); } catch { close(); } };
      const startTimer = setTimeout(() => { close(); port.disconnect(); }, 5000);
      function close() { closed = true; clearTimeout(startTimer); clearInterval(keepalive); controller.abort(); }
      port.onDisconnect.addListener(close);
      port.onMessage.addListener(m => {
        if (closed || m?.v !== 1) return;
        if (m.type === 'abort' && m.requestId === requestId) return close();
        if (m.type !== 'start' || started) return;
        started = true; requestId = m.requestId; clearTimeout(startTimer);
        if (!requestId || m.task?.id && m.task.id !== requestId) { post({ type: 'error', error: { code: 'invalid_args', message: 'Invalid request ID.' } }); close(); return; }
        keepalive = setInterval(() => post({ type: 'keepalive' }), 20000);
        api.handle({ op: 'chat', task: m.task }, { signal: controller.signal, onDelta: (text, sequence) => post({ type: 'delta', text, sequence }) })
          .then(result => post({ type: 'complete', result }), error => post({ type: 'error', error }))
          .finally(() => { close(); setTimeout(() => { try { port.disconnect(); } catch { /* disconnected */ } }, 1000); });
      });
    });
    return api;
  }
  root.BetterDungeonAIRuntime = Object.freeze({ create, install });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BetterDungeonAIRuntime;
})(globalThis);
