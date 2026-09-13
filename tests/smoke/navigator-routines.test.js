'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Routines = require('../../services/navigator/routines.js');
const copy = value => structuredClone(value);
const rule = (id = 'cards', interval = 5) => ({ id, name: id, instruction: 'Review the recent story.', interval, enabled: true });
const event = count => ({ source: 'live', type: 'create', actions: [{ id: String(count - 1) }], shortId: 'adventure' });

function storage(initial = {}) {
  const values = copy(initial);
  return {
    values,
    async get(_area, key) { return { [key]: copy(values[key]) }; },
    async set(_area, data) { Object.assign(values, copy(data)); }
  };
}

function locks() {
  const queues = new Map();
  return { request(name, { signal }, task) {
    const pending = (queues.get(name) || Promise.resolve()).then(() => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return task();
    });
    queues.set(name, pending.catch(() => {}));
    return pending;
  } };
}

function session(log, name, gate = null) {
  return {
    routineId: name === 'chat' ? null : name,
    messages: [],
    async load() {}, async refreshStoredConversation() {}, async persist() {},
    getMessages() { return this.messages; },
    async send(text, meta) {
      log.push(name);
      if (gate) await gate();
      this.messages.push({ role: 'user', content: text, ...meta }, { role: 'assistant', status: 'complete', content: 'Done.', ...meta });
    },
    abort() {}, abortMutation() {}, destroy() {}
  };
}

async function harness({ initialCount = 0, rules = [rule()], store, lockManager, android = false, gate = null, adventure = 'adventure' } = {}) {
  const log = [];
  store ||= storage({ [Routines.KEY]: { version: 1, templateCatalogVersion: 5, routines: rules } });
  const chat = session(log, 'chat');
  let serverCount = initialCount;
  const runner = new Routines(adventure, chat, {
    storage: store, locks: lockManager || locks(), android,
    readCount: async () => serverCount,
    makeSession: name => session(log, name, gate)
  });
  await runner.init();
  return { runner, store, log, chat, setCount: count => { serverCount = count; } };
}

async function idle(...runners) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (runners.every(runner => !runner.active && !runner.pending.size && !runner.manual.length)) return;
  }
  throw new Error('Runner did not become idle');
}

test('absolute milestones count completed creates, crossing over a milestone once; edits, hydration, and reload do not run', async () => {
  const h = await harness({ initialCount: 4 });
  await h.runner.observe({ ...event(5), source: 'hydrate' });
  await h.runner.observe({ ...event(5), type: 'update' });
  assert.deepEqual(h.log, []);
  await h.runner.observe(event(6));
  await h.runner.observe(event(6));
  await idle(h.runner);
  assert.deepEqual(h.log, ['cards']);
  assert.equal(h.runner.activity[0].milestone, 5);
  h.runner.destroy();
  const reopened = await harness({ initialCount: 20, store: h.store });
  await reopened.runner.observe(event(20));
  await idle(reopened.runner);
  assert.deepEqual(reopened.log, []);
  await reopened.runner.observe(event(25));
  await idle(reopened.runner);
  assert.deepEqual(reopened.log, ['cards']);
  reopened.runner.destroy();
});

test('a busy runner coalesces milestones and serves waiting manual chat before another Routine', async () => {
  let release;
  let first = true;
  const gate = () => first ? (first = false, new Promise(resolve => { release = resolve; })) : Promise.resolve();
  const h = await harness({ gate });
  await h.runner.observe(event(5));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await h.runner.observe(event(10));
  await h.runner.observe(event(15));
  assert.equal(h.runner.pending.size, 1);
  const manual = h.runner.enqueueManual(h.chat, 'My question');
  release();
  await manual;
  await idle(h.runner);
  assert.deepEqual(h.log, ['cards', 'chat', 'cards']);
  assert.deepEqual(h.runner.activity.map(item => item.milestone), [15, 5]);
  assert.equal(h.runner.manual.length, 0);
  h.runner.destroy();
});

