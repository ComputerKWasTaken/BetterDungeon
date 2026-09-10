'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const C = require('../../services/ai/config.js');
require('../../modules/ai/executor.js');
const Runtime = require('../../services/ai/runtime.js');
const copy = v => JSON.parse(JSON.stringify(v));
const query = { op: 'query', task: { prompt: 'Describe the forest.', output: { type: 'text' }, consumer: 'ultrascripts' } };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const reply = () => json({ choices: [{ message: { content: 'Forest' }, finish_reason: 'stop' }] });
const geminiReply = () => json({ candidates: [{ content: { parts: [{ text: 'Forest' }] }, finishReason: 'STOP' }] });
const limited = (headers = {}) => json({ error: { message: 'Model rate limit' } }, 429, headers);
const stream = events => new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\r\n\r\n').join(''));
function advanced(service = 'mistral') {
  return C.normalize({ simple: { apiKey: 'gemini-secret' }, advanced: { enabled: true, activeService: service,
    profiles: { mistral: { apiKey: 'mistral-secret', modelMode: 'auto' }, openrouter: { apiKey: 'router-secret', model: 'example/model' } } },
    routing: { ultrascripts: 'advanced', navigator: 'advanced' } });
}
function setup(config, fetch, initial) {
  const data = initial || { [C.KEY]: config };
  const requests = [], writes = [];
  let time = 100000;
  const storage = {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => data[k] !== undefined).map(k => [k, copy(data[k])])),
    set: async values => { writes.push('set'); Object.assign(data, copy(values)); },
    remove: async key => { writes.push('remove'); delete data[key]; },
  };
  const api = Runtime.create({ storage, now: () => time, fetch: async (url, init) => {
    requests.push({ url, ...init });
    if (url.endsWith('/models')) return json({ data: C.mistral.map(m => ({ id: m.id, max_context_length: m.context })) });
    return fetch(url, init);
  } });
  return { api, requests, data, writes, storage, advance: n => { time += n; } };
}
test('migration preserves profiles and keys; status redacts them; failed writes preserve legacy data', async () => {
  const old = { activeService: 'custom', profiles: { gemini: { apiKey: 'g-secret', model: 'old' }, custom: { apiKey: 'c-secret', model: 'abc', baseUrl: 'https://example.com/v1' } } };
  const h = setup(null, reply, { [C.LEGACY_KEY]: old });
  const result = await h.api.handle({ op: 'settings:get' });
  assert.deepEqual(h.writes, ['set', 'remove']);
  assert.equal(h.data[C.KEY].simple.apiKey, 'g-secret');
  assert.equal(h.data[C.KEY].advanced.profiles.custom.apiKey, 'c-secret');
  assert.ok(Object.values(result.config.routing).every(v => v === 'advanced'));
  assert.ok(!JSON.stringify(result).includes('-secret'));
  await h.api.handle({ op: 'settings:set', config: result.config });
  assert.equal(h.data[C.KEY].simple.apiKey, 'g-secret');
  const broken = setup(null, reply, { [C.LEGACY_KEY]: old });
  broken.storage.set = async () => { throw new Error('Disk full'); };
  await assert.rejects(broken.api.config());
  assert.ok(broken.data[C.LEGACY_KEY]);
});
test('Gemini lanes and Navigator large-request eligibility', () => {
  const c = C.normalize({ simple: { apiKey: 'g' } });
  assert.deepEqual(C.models(c, 'simple', 'ultrascripts', 4000), C.flash);
  assert.deepEqual(C.models(c, 'simple', 'character-presets', 4000), C.gemma);
  c.simple.quotaStrategy = 'shared';
  assert.deepEqual(C.models(c, 'simple', 'navigator', 12001), C.flash);
  assert.deepEqual(C.models(c, 'simple', 'navigator', 12000), [...C.flash, ...C.gemma]);
});
test('Mistral Automatic falls through in order, respects suppression and returns actual provider metadata', async () => {
  let success = false;
  const h = setup(advanced(), (_url, init) => {
    const m = JSON.parse(init.body).model;
    return success || m === C.mistral[2].id ? reply() : limited({ 'Retry-After': '2' });
  });
  const result = await h.api.handle(query);
  assert.equal(result.model, C.mistral[2].id);
  assert.deepEqual(result.attemptedModels, C.mistral.slice(0, 3).map(m => m.id));
  assert.equal(result.providerTier, 'advanced');
  assert.equal(result.advancedFallback, false);
  assert.deepEqual((await h.api.handle(query)).attemptedModels, [C.mistral[2].id]);
  h.advance(2001); success = true;
  assert.equal((await h.api.handle(query)).model, C.mistral[0].id);
});
test('headerless Mistral limits back off; all exhausted models fall back to Simple exactly once', async () => {
  const h = setup(advanced(), url => url.includes('googleapis') ? geminiReply() : limited());
  let result = await h.api.handle(query);
  assert.equal(result.advancedFallback, true);
  assert.equal(result.attemptedModels.length, 5);
  result = await h.api.handle(query);
  assert.deepEqual(result.attemptedModels, [C.flash[0]]);
  h.advance(60001);
  assert.equal((await h.api.handle(query)).attemptedModels.length, 5);
  h.advance(60001);
  assert.deepEqual((await h.api.handle(query)).attemptedModels, [C.flash[0]]);
});
test('pinned Mistral never tries another Mistral model and Advanced can operate standalone', async () => {
  const c = advanced(); c.simple.apiKey = '';
  c.advanced.profiles.mistral.modelMode = 'pinned'; c.advanced.profiles.mistral.model = C.mistral[2].id;
  const h = setup(c, () => limited());
  await assert.rejects(h.api.handle(query), { code: 'rate_limit' });
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 1);
  assert.deepEqual(C.models(c, 'advanced', 'ultrascripts', 2), [C.mistral[2].id]);
});
test('model discovery filters inaccessible models and refuses invalid pinned IDs', async () => {
  const c = advanced(); c.simple.apiKey = ''; c.advanced.profiles.mistral.modelMode = 'pinned'; c.advanced.profiles.mistral.model = 'unknown';
  const h = setup(c, reply);
  await assert.rejects(h.api.handle(query), { code: 'model_unavailable' });
  assert.equal(h.requests.length, 1);
});
test('availability falls back; safety, invalid input and cancellation never do', async () => {
  for (const status of [401, 429, 500]) {
    const h = setup(advanced('openrouter'), url => url.includes('googleapis') ? geminiReply() : json({}, status));
    assert.equal((await h.api.handle(query)).advancedFallback, true);
    assert.equal(h.requests.length, 2);
  }
  for (const [status, message, code] of [[400, 'Invalid parameter', 'invalid_args'], [400, 'Content policy blocked', 'safety_blocked']]) {
    const h = setup(advanced('openrouter'), () => json({ error: { message } }, status));
    await assert.rejects(h.api.handle(query), { code }); assert.equal(h.requests.length, 1);
  }
  const h = setup(advanced(), reply), controller = new AbortController(); controller.abort();
  await assert.rejects(h.api.handle(query, { signal: controller.signal }), { code: 'aborted' });
  assert.equal(h.requests.length, 0);
});
test('feature assignment and Gemini native JSON request preserve the contract', async () => {
  const c = advanced();
  const h = setup(c, (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(init.headers['x-goog-api-key'], 'gemini-secret');
    assert.ok(!('model' in body));
    return json({ candidates: [{ content: { parts: [{ text: '{"name":"A"}' }] }, finishReason: 'STOP' }] });
  });
  const result = await h.api.handle({ op: 'query', task: { prompt: 'Name', consumer: 'character-presets', output: { type: 'json', schema: { type: 'object', properties: { name: { type: 'string' } } } } } });
  assert.deepEqual(result.json, { name: 'A' });
  assert.equal(result.model, C.gemma[0]);
});
const chat = { op: 'chat', task: { op: 'chat', consumer: 'navigator', systemInstruction: 'Help.', messages: [{ role: 'user', content: 'Look up a card' }], tools: [{ name: 'read_card', description: 'Read a card', parameters: { type: 'object' } }], budget: { maxInputChars: 100000, maxOutputTokens: 2048 } } };
test('Gemini streams text and retains native tool signatures across continuation', async () => {
  let round = 0;
  const h = setup(C.normalize({ simple: { apiKey: 'g' } }), (_url, init) => {
    if (++round === 1) return stream([{ candidates: [{ content: { parts: [{ functionCall: { id: 'callA', name: 'read_card', args: {} }, thoughtSignature: 'signature' }] }, finishReason: 'STOP' }] }]);
    const body = JSON.parse(init.body);
    assert.equal(body.contents[1].parts[0].thoughtSignature, 'signature');
    assert.equal(body.contents[2].parts[0].functionResponse.id, 'callA');
    return stream([{ candidates: [{ content: { parts: [{ text: 'Found ' }] } }] }, { candidates: [{ content: { parts: [{ text: 'it.' }] }, finishReason: 'STOP' }] }]);
  });
  const first = await h.api.handle(chat);
  assert.equal(first.toolCalls[0].name, 'read_card');
  const deltas = [];
  const result = await h.api.handle({ op: 'chat', task: { ...chat.task, continuation: first.continuation, toolResults: [{ callId: 'callA', name: 'read_card', result: { text: 'card' } }] } }, { onDelta: d => deltas.push(d) });
  assert.equal(result.text, 'Found it.'); assert.deepEqual(deltas, ['Found ', 'it.']);
});
test('OpenAI tool continuation can fall back to Gemini without losing completed results', async () => {
  const h = setup(advanced('openrouter'), url => url.includes('googleapis') ? stream([{ candidates: [{ content: { parts: [{ text: 'Result' }] }, finishReason: 'STOP' }] }]) : limited());
  const result = await h.api.handle({ op: 'chat', task: { ...chat.task,
    continuation: { provider: 'betterdungeon-ai', service: 'openrouter', messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'read_card', arguments: '{}' } }] }] },
    toolResults: [{ callId: 'a', name: 'read_card', result: { text: 'Completed result' } }] } });
  assert.equal(result.advancedFallback, true);
  assert.ok(h.requests.at(-1).body.includes('Completed result'));
});
test('truncated streams are not retried after visible output', async () => {
  const h = setup(advanced('openrouter'), () => stream([{ choices: [{ delta: { content: 'Partial' } }] }]));
  await assert.rejects(h.api.handle(chat), { code: 'invalid_response' });
  assert.equal(h.requests.length, 1);
});
test('Ultrascripts rejects overlap and unlocks after failure', async () => {
  let release;
  const context = { console, window: { BetterDungeonAI: { query: () => new Promise((_, reject) => { release = reject; }) } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/ai/module.js'), 'utf8'), context);
  const queryOp = context.window.UltrascriptsAIModule.ops.query.handler;
  const pending = queryOp({ prompt: 'a' });
  await assert.rejects(queryOp({ prompt: 'b' }), e => e.code === 'busy');
  release(new Error('Failed')); await assert.rejects(pending);
  const again = queryOp({ prompt: 'c' }); release(new Error('Failed')); await assert.rejects(again);
});
test('browser and Android hosts return identical responses through current and legacy messages', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'android/betterdungeon-runtime.json')));
  assert.ok(manifest.scripts.indexOf('services/ai/config.js') < manifest.scripts.indexOf('services/ai/runtime.js'));
  assert.ok(manifest.scripts.indexOf('modules/ai/executor.js') < manifest.scripts.indexOf('services/ai/runtime.js'));
  assert.ok(manifest.scripts.indexOf('services/ai/runtime.js') < manifest.scripts.indexOf('utils/ai-native-runtime.js'));
  const results = [];
  for (const file of ['background-ai-openai-compatible.js', 'android/web/utils/ai-native-runtime.js']) {
    const h = setup(C.normalize({ simple: { apiKey: 'g' } }), geminiReply);
    const listeners = [];
    const context = { console, URL, TextDecoder, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
      fetch: geminiReply, __bdNativeAiFetch: geminiReply, importScripts() {},
      chrome: { runtime: { onMessage: { addListener: fn => listeners.push(fn) }, onConnect: { addListener() {} } }, storage: { local: h.storage } } };
    context.window = context;
    vm.createContext(context);
    for (const source of ['services/ai/config.js', 'modules/ai/executor.js', 'services/ai/runtime.js', file]) {
      vm.runInContext(fs.readFileSync(path.join(root, source), 'utf8'), context);
    }
    for (const type of ['BETTERDUNGEON_AI', 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE']) {
      const result = await new Promise(resolve => listeners[0]({ type, request: query }, {}, resolve));
      assert.equal(result.ok, true); results.push([result.data.text, result.data.model, result.data.providerTier]);
    }
  }
  assert.ok(results.every(r => JSON.stringify(r) === JSON.stringify(results[0])));
});
