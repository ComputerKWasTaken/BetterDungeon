// modules/scripture/renderer.js
//
// DOM renderer for Scripture widgets. It intentionally keeps the legacy
// BetterScripts CSS class names so existing widget styles remain pixel-stable
// while the data source moves to Frontier state cards.

(function () {
  if (window.ScriptureWidgetRenderer) return;

  const validators = () => window.ScriptureValidators;

  class ScriptureWidgetRenderer {
    constructor(options = {}) {
      this.logFn = typeof options.log === 'function' ? options.log : null;
      this.registeredWidgets = new Map();
      this.widgetContainer = null;
      this.widgetWrapper = null;
      this.widgetZones = { left: null, center: null, right: null };
      this.boundResizeHandler = null;
      this.resizeDebounceTimer = null;
      this.layoutObserver = null;
      this.gameTextMaskObserver = null;
      this.cachedLayout = null;
      this._densityRafId = null;
    }

    log(...args) {
      if (this.logFn) this.logFn('debug', ...args);
    }

    warn(...args) {
      if (this.logFn) this.logFn('warn', ...args);
      else console.warn('[Scripture]', ...args);
    }

    setWidgets(widgets) {
      if (!Array.isArray(widgets) || widgets.length === 0) {
        this.clearAllWidgets();
        return;
      }

      const desiredIds = new Set();
      for (const config of widgets) {
        desiredIds.add(config.id);
      }

      for (const widgetId of [...this.registeredWidgets.keys()]) {
        if (!desiredIds.has(widgetId)) {
          this.destroyWidget(widgetId);
        }
      }

      for (const config of widgets) {
        this.createOrUpdateWidget(config.id, config);
      }

      this.reorderWidgets(widgets);
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
      wrapper.className = 'bd-betterscripts-wrapper';
      wrapper.id = 'bd-betterscripts-wrapper';
      Object.assign(wrapper.style, {
        position: 'fixed',
        zIndex: '1000',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
      });

      this.widgetContainer = document.createElement('div');
      this.widgetContainer.className = 'bd-betterscripts-container';
      this.widgetContainer.id = 'bd-betterscripts-top';

      const leftZone = document.createElement('div');
      leftZone.className = 'bd-bar-zone bd-bar-left';

      const centerZone = document.createElement('div');
      centerZone.className = 'bd-bar-zone bd-bar-center';

      const rightZone = document.createElement('div');
      rightZone.className = 'bd-bar-zone bd-bar-right';

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
      Object.assign(this.widgetWrapper.style, {
        top: `${layout.contentTop + 6}px`,
        left: `${layout.contentLeft}px`,
        width: `${layout.contentWidth}px`,
      });

      this.log('Container positioned:', {
        top: layout.contentTop + 6,
        left: layout.contentLeft,
        width: layout.contentWidth,
      });
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
      this.log('Widget density:', density || 'normal', {
        ratio: Number(ratio.toFixed(2)),
        widgetCount,
        containerWidth,
        isOverflowing,
      });
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
      const validation = validators().validateWidgetConfig(widgetId, config);
      if (!validation.valid) {
        this.warn(`Invalid widget config for "${widgetId}":`, validation.errors.join('; '));
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
      this.emitWidget('destroyed', widgetId);

      if (this.registeredWidgets.size === 0) this.removeWidgetContainer();
      else this.recalculateWidgetDensity();
    }

    clearAllWidgets() {
      this.registeredWidgets.forEach((data) => {
        data.element.remove();
      });
      this.registeredWidgets.clear();
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
