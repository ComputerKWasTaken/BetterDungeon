// BetterDungeon - Plot Presets Feature
// Allows users to save, manage, and apply plot component presets

class PlotPresetsFeature {
  static id = 'favoriteInstructions';

  constructor() {
    this.observer = null;
    this.domUtils = window.DOMUtils;
    this.storageKey = 'betterDungeon_favoritePresets';
    this.presets = [];
    this.saveButton = null;
    this.debug = true;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async init() {
    console.log('[PlotPresets] Initializing Plot Presets feature...');
    await this.loadPresets();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  // ============================================
  // STORAGE OPERATIONS
  // ============================================

  async loadPresets() {
    return new Promise((resolve) => {
      // Use local storage (no per-item size limit) instead of sync (8KB cap)
      chrome.storage.local.get(this.storageKey, (localResult) => {
        const localPresets = (localResult || {})[this.storageKey];

        if (localPresets && localPresets.length > 0) {
          this.presets = localPresets;
          resolve(this.presets);
          return;
        }

        // One-time migration: pull any legacy presets from sync storage
        chrome.storage.sync.get(this.storageKey, (syncResult) => {
          const syncPresets = (syncResult || {})[this.storageKey] || [];
          this.presets = syncPresets;

          if (syncPresets.length > 0) {
            chrome.storage.local.set({ [this.storageKey]: syncPresets }, () => {
              chrome.storage.sync.remove(this.storageKey);
              this.log('[PlotPresets] Migrated presets from sync to local storage');
            });
          }

          resolve(this.presets);
        });
      });
    });
  }

  async savePresets() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [this.storageKey]: this.presets }, () => {
        if (chrome.runtime.lastError) {
          console.error('[PlotPresets] Storage save error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  async createPreset(name, components) {
    // Reload from storage to pick up any popup-side changes (deletes, edits)
    await this.loadPresets();

    const preset = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
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
    await this.loadPresets();

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
    await this.loadPresets();

    const index = this.presets.findIndex(p => p.id === id);
    if (index === -1) return false;
    
    this.presets.splice(index, 1);
    await this.savePresets();
    return true;
  }

  async incrementUseCount(id) {
    await this.loadPresets();

    const preset = this.presets.find(p => p.id === id);
    if (preset) {
      preset.useCount++;
      await this.savePresets();
    }
  }

  getPresetsSortedByUsage() {
    return [...this.presets].sort((a, b) => b.useCount - a.useCount);
  }

  // ============================================
  // NAVIGATION - Ensure Plot Tab is Visible
  // ============================================

  /**
   * Get the AIDungeonService instance from the global BetterDungeon instance.
   * This is used to navigate to the Plot settings tab when needed.
   */
  getAIDungeonService() {
    if (typeof betterDungeonInstance !== 'undefined' && betterDungeonInstance?.aiDungeonService) {
      return betterDungeonInstance.aiDungeonService;
    }
    return null;
  }

  /**
   * Get the loading screen singleton for visual feedback during async operations.
   */
  getLoadingScreen() {
    if (typeof loadingScreen !== 'undefined') {
      return loadingScreen;
    }
    if (typeof window !== 'undefined' && window.loadingScreen) {
      return window.loadingScreen;
    }
    return null;
  }

  /**
   * Ensure the Plot tab is open and textareas are visible.
   * This handles the case where the user navigated to the adventure page from another page
   * (e.g., home page) without refreshing, so the settings panel may not be open.
   * 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async ensurePlotTabVisible(onStepUpdate = null) {
    const service = this.getAIDungeonService();
    if (!service) {
      this.log('[PlotPresets] AIDungeonService not available');
      return { success: false, error: 'Navigation service not available' };
    }

    // Check if we can already find textareas — no navigation needed
    const existing = this.findPlotComponentTextareas();
    const alreadyVisible = !!(existing.aiInstructions || existing.plotEssentials || existing.authorsNote);
    this.log('[PlotPresets] Pre-nav check:', {
      aiInstructions: !!existing.aiInstructions,
      plotEssentials: !!existing.plotEssentials,
      authorsNote:    !!existing.authorsNote,
      settingsOpen:   service.isSettingsPanelOpen(),
    });

    if (alreadyVisible) {
      this.log('[PlotPresets] Plot textareas already visible, skipping navigation');
      return { success: true };
    }

    // Textareas not found — walk through the full navigation state machine
    if (!service.isOnAdventurePage()) {
      return { success: false, error: 'Navigate to an adventure first' };
    }

    this.log('[PlotPresets] Navigating: Settings → Adventure → Plot');
    const navResult = await service.navigateToPlotSettings({ onStepUpdate });
    if (!navResult.success) {
      this.log('[PlotPresets] Navigation failed:', navResult.error);
      return navResult;
    }

    // Poll for textareas to render after the subtab switch
    onStepUpdate?.('Waiting for plot components...');
    const found = await service.waitFor(() => {
      const ta = this.findPlotComponentTextareas();
      return (ta.aiInstructions || ta.plotEssentials || ta.authorsNote) ? ta : null;
    }, { interval: 150, timeout: 3000 });

    if (found) {
      this.log('[PlotPresets] Textareas found after navigation:', {
        aiInstructions: !!found.aiInstructions,
        plotEssentials: !!found.plotEssentials,
        authorsNote:    !!found.authorsNote,
      });
      return { success: true };
    }

    this.log('[PlotPresets] Textareas NOT found after navigation');
    return { success: false, error: 'Plot components not found after navigation. Make sure you have active plot components.' };
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // DOM OPERATIONS - Finding Elements
  // ============================================

  findPlotComponentTextareas() {
    // Delegate to AIDungeonService's centralized selectors for consistent detection
    const service = this.getAIDungeonService();
    if (service) {
      return {
        aiInstructions: service.findAIInstructionsTextarea(),
        plotEssentials: service.findPlotEssentialsTextarea(),
        authorsNote: service.findAuthorsNoteTextarea()
      };
    }

    // Fallback: use centralized selectors directly if service instance unavailable
    return {
      aiInstructions: document.querySelector(AIDungeonService.SEL.AI_INSTRUCTIONS),
      plotEssentials: document.querySelector(AIDungeonService.SEL.PLOT_ESSENTIALS),
      authorsNote: document.querySelector(AIDungeonService.SEL.AUTHORS_NOTE)
    };
  }

  async applyPreset(presetId, mode = 'replace') {
    // Reload from storage so we have the latest data (popup may have edited/deleted)
    await this.loadPresets();

    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) {
      return { success: false, error: 'Preset not found' };
    }

    const ls = this.getLoadingScreen();
    if (!ls) return this._doApplyPreset(preset, mode);
    return ls.queueOperation(() => this._doApplyPreset(preset, mode));
  }

  async _doApplyPreset(preset, mode) {
    const ls = this.getLoadingScreen();

    ls?.show({
      title: 'Applying Plot Preset',
      subtitle: 'Initializing...',
      showProgress: false
    });

    try {
      const navResult = await this.ensurePlotTabVisible((msg) => ls?.updateSubtitle(msg));
      if (!navResult.success) throw new Error(navResult.error);

      ls?.updateSubtitle('Applying to plot components...');
      const textareas = this.findPlotComponentTextareas();
      let appliedCount = 0;

      // Capture previous state for undo
      const previousState = {
        aiInstructions: textareas.aiInstructions?.value || '',
        plotEssentials: textareas.plotEssentials?.value || '',
        authorsNote: textareas.authorsNote?.value || ''
      };

      if (preset.components.aiInstructions && textareas.aiInstructions) {
        this.applyToTextarea(textareas.aiInstructions, preset.components.aiInstructions, mode);
        appliedCount++;
      }
      if (preset.components.plotEssentials && textareas.plotEssentials) {
        this.applyToTextarea(textareas.plotEssentials, preset.components.plotEssentials, mode);
        appliedCount++;
      }
      if (preset.components.authorsNote && textareas.authorsNote) {
        this.applyToTextarea(textareas.authorsNote, preset.components.authorsNote, mode);
        appliedCount++;
      }

      await this.incrementUseCount(preset.id);

      ls?.updateTitle('Preset Applied!');
      ls?.updateSubtitle(`Applied "${preset.name}" to ${appliedCount} component(s)`);
      await this.wait(1200);

      return { success: true, appliedCount, previousState };

    } catch (error) {
      console.error('[PlotPresets] Apply error:', error);
      ls?.updateTitle('Failed to Apply');
      ls?.updateSubtitle(error.message);
      await this.wait(2000);
      return { success: false, error: error.message };

    } finally {
      ls?.hide();
    }
  }

  // Restore previous state (undo)
  async restorePreviousState(previousState) {
    const ls = this.getLoadingScreen();
    if (!ls) return this._doRestoreState(previousState);
    return ls.queueOperation(() => this._doRestoreState(previousState));
  }

  async _doRestoreState(previousState) {
    const ls = this.getLoadingScreen();

    ls?.show({
      title: 'Restoring Previous State',
      subtitle: 'Initializing...',
      showProgress: false
    });

    try {
      const navResult = await this.ensurePlotTabVisible((msg) => ls?.updateSubtitle(msg));
      if (!navResult.success) throw new Error(navResult.error);

      ls?.updateSubtitle('Restoring plot components...');
      const textareas = this.findPlotComponentTextareas();
      let restoredCount = 0;

      if (textareas.aiInstructions && previousState.aiInstructions !== undefined) {
        this.applyToTextarea(textareas.aiInstructions, previousState.aiInstructions, 'replace');
        restoredCount++;
      }
      if (textareas.plotEssentials && previousState.plotEssentials !== undefined) {
        this.applyToTextarea(textareas.plotEssentials, previousState.plotEssentials, 'replace');
        restoredCount++;
      }
      if (textareas.authorsNote && previousState.authorsNote !== undefined) {
        this.applyToTextarea(textareas.authorsNote, previousState.authorsNote, 'replace');
        restoredCount++;
      }

      ls?.updateTitle('State Restored!');
      ls?.updateSubtitle('Previous state has been restored');
      await this.wait(1200);

      return { success: true, restoredCount };

    } catch (error) {
      console.error('[PlotPresets] Restore error:', error);
      ls?.updateTitle('Failed to Restore');
      ls?.updateSubtitle(error.message);
      await this.wait(2000);
      return { success: false, error: error.message };

    } finally {
      ls?.hide();
    }
  }

  applyToTextarea(textarea, content, mode) {
    if (!textarea) return;

    let newValue;
    if (mode === 'replace') {
      newValue = content;
    } else if (mode === 'append') {
      const currentValue = textarea.value || '';
      newValue = currentValue.trim() ? currentValue + '\n\n' + content : content;
    } else {
      newValue = content;
    }

    // Use React-compatible native setter so the framework's internal state updates
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    if (setter) {
      setter.call(textarea, newValue);
    } else {
      textarea.value = newValue;
    }

    // Dispatch events so React reconciles the change
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // Focus and blur to ensure the change is committed
    textarea.focus();
    textarea.blur();
  }

  showToast(message, type = 'info') {
    // Remove existing toast
    const existingToast = document.querySelector('.bd-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `bd-toast bd-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('bd-toast-visible');
    });

    // Remove after delay
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

  async saveCurrentAsPreset(name, includeComponents = null) {
    const ls = this.getLoadingScreen();
    if (!ls) return this._doSavePreset(name, includeComponents);
    return ls.queueOperation(() => this._doSavePreset(name, includeComponents));
  }

  async _doSavePreset(name, includeComponents = null) {
    const ls = this.getLoadingScreen();

    ls?.show({
      title: 'Saving Plot Preset',
      subtitle: 'Initializing...',
      showProgress: false
    });

    try {
      const navResult = await this.ensurePlotTabVisible((msg) => ls?.updateSubtitle(msg));
      if (!navResult.success) throw new Error(navResult.error);

      ls?.updateSubtitle('Reading plot components...');
      const textareas = this.findPlotComponentTextareas();

      const components = {};
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

      if (Object.keys(components).length === 0) {
        throw new Error('No plot components with content found. Make sure you have text in at least one component.');
      }

      ls?.updateSubtitle('Saving preset...');
      const preset = await this.createPreset(name, components);

      ls?.updateTitle('Preset Saved!');
      ls?.updateSubtitle(`"${name}" saved successfully`);
      await this.wait(1200);

      return { success: true, preset };

    } catch (error) {
      console.error('[PlotPresets] Save error:', error);
      ls?.updateTitle('Failed to Save');
      ls?.updateSubtitle(error.message);
      await this.wait(2000);
      return { success: false, error: error.message };

    } finally {
      ls?.hide();
    }
  }
}

// Make available globally (both old and new names for backward compatibility)
if (typeof window !== 'undefined') {
  window.PlotPresetsFeature = PlotPresetsFeature;
  window.FavoriteInstructionsFeature = PlotPresetsFeature;
}
