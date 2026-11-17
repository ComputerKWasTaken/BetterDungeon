'use strict';

// Regression checks for Input History draft preservation and IME-safe capture.
// Bug pinned here: cycling through history discarded the user's half-typed
// draft — stepping back past the newest entry restored '' instead of the
// text that was in the box when cycling started (both the desktop
// Ctrl/Meta+Arrow path and the mobile history-chip path). Also pinned:
// an Enter that confirms an IME composition must not record the input.

const test = require('node:test');
const assert = require('node:assert/strict');

class FakeTextarea {
  constructor() { this.value = ''; this.id = 'game-text-input'; }
  dispatchEvent() { return true; }
}

const fakeInput = new FakeTextarea();

global.window = {
  location: { pathname: '/adventure/ABC123/test/play' },
  BetterDungeonPlatform: { has: () => false },
  HTMLTextAreaElement: FakeTextarea,
  HTMLInputElement: class {},
  addEventListener() {},
  removeEventListener() {},
};
global.document = {
  querySelector: (sel) => (sel === '#game-text-input' ? fakeInput : null),
  addEventListener() {},
  removeEventListener() {},
};
global.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
};
global.AIDungeonService = class {
  detectCurrentMode() { return 'do'; }
  async switchToMode() { return { success: true }; }
  async openModeMenu() { return true; }
  getModeButtonByName() { return {}; }
  usesCompactInput() { return false; }
};

const InputHistoryFeature = require('../../features/input_history_feature.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFeature() {
  const f = new InputHistoryFeature();
  f.currentAdventureId = 'ABC123';
  f.history = [
    { mode: 'do', text: 'newest action' },
    { mode: 'say', text: 'older action' },
  ];
  f.lastModeSwitchTime = 0;
  return f;
}

function keyEvent(key, extra = {}) {
  return {
    target: fakeInput, key,
    ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false,
    preventDefault() {},
    ...extra,
  };
}

test('desktop cycling restores the draft when stepping back past the newest entry', async () => {
  const f = makeFeature();
  fakeInput.value = 'my half-typed draft';

  await f.handleKeydown(keyEvent('ArrowUp', { ctrlKey: true }));
  assert.equal(f.historyIndex, 0);
  assert.equal(fakeInput.value, 'newest action');

  await f.handleKeydown(keyEvent('ArrowUp', { ctrlKey: true }));
  assert.equal(f.historyIndex, 1);
  assert.equal(fakeInput.value, 'older action');

  await f.handleKeydown(keyEvent('ArrowDown', { ctrlKey: true }));
  assert.equal(f.historyIndex, 0);
  assert.equal(fakeInput.value, 'newest action');

  await f.handleKeydown(keyEvent('ArrowDown', { ctrlKey: true }));
  assert.equal(f.historyIndex, -1);
  assert.equal(fakeInput.value, 'my half-typed draft', 'draft must be restored, not cleared');
  assert.equal(f.pendingDraft, null);
});

test('mobile chip navigation restores the draft the same way', async () => {
  const f = makeFeature();
  fakeInput.value = 'mobile draft';

  f.navigateHistory('up');
  await sleep(20);
  assert.equal(fakeInput.value, 'newest action');

  f.navigateHistory('down');
  await sleep(20);
  assert.equal(f.historyIndex, -1);
  assert.equal(fakeInput.value, 'mobile draft');
});

test('cycling from an empty box still returns to empty', async () => {
  const f = makeFeature();
  fakeInput.value = '';

  await f.handleKeydown(keyEvent('ArrowUp', { ctrlKey: true }));
  assert.equal(fakeInput.value, 'newest action');
  await f.handleKeydown(keyEvent('ArrowDown', { ctrlKey: true }));
  assert.equal(f.historyIndex, -1);
  assert.equal(fakeInput.value, '');
});

test('typing over a recalled entry drops the saved draft', async () => {
  const f = makeFeature();
  fakeInput.value = 'original draft';

  await f.handleKeydown(keyEvent('ArrowUp', { ctrlKey: true }));
  assert.equal(f.pendingDraft, 'original draft');
  await sleep(20); // let setInputValue's flag reset

  fakeInput.value = 'edited by hand';
  f.handleInput({ target: fakeInput });
  assert.equal(f.historyIndex, -1);
  assert.equal(f.pendingDraft, null, 'stale draft must not resurface later');
});

test('Enter during IME composition does not record the input', async () => {
  const f = makeFeature();
  fakeInput.value = 'composing text';
  let saves = 0;
  f.saveCurrentInput = () => { saves++; };

  await f.handleKeydown(keyEvent('Enter', { isComposing: true }));
  assert.equal(saves, 0, 'composition-confirming Enter is not a submit');

  await f.handleKeydown(keyEvent('Enter', { isComposing: false }));
  assert.equal(saves, 1, 'plain Enter still records on desktop');
});
