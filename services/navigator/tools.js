// BetterDungeon - Navigator Read Tools
//
// Typed, bounded, read-only access to the turn-bound adventure snapshot.

(function () {
  if (typeof window === 'undefined' || window.NavigatorTools) return;

  const MAX_CARD_ENTRY_CHARS = 6000;
  const MAX_CARD_RESULT_CHARS = 10000;
  const MAX_SEARCH_RESULT_CHARS = 4000;
  const MAX_SEARCH_PREVIEW_CHARS = 240;
  const MAX_SEARCH_LIMIT = 10;
  const MAX_ACTION_WINDOW = 20;
  const MAX_ACTION_WINDOW_CHARS = 8000;
  const MAX_ACTION_RESULT_CHARS = 10000;
  const MAX_MEMORY_CHARS = 4000;

  const DEFINITIONS = Object.freeze([
    {
      name: 'get_story_card',
      description: 'Read one current Story Card selected by stable ID from the supplied directory or search results. Returns complete metadata and up to 6000 entry characters. This tool never changes the card.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Exact Story Card ID.' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_story_cards',
      description: 'Search current Story Cards with case-insensitive substring matching. Ranking is deterministic: title or trigger hits outrank type hits, which outrank entry hits, which outrank notes; ties use Story Card directory order. Results include match-centred previews.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: 'Case-insensitive text to search for.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, description: 'Maximum matches to return. Defaults to 5.' },
          type: { type: 'string', description: 'Optional exact Story Card type filter.' },
          fields: {
            type: 'array',
            items: { type: 'string', enum: ['title', 'triggers', 'type', 'entry', 'notes'] },
            description: 'Optional fields to search. Defaults to all searchable fields.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_story_history',
      description: 'Search normalized action text with case-insensitive substring matching. Temporal order is primary (newest-first by default or oldest-first); match count only breaks selection when more hits exist than the limit. Use the returned positional index with get_story_actions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT },
          order: { type: 'string', enum: ['newest-first', 'oldest-first'] },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_story_actions',
      description: 'Read a bounded action window around an action ID or positional index. Supply exactly one anchor. Direction is before, after, or around; each call returns at most 20 actions and approximately 8000 characters.',
      parameters: {
        type: 'object',
        properties: {
          actionId: { type: 'string' },
          fromIndex: { type: 'integer', minimum: 0 },
          count: { type: 'integer', minimum: 1, maximum: MAX_ACTION_WINDOW },
          direction: { type: 'string', enum: ['before', 'after', 'around'] },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'search_memory_bank',
      description: 'Search normalized Memory Bank entries with case-insensitive substring matching. Results include both stable memory IDs and positional indexes; match count only breaks selection when more hits exist than the limit. Use get_memory with either returned id or index.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_memory',
      description: 'Read one bounded Memory Bank entry by stable memory ID or positional index. The result is capped at 4000 characters and reports truncation explicitly.',
      parameters: {
        type: 'object',
        properties: { index: { type: 'integer', minimum: 0 }, id: { type: 'string', minLength: 1 } },
        required: [],
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
    const suffix = '\n[truncated]';
    return {
      text: `${source.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`,
      truncated: true,
      sourceChars: source.length,
    };
  }

  function matchPreview(value, query, maxChars) {
    const source = text(value);
    const lower = source.toLowerCase();
    const needle = text(query).toLowerCase();
    const hit = lower.indexOf(needle);
    if (hit < 0 || source.length <= maxChars) {
      return { text: source.slice(0, maxChars), truncated: source.length > maxChars, sourceChars: source.length };
    }
    const marker = '[...]\n';
    const usable = Math.max(needle.length, maxChars - marker.length * 2);
    let start = Math.max(0, hit - Math.floor((usable - needle.length) / 2));
    let end = Math.min(source.length, start + usable);
    if (end - start < usable) start = Math.max(0, end - usable);
    let result = source.slice(start, end);
    if (start > 0) result = `${marker}${result}`;
    if (end < source.length) result = `${result}${marker}`;
    return { text: result.slice(0, maxChars), truncated: true, sourceChars: source.length };
  }

  function integerArg(value, fallback, min, max, label) {
    if (value === undefined || value === null) return fallback;
    const parsed = value;
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw { code: 'invalid_tool_args', message: `${label} must be an integer from ${min} to ${max}.` };
    }
    return parsed;
  }

  function assertArgs(args, definition) {
    if (args === undefined || args === null) args = {};
    if (!isObject(args)) throw { code: 'invalid_tool_args', message: 'Tool arguments must be an object.' };
    const schema = definition.parameters;
    const accepted = Object.keys(schema.properties || {});
    const unknown = Object.keys(args).filter(key => !accepted.includes(key));
    if (unknown.length) {
      throw {
        code: 'invalid_tool_args',
        message: `Unexpected argument key(s): ${unknown.join(', ')}. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
      };
    }
    const missing = (schema.required || []).filter(key => args[key] === undefined || args[key] === null);
    if (missing.length) {
      throw {
        code: 'invalid_tool_args',
        message: `Missing required key(s): ${missing.join(', ')}. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
      };
    }
    for (const [key, property] of Object.entries(schema.properties || {})) {
      if (args[key] === undefined || args[key] === null) continue;
      const value = args[key];
      const validType = property.type === 'string'
        ? typeof value === 'string'
        : property.type === 'integer'
          ? Number.isSafeInteger(value)
          : property.type === 'array'
            ? Array.isArray(value)
            : true;
      if (!validType) {
        throw {
          code: 'invalid_tool_args',
          message: `${key} has the wrong type; expected ${property.type}. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
        };
      }
      if (property.minLength !== undefined && value.length < property.minLength) {
        throw {
          code: 'invalid_tool_args',
          message: `${key} must contain at least ${property.minLength} character. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
        };
      }
      if (property.minimum !== undefined && value < property.minimum) {
        throw {
          code: 'invalid_tool_args',
          message: `${key} must be at least ${property.minimum}. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
        };
      }
      if (property.maximum !== undefined && value > property.maximum) {
        throw {
          code: 'invalid_tool_args',
          message: `${key} must be at most ${property.maximum}. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
        };
      }
      if (property.enum && !property.enum.includes(value)) {
        throw {
          code: 'invalid_tool_args',
          message: `${key} must be one of ${property.enum.join(', ')}. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
        };
      }
      if (property.items?.enum && Array.isArray(value) && value.some(item => !property.items.enum.includes(item))) {
        throw {
          code: 'invalid_tool_args',
          message: `${key} contains an unsupported value. Accepted values: ${property.items.enum.join(', ')}. Accepted keys: ${accepted.join(', ') || '(none)'}.`,
        };
      }
    }
    return args;
  }

  function boundedResult(value, maxChars) {
    const sourceChars = JSON.stringify(value).length;
    if (sourceChars <= maxChars) return value;
    const result = cloneJson(value);
    const data = result.data || {};
    const listKeys = ['actions', 'cards', 'memories'];
    let omittedRecords = 0;
    for (const key of listKeys) {
      if (!Array.isArray(data[key])) continue;
      while (data[key].length > 1 && JSON.stringify(result).length > maxChars) {
        data[key].pop();
        omittedRecords += 1;
      }
      if (omittedRecords) {
        data.omittedRecords = omittedRecords;
        if (typeof data.returned === 'number') data.returned = data[key].length;
        if (typeof data.omitted === 'number') data.omitted += omittedRecords;
      }
    }
    const clipLargestString = () => {
      let largest = null;
      const visit = (node, parent, key) => {
        if (typeof node === 'string' && (!largest || node.length > largest.value.length)) {
          largest = { parent, key, value: node };
          return;
        }
        if (Array.isArray(node)) node.forEach((item, index) => visit(item, node, index));
        else if (node && typeof node === 'object') {
          Object.entries(node).forEach(([childKey, child]) => visit(child, node, childKey));
        }
      };
      visit(result);
      const suffix = '\n[truncated]';
      if (!largest || largest.value.length <= suffix.length + 8) return false;
      const nextLength = Math.max(
        suffix.length + 8,
        Math.min(largest.value.length - 1, Math.floor(largest.value.length * 0.7))
      );
      largest.parent[largest.key] = `${largest.value.slice(0, nextLength - suffix.length)}${suffix}`;
      return true;
    };
    while (JSON.stringify(result).length > maxChars && clipLargestString()) {}
    result.truncated = true;
    result.sourceChars = sourceChars;
    result.data = {
      ...data,
      truncated: true,
      omittedRecords,
      message: 'Navigator returned a clipped result; use narrower retrieval arguments for omitted content.',
    };
    while (JSON.stringify(result).length > maxChars && clipLargestString()) {}
    return result;
  }

  function normalizeTriggers(card) {
    if (Array.isArray(card?.triggers)) return card.triggers.map(oneLine).filter(Boolean);
    return text(card?.keys).split(',').map(value => value.trim()).filter(Boolean);
  }

  function normalizeCard(card) {
    if (!card || card.deletedAt) return null;
    const id = card.id == null ? null : String(card.id);
    const keys = Array.isArray(card.keys) ? card.keys.join(', ') : text(card.keys);
    return {
      id,
      type: oneLine(card.type || 'other').toLowerCase(),
      title: oneLine(card.title || card.name || keys) || (id ? `Story Card ${id}` : 'Untitled Story Card'),
      notes: text(card.description),
      keys,
      triggers: normalizeTriggers({ ...card, keys }),
      value: text(card.value ?? card.entryText),
      updatedAt: typeof card.updatedAt === 'string' ? card.updatedAt : null,
      useForCharacterCreation: card.useForCharacterCreation === true,
    };
  }

  function currentIndex(index) {
    if (!index || !Array.isArray(index.cards)) {
      throw { code: 'unavailable', message: 'The current Navigator snapshot index is unavailable. Start a new turn and try again.' };
    }
    return index;
  }

  function cardField(card, field) {
    if (field === 'title') return card.title;
    if (field === 'triggers') return card.triggers.join(' ');
    if (field === 'type') return card.type;
    if (field === 'entry') return card.value;
    return card.notes;
  }

  function getStoryCard(shortId, args, index) {
    const id = oneLine(args.id);
    if (!id) throw { code: 'invalid_tool_args', message: 'get_story_card requires id. Accepted keys: id.' };
    const snapshot = currentIndex(index);
    const card = snapshot.cards.map(normalizeCard).filter(Boolean).find(candidate => candidate.id === id);
    if (!card) throw { code: 'not_found', message: 'No current Story Card matched that identifier.' };
    const entry = boundedText(card.value, MAX_CARD_ENTRY_CHARS);
    return {
      source: snapshot.source || 'unknown',
      adventureId: snapshot.adventureId || null,
      shortId: snapshot.shortId || shortId,
      capturedAtIso: snapshot.capturedAtIso || null,
      card: {
        id: card.id,
        type: card.type,
        title: card.title,
        description: boundedText(card.notes, 800).text,
        keys: boundedText(card.keys, 800).text,
        triggers: card.triggers.slice(0, 20),
        value: entry.text,
        entryTruncated: entry.truncated,
        useForCharacterCreation: card.useForCharacterCreation,
        updatedAt: card.updatedAt,
      },
      entrySourceChars: entry.sourceChars,
      entryTruncated: entry.truncated,
    };
  }

  function searchStoryCards(shortId, args, index) {
    const query = oneLine(args.query).toLowerCase();
    if (!query) throw { code: 'invalid_tool_args', message: 'query must be a non-empty string. Accepted keys: query, limit, type, fields.' };
    const limit = integerArg(args.limit, 5, 1, MAX_SEARCH_LIMIT, 'limit');
    const type = args.type === undefined ? null : oneLine(args.type).toLowerCase();
    const fields = args.fields === undefined ? ['title', 'triggers', 'type', 'entry', 'notes'] : args.fields;
    if (!Array.isArray(fields) || !fields.length || fields.some(field => !['title', 'triggers', 'type', 'entry', 'notes'].includes(field))) {
      throw { code: 'invalid_tool_args', message: 'fields must contain only title, triggers, type, entry, or notes. Accepted keys: query, limit, type, fields.' };
    }
    const snapshot = currentIndex(index);
    const ranked = [];
    snapshot.cards.map(normalizeCard).filter(Boolean).forEach((card, directoryIndex) => {
      if (type && card.type !== type) return;
      const hits = fields.filter(field => text(cardField(card, field)).toLowerCase().includes(query));
      if (!hits.length) return;
      const score = hits.reduce((best, field) => Math.max(best, field === 'title' || field === 'triggers' ? 4 : field === 'type' ? 3 : field === 'entry' ? 2 : 1), 0);
      ranked.push({ card, hits, score, directoryIndex });
    });
    ranked.sort((left, right) => right.score - left.score || left.directoryIndex - right.directoryIndex);
    const records = [];
    let used = 0;
    for (const match of ranked.slice(0, limit)) {
      const field = match.hits.slice().sort((left, right) => (
        (left === 'title' || left === 'triggers' ? 4 : left === 'type' ? 3 : left === 'entry' ? 2 : 1) -
        (right === 'title' || right === 'triggers' ? 4 : right === 'type' ? 3 : right === 'entry' ? 2 : 1)
      ))[0];
      const preview = matchPreview(cardField(match.card, field), query, MAX_SEARCH_PREVIEW_CHARS);
      const record = {
        id: match.card.id,
        type: match.card.type,
        title: match.card.title,
        matchedFields: match.hits,
        preview: preview.text,
        previewField: field,
        previewTruncated: preview.truncated,
      };
      const next = JSON.stringify(record).length;
      if (records.length && used + next > MAX_SEARCH_RESULT_CHARS - 700) break;
      records.push(record);
      used += next;
    }
    return {
      source: snapshot.source || 'unknown',
      adventureId: snapshot.adventureId || null,
      shortId: snapshot.shortId || shortId,
      capturedAtIso: snapshot.capturedAtIso || null,
      query,
      totalMatches: ranked.length,
      returned: records.length,
      omitted: Math.max(0, ranked.length - records.length),
      cards: records,
    };
  }

  function currentActions(index) {
    const snapshot = currentIndex(index);
    if (!Array.isArray(snapshot.actions)) throw { code: 'unavailable', message: 'Story history is unavailable in this snapshot.' };
    return snapshot.actions;
  }

  function currentMemories(index) {
    const snapshot = currentIndex(index);
    if (!Array.isArray(snapshot.memories)) throw { code: 'unavailable', message: 'Memory Bank is unavailable in this snapshot.' };
    return snapshot.memories;
  }

  function searchStoryHistory(shortId, args, index) {
    const query = oneLine(args.query).toLowerCase();
    if (!query) throw { code: 'invalid_tool_args', message: 'query must be a non-empty string. Accepted keys: query, limit, order.' };
    const limit = integerArg(args.limit, 5, 1, MAX_SEARCH_LIMIT, 'limit');
    const order = args.order === 'oldest-first' ? 'oldest-first' : 'newest-first';
    const actions = currentActions(index);
    const matches = actions.map((action, actionIndex) => {
      const lower = text(action.text).toLowerCase();
      let count = 0;
      let offset = 0;
      while ((offset = lower.indexOf(query, offset)) >= 0) {
        count += 1;
        offset += Math.max(1, query.length);
      }
      return count ? { action, actionIndex, count } : null;
    }).filter(Boolean);
    const ordered = matches.sort((left, right) => (
      order === 'oldest-first'
        ? left.actionIndex - right.actionIndex || right.count - left.count
        : right.actionIndex - left.actionIndex || right.count - left.count
    ));
    return {
      source: index.source || 'unknown',
      query,
      order,
      totalMatches: ordered.length,
      returned: Math.min(limit, ordered.length),
      actions: ordered.slice(0, limit).map(match => ({
        actionId: String(match.action.id),
        index: match.actionIndex,
        type: match.action.type || null,
        preview: matchPreview(match.action.text, query, MAX_SEARCH_PREVIEW_CHARS).text,
      })),
    };
  }

  function getStoryActions(shortId, args, index) {
    const hasId = args.actionId !== undefined;
    const hasIndex = args.fromIndex !== undefined;
    if (hasId === hasIndex) {
      throw { code: 'invalid_tool_args', message: 'Supply exactly one of actionId or fromIndex. Accepted keys: actionId, fromIndex, count, direction.' };
    }
    const actions = currentActions(index);
    const anchor = hasId
      ? actions.findIndex(action => String(action.id) === String(args.actionId))
      : integerArg(args.fromIndex, 0, 0, Math.max(0, actions.length - 1), 'fromIndex');
    if (anchor < 0 || anchor >= actions.length) throw { code: 'not_found', message: 'No action matched the supplied anchor.' };
    const count = integerArg(args.count, 10, 1, MAX_ACTION_WINDOW, 'count');
    const direction = args.direction || 'around';
    if (!['before', 'after', 'around'].includes(direction)) {
      throw { code: 'invalid_tool_args', message: 'direction must be before, after, or around. Accepted keys: actionId, fromIndex, count, direction.' };
    }
    let indices;
    if (direction === 'before') indices = Array.from({ length: count }, (_, offset) => anchor - count + offset);
    else if (direction === 'after') indices = Array.from({ length: count }, (_, offset) => anchor + 1 + offset);
    else {
      const before = Math.floor((count - 1) / 2);
      indices = Array.from({ length: count }, (_, offset) => anchor - before + offset);
    }
    const valid = indices.filter(value => value >= 0 && value < actions.length);
    const selected = [];
    let used = 0;
    let clippedByChars = false;
    const actionBudget = MAX_ACTION_WINDOW_CHARS - 700;
    for (const actionIndex of valid) {
      const action = actions[actionIndex];
      const remaining = Math.max(80, actionBudget - used - 180);
      const clippedText = boundedText(action.text, remaining);
      const selectedAction = {
        index: actionIndex,
        id: String(action.id),
        type: action.type || null,
        text: clippedText.text,
        textSourceChars: clippedText.sourceChars,
        textTruncated: clippedText.truncated,
      };
      const serialized = JSON.stringify(selectedAction).length;
      if (selected.length && used + serialized > actionBudget) {
        clippedByChars = true;
        break;
      }
      if (clippedText.truncated) clippedByChars = true;
      selected.push(selectedAction);
      used += serialized;
    }
    return {
      source: index.source || 'unknown',
      anchor: { actionId: String(actions[anchor].id), index: anchor },
      direction,
      requestedCount: count,
      fromIndex: selected.length ? selected[0].index : null,
      toIndex: selected.length ? selected[selected.length - 1].index : null,
      totalActions: actions.length,
      clipped: valid.length > selected.length || clippedByChars,
      clippedByCount: valid.length < indices.length,
      clippedByChars,
      actions: selected,
    };
  }

  function searchMemoryBank(shortId, args, index) {
    const query = oneLine(args.query).toLowerCase();
    if (!query) throw { code: 'invalid_tool_args', message: 'query must be a non-empty string. Accepted keys: query, limit.' };
    const limit = integerArg(args.limit, 5, 1, MAX_SEARCH_LIMIT, 'limit');
    const memories = currentMemories(index);
    const matches = memories.map((memory, memoryIndex) => {
      const count = text(memory.text).toLowerCase().split(query).length - 1;
      return count ? { memory, index: memoryIndex, count } : null;
    }).filter(Boolean);
    return {
      source: index.source || 'unknown',
      query,
      totalMatches: matches.length,
      returned: Math.min(limit, matches.length),
      memories: matches.slice(0, limit).map(match => ({
        id: match.memory.id || null,
        index: match.index,
        preview: matchPreview(match.memory.text, query, MAX_SEARCH_PREVIEW_CHARS).text,
      })),
    };
  }

  function getMemory(shortId, args, index) {
    if (args.id === undefined && args.index === undefined) {
      throw { code: 'invalid_tool_args', message: 'Supply either id or index to get_memory.' };
    }
    const memories = currentMemories(index);
    let memoryIndex;
    if (args.id !== undefined) {
      const id = oneLine(args.id);
      memoryIndex = memories.findIndex(memory => String(memory.id || memory.actionIds?.[0] || '') === id);
      if (memoryIndex < 0) throw { code: 'not_found', message: 'No Memory Bank entry matched that identifier.' };
    } else {
      memoryIndex = integerArg(args.index, 0, 0, Math.max(0, memories.length - 1), 'index');
    }
    const memory = memories[memoryIndex];
    if (!memory) throw { code: 'not_found', message: 'No Memory Bank entry matched that index.' };
    const result = boundedText(memory.text, MAX_MEMORY_CHARS);
    return {
      source: index.source || 'unknown',
      id: memory.id || null,
      index: memoryIndex,
      text: result.text,
      sourceChars: result.sourceChars,
      truncated: result.truncated,
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
      if (options.signal?.aborted) throw { code: 'aborted', message: 'Navigator tool execution was stopped.', retryable: false };
      const definition = DEFINITIONS.find(candidate => candidate.name === name);
      if (!definition) throw { code: 'unknown_tool', message: `Navigator read tool '${name}' is not available.` };
      const args = assertArgs(rawArgs, definition);
      let result;
      switch (name) {
        case 'get_story_card': result = getStoryCard(this.shortId, args, options.index); break;
        case 'search_story_cards': result = searchStoryCards(this.shortId, args, options.index); break;
        case 'search_story_history': result = searchStoryHistory(this.shortId, args, options.index); break;
        case 'get_story_actions': result = getStoryActions(this.shortId, args, options.index); break;
        case 'search_memory_bank': result = searchMemoryBank(this.shortId, args, options.index); break;
        case 'get_memory': result = getMemory(this.shortId, args, options.index); break;
        default: throw { code: 'unknown_tool', message: `Navigator read tool '${name}' is not available.` };
      }
      const envelope = {
        ok: true,
        tool: name,
        capturedAtIso: options.index?.capturedAtIso || new Date().toISOString(),
        data: result,
      };
      const resultLimit = name === 'search_story_cards'
        ? MAX_SEARCH_RESULT_CHARS
        : name === 'get_story_card'
          ? MAX_CARD_RESULT_CHARS
          : name === 'get_story_actions'
            ? MAX_ACTION_RESULT_CHARS
            : name === 'get_memory'
              ? MAX_MEMORY_CHARS + 1000
              : MAX_SEARCH_RESULT_CHARS;
      return boundedResult(envelope, resultLimit);
    }
  }

  NavigatorTools.DEFINITIONS = DEFINITIONS;
  NavigatorTools.MAX_CARD_RESULT_CHARS = MAX_CARD_RESULT_CHARS;
  NavigatorTools.MAX_SEARCH_RESULT_CHARS = MAX_SEARCH_RESULT_CHARS;
  window.NavigatorTools = NavigatorTools;

  if (typeof module !== 'undefined' && module.exports) module.exports = NavigatorTools;
})();
