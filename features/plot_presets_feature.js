// BetterDungeon - Plot Presets Feature
// Allows users to save, manage, and apply plot component presets
// Includes in-page quick-apply overlay, active preset indicator, and quick-save

class PlotPresetsFeature {
  static id = 'plotPresets';

  constructor() {
    this.observer = null;
    this.checkInterval = null;
    this.storageKey = 'betterDungeon_plotPresets';
    this.activePresetKey = 'betterDungeon_activePlotPreset';
    this.legacyStorageKey = 'betterDungeon_favoritePresets'; // Migration source
    this.presets = [];
    this.activePresetId = null;
    this.overlayElement = null;
    this.saveButtonElement = null;
    this.presetIndicator = null;
    this.lastApplyState = null; // Previous state for undo
    this.isProcessing = false;
    this.debug = false;
    this._checkDebounceTimer = null;
    this._fieldGraceTimer = null;
    this._lastPlotTabState = null; // Track whether we were on the Plot tab
    this._indicatorPresetId = null; // Track which preset the indicator is showing
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async init() {
    console.log('[PlotPresets] Initializing Plot Presets feature...');
    await this.migrateFromLegacyStorage();
    await this.loadPresets();
    await this.loadActivePreset();
    this.setupObserver();
    this.startPolling();
    this.checkForPlotTab();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this._checkDebounceTimer) {
      clearTimeout(this._checkDebounceTimer);
      this._checkDebounceTimer = null;
    }
    if (this._fieldGraceTimer) {
      clearTimeout(this._fieldGraceTimer);
      this._fieldGraceTimer = null;
    }
    this.removeOverlay();
    this.removeSaveButton();
    this.removePresetIndicator();
  }

  // Shared helper: fade out a tracked UI element, null the reference, then
  // remove it from the DOM after the CSS transition and sweep any orphans.
  _removeUIElement(refName, visibleClass, sweepSelector) {
    const el = this[refName];
    if (el) {
      el.classList.remove(visibleClass);
      this[refName] = null;
      setTimeout(() => {
        el?.remove();
        // Sweep orphans, but protect any freshly-created element now tracked by this ref
        const current = this[refName];
        document.querySelectorAll(sweepSelector).forEach(e => {
          if (e !== current) e.remove();
        });
      }, 300); // Match CSS transition duration (0.3s)
    } else {
      document.querySelectorAll(sweepSelector).forEach(e => e.remove());
    }
  }

  removeOverlay() {
    this._removeUIElement('overlayElement', 'bd-plot-overlay-visible', '.bd-plot-preset-overlay');
  }

  removeSaveButton() {
    this._removeUIElement('saveButtonElement', 'bd-save-visible', '.bd-plot-save-wrapper');
  }

  removePresetIndicator() {
    this._indicatorPresetId = null;
    this._removeUIElement('presetIndicator', 'bd-indicator-visible', '.bd-plot-indicator');
  }

  startPolling() {
    // Poll every 500ms as a fallback for detection
    this.checkInterval = setInterval(() => {
      this.debouncedCheck();
    }, 500);
  }

  // Debounce checkForPlotTab to avoid excessive calls from MutationObserver
  debouncedCheck() {
    if (this._checkDebounceTimer) return;
    this._checkDebounceTimer = setTimeout(() => {
      this._checkDebounceTimer = null;
      this.checkForPlotTab();
    }, 250);
  }

  // ============================================
  // STORAGE OPERATIONS
  // ============================================

