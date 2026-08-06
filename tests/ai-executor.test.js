'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const EXECUTOR_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'modules', 'ai', 'executor.js');

function loadExecutor() {
  const window = {};
  const context = vm.createContext({
    window,
    console,
    Date,
    JSON,
    Map,
    Object,
    Array,
    RegExp,
    Promise,
    TypeError,
    module: { exports: {} },
  });
  vm.runInContext(fs.readFileSync(EXECUTOR_PATH, 'utf8'), context, { filename: EXECUTOR_PATH });
  return window.UltrascriptsAIExecutor;
}

function provider(id, options = {}) {
  const calls = [];
  let refreshes = 0;
  let ready = options.ready !== false;
  const instance = {
    id,
    label: options.label || id,
    supports: options.supports || { text: true, json: true, thinking: true },
    status: () => ({
      ready,
      available: ready,
      reason: ready ? null : 'not_configured',
      message: ready ? `${id} ready` : `${id} not ready`,
    }),
    async refreshStatus() {
      refreshes += 1;
      return instance.status();
    },
    async query(task) {
      calls.push(task);
      if (options.query) return options.query(task);
      if (task.output.type === 'json') {
        return { provider: id, json: { provider: id }, model: `${id}-model` };
      }
      return { provider: id, text: `${id}:${task.prompt}`, model: `${id}-model` };
    },
  };
  return {
    instance,
    calls,
    refreshes: () => refreshes,
    setReady(value) { ready = value === true; },
  };
}

async function expectError(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

async function testDefaultAndConsumerRouting() {
  const executor = loadExecutor();
  const gemini = provider('gemini', { label: 'Gemini' });
  const openrouter = provider('openrouter', { label: 'OpenRouter' });

  executor.registerProvider(gemini.instance);
  executor.registerProvider(openrouter.instance);

  assert.equal(executor.resolveProvider('ultrascripts').provider, 'gemini');
  assert.equal(executor.resolveProvider('character-presets').provider, 'gemini');

  executor.setProviderForConsumer('character-presets', 'openrouter');
  assert.equal(executor.status({ consumer: 'character-presets' }).provider, 'openrouter');
  assert.equal(executor.status({ consumer: 'ultrascripts' }).provider, 'gemini');

  const scriptResult = await executor.query({ prompt: 'script request' }, { consumer: 'ultrascripts' });
  const presetResult = await executor.query({
    prompt: 'preset request',
    output: { type: 'json', schema: { type: 'object' } },
  }, { consumer: 'character-presets' });

  assert.equal(scriptResult.text, 'gemini:script request');
  assert.equal(scriptResult.meta.provider, 'gemini');
  assert.equal(presetResult.json.provider, 'openrouter');
  assert.equal(presetResult.meta.provider, 'openrouter');
  assert.equal(gemini.calls.length, 1);
  assert.equal(openrouter.calls.length, 1);

  await executor.refreshStatus({ consumer: 'character-presets' });
  assert.equal(openrouter.refreshes(), 1);
  assert.equal(gemini.refreshes(), 0);
}

async function testSwitchingAndFallback() {
  const executor = loadExecutor();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const gemini = provider('gemini');
  const openrouter = provider('openrouter', {
    query: async () => {
      await pending;
      return { provider: 'openrouter', text: 'openrouter completed' };
    },
  });

  executor.registerProvider(gemini.instance);
  executor.registerProvider(openrouter.instance);
  executor.setProviderForConsumer('character-presets', 'openrouter');

  const inFlight = executor.query({ prompt: 'one' }, { consumer: 'character-presets' });
  executor.setProviderForConsumer('character-presets', 'gemini');
  release();
  const result = await inFlight;
  assert.equal(result.meta.provider, 'openrouter', 'in-flight requests stay on their dispatched provider');

  const next = await executor.query({ prompt: 'two' }, { consumer: 'character-presets' });
  assert.equal(next.meta.provider, 'gemini', 'switching affects subsequent requests');

  executor.setProviderForConsumer('character-presets', 'openrouter');
  executor.unregisterProvider('openrouter');
  assert.equal(executor.resolveProvider('character-presets').provider, 'gemini');
  assert.equal(executor.resolveProvider('character-presets').selection, 'default');
}

async function testValidationAndCapabilityErrors() {
  const executor = loadExecutor();
  await expectError(executor.query({ prompt: 'missing provider' }), 'not_configured');

  const textOnly = provider('text-only', {
    supports: { text: true, json: false, thinking: false },
  });
  executor.registerProvider(textOnly.instance);
  await expectError(executor.query({
    prompt: 'json please',
    output: { type: 'json', schema: { type: 'object' } },
  }), 'unavailable');

  assert.throws(() => executor.registerProvider({ id: 'Bad Provider', query() {} }), TypeError);
  assert.throws(() => executor.setProviderForConsumer('character-presets', 'missing'), TypeError);
}

async function main() {
  await testDefaultAndConsumerRouting();
  await testSwitchingAndFallback();
  await testValidationAndCapabilityErrors();
  console.log(`AI executor provider routing tests passed (${EXECUTOR_PATH})`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
