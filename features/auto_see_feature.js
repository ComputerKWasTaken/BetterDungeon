// BetterDungeon - Auto See Feature
// Automatically sends a "See" action after AI outputs

class AutoSeeFeature {
  static id = 'autoSee';

  constructor() {
    // DOM observation state
    this.observer = null;
    this.debounceTimer = null;
    
    // Track story content to detect changes
    this.lastStoryContent = '';
    this.lastStoryLength = 0;
    this.isProcessing = false;
    
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
    this.inputModeMenuSelector = '[aria-label="Change input mode"]';
    this.seeModeSelectorInMenu = '[aria-label="Set to \'See\' mode"]';
    this.takeATurnSelector = '[aria-label="Command: take a turn"]';
    this.closeInputSelector = '[aria-label="Close text input"]';
    this.textInputSelector = '#game-text-input';
  }

  // ==================== LIFECYCLE ====================

  async init() {
    await this.loadSettings();
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
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
    this.isProcessing = false;
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
      // Reset state on adventure change
      this.lastStoryContent = '';
      this.lastStoryLength = 0;
      this.turnCounter = 0;
      this.isProcessing = false;
    }
    
    this.currentAdventureId = newAdventureId;
  }

  startAdventureChangeDetection() {
    // Listen for popstate (back/forward navigation)
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

  // ==================== OUTPUT OBSERVATION ====================

  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      // Only process if we're on an adventure page and feature is enabled
      if (!this.currentAdventureId || !this.enabled) return;
      
      // Debounce to avoid triggering on partial updates
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      this.debounceTimer = setTimeout(() => {
        this.checkForNewOutput();
      }, this.delay);
    });

    // Observe the entire document for story output changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    // Capture initial story content
    this.captureCurrentStoryContent();
  }

  captureCurrentStoryContent() {
    const storyOutput = document.querySelector(this.storyOutputSelector);
    if (storyOutput) {
      this.lastStoryContent = storyOutput.textContent?.trim() || '';
      this.lastStoryLength = this.lastStoryContent.length;
    }
  }

  checkForNewOutput() {
    // Don't trigger if already processing or if input area is open (user is typing)
    if (this.isProcessing || this.isInputAreaOpen()) {
      return;
    }

    const storyOutput = document.querySelector(this.storyOutputSelector);
    if (!storyOutput) return;

    const currentContent = storyOutput.textContent?.trim() || '';
    const currentLength = currentContent.length;
    
    // Check if content has changed (new AI output)
    if (currentContent !== this.lastStoryContent && currentLength > this.lastStoryLength) {
      // Content has grown, likely a new output
      this.lastStoryContent = currentContent;
      this.lastStoryLength = currentLength;
      
      // Increment turn counter
      this.turnCounter++;
      
      // Check if we should trigger based on mode
      if (this.shouldTriggerSee()) {
        this.triggerSeeAction();
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

  async triggerSeeAction() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;

    try {
      // Step 1: Open the input area by clicking "Take a Turn"
      const takeATurnBtn = document.querySelector(this.takeATurnSelector);
      if (!takeATurnBtn) {
        this.isProcessing = false;
        return;
      }

      takeATurnBtn.click();
      await this.wait(300);

      // Step 2: Open the input mode menu
      const menuOpened = await this.openInputModeMenu();
      if (!menuOpened) {
        this.closeInputArea();
        this.isProcessing = false;
        return;
      }

      // Step 3: Select "See" mode
      await this.wait(150);
      const seeModeBtn = document.querySelector(this.seeModeSelectorInMenu);
      if (!seeModeBtn) {
        this.closeInputArea();
        this.isProcessing = false;
        return;
      }

      seeModeBtn.click();
      await this.wait(200);

      // Step 4: Clear the input field (See with empty input generates current scene)
      const textInput = document.querySelector(this.textInputSelector);
      if (textInput) {
        textInput.value = '';
        // Trigger React's onChange
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Step 5: Submit the See action
      await this.wait(100);
      const submitBtn = document.querySelector(this.submitButtonSelector);
      if (!submitBtn) {
        this.closeInputArea();
        this.isProcessing = false;
        return;
      }

      submitBtn.click();

      // Wait for See to complete before allowing next trigger
      await this.wait(3000);
      
      // Update the story content after See completes
      this.captureCurrentStoryContent();

    } catch (error) {
    } finally {
      this.isProcessing = false;
    }
  }

  async openInputModeMenu() {
    const menuButton = document.querySelector(this.inputModeMenuSelector);
    if (!menuButton) return false;
    
    // Check if menu is already open
    const existingMenu = document.querySelector(this.seeModeSelectorInMenu);
    if (existingMenu) return true;
    
    menuButton.click();
    
    // Wait for menu to appear
    for (let i = 0; i < 20; i++) {
      await this.wait(50);
      const menu = document.querySelector(this.seeModeSelectorInMenu);
      if (menu) return true;
    }
    
    return false;
  }

  closeInputArea() {
    const closeButton = document.querySelector(this.closeInputSelector);
    if (closeButton) {
      closeButton.click();
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.AutoSeeFeature = AutoSeeFeature;
}
