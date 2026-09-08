'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ANDROID_ROOT } = require('../../harness/android-runtime');

const activityPath = path.join(
  ANDROID_ROOT,
  'app',
  'src',
  'main',
  'java',
  'com',
  'computerk',
  'betterdungeon',
  'MainActivity.kt'
);
const activity = fs.readFileSync(activityPath, 'utf8');

function bodyBetween(startMarker, endMarker) {
  const start = activity.indexOf(startMarker);
  const end = activity.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return activity.slice(start, end);
}

function testSupportedBranchesAreWhitelisted() {
  assert.match(activity, /DEFAULT_AI_DUNGEON_URL\s*=\s*"https:\/\/play\.aidungeon\.com"/);
  for (const host of ['play.aidungeon.com', 'beta.aidungeon.com', 'alpha.aidungeon.com']) {
    assert.ok(activity.includes(`"${host}"`), `missing supported branch ${host}`);
  }
  assert.match(activity, /rememberedHost\?\.let \{ "https:\/\/\$it" \} \?: DEFAULT_AI_DUNGEON_URL/);
}

function testLauncherRestoresRememberedBranch() {
  assert.match(activity, /loadAiDungeonUrl\(intent\.data\)/);

  const loader = bodyBetween('private fun loadAiDungeonUrl', 'private fun isAiDungeonUri');
  assert.match(loader, /uri\?\.takeIf\(::isAiDungeonUri\)/);
  assert.match(loader, /requestedUri\?\.toString\(\) \?: rememberedAiDungeonBranchUrl\(\)/);
  assert.match(loader, /rememberAiDungeonBranch\(requestedUri\)/);
}

function testInAppNavigationUpdatesRememberedBranch() {
  const pageStarted = bodyBetween('override fun onPageStarted', 'override fun onPageFinished');
  assert.match(pageStarted, /rememberAiDungeonBranch\(uri\)/);

  const remember = bodyBetween('private fun rememberAiDungeonBranch', 'private fun rememberedAiDungeonBranchUrl');
  assert.match(remember, /if \(!isAiDungeonUri\(uri\)\) return/);
  assert.match(remember, /putString\(AI_DUNGEON_BRANCH_PREFERENCE, host\)/);
  assert.match(remember, /\.apply\(\)/);
}

testSupportedBranchesAreWhitelisted();
testLauncherRestoresRememberedBranch();
testInAppNavigationUpdatesRememberedBranch();
console.log('AI Dungeon branch persistence contract tests passed');