test('duplicate tabs claim a milestone once; the same global rule runs independently in another adventure', async () => {
  const store = storage({ [Routines.KEY]: { version: 1, routines: [rule()] } });
  const lockManager = locks();
  const a = await harness({ store, lockManager });
  const b = await harness({ store, lockManager });
  await Promise.all([a.runner.observe(event(5)), b.runner.observe(event(5))]);
  await idle(a.runner, b.runner);
  assert.equal(a.log.length + b.log.length, 1);
  const c = await harness({ store, lockManager, adventure: 'another' });
  await c.runner.observe({ ...event(5), shortId: 'another' });
  await idle(c.runner);
  assert.deepEqual(c.log, ['cards']);
  [a, b, c].forEach(h => h.runner.destroy());
});

test('enabling at a milestone waits for the next; disabling drops queued work and lets the current run finish', async () => {
  let release;
  const h = await harness({ initialCount: 5, rules: [{ ...rule(), enabled: false }], gate: () => new Promise(resolve => { release = resolve; }) });
  await h.runner.saveRule(rule());
  await h.runner.observe(event(5));
  assert.deepEqual(h.log, []);
  await h.runner.observe(event(10));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await h.runner.observe(event(15));
  await h.runner.saveRule({ ...rule(), enabled: false });
  assert.equal(h.runner.pending.size, 0);
  assert.ok(h.runner.active);
  release();
  await idle(h.runner);
  assert.deepEqual(h.log, ['cards']);
  h.runner.destroy();
});

test('unavailable browser coordination prevents background calls while Android and manual chat retain access', async () => {
  const browser = await harness({ lockManager: {} });
  assert.match(browser.runner.error, /Web Locks/);
  await assert.rejects(browser.runner.observe(event(5)), /Web Locks/);
  await browser.runner.enqueueManual(browser.chat, 'Hello');
  assert.deepEqual(browser.log, ['chat']);
  const android = await harness({ lockManager: {}, android: true });
  await android.runner.observe(event(5));
  await idle(android.runner);
  assert.deepEqual(android.log, ['cards']);
  browser.runner.destroy(); android.runner.destroy();
});

test('imports validate all rules atomically and add disabled copies; exports contain only rule fields', async () => {
  const exported = Routines.exportRules([{ ...rule(), apiKey: 'secret', history: ['private'] }]);
  assert.doesNotMatch(exported, /secret|private|apiKey|history/);
  const imported = Routines.parseImport(exported);
  assert.equal(imported[0].enabled, false);
  assert.notEqual(imported[0].id, 'cards');
  assert.throws(() => Routines.parseImport('{broken'), /JSON/);
  assert.throws(() => Routines.parseImport(JSON.stringify({ version: 1, routines: [{ ...rule(), interval: 0 }] })), /interval/);
  assert.throws(() => Routines.parseImport(JSON.stringify({ version: 1, routines: [{ ...rule(), instruction: 'a'.repeat(7001) }] })), /7,000/);
  const h = await harness();
  await assert.rejects(h.runner.importRules(JSON.stringify({ version: 1, routines: [rule('good'), { ...rule('bad'), interval: 101 }] })));
  assert.equal(h.runner.rules.length, 1);
  await h.runner.importRules(exported);
  assert.equal(h.runner.rules.length, 2);
  assert.equal(h.runner.rules[1].enabled, false);
  h.runner.destroy();
});

test('the feature script entry bootstraps real platform storage before Routines, independently of early injection', async () => {
  const root = path.join(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const entry = manifest.content_scripts.find(entry => entry.js.includes('features/navigator_feature.js'));
  assert.equal(entry.world || 'ISOLATED', 'ISOLATED');
  assert.equal(entry.js[0], 'utils/platform.js');
  const values = {};
  const context = { console, AbortController, crypto: globalThis.crypto, TextEncoder,
    chrome: { runtime: {}, storage: { local: {
      get(key, callback) { callback({ [key]: values[key] }); },
      set(data, callback) { Object.assign(values, copy(data)); callback(); }
    } } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, entry.js[0]), 'utf8'), context);
  const platform = context.BetterDungeonPlatform;
  // Repeating the bootstrap must preserve the existing shared contract.
  vm.runInContext(fs.readFileSync(path.join(root, entry.js[0]), 'utf8'), context);
  assert.equal(context.BetterDungeonPlatform, platform);
  vm.runInContext(fs.readFileSync(path.join(root, 'services/navigator/routines.js'), 'utf8'), context);
  const runner = new context.NavigatorRoutines('adventure', session([], 'chat'));
  await runner.init();
  assert.equal(runner.error, '');
  assert.equal(runner.rules.length, 6);
  assert.deepEqual(Array.from(runner.rules, rule => [rule.name, rule.interval]), [
    ['NPC Brains', 5], ['Automatic Story Cards', 5], ['Story Arcs', 10], ['State Management', 5],
    ['Scene Compass', 10], ['Continuity Watch', 10]
  ]);
  assert.equal(values[Routines.KEY].routines.every(rule => !rule.enabled), true);
  runner.destroy();
});

