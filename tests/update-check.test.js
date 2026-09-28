'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services', 'update-check.js'), 'utf8');

function loadModule(overrides = {}) {
  const store = {};
  const calls = { fetch: 0 };
  const fakeChrome = {
    runtime: {
      getManifest: () => ({ version: '2.1.1' }),
    },
    storage: {
      local: {
        get(key, callback) {
          const result = {};
          if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
          if (callback) callback(result);
          return Promise.resolve(result);
        },
        set(items, callback) {
          Object.assign(store, items);
          if (callback) callback();
          return Promise.resolve();
        },
      },
    },
  };
  const context = {
    console,
    Promise,
    Error,
    Set,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Math,
    TextDecoder,
    fetch: async () => {
      calls.fetch += 1;
      throw new Error('fetch not stubbed');
    },
    chrome: fakeChrome,
    ...overrides,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'services/update-check.js' });
  return { module: context.BetterDungeonUpdateCheck, context, store, calls };
}

function releaseResponse(tag, overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? '"etag-1"' : null) },
    json: async () => ({
      tag_name: tag,
      name: `BetterDungeon ${tag}`,
      html_url: `https://github.com/ComputerKWasTaken/BetterDungeon/releases/tag/${tag}`,
      assets: [
        { browser_download_url: `https://example.com/BetterDungeon-${tag}.zip` },
        { browser_download_url: `https://example.com/BetterDungeon-Mobile-${tag}-debug.apk` },
      ],
      ...overrides,
    }),
  };
}

test('compareVersions handles tags, v-prefixes, missing segments, and suffixes', () => {
  const { module } = loadModule();
  assert.ok(module.compareVersions('2.1.0', '2.0.3') > 0);
  assert.ok(module.compareVersions('2.0.3', '2.1.0') < 0);
  assert.equal(module.compareVersions('v2.1.0', '2.1.0'), 0);
  assert.equal(module.compareVersions('2.0', '2.0.0'), 0);
  assert.ok(module.compareVersions('2.1.0-beta', '2.1.0') < 0);
  assert.ok(module.compareVersions('2.1.0', '2.1.0-beta') > 0);
  assert.equal(module.compareVersions('garbage', '2.1.0'), 0);
});

test('install context only treats manual installs as checkable', () => {
  const unpacked = loadModule();
  assert.equal(unpacked.module.getInstallContext().manual, true);
  assert.equal(unpacked.module.getInstallContext().channel, 'extension');

  const storeManaged = loadModule({
    chrome: {
      runtime: { getManifest: () => ({ version: '2.1.1', update_url: 'https://clients2.google.com/service/update2/crx' }) },
    },
  });
  assert.equal(storeManaged.module.getInstallContext().manual, false);

  const gecko = loadModule({
    browser: { runtime: { getBrowserInfo: async () => ({ name: 'Firefox' }), getManifest: () => ({ version: '2.1.1' }) } },
  });
  assert.equal(gecko.module.getInstallContext().manual, false);

  const android = loadModule({
    BetterDungeonPlatform: { kind: 'android-webview' },
  });
  assert.equal(android.module.getInstallContext().manual, true);
  assert.equal(android.module.getInstallContext().channel, 'android');
});

test('checkNow flags newer releases and links the matching asset', async () => {
  const { module } = loadModule({
    fetch: async () => releaseResponse('2.2.0'),
  });
  const status = await module.checkNow();
  assert.equal(status.updateAvailable, true);
  assert.equal(status.shouldNotify, true);
  assert.equal(status.latestVersion, '2.2.0');
  assert.ok(status.downloadUrl.endsWith('.zip'));
});

test('older or equal releases never flag', async () => {
  const { module } = loadModule({
    fetch: async () => releaseResponse('2.0.3'),
  });
  const status = await module.checkNow();
  assert.equal(status.updateAvailable, false);
  assert.equal(status.shouldNotify, false);
});
