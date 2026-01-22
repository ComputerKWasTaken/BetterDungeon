// BetterDungeon - Auto See Feature
// Automatically sends a "See" action after AI outputs
// Detects submitted actions and Continue actions, then triggers See and reverts to original input mode

class AutoSeeFeature {
  static id = 'autoSee';

  constructor() {
    // DOM observation state
    this.observer = null;
    this.debounceTimer = null;
    
    // Track story content to detect AI response completion
    this.lastStoryContent = '';
    this.lastStoryLength = 0;
    this.isProcessing = false;
    this.isWaitingForAIResponse = false;
    
    // Track user's original input mode for restoration
    this.userOriginalMode = 'do'; // Default to 'do' mode
    
    // Settings
    this.enabled = true;
    this.delay = 500; // Fixed 0.5s delay before triggering See action
    this.triggerMode = 'everyTurn'; // 'everyTurn' or 'afterNTurns'
    this.turnInterval = 2; // If triggerMode is 'afterNTurns', trigger every N turns
    this.turnCounter = 0;
    
    // Selectors
    this.storyOutputSelector = '#gameplay-output';
    this.inputAreaSelector = '[aria-label="Change input mode"]';
    this.submitButtonSelector = '[aria-label="Submit action"]';
    this.continueButtonSelector = '[aria-label="Command: continue"]';
    this.inputModeMenuSelector = '[aria-label="Change input mode"]';
    this.closeInputModeMenuSelector = '[aria-label="Close \'Input Mode\' menu"]';
    this.takeATurnSelector = '[aria-label="Command: take a turn"]';
    this.closeInputSelector = '[aria-label="Close text input"]';
    this.textInputSelector = '#game-text-input';
    
    // Mode selectors for switching
    this.modeSelectors = {
      'do': '[aria-label="Set to \'Do\' mode"]',
      'attempt': '[aria-label="Set to \'Attempt\' mode"]',
      'say': '[aria-label="Set to \'Say\' mode"]',
      'story': '[aria-label="Set to \'Story\' mode"]',
      'see': '[aria-label="Set to \'See\' mode"]',
      'command': '[aria-label="Set to \'Command\' mode"]'
    };
    
    // Bound event listeners for cleanup
    this.boundSubmitClickHandler = null;
    this.boundContinueClickHandler = null;
    this.boundEnterKeyHandler = null;
  }

  // ==================== LIFECYCLE ====================

  async init() {
    console.log('AutoSeeFeature: Initializing...');
    await this.loadSettings();
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
    this.setupActionDetection();
    this.startObserving();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    this.cleanupActionDetection();
    
    this.isProcessing = false;
    this.isWaitingForAIResponse = false;
  }

