// BetterDungeon - Feature Manager
// Centralized feature lifecycle management

class FeatureManager {
  constructor() {
    this.debug = false;
    this.features = new Map();
    this.featureClasses = new Map();
    this.storageManager = window.StorageManager;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async initialize() {
    console.log('[FeatureManager] Initializing...');
    this.registerAvailableFeatures();
    await this.loadFeaturesFromStorage();
  }

  registerAvailableFeatures() {
    if (typeof MarkdownFeature !== 'undefined') {
      this.featureClasses.set('markdown', MarkdownFeature);
    }

    if (typeof CommandFeature !== 'undefined') {
      this.featureClasses.set('command', CommandFeature);
    }

    if (typeof AttemptFeature !== 'undefined') {
      this.featureClasses.set('attempt', AttemptFeature);
    }

    if (typeof ReadablePositionFeature !== 'undefined') {
      this.featureClasses.set('readablePosition', ReadablePositionFeature);
    }

    if (typeof TriggerHighlightFeature !== 'undefined') {
      this.featureClasses.set('triggerHighlight', TriggerHighlightFeature);
    }

    if (typeof HotkeyFeature !== 'undefined') {
      this.featureClasses.set('hotkey', HotkeyFeature);
    }

    if (typeof FavoriteInstructionsFeature !== 'undefined') {
      this.featureClasses.set('favoriteInstructions', FavoriteInstructionsFeature);
    }

    if (typeof InputModeColorFeature !== 'undefined') {
      this.featureClasses.set('inputModeColor', InputModeColorFeature);
    }

    if (typeof CharacterPresetFeature !== 'undefined') {
      this.featureClasses.set('characterPreset', CharacterPresetFeature);
    }

    if (typeof AutoSeeFeature !== 'undefined') {
      this.featureClasses.set('autoSee', AutoSeeFeature);
    }

    if (typeof StoryCardAnalyticsFeature !== 'undefined') {
      this.featureClasses.set('storyCardAnalytics', StoryCardAnalyticsFeature);
    }

    if (typeof NotesFeature !== 'undefined') {
      this.featureClasses.set('notes', NotesFeature);
    }

    if (typeof AutoEnableScriptsFeature !== 'undefined') {
      this.featureClasses.set('autoEnableScripts', AutoEnableScriptsFeature);
    }
  }

  async loadFeaturesFromStorage() {
    const savedStates = await this.storageManager.getFeatures();

    this.featureClasses.forEach((FeatureClass, id) => {
      // Always-on QOL features that don't need user toggling
      const alwaysEnabled = ['storyCardAnalytics', 'autoEnableScripts'];
      // Features that are disabled by default
      const defaultOff = ['autoSee'];
      
      const enabled = alwaysEnabled.includes(id) || 
                      savedStates[id] === true || 
                      (savedStates[id] === undefined && !defaultOff.includes(id));
      if (enabled) {
        this.enableFeature(id);
      }
    });
  }

  enableFeature(id) {
    if (this.features.has(id)) {
      return;
    }

    const FeatureClass = this.featureClasses.get(id);
    if (!FeatureClass) {
      console.warn(`[FeatureManager] Unknown feature "${id}"`);
      return;
    }

    try {
      const feature = new FeatureClass();
      this.features.set(id, feature);

      if (typeof feature.init === 'function') {
        feature.init();
      }
    } catch (error) {
      console.error(`[FeatureManager] Failed to enable feature "${id}":`, error);
    }
  }

  disableFeature(id) {
    const feature = this.features.get(id);
    if (!feature) {
      return;
    }

    try {
      if (typeof feature.destroy === 'function') {
        feature.destroy();
      }

      this.features.delete(id);
    } catch (error) {
      console.error(`[FeatureManager] Failed to disable feature "${id}":`, error);
    }
  }

  async toggleFeature(id, enabled) {
    if (enabled) {
      this.enableFeature(id);
    } else {
      this.disableFeature(id);
    }

    await this.storageManager.setFeatureState(id, enabled);
  }

  getFeature(id) {
    return this.features.get(id);
  }

  isFeatureEnabled(id) {
    return this.features.has(id);
  }

  getEnabledFeatures() {
    return Array.from(this.features.keys());
  }

  getAvailableFeatures() {
    return Array.from(this.featureClasses.keys());
  }

  destroy() {
    this.features.forEach((feature, id) => {
      if (typeof feature.destroy === 'function') {
        try {
          feature.destroy();
        } catch (error) {
          console.error(`[FeatureManager] Error destroying feature "${id}":`, error);
        }
      }
    });
    this.features.clear();
    this.featureClasses.clear();
  }
}

if (typeof window !== 'undefined') {
  window.FeatureManager = FeatureManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeatureManager;
}
