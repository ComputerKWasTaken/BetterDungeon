'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'services', 'update-check.js'), 'utf8');

function loadModule(overrides = {}) {
  const store = {};
  const calls = { fetch: 0 };
  const fakeChrome = {
    runtime: {
      getManifest: () => ({ version: '2.1.0' }),
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
      runtime: { getManifest: () => ({ version: '2.1.0', update_url: 'https://clients2.google.com/service/update2/crx' }) },
    },
  });
  assert.equal(storeManaged.module.getInstallContext().manual, false);

  const gecko = loadModule({
    browser: { runtime: { getBrowserInfo: async () => ({ name: 'Firefox' }), getManifest: () => ({ version: '2.1.0' }) } },
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

test('Android picks the APK asset', async () => {
  const { module } = loadModule({
    BetterDungeonPlatform: { kind: 'android-webview' },
    fetch: async () => releaseResponse('2.2.0'),
  });
  const status = await module.checkNow();
  assert.equal(status.updateAvailable, true);
  assert.ok(status.downloadUrl.endsWith('.apk'));
});

test('older or equal releases never flag', async () => {
  const { module } = loadModule({
    fetch: async () => releaseResponse('2.0.3'),
  });
  const status = await module.checkNow();
  assert.equal(status.updateAvailable, false);
  assert.equal(status.shouldNotify, false);
});

test('dismiss silences the flag for that version only', async () => {
  const { module } = loadModule({
    fetch: async () => releaseResponse('2.2.0'),
  });
  await module.checkNow();
  const dismissed = await module.dismiss('2.2.0');
  assert.equal(dismissed.shouldNotify, false);
  assert.equal(dismissed.updateAvailable, true);
});

test('setEnabled(false) stops automatic checks but manual checkNow still runs', async () => {
  let fetches = 0;
  const env = loadModule({
    fetch: async () => { fetches += 1; return releaseResponse('2.2.0'); },
  });
  await env.module.setEnabled(false);
  const due = await env.module.checkIfDue();
  assert.equal(due.enabled, false);
  assert.equal(fetches, 0);
  const forced = await env.module.checkNow();
  assert.equal(forced.updateAvailable, true);
  assert.equal(fetches, 1);
});

test('checkIfDue throttles repeat checks', async () => {
  let fetches = 0;
  const env = loadModule({
    fetch: async () => { fetches += 1; return releaseResponse('2.1.0'); },
  });
  await env.module.checkNow();
  assert.equal(fetches, 1);
  await env.module.checkIfDue();
  assert.equal(fetches, 1);
});

test('304 responses keep the last known release', async () => {
  let notModified = false;
  const env = loadModule({
    fetch: async (url, options) => {
      if (options?.headers?.['If-None-Match']) {
        notModified = true;
        return { ok: false, status: 304, headers: { get: () => null }, json: async () => ({}) };
      }
      return releaseResponse('2.2.0');
    },
  });
  await env.module.checkNow();
  env.store.betterDungeonUpdateCheck.nextRetryAt = 0;
  await env.module.checkIfDue();
  assert.equal(notModified, true);
  const status = await env.module.getStatus();
  assert.equal(status.latestVersion, '2.2.0');
});
