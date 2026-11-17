'use strict';

// Focused checks for Try Mode: the RNG contract its UI promises (success
// chance = 50% + 5% per weight level, clamped 5–95; an independent critical
// roll at the configured chance, default 5%), the sentence formatting, and
// the settings-listener lifecycle. loadSettings() used to register an
// anonymous chrome.storage.onChanged listener on every init() that
// destroy() could never remove — FeatureManager builds a fresh instance per
// enable, so toggling Try leaked a listener (and a retained instance) each
// time. These tests pin the removable-handler behaviour.

const test = require('node:test');
const assert = require('node:assert/strict');

// The feature constructs an AIDungeonService and (in destroy) queries the
// document; stub both before loading it.
global.AIDungeonService = class {
  removeCustomModeButton() {}
};
global.document = {
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};

const listeners = new Set();
global.chrome = {
  storage: {
    sync: {
      get: (_key, callback) => callback({ betterDungeonSettings: { tryCriticalChance: 12 } }),
    },
    onChanged: {
      addListener: fn => listeners.add(fn),
      removeListener: fn => listeners.delete(fn),
    },
  },
};

const TryFeature = require('../../features/try_feature.js');

function withRandomQueue(values, fn) {
  const original = Math.random;
  let index = 0;
  Math.random = () => values[Math.min(index++, values.length - 1)];
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test('success chance follows the weight scale the bar displays', () => {
  const feature = new TryFeature();
  const cases = [[-99, 5], [-9, 5], [-5, 25], [0, 50], [5, 75], [9, 95], [99, 95]];
  for (const [weight, expected] of cases) {
    feature.weight = weight;
    assert.equal(feature.getSuccessChance(), expected, `weight ${weight}`);
  }
});

test('rollOutcome maps rolls to the four promised outcomes', () => {
  const feature = new TryFeature();
  feature.weight = 0; // 50% success
  feature.criticalChance = 5;

  // [successRoll, critRoll, phrasePick]
  let result = withRandomQueue([0.10, 0.50, 0], () => feature.rollOutcome());
  assert.equal(result.status, 'success');
  assert.equal(result.succeeded, true);
  assert.equal(result.isCrit, false);

  result = withRandomQueue([0.10, 0.01, 0], () => feature.rollOutcome());
  assert.equal(result.status, 'crit_success');
  assert.equal(result.isCrit, true);

  result = withRandomQueue([0.90, 0.50, 0], () => feature.rollOutcome());
  assert.equal(result.status, 'failure');
  assert.equal(result.succeeded, false);

  result = withRandomQueue([0.90, 0.01, 0], () => feature.rollOutcome());
  assert.equal(result.status, 'crit_fail');

  // A roll exactly at the chance is a failure (strict < comparison).
  result = withRandomQueue([0.50, 0.50, 0], () => feature.rollOutcome());
  assert.equal(result.status, 'failure');
});

test('rollOutcome distribution matches the displayed odds', () => {
  const feature = new TryFeature();
  feature.weight = 0;
  feature.criticalChance = 5;
  const iterations = 20000;
  let successes = 0;
  let crits = 0;
  for (let i = 0; i < iterations; i++) {
    const result = feature.rollOutcome();
    if (result.succeeded) successes++;
    if (result.isCrit) crits++;
  }
  const successRate = successes / iterations;
  const critRate = crits / iterations;
  assert.ok(successRate > 0.46 && successRate < 0.54, `success rate ${successRate}`);
  assert.ok(critRate > 0.03 && critRate < 0.07, `crit rate ${critRate}`);
});

test('formatAsTry strips prefixes and builds the promised sentence', () => {
  const feature = new TryFeature();
  feature.weight = 0;
  feature.criticalChance = 5;
  // success roll, no crit, first phrase, first template
  const output = withRandomQueue([0.10, 0.50, 0, 0], () =>
    feature.formatAsTry('I open the heavy door.'));
  assert.equal(output, 'try to open the heavy door, and you manage to do it.');

  const retry = withRandomQueue([0.10, 0.50, 0, 0], () =>
    feature.formatAsTry('try to climb the wall'));
  assert.ok(retry.includes('climb the wall'), retry);
  assert.ok(!retry.includes('try to try to'), retry);
  assert.ok(retry.endsWith('.'), retry);
});

test('settings listener is registered once and removed on destroy', () => {
  listeners.clear();
  const feature = new TryFeature();
  feature.loadSettings();
  assert.equal(feature.criticalChance, 12, 'settings value applied');
  assert.equal(listeners.size, 1);

  // The handler still applies live settings changes, sync namespace only.
  const [handler] = [...listeners];
  handler({ betterDungeonSettings: { newValue: { tryCriticalChance: 20 } } }, 'sync');
  assert.equal(feature.criticalChance, 20);
  handler({ betterDungeonSettings: { newValue: { tryCriticalChance: 1 } } }, 'local');
  assert.equal(feature.criticalChance, 20, 'other namespaces ignored');

  feature.loadSettings();
  assert.equal(listeners.size, 1, 're-init does not stack listeners');

  feature.destroy();
  assert.equal(listeners.size, 0, 'destroy removes the listener');
});
