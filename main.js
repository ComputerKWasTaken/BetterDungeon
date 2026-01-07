// BetterDungeon - main.js
// The core orchestrator that manages feature lifecycle

class BetterDungeon {
  constructor() {
    this.featureManager = new FeatureManager();
    this.aiDungeonService = new AIDungeonService();
    this.init();
  }

  init() {
    console.log('BetterDungeon: Initializing...');
    this.injectStyles();
    this.setupMessageListener();
    this.featureManager.initialize();
  }

  // Setup listener for messages from popup
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'FEATURE_TOGGLE') {
        this.handleFeatureToggle(message.featureId, message.enabled);
      } else if (message.type === 'APPLY_INSTRUCTIONS') {
        this.handleApplyInstructions().then(sendResponse);
        return true;
      }
    });
  }

  async handleFeatureToggle(featureId, enabled) {
    await this.featureManager.toggleFeature(featureId, enabled);
  }


  async handleApplyInstructions() {
    try {
      const instructionsResult = await this.aiDungeonService.fetchInstructionsFile();
      if (!instructionsResult.success) {
        return { success: false, error: instructionsResult.error };
      }

      return await this.aiDungeonService.applyInstructionsToTextareas(instructionsResult.data);
    } catch (error) {
      console.error('BetterDungeon: Error applying instructions:', error);
      return { success: false, error: error.message };
    }
  }


  injectStyles() {
    DOMUtils.injectStyles(chrome.runtime.getURL('styles.css'), 'better-dungeon-styles');
  }

  destroy() {
    this.featureManager.destroy();
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
