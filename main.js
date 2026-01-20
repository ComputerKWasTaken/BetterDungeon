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
      } else if (message.type === 'GET_PRESETS') {
        this.handleGetPresets().then(sendResponse);
        return true;
      } else if (message.type === 'SAVE_PRESET') {
        this.handleSavePreset(message.name, message.components).then(sendResponse);
        return true;
      } else if (message.type === 'APPLY_PRESET') {
        this.handleApplyPreset(message.presetId, message.mode).then(sendResponse);
        return true;
      } else if (message.type === 'DELETE_PRESET') {
        this.handleDeletePreset(message.presetId).then(sendResponse);
        return true;
      } else if (message.type === 'UPDATE_PRESET') {
        this.handleUpdatePreset(message.presetId, message.updates).then(sendResponse);
        return true;
      } else if (message.type === 'SAVE_CURRENT_AS_PRESET') {
        this.handleSaveCurrentAsPreset(message.name, message.includeComponents).then(sendResponse);
        return true;
      } else if (message.type === 'UNDO_PRESET_APPLY') {
        this.handleUndoPresetApply(message.previousState).then(sendResponse);
        return true;
      } else if (message.type === 'GET_CHARACTER_PRESETS') {
        this.handleGetCharacterPresets().then(sendResponse);
        return true;
      } else if (message.type === 'CREATE_CHARACTER_PRESET') {
        this.handleCreateCharacterPreset(message.name).then(sendResponse);
        return true;
      } else if (message.type === 'UPDATE_CHARACTER_PRESET') {
        this.handleUpdateCharacterPreset(message.presetId, message.updates).then(sendResponse);
        return true;
      } else if (message.type === 'DELETE_CHARACTER_PRESET') {
        this.handleDeleteCharacterPreset(message.presetId).then(sendResponse);
        return true;
      } else if (message.type === 'SET_ACTIVE_CHARACTER_PRESET') {
        this.handleSetActiveCharacterPreset(message.presetId).then(sendResponse);
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

  async handleGetPresets() {
    const feature = this.featureManager.features.get('favoriteInstructions');
    if (feature) {
      const presets = await feature.getAllPresets();
      return { success: true, presets };
    }
    return { success: false, error: 'Feature not available' };
  }

  async handleSavePreset(name, components) {
    const feature = this.featureManager.features.get('favoriteInstructions');
    if (feature) {
      const preset = await feature.createPreset(name, components);
      return { success: true, preset };
    }
    return { success: false, error: 'Feature not available' };
  }

  async handleApplyPreset(presetId, mode) {
    const feature = this.featureManager.features.get('favoriteInstructions');
    if (feature) {
      return await feature.applyPreset(presetId, mode);
    }
    return { success: false, error: 'Feature not available' };
  }

  async handleDeletePreset(presetId) {
    const feature = this.featureManager.features.get('favoriteInstructions');
    if (feature) {
      const deleted = await feature.deletePreset(presetId);
      return { success: deleted };
    }
    return { success: false, error: 'Feature not available' };
  }

  async handleUpdatePreset(presetId, updates) {
    const feature = this.featureManager.features.get('favoriteInstructions');
    if (feature) {
      const preset = await feature.updatePreset(presetId, updates);
      return { success: !!preset, preset };
    }
    return { success: false, error: 'Feature not available' };
  }

  async handleSaveCurrentAsPreset(name, includeComponents = null) {
    const feature = this.featureManager.features.get('favoriteInstructions');
    if (feature) {
      try {
        return await feature.saveCurrentAsPreset(name, includeComponents);
      } catch (error) {
        console.error('BetterDungeon: Error in saveCurrentAsPreset:', error);
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Favorite Instructions feature not enabled. Enable it in the Presets tab.' };
  }

  async handleUndoPresetApply(previousState) {
    const feature = this.featureManager.features.get('favoriteInstructions');
    if (feature) {
      try {
        return await feature.restorePreviousState(previousState);
      } catch (error) {
        console.error('BetterDungeon: Error in restorePreviousState:', error);
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Feature not available' };
  }

  async handleGetCharacterPresets() {
    const feature = this.featureManager.features.get('characterPreset');
    if (feature) {
      const presets = await feature.getAllPresets();
      const activeId = feature.activePresetId;
      return { success: true, presets, activePresetId: activeId };
    }
    return { success: false, error: 'Character Preset feature not available' };
  }

  async handleCreateCharacterPreset(name) {
    const feature = this.featureManager.features.get('characterPreset');
    if (feature) {
      const preset = await feature.createPreset(name);
      return { success: true, preset };
    }
    return { success: false, error: 'Character Preset feature not available' };
  }

  async handleUpdateCharacterPreset(presetId, updates) {
    const feature = this.featureManager.features.get('characterPreset');
    if (feature) {
      const preset = await feature.updatePreset(presetId, updates);
      return { success: !!preset, preset };
    }
    return { success: false, error: 'Character Preset feature not available' };
  }

  async handleDeleteCharacterPreset(presetId) {
    const feature = this.featureManager.features.get('characterPreset');
    if (feature) {
      const deleted = await feature.deletePreset(presetId);
      return { success: deleted };
    }
    return { success: false, error: 'Character Preset feature not available' };
  }

  async handleSetActiveCharacterPreset(presetId) {
    const feature = this.featureManager.features.get('characterPreset');
    if (feature) {
      await feature.setActivePreset(presetId);
      return { success: true };
    }
    return { success: false, error: 'Character Preset feature not available' };
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
