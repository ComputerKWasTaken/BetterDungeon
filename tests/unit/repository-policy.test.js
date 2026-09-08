'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ANDROID_ROOT, REPO_ROOT, readConfig, validateRuntimeConfig } = require('../harness/android-runtime');

const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
const packageEntries = fs.readFileSync(path.join(REPO_ROOT, 'build', 'extension-files.txt'), 'utf8')
  .split(/\r?\n/)
  .map(value => value.trim())
  .filter(value => value && !value.startsWith('#'));

function packaged(relativePath) {
  return packageEntries.some(entry => relativePath === entry || relativePath.startsWith(`${entry}/`));
}

test('browser and Android versions stay aligned', () => {
  const gradle = fs.readFileSync(path.join(ANDROID_ROOT, 'app', 'build.gradle.kts'), 'utf8');
  const match = gradle.match(/versionName\s*=\s*"([^"]+)"/);
  assert.ok(match, 'Android versionName must be readable');
  assert.equal(match[1], manifest.version);
});

test('extension manifest runtime paths are packaged', () => {
  const runtimePaths = [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    ...manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])]),
    ...manifest.web_accessible_resources.flatMap(entry => entry.resources || []),
    ...Object.values(manifest.icons || {}),
    manifest.action?.default_popup,
  ].filter(Boolean);
  for (const relativePath of runtimePaths) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relativePath)), `missing manifest path ${relativePath}`);
    assert.ok(packaged(relativePath), `manifest path is not covered by extension-files.txt: ${relativePath}`);
  }
  for (const forbidden of ['android', 'tests', 'dist', '.git']) assert.equal(packaged(`${forbidden}/sentinel`), false);
});

test('Android runtime configuration is complete and explicit', () => {
  const config = validateRuntimeConfig();
  assert.ok(config.earlyScripts.length > 0);
  assert.ok(config.scripts.includes('main.js'));
  assert.ok(config.mobileFiles.includes('utils/webview-polyfill.js'));
  assert.ok(config.overrides.includes('features/navigator_feature.js'));
  const injection = fs.readFileSync(path.join(ANDROID_ROOT, 'app', 'src', 'main', 'java', 'com', 'computerk', 'betterdungeon', 'InjectionEngine.kt'), 'utf8');
  assert.match(injection, /runtime-manifest\.json/);
  assert.doesNotMatch(injection, /private val (?:CSS|JS)_FILES/);
});

test('generated output and release binaries are not tracked', () => {
  const tracked = childProcess.execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const forbidden = tracked.filter(relativePath =>
    /(^|\/)(?:dist|\.build)(?:\/|$)/i.test(relativePath)
      || /^android\/(?:.+\/)?build(?:\/|$)/i.test(relativePath)
      || /^android\/app\/release(?:\/|$)/i.test(relativePath)
      || /\.(?:apk|aab|jks|keystore)$/i.test(relativePath)
      || /(^|\/)local\.properties$/i.test(relativePath)
  );
  assert.deepEqual(forbidden, []);
});
