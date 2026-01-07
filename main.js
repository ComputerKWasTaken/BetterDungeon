// BetterDungeon - main.js
// The core orchestrator that manages feature lifecycle

const STORAGE_KEY = 'betterDungeonFeatures';

class BetterDungeon {
  constructor() {
    this.features = new Map();
    this.featureClasses = new Map();
    this.init();
  }

  init() {
    console.log('BetterDungeon: Initializing...');
    this.injectStyles();
    this.setupMessageListener();
    this.loadFeaturesFromStorage();
  }

  // Setup listener for messages from popup
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'FEATURE_TOGGLE') {
        this.handleFeatureToggle(message.featureId, message.enabled);
      }
    });
  }

  // Handle feature toggle from popup
  handleFeatureToggle(featureId, enabled) {
    if (enabled) {
      this.enableFeature(featureId);
    } else {
      this.disableFeature(featureId);
    }
  }

  // Load feature states from storage and register accordingly
  loadFeaturesFromStorage() {
    // Register available feature classes
    if (typeof MarkdownFeature !== 'undefined') {
      this.featureClasses.set('markdown', MarkdownFeature);
    }

    if (typeof CommandFeature !== 'undefined') {
      this.featureClasses.set('command', CommandFeature);
    }

    // Future features will be registered here
    // if (typeof FavoritesFeature !== 'undefined') {
    //   this.featureClasses.set('favorites', FavoritesFeature);
    // }

    // Load saved states
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      const savedStates = result[STORAGE_KEY] || {};

      // Enable features based on saved state (default to true if not set)
      this.featureClasses.forEach((FeatureClass, id) => {
        const enabled = savedStates[id] !== false; // Default true
        if (enabled) {
          this.enableFeature(id);
        }
      });
    });
  }

  // Enable a feature by id
  enableFeature(id) {
    if (this.features.has(id)) return; // Already enabled

    const FeatureClass = this.featureClasses.get(id);
    if (!FeatureClass) {
      console.warn(`BetterDungeon: Unknown feature "${id}"`);
      return;
    }

    const feature = new FeatureClass();
    this.features.set(id, feature);

    if (typeof feature.init === 'function') {
      feature.init();
    }

    console.log(`BetterDungeon: Enabled feature "${id}"`);
  }

  // Disable a feature by id
  disableFeature(id) {
    const feature = this.features.get(id);
    if (!feature) return; // Not enabled

    if (typeof feature.destroy === 'function') {
      feature.destroy();
    }

    this.features.delete(id);
    console.log(`BetterDungeon: Disabled feature "${id}"`);
  }

  // Get a feature by id
  getFeature(id) {
    return this.features.get(id);
  }

  // Check if a feature is enabled
  isFeatureEnabled(id) {
    return this.features.has(id);
  }

  // Inject CSS styles
  injectStyles() {
    if (document.getElementById('better-dungeon-styles')) return;

    const link = document.createElement('link');
    link.id = 'better-dungeon-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
    console.log('BetterDungeon: Styles injected');
  }

  // Cleanup
  destroy() {
    this.features.forEach((feature, id) => {
      if (typeof feature.destroy === 'function') {
        feature.destroy();
      }
    });
    this.features.clear();
    this.featureClasses.clear();
    console.log('BetterDungeon: Destroyed');
  }
}

// Global instance
let betterDungeonInstance = null;

// Initialize when DOM is ready
function initBetterDungeon() {
  if (betterDungeonInstance) {
    betterDungeonInstance.destroy();
  }
  betterDungeonInstance = new BetterDungeon();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBetterDungeon);
} else {
  initBetterDungeon();
}