  // Generic chrome storage get that returns the value for `key`, or `fallback` on any error.
  _chromeGet(area, key, fallback = null) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) { resolve(fallback); return; }
        chrome.storage[area].get(key, (result) => {
          resolve(chrome.runtime.lastError ? fallback : (result[key] ?? fallback));
        });
      } catch { resolve(fallback); }
    });
  }

  // Generic chrome storage set that silently resolves on error.
  _chromeSet(area, data) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) { resolve(); return; }
        chrome.storage[area].set(data, () => resolve());
      } catch { resolve(); }
    });
  }

  // Generic chrome storage remove that silently resolves on error.
  _chromeRemove(area, key) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) { resolve(); return; }
        chrome.storage[area].remove(key, () => resolve());
      } catch { resolve(); }
    });
  }

  // ============================================
  // DATA MIGRATION
  // ============================================

  async migrateFromLegacyStorage() {
    // Check if legacy presets exist under the old key
    const legacyPresets = await this._chromeGet('sync', this.legacyStorageKey, null);
    if (!legacyPresets || !Array.isArray(legacyPresets) || legacyPresets.length === 0) return;

    // Check if new key already has data (don't overwrite)
    const existing = await this._chromeGet('sync', this.storageKey, null);
    if (existing && Array.isArray(existing) && existing.length > 0) {
      // Both exist - merge legacy into new (skip duplicates by id)
      const existingIds = new Set(existing.map(p => p.id));
      const toMerge = legacyPresets.filter(p => !existingIds.has(p.id));
      if (toMerge.length > 0) {
        const merged = [...existing, ...toMerge];
        await this._chromeSet('sync', { [this.storageKey]: merged });
        console.log(`[PlotPresets] Merged ${toMerge.length} legacy presets`);
      }
    } else {
      // No new data - copy legacy directly
      await this._chromeSet('sync', { [this.storageKey]: legacyPresets });
      console.log(`[PlotPresets] Migrated ${legacyPresets.length} legacy presets`);
    }

    // Clean up legacy key
    await this._chromeRemove('sync', this.legacyStorageKey);
  }

  async loadPresets() {
    this.presets = await this._chromeGet('sync', this.storageKey, []);
    return this.presets;
  }

  async savePresets() {
    await this._chromeSet('sync', { [this.storageKey]: this.presets });
  }

  async loadActivePreset() {
    this.activePresetId = await this._chromeGet('sync', this.activePresetKey, null);
    return this.activePresetId;
  }

  async setActivePreset(presetId) {
    this.activePresetId = presetId;
    await this._chromeSet('sync', { [this.activePresetKey]: presetId });
  }

  async createPreset(name, components) {
    const preset = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      name: name,
      components: components, // { aiInstructions, plotEssentials, authorsNote }
      useCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.presets.unshift(preset);
    await this.savePresets();
    return preset;
  }

  async updatePreset(id, updates) {
    const index = this.presets.findIndex(p => p.id === id);
    if (index === -1) return null;
    
    this.presets[index] = {
      ...this.presets[index],
      ...updates,
      updatedAt: Date.now()
    };
    
    await this.savePresets();
    return this.presets[index];
  }

  async deletePreset(id) {
    const index = this.presets.findIndex(p => p.id === id);
    if (index === -1) return false;
    
    this.presets.splice(index, 1);

    if (this.activePresetId === id) {
      this.activePresetId = null;
      await this.setActivePreset(null);
    }
    
    await this.savePresets();
    return true;
  }

  async duplicatePreset(id) {
    const source = this.presets.find(p => p.id === id);
    if (!source) return null;

    const copy = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      name: source.name + ' (Copy)',
      components: { ...source.components },
      useCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Insert right after the source
    const sourceIndex = this.presets.findIndex(p => p.id === id);
    this.presets.splice(sourceIndex + 1, 0, copy);
    await this.savePresets();
    return copy;
  }

  async incrementUseCount(id) {
    const preset = this.presets.find(p => p.id === id);
    if (preset) {
      preset.useCount++;
      preset.updatedAt = Date.now();
      await this.savePresets();
    }
  }

  getPresetsSortedByUsage() {
    return [...this.presets].sort((a, b) => b.useCount - a.useCount);
  }

  getActivePreset() {
    if (!this.activePresetId) return null;
    return this.presets.find(p => p.id === this.activePresetId) || null;
  }

  // ============================================
  // DOM DETECTION
  // ============================================

  setupObserver() {
    this.observer = new MutationObserver((mutations) => {
      if (this.isProcessing) return;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          this.debouncedCheck();
          break;
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ============================================
  // DOM OPERATIONS - Finding Elements
  // ============================================

  findPlotTab() {
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
      if (ariaLabel.includes('plot')) {
        return tab;
      }
    }
    return null;
  }

  isPlotTabActive() {
    const plotTab = this.findPlotTab();
    if (!plotTab) return false;
    // Check standard aria-selected attribute first, fall back to aria-label text
    if (plotTab.getAttribute('aria-selected') === 'true') return true;
    return plotTab.getAttribute('aria-label')?.toLowerCase().includes('selected') || false;
  }

  findPlotComponentTextareas() {
    const result = {
      aiInstructions: null,
      plotEssentials: null,
      authorsNote: null
    };

    const allTextareas = document.querySelectorAll('textarea');

    // Strategy 1: Find by placeholder text (multiple patterns)
    for (const textarea of allTextareas) {
      const placeholder = (textarea.placeholder || '').toLowerCase();
      
      // AI Instructions patterns
      if (placeholder.includes('influence') && placeholder.includes('response')) {
        result.aiInstructions = textarea;
      }
      // Author's Note patterns
      else if (placeholder.includes('influence') && (placeholder.includes('style') || placeholder.includes('writing'))) {
        result.authorsNote = textarea;
      }
      // Plot Essentials patterns
      else if (placeholder.includes('important') || placeholder.includes('essential')) {
        result.plotEssentials = textarea;
      }
    }

    // Strategy 2: Find by looking at parent labels/headers
    if (!result.aiInstructions || !result.authorsNote) {
      const plotComponents = this.findPlotComponentsByHeader();
      if (plotComponents.aiInstructions) result.aiInstructions = plotComponents.aiInstructions;
      if (plotComponents.authorsNote) result.authorsNote = plotComponents.authorsNote;
      if (plotComponents.plotEssentials) result.plotEssentials = plotComponents.plotEssentials;
    }

    return result;
  }

  // Find plot components by looking for header text near textareas
  findPlotComponentsByHeader() {
    const result = {
      aiInstructions: null,
      plotEssentials: null,
      authorsNote: null
    };

    // Look for elements containing plot component names
    const componentNames = [
      { key: 'aiInstructions', patterns: ['ai instructions', 'ai-instructions'] },
      { key: 'authorsNote', patterns: ["author's note", 'authors note', 'author note'] },
      { key: 'plotEssentials', patterns: ['plot essentials', 'plot-essentials'] }
    ];

    for (const { key, patterns } of componentNames) {
      for (const pattern of patterns) {
        // Scope to likely header elements near textareas to avoid querying thousands of DOM nodes.
        // Fall back to a broader query if the scoped one finds nothing.
        let elements = document.querySelectorAll('[class*="plot"] h1, [class*="plot"] h2, [class*="plot"] h3, [class*="plot"] h4, [class*="Plot"] h1, [class*="Plot"] h2, [class*="Plot"] h3, [class*="Plot"] h4, [role="tabpanel"] h1, [role="tabpanel"] h2, [role="tabpanel"] h3, [role="tabpanel"] h4, [role="tabpanel"] span, [role="tabpanel"] p');
        if (elements.length === 0) {
          elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span');
        }
        for (const el of elements) {
          const text = el.textContent?.toLowerCase().trim();
          if (text === pattern || text?.startsWith(pattern)) {
            // Found a header, now find the nearest textarea
            const container = el.closest('[class*="Column"], [class*="Card"], [class*="component"], section, article') || el.parentElement?.parentElement;
            if (container) {
              const textarea = container.querySelector('textarea');
              if (textarea && !result[key]) {
                result[key] = textarea;
                break;
              }
            }
          }
        }
        if (result[key]) break;
      }
    }

    return result;
  }

  // Find a suitable parent container for injecting UI elements near the plot tab.
  // Walks up the DOM from the element until it finds a layout boundary.
  getFieldContainer(element) {
    if (!element) return null;
    
    let el = element.parentElement;
    let depth = 0;
    
    while (el && el !== document.body && depth < 10) {
      if (el.parentElement && el.parentElement.children.length > 1) {
        return el.parentElement;
      }
      el = el.parentElement;
      depth++;
    }
    
    return element.parentElement?.parentElement || null;
  }

  // Check if we're on the Plot tab and handle UI accordingly.
  // Uses a grace period to avoid tearing down UI during React re-renders.
  checkForPlotTab() {
    const isActive = this.isPlotTabActive();
    
    if (isActive) {
      // Plot tab is active - cancel any pending teardown
      if (this._fieldGraceTimer) {
        clearTimeout(this._fieldGraceTimer);
        this._fieldGraceTimer = null;
      }
      
      if (this._lastPlotTabState !== true) {
        this._lastPlotTabState = true;
        this.showInPageUI();
      }
    } else {
      // Plot tab not active - use grace period before tearing down UI
      if (this._lastPlotTabState === true && !this._fieldGraceTimer) {
        this._fieldGraceTimer = setTimeout(() => {
          this._fieldGraceTimer = null;
          // Re-check: if plot tab is genuinely gone, tear down
          if (!this.isPlotTabActive()) {
            this._lastPlotTabState = false;
            this._indicatorPresetId = null;
            this.removeOverlay();
            this.removeSaveButton();
            this.removePresetIndicator();
          }
        }, 400);
      }
    }
  }

  // ============================================
  // IN-PAGE UI ORCHESTRATION
  // ============================================

  async showInPageUI() {
    await this.loadPresets();
    this.showPlotPresetOverlay();
    this.showQuickSaveButton();
    
    // Show active preset indicator if one is set
    const activePreset = this.getActivePreset();
    if (activePreset) {
      this.showPresetIndicator(activePreset);
    }
  }

  // ============================================
  // IN-PAGE UI - QUICK-APPLY OVERLAY
  // ============================================

  showPlotPresetOverlay() {
    if (this.overlayElement?.isConnected) return;
    this.removeOverlay();
    
    if (this.presets.length === 0) return;
    
    const plotTab = this.findPlotTab();
    const container = this.getFieldContainer(plotTab);
    if (!container) return;
    
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'bd-plot-preset-overlay';
    this.overlayElement.innerHTML = this.buildOverlayHTML();
    
    container.appendChild(this.overlayElement);
    
    requestAnimationFrame(() => {
      this.overlayElement?.classList.add('bd-plot-overlay-visible');
    });
    
    this.setupOverlayHandlers();
  }

  buildOverlayHTML() {
    const presets = this.getPresetsSortedByUsage();
    const activeId = this.activePresetId;
    
    const options = presets.map(p => {
      const selected = p.id === activeId ? ' selected' : '';
      const badges = this.getComponentBadges(p);
      return `<option value="${p.id}"${selected}>${this.escapeHtml(p.name)}${badges ? ' ' + badges : ''}</option>`;
    }).join('');
    
    return `
      <div class="bd-plot-overlay-row">
        <label class="bd-plot-overlay-label">Quick Apply Preset</label>
        <select class="bd-plot-overlay-dropdown">
          <option value="">-- Select Preset --</option>
          ${options}
        </select>
        <button class="bd-plot-overlay-apply" title="Replace current plot components">Apply</button>
        <button class="bd-plot-overlay-append" title="Append to current plot components">Append</button>
      </div>
    `;
  }

  getComponentBadges(preset) {
    if (!preset?.components) return '';
    const parts = [];
    if (preset.components.aiInstructions) parts.push('AI');
    if (preset.components.plotEssentials) parts.push('PE');
    if (preset.components.authorsNote) parts.push('AN');
    return parts.length > 0 ? `[${parts.join('+')}]` : '';
  }

  setupOverlayHandlers() {
    if (!this.overlayElement) return;
    
    const applyBtn = this.overlayElement.querySelector('.bd-plot-overlay-apply');
    const appendBtn = this.overlayElement.querySelector('.bd-plot-overlay-append');
    
    if (applyBtn) {
      applyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.applyPresetFromOverlay('replace');
      });
    }
    
    if (appendBtn) {
      appendBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.applyPresetFromOverlay('append');
      });
    }
  }

  async applyPresetFromOverlay(mode) {
    if (!this.overlayElement) return;
    
    const dropdown = this.overlayElement.querySelector('.bd-plot-overlay-dropdown');
    const presetId = dropdown?.value;
    
    if (!presetId) {
      this.showToast('Select a preset first', 'error');
      return;
    }
    
    const result = await this.applyPreset(presetId, mode);
    if (result.success) {
      this.showToast(`Preset applied (${result.appliedCount} components, ${mode})`, 'success');
      // Refresh indicator
      const preset = this.getActivePreset();
      if (preset) this.showPresetIndicator(preset);
    } else {
      this.showToast(result.error || 'Failed to apply', 'error');
    }
  }

  // ============================================
  // IN-PAGE UI - ACTIVE PRESET INDICATOR
  // ============================================

  showPresetIndicator(preset) {
    if (!preset) return;
    // Skip rebuild if already showing indicator for the same preset
    if (this._indicatorPresetId === preset.id && this.presetIndicator?.isConnected) return;
    this.removePresetIndicator();
    this._indicatorPresetId = preset.id;
    
    const plotTab = this.findPlotTab();
    const container = this.getFieldContainer(plotTab);
    if (!container) return;
    
    this.presetIndicator = document.createElement('div');
    this.presetIndicator.className = 'bd-plot-indicator';
    this.presetIndicator.innerHTML = `
      <div class="bd-indicator-content">
        <span style="color: var(--bd-accent-primary);">●</span>
        <span>Active: <strong style="color: var(--bd-text-primary);">${this.escapeHtml(preset.name)}</strong></span>
        <span class="bd-indicator-uses">(${preset.useCount || 0} uses)</span>
      </div>
    `;
    
    container.appendChild(this.presetIndicator);
    
    requestAnimationFrame(() => {
      this.presetIndicator?.classList.add('bd-indicator-visible');
    });
  }

  // ============================================
  // IN-PAGE UI - QUICK SAVE BUTTON
  // ============================================

  showQuickSaveButton() {
    if (this.saveButtonElement?.isConnected) return;
    this.removeSaveButton();
    
    const plotTab = this.findPlotTab();
    const container = this.getFieldContainer(plotTab);
    if (!container) return;
    
    this.saveButtonElement = document.createElement('div');
    this.saveButtonElement.className = 'bd-plot-save-wrapper';
    this.saveButtonElement.innerHTML = `
      <button class="bd-plot-save-btn" title="Save current plot components as a new preset">
        <span>💾</span> Quick Save Plot
      </button>
    `;
    
    container.appendChild(this.saveButtonElement);
    
    requestAnimationFrame(() => {
      this.saveButtonElement?.classList.add('bd-save-visible');
    });
    
    const saveBtn = this.saveButtonElement.querySelector('.bd-plot-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.quickSaveFromPage();
      });
    }
  }

  async quickSaveFromPage() {
    const name = `Plot ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const result = await this.saveCurrentAsPreset(name);
    
    if (result.success) {
      this.showToast(`Saved: "${result.preset.name}"`, 'success');
      // Refresh the overlay to include the new preset
      if (this.overlayElement?.isConnected) {
        this.overlayElement.innerHTML = this.buildOverlayHTML();
        this.setupOverlayHandlers();
      }
    } else {
      this.showToast(result.error || 'Failed to save', 'error');
    }
  }

  // ============================================
  // APPLY PRESET
  // ============================================

  async applyPreset(presetId, mode = 'replace') {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) {
      return { success: false, error: 'Preset not found' };
    }

    if (this.isProcessing) {
      return { success: false, error: 'Already processing' };
    }
    this.isProcessing = true;

    try {
      const textareas = this.findPlotComponentTextareas();
      let appliedCount = 0;

      // Capture previous state for undo
      const previousState = {
        aiInstructions: textareas.aiInstructions?.value || '',
        plotEssentials: textareas.plotEssentials?.value || '',
        authorsNote: textareas.authorsNote?.value || ''
      };

      // Apply AI Instructions
      if (preset.components.aiInstructions && textareas.aiInstructions) {
        await this.fillTextarea(textareas.aiInstructions, this.computeValue(textareas.aiInstructions, preset.components.aiInstructions, mode));
        appliedCount++;
      }

      // Apply Plot Essentials
      if (preset.components.plotEssentials && textareas.plotEssentials) {
        await this.fillTextarea(textareas.plotEssentials, this.computeValue(textareas.plotEssentials, preset.components.plotEssentials, mode));
        appliedCount++;
      }

      // Apply Author's Note
      if (preset.components.authorsNote && textareas.authorsNote) {
        await this.fillTextarea(textareas.authorsNote, this.computeValue(textareas.authorsNote, preset.components.authorsNote, mode));
        appliedCount++;
      }

      // Store for undo
      this.lastApplyState = previousState;

      // Increment use count and set as active
      await this.incrementUseCount(presetId);
      await this.setActivePreset(presetId);

      return { success: true, appliedCount, previousState };
    } catch (err) {
      this.log('[PlotPresets] Error applying preset:', err);
      return { success: false, error: 'Failed to apply preset' };
    } finally {
      this.isProcessing = false;
    }
  }

  // Compute the new value for a textarea based on mode
  computeValue(textarea, content, mode) {
    if (mode === 'append') {
      const currentValue = textarea.value || '';
      return currentValue.trim() ? currentValue + '\n\n' + content : content;
    }
    return content; // 'replace' mode
  }

  // Restore previous state (undo)
  async restorePreviousState(previousState) {
    if (this.isProcessing) {
      return { success: false, error: 'Already processing' };
    }
    this.isProcessing = true;

    try {
      const textareas = this.findPlotComponentTextareas();
      let restoredCount = 0;

      if (textareas.aiInstructions && previousState.aiInstructions !== undefined) {
        await this.fillTextarea(textareas.aiInstructions, previousState.aiInstructions);
        restoredCount++;
      }
      if (textareas.plotEssentials && previousState.plotEssentials !== undefined) {
        await this.fillTextarea(textareas.plotEssentials, previousState.plotEssentials);
        restoredCount++;
      }
      if (textareas.authorsNote && previousState.authorsNote !== undefined) {
        await this.fillTextarea(textareas.authorsNote, previousState.authorsNote);
        restoredCount++;
      }

      this.showToast('Previous state restored', 'success');
      return { success: true, restoredCount };
    } catch (err) {
      this.log('[PlotPresets] Error restoring state:', err);
      return { success: false, error: 'Failed to restore state' };
    } finally {
      this.isProcessing = false;
    }
  }

  // Fill a textarea using the native value setter so React picks up the change.
  // Mirrors the approach used by CharacterPresetFeature.typewriterFill.
  fillTextarea(textarea, text) {
    return new Promise((resolve) => {
      if (!textarea) { resolve(); return; }

      // Short-circuit for empty/null text — just clear the field directly
      if (!text) {
        textarea.focus();
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.blur();
        resolve();
        return;
      }

      textarea.focus();
      
      // Determine the correct native value setter based on the element type.
      // Using the wrong prototype's setter can fail to trigger React's synthetic events.
      const proto = textarea instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      
      if (!nativeSetter) {
        // Fallback: direct assignment if native setter is unavailable
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.blur();
        resolve();
        return;
      }
      
      // Step 1: Simulate a single keystroke to trigger React's state update.
      const firstChar = text.charAt(0) || ' ';
      nativeSetter.call(textarea, firstChar);
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: firstChar
      }));
      
      // Step 2: Brief pause for React to process the state change
      setTimeout(() => {
        // Now set the full text instantly using the native setter
        nativeSetter.call(textarea, text);
        textarea.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.blur();
        resolve();
      }, 50);
    });
  }

  // ============================================
  // UI - TOAST NOTIFICATIONS
  // ============================================

  showToast(message, type = 'info') {
    const existingToast = document.querySelector('.bd-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `bd-toast bd-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('bd-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('bd-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ============================================
  // API FOR POPUP
  // ============================================

  async getAllPresets() {
    await this.loadPresets();
    return this.getPresetsSortedByUsage();
  }

  async getPresetById(id) {
    await this.loadPresets();
    return this.presets.find(p => p.id === id) || null;
  }

  async saveCurrentAsPreset(name, includeComponents = null) {
    const textareas = this.findPlotComponentTextareas();
    
    const components = {};
    
    // Check if we should include each component (default to true if not specified)
    const shouldIncludeAi = includeComponents?.aiInstructions !== false;
    const shouldIncludeEssentials = includeComponents?.plotEssentials !== false;
    const shouldIncludeNote = includeComponents?.authorsNote !== false;
    
    if (shouldIncludeAi && textareas.aiInstructions?.value?.trim()) {
      components.aiInstructions = textareas.aiInstructions.value;
    }
    if (shouldIncludeEssentials && textareas.plotEssentials?.value?.trim()) {
      components.plotEssentials = textareas.plotEssentials.value;
    }
    if (shouldIncludeNote && textareas.authorsNote?.value?.trim()) {
      components.authorsNote = textareas.authorsNote.value;
    }

    // Fallback: If no components found by type, try to grab any visible textareas with content
    if (Object.keys(components).length === 0) {
      const allTextareas = document.querySelectorAll('textarea');
      let fallbackIndex = 0;
      for (const ta of allTextareas) {
        if (ta.value?.trim()) {
          const key = `component_${fallbackIndex}`;
          components[key] = ta.value;
          fallbackIndex++;
        }
      }
    }

    if (Object.keys(components).length === 0) {
      return { success: false, error: 'No plot components with content found. Make sure you are on the Plot tab and have text in at least one component.' };
    }

    const preset = await this.createPreset(name, components);
    return { success: true, preset };
  }

  // ============================================
  // UTILITIES
  // ============================================

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.PlotPresetsFeature = PlotPresetsFeature;
}
