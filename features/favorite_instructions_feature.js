// BetterDungeon - Favorite Instructions Feature
// Allows users to save, manage, and apply plot component presets

class FavoriteInstructionsFeature {
  static id = 'favoriteInstructions';

  constructor() {
    this.observer = null;
    this.domUtils = window.DOMUtils;
    this.storageKey = 'betterDungeon_favoritePresets';
    this.presets = [];
    this.saveButton = null;
  }

  async init() {
    console.log('[FavoriteInstructions] Initializing Favorite Instructions feature...');
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
      chrome.storage.sync.get(this.storageKey, (result) => {
        this.presets = result[this.storageKey] || [];
        resolve(this.presets);
      });
    });
  }

  async savePresets() {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [this.storageKey]: this.presets }, () => {
        resolve();
      });
    });
  }

  async createPreset(name, components) {
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
    await this.savePresets();
    return true;
  }

  async incrementUseCount(id) {
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
      const value = textarea.value || '';
      
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

  async applyPreset(presetId, mode = 'replace') {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) {
      return { success: false, error: 'Preset not found' };
    }

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
      this.applyToTextarea(textareas.aiInstructions, preset.components.aiInstructions, mode);
      appliedCount++;
    }

    // Apply Plot Essentials
    if (preset.components.plotEssentials && textareas.plotEssentials) {
      this.applyToTextarea(textareas.plotEssentials, preset.components.plotEssentials, mode);
      appliedCount++;
    }

    // Apply Author's Note
    if (preset.components.authorsNote && textareas.authorsNote) {
      this.applyToTextarea(textareas.authorsNote, preset.components.authorsNote, mode);
      appliedCount++;
    }

    // Increment use count
    await this.incrementUseCount(presetId);

    return { success: true, appliedCount, previousState };
  }

  // Restore previous state (undo)
  async restorePreviousState(previousState) {
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

    this.showToast('Previous state restored', 'success');
    return { success: true, restoredCount };
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

    // Set the value
    textarea.value = newValue;
    
    // Trigger input event so React picks up the change
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Focus and blur to ensure the change is registered
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
}

// Make available globally
if (typeof window !== 'undefined') {
  window.FavoriteInstructionsFeature = FavoriteInstructionsFeature;
}
