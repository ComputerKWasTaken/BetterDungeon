'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
global.window = global;

window.NavigatorPrimer = {
  VERSION: 10,
  CORE: 'NAVIGATOR CORE',
  REFERENCE: 'NAVIGATOR REFERENCE',
};
window.Ultrascripts = {
  ws: {
    getAdventureShortId: () => 'context-test',
    getAdventureId: () => '42',
  },
};
window.BetterDungeonAdventureRead = {
  async readAdventure() {
    return {
      identity: { id: '42', shortId: 'context-test', title: 'Inspector Adventure', actionCount: 2, thirdPerson: false },
      plot: {
        instructions: 'Always write vivid scenes.',
        memory: 'Mara is searching for the glass city.',
        authorsNote: 'Keep the mood mysterious.',
        storySummary: 'Mara crossed the silent marsh.',
      },
      state: { lastSummarizedActionId: '1', lastMemoryActionId: '1', memories: [] },
      actions: [
        { id: '1', type: 'do', text: 'Mara entered the marsh.' },
        { id: '2', type: 'story', text: 'A distant bell answered.' },
      ],
      storyCards: [{ id: 'card-1', type: 'location', title: 'Glass City', keys: 'glass city', value: 'A hidden city.' }],
      provenance: {
        plot: { instructions: 'graphql', memory: 'graphql', authorsNote: 'graphql', storySummary: 'graphql' },
        actions: { source: 'apollo' },
        storyCards: { source: 'graphql' },
      },
      coverage: {
        actions: { authoritativeTotal: 2, available: 2, availabilityGap: false },
        storyCards: { authoritativeTotal: 1, available: 1 },
      },
      degradations: [],
      sourceDegraded: false,
      historyIncomplete: false,
      apolloRetryable: false,
    };
  },
  async readMemories() {
    return {
      memories: [{ id: 'memory-1', text: 'Mara distrusts bells.' }],
      provenance: { source: 'graphql' },
      degradations: [],
    };
  },
};

vm.runInThisContext(
  fs.readFileSync(path.join(ROOT, 'services', 'navigator', 'context.js'), 'utf8'),
  { filename: 'services/navigator/context.js' }
);

(async () => {
  const source = fs.readFileSync(path.join(ROOT, 'services', 'navigator', 'context.js'), 'utf8');
  assert.doesNotMatch(source, /contextSections|omitted by user setting|get_plot_components/);

  const snapshot = await new window.NavigatorContext('context-test').build({ maxChars: 46000 });
  const sections = snapshot.inspectionSections;
  assert.ok(sections);
  assert.match(sections.identity, /Inspector Adventure/);
  assert.match(sections.plotComponents, /Always write vivid scenes/);
  assert.match(sections.recentActions, /A distant bell answered/);
  assert.match(sections.memoryBank, /Mara distrusts bells/);
  assert.match(sections.storyCardDirectory, /Glass City/);

  const exactSections = [
    ['COVERAGE', sections.coverage],
    ['IDENTITY', sections.identity],
    ['PLOT COMPONENTS', sections.plotComponents],
    ['RECENT STORY ACTIONS', sections.recentActions],
    ['MEMORY BANK', sections.memoryBank],
    ['STORY CARD DIRECTORY (ID | TYPE | TITLE)', sections.storyCardDirectory],
  ];
  for (const [heading, text] of exactSections) {
    assert.ok(snapshot.systemInstruction.includes(`${heading}\n${text}`), `${heading} inspection text must exactly match the sent snapshot`);
  }
  assert.equal(snapshot.summary.settings, undefined);

  console.log('Navigator context and Inspector section contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
