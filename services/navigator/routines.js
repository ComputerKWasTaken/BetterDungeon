// Navigator Routines: local rules, milestone scheduling, and serialized work.
(function () {
  'use strict';
  if (globalThis.NavigatorRoutines) return;
  const KEY = 'betterDungeon_navigator_routines_v1';
  const OVERRIDES_PREFIX = 'betterDungeon_navigator_routine_overrides_';
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_ACTIVITY = 100;
  const id = () => globalThis.crypto.randomUUID();
  const TEMPLATE_CATALOG_VERSION = 6;
  const DEFAULT_TEMPLATES = [
    { name: 'NPC Brains', interval: 5, instruction: [
      'Review recent story context and the Story Card directory. Select only significant recurring NPCs with meaningful new experiences; otherwise make no change.',
      'For each selected NPC, use search_story_cards and get_story_card to find and read any existing dedicated brain card and relevant character card before editing. Maintain one compact Story Card titled "NPC Brain — [name]" with Type "NPC Brain" and distinctive name or alias triggers. Revise an existing brain with propose_story_card_update; use propose_story_card_create only when the NPC has none. Avoid duplicate brains and broad triggers.',
      'In the Entry, distinguish established experiences and outward behavior from inferred private beliefs, feelings, motives, perceptions, and relationships. Ground inferences in observed events, let them evolve, and never present them as canon facts or force their revelation in prose.',
      'Preserve the NPC’s identity card and unrelated lore. Update only when the new context materially changes the brain; do not invent events, delete cards, or write to Plot Essentials. Briefly report what changed or why nothing did.'
    ].join(' ') },
    { name: 'Automatic Story Cards', interval: 5, instruction: [
      'Review recent story developments and the Story Card directory. Identify durable characters, places, objects, or lore worth retrieving later; do not create a card for every passing detail.',
      'Use search_story_cards and get_story_card to find and read relevant existing cards before proposing a change. When a card already covers the subject, revise it with propose_story_card_update and preserve its other fields; reserve propose_story_card_create for subjects no existing card covers. Give new cards specific triggers and an Entry grounded in established story facts.',
      'Leave dedicated NPC Brain cards, Story Arc, and Adventure State to their own Routines. Preserve unrelated card fields and do not delete cards or change Plot Essentials. Make no change when nothing durable or materially new appeared; briefly report the result.'
    ].join(' ') },
    { name: 'Story Arcs', interval: 10, instruction: [
      'Review recent story progress and all current Plot Essentials. Find any existing Story Arc section before editing.',
      'Use propose_plot_component_change to maintain one concise, forward-looking Story Arc section in Plot Essentials with roughly 3–5 flexible plot beats that give the story model a direction to pursue. Retire completed beats rather than recording them as history; revise or replace beats when player choices change the direction.',
      'Suggest possible developments without declaring them already true or forcing the player down a fixed path. Preserve unrelated Plot Essentials exactly, and leave Adventure State and Story Cards to their own Routines. Make no change if the current arc still fits; briefly report the result.'
    ].join(' ') },
    { name: 'State Management', interval: 5, instruction: [
      'Review recent story events and all current Plot Essentials, including any Adventure State section. Compare established changes with recorded states; do not recompute the whole adventure from guesswork.',
      'Use propose_plot_component_change to maintain one compact, clearly labeled Adventure State section in Plot Essentials for story-relevant location, inventory, injuries, resources, commitments, abilities, or other evidenced categories. Add a category only when play establishes its relevance. Use numeric values or calculations only when the player or story has defined their rules.',
      'Treat player-added or edited states as authoritative until an explicit story event changes them. Flag contradictions or uncertainty instead of silently overwriting a value. Preserve unrelated Plot Essentials exactly; do not modify Story Cards or Story Arc. Skip when no supported state transition occurred and briefly report the result.'
    ].join(' ') },
    { name: 'Scene Compass', interval: 10, instruction: [
      'Review the recent scene, player choices, and current Author’s Note. Decide whether a meaningful shift in tension, pace, or tone needs gentle guidance; do nothing when the scene is already working.',
      'Use propose_plot_component_change to maintain at most one short, clearly labeled Scene Compass line in Author’s Note. Suggest a present-scene storytelling emphasis, not a plot event or outcome. Respect the player’s explicit style and boundaries; preserve every unrelated part of Author’s Note exactly.',
      'Update or remove your line when it becomes stale. Avoid constant rewrites, railroading, repeating the Story Arc, or asserting facts not established by the story. Briefly report what changed or why no change was needed.'
    ].join(' ') },
    { name: 'Continuity Watch', interval: 10, instruction: [
      'Compare recent story evidence with existing Plot Essentials, Story Cards, and Story Summary. Look for a material, clearly demonstrable contradiction or stale fact that would mislead later play; do not treat ambiguity or a deliberate mystery as an error.',
      'Read a relevant Story Card with get_story_card before correcting it. If evidence is strong, make the smallest correction to an existing card or Plot Essentials with propose_story_card_update or propose_plot_component_change while preserving unrelated content. Do not create new lore, rewrite an entire scene, or delete anything.',
      'Auto Summarization may rewrite Story Summary, so report a summary-only issue rather than repeatedly fighting it unless the player specifically asks for a correction. If evidence is insufficient, report the concern without making a change; otherwise skip quietly. Briefly cite the story evidence for any correction.'
    ].join(' ') }
  ];
  const templates = () => DEFAULT_TEMPLATES.map(template => ({ id: id(), ...template, enabled: false }));

  // Exact pre-release prompts identify only untouched, disabled examples.
  // An edited or enabled rule is user data, even when it retains a default name.
  const LEGACY_DEFAULTS = Object.freeze([
    { name: 'Auto Cards', interval: 5, instruction: 'Review the recent story and existing Story Cards. Create or revise cards for significant characters, places, and durable facts established by the story. Search and read relevant existing cards first to avoid duplicates. Preserve useful existing details. Do not invent facts, delete cards, or change unrelated Plot Components. Make no change when nothing warrants one. Briefly report what you changed or why no change was needed.', replacement: 'Automatic Story Cards' },
    { name: 'Story Arc', interval: 10, instruction: 'Review recent story progress and Plot Essentials. Maintain a concise, high-level story arc in a clearly labeled Story Arc section of Plot Essentials. Update the existing arc when warranted, or suggest a new direction when it has concluded. Treat future events as flexible possibilities, preserve player agency and all unrelated Plot Essentials, and avoid contradicting established facts. Do not delete cards or memories. Make no change when the current arc remains useful. Briefly report the result.', replacement: 'Story Arcs' },
    { name: 'Inner Self', interval: 5, instruction: 'Review recent story context and existing Story Cards for significant NPCs. Maintain concise character-centered cards covering established memories, injuries, motives, beliefs, relationship changes, and unresolved plot threads. Let kindness, conflict, and repeated behavior change relationships gradually. Distinguish observations from interpretations; do not invent private thoughts as established facts. Search and read a relevant card before updating it; avoid duplicates and unrelated changes. Put useful durable guidance in the Entry with specific triggers, not a wall of hidden bookkeeping. Make no change when there is no meaningful development and briefly explain the result.', replacement: 'NPC Brains' },
    { name: 'Stateboy / TAS', interval: 5, instruction: 'Review the recent story and existing Plot Essentials and Story Cards. Track only concrete, story-relevant state that the adventure actually establishes: location, inventory, injuries, resources, commitments, abilities, and active constraints. Reconcile changes against prior recorded state, never guess numbers or treat speculation as fact. Maintain a compact clearly labeled state section in Plot Essentials, or a relevant card when the state belongs to a specific character or place. Preserve unrelated material and player agency. Make no change if there is no verified state transition; briefly report updates and uncertainty.', replacement: 'State Management' }
  ].map(template => Object.freeze(template)));

  // Exact prior-catalog prompts identify only untouched, disabled copies,
  // which migrate to the current template of the same name.
  const RETIRED_TEMPLATES = Object.freeze([
    { name: 'NPC Brains', interval: 5, replacement: 'NPC Brains', instruction: [
      'Review recent story context and the Story Card directory. Select only significant recurring NPCs with meaningful new experiences; otherwise make no change.',
      'For each selected NPC, find and read any existing dedicated brain card and relevant character card before editing. Maintain one compact Story Card titled "NPC Brain — [name]" with Type "NPC Brain" and distinctive name or alias triggers; avoid duplicate brains and broad triggers.',
      'In the Entry, distinguish established experiences and outward behavior from inferred private beliefs, feelings, motives, perceptions, and relationships. Ground inferences in observed events, let them evolve, and never present them as canon facts or force their revelation in prose.',
      'Preserve the NPC’s identity card and unrelated lore. Update only when the new context materially changes the brain; do not invent events, delete cards, or write to Plot Essentials. Briefly report what changed or why nothing did.'
    ].join(' ') },
    { name: 'Automatic Story Cards', interval: 5, replacement: 'Automatic Story Cards', instruction: [
      'Review recent story developments and the Story Card directory. Identify durable characters, places, objects, or lore worth retrieving later; do not create a card for every passing detail.',
      'Search for and read relevant existing cards before proposing a change. Update a matching card when possible; otherwise create a concise card with specific triggers and an Entry grounded in established story facts.',
      'Leave dedicated NPC Brain cards, Story Arc, and Adventure State to their own Routines. Preserve unrelated card fields and do not delete cards or change Plot Essentials. Make no change when nothing durable or materially new appeared; briefly report the result.'
    ].join(' ') },
    { name: 'Story Arcs', interval: 10, replacement: 'Story Arcs', instruction: [
      'Review recent story progress and all current Plot Essentials. Find any existing Story Arc section before editing.',
      'Maintain one concise, forward-looking Story Arc section with roughly 3–5 flexible plot beats that give the story model a direction to pursue. Retire completed beats rather than recording them as history; revise or replace beats when player choices change the direction.',
      'Suggest possible developments without declaring them already true or forcing the player down a fixed path. Preserve unrelated Plot Essentials exactly, and leave Adventure State and Story Cards to their own Routines. Make no change if the current arc still fits; briefly report the result.'
    ].join(' ') },
    { name: 'State Management', interval: 5, replacement: 'State Management', instruction: [
      'Review recent story events and all current Plot Essentials, including any Adventure State section. Compare established changes with recorded states; do not recompute the whole adventure from guesswork.',
      'Maintain one compact, clearly labeled Adventure State section for story-relevant location, inventory, injuries, resources, commitments, abilities, or other evidenced categories. Add a category only when play establishes its relevance. Use numeric values or calculations only when the player or story has defined their rules.',
      'Treat player-added or edited states as authoritative until an explicit story event changes them. Flag contradictions or uncertainty instead of silently overwriting a value. Preserve unrelated Plot Essentials exactly; do not modify Story Cards or Story Arc. Skip when no supported state transition occurred and briefly report the result.'
    ].join(' ') },
    { name: 'Scene Compass', interval: 10, replacement: 'Scene Compass', instruction: [
      'Review the recent scene, player choices, and current Author’s Note. Decide whether a meaningful shift in tension, pace, or tone needs gentle guidance; do nothing when the scene is already working.',
      'Maintain at most one short, clearly labeled Scene Compass line in Author’s Note. Suggest a present-scene storytelling emphasis, not a plot event or outcome. Respect the player’s explicit style and boundaries; preserve every unrelated part of Author’s Note exactly.',
      'Update or remove your line when it becomes stale. Avoid constant rewrites, railroading, repeating the Story Arc, or asserting facts not established by the story. Briefly report what changed or why no change was needed.'
    ].join(' ') },
    { name: 'Continuity Watch', interval: 10, replacement: 'Continuity Watch', instruction: [
      'Compare recent story evidence with existing Plot Essentials, Story Cards, and Story Summary. Look for a material, clearly demonstrable contradiction or stale fact that would mislead later play; do not treat ambiguity or a deliberate mystery as an error.',
      'Read a relevant Story Card before correcting it. If evidence is strong, make the smallest correction to an existing card or Plot Essentials while preserving unrelated content. Do not create new lore, rewrite an entire scene, or delete anything.',
      'Auto Summarization may rewrite Story Summary, so report a summary-only issue rather than repeatedly fighting it unless the player specifically asks for a correction. If evidence is insufficient, report the concern without making a change; otherwise skip quietly. Briefly cite the story evidence for any correction.'
    ].join(' ') }
  ].map(template => Object.freeze(template)));

  const LEGACY_RULES = Object.freeze([...LEGACY_DEFAULTS, ...RETIRED_TEMPLATES]);

  function upgradeTemplates(data) {
    const untouched = [];
    const replacements = new Map();
    for (const rule of data.routines) {
      const legacy = LEGACY_RULES.find(old => old.name === rule.name && old.interval === rule.interval && old.instruction === rule.instruction
        && rule.enabled === false && (rule.mode === undefined || rule.mode === 'scheduled') && (rule.command === undefined || rule.command === null));
      if (!legacy || replacements.has(legacy.replacement)) { untouched.push(rule); continue; }
      const current = DEFAULT_TEMPLATES.find(template => template.name === legacy.replacement);
      replacements.set(legacy.replacement, { ...rule, ...current, enabled: false });
    }
    const front = [];
    for (const template of templates()) {
      const replacement = replacements.get(template.name);
      if (replacement) front.push(replacement);
      else {
        const pristineIndex = untouched.findIndex(rule => rule.name === template.name && rule.interval === template.interval
          && rule.instruction === template.instruction && rule.enabled === false
          && (rule.mode === undefined || rule.mode === 'scheduled') && (rule.command === undefined || rule.command === null));
        if (pristineIndex !== -1) front.push(untouched.splice(pristineIndex, 1)[0]);
        else if (!untouched.some(rule => rule.name === template.name) && front.length + untouched.length < 100) front.push(template);
      }
    }
    return { ...data, templateCatalogVersion: TEMPLATE_CATALOG_VERSION, routines: [...front, ...untouched] };
  }

  function validateRule(raw, newId = false) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each Routine must be an object.');
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) throw new Error('Use a Routine name of 1–80 characters.');
    if (typeof raw.instruction !== 'string' || !raw.instruction.trim() || raw.instruction.length > 7000) throw new Error('Use instructions of 1–7,000 characters.');
    if (!Number.isInteger(raw.interval) || raw.interval < 1 || raw.interval > 100) throw new Error('Choose an interval from 1 to 100 actions.');
    if (typeof raw.enabled !== 'boolean') throw new Error('Routine enabled must be true or false.');
    if (!newId && (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id))) throw new Error('Invalid Routine ID.');
    return { id: newId ? id() : raw.id, name: raw.name.trim(), instruction: raw.instruction.trim(), interval: raw.interval, enabled: newId ? false : raw.enabled };
  }

  function migrateRule(raw) {
    // Former slash-only rules have no interval. Keep their content and history
    // identity, but never enable an automatic trigger during migration.
    return validateRule(raw?.mode === 'manual' ? { ...raw, interval: 5, enabled: false } : raw);
  }

  function parseImport(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Choose a Routine file smaller than 1 MB.');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
    if (data?.version !== 1 || !Array.isArray(data.routines) || data.routines.length > 100) throw new Error('Choose a version 1 Routine file containing at most 100 Routines.');
    return data.routines.map(raw => validateRule(raw?.mode === 'manual' ? { ...raw, interval: 5, enabled: false } : raw, true));
  }

  function exportRules(rules) {
    // Deliberately enumerate fields: never export saved enabled state, sessions,
    // provider configuration, run metadata, or arbitrary imported properties.
    return JSON.stringify({ version: 1, routines: rules.map(raw => ({ ...validateRule(raw), enabled: false })) }, null, 2);
  }

  function normalizeOverrideMap(value) {
    const map = {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [ruleId, enabled] of Object.entries(value)) {
        if (typeof enabled === 'boolean') map[ruleId] = enabled;
      }
    }
    return map;
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
      this.overridesKey = `${OVERRIDES_PREFIX}${encodeURIComponent(adventureId)}`;
      this.overrideMode = false;
      this.overrides = {};
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
        if (changes[this.overridesKey]) {
          this.eventQueue = this.eventQueue.then(() => this.reloadOverrides()).catch(error => this.report(error));
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
          const data = await this.get(KEY);
          if (!data) await this.set(KEY, { version: 1, templateCatalogVersion: TEMPLATE_CATALOG_VERSION, routines: templates() });
          else if (data.version === 1 && Array.isArray(data.routines) && (data.templateCatalogVersion || 1) < TEMPLATE_CATALOG_VERSION) {
            const upgraded = upgradeTemplates(data);
            await this.set(KEY, { ...upgraded, routines: upgraded.routines.map(migrateRule) });
          }
        });
        await this.loadOverrides();
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
      if (!this.rules.some(rule => this.isEnabled(rule)) || this.destroyed) return;
      if (!this.locks?.request && !this.android) throw new Error('Routines need Web Locks to coordinate adventure tabs. Update your browser to enable them.');
      const count = await this.readCount(this.controller.signal);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Waiting for the adventure action count.');
      if (this.destroyed) return;
      this.count = Math.max(this.count ?? 0, count);
      for (const rule of this.rules) {
        if (this.isEnabled(rule) && (!ruleIds || ruleIds.includes(rule.id))) this.observed.set(rule.id, count);
      }
      this.armed = true;
      this.error = '';
    }

    // The effective Enabled switch for this adventure: the shared rule flag,
    // or the adventure's own switch when it uses separate switches.
    isEnabled(rule) {
      return this.overrideMode ? (this.overrides[rule.id] ?? rule.enabled) : rule.enabled;
    }

    async loadOverrides() {
      const stored = await this.get(this.overridesKey);
      this.overrideMode = stored?.mode === 'adventure';
      this.overrides = normalizeOverrideMap(stored?.enabled);
    }

    snapshotEnabled() {
      return this.rules.map(rule => ({ id: rule.id, interval: rule.interval, on: this.isEnabled(rule) }));
    }

    // Reconcile queued work and baselines after rules or adventure switches
    // change. Returns the rules that became enabled (or changed interval while
    // enabled) and need a fresh milestone baseline.
    syncSchedule(before) {
      const prior = new Map(before.map(item => [item.id, item]));
      const enabled = new Set();
      const changedSchedule = [];
      for (const rule of this.rules) {
        if (!this.isEnabled(rule)) continue;
        enabled.add(rule.id);
        const old = prior.get(rule.id);
        if (!old?.on || old.interval !== rule.interval) changedSchedule.push(rule.id);
      }
      for (const ruleId of this.pending.keys()) {
        if (changedSchedule.includes(ruleId) || !enabled.has(ruleId)) this.pending.delete(ruleId);
      }
      for (const ruleId of this.observed.keys()) if (!enabled.has(ruleId)) this.observed.delete(ruleId);
      if (!enabled.size) this.armed = false;
      return changedSchedule;
    }

    async reschedule(before, rearm = true) {
      const changedSchedule = this.syncSchedule(before);
      if (rearm && changedSchedule.length) await this.arm(changedSchedule);
      this.changed();
    }

    async reloadRules(rearm = true) {
      const data = await this.get(KEY);
      if (data?.version !== 1 || !Array.isArray(data.routines)) throw new Error('Saved Routines are invalid. Import a valid Routine file to add rules.');
      const next = data.routines.map(rule => validateRule(rule));
      if (new Set(next.map(rule => rule.id)).size !== next.length) throw new Error('Saved Routines contain duplicate IDs.');
      const before = this.snapshotEnabled();
      this.rules = next;
      await this.reschedule(before, rearm);
    }

    async reloadOverrides(rearm = true) {
      const before = this.snapshotEnabled();
      await this.loadOverrides();
      await this.reschedule(before, rearm);
    }

    async updateOverrideMap(mode, edit = null) {
      await this.locked('betterdungeon:navigator:routines:rules', async () => {
        const stored = await this.get(this.overridesKey);
        const map = normalizeOverrideMap(stored?.enabled);
        const live = new Set(this.rules.map(rule => rule.id));
        for (const ruleId of Object.keys(map)) if (!live.has(ruleId)) delete map[ruleId];
        edit?.(map);
        await this.set(this.overridesKey, { version: 1, mode, enabled: map });
        await this.loadOverrides();
      });
    }

    // Switch this adventure between the shared Enabled switches and its own.
    // Switching to adventure switches snapshots the current shared states so a
    // later shared change does not leak in; switching back discards them.
    async setAdventureSwitches(use) {
      const before = this.snapshotEnabled();
      await this.updateOverrideMap(use ? 'adventure' : 'shared', use
        ? map => { for (const rule of this.rules) if (typeof map[rule.id] !== 'boolean') map[rule.id] = rule.enabled; }
        : map => { for (const ruleId of Object.keys(map)) delete map[ruleId]; });
      await this.reschedule(before);
    }

    // Toggle the Enabled switch for this adventure: the shared flag, or the
    // adventure's own switch while it uses separate switches.
    async setRuleEnabled(rule, enabled) {
      if (!this.overrideMode) return this.saveRule({ ...rule, enabled });
      const before = this.snapshotEnabled();
      await this.updateOverrideMap('adventure', map => { map[rule.id] = enabled === true; });
      await this.reschedule(before);
    }

    // Save Routine fields the way the current scope expects: shared mode edits
    // the shared rule including its Enabled switch; adventure mode edits the
    // shared fields only and stores Enabled as this adventure's own switch.
    async saveScopedRule(rule) {
      const valid = validateRule(rule);
      if (!this.overrideMode) return this.saveRule(valid);
      await this.editRules(rules => {
        const existing = rules.find(item => item.id === valid.id);
        const stored = { ...valid, enabled: existing ? existing.enabled : false };
        return existing ? rules.map(item => item.id === valid.id ? stored : item) : [...rules, stored];
      });
      await this.setRuleEnabled(valid, valid.enabled);
    }

    async editRules(transform) {
      await this.locked('betterdungeon:navigator:routines:rules', async () => {
        const data = await this.get(KEY);
        const next = transform((data?.routines || []).map(rule => validateRule(rule)));
        if (next.length > 100) throw new Error('Keep at most 100 Routines in this library.');
        if (new TextEncoder().encode(exportRules(next)).length > MAX_FILE_BYTES) throw new Error('The Routine library exceeds 1 MB. Remove unused rules before adding more.');
        await this.set(KEY, { version: 1, templateCatalogVersion: TEMPLATE_CATALOG_VERSION, routines: next });
      });
      this.eventQueue = this.eventQueue.catch(() => {}).then(() => this.reloadRules());
      await this.eventQueue;
    }

    saveRule(rule) {
      const valid = validateRule(rule);
      return this.editRules(rules => rules.some(item => item.id === valid.id)
        ? rules.map(item => item.id === valid.id ? valid : item) : [...rules, valid]);
    }
    static proposalDefinition() {
      return { name: 'propose_routine_create', description: 'Draft a new local BetterDungeon Routine for the player to review. It can run every 1–100 completed adventure actions when enabled, and the player can also ask Navigator to run it on demand. Approval creates it disabled; nothing runs automatically. Never use this tool without a player request for a reusable Routine.', parameters: { type: 'object', properties: {
        name: { type: 'string' }, instruction: { type: 'string' }, interval: { type: 'integer', minimum: 1, maximum: 100 }, reason: { type: 'string' }
      }, required: ['name', 'instruction', 'interval'], additionalProperties: false } };
    }
    static navigatorDefinitions() {
      return [
        { name: 'list_routines', description: 'List saved BetterDungeon Routines so you can identify one the player asked about or asked you to run. Includes disabled automatic Routines, which can still be run on request. Reports whether automatic switches are shared across adventures or set for this adventure.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Optional name search.' } }, additionalProperties: false } },
        { name: 'run_routine', description: 'Queue one saved Routine to run after this chat response. Use only when the player explicitly asks you to run that Routine; first identify it with list_routines if needed. An off automatic toggle does not block a requested run. This returns queued status, not the completed result; direct the player to Activity.', parameters: { type: 'object', properties: { routine: { type: 'string', description: 'Exact Routine ID or unambiguous name.' }, guidance: { type: 'string', description: 'Optional player guidance for this run.' } }, required: ['routine'], additionalProperties: false } }
      ];
    }
    makeProposal(args) {
      const rule = validateRule({ id: id(), name: args?.name, instruction: args?.instruction, interval: args?.interval, enabled: false });
      return { id: id(), kind: 'routine_create', action: 'create', status: 'pending', targetLabel: rule.name, reason: String(args?.reason || 'Create a reusable Routine for this device.').slice(0, 300), rule,
        changes: [{ label: 'Trigger', before: '', after: `Every ${rule.interval} actions in adventures where it is enabled` }, { label: 'Instructions', before: '', after: rule.instruction }, { label: 'Initial state', before: '', after: 'Disabled until you enable it' }] };
    }
    async applyProposedRule(proposal) {
      if (!proposal || proposal.kind !== 'routine_create' || proposal.restored || proposal.status !== 'applying') throw { code: 'invalid_proposal', message: 'This Routine proposal cannot be applied.' };
      await this.saveRule({ ...proposal.rule, enabled: false });
      return { appliedAtIso: new Date().toISOString(), targetLabel: proposal.rule.name };
    }
    listForNavigator(query = '') {
      const needle = String(query || '').trim().toLowerCase().slice(0, 80);
      const matches = this.rules.filter(rule => !needle || rule.name.toLowerCase().includes(needle));
      return { total: matches.length, switches: this.overrideMode ? 'adventure' : 'shared', routines: matches.slice(0, 20).map(rule => ({
        id: rule.id, name: rule.name, interval: rule.interval, automaticEnabled: this.isEnabled(rule),
        ...(this.overrideMode ? { sharedEnabled: rule.enabled } : {}),
        summary: rule.instruction.slice(0, 120)
      })) };
    }
    requestRun(identifier, guidance = '') {
      if (this.destroyed) throw new Error('Navigator is no longer open in this adventure.');
      if (!this.locks?.request && !this.android) throw new Error('Routines need Web Locks to coordinate adventure tabs. Update your browser to enable them.');
      const target = String(identifier || '').trim();
      const matches = this.rules.filter(rule => rule.id === target || rule.name.toLowerCase() === target.toLowerCase());
      if (matches.length !== 1) throw new Error(matches.length ? 'Multiple Routines match that name. Use the exact ID from list_routines.' : 'No saved Routine matches that name or ID.');
      const text = String(guidance || '').trim();
      if (text.length > 2000) throw new Error('Routine guidance must be 2,000 characters or fewer.');
      const existing = this.manual.find(task => task.kind === 'requested' && task.ruleId === matches[0].id);
      if (existing) return { requestId: existing.requestId, name: matches[0].name, status: 'already_queued' };
      const task = { kind: 'requested', ruleId: matches[0].id, guidance: text, requestId: id() };
      this.manual.push(task);
      this.changed();
      void this.pump();
      return { requestId: task.requestId, name: matches[0].name, status: 'queued' };
    }
    removeRule(ruleId) { return this.editRules(rules => rules.filter(rule => rule.id !== ruleId)); }
    async importRules(text) {
      const incoming = parseImport(text);
      await this.editRules(rules => [...rules, ...incoming]);
    }
    exportRules() { return exportRules(this.rules); }

    async observe(detail) {
      if (this.destroyed || !this.rules.some(rule => this.isEnabled(rule))) return;
      if (detail?.shortId && detail.shortId !== this.adventureId) return;
      let next = actionCount(detail);
      if (next === null) return;
      if (!this.armed) { await this.arm(); return; }
      if (next === undefined) next = await this.readCount(this.controller.signal);
      if (!Number.isSafeInteger(next) || this.destroyed) return;
      this.count = Math.max(this.count ?? 0, next);
      for (const rule of this.rules) {
        if (!this.isEnabled(rule)) continue;
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
        session.routines = this;
        this.sessions.set(ruleId, session);
        session.loadPromise = session.load();
      }
      const session = this.sessions.get(ruleId);
      await session.loadPromise;
      return session;
    }

    enqueueManual(session, text, operation = null) {
      if (this.destroyed) return Promise.resolve();
      if (this.manual.some(task => task.kind === 'manual')) return Promise.reject(new Error('A message is already waiting. Wait for it to run or cancel it first.'));
      return new Promise((resolve, reject) => {
        this.manual.unshift({ session, text, operation, resolve, reject, kind: 'manual' });
        this.changed();
        void this.pump();
      });
    }

    cancelWaiting() {
      const waiting = this.manual.splice(0);
      for (const item of waiting) item.resolve?.();
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
          const latestRules = ((await this.get(KEY))?.routines || this.rules).map(item => validateRule(item));
          await this.loadOverrides();
          const rule = latestRules.find(item => item.id === task.ruleId);
          if (task.kind === 'routine' && !(rule && this.isEnabled(rule))) return;
          if (task.kind === 'requested' && !rule) return;
          let state = await this.get(this.stateKey) || {};
          if (task.kind === 'routine') {
            if ((state.fired?.[task.ruleId] ?? -1) >= task.milestone) return;
            state = { ...state, fired: { ...state.fired, [task.ruleId]: task.milestone }, actionCount: this.count };
          } else if (task.kind === 'requested') {
            // One explicit run also satisfies a locally queued milestone for
            // this same Routine, avoiding two near-identical provider calls.
            const due = this.pending.get(task.ruleId);
            if (due) {
              this.pending.delete(task.ruleId);
              state = { ...state, fired: { ...state.fired, [task.ruleId]: Math.max(state.fired?.[task.ruleId] ?? -1, due.milestone) }, actionCount: this.count };
            }
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
            : task.kind === 'requested'
              ? `The player asked Navigator to run Routine "${rule.name}" now. These are the current instructions and supersede older versions:\n\n${rule.instruction}\n\n${task.guidance ? `Player guidance for this run: ${task.guidance}\n\n` : ''}Use current adventure context and this Routine's separate conversation. Report applied changes, proposals awaiting approval, or that no change was needed.`
            : task.text;
          if (!task.controller.signal.aborted && !this.destroyed) await task.session.send(text, { routineId, runId: record.id, source: task.kind === 'requested' ? 'routine' : task.kind, routineName: record.name, milestone: record.milestone });
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
  Object.assign(NavigatorRoutines, { KEY, OVERRIDES_PREFIX, TEMPLATE_CATALOG_VERSION, MAX_FILE_BYTES, templates, legacyDefaults: LEGACY_DEFAULTS, retiredTemplates: RETIRED_TEMPLATES, validateRule, parseImport, exportRules, milestone, actionCount, createId: id });
  globalThis.NavigatorRoutines = NavigatorRoutines;
  if (typeof module !== 'undefined') module.exports = NavigatorRoutines;
})();
