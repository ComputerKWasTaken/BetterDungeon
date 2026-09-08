'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { composeAndroidRuntime } = require('../../harness/android-runtime');

const ROOT = composeAndroidRuntime();
const storage = new Map();
const cancelledRequests = [];
const pageListeners = new Map();
const popupResponseWaiters = new Map();

global.window = global;
global.location = { protocol: 'https:', href: 'https://play.aidungeon.com/adventure/test' };
global.addEventListener = (type, listener) => {
  const listeners = pageListeners.get(type) || [];
  listeners.push(listener);
  pageListeners.set(type, listeners);
};
global.removeEventListener = (type, listener) => {
  const listeners = pageListeners.get(type) || [];
  pageListeners.set(type, listeners.filter(candidate => candidate !== listener));
};
global.atob ||= value => Buffer.from(value, 'base64').toString('binary');

function emitNative(requestId, event) {
  window.__bdNativeAiTransportEvent(requestId, JSON.stringify(event));
}

global.BetterDungeonBridge = {
  storageGet(key) {
    return storage.get(key) || '';
  },
  storageGetAll() {
    return `{${Array.from(storage.entries()).map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}`;
  },
  storageSet(key, value) {
    storage.set(key, value);
  },
  storageRemove(key) {
    storage.delete(key);
  },
  getAppVersion() {
    return '2.1.0-test';
  },
  aiFetch(requestJson, requestId) {
    const request = JSON.parse(requestJson);
    const payload = JSON.parse(request.body);
    const holding = JSON.stringify(payload).includes('hold-open');

    queueMicrotask(() => {
      emitNative(requestId, {
        type: 'response',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/event-stream' },
      });
      if (holding) return;

      if (payload.stream !== true) {
        const data = {
          model: payload.model,
          choices: [{ message: { content: request.url.includes('generativelanguage.googleapis.com') ? 'Gemini query answer' : 'Compatible query answer' } }],
          usage: { total_tokens: 4 },
        };
        emitNative(requestId, {
          type: 'chunk',
          data: Buffer.from(JSON.stringify(data), 'utf8').toString('base64'),
        });
        emitNative(requestId, { type: 'complete' });
        return;
      }

      const gemini = request.url.includes('generativelanguage.googleapis.com');
      const frames = [
        `data: ${JSON.stringify({ model: payload.model, choices: [{ delta: { content: gemini ? 'Gemini ' : 'Hello ' }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: gemini ? 'works' : 'world' }, finish_reason: 'stop' }], usage: { total_tokens: 7 } })}\n\ndata: [DONE]\n\n`,
      ];
      frames.forEach(frame => emitNative(requestId, {
        type: 'chunk',
        data: Buffer.from(frame, 'utf8').toString('base64'),
      }));
      emitNative(requestId, { type: 'complete' });
    });
  },
  aiCancel(requestId) {
    cancelledRequests.push(requestId);
    return true;
  },
  sendResponseToPopup(responseJson, requestId) {
    const resolve = popupResponseWaiters.get(requestId);
    if (!resolve) return;
    popupResponseWaiters.delete(requestId);
    resolve(JSON.parse(responseJson));
  },
};

function load(relativePath) {
  const filename = path.join(ROOT, relativePath);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('utils/webview-polyfill.js');
load('utils/ai-native-runtime.js');
load('modules/ai/executor.js');
load('modules/ai/openai-compatible-backend.js');

async function configureCustom() {
  const response = await chrome.runtime.sendMessage({
    type: 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE',
    request: {
      op: 'settings:set',
      config: {
        version: 1,
        activeService: 'custom',
        profiles: { custom: { baseUrl: 'https://provider.example/v1', apiKey: 'test-key', model: 'mock-model' } },
      },
    },
  });
  assert.equal(response.ok, true);
  await window.UltrascriptsAIExecutor.refreshStatus();
}

async function testPopupRuntimeRouting() {
  const requestId = 'popup-contract-test';
  const responsePromise = new Promise(resolve => popupResponseWaiters.set(requestId, resolve));
  window.__bdDispatchMessageFromPopup({
    type: 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE',
    request: { op: 'status' },
  }, requestId);
  const response = await responsePromise;
  assert.equal(response.ok, true);
  assert.equal(response.data.ready, true);
  assert.equal(response.data.config.model, 'mock-model');
}

function chatArgs(content) {
  return {
    messages: [{ role: 'user', content }],
    systemInstruction: 'Answer briefly.',
    budget: { maxInputChars: 4000, maxOutputTokens: 128 },
    thinking: { level: 'minimal' },
    tools: [],
  };
}

async function testStreaming() {
  const deltas = [];
  const result = await window.UltrascriptsAIExecutor.chat(chatArgs('say hello'), {
    onDelta(delta) {
      deltas.push(delta.text);
    },
  });
  assert.equal(result.text, 'Hello world');
  assert.deepEqual(deltas, ['Hello ', 'world']);
  assert.equal(result.meta.provider, 'openai-compatible');
  assert.equal(result.meta.service, 'custom');
  assert.equal(result.meta.providerModel, 'mock-model');
  assert.deepEqual(result.meta.usage, { total_tokens: 7 });
}

async function testQueries() {
  await configureCustom();
  const compatible = await window.UltrascriptsAIExecutor.query({ prompt: 'query compatible' });
  assert.equal(compatible.text, 'Compatible query answer');
  assert.equal(compatible.meta.providerModel, 'mock-model');

  await configureGemini();
  const gemini = await window.UltrascriptsAIExecutor.query({ prompt: 'query gemini' });
  assert.equal(gemini.text, 'Gemini query answer');
  assert.equal(gemini.meta.providerModel, 'gemini-mock');
}

async function configureGemini() {
  const settings = await chrome.runtime.sendMessage({
    type: 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE',
    request: { op: 'settings:set', config: { version: 1, activeService: 'gemini', profiles: { gemini: { apiKey: 'gemini-test-key', modelMode: 'manual', model: 'gemini-mock' } } } },
  });
  assert.equal(settings.ok, true);
  await window.UltrascriptsAIExecutor.refreshStatus();
}

async function testGeminiStreaming() {
  await configureGemini();
  const deltas = [];
  const result = await window.UltrascriptsAIExecutor.chat(chatArgs('test gemini'), {
    onDelta(delta) { deltas.push(delta.text); },
  });
  assert.equal(result.text, 'Gemini works');
  assert.deepEqual(deltas, ['Gemini ', 'works']);
  assert.equal(result.meta.provider, 'openai-compatible');
  assert.equal(result.meta.service, 'gemini');
  assert.equal(result.meta.providerModel, 'gemini-mock');
}

async function testCancellation() {
  await configureCustom();
  const controller = new AbortController();
  const pending = window.UltrascriptsAIExecutor.chat(chatArgs('hold-open'), {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, error => error && error.code === 'aborted');
  assert.ok(cancelledRequests.length > 0, 'native cancellation should be requested');
}

(async () => {
  await configureCustom();
  await testPopupRuntimeRouting();
  await testStreaming();
  await testGeminiStreaming();
  await testQueries();
  await testCancellation();
  console.log('AI native transport contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
