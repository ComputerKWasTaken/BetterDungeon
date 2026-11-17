'use strict';

// Regression checks for Auto See audit fixes:
// 1. A See trigger pending its 300 ms delay must be cancellable by an abort
//    (user interrupt / adventure change / destroy). Before the fix the delay
//    used a bare setTimeout that no abort path could reach, because during
//    the delay the feature is neither processing nor waiting.
// 2. detectCurrentInputMode() falls back to the mode button's own label when
//    the `.font_body` descendant is absent, accepting only known text modes.
// 3. The turn-complete predicate must never be satisfied by a "see" action
//    alone (loop guard: Auto See's own output must not retrigger it).

const test = require('node:test');
const assert = require('node:assert/strict');
const AutoSeeFeature = require('../../features/auto_see_feature.js');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeFeature() {
  const feature = new AutoSeeFeature();
  feature.currentAdventureId = 'adv1';
  feature.triggerMode = 'everyTurn';
  return feature;
}

function completeTurn(feature) {
  feature.isWaitingForAIResponse = true;
  const operationId = ++feature.currentOperationId;
  feature.handleUserTurnComplete(operationId, 'adv1', {});
  return operationId;
}

test('pending See trigger fires after the delay when nothing intervenes', async () => {
  const feature = makeFeature();
  let calls = 0;
  feature.triggerSeeAction = () => { calls++; };

  completeTurn(feature);
  assert.ok(feature.triggerTimer, 'trigger should be pending during the delay');
  await delay(400);
  assert.equal(calls, 1);
  assert.equal(feature.triggerTimer, null);
});

test('abort during the trigger delay cancels the pending See', async () => {
  const feature = makeFeature();
  let calls = 0;
  feature.triggerSeeAction = () => { calls++; };

  completeTurn(feature);
  feature.abortCurrentOperation('User interaction: Command: erase');
  assert.equal(feature.triggerTimer, null, 'abort must clear the pending trigger');
  await delay(400);
  assert.equal(calls, 0, 'See must not fire after an abort');
});

test('destroy during the trigger delay cancels the pending See', async () => {
  const feature = makeFeature();
  let calls = 0;
  feature.triggerSeeAction = () => { calls++; };

  completeTurn(feature);
  feature.destroy();
  await delay(400);
  assert.equal(calls, 0, 'See must not fire after the feature is destroyed');
});

test('detectCurrentInputMode falls back to the button label for known text modes only', () => {
  const feature = makeFeature();
  const button = (text, fontBody) => ({
    textContent: text,
    querySelector: (selector) => (selector === '.font_body' && fontBody ? { textContent: fontBody } : null),
  });
  try {
    global.document = { querySelector: () => button('See', null) };
    assert.equal(feature.detectCurrentInputMode(), 'see');

    global.document = { querySelector: () => button('Do', null) };
    assert.equal(feature.detectCurrentInputMode(), 'do');

    global.document = { querySelector: () => button('Image', null) };
    assert.equal(feature.detectCurrentInputMode(), null, 'media labels are not text modes');

    global.document = { querySelector: () => button('ignored', 'Say') };
    assert.equal(feature.detectCurrentInputMode(), 'say', '.font_body remains the primary source');

    global.document = { querySelector: () => null };
    assert.equal(feature.detectCurrentInputMode(), null);
  } finally {
    delete global.document;
  }
});

test('turn-complete predicate ignores see-only updates but accepts new story actions', () => {
  const feature = makeFeature();
  const baseline = { tail: '5', tailNum: 5, liveCount: 1 };
  const live = (id, type) => ({ id, type, undoneAt: null, deletedAt: null });

  const seeOnly = {
    source: 'actions:change',
    changed: [live(6, 'see')],
    actions: [live(6, 'see')],
    tail: '5',
    liveCount: 1,
  };
  assert.equal(feature.isUserTurnComplete(seeOnly, baseline), false);

  const story = {
    source: 'actions:change',
    changed: [live(6, 'story')],
    actions: [live(6, 'story')],
    tail: '5',
    liveCount: 1,
  };
  assert.equal(feature.isUserTurnComplete(story, baseline), true);
});