test('a missing platform reports a recoverable startup error instead of preventing the Navigator UI', async () => {
  const runner = new Routines('adventure', session([], 'chat'));
  await runner.init();
  assert.match(runner.error, /Reload the BetterDungeon extension/);
  assert.equal(runner.armed, false);
  runner.destroy();
});

test('catalog migration replaces only pristine disabled examples and preserves edited or active rules', async () => {
  const old = Routines.legacyDefaults.map((template, index) => ({ id: `old-${index}`, name: template.name, interval: template.interval, instruction: template.instruction, enabled: false }));
  const pristineStore = storage({ [Routines.KEY]: { version: 1, templateCatalogVersion: 2, routines: old } });
  const pristine = await harness({ store: pristineStore });
  assert.deepEqual(pristine.runner.rules.slice(0, 4).map(rule => rule.name), ['NPC Brains', 'Automatic Story Cards', 'Story Arcs', 'State Management']);
  assert.deepEqual(pristine.runner.rules.slice(0, 4).map(rule => rule.id), ['old-2', 'old-0', 'old-1', 'old-3']);
  assert.equal(pristine.runner.rules.length, 6);
  assert.equal(pristine.runner.rules.every(rule => !rule.enabled), true);
  pristine.runner.destroy();
  const reopened = await harness({ store: pristineStore });
  assert.equal(reopened.runner.rules.length, 6);
  reopened.runner.destroy();

  const original = { ...rule('saved'), name: 'My saved rule', instruction: 'Keep my original instruction.' };
  const edited = { ...old[0], instruction: 'My changed instructions.', id: 'edited' };
  const active = { ...old[2], enabled: true, id: 'active' };
  const store = storage({ [Routines.KEY]: { version: 1, templateCatalogVersion: 2, routines: [original, edited, active] } });
  const first = await harness({ store });
  assert.deepEqual(first.runner.rules.slice(0, 4).map(item => item.name), ['NPC Brains', 'Automatic Story Cards', 'Story Arcs', 'State Management']);
  assert.equal(first.runner.rules.find(item => item.id === original.id).instruction, original.instruction);
  assert.equal(first.runner.rules.find(item => item.id === 'edited').instruction, edited.instruction);
  assert.equal(first.runner.rules.find(item => item.id === 'active').enabled, true);
  assert.equal(first.runner.rules.find(item => item.id === 'active').instruction, active.instruction);
  first.runner.destroy();
  const second = await harness({ store });
  assert.equal(second.runner.rules.length, 9);
  second.runner.destroy();

  const fullStore = storage({ [Routines.KEY]: { version: 1, templateCatalogVersion: 2, routines: Array.from({ length: 99 }, (_, index) => ({ ...rule(`saved-${index}`), enabled: false })) } });
  const full = await harness({ store: fullStore });
  assert.equal(full.runner.rules.length, 100);
  assert.equal(full.runner.rules[0].name, 'NPC Brains');
  full.runner.destroy();

  const current = Routines.templates().slice(0, 4);
  const currentIds = current.map(item => item.id);
  const v3Store = storage({ [Routines.KEY]: { version: 1, templateCatalogVersion: 3, routines: current } });
  const upgraded = await harness({ store: v3Store });
  assert.deepEqual(upgraded.runner.rules.map(item => item.name), Routines.templates().map(item => item.name));
  assert.deepEqual(upgraded.runner.rules.slice(0, 4).map(item => item.id), currentIds);
  upgraded.runner.destroy();
});

