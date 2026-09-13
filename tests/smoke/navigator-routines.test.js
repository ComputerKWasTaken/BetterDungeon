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
  store ||= storage({ [Routines.KEY]: { version: 1, routines: rules } });
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
  assert.equal(runner.rules.length, 2);
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
