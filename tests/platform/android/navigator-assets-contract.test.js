'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ANDROID_ROOT, composeAndroidRuntime, readConfig } = require('../../harness/android-runtime');

const APP_ROOT = ANDROID_ROOT;
const ASSETS = composeAndroidRuntime();

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS, relativePath), 'utf8');
}

function testInjectionOrder() {
  const source = readConfig().scripts;
  const paths = [
    'services/apollo-cache-service.js',
    'services/adventure-read-service.js',
    'services/adventure-write-hydration.js',
    'services/story-card-cache.js',
    'services/navigator/primer.js',
    'services/navigator/context.js',
    'services/navigator/tools.js',
    'services/navigator/mutations.js',
    'services/navigator/session.js',
    'features/navigator_feature.js',
  ];
  const offsets = paths.map(value => source.indexOf(value));
  assert.ok(offsets.every(value => value >= 0), 'every Navigator v2.1 asset must be injected');
  assert.deepEqual(offsets, offsets.slice().sort((left, right) => left - right));
}

function testCurrentContracts() {
  const context = readAsset('services/navigator/context.js');
  const tools = readAsset('services/navigator/tools.js');
  const mutations = readAsset('services/navigator/mutations.js');
  const session = readAsset('services/navigator/session.js');
  const feature = readAsset('features/navigator_feature.js');

  assert.match(context, /inspectionSections/);
  assert.match(context, /coverage[\s\S]*identity[\s\S]*plotComponents[\s\S]*recentActions[\s\S]*memoryBank[\s\S]*storyCardDirectory/);
  assert.doesNotMatch(context, /contextSections/);

  assert.doesNotMatch(tools, /get_plot_components/);
  for (const name of [
    'get_story_card',
    'search_story_cards',
    'search_story_history',
    'get_story_actions',
    'search_memory_bank',
    'get_memory',
  ]) {
    assert.match(tools, new RegExp(name));
  }

  assert.match(mutations, /changesDisabled\(\)/);
  assert.match(mutations, /changeMode === 'none'/);
  assert.match(session, /changeMode/);
  assert.match(session, /DEFAULT_CHANGE_MODE = 'automatic'/);
  assert.match(session, /snapshot:/);
  assert.match(session, /conversation:/);
  assert.match(session, /rounds:/);
  assert.match(session, /status:/);
  assert.match(session, /error:/);
  assert.match(session, /MAX_INSPECTION_CHARS/);
  assert.doesNotMatch(session, /headers\s*:|authorization|apiKey/i);

  assert.match(feature, /createInspectionDisclosure\('Context sent'/);
  assert.match(feature, /createInspectionDisclosure\('Conversation sent'/);
  assert.match(feature, /createInspectionDisclosure\('Tool activity'/);
  assert.match(feature, /createInspectionDisclosure\('Technical details'/);
  assert.doesNotMatch(feature, /Copy round JSON|clipboard\.writeText|bd-navigator-message-actions/);
}

testInjectionOrder();
testCurrentContracts();
console.log('Navigator v2.1 asset contract tests passed');
