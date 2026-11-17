'use strict';

// Focused regression checks for Navigator's settings-tab mounting gates.
// The tab vanished when AI Dungeon renamed the "Models" section subtab to
// "AI Models": findModelsTab() required the exact label "models", and the
// settings surface was only found via one generated element id. These checks
// pin the resilient discovery: either models label, a missing-models
// fallback anchor, flat or wrapped tab structures, and surface/tablist
// discovery without the legacy id. Fake DOM is intentionally minimal — only
// the primitives the discovery methods use.

const test = require('node:test');
const assert = require('node:assert/strict');
const NavigatorFeature = require('../../features/navigator_feature.js');

class FakeClassList {
  constructor(el) { this.el = el; }
  add(...names) { names.forEach(name => this.el._classes.add(name)); }
  remove(...names) { names.forEach(name => this.el._classes.delete(name)); }
  contains(name) { return this.el._classes.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.el._classes.has(name) : !!force;
    if (next) this.el._classes.add(name); else this.el._classes.delete(name);
    return next;
  }
}

function matchCompound(el, compound) {
  const tokens = compound.match(/[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/g) || [];
  return tokens.every(token => {
    if (token.startsWith('.')) return el._classes.has(token.slice(1));
    if (token.startsWith('#')) return el.id === token.slice(1);
    if (token.startsWith('[')) {
      const match = token.match(/^\[([\w-]+)(?:="([^"]*)"\s*(i)?)?\]$/);
      if (!match) return false;
      const value = el.getAttribute(match[1]);
      if (value === null) return false;
      if (match[2] === undefined) return true;
      return match[3] ? value.toLowerCase() === match[2].toLowerCase() : value === match[2];
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
    const parts = group.trim().split(/\s+/).filter(Boolean);
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
    this.hidden = false;
    this.style = {};
    this.classList = new FakeClassList(this);
  }
  get id() { return this._attrs.id || ''; }
  set id(value) { this._attrs.id = value; }
  get className() { return [...this._classes].join(' '); }
  set className(value) { this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  removeAttribute(name) { delete this._attrs[name]; }
  appendChild(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
  insertBefore(node, ref) {
    node.remove();
    node.parentElement = this;
    const index = ref ? this.children.indexOf(ref) : -1;
    if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
    return node;
  }
  remove() {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    parent.children = parent.children.filter(child => child !== this);
    this.parentElement = null;
  }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { top: 0, bottom: 600, left: 0, right: 400 }; }
  matches(selector) { return matchCompound(this, selector.trim()); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return queryAll(this, selector); }
  cloneNode(deep) {
    const copy = new FakeElement(this.tagName.toLowerCase());
    copy._attrs = { ...this._attrs };
    copy._classes = new Set(this._classes);
    copy._text = this._text;
    if (deep) {
      for (const child of this.children) {
        const childCopy = child.cloneNode(true);
        childCopy.parentElement = copy;
        copy.children.push(childCopy);
      }
    }
    return copy;
  }
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
  };
  return { doc, body };
}

function makeTab(label, { selected = false } = {}) {
  const tab = new FakeElement('div');
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-label', `${selected ? 'Selected tab' : 'Tab'} ${label}`);
  if (selected) tab.setAttribute('aria-selected', 'true');
  const icon = new FakeElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'w_icon';
  const text = new FakeElement('span');
  text.textContent = label;
  tab.appendChild(icon);
  tab.appendChild(text);
  return tab;
}

function makeTablist(labels, { wrapped = true, ariaLabel = 'Section Tabs' } = {}) {
  const tablist = new FakeElement('div');
  tablist.setAttribute('role', 'tablist');
  if (ariaLabel) tablist.setAttribute('aria-label', ariaLabel);
  const tabs = labels.map((label, index) => {
    const tab = makeTab(label, { selected: index === 0 });
    if (wrapped) {
      const wrapper = new FakeElement('div');
      wrapper.appendChild(tab);
      tablist.appendChild(wrapper);
    } else {
      tablist.appendChild(tab);
    }
    return tab;
  });
  return { tablist, tabs };
}

test('models tab is found under both its historical and current labels', () => {
  const feature = new NavigatorFeature();
  for (const label of ['Models', 'AI Models']) {
    const { tablist, tabs } = makeTablist(['Gameplay', label, 'Safety']);
    assert.equal(feature.getTabLabel(tabs[1]), label.toLowerCase());
    assert.equal(feature.findModelsTab(tablist), tabs[1], `expected to find "${label}" tab`);
    assert.equal(feature.findSectionTab(tablist), tabs[1]);
  }
});

test('section anchor falls back to the first native tab when no models tab exists', () => {
  const feature = new NavigatorFeature();
  const { tablist, tabs } = makeTablist(['Safety', 'Appearance']);
  assert.equal(feature.findModelsTab(tablist), null);
  assert.equal(feature.findSectionTab(tablist), tabs[0]);
});

test('surface and tablist are discovered without the legacy surface id or tablist label', () => {
  const { doc, body } = makeDocument();
  global.document = doc;
  try {
    const panel = new FakeElement('div');
    panel.setAttribute('role', 'tabpanel');
    const nav = new FakeElement('div');
    const { tablist } = makeTablist(['AI Models', 'Safety'], { ariaLabel: 'Tabs' });
    nav.appendChild(tablist);
    panel.appendChild(nav);
    body.appendChild(panel);

    const feature = new NavigatorFeature();
    assert.equal(feature.getGameplaySettingsSurface(), panel);
    assert.equal(feature.getSectionTablist(panel), tablist);
    assert.equal(feature.findSectionTablist(), tablist);
  } finally {
    delete global.document;
  }
});

test('syncSettingsIntegration mounts the tab and content panel on the AI Models layout', () => {
  const { doc, body } = makeDocument();
  global.document = doc;
  global.window = { BetterDungeonPlatform: { has: capability => capability === 'touchControls' } };
  try {
    // Settings surface with no legacy id: tabpanel > content > [nav > tablist, native content]
    const panel = new FakeElement('div');
    panel.setAttribute('role', 'tabpanel');
    const content = new FakeElement('div');
    const nav = new FakeElement('div');
    const { tablist } = makeTablist(['AI Models', 'Safety'], { ariaLabel: 'Tabs' });
    nav.appendChild(tablist);
    const nativeContent = new FakeElement('div');
    content.appendChild(nav);
    content.appendChild(nativeContent);
    panel.appendChild(content);
    body.appendChild(panel);

    const feature = new NavigatorFeature();
    feature.drawer = new FakeElement('aside');
    body.appendChild(feature.drawer);

    assert.equal(feature.syncSettingsIntegration(), true);
    assert.ok(feature.settingsTab, 'Navigator settings tab should be mounted');
    assert.equal(feature.settingsTab.getAttribute('aria-label'), 'Tab navigator');
    assert.ok(feature.settingsContentPanel, 'Navigator content panel should be mounted');
    assert.equal(feature.settingsContentPanel.parentElement, content);
    assert.equal(feature.settingsSurface, panel);
    assert.equal(feature.drawer.hidden, true, 'drawer stays parked until the tab is activated');

    assert.equal(feature.activateSettingsNavigator(), true);
    assert.equal(feature.drawer.parentElement, feature.settingsContentPanel);
    assert.equal(feature.drawer.hidden, false);
    assert.ok(nativeContent.classList.contains('bd-navigator-settings-native-hidden'));
  } finally {
    delete global.document;
    delete global.window;
  }
});

test('normalizeTabLabel strips ligature markers and collapses punctuation', () => {
  const normalize = NavigatorFeature.normalizeTabLabel;
  assert.equal(normalize('w_aimodels'), 'aimodels');
  assert.equal(normalize('w_aimodels AI Models'), 'aimodels ai models');
  assert.equal(normalize('AI Models'), 'ai models');
  assert.equal(normalize('Models'), 'models');
  assert.equal(normalize('Testing & Feedback'), 'testing feedback');
  assert.equal(normalize('w_safety'), 'safety');
  assert.equal(normalize(''), '');
  assert.equal(normalize(null), '');
});

test('models tab is found when its label is a raw icon ligature', () => {
  const feature = new NavigatorFeature();
  // Live layout (owner's logged-in test, 2026-11-17): the settings tabs
  // expose raw Tamagui ligature labels like "w_aimodels" instead of the
  // clean "AI Models" text the bundle evidence suggested.
  for (const label of ['w_aimodels', 'w_aimodels AI Models']) {
    const { tablist, tabs } = makeTablist(['w_narration', label, 'w_display']);
    assert.equal(feature.findModelsTab(tablist), tabs[1], `expected models tab for label "${label}"`);
    assert.equal(feature.findSectionTab(tablist), tabs[1]);
    assert.equal(feature.isSectionTablist(tablist), true);
  }
});

test('section tablist is identified by ligature labels on non-models tabs', () => {
  const feature = new NavigatorFeature();
  const { tablist } = makeTablist(['w_safety', 'w_memorysystem']);
  assert.equal(feature.isSectionTablist(tablist), true);
});

test('adventure section tablist is not mistaken for the gameplay one', () => {
  const feature = new NavigatorFeature();
  const { tablist } = makeTablist(['Plot', 'Story Cards', 'Details', 'Scripts']);
  assert.equal(feature.isSectionTablist(tablist), false);
  assert.equal(feature.findModelsTab(tablist), null);
});

test('a ligature-contaminated models tab outranks a merely similar label', () => {
  const feature = new NavigatorFeature();
  const { tablist, tabs } = makeTablist(['Model Settings', 'w_aimodels AI Models']);
  assert.equal(feature.findModelsTab(tablist), tabs[1]);
});

test('syncSettingsIntegration mounts on the live ligature-labelled layout', () => {
  const { doc, body } = makeDocument();
  global.document = doc;
  global.window = { BetterDungeonPlatform: { has: capability => capability === 'touchControls' } };
  try {
    const panel = new FakeElement('div');
    panel.setAttribute('role', 'tabpanel');
    const content = new FakeElement('div');
    const nav = new FakeElement('div');
    const { tablist } = makeTablist(['w_aimodels', 'w_narration', 'w_display'], { ariaLabel: 'Tabs' });
    nav.appendChild(tablist);
    const nativeContent = new FakeElement('div');
    content.appendChild(nav);
    content.appendChild(nativeContent);
    panel.appendChild(content);
    body.appendChild(panel);

    const feature = new NavigatorFeature();
    feature.drawer = new FakeElement('aside');
    body.appendChild(feature.drawer);

    assert.equal(feature.syncSettingsIntegration(), true);
    assert.ok(feature.settingsTab, 'Navigator settings tab should mount on ligature labels');
    assert.equal(feature.settingsTab.getAttribute('aria-label'), 'Tab navigator');
    assert.equal(feature.settingsSurface, panel);
  } finally {
    delete global.document;
    delete global.window;
  }
});

test('a failed sync warns once and names the tab labels actually seen', () => {
  const { doc, body } = makeDocument();
  global.document = doc;
  global.window = { BetterDungeonPlatform: { has: capability => capability === 'touchControls' } };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    // Only an Adventure section tablist exists: nothing may match, and
    // the failure must say what was seen instead of staying silent.
    const panel = new FakeElement('div');
    panel.setAttribute('role', 'tabpanel');
    const { tablist } = makeTablist(['Plot', 'Story Cards', 'Details'], { ariaLabel: 'Tabs' });
    panel.appendChild(tablist);
    body.appendChild(panel);

    const feature = new NavigatorFeature();
    feature.drawer = new FakeElement('aside');
    body.appendChild(feature.drawer);

    assert.equal(feature.syncSettingsIntegration(), false);
    assert.equal(feature.syncSettingsIntegration(), false);
    assert.equal(warnings.length, 1, 'the unmatched-labels warning should fire once');
    assert.match(warnings[0], /tab labels seen:/);
    assert.match(warnings[0], /Plot/);
  } finally {
    console.warn = originalWarn;
    delete global.document;
    delete global.window;
  }
});

test('settings tab mounts before the anchor in wrapped and flat tab structures', () => {
  const feature = new NavigatorFeature();
  for (const wrapped of [true, false]) {
    const { tablist } = makeTablist(['AI Models', 'Safety'], { wrapped });
    const anchor = feature.findSectionTab(tablist);
    const tab = feature.createSettingsTab(tablist, anchor);
    assert.ok(tab, `createSettingsTab failed for wrapped=${wrapped}`);
    assert.equal(tab.getAttribute('aria-label'), 'Tab navigator');
    assert.ok(tab.classList.contains('bd-navigator-settings-tab'));
    const container = wrapped ? feature.settingsTabWrapper : tab;
    const anchorContainer = wrapped ? anchor.parentElement : anchor;
    const siblings = tablist.children;
    assert.equal(siblings[siblings.indexOf(container) + 1], anchorContainer,
      'Navigator tab should sit immediately before its anchor');
  }
});
