'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ANDROID_ROOT = path.join(REPO_ROOT, 'android');
const CONFIG_PATH = path.join(ANDROID_ROOT, 'betterdungeon-runtime.json');

let composedRoot = null;
let temporaryRoot = null;

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/'))
    .sort();
}

function resolveRuntimeSource(relativePath, config) {
  if (config.overrides.includes(relativePath)) {
    return path.join(ANDROID_ROOT, 'overrides', relativePath);
  }
  if (config.mobileFiles.includes(relativePath)) {
    return path.join(ANDROID_ROOT, 'web', relativePath);
  }
  return path.join(REPO_ROOT, relativePath);
}

function validateRuntimeConfig(config = readConfig()) {
  const requiredLists = ['earlyScripts', 'styles', 'scripts', 'resources', 'mobileFiles', 'overrides'];
  for (const key of requiredLists) {
    if (!Array.isArray(config[key]) || config[key].some(value => typeof value !== 'string')) {
      throw new TypeError(`${key} must be an array of paths`);
    }
    if (new Set(config[key]).size !== config[key].length) throw new Error(`${key} contains duplicate paths`);
    if (config[key].some(value => !value || path.isAbsolute(value) || value.split('/').includes('..'))) {
      throw new Error(`${key} contains an unsafe path`);
    }
  }

  const orderedTargets = [...config.earlyScripts, ...config.styles, ...config.scripts, ...config.resources];
  if (new Set(orderedTargets).size !== orderedTargets.length) {
    throw new Error('Android runtime lists contain duplicate paths');
  }

  const mobileSet = new Set(config.mobileFiles);
  const overrideSet = new Set(config.overrides);
  const overlap = [...mobileSet].filter(value => overrideSet.has(value));
  if (overlap.length) throw new Error(`Runtime paths cannot be mobile files and overrides: ${overlap.join(', ')}`);

  const actualMobile = listFiles(path.join(ANDROID_ROOT, 'web'));
  const actualOverrides = listFiles(path.join(ANDROID_ROOT, 'overrides'));
  const same = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
  if (!same(actualMobile, [...mobileSet].sort())) throw new Error('android/web does not match mobileFiles');
  if (!same(actualOverrides, [...overrideSet].sort())) throw new Error('android/overrides does not match overrides');

  const included = new Set([
    ...config.earlyScripts,
    ...config.styles,
    ...config.scripts,
    ...config.resources,
  ]);
  for (const target of [...mobileSet, ...overrideSet]) {
    if (!included.has(target)) throw new Error(`Android-specific target is not packaged: ${target}`);
  }
  for (const target of included) {
    if (!fs.existsSync(resolveRuntimeSource(target, config))) throw new Error(`Missing Android runtime source: ${target}`);
  }
  return config;
}

function composeAndroidRuntime() {
  if (composedRoot) return composedRoot;
  const config = validateRuntimeConfig();
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdungeon-android-test-'));
  composedRoot = path.join(temporaryRoot, 'betterdungeon');
  fs.mkdirSync(composedRoot, { recursive: true });

  const targets = [...new Set([
    ...config.earlyScripts,
    ...config.styles,
    ...config.scripts,
    ...config.resources,
  ])];
  for (const target of targets) {
    const source = resolveRuntimeSource(target, config);
    if (!fs.existsSync(source)) throw new Error(`Missing Android runtime source: ${target}`);
    fs.cpSync(source, path.join(composedRoot, target), { recursive: true, errorOnExist: true });
  }

  fs.writeFileSync(path.join(composedRoot, 'runtime-manifest.json'), `${JSON.stringify({
    earlyScripts: config.earlyScripts,
    styles: config.styles,
    scripts: config.scripts,
  }, null, 2)}\n`);
  return composedRoot;
}

process.once('exit', () => {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

module.exports = {
  ANDROID_ROOT,
  CONFIG_PATH,
  REPO_ROOT,
  composeAndroidRuntime,
  readConfig,
  resolveRuntimeSource,
  validateRuntimeConfig,
};
