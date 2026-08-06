'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ASSET_ROOT = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;

function source(relativePath) {
  return fs.readFileSync(path.join(ASSET_ROOT, relativePath), 'utf8');
}

async function main() {
  let registeredModule = null;
  const messages = [];
  const runtime = {
    async sendMessage(message) {
      messages.push(message);
      const op = message.request?.op;
      if (op === 'status') {
        return {
          ok: true,
          data: {
            backend: 'gemini',
            backendLabel: 'Gemini',
            ready: true,
            available: true,
            config: { provider: 'gemini', keyConfigured: true },
            message: 'Gemini backend is configured.',
          },
        };
      }
      if (op === 'query') {
        return {
          ok: true,
          data: {
            backend: 'gemini',
            text: 'provider response',
            model: 'gemini-test',
            providerModel: 'gemini-test-001',
            generatedAtIso: '2026-08-06T00:00:00.000Z',
          },
        };
      }
      throw new Error(`Unexpected Gemini op: ${op}`);
    },
  };
  const window = {
    Ultrascripts: {
      registry: {
        register(module) { registeredModule = module; },
      },
    },
  };
  const context = vm.createContext({
    window,
    browser: { runtime },
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

  for (const relativePath of [
    path.join('modules', 'ai', 'executor.js'),
    path.join('modules', 'ai', 'gemini-backend.js'),
    path.join('modules', 'ai', 'module.js'),
  ]) {
    vm.runInContext(source(relativePath), context, { filename: relativePath });
  }

  assert.ok(registeredModule, 'AI module registers');
  assert.equal(registeredModule.version, '0.6.0');
  assert.equal(registeredModule.description.includes('Gemini'), false);
  assert.equal(window.UltrascriptsAIExecutor.resolveProvider('ultrascripts').provider, 'gemini');
  assert.equal(window.UltrascriptsAIExecutor.resolveProvider('character-presets').provider, 'gemini');

  const logs = [];
  registeredModule.mount({ log: (...args) => logs.push(args) });
  assert.equal(logs[0][0], 'debug');
  assert.equal(logs[0][2].provider, 'gemini');

  const status = await registeredModule.ops.status.handler({});
  assert.equal(status.provider, 'gemini');
  assert.equal(status.consumer, 'ultrascripts');
  assert.equal(status.ready, true);

  const result = await registeredModule.ops.query.handler(
    { prompt: 'hello' },
    {},
    { id: 'request-1' }
  );
  assert.equal(result.text, 'provider response');
  assert.equal(result.meta.provider, 'gemini');
  assert.equal(result.meta.backend, 'gemini');
  assert.ok(messages.some(message => message.request?.op === 'query'));

  console.log(`AI provider integration tests passed (${ASSET_ROOT})`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
