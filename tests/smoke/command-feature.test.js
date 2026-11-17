'use strict';

// Focused regression checks for Command Mode (features/command_feature.js).
// The auto-delete story scan used to query 'span[id="transition-opacity"]',
// but AI Dungeon renders that id through Tamagui components whose web
// element is not reliably a <span> — the shared service selector is the
// tag-agnostic '#transition-opacity' for the same reason. The span-only
// selector silently matched nothing, so auto-delete never fired. These
// checks pin the tag-agnostic scan, the header formats for all three
// sub-modes, sub-mode cycling, and the warn-once platform diagnostics.

const test = require('node:test');
const assert = require('node:assert/strict');

// The feature constructor instantiates the shared service; stub it before
// loading the file (in the browser it comes from ai-dungeon-service.js).
global.AIDungeonService = class AIDungeonServiceStub {};
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
};

const CommandFeature = require('../../features/command_feature.js');

function makeFeature() {
  return new CommandFeature();
}

test('formatAsCommand produces the designed header for each sub-mode', () => {
  const feature = makeFeature();

  feature.subMode = 'standard';
  assert.equal(feature.formatAsCommand('Kill the dragon'), '\n\n## Kill the dragon:\n\n');

  feature.subMode = 'subtle';
  assert.equal(feature.formatAsCommand('Kill the dragon'), '\n\n[## Kill the dragon:]\n\n');

  feature.subMode = 'ooc';
  assert.equal(
    feature.formatAsCommand('Kill the dragon'),
    '\n\n((DIRECTLY RESPOND TO THIS OOC. RESPOND AS "AI:" | User: Kill the dragon?))\n\n'
  );
});

test('formatAsCommand cleans leading hashes and trailing punctuation', () => {
  const feature = makeFeature();
  feature.subMode = 'standard';
  assert.equal(feature.formatAsCommand('  ## Open the door!  '), '\n\n## Open the door:\n\n');
  feature.subMode = 'ooc';
  assert.equal(
    feature.formatAsCommand('What is the dragon planning?'),
    '\n\n((DIRECTLY RESPOND TO THIS OOC. RESPOND AS "AI:" | User: What is the dragon planning?))\n\n'
  );
});

test('cycleSubMode wraps around in both directions', () => {
  const feature = makeFeature();
  feature.subMode = 'standard';
  feature.cycleSubMode(1);
  assert.equal(feature.subMode, 'subtle');
  feature.cycleSubMode(1);
  assert.equal(feature.subMode, 'ooc');
  feature.cycleSubMode(1);
  assert.equal(feature.subMode, 'standard');
  feature.cycleSubMode(-1);
  assert.equal(feature.subMode, 'ooc');
});

// Minimal selector matcher covering the two shapes this feature queries:
// an optional tag name plus [id="..."]. A DIV carrying the id must match
// the tag-agnostic form and must NOT match the old span-only form.
function fakeStoryOutput(elements) {
  return {
    querySelectorAll(selector) {
      const match = selector.match(/^(?:([a-z]+))?\[id="([^"]+)"\]$/i);
      assert.ok(match, `unexpected selector in test harness: ${selector}`);
      const [, tag, id] = match;
      return elements.filter(el =>
        el.id === id && (!tag || el.tagName === tag.toUpperCase()));
    },
  };
}

function fakeBlock(tagName, text) {
  return {
    tagName,
    id: 'transition-opacity',
    textContent: text,
    clicked: false,
    click() { this.clicked = true; },
  };
}

test('deleteCommandFromStory finds the command in a DIV action block', () => {
  const feature = makeFeature();
  const commandText = '## Burn the village:';
  const divBlock = fakeBlock('div', `Some narration. ${commandText} More text.`);
  const otherBlock = fakeBlock('span', 'Unrelated action text.');
  const output = fakeStoryOutput([divBlock, otherBlock]);

  const realDocument = global.document;
  global.document = {
    querySelector: selector => (selector === '#gameplay-output' ? output : null),
    querySelectorAll: () => [],
  };
  try {
    feature.pendingCommandDelete = commandText;
    feature.deleteCommandFromStory();
  } finally {
    global.document = realDocument;
  }

  assert.equal(divBlock.clicked, true, 'auto-delete should click the DIV action block');
  assert.equal(otherBlock.clicked, false);
});

test('warnOnce reports each platform failure reason only once', () => {
  const feature = makeFeature();
  const warnings = [];
  const realWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    feature.warnOnce('inject-failed', 'first');
    feature.warnOnce('inject-failed', 'first again');
    feature.warnOnce('activate-no-story', 'second reason');
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /\[Command\] first/);
});

test('injectCommandButton warns once when the menu is open but injection fails', () => {
  const feature = makeFeature();
  const warnings = [];
  const realWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    feature.aid = {
      injectCustomModeButton: () => null,
      getInputModeMenu: () => ({}),
      detectCurrentMode: () => null,
    };
    feature.injectCommandButton();
    feature.injectCommandButton();
    assert.equal(feature.commandButton, null);
    assert.equal(warnings.length, 1, 'expected exactly one injection warning');

    // A later successful injection re-arms the warning.
    feature.aid = {
      injectCustomModeButton: () => ({}),
      getInputModeMenu: () => ({}),
      detectCurrentMode: () => null,
    };
    feature.injectCommandButton();
    assert.ok(feature.commandButton);
    feature.aid.injectCustomModeButton = () => null;
    feature.injectCommandButton();
    assert.equal(warnings.length, 2, 'warning should fire again after a success reset it');
  } finally {
    console.warn = realWarn;
  }
});
