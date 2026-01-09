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
      } else if (message.type === 'SCAN_STORY_CARDS') {
        this.handleScanStoryCards().then(sendResponse);
        return true;
      } else if (message.type === 'SET_AUTO_SCAN') {
        this.handleSetAutoScan(message.enabled);
      } else if (message.type === 'SET_AUTO_APPLY') {
        this.handleSetAutoApply(message.enabled);
      } else if (message.type === 'APPLY_INSTRUCTIONS_WITH_LOADING') {
        this.handleApplyInstructionsWithLoading().then(sendResponse);
        return true;
      }
    });
  }

  handleSetAutoScan(enabled) {
    const triggerFeature = this.featureManager.features.get('triggerHighlight');
    if (triggerFeature && typeof triggerFeature.setAutoScan === 'function') {
      triggerFeature.setAutoScan(enabled);
    }
  }

  handleSetAutoApply(enabled) {
    const markdownFeature = this.featureManager.features.get('markdown');
    if (markdownFeature && typeof markdownFeature.setAutoApply === 'function') {
      markdownFeature.setAutoApply(enabled);
    }
  }

  async handleApplyInstructionsWithLoading() {
    const markdownFeature = this.featureManager.features.get('markdown');
    if (markdownFeature && typeof markdownFeature.applyInstructionsWithLoadingScreen === 'function') {
      return await markdownFeature.applyInstructionsWithLoadingScreen();
    }
    return { success: false, error: 'Markdown feature not available' };
  }

  async handleScanStoryCards() {
    // Get the trigger highlight feature instance
    const triggerFeature = this.featureManager.features.get('triggerHighlight');
    
    if (!triggerFeature) {
      return { success: false, error: 'Trigger Highlight feature not enabled' };
    }

    if (typeof triggerFeature.scanAllStoryCards !== 'function') {
      return { success: false, error: 'Scan function not available' };
    }

    try {
      const result = await triggerFeature.scanAllStoryCards();
      return result;
    } catch (error) {
      console.error('BetterDungeon: Scan error:', error);
      return { success: false, error: error.message };
    }
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
