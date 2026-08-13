'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const local = new Map([
  ['ultrascripts_ai_gemini_api_key', 'legacy-gemini'],
  ['ultrascripts_ai_openai_model', 'legacy-model'],
]);
const sync = new Map([['ultrascripts_ai_default_provider', 'openai']]);
const messageListeners = [];
const connectListeners = [];
const pageListeners = new Map();
const requests = [];
let holdStream = false;

global.window = global;
const realSetTimeout = global.setTimeout;
global.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, delay === 120000 ? 40 : delay, ...args);
global.location = { protocol: 'https:', href: 'https://play.aidungeon.com/adventure/test' };
global.addEventListener = (type, listener) => {
  const list = pageListeners.get(type) || [];
  list.push(listener);
  pageListeners.set(type, list);
};
global.removeEventListener = (type, listener) => {
  pageListeners.set(type, (pageListeners.get(type) || []).filter(candidate => candidate !== listener));
};

function storageArea(store) {
  return {
    get(keys, callback) {
      const names = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
      const result = {};
      names.forEach(key => {
        if (store.has(key)) result[key] = JSON.parse(store.get(key));
      });
      callback?.(result);
      return Promise.resolve(result);
    },
    set(values, callback) {
      Object.entries(values || {}).forEach(([key, value]) => store.set(key, JSON.stringify(value)));
      callback?.();
      return Promise.resolve();
    },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach(key => store.delete(key));
      callback?.();
      return Promise.resolve();
    },
  };
}

