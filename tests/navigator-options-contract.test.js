'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const sync = new Map([
  ['betterDungeon_navigator_read_only', true],
  ['betterDungeon_navigator_thinking_level', 'medium'],
  ['betterDungeon_navigator_defaults', { contextCap: 90000, toolRounds: 8 }],
]);
const local = new Map([
  ['betterDungeon_navigator_adventure_demo', {
    readOnly: false,
    contextCap: 20000,
    includeMemoryBank: false,
    historyMode: 'floor',
  }],
]);
const area = store => ({
  get(keys, callback) {
    const requested = Array.isArray(keys) ? keys : [keys];
    callback(Object.fromEntries(requested.filter(key => store.has(key)).map(key => [key, store.get(key)])));
  },
  set(values, callback) {
    for (const [key, value] of Object.entries(values)) store.set(key, value);
    callback?.();
  },
});

global.window = global;
window.NavigatorPrimer = { TEXT: 'You are Navigator.' };
window.BetterDungeonAdventureRead = {
  readAdventure: async () => ({
    identity: { id: '42', shortId: 'demo', title: 'Options', actionCount: 40, thirdPerson: false },
    plot: { instructions: 'Use prose.' },
    actions: Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), type: 'do', text: `Action ${index + 1}` })),
    storyCards: [],
    state: { memories: ['Hidden memory'] },
    coverage: { actions: { authoritativeTotal: 20, available: 20 }, storyCards: { authoritativeTotal: 0 } },
    provenance: { plot: { instructions: 'apollo' }, actions: { source: 'apollo' }, storyCards: { source: 'apollo' } },
  }),
};
global.chrome = {
  runtime: { id: 'options-test', lastError: null },
  storage: {
    sync: area(sync),
    local: area(local),
    onChanged: { addListener() {}, removeListener() {} },
  },
};
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/primer.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'services/navigator/context.js'), 'utf8'));

async function run() {
  const session = new window.NavigatorSession('demo');
  await session.settingsReady;
  const settings = session.getSettings();
  assert.equal(settings.readOnly, false, 'explicit per-adventure read-only off beats global on');
  assert.equal(settings.contextCap, 20000, 'per-adventure cap beats global default');
  assert.equal(settings.includeMemoryBank, false);
  assert.equal(settings.historyMode, 'floor');
  assert.equal(settings.toolRounds, 8);
  await session.clearAdventureSetting('readOnly');
  assert.equal(session.getSettings().readOnly, true, 'clearing override inherits global read-only');
  await session.saveSettings({ contextCap: null });
  assert.equal(session.getSettings().contextCap, 90000, 'clearing cap restores inherited default');
  const snapshot = await new window.NavigatorContext('demo').build({
    maxChars: 100000,
    includeMemoryBank: false,
    historyMode: 'floor',
  });
  assert.match(snapshot.systemInstruction, /Full history omitted by user setting/);
  assert.match(snapshot.systemInstruction, /Memory Bank: omitted by user setting/);
  assert.doesNotMatch(snapshot.systemInstruction, /reduced for total budget/);
  assert.match(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /Math\.min\(providerMaxInputChars, userCap/);
  assert.match(fs.readFileSync(path.join(ROOT, 'services/navigator/session.js'), 'utf8'), /roundLimit = this\.effectiveSettings\.toolRounds/);
  console.log('Navigator options contract tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
