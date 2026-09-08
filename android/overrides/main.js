// BetterDungeon - main.js
// The core orchestrator that manages feature lifecycle

class BetterDungeon {
  constructor() {
    this.debug = false;
    this.destroyed = false;
    this.aiDungeonService = new AIDungeonService();
    this.featureManager = new FeatureManager({
      aiDungeonService: this.aiDungeonService,
    });
    this.init();
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  init() {
    console.log('[BetterDungeon] Initializing...');
    this.injectStyles();
    this.setupMessageListener();
    this.initializeCaretScrollFix();
    this.featureManager.initialize();
  }

  initializeCaretScrollFix() {
    if (!window.BetterDungeonCaretScrollFix || !chrome.storage?.sync) return;

    chrome.storage.sync.get('betterDungeon_androidCaretScrollFix', (result) => {
      const enabled =
        (result || {}).betterDungeon_androidCaretScrollFix === true;
      window.BetterDungeonCaretScrollFix.setEnabled(enabled);
    });
  }

  // Setup listener for messages from popup
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'FEATURE_TOGGLE') {
        this.handleFeatureToggle(message.featureId, message.enabled);
      } else if (message.type === 'SET_AUTO_SEE_TRIGGER_MODE') {
        this.handleSetAutoSeeTriggerMode(message.mode);
      } else if (message.type === 'SET_AUTO_SEE_TURN_INTERVAL') {
        this.handleSetAutoSeeTurnInterval(message.interval);
      } else if (message.type === 'SET_TEXT_TO_SPEECH_SETTINGS') {
        this.handleSetTextToSpeechSettings(message.settings);
      } else if (message.type === 'SET_ANDROID_CARET_SCROLL_FIX') {
        const enabled = this.handleSetAndroidCaretScrollFix(message.enabled);
        sendResponse({ success: true, enabled });
      } else if (message.type === 'STOP_TEXT_TO_SPEECH') {
        this.handleStopTextToSpeech();
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
      } else if (message.type === 'OPEN_STORY_CARD_ANALYTICS') {
        this.handleOpenStoryCardAnalytics().then(sendResponse);
        return true;
      } else if (message.type === 'SET_ULTRASCRIPTS_DEBUG') {
        window.Ultrascripts?.core?.setDebug?.(message.enabled);
        sendResponse({ success: true, debugEnabled: !!message.enabled });
        return true;
      } else if (message.type === 'SET_ULTRASCRIPTS_MODULE_ENABLED') {
        window.Ultrascripts?.registry?.setModuleEnabled?.(message.moduleId, message.enabled);
        sendResponse({
          success: true,
          moduleId: message.moduleId,
          enabled: !!message.enabled,
          registry: window.Ultrascripts?.registry?.inspect?.() || null,
        });
        return true;
      } else if (message.type === 'GET_ULTRASCRIPTS_STATE') {
        sendResponse({
          ultrascriptsEnabled: this.featureManager.isFeatureEnabled('ultrascripts'),
          core: window.Ultrascripts?.core?.inspect?.() || null,
          registry: window.Ultrascripts?.registry?.inspect?.() || null,
          modules: window.Ultrascripts?.registry?.list?.() || [],
        });
        return true;
      } else if (message.type === 'REFRESH_CUSTOM_DYNAMIC_MODELS') {
        this.handleRefreshCustomDynamicModels(message.force !== false).then(sendResponse);
        return true;
      }
    });
  }

  async handleRefreshCustomDynamicModels(force = true) {
    try {
      let feature = this.featureManager.getFeature('customDynamic');
      if (!feature && typeof CustomDynamicFeature !== 'undefined') {
        feature = new CustomDynamicFeature();
      }
      if (!feature?.refreshVisibleVersions) {
        return { success: false, error: 'Custom Dynamic model discovery is unavailable.' };
      }

      const versions = await feature.refreshVisibleVersions({ force });
      return {
        success: true,
        versions,
        catalogSchemaVersion: CustomDynamicFeature.catalogSchemaVersion,
        refreshedAt: new Date().toISOString()
      };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  handleSetAutoSeeTriggerMode(mode) {
    const autoSeeFeature = this.featureManager.features.get('autoSee');
    if (autoSeeFeature && typeof autoSeeFeature.setTriggerMode === 'function') {
      autoSeeFeature.setTriggerMode(mode);
    }
  }

  handleSetAutoSeeTurnInterval(interval) {
    const autoSeeFeature = this.featureManager.features.get('autoSee');
    if (autoSeeFeature && typeof autoSeeFeature.setTurnInterval === 'function') {
      autoSeeFeature.setTurnInterval(interval);
    }
  }

  handleSetTextToSpeechSettings(settings) {
    const textToSpeechFeature = this.featureManager.features.get('textToSpeech');
    if (textToSpeechFeature && typeof textToSpeechFeature.setSettings === 'function') {
      textToSpeechFeature.setSettings(settings);
    }
  }

  handleStopTextToSpeech() {
    const textToSpeechFeature = this.featureManager.features.get('textToSpeech');
    if (textToSpeechFeature && typeof textToSpeechFeature.stop === 'function') {
      textToSpeechFeature.stop();
    }
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
        console.error('[BetterDungeon] Error in saveCurrentAsPreset:', error);
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
        console.error('[BetterDungeon] Error in restorePreviousState:', error);
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

  async handleOpenStoryCardAnalytics() {
    const analyticsFeature = this.featureManager.features.get('storyCardAnalytics');
    if (analyticsFeature && typeof analyticsFeature.openDashboard === 'function') {
      await analyticsFeature.openDashboard();
      return { success: true };
    }
    return { success: false, error: 'Story Card Analytics feature not available' };
  }

  async handleFeatureToggle(featureId, enabled) {
    await this.featureManager.toggleFeature(featureId, enabled);
  }
  injectStyles() {
    DOMUtils.injectStyles(chrome.runtime.getURL('styles.css'), 'better-dungeon-styles');
  }

  destroy() {
    this.destroyed = true;
    this.featureManager.destroy();
  }

  handleSetAndroidCaretScrollFix(enabled) {
    const nextEnabled = enabled === true;
    window.BetterDungeonCaretScrollFix?.setEnabled(nextEnabled);

    try {
      window.BetterDungeonBridge?.setCaretScrollFixEnabled(nextEnabled);
    } catch (error) {
      console.warn('[BetterDungeon] Native caret fix toggle unavailable:', error);
    }

    return nextEnabled;
  }
}

// Initialize when DOM is ready
function initBetterDungeon() {
  const existing = window.betterDungeonInstance;
  if (existing && existing.destroyed !== true) {
    console.log('[BetterDungeon] Existing instance detected; skipping duplicate initialization');
    return existing;
  }

  const instance = new BetterDungeon();
  window.betterDungeonInstance = instance;
  return instance;
}

if (document.readyState === 'loading') {
  if (!window.__betterDungeonInitListenerRegistered) {
    window.__betterDungeonInitListenerRegistered = true;
    document.addEventListener('DOMContentLoaded', () => {
      window.__betterDungeonInitListenerRegistered = false;
      initBetterDungeon();
    }, { once: true });
  }
} else {
  initBetterDungeon();
}
