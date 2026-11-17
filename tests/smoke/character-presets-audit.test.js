'use strict';

// Audit regression checks for Character Prefill beyond entry-field
// detection (the aria-label fix itself is covered by the PR #73 work):
//  - fallback input lookups must only bind to free-text fields, never to
//    radio/checkbox inputs a multiple-choice scenario-start step renders
//    inside the scenario-start container;
//  - advance-button matching must be word-boundary based ("Restart" and
//    "Get Started" are not advance buttons) and the post-fill click must
//    wait for the button to become clickable instead of firing blind;
//  - a panel dismissal must not silently disable the feature for a
//    different scenario reached by SPA navigation when the
//    scenario:start event never fires.

const test = require('node:test');
const assert = require('node:assert/strict');
const CharacterPresetFeature = require('../../features/character_preset_feature.js');

function fakeEl({ tag = 'INPUT', type = null, text = '', disabled = false, attrs = {} } = {}) {
  const allAttrs = { ...(type ? { type } : {}), ...attrs };
  return {
    tagName: tag,
    type: type || '',
    textContent: text,
    disabled,
    _attrs: allAttrs,
    clicks: 0,
    getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; },
    click() { this.clicks++; },
  };
}

function withGlobals(globals, fn) {
  const saved = {};
  for (const key of Object.keys(globals)) {
    saved[key] = global[key];
    global[key] = globals[key];
  }
  const restore = () => {
    for (const key of Object.keys(globals)) {
      if (saved[key] === undefined) delete global[key];
      else global[key] = saved[key];
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('isTextEntryElement only accepts free-text fields', () => {
  const feature = new CharacterPresetFeature();
  assert.equal(feature.isTextEntryElement(fakeEl({ tag: 'TEXTAREA' })), true);
  assert.equal(feature.isTextEntryElement(fakeEl({ type: 'search' })), true);
  assert.equal(feature.isTextEntryElement(fakeEl({ type: 'text' })), true);
  assert.equal(feature.isTextEntryElement(fakeEl({})), true);
  assert.equal(feature.isTextEntryElement(fakeEl({ type: 'radio' })), false);
  assert.equal(feature.isTextEntryElement(fakeEl({ type: 'checkbox' })), false);
  assert.equal(feature.isTextEntryElement(fakeEl({ type: 'hidden' })), false);
  assert.equal(feature.isTextEntryElement(fakeEl({ tag: 'DIV' })), false);
  assert.equal(feature.isTextEntryElement(null), false);
});

test('fallback input lookup skips radio/checkbox inputs in the scenario-start container', () => {
  const radio = fakeEl({ type: 'radio' });
  const checkbox = fakeEl({ type: 'checkbox' });
  const text = fakeEl({ type: 'search' });
  const editInput = fakeEl({ tag: 'TEXTAREA' });
  const rerollInput = fakeEl({ type: 'text' });
  editInput.closest = rerollInput.closest = selector => selector === '.bd-character-ai-panel' ? {} : null;
  const container = {
    querySelectorAll: () => [radio, checkbox, editInput, rerollInput, text],
  };
  const documentStub = {
    getElementById: () => null,
    querySelector: (selector) => {
      if (selector === '[aria-labelledby="scenario-start-prompt"]') return radio;
      if (selector === '[id$="scenario-start"]') return container;
      return null;
    },
  };
  return withGlobals({ document: documentStub }, () => {
    const feature = new CharacterPresetFeature();
    assert.equal(feature.findScenarioEntryInput(), text);
  });
});

test('Android keeps an open disclosure through a same-question remount and collapses for a new question', async () => {
  const feature = new CharacterPresetFeature();
  const first = { label: 'First question', input: {} };
  const replacement = { ...first, input: {} };
  const second = { label: 'Second question', input: {} };
  const makeAnchor = () => ({
    after(disclosure) { disclosure.previousElementSibling = this; },
  });
  const anchors = new Map([first, replacement, second].map(field => [field.input, makeAnchor()]));
  feature.findMobilePresetAnchor = input => anchors.get(input);
  feature.handleField = async field => {
    const disclosure = {
      open: false,
      remove() { this.previousElementSibling = null; },
    };
    field.mobileStep.disclosure = disclosure;
    field.mobileStep.status = feature.status;
    anchors.get(field.input).after(disclosure);
  };
  await withGlobals({
    document: { querySelectorAll: () => [] },
    window: { location: { pathname: '/scenario/AAA/play' } },
  }, async () => {
    await feature.checkMobileStep(first);
    const initialDisclosure = feature.mobileStep.disclosure;
    initialDisclosure.open = true;
    await feature.checkMobileStep(replacement);
    assert.equal(feature.mobileStep.disclosure, initialDisclosure);
    assert.equal(initialDisclosure.previousElementSibling, anchors.get(replacement.input));
    assert.equal(initialDisclosure.open, true);

    await feature.checkMobileStep(null);
    assert.equal(initialDisclosure.previousElementSibling, null);
    await feature.checkMobileStep(second);
    assert.equal(feature.mobileStep.disclosure.open, false);
    assert.notEqual(feature.mobileStep.disclosure, initialDisclosure);
  });
});

test('advance button text matching is word-boundary based', () => {
  const feature = new CharacterPresetFeature();
  for (const ok of ['Next', 'Start', 'Continue', 'Start Adventure', 'next', ' Continue ']) {
    assert.equal(feature.isAdvanceButtonText(ok), true, `expected advance: "${ok}"`);
  }
  for (const notOk of ['Back', 'Restart', 'Get Started', 'Back to Start', '', 'Save']) {
    assert.equal(feature.isAdvanceButtonText(notOk), false, `expected not advance: "${notOk}"`);
  }
});

test('advance candidates exclude back/restart buttons and keep document order', () => {
  const back = fakeEl({ tag: 'BUTTON', text: 'Back' });
  const restart = fakeEl({ tag: 'BUTTON', text: 'Restart' });
  const next = fakeEl({ tag: 'BUTTON', text: 'Next' });
  const root = { querySelectorAll: () => [back, restart, next] };
  const feature = new CharacterPresetFeature();
  feature.getFieldContainer = () => root;
  assert.deepEqual(feature.findAdvanceCandidates({}), [next]);
  assert.equal(feature.findAdvanceButton({}), next);
});

test('advance click ignores decorative glyphs and waits for Start to enable', async () => {
  const next = fakeEl({ tag: 'BUTTON', text: 'w_playStart', disabled: true });
  next.querySelector = selector => selector === '[aria-hidden="true"]' ? {} : null;
  next.cloneNode = () => {
    const copy = { textContent: 'w_playStart' };
    copy.querySelectorAll = () => [{ remove: () => { copy.textContent = 'Start'; } }];
    return copy;
  };
  const root = { querySelectorAll: () => [next] };
  const feature = new CharacterPresetFeature();
  feature.getFieldContainer = () => root;
  setTimeout(() => { next.disabled = false; }, 30);
  const clicked = await feature.clickAdvanceButtonWhenReady({}, { timeoutMs: 1000, intervalMs: 10 });
  assert.equal(clicked, true);
  assert.equal(next.clicks, 1);
});

test('advance click reports failure when the button never enables', async () => {
  const next = fakeEl({ tag: 'BUTTON', text: 'Next', disabled: true });
  const root = { querySelectorAll: () => [next] };
  const feature = new CharacterPresetFeature();
  feature.getFieldContainer = () => root;
  const clicked = await feature.clickAdvanceButtonWhenReady({}, { timeoutMs: 60, intervalMs: 10 });
  assert.equal(clicked, false);
  assert.equal(next.clicks, 0);
});

test('aria-disabled advance buttons count as not enabled', () => {
  const feature = new CharacterPresetFeature();
  const btn = fakeEl({ tag: 'BUTTON', text: 'Next', attrs: { 'aria-disabled': 'true' } });
  assert.equal(feature.isAdvanceButtonEnabled(btn), false);
  btn._attrs['aria-disabled'] = 'false';
  assert.equal(feature.isAdvanceButtonEnabled(btn), true);
});

test('dismissal clears when the route moves to a different scenario', async () => {
  const documentStub = {
    getElementById: () => null,
    querySelector: () => null,
  };
  await withGlobals({
    document: documentStub,
    window: { location: { pathname: '/scenario/BBB/play' } },
  }, async () => {
    const feature = new CharacterPresetFeature();
    feature.sessionDismissed = true;
    feature.dismissedRouteShortId = 'AAA';
    await feature.checkForEntryField();
    assert.equal(feature.sessionDismissed, false);
    assert.equal(feature.dismissedRouteShortId, null);
  });
});

test('dismissal holds on the same scenario route', async () => {
  const documentStub = {
    getElementById: () => null,
    querySelector: () => null,
  };
  await withGlobals({
    document: documentStub,
    window: { location: { pathname: '/scenario/AAA/play' } },
  }, async () => {
    const feature = new CharacterPresetFeature();
    feature.sessionDismissed = true;
    feature.dismissedRouteShortId = 'AAA';
    await feature.checkForEntryField();
    assert.equal(feature.sessionDismissed, true);
  });
});
