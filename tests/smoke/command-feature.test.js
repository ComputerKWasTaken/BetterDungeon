'use strict';

// Focused regression checks for Command Mode (features/command_feature.js).

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