test('old manual-only rules become disabled scheduled rules and still run on explicit request', async () => {
  const manual = { id: 'self', name: 'Inner Self', instruction: 'Review the NPC.', mode: 'manual', command: 'inner-self', interval: null, enabled: true };
  const store = storage({ [Routines.KEY]: { version: 1, templateCatalogVersion: 4, routines: [manual] } });
  const h = await harness({ store });
  const migrated = h.runner.rules.find(item => item.id === 'self');
  assert.equal(migrated.interval, 5);
  assert.equal(migrated.enabled, false);
  assert.equal('mode' in migrated || 'command' in migrated, false);
  await h.runner.observe(event(100));
  await idle(h.runner);
  assert.deepEqual(h.log, []);
  assert.equal(h.runner.listForNavigator('inner').routines[0].id, 'self');
  assert.equal(h.runner.requestRun('Inner Self', 'extra guidance').status, 'queued');
  await idle(h.runner);
  assert.deepEqual(h.log, ['self']);
  assert.equal(h.runner.activity[0].kind, 'requested');
  assert.equal(h.runner.activity[0].milestone, null);
  assert.deepEqual(h.chat.getMessages(), []);
  assert.match((await h.runner.sessionFor('self')).getMessages()[0].content, /extra guidance/);
  const exported = h.runner.exportRules();
  assert.equal(JSON.parse(exported).routines.every(item => !('mode' in item) && !('command' in item)), true);
  await h.runner.importRules(exported);
  assert.equal(h.runner.rules.find(item => item.name === 'Inner Self' && item.id !== 'self').enabled, false);
  const imported = Routines.parseImport(JSON.stringify({ version: 1, routines: [manual] }));
  assert.equal(imported[0].interval, 5);
  assert.equal(imported[0].enabled, false);
  h.runner.destroy();
});

test('Navigator Routine proposals require approval and create disabled rules', async () => {
  const h = await harness();
  const definition = Routines.proposalDefinition();
  assert.equal(definition.name, 'propose_routine_create');
  const proposal = h.runner.makeProposal({ name: 'Relationship review', instruction: 'Review changes in relationships.', interval: 5 });
  assert.equal(proposal.status, 'pending');
  assert.equal(h.runner.rules.some(item => item.name === 'Relationship review'), false);
  await assert.rejects(h.runner.applyProposedRule(proposal), error => error.code === 'invalid_proposal');
  proposal.status = 'applying';
  await h.runner.applyProposedRule(proposal);
  const saved = h.runner.rules.find(item => item.name === 'Relationship review');
  assert.equal(saved.enabled, false);
  assert.equal(saved.interval, 5);
  assert.throws(() => h.runner.makeProposal({ name: 'Invalid', instruction: 'Review.', interval: 0 }), /interval/);
  h.runner.destroy();
});

test('Navigator stages a Routine tool call for approval even in Automatic mode', async () => {
  const h = await harness();
  const context = { console, setTimeout, clearTimeout, AbortController, crypto: globalThis.crypto,
    chrome: { runtime: { id: 'test' }, storage: { local: { get(_key, cb) { cb({}); }, set(_data, cb) { cb(); } }, onChanged: { addListener() {}, removeListener() {} } } } };
  context.window = context;
  context.NavigatorRoutines = Routines;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../services/navigator/session.js'), 'utf8'), context);
  const navigator = new context.NavigatorSession('adventure');
  navigator.routines = h.runner;
  navigator.tools = { definitions: () => [] };
  navigator.mutations = null;
  navigator.changeMode = 'automatic';
  assert.ok(navigator.getToolDefinitions().some(item => item.name === 'propose_routine_create'));
  const message = navigator.addMessage({ role: 'assistant', content: '' });
  const results = await navigator.executeToolCalls([{ id: 'call', name: 'propose_routine_create', arguments: {
    name: 'Memory review', instruction: 'Review significant changes to relationships.', interval: 5
  } }], new AbortController().signal, 8000, message.id, { index: {} });
  assert.equal(results.results[0].result.data.status, 'pending_approval');
  assert.equal(h.runner.rules.some(item => item.name === 'Memory review'), false);
  const proposal = navigator.findMessage(message.id).proposals[0];
  assert.equal(proposal.status, 'pending');
  assert.equal(await navigator.applyProposal(message.id, proposal.id), true);
  assert.equal(h.runner.rules.find(item => item.name === 'Memory review').enabled, false);
  navigator.destroy(); h.runner.destroy();
});

