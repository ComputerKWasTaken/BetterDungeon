(function () {
  'use strict';

  function has(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  function cardFields(card) {
    const fields = {};
    for (const field of ['type', 'title', 'description', 'keys', 'value', 'useForCharacterCreation', 'updatedAt', 'deletedAt']) {
      if (has(card, field)) fields[field] = card[field];
    }
    return fields;
  }

  const CARD_BEFORE_FIELDS = Object.freeze({
    Type: 'type',
    Name: 'title',
    Triggers: 'keys',
    Entry: 'value',
    Notes: 'description',
  });

  function cardValue(value) {
    return Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value);
  }

  function cachedCardMatchesBefore(cached, proposal) {
    const changes = Array.isArray(proposal?.changes) ? proposal.changes : [];
    return changes.length > 0 && changes.every(change => {
      const field = CARD_BEFORE_FIELDS[change?.label];
      return field && cardValue(cached?.[field]) === cardValue(change.before);
    });
  }

  async function hydrateAdventure(verified, proposal, apollo) {
    const id = verified?.id || proposal.adventureId;
    if (id == null) return { ok: false, reason: 'confirmed adventure id unavailable' };
    const field = proposal.field;
    const rootFields = ['title', 'memory', 'authorsNote', 'thirdPerson'];
    const stateFields = ['instructions', 'storySummary'];
    if (!rootFields.includes(field) && !stateFields.includes(field)) {
      return { ok: false, reason: `no safe normalized Adventure placement for '${field || 'unknown'}'` };
    }
    const fields = {};
    if (!has(verified, field)) {
      return { ok: false, reason: `confirmed '${field}' unavailable` };
    }
    if (rootFields.includes(field)) fields[field] = verified[field];
    if (has(verified, 'editedAt')) fields.editedAt = verified.editedAt;
    if (stateFields.includes(field)) {
      const current = await apollo.readEntity({ typename: 'Adventure', id: String(id), fields: ['state'] });
      if (!current.available || !current.data) return { ok: false, reason: 'Adventure cache state unavailable' };
      const state = { ...(current.data.state || {}) };
      if (field === 'instructions') {
        const existing = state.instructions;
        const type = existing && typeof existing === 'object' && existing.type
          ? existing.type
          : 'custom';
        state.instructions = { type, custom: verified.instructions };
      } else {
        state.storySummary = verified.storySummary;
      }
      fields.state = state;
    }
    if (!Object.keys(fields).length) return { ok: false, reason: 'no confirmed adventure fields to hydrate' };
    const result = await apollo.modifyEntity({ typename: 'Adventure', id: String(id), fields });
    if (!result.available || result.data?.changed !== true) {
      return { ok: false, reason: result.error?.message || 'Adventure cache modification was not applied' };
    }
    return { ok: true, entity: `Adventure:${id}` };
  }

  async function hydrateCard(verified, proposal, apollo) {
    if (!verified?.id) return { ok: false, reason: 'confirmed Story Card id unavailable' };
    let cached;
    try {
      cached = await apollo.readEntity({
        typename: 'StoryCard',
        id: String(verified.id),
        fields: ['type', 'title', 'description', 'keys', 'value', 'useForCharacterCreation'],
      });
    } catch {
      return { ok: false, reason: `cached StoryCard:${verified.id} could not be inspected; hydration was skipped to avoid clobbering another adventure's cached card` };
    }
    if (!cached?.available || !cached.data) {
      return { ok: false, reason: `cached StoryCard:${verified.id} is missing; hydration was skipped to avoid clobbering another adventure's cached card` };
    }
    if (!cachedCardMatchesBefore(cached.data, proposal)) {
      return { ok: false, reason: `cached StoryCard:${verified.id} does not match the pre-write card for this adventure; hydration was skipped to avoid clobbering another adventure's cached card` };
    }
    const result = await apollo.modifyEntity({
      typename: 'StoryCard',
      id: String(verified.id),
      fields: cardFields(verified),
    });
    if (!result.available || result.data?.changed !== true) {
      return { ok: false, reason: result.error?.message || 'Story Card cache modification was not applied' };
    }
    return { ok: true, entity: `StoryCard:${verified.id}` };
  }

  async function hydrateVerifiedMutation(options = {}) {
    const apollo = window.BetterDungeonApolloCache;
    if (!apollo) return { attempted: false, ok: false, reason: 'Apollo cache unavailable' };
    try {
      if (options.kind === 'story_card_create' || options.kind === 'story_card_delete') {
        if (!apollo.refetchActive) return { attempted: false, ok: false, deferred: true, reason: 'Story Card membership hydration deferred' };
        const result = await apollo.refetchActive();
        if (!result.available || result.data?.refetched !== true) {
          return { attempted: true, ok: false, deferred: true, reason: result.error?.message || 'Story Card membership refetch failed' };
        }
        return { attempted: true, ok: true, deferred: true, reason: 'Story Card membership refreshed through active queries' };
      }
      if (!apollo.modifyEntity) return { attempted: false, ok: false, reason: 'Apollo cache unavailable' };
      const result = options.kind?.startsWith('story_card_')
        ? await hydrateCard(options.verified, options.proposal, apollo)
        : await hydrateAdventure(options.verified, options.proposal, apollo);
      return { attempted: true, ...result };
    } catch (error) {
      console.warn('[Navigator] Verified-write Apollo hydration failed:', error);
      return { attempted: true, ok: false, reason: error?.message || String(error) };
    }
  }

  window.BetterDungeonAdventureWriteHydration = {
    hydrateVerifiedMutation,
    cardBeforeFields: CARD_BEFORE_FIELDS,
  };
}());
