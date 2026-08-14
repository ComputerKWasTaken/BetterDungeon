(function () {
  'use strict';

  function has(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  function confirmedFields(verified, proposal) {
    const fields = {};
    const adventureFields = ['title', 'memory', 'authorsNote', 'thirdPerson', 'storySummary', 'editedAt'];
    for (const field of adventureFields) {
      if (has(verified, field)) fields[field] = verified[field];
    }
    if (proposal.field === 'instructions' && has(verified, 'instructions')) {
      fields.__instructions = verified.instructions;
    }
    return fields;
  }

  function cardFields(card) {
    const fields = {};
    for (const field of ['type', 'title', 'description', 'keys', 'value', 'useForCharacterCreation', 'updatedAt', 'deletedAt']) {
      if (has(card, field)) fields[field] = card[field];
    }
    return fields;
  }

  async function hydrateAdventure(verified, proposal, apollo) {
    const id = verified?.id || proposal.adventureId;
    if (id == null) return { ok: false, reason: 'confirmed adventure id unavailable' };
    const fields = confirmedFields(verified, proposal);
    if (has(fields, '__instructions')) {
      const current = await apollo.readEntity({ typename: 'Adventure', id: String(id), fields: ['state'] });
      if (!current.available || !current.data) return { ok: false, reason: 'Adventure cache state unavailable' };
      const state = { ...(current.data.state || {}) };
      state.instructions = { type: 'custom', custom: fields.__instructions };
      fields.state = state;
      delete fields.__instructions;
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
    if (!apollo?.modifyEntity) return { attempted: false, ok: false, reason: 'Apollo cache unavailable' };
    try {
      if (options.kind === 'story_card_delete') {
        if (!apollo.refetchActive) return { attempted: false, ok: false, deferred: true, reason: 'Story Card deletion hydration deferred' };
        const result = await apollo.refetchActive();
        if (!result.available || result.data?.refetched !== true) {
          return { attempted: true, ok: false, deferred: true, reason: result.error?.message || 'Story Card deletion refetch failed' };
        }
        return { attempted: true, ok: true, deferred: true, reason: 'Story Card deletion refreshed through active queries' };
      }
      const result = options.kind?.startsWith('story_card_')
        ? await hydrateCard(options.verified, options.proposal, apollo)
        : await hydrateAdventure(options.verified, options.proposal, apollo);
      return { attempted: true, ...result };
    } catch (error) {
      console.warn('[Navigator] Verified-write Apollo hydration failed:', error);
      return { attempted: true, ok: false, reason: error?.message || String(error) };
    }
  }

  window.BetterDungeonAdventureWriteHydration = { hydrateVerifiedMutation };
}());
