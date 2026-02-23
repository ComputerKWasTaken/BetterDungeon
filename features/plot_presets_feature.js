// BetterDungeon - Plot Presets Feature
// Allows users to save, manage, and apply plot component presets

class PlotPresetsFeature {
  static id = 'plotPresets';

  constructor() {
    this.observer = null;
    this.checkInterval = null;
    this.storageKey = 'betterDungeon_plotPresets';
    this.activePresetKey = 'betterDungeon_activePlotPreset';
    this.presets = [];
    this.activePresetId = null;
    this.saveButton = null;
    this.overlayElement = null;
    this.lastApplyState = null; // Previous state for undo
    this.isProcessing = false;
    this.debug = false;
    this._checkDebounceTimer = null;
    this._fieldGraceTimer = null;
    this._lastPlotTabState = null; // Track whether we were on the Plot tab
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async init() {
    console.log('[PlotPresets] Initializing Plot Presets feature...');
    await this.loadPresets();
    await this.loadActivePreset();
    this.setupObserver();
    this.startPolling();
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
    this._removeUIElement('saveButton', 'bd-save-visible', '.bd-plot-save-wrapper');
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
    return plotTab.getAttribute('aria-label')?.toLowerCase().includes('selected');
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
        // Find any element containing this text
        const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div');
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

  // Check if we're on the Plot tab and handle UI accordingly
  checkForPlotTab() {
    const isActive = this.isPlotTabActive();
    
    if (isActive !== this._lastPlotTabState) {
      this._lastPlotTabState = isActive;
      
      if (!isActive) {
        // Left the Plot tab - clean up UI
        this.removeOverlay();
        this.removeSaveButton();
      }
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
