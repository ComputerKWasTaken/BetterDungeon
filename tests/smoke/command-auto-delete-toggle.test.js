'use strict';

// Contract test for the Command Mode auto-delete popup toggle (v2.1.2):
// the popup control, the popup wiring and the content feature must agree
// on the storage key and the live-update message, or the toggle would
// silently do nothing — the exact failure this test exists to prevent.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const commandFeature = fs.readFileSync(path.join(root, 'features', 'command_feature.js'), 'utf8');

test('popup exposes an auto-delete toggle in the Command Mode card', () => {
  const cardStart = popupHtml.indexOf('data-feature="command"');
  const cardEnd = popupHtml.indexOf('</article>', cardStart);
  assert.ok(cardStart !== -1 && cardEnd !== -1, 'Command Mode card must exist');
  const card = popupHtml.slice(cardStart, cardEnd);
  assert.match(card, /id="command-auto-delete"/);
  assert.match(card, /Auto-delete command header/);
});

test('popup toggle persists the exact storage key the feature reads', () => {
  assert.match(popupJs, /commandAutoDelete: 'betterDungeon_commandAutoDelete'/);
  assert.match(popupJs, /storage\.sync\.get\(STORAGE_KEYS\.commandAutoDelete/);
  assert.match(popupJs, /storage\.sync\.set\(\{ \[STORAGE_KEYS\.commandAutoDelete\]: e\.target\.checked \}\)/);
  assert.match(commandFeature, /chrome\.storage\.sync\.get\('betterDungeon_commandAutoDelete'/);
  assert.match(commandFeature, /betterDungeon_commandAutoDelete \?\? false/);
});

test('popup toggle live-updates the feature via its message', () => {
  assert.match(popupJs, /notifyContentScript\('SET_COMMAND_AUTO_DELETE', \{ enabled: e\.target\.checked \}\)/);
  assert.match(commandFeature, /message\.type === 'SET_COMMAND_AUTO_DELETE'/);
});
