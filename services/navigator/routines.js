// Navigator Routines: local rules, milestone scheduling, and serialized work.
(function () {
  'use strict';
  if (globalThis.NavigatorRoutines) return;
  const KEY = 'betterDungeon_navigator_routines_v1';
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_ACTIVITY = 100;
  const id = () => globalThis.crypto.randomUUID();
  const templates = () => [
    { id: id(), name: 'Auto Cards', interval: 5, enabled: false,
      instruction: 'Review the recent story and existing Story Cards. Create or revise cards for significant characters, places, and durable facts established by the story. Search and read relevant existing cards first to avoid duplicates. Preserve useful existing details. Do not invent facts, delete cards, or change unrelated Plot Components. Make no change when nothing warrants one. Briefly report what you changed or why no change was needed.' },
    { id: id(), name: 'Story Arc', interval: 10, enabled: false,
      instruction: 'Review recent story progress and Plot Essentials. Maintain a concise, high-level story arc in a clearly labeled Story Arc section of Plot Essentials. Update the existing arc when warranted, or suggest a new direction when it has concluded. Treat future events as flexible possibilities, preserve player agency and all unrelated Plot Essentials, and avoid contradicting established facts. Do not delete cards or memories. Make no change when the current arc remains useful. Briefly report the result.' }
  ];

  function validateRule(raw, newId = false) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each Routine must be an object.');
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) throw new Error('Use a Routine name of 1–80 characters.');
    if (typeof raw.instruction !== 'string' || !raw.instruction.trim() || raw.instruction.length > 7000) throw new Error('Use instructions of 1–7,000 characters.');
    if (!Number.isInteger(raw.interval) || raw.interval < 1 || raw.interval > 100) throw new Error('Choose an interval from 1 to 100 actions.');
    if (typeof raw.enabled !== 'boolean') throw new Error('Routine enabled must be true or false.');
    if (!newId && (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id))) throw new Error('Invalid Routine ID.');
    return { id: newId ? id() : raw.id, name: raw.name.trim(), instruction: raw.instruction.trim(), interval: raw.interval, enabled: newId ? false : raw.enabled };
  }

  function parseImport(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Choose a Routine file smaller than 1 MB.');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
    if (data?.version !== 1 || !Array.isArray(data.routines) || data.routines.length > 100) throw new Error('Choose a version 1 Routine file containing at most 100 Routines.');
    return data.routines.map(raw => validateRule(raw, true));
  }

  function exportRules(rules) {
    // Deliberately enumerate fields: never export saved enabled state, sessions,
    // provider configuration, run metadata, or arbitrary imported properties.
    return JSON.stringify({ version: 1, routines: rules.map(raw => ({ ...validateRule(raw), enabled: false })) }, null, 2);
  }

  function milestone(previous, current, interval) {
    if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(current) || current <= previous) return null;
    return Math.floor(current / interval) > Math.floor(previous / interval)
      ? Math.floor(current / interval) * interval : null;
  }

  function actionCount(detail) {
    if (detail?.source === 'hydrate' || String(detail?.type).toLowerCase() !== 'create') return null;
    const actions = detail.actions;
    if (!Array.isArray(actions) || !actions.length) return undefined;
    const numbers = actions.map(action => /^\d+$/.test(String(action?.id)) ? Number(action.id) : NaN);
    if (numbers.some(value => !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER)) return undefined;
    return Math.max(...numbers) + 1;
  }

  class NavigatorRoutines {
    constructor(adventureId, chatSession, options = {}) {
      this.adventureId = adventureId;
      this.chatSession = chatSession;
      this.storage = options.storage || null;
      this.locks = options.locks ?? globalThis.navigator?.locks;
      this.android = options.android ?? globalThis.BetterDungeonPlatform?.kind === 'android-webview';
      this.makeSession = options.makeSession || (ruleId => new globalThis.NavigatorSession(adventureId, { routineId: ruleId }));
      this.readCount = options.readCount || (async signal => (await globalThis.BetterDungeonGQL.getNavigatorAdventureContext(adventureId, { signal })).actionCount);
      this.onChange = options.onChange || (() => {});
      this.rules = [];
      this.activity = [];
      this.sessions = new Map();
      this.pending = new Map();
      this.manual = [];
      this.active = null;
      this.count = null;
      this.observed = new Map();
      this.armed = false;
      this.destroyed = false;
      this.error = '';
      this.controller = new AbortController();
      this.stateKey = `betterDungeon_navigator_routine_state_${encodeURIComponent(adventureId)}`;
      this.lockName = `betterdungeon:navigator:${adventureId}`;
      this.eventQueue = Promise.resolve();
      this.boundAction = event => {
        const detail = event.detail;
        this.eventQueue = this.eventQueue.then(() => this.observe(detail)).catch(error => this.report(error));
      };
      this.boundStorage = (changes, area) => {
        if (area !== 'local' || this.destroyed) return;
        if (changes[KEY]) {
          this.eventQueue = this.eventQueue.then(() => this.reloadRules()).catch(error => this.report(error));
        }
        if (changes[this.stateKey]) this.changed();
      };
    }

    requireStorage() {
      const storage = this.storage || globalThis.BetterDungeonPlatform?.storage;
      if (!storage?.get || !storage?.set) {
        throw new Error('Routines could not initialize BetterDungeon storage. Reload the BetterDungeon extension, then refresh this adventure.');
      }
      return storage;
    }
    async get(key) { return (await this.requireStorage().get('local', key))?.[key]; }
    async set(key, value) { await this.requireStorage().set('local', { [key]: value }); }
    changed(notice = null) { if (!this.destroyed) this.onChange(notice); }
    report(error) { this.error = error?.message || 'Routines could not access local storage.'; this.changed(); }

    async locked(name, task, signal = this.controller.signal) {
      if (this.locks?.request) return this.locks.request(name, { signal }, task);
      if (this.android || name.endsWith(':rules')) return task();
      throw new Error('Routines need Web Locks to coordinate adventure tabs. Update your browser to enable them.');
    }

    async init() {
      // Initialization never enqueues a run, even on an existing milestone.
      try {
        await this.locked('betterdungeon:navigator:routines:rules', async () => {
          if (!(await this.get(KEY))) await this.set(KEY, { version: 1, routines: templates() });
        });
        await this.reloadRules(false);
        this.activity = (await this.get(this.stateKey))?.activity || [];
        if (this.destroyed) return;
        globalThis.document?.addEventListener('ultrascripts:actions:change', this.boundAction);
        globalThis.chrome?.storage?.onChanged?.addListener(this.boundStorage);
        await this.arm();
      } catch (error) { this.report(error); }
      this.changed();
    }

    async arm(ruleIds = null) {
      if (!this.rules.some(rule => rule.enabled) || this.destroyed) return;
      if (!this.locks?.request && !this.android) throw new Error('Routines need Web Locks to coordinate adventure tabs. Update your browser to enable them.');
      const count = await this.readCount(this.controller.signal);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Waiting for the adventure action count.');
      if (this.destroyed) return;
      this.count = Math.max(this.count ?? 0, count);
      for (const rule of this.rules) {
        if (rule.enabled && (!ruleIds || ruleIds.includes(rule.id))) this.observed.set(rule.id, count);
      }
      this.armed = true;
      this.error = '';
    }

    async reloadRules(rearm = true) {
      const data = await this.get(KEY);
      if (data?.version !== 1 || !Array.isArray(data.routines)) throw new Error('Saved Routines are invalid. Import a valid Routine file to add rules.');
      const next = data.routines.map(rule => validateRule(rule));
      if (new Set(next.map(rule => rule.id)).size !== next.length) throw new Error('Saved Routines contain duplicate IDs.');
      const changedSchedule = next.filter(rule => rule.enabled && !this.rules.some(old => old.id === rule.id && old.enabled && old.interval === rule.interval)).map(rule => rule.id);
      this.rules = next;
      for (const ruleId of this.pending.keys()) {
        if (changedSchedule.includes(ruleId) || !next.some(rule => rule.id === ruleId && rule.enabled)) this.pending.delete(ruleId);
      }
      for (const ruleId of this.observed.keys()) if (!next.some(rule => rule.id === ruleId && rule.enabled)) this.observed.delete(ruleId);
      if (!next.some(rule => rule.enabled)) this.armed = false;
      if (rearm && changedSchedule.length) await this.arm(changedSchedule);
      this.changed();
    }

    async editRules(transform) {
      await this.locked('betterdungeon:navigator:routines:rules', async () => {
        const data = await this.get(KEY);
        const next = transform((data?.routines || []).map(rule => validateRule(rule)));
        if (next.length > 100) throw new Error('Keep at most 100 Routines in this library.');
        if (new TextEncoder().encode(exportRules(next)).length > MAX_FILE_BYTES) throw new Error('The Routine library exceeds 1 MB. Remove unused rules before adding more.');
        await this.set(KEY, { version: 1, routines: next });
      });
      this.eventQueue = this.eventQueue.catch(() => {}).then(() => this.reloadRules());
      await this.eventQueue;
    }

    saveRule(rule) {
      const valid = validateRule(rule);
      return this.editRules(rules => rules.some(item => item.id === valid.id)
        ? rules.map(item => item.id === valid.id ? valid : item) : [...rules, valid]);
    }
    removeRule(ruleId) { return this.editRules(rules => rules.filter(rule => rule.id !== ruleId)); }
    async importRules(text) { const incoming = parseImport(text); await this.editRules(rules => [...rules, ...incoming]); }
    exportRules() { return exportRules(this.rules); }

    async observe(detail) {
      if (this.destroyed || !this.rules.some(rule => rule.enabled)) return;
      if (detail?.shortId && detail.shortId !== this.adventureId) return;
      let next = actionCount(detail);
      if (next === null) return;
      if (!this.armed) { await this.arm(); return; }
      if (next === undefined) next = await this.readCount(this.controller.signal);
      if (!Number.isSafeInteger(next) || this.destroyed) return;
      this.count = Math.max(this.count ?? 0, next);
      for (const rule of this.rules) {
        if (!rule.enabled) continue;
        const previous = this.observed.get(rule.id);
        this.observed.set(rule.id, Math.max(previous ?? next, next));
        const due = milestone(previous, next, rule.interval);
        if (due !== null) this.pending.set(rule.id, { ruleId: rule.id, milestone: due });
      }
      this.changed();
      void this.pump();
    }

    async sessionFor(ruleId) {
      if (!ruleId) return this.chatSession;
      if (!this.sessions.has(ruleId)) {
        const session = this.makeSession(ruleId);
        this.sessions.set(ruleId, session);
        session.loadPromise = session.load();
      }
      const session = this.sessions.get(ruleId);
      await session.loadPromise;
      return session;
    }

    enqueueManual(session, text, operation = null) {
      if (this.destroyed) return Promise.resolve();
      if (this.manual.length) return Promise.reject(new Error('A message is already waiting. Wait for it to run or cancel it first.'));
      return new Promise((resolve, reject) => {
        this.manual.push({ session, text, operation, resolve, reject, kind: 'manual' });
        this.changed();
        void this.pump();
      });
    }

    cancelWaiting() {
      const waiting = this.manual.splice(0);
      for (const item of waiting) item.resolve();
      this.changed();
      return waiting;
    }

    async updateRecord(record, state = null) {
      const stored = state || await this.get(this.stateKey) || {};
      const activity = [record, ...(stored.activity || []).filter(item => item.id !== record.id)].slice(0, MAX_ACTIVITY);
      await this.set(this.stateKey, { ...stored, version: 1, activity });
      this.activity = activity;
    }

    async readActivity() {
      const stored = await this.get(this.stateKey);
      this.activity = (stored?.activity || []).slice(0, MAX_ACTIVITY);
      const holders = this.locks?.query ? (await this.locks.query()).held.filter(lock => lock.name === this.lockName).map(lock => lock.clientId) : [];
      return this.activity.map(record => {
        // Records left running by a closed page are historical, never replayed.
        const live = this.active?.record?.id === record.id;
        if (!live && record.status === 'running' && !holders.includes(record.lockClientId)) return { ...record, status: 'interrupted' };
        if (record.status === 'approval' && !this.sessions.has(record.routineId)) return { ...record, status: 'expired' };
        const session = this.sessions.get(record.routineId);
        const proposals = session?.getMessages().filter(message => message.runId === record.id).flatMap(message => message.proposals || []) || [];
        if (record.status === 'approval' && proposals.length && !proposals.some(proposal => proposal.status === 'pending')) {
          return { ...record, status: proposals.some(proposal => proposal.status === 'expired') ? 'expired' : 'complete', pending: 0 };
        }
        return record;
      });
    }

    async pump() {
      if (this.active || this.destroyed) return;
      let task = this.manual.shift();
      if (!task) {
        const due = this.pending.values().next().value;
        if (!due) return;
        this.pending.delete(due.ruleId);
        task = { ...due, kind: 'routine' };
      }
      task.controller = new AbortController();
      this.active = task;
      this.changed();
      try {
        const execute = async () => {
          if (this.destroyed || task.controller.signal.aborted) return;
          const latestRules = (await this.get(KEY))?.routines || this.rules;
          const rule = latestRules.find(item => item.id === task.ruleId);
          if (task.kind === 'routine' && !rule?.enabled) return;
          let state = await this.get(this.stateKey) || {};
          if (task.kind === 'routine') {
            if ((state.fired?.[task.ruleId] ?? -1) >= task.milestone) return;
            state = { ...state, fired: { ...state.fired, [task.ruleId]: task.milestone }, actionCount: this.count };
          }
          task.session = task.session || await this.sessionFor(task.ruleId);
          await task.session.loadPromise;
          await task.session.refreshStoredConversation?.();
          if (task.controller.signal.aborted || this.destroyed) return;
          if (task.operation) {
            await task.operation();
            await task.session.persist();
            const stored = await this.get(this.stateKey) || {};
            for (const record of stored.activity || []) {
              const proposals = task.session.getMessages().filter(message => message.runId === record.id).flatMap(message => message.proposals || []);
              if (!proposals.length) continue;
              record.applied = proposals.filter(proposal => proposal.status === 'applied').length;
              record.pending = proposals.filter(proposal => proposal.status === 'pending').length;
              record.status = record.pending ? 'approval' : proposals.some(proposal => ['error', 'conflict'].includes(proposal.status)) ? 'error' : proposals.some(proposal => proposal.status === 'expired') ? 'expired' : 'complete';
            }
            if (stored.activity) await this.set(this.stateKey, stored);
            return;
          }
          const routineId = task.ruleId || task.session.routineId || null;
          const routine = rule || this.rules.find(item => item.id === routineId);
          const record = task.record = { id: id(), routineId, name: routine?.name || (routineId ? 'Routine follow-up' : 'Navigator chat'), kind: task.kind, milestone: task.milestone ?? null, startedAt: Date.now(), status: 'running' };
          if (this.locks?.query) record.lockClientId = (await this.locks.query()).held.find(lock => lock.name === this.lockName)?.clientId;
          if (routineId) await this.updateRecord(record, state);
          const start = task.session.getMessages().length;
          const text = task.kind === 'routine'
            ? `Run Routine "${rule.name}" at adventure action-count milestone ${task.milestone}. These are the current instructions and supersede older versions of this Routine:\n\n${rule.instruction}\n\nUse current adventure context. Earlier runs and follow-up guidance belong only to this Routine. Report applied changes, proposals awaiting approval, or that no change was needed.`
            : task.text;
          if (!task.controller.signal.aborted && !this.destroyed) await task.session.send(text, { routineId, runId: record.id, source: task.kind, routineName: record.name, milestone: record.milestone });
          await task.session.persist();
          const messages = task.session.getMessages().slice(start);
          const replies = messages.filter(message => message.role === 'assistant');
          const last = replies.at(-1);
          const proposals = messages.flatMap(message => message.proposals || []);
          const applied = proposals.filter(proposal => proposal.status === 'applied').length;
          const pending = proposals.filter(proposal => proposal.status === 'pending').length;
          const failed = proposals.some(proposal => ['error', 'conflict', 'expired'].includes(proposal.status));
          record.status = task.controller.signal.aborted ? 'stopped' : last?.status === 'error' || failed ? 'error' : pending ? 'approval' : last?.status === 'aborted' ? 'stopped' : 'complete';
          record.finishedAt = Date.now();
          record.applied = applied;
          record.pending = pending;
          record.summary = (last?.error?.message || last?.content || (record.status === 'stopped' ? 'Stopped.' : 'No response.')).slice(0, 500);
          if (routineId) await this.updateRecord(record);
          if (applied || pending || record.status === 'error') this.changed({ record });
        };
        // Manual chat keeps its existing availability on older browsers;
        // unattended runs require safe cross-tab coordination.
        if (task.kind === 'manual' && !this.locks?.request) await execute();
        else await this.locked(this.lockName, execute, task.controller.signal);
        task.resolve?.();
      } catch (error) {
        if (error?.name !== 'AbortError' && !this.destroyed) {
          this.report(error);
          if (task.record) {
            task.record.status = 'error';
            task.record.summary = 'The run was interrupted by a local error. Review the conversation before trying again.';
            await this.updateRecord(task.record).catch(() => {});
            this.changed({ record: task.record });
          }
        }
        task.reject?.(error);
      } finally {
        this.active = null;
        this.changed();
        if (!this.destroyed) void this.pump();
      }
    }

    stop() {
      const active = this.active;
      if (active?.ruleId) this.pending.delete(active.ruleId);
      active?.controller.abort();
      active?.session?.abort();
      active?.session?.abortMutation();
      this.changed();
    }

    destroy() {
      this.destroyed = true;
      this.controller.abort();
      this.stop();
      this.pending.clear();
      this.cancelWaiting();
      globalThis.document?.removeEventListener('ultrascripts:actions:change', this.boundAction);
      globalThis.chrome?.storage?.onChanged?.removeListener(this.boundStorage);
      for (const session of this.sessions.values()) session.destroy();
    }
  }
  Object.assign(NavigatorRoutines, { KEY, MAX_FILE_BYTES, templates, validateRule, parseImport, exportRules, milestone, actionCount, createId: id });
  globalThis.NavigatorRoutines = NavigatorRoutines;
  if (typeof module !== 'undefined') module.exports = NavigatorRoutines;
})();
