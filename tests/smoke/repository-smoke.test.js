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
