// BetterDungeon - Storage Utilities
// Centralized storage management for features and settings

class StorageManager {
  static debug = false;

  static log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  static STORAGE_KEY = 'betterDungeonFeatures';
  static DEFAULT_FEATURES = {
    markdown: true,
    command: true
  };

  static async getFeatures() {
    const result = await browser.storage.sync.get(this.STORAGE_KEY);
    const features = result[this.STORAGE_KEY] || this.DEFAULT_FEATURES;
    this.log('[StorageManager] Retrieved features:', features);
    return features;
  }

  static async saveFeatures(features) {
    await browser.storage.sync.set({ [this.STORAGE_KEY]: features });
    this.log('[StorageManager] Saved features:', features);
  }

  static async getFeatureState(featureId) {
    const features = await this.getFeatures();
    return features[featureId] !== false; // Default to true
  }

  static async setFeatureState(featureId, enabled) {
    const features = await this.getFeatures();
    features[featureId] = enabled;
    await this.saveFeatures(features);
  }

  static async resetToDefaults() {
    await this.saveFeatures(this.DEFAULT_FEATURES);
  }
}

if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
