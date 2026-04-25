// modules/scripture/module.js
//
// Frontier Scripture module. Consumes `frontier:state:scripture` and renders
// widget state from the live-count history entry matching the current action
// window.

(function () {
  if (window.ScriptureModule) return;

  const MODULE_ID = 'scripture';
  const STATE_NAME = 'scripture';

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
    if (isObject(value)) {
      Object.assign(config, cloneObject(value));
      return;
    }

    switch (config.type) {
      case 'text':
      case 'badge':
        config.text = value;
        break;
      case 'icon':
        config.icon = value;
        break;
      default:
        config.value = value;
        break;
    }
  }

  function buildRenderWidgets(parsed, liveCount, ctx) {
    const validators = window.ScriptureValidators;
    if (!validators) throw new Error('ScriptureValidators is not loaded');

    if (!isObject(parsed)) {
      return { widgets: [], errors: ['State card payload must be an object'] };
    }

    if (parsed.v !== 1) {
      return { widgets: [], errors: [`Unsupported Scripture state version: ${parsed.v}`] };
    }

    const manifestResult = validators.validateManifest(parsed.manifest);
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

      const validation = validators.validateWidgetConfig(config.id, config);
      if (!validation.valid) {
        errors.push(`Widget "${config.id}" invalid after values: ${validation.errors.join('; ')}`);
        continue;
      }

      widgets.push(config);
    }

    if (!manifestResult.valid) {
      ctx?.log?.('warn', 'Scripture manifest contained invalid widgets:', manifestResult.errors);
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

    mount(ctx) {
      this._ctx = ctx;
      this._renderer = new window.ScriptureWidgetRenderer({
        log: (level, ...args) => ctx.log(level, ...args),
      });
    },

    unmount() {
      this._renderer?.destroy?.();
      this._renderer = null;
      this._ctx = null;
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
    },

    onStateChange(name, parsed, ctx) {
      if (name !== STATE_NAME) return;

      try {
        if (!this._renderer) this.mount(ctx);

        if (parsed == null) {
          this._renderer.clearAllWidgets();
          return;
        }

        const liveCount = ctx.getLiveCount();
        const result = buildRenderWidgets(parsed, liveCount, ctx);

        if (result.errors.length) {
          ctx.log('warn', 'Scripture state warnings:', result.errors);
        }

        this._renderer.setWidgets(result.widgets);
      } catch (err) {
        ctx.log('warn', 'Scripture onStateChange failed:', err);
      }
    },

    inspect() {
      return {
        mounted: !!this._renderer,
        widgets: this._renderer ? [...this._renderer.registeredWidgets.keys()] : [],
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
