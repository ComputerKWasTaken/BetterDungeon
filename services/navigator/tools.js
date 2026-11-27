// BetterDungeon - Navigator Read Tools
//
// Typed, bounded, read-only access to the turn-bound adventure snapshot.

(function () {
  if (typeof window === 'undefined' || window.NavigatorTools) return;

  const MAX_CARD_ENTRY_CHARS = 4000;
  const MAX_CARD_RESULT_CHARS = 6000;
  const MAX_SEARCH_RESULT_CHARS = 4000;
  const MAX_SEARCH_PREVIEW_CHARS = 200;
  const MAX_SEARCH_LIMIT = 10;
  const MAX_LIST_LIMIT = 25;
  const MAX_ACTION_WINDOW = 20;
  const MAX_ACTION_WINDOW_CHARS = 6000;
  const MAX_ACTION_RESULT_CHARS = 7000;
  const MAX_MEMORY_CHARS = 3000;
  const MAX_PLOT_COMPONENT_CHARS = 6000;
  const MAX_PLOT_RESULT_CHARS = 12000;
  const PLOT_COMPONENTS = Object.freeze({
    ai_instructions: { label: 'AI Instructions', field: 'instructions' },
    plot_essentials: { label: 'Plot Essentials', field: 'memory' },
    authors_note: { label: "Author's Note", field: 'authorsNote' },
    story_summary: { label: 'Story Summary', field: 'storySummary' },
  });
  const DEFINITIONS = Object.freeze([
    {
      name: 'get_plot_components',
      description: 'Read current Plot Components (defaults to all four) and Third Person state.',
      parameters: {
        type: 'object',
        properties: {
          components: {
            type: 'array',
            items: { type: 'string', enum: Object.keys(PLOT_COMPONENTS) },
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'get_story_card',
      description: 'Read one Story Card by stable ID.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_story_cards',
      description: 'Search Story Cards by substring, or omit query to list directory entries.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT },
          type: { type: 'string' },
          fields: {
            type: 'array',
            items: { type: 'string', enum: ['title', 'triggers', 'type', 'entry', 'notes'] },
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'search_story_history',
      description: 'Search story actions by substring; returns indices for get_story_actions.',
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
      description: 'Read up to 20 story actions around an actionId/fromIndex, or the latest actions when no anchor is supplied.',
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
      description: 'Search Memory Bank by substring, or omit query to list newest memories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'get_memory',
      description: 'Read one Memory Bank entry by stable ID or index.',
      parameters: {
        type: 'object',
        properties: { index: { type: 'integer', minimum: 0 }, id: { type: 'string', minLength: 1 } },
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
    const markClippedField = path => {
      const key = path.join('.');
      const cardFlags = {
        'data.card.type': 'typeTruncated',
        'data.card.title': 'titleTruncated',
        'data.card.description': 'notesTruncated',
        'data.card.keys': 'keysTruncated',
        'data.card.value': 'entryTruncated',
      };
      if (cardFlags[key] && data.card) data.card[cardFlags[key]] = true;
      if (key === 'data.card.value') data.entryTruncated = true;
      if (/^data\.card\.triggers\.\d+$/.test(key) && data.card) data.card.triggersTruncated = true;
      const componentMatch = key.match(/^data\.components\.(\d+)\.content$/);
      if (componentMatch && data.components?.[Number(componentMatch[1])]) {
        const component = data.components[Number(componentMatch[1])];
        component.truncated = true;
        component.returnedChars = component.content.length;
      }
    };
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
    const clippedPaths = new Set();
    const clipLargestString = () => {
      let largest = null;
      const visit = (node, parent, key, path = []) => {
        if (typeof node === 'string' && (!largest || node.length > largest.value.length)) {
          largest = { parent, key, value: node, path };
          return;
        }
        if (Array.isArray(node)) node.forEach((item, index) => visit(item, node, index, [...path, index]));
        else if (node && typeof node === 'object') {
          Object.entries(node).forEach(([childKey, child]) => visit(child, node, childKey, [...path, childKey]));
        }
      };
      visit(result, null, null, []);
      const suffix = '\n[truncated]';
      if (!largest || largest.value.length <= suffix.length + 8) return false;
      const nextLength = Math.max(
        suffix.length + 8,
        Math.min(largest.value.length - 1, Math.floor(largest.value.length * 0.7))
      );
      largest.parent[largest.key] = `${largest.value.slice(0, nextLength - suffix.length)}${suffix}`;
      clippedPaths.add(largest.path.join('.'));
      markClippedField(largest.path);
      return true;
    };
    while (JSON.stringify(result).length > maxChars && clipLargestString()) {}
    result.truncated = true;
    result.sourceChars = sourceChars;
    result.data = {
      ...data,
      truncated: true,
      omittedRecords,
      clippedFields: [...clippedPaths],
      message: 'Navigator returned a clipped result; use narrower retrieval arguments for omitted content.',
    };
    while (JSON.stringify(result).length > maxChars && clipLargestString()) {}
    result.data.clippedFields = [...clippedPaths];
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

  function getPlotComponents(shortId, args, index) {
    const snapshot = currentIndex(index);
    if (!snapshot.adventure) {
      throw { code: 'unavailable', message: 'Plot Components are unavailable in the current Navigator snapshot.' };
    }
    const requested = args.components === undefined ? Object.keys(PLOT_COMPONENTS) : args.components;
    if (!Array.isArray(requested) || !requested.length || requested.some(name => !PLOT_COMPONENTS[name])) {
      throw {
        code: 'invalid_tool_args',
        message: `components must contain one or more of: ${Object.keys(PLOT_COMPONENTS).join(', ')}.`,
      };
    }
    const unique = [...new Set(requested)];
    const perComponentLimit = Math.min(
      MAX_PLOT_COMPONENT_CHARS,
      Math.max(1000, Math.floor(10000 / unique.length))
    );
    return {
      thirdPerson: snapshot.adventure.thirdPerson === true,
      components: unique.map(component => {
        const config = PLOT_COMPONENTS[component];
        const bounded = boundedText(snapshot.adventure[config.field], perComponentLimit);
        const item = {
          component,
          label: config.label,
          content: bounded.text,
          populated: bounded.sourceChars > 0,
        };
        if (bounded.truncated) {
          item.truncated = true;
          item.sourceChars = bounded.sourceChars;
        }
        return item;
      }),
    };
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
    if (!id) throw { code: 'invalid_tool_args', message: 'get_story_card requires id.' };
    const snapshot = currentIndex(index);
    const card = snapshot.cards.map(normalizeCard).filter(Boolean).find(candidate => candidate.id === id);
    if (!card) throw { code: 'not_found', message: 'No current Story Card matched that identifier.' };
    const type = boundedText(card.type, 160);
    const title = boundedText(card.title, 300);
    const notes = boundedText(card.notes, 800);
    const keys = boundedText(card.keys, 800);
    const entry = boundedText(card.value, MAX_CARD_ENTRY_CHARS);
    const record = {
      id: card.id,
      type: type.text,
      title: title.text,
      keys: keys.text,
      value: entry.text,
      description: notes.text,
    };
    if (card.useForCharacterCreation) record.useForCharacterCreation = true;
    if (card.updatedAt) record.updatedAt = card.updatedAt;
    if (type.truncated) { record.typeTruncated = true; record.typeSourceChars = type.sourceChars; }
    if (title.truncated) { record.titleTruncated = true; record.titleSourceChars = title.sourceChars; }
    if (keys.truncated) { record.keysTruncated = true; record.keysSourceChars = keys.sourceChars; }
    if (entry.truncated) { record.entryTruncated = true; record.entrySourceChars = entry.sourceChars; }
    if (notes.truncated) { record.notesTruncated = true; record.notesSourceChars = notes.sourceChars; }
    return {
      card: record,
      ...(entry.truncated ? { entryTruncated: true, entrySourceChars: entry.sourceChars } : {}),
    };
  }

  function searchStoryCards(shortId, args, index) {
    const query = args.query === undefined ? '' : oneLine(args.query).toLowerCase();
    const type = args.type === undefined ? null : oneLine(args.type).toLowerCase();
    const snapshot = currentIndex(index);
    const allCards = snapshot.cards.map(normalizeCard).filter(Boolean);
    if (!query) {
      const limit = integerArg(args.limit, 15, 1, MAX_LIST_LIMIT, 'limit');
      const filtered = allCards
        .filter(card => !type || card.type === type)
        .sort((left, right) => (
          left.type.localeCompare(right.type, 'en', { sensitivity: 'base' }) ||
          left.title.localeCompare(right.title, 'en', { sensitivity: 'base' }) ||
          String(left.id || '').localeCompare(String(right.id || ''), 'en')
        ));
      const records = filtered.slice(0, limit).map(card => ({
        id: card.id,
        type: card.type,
        title: card.title,
      }));
      return {
        totalMatches: filtered.length,
        returned: records.length,
        omitted: Math.max(0, filtered.length - records.length),
        cards: records,
      };
    }
    const limit = integerArg(args.limit, 5, 1, MAX_SEARCH_LIMIT, 'limit');
    const fields = args.fields === undefined ? ['title', 'triggers', 'type', 'entry', 'notes'] : args.fields;
    if (!Array.isArray(fields) || !fields.length || fields.some(field => !['title', 'triggers', 'type', 'entry', 'notes'].includes(field))) {
      throw { code: 'invalid_tool_args', message: 'fields must contain only title, triggers, type, entry, or notes.' };
    }
    const ranked = [];
    allCards.forEach((card, directoryIndex) => {
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
        ...(preview.truncated ? { previewTruncated: true } : {}),
      };
      const next = JSON.stringify(record).length;
      if (records.length && used + next > MAX_SEARCH_RESULT_CHARS - 600) break;
      records.push(record);
      used += next;
    }
    return {
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
    if (!query) throw { code: 'invalid_tool_args', message: 'query must be a non-empty string.' };
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
    if (hasId && hasIndex) {
      throw { code: 'invalid_tool_args', message: 'Supply at most one of actionId or fromIndex.' };
    }
    const actions = currentActions(index);
    const count = integerArg(args.count, 10, 1, MAX_ACTION_WINDOW, 'count');
    if (!actions.length) {
      return { totalActions: 0, fromIndex: null, toIndex: null, clipped: false, actions: [] };
    }
    let anchor;
    let direction;
    let indices;
    if (!hasId && !hasIndex) {
      anchor = actions.length - 1;
      direction = 'latest';
      const start = Math.max(0, actions.length - count);
      indices = Array.from({ length: actions.length - start }, (_, offset) => start + offset);
    } else {
      anchor = hasId
        ? actions.findIndex(action => String(action.id) === String(args.actionId))
        : integerArg(args.fromIndex, 0, 0, Math.max(0, actions.length - 1), 'fromIndex');
      if (anchor < 0 || anchor >= actions.length) throw { code: 'not_found', message: 'No action matched the supplied anchor.' };
      direction = args.direction || 'around';
      if (!['before', 'after', 'around'].includes(direction)) {
        throw { code: 'invalid_tool_args', message: 'direction must be before, after, or around.' };
      }
      if (direction === 'before') indices = Array.from({ length: count }, (_, offset) => anchor - count + offset);
      else if (direction === 'after') indices = Array.from({ length: count }, (_, offset) => anchor + 1 + offset);
      else {
        const before = Math.floor((count - 1) / 2);
        indices = Array.from({ length: count }, (_, offset) => anchor - before + offset);
      }
    }
    const valid = indices.filter(value => value >= 0 && value < actions.length);
    const selected = [];
    let used = 0;
    let clippedByChars = false;
    const actionBudget = MAX_ACTION_WINDOW_CHARS - 500;
    const orderedValid = direction === 'latest' ? valid.slice().reverse() : valid;
    for (const actionIndex of orderedValid) {
      const action = actions[actionIndex];
      const remaining = Math.max(80, actionBudget - used - 140);
      const clippedText = boundedText(action.text, remaining);
      const selectedAction = {
        index: actionIndex,
        id: String(action.id),
        ...(action.type ? { type: action.type } : {}),
        text: clippedText.text,
        ...(clippedText.truncated ? { textTruncated: true, textSourceChars: clippedText.sourceChars } : {}),
      };
      const serialized = JSON.stringify(selectedAction).length;
      if (selected.length && used + serialized > actionBudget) {
        clippedByChars = true;
        break;
      }
      if (clippedText.truncated) clippedByChars = true;
      if (direction === 'latest') selected.unshift(selectedAction);
      else selected.push(selectedAction);
      used += serialized;
    }
    return {
      anchor: { actionId: String(actions[anchor].id), index: anchor },
      direction,
      fromIndex: selected.length ? selected[0].index : null,
      toIndex: selected.length ? selected[selected.length - 1].index : null,
      totalActions: actions.length,
      clipped: valid.length > selected.length || clippedByChars,
      actions: selected,
    };
  }

  function searchMemoryBank(shortId, args, index) {
    const query = args.query === undefined ? '' : oneLine(args.query).toLowerCase();
    const limit = integerArg(args.limit, 5, 1, MAX_SEARCH_LIMIT, 'limit');
    const memories = currentMemories(index);
    if (!query) {
      const recent = memories.map((memory, memoryIndex) => ({ memory, index: memoryIndex }))
        .slice(-limit)
        .reverse();
      return {
        totalMatches: memories.length,
        returned: recent.length,
        memories: recent.map(item => ({
          id: item.memory.id || null,
          index: item.index,
          preview: boundedText(item.memory.text, MAX_SEARCH_PREVIEW_CHARS).text,
        })),
      };
    }
    const matches = memories.map((memory, memoryIndex) => {
      const count = text(memory.text).toLowerCase().split(query).length - 1;
      return count ? { memory, index: memoryIndex, count } : null;
    }).filter(Boolean);
    return {
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
      id: memory.id || null,
      index: memoryIndex,
      text: result.text,
      ...(result.truncated ? { truncated: true, sourceChars: result.sourceChars } : {}),
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
        case 'get_plot_components': result = getPlotComponents(this.shortId, args, options.index); break;
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
        data: result,
      };
      const resultLimit = name === 'get_plot_components'
        ? MAX_PLOT_RESULT_CHARS
        : name === 'search_story_cards'
          ? MAX_SEARCH_RESULT_CHARS
          : name === 'get_story_card'
            ? MAX_CARD_RESULT_CHARS
            : name === 'get_story_actions'
              ? MAX_ACTION_RESULT_CHARS
              : name === 'get_memory'
                ? MAX_MEMORY_CHARS + 800
                : MAX_SEARCH_RESULT_CHARS;
      return boundedResult(envelope, resultLimit);
    }
  }

  NavigatorTools.DEFINITIONS = DEFINITIONS;
  NavigatorTools.MAX_CARD_RESULT_CHARS = MAX_CARD_RESULT_CHARS;
  NavigatorTools.MAX_SEARCH_RESULT_CHARS = MAX_SEARCH_RESULT_CHARS;
  NavigatorTools.MAX_PLOT_RESULT_CHARS = MAX_PLOT_RESULT_CHARS;
  window.NavigatorTools = NavigatorTools;

  if (typeof module !== 'undefined' && module.exports) module.exports = NavigatorTools;
})();
