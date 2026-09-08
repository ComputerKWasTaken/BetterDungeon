'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { composeAndroidRuntime } = require('../../harness/android-runtime');

const ROOT = composeAndroidRuntime();
global.window = global;

function load(file) {
  const filename = path.join(ROOT, file);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

load('services/navigator/primer.js');
load('services/navigator/tools.js');

const index = {
  source: 'graphql',
  adventureId: '42',
  shortId: 'demo',
  capturedAtIso: '2026-08-26T12:00:00.000Z',
  adventure: {
    instructions: 'instruction '.repeat(800),
    memory: 'A compact persistent fact.',
    authorsNote: 'Keep the scene tense.',
    storySummary: 'The party reached the gate.',
  },
  provenance: {
    plot: {
      instructions: 'graphql',
      memory: 'graphql',
      authorsNote: 'graphql',
      storySummary: 'graphql',
    },
  },
  cards: [{
    id: 'long-card',
    type: 'lore '.repeat(80),
    title: `Dragon Archive ${'title '.repeat(100)}`,
    keys: Array.from({ length: 25 }, (_, triggerIndex) => `dragon-${triggerIndex}-${'x'.repeat(250)}`).join(','),
    value: '\0'.repeat(10000),
    description: 'notes '.repeat(300),
  }],
  actions: [],
  memories: [],
};

(async () => {
  assert.equal(window.NavigatorPrimer.VERSION, 10);
  assert.match(window.NavigatorPrimer.CORE, /CORE EVIDENCE RULES/);
  assert.match(window.NavigatorPrimer.CORE, /CORE CHANGE RULES/);
  assert.match(window.NavigatorPrimer.REFERENCE, /PLOT COMPONENT REFERENCE/);
  assert.equal(window.NavigatorPrimer.TEXT, `${window.NavigatorPrimer.CORE}\n\n${window.NavigatorPrimer.REFERENCE}`);

  const tools = new window.NavigatorTools('demo');
  assert.doesNotMatch(JSON.stringify(tools.definitions()), /get_plot_components/);

  const card = await tools.execute('get_story_card', { id: 'long-card' }, { index });
  for (const field of ['type', 'title', 'keys', 'triggers', 'notes', 'entry']) {
    assert.equal(card.data.card[`${field}Truncated`], true, `${field} truncation must be explicit`);
  }
  assert.equal(card.data.card.triggerCount, 25);
  assert.equal(card.data.card.triggersReturned, 20);
  assert.ok(card.data.card.entrySourceChars > card.data.card.value.length);
  assert.equal(card.truncated, true);
  assert.ok(card.data.clippedFields.includes('data.card.value'));

  await assert.rejects(
    tools.execute('get_plot_components', { components: [] }, { index }),
    error => error?.code === 'unknown_tool'
  );

  console.log('Navigator tool and primer contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
