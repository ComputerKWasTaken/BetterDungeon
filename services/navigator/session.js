// BetterDungeon - Navigator Session
//
// Owns a single adventure's Navigator conversation: the transcript, streaming
// request lifecycle, abort, input budgeting, and per-adventure persistence.
//
// The drawer UI talks only to this class, and this class talks only to the
// first-party chat surface on BetterDungeonAI. Grounding stays behind
// buildSystemInstruction() and buildRequestMessages() so later tools do not
// change the drawer contract.

(function () {
  if (typeof window === 'undefined' || window.NavigatorSession) return;

  const CONSUMER = 'navigator';
  const STORAGE_PREFIX = 'betterDungeon_navigator_session_';

  // Budget for the first-party chat surface. Independent of the frozen
  // script-facing ai.query cap, which stays at 12k characters.
  const CHARS_PER_TOKEN = 3;
  const MAX_INPUT_CHARS = 128000 * CHARS_PER_TOKEN;
  const MAX_OUTPUT_TOKENS = 2048;
  const MAX_HISTORY_CHARS = 10000;
  const MAX_ROUTINE_HISTORY_CHARS = 3000;
  const MAX_ROUTINE_HISTORY_MESSAGES = 5;
  const MAX_TOOL_ROUNDS = 6;
  const MAX_TOOL_RESULT_CHARS_PER_TURN = 16000;
  const DEFAULT_SNAPSHOT_MAX_CHARS = 20000;
  const HISTORY_LEDGER_SHARE = 0.2;
  const TOOL_RESULT_LEDGER_SHARE = 0.25;
  const MAX_RESERVE_LEDGER_SHARE = 0.4;
  const PROPOSAL_RESULT_FLOOR_CHARS = 16000;
  const TOOL_ERROR_RESERVE_CHARS = 256;
  const READ_ONLY_STORAGE_KEY = 'betterDungeon_navigator_read_only';
  const THINKING_LEVEL_STORAGE_KEY = 'betterDungeon_navigator_thinking_level';
  const NAVIGATOR_DEFAULTS_STORAGE_KEY = 'betterDungeon_navigator_defaults';
  const NAVIGATOR_ADVENTURE_SETTINGS_PREFIX = 'betterDungeon_navigator_adventure_';
  const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];
  const CHANGE_MODES = ['automatic', 'proposed', 'none'];
  const DEFAULT_CHANGE_MODE = 'automatic';
  const DEFAULT_NAVIGATOR_SETTINGS = Object.freeze({ changeMode: DEFAULT_CHANGE_MODE });
  const TOOL_DROP_GUIDANCE = 'Tool access was reduced to fit the provider input limit; use only the offered tools.';

  // A single user turn longer than this can never fit alongside a system
  // instruction, so it is rejected before a request is attempted.
  const MAX_USER_MESSAGE_CHARS = 8000;

  // Persistence bounds. Transcripts are convenience state, not archives.
  const MAX_PERSISTED_MESSAGES = 80;
  const MAX_PERSISTED_CHARS = 120000;
  const MAX_INSPECTION_CHARS = 4 * 1024 * 1024;
  const MAX_PERSISTED_PROPOSAL_VALUE_CHARS = 1000;
  const MAX_TOOL_ACTIVITY_TEXT_CHARS = 96;
  const PERSISTED_PROPOSAL_TRUNCATION_MARKER = ' …[truncated for reload]';
  const NON_RETRYABLE_ERROR_CODES = new Set([
    'prohibited_content',
    'safety_blocked',
    'invalid_args',
    'context_limit',
    'provider_limit',
    'tool_limit',
    'context_budget_exhausted',
  ]);

  const PURE_GREETING_RE = /^(?:hi|hello|hey|yo|sup|howdy|greetings|good\s+(?:morning|afternoon|evening|night)|how\s+are\s+you(?:\s+doing)?|what'?s\s+up|thanks|thank\s+you|thx|ty|cheers|bye|goodbye|see\s+ya|test|testing)[\s!.,?]*$/i;
  const PURE_META_HELP_RE = /^(?:what\s+(?:can\s+you\s+do|do\s+you\s+do|are\s+(?:you|routines?|story\s+cards?|plot\s+components?|memory\s+bank))|who\s+are\s+you|help|how\s+(?:do|does)\s+(?:you|navigator|routines?|story\s+cards?|plot\s+components?|ai\s+instructions?|plot\s+essentials?|author['’]?s?\s+note|story\s+summary|memory\s+bank|triggers?)\s+work|explain\s+(?:routines?|story\s+cards?|plot\s+components?|memory\s+bank))[\s?!.]*$/i;
  const LIVE_ACTION_OR_OWN_RE = /\b(?:my|our|this\s+adventure|check|review|list|run|show|edit|update|fix|create|delete|make|find|search|read)\b/i;
  const ROUTINE_NAMES_RE = /\b(?:npc\s+brains?|automatic\s+story\s+cards|story\s+arcs?|state\s+management|scene\s+compass|continuity\s+watch)\b/gi;
  const ROUTINE_COMMAND_RE = /\b(?:run|trigger|execute|start|list|show|what|which|create|make|draft|add|build|write|set\s+up)\b[^.!?\n]{0,60}\broutines?\b|\b(?:run|trigger|execute|start)\s+(?:the\s+)?(?:npc\s+brains?|automatic\s+story\s+cards|story\s+arcs?|state\s+management|scene\s+compass|continuity\s+watch)\b/i;

  function stripNegations(value) {
    return String(value || '')
      .replace(/\b(?:do\s+not|don't|never|avoid)\b[^.;!\n]*/gi, ' ')
      .replace(/\bleave\b[^.;!\n]*?\bto\s+(?:its|their)\s+own\s+routines?\b[^.;!\n]*/gi, ' ');
  }

  function detectDomains(value, { allowBroadPlot = false, stripRoutineNames = false } = {}) {
    let text = stripNegations(value);
    const routines = /\b(?:routines?|milestones?|list_routines|run_routine|propose_routine_create)\b/i.test(text)
      || ROUTINE_NAMES_RE.test(text);
    ROUTINE_NAMES_RE.lastIndex = 0;
    if (stripRoutineNames) text = text.replace(ROUTINE_NAMES_RE, ' ');
    const plotFields = [];
    if (/\b(?:ai\s+instructions?|custom\s+instructions?)\b/i.test(text)) plotFields.push('instructions');
    if (/\b(?:plot\s+essentials?|adventure\s+state|story\s+arc)\b/i.test(text)) plotFields.push('memory');
    if (/\b(?:author['’]?s?\s+note|scene\s+compass)\b/i.test(text)) plotFields.push('authorsNote');
    if (/\b(?:story\s+summary|auto[\s-]*summariz\w*)\b/i.test(text) || (allowBroadPlot && /\bsummary\b/i.test(text))) plotFields.push('storySummary');
    const plotGeneral = /\b(?:plot\s+components?|third[\s-]*person|propose_third_person_change)\b/i.test(text)
      || (allowBroadPlot && /\b(?:plot|pov|perspective|tone|pacing|writing\s+style)\b/i.test(text));
    const plot = plotGeneral || plotFields.length > 0 || /\bpropose_plot_component_change\b/i.test(text);
    const thirdPerson = /\b(?:third[\s-]*person|propose_third_person_change)\b/i.test(text);
    const cards = /\b(?:story\s*cards?|cards?|triggers?|lore|world\s+info|npcs?|character\s+cards?|brain\s+cards?|get_story_card|search_story_cards|propose_story_card_)\b/i.test(text);
    const memory = /\b(?:memory\s+bank|memories|propose_memory_|search_memory_bank|get_memory)\b/i.test(text);
    const history = /\b(?:recent\s+story|recent\s+scene|story\s+(?:history|events?|progress|developments?|context|actions?)|what\s+happened|happen\s+next|next\s+steps?|brainstorm|continuity|actions?|search_story_history|get_story_actions)\b/i.test(text);
    return { routines, plot, plotGeneral, plotFields, thirdPerson, cards, memory, history };
  }

  function mergeDomains(a, b) {
    return {
      routines: a.routines || b.routines,
      plot: a.plot || b.plot,
      plotGeneral: a.plotGeneral || b.plotGeneral,
      plotFields: [...new Set([...a.plotFields, ...b.plotFields])],
      thirdPerson: a.thirdPerson || b.thirdPerson,
      cards: a.cards || b.cards,
      memory: a.memory || b.memory,
      history: a.history || b.history,
    };
  }

  function isPureGreeting(value) {
    return PURE_GREETING_RE.test(String(value || '').trim());
  }

  function isPureMetaHelp(value) {
    const text = String(value || '').trim();
    return PURE_META_HELP_RE.test(text) && !LIVE_ACTION_OR_OWN_RE.test(text);
  }

  function truncatePersistedProposalValue(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (text.length <= MAX_PERSISTED_PROPOSAL_VALUE_CHARS) return text;
    const keep = Math.max(0, MAX_PERSISTED_PROPOSAL_VALUE_CHARS - PERSISTED_PROPOSAL_TRUNCATION_MARKER.length);
    return `${text.slice(0, keep)}${PERSISTED_PROPOSAL_TRUNCATION_MARKER}`;
  }

  function projectProposalForPersistence(proposal) {
    const persisted = {
      id: proposal.id,
      kind: proposal.kind,
      status: proposal.status,
      targetLabel: proposal.targetLabel,
      reason: proposal.reason,
      changes: Array.isArray(proposal.changes)
        ? proposal.changes.map(change => ({
          label: change.label,
          before: truncatePersistedProposalValue(change.before),
          after: truncatePersistedProposalValue(change.after),
        }))
        : [],
      irreversible: proposal.irreversible === true,
      error: proposal.error || null,
      restored: true,
    };
    if (proposal.updatedAtDrift) persisted.updatedAtDrift = proposal.updatedAtDrift;
    return persisted;
  }

  function boundedActivityText(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= MAX_TOOL_ACTIVITY_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_TOOL_ACTIVITY_TEXT_CHARS - 1)}…`;
  }

  function projectToolActivityForPersistence(activity) {
    if (!activity || typeof activity !== 'object') return null;
    const summary = activity.summary && typeof activity.summary === 'object'
      ? Object.fromEntries(Object.entries(activity.summary)
        .filter(([key, value]) => (
          ['query', 'target', 'detail', 'resultCount', 'resultTotal'].includes(key)
          && (typeof value === 'string' || Number.isFinite(value))
        ))
        .map(([key, value]) => [key, typeof value === 'string' ? boundedActivityText(value) : value]))
      : {};
    return {
      id: boundedActivityText(activity.id || createId('tool')),
      round: Number.isSafeInteger(activity.round) ? activity.round : 0,
      name: boundedActivityText(activity.name || 'unknown_tool'),
      status: ['running', 'success', 'error'].includes(activity.status) ? activity.status : 'error',
      durationMs: Number.isFinite(activity.durationMs) ? Math.max(0, Math.round(activity.durationMs)) : null,
      summary,
      errorCode: activity.errorCode ? boundedActivityText(activity.errorCode) : null,
    };
  }

  function persistedMessageSize(message) {
    return (message.content?.length || 0)
      + JSON.stringify(message.proposals || []).length
      + JSON.stringify(message.toolActivityTrail || []).length;
  }

  function createId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
    }
    return value;
  }

  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  class NavigatorSession {
    constructor(adventureId, { routineId = null } = {}) {
      this.adventureId = adventureId || null;
      this.routineId = routineId;
      this.messageMetadata = {};
      this.turnMetadata = {};
      this.persistenceDirty = false;
      this.persistPromise = Promise.resolve();
      this.storageRevision = null;
      this.messages = [];
      this.listeners = new Set();
      this.controller = null;
      this.streamingMessageId = null;
      this.sending = false;
      this.loaded = false;
      this.saveTimer = null;
      this.contextReader = typeof NavigatorContext !== 'undefined'
        ? new NavigatorContext(this.adventureId)
        : null;
      this.tools = typeof NavigatorTools !== 'undefined'
        ? new NavigatorTools(this.adventureId)
        : null;
      this.mutations = typeof NavigatorMutations !== 'undefined'
        ? new NavigatorMutations(this.adventureId)
        : null;
      this.contextSnapshot = null;
      this.contextState = 'idle';
      this.contextRevision = 0;
      this.contextControllers = new Set();
      this.applyController = null;
      this.mutationQueue = Promise.resolve();
      this.changeMode = DEFAULT_CHANGE_MODE;
      this.thinkingLevel = 'low';
      this.providerStatus = null;
      this.hasLoadedSettings = false;
      this.fallbackSettings = { ...DEFAULT_NAVIGATOR_SETTINGS };
      this.adventureSettings = {};
      this.effectiveSettings = { ...DEFAULT_NAVIGATOR_SETTINGS, changeMode: 'none', thinkingLevel: 'low' };
      this.boundStorageChange = (changes, areaName) => this.onStorageChange(changes, areaName);
      this.settingsReady = this.loadSettings();
      this.destroyed = false;
      this.debug = false;
      this.lastRequestInspection = null;

      try {
        chrome.storage?.onChanged?.addListener(this.boundStorageChange);
      } catch {
        /* noop */
      }
    }

    log(message, ...args) {
      if (this.debug) console.log(message, ...args);
    }

    // ==================== SUBSCRIPTIONS ====================

    // Listeners receive (event, payload). Events:
    //   'reset'  — the whole transcript changed, re-render everything
    //   'append' — a single message was added
    //   'update' — a single message changed in place (streaming, completion)
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(event, payload) {
      if (['append', 'update', 'reset'].includes(event)) this.persistenceDirty = true;
      for (const listener of this.listeners) {
        try {
          listener(event, payload);
        } catch (error) {
          console.error('[Navigator] Session listener failed:', error);
        }
      }
    }

    // ==================== STATE ====================

    // True from the moment a send is accepted until the turn settles, so the
    // async readiness check cannot be raced by a second submit.
    get isBusy() {
      return this.isChatBusy || this.applyController !== null;
    }

    get isChatBusy() {
      return this.sending || this.streamingMessageId !== null;
    }

    getMessages() {
      return this.messages;
    }

    findMessage(id) {
      return this.messages.find(message => message.id === id) || null;
    }

    findMessageIndex(id) {
      return this.messages.findIndex(message => message.id === id);
    }

    addMessage(message) {
      const record = {
        id: createId('msg'),
        createdAt: Date.now(),
        status: 'complete',
        content: '',
        ...this.messageMetadata,
        ...message,
      };
      this.messages.push(record);
      this.emit('append', record);
      return record;
    }

    updateMessage(id, updates) {
      const message = this.findMessage(id);
      if (!message) return null;
      Object.assign(message, updates);
      this.emit('update', message);
      return message;
    }

    clear() {
      this.abort();
      this.abortMutation();
      this.messages = [];
      this.lastRequestInspection = null;
      this.emit('reset', this.messages);
      this.persist();
    }

    getLastRequestInspection() {
      if (!this.lastRequestInspection) return null;
      return JSON.parse(JSON.stringify(this.lastRequestInspection));
    }

    beginRequestInspection() {
      this.lastRequestInspection = {
        capturedAt: new Date().toISOString(),
        adventureId: this.adventureId,
        status: 'running',
        model: null,
        thinkingLevel: null,
        inputCap: null,
        snapshot: null,
        conversation: null,
        turnAllowances: null,
        rounds: [],
        meta: null,
        error: null,
      };
      this.emit('inspection');
    }

    retainInspectionRound(round) {
      const inspection = this.lastRequestInspection;
      if (!inspection) return -1;
      inspection.rounds.push({
        ...round,
        toolCalls: [],
        executionResults: [],
        activity: [],
        responseMeta: null,
      });
      this.trimInspectionRetention();
      this.emit('inspection');
      return inspection.rounds.length - 1;
    }

    updateInspectionRound(index, updates) {
      const inspection = this.lastRequestInspection;
      const round = inspection?.rounds?.[index];
      if (!round || round.omitted) return;
      Object.assign(round, updates);
      this.trimInspectionRetention();
      this.emit('inspection');
    }

    trimInspectionRetention() {
      const inspection = this.lastRequestInspection;
      if (!inspection) return;
      let retainedChars = JSON.stringify(inspection).length;
      const placeholder = item => ({
        round: item.round,
        omitted: true,
        omissionReason: 'Intermediate round text omitted due to the inspection retention limit.',
        projectedInputChars: item.projectedInputChars,
        tools: Array.isArray(item.tools) ? item.tools.map(tool => ({ name: tool.name })) : [],
        continuationPresent: item.continuationPresent,
        activity: Array.isArray(item.activity) ? item.activity : [],
        responseMeta: item.responseMeta ? {
          outputTruncated: item.responseMeta.outputTruncated === true,
          finishReason: item.responseMeta.finishReason || null,
        } : null,
      });
      const truncated = item => {
        const marker = '\n\n[Inspection text truncated to stay within the retention limit.]';
        const prefix = typeof item.systemInstruction === 'string'
          ? item.systemInstruction.slice(0, 1024 * 1024) + marker
          : marker.trim();
        return {
          round: item.round,
          truncated: true,
          omissionReason: 'This round exceeded the inspection retention limit; text is shown with an explicit prefix marker.',
          systemInstruction: prefix,
          messages: [],
          tools: Array.isArray(item.tools) ? item.tools.map(tool => ({ name: tool.name })) : [],
          toolResults: [],
          continuationPresent: item.continuationPresent,
          budget: item.budget,
          thinking: item.thinking,
          projectedInputChars: item.projectedInputChars,
          activity: Array.isArray(item.activity) ? item.activity : [],
          responseMeta: item.responseMeta || null,
        };
      };
      const replaceRound = (index, replacement) => {
        retainedChars -= JSON.stringify(inspection.rounds[index]).length;
        inspection.rounds[index] = replacement;
        retainedChars += JSON.stringify(replacement).length;
      };
      while (retainedChars > MAX_INSPECTION_CHARS && inspection.rounds.length > 2) {
        const index = inspection.rounds.findIndex((item, i) => i > 0 && i < inspection.rounds.length - 1 && !item.omitted);
        if (index < 0) break;
        replaceRound(index, placeholder(inspection.rounds[index]));
      }
      if (retainedChars > MAX_INSPECTION_CHARS) {
        const latest = inspection.rounds[inspection.rounds.length - 1];
        const index = inspection.rounds.findIndex(
          item => !item.omitted && inspection.rounds.length > 1 && item !== latest
        );
        if (index >= 0) replaceRound(index, placeholder(inspection.rounds[index]));
      }
      if (retainedChars > MAX_INSPECTION_CHARS) {
        const index = inspection.rounds.findIndex(item => !item.omitted);
        if (index >= 0) replaceRound(index, truncated(inspection.rounds[index]));
      }
    }

    finishRequestInspection(meta, error) {
      if (!this.lastRequestInspection) return;
      this.lastRequestInspection.meta = meta ? { ...meta } : null;
      this.lastRequestInspection.error = error ? { code: error.code || 'unknown', message: error.message || String(error) } : null;
      const needsAttention = this.lastRequestInspection.snapshot?.partial === true
        || this.lastRequestInspection.conversation?.truncated === true
        || meta?.toolsDropped === true
        || meta?.inputLimitReached === true
        || meta?.toolLimitReached === true
        || Number(meta?.toolResultsOmitted || 0) > 0
        || meta?.outputTruncated === true;
      this.lastRequestInspection.status = error ? 'error' : needsAttention ? 'attention' : 'complete';
      this.emit('inspection');
    }

    // ==================== PERSISTENCE ====================

    get storageKey() {
      if (this.routineId && this.adventureId) return `betterDungeon_navigator_routine_session_${encodeURIComponent(this.adventureId)}_${encodeURIComponent(this.routineId)}`;
      return this.adventureId ? `${STORAGE_PREFIX}${this.adventureId}` : null;
    }

    async refreshStoredConversation() {
      await this.persistPromise;
      if (!this.loaded) return this.load();
      const stored = await this.storageGet(chrome.storage.local, this.storageKey);
      const revision = stored?.[this.storageKey]?.revision || null;
      if (revision !== this.storageRevision) await this.load();
    }

    async load() {
      const key = this.storageKey;
      if (!key || !isExtensionContextValid()) {
        this.loaded = true;
        return;
      }

      const stored = await new Promise((resolve) => {
        try {
          chrome.storage.local.get(key, result => resolve((result || {})[key] || null));
        } catch {
          resolve(null);
        }
      });

      // A transcript persisted mid-stream is restored as an interrupted turn
      // rather than as a message that is still arriving.
      this.messages = Array.isArray(stored?.messages)
        ? stored.messages.map(message => {
          const restored = message.status === 'streaming' || message.status === 'pending'
            ? { ...message, status: message.content ? 'aborted' : 'error', toolActivity: null }
            : { ...message };
          if (Array.isArray(restored.proposals)) {
            restored.proposals = restored.proposals.map(proposal => {
              const inFlight = proposal.status === 'pending'
                || proposal.status === 'queued'
                || proposal.status === 'applying';
              return {
                ...projectProposalForPersistence(proposal),
                status: inFlight ? 'expired' : proposal.status,
                error: inFlight ? null : proposal.error || null,
              };
            });
          }
          if (Array.isArray(restored.toolActivityTrail)) {
            restored.toolActivityTrail = restored.toolActivityTrail
              .map(projectToolActivityForPersistence)
              .filter(Boolean)
              .map(activity => activity.status === 'running'
                ? {
                  ...activity,
                  status: 'error',
                  errorCode: 'interrupted',
                  summary: { ...activity.summary, detail: 'Interrupted when the page reloaded' },
                }
                : activity);
          }
          return restored;
        })
        : [];
      this.loaded = true;
      this.emit('reset', this.messages);
      this.storageRevision = stored?.revision || null;
      this.persistenceDirty = false;
    }

    storageGet(area, keys) {
      return new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value || {});
        };
        const timer = setTimeout(() => finish({ __failed: true }), 2000);
        try {
          area.get(keys, result => finish(chrome.runtime?.lastError ? { __failed: true } : result));
        } catch {
          finish({ __failed: true });
        }
      });
    }

    adventureSettingsKey() {
      return `${NAVIGATOR_ADVENTURE_SETTINGS_PREFIX}${encodeURIComponent(String(this.adventureId || 'unknown'))}`;
    }

    normalizeSettings(value) {
      const result = {};
      if (THINKING_LEVELS.includes(value?.thinkingLevel)) result.thinkingLevel = value.thinkingLevel;
      if (CHANGE_MODES.includes(value?.changeMode)) {
        result.changeMode = value.changeMode;
      } else if (
        typeof value?.readOnly === 'boolean'
        || value?.applyMode === 'auto'
        || value?.applyMode === 'review'
      ) {
        result.changeMode = value.readOnly === true
          ? 'none'
          : value.applyMode === 'review' ? 'proposed' : 'automatic';
      }
      return result;
    }

    async loadSettings() {
      if (!isExtensionContextValid()) {
        this.setChangeMode('none');
        this.effectiveSettings = { ...DEFAULT_NAVIGATOR_SETTINGS, changeMode: 'none', thinkingLevel: 'low' };
        return this.effectiveSettings;
      }
      const [syncResult, localResult] = await Promise.all([
        this.storageGet(chrome.storage.sync, [READ_ONLY_STORAGE_KEY, THINKING_LEVEL_STORAGE_KEY, NAVIGATOR_DEFAULTS_STORAGE_KEY]),
        this.storageGet(chrome.storage.local, this.adventureSettingsKey()),
      ]);
      if (syncResult.__failed || localResult.__failed) {
        if (!this.hasLoadedSettings) {
          this.fallbackSettings = { ...DEFAULT_NAVIGATOR_SETTINGS };
          this.adventureSettings = {};
          this.effectiveSettings = { ...DEFAULT_NAVIGATOR_SETTINGS, changeMode: 'none', thinkingLevel: 'low' };
        } else {
          this.effectiveSettings = { ...this.effectiveSettings, changeMode: 'none', thinkingLevel: 'low' };
        }
        this.thinkingLevel = 'low';
        this.setChangeMode('none');
        return this.effectiveSettings;
      }
      const rawDefaults = syncResult[NAVIGATOR_DEFAULTS_STORAGE_KEY] || {};
      const defaults = this.normalizeSettings(rawDefaults);
      const legacyThinking = syncResult[THINKING_LEVEL_STORAGE_KEY];
      const globalReadOnly = syncResult[READ_ONLY_STORAGE_KEY] === true;
      const fallbackChangeMode = CHANGE_MODES.includes(rawDefaults.changeMode)
        ? rawDefaults.changeMode
        : globalReadOnly
          ? 'none'
          : rawDefaults.applyMode === 'review' ? 'proposed' : DEFAULT_CHANGE_MODE;
      this.fallbackSettings = { ...DEFAULT_NAVIGATOR_SETTINGS, ...defaults, changeMode: fallbackChangeMode };
      this.fallbackSettings.thinkingLevel = THINKING_LEVELS.includes(legacyThinking)
        ? legacyThinking
        : (defaults.thinkingLevel || 'low');
      const adventureSettingsKey = this.adventureSettingsKey();
      const rawStoredSettings = localResult[adventureSettingsKey] || {};
      const migratedSettings = { ...rawStoredSettings };
      if (!CHANGE_MODES.includes(rawStoredSettings.changeMode)) {
        const hasLocalLegacyMode = typeof rawStoredSettings.readOnly === 'boolean'
          || rawStoredSettings.applyMode === 'auto'
          || rawStoredSettings.applyMode === 'review';
        if (hasLocalLegacyMode) {
          const effectiveLegacyReadOnly = typeof rawStoredSettings.readOnly === 'boolean'
            ? rawStoredSettings.readOnly
            : globalReadOnly;
          const effectiveLegacyApplyMode = rawStoredSettings.applyMode === 'review'
            || rawStoredSettings.applyMode === 'auto'
            ? rawStoredSettings.applyMode
            : rawDefaults.applyMode;
          migratedSettings.changeMode = effectiveLegacyReadOnly
            ? 'none'
            : effectiveLegacyApplyMode === 'review' ? 'proposed' : 'automatic';
        }
      }
      if (!Object.prototype.hasOwnProperty.call(rawStoredSettings, 'thinkingLevel')) {
        const migratedThinking = THINKING_LEVELS.includes(legacyThinking)
          ? legacyThinking
          : defaults.thinkingLevel;
        if (migratedThinking) migratedSettings.thinkingLevel = migratedThinking;
      }
      if (JSON.stringify(migratedSettings) !== JSON.stringify(rawStoredSettings)) {
        await new Promise(resolve => chrome.storage.local.set(
          { [adventureSettingsKey]: migratedSettings },
          resolve
        ));
      }
      this.adventureSettings = migratedSettings;
      const normalizedAdventure = this.normalizeSettings(migratedSettings);
      const effective = {
        ...this.fallbackSettings,
        ...normalizedAdventure,
        changeMode: normalizedAdventure.changeMode || this.fallbackSettings.changeMode || DEFAULT_CHANGE_MODE,
        thinkingLevel: normalizedAdventure.thinkingLevel || this.fallbackSettings.thinkingLevel || 'low',
      };
      this.effectiveSettings = effective;
      this.hasLoadedSettings = true;
      this.thinkingLevel = effective.thinkingLevel;
      this.setChangeMode(effective.changeMode);
      return effective;
    }

    async reloadSettingsAndNotify() {
      await this.loadSettings();
      this.emit('settings', this.getSettings());
      return this.getSettings();
    }

    getSettings() {
      return {
        ...this.effectiveSettings,
        adventureId: this.adventureId,
        providerThinkingLevels: this.getProviderThinkingLevels(),
      };
    }

    getProviderThinkingLevels() {
      const status = this.providerStatus;
      return Array.isArray(status?.config?.thinkingLevels) && status.config.thinkingLevels.length
        ? status.config.thinkingLevels
        : (Array.isArray(status?.thinkingLevels) ? status.thinkingLevels : []);
    }

    async saveSettings(fields) {
      if (!isExtensionContextValid()) return this.getSettings();
      const normalized = this.normalizeSettings(fields);
      const nextSettings = { ...this.adventureSettings, ...normalized };
      for (const key of Object.keys(fields || {})) {
        if (fields[key] === null || fields[key] === undefined) delete nextSettings[key];
      }
      this.adventureSettings = nextSettings;
      await new Promise(resolve => chrome.storage.local.set({ [this.adventureSettingsKey()]: nextSettings }, resolve));
      await this.loadSettings();
      this.emit('settings', this.getSettings());
      return this.getSettings();
    }

    setChangeMode(mode) {
      this.changeMode = CHANGE_MODES.includes(mode) ? mode : 'none';
      const state = this.getPermissionState();
      this.emit('permissions', state);
      return state;
    }

    onStorageChange(changes, areaName) {
      let shouldReload = false;
      if (areaName === 'sync' && changes?.[THINKING_LEVEL_STORAGE_KEY]) {
        shouldReload = true;
      }
      if (areaName === 'sync' && changes?.[READ_ONLY_STORAGE_KEY]) {
        shouldReload = true;
      }
      if (areaName === 'sync' && changes?.[NAVIGATOR_DEFAULTS_STORAGE_KEY]) {
        shouldReload = true;
      }
      if (areaName === 'local' && changes?.[this.adventureSettingsKey()]) {
        shouldReload = true;
      }
      if (shouldReload) this.reloadSettingsAndNotify();
    }

    getPermissionState() {
      return { changeMode: this.changeMode };
    }

    // Debounced so streaming deltas do not thrash extension storage.
    schedulePersist() {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.persist();
      }, 500);
    }

    persist() {
      const key = this.storageKey;
      if (!key || !isExtensionContextValid() || !this.persistenceDirty) return this.persistPromise;

      let kept = this.messages.slice(-(this.routineId ? 40 : MAX_PERSISTED_MESSAGES)).map(message => ({
        ...message,
        proposals: Array.isArray(message.proposals)
          ? message.proposals.map(projectProposalForPersistence)
          : undefined,
        toolActivityTrail: Array.isArray(message.toolActivityTrail)
          ? message.toolActivityTrail.map(projectToolActivityForPersistence).filter(Boolean)
          : undefined,
      }));
      let total = kept.reduce((sum, message) => sum + persistedMessageSize(message), 0);
      while (kept.length > 1 && total > (this.routineId ? 48000 : MAX_PERSISTED_CHARS)) {
        total -= persistedMessageSize(kept[0]);
        kept = kept.slice(1);
      }

      this.persistenceDirty = false;
      const revision = createId('revision');
      this.storageRevision = revision;
      this.persistPromise = this.persistPromise.then(() => new Promise(resolve => {
        try {
          chrome.storage.local.set({ [key]: { v: 1, messages: kept, revision, updatedAt: Date.now() } }, () => {
            if (chrome.runtime?.lastError) this.persistenceDirty = true;
            resolve();
          });
        } catch (error) {
          this.persistenceDirty = true;
          this.log('[Navigator] Failed to persist transcript:', error);
          resolve();
        }
      }));
      return this.persistPromise;
    }

    // ==================== GROUNDING ====================

    getContextSummary() {
      const summary = this.contextSnapshot?.summary || {};
      return {
        state: this.contextState,
        partial: this.contextSnapshot?.partial === true,
        capturedAtIso: this.contextSnapshot?.capturedAtIso || null,
        ...summary,
        preview: summary.preview === true,
        apolloRetryable: summary.apolloRetryable === true,
        actionsIncluded: this.contextSnapshot?.segments?.recentActions?.included ??
          summary.actionsIncluded,
      };
    }

    isApolloPreviewRetryable() {
      return this.getContextSummary().apolloRetryable === true;
    }

    async refreshContext(options = {}) {
      if (!this.contextReader) {
        const error = {
          code: 'unavailable',
          message: 'Navigator adventure grounding is not loaded. Reload the page and try again.',
          retryable: true,
        };
        this.contextState = 'error';
        this.emit('context', this.getContextSummary());
        throw error;
      }

      const revision = ++this.contextRevision;
      const ownController = options.signal ? null : new AbortController();
      const signal = options.signal || ownController.signal;
      if (ownController) this.contextControllers.add(ownController);
      this.contextState = 'loading';
      this.emit('context', this.getContextSummary());

      try {
        const snapshot = await this.contextReader.build({
          signal,
          maxChars: options.maxChars,
          plan: options.plan,
        });
        if (revision === this.contextRevision) {
          this.contextSnapshot = snapshot;
          this.contextState = snapshot.partial ? 'partial' : 'ready';
          this.emit('context', this.getContextSummary());
        }
        return snapshot;
      } catch (error) {
        if (revision === this.contextRevision && String(error?.code || '').toLowerCase() !== 'aborted') {
          this.contextState = 'error';
          this.emit('context', this.getContextSummary());
        }
        throw error;
      } finally {
        if (ownController) this.contextControllers.delete(ownController);
      }
    }

    // ==================== PROVIDER READINESS ====================

    async checkReady() {
      const executor = window.BetterDungeonAI;
      if (!executor?.chat) {
        return { ready: false, message: 'The BetterDungeon AI layer is not loaded. Try reloading the page.' };
      }

      try {
        const status = executor.refreshStatus
          ? await executor.refreshStatus({ consumer: CONSUMER })
          : executor.status?.({ consumer: CONSUMER });
        this.providerStatus = status || null;
        if (status?.ready) return { ready: true, status };
        return {
          ready: false,
          status,
          message: `${status?.message || 'The configured AI provider is not ready.'} Open the BetterDungeon popup and go to AI to configure it.`,
        };
      } catch (error) {
        return {
          ready: false,
          message: `${error?.message || 'AI provider status could not be checked.'} Open the BetterDungeon popup and go to AI to configure it.`,
        };
      }
    }

    // ==================== REQUEST ASSEMBLY ====================

    planTurn(userText = '') {
      const text = String(userText || '').trim();
      const canMutate = this.changeMode !== 'none' && !!this.mutations;
      const pushChangeModule = modules => (canMutate ? [...modules, 'changes'] : modules);

      if (this.routineId && (this.turnMetadata?.source === 'routine' || !isPureGreeting(text))) {
        const rule = this.routines?.rules?.find(item => item.id === this.routineId) || null;
        const interval = Number.isInteger(this.turnMetadata?.routineInterval)
          ? this.turnMetadata.routineInterval
          : (Number.isInteger(rule?.interval) ? rule.interval : 5);
        const maxActions = Math.min(16, Math.max(8, interval + 4));
        const routineSource = `${rule?.name || this.turnMetadata?.routineName || ''}\n${this.turnMetadata?.routineInstruction || rule?.instruction || text}`;
        let domains = detectDomains(routineSource, { allowBroadPlot: false });
        if (this.turnMetadata?.source !== 'routine' && text) {
          domains = mergeDomains(domains, detectDomains(text, { allowBroadPlot: true }));
        }
        const scoped = domains.plot || domains.cards || domains.memory;
        const plotSection = scoped
          ? (domains.plot ? (domains.plotFields.length && !domains.plotGeneral ? domains.plotFields : true) : false)
          : true;
        const cardsSection = scoped ? domains.cards : true;
        const memorySection = scoped ? domains.memory : false;
        const primerModules = [];
        if (plotSection !== false) primerModules.push('plot');
        if (cardsSection) primerModules.push('cards');
        if (memorySection) primerModules.push('memory');
        const mutationDomains = scoped
          ? { plot: domains.plot, thirdPerson: domains.thirdPerson, cards: domains.cards, memory: domains.memory }
          : { plot: true, thirdPerson: true, cards: true, memory: true };
        return {
          mode: 'routine',
          primerModules: pushChangeModule(primerModules),
          sections: { plot: plotSection, history: true, cards: cardsSection, memory: memorySection },
          budgets: {
            plot: plotSection === false ? 0 : (Array.isArray(plotSection) && plotSection.length === 1 ? 4500 : 6500),
            history: interval >= 10 ? 7000 : 6000,
            maxActions,
            cards: cardsSection ? 4000 : 0,
            memory: memorySection ? 4000 : 0,
          },
          maxSnapshotChars: 18000,
          historyCharsCap: MAX_ROUTINE_HISTORY_CHARS,
          maxHistoryMessages: MAX_ROUTINE_HISTORY_MESSAGES,
          skipMemoryRead: false,
          tools: {
            read: true,
            includeMemoryRead: !scoped || domains.memory,
            mutations: canMutate ? mutationDomains : null,
            routines: false,
          },
        };
      }

      if (isPureGreeting(text)) {
        return {
          mode: 'minimal',
          primerModules: [],
          sections: { plot: false, history: false, cards: false, memory: false },
          budgets: { plot: 0, history: 0, maxActions: 0, cards: 0, memory: 0 },
          maxSnapshotChars: 2400,
          historyCharsCap: 2000,
          skipMemoryRead: true,
          tools: { read: false, mutations: null, routines: false },
        };
      }

      if (isPureMetaHelp(text)) {
        const metaDomains = detectDomains(text, { allowBroadPlot: true });
        const primerModules = [];
        if (metaDomains.routines) primerModules.push('routines');
        if (metaDomains.plot) primerModules.push('plot');
        if (metaDomains.cards) primerModules.push('cards');
        if (metaDomains.memory) primerModules.push('memory');
        if (!primerModules.length) primerModules.push('plot', 'cards', 'routines');
        return {
          mode: 'minimal',
          primerModules,
          sections: { plot: false, history: false, cards: false, memory: false },
          budgets: { plot: 0, history: 0, maxActions: 0, cards: 0, memory: 0 },
          maxSnapshotChars: 4200,
          historyCharsCap: 2500,
          skipMemoryRead: true,
          tools: { read: false, mutations: null, routines: false },
        };
      }

      const routineCommand = ROUTINE_COMMAND_RE.test(text);
      let domains = detectDomains(text, { allowBroadPlot: true, stripRoutineNames: routineCommand });
      const hasAdventureDomain = domains.plot || domains.cards || domains.memory || domains.history;
      if (domains.routines && !hasAdventureDomain) {
        return {
          mode: 'routines',
          primerModules: ['routines'],
          sections: { plot: false, history: false, cards: false, memory: false },
          budgets: { plot: 0, history: 0, maxActions: 0, cards: 0, memory: 0 },
          maxSnapshotChars: 3500,
          historyCharsCap: 4000,
          skipMemoryRead: true,
          tools: { read: false, mutations: null, routines: true },
        };
      }

      if (!hasAdventureDomain && !domains.routines) {
        const prior = this.messages.filter(msg => (
          (msg.role === 'user' || msg.role === 'assistant')
          && msg.status !== 'error'
          && msg.excluded !== true
          && typeof msg.content === 'string'
          && msg.content.trim().length > 0
        ));
        const previousTurn = prior.slice(Math.max(0, prior.length - 3), Math.max(0, prior.length - 1));
        if (previousTurn.length) {
          const priorText = previousTurn.map(msg => msg.content).join('\n');
          const inherited = detectDomains(priorText, { allowBroadPlot: true, stripRoutineNames: ROUTINE_COMMAND_RE.test(priorText) });
          if (inherited.plot || inherited.cards || inherited.memory || inherited.routines) {
            domains = mergeDomains(domains, inherited);
          }
        }
      }

      const specificDomain = domains.plot || domains.cards || domains.memory;
      if (specificDomain) {
        const primerModules = [];
        if (domains.plot) primerModules.push('plot');
        if (domains.cards) primerModules.push('cards');
        if (domains.memory) primerModules.push('memory');
        if (domains.routines) primerModules.push('routines');
        const plotSection = domains.plot
          ? (domains.plotFields.length && !domains.plotGeneral ? domains.plotFields : true)
          : false;
        const historyActions = domains.history ? 10 : (domains.cards ? 6 : 4);
        const historyBudget = domains.history ? 6000 : (domains.cards ? 3500 : 2500);
        return {
          mode: 'focused',
          primerModules: pushChangeModule(primerModules),
          sections: {
            plot: plotSection,
            history: true,
            cards: domains.cards,
            memory: domains.memory,
          },
          budgets: {
            plot: plotSection === false ? 0 : (domains.cards || domains.history ? 7000 : 10000),
            history: historyBudget,
            maxActions: historyActions,
            cards: domains.cards ? 4000 : 0,
            memory: domains.memory ? 4000 : 0,
          },
          maxSnapshotChars: DEFAULT_SNAPSHOT_MAX_CHARS,
          historyCharsCap: MAX_HISTORY_CHARS,
          skipMemoryRead: false,
          tools: {
            read: true,
            includeMemoryRead: true,
            mutations: canMutate
              ? { plot: domains.plot, thirdPerson: domains.plot || domains.thirdPerson, cards: domains.cards, memory: domains.memory }
              : null,
            routines: domains.routines,
          },
        };
      }

      return {
        mode: 'general',
        primerModules: pushChangeModule(['plot', 'cards', ...(domains.routines ? ['routines'] : [])]),
        sections: { plot: ['memory', 'authorsNote', 'storySummary'], history: true, cards: true, memory: false },
        budgets: { plot: 5500, history: 6000, maxActions: 10, cards: 2500, memory: 0 },
        maxSnapshotChars: DEFAULT_SNAPSHOT_MAX_CHARS,
        historyCharsCap: MAX_HISTORY_CHARS,
        skipMemoryRead: false,
        tools: {
          read: true,
          includeMemoryRead: true,
          mutations: canMutate ? { plot: true, thirdPerson: true, cards: true, memory: true } : null,
          routines: domains.routines,
        },
      };
    }

    async buildSystemInstruction(signal, maxChars, plan = null) {
      const built = await this.buildTurnContext(signal, maxChars, plan);
      return built.instruction;
    }

    async buildTurnContext(signal, maxChars, plan = null) {
      const snapshot = await this.refreshContext({ signal, maxChars, plan });
      const tools = this.getToolDefinitions(plan);
      const instruction = `${snapshot.systemInstruction}${this.buildToolGuidance(tools)}`;
      return { instruction, snapshot, tools };
    }

    buildToolGuidance(tools, options = {}) {
      const definitions = Array.isArray(tools) ? tools : [];
      const hasMutation = definitions.some(tool => this.isMutationTool(tool.name));
      const lines = [];
      if (hasMutation) {
        lines.push(this.changeMode === 'automatic'
          ? 'Change mode: Automatic (non-deletion changes apply immediately and verify; deletions require approval).'
          : 'Change mode: Approval (changes require player approval; never claim they applied).');
      } else if (this.changeMode === 'none' || !this.mutations) {
        lines.push('Change mode: No changes (change tools disabled; draft as plain text only).');
      }
      if (options.dropped) lines.push(TOOL_DROP_GUIDANCE);
      return lines.length ? `\n\n${lines.join('\n')}` : '';
    }

    resolveThinkingLevel(status) {
      const supported = Array.isArray(status?.config?.thinkingLevels) && status.config.thinkingLevels.length
        ? status.config.thinkingLevels
        : (Array.isArray(status?.thinkingLevels) ? status.thinkingLevels : []);
      if (!supported.length) return this.thinkingLevel;
      return supported.includes(this.thinkingLevel) ? this.thinkingLevel : (supported.includes('low') ? 'low' : supported[0]);
    }

    getToolDefinitions(plan = null) {
      const toolScope = plan?.tools || null;
      const definitions = [];
      if (!toolScope || toolScope.read !== false) {
        const readDefs = this.tools?.definitions?.() || [];
        const includeMemoryRead = !toolScope || toolScope.includeMemoryRead !== false;
        definitions.push(...readDefs.filter(tool => (
          includeMemoryRead || (tool.name !== 'search_memory_bank' && tool.name !== 'get_memory')
        )));
      }
      const allowRoutines = !!this.routines && !this.routineId && (!toolScope || toolScope.routines === true);
      if (allowRoutines) definitions.push(...NavigatorRoutines.navigatorDefinitions());
      if (this.changeMode !== 'none') {
        const mutationScope = toolScope ? toolScope.mutations : { plot: true, thirdPerson: true, cards: true, memory: true };
        if (mutationScope) {
          const allMutations = this.mutations?.definitions?.() || [];
          definitions.push(...allMutations.filter(tool => {
            if (tool.name === 'propose_plot_component_change') return mutationScope.plot === true;
            if (tool.name === 'propose_third_person_change') return mutationScope.thirdPerson === true;
            if (tool.name.startsWith('propose_story_card_')) return mutationScope.cards === true;
            if (tool.name.startsWith('propose_memory_')) return mutationScope.memory === true;
            return true;
          }));
        }
        if (allowRoutines) definitions.push(NavigatorRoutines.proposalDefinition());
      }
      return definitions;
    }

    getTurnAllowances(maxInputChars, toolsOffered, isRoutine = Boolean(this.routineId)) {
      const ledger = Math.max(0, Number.isFinite(maxInputChars) ? maxInputChars : MAX_INPUT_CHARS);
      const historyCeiling = isRoutine ? MAX_ROUTINE_HISTORY_CHARS : MAX_HISTORY_CHARS;
      const historyDemand = Math.min(historyCeiling, Math.floor(ledger * HISTORY_LEDGER_SHARE));
      const toolDemand = toolsOffered
        ? Math.min(MAX_TOOL_RESULT_CHARS_PER_TURN, Math.floor(ledger * TOOL_RESULT_LEDGER_SHARE))
        : 0;
      const reserveCeiling = Math.floor(ledger * MAX_RESERVE_LEDGER_SHARE);
      const demand = historyDemand + toolDemand;
      const scale = demand > reserveCeiling && demand > 0 ? reserveCeiling / demand : 1;
      return {
        historyAllowance: Math.max(0, Math.floor(historyDemand * scale)),
        toolResultAllowance: Math.max(0, Math.floor(toolDemand * scale)),
      };
    }

    isMutationTool(name) {
      return String(name || '').startsWith('propose_');
    }

    isSideEffectTool(name) {
      return this.isMutationTool(name) || name === 'run_routine';
    }

    summarizeToolInput(name, args = {}) {
      const summary = {};
      if (typeof args.query === 'string' && args.query.trim()) {
        summary.query = boundedActivityText(args.query);
      }
      if (name === 'get_plot_components') {
        summary.target = Array.isArray(args.components) && args.components.length
          ? boundedActivityText(args.components.join(', '))
          : 'Plot Components';
      } else if (name === 'get_story_card') {
        summary.target = args.id ? `Story Card ${boundedActivityText(args.id)}` : 'Story Card';
      } else if (name === 'search_story_cards' && !summary.query) {
        summary.target = args.type ? `${boundedActivityText(args.type)} cards` : 'Story Card list';
      } else if (name === 'get_memory') {
        summary.target = args.id
          ? `Memory Bank entry ${boundedActivityText(args.id)}`
          : `Memory Bank entry #${Number.isSafeInteger(args.index) ? args.index + 1 : '?'}`;
      } else if (name === 'get_story_actions') {
        if (args.actionId === undefined && args.fromIndex === undefined) {
          summary.target = boundedActivityText(`latest ${args.count || 10} actions`);
        } else {
          const anchor = args.actionId
            ? `action ${boundedActivityText(args.actionId)}`
            : `action #${Number.isSafeInteger(args.fromIndex) ? args.fromIndex + 1 : '?'}`;
          summary.target = boundedActivityText(`${args.count || 10} actions ${args.direction || 'around'} ${anchor}`);
        }
      }
      return summary;
    }

    summarizeToolResult(name, result, inputSummary = {}) {
      const summary = { ...inputSummary };
      const data = result?.data && typeof result.data === 'object' ? result.data : {};
      if (name === 'get_plot_components') {
        summary.resultCount = Array.isArray(data.components) ? data.components.length : 0;
      } else if (name === 'search_story_cards' || name === 'search_story_history' || name === 'search_memory_bank') {
        summary.resultCount = Number.isFinite(data.returned) ? data.returned : 0;
        summary.resultTotal = Number.isFinite(data.totalMatches) ? data.totalMatches : summary.resultCount;
      } else if (name === 'get_story_actions') {
        summary.resultCount = Array.isArray(data.actions) ? data.actions.length : 0;
      } else if (name === 'get_story_card') {
        summary.resultCount = data.card ? 1 : 0;
        if (data.card?.title) summary.target = boundedActivityText(data.card.title);
      } else if (name === 'get_memory') {
        summary.resultCount = data && Object.keys(data).length ? 1 : 0;
        if (Number.isSafeInteger(data.index)) summary.target = `Memory Bank entry #${data.index + 1}`;
      }
      return summary;
    }

    startToolActivity(messageId, call, round) {
      if (this.isMutationTool(call?.name)) return null;
      const message = this.findMessage(messageId);
      if (!message) return null;
      const activity = {
        id: createId('tool'),
        round,
        name: boundedActivityText(call.name || 'unknown_tool'),
        status: 'running',
        startedAt: Date.now(),
        durationMs: null,
        summary: this.summarizeToolInput(call.name, call.arguments || {}),
        errorCode: null,
      };
      message.toolActivityTrail = [...(message.toolActivityTrail || []), activity];
      this.emit('update', message);
      this.schedulePersist();
      return activity;
    }

    finishToolActivity(messageId, activityId, envelope) {
      if (!activityId) return;
      const message = this.findMessage(messageId);
      const activity = message?.toolActivityTrail?.find(candidate => candidate.id === activityId);
      if (!message || !activity) return;
      const failed = envelope?.isError === true || envelope?.result?.ok === false;
      activity.status = failed ? 'error' : 'success';
      activity.durationMs = Math.max(0, Date.now() - (activity.startedAt || Date.now()));
      activity.summary = failed
        ? { ...activity.summary, detail: 'Tool could not complete' }
        : this.summarizeToolResult(activity.name, envelope?.result, activity.summary);
      activity.errorCode = failed
        ? boundedActivityText(envelope?.result?.error?.code || 'tool_failed')
        : null;
      delete activity.startedAt;
      this.emit('update', message);
      this.schedulePersist();
    }

    settleRunningToolActivity(messageId, detail = 'Tool execution stopped') {
      const message = this.findMessage(messageId);
      if (!message || !Array.isArray(message.toolActivityTrail)) return;
      let changed = false;
      for (const activity of message.toolActivityTrail) {
        if (activity.status !== 'running') continue;
        activity.status = 'error';
        activity.durationMs = Math.max(0, Date.now() - (activity.startedAt || Date.now()));
        activity.summary = { ...activity.summary, detail: boundedActivityText(detail) };
        activity.errorCode = 'interrupted';
        delete activity.startedAt;
        changed = true;
      }
      if (changed) this.emit('update', message);
    }

    registerProposal(messageId, proposal) {
      const message = this.findMessage(messageId);
      if (!message) throw { code: 'unavailable', message: 'Navigator lost the message that owns this proposal.' };
      const proposals = Array.isArray(message.proposals) ? message.proposals : [];
      message.proposals = [...proposals, proposal];
      this.emit('update', message);
      this.schedulePersist();
    }

    shedTools(tools, fixedChars, maxInputChars) {
      if (!Array.isArray(tools) || !tools.length) return tools || [];
      const ranked = tools
        .map((tool, index) => ({ tool, index, chars: JSON.stringify(tool).length }))
        .sort((left, right) => right.chars - left.chars || left.index - right.index);
      const kept = tools.slice();
      while (
        kept.length
        && fixedChars + JSON.stringify(kept).length > maxInputChars
      ) {
        const candidate = ranked.find(item => kept.includes(item.tool));
        if (!candidate) break;
        kept.splice(kept.indexOf(candidate.tool), 1);
      }
      return kept;
    }

    async executeToolCalls(
      calls,
      signal,
      remainingChars,
      messageId,
      snapshot = this.contextSnapshot,
      memo = null,
      round = 0,
      options = {}
    ) {
      if (!this.tools) {
        throw {
          code: 'unavailable',
          message: 'Navigator read tools are not loaded. Reload the page and try again.',
          retryable: true,
        };
      }

      const results = [];
      let charsUsed = 0;
      const budgetError = call => ({
        callId: call.id,
        name: call.name,
        isError: true,
        result: {
          ok: false,
          error: {
            code: 'context_budget_exhausted',
            message: 'Navigator reached this turn\'s read-tool budget.',
          },
        },
      });

      for (let index = 0; index < calls.length; index++) {
        const call = calls[index];
        const isMutation = this.isMutationTool(call.name);
        const isSideEffect = this.isSideEffectTool(call.name);
        let proposalToRegister = null;
        if (signal.aborted) {
          throw { code: 'aborted', message: 'Navigator tool execution was stopped.', retryable: false };
        }
        const activity = this.startToolActivity?.(messageId, call, round) || null;
        const memoKey = `${call.name}:${JSON.stringify(canonicalize(call.arguments || {}))}`;
        const memoize = !!memo && !isSideEffect;
        const previous = memoize ? memo.get(memoKey) : null;
        let envelope;
        if (previous) {
          envelope = {
            callId: call.id,
            name: call.name,
            isError: true,
            result: {
              ok: false,
              tool: call.name,
              error: {
                code: 'tool_already_read',
                message: `This identical tool call was already returned in round ${previous.round}; use that result instead of repeating it.`,
              },
            },
          };
        } else try {
          if (call.name === 'list_routines' || call.name === 'run_routine') {
            if (!this.routines || this.routineId) throw { code: 'unavailable', message: 'Routine commands are available only in Navigator Chat.' };
            await this.routinesReady;
            if (call.name === 'run_routine' && options.rejectMutations) throw { code: 'output_truncated', message: 'The provider cut off its output; no Routine was queued.' };
            const data = call.name === 'list_routines'
              ? this.routines.listForNavigator(call.arguments?.query)
              : this.routines.requestRun(call.arguments?.routine, call.arguments?.guidance);
            envelope = { callId: call.id, name: call.name, isError: false, result: { ok: true, tool: call.name, data } };
          } else if (isMutation) {
            if (options.rejectMutations) {
              throw {
                code: 'output_truncated',
                message: 'The provider cut off its output at the token limit; this change was not staged.',
              };
            }
            if (this.changeMode === 'none') throw { code: 'changes_disabled', message: 'Navigator No changes mode is enabled.' };
            if (call.name !== 'propose_routine_create' && !this.mutations) throw { code: 'unavailable', message: 'Navigator mutation proposals are not loaded.' };
            const proposal = call.name === 'propose_routine_create'
              ? this.routines?.makeProposal(call.arguments)
              : await this.mutations.createProposal(call.name, call.arguments, {
                index: snapshot?.index || null,
                signal,
              });
            if (!proposal) throw { code: 'unavailable', message: 'Routine proposals are unavailable.' };
            const permanent = proposal.irreversible === true || proposal.action === 'delete';
            if (this.changeMode === 'automatic' && !permanent && proposal.kind !== 'routine_create') {
              this.registerProposal(messageId, proposal);
              await this.applyProposal(messageId, proposal.id);
              const settled = this.findProposal(messageId, proposal.id).proposal;
              const applied = settled?.status === 'applied';
              envelope = {
                callId: call.id,
                name: call.name,
                isError: !applied,
                result: applied
                  ? { ok: true, tool: call.name, data: { proposalId: proposal.id, status: 'applied' } }
                  : {
                    ok: false,
                    tool: call.name,
                    error: {
                      code: settled?.error?.code || settled?.status || 'mutation_failed',
                      message: settled?.error?.message || 'Navigator could not apply this change. The change card reports the details.',
                    },
                  },
              };
            } else {
              proposalToRegister = proposal;
              envelope = {
                callId: call.id,
                name: call.name,
                isError: false,
                result: {
                  ok: true,
                  tool: call.name,
                  data: { proposalId: proposal.id, status: 'pending_approval' },
                },
              };
            }
          } else {
            const result = await this.tools.execute(call.name, call.arguments, {
              signal,
              index: snapshot?.index || null,
            });
            envelope = { callId: call.id, name: call.name, result, isError: false };
          }
        } catch (error) {
          if (signal.aborted || String(error?.code || '').toLowerCase() === 'aborted') throw error;
          envelope = {
            callId: call.id,
            name: call.name,
            isError: true,
            result: {
              ok: false,
              tool: call.name,
              error: {
                code: String(error?.code || 'tool_failed'),
                message: error?.message || 'Navigator could not execute this tool.',
              },
            },
          };
          console.warn('[Navigator] Tool failed:', call.name, error?.code || error?.message || error);
        }
        if (!previous && memoize && !envelope.isError && envelope.result?.ok !== false) {
          memo.set(memoKey, { round });
        }

        const pendingProposal = calls.slice(index + 1).some(candidate => this.isSideEffectTool(candidate.name));
        const proposalReserve = pendingProposal
          ? Math.min(PROPOSAL_RESULT_FLOOR_CHARS, Math.max(0, remainingChars - charsUsed))
          : 0;
        const available = Math.max(0, remainingChars - charsUsed - (isSideEffect ? 0 : proposalReserve));
        const reserve = TOOL_ERROR_RESERVE_CHARS * (calls.length - index);
        let serializedChars = JSON.stringify(envelope).length;
        if (!isSideEffect && serializedChars > Math.max(0, available - reserve)) {
          envelope = budgetError(call);
          serializedChars = JSON.stringify(envelope).length;
        }
        if (serializedChars > available) {
          if (pendingProposal && !isSideEffect) {
            this.finishToolActivity?.(messageId, activity?.id, envelope);
            results.push(envelope);
            charsUsed += serializedChars;
            continue;
          }
          this.finishToolActivity?.(messageId, activity?.id, budgetError(call));
          return {
            results,
            charsUsed,
            exhausted: true,
            note: 'Navigator reached this turn\'s read-tool budget; remaining tool calls were skipped.',
          };
        }

        if (proposalToRegister) this.registerProposal(messageId, proposalToRegister);
        this.finishToolActivity?.(messageId, activity?.id, envelope);
        results.push(envelope);
        charsUsed += serializedChars;
        if (!envelope.isError) this.log(`[Navigator] ${isMutation ? 'Proposal' : call.name === 'run_routine' ? 'Routine request' : 'Read tool'} executed:`, call.name);
      }
      return { results, charsUsed };
    }

    // Select the newest history that fits the input budget. The final user
    // message is mandatory; older turns are dropped oldest-first to make room.
    buildRequestMessages(
      systemInstruction,
      maxInputChars = MAX_INPUT_CHARS,
      toolChars = 0,
      historyAllowance = MAX_HISTORY_CHARS,
      toolResultAllowance = MAX_TOOL_RESULT_CHARS_PER_TURN,
      maxMessages = null
    ) {
      const usable = this.messages.filter(message => (
        (message.role === 'user' || message.role === 'assistant') &&
        message.status !== 'error' &&
        message.excluded !== true &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0
      ));

      if (!usable.length || usable[usable.length - 1].role !== 'user') {
        throw new Error('Navigator has no pending question to send.');
      }

      const maxHeadroom = Math.max(0, maxInputChars - systemInstruction.length - toolChars);
      const budget = Math.max(
        Math.min(usable[usable.length - 1].content.length, maxHeadroom),
        Math.min(historyAllowance, Math.max(0, maxHeadroom - toolResultAllowance))
      );
      const selected = [];
      let used = 0;

      for (let i = usable.length - 1; i >= 0; i--) {
        if (Number.isSafeInteger(maxMessages) && maxMessages > 0 && selected.length >= maxMessages) break;
        const msg = usable[i];
        const content = (this.routineId && i < usable.length - 1 && msg.role === 'user' && msg.source === 'routine')
          ? `[Earlier "${msg.routineName || 'Routine'}" run${msg.milestone != null ? ` at action ${msg.milestone}` : ''}]`
          : msg.content;
        const length = content.length;
        if (used + length > budget) break;
        selected.unshift({ role: msg.role, content });
        used += length;
      }

      if (!selected.length || selected[selected.length - 1].role !== 'user') {
        throw { code: 'invalid_args', message: 'That message is too long for Navigator to send. Try shortening it.', retryable: false };
      }

      // A leading assistant turn is a truncation artifact, not a real opening.
      while (selected.length && selected[0].role === 'assistant') {
        selected.shift();
      }

      return {
        messages: selected,
        truncated: selected.length < usable.length,
        historyChars: selected.reduce((sum, message) => sum + message.content.length, 0),
        omittedMessages: Math.max(0, usable.length - selected.length),
      };
    }

    trimToolResults(results, maxChars) {
      if (!Array.isArray(results) || JSON.stringify(results).length <= maxChars) return results;
      const omitted = item => ({
        ...item,
        isError: true,
        result: {
          ok: false,
          error: {
            code: 'context_budget_omitted',
            message: 'This tool result was omitted because the remaining turn budget was exhausted.',
          },
        },
      });
      const trimmed = results.map(item => ({ ...item }));
      while (trimmed.length && JSON.stringify(trimmed).length > Math.max(0, maxChars)) {
        const candidates = trimmed
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.result?.error?.code !== 'context_budget_omitted');
        if (!candidates.length) break;
        let largest = candidates[0];
        for (const candidate of candidates.slice(1)) {
          if (JSON.stringify(candidate.item).length > JSON.stringify(largest.item).length) largest = candidate;
        }
        trimmed[largest.index] = omitted(trimmed[largest.index]);
      }
      return trimmed;
    }

    // ==================== SEND ====================

    async send(text, metadata = {}) {
      const trimmed = String(text || '').trim();
      if (!trimmed) return;
      if (this.isBusy || this.destroyed) return;

      this.sending = true;
      this.controller = new AbortController();
      this.turnMetadata = metadata || {};
      this.messageMetadata = { routineId: this.routineId, runId: metadata.runId || null, source: metadata.source || 'manual', routineName: metadata.routineName || null, milestone: metadata.milestone ?? null };
      try {
        await this.runTurn(trimmed);
      } finally {
        this.controller = null;
        this.messageMetadata = {};
        this.turnMetadata = {};
        this.sending = false;
        this.emit('idle', null);
      }
    }

    async runTurn(trimmed, { addUserMessage = true } = {}) {
      this.beginRequestInspection();
      if (trimmed.length > MAX_USER_MESSAGE_CHARS) {
        if (addUserMessage) this.addMessage({ role: 'user', content: trimmed });
        this.addMessage({
          role: 'assistant',
          status: 'error',
          content: '',
          error: {
            code: 'invalid_args',
            message: `That message is ${trimmed.length} characters. Navigator accepts up to ${MAX_USER_MESSAGE_CHARS}.`,
          },
        });
        this.finishRequestInspection(null, { code: 'invalid_args', message: `That message is ${trimmed.length} characters.` });
        this.persist();
        return;
      }

      if (addUserMessage) this.addMessage({ role: 'user', content: trimmed });

      const ready = await this.checkReady();
      if (this.destroyed || this.controller?.signal.aborted) {
        this.addMessage({ role: 'assistant', status: 'aborted', content: '' });
        this.finishRequestInspection(null, { code: 'aborted', message: 'Stopped.' });
        this.persist();
        return;
      }
      if (!ready.ready) {
        this.addMessage({
          role: 'assistant',
          status: 'error',
          content: '',
          error: { code: 'not_configured', message: ready.message },
        });
        this.finishRequestInspection(null, { code: 'not_configured', message: ready.message });
        this.persist();
        return;
      }

      const assistant = this.addMessage({ role: 'assistant', status: 'pending', content: '' });
      this.streamingMessageId = assistant.id;
      const turnController = this.controller || new AbortController();
      this.controller = turnController;

      let request;
      try {
        await this.settingsReady;
        const limits = ready.status?.limits || ready.status?.config?.limits || {
          maxInputChars: MAX_INPUT_CHARS,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        };
        const turnLimits = {
          maxInputChars: Number.isSafeInteger(limits.maxInputChars) && limits.maxInputChars > 0
            ? limits.maxInputChars
            : MAX_INPUT_CHARS,
          maxOutputTokens: Number.isSafeInteger(limits.maxOutputTokens) ? limits.maxOutputTokens : MAX_OUTPUT_TOKENS,
        };
        const plan = this.planTurn(trimmed);
        const preflightTools = this.getToolDefinitions(plan);
        const preflightToolChars = JSON.stringify(preflightTools).length;
        const preflightGuidanceChars = this.buildToolGuidance(preflightTools).length;
        const baseAllowances = this.getTurnAllowances(
          turnLimits.maxInputChars,
          preflightTools.length > 0,
          Boolean(this.routineId)
        );
        const turnAllowances = {
          historyAllowance: Number.isFinite(plan.historyCharsCap)
            ? Math.min(baseAllowances.historyAllowance, plan.historyCharsCap)
            : baseAllowances.historyAllowance,
          toolResultAllowance: baseAllowances.toolResultAllowance,
        };
        const jsonOverhead = Math.min(8000, Math.floor(turnLimits.maxInputChars * 0.08));
        const availableForSnapshot = Math.max(
          0,
          turnLimits.maxInputChars
            - preflightToolChars
            - preflightGuidanceChars
            - Math.max(trimmed.length + 128, turnAllowances.historyAllowance)
            - turnAllowances.toolResultAllowance
            - jsonOverhead
        );
        const snapshotMaxChars = Math.min(
          Number.isFinite(plan.maxSnapshotChars) ? plan.maxSnapshotChars : DEFAULT_SNAPSHOT_MAX_CHARS,
          availableForSnapshot
        );
        const builtContext = await this.buildTurnContext(turnController.signal, snapshotMaxChars, plan);
        const turnTools = builtContext.tools;
        const toolChars = JSON.stringify(turnTools).length;
        const built = this.buildRequestMessages(
          builtContext.instruction,
          turnLimits.maxInputChars,
          toolChars,
          turnAllowances.historyAllowance,
          turnAllowances.toolResultAllowance,
          plan.maxHistoryMessages || null
        );
        request = {
          systemInstruction: builtContext.instruction,
          snapshot: builtContext.snapshot,
          snapshotInstruction: builtContext.snapshot.systemInstruction,
          limits: turnLimits,
          messages: built.messages,
          truncated: built.truncated,
          historyChars: built.historyChars,
          omittedMessages: built.omittedMessages,
          turnAllowances,
          tools: turnTools,
        };
        this.lastRequestInspection.model = ready.status?.model || ready.status?.modelId || ready.status?.config?.model || null;
        this.lastRequestInspection.thinkingLevel = this.resolveThinkingLevel(ready.status);
        this.lastRequestInspection.inputCap = turnLimits.maxInputChars;
        this.lastRequestInspection.snapshot = {
          capturedAtIso: builtContext.snapshot.capturedAtIso || null,
          summary: builtContext.snapshot.summary || null,
          segments: builtContext.snapshot.segments || null,
          warnings: builtContext.snapshot.warnings || [],
          partial: builtContext.snapshot.partial === true,
          degradation: builtContext.snapshot.degradation || builtContext.snapshot.summary?.degradation || null,
          sections: builtContext.snapshot.inspectionSections || null,
        };
        this.lastRequestInspection.conversation = {
          messages: built.messages.map(message => ({ role: message.role, content: message.content })),
          historyChars: built.historyChars,
          omittedMessages: built.omittedMessages,
          truncated: built.truncated === true,
        };
        this.lastRequestInspection.turnAllowances = { ...turnAllowances };
        this.emit('inspection', this.getLastRequestInspection());
      } catch (error) {
        const inspectionError = error?.code ? error : { code: 'context_unavailable', message: error?.message || 'Navigator context could not be assembled.', retryable: true };
        this.finishRequestInspection(null, inspectionError);
        this.finishWithError(
          assistant.id,
          inspectionError
        );
        return;
      }

      if (request.truncated) {
        this.updateMessage(assistant.id, { truncated: true });
      }

      let toolRounds = 0;
      let toolsDropped = false;
      let inputLimitReached = false;
      let toolResultsOmitted = 0;
      let toolLimitReached = false;
      let peakInputChars = 0;
      try {
        let tools = request.tools;
        const toolNames = [];
        const completedReadToolNames = [];
        let continuation = null;
        let toolResults = [];
        let toolResultChars = 0;
        let finalMeta = null;
        const toolMemo = new Map();

        const rebuildToolInstruction = () => {
          request.systemInstruction = `${request.snapshotInstruction}${this.buildToolGuidance(tools, { dropped: toolsDropped })}`;
        };

        while (true) {
          const fixedWithoutTools = request.systemInstruction.length
            + request.messages.reduce((sum, item) => sum + item.content.length, 0)
            + JSON.stringify(toolResults).length
            + JSON.stringify(continuation || '').length;
          let projected = fixedWithoutTools + JSON.stringify(tools).length;
          if (projected > request.limits.maxInputChars) {
            const reduced = this.shedTools(tools, fixedWithoutTools, request.limits.maxInputChars);
            if (reduced.length !== tools.length) {
              tools = reduced;
              toolsDropped = true;
              rebuildToolInstruction();
              projected = request.systemInstruction.length
                + request.messages.reduce((sum, item) => sum + item.content.length, 0)
                + JSON.stringify(tools).length
                + JSON.stringify(toolResults).length
                + JSON.stringify(continuation || '').length;
            }
            if (projected > request.limits.maxInputChars && tools.length) {
              tools = [];
              toolsDropped = true;
              rebuildToolInstruction();
            }
          }
          const fixedRoundChars = request.systemInstruction.length
            + request.messages.reduce((sum, item) => sum + item.content.length, 0)
            + JSON.stringify(tools).length
            + JSON.stringify(continuation || '').length;
          const resultHeadroom = Math.max(0, request.limits.maxInputChars - fixedRoundChars - JSON.stringify([]).length);
          const resultAllowance = Math.max(0, Math.min(
            request.turnAllowances.toolResultAllowance - toolResultChars,
            resultHeadroom
          ));
          toolResults = this.trimToolResults(toolResults, resultAllowance);
          toolResultsOmitted = toolResults.filter(item => item.result?.error?.code === 'context_budget_omitted').length;
          projected = fixedRoundChars + JSON.stringify(toolResults).length;
          if (projected > request.limits.maxInputChars && tools.length) {
            tools = [];
            toolsDropped = true;
            rebuildToolInstruction();
            projected = request.systemInstruction.length
              + request.messages.reduce((sum, item) => sum + item.content.length, 0)
              + JSON.stringify(tools).length
              + JSON.stringify(toolResults).length
              + JSON.stringify(continuation || '').length;
          }
          peakInputChars = Math.max(peakInputChars, projected);
          const roundStartLength = this.findMessage(assistant.id)?.content.length || 0;
          let roundReceivedDelta = false;
          if (projected > request.limits.maxInputChars) {
            if (!(this.findMessage(assistant.id)?.content || '').trim()) {
              throw { code: 'context_limit', message: 'Navigator could not fit this turn within the provider input limit.', retryable: false };
            }
            inputLimitReached = true;
            this.updateMessage(assistant.id, {
              content: `${this.findMessage(assistant.id)?.content || ''}\n\n[Navigator reached the provider input limit before the final response.]`,
            });
            break;
          }
          const requestPayload = {
            systemInstruction: request.systemInstruction,
            messages: request.messages,
            budget: request.limits,
            thinking: { level: this.resolveThinkingLevel(ready.status) },
            tools,
            ...(continuation ? { continuation, toolResults } : {}),
          };
          const inspectionRoundIndex = this.retainInspectionRound({
            round: toolRounds,
            systemInstruction: requestPayload.systemInstruction,
            messages: requestPayload.messages,
            tools: requestPayload.tools,
            toolResults: requestPayload.toolResults,
            continuationPresent: Boolean(continuation),
            budget: requestPayload.budget,
            thinking: requestPayload.thinking,
            projectedInputChars: projected,
          });
          const result = await window.BetterDungeonAI.chat(requestPayload, {
            consumer: CONSUMER,
            requestId: `navigator-${this.adventureId || 'unknown'}-${Date.now()}-${toolRounds}`,
            signal: turnController.signal,
            onDelta: (delta) => {
              if (this.streamingMessageId !== assistant.id) return;
              const message = this.findMessage(assistant.id);
              if (!message) return;
              if (!roundReceivedDelta && toolRounds > 0 && message.content && !/\s$/.test(message.content)) {
                message.content += '\n\n';
              }
              roundReceivedDelta = true;
              message.content += delta.text;
              message.status = 'streaming';
              message.toolActivity = null;
              this.emit('update', message);
              this.schedulePersist();
            },
          });

          if (this.streamingMessageId !== assistant.id) return;
          const message = this.findMessage(assistant.id);
          if (
            message &&
            message.content.length === roundStartLength &&
            typeof result?.text === 'string' &&
            result.text
          ) {
            message.content += result.text;
            message.status = 'streaming';
            message.toolActivity = null;
            this.emit('update', message);
          }
          finalMeta = { ...(finalMeta || {}), ...(result?.meta || {}) };
          const outputTruncated = result?.meta?.outputTruncated === true;

          const calls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
          this.updateInspectionRound(inspectionRoundIndex, {
            toolCalls: calls,
            responseMeta: result?.meta || null,
            responseTextChars: typeof result?.text === 'string' ? result.text.length : 0,
          });
          if (!calls.length) {
            if (outputTruncated) {
              this.updateMessage(assistant.id, {
                content: `${this.findMessage(assistant.id)?.content || ''}\n\n[Navigator reached the provider output token limit before completing its response.]`,
              });
            }
            break;
          }
          if (outputTruncated && calls.some(call => this.isSideEffectTool(call.name))) {
            this.updateMessage(assistant.id, {
              content: `${this.findMessage(assistant.id)?.content || ''}\n\n[Navigator did not stage a change or queue a Routine because the provider reached its output token limit.]`,
            });
          }
          const roundLimit = MAX_TOOL_ROUNDS;
          if (toolRounds >= roundLimit) {
            toolLimitReached = true;
            this.updateMessage(assistant.id, {
              content: `${this.findMessage(assistant.id)?.content || ''}\n\n[Navigator reached its ${roundLimit}-round tool limit before the final response.]`,
            });
            break;
          }

          toolRounds += 1;
          toolNames.push(...calls.map(call => call.name));
          const currentContent = this.findMessage(assistant.id)?.content || '';
          this.updateMessage(assistant.id, {
            status: currentContent ? 'streaming' : 'pending',
            toolActivity: { round: toolRounds, names: calls.map(call => call.name) },
          });
          const executed = await this.executeToolCalls(
            calls,
            turnController.signal,
            calls.some(call => this.isSideEffectTool(call.name))
              ? Math.max(resultAllowance, PROPOSAL_RESULT_FLOOR_CHARS)
              : resultAllowance,
            assistant.id,
            request.snapshot,
            toolMemo,
            toolRounds,
            { rejectMutations: outputTruncated }
          );
          const activity = calls.map(call => {
            const envelope = executed.results.find(item => item.callId === call.id || item.name === call.name);
            const inputSummary = this.summarizeToolInput(call.name, call.arguments || {});
            return {
              name: boundedActivityText(call.name || 'unknown_tool'),
              status: envelope?.isError ? 'error' : 'success',
              errorCode: envelope?.isError ? boundedActivityText(envelope.result?.error?.code || 'tool_failed') : null,
              summary: this.summarizeToolResult(call.name, envelope?.result, inputSummary),
            };
          });
          this.updateInspectionRound(inspectionRoundIndex, {
            executionResults: executed.results,
            activity,
          });
          toolResults = executed.results;
          completedReadToolNames.push(...executed.results
            .filter(item => !item.isError && !this.isMutationTool(item.name))
            .map(item => item.name));
          toolResultChars += JSON.stringify(executed.results).length;
          continuation = result.continuation;
          if (executed.exhausted) {
            if (!(this.findMessage(assistant.id)?.content || '').trim()) {
              throw { code: 'context_budget_exhausted', message: executed.note, retryable: false };
            }
            const note = `\n\n[${executed.note}]`;
            this.updateMessage(assistant.id, { content: `${this.findMessage(assistant.id)?.content || ''}${note}` });
            break;
          }
        }

        if (this.streamingMessageId !== assistant.id) return;
        this.streamingMessageId = null;
        this.controller = null;
        this.updateMessage(assistant.id, {
          status: 'complete',
          content: this.findMessage(assistant.id)?.content || '',
          toolActivity: null,
          meta: {
            ...(finalMeta || {}),
            toolRounds,
            toolResultChars,
            inputChars: peakInputChars,
            toolsDropped,
            inputLimitReached,
            toolResultsOmitted,
            toolLimitReached,
            toolsUsed: Array.from(new Set(toolNames)),
            readToolsCompleted: Array.from(new Set(completedReadToolNames)),
          },
        });
        this.finishRequestInspection({
          ...(finalMeta || {}), peakInputChars, toolRounds, toolsDropped, inputLimitReached, toolLimitReached, toolResultsOmitted,
        }, null);
        this.persist();
      } catch (error) {
        if (this.streamingMessageId !== assistant.id) return;
        this.finishRequestInspection({
          peakInputChars,
          toolRounds,
          toolsDropped,
          inputLimitReached,
          toolLimitReached,
          toolResultsOmitted,
        }, error);
        this.finishWithError(assistant.id, error);
      }
    }

    finishWithError(messageId, error) {
      this.streamingMessageId = null;
      this.controller = null;
      this.expireMessageProposals(messageId);
      this.settleRunningToolActivity(
        messageId,
        String(error?.code || '').toLowerCase() === 'aborted' ? 'Stopped by user' : 'Tool execution interrupted'
      );

      const message = this.findMessage(messageId);
      const partial = message?.content || '';
      const code = String(error?.code || '').toLowerCase();

      // An aborted turn with partial text is kept as a readable partial answer.
      if (code === 'aborted') {
        this.updateMessage(messageId, {
          status: partial ? 'aborted' : 'error',
          error: partial ? null : this.describeError(error),
          excluded: false,
          toolActivity: null,
        });
      } else {
        this.updateMessage(messageId, {
          status: 'error',
          error: this.describeError(error),
          toolActivity: null,
        });
      }

      // A provider refusal is caused by the content of the turn that triggered
      // it. Left in history it would re-trigger on every later request, so the
      // offending user message is dropped from future context. It stays visible
      // in the transcript.
      if (code === 'prohibited_content' || code === 'safety_blocked') {
        this.excludePrecedingUserMessage(messageId);
      }

      this.persist();
    }

    expireMessageProposals(messageId) {
      const message = this.findMessage(messageId);
      if (!message) return;
      let changed = false;
      for (const proposal of message.proposals || []) {
        if (proposal.status === 'pending' || proposal.status === 'queued') {
          proposal.status = 'expired';
          proposal.error = null;
          changed = true;
        }
      }
      if (changed) this.emit('update', message);
    }

    excludePrecedingUserMessage(assistantMessageId) {
      const index = this.messages.findIndex(message => message.id === assistantMessageId);
      for (let i = index - 1; i >= 0; i--) {
        if (this.messages[i].role === 'user') {
          this.updateMessage(this.messages[i].id, { excluded: true });
          return;
        }
      }
    }

    describeError(error) {
      const code = String(error?.code || '').toLowerCase();
      const retryable = typeof error?.retryable === 'boolean'
        ? error.retryable
        : !NON_RETRYABLE_ERROR_CODES.has(code);
      switch (code) {
        case 'prohibited_content':
          return { code, retryable: false, message: 'The selected AI service refused this request under its content policy. Choose another configured service if appropriate.' };
        case 'safety_blocked':
          return { code, retryable: false, message: 'The AI provider blocked this request under its safety filters. Try rephrasing.' };
        case 'not_configured':
        case 'auth_failed':
          return { code, retryable, message: 'Navigator needs an AI provider. Open the BetterDungeon popup and go to AI.' };
        case 'rate_limit':
          return { code, retryable, message: 'The AI provider hit a rate limit. Wait a moment and try again.' };
        case 'provider_limit':
          return { code, retryable: false, message: 'The AI provider rejected this request due to an account quota or spending limit.' };
        case 'context_limit':
          return { code, retryable: false, message: 'This turn exceeded the AI model\'s context limit. Try a shorter request or start a new conversation.' };
        case 'timeout':
          return { code, retryable, message: 'The AI provider took too long to respond. Try again.' };
        case 'tool_limit':
          return { code, retryable: false, message: error?.message || 'Navigator reached its read-tool limit. Narrow the request and try again.' };
        case 'context_budget_exhausted':
          return { code, retryable: false, message: error?.message || 'Navigator reached this turn\'s read-tool budget. Start a new turn or narrow the request.' };
        case 'aborted':
          return { code, retryable: true, message: 'Stopped.' };
        case 'invalid_args':
          return { code, retryable: false, message: error?.message || 'Navigator could not send this turn because it exceeded the provider limits. Try shortening the request.' };
        case 'output_truncated':
          return { code, retryable, message: error?.message || 'The provider cut off its output at the token limit; this change was not staged.' };
        case 'extension_context_invalid':
          return { code, retryable, message: 'Navigator lost access to the extension page. Reload the adventure and try again.' };
        default:
          return {
            code: code || 'unknown',
            retryable,
            message: error?.message || 'Navigator could not complete that request.',
          };
      }
    }

    findProposal(messageId, proposalId) {
      const message = this.findMessage(messageId);
      const proposal = message?.proposals?.find(candidate => candidate.id === proposalId) || null;
      return { message, proposal };
    }

    updateProposal(messageId, proposalId, updates) {
      const { message, proposal } = this.findProposal(messageId, proposalId);
      if (!message || !proposal) return null;
      Object.assign(proposal, updates);
      this.emit('update', message);
      this.schedulePersist();
      return proposal;
    }

    rejectProposal(messageId, proposalId) {
      const { proposal } = this.findProposal(messageId, proposalId);
      if (!proposal || proposal.restored || proposal.status !== 'pending') return false;
      this.updateProposal(messageId, proposalId, { status: 'rejected', error: null });
      return true;
    }

    applyProposal(messageId, proposalId) {
      const { proposal } = this.findProposal(messageId, proposalId);
      if (!proposal || proposal.restored || proposal.status !== 'pending') return Promise.resolve(false);
      this.updateProposal(messageId, proposalId, { status: 'queued', error: null });

      const task = this.mutationQueue.then(() => this.runProposalApplication(messageId, proposalId));
      this.mutationQueue = task.catch(() => false);
      return task;
    }

    async runProposalApplication(messageId, proposalId) {
      const { proposal } = this.findProposal(messageId, proposalId);
      if (!proposal || proposal.status !== 'queued' || this.destroyed) return false;
      if (proposal.kind !== 'routine_create' && !this.mutations) {
        this.updateProposal(messageId, proposalId, {
          status: 'error',
          error: { code: 'unavailable', message: 'Navigator mutation support is unavailable. Reload the page and try again.' },
        });
        return false;
      }

      const controller = new AbortController();
      this.applyController = controller;
      this.updateProposal(messageId, proposalId, { status: 'applying', error: null });
      try {
        const result = proposal.kind === 'routine_create'
          ? await this.routines.applyProposedRule(proposal)
          : await this.mutations.apply(proposal, { signal: controller.signal });
        if (this.destroyed || controller.signal.aborted) return false;
        this.updateProposal(messageId, proposalId, {
          status: 'applied',
          error: null,
          appliedAtIso: result.appliedAtIso,
          hydration: result.hydration || null,
          cardId: result.cardId || proposal.cardId || null,
          targetLabel: result.targetLabel || proposal.targetLabel,
          updatedAtDrift: result.updatedAtDrift || null,
        });
        this.log('[Navigator] Verified mutation applied:', proposal.kind, proposal.targetLabel);
        if (proposal.kind !== 'routine_create') {
          try {
            await this.refreshContext();
          } catch (error) {
            this.log('[Navigator] Context refresh after mutation failed:', error);
          }
        }
        return true;
      } catch (error) {
        if (this.destroyed) return false;
        const code = controller.signal.aborted ? 'aborted' : String(error?.code || 'mutation_failed').toLowerCase();
        this.updateProposal(messageId, proposalId, {
          status: code === 'conflict' ? 'conflict' : (code === 'aborted' ? 'expired' : 'error'),
          error: code === 'aborted' ? null : {
            code,
            message: error?.message || 'Navigator could not apply the accepted change.',
          },
        });
        return false;
      } finally {
        if (this.applyController === controller) this.applyController = null;
        this.emit('idle', null);
      }
    }

    abortMutation() {
      if (this.applyController) {
        try { this.applyController.abort(); } catch { /* noop */ }
        this.applyController = null;
      }
      for (const message of this.messages) {
        for (const proposal of message.proposals || []) {
          if (proposal.status === 'pending' || proposal.status === 'queued' || proposal.status === 'applying') {
            proposal.status = 'expired';
            proposal.error = null;
            this.persistenceDirty = true;
          }
        }
      }
    }

    abort() {
      if (!this.controller) return;
      try {
        this.controller.abort();
      } catch {
        /* noop */
      }
      // Keep the aborted signal visible while readiness/context work settles.
    }

    destroy() {
      this.destroyed = true;
      this.abort();
      this.abortMutation();
      for (const controller of this.contextControllers) {
        try { controller.abort(); } catch { /* noop */ }
      }
      this.contextControllers.clear();
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.persist();
      try {
        chrome.storage?.onChanged?.removeListener(this.boundStorageChange);
      } catch {
        /* noop */
      }
      this.listeners.clear();
    }
  }

  NavigatorSession.CONSUMER = CONSUMER;
  NavigatorSession.MAX_INPUT_CHARS = MAX_INPUT_CHARS;
  NavigatorSession.MAX_INSPECTION_CHARS = MAX_INSPECTION_CHARS;
  NavigatorSession.CHARS_PER_TOKEN = CHARS_PER_TOKEN;
  NavigatorSession.MAX_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS;
  NavigatorSession.MAX_HISTORY_CHARS = MAX_HISTORY_CHARS;
  NavigatorSession.MAX_USER_MESSAGE_CHARS = MAX_USER_MESSAGE_CHARS;
  NavigatorSession.MAX_TOOL_ROUNDS = MAX_TOOL_ROUNDS;
  NavigatorSession.MAX_TOOL_RESULT_CHARS_PER_TURN = MAX_TOOL_RESULT_CHARS_PER_TURN;

  window.NavigatorSession = NavigatorSession;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigatorSession;
  }
})();
