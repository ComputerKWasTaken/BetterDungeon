'use strict';

// Regression checks for Trigger Highlight after AI Dungeon's editor and
// context-viewer changes:
// - The story card editor is now a Tailwind UI: the triggers field is an
//   <input aria-labelledby="scTriggersLabel"> and the name field is
//   <input aria-labelledby="scTitleLabel">. The old Tamagui anchors
//   (p.is_Paragraph label inside .is_Column) match nothing there, so
//   scanForTriggers() silently harvested no triggers from the editor.
// - highlightElement() used to re-scan its own inserted markup once per
//   trigger, so a shorter trigger could match inside a previous span's
//   data-card-name attribute and corrupt the HTML. It now replaces in a
//   single combined-regex pass.
// - isAdventureModal() now also accepts the current viewer's
//   "View Context" heading (it previously only knew "Adventure" /
//   "Complete Text" and required an h1 carrying an explicit
//   role="heading" attribute).

const test = require('node:test');
const assert = require('node:assert/strict');
const TriggerHighlightFeature = require('../../features/trigger_highlight_feature.js');

// ---------- Minimal fake DOM (compound selectors only) ----------

function matchCompound(el, compound) {
  const tokens = compound.match(/[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/g) || [];
  return tokens.every(token => {
    if (token.startsWith('.')) return el._classes.has(token.slice(1));
    if (token.startsWith('#')) return el.id === token.slice(1);
    if (token.startsWith('[')) {
      const m = token.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!m) return false;
      const v = el.getAttribute(m[1]);
      if (v === null) return false;
      return m[2] === undefined ? true : v === m[2];
    }
    return el.tagName === token.toUpperCase();
  });
}

function descendants(el) {
  const out = [];
  for (const child of el.children) out.push(child, ...descendants(child));
  return out;
}

function queryAll(root, selector) {
  const results = new Set();
  for (const group of selector.split(',')) {
    const part = group.trim();
    if (!part || /\s/.test(part)) continue; // tests only use compound selectors
    for (const cand of descendants(root)) {
      if (matchCompound(cand, part)) results.add(cand);
    }
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
    this.value = '';
  }
  get id() { return this._attrs.id || ''; }
  set id(v) { this._attrs.id = v; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; }
  setAttribute(n, v) { this._attrs[n] = String(v); }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  closest(sel) {
    let el = this;
    while (el) {
      if (sel.split(',').some(g => matchCompound(el, g.trim()))) return el;
      el = el.parentElement;
    }
    return null;
  }
}

function makeDocument(body) {
  const root = new FakeElement('root');
  root.appendChild(body);
  return {
    body,
    createElement: () => { throw new Error('createElement not used in these tests'); },
    getElementById: id => [root, ...descendants(root)].find(el => el.id === id) || null,
    querySelector: sel => queryAll(root, sel)[0] || null,
    querySelectorAll: sel => queryAll(root, sel),
  };
}

function el(tag, attrs = {}, text = '') {
  const e = new FakeElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => e._classes.add(c));
    else e.setAttribute(k, v);
  }
  if (text) e._text = text;
  return e;
}

