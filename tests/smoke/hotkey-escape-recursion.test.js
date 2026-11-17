'use strict';

// Regression test for the Escape stack overflow found live in PR #73:
// with the nested See menu open, pressing Escape recursed between the
// hotkey handler and AIDungeonService.closeModeMenu() until the call
// stack was exhausted and the menu never closed.
//
// The cycle: the handler (document, capture phase) sees Escape with the
// menu open and calls closeModeMenu(); closeModeMenu() dismisses the
// See/mobile menu by dispatching a synthetic bubbling Escape keydown on
// it; that event reaches the document handler BEFORE the native menu
// has processed it, so the menu still reads as open and the handler
// calls closeModeMenu() again — synchronously, one dispatchEvent deep
// per cycle.
//
// This harness reproduces that geometry with the REAL service and the
// REAL handler: the fake menu's dispatchEvent delivers the event
// straight to the captured document handler while the menu keeps
// reading as open, and delivery stops past a depth bound (a real stack
// is bounded the same way — past it, Chrome threw RangeError).

const test = require('node:test');
const assert = require('node:assert/strict');

// The service constructor reads window.DOMUtils; KeyboardEvent is a
// browser global Node lacks. Plain class instances accept the
// `bdSynthetic` expando the service tags its events with.
global.window = {};
global.KeyboardEvent = class KeyboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
  }
  preventDefault() {}
  stopPropagation() {}
};

const AIDungeonService = require('../../services/ai-dungeon-service.js');
global.AIDungeonService = AIDungeonService;
const HotkeyFeature = require('../../features/hotkey_feature.js');

function makeDocument() {
  const doc = {
    activeElement: null,
    keydownHandler: null,
    addEventListener(type, fn) { if (type === 'keydown') doc.keydownHandler = fn; },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return doc;
}

function userEscape() {
  return { key: 'Escape', preventDefault() {}, stopPropagation() {} };
}

test('Escape in the nested See menu closes it exactly once — no recursion', async () => {
  const doc = makeDocument();
  global.document = doc;
  try {
    const aid = new AIDungeonService();
    const feature = new HotkeyFeature();
    feature.aid = aid;
    let exitCalls = 0;
    feature.closeInputArea = () => { exitCalls++; };

    let closeCalls = 0;
    let dispatchCount = 0;
    let depth = 0;
    let overflowed = false;
    const seeMenu = {
      dispatchEvent(event) {
        dispatchCount++;
        depth++;
        if (depth > 100) { overflowed = true; return true; }
        try { doc.keydownHandler(event); } finally { depth--; }
        return true;
      },
    };
    // The menu reads as open for the whole close: natively, dismissal
    // only happens once the synthetic event finishes propagating.
    aid.getSeeActionMenu = () => seeMenu;
    aid.getInputModeMenu = () => ({});
    const realClose = aid.closeModeMenu.bind(aid);
    aid.closeModeMenu = () => { closeCalls++; return realClose(); };

    feature.setupKeyboardListener();
    await doc.keydownHandler(userEscape());

    assert.equal(overflowed, false, 'Escape handling recursed past the depth bound (the live stack overflow)');
    assert.equal(closeCalls, 1, 'closeModeMenu must run exactly once per Escape press');
    assert.equal(dispatchCount, 1, 'exactly one synthetic Escape should be dispatched');
    assert.equal(exitCalls, 0, 'Escape with a menu open must not fall through to Exit Input');
  } finally {
    delete global.document;
  }
});

test('an untagged synthetic Escape re-entering mid-close is swallowed by the guard', async () => {
  const doc = makeDocument();
  global.document = doc;
  try {
    const feature = new HotkeyFeature();
    let closeCalls = 0;
    let depth = 0;
    let overflowed = false;
    // A close path that re-enters the handler with an UNTAGGED Escape
    // (e.g. another feature's own synthetic dispatch) while the menu
    // still reads as open. Only the handler's re-entrancy guard can
    // break this cycle.
    feature.aid = {
      isModeMenuOpen: () => true,
      closeModeMenu() {
        closeCalls++;
        depth++;
        if (depth > 100) { overflowed = true; return; }
        try { doc.keydownHandler(userEscape()); } finally { depth--; }
      },
    };

    feature.setupKeyboardListener();
    await doc.keydownHandler(userEscape());

    assert.equal(overflowed, false, 'untagged re-entrant Escape recursed past the depth bound');
    assert.equal(closeCalls, 1, 'the nested Escape belongs to the same close gesture and must not close again');
  } finally {
    delete global.document;
  }
});

test('Escape with no menu open still falls through to Exit Input', async () => {
  const doc = makeDocument();
  global.document = doc;
  try {
    const feature = new HotkeyFeature();
    feature.aid = {
      isModeMenuOpen: () => false,
      closeModeMenu() { throw new Error('closeModeMenu must not run when no menu is open'); },
    };
    let exitCalls = 0;
    feature.closeInputArea = () => { exitCalls++; };
    feature.buildHotkeyMap();

    feature.setupKeyboardListener();
    await doc.keydownHandler(userEscape());

    assert.equal(exitCalls, 1, 'Escape bound to Exit Input must still fire when no menu is open');
  } finally {
    delete global.document;
  }
});