test('Navigator Chat queues a requested Routine after its reply without mixing histories', async () => {
  const h = await harness({ rules: [{ ...rule(), enabled: false }] });
  let release;
  const sendChat = h.chat.send.bind(h.chat);
  h.chat.send = async (...args) => { await new Promise(resolve => { release = resolve; }); await sendChat(...args); };
  const speaking = h.runner.enqueueManual(h.chat, 'Run cards now');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const context = { console, setTimeout, clearTimeout, AbortController, crypto: globalThis.crypto,
    chrome: { runtime: { id: 'test' }, storage: { local: { get(_key, cb) { cb({}); }, set(_data, cb) { cb(); } }, onChanged: { addListener() {}, removeListener() {} } } } };
  context.window = context;
  context.NavigatorRoutines = Routines;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../services/navigator/session.js'), 'utf8'), context);
  const navigator = new context.NavigatorSession('adventure');
  navigator.routines = h.runner;
  navigator.tools = { definitions: () => [] };
  navigator.changeMode = 'none';
  assert.deepEqual(navigator.getToolDefinitions().map(item => item.name), ['list_routines', 'run_routine']);
  const message = navigator.addMessage({ role: 'assistant', content: '' });
  const listed = await navigator.executeToolCalls([{ id: 'list', name: 'list_routines', arguments: { query: 'cards' } }], new AbortController().signal, 8000, message.id);
  assert.equal(listed.results[0].result.data.routines[0].id, 'cards');
  const queued = await navigator.executeToolCalls([{ id: 'run', name: 'run_routine', arguments: { routine: 'cards', guidance: 'Focus on places.' } }], new AbortController().signal, 8000, message.id);
  assert.equal(queued.results[0].result.data.status, 'queued');
  assert.deepEqual(h.log, []);
  const duplicate = await navigator.executeToolCalls([{ id: 'again', name: 'run_routine', arguments: { routine: 'cards' } }], new AbortController().signal, 8000, message.id);
  assert.equal(duplicate.results[0].result.data.status, 'already_queued');
  release();
  await speaking;
  await idle(h.runner);
  assert.deepEqual(h.log, ['chat', 'cards']);
  assert.equal(h.runner.activity[0].kind, 'requested');
  assert.match((await h.runner.sessionFor('cards')).getMessages()[0].content, /Focus on places/);
  const routineSession = new context.NavigatorSession('adventure', { routineId: 'cards' });
  routineSession.routines = h.runner;
  routineSession.tools = { definitions: () => [] };
  assert.equal(routineSession.getToolDefinitions().some(item => item.name === 'run_routine'), false);
  navigator.destroy(); routineSession.destroy(); h.runner.destroy();
});

test('an explicit request satisfies the same Routine’s pending automatic milestone', async () => {
  const h = await harness({ initialCount: 4 });
  let release;
  const sendChat = h.chat.send.bind(h.chat);
  h.chat.send = async (...args) => { await new Promise(resolve => { release = resolve; }); await sendChat(...args); };
  const speaking = h.runner.enqueueManual(h.chat, 'Run cards now');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await h.runner.observe(event(5));
  assert.equal(h.runner.pending.get('cards').milestone, 5);
  h.runner.requestRun('cards');
  release();
  await speaking;
  await idle(h.runner);
  assert.deepEqual(h.log, ['chat', 'cards']);
  assert.equal(h.runner.activity[0].kind, 'requested');
  assert.equal(h.store.values[h.runner.stateKey].fired.cards, 5);
  h.runner.destroy();
});

