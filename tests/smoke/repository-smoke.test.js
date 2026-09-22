'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const androidRoot = path.join(root, 'android');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const runtime = JSON.parse(fs.readFileSync(path.join(androidRoot, 'betterdungeon-runtime.json'), 'utf8'));
const packageEntries = fs.readFileSync(path.join(root, 'build', 'extension-files.txt'), 'utf8')
  .split(/\r?\n/)
  .map(value => value.trim())
  .filter(value => value && !value.startsWith('#'));
const platformSource = fs.readFileSync(path.join(root, 'utils', 'platform.js'), 'utf8');
const adventureReadSource = fs.readFileSync(path.join(root, 'services', 'adventure-read-service.js'), 'utf8');
const storyCardScannerSource = fs.readFileSync(path.join(root, 'services', 'story-card-scanner.js'), 'utf8');

function loadPlatform(overrides = {}) {
  const listeners = new Map();
  const documentElement = { dataset: {} };
  const context = {
    console,
    Promise,
    Error,
    Set,
    location: { protocol: 'https:' },
    document: { documentElement },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    ...overrides
  };
  context.globalThis = context;
  vm.runInNewContext(platformSource, context, { filename: 'utils/platform.js' });
  return { context, listeners, platform: context.BetterDungeonPlatform };
}

function loadAdventureReadService({ apolloData, graphqlCards }) {
  const calls = { storyCards: 0 };
  const context = {
    console,
    Promise,
    Error,
    Set,
    AbortController,
    location: { hostname: 'play.aidungeon.com', pathname: '/adventure/adv1' },
    document: { addEventListener() {} },
    Ultrascripts: {
      ws: {
        getAdventureShortId: () => 'adv1',
        getActions: () => [],
        getCards: () => []
      }
    },
    BetterDungeonApolloCache: {
      readAdventure: async () => ({ available: true, data: apolloData })
    },
    BetterDungeonGQL: {
      getNavigatorStoryCards: async () => {
        calls.storyCards += 1;
        return { cards: graphqlCards };
      }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(adventureReadSource, context, { filename: 'services/adventure-read-service.js' });
  return { service: context.window.BetterDungeonAdventureRead, calls, context };
}

function includedByPackage(relativePath) {
  return packageEntries.some(entry => relativePath === entry || relativePath.startsWith(entry + '/'));
}

function filesBelow(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolutePath, relativePath) : [relativePath];
  });
}

test('browser and Android release versions match', () => {
  const gradle = fs.readFileSync(path.join(androidRoot, 'app', 'build.gradle.kts'), 'utf8');
  const versionName = gradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(versionName, 'Android versionName must be declared');
  assert.equal(versionName, manifest.version);
});

test('platform contract uses browser defaults and native Android capabilities', async () => {
  const browser = loadPlatform().platform;
  assert.equal(browser.kind, 'browser');
  assert.equal(browser.formFactor, 'desktop');
  assert.equal(browser.has('nativeBridge'), false);
  assert.equal(browser.supportsFeature('hotkey'), true);

  const nativeConfig = {
    kind: 'android-webview',
    capabilities: { popupBridge: true, nativeBridge: true },
    supportedFeatures: ['command']
  };
  const android = loadPlatform({
    location: { protocol: 'file:' },
    BetterDungeonBridge: { getPlatformConfig: () => JSON.stringify(nativeConfig) }
  });
  assert.equal(android.platform.kind, 'android-webview');
  assert.equal(android.platform.formFactor, 'mobile');
  assert.equal(android.platform.has('nativeBridge'), true);
  assert.equal(android.platform.supportsFeature('command'), true);
  assert.equal(android.platform.supportsFeature('hotkey'), false);

  let ready = false;
  const pending = android.platform.whenReady().then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  android.listeners.get('betterdungeon:popup-bridge-ready')();
  await pending;
  assert.equal(ready, true);

  const malformed = loadPlatform({
    console: { warn() {} },
    location: { protocol: 'file:' },
    BetterDungeonBridge: { getPlatformConfig: () => '{not-json' }
  }).platform;
  assert.equal(malformed.kind, 'android-webview');
  assert.equal(malformed.supportsFeature('hotkey'), false);
});

