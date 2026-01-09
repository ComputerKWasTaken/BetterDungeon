// BetterDungeon - Feature Manager
// Centralized feature lifecycle management

class FeatureManager {
  constructor() {
    this.features = new Map();
    this.featureClasses = new Map();
    this.storageManager = window.StorageManager;
  }

  async initialize() {
    console.log('FeatureManager: Initializing...');
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

    console.log('FeatureManager: Registered feature classes:', Array.from(this.featureClasses.keys()));
  }

  async loadFeaturesFromStorage() {
    const savedStates = await this.storageManager.getFeatures();

    this.featureClasses.forEach((FeatureClass, id) => {
      const enabled = savedStates[id] !== false;
      if (enabled) {
        this.enableFeature(id);
      }
    });
  }

  enableFeature(id) {
    if (this.features.has(id)) {
      console.log(`FeatureManager: Feature "${id}" already enabled`);
      return;
    }

    const FeatureClass = this.featureClasses.get(id);
    if (!FeatureClass) {
      console.warn(`FeatureManager: Unknown feature "${id}"`);
      return;
    }

    try {
      const feature = new FeatureClass();
      this.features.set(id, feature);

      if (typeof feature.init === 'function') {
        feature.init();
      }

      console.log(`FeatureManager: Enabled feature "${id}"`);
    } catch (error) {
      console.error(`FeatureManager: Failed to enable feature "${id}":`, error);
    }
  }

  disableFeature(id) {
    const feature = this.features.get(id);
    if (!feature) {
      console.log(`FeatureManager: Feature "${id}" not enabled`);
      return;
    }

    try {
      if (typeof feature.destroy === 'function') {
        feature.destroy();
      }

      this.features.delete(id);
      console.log(`FeatureManager: Disabled feature "${id}"`);
    } catch (error) {
      console.error(`FeatureManager: Failed to disable feature "${id}":`, error);
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
    console.log('FeatureManager: Destroying all features...');
    this.features.forEach((feature, id) => {
      if (typeof feature.destroy === 'function') {
        try {
          feature.destroy();
        } catch (error) {
          console.error(`FeatureManager: Error destroying feature "${id}":`, error);
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
