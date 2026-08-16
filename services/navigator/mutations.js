// BetterDungeon - Navigator Mutation Proposals
//
// Model-facing functions in this registry only create proposals. GraphQL writes
// are reachable exclusively through apply(), which the Navigator UI calls after
// an explicit player action.

(function () {
  if (typeof window === 'undefined' || window.NavigatorMutations) return;

  const READ_ONLY_STORAGE_KEY = 'betterDungeon_navigator_read_only';
  const MAX_PROPOSAL_CHARS = 40000;
  const MAX_REASON_CHARS = 1000;
  const ID_ATTEMPTS = 8;

  const TEXT_COMPONENTS = Object.freeze({
    ai_instructions: { label: 'AI Instructions', field: 'instructions', transport: 'state' },
    plot_essentials: { label: 'Plot Essentials', field: 'memory', transport: 'plot' },
    authors_note: { label: "Author's Note", field: 'authorsNote', transport: 'plot' },
    story_summary: { label: 'Story Summary', field: 'storySummary', transport: 'state' },
  });

  const CARD_FIELDS = Object.freeze({
    type: { label: 'Type', field: 'type' },
    title: { label: 'Name', field: 'title' },
    triggers: { label: 'Triggers', field: 'keys' },
    entry: { label: 'Entry', field: 'value' },
    notes: { label: 'Notes', field: 'description' },
  });

  const DEFINITIONS = Object.freeze([
    {
      name: 'propose_plot_component_change',
      description: 'Prepare a player-approved change to AI Instructions, Plot Essentials, Author\'s Note, or Story Summary. An empty content string proposes removing that component. This function never applies the change.',
      parameters: {
        type: 'object',
        properties: {
          component: {
            type: 'string',
            enum: Object.keys(TEXT_COMPONENTS),
            description: 'Plot Component to add, modify, or remove.',
          },
          content: { type: 'string', description: 'Complete replacement content. Use an empty string to remove the component.' },
          reason: { type: 'string', description: 'Short explanation shown to the player.' },
        },
        required: ['component', 'content'],
        additionalProperties: false,
      },
    },
    {
      name: 'propose_third_person_change',
      description: 'Prepare a player-approved change to the adventure Third Person setting. This function never applies the change.',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Whether Third Person should be enabled.' },
          reason: { type: 'string', description: 'Short explanation shown to the player.' },
        },
        required: ['enabled'],
        additionalProperties: false,
      },
    },
    {
      name: 'propose_story_card_create',
      description: 'Prepare a new Story Card for player approval. Supply all five player-facing fields. This function never creates the card.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          triggers: { type: 'string' },
          entry: { type: 'string' },
          notes: { type: 'string' },
          reason: { type: 'string', description: 'Short explanation shown to the player.' },
        },
        required: ['type', 'title', 'triggers', 'entry', 'notes'],
        additionalProperties: false,
      },
    },
    {
      name: 'propose_story_card_update',
      description: 'Prepare player-approved changes to an existing Story Card selected by stable ID. Include only fields that should change. This function never updates the card.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact Story Card ID from the directory or a read tool.' },
          changes: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              title: { type: 'string' },
              triggers: { type: 'string' },
              entry: { type: 'string' },
              notes: { type: 'string' },
            },
            additionalProperties: false,
          },
          reason: { type: 'string', description: 'Short explanation shown to the player.' },
        },
        required: ['id', 'changes'],
        additionalProperties: false,
      },
    },
    {
      name: 'propose_story_card_delete',
      description: 'Prepare irreversible deletion of one Story Card selected by stable ID. The player must explicitly approve it. This function never deletes the card.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact Story Card ID from the directory or a read tool.' },
          reason: { type: 'string', description: 'Short explanation shown to the player.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  ]);

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function createId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function assertObject(value, label) {
    if (!isObject(value)) throw { code: 'invalid_tool_args', message: `${label} must be an object.` };
    return value;
  }

  function assertOnlyKeys(value, allowed, label) {
    const unexpected = Object.keys(value).find(key => !allowed.includes(key));
    if (unexpected) throw { code: 'invalid_tool_args', message: `${label} contains unsupported field '${unexpected}'.` };
  }

  function stringArg(value, label, options = {}) {
    if (typeof value !== 'string') throw { code: 'invalid_tool_args', message: `${label} must be a string.` };
    if (value.length > (options.maxChars || MAX_PROPOSAL_CHARS)) {
      throw { code: 'invalid_tool_args', message: `${label} is too long.` };
    }
    if (options.nonEmpty && !value.trim()) {
      throw { code: 'invalid_tool_args', message: `${label} must not be empty.` };
    }
    return value;
  }

  function reasonArg(value) {
    if (value === undefined) return '';
    return stringArg(value, 'reason', { maxChars: MAX_REASON_CHARS }).trim();
  }

  function normalizeCard(card) {
    if (!card || card.deletedAt) return null;
    return {
      id: text(card.id),
      type: text(card.type),
      title: text(card.title),
      description: text(card.description),
      keys: Array.isArray(card.keys) ? card.keys.join(', ') : text(card.keys),
      value: text(card.value),
      useForCharacterCreation: card.useForCharacterCreation === true,
      updatedAt: typeof card.updatedAt === 'string' ? card.updatedAt : null,
    };
  }

  function fingerprintCard(card) {
    return JSON.stringify({
      id: card.id,
      type: card.type,
      title: card.title,
      description: card.description,
      keys: card.keys,
      value: card.value,
      useForCharacterCreation: card.useForCharacterCreation,
    });
  }

  function cardContentMatches(left, right) {
    return !!left && !!right && [
      'id', 'type', 'title', 'description', 'keys', 'value', 'useForCharacterCreation',
    ].every(key => left[key] === right[key]);
  }

  function inferTextAction(before, after) {
    if (!before && after) return 'add';
    if (before && !after) return 'remove';
    return 'modify';
  }

  function ensureProposalSize(proposal) {
    if (JSON.stringify(proposal).length > MAX_PROPOSAL_CHARS) {
      throw { code: 'invalid_tool_args', message: 'The proposed change is too large for Navigator to preview safely.' };
    }
    return proposal;
  }

  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  class NavigatorMutations {
    constructor(shortId) {
      this.shortId = shortId || null;
    }

    definitions() {
      return cloneJson(DEFINITIONS);
    }

    async readOnlyEnabled() {
      if (!isExtensionContextValid()) {
        throw { code: 'extension_context_invalid', message: 'The extension was reloaded. Reload this page before applying changes.' };
      }
      return new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => finish(true), 2000);
        try {
          chrome.storage.sync.get(READ_ONLY_STORAGE_KEY, result => {
            try {
              if (chrome.runtime?.lastError) {
                finish(true);
                return;
              }
              finish((result || {})[READ_ONLY_STORAGE_KEY] === true);
            } catch {
              finish(true);
            }
          });
        } catch {
          finish(true);
        }
      });
    }

    createProposal(name, rawArgs, options = {}) {
      const args = assertObject(rawArgs, 'Tool arguments');
      const index = options.index;
      if (!index || !index.shortId || String(index.shortId) !== String(this.shortId)) {
        throw { code: 'unavailable', message: 'The current adventure snapshot is unavailable. Start a new Navigator turn and try again.' };
      }

      let proposal;
      switch (name) {
        case 'propose_plot_component_change':
          proposal = this.createPlotProposal(args, index);
          break;
        case 'propose_third_person_change':
          proposal = this.createThirdPersonProposal(args, index);
          break;
        case 'propose_story_card_create':
          proposal = this.createCardCreateProposal(args, index);
          break;
        case 'propose_story_card_update':
          proposal = this.createCardUpdateProposal(args, index);
          break;
        case 'propose_story_card_delete':
          proposal = this.createCardDeleteProposal(args, index);
          break;
        default:
          throw { code: 'unknown_tool', message: `Navigator mutation proposal '${name}' is not available.` };
      }
      return ensureProposalSize(proposal);
    }

    proposalBase(kind, targetLabel, reason, index) {
      return {
        id: createId('proposal'),
        kind,
        targetLabel,
        reason,
        status: 'pending',
        shortId: String(index.shortId),
        adventureId: String(index.adventureId || ''),
        createdAt: Date.now(),
      };
    }

    createPlotProposal(args, index) {
      assertOnlyKeys(args, ['component', 'content', 'reason'], 'Plot Component proposal');
      const config = TEXT_COMPONENTS[args.component];
      if (!config) throw { code: 'invalid_tool_args', message: 'component is not a supported Plot Component.' };
      if (!index.adventure) throw { code: 'unavailable', message: 'Authoritative Plot Component data is unavailable for this turn.' };
      const before = text(index.adventure[config.field]);
      const after = stringArg(args.content, 'content');
      if (before === after) throw { code: 'no_change', message: `${config.label} already matches the proposed content.` };
      return {
        ...this.proposalBase('plot_component', config.label, reasonArg(args.reason), index),
        action: inferTextAction(before, after),
        component: args.component,
        field: config.field,
        transport: config.transport,
        before,
        after,
        changes: [{ label: config.label, before, after }],
      };
    }

    createThirdPersonProposal(args, index) {
      assertOnlyKeys(args, ['enabled', 'reason'], 'Third Person proposal');
      if (typeof args.enabled !== 'boolean') throw { code: 'invalid_tool_args', message: 'enabled must be a boolean.' };
      if (!index.adventure) throw { code: 'unavailable', message: 'Authoritative Plot Component data is unavailable for this turn.' };
      const before = index.adventure.thirdPerson === true;
      if (before === args.enabled) throw { code: 'no_change', message: `Third Person is already ${before ? 'enabled' : 'disabled'}.` };
      return {
        ...this.proposalBase('third_person', 'Third Person', reasonArg(args.reason), index),
        action: args.enabled ? 'enable' : 'disable',
        before,
        after: args.enabled,
        changes: [{ label: 'Third Person', before: before ? 'Enabled' : 'Disabled', after: args.enabled ? 'Enabled' : 'Disabled' }],
      };
    }

    createCardCreateProposal(args, index) {
      assertOnlyKeys(args, ['type', 'title', 'triggers', 'entry', 'notes', 'reason'], 'Story Card creation proposal');
      const after = {
        id: null,
        type: stringArg(args.type, 'type'),
        title: stringArg(args.title, 'title'),
        keys: stringArg(args.triggers, 'triggers'),
        value: stringArg(args.entry, 'entry'),
        description: stringArg(args.notes, 'notes'),
        useForCharacterCreation: false,
        updatedAt: null,
      };
      return {
        ...this.proposalBase('story_card_create', after.title || 'Untitled Story Card', reasonArg(args.reason), index),
        action: 'create',
        before: null,
        after,
        changes: Object.entries(CARD_FIELDS).map(([, config]) => ({
          label: config.label,
          before: '',
          after: after[config.field],
        })),
      };
    }

    requireAuthoritativeCards(index) {
      const authoritative = index?.source === 'apollo' || index?.source === 'graphql';
      if (!authoritative || !Array.isArray(index.cards)) {
        throw { code: 'unavailable', message: 'Authoritative Story Card data is unavailable for this turn.' };
      }
      return index.cards.map(normalizeCard).filter(Boolean);
    }

    createCardUpdateProposal(args, index) {
      assertOnlyKeys(args, ['id', 'changes', 'reason'], 'Story Card update proposal');
      const id = stringArg(args.id, 'id', { nonEmpty: true }).trim();
      const changes = assertObject(args.changes, 'changes');
      assertOnlyKeys(changes, Object.keys(CARD_FIELDS), 'changes');
      if (!Object.keys(changes).length) throw { code: 'invalid_tool_args', message: 'changes must include at least one Story Card field.' };
      const before = this.requireAuthoritativeCards(index).find(card => card.id === id);
      if (!before) throw { code: 'not_found', message: 'No current Story Card matched that identifier.' };
      const patch = {};
      const displayChanges = [];
      for (const [key, value] of Object.entries(changes)) {
        const config = CARD_FIELDS[key];
        const next = stringArg(value, `changes.${key}`);
        if (before[config.field] === next) continue;
        displayChanges.push({ label: config.label, before: before[config.field], after: next });
        patch[config.field] = next;
      }
      if (!displayChanges.length) throw { code: 'no_change', message: 'The Story Card already matches every proposed field.' };
      return {
        ...this.proposalBase('story_card_update', before.title || `Story Card ${id}`, reasonArg(args.reason), index),
        action: 'modify',
        cardId: id,
        patch,
        beforeFingerprint: fingerprintCard(before),
        beforeUpdatedAt: before.updatedAt,
        changes: displayChanges,
      };
    }

    createCardDeleteProposal(args, index) {
      assertOnlyKeys(args, ['id', 'reason'], 'Story Card deletion proposal');
      const id = stringArg(args.id, 'id', { nonEmpty: true }).trim();
      const before = this.requireAuthoritativeCards(index).find(card => card.id === id);
      if (!before) throw { code: 'not_found', message: 'No current Story Card matched that identifier.' };
      return {
        ...this.proposalBase('story_card_delete', before.title || `Story Card ${id}`, reasonArg(args.reason), index),
        action: 'delete',
        cardId: id,
        after: null,
        beforeFingerprint: fingerprintCard(before),
        beforeUpdatedAt: before.updatedAt,
        irreversible: true,
        changes: Object.entries(CARD_FIELDS).map(([, config]) => ({
          label: config.label,
          before: before[config.field],
          after: '',
        })),
      };
    }

    async apply(proposal, options = {}) {
      if (proposal?.restored) {
        throw { code: 'invalid_proposal', message: 'This restored proposal is display-only and cannot be applied.' };
      }
      if (!proposal || proposal.status !== 'applying') {
        throw { code: 'invalid_proposal', message: 'This proposal is not ready to apply.' };
      }
      if (await this.readOnlyEnabled()) {
        throw { code: 'read_only', message: 'Navigator Read-only mode is enabled.' };
      }
      const liveShortId = window.Ultrascripts?.ws?.getAdventureShortId?.();
      if (liveShortId && String(liveShortId) !== String(proposal.shortId)) {
        throw { code: 'adventure_changed', message: 'The open adventure no longer matches this proposal.' };
      }
      if (String(proposal.shortId) !== String(this.shortId)) {
        throw { code: 'adventure_changed', message: 'This proposal belongs to a different adventure.' };
      }

      try {
        switch (proposal.kind) {
          case 'plot_component': return await this.applyPlotComponent(proposal, options.signal);
          case 'third_person': return await this.applyThirdPerson(proposal, options.signal);
          case 'story_card_create': return await this.applyCardCreate(proposal, options.signal);
          case 'story_card_update': return await this.applyCardUpdate(proposal, options.signal);
          case 'story_card_delete': return await this.applyCardDelete(proposal, options.signal);
          default: throw { code: 'invalid_proposal', message: 'This proposal has an unsupported mutation type.' };
        }
      } catch (error) {
        if (error?.code) throw error;
        throw { code: 'mutation_failed', message: error?.message || 'AI Dungeon rejected the proposed change.' };
      }
    }

    gql() {
      const gql = window.BetterDungeonGQL;
      if (!gql) throw { code: 'unavailable', message: 'The BetterDungeon GraphQL service is unavailable.' };
      return gql;
    }

    async readAdventure(signal) {
      return this.gql().getNavigatorAdventureContext(this.shortId, { signal });
    }

    async readCards(signal) {
      const snapshot = await this.gql().getNavigatorStoryCards(this.shortId, { signal });
      return snapshot.cards.map(normalizeCard).filter(Boolean);
    }

    async hydrateVerifiedMutation(proposal, verified, signal) {
      const hydrator = window.BetterDungeonAdventureWriteHydration;
      if (!hydrator?.hydrateVerifiedMutation) {
        return { attempted: false, ok: false, reason: 'Apollo hydration service unavailable' };
      }
      try {
        return await hydrator.hydrateVerifiedMutation({
          kind: proposal.kind,
          proposal,
          verified,
          signal,
        });
      } catch (error) {
        console.warn('[Navigator] Apollo hydration diagnostic failed:', error);
        return { attempted: true, ok: false, reason: error?.message || String(error) };
      }
    }

    async applyPlotComponent(proposal, signal) {
      const current = await this.readAdventure(signal);
      if (text(current[proposal.field]) !== proposal.before) {
        throw { code: 'conflict', message: `${proposal.targetLabel} changed after Navigator prepared this proposal.` };
      }
      if (proposal.transport === 'plot') {
        await this.gql().updateNavigatorAdventurePlot(this.shortId, { [proposal.field]: proposal.after }, { signal });
      } else {
        const value = proposal.field === 'instructions'
          ? { type: 'custom', custom: proposal.after }
          : proposal.after;
        await this.gql().updateNavigatorAdventureState(this.shortId, { [proposal.field]: value }, { signal });
      }
      const verified = await this.readAdventure(signal);
      if (text(verified[proposal.field]) !== proposal.after) {
        throw { code: 'verification_failed', message: `${proposal.targetLabel} did not match the accepted value after AI Dungeon responded.` };
      }
      return {
        appliedAtIso: new Date().toISOString(),
        hydration: await this.hydrateVerifiedMutation(proposal, verified, signal),
      };
    }

    async applyThirdPerson(proposal, signal) {
      const current = await this.readAdventure(signal);
      if ((current.thirdPerson === true) !== proposal.before) {
        throw { code: 'conflict', message: 'Third Person changed after Navigator prepared this proposal.' };
      }
      await this.gql().updateNavigatorAdventurePlot(this.shortId, { thirdPerson: proposal.after }, { signal });
      const verified = await this.readAdventure(signal);
      if ((verified.thirdPerson === true) !== proposal.after) {
        throw { code: 'verification_failed', message: 'Third Person did not match the accepted setting after AI Dungeon responded.' };
      }
      return {
        appliedAtIso: new Date().toISOString(),
        hydration: await this.hydrateVerifiedMutation(proposal, verified, signal),
      };
    }

    generateCardId(existingIds) {
      if (!globalThis.crypto?.getRandomValues) {
        throw { code: 'id_generation_failed', message: 'Secure Story Card ID generation is unavailable in this browser context.' };
      }
      for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
        const random = new Uint32Array(1);
        globalThis.crypto.getRandomValues(random);
        const id = String(100000000 + (random[0] % 900000000));
        if (!existingIds.has(id)) return id;
      }
      throw { code: 'id_generation_failed', message: 'Navigator could not allocate an unused Story Card ID.' };
    }

    async applyCardCreate(proposal, signal) {
      const currentCards = await this.readCards(signal);
      const id = this.generateCardId(new Set(currentCards.map(card => card.id)));
      const desired = { ...proposal.after, id };
      await this.gql().updateNavigatorStoryCard(this.shortId, desired, { signal });
      const verified = (await this.readCards(signal)).find(card => card.id === id);
      if (!cardContentMatches(verified, desired)) {
        throw { code: 'verification_failed', message: 'The new Story Card did not match the accepted values after AI Dungeon responded.' };
      }
      return {
        appliedAtIso: new Date().toISOString(),
        cardId: id,
        targetLabel: verified.title || proposal.targetLabel,
        hydration: await this.hydrateVerifiedMutation(proposal, verified, signal),
      };
    }

    async applyCardUpdate(proposal, signal) {
      const current = (await this.readCards(signal)).find(card => card.id === proposal.cardId);
      if (!current || fingerprintCard(current) !== proposal.beforeFingerprint) {
        throw { code: 'conflict', message: 'The Story Card changed after Navigator prepared this proposal.' };
      }
      const updatedAtDrift = current.updatedAt !== proposal.beforeUpdatedAt
        ? { before: proposal.beforeUpdatedAt || null, current: current.updatedAt || null }
        : null;
      const desired = { ...current, ...proposal.patch };
      await this.gql().updateNavigatorStoryCard(this.shortId, desired, { signal });
      const verified = (await this.readCards(signal)).find(card => card.id === proposal.cardId);
      if (!cardContentMatches(verified, desired)) {
        throw { code: 'verification_failed', message: 'The Story Card did not match the accepted values after AI Dungeon responded.' };
      }
      return {
        appliedAtIso: new Date().toISOString(),
        updatedAtDrift,
        hydration: await this.hydrateVerifiedMutation(proposal, verified, signal),
      };
    }

    async applyCardDelete(proposal, signal) {
      const current = (await this.readCards(signal)).find(card => card.id === proposal.cardId);
      if (!current || fingerprintCard(current) !== proposal.beforeFingerprint) {
        throw { code: 'conflict', message: 'The Story Card changed after Navigator prepared this deletion.' };
      }
      const updatedAtDrift = current.updatedAt !== proposal.beforeUpdatedAt
        ? { before: proposal.beforeUpdatedAt || null, current: current.updatedAt || null }
        : null;
      await this.gql().deleteNavigatorStoryCard(this.shortId, proposal.cardId, { signal });
      const verified = (await this.readCards(signal)).find(card => card.id === proposal.cardId);
      if (verified) {
        throw { code: 'verification_failed', message: 'The Story Card was still present after AI Dungeon responded.' };
      }
      return {
        appliedAtIso: new Date().toISOString(),
        updatedAtDrift,
        hydration: await this.hydrateVerifiedMutation(proposal, verified, signal),
      };
    }
  }

  NavigatorMutations.DEFINITIONS = DEFINITIONS;
  NavigatorMutations.READ_ONLY_STORAGE_KEY = READ_ONLY_STORAGE_KEY;
  NavigatorMutations.MAX_PROPOSAL_CHARS = MAX_PROPOSAL_CHARS;
  window.NavigatorMutations = NavigatorMutations;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigatorMutations;
  }
})();
