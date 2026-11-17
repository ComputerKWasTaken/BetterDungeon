'use strict';

// Regression checks for Story Card Modal Dock's modal detection.
//
// The feature died silently when AI Dungeon rebuilt the story card editor
// as a Radix dialog: the old anchor, aria-label="Story Card Edit Modal",
// no longer exists anywhere in AID's current bundle (build
// yHuVepAanMcsrfh7owWDd). The editor's accessible title is now an sr-only
// DialogTitle reading "Edit story card" / "Create story card", exposed via
// aria-labelledby. These checks pin the layered detection (legacy label,
// labelledby title, sr-only heading), the Radix overlay backdrop lookup,
// and the close path that must never click the form's Save/Cancel buttons.

const test = require('node:test');
const assert = require('node:assert/strict');
const StoryCardModalDockFeature = require('../../features/story_card_modal_dock_feature.js');

class FakeClassList {
  constructor(el) { this.el = el; }
  add(...names) { names.forEach(name => this.el._classes.add(name)); }
  remove(...names) { names.forEach(name => this.el._classes.delete(name)); }
  contains(name) { return this.el._classes.has(name); }
}

function matchCompound(el, compound) {
  const tokens = compound.match(/[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/g) || [];
  return tokens.every(token => {
    if (token.startsWith('.')) return el._classes.has(token.slice(1));
    if (token.startsWith('#')) return el.id === token.slice(1);
    if (token.startsWith('[')) {
      const match = token.match(/^\[([\w-]+)(?:([*^$]?=)"([^"]*)"\s*(i)?)?\]$/);
      if (!match) return false;
      const value = el.getAttribute(match[1]);
      if (value === null) return false;
      if (match[3] === undefined) return true;
      if (match[2] === '*') return value.includes(match[3]);
      if (match[2] === '^') return value.startsWith(match[3]);
      if (match[2] === '$') return value.endsWith(match[3]);
      return match[4] ? value.toLowerCase() === match[3].toLowerCase() : value === match[3];
    }
    return el.tagName === token.toUpperCase();
  });
}

function descendants(el) {
  const out = [];
  for (const child of el.children) out.push(child, ...descendants(child));
  return out;
}

// Split a selector group on descendant combinators, respecting whitespace
// inside attribute brackets/quotes (e.g. [aria-label="Close Dialog"]).
function splitSelectorParts(group) {
  const parts = [];
  let depth = 0;
  let inQuote = false;
  let current = '';
  for (const ch of group.trim()) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote) {
      if (ch === '[') depth++;
      if (ch === ']') depth--;
      if (/\s/.test(ch) && depth === 0) {
        if (current) parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function queryAll(root, selector) {
  const results = new Set();
  for (const group of selector.split(',')) {
    const parts = splitSelectorParts(group);
    let current = [root];
    for (const part of parts) {
      const next = [];
      for (const base of current) {
        for (const candidate of descendants(base)) {
          if (matchCompound(candidate, part)) next.push(candidate);
        }
      }
      current = next;
    }
    current.forEach(el => results.add(el));
  }
  return [...results];
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this._attrs = {};
    this._classes = new Set();
    this._text = '';
    this.clicked = 0;
    this.dispatched = [];
    this.classList = new FakeClassList(this);
    this.style = {
      _props: {},
      getPropertyValue(prop) { return this._props[prop]?.value || ''; },
      getPropertyPriority(prop) { return this._props[prop]?.priority || ''; },
      setProperty(prop, value, priority) { this._props[prop] = { value, priority: priority || '' }; },
      removeProperty(prop) { delete this._props[prop]; }
    };
  }
  get id() { return this._attrs.id || ''; }
  set id(value) { this._attrs.id = value; }
  get className() { return [...this._classes].join(' '); }
  set className(value) { this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  hasAttribute(name) { return name in this._attrs; }
  appendChild(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
  remove() {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    parent.children = parent.children.filter(child => child !== this);
    this.parentElement = null;
  }
  contains(other) {
    let el = other;
    while (el) { if (el === this) return true; el = el.parentElement; }
    return false;
  }
  click() { this.clicked++; }
  dispatchEvent(event) { this.dispatched.push(event); return true; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return queryAll(this, selector); }
}

function makeDocument() {
  const root = new FakeElement('root');
  const body = new FakeElement('body');
  root.appendChild(body);
  const doc = {
    body,
    documentElement: body,
    createElement: tag => new FakeElement(tag),
    getElementById: id => [root, ...descendants(root)].find(el => el.id === id) || null,
    querySelector: selector => queryAll(root, selector)[0] || null,
    querySelectorAll: selector => queryAll(root, selector),
    dispatched: [],
    dispatchEvent(event) { this.dispatched.push(event); return true; }
  };
  return { doc, body };
}

function withDocument(fn) {
  const { doc, body } = makeDocument();
  global.document = doc;
  global.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
  try {
    fn(body, doc);
  } finally {
    delete global.document;
    delete global.KeyboardEvent;
  }
}

test('legacy aria-label modal is still detected', () => {
  withDocument((body) => {
    const modal = new FakeElement('div');
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-label', 'Story Card Edit Modal');
    body.appendChild(modal);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.findStoryCardModal(), modal);
  });
});

test('current Radix layout: dialog named via aria-labelledby to an sr-only title is detected', () => {
  withDocument((body) => {
    // Mirrors AID's current bundle: DialogContent role="dialog" with
    // aria-labelledby pointing at the sr-only DialogTitle element.
    const portal = new FakeElement('div');
    const title = new FakeElement('h2');
    title.id = 'radix-title-1';
    title.className = 'sr-only';
    title.textContent = 'Edit story card';
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 'radix-title-1');
    dialog.appendChild(title);
    const form = new FakeElement('div');
    form.textContent = 'form fields';
    dialog.appendChild(form);
    portal.appendChild(dialog);
    body.appendChild(portal);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.findStoryCardModal(), dialog);
  });
});

test('create variant: sr-only heading inside the dialog is detected without labelledby', () => {
  withDocument((body) => {
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    const title = new FakeElement('h2');
    title.className = 'sr-only';
    title.textContent = 'Create story card';
    dialog.appendChild(title);
    body.appendChild(dialog);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.findStoryCardModal(), dialog);
  });
});

test('unrelated dialogs are not mistaken for the story card editor', () => {
  withDocument((body) => {
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    const title = new FakeElement('h2');
    title.className = 'sr-only';
    title.textContent = 'Game Menu';
    dialog.appendChild(title);
    body.appendChild(dialog);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.findStoryCardModal(), null);
  });
});

