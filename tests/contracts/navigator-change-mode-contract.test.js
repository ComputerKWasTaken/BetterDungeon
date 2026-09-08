'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const localStorage = {};
const syncStorage = {};
let failLocalRead = false;

global.window = global;
global.chrome = {
  runtime: { id: 'navigator-change-mode-test', lastError: null },
  storage: {
    local: {
      get(key, callback) {
        if (failLocalRead) throw new Error('simulated local storage failure');
        callback(key in localStorage ? { [key]: localStorage[key] } : {});
      },
    },
    sync: {
      get(key, callback) {
        callback(key in syncStorage ? { [key]: syncStorage[key] } : {});
      },
    },
  },
};

vm.runInThisContext(
  fs.readFileSync(path.join(ROOT, 'services', 'navigator', 'mutations.js'), 'utf8'),
  { filename: 'services/navigator/mutations.js' }
);

(async () => {
  const shortId = 'mode-contract';
  const adventureKey = `betterDungeon_navigator_adventure_${encodeURIComponent(shortId)}`;
  const mutations = new window.NavigatorMutations(shortId);

  localStorage[adventureKey] = { changeMode: 'automatic', readOnly: true };
  syncStorage.betterDungeon_navigator_read_only = true;
  assert.equal(await mutations.changesDisabled(), false, 'canonical Automatic must outrank legacy fallbacks');

  localStorage[adventureKey] = { changeMode: 'proposed', readOnly: true };
  assert.equal(await mutations.changesDisabled(), false, 'Proposed changes must still permit approved writes');

  localStorage[adventureKey] = { changeMode: 'none', readOnly: false };
  assert.equal(await mutations.changesDisabled(), true, 'No changes must block writes');

  localStorage[adventureKey] = { readOnly: true };
  assert.equal(await mutations.changesDisabled(), true, 'legacy per-adventure Read-only remains a migration fallback');

  delete localStorage[adventureKey];
  assert.equal(await mutations.changesDisabled(), true, 'legacy synchronized Read-only remains a fallback');

  syncStorage.betterDungeon_navigator_read_only = false;
  failLocalRead = true;
  assert.equal(await mutations.changesDisabled(), true, 'storage failures must fail closed');
  await assert.rejects(
    mutations.apply({ status: 'applying', shortId, kind: 'plot_component' }),
    error => error?.code === 'changes_disabled',
    'the independent pre-write gate must enforce the fail-closed result'
  );
  failLocalRead = false;

  chrome.runtime.id = '';
  await assert.rejects(
    mutations.changesDisabled(),
    error => error?.code === 'extension_context_invalid',
    'an invalid extension context must stop the write gate'
  );

  console.log('Navigator change-mode contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