test('a waiting chat message takes priority over requested runs, which can be cancelled', async () => {
  const h = await harness();
  let release;
  const sendChat = h.chat.send.bind(h.chat);
  h.chat.send = async (...args) => { await new Promise(resolve => { release = resolve; }); await sendChat(...args); };
  const first = h.runner.enqueueManual(h.chat, 'First message');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  h.runner.requestRun('cards');
  const second = h.runner.enqueueManual(h.chat, 'Second message');
  assert.deepEqual(h.runner.manual.map(task => task.kind), ['manual', 'requested']);
  const cancelled = h.runner.cancelWaiting();
  assert.deepEqual(cancelled.map(task => task.kind), ['manual', 'requested']);
  release();
  await Promise.all([first, second]);
  await idle(h.runner);
  assert.deepEqual(h.log, ['chat']);
  h.runner.destroy();
});

test('a failed run is recorded once and waits for the next milestone rather than retrying', async () => {
  const h = await harness({ gate: async () => { throw new Error('Provider unavailable'); } });
  await h.runner.observe(event(5));
  await idle(h.runner);
  assert.equal(h.runner.activity[0].status, 'error');
  await h.runner.observe(event(5));
  await idle(h.runner);
  assert.deepEqual(h.log, ['cards']);
  await h.runner.observe(event(10));
  await idle(h.runner);
  assert.deepEqual(h.log, ['cards', 'cards']);
  h.runner.destroy();
});

test('Stop cancels work waiting for another tab without sending or claiming its milestone', async () => {
  const manager = locks();
  let release;
  const held = manager.request('betterdungeon:navigator:adventure', { signal: new AbortController().signal }, () => new Promise(resolve => { release = resolve; }));
  const h = await harness({ lockManager: manager });
  await h.runner.observe(event(5));
  assert.ok(h.runner.active);
  h.runner.stop();
  release();
  await held;
  await idle(h.runner);
  assert.deepEqual(h.log, []);
  assert.equal(h.store.values[h.runner.stateKey], undefined);
  await h.runner.observe(event(10));
  await idle(h.runner);
  assert.deepEqual(h.log, ['cards']);
  h.runner.destroy();
});

test('real Navigator sessions isolate rule histories and expire approvals on reload without overwriting manual chat', async () => {
  const values = {};
  const area = {
    get(keys, callback) {
      const requested = typeof keys === 'string' ? [keys] : keys;
      callback(Object.fromEntries(requested.map(key => [key, copy(values[key])])));
    },
    set(data, callback) { Object.assign(values, copy(data)); callback?.(); }
  };
  const context = { console, setTimeout, clearTimeout, AbortController, chrome: { runtime: { id: 'test' }, storage: { local: area, sync: area, onChanged: { addListener() {}, removeListener() {} } } } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../services/navigator/session.js'), 'utf8'), context);
  const Session = context.NavigatorSession;
  const chat = new Session('adventure');
  const routine = new Session('adventure', { routineId: 'cards' });
  await Promise.all([chat.load(), routine.load()]);
  chat.addMessage({ role: 'user', content: 'Only in chat' });
  routine.addMessage({ role: 'assistant', content: 'Only in cards', proposals: [{ id: 'proposal', status: 'pending', kind: 'story_card_delete', irreversible: true, changes: [] }] });
  await Promise.all([chat.persist(), routine.persist()]);
  assert.equal(chat.storageKey, 'betterDungeon_navigator_session_adventure');
  const restored = new Session('adventure', { routineId: 'cards' });
  await restored.load();
  assert.equal(restored.getMessages().length, 1);
  assert.equal(restored.getMessages()[0].proposals[0].status, 'expired');
  assert.equal(restored.getMessages()[0].proposals[0].restored, true);
  assert.equal(await restored.applyProposal(restored.getMessages()[0].id, 'proposal'), false);
  assert.equal(values[chat.storageKey].messages[0].content, 'Only in chat');
  // Stop must also work before provider readiness has finished, not just
  // after streaming starts. No provider call is needed for this check.
  let ready;
  restored.checkReady = () => new Promise(resolve => { ready = resolve; });
  const sending = restored.send('Cancel during connection check');
  restored.abort();
  ready({ ready: true });
  await sending;
  assert.equal(restored.getMessages().at(-1).status, 'aborted');
  assert.equal(restored.isBusy, false);
  [chat, routine, restored].forEach(s => s.destroy());
});
