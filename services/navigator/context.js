// BetterDungeon - Navigator Context
//
// Builds a bounded, read-only snapshot of the current adventure from the live
// action cache plus authenticated GraphQL Plot Component and Story Card reads.

(function () {
  if (typeof window === 'undefined' || window.NavigatorContext) return;

  const BUDGETS = Object.freeze({
    systemInstruction: 20000,
    identity: 400,
    actionText: 1500,
    directoryTitle: 120,
    historyCeiling: 6000,
    historyMaxActions: 10,
    memoryBankCeiling: 4000,
    cardDirectoryCeiling: 4000,
    unmeasuredFramingReserve: 600,
    plotComponentsCeiling: 8000,
    plotFieldFloor: 160,
    historyFloorActions: 6,
    degradedPrimerMinimum: 256,
  });
  const TRUNCATION_MARKER = '\n[truncated to Navigator context budget]';
  const CLOSING_MARKER = '=== END ADVENTURE SNAPSHOT ===';
  const SECTION_SEPARATORS = Object.freeze({
    history: '\n\n',
    memory: '\n\n',
    cards: '\n',
  });
  function stringValue(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  function oneLine(value, fallback = '') {
    return stringValue(value).replace(/\s+/g, ' ').trim() || fallback;
  }

  function truncate(value, maxChars) {
    const source = stringValue(value);
    if (source.length <= maxChars) {
      return { text: source, truncated: false, sourceChars: source.length, boundary: 'none' };
    }
    if (maxChars <= TRUNCATION_MARKER.length) {
      return { text: source.slice(0, Math.max(0, maxChars)), truncated: true, sourceChars: source.length, boundary: 'hard' };
    }
    const limit = maxChars - TRUNCATION_MARKER.length;
    const candidate = source.slice(0, limit);
    const paragraph = candidate.lastIndexOf('\n\n');
    const matches = [...candidate.matchAll(/[.!?](?=\s|$)/g)];
    const sentence = matches.length ? matches[matches.length - 1].index + 1 : -1;
    const word = candidate.search(/\s(?=\S*$)/);
    const cut = paragraph >= limit * 0.45
      ? paragraph
      : sentence >= limit * 0.55
        ? sentence
        : word >= limit * 0.65 ? word : limit;
    return {
      text: `${source.slice(0, cut).trimEnd()}${TRUNCATION_MARKER}`,
      truncated: true,
      sourceChars: source.length,
      boundary: cut === paragraph ? 'paragraph' : cut === sentence ? 'sentence' : cut === word ? 'word' : 'hard',
    };
  }

  function numericId(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function renderAction(action) {
    const id = oneLine(action.id, '?');
    const type = oneLine(action.type);
    const prefix = `[Action ${id}${type ? ` · ${type}` : ''}] `;
    const body = truncate(stringValue(action.text).trim(), Math.max(1, BUDGETS.actionText - prefix.length));
    return { text: `${prefix}${body.text}`, truncated: body.truncated };
  }

  function estimateActionsChars(actions) {
    if (!actions.length) return 0;
    let total = Math.max(0, actions.length - 1) * SECTION_SEPARATORS.history.length;
    for (const action of actions) {
      total += Math.min(BUDGETS.actionText, stringValue(action.text).trim().length + 24);
    }
    return total;
  }

  function buildRecentActions(actions, budget, maxActions = BUDGETS.historyMaxActions) {
    const totalActions = actions.length;
    const sourceChars = estimateActionsChars(actions);
    const windowedActions = Number.isFinite(maxActions) && maxActions >= 0
      ? (maxActions === 0 ? [] : actions.slice(-maxActions))
      : actions;
    const rendered = windowedActions.map(action => ({ action, ...renderAction(action) }));
    const floorCount = Math.min(BUDGETS.historyFloorActions, rendered.length);
    const floor = rendered.slice(-floorCount);
    const older = rendered.slice(0, Math.max(0, rendered.length - floor.length));
    const selected = [];
    let used = 0;
    const add = item => {
      const separator = selected.length ? SECTION_SEPARATORS.history.length : 0;
      const remaining = budget - used - separator;
      if (remaining <= 0) return true;
      const clipped = item.text.length > remaining ? truncate(item.text, remaining) : item;
      selected.unshift({ action: item.action, text: clipped.text, truncated: item.truncated || clipped.truncated });
      used += separator + clipped.text.length;
      return clipped.text.length >= remaining;
    };
    for (let index = floor.length - 1; index >= 0 && !add(floor[index]); index -= 1) {}
    for (let index = older.length - 1; index >= 0 && used < budget && !add(older[index]); index -= 1) {}
    const output = selected.length
      ? selected.map(item => item.text).join(SECTION_SEPARATORS.history)
      : '(No live story actions are available in the current page cache.)';
    const budgetTruncated = selected.some(item => item.truncated) || selected.length < rendered.length;
    return {
      text: output,
      meta: {
        budgetChars: budget,
        sourceChars,
        includedChars: selected.length ? output.length : 0,
        total: totalActions,
        windowTotal: rendered.length,
        included: selected.length,
        floorIncluded: selected.filter(item => floor.some(candidate => candidate.action === item.action)).length,
        omitted: Math.max(0, totalActions - selected.length),
        windowed: rendered.length < totalActions,
        truncated: budgetTruncated,
        truncatedReason: budgetTruncated ? 'total budget' : null,
      },
    };
  }

  function directoryRow(card) {
    const title = truncate(oneLine(card.title, 'Untitled Story Card'), BUDGETS.directoryTitle);
    return `${oneLine(card.id, '?')} | ${oneLine(card.type, 'other')} | ${oneLine(title.text)}`;
  }

  function buildStoryCardDirectory(cards, budget, source) {
    const rows = cards.slice().sort((left, right) => (
      left.type.localeCompare(right.type, 'en', { sensitivity: 'base' }) ||
      left.title.localeCompare(right.title, 'en', { sensitivity: 'base' }) ||
      String(left.id || '').localeCompare(String(right.id || ''), 'en')
    )).map(directoryRow);
    const selected = [];
    let used = 0;
    for (const row of rows) {
      const separator = selected.length ? SECTION_SEPARATORS.cards.length : 0;
      if (used + separator + row.length > budget) break;
      selected.push(row);
      used += separator + row.length;
    }
    const emptyText = source === 'graphql' ? '(No Story Cards are present.)' : '(No Story Cards are available in the current page cache.)';
    const output = selected.length ? selected.join('\n') : truncate(emptyText, budget).text;
    return {
      text: output,
      meta: {
        budgetChars: budget,
        sourceChars: rows.reduce((sum, row) => sum + row.length, 0) +
          Math.max(0, rows.length - 1) * SECTION_SEPARATORS.cards.length,
        includedChars: selected.length ? output.length : 0,
        total: rows.length,
        included: selected.length,
        omitted: Math.max(0, rows.length - selected.length),
        source,
        truncated: selected.length < rows.length,
        truncatedReason: selected.length < rows.length ? 'total budget' : null,
      },
    };
  }

  function plotFields(adventure, provenance) {
    return [
      ['instructions', 'AI Instructions'],
      ['memory', 'Plot Essentials'],
      ['authorsNote', "Author's Note"],
      ['storySummary', 'Story Summary'],
    ].map(([key, label]) => {
      const sourceName = provenance[key] || (adventure ? 'unknown' : 'unavailable');
      return { key, label, source: stringValue(adventure?.[key]).trim(), available: sourceName !== 'unavailable', provenance: sourceName };
    });
  }

  function distributePlotBudget(fields, budget) {
    const overhead = fields.reduce((sum, field) => sum + field.label.length + 2, 0) + Math.max(0, fields.length - 1) * 2;
    const capacity = Math.max(0, budget - overhead);
    const allocations = fields.map(field => Math.min(
      field.available ? field.source.length || 8 : '(unavailable)'.length,
      BUDGETS.plotFieldFloor
    ));
    let total = allocations.reduce((sum, value) => sum + value, 0);
    while (total > capacity) {
      const index = allocations.findIndex(value => value > 1);
      if (index < 0) break;
      allocations[index] -= 1;
      total -= 1;
    }
    let spare = Math.max(0, capacity - total);
    for (const [index, field] of fields.entries()) {
      const sourceLength = field.available ? field.source.length || 8 : '(unavailable)'.length;
      field.remainingNeed = Math.max(0, sourceLength - allocations[index]);
    }
    while (spare > 0) {
      const totalNeed = fields.reduce((sum, field) => (
        sum + Math.max(0, field.remainingNeed)
      ), 0);
      if (!totalNeed) break;
      const shares = fields.map(field => (
        Math.min(field.remainingNeed, Math.floor(spare * field.remainingNeed / totalNeed))
      ));
      let distributed = shares.reduce((sum, share) => sum + share, 0);
      const remainders = fields.map((field, index) => ({
        index,
        remainder: field.remainingNeed
          ? (spare * field.remainingNeed / totalNeed) - shares[index]
          : -1,
      })).sort((left, right) => right.remainder - left.remainder);
      for (const item of remainders) {
        if (distributed >= spare) break;
        if (shares[item.index] < fields[item.index].remainingNeed) {
          shares[item.index] += 1;
          distributed += 1;
        }
      }
      if (!distributed) break;
      for (const [index, share] of shares.entries()) {
        allocations[index] += share;
        fields[index].remainingNeed -= share;
      }
      spare -= distributed;
    }
    return allocations;
  }

  function buildPlotComponents(adventure, provenance = {}, budget, selectedKeys = null) {
    const allFields = plotFields(adventure, provenance);
    const filterActive = Array.isArray(selectedKeys) && selectedKeys.length > 0;
    const fields = filterActive ? allFields.filter(field => selectedKeys.includes(field.key)) : allFields;
    const omittedPopulated = filterActive
      ? allFields.filter(field => !selectedKeys.includes(field.key) && field.source).map(field => field.label)
      : [];
    const totalSourceChars = allFields.reduce((sum, field) => sum + field.source.length, 0);
    const fullParts = fields.map(field => (
      `${field.label}:\n${field.available ? field.source || '(empty)' : '(unavailable)'}`
    ));
    const fullOutput = fullParts.join('\n\n');
    if (fullOutput.length <= budget) {
      const metas = {};
      for (const field of fields) {
        const value = field.available ? field.source || '(empty)' : '(unavailable)';
        metas[field.key] = {
          sourceChars: field.source.length,
          includedChars: field.source.length,
          maxChars: value.length,
          empty: !field.source,
          unavailable: !field.available,
          available: field.available,
          source: field.provenance,
          truncated: false,
          truncatedReason: null,
          boundary: 'none',
        };
      }
      return {
        text: fullOutput,
        meta: {
          budgetChars: budget,
          sourceChars: totalSourceChars,
          includedChars: fields.reduce((sum, field) => sum + field.source.length, 0),
          available: allFields.some(field => field.available),
          populated: allFields.filter(field => field.source).length,
          selectedLabels: fields.map(field => field.label),
          omittedPopulated,
          fields: metas,
          truncated: false,
        },
      };
    }
    const allocations = distributePlotBudget(fields, budget);
    const parts = [];
    const metas = {};
    for (const [index, field] of fields.entries()) {
      const value = field.available ? field.source || '(empty)' : '(unavailable)';
      const clipped = truncate(value, allocations[index]);
      parts.push(`${field.label}:\n${clipped.text}`);
      metas[field.key] = {
        sourceChars: field.source.length,
        includedChars: field.source.length
          ? Math.min(field.source.length, allocations[index])
          : 0,
        maxChars: allocations[index],
        empty: !field.source,
        unavailable: !field.available,
        available: field.available,
        source: field.provenance,
        truncated: clipped.truncated,
        truncatedReason: clipped.truncated ? 'total budget' : null,
        boundary: clipped.boundary,
      };
    }
    const output = parts.join('\n\n');
    return {
      text: output,
      meta: {
        budgetChars: budget,
        sourceChars: totalSourceChars,
        includedChars: Object.values(metas).reduce((sum, field) => sum + field.includedChars, 0),
        available: allFields.some(field => field.available),
        populated: allFields.filter(field => field.source).length,
        selectedLabels: fields.map(field => field.label),
        omittedPopulated,
        fields: metas,
        truncated: Object.values(metas).some(field => field.truncated),
      },
    };
  }

  function memoryText(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value.text === 'string') return value.text;
    return stringValue(value);
  }

  function buildMemoryBank(values, budget, available) {
    if (!available) {
      return {
        text: '(Memory Bank is unavailable from the current GraphQL fallback reader.)',
        meta: { budgetChars: budget, sourceChars: 0, includedChars: 0, total: null, included: null, omitted: null, unavailable: true, truncated: false, truncatedReason: null },
      };
    }
    const rows = values.map((value, index) => {
      const content = memoryText(value).trim();
      const idTag = value?.id ? ` · id:${value.id}` : '';
      return {
        text: `[Memory ${index + 1}${idTag}] ${content || '(empty)'}`,
        contentChars: content.length,
        prefixChars: `[Memory ${index + 1}${idTag}] `.length,
      };
    });
    const selected = [];
    let used = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      const separator = selected.length ? SECTION_SEPARATORS.memory.length : 0;
      if (used + separator + row.text.length <= budget) {
        selected.unshift(row);
        used += separator + row.text.length;
      } else if (!selected.length && budget > 0) {
        const clipped = truncate(row.text, budget);
        selected.unshift({
          text: clipped.text,
          contentChars: Math.min(row.contentChars, Math.max(0, clipped.text.length - row.prefixChars)),
          prefixChars: row.prefixChars,
        });
        break;
      } else {
        break;
      }
    }
    const output = selected.length
      ? selected.map(row => row.text).join(SECTION_SEPARATORS.memory)
      : '(No Memory Bank entries are available.)';
    return {
      text: output,
      meta: {
        budgetChars: budget,
        sourceChars: rows.reduce((sum, row) => sum + row.text.length, 0) +
          Math.max(0, rows.length - 1) * SECTION_SEPARATORS.memory.length,
        includedChars: selected.reduce((sum, row) => sum + row.contentChars, 0),
        total: rows.length,
        included: selected.length,
        omitted: Math.max(0, rows.length - selected.length),
        unavailable: false,
        truncated: selected.length < rows.length,
        truncatedReason: selected.length < rows.length ? 'total budget' : null,
      },
    };
  }

  function shrinkAllocation(allocation, key, overflow, floor, reasons) {
    const reduction = Math.min(overflow, Math.max(0, allocation[key] - floor));
    if (reduction > 0) {
      allocation[key] -= reduction;
      reasons[key] = 'total budget';
    }
    return reduction;
  }

  function sectionReason(key, meta, allocation, ceiling, reasons) {
    if (!meta.truncated) return null;
    if (reasons[key]) return reasons[key];
    return allocation[key] >= ceiling ? 'section ceiling' : 'total budget';
  }

  function skippedMeta(sourceMeta) {
    return {
      ...sourceMeta,
      budgetChars: 0,
      included: 0,
      includedChars: 0,
      omitted: sourceMeta.total === null ? null : sourceMeta.total,
      truncated: false,
      skipped: true,
      truncatedReason: 'on_demand',
    };
  }

  function droppedMeta(sourceMeta, budget, reason = 'total budget') {
    return {
      ...sourceMeta,
      budgetChars: budget,
      included: 0,
      includedChars: 0,
      omitted: sourceMeta.total === null ? null : sourceMeta.total,
      populated: sourceMeta.populated === undefined ? sourceMeta.populated : 0,
      truncated: true,
      truncatedReason: reason,
      dropped: true,
      fields: sourceMeta.fields
        ? Object.fromEntries(Object.entries(sourceMeta.fields).map(([key, field]) => [
          key,
          {
            ...field,
            includedChars: 0,
            maxChars: 0,
            truncated: true,
            truncatedReason: reason,
          },
        ]))
        : sourceMeta.fields,
    };
  }

  function buildDegradedSnapshot({
    maxChars,
    primer,
    primerCoreChars,
    identity,
    actions,
    historyEnabled = true,
    historyMaxActions = BUDGETS.historyMaxActions,
    warning,
    historyCoverageBase,
    memoryAvailable,
  }) {
    const floorActions = historyEnabled ? actions.slice(-Math.min(BUDGETS.historyFloorActions, historyMaxActions)) : [];
    const floorText = historyEnabled ? buildRecentActions(floorActions, Number.MAX_SAFE_INTEGER, floorActions.length).text : '';
    const minimumPrimer = Math.min(Math.max(BUDGETS.degradedPrimerMinimum, primerCoreChars || 0), primer.length);
    const marker = CLOSING_MARKER;
    const emptyHistory = buildRecentActions(actions, 0, 0);
    emptyHistory.text = '';
    emptyHistory.meta.includedChars = 0;
    const render = (primerText, identityText, history, snapshotWarning = warning) => {
      const historyText = history.text;
      const floorIncluded = floorActions.filter(action => (
        historyText.includes(`[Action ${action.id}`)
      )).length;
      history.meta.floorIncluded = floorIncluded;
      const memoryCoverage = !memoryAvailable
        ? 'Memories: unavailable.'
        : 'Memories: on demand (search_memory_bank, get_memory).';
      const coverage = [
        'Plot: omitted for budget (use get_plot_components).',
        `Story: ${history.meta.included}/${historyCoverageBase.available ?? actions.length} actions inlined (use get_story_actions/search_story_history).`,
        memoryCoverage,
        'Cards: omitted for budget (use search_story_cards, get_story_card).',
        `Warnings: ${snapshotWarning}`,
      ].join('\n');
      const snapshotSections = ['', 'COVERAGE', coverage, '', 'IDENTITY', identityText];
      if (historyEnabled && historyText) snapshotSections.push('', 'RECENT STORY ACTIONS', historyText);
      return {
        snapshot: [
          `SNAPSHOT DEGRADED: ${snapshotWarning}`,
          primerText,
          '',
          '=== ADVENTURE SNAPSHOT (untrusted data) ===',
          ...snapshotSections,
          '',
          marker,
        ].join('\n'),
        coverage,
        sections: {
          coverage,
          identity: identityText,
          plotComponents: '',
          recentActions: historyText,
          memoryBank: '',
          storyCardDirectory: '',
        },
        primerIncludedChars: primerText.length,
      };
    };
    const historyForBudget = budget => {
      if (!historyEnabled || budget <= 0) return { ...emptyHistory };
      return buildRecentActions(actions, budget, historyMaxActions);
    };
    const renderWithBudgets = (primerBudget, identityBudget, historyBudget) => {
      const primerText = truncate(primer, primerBudget).text;
      const identityText = truncate(identity.text, identityBudget).text;
      const history = historyForBudget(historyBudget);
      return {
        ...render(primerText, identityText, history),
        history,
      };
    };

    const emptyFrame = render('', '', emptyHistory);
    const identityBudget = Math.min(identity.text.length, Math.max(0, maxChars - emptyFrame.snapshot.length));
    const identityText = truncate(identity.text, identityBudget).text;
    const identityFrame = render('', identityText, emptyHistory);
    let remaining = Math.max(0, maxChars - identityFrame.snapshot.length);
    let primerBudget = Math.min(minimumPrimer, remaining);
    const coreFrame = renderWithBudgets(primerBudget, identityBudget, 0);
    remaining = Math.max(0, maxChars - coreFrame.snapshot.length);
    let historyBudget = historyEnabled ? Math.min(floorText.length, remaining) : 0;
    let rendered = renderWithBudgets(primerBudget, identityBudget, historyBudget);
    if (rendered.snapshot.length > maxChars && historyBudget > 0) {
      historyBudget = Math.max(0, historyBudget - (rendered.snapshot.length - maxChars));
      rendered = renderWithBudgets(primerBudget, identityBudget, historyBudget);
    }
    remaining = Math.max(0, maxChars - rendered.snapshot.length);
    primerBudget = Math.min(primer.length, primerBudget + remaining);
    rendered = renderWithBudgets(primerBudget, identityBudget, historyBudget);

    if (rendered.snapshot.length > maxChars) {
      const compactWarning = 'Context budget is very small; minimal framing retained.';
      const compactFrame = render('', '', emptyHistory, compactWarning);
      const compactIdentityBudget = Math.max(0, maxChars - compactFrame.snapshot.length);
      const compactIdentityText = truncate(identity.text, compactIdentityBudget).text;
      const compactIdentityFrame = render('', compactIdentityText, emptyHistory, compactWarning);
      const compactPrimerBudget = Math.max(0, maxChars - compactIdentityFrame.snapshot.length);
      const compact = render(
        truncate(primer, compactPrimerBudget).text,
        compactIdentityText,
        emptyHistory,
        compactWarning
      );
      rendered = { ...compact, history: emptyHistory, primerIncludedChars: compact.primerIncludedChars };
    }
    if (rendered.snapshot.length > maxChars) {
      const minimalWarning = 'Context budget is too small for full framing.';
      const minimalCoverage = `Story: 0/${actions.length} actions inlined.`;
      const minimalPrefix = [
        `SNAPSHOT DEGRADED: ${minimalWarning}`,
        'COVERAGE',
        minimalCoverage,
      ].join('\n');
      const minimalSuffix = `\n${marker}`;
      const minPrimerBudget = Math.max(0, maxChars - minimalPrefix.length - minimalSuffix.length - 1);
      const primerText = truncate(primer, minPrimerBudget).text;
      rendered = {
        snapshot: `${minimalPrefix}\n${primerText}${minimalSuffix}`,
        coverage: minimalCoverage,
        sections: {
          coverage: minimalCoverage,
          identity: '',
          plotComponents: '',
          recentActions: '',
          memoryBank: '',
          storyCardDirectory: '',
        },
        history: emptyHistory,
        primerIncludedChars: primerText.length,
      };
    }
    return rendered;
  }

  class NavigatorContext {
    constructor(shortId) {
      this.shortId = shortId || null;
    }

    async build(options = {}) {
      const signal = options.signal || null;
      const plan = options.plan || {};
      const planSections = plan.sections || {};
      const planBudgets = plan.budgets || {};
      const plotConfig = planSections.plot === undefined ? true : planSections.plot;
      const selectedPlotKeys = Array.isArray(plotConfig) ? plotConfig : null;
      const plotEnabled = plotConfig !== false && (!selectedPlotKeys || selectedPlotKeys.length > 0);
      const historyEnabled = planSections.history !== false;
      const cardsEnabled = planSections.cards !== false;
      const memoryEnabled = planSections.memory === true;
      const plotCeiling = plotEnabled
        ? (Number.isFinite(planBudgets.plot) ? Math.max(0, planBudgets.plot) : BUDGETS.plotComponentsCeiling)
        : 0;
      const historyCeiling = historyEnabled
        ? (Number.isFinite(planBudgets.history) ? Math.max(0, planBudgets.history) : BUDGETS.historyCeiling)
        : 0;
      const historyMaxActions = historyEnabled
        ? (Number.isFinite(planBudgets.maxActions) ? Math.max(0, planBudgets.maxActions) : BUDGETS.historyMaxActions)
        : 0;
      const cardsCeiling = cardsEnabled
        ? (Number.isFinite(planBudgets.cards) ? Math.max(0, planBudgets.cards) : BUDGETS.cardDirectoryCeiling)
        : 0;
      const memoryCeiling = memoryEnabled
        ? (Number.isFinite(planBudgets.memory) ? Math.max(0, planBudgets.memory) : BUDGETS.memoryBankCeiling)
        : 0;

      const maxChars = Number.isFinite(options.maxChars) ? Math.max(0, options.maxChars) : BUDGETS.systemInstruction;
      const ws = window.Ultrascripts?.ws || null;
      const resolvedShortId = this.shortId || ws?.getAdventureShortId?.() || null;
      const reader = window.BetterDungeonAdventureRead;
      if (!reader?.readAdventure) throw new Error('The BetterDungeon adventure reader is unavailable.');
      const adventureSnapshot = await reader.readAdventure({ shortId: resolvedShortId, signal });
      if (signal?.aborted) throw { code: 'aborted', message: 'Navigator context loading was stopped.', retryable: false };

      const adventure = { ...adventureSnapshot.identity, ...adventureSnapshot.plot };
      const actions = adventureSnapshot.actions || [];
      const cards = adventureSnapshot.storyCards || [];
      const memoryRead = !plan.skipMemoryRead && reader.readMemories
        ? await reader.readMemories({ shortId: resolvedShortId, signal })
        : { memories: adventureSnapshot.state?.memories ?? null, provenance: { source: adventureSnapshot.provenance?.state?.memories || 'unavailable' }, degradations: [] };
      const provenance = adventureSnapshot.provenance || { plot: {}, actions: { source: 'unknown' }, storyCards: { source: 'unknown' } };
      if (memoryRead.provenance) provenance.memoryBank = memoryRead.provenance;
      const readerCardSource = provenance.storyCards.source || 'unavailable';
      const cardSource = readerCardSource === 'storyCardCache' || readerCardSource === 'ws' ? 'cache' : readerCardSource;
      const primerCore = stringValue(window.NavigatorPrimer?.CORE || window.NavigatorPrimer?.TEXT);
      const primer = typeof window.NavigatorPrimer?.compose === 'function' && Array.isArray(plan.primerModules)
        ? window.NavigatorPrimer.compose(plan.primerModules)
        : [primerCore, window.NavigatorPrimer?.CORE ? stringValue(window.NavigatorPrimer?.REFERENCE) : ''].filter(Boolean).join('\n\n');
      if (!primer) throw new Error('Navigator primer is unavailable.');
      const primerReferenceChars = Math.max(0, primer.length - primerCore.length);

      const thirdPersonLabel = typeof adventure?.thirdPerson === 'boolean'
        ? (adventure.thirdPerson ? 'on' : 'off')
        : 'unknown';
      const identity = truncate(
        `Title: ${oneLine(adventure?.title, '(unavailable)')} | Actions: ${Number.isFinite(adventure?.actionCount) ? adventure.actionCount : 'unknown'} | Third-person: ${thirdPersonLabel}`,
        BUDGETS.identity
      );
      const memoryBank = Array.isArray(memoryRead.memories) ? memoryRead.memories : null;
      const memoryBankChars = memoryBank
        ? memoryBank.reduce((sum, item) => sum + memoryText(item).length, 0)
        : null;
      const summaryLag = {
        latestActionId: actions.length ? numericId(actions[actions.length - 1].id) : null,
        lastSummarizedActionId: adventureSnapshot.state?.lastSummarizedActionId,
        lastMemoryActionId: adventureSnapshot.state?.lastMemoryActionId,
      };
      const warnings = [];
      if (adventureSnapshot.historyIncomplete) warnings.push('Apollo history unavailable; only cached actions are visible.');
      for (const degradation of adventureSnapshot.degradations || []) {
        if (degradation.userVisible) warnings.push(`${degradation.section} data degraded: ${degradation.message}`);
      }
      for (const degradation of memoryRead.degradations || []) {
        if (degradation.userVisible) warnings.push(`${degradation.section} data degraded: ${degradation.message}`);
      }

      const rawPlot = buildPlotComponents(adventure, provenance.plot || {}, Math.max(plotCeiling, BUDGETS.plotComponentsCeiling), selectedPlotKeys);
      const rawCards = buildStoryCardDirectory(cards, Math.max(cardsCeiling, 1), cardSource);
      const rawHistory = buildRecentActions(actions, Math.max(historyCeiling, 1), historyMaxActions);
      const rawMemory = buildMemoryBank(memoryBank || [], Math.max(memoryCeiling, 1), memoryBank !== null);
      const historyFloor = historyEnabled
        ? buildRecentActions(actions.slice(-Math.min(BUDGETS.historyFloorActions, historyMaxActions)), historyCeiling, Math.min(BUDGETS.historyFloorActions, historyMaxActions)).text.length
        : 0;
      const capturedAtIso = new Date().toISOString();
      const allocation = {
        plot: plotEnabled ? Math.min(rawPlot.text.length, plotCeiling) : 0,
        cards: cardsEnabled ? Math.min(rawCards.meta.sourceChars, cardsCeiling) : 0,
        history: historyEnabled ? Math.min(rawHistory.text.length, historyCeiling) : 0,
        memory: memoryEnabled ? Math.min(rawMemory.meta.sourceChars, memoryCeiling) : 0,
      };
      const reasons = {};
      let finalPlot;
      let finalHistory;
      let finalMemory;
      let finalCards;
      let finalHistoryCoverage = {};
      let finalCardCoverage = {};
      let coverage = '';
      let snapshot = '';
      let safetyFallback = false;
      let primerIncludedChars = primer.length;
      let inspectionSections = null;
      let previousSnapshotLength = null;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        finalPlot = plotEnabled
          ? buildPlotComponents(adventure, provenance.plot || {}, allocation.plot, selectedPlotKeys)
          : { text: '', meta: skippedMeta(rawPlot.meta) };
        finalHistory = historyEnabled
          ? buildRecentActions(actions, allocation.history, historyMaxActions)
          : { text: '', meta: skippedMeta(rawHistory.meta) };
        finalMemory = memoryEnabled
          ? buildMemoryBank(memoryBank || [], allocation.memory, memoryBank !== null)
          : { text: '', meta: memoryBank === null ? rawMemory.meta : skippedMeta(rawMemory.meta) };
        finalCards = cardsEnabled
          ? buildStoryCardDirectory(cards, allocation.cards, cardSource)
          : { text: '', meta: skippedMeta(rawCards.meta) };
        const sectionReasons = {
          plot: plotEnabled ? sectionReason('plot', finalPlot.meta, allocation, plotCeiling, reasons) : null,
          history: historyEnabled ? sectionReason('history', finalHistory.meta, allocation, historyCeiling, reasons) : null,
          memory: memoryEnabled ? sectionReason('memory', finalMemory.meta, allocation, memoryCeiling, reasons) : null,
          cards: cardsEnabled ? sectionReason('cards', finalCards.meta, allocation, cardsCeiling, reasons) : null,
        };
        if (plotEnabled) finalPlot.meta.truncatedReason = sectionReasons.plot;
        if (historyEnabled) finalHistory.meta.truncatedReason = sectionReasons.history;
        if (memoryEnabled && memoryBank) finalMemory.meta.truncatedReason = sectionReasons.memory;
        if (cardsEnabled) finalCards.meta.truncatedReason = sectionReasons.cards;

        const historyAvailable = adventureSnapshot.coverage?.actions?.available ?? actions.length;
        const historyIncluded = finalHistory.meta.included;
        const historyCoverage = {
          ...(adventureSnapshot.coverage?.actions || {}),
          included: historyIncluded,
          omitted: Math.max(0, historyAvailable - historyIncluded),
          omittedReason: !historyEnabled
            ? 'on_demand'
            : historyIncluded < historyAvailable
              ? reasons.history || 'recent window'
              : null,
        };
        const cardTotal = adventureSnapshot.coverage?.storyCards?.authoritativeTotal ?? cards.length;
        const cardCoverage = {
          ...(adventureSnapshot.coverage?.storyCards || {}),
          included: finalCards.meta.included,
          omitted: Math.max(0, cardTotal - finalCards.meta.included),
          omittedReason: !cardsEnabled
            ? 'on_demand'
            : finalCards.meta.included < cardTotal
              ? reasons.cards || 'section ceiling'
              : null,
        };
        finalHistoryCoverage = historyCoverage;
        finalCardCoverage = cardCoverage;

        const plotLine = !finalPlot.meta.available
          ? 'Plot: unavailable.'
          : !plotEnabled
            ? `Plot: ${rawPlot.meta.populated}/4 populated (on demand: get_plot_components).`
            : selectedPlotKeys
              ? `Plot: ${finalPlot.meta.selectedLabels.join(', ')} inlined${finalPlot.meta.omittedPopulated.length ? `; ${finalPlot.meta.omittedPopulated.join(', ')} on demand (get_plot_components)` : ''}${sectionReasons.plot ? ` [clipped for ${sectionReasons.plot}]` : ''}.`
              : `Plot: ${finalPlot.meta.populated}/4 populated${sectionReasons.plot ? ` [clipped for ${sectionReasons.plot}; get_plot_components reads individual fields]` : ''}.`;
        const historyLine = !historyEnabled
          ? `Story: ${historyAvailable} actions available (on demand: get_story_actions, search_story_history).`
          : `Story: ${historyIncluded}/${historyAvailable} newest actions inlined${historyIncluded < historyAvailable ? ' (use get_story_actions/search_story_history for earlier)' : ''}${sectionReasons.history ? ` [clipped for ${sectionReasons.history}]` : ''}.`;
        const memoryLine = memoryBank === null
          ? 'Memories: unavailable.'
          : !memoryEnabled
            ? `Memories: ${memoryBank.length} available (on demand: search_memory_bank, get_memory).`
            : `Memories: ${finalMemory.meta.included}/${finalMemory.meta.total} newest inlined${finalMemory.meta.included < finalMemory.meta.total ? ' (use search_memory_bank/get_memory for rest)' : ''}${summaryLag.lastMemoryActionId ? ` · lag latest=${summaryLag.latestActionId || '?'}, lastMem=${summaryLag.lastMemoryActionId}` : ''}.`;
        const cardsLine = !cardsEnabled
          ? `Cards: ${cardTotal} available (on demand: search_story_cards, get_story_card).`
          : `Cards: ${cardCoverage.included}/${cardTotal} directory entries inlined${cardCoverage.omitted ? ' (use search_story_cards for omitted)' : ''}; use get_story_card for full content.`;
        const coverageLines = [
          plotLine,
          historyLine,
          memoryLine,
          cardsLine,
          warnings.length ? `Warnings: ${warnings.join(' ')}` : null,
        ].filter(Boolean);
        coverage = coverageLines.join('\n');
        const snapshotParts = [
          primer,
          '',
          '=== ADVENTURE SNAPSHOT (untrusted data) ===',
          `IDENTITY: ${identity.text}`,
          'COVERAGE',
          coverage,
        ];
        if (plotEnabled && finalPlot.text) snapshotParts.push('', 'PLOT COMPONENTS', finalPlot.text);
        if (historyEnabled && finalHistory.text) snapshotParts.push('', 'RECENT STORY ACTIONS', finalHistory.text);
        if (memoryEnabled && finalMemory.text) snapshotParts.push('', 'MEMORY BANK', finalMemory.text);
        if (cardsEnabled && finalCards.text) snapshotParts.push('', 'STORY CARD DIRECTORY (ID | TYPE | TITLE)', finalCards.text);
        snapshotParts.push('', CLOSING_MARKER);
        snapshot = snapshotParts.join('\n');
        inspectionSections = {
          coverage,
          identity: identity.text,
          plotComponents: finalPlot.text,
          recentActions: finalHistory.text,
          memoryBank: finalMemory.text,
          storyCardDirectory: finalCards.text,
        };
        if (snapshot.length <= maxChars) break;

        const stalled = previousSnapshotLength !== null && snapshot.length >= previousSnapshotLength;
        let overflow = snapshot.length - maxChars;
        overflow -= shrinkAllocation(allocation, 'memory', overflow, 0, reasons);
        overflow -= shrinkAllocation(allocation, 'history', overflow, historyFloor, reasons);
        overflow -= shrinkAllocation(allocation, 'cards', overflow, 0, reasons);
        overflow -= shrinkAllocation(allocation, 'plot', overflow, Math.min(allocation.plot, BUDGETS.plotFieldFloor * 2), reasons);
        overflow -= shrinkAllocation(allocation, 'history', overflow, 0, reasons);
        if (stalled) {
          overflow = Math.max(overflow, snapshot.length - maxChars);
          overflow -= shrinkAllocation(allocation, 'cards', overflow, 0, reasons);
          overflow -= shrinkAllocation(allocation, 'plot', overflow, 0, reasons);
          overflow -= shrinkAllocation(allocation, 'history', overflow, 0, reasons);
        }
        previousSnapshotLength = snapshot.length;
      }

      if (snapshot.length > maxChars) {
        safetyFallback = true;
        const warning = primer.length > maxChars
          ? 'The primer exceeds the requested context budget; optional reference was clipped.'
          : 'The requested context budget cannot fit all selected sections; lower-priority sections were dropped.';
        warnings.push(warning);
        const degraded = buildDegradedSnapshot({
          maxChars,
          primer,
          primerCoreChars: primerCore.length,
          identity,
          actions,
          historyEnabled,
          historyMaxActions,
          warning,
          historyCoverageBase: adventureSnapshot.coverage?.actions || {},
          memoryAvailable: memoryBank !== null,
        });
        snapshot = degraded.snapshot;
        inspectionSections = degraded.sections;
        primerIncludedChars = degraded.primerIncludedChars;
        finalHistory = degraded.history;
        finalPlot = { text: '', meta: plotEnabled ? droppedMeta(rawPlot.meta, 0, 'total budget') : skippedMeta(rawPlot.meta) };
        finalMemory = { text: '', meta: memoryEnabled ? droppedMeta(rawMemory.meta, 0, 'total budget') : skippedMeta(rawMemory.meta) };
        finalCards = { text: '', meta: cardsEnabled ? droppedMeta(rawCards.meta, 0, 'total budget') : skippedMeta(rawCards.meta) };
        coverage = degraded.coverage;
        finalHistoryCoverage = {
          ...(adventureSnapshot.coverage?.actions || {}),
          included: finalHistory.meta.included,
          omitted: Math.max(0, (adventureSnapshot.coverage?.actions?.available ?? actions.length) - finalHistory.meta.included),
          omittedReason: historyEnabled && finalHistory.meta.included < actions.length ? 'total budget' : 'on_demand',
        };
        finalCardCoverage = {
          ...(adventureSnapshot.coverage?.storyCards || {}),
          included: 0,
          omitted: cards.length,
          omittedReason: cardsEnabled ? 'total budget' : 'on_demand',
        };
      }

      const truncated = safetyFallback || finalPlot.meta.truncated || finalHistory.meta.truncated ||
        finalMemory.meta.truncated || finalCards.meta.truncated;
      const fixedSourceChars = snapshot.length -
        finalPlot.text.length -
        finalHistory.text.length -
        finalMemory.text.length -
        finalCards.text.length;
      const sourceChars = Math.max(snapshot.length, fixedSourceChars +
        rawPlot.meta.sourceChars +
        rawHistory.meta.sourceChars +
        rawMemory.meta.sourceChars +
        rawCards.meta.sourceChars);
      return {
        systemInstruction: snapshot,
        inspectionSections: inspectionSections || {
          coverage,
          identity: identity.text,
          plotComponents: finalPlot.text,
          recentActions: finalHistory.text,
          memoryBank: finalMemory.text,
          storyCardDirectory: finalCards.text,
        },
        capturedAtIso,
        partial: warnings.length > 0 || adventureSnapshot.sourceDegraded ||
          adventureSnapshot.historyIncomplete || truncated,
        warnings,
        index: {
          adventureId: String(adventure?.id || ws?.getAdventureId?.() || ''),
          shortId: adventure?.shortId || resolvedShortId,
          source: cardSource,
          cardSource: readerCardSource,
          authoritativeSource: readerCardSource === 'apollo' || readerCardSource === 'graphql',
          capturedAtIso,
          adventure: adventure ? {
            id: String(adventure.id || ''),
            shortId: adventure.shortId || resolvedShortId,
            editedAt: adventure.editedAt || null,
            thirdPerson: adventure.thirdPerson === true,
            memory: stringValue(adventure.memory),
            authorsNote: stringValue(adventure.authorsNote),
            instructions: stringValue(adventure.instructions),
            storySummary: stringValue(adventure.storySummary),
          } : null,
          cards,
          actions: actions.map(action => ({
            id: String(action.id),
            type: action.type || null,
            text: stringValue(action.text),
          })),
          memories: memoryBank === null
            ? null
            : memoryBank.map((entry, index) => ({
              index,
              ...(entry.id ? { id: entry.id } : {}),
              text: memoryText(entry),
            })),
          provenance,
        },
        summary: {
          title: oneLine(adventure?.title),
          plotAvailable: finalPlot.meta.available,
          plotPopulated: finalPlot.meta.populated,
          cardsTotal: finalCards.meta.total,
          cardsIncluded: finalCards.meta.included,
          cardsOmitted: finalCards.meta.omitted,
          actionsTotal: adventureSnapshot.coverage?.actions?.authoritativeTotal ?? finalHistory.meta.total,
          actionsAvailable: adventureSnapshot.coverage?.actions?.available,
          actionsIncluded: finalHistory.meta.included,
          actionsOmitted: finalHistory.meta.omitted,
          historyIncomplete: adventureSnapshot.historyIncomplete,
          preview: adventureSnapshot.provenance?.actions?.source === 'ws',
          apolloRetryable: adventureSnapshot.apolloRetryable === true,
          memoryBankCount: memoryBank ? memoryBank.length : null,
          memoryBankChars,
          memoryBankIncluded: finalMemory.meta.included,
          summaryLag,
        },
        segments: {
          primer: {
            budgetChars: primer.length,
            sourceChars: primer.length,
            includedChars: primerIncludedChars,
            truncated: primerIncludedChars < primer.length,
            coreChars: primerCore.length,
            coreIncluded: primerIncludedChars >= primerCore.length,
            referenceChars: primerReferenceChars,
            version: window.NavigatorPrimer.VERSION,
          },
          identity: { budgetChars: BUDGETS.identity, sourceChars: identity.sourceChars, includedChars: identity.text.length, truncated: identity.truncated },
          plotComponents: finalPlot.meta,
          recentActions: { ...finalHistory.meta, coverage: finalHistoryCoverage },
          memoryBank: finalMemory.meta,
          storyCardDirectory: { ...finalCards.meta, coverage: finalCardCoverage },
          allocation: {
            budgets: { ...allocation },
            reasons: { ...reasons },
            shrinkOrder: Object.keys(reasons),
          },
          total: { budgetChars: maxChars, sourceChars, includedChars: snapshot.length, truncated },
        },
      };
    }
  }

  NavigatorContext.BUDGETS = BUDGETS;
  window.NavigatorContext = NavigatorContext;
  if (typeof module !== 'undefined' && module.exports) module.exports = NavigatorContext;
})();