test('pre-fix behaviour: a dialog with no legacy aria-label yields no modal from the old selector shape', () => {
  withDocument((body, doc) => {
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 't1');
    const title = new FakeElement('h2');
    title.id = 't1';
    title.textContent = 'Edit story card';
    dialog.appendChild(title);
    body.appendChild(dialog);

    // The old implementation's only query:
    assert.equal(doc.querySelector('[aria-label="Story Card Edit Modal"]'), null);
    // The fixed implementation finds it:
    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.findStoryCardModal(), dialog);
  });
});

test('backdrop: Radix overlay sibling (data-state + bg-black class) is found', () => {
  withDocument((body) => {
    const portal = new FakeElement('div');
    const overlay = new FakeElement('div');
    overlay.setAttribute('data-state', 'open');
    overlay.className = 'fixed inset-0 bg-black/80';
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    portal.appendChild(overlay);
    portal.appendChild(dialog);
    body.appendChild(portal);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.findBackdropForModal(dialog), overlay);
  });
});

test('backdrop: legacy Close Dialog element is found even when it is not a <button>', () => {
  withDocument((body) => {
    // Tamagui's Overlay renders with role="button", not as a button element.
    const wrap = new FakeElement('div');
    const backdrop = new FakeElement('div');
    backdrop.setAttribute('role', 'button');
    backdrop.setAttribute('aria-label', 'Close Dialog');
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    wrap.appendChild(backdrop);
    wrap.appendChild(dialog);
    body.appendChild(wrap);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.findBackdropForModal(dialog), backdrop);
  });
});

test('close path never clicks Save/Cancel and falls back to Escape on the modal', () => {
  withDocument((body) => {
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    const save = new FakeElement('button');
    save.textContent = 'Save';
    const cancel = new FakeElement('button');
    cancel.textContent = 'Cancel';
    dialog.appendChild(save);
    dialog.appendChild(cancel);
    body.appendChild(dialog);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.tryCloseModal(dialog), true);
    assert.equal(save.clicked, 0, 'Save must not be clicked to close');
    assert.equal(cancel.clicked, 0, 'Cancel must not be clicked to close (would discard edits)');
    assert.equal(dialog.dispatched.length, 1);
    assert.equal(dialog.dispatched[0].key, 'Escape');
  });
});

test('close path uses an explicit Close dialog control when present', () => {
  withDocument((body) => {
    const dialog = new FakeElement('div');
    dialog.setAttribute('role', 'dialog');
    const closeBtn = new FakeElement('button');
    closeBtn.setAttribute('aria-label', 'Close dialog');
    dialog.appendChild(closeBtn);
    body.appendChild(dialog);

    const feature = new StoryCardModalDockFeature();
    assert.equal(feature.tryCloseModal(dialog), true);
    assert.equal(closeBtn.clicked, 1);
    assert.equal(dialog.dispatched.length, 0);
  });
});
