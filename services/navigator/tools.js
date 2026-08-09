// BetterDungeon - Navigator Read Tools
//
// Typed, bounded, read-only access to live adventure data. This registry is
// first-party Navigator infrastructure and is never exposed through the
// Ultrascripts ops dispatcher.

(function () {
  if (typeof window === 'undefined' || window.NavigatorTools) return;

  const MAX_CARD_ENTRY_CHARS = 6000;
  const MAX_CARD_RESULT_CHARS = 10000;
  const MAX_SEARCH_RESULT_CHARS = 4000;
  const MAX_SEARCH_PREVIEW_CHARS = 240;
  const MAX_SEARCH_LIMIT = 10;

  const DEFINITIONS = Object.freeze([
    {
      name: 'get_story_card',
      description: 'Read one current Story Card selected by stable ID from the supplied directory or search results. Returns complete metadata and up to 6000 entry characters. This tool never changes the card.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact Story Card ID.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_story_cards',
      description: 'Search current Story Cards across title, type, triggers, entry, and notes. Returns stable IDs and bounded matching previews.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: 'Case-insensitive text to search for.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, description: 'Maximum matches to return. Defaults to 5.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ]);

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function oneLine(value) {
    return text(value).replace(/\s+/g, ' ').trim();
  }

  function boundedText(value, maxChars) {
    const source = text(value);
    if (source.length <= maxChars) return { text: source, truncated: false, sourceChars: source.length };
    return {
      text: `${source.slice(0, Math.max(0, maxChars - 18))}\n[truncated]`,
      truncated: true,
      sourceChars: source.length,
    };
  }

  function normalizeTriggers(card) {
    if (Array.isArray(card?.triggers)) {
      return card.triggers.map(oneLine).filter(Boolean);
    }
    return text(card?.keys)
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  }

  function normalizeCard(card) {
    if (!card || card.deletedAt) return null;
    const id = card.id == null ? null : String(card.id);
    const keys = Array.isArray(card.keys) ? card.keys.join(', ') : text(card.keys);
    const hasEntryValue = card.value !== undefined || card.entryText !== undefined;
    return {
      id,
      type: oneLine(card.type || 'other').toLowerCase(),
      title: oneLine(card.title || card.name || keys) || (id ? `Story Card ${id}` : 'Untitled Story Card'),
      description: text(card.description),
      keys,
      triggers: normalizeTriggers({ ...card, keys }),
      value: hasEntryValue ? text(card.value ?? card.entryText) : text(card.description),
      useForCharacterCreation: card.useForCharacterCreation === true,
      updatedAt: typeof card.updatedAt === 'string' ? card.updatedAt : null,
    };
  }

  function currentCards(shortId, index) {
    if (!index || !Array.isArray(index.cards)) {
      throw { code: 'unavailable', message: 'The current Story Card snapshot is unavailable. Start a new Navigator turn and try again.' };
    }
    const cards = index.cards.map(normalizeCard).filter(Boolean);
    return {
      adventureId: index.adventureId || null,
      shortId: index.shortId || shortId,
      source: index.source || 'unknown',
      capturedAtIso: index.capturedAtIso || null,
      cards,
    };
  }

  function integerArg(value, fallback, min, max, label) {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw { code: 'invalid_tool_args', message: `${label} must be an integer from ${min} to ${max}.` };
    }
    return parsed;
  }

  function assertArgs(args) {
    if (args === undefined || args === null) return {};
    if (!isObject(args)) throw { code: 'invalid_tool_args', message: 'Tool arguments must be an object.' };
    return args;
  }

  function boundedResult(value, maxChars) {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars) return value;
    throw {
      code: 'tool_result_too_large',
      message: 'The Story Card result exceeded Navigator\'s per-result budget. Narrow the search and try again.',
    };
  }

  function boundedMetadata(value, maxChars) {
    const clipped = boundedText(value, maxChars);
    return { value: clipped.text, sourceChars: clipped.sourceChars, truncated: clipped.truncated };
  }

  function boundedTriggers(triggers) {
    const source = Array.isArray(triggers) ? triggers : [];
    const selected = [];
    let used = 0;
    for (const trigger of source) {
      const clipped = oneLine(trigger).slice(0, 100);
      if (!clipped) continue;
      if (used + clipped.length > 600) break;
      selected.push(clipped);
      used += clipped.length;
    }
    return {
      values: selected,
      sourceCount: source.length,
      truncated: selected.length < source.length,
    };
  }

  function getStoryCard(shortId, args, index) {
    const id = oneLine(args.id);
    if (!id) {
      throw { code: 'invalid_tool_args', message: 'get_story_card requires id.' };
    }
    const snapshot = currentCards(shortId, index);
    const card = snapshot.cards.find(candidate => candidate.id === id);
    if (!card) throw { code: 'not_found', message: 'No current Story Card matched that identifier.' };
    const entry = boundedText(card.value, MAX_CARD_ENTRY_CHARS);
    const title = boundedMetadata(card.title, 500);
    const type = boundedMetadata(card.type, 100);
    const description = boundedMetadata(card.description, 800);
    const keys = boundedMetadata(card.keys, 800);
    const triggers = boundedTriggers(card.triggers);
    return {
      source: snapshot.source,
      adventureId: snapshot.adventureId,
      shortId: snapshot.shortId,
      capturedAtIso: snapshot.capturedAtIso,
      card: {
        id: card.id,
        type: type.value,
        typeSourceChars: type.sourceChars,
        typeTruncated: type.truncated,
        title: title.value,
        titleSourceChars: title.sourceChars,
        titleTruncated: title.truncated,
        description: description.value,
        descriptionSourceChars: description.sourceChars,
        descriptionTruncated: description.truncated,
        keys: keys.value,
        keysSourceChars: keys.sourceChars,
        keysTruncated: keys.truncated,
        triggers: triggers.values,
        triggersSourceCount: triggers.sourceCount,
        triggersTruncated: triggers.truncated,
        value: entry.text,
        useForCharacterCreation: card.useForCharacterCreation,
        updatedAt: card.updatedAt,
      },
      entrySourceChars: entry.sourceChars,
      entryTruncated: entry.truncated,
    };
  }

  function searchStoryCards(shortId, args, index) {
    const query = oneLine(args.query).toLowerCase();
    if (!query) throw { code: 'invalid_tool_args', message: 'query must be a non-empty string.' };
    const limit = integerArg(args.limit, 5, 1, MAX_SEARCH_LIMIT, 'limit');
    const snapshot = currentCards(shortId, index);
    const matches = snapshot.cards.filter(card => [
      card.title,
      card.type,
      card.keys,
      card.value,
      card.description,
    ].some(value => text(value).toLowerCase().includes(query)));
    const records = [];
    for (const card of matches.slice(0, limit)) {
      const preview = boundedText(card.value, MAX_SEARCH_PREVIEW_CHARS);
      const triggers = boundedTriggers(card.triggers);
      const title = boundedMetadata(card.title, 500);
      const type = boundedMetadata(card.type, 100);
      const record = {
        id: card.id,
        type: type.value,
        typeTruncated: type.truncated,
        title: title.value,
        titleTruncated: title.truncated,
        triggers: triggers.values,
        triggersSourceCount: triggers.sourceCount,
        triggersTruncated: triggers.truncated,
        entryPreview: preview.text,
        entryTruncated: preview.truncated,
        updatedAt: card.updatedAt,
      };
      const candidate = {
        source: snapshot.source,
        adventureId: snapshot.adventureId,
        shortId: snapshot.shortId,
        capturedAtIso: snapshot.capturedAtIso,
        query,
        totalMatches: matches.length,
        returned: records.length + 1,
        omitted: Math.max(0, matches.length - records.length - 1),
        cards: [...records, record],
      };
      if (JSON.stringify(candidate).length > MAX_SEARCH_RESULT_CHARS - 300) break;
      records.push(record);
    }
    return {
      source: snapshot.source,
      adventureId: snapshot.adventureId,
      shortId: snapshot.shortId,
      capturedAtIso: snapshot.capturedAtIso,
      query,
      totalMatches: matches.length,
      returned: records.length,
      omitted: Math.max(0, matches.length - records.length),
      cards: records,
    };
  }

  class NavigatorTools {
    constructor(shortId) {
      this.shortId = shortId || null;
    }

    definitions() {
      return cloneJson(DEFINITIONS);
    }

    async execute(name, rawArgs, options = {}) {
      if (options.signal?.aborted) {
        throw { code: 'aborted', message: 'Navigator tool execution was stopped.', retryable: false };
      }
      const args = assertArgs(rawArgs);
      let result;
      switch (name) {
        case 'get_story_card': result = getStoryCard(this.shortId, args, options.index); break;
        case 'search_story_cards': result = searchStoryCards(this.shortId, args, options.index); break;
        default: throw { code: 'unknown_tool', message: `Navigator read tool '${name}' is not available.` };
      }
      return boundedResult({
        ok: true,
        tool: name,
        capturedAtIso: options.index?.capturedAtIso || new Date().toISOString(),
        data: result,
      }, name === 'search_story_cards' ? MAX_SEARCH_RESULT_CHARS : MAX_CARD_RESULT_CHARS);
    }
  }

  NavigatorTools.DEFINITIONS = DEFINITIONS;
  NavigatorTools.MAX_CARD_RESULT_CHARS = MAX_CARD_RESULT_CHARS;
  NavigatorTools.MAX_SEARCH_RESULT_CHARS = MAX_SEARCH_RESULT_CHARS;
  window.NavigatorTools = NavigatorTools;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigatorTools;
  }
})();
