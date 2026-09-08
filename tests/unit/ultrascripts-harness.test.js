'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { UltrascriptsHarness } = require('../harness/ultrascripts-runtime');

const publicModules = [
  { id: 'ai', ops: ['status', 'query'] },
  { id: 'audio', ops: [] },
  { id: 'clock', ops: ['now', 'tz', 'format'] },
  { id: 'network', ops: ['status'] },
  { id: 'sdk', ops: ['version', 'config'] },
  { id: 'system', ops: ['info', 'power'] },
  { id: 'weather', ops: ['current', 'forecast'] },
  { id: 'webfetch', ops: ['fetch'] },
  { id: 'widget', ops: [] },
];

test('Ultrascripts harness catalog matches the production module registrations', () => {
  const registered = [];
  const previous = {
    window: global.window,
    document: global.document,
    sessionStorage: global.sessionStorage,
  };
  global.window = { Ultrascripts: { registry: { register: definition => registered.push(definition) } } };
  global.document = {};
  global.sessionStorage = { getItem() { return null; }, setItem() {} };
  try {
    for (const module of publicModules) {
      const source = path.join(__dirname, '..', '..', 'modules', module.id, 'module.js');
      delete require.cache[require.resolve(source)];
      require(source);
    }
  } finally {
    global.window = previous.window;
    global.document = previous.document;
    global.sessionStorage = previous.sessionStorage;
  }

  const actual = registered
    .map(definition => ({ id: definition.id, ops: Object.keys(definition.ops || {}) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(actual, publicModules);
});

test('Ultrascripts harness discovers every public module and completes every request operation', async () => {
  const harness = new UltrascriptsHarness({ modules: publicModules });
  assert.deepEqual(harness.heartbeat().modules, publicModules);

  for (const module of publicModules) {
    for (const operation of module.ops) {
      const response = harness.request(module.id, operation, { sample: true });
      const pending = harness.pendingRequest();
      assert.equal(pending.module, module.id);
      assert.equal(pending.operation, operation);
      assert.equal(harness.resolve(pending.id, { ok: true }), true);
      assert.deepEqual(await response, { ok: true });
    }
  }
});

test('Ultrascripts harness covers permission and availability failures', async () => {
  const harness = new UltrascriptsHarness({ modules: [{ id: 'sdk', ops: ['config'] }] });
  await assert.rejects(harness.request('sdk', 'config', {}, { permission: 'sdk.config' }), /Permission denied/);
  await assert.rejects(harness.request('missing', 'read'), /Unsupported operation/);
  harness.available = false;
  await assert.rejects(harness.request('sdk', 'config'), /BetterDungeon is unavailable/);
});

test('Ultrascripts harness enforces payload and secret serialization boundaries', async () => {
  const harness = new UltrascriptsHarness({
    modules: [{ id: 'webfetch', ops: ['fetch'] }],
    maxPayloadBytes: 64,
  });
  await assert.rejects(harness.request('webfetch', 'fetch', { body: 'x'.repeat(100) }), /exceeds/);
  await assert.rejects(harness.request('webfetch', 'fetch', { authorization: 'private' }), /secret field/);

  const malformed = {};
  malformed.self = malformed;
  const response = harness.request('webfetch', 'fetch');
  const pending = harness.pendingRequest();
  assert.equal(harness.resolve(pending.id, malformed), true);
  await assert.rejects(response, /not serializable/);
});

test('Ultrascripts harness ignores duplicate and late responses and cancels on reload', async () => {
  const harness = new UltrascriptsHarness({ modules: [{ id: 'clock', ops: ['now'] }] });
  const completed = harness.request('clock', 'now');
  const completedId = harness.pendingRequest().id;
  harness.resolve(completedId, { ok: true });
  await completed;
  assert.equal(harness.resolve(completedId, { ok: false }), false);

  const timedOut = harness.request('clock', 'now', {}, { timeoutMs: 1 });
  const timedOutId = harness.pendingRequest().id;
  await assert.rejects(timedOut, /timed out/);
  assert.equal(harness.resolve(timedOutId, {}), false);

  const cancelled = harness.request('clock', 'now');
  const cancelledId = harness.pendingRequest().id;
  assert.equal(harness.cancel(cancelledId), true);
  await assert.rejects(cancelled, /cancelled/);

  const reloaded = harness.request('clock', 'now');
  harness.reload();
  await assert.rejects(reloaded, /reloaded/);
});
