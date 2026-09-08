'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadFeature(file, name, document = {}) {
  const context = vm.createContext({ window: {}, document, console, setTimeout, clearTimeout });
  vm.runInContext(read(file), context, { filename: file });
  return context.window[name];
}

test('Android newlines and IME Enter do not record unsent input; submission does', async () => {
  const Feature = loadFeature('android/overrides/features/input_history_feature.js', 'InputHistoryFeature');
  const feature = new Feature();
  let saves = 0;
  feature.saveCurrentInput = () => saves++;
  for (const extra of [{}, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    await feature.handleKeydown({ target: { id: 'game-text-input' }, key: 'Enter', ...extra });
  }
  assert.equal(saves, 0);
  feature.handleClick({ target: { closest: () => null } });
  feature.handleClick({ target: { closest: () => ({ disabled: true }) } });
  feature.handleClick({ target: { closest: () => ({ getAttribute: () => 'true' }) } });
  assert.equal(saves, 0);
  feature.handleClick({ target: { closest: () => ({ getAttribute: () => null }) } });
  assert.equal(saves, 1);
});

test('Command buttons are reachable outside the input row and activate once per click', () => {
  const controls = new Map();
  const makeControl = () => ({ style: {}, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
  controls.set('#bd-submode-prev', makeControl());
  controls.set('#bd-submode-next', makeControl());
  const bar = { style: {}, querySelector: key => controls.get(key), remove() {} };
  let inserted;
  const row = { parentElement: { insertBefore: (node, before) => { inserted = { node, before }; } } };
  const document = {
    querySelector: key => key === '#game-text-input' ? { parentElement: row } : null,
    createElement: () => bar
  };
  const Feature = loadFeature('android/overrides/features/command_feature.js', 'CommandFeature', document);
  const feature = new Feature();
  feature.saveSubModeSetting = () => {};
  feature.updateModeDisplay = () => {};
  feature.injectSubModeBar();
  assert.equal(inserted.node, bar);
  assert.equal(inserted.before, row);
  assert.match(bar.innerHTML, /<button type="button"/);
  const next = controls.get('#bd-submode-next');
  next.handlers.pointerdown();
  assert.equal(feature.subMode, 'standard');
  next.handlers.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(feature.subMode, 'subtle');
  next.handlers.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(feature.subMode, 'ooc');
  next.handlers.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(feature.subMode, 'standard');
});

test('Android runtime and feature settings no longer expose the removed narrator', () => {
  const runtime = JSON.parse(read('android/betterdungeon-runtime.json'));
  assert.doesNotMatch(JSON.stringify(runtime), /text_to_spe|textToSpeech/);
  for (const file of ['android/overrides/core/feature-manager.js', 'android/overrides/popup.js',
    'android/overrides/main.js', 'android/app/src/main/java/com/computerk/betterdungeon/BetterDungeonBridge.kt']) {
    assert.doesNotMatch(read(file), /TextToSpeech|textToSpeech|ttsSpeak|ttsManager/);
  }
  const popup = read('android/overrides/popup.html');
  assert.doesNotMatch(popup, /data-feature="textToSpeech"|Ctrl|Cycle through past inputs with arrow keys/);
});

for (const file of ['features/notes_feature.js', 'android/overrides/features/notes_feature.js']) {
  test(file + ': native presentation is reused without native editor bindings or values', () => {
    const target = () => ({ classList: { names: [], add(name) { this.names.push(name); } } });
    const editor = { classList: ['is_TextArea'], value: 'Private native plot content' };
    const body = { classList: ['_bg-coreA1'] };
    const heading = { classList: ['font_body'] };
    const header = { classList: ['_h-t-size-7'] };
    const card = { classList: ['_bg-coreA0'], firstElementChild: header, querySelector: () => heading };
    editor.parentElement = body;
    body.parentElement = card;
    const document = { querySelector: () => editor };
    const Feature = loadFeature(file, 'NotesFeature', document);
    const feature = Object.create(Feature.prototype);
    const targets = new Map(['.bd-notes-card-header', '.bd-notes-card-title', '.bd-notes-card-body', '.bd-notes-textarea'].map(key => [key, target()]));
    feature.notesCard = { ...target(), querySelector: key => targets.get(key) };
    feature.matchNativePlotStyles();
    assert.deepEqual(feature.notesCard.classList.names, ['_bg-coreA0']);
    assert.deepEqual(targets.get('.bd-notes-textarea').classList.names, ['is_TextArea']);
    assert.equal(targets.get('.bd-notes-textarea').value, undefined);
    assert.doesNotMatch(feature.buildNotesCardMarkup(), /data-undo-redo-editor-field/);
  });
}
