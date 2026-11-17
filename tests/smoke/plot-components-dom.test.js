'use strict';

// Regression checks for AIDungeonService plot-component textarea detection,
// which Plot Presets (favoriteInstructions) depends on for save/apply.
//
// AI Dungeon's current UI renders plot components inside
// [data-slot="platform-column"] containers with platform-text titles and no
// guarantee of the historical placeholder text; the legacy Tamagui UI used
// .is_Column containers and [role="heading"] titles. The placeholder
// substrings the primary selectors target do not appear anywhere in the
// current play bundle, so the heading fallback is load-bearing — and it must
// never guess: an ancestor holding several textareas is ambiguous, and
// writing a preset into the wrong field is worse than failing to find one.
// Fake DOM is intentionally minimal — only the primitives the finders use.

const test = require('node:test');
const assert = require('node:assert/strict');
const AIDungeonService = require('../../services/ai-dungeon-service.js');

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
      const match = token.match(/^\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]$/);
      if (!match) return false;
      const value = el.getAttribute(match[1]);
      if (value === null) return false;
      if (match[3] === undefined) return true;
      if (match[2] === '*=') return value.includes(match[3]);
      if (match[2] === '^=') return value.startsWith(match[3]);
      if (match[2] === '$=') return value.endsWith(match[3]);
      return value === match[3];
    }
    return el.tagName === token.toUpperCase();
  });
}

function descendants(el) {
  const out = [];
  for (const child of el.children) out.push(child, ...descendants(child));
  return out;
}

// Split a selector on a delimiter that appears outside [] and quotes
// (attribute values such as "Plot Essentials" contain spaces/commas).
function splitSelector(input, delimiter) {
  const out = [];
  let depth = 0, quote = null, current = '';
  for (const ch of input) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (depth === 0 && (delimiter === ' ' ? /\s/.test(ch) : ch === delimiter)) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function queryAll(root, selector) {
  const results = new Set();
  for (const group of splitSelector(selector, ',')) {
    const parts = splitSelector(group, ' ');
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
    this.classList = new FakeClassList(this);
  }
  get id() { return this._attrs.id || ''; }
  set id(value) { this._attrs.id = value; }
  get className() { return [...this._classes].join(' '); }
  set className(value) { this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  matches(selector) { return splitSelector(selector, ',').some(group => matchCompound(this, group)); }
  closest(selector) {
    let el = this;
    while (el) {
      if (el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return queryAll(this, selector); }
}

function el(tag, { attrs = {}, classes = [], text = '' } = {}, children = []) {
  const node = new FakeElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.className = classes.join(' ');
  if (text) node.textContent = text;
  for (const child of children) node.appendChild(child);
  return node;
}

function makeDocument(bodyChildren) {
  const root = new FakeElement('root');
  const body = new FakeElement('body');
  root.appendChild(body);
  for (const child of bodyChildren) body.appendChild(child);
  return {
    body,
    querySelector: selector => queryAll(root, selector)[0] || null,
    querySelectorAll: selector => queryAll(root, selector),
  };
}

function withDom(bodyChildren, fn) {
  global.window = { DOMUtils: undefined };
  global.document = makeDocument(bodyChildren);
  try {
    return fn(new AIDungeonService());
  } finally {
    delete global.document;
    delete global.window;
  }
}

// A plot component in the current platform layout: per-component
// platform-column, title as platform-text (curly apostrophe), bare textarea.
function platformComponent(title, textareaAttrs = {}) {
  const textarea = el('textarea', { attrs: textareaAttrs });
  const column = el('div', { attrs: { 'data-slot': 'platform-column' } }, [
    el('span', { attrs: { 'data-slot': 'platform-text' }, text: title }),
    textarea,
  ]);
  return { column, textarea };
}

test('current platform layout: heading fallback finds each component textarea', () => {
  const note = platformComponent('Author\u2019s Note');
  const essentials = platformComponent('Plot Essentials');
  const panel = el('div', { attrs: { 'data-slot': 'platform-column' } }, [note.column, essentials.column]);
  withDom([panel], (svc) => {
    assert.equal(svc.findAuthorsNoteTextarea(), note.textarea);
    assert.equal(svc.findPlotEssentialsTextarea(), essentials.textarea);
    assert.equal(svc.findAIInstructionsTextarea(), null);
  });
});

test('legacy Tamagui layout: .is_Column + role=heading still detected', () => {
  const textarea = el('textarea');
  const column = el('div', { classes: ['is_Column'] }, [
    el('div', { classes: ['is_Row'] }, [el('h2', { attrs: { role: 'heading' }, text: 'AI Instructions' })]),
    el('div', { classes: ['is_Column'] }, [textarea]),
  ]);
  withDom([column], (svc) => {
    assert.equal(svc.findAIInstructionsTextarea(), textarea);
  });
});

test('placeholder tier still wins when the historical placeholder is present', () => {
  const textarea = el('textarea', { attrs: { placeholder: "Influence the AI's responses to your story" } });
  withDom([el('div', {}, [textarea])], (svc) => {
    assert.equal(svc.findAIInstructionsTextarea(), textarea);
  });
});

test('aria-label tier finds fields whose title moved to aria-label', () => {
  const textarea = el('textarea', { attrs: { 'aria-label': 'Plot Essentials' } });
  withDom([el('div', {}, [textarea])], (svc) => {
    assert.equal(svc.findPlotEssentialsTextarea(), textarea);
  });
});

test('ambiguous shared container: detection fails instead of returning the wrong field', () => {
  // Both components flat inside one panel column, no per-component wrapper.
  const aiTextarea = el('textarea');
  const peTextarea = el('textarea');
  const panel = el('div', { attrs: { 'data-slot': 'platform-column' } }, [
    el('h2', { attrs: { role: 'heading' }, text: 'AI Instructions' }),
    aiTextarea,
    el('h2', { attrs: { role: 'heading' }, text: 'Plot Essentials' }),
    peTextarea,
  ]);
  withDom([panel], (svc) => {
    // The old grandparent shortcut returned the FIRST textarea for both
    // headings — Plot Presets would have written essentials into the
    // instructions field. The hardened finder must return null here.
    assert.equal(svc.findPlotEssentialsTextarea(), null);
    assert.equal(svc.findAIInstructionsTextarea(), null);
  });
});

test('same-named label inside a button/tab is not mistaken for a component heading', () => {
  const button = el('button', {}, [el('span', { attrs: { 'data-slot': 'platform-text' }, text: 'Plot Essentials' })]);
  const real = platformComponent('Plot Essentials');
  withDom([button, real.column], (svc) => {
    assert.equal(svc.findPlotEssentialsTextarea(), real.textarea);
  });
});
