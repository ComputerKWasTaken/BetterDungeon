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

  function editorDocument(textarea, documentLike) {
    if (documentLike) return documentLike;
    if (textarea?.ownerDocument) return textarea.ownerDocument;
    return typeof document !== 'undefined' ? document : null;
  }

  function editorValueSetter(textarea) {
    const hostWindow = typeof window !== 'undefined' ? window : null;
    const prototypes = [
      Object.getPrototypeOf(textarea),
      textarea?.constructor?.prototype,
      textarea?.ownerDocument?.defaultView?.HTMLTextAreaElement?.prototype,
      hostWindow?.HTMLTextAreaElement?.prototype,
    ];
    for (const prototype of prototypes) {
      const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) return setter;
    }
    return null;
  }

  function dispatchEditorEvent(textarea, type) {
    const hostWindow = typeof window !== 'undefined' ? window : null;
    const eventConstructor = textarea?.ownerDocument?.defaultView?.Event
      || hostWindow?.Event
      || (typeof Event !== 'undefined' ? Event : null);
    const event = eventConstructor
      ? new eventConstructor(type, { bubbles: true })
      : { type, bubbles: true };
    textarea.dispatchEvent(event);
  }

  function fillEditorTextarea(textarea, before, after, documentLike) {
    if (!textarea) {
      return { attempted: true, ok: false, reason: 'no editor surface located' };
    }
    try {
      const pageDocument = editorDocument(textarea, documentLike);
      if (pageDocument?.activeElement === textarea) {
        return {
          attempted: true,
          ok: false,
          reason: 'Plot editor is active; editor hydration was skipped to avoid clobbering unsaved text',
        };
      }
      if (textarea.value !== before) {
        return {
          attempted: true,
          ok: false,
          reason: 'Plot editor holds different or unsaved text; editor hydration was skipped',
        };
      }
      const setter = editorValueSetter(textarea);
      if (!setter) {
        return { attempted: true, ok: false, reason: 'Plot editor value setter unavailable' };
      }
      setter.call(textarea, after);
      if (textarea.value !== after) {
        return { attempted: true, ok: false, reason: 'Plot editor value could not be updated' };
      }
      dispatchEditorEvent(textarea, 'input');
      dispatchEditorEvent(textarea, 'change');
      return { attempted: true, ok: true };
    } catch (error) {
      return {
        attempted: true,
        ok: false,
        reason: error?.message || String(error),
      };
    }
  }

  function getAIDungeonService() {
    const hostWindow = typeof window !== 'undefined' ? window : null;
    let instance = hostWindow?.betterDungeonInstance;
    if (!instance) {
      try {
        instance = betterDungeonInstance;
      } catch {
        instance = null;
      }
    }
    return instance?.aiDungeonService || null;
  }

  function findPlotEditorTextarea(field) {
    const service = getAIDungeonService();
    const methods = {
      instructions: 'findAIInstructionsTextarea',
      memory: 'findPlotEssentialsTextarea',
      authorsNote: 'findAuthorsNoteTextarea',
    };
    const method = methods[field];
    if (service && method && typeof service[method] === 'function') {
      return service[method]();
    }
    if (field === 'storySummary' && service && typeof service._findTextareaByComponentHeading === 'function') {
      return service._findTextareaByComponentHeading('Story Summary');
    }

    const hostWindow = typeof window !== 'undefined' ? window : null;
    const serviceClass = hostWindow?.AIDungeonService;
    const selectorKey = {
      instructions: 'AI_INSTRUCTIONS',
      memory: 'PLOT_ESSENTIALS',
      authorsNote: 'AUTHORS_NOTE',
    }[field];
    const pageDocument = editorDocument(null);
    const selector = selectorKey && serviceClass?.SEL?.[selectorKey];
    if (selector && pageDocument?.querySelector) return pageDocument.querySelector(selector);
    if (field === 'storySummary' && typeof serviceClass === 'function') {
      try {
        const fallbackService = new serviceClass();
        return fallbackService._findTextareaByComponentHeading?.('Story Summary') || null;
      } catch {
        return null;
      }
    }
    return null;
  }

  function hydratePlotEditor(proposal, verified) {
    try {
      const textarea = findPlotEditorTextarea(proposal?.field);
      return fillEditorTextarea(textarea, proposal?.before, verified?.[proposal?.field]);
    } catch (error) {
      return {
        attempted: true,
        ok: false,
        reason: error?.message || String(error),
      };
    }
  }

  async function hydrateAdventure(verified, proposal, apollo) {
    const id = verified?.id || proposal.adventureId;
    if (!id) return { ok: false, reason: 'confirmed adventure id unavailable' };
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

  async function hydrateMemory(verified, proposal, apollo, kind = proposal?.kind) {
    const id = verified?.id ?? proposal?.memoryId;
    if (id == null || id === '') return { ok: false, reason: 'Memory Bank identity unavailable' };
    const adventureId = verified?.adventureId || proposal.adventureId;
    if (!adventureId) return { ok: false, reason: 'Memory Bank adventure id unavailable' };
    let cached;
    try {
      cached = await apollo.readEntity({
        typename: 'Adventure',
        id: String(adventureId),
        fields: ['state'],
      });
    } catch {
      return { ok: false, reason: 'Memory Bank Adventure state could not be inspected' };
    }
    if (!cached?.available || !cached.data?.state) {
      return { ok: false, reason: 'Memory Bank Adventure state unavailable' };
    }
    const state = cached.data.state;
    if (!Array.isArray(state.memories)) {
      return { ok: false, reason: 'Memory Bank state is unavailable in the Adventure cache' };
    }
    const memoryIndex = state.memories.findIndex(entry => (
      String(entry?.actionIds?.[0]) === String(id)
    ));
    if (memoryIndex < 0) {
      return { ok: false, reason: `Memory Bank entry '${id}' is missing from the Adventure cache` };
    }
    const current = state.memories[memoryIndex];
    if (kind === 'memory_update' && current.text !== proposal.before) {
      return { ok: false, reason: `Memory Bank entry '${id}' does not match its pre-write text; hydration was skipped` };
    }
    if (kind === 'memory_delete' && has(proposal, 'before') && proposal.before != null && current.text !== proposal.before) {
      return { ok: false, reason: `Memory Bank entry '${id}' does not match its pre-write text; deletion hydration was skipped` };
    }
    const memories = state.memories.slice();
    if (kind === 'memory_delete') memories.splice(memoryIndex, 1);
    else memories[memoryIndex] = { ...current, text: verified.text };
    const result = await apollo.modifyEntity({
      typename: 'Adventure',
      id: String(adventureId),
      fields: { state: { ...state, memories } },
    });
    if (!result.available || result.data?.changed !== true) {
      return { ok: false, reason: result.error?.message || 'Memory Bank cache modification was not applied' };
    }
    return { ok: true, entity: `Adventure:${adventureId}`, memoryId: String(id) };
  }

  async function refetchActive(apollo) {
    if (!apollo.refetchActive) {
      return { attempted: false, ok: false, reason: 'Apollo active-query refetch unavailable' };
    }
    try {
      const result = await apollo.refetchActive();
      if (!result?.available || result.data?.refetched !== true) {
        return {
          attempted: true,
          ok: false,
          reason: result?.error?.message || 'Apollo active-query refetch failed',
        };
      }
      return { attempted: true, ok: true };
    } catch (error) {
      return { attempted: true, ok: false, reason: error?.message || String(error) };
    }
  }

  async function hydrateVerifiedMutation(options = {}) {
    const apollo = window.BetterDungeonApolloCache;
    if (!apollo) return { attempted: false, ok: false, reason: 'Apollo cache unavailable' };
    try {
      const kind = options.kind;
      if (options.kind === 'story_card_create' || options.kind === 'story_card_delete') {
        const refetch = await refetchActive(apollo);
        if (!refetch.ok) {
          return {
            attempted: refetch.attempted,
            ok: false,
            deferred: true,
            refetch,
            reason: refetch.reason || 'Story Card membership refetch failed',
          };
        }
        return {
          attempted: true,
          ok: true,
          deferred: true,
          refetch,
          reason: 'Story Card membership refreshed through active queries',
        };
      }
      if (![
        'plot_component',
        'third_person',
        'story_card_update',
        'memory_update',
        'memory_delete',
      ].includes(kind)) {
        return {
          attempted: false,
          ok: false,
          reason: `Unsupported verified mutation kind '${kind || 'unknown'}'; hydration was not attempted`,
        };
      }
      if (!apollo.modifyEntity) return { attempted: false, ok: false, reason: 'Apollo cache unavailable' };
      let result;
      switch (kind) {
        case 'plot_component':
        case 'third_person':
          result = await hydrateAdventure(options.verified, options.proposal, apollo);
          break;
        case 'story_card_update':
          result = await hydrateCard(options.verified, options.proposal, apollo);
          break;
        case 'memory_update':
        case 'memory_delete':
          result = await hydrateMemory(options.verified, options.proposal, apollo, kind);
          break;
        default:
          result = { ok: false, reason: `Unsupported verified mutation kind '${kind || 'unknown'}'; hydration was not attempted` };
      }
      if (!result.ok) return { attempted: true, ...result };
      const output = { attempted: true, ...result, refetch: await refetchActive(apollo) };
      if (kind === 'plot_component') output.editor = hydratePlotEditor(options.proposal, options.verified);
      return output;
    } catch (error) {
      console.warn('[Navigator] Verified-write Apollo hydration failed:', error);
      return { attempted: true, ok: false, reason: error?.message || String(error) };
    }
  }

  window.BetterDungeonAdventureWriteHydration = {
    hydrateVerifiedMutation,
    fillEditorTextarea,
    cardBeforeFields: CARD_BEFORE_FIELDS,
  };
}());
