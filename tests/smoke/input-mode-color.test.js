'use strict';

// Focused regression checks for InputModeColorFeature's update plumbing:
// 1. The MutationObserver used to run a full detection pass (including
//    computed-style reads) on every mutation batch — during AI text
//    streaming that is many passes per second. Passes are now coalesced
//    to at most one per animation frame, and destroy() cancels a pending
//    pass so it cannot run against a torn-down feature.
// 2. Custom colors used to sync only via the popup's runtime message,
//    which reaches just the active tab. The feature now also follows
//    chrome.storage.onChanged, so every open AI Dungeon tab picks up
//    color changes, including the legacy 'see' -> 'image' migration.

const test = require('node:test');
const assert = require('node:assert/strict');

// --- Globals the feature touches (stubbed before construction) ---
global.AIDungeonService = class { };

let rafQueue;
let storageListeners;
let messageListeners;

function installGlobals() {
  rafQueue = new Map();
  let nextId = 1;
  global.requestAnimationFrame = (cb) => { const id = nextId++; rafQueue.set(id, cb); return id; };
  global.cancelAnimationFrame = (id) => { rafQueue.delete(id); };

  storageListeners = new Set();
  messageListeners = new Set();
  global.chrome = {
    storage: {
      sync: { get: (key, cb) => cb({}) },
      onChanged: {
        addListener: (fn) => storageListeners.add(fn),
        removeListener: (fn) => storageListeners.delete(fn),
      },
    },
    runtime: {
      onMessage: {
        addListener: (fn) => messageListeners.add(fn),
        removeListener: (fn) => messageListeners.delete(fn),
      },
    },
  };

  global.document = {
    body: {},
    head: { appendChild: () => { } },
    createElement: () => ({ remove() { }, style: {}, textContent: '' }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  global.MutationObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { }
    disconnect() { }
  };
}

function flushFrames() {
  const pending = [...rafQueue.values()];
  rafQueue.clear();
  pending.forEach(cb => cb());
}

installGlobals();
const InputModeColorFeature = require('../../features/input_mode_color_feature.js');

function makeFeature() {
  const feature = new InputModeColorFeature();
  let passes = 0;
  feature.detectAndApplyColor = () => { passes += 1; };
  feature.getPasses = () => passes;
  return feature;
}

test('observer callbacks coalesce into one detection pass per frame', () => {
  installGlobals();
  const feature = makeFeature();
  feature.setupObserver();
  // Simulate a burst of mutation batches in a single frame (streaming text).
  for (let i = 0; i < 25; i++) feature.observer.callback();
  assert.equal(feature.getPasses(), 0, 'no pass runs before the frame');
  flushFrames();
  assert.equal(feature.getPasses(), 1, 'the whole burst costs one pass');
  feature.observer.callback();
  flushFrames();
  assert.equal(feature.getPasses(), 2, 'the next frame gets its own pass');
  feature.destroy();
});

test('destroy cancels a pending coalesced pass and removes listeners', () => {
  installGlobals();
  const feature = makeFeature();
  feature.setupObserver();
  feature.listenForColorUpdates();
  feature.observer.callback();
  feature.destroy();
  flushFrames();
  assert.equal(feature.getPasses(), 0, 'pending pass must not run after destroy');
  assert.equal(storageListeners.size, 0, 'storage listener removed');
  assert.equal(messageListeners.size, 0, 'message listener removed');
});

test('storage changes apply new colors to every tab, with see->image migration', () => {
  installGlobals();
  const feature = makeFeature();
  feature.listenForColorUpdates();
  assert.equal(storageListeners.size, 1, 'storage listener registered');

  const injected = [];
  feature.injectCustomColorStyles = () => injected.push({ ...feature.customColors });

  const fire = [...storageListeners][0];
  fire({ unrelated: { newValue: {} } }, 'sync');
  assert.equal(injected.length, 0, 'unrelated keys are ignored');
  fire({ [InputModeColorFeature.STORAGE_KEY]: { newValue: { do: '#111111' } } }, 'local');
  assert.equal(injected.length, 0, 'non-sync areas are ignored');

  fire({ [InputModeColorFeature.STORAGE_KEY]: { newValue: { do: '#111111', see: '#222222' } } }, 'sync');
  assert.equal(injected.length, 1, 'sync change applies colors');
  assert.equal(feature.customColors.do, '#111111');
  assert.equal(feature.customColors.image, '#222222', "legacy 'see' migrates to 'image'");
  assert.equal(feature.customColors.say, InputModeColorFeature.DEFAULT_COLORS.say, 'defaults fill the rest');
  feature.destroy();
});

test('mergeCustomColors tolerates corrupt storage values', () => {
  installGlobals();
  const feature = makeFeature();
  assert.deepEqual(feature.mergeCustomColors(null), { ...InputModeColorFeature.DEFAULT_COLORS });
  assert.deepEqual(feature.mergeCustomColors('nope'), { ...InputModeColorFeature.DEFAULT_COLORS });
  assert.equal(feature.mergeCustomColors({ video: '#123456' }).video, '#123456');
});