  // ==================== SETTINGS ====================

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'betterDungeon_autoSeeEnabled',
        'betterDungeon_autoSeeTriggerMode',
        'betterDungeon_autoSeeTurnInterval'
      ]);
      this.enabled = result.betterDungeon_autoSeeEnabled ?? true;
      this.triggerMode = result.betterDungeon_autoSeeTriggerMode ?? 'everyTurn';
      this.turnInterval = result.betterDungeon_autoSeeTurnInterval ?? 2;
    } catch (e) {
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    chrome.storage.sync.set({ betterDungeon_autoSeeEnabled: enabled });
  }

  setTriggerMode(mode) {
    this.triggerMode = mode;
    chrome.storage.sync.set({ betterDungeon_autoSeeTriggerMode: mode });
  }

  setTurnInterval(interval) {
    this.turnInterval = Math.max(2, Math.min(10, interval));
    chrome.storage.sync.set({ betterDungeon_autoSeeTurnInterval: this.turnInterval });
  }

  // ==================== ADVENTURE DETECTION ====================

  detectCurrentAdventure() {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    const newAdventureId = match ? match[1] : null;
    
    if (newAdventureId !== this.currentAdventureId) {
      this.lastStoryContent = '';
      this.lastStoryLength = 0;
      this.turnCounter = 0;
      this.isProcessing = false;
      this.isWaitingForAIResponse = false;
      this.userOriginalMode = 'do';
    }
    
    this.currentAdventureId = newAdventureId;
  }

  startAdventureChangeDetection() {
    window.addEventListener('popstate', () => this.detectCurrentAdventure());
    
    // Watch for URL changes via history API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.detectCurrentAdventure();
    };
    
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.detectCurrentAdventure();
    };
  }

  // ==================== ACTION DETECTION ====================
  // Detects when user submits an action or clicks Continue to trigger Auto See

  setupActionDetection() {
    this.boundSubmitClickHandler = (e) => this.handleActionClick(e, 'submit');
    this.boundContinueClickHandler = (e) => this.handleActionClick(e, 'continue');
    this.boundEnterKeyHandler = (e) => this.handleEnterKeySubmit(e);
    
    document.addEventListener('click', this.boundSubmitClickHandler, true);
    document.addEventListener('keydown', this.boundEnterKeyHandler, true);
  }

  cleanupActionDetection() {
    if (this.boundSubmitClickHandler) {
      document.removeEventListener('click', this.boundSubmitClickHandler, true);
      this.boundSubmitClickHandler = null;
    }
    if (this.boundEnterKeyHandler) {
      document.removeEventListener('keydown', this.boundEnterKeyHandler, true);
      this.boundEnterKeyHandler = null;
    }
  }

  /**
   * Handles Enter key press to detect submit action when user presses Enter in the text input
   */
  handleEnterKeySubmit(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (!this.enabled || !this.currentAdventureId) return;
    if (this.isProcessing) return;
    
    const activeElement = document.activeElement;
    if (!activeElement || activeElement.id !== 'game-text-input') return;
    if (!this.isInputAreaOpen()) return;
    
    const currentMode = this.detectCurrentInputMode();
    if (currentMode && currentMode !== 'see') {
      this.userOriginalMode = currentMode;
    }
    
    this.captureCurrentStoryContent();
    this.isWaitingForAIResponse = true;
    this.turnCounter++;
  }

  handleActionClick(e, type) {
    if (!this.enabled || !this.currentAdventureId) return;
    if (this.isProcessing) return;
    
    const target = e.target.closest('[aria-label]');
    if (!target) return;
    
    const ariaLabel = target.getAttribute('aria-label');
    
    if (ariaLabel === 'Submit action') {
      const currentMode = this.detectCurrentInputMode();
      if (currentMode && currentMode !== 'see') {
        this.userOriginalMode = currentMode;
      }
      
      this.captureCurrentStoryContent();
      this.isWaitingForAIResponse = true;
      this.turnCounter++;
      return;
    }
    
    if (ariaLabel === 'Command: continue') {
      this.captureCurrentStoryContent();
      this.isWaitingForAIResponse = true;
      this.turnCounter++;
      return;
    }
  }

  // ==================== OUTPUT OBSERVATION ====================
  // Watches for AI response completion to trigger the See action

  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.currentAdventureId || !this.enabled) return;
      if (!this.isWaitingForAIResponse) return;
      
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      this.debounceTimer = setTimeout(() => {
        this.checkForAIResponseComplete();
      }, this.delay);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  captureCurrentStoryContent() {
    const storyOutput = document.querySelector(this.storyOutputSelector);
    if (storyOutput) {
      this.lastStoryContent = storyOutput.textContent?.trim() || '';
      this.lastStoryLength = this.lastStoryContent.length;
    }
  }

  checkForAIResponseComplete() {
    if (this.isProcessing) return;
    if (this.isInputAreaOpen()) return;

    const storyOutput = document.querySelector(this.storyOutputSelector);
    if (!storyOutput) return;

    const currentContent = storyOutput.textContent?.trim() || '';
    const currentLength = currentContent.length;
    
    if (this.lastStoryLength === 0) return;
    
    if (currentLength > this.lastStoryLength) {
      this.lastStoryContent = currentContent;
      this.lastStoryLength = currentLength;
      this.isWaitingForAIResponse = false;
      
      if (this.shouldTriggerSee()) {
        setTimeout(() => {
          this.triggerSeeAction();
        }, 300);
      }
    }
  }

  shouldTriggerSee() {
    if (this.triggerMode === 'everyTurn') {
      return true;
    } else if (this.triggerMode === 'afterNTurns') {
      return this.turnCounter % this.turnInterval === 0;
    }
    return false;
  }

  // ==================== SEE ACTION TRIGGERING ====================

  isInputAreaOpen() {
    return !!document.querySelector(this.inputAreaSelector);
  }

  /**
   * Detects the current input mode from the mode button text
   * @returns {string|null} The current mode name (lowercase) or null if not found
   */
  detectCurrentInputMode() {
    const modeButton = document.querySelector(this.inputModeMenuSelector);
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText) {
        return modeText.textContent.toLowerCase().trim();
      }
    }
    return null;
  }

  async triggerSeeAction() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;

    try {
      const takeATurnBtn = document.querySelector(this.takeATurnSelector);
      if (!takeATurnBtn) {
        this.isProcessing = false;
        return;
      }

      takeATurnBtn.click();
      await this.wait(300);

      const menuOpened = await this.openInputModeMenu();
      if (!menuOpened) {
        this.closeInputArea();
        this.isProcessing = false;
        return;
      }

      await this.wait(150);
      const seeModeSelector = this.modeSelectors['see'];
      const seeModeBtn = document.querySelector(seeModeSelector);
      if (!seeModeBtn) {
        this.closeInputModeMenu();
        this.closeInputArea();
        this.isProcessing = false;
        return;
      }

      seeModeBtn.click();
      await this.wait(200);

      const textInput = document.querySelector(this.textInputSelector);
      if (textInput) {
        textInput.value = '';
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await this.wait(100);
      const submitBtn = document.querySelector(this.submitButtonSelector);
      if (!submitBtn) {
        this.closeInputArea();
        this.isProcessing = false;
        return;
      }

      submitBtn.click();

      await this.waitForImageGenerationComplete();
      this.captureCurrentStoryContent();

      await this.restoreOriginalInputMode();

    } catch (error) {
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Waits for the image generation to complete by monitoring for the input area to close
   * and then waiting for any loading indicators to disappear
   */
  async waitForImageGenerationComplete() {
    let attempts = 0;
    while (this.isInputAreaOpen() && attempts < 60) {
      await this.wait(100);
      attempts++;
    }
    
    await this.wait(3000);
  }

  /**
   * Restores the user's original input mode by opening the input area,
   * switching to the original mode, then closing the input area
   */
  async restoreOriginalInputMode() {
    if (this.userOriginalMode === 'see') return;
    
    const modeSelector = this.modeSelectors[this.userOriginalMode];
    if (!modeSelector) return;
    
    try {
      const takeATurnBtn = document.querySelector(this.takeATurnSelector);
      if (!takeATurnBtn) return;
      
      takeATurnBtn.click();
      await this.wait(300);
      
      const menuOpened = await this.openInputModeMenu();
      if (!menuOpened) {
        this.closeInputArea();
        return;
      }
      
      await this.wait(150);
      const modeBtn = document.querySelector(modeSelector);
      if (!modeBtn) {
        this.closeInputModeMenu();
        this.closeInputArea();
        return;
      }
      
      modeBtn.click();
      await this.wait(200);
      
      this.closeInputArea();
      await this.wait(100);
      
    } catch (error) {
    }
  }

  async openInputModeMenu() {
    const menuButton = document.querySelector(this.inputModeMenuSelector);
    if (!menuButton) return false;
    
    const existingMenu = document.querySelector(this.modeSelectors['do']);
    if (existingMenu) return true;
    
    menuButton.click();
    
    for (let i = 0; i < 20; i++) {
      await this.wait(50);
      const menu = document.querySelector(this.modeSelectors['do']);
      if (menu) return true;
    }
    
    return false;
  }

  closeInputModeMenu() {
    const closeButton = document.querySelector(this.closeInputModeMenuSelector);
    if (closeButton) closeButton.click();
  }

  closeInputArea() {
    const closeButton = document.querySelector(this.closeInputSelector);
    if (closeButton) closeButton.click();
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.AutoSeeFeature = AutoSeeFeature;
}