// escapeHtml() in the feature round-trips through a real div; emulate the
// browser's textContent -> innerHTML escaping for the highlight tests.
function makeEscapeDocument() {
  return {
    createElement: () => {
      let t = '';
      return {
        set textContent(v) { t = String(v); },
        get textContent() { return t; },
        get innerHTML() {
          return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
      };
    },
  };
}

function withGlobals(globals, fn) {
  const saved = {};
  for (const k of Object.keys(globals)) { saved[k] = global[k]; global[k] = globals[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(globals)) {
      if (saved[k] === undefined) delete global[k]; else global[k] = saved[k];
    }
  }
}

// ---------- scanForTriggers: current editor ----------

test('scanForTriggers harvests triggers from the current Tailwind editor', () => {
  const recorded = [];
  const cache = { size: 0, setTrigger: (t, name) => recorded.push([t, name]) };

  const body = new FakeElement('body');
  const form = el('div');
  const titleWrap = el('div');
  titleWrap.appendChild(el('label', { id: 'scTitleLabel' }, 'Name'));
  const titleInput = el('input', { 'aria-labelledby': 'scTitleLabel' });
  titleInput.value = 'Larion';
  titleWrap.appendChild(titleInput);
  const trigWrap = el('div');
  trigWrap.appendChild(el('label', { id: 'scTriggersLabel' }, 'Triggers'));
  const trigInput = el('input', { 'aria-labelledby': 'scTriggersLabel' });
  trigInput.value = 'larion, kingdom';
  trigWrap.appendChild(trigInput);
  form.appendChild(titleWrap);
  form.appendChild(trigWrap);
  body.appendChild(form);

  withGlobals({ document: makeDocument(body), storyCardCache: cache }, () => {
    new TriggerHighlightFeature().scanForTriggers();
  });

  // Both the aria-labelledby sweep and the label-anchored sweep find the
  // field; setTrigger dedupes in the real cache, so just require the pairs.
  assert.ok(recorded.some(([t, n]) => t === 'larion' && n === 'Larion'), JSON.stringify(recorded));
  assert.ok(recorded.some(([t, n]) => t === 'kingdom' && n === 'Larion'), JSON.stringify(recorded));
});

test('scanForTriggers still harvests from the legacy Tamagui editor', () => {
  const recorded = [];
  const cache = { size: 0, setTrigger: (t, name) => recorded.push([t, name]) };

  const body = new FakeElement('body');
  const column = el('div', { class: 'is_Column' });
  column.appendChild(el('p', { class: 'is_Paragraph' }, 'TRIGGERS'));
  const input = el('input');
  input.value = 'dragon';
  column.appendChild(input);
  body.appendChild(column);

  withGlobals({ document: makeDocument(body), storyCardCache: cache }, () => {
    new TriggerHighlightFeature().scanForTriggers();
  });

  assert.ok(recorded.some(([t]) => t === 'dragon'), JSON.stringify(recorded));
});

// ---------- highlightElement: single-pass replacement ----------

function highlight(text, triggerMap) {
  const cache = { size: triggerMap.size, getTriggers: () => triggerMap, hasTrigger: t => triggerMap.has(t) };
  // A real element's innerHTML already holds its (escaped) text; the
  // feature only rewrites innerHTML when highlighting changed something.
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const element = { textContent: text, innerHTML: escaped };
  withGlobals({ document: makeEscapeDocument(), storyCardCache: cache }, () => {
    new TriggerHighlightFeature().highlightElement(element, new Map());
  });
  return element.innerHTML;
}

test('highlightElement does not match inside its own data-card-name attributes', () => {
  const triggers = new Map([['kingdom', 'Larion'], ['larion', 'Kingdom Card']]);
  const html = highlight('The kingdom of Larion endures.', triggers);
  assert.equal(
    html,
    'The <span class="bd-trigger-highlight" data-card-name="Larion">kingdom</span> of ' +
    '<span class="bd-trigger-highlight" data-card-name="Kingdom Card">Larion</span> endures.'
  );
});

test('highlightElement is case-insensitive with word boundaries', () => {
  const triggers = new Map([['king', 'The King']]);
  const html = highlight('King the king, kingdom stays.', triggers);
  assert.equal(
    html,
    '<span class="bd-trigger-highlight" data-card-name="The King">King</span> the ' +
    '<span class="bd-trigger-highlight" data-card-name="The King">king</span>, kingdom stays.'
  );
});

test('highlightElement does not match inside HTML entities', () => {
  const triggers = new Map([['amp', 'Amp Card']]);
  const html = highlight('Fish & Chips', triggers);
  assert.equal(html, 'Fish &amp; Chips');
});

// ---------- isAdventureModal ----------

test('isAdventureModal accepts the current "View Context" heading', () => {
  const feature = new TriggerHighlightFeature();
  const modal = {
    textContent: 'some viewer content',
    querySelector: sel => (sel.includes('h1') ? { textContent: 'View Context' } : null),
    querySelectorAll: () => [],
  };
  assert.equal(feature.isAdventureModal(modal), true);
});

test('isAdventureModal accepts the viewer signature text and rejects other dialogs', () => {
  const feature = new TriggerHighlightFeature();
  const viewer = {
    textContent: 'View Context — Context used for this action — 1200 / 4000 tokens',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  assert.equal(feature.isAdventureModal(viewer), true);

  const other = {
    textContent: 'Are you sure you want to delete this?',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  assert.equal(feature.isAdventureModal(other), false);
});