test('extension manifest files exist and stay inside the package allowlist', () => {
  const runtimePaths = [
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap(entry => [...(entry.js || []), ...(entry.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(entry => entry.resources || []),
    ...Object.values(manifest.icons || {}),
    manifest.action?.default_popup
  ].filter(Boolean);

  for (const relativePath of runtimePaths) {
    if (relativePath.includes('*')) {
      const prefix = relativePath.slice(0, relativePath.indexOf('*'));
      const dirPart = prefix.slice(0, Math.max(prefix.lastIndexOf('/'), 0));
      const regex = new RegExp('^' + relativePath.split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*') + '$');
      const matches = filesBelow(path.join(root, dirPart), dirPart).filter(p => regex.test(p));
      assert.ok(matches.length > 0, 'manifest glob matches nothing: ' + relativePath);
      for (const match of matches) {
        assert.ok(includedByPackage(match), 'not allowlisted: ' + match);
      }
      continue;
    }
    assert.ok(fs.existsSync(path.join(root, relativePath)), 'missing manifest path: ' + relativePath);
    assert.ok(includedByPackage(relativePath), 'not allowlisted: ' + relativePath);
  }

  for (const excludedDirectory of ['android', 'tests', 'dist', '.git']) {
    assert.equal(includedByPackage(excludedDirectory + '/sentinel'), false);
  }
});

test('Android runtime sources resolve and release-only files stay untracked', () => {
  const lists = ['earlyScripts', 'styles', 'scripts', 'resources', 'androidFiles'];
  for (const key of lists) {
    assert.ok(Array.isArray(runtime[key]), 'runtime manifest is missing ' + key);
    assert.equal(new Set(runtime[key]).size, runtime[key].length, key + ' contains duplicates');
  }

  const ordered = [...runtime.earlyScripts, ...runtime.styles, ...runtime.scripts, ...runtime.resources];
  assert.equal(new Set(ordered).size, ordered.length, 'runtime injection order contains duplicates');
  assert.equal(runtime.earlyScripts[0], 'utils/platform.js', 'platform contract must load before early scripts');
  assert.equal('overrides' in runtime, false, 'runtime manifest must not support copied overrides');
  assert.deepEqual(filesBelow(path.join(androidRoot, 'overrides')), [], 'android/overrides must contain no files');
  assert.deepEqual(
    [...runtime.androidFiles].sort(),
    filesBelow(path.join(androidRoot, 'web')).sort(),
    'androidFiles must exactly match android/web'
  );
  for (const relativePath of runtime.androidFiles) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, 'Android-only path collides with shared source: ' + relativePath);
  }
  for (const relativePath of ordered) {
    const source = runtime.androidFiles.includes(relativePath)
      ? path.join(androidRoot, 'web', relativePath)
      : path.join(root, relativePath);
    assert.ok(fs.existsSync(source), 'missing Android runtime source: ' + relativePath);
  }

  for (const relativePath of runtime.androidFiles) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, 'Android-only path replaces shared source: ' + relativePath);
  }

  const tracked = childProcess.execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(
    tracked,
    /(^|\/)(?:dist|\.build)(?:\/|$)|^android\/(?:.+\/)?build(?:\/|$)|\.(?:apk|aab|jks|keystore)$/im,
    'generated packages and signing files must not be tracked'
  );
});

test('adventure read falls back to GraphQL story cards when Apollo is incomplete', async () => {
  const graphqlCards = [
    { id: 'g1', type: 'character', title: 'Graph One', description: 'first', keys: 'alpha,beta', value: 'Graph One entry' },
    { id: 'g2', type: 'location', title: 'Graph Two', description: 'second', keys: 'gamma', value: 'Graph Two entry' }
  ];
  const apolloData = storyCards => ({
    adventure: { id: 'a1', shortId: 'adv1', title: 'Adventure', actionCount: 0, storyCardCount: 2 },
    state: {},
    storyCards,
    actions: []
  });

  const empty = loadAdventureReadService({ apolloData: apolloData([]), graphqlCards });
  const emptyRead = await empty.service.readAdventure({ shortId: 'adv1' });
  assert.equal(empty.calls.storyCards, 1);
  assert.deepEqual(Array.from(emptyRead.storyCards).map(card => card.id), ['g1', 'g2']);
  assert.equal(emptyRead.provenance.storyCards.source, 'graphql');

  const partial = loadAdventureReadService({ apolloData: apolloData([{ id: 'a1' }]), graphqlCards });
  const partialRead = await partial.service.readCards({ shortId: 'adv1' });
  assert.equal(partial.calls.storyCards, 1);
  assert.deepEqual(Array.from(partialRead.cards).map(card => card.id), ['g1', 'g2']);
  assert.equal(partialRead.provenance.source, 'graphql');

  const complete = loadAdventureReadService({
    apolloData: apolloData([{ id: 'a1' }, { id: 'a2' }]),
    graphqlCards
  });
  const completeRead = await complete.service.readAdventure({ shortId: 'adv1' });
  assert.equal(complete.calls.storyCards, 0);
  assert.deepEqual(Array.from(completeRead.storyCards).map(card => card.id), ['a1', 'a2']);
  assert.equal(completeRead.provenance.storyCards.source, 'apollo');
});

test('story card scanner consumes the shared adventure read fallback chain', async () => {
  const graphqlCards = [
    { id: 'g1', type: 'character', title: 'Graph One', keys: 'alpha,beta', value: 'Graph One entry' },
    { id: 'g2', type: 'location', title: 'Graph Two', keys: 'gamma', value: 'Graph Two entry' }
  ];
  const harness = loadAdventureReadService({
    apolloData: {
      adventure: { id: 'a1', shortId: 'adv1', title: 'Adventure', actionCount: 0, storyCardCount: 2 },
      state: {},
      storyCards: [],
      actions: []
    },
    graphqlCards
  });
  vm.runInNewContext(storyCardScannerSource, harness.context, { filename: 'services/story-card-scanner.js' });
  const scanner = new harness.context.StoryCardScanner();
  const result = await scanner.scanAllCards();
  assert.equal(result.success, true);
  assert.equal(result.source, 'graphql');
  assert.equal(result.scannedCount, 2);
  assert.equal(harness.calls.storyCards, 1);
  const analytics = scanner.getAnalytics();
  assert.equal(analytics.totalCards, 2);
  assert.equal(analytics.withTriggers, 2);
});
