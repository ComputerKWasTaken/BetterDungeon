'use strict';

// Regression pins for Navigator's GraphQL documents against the shapes
// AI Dungeon's own web client uses (verified from the live play bundle,
// build yHuVepAanMcsrfh7owWDd, 2026-11-17).
//
// The memory mutations previously requested `code` (edit + delete) and
// `memory` (edit) on the editMemory/deleteMemory payloads. AI Dungeon's own
// EditMemory/DeleteMemory documents only ever select success/message (plus
// numMemoriesStored on delete), while sibling payloads that do have a `code`
// field (updateStoryCard, RenameAdventureEntity) are selected with it by the
// app. Requesting a field the payload type does not have fails GraphQL
// validation and rejects the entire mutation — and BetterDungeon's wrappers
// only consume success/message anyway. These tests pin the trimmed shapes so
// unverified fields cannot creep back in.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadService() {
  const context = { window: {}, console, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.createContext(context);
  const file = path.join(__dirname, '../../services/graphql-service.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.window.BetterDungeonGQLService;
}

function selectionFields(document, rootField) {
  const match = document.match(new RegExp(`${rootField}\\s*\\(input:[^)]*\\)\\s*\\{([^}]*)\\}`));
  assert.ok(match, `document should select on ${rootField}`);
  return match[1].split(/\s+/).filter(Boolean).sort();
}

test('NavigatorEditMemory requests only bundle-verified payload fields', () => {
  const Service = loadService();
  assert.deepEqual(
    selectionFields(Service.MUTATIONS.navigatorEditMemory, 'editMemory'),
    ['message', 'success']
  );
});

test('NavigatorDeleteMemory requests only bundle-verified payload fields', () => {
  const Service = loadService();
  assert.deepEqual(
    selectionFields(Service.MUTATIONS.navigatorDeleteMemory, 'deleteMemory'),
    ['message', 'success']
  );
});

test('Navigator context query fields all appear in the app\'s own adventure queries', () => {
  const Service = loadService();
  // Fields AI Dungeon's own GetAdventure / GetGameplayAdventure select on
  // Adventure (plus state subfields), from the same live bundle.
  const verifiedAdventureFields = new Set([
    'id', 'shortId', 'title', 'actionCount', 'editedAt', 'thirdPerson',
    'memory', 'authorsNote', 'instructions', 'scenarioId', 'storyCardCount',
    'state', '__typename',
  ]);
  const verifiedStateFields = new Set(['instructions', 'storySummary', '__typename']);
  const query = Service.QUERIES.navigatorAdventureContext;
  const stateBlock = query.match(/state\s*\{([^}]*)\}/)[1];
  const adventureBlock = query
    .replace(/state\s*\{[^}]*\}/, 'state')
    .match(/adventure\s*\([^)]*\)\s*\{([\s\S]*)\}\s*`?$/)[1];
  for (const field of stateBlock.split(/\s+/).filter(Boolean)) {
    assert.ok(verifiedStateFields.has(field), `state field ${field} is not bundle-verified`);
  }
  for (const field of adventureBlock.split(/\s+/).filter(token => /^[A-Za-z_]+$/.test(token))) {
    assert.ok(verifiedAdventureFields.has(field), `adventure field ${field} is not bundle-verified`);
  }
});
