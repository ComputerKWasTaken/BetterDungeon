'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createChromeRuntime } = require('../harness/chrome-runtime');
const { createAidDungeonRuntime } = require('../harness/aidungeon-runtime');
const { UltrascriptsHarness } = require('../harness/ultrascripts-runtime');

test('Chrome storage mocks support callback and promise access', async () => {
  const chrome = createChromeRuntime({ local: { enabled: true } });
  assert.deepEqual(await chrome.storage.local.get('enabled'), { enabled: true });
  await chrome.storage.local.set({ count: 2 });
  assert.deepEqual(chrome.storage.local.snapshot(), { enabled: true, count: 2 });
});

test('AI Dungeon harness preserves state across phases', () => {
  const runtime = createAidDungeonRuntime({ state: { turns: 0 } });
  runtime.evaluate('function input({ text }) { state.turns += 1; return { text: text.toUpperCase() }; }');
  assert.equal(runtime.runPhase('input', 'hello').text, 'HELLO');
  assert.equal(runtime.sandbox.state.turns, 1);
});

test('Ultrascripts harness negotiates, resolves, denies, and times out', async () => {
  const harness = new UltrascriptsHarness({ modules: [{ id: 'clock', ops: ['now'] }] });
  assert.deepEqual(harness.heartbeat().modules, [{ id: 'clock', ops: ['now'] }]);

  const response = harness.request('clock', 'now');
  const pending = harness.pendingRequest();
  assert.equal(harness.resolve(pending.id, { iso: '2026-09-08T12:00:00Z' }), true);
  assert.deepEqual(await response, { iso: '2026-09-08T12:00:00Z' });
  assert.equal(harness.resolve(pending.id, {}), false, 'late duplicate responses must be ignored');

  await assert.rejects(harness.request('clock', 'missing'), /Unsupported operation/);
  await assert.rejects(harness.request('clock', 'now', {}, { permission: 'clock.precise' }), /Permission denied/);
  await assert.rejects(harness.request('clock', 'now', {}, { timeoutMs: 1 }), /timed out/);
});
