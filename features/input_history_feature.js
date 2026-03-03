// BetterDungeon - Input History Feature
// Terminal-style input history: Save the user's recent inputs in local storage
// Pressing Ctrl/Meta + Up/Down arrow keys inside an empty input box cycles through previously sent actions

class InputHistoryFeature {
  static id = 'inputHistory';

  constructor() {
    this.enabled = true;
    this.debug = false;
    
    // Selectors
    this.textInputSelector = '#game-text-input';
    this.submitButtonSelector = '[aria-label="Submit action"]';
    this.inputModeMenuSelector = '[aria-label="Change input mode"]';
    
    // Mode selectors
    this.modeSelectors = {
      'do': '[aria-label="Set to \'Do\' mode"]',
      'say': '[aria-label="Set to \'Say\' mode"]',
      'story': '[aria-label="Set to \'Story\' mode"]',
      'see': '[aria-label="Set to \'See\' mode"]',
      'try': '[aria-label="Set to \'Try\' mode"]',
      'command': '[aria-label="Set to \'Command\' mode"]'
    };

    // State
    this.history = [];
    this.historyIndex = -1;
    this.maxHistorySize = 50;
    this.storageKey = 'betterDungeon_inputHistory';
    this.isSettingValue = false;
    this.modeSwitchTimeout = null;
    
    // Bound handlers for cleanup
    this.boundKeydownHandler = this.handleKeydown.bind(this);
    this.boundClickHandler = this.handleClick.bind(this);
    this.boundInputHandler = this.handleInput.bind(this);
  }

  log(...args) {
    if (this.debug) {
      console.log('[InputHistory]', ...args);
    }
  }

  async init() {
    console.log('Initializing Input History feature...');
    await this.loadHistory();
    this.attachListeners();
    console.log('Initialization complete.');
  }

  destroy() {
    console.log('Destroying Input History feature...');
    this.detachListeners();
    console.log('Cleanup complete');
  }

  async loadHistory() {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      if (result[this.storageKey]) {
        this.history = result[this.storageKey];
        this.log(`Loaded ${this.history.length} history items`);
      }
    } catch (e) {
      console.error('[InputHistory] Error loading history:', e);
    }
  }

  async saveHistory() {
    try {
      await chrome.storage.local.set({ [this.storageKey]: this.history });
    } catch (e) {
      console.error('[InputHistory] Error saving history:', e);
    }
  }

  attachListeners() {
    document.addEventListener('keydown', this.boundKeydownHandler, true);
    document.addEventListener('click', this.boundClickHandler, true);
    document.addEventListener('input', this.boundInputHandler, true);
  }

  detachListeners() {
    document.removeEventListener('keydown', this.boundKeydownHandler, true);
    document.removeEventListener('click', this.boundClickHandler, true);
    document.removeEventListener('input', this.boundInputHandler, true);
  }

  detectCurrentInputMode() {
    const modeButton = document.querySelector(this.inputModeMenuSelector);
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText) {
        const mode = modeText.textContent.toLowerCase().trim();
        return mode;
      }
    }
    return 'do'; // Default
  }

  async setInputMode(mode) {
    const targetMode = mode.toLowerCase();
    const currentMode = this.detectCurrentInputMode();
    
    if (targetMode === currentMode) return;
    
    this.log(`Changing mode from ${currentMode} to ${targetMode}`);
    
    // Open mode menu
    const modeMenuBtn = document.querySelector(this.inputModeMenuSelector);
    if (!modeMenuBtn) return;
    
    modeMenuBtn.click();
    
    // Wait for menu to open
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Select the mode
    const modeSelector = this.modeSelectors[targetMode];
    if (modeSelector) {
      const modeBtn = document.querySelector(modeSelector);
      if (modeBtn) {
        modeBtn.click();
      } else {
        // Fallback: click outside to close if mode button not found
        document.body.click();
      }
    } else {
      // Fallback
      document.body.click();
    }
  }

  setInputValue(text) {
    const inputElement = document.querySelector(this.textInputSelector);
    if (!inputElement) return;
    
    this.isSettingValue = true;
    
    // Use native value setter to bypass React's tracking, allowing the dispatchEvent to work properly
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set || 
                                   Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                   
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(inputElement, text);
    } else {
      inputElement.value = text;
    }
    
    // Trigger React's onChange
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Move cursor to end
    setTimeout(() => {
      const activeInput = document.querySelector(this.textInputSelector);
      if (activeInput) {
        activeInput.selectionStart = activeInput.selectionEnd = text.length;
      }
      this.isSettingValue = false;
    }, 10);
  }

  handleInput(e) {
    // Only care if the target is the text input
    if (!e.target || e.target.id !== 'game-text-input') return;
    
    // If we are artificially setting the value from history, don't reset the index
    if (this.isSettingValue) return;
    
    // If the user actually typed something, reset the history index so they can navigate normally
    if (this.historyIndex !== -1) {
      this.historyIndex = -1;
    }
  }

  saveCurrentInput() {
    const inputElement = document.querySelector(this.textInputSelector);
    if (!inputElement) return;
    
    const text = inputElement.value.trim();
    if (!text) return; // Don't save empty inputs
    
    const mode = this.detectCurrentInputMode();
    
    // Don't save if it's identical to the most recent one
    if (this.history.length > 0) {
      const last = this.history[0];
      if (last.text === text && last.mode === mode) {
        this.historyIndex = -1; // Reset index
        return;
      }
    }
    
    // Add to front of history
    this.history.unshift({ mode, text });
    
    // Cap size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }
    
    this.saveHistory();
    this.historyIndex = -1; // Reset index after sending
    this.log(`Saved input to history: [${mode}] ${text}`);
  }

  handleKeydown(e) {
    // Only care if the target is the text input
    if (!e.target || e.target.id !== 'game-text-input') return;

    // Save on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      // Execute save synchronously before React clears the input
      this.saveCurrentInput();
      return;
    }

    // Handle history navigation
    if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const isUp = e.key === 'ArrowUp';
      
      e.preventDefault(); // Prevent cursor movement
      
      if (isUp) {
        // Go older
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          this.applyHistoryItem(this.historyIndex);
        }
      } else {
        // Go newer
        if (this.historyIndex > 0) {
          this.historyIndex--;
          this.applyHistoryItem(this.historyIndex);
        } else if (this.historyIndex === 0) {
          // Clear input when going down from newest item
          this.historyIndex = -1;
          this.setInputValue('');
        }
      }
    }
  }

  handleClick(e) {
    // See if we clicked the submit button
    const submitBtn = e.target.closest(this.submitButtonSelector);
    if (submitBtn) {
      this.saveCurrentInput();
    }
  }

  applyHistoryItem(index) {
    if (index >= 0 && index < this.history.length) {
      const item = this.history[index];
      this.log(`Applying history item ${index}: [${item.mode}] ${item.text}`);
      
      // Instantly update the text
      this.setInputValue(item.text);
      
      // Debounce the UI-heavy mode switch so it doesn't brick the React app when scrolling fast
      if (this.modeSwitchTimeout) {
        clearTimeout(this.modeSwitchTimeout);
      }
      
      this.modeSwitchTimeout = setTimeout(() => {
        this.setInputMode(item.mode);
        this.modeSwitchTimeout = null;
      }, 250);
    }
  }
}

if (typeof window !== 'undefined') {
  window.InputHistoryFeature = InputHistoryFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = InputHistoryFeature;
}
