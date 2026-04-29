// modules/scripture/renderer.js
//
// DOM renderer for Scripture widgets. It intentionally keeps the legacy
// BetterScripts CSS class names so existing widget styles remain pixel-stable
// while the data source moves to Frontier state cards.

(function () {
  if (window.ScriptureWidgetRenderer) return;

  const validators = () => window.ScriptureValidators;
  const DEFAULT_DISPLAY_OPTIONS = {
    size: 'normal',
    maxHeight: 'medium',
    layout: 'balanced',
  };

  function normalizeDisplayOptions(options = {}) {
    const raw = options && typeof options === 'object' ? options : {};
    const size = ['compact', 'normal', 'comfortable', 'large'].includes(String(raw.size || '').toLowerCase())
      ? String(raw.size).toLowerCase()
      : DEFAULT_DISPLAY_OPTIONS.size;
    const maxHeight = ['short', 'medium', 'tall'].includes(String(raw.maxHeight || '').toLowerCase())
      ? String(raw.maxHeight).toLowerCase()
      : DEFAULT_DISPLAY_OPTIONS.maxHeight;
    const layout = ['balanced', 'stacked'].includes(String(raw.layout || '').toLowerCase())
      ? String(raw.layout).toLowerCase()
      : DEFAULT_DISPLAY_OPTIONS.layout;
    return { size, maxHeight, layout };
  }

  class ScriptureWidgetRenderer {
    constructor(options = {}) {
      this.logFn = typeof options.log === 'function' ? options.log : null;
      this.onInteraction = typeof options.onInteraction === 'function' ? options.onInteraction : null;
      this.displayOptions = normalizeDisplayOptions(options.displayOptions);
      this.registeredWidgets = new Map();
      this.pendingInteractionValues = new Map();
      this.widgetContainer = null;
      this.widgetWrapper = null;
      this.widgetZones = { left: null, center: null, right: null };
      this.boundResizeHandler = null;
      this.resizeDebounceTimer = null;
      this.layoutObserver = null;
      this.gameTextMaskObserver = null;
      this.cachedLayout = null;
      this._densityRafId = null;
      this._lastLayoutLogKey = '';
      this._lastDensityLogKey = '';
      this._warnedMessages = new Set();
    }

    log(...args) {
      if (this.logFn) this.logFn('debug', ...args);
    }

    warn(...args) {
      if (this.logFn) this.logFn('warn', ...args);
      else console.warn('[Scripture]', ...args);
    }

    warnOnce(key, ...args) {
      if (this._warnedMessages.has(key)) return;
      this._warnedMessages.add(key);
      if (this._warnedMessages.size > 200) this._warnedMessages.clear();
      this.warn(...args);
    }

    getCurrentWidgetConfig(widgetId, fallback) {
      return this.registeredWidgets.get(widgetId)?.config || fallback;
    }

    setDisplayOptions(options = {}) {
      this.displayOptions = normalizeDisplayOptions({ ...this.displayOptions, ...options });
      this.applyDisplayOptions();
      this.updateContainerPosition();
      this.recalculateWidgetDensity();
      return { ...this.displayOptions };
    }

    applyDisplayOptions() {
      if (!this.widgetContainer) return;
      this.widgetContainer.dataset.widgetSize = this.displayOptions.size;
      this.widgetContainer.dataset.widgetHeight = this.displayOptions.maxHeight;
      this.widgetContainer.dataset.widgetLayout = this.displayOptions.layout;
    }

    isInteractiveType(type) {
      return validators().INTERACTIVE_WIDGET_TYPES?.has?.(type);
    }

    applyPendingInteractionValue(config) {
      if (!config?.id || !this.pendingInteractionValues.has(config.id)) return config;
      if (!this.isInteractiveType(config.type)) return config;
      const pending = this.pendingInteractionValues.get(config.id);
      return { ...config, value: pending.value, _optimisticSeq: pending.seq };
    }

    ackInteractions(ackSeq) {
      const n = Number(ackSeq || 0);
      if (!Number.isFinite(n)) return;
      for (const [widgetId, pending] of [...this.pendingInteractionValues.entries()]) {
        if (Number(pending.seq || 0) <= n) {
          this.pendingInteractionValues.delete(widgetId);
        }
      }
    }

    rememberPendingValue(widgetId, value, record) {
      if (!widgetId || !record?.seq) return;
      this.pendingInteractionValues.set(widgetId, {
        value,
        seq: Number(record.seq),
      });
    }

    emitInteraction(config, action, value, previousValue, extra = {}) {
      if (!this.onInteraction || !config?.id) return null;
      const widgetType = config.type;
      const coalesce = extra.coalesce !== undefined
        ? !!extra.coalesce
        : ['toggle', 'select', 'slider', 'input', 'textarea'].includes(widgetType);
      const detail = {
        widgetId: config.id,
        widgetType,
        action,
        event: config.event || action,
        name: config.name || config.action || null,
        label: config.label || config.text || config.title || null,
        value,
        previousValue,
        risk: validators().getWidgetRiskLevel?.(config) || config.risk || 'enhanced',
        coalesceKey: coalesce ? `${config.id}:${widgetType}:${config.event || action}` : null,
        ...extra,
      };
      return this.onInteraction(detail);
    }

    setInteractiveDisabled(element, config) {
      const disabled = !!config.disabled;
      element.classList.toggle('bd-widget-disabled', disabled);
      element.setAttribute('aria-disabled', String(disabled));
      element.querySelectorAll('button, input, select, textarea').forEach(control => {
        control.disabled = disabled;
      });
    }

    setWidgets(widgets) {
      if (!Array.isArray(widgets) || widgets.length === 0) {
        this.clearAllWidgets();
        return;
      }

      const renderWidgets = widgets.map(config => this.applyPendingInteractionValue(config));
      const desiredIds = new Set();
      for (const config of renderWidgets) {
        desiredIds.add(config.id);
      }

      for (const widgetId of [...this.registeredWidgets.keys()]) {
        if (!desiredIds.has(widgetId)) {
          this.destroyWidget(widgetId);
        }
      }

      for (const config of renderWidgets) {
        this.createOrUpdateWidget(config.id, config);
      }

      this.reorderWidgets(renderWidgets);
      this.recalculateWidgetDensity();
    }

    createOrUpdateWidget(widgetId, config) {
      const existing = this.registeredWidgets.get(widgetId);
      if (existing && existing.config.type === config.type) {
        this.updateWidget(widgetId, config);
      } else {
        this.createWidget(widgetId, config);
      }
    }

    reorderWidgets(widgets) {
      if (!this.widgetZones) return;
      for (const config of widgets) {
        const data = this.registeredWidgets.get(config.id);
        if (!data?.element) continue;
        const align = validators().VALID_ALIGNMENTS.has(config.align) ? config.align : 'center';
        const zone = this.widgetZones[align];
        if (zone && data.element.parentNode === zone) {
          zone.appendChild(data.element);
        }
      }
    }

    createWidgetContainer() {
      if (this.widgetContainer && document.body.contains(this.widgetContainer)) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'bd-betterscripts-wrapper bd-scripture-wrapper';
      wrapper.id = 'bd-betterscripts-wrapper';
      Object.assign(wrapper.style, {
        position: 'fixed',
        zIndex: '1000',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
      });

      this.widgetContainer = document.createElement('div');
      this.widgetContainer.className = 'bd-betterscripts-container bd-scripture-container';
      this.widgetContainer.id = 'bd-betterscripts-top';
      this.applyDisplayOptions();

      const leftZone = document.createElement('div');
      leftZone.className = 'bd-bar-zone bd-bar-left bd-scripture-zone';

      const centerZone = document.createElement('div');
      centerZone.className = 'bd-bar-zone bd-bar-center bd-scripture-zone';

      const rightZone = document.createElement('div');
      rightZone.className = 'bd-bar-zone bd-bar-right bd-scripture-zone';

      this.widgetContainer.appendChild(leftZone);
      this.widgetContainer.appendChild(centerZone);
      this.widgetContainer.appendChild(rightZone);
      this.widgetZones = { left: leftZone, center: centerZone, right: rightZone };

      wrapper.appendChild(this.widgetContainer);
      document.body.appendChild(wrapper);
      this.widgetWrapper = wrapper;

      this.updateContainerPosition();
      this.setupLayoutMonitoring();
      this.log('Widget container created');
    }

    detectLayout() {
      const layout = {
        navHeight: 56,
        contentLeft: 0,
        contentWidth: window.innerWidth,
        contentTop: 56,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        gameTextMask: null,
      };

      const navSelectors = [
        'nav',
        '[role="navigation"]',
        'header',
        '.navbar',
        '#navbar',
      ];

      for (const selector of navSelectors) {
        const nav = document.querySelector(selector);
        if (!nav) continue;
        const rect = nav.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 100) {
          layout.navHeight = rect.height;
          layout.contentTop = rect.bottom;
          break;
        }
      }

      const gameTextMask = document.querySelector('.game-text-mask');
      if (gameTextMask) {
        const rect = gameTextMask.getBoundingClientRect();
        if (rect.width > 100) {
          layout.contentLeft = rect.left;
          layout.contentWidth = rect.width;
          layout.gameTextMask = gameTextMask;
          this.cachedLayout = layout;
          return layout;
        }
      }

      const contentSelectors = [
        '#gameplay-output',
        '[class*="gameplay"]',
        'main',
        '[role="main"]',
        '.main-content',
      ];

      for (const selector of contentSelectors) {
        const content = document.querySelector(selector);
        if (!content) continue;
        const rect = content.getBoundingClientRect();
        if (rect.width > 100) {
          layout.contentLeft = rect.left;
          layout.contentWidth = rect.width;
          break;
        }
      }

      this.cachedLayout = layout;
      return layout;
    }

    updateContainerPosition() {
      if (!this.widgetWrapper) return;

      const layout = this.detectLayout();
      const viewportPadding = 8;
      const maxWidth = Math.max(0, window.innerWidth - (viewportPadding * 2));
      const desiredWidth = layout.contentWidth > 0 ? layout.contentWidth : maxWidth;
      const width = Math.max(
        0,
        Math.min(desiredWidth, maxWidth),
      );
      const left = Math.max(
        viewportPadding,
        Math.min(layout.contentLeft, Math.max(viewportPadding, window.innerWidth - width - viewportPadding)),
      );
      const top = Math.max(0, layout.contentTop + 6);
      Object.assign(this.widgetWrapper.style, {
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
      });

      const logKey = `${Math.round(top)}:${Math.round(left)}:${Math.round(width)}`;
      if (logKey !== this._lastLayoutLogKey) {
        this._lastLayoutLogKey = logKey;
        this.log('Container positioned:', { top, left, width });
      }
    }

    recalculateWidgetDensity() {
      if (this._densityRafId) return;
      this._densityRafId = requestAnimationFrame(() => {
        this._densityRafId = null;
        this._performDensityCalculation();
      });
    }

    _performDensityCalculation() {
      if (!this.widgetContainer || !this.widgetWrapper) return;

      const containerWidth = this.widgetWrapper.offsetWidth;
      if (containerWidth <= 0) return;

      const widgetCount = this.registeredWidgets.size;
      if (widgetCount === 0) {
        this.widgetContainer.removeAttribute('data-density');
        return;
      }

      delete this.widgetContainer.dataset.density;

      const containerStyles = getComputedStyle(this.widgetContainer);
      const containerPadding = parseFloat(containerStyles.paddingLeft) +
        parseFloat(containerStyles.paddingRight);
      const containerGap = parseFloat(containerStyles.gap) || 6;

      let totalWidgetWidth = 0;
      for (const [, data] of this.registeredWidgets) {
        if (data.element) totalWidgetWidth += data.element.offsetWidth;
      }

      const activeZones = Object.values(this.widgetZones)
        .filter(z => z && z.children.length > 0);
      const zoneCount = activeZones.length;
      const widgetsInZones = activeZones.reduce((sum, z) => sum + z.children.length, 0);

      let zoneGap = containerGap;
      if (activeZones.length > 0) {
        zoneGap = parseFloat(getComputedStyle(activeZones[0]).gap) || containerGap;
      }

      const intraZoneGaps = Math.max(0, widgetsInZones - zoneCount) * zoneGap;
      const interZoneGaps = Math.max(0, zoneCount - 1) * containerGap;
      const usedWidth = totalWidgetWidth + intraZoneGaps + interZoneGaps + containerPadding;
      const ratio = usedWidth / containerWidth;

      let density = null;
      if (ratio > 1.2) {
        density = 'dense';
      } else if (ratio > 0.9) {
        density = 'compact';
      } else if (ratio < 0.4 && widgetCount <= 3) {
        density = 'spacious';
      }

      if (density) {
        this.widgetContainer.dataset.density = density;
      }

      const isOverflowing = this.widgetContainer.scrollHeight > this.widgetContainer.clientHeight;
      this.widgetContainer.classList.toggle('bd-scrollable', isOverflowing);
      const densityLog = {
        ratio: Number(ratio.toFixed(2)),
        widgetCount,
        containerWidth,
        isOverflowing,
      };
      const logKey = `${density || 'normal'}:${densityLog.ratio}:${widgetCount}:${Math.round(containerWidth)}:${isOverflowing}`;
      if (logKey !== this._lastDensityLogKey) {
        this._lastDensityLogKey = logKey;
        this.log('Widget density:', density || 'normal', densityLog);
      }
    }

    setupLayoutMonitoring() {
      if (!this.boundResizeHandler) {
        this.boundResizeHandler = () => {
          if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
          this.resizeDebounceTimer = setTimeout(() => {
            this.updateContainerPosition();
            this.recalculateWidgetDensity();
          }, 50);
        };

        window.addEventListener('resize', this.boundResizeHandler);
        window.addEventListener('orientationchange', this.boundResizeHandler);
      }

      if (window.ResizeObserver && !this.gameTextMaskObserver) {
        const gameTextMask = document.querySelector('.game-text-mask');
        if (gameTextMask) {
          this.gameTextMaskObserver = new ResizeObserver(() => {
            this.boundResizeHandler();
          });
          this.gameTextMaskObserver.observe(gameTextMask);
          this.log('Observing game-text-mask for size changes');
        }
      }

      if (window.ResizeObserver && !this.layoutObserver && !this.gameTextMaskObserver) {
        const contentArea =
          document.querySelector('#gameplay-output') ||
          document.querySelector('main') ||
          document.body;

        this.layoutObserver = new ResizeObserver(() => {
          this.boundResizeHandler();
        });

        this.layoutObserver.observe(contentArea);
      }
    }

    removeWidgetContainer() {
      if (this._densityRafId) {
        cancelAnimationFrame(this._densityRafId);
        this._densityRafId = null;
      }

      if (this.widgetWrapper) {
        this.widgetWrapper.remove();
        this.widgetWrapper = null;
      }

      this.widgetContainer = null;
      this.widgetZones = { left: null, center: null, right: null };

      if (this.gameTextMaskObserver) {
        this.gameTextMaskObserver.disconnect();
        this.gameTextMaskObserver = null;
      }

      if (this.layoutObserver) {
        this.layoutObserver.disconnect();
        this.layoutObserver = null;
      }

      if (this.boundResizeHandler) {
        window.removeEventListener('resize', this.boundResizeHandler);
        window.removeEventListener('orientationchange', this.boundResizeHandler);
        this.boundResizeHandler = null;
      }

      if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer);
        this.resizeDebounceTimer = null;
      }

      this.cachedLayout = null;
    }

    createWidget(widgetId, config) {
      const validation = validators().validateWidgetConfig(widgetId, config, {
        allowedRiskLevel: 'unsafe',
      });
      if (!validation.valid) {
        this.warnOnce(
          `validation:${widgetId}:${validation.errors.join('|')}`,
          `Invalid widget config for "${widgetId}":`,
          validation.errors.join('; '),
        );
        this.emitError('validation_error', { widgetId, errors: validation.errors });
        return;
      }

      if (this.registeredWidgets.has(widgetId)) {
        const existingData = this.registeredWidgets.get(widgetId);
        if (existingData.config.type === config.type) {
          this.updateWidget(widgetId, config);
          return;
        }
        this.destroyWidget(widgetId);
      }

      this.createWidgetContainer();

      let widgetElement;
      switch (config.type) {
        case 'stat':
          widgetElement = this.createStatWidget(widgetId, config);
          break;
        case 'bar':
          widgetElement = this.createBarWidget(widgetId, config);
          break;
        case 'text':
          widgetElement = this.createTextWidget(widgetId, config);
          break;
        case 'panel':
          widgetElement = this.createPanelWidget(widgetId, config);
          break;
        case 'custom':
          widgetElement = this.createCustomWidget(widgetId, config);
          break;
        case 'badge':
          widgetElement = this.createBadgeWidget(widgetId, config);
          break;
        case 'list':
          widgetElement = this.createListWidget(widgetId, config);
          break;
        case 'icon':
          widgetElement = this.createIconWidget(widgetId, config);
          break;
        case 'counter':
          widgetElement = this.createCounterWidget(widgetId, config);
          break;
        case 'button':
          widgetElement = this.createButtonWidget(widgetId, config);
          break;
        case 'toggle':
          widgetElement = this.createToggleWidget(widgetId, config);
          break;
        case 'select':
          widgetElement = this.createSelectWidget(widgetId, config);
          break;
        case 'slider':
          widgetElement = this.createSliderWidget(widgetId, config);
          break;
        case 'input':
          widgetElement = this.createInputWidget(widgetId, config);
          break;
        case 'textarea':
          widgetElement = this.createTextareaWidget(widgetId, config);
          break;
        default:
          this.warn('Unknown widget type:', config.type);
          return;
      }

      if (!widgetElement || !this.widgetContainer) return;

      const align = validators().VALID_ALIGNMENTS.has(config.align) ? config.align : 'center';
      const zone = this.widgetZones[align];
      if (zone) zone.appendChild(widgetElement);
      else this.widgetContainer.appendChild(widgetElement);

      this.registeredWidgets.set(widgetId, { element: widgetElement, config: { ...config } });
      this.recalculateWidgetDensity();
      this.emitWidget('created', widgetId, config);
    }

    createStatWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-stat', config);

      const label = document.createElement('span');
      label.className = 'bd-widget-label';
      label.textContent = config.label || 'Stat';

      const value = document.createElement('span');
      value.className = 'bd-widget-value';
      value.textContent = config.value ?? '0';

      this.applyPresetOrInlineColor(widget, value, config.color, 'color');

      widget.appendChild(label);
      widget.appendChild(value);
      return widget;
    }

    createBarWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-bar', config);

      const label = document.createElement('span');
      label.className = 'bd-widget-label';
      label.textContent = config.label || 'Progress';

      const barContainer = document.createElement('div');
      barContainer.className = 'bd-widget-bar-container';

      const barFill = document.createElement('div');
      barFill.className = 'bd-widget-bar-fill';

      const max = config.max ?? 100;
      const percentage = Math.min(100, Math.max(0, ((config.value ?? 0) / max) * 100));
      barFill.style.width = `${percentage}%`;
      this.applyPresetOrInlineColor(widget, barFill, config.color, 'background');

      const valueText = document.createElement('span');
      valueText.className = 'bd-widget-bar-text';
      valueText.textContent = config.showValue !== false ? `${config.value ?? 0}/${config.max ?? 100}` : '';

      barContainer.appendChild(barFill);
      barContainer.appendChild(valueText);
      widget.appendChild(label);
      widget.appendChild(barContainer);
      return widget;
    }

    createTextWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-text', config);
      widget.textContent = config.text ?? '';
      if (config.color) widget.style.color = config.color;
      this.applyStyles(widget, config.style);
      return widget;
    }

    createPanelWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-panel', config);

      if (config.title) {
        const title = document.createElement('div');
        title.className = 'bd-widget-panel-title';
        title.textContent = config.title;
        widget.appendChild(title);
      }

      const content = document.createElement('div');
      content.className = 'bd-widget-panel-content';
      this.populatePanelContent(content, config);
      widget.appendChild(content);
      return widget;
    }

    createCustomWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-custom', config);
      if (config.html) widget.innerHTML = validators().sanitizeHTML(config.html);
      if (config.color) widget.style.color = config.color;
      this.applyStyles(widget, config.style);
      return widget;
    }

    createBadgeWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-badge', config);

      if (config.icon) {
        const icon = document.createElement('span');
        icon.className = 'bd-widget-badge-icon';
        icon.textContent = config.icon;
        widget.appendChild(icon);
      }

      const text = document.createElement('span');
      text.className = 'bd-widget-badge-text';
      text.textContent = config.text ?? config.label ?? '';
      widget.appendChild(text);

      if (config.color) widget.style.setProperty('--badge-color', config.color);
      if (config.variant) widget.dataset.variant = config.variant;
      return widget;
    }

    createListWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-list', config);

      if (config.title) {
        const title = document.createElement('div');
        title.className = 'bd-widget-list-title';
        title.textContent = config.title;
        widget.appendChild(title);
      }

      const list = document.createElement('ul');
      list.className = 'bd-widget-list-items';
      this.populateListItems(list, config.items);
      widget.appendChild(list);
      return widget;
    }

    createIconWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-icon', config);
      widget.textContent = config.icon ?? config.text ?? '*';
      if (config.color) widget.style.color = config.color;
      if (config.size) {
        widget.style.setProperty('--icon-size', typeof config.size === 'number' ? `${config.size}px` : config.size);
      }
      if (config.tooltip || config.title) widget.title = config.tooltip || config.title;
      return widget;
    }

    createCounterWidget(widgetId, config) {
      const widget = this.createBaseWidget(widgetId, 'bd-widget-counter', config);

      if (config.icon) {
        const icon = document.createElement('span');
        icon.className = 'bd-widget-counter-icon';
        icon.textContent = config.icon;
        widget.appendChild(icon);
      }

      const value = document.createElement('span');
      value.className = 'bd-widget-counter-value';
      value.textContent = config.value ?? 0;
      if (config.color) value.style.color = config.color;
      widget.appendChild(value);

      this.applyCounterDelta(widget, config.delta);
      return widget;
    }

    createInteractiveShell(widgetId, typeClass, config) {
      const widget = this.createBaseWidget(widgetId, `${typeClass} bd-widget-interactive`, config);
      if (config.tooltip || config.title) widget.title = config.tooltip || config.title;
      this.applyStyles(widget, config.style);
      return widget;
    }

    createControlLabel(config, fallback) {
      const label = document.createElement('span');
      label.className = 'bd-widget-control-label';
      label.textContent = config.label ?? fallback;
      return label;
    }

    createButtonWidget(widgetId, config) {
      const widget = this.createInteractiveShell(widgetId, 'bd-widget-button', config);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bd-widget-control bd-widget-button-control';
      if (config.variant) button.dataset.variant = config.variant;

      if (config.icon) {
        const icon = document.createElement('span');
        icon.className = 'bd-widget-control-icon';
        icon.textContent = config.icon;
        button.appendChild(icon);
      }

      const text = document.createElement('span');
      text.className = 'bd-widget-button-text';
      text.textContent = config.text ?? config.label ?? 'Button';
      button.appendChild(text);

      button.addEventListener('click', () => {
        const currentConfig = this.getCurrentWidgetConfig(widgetId, config);
        if (currentConfig.disabled) return;
        const value = currentConfig.value !== undefined ? currentConfig.value : true;
        this.emitInteraction(currentConfig, 'press', value, undefined, { coalesce: !!currentConfig.coalesce });
      });

      widget.appendChild(button);
      this.setInteractiveDisabled(widget, config);
      return widget;
    }

    createToggleWidget(widgetId, config) {
      const widget = this.createInteractiveShell(widgetId, 'bd-widget-toggle', config);
      const wrap = document.createElement('label');
      wrap.className = 'bd-widget-toggle-control';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!config.value;

      const slider = document.createElement('span');
      slider.className = 'bd-widget-toggle-slider';

      const label = this.createControlLabel(config, 'Toggle');

      input.addEventListener('change', () => {
        const currentConfig = this.getCurrentWidgetConfig(widgetId, config);
        const previousValue = !!currentConfig.value;
        const nextValue = !!input.checked;
        const record = this.emitInteraction(currentConfig, 'change', nextValue, previousValue);
        this.rememberPendingValue(widgetId, nextValue, record);
      });

      wrap.appendChild(input);
      wrap.appendChild(slider);
      widget.appendChild(wrap);
      widget.appendChild(label);
      this.setInteractiveDisabled(widget, config);
      return widget;
    }

    createSelectWidget(widgetId, config) {
      const widget = this.createInteractiveShell(widgetId, 'bd-widget-select', config);
      const label = this.createControlLabel(config, 'Select');
      const select = document.createElement('select');
      select.className = 'bd-widget-control bd-widget-select-control';
      this.populateSelectOptions(select, config.options, config.value);

      select.addEventListener('change', () => {
        const currentConfig = this.getCurrentWidgetConfig(widgetId, config);
        const nextValue = this.readSelectValue(select);
        const previousValue = currentConfig.value;
        const record = this.emitInteraction(currentConfig, 'change', nextValue, previousValue);
        this.rememberPendingValue(widgetId, nextValue, record);
      });

      widget.appendChild(label);
      widget.appendChild(select);
      this.setInteractiveDisabled(widget, config);
      return widget;
    }

    createSliderWidget(widgetId, config) {
      const widget = this.createInteractiveShell(widgetId, 'bd-widget-slider', config);
      const label = this.createControlLabel(config, 'Slider');
      const valueText = document.createElement('span');
      valueText.className = 'bd-widget-slider-value';

      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'bd-widget-control bd-widget-slider-control';
      const min = config.min ?? 0;
      const max = config.max ?? 100;
      const step = config.step ?? 1;
      const value = config.value ?? min;
      range.min = String(min);
      range.max = String(max);
      range.step = String(step);
      range.value = String(value);
      valueText.textContent = config.showValue === false ? '' : String(value);

      range.addEventListener('input', () => {
        const currentConfig = this.getCurrentWidgetConfig(widgetId, config);
        const nextValue = Number(range.value);
        valueText.textContent = currentConfig.showValue === false ? '' : String(nextValue);
        const previousValue = currentConfig.value ?? currentConfig.min ?? min;
        const record = this.emitInteraction(currentConfig, 'change', nextValue, previousValue);
        this.rememberPendingValue(widgetId, nextValue, record);
      });

      widget.appendChild(label);
      widget.appendChild(range);
      widget.appendChild(valueText);
      this.setInteractiveDisabled(widget, config);
      return widget;
    }

    createInputWidget(widgetId, config) {
      const widget = this.createInteractiveShell(widgetId, 'bd-widget-input', config);
      const label = this.createControlLabel(config, 'Input');
      const input = document.createElement('input');
      input.className = 'bd-widget-control bd-widget-input-control';
      input.type = config.inputType || 'text';
      input.value = config.value ?? '';
      input.placeholder = config.placeholder || '';
      input.maxLength = config.maxLength || validators().MAX_INPUT_LENGTH || 240;

      input.addEventListener('input', () => {
        const currentConfig = this.getCurrentWidgetConfig(widgetId, config);
        const nextValue = currentConfig.inputType === 'number' ? Number(input.value) : input.value;
        const previousValue = currentConfig.value ?? '';
        const record = this.emitInteraction(currentConfig, 'change', nextValue, previousValue);
        this.rememberPendingValue(widgetId, nextValue, record);
      });

      widget.appendChild(label);
      widget.appendChild(input);
      this.setInteractiveDisabled(widget, config);
      return widget;
    }

    createTextareaWidget(widgetId, config) {
      const widget = this.createInteractiveShell(widgetId, 'bd-widget-textarea', config);
      const label = this.createControlLabel(config, 'Text');
      const textarea = document.createElement('textarea');
      textarea.className = 'bd-widget-control bd-widget-textarea-control';
      textarea.value = config.value ?? '';
      textarea.placeholder = config.placeholder || '';
      textarea.rows = config.rows || 2;
      textarea.maxLength = config.maxLength || validators().MAX_TEXTAREA_LENGTH || 1200;

      textarea.addEventListener('input', () => {
        const currentConfig = this.getCurrentWidgetConfig(widgetId, config);
        const nextValue = textarea.value;
        const previousValue = currentConfig.value ?? '';
        const record = this.emitInteraction(currentConfig, 'change', nextValue, previousValue);
        this.rememberPendingValue(widgetId, nextValue, record);
      });

      widget.appendChild(label);
      widget.appendChild(textarea);
      this.setInteractiveDisabled(widget, config);
      return widget;
    }

    createBaseWidget(widgetId, typeClass, config) {
      const widget = document.createElement('div');
      widget.className = `bd-widget ${typeClass}`;
      widget.id = `bd-widget-${widgetId}`;
      widget.style.pointerEvents = 'auto';
      if (config.order !== undefined) widget.style.order = config.order;
      return widget;
    }

    updateWidget(widgetId, config) {
      const widgetData = this.registeredWidgets.get(widgetId);
      if (!widgetData) {
        this.createWidget(widgetId, config);
        return;
      }

      const { element, config: existingConfig } = widgetData;
      if (existingConfig.type !== config.type) {
        this.createWidget(widgetId, config);
        return;
      }

      if (config.align !== undefined && config.align !== existingConfig.align) {
        const newAlign = validators().VALID_ALIGNMENTS.has(config.align) ? config.align : 'center';
        const targetZone = this.widgetZones[newAlign];
        if (targetZone && element.parentNode !== targetZone) targetZone.appendChild(element);
      }

      switch (existingConfig.type) {
        case 'stat':
          this.updateStatWidget(element, config);
          break;
        case 'bar':
          this.updateBarWidget(element, config, existingConfig);
          break;
        case 'text':
          element.textContent = config.text ?? '';
          element.style.color = config.color || '';
          this.replaceStyles(element, existingConfig.style, config.style);
          break;
        case 'panel':
          this.updatePanelWidget(element, config);
          break;
        case 'custom':
          element.innerHTML = config.html !== undefined ? validators().sanitizeHTML(config.html) : '';
          element.style.color = config.color || '';
          this.replaceStyles(element, existingConfig.style, config.style);
          break;
        case 'badge':
          this.updateBadgeWidget(element, config);
          break;
        case 'list':
          this.updateListWidget(element, config);
          break;
        case 'icon':
          this.updateIconWidget(element, config);
          break;
        case 'counter':
          this.updateCounterWidget(element, config);
          break;
        case 'button':
        case 'toggle':
        case 'select':
        case 'slider':
        case 'input':
        case 'textarea':
          this.updateInteractiveWidget(element, widgetId, config, existingConfig);
          break;
      }

      if (config.order !== undefined) element.style.order = config.order;
      else element.style.order = '';

      this.registeredWidgets.set(widgetId, { element, config: { ...config } });
      this.recalculateWidgetDensity();
      this.emitWidget('updated', widgetId, config);
    }

    updateStatWidget(element, config) {
      const labelEl = element.querySelector('.bd-widget-label');
      const valueEl = element.querySelector('.bd-widget-value');
      if (labelEl) labelEl.textContent = config.label ?? 'Stat';
      if (valueEl) valueEl.textContent = config.value ?? '0';
      if (valueEl) this.applyPresetOrInlineColor(element, valueEl, config.color, 'color', true);
    }

    updateBarWidget(element, config) {
      const labelEl = element.querySelector('.bd-widget-label');
      const barFill = element.querySelector('.bd-widget-bar-fill');
      const barText = element.querySelector('.bd-widget-bar-text');

      if (labelEl) labelEl.textContent = config.label ?? 'Progress';
      if (barFill) {
        const value = config.value ?? 0;
        const max = config.max ?? 100;
        const percentage = Math.min(100, Math.max(0, (value / max) * 100));
        barFill.style.width = `${percentage}%`;
      }
      if (barText) {
        const showValue = config.showValue !== false;
        barText.textContent = showValue ? `${config.value ?? 0}/${config.max ?? 100}` : '';
      }
      if (barFill) this.applyPresetOrInlineColor(element, barFill, config.color, 'background', true);
    }

    updatePanelWidget(element, config) {
      const titleEl = element.querySelector('.bd-widget-panel-title');
      if (titleEl) {
        if (config.title) titleEl.textContent = config.title;
        else titleEl.remove();
      } else if (config.title) {
        const newTitle = document.createElement('div');
        newTitle.className = 'bd-widget-panel-title';
        newTitle.textContent = config.title;
        element.insertBefore(newTitle, element.firstChild);
      }

      const content = element.querySelector('.bd-widget-panel-content');
      if (content) {
        content.innerHTML = '';
        this.populatePanelContent(content, config);
      }
    }

    updateBadgeWidget(element, config) {
      const textEl = element.querySelector('.bd-widget-badge-text');
      if (textEl) {
        textEl.textContent = config.text ?? config.label ?? '';
      }

      let iconEl = element.querySelector('.bd-widget-badge-icon');
      if (config.icon) {
        if (iconEl) {
          iconEl.textContent = config.icon;
        } else {
          iconEl = document.createElement('span');
          iconEl.className = 'bd-widget-badge-icon';
          iconEl.textContent = config.icon;
          element.insertBefore(iconEl, element.firstChild);
        }
      } else if (iconEl) {
        iconEl.remove();
      }

      if (config.color !== undefined) element.style.setProperty('--badge-color', config.color);
      else element.style.removeProperty('--badge-color');
      if (config.variant !== undefined) element.dataset.variant = config.variant;
      else delete element.dataset.variant;
    }

    updateListWidget(element, config) {
      const titleEl = element.querySelector('.bd-widget-list-title');
      if (titleEl) {
        if (config.title) titleEl.textContent = config.title;
        else titleEl.remove();
      } else if (config.title) {
        const title = document.createElement('div');
        title.className = 'bd-widget-list-title';
        title.textContent = config.title;
        element.insertBefore(title, element.firstChild);
      }

      const list = element.querySelector('.bd-widget-list-items');
      if (list) {
        list.innerHTML = '';
        this.populateListItems(list, config.items);
      }
    }

    updateIconWidget(element, config) {
      element.textContent = config.icon ?? config.text ?? '*';
      element.style.color = config.color || '';
      if (config.size !== undefined) {
        element.style.setProperty('--icon-size', typeof config.size === 'number' ? `${config.size}px` : config.size);
      } else {
        element.style.removeProperty('--icon-size');
      }
      element.title = config.tooltip ?? config.title ?? '';
    }

    updateCounterWidget(element, config) {
      const valueEl = element.querySelector('.bd-widget-counter-value');

      let iconEl = element.querySelector('.bd-widget-counter-icon');
      if (config.icon) {
        if (iconEl) {
          iconEl.textContent = config.icon;
        } else {
          iconEl = document.createElement('span');
          iconEl.className = 'bd-widget-counter-icon';
          iconEl.textContent = config.icon;
          element.insertBefore(iconEl, element.firstChild);
        }
      } else if (iconEl) {
        iconEl.remove();
      }

      if (valueEl) valueEl.textContent = config.value ?? 0;
      if (valueEl) valueEl.style.color = config.color || '';
      this.applyCounterDelta(element, config.delta);
    }

    updateInteractiveWidget(element, widgetId, config, existingConfig) {
      element.title = config.tooltip ?? config.title ?? '';
      element.className = `bd-widget bd-widget-${config.type} bd-widget-interactive`;
      this.replaceStyles(element, existingConfig?.style, config.style);

      switch (config.type) {
        case 'button':
          this.updateButtonWidget(element, widgetId, config);
          break;
        case 'toggle':
          this.updateToggleWidget(element, widgetId, config);
          break;
        case 'select':
          this.updateSelectControl(element, widgetId, config, existingConfig);
          break;
        case 'slider':
          this.updateSliderControl(element, widgetId, config);
          break;
        case 'input':
          this.updateInputControl(element, widgetId, config);
          break;
        case 'textarea':
          this.updateTextareaControl(element, widgetId, config);
          break;
        default:
          return;
      }

      this.setInteractiveDisabled(element, config);
    }

    replaceInteractiveContent(element, widgetId, config) {
      let replacementContent;
      switch (config.type) {
        case 'button':
          replacementContent = this.createButtonWidget(widgetId, config);
          break;
        case 'toggle':
          replacementContent = this.createToggleWidget(widgetId, config);
          break;
        case 'select':
          replacementContent = this.createSelectWidget(widgetId, config);
          break;
        case 'slider':
          replacementContent = this.createSliderWidget(widgetId, config);
          break;
        case 'input':
          replacementContent = this.createInputWidget(widgetId, config);
          break;
        case 'textarea':
          replacementContent = this.createTextareaWidget(widgetId, config);
          break;
        default:
          return false;
      }

      element.innerHTML = '';
      while (replacementContent.firstChild) {
        element.appendChild(replacementContent.firstChild);
      }
      element.className = replacementContent.className;
      element.dataset.color = replacementContent.dataset.color || '';
      if (!replacementContent.dataset.color) delete element.dataset.color;
      return true;
    }

    updateControlLabel(element, config, fallback) {
      const label = element.querySelector('.bd-widget-control-label');
      if (label) label.textContent = config.label ?? fallback;
    }

    updateButtonWidget(element, widgetId, config) {
      const button = element.querySelector('.bd-widget-button-control');
      if (!button) {
        this.replaceInteractiveContent(element, widgetId, config);
        return;
      }

      if (config.variant) button.dataset.variant = config.variant;
      else delete button.dataset.variant;

      let icon = button.querySelector('.bd-widget-control-icon');
      if (config.icon) {
        if (!icon) {
          icon = document.createElement('span');
          icon.className = 'bd-widget-control-icon';
          button.insertBefore(icon, button.firstChild);
        }
        icon.textContent = config.icon;
      } else if (icon) {
        icon.remove();
      }

      let text = button.querySelector('.bd-widget-button-text');
      if (!text) {
        text = document.createElement('span');
        text.className = 'bd-widget-button-text';
        button.appendChild(text);
      }
      text.textContent = config.text ?? config.label ?? 'Button';
    }

    updateToggleWidget(element, widgetId, config) {
      const input = element.querySelector('.bd-widget-toggle-control input');
      if (!input) {
        this.replaceInteractiveContent(element, widgetId, config);
        return;
      }
      input.checked = !!config.value;
      this.updateControlLabel(element, config, 'Toggle');
    }

    updateSelectControl(element, widgetId, config, existingConfig) {
      const select = element.querySelector('.bd-widget-select-control');
      if (!select) {
        this.replaceInteractiveContent(element, widgetId, config);
        return;
      }

      this.updateControlLabel(element, config, 'Select');
      const optionsChanged = JSON.stringify(config.options || []) !== JSON.stringify(existingConfig?.options || []);
      if (optionsChanged) {
        select.innerHTML = '';
        this.populateSelectOptions(select, config.options, config.value);
      } else {
        select.value = this.optionDomValue(config.value);
      }
    }

    updateSliderControl(element, widgetId, config) {
      const range = element.querySelector('.bd-widget-slider-control');
      const valueText = element.querySelector('.bd-widget-slider-value');
      if (!range || !valueText) {
        this.replaceInteractiveContent(element, widgetId, config);
        return;
      }

      const min = config.min ?? 0;
      const max = config.max ?? 100;
      const step = config.step ?? 1;
      const value = config.value ?? min;
      this.updateControlLabel(element, config, 'Slider');
      range.min = String(min);
      range.max = String(max);
      range.step = String(step);
      range.value = String(value);
      valueText.textContent = config.showValue === false ? '' : String(value);
    }

    updateInputControl(element, widgetId, config) {
      const input = element.querySelector('.bd-widget-input-control');
      if (!input) {
        this.replaceInteractiveContent(element, widgetId, config);
        return;
      }

      this.updateControlLabel(element, config, 'Input');
      input.type = config.inputType || 'text';
      input.placeholder = config.placeholder || '';
      input.maxLength = config.maxLength || validators().MAX_INPUT_LENGTH || 240;
      const nextValue = String(config.value ?? '');
      if (document.activeElement !== input && input.value !== nextValue) {
        input.value = nextValue;
      }
    }

    updateTextareaControl(element, widgetId, config) {
      const textarea = element.querySelector('.bd-widget-textarea-control');
      if (!textarea) {
        this.replaceInteractiveContent(element, widgetId, config);
        return;
      }

      this.updateControlLabel(element, config, 'Text');
      textarea.placeholder = config.placeholder || '';
      textarea.rows = config.rows || 2;
      textarea.maxLength = config.maxLength || validators().MAX_TEXTAREA_LENGTH || 1200;
      const nextValue = String(config.value ?? '');
      if (document.activeElement !== textarea && textarea.value !== nextValue) {
        textarea.value = nextValue;
      }
    }

    normalizeSelectOption(option) {
      if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') {
        return { label: String(option), value: option, disabled: false };
      }
      return {
        label: String(option?.label ?? option?.value ?? ''),
        value: option?.value,
        disabled: !!option?.disabled,
      };
    }

    optionDomValue(value) {
      return `${typeof value}:${String(value)}`;
    }

    populateSelectOptions(select, options, selectedValue) {
      const normalized = Array.isArray(options) ? options.map(option => this.normalizeSelectOption(option)) : [];
      for (const option of normalized) {
        const optionEl = document.createElement('option');
        optionEl.textContent = option.label;
        optionEl.value = this.optionDomValue(option.value);
        optionEl.dataset.type = typeof option.value;
        optionEl.dataset.value = String(option.value);
        optionEl.disabled = option.disabled;
        optionEl.selected = option.value === selectedValue;
        select.appendChild(optionEl);
      }
    }

    readSelectValue(select) {
      const option = select.selectedOptions?.[0];
      if (!option) return select.value;
      const type = option.dataset.type;
      const raw = option.dataset.value;
      if (type === 'number') return Number(raw);
      if (type === 'boolean') return raw === 'true';
      return raw;
    }

    populatePanelContent(content, config) {
      if (config.items && Array.isArray(config.items)) {
        config.items.forEach(item => {
          const itemEl = document.createElement('div');
          itemEl.className = 'bd-widget-panel-item';

          if (item.label) {
            const itemLabel = document.createElement('span');
            itemLabel.className = 'bd-widget-panel-item-label';
            itemLabel.textContent = item.label;
            itemEl.appendChild(itemLabel);
          }

          if (item.value !== undefined) {
            const itemValue = document.createElement('span');
            itemValue.className = 'bd-widget-panel-item-value';
            itemValue.textContent = item.value;
            if (item.color) itemValue.style.color = item.color;
            itemEl.appendChild(itemValue);
          }

          content.appendChild(itemEl);
        });
      } else if (config.content !== undefined) {
        content.textContent = config.content;
      }
    }

    populateListItems(list, items) {
      if (!Array.isArray(items)) return;

      items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'bd-widget-list-item';

        if (typeof item === 'string') {
          li.textContent = item;
        } else if (item && typeof item === 'object') {
          if (item.icon) {
            const icon = document.createElement('span');
            icon.className = 'bd-widget-list-item-icon';
            icon.textContent = item.icon;
            li.appendChild(icon);
          }
          const text = document.createElement('span');
          text.textContent = item.text ?? item.label ?? '';
          if (item.color) text.style.color = item.color;
          li.appendChild(text);
        }

        list.appendChild(li);
      });
    }

    applyCounterDelta(element, deltaValue) {
      let deltaEl = element.querySelector('.bd-widget-counter-delta');
      if (deltaValue === undefined) {
        if (deltaEl) deltaEl.remove();
        return;
      }

      if (deltaEl) {
        if (deltaValue === 0) {
          deltaEl.remove();
        } else {
          const sign = deltaValue > 0 ? '+' : '';
          deltaEl.textContent = sign + deltaValue;
          deltaEl.dataset.positive = deltaValue > 0 ? 'true' : 'false';
        }
      } else if (deltaValue !== 0) {
        deltaEl = document.createElement('span');
        deltaEl.className = 'bd-widget-counter-delta';
        const sign = deltaValue > 0 ? '+' : '';
        deltaEl.textContent = sign + deltaValue;
        deltaEl.dataset.positive = deltaValue > 0 ? 'true' : 'false';
        element.appendChild(deltaEl);
      }
    }

    applyPresetOrInlineColor(widget, target, color, property, resetInline = false) {
      if (color === undefined || color === null || color === '') {
        delete widget.dataset.color;
        target.style[property] = '';
        return;
      }

      const colorLower = String(color).toLowerCase();
      if (validators().PRESET_COLORS.has(colorLower)) {
        widget.dataset.color = colorLower;
        if (resetInline) target.style[property] = '';
      } else {
        delete widget.dataset.color;
        target.style[property] = color;
      }
    }

    applyStyles(element, style) {
      if (!style) return;
      Object.assign(element.style, validators().sanitizeStyleObject(style));
    }

    replaceStyles(element, previousStyle, nextStyle) {
      const previous = validators().sanitizeStyleObject(previousStyle);
      const next = validators().sanitizeStyleObject(nextStyle);

      for (const property of Object.keys(previous)) {
        if (!(property in next)) {
          element.style[property] = '';
        }
      }

      Object.assign(element.style, next);
    }

    destroyWidget(widgetId) {
      const widgetData = this.registeredWidgets.get(widgetId);
      if (!widgetData) return;

      widgetData.element.remove();
      this.registeredWidgets.delete(widgetId);
      this.pendingInteractionValues.delete(widgetId);
      this.emitWidget('destroyed', widgetId);

      if (this.registeredWidgets.size === 0) this.removeWidgetContainer();
      else this.recalculateWidgetDensity();
    }

    clearAllWidgets() {
      this.registeredWidgets.forEach((data) => {
        data.element.remove();
      });
      this.registeredWidgets.clear();
      this.pendingInteractionValues.clear();
      this._warnedMessages.clear();
      this.removeWidgetContainer();
      this.log('All widgets cleared');
    }

    destroy() {
      this.clearAllWidgets();
    }

    emitWidget(action, widgetId, config) {
      window.dispatchEvent(new CustomEvent('scripture:widget', {
        detail: { action, widgetId, config },
      }));
    }

    emitError(type, detail) {
      window.dispatchEvent(new CustomEvent('scripture:error', {
        detail: { type, ...detail },
      }));
    }
  }

  window.ScriptureWidgetRenderer = ScriptureWidgetRenderer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScriptureWidgetRenderer;
  }
})();
