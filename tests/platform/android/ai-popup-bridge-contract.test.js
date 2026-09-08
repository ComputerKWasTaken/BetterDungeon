'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ANDROID_ROOT, composeAndroidRuntime } = require('../../harness/android-runtime');

const ROOT = ANDROID_ROOT;
const ASSETS = composeAndroidRuntime();
const CONTROLLER = path.join(
  ASSETS,
  'popup-ai-endpoint.js'
);

function createPopupContext({ bridgeReady = false } = {}) {
  const listeners = new Map();
  let statusRequests = 0;
  const window = {
    __bdPopupBridgeReady: bridgeReady,
    addEventListener(type, listener, options) {
      const entries = listeners.get(type) || [];
      entries.push({ listener, once: options?.once === true });
      listeners.set(type, entries);
    },
    dispatchEvent(event) {
      const entries = (listeners.get(event.type) || []).slice();
      listeners.set(event.type, entries.filter(entry => !entry.once));
      entries.forEach(entry => entry.listener(event));
    },
  };
  const context = vm.createContext({
    URL,
    console,
    setTimeout,
    clearTimeout,
    window,
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    chrome: {
      runtime: {
        lastError: undefined,
        sendMessage(message, callback) {
          assert.equal(message.type, 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE');
          assert.equal(message.request?.op, 'status');
          assert.deepEqual(Object.keys(message.request), ['op']);
          statusRequests += 1;
          callback({
            ok: true,
            data: {
              ready: false,
              service: 'gemini',
              config: { service: 'gemini', profiles: { gemini: {} } },
            },
          });
        },
      },
    },
  });
  vm.runInContext(fs.readFileSync(CONTROLLER, 'utf8'), context, { filename: CONTROLLER });
  return {
    context,
    window,
    statusRequests: () => statusRequests,
  };
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
}

async function testStatusWaitsForNativeBridge() {
  const popup = createPopupContext();
  vm.runInContext('initAIEndpointSettings()', popup.context);
  assert.equal(popup.statusRequests(), 0, 'opening the popup must not use the temporary runtime shim');

  popup.window.__bdPopupBridgeReady = true;
  popup.window.dispatchEvent({ type: 'betterdungeon:popup-bridge-ready' });
  await flushPromises();
  assert.equal(popup.statusRequests(), 1, 'bridge readiness should trigger one initial status request');

  popup.window.dispatchEvent({ type: 'betterdungeon:popup-bridge-ready' });
  await flushPromises();
  assert.equal(popup.statusRequests(), 1, 'the initial status listener must be one-shot');
}

async function testAlreadyReadyBridgeLoadsImmediately() {
  const popup = createPopupContext({ bridgeReady: true });
  vm.runInContext('initAIEndpointSettings()', popup.context);
  await flushPromises();
  assert.equal(popup.statusRequests(), 1);
}

async function main() {
  const activity = fs.readFileSync(
    path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'computerk', 'betterdungeon', 'MainActivity.kt'),
    'utf8'
  );
  assert.match(activity, /window\.__bdPopupBridgeReady = true;[\s\S]*popup-bridge-ready/);
  await testStatusWaitsForNativeBridge();
  await testAlreadyReadyBridgeLoadsImmediately();
  console.log('AI popup bridge contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
