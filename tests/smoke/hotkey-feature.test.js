'use strict';

// Regression checks for Hotkey target resolution. The feature's simple
// actions used single exact-match aria-label selectors and failed silently
// (after swallowing the keypress) when AI Dungeon changed a label. These
// checks pin the resilient lookup (case-insensitive fallback), the
// warn-once diagnostics, and the binding migration/map invariants.

const test = require('node:test');
const assert = require('node:assert/strict');

global.AIDungeonService = class { isModeMenuOpen() { return false; } };
const HotkeyFeature = require('../../features/hotkey_feature.js');

class FakeElement {
  constructor(label) {
    this._attrs = {};
    if (label !== undefined) this._attrs['aria-label'] = label;
    this.clicked = 0;
  }
  getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  hasAttribute(name) { return name in this._attrs; }
  click() { this.clicked++; }
}

function makeDocument(elements) {
  return {
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      if (selector === '[aria-label]') return elements.filter(el => el.getAttribute('aria-label') !== null);
      const match = selector.match(/^\[aria-label="(.+)"\]$/);
      if (match) return elements.filter(el => el.getAttribute('aria-label') === match[1]);
      return [];
    },
  };
}

function withDocument(elements, fn) {
  global.document = makeDocument(elements);
  try { return fn(); } finally { delete global.document; }
}

test('findByLabel matches the exact aria-label', () => {
  const retry = new FakeElement('Command: retry');
  withDocument([new FakeElement('Command: continue'), retry], () => {
    const feature = new HotkeyFeature();
    assert.equal(feature.findByLabel('Command: retry'), retry);
  });
});

test('findByLabel falls back to a case-insensitive match when capitalization changes', () => {
  const retry = new FakeElement('command: Retry');
  withDocument([retry], () => {
    const feature = new HotkeyFeature();
    assert.equal(feature.findByLabel('Command: retry'), retry);
    assert.equal(feature.findActionTarget(HotkeyFeature.HOTKEY_ACTIONS.retry), retry);
  });
});

test('findActionTarget returns null when the target is gone', () => {
  withDocument([new FakeElement('Command: continue')], () => {
    const feature = new HotkeyFeature();
    assert.equal(feature.findActionTarget(HotkeyFeature.HOTKEY_ACTIONS.erase), null);
    assert.equal(feature.findByLabel('Undo change'), null);
  });
});

test('warnOnce warns exactly once per key', () => {
  const feature = new HotkeyFeature();
  const original = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    feature.warnOnce('missing:retry', 'first');
    feature.warnOnce('missing:retry', 'second');
    feature.warnOnce('missing:erase', 'other');
  } finally { console.warn = original; }
  assert.equal(seen.length, 2);
  assert.match(seen[0], /first/);
  assert.match(seen[1], /other/);
});

test('saved bindings migrate the retired See action to Generate Image', () => {
  assert.deepEqual(
    HotkeyFeature.migrateBindings({ 6: 'modeSee', t: 'takeATurn' }),
    { 6: 'generateImage', t: 'takeATurn' }
  );
});

test('every default binding names a real action, and the map is built from bindings', () => {
  for (const actionId of Object.values(HotkeyFeature.DEFAULT_BINDINGS)) {
    assert.ok(HotkeyFeature.HOTKEY_ACTIONS[actionId], `default binding targets unknown action ${actionId}`);
  }
  const feature = new HotkeyFeature();
  feature.keyBindings = { x: 'retry', q: 'notARealAction' };
  feature.buildHotkeyMap();
  assert.equal(feature.hotkeyMap.x.actionId, 'retry');
  assert.equal(feature.hotkeyMap.q, undefined);
});
