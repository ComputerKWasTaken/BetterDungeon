// BetterDungeon - Storage Utilities
// Centralized storage management for features and settings

class StorageManager {
  static STORAGE_KEY = 'betterDungeonFeatures';
  static DEFAULT_FEATURES = {
    markdown: true,
    command: true
  };

  static async getFeatures() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(this.STORAGE_KEY, (result) => {
        const features = result[this.STORAGE_KEY] || this.DEFAULT_FEATURES;
        resolve(features);
      });
    });
  }

  static async saveFeatures(features) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [this.STORAGE_KEY]: features }, () => {
        console.log('StorageManager: Features saved', features);
        resolve();
      });
    });
  }

  static async getFeatureState(featureId) {
    const features = await this.getFeatures();
    return features[featureId] !== false; // Default to true
  }

  static async setFeatureState(featureId, enabled) {
    const features = await this.getFeatures();
    features[featureId] = enabled;
    await this.saveFeatures(features);
    console.log(`StorageManager: Feature "${featureId}" ${enabled ? 'enabled' : 'disabled'}`);
  }

  static async resetToDefaults() {
    await this.saveFeatures(this.DEFAULT_FEATURES);
    console.log('StorageManager: Reset to default feature states');
  }
}

if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
