// modules/scripture/module.js
//
// Frontier Scripture module. Consumes `frontier:state:scripture` and renders
// widget state from the live-count history entry matching the current action
// window.

(function () {
  if (window.ScriptureModule) return;

  const MODULE_ID = 'scripture';
  const STATE_NAME = 'scripture';
  const IN_CARD_TITLE = 'frontier:in:scripture';
  const MAX_WIDGET_EVENTS = 100;
  const DEFAULT_WIDGET_DISPLAY_OPTIONS = {
    size: 'normal',
    maxHeight: 'medium',
    layout: 'balanced',
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneObject(value) {
    if (!isObject(value) && !Array.isArray(value)) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return Array.isArray(value) ? value.slice() : { ...value };
    }
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function getOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
  }

  function selectHistoryEntry(history, liveCount) {
    if (!isObject(history)) return {};

    const liveKey = String(liveCount);
    if (Object.prototype.hasOwnProperty.call(history, liveKey) && isObject(history[liveKey])) {
      return history[liveKey];
    }

    const numericKeys = Object.keys(history)
      .map(key => ({ key, n: Number(key) }))
      .filter(entry => Number.isFinite(entry.n))
      .sort((a, b) => b.n - a.n);

    if (numericKeys.length === 0) return {};

    const liveNum = Number(liveCount);
    if (Number.isFinite(liveNum) && liveNum > 0) {
      const nearestEarlier = numericKeys.find(entry => entry.n <= liveNum);
      if (nearestEarlier && isObject(history[nearestEarlier.key])) {
        return history[nearestEarlier.key];
      }
    }

    const newest = numericKeys[0];
    return isObject(history[newest.key]) ? history[newest.key] : {};
  }

  function applyValueToWidget(config, value) {
    const validators = window.ScriptureValidators;
    if (isObject(value)) {
      const patch = validators?.filterWidgetStatePatch
        ? validators.filterWidgetStatePatch(config, cloneObject(value))
        : cloneObject(value);
      Object.assign(config, patch);
      return;
    }

    const field = validators?.getPrimitiveStateField?.(config) || 'value';
    config[field] = value;
  }

  function cardValue(card) {
    return card?.value ?? card?.entry ?? card?.description ?? '';
  }

  function parseJson(value) {
    if (isObject(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function normalizeInboxEnvelope(raw) {
    const parsed = parseJson(raw);
    const envelope = isObject(parsed) ? cloneObject(parsed) : {};
    envelope.v = 1;
    if (!isObject(envelope.responses)) envelope.responses = {};
    return envelope;
  }

  function normalizeEventQueue(rawEvents, ackSeq) {
    if (!Array.isArray(rawEvents)) return [];
    return rawEvents
      .filter(event => isObject(event))
      .map(event => ({
        ...event,
        seq: Number(event.seq || 0),
        count: Math.max(1, Number(event.count || 1)),
      }))
      .filter(event => Number.isFinite(event.seq) && event.seq > Number(ackSeq || 0))
      .sort((a, b) => a.seq - b.seq)
      .slice(-MAX_WIDGET_EVENTS);
  }

  function readAckSeq(parsed) {
    const candidates = [
      parsed?.interactions?.ackSeq,
      parsed?.interactions?.widgetAckSeq,
      parsed?.widgetEvents?.ackSeq,
      parsed?.ack?.scripture,
    ];
    let max = 0;
    for (const candidate of candidates) {
      const n = Number(candidate);
      if (Number.isFinite(n) && n > max) max = Math.floor(n);
    }
    return max;
  }

  function normalizeWidgetDisplayOptions(options = {}) {
    const raw = isObject(options) ? options : {};
    const size = ['compact', 'normal', 'comfortable', 'large'].includes(String(raw.size || '').toLowerCase())
      ? String(raw.size).toLowerCase()
      : DEFAULT_WIDGET_DISPLAY_OPTIONS.size;
    const maxHeight = ['short', 'medium', 'tall'].includes(String(raw.maxHeight || '').toLowerCase())
      ? String(raw.maxHeight).toLowerCase()
      : DEFAULT_WIDGET_DISPLAY_OPTIONS.maxHeight;
    const layout = ['balanced', 'stacked'].includes(String(raw.layout || '').toLowerCase())
      ? String(raw.layout).toLowerCase()
      : DEFAULT_WIDGET_DISPLAY_OPTIONS.layout;
    return { size, maxHeight, layout };
  }

  function buildRenderWidgets(parsed, liveCount, ctx, opts = {}) {
    const validators = window.ScriptureValidators;
    if (!validators) throw new Error('ScriptureValidators is not loaded');

    if (!isObject(parsed)) {
      return { widgets: [], errors: ['State card payload must be an object'] };
    }

    if (parsed.v !== 1) {
      return { widgets: [], errors: [`Unsupported Scripture state version: ${parsed.v}`] };
    }

    const manifestResult = validators.validateManifest(parsed.manifest, {
      allowedRiskLevel: opts.allowedRiskLevel,
    });
    const errors = manifestResult.errors.slice();
    const values = selectHistoryEntry(parsed.history, liveCount);
    const widgets = [];

    for (const widget of manifestResult.widgets) {
      const config = cloneObject(widget);
      const primaryValue = getOwn(values, widget.id);
      if (primaryValue !== undefined) {
        applyValueToWidget(config, primaryValue);
      }

      const progressValue = getOwn(values, `${widget.id}__progress`);
      if (progressValue !== undefined) {
        config.progress = progressValue;
      }

      const validation = validators.validateWidgetConfig(config.id, config, {
        allowedRiskLevel: opts.allowedRiskLevel,
      });
      if (!validation.valid) {
        errors.push(`Widget "${config.id}" invalid after values: ${validation.errors.join('; ')}`);
        continue;
      }

      widgets.push(config);
    }

    return { widgets, errors };
  }

  const ScriptureModule = {
    id: MODULE_ID,
    version: '1.0.0',
    label: 'Scripture',
    description: 'Renders Frontier widget state from scripture state cards.',
    stateNames: [STATE_NAME],
    tracksLiveCount: true,
    _renderer: null,
    _ctx: null,
    _riskLevel: 'enhanced',
    _widgetDisplayOptions: { ...DEFAULT_WIDGET_DISPLAY_OPTIONS },
    _lastParsed: null,
    _lastCtx: null,
    _eventQueue: [],
    _queueLoaded: false,
    _lastSeq: 0,
    _ackSeq: 0,
    _inboxWriteTimer: null,
    _warnedMessages: new Set(),

    mount(ctx) {
      this._ctx = ctx;
      this._renderer = new window.ScriptureWidgetRenderer({
        log: (level, ...args) => ctx.log(level, ...args),
        onInteraction: (event) => this.queueInteraction(event),
        displayOptions: this._widgetDisplayOptions,
      });
      ctx.storage.get('risk_level', 'enhanced').then((level) => {
        if (this._ctx === ctx) this.setRiskLevel(level);
      });
      ctx.storage.get('widget_display', DEFAULT_WIDGET_DISPLAY_OPTIONS).then((options) => {
        if (this._ctx === ctx) this.setWidgetDisplayOptions(options);
      });
    },

    unmount() {
      this._renderer?.destroy?.();
      this._renderer = null;
      this._ctx = null;
      this._lastParsed = null;
      this._lastCtx = null;
      if (this._inboxWriteTimer) {
        clearTimeout(this._inboxWriteTimer);
        this._inboxWriteTimer = null;
      }
    },

    onEnable(ctx) {
      ctx.log('debug', 'Scripture enabled');
    },

    onDisable(ctx) {
      ctx.log('debug', 'Scripture disabled');
      this._renderer?.clearAllWidgets?.();
    },

    onAdventureChange(_newAdventureShortId, ctx) {
      ctx.log('debug', 'Adventure changed; clearing Scripture widgets');
      this._renderer?.clearAllWidgets?.();
      this._eventQueue = [];
      this._queueLoaded = false;
      this._lastSeq = 0;
      this._ackSeq = 0;
      this._lastParsed = null;
      this._lastCtx = null;
      this._warnedMessages.clear();
      if (this._inboxWriteTimer) {
        clearTimeout(this._inboxWriteTimer);
        this._inboxWriteTimer = null;
      }
    },

    onStateChange(name, parsed, ctx) {
      if (name !== STATE_NAME) return;

      try {
        if (!this._renderer) this.mount(ctx);

        if (parsed == null) {
          this._renderer.clearAllWidgets();
          this._lastParsed = null;
          this._lastCtx = null;
          return;
        }

        this.renderState(parsed, ctx);
      } catch (err) {
        ctx.log('warn', 'Scripture onStateChange failed:', err);
      }
    },

    renderState(parsed, ctx) {
      this._lastParsed = parsed;
      this._lastCtx = ctx;
      this.processInteractionAck(parsed, ctx);

      const liveCount = ctx.getLiveCount();
      const result = buildRenderWidgets(parsed, liveCount, ctx, {
        allowedRiskLevel: this._riskLevel,
      });

      if (result.errors.length) {
        this.warnOnce(ctx, 'state-warnings', 'Scripture state warnings:', result.errors);
      }

      this._renderer.setWidgets(result.widgets);
    },

    warnOnce(ctx, key, message, details) {
      const detailKey = (() => {
        try {
          return JSON.stringify(details);
        } catch {
          return String(details);
        }
      })();
      const cacheKey = `${key}:${detailKey}`;
      if (this._warnedMessages.has(cacheKey)) return;
      this._warnedMessages.add(cacheKey);
      if (this._warnedMessages.size > 200) this._warnedMessages.clear();
      ctx?.log?.('warn', message, details);
    },

    setRiskLevel(level, opts = {}) {
      const validators = window.ScriptureValidators;
      const normalized = validators?.normalizeRiskLevel
        ? validators.normalizeRiskLevel(level, 'enhanced')
        : (['safe', 'enhanced', 'unsafe'].includes(String(level).toLowerCase()) ? String(level).toLowerCase() : 'enhanced');
      this._riskLevel = normalized;

      if (opts.persist && this._ctx?.storage) {
        this._ctx.storage.set('risk_level', normalized);
      }

      if (this._lastParsed && this._lastCtx) {
        this.renderState(this._lastParsed, this._lastCtx);
      }

      return normalized;
    },

    setWidgetDisplayOptions(options, opts = {}) {
      const normalized = normalizeWidgetDisplayOptions(options);
      this._widgetDisplayOptions = normalized;
      this._renderer?.setDisplayOptions?.(normalized);

      if (opts.persist && this._ctx?.storage) {
        this._ctx.storage.set('widget_display', normalized);
      }

      return normalized;
    },

    ensureQueueLoaded(ctx = this._ctx) {
      if (this._queueLoaded) return;
      const card = ctx?.getCardByTitle?.(IN_CARD_TITLE);
      const envelope = normalizeInboxEnvelope(cardValue(card));
      const widgetEvents = isObject(envelope.widgetEvents) ? envelope.widgetEvents : {};
      this._eventQueue = normalizeEventQueue(widgetEvents.events, this._ackSeq);
      this._lastSeq = Math.max(
        Number(widgetEvents.latestSeq || 0),
        ...this._eventQueue.map(event => Number(event.seq || 0)),
        this._lastSeq,
      );
      this._queueLoaded = true;
    },

    processInteractionAck(parsed, ctx) {
      const ackSeq = readAckSeq(parsed);
      if (ackSeq <= this._ackSeq) return;

      this._ackSeq = ackSeq;
      this._renderer?.ackInteractions?.(ackSeq);
      this.ensureQueueLoaded(ctx);

      const before = this._eventQueue.length;
      this._eventQueue = this._eventQueue.filter(event => Number(event.seq || 0) > ackSeq);
      if (this._eventQueue.length !== before) {
        this.writeInteractionInbox(ctx).catch((err) => {
          ctx.log('warn', 'Failed to prune Scripture widget events:', err);
        });
      }
    },

    queueInteraction(event) {
      const ctx = this._ctx;
      if (!ctx || !isObject(event)) return null;

      this.ensureQueueLoaded(ctx);

      const nowMs = Date.now();
      const seq = Math.max(this._lastSeq, ...this._eventQueue.map(item => Number(item.seq || 0))) + 1;
      const record = {
        id: `scripture-${seq}`,
        seq,
        widgetId: event.widgetId,
        widgetType: event.widgetType,
        action: event.action || 'change',
        event: event.event || event.action || 'change',
        value: cloneJson(event.value),
        previousValue: cloneJson(event.previousValue),
        liveCount: ctx.getLiveCount(),
        actionId: ctx.getCurrentActionId?.() || ctx.getTail?.() || null,
        risk: event.risk || 'enhanced',
        ts: nowMs,
        at: new Date(nowMs).toISOString(),
        count: 1,
      };

      if (event.name) record.name = event.name;
      if (event.label) record.label = event.label;
      if (event.coalesceKey) record.coalesceKey = event.coalesceKey;

      if (record.coalesceKey) {
        const replaced = this._eventQueue.filter(item => item.coalesceKey === record.coalesceKey);
        this._eventQueue = this._eventQueue.filter(item => item.coalesceKey !== record.coalesceKey);

        if (replaced.length) {
          const first = replaced[0];
          record.coalesced = true;
          record.replaces = replaced.map(item => item.seq);
          record.count = replaced.reduce((sum, item) => sum + Math.max(1, Number(item.count || 1)), 0) + 1;
          record.firstAt = first.firstAt || first.at || record.at;
          record.firstValue = first.firstValue !== undefined ? cloneJson(first.firstValue) : cloneJson(first.value);
        }
      }

      this._eventQueue.push(record);
      this._eventQueue = this._eventQueue
        .filter(item => Number(item.seq || 0) > this._ackSeq)
        .sort((a, b) => a.seq - b.seq)
        .slice(-MAX_WIDGET_EVENTS);
      this._lastSeq = seq;

      this.scheduleInteractionInboxWrite(ctx, !record.coalesceKey);

      return record;
    },

    scheduleInteractionInboxWrite(ctx = this._ctx, immediate = false) {
      if (this._inboxWriteTimer) {
        clearTimeout(this._inboxWriteTimer);
        this._inboxWriteTimer = null;
      }

      const run = () => {
        this._inboxWriteTimer = null;
        this.writeInteractionInbox(ctx).catch((err) => {
          ctx.log('warn', 'Failed to write Scripture widget event:', err);
        });
      };

      if (immediate) {
        run();
      } else {
        this._inboxWriteTimer = setTimeout(run, 120);
      }
    },

    async writeInteractionInbox(ctx = this._ctx) {
      if (!ctx?.writeCard) return;
      const currentCard = ctx.getCardByTitle?.(IN_CARD_TITLE);
      const envelope = normalizeInboxEnvelope(cardValue(currentCard));
      const events = this._eventQueue.filter(event => Number(event.seq || 0) > this._ackSeq);

      envelope.widgetEvents = {
        v: 1,
        module: MODULE_ID,
        source: 'BetterDungeon',
        latestSeq: this._lastSeq,
        ackSeq: this._ackSeq,
        liveCount: ctx.getLiveCount(),
        actionId: ctx.getCurrentActionId?.() || ctx.getTail?.() || null,
        writtenAt: new Date().toISOString(),
        events,
      };

      await ctx.writeCard(IN_CARD_TITLE, JSON.stringify(envelope), {
        type: 'frontier',
        description: 'Scripture widget interaction queue.',
      });
    },

    inspect() {
      return {
        mounted: !!this._renderer,
        widgets: this._renderer ? [...this._renderer.registeredWidgets.keys()] : [],
        riskLevel: this._riskLevel,
        widgetDisplayOptions: { ...this._widgetDisplayOptions },
        widgetEventQueueLength: this._eventQueue.length,
        widgetEventLatestSeq: this._lastSeq,
        widgetEventAckSeq: this._ackSeq,
      };
    },
  };

  window.ScriptureModule = ScriptureModule;

  if (window.Frontier?.registry) {
    window.Frontier.registry.register(ScriptureModule);
  } else {
    console.warn('[Scripture] Frontier registry not available; Scripture module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScriptureModule;
  }
})();