function event(list) {
  return {
    addListener(listener) { list.push(listener); },
    removeListener(listener) {
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
  };
}

function createPortPair(name) {
  const clientMessages = [];
  const runtimeMessages = [];
  const clientDisconnects = [];
  const runtimeDisconnects = [];
  let closed = false;
  const dispatch = (listeners, value, port) => queueMicrotask(() => listeners.slice().forEach(listener => listener(value, port)));
  const disconnect = () => {
    if (closed) return;
    closed = true;
    dispatch(clientDisconnects, client, client);
    dispatch(runtimeDisconnects, server, server);
  };
  const client = {
    name,
    onMessage: event(clientMessages),
    onDisconnect: event(clientDisconnects),
    postMessage(value) { if (!closed) dispatch(runtimeMessages, value, server); },
    disconnect,
  };
  const server = {
    name,
    sender: { id: 'betterdungeon-test' },
    onMessage: event(runtimeMessages),
    onDisconnect: event(runtimeDisconnects),
    postMessage(value) { if (!closed) dispatch(clientMessages, value, client); },
    disconnect,
  };
  queueMicrotask(() => connectListeners.slice().forEach(listener => listener(server)));
  return client;
}

function dispatchMessage(message, callback) {
  let handled = false;
  for (const listener of messageListeners) {
    const result = listener(message, { id: 'betterdungeon-test' }, response => callback?.(response));
    if (result === true) { handled = true; break; }
  }
  if (!handled) callback?.();
}

global.chrome = {
  runtime: {
    id: 'betterdungeon-test',
    lastError: null,
    onMessage: event(messageListeners),
    onConnect: event(connectListeners),
    sendMessage(message, callback) {
      dispatchMessage(message, callback);
    },
    connect({ name }) { return createPortPair(name); },
  },
  storage: {
    local: storageArea(local),
    sync: storageArea(sync),
  },
};

function jsonResponse(status, data, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function streamResponse(frames) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      if (holdStream) {
        holdStream = false;
        setTimeout(() => controller.close(), 80);
        return;
      }
      frames.forEach(frame => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
    cancel() {},
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function sse(events) {
  return events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`);
}

const SIGNATURE_ONE = 'sig-one+/=byte-for-byte';
const SIGNATURE_TWO = 'sig-two+/=byte-for-byte';

global.fetch = async (url, init) => {
  const payload = JSON.parse(init.body);
  requests.push({ url, payload, headers: init.headers });
  const prompt = payload.messages?.map(message => message.content || '').join(' ') || '';

  if (prompt.includes('auth-error')) return jsonResponse(401, { error: { message: 'bad key' } });
  if (prompt.includes('safety-error')) return jsonResponse(400, { error: { status: 'PROHIBITED_CONTENT', message: 'blocked' } });
  if (prompt.includes('malformed-response')) return new Response('{nope', { status: 200 });
  if (prompt.includes('fallback-test') && payload.model === 'gemini-3.5-flash-lite') {
    return jsonResponse(429, { error: { message: 'quota' } }, { 'retry-after': '1' });
  }
  if (prompt.includes('manual-rate-limit') || prompt.includes('openrouter-rate-limit')) {
    return jsonResponse(429, { error: { message: 'quota' } });
  }
  if (prompt.includes('custom-unsupported') && payload.reasoning_effort) {
    return jsonResponse(400, { error: { message: 'unknown parameter reasoning_effort' } });
  }
  if (!payload.stream) {
    const content = payload.response_format ? JSON.stringify({ ok: true }) : `answer:${payload.model}`;
    return jsonResponse(200, { model: `${payload.model}-provider`, choices: [{ message: { content } }], usage: { total_tokens: 7 } });
  }
  if (prompt.includes('hold-open')) {
    holdStream = true;
    return streamResponse([]);
  }
  if (prompt.includes('malformed-stream')) return streamResponse(['data: {not-json\n\n']);
  if (prompt.includes('tool-round-one')) {
    return streamResponse(sse([
      { model: payload.model, choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'read_card', arguments: '{"id":' }, extra_content: { google: { thought_signature: SIGNATURE_ONE } } }, { index: 1, id: 'call_plot', type: 'function', function: { name: 'read_plot', arguments: '{}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"card-1"}' } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ]));
  }
  if (prompt.includes('tool-round-two')) {
    const replay = payload.messages.find(message => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call_read');
    assert.equal(replay.tool_calls[0].extra_content.google.thought_signature, SIGNATURE_ONE);
    return streamResponse(sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_next', type: 'function', function: { name: 'read_card', arguments: '{"id":"card-2"}' }, extra_content: { google: { thought_signature: SIGNATURE_TWO } } }] }, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ]));
  }
  if (prompt.includes('tool-round-three')) {
    const assistants = payload.messages.filter(message => message.role === 'assistant' && message.tool_calls);
    assert.equal(assistants[0].tool_calls[0].extra_content.google.thought_signature, SIGNATURE_ONE);
    assert.equal(assistants[1].tool_calls[0].extra_content.google.thought_signature, SIGNATURE_TWO);
  }
  return streamResponse(sse([
    { model: payload.model, choices: [{ delta: { content: 'Hello ' } }] },
    { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }], usage: { total_tokens: 9 } },
    '[DONE]',
  ]));
};

function load(relative) {
  const filename = path.join(ROOT, relative);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('background-ai-openai-compatible.js');
load('modules/ai/executor.js');
load('modules/ai/openai-compatible-backend.js');

function raw(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE', request }, response => {
      if (response?.ok) resolve(response.data);
      else reject(response?.error || new Error('missing response'));
    });
  });
}

function chatArgs(content, extra = {}) {
  return {
    messages: [{ role: 'user', content }],
    systemInstruction: 'Answer briefly.',
    budget: { maxInputChars: 12000, maxOutputTokens: 256 },
    thinking: { level: 'low' },
    tools: [],
    ...extra,
  };
}

async function configure(service, profile) {
  const result = await raw({ op: 'settings:set', config: { version: 1, activeService: service, profiles: { [service]: profile } } });
  await window.UltrascriptsAIExecutor.refreshStatus();
  return result;
}

(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(local.has('ultrascripts_ai_gemini_api_key'), false);
  assert.equal(local.has('ultrascripts_ai_openai_model'), false);
  assert.equal(sync.has('ultrascripts_ai_default_provider'), false);
  const initial = await raw({ op: 'status' });
  assert.equal(initial.service, 'gemini');
  assert.equal(initial.ready, false);
  assert.equal((await configure('gemini', { apiKey: 'test-gemini', modelMode: 'manual', model: '' })).ready, false);
  assert.equal((await configure('openrouter', { apiKey: '', model: 'router-model' })).ready, false);
  await configure('gemini', { apiKey: '', modelMode: 'auto', model: 'gemini-3.5-flash-lite' });

  const inspected = window.UltrascriptsAIExecutor.inspect();
  assert.equal(inspected.providers.length, 1);
  assert.equal(inspected.defaultProvider, 'openai-compatible');
  assert.deepEqual(inspected.supports, { text: true, json: true, thinking: true });

  await configure('gemini', { apiKey: 'test-gemini', modelMode: 'auto', model: 'gemini-3.5-flash-lite' });
  const text = await window.UltrascriptsAIExecutor.query({ prompt: 'plain query', thinking: { level: 'high' } });
  assert.equal(text.meta.provider, 'openai-compatible');
  assert.equal(text.meta.backend, 'openai-compatible');
  assert.equal(text.meta.service, 'gemini');
  assert.equal(requests.at(-1).payload.reasoning_effort, 'high');

  const structured = await window.UltrascriptsAIExecutor.query({
    prompt: 'structured query',
    thinking: { level: 'low' },
    output: { type: 'json', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } },
  });
  assert.deepEqual(structured.json, { ok: true });
  assert.equal(requests.at(-1).payload.response_format.type, 'json_schema');
  assert.deepEqual(requests.at(-1).payload.response_format.json_schema.schema.required, ['ok']);

  const fallback = await window.UltrascriptsAIExecutor.query({ prompt: 'fallback-test' });
  assert.equal(fallback.meta.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(fallback.meta.fallback.attemptedModels, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);

  await configure('gemini', { modelMode: 'manual', model: 'gemini-manual' });
  const beforeManual = requests.length;
  await assert.rejects(() => window.UltrascriptsAIExecutor.query({ prompt: 'manual-rate-limit' }), error => error.code === 'rate_limit');
  assert.equal(requests.length, beforeManual + 1);

  await configure('gemini', { modelMode: 'manual', model: 'gemma-4-31b-it' });
  await window.UltrascriptsAIExecutor.query({ prompt: 'gemma high', thinking: { level: 'high' } });
  assert.equal(requests.at(-1).payload.extra_body.google.thinking_config.thinking_level, 'high');
  assert.equal(requests.at(-1).payload.reasoning_effort, undefined);
  await window.UltrascriptsAIExecutor.query({ prompt: 'gemma minimal', thinking: { level: 'minimal' } });
  assert.equal(requests.at(-1).payload.extra_body, undefined);

  await configure('openrouter', { apiKey: 'test-openrouter', model: 'router-model' });
  assert.deepEqual(window.UltrascriptsAIExecutor.status().supports, { text: true, json: true, thinking: false });
  await window.UltrascriptsAIExecutor.query({
    prompt: 'router json',
    output: { type: 'json', schema: { type: 'object' } },
  });
  assert.equal(requests.at(-1).payload.response_format.type, 'json_object');
  assert.equal(requests.at(-1).payload.reasoning_effort, undefined);
  assert.match(requests.at(-1).payload.messages[0].content, /JSON schema/);
  const beforeRouter = requests.length;
  await assert.rejects(() => window.UltrascriptsAIExecutor.query({ prompt: 'openrouter-rate-limit' }), error => error.code === 'rate_limit');
  assert.equal(requests.length, beforeRouter + 1);

  const customBad = await configure('custom', { baseUrl: 'http://localhost:1234/v1', model: 'local' });
  assert.equal(customBad.ready, false);
  const customGood = await configure('custom', { baseUrl: 'https://provider.example/v1', model: 'custom-model' });
  assert.equal(customGood.ready, true);
  const retryStages = [];
  const retryResult = await window.UltrascriptsAIExecutor.chat(chatArgs('custom-unsupported', {
    thinking: { level: 'high', sendReasoningToCustom: true },
  }), { onStage: stage => retryStages.push(stage) });
  assert.equal(retryResult.text, 'Hello world');
  assert.deepEqual(retryStages, ['connected', 'streaming']);
  assert.equal(requests.at(-2).payload.reasoning_effort, 'high');
  assert.equal(requests.at(-1).payload.reasoning_effort, undefined);

  await configure('gemini', { modelMode: 'manual', model: 'gemini-tool-model' });
  const deltas = [];
  const stages = [];
  const streamed = await window.UltrascriptsAIExecutor.chat(chatArgs('stream text'), {
    onDelta: delta => deltas.push(delta.text),
    onStage: stage => stages.push(stage),
  });
  assert.equal(streamed.text, 'Hello world');
  assert.deepEqual(deltas, ['Hello ', 'world']);
  assert.deepEqual(stages, ['connected', 'streaming']);

  const tools = [
    { name: 'read_card', description: 'Read one card.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'read_plot', description: 'Read the plot.', parameters: { type: 'object', properties: {} } },
  ];
  const roundOne = await window.UltrascriptsAIExecutor.chat(chatArgs('tool-round-one', { tools }));
  assert.equal(roundOne.toolCalls.length, 2);
  assert.equal(roundOne.continuation.service, 'gemini');
  assert.equal(roundOne.continuation.messages[0].tool_calls[0].extra_content.google.thought_signature, SIGNATURE_ONE);
  const roundTwo = await window.UltrascriptsAIExecutor.chat(chatArgs('tool-round-two', {
    tools,
    continuation: roundOne.continuation,
    toolResults: roundOne.toolCalls.map(call => ({ callId: call.id, name: call.name, result: { ok: true } })),
  }));
  assert.equal(roundTwo.continuation.messages.at(-1).tool_calls[0].extra_content.google.thought_signature, SIGNATURE_TWO);
  await window.UltrascriptsAIExecutor.chat(chatArgs('tool-round-three', {
    tools,
    continuation: roundTwo.continuation,
    toolResults: roundTwo.toolCalls.map(call => ({ callId: call.id, name: call.name, result: { ok: true } })),
  }));

  await configure('openrouter', { model: 'router-model' });
  await assert.rejects(() => window.UltrascriptsAIExecutor.chat(chatArgs('wrong service', {
    tools,
    continuation: roundOne.continuation,
    toolResults: roundOne.toolCalls.map(call => ({ callId: call.id, name: call.name, result: {} })),
  })), error => error.code === 'invalid_args');

  await assert.rejects(() => window.UltrascriptsAIExecutor.query({ prompt: 'auth-error' }), error => error.code === 'auth_failed');
  await assert.rejects(() => window.UltrascriptsAIExecutor.query({ prompt: 'safety-error' }), error => error.code === 'prohibited_content');
  await assert.rejects(() => window.UltrascriptsAIExecutor.query({ prompt: 'malformed-response' }), error => error.code === 'invalid_response');

  await configure('custom', { baseUrl: 'https://provider.example/v1', model: 'custom-model' });
  await assert.rejects(
    () => window.UltrascriptsAIExecutor.chat(chatArgs('malformed-stream')),
    error => error.code === 'invalid_response',
  );
  const controller = new AbortController();
  const pending = window.UltrascriptsAIExecutor.chat(chatArgs('hold-open'), { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, error => error.code === 'aborted');

  await assert.rejects(
    () => window.UltrascriptsAIExecutor.chat(chatArgs('hold-open')),
    error => error.code === 'timeout',
  );

  console.log('Desktop OpenAI-compatible AI contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
