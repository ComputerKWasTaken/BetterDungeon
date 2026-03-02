// BetterDungeon - Hotkey Feature
// Adds keyboard shortcuts for common AI Dungeon actions
// Supports custom hotkey bindings via Chrome storage

class HotkeyFeature {
  static id = 'hotkey';
  
  // Storage key for custom bindings
  static STORAGE_KEY = 'betterDungeon_customHotkeys';

  // Default hotkey definitions (action ID -> config)
  // These define what each action does, separate from key bindings
  static HOTKEY_ACTIONS = {
    'takeATurn': { selector: '[aria-label="Command: take a turn"]', description: 'Take a Turn', category: 'actions' },
    'continue': { selector: '[aria-label="Command: continue"]', description: 'Continue', category: 'actions' },
    'retry': { selector: '[aria-label="Command: retry"]', description: 'Retry', category: 'actions' },
    'erase': { selector: '[aria-label="Command: erase"]', description: 'Erase', category: 'actions' },
    'exitInput': { action: 'closeInputArea', description: 'Exit Input', category: 'actions' },
    'undo': { selector: '[aria-label="Undo change"]', description: 'Undo', category: 'history' },
    'redo': { selector: '[aria-label="Redo change"]', description: 'Redo', category: 'history' },
    'modeDo': { selector: '[aria-label="Set to \'Do\' mode"]', description: 'Do Mode', requiresMenu: true, category: 'modes' },
    'modeTry': { selector: '[aria-label="Set to \'Try\' mode"]', description: 'Try Mode', requiresMenu: true, featureDependent: 'try', category: 'modes' },
    'modeSay': { selector: '[aria-label="Set to \'Say\' mode"]', description: 'Say Mode', requiresMenu: true, category: 'modes' },
    'modeStory': { selector: '[aria-label="Set to \'Story\' mode"]', description: 'Story Mode', requiresMenu: true, category: 'modes' },
    'modeSee': { selector: '[aria-label="Set to \'See\' mode"]', description: 'See Mode', requiresMenu: true, category: 'modes' },
    'modeCommand': { selector: '[aria-label="Set to \'Command\' mode"]', description: 'Command Mode', requiresMenu: true, featureDependent: 'command', category: 'modes' }
  };

  // Default key bindings (key -> action ID)
  static DEFAULT_BINDINGS = {
    't': 'takeATurn',
    'c': 'continue',
    'r': 'retry',
    'e': 'erase',
    'escape': 'exitInput',
    'z': 'undo',
    'y': 'redo',
    '1': 'modeDo',
    '2': 'modeTry',
    '3': 'modeSay',
    '4': 'modeStory',
    '5': 'modeSee',
    '6': 'modeCommand'
  };

  constructor() {
    this.boundKeyHandler = null;
    this.boundMessageListener = null;
    // hotkeyMap maps key -> action config (built from bindings)
    this.hotkeyMap = {};
    // keyBindings maps key -> action ID (for storage/display)
    this.keyBindings = { ...HotkeyFeature.DEFAULT_BINDINGS };
    this.debug = false;
    
    // ==================== STABILITY IMPROVEMENTS ====================
    // Operation locking to prevent concurrent async operations
    this.isProcessingAction = false;
    this.currentOperationId = 0;
    
    // Debouncing and rate limiting
    this.lastKeyTime = 0;
    this.KEY_DEBOUNCE_MS = 150; // Minimum time between key presses
    
    // Track pending timeouts for cleanup
    this.pendingTimeouts = [];
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async init() {
    console.log('[Hotkey] Initializing Keyboard Shortcuts feature...');
    await this.loadCustomBindings();
    this.buildHotkeyMap();
    this.setupKeyboardListener();
    this.listenForBindingUpdates();
  }

  // Load custom key bindings from Chrome storage
  async loadCustomBindings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(HotkeyFeature.STORAGE_KEY, (result) => {
        const customBindings = result[HotkeyFeature.STORAGE_KEY];
        if (customBindings && typeof customBindings === 'object') {
          // Merge custom bindings with defaults (custom takes precedence)
          this.keyBindings = { ...HotkeyFeature.DEFAULT_BINDINGS, ...customBindings };
          this.log('[Hotkey] Loaded custom bindings', this.keyBindings);
        } else {
          this.keyBindings = { ...HotkeyFeature.DEFAULT_BINDINGS };
        }
        resolve();
      });
    });
  }

  // Build the hotkeyMap from current keyBindings
  buildHotkeyMap() {
    this.hotkeyMap = {};
    for (const [key, actionId] of Object.entries(this.keyBindings)) {
      const actionConfig = HotkeyFeature.HOTKEY_ACTIONS[actionId];
      if (actionConfig) {
        this.hotkeyMap[key.toLowerCase()] = { ...actionConfig, actionId };
      }
    }
  }

  // Listen for binding updates from the popup
  listenForBindingUpdates() {
    this.boundMessageListener = (message, sender, sendResponse) => {
      if (message.type === 'HOTKEY_BINDINGS_UPDATED') {
        this.keyBindings = message.bindings;
        this.buildHotkeyMap();
        this.log('[Hotkey] Bindings updated', this.keyBindings);
        sendResponse({ success: true });
      }
      return true;
    };
    chrome.runtime.onMessage.addListener(this.boundMessageListener);
  }

  destroy() {
    // Abort any ongoing operation
    this.abortCurrentOperation('Feature destroyed');
    
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    if (this.boundMessageListener) {
      chrome.runtime.onMessage.removeListener(this.boundMessageListener);
      this.boundMessageListener = null;
    }
    
    // Clear all pending timeouts
    this.clearPendingTimeouts();
  }

  // ==================== STATE MANAGEMENT ====================

  /**
   * Aborts the current operation if one is in progress
   * @param {string} reason - Reason for aborting
   */
  abortCurrentOperation(reason) {
    if (this.isProcessingAction) {
      this.log('[Hotkey] Aborting current operation:', reason);
      this.currentOperationId++; // Invalidate any ongoing async operations
      this.isProcessingAction = false;
      
      // Try to clean up any open UI elements
      this.safeCleanupUI();
    }
  }

  /**
   * Safely attempts to close any open UI elements without throwing errors
   */
  safeCleanupUI() {
    try {
      this.closeInputModeMenu();
    } catch (e) {
      this.log('[Hotkey] Error during UI cleanup:', e);
    }
  }

  /**
   * Checks if an operation is still valid (not stale/cancelled)
   * @param {number} operationId - The operation ID to check
   * @returns {boolean} True if operation is still valid
   */
  isOperationValid(operationId) {
    return operationId === this.currentOperationId;
  }

  /**
   * Clears all pending timeouts
   */
  clearPendingTimeouts() {
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts = [];
  }

  /**
   * Creates a tracked timeout that can be cleared on destroy
   * @param {Function} callback - Callback function
   * @param {number} delay - Delay in milliseconds
   * @returns {number} Timeout ID
   */
  createTrackedTimeout(callback, delay) {
    const timeoutId = setTimeout(() => {
      // Remove from tracking array when executed
      const index = this.pendingTimeouts.indexOf(timeoutId);
      if (index > -1) {
        this.pendingTimeouts.splice(index, 1);
      }
      callback();
    }, delay);
    this.pendingTimeouts.push(timeoutId);
    return timeoutId;
  }

  // Static method to get default bindings (used by popup)
  static getDefaultBindings() {
    return { ...HotkeyFeature.DEFAULT_BINDINGS };
  }

  // Static method to get action definitions (used by popup)
  static getActionDefinitions() {
    return { ...HotkeyFeature.HOTKEY_ACTIONS };
  }

  isUserTyping() {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    
    const tagName = activeElement.tagName.toLowerCase();
    const isEditable = activeElement.isContentEditable;
    const isInput = tagName === 'input' || tagName === 'textarea';
    
    return isEditable || isInput;
  }

  isFeatureEnabled(featureId) {
    // Check if the feature-dependent button exists in DOM (means feature is enabled)
    if (featureId === 'try') {
      return !!document.querySelector('[aria-label="Set to \'Try\' mode"]');
    }
    if (featureId === 'command') {
      return !!document.querySelector('[aria-label="Set to \'Command\' mode"]');
    }
    return true;
  }

  async openInputModeMenu(operationId = null) {
    const menuButton = document.querySelector('[aria-label="Change input mode"]');
    if (!menuButton) return false;
    
    // Check if menu is already open
    const existingMenu = document.querySelector('[aria-label="Set to \'Do\' mode"]');
    if (existingMenu) return true;
    
    // Click to open the menu
    menuButton.click();
    
    // Wait for menu to appear with operation validation
    return new Promise(resolve => {
      let attempts = 0;
      const checkMenu = setInterval(() => {
        // Check if operation was cancelled
        if (operationId !== null && !this.isOperationValid(operationId)) {
          clearInterval(checkMenu);
          resolve(false);
          return;
        }
        
        attempts++;
        const menu = document.querySelector('[aria-label="Set to \'Do\' mode"]');
        if (menu) {
          clearInterval(checkMenu);
          resolve(true);
        } else if (attempts > 20) {
          clearInterval(checkMenu);
          resolve(false);
        }
      }, 50);
    });
  }

  closeInputModeMenu() {
    const closeButton = document.querySelector('[aria-label="Close \'Input Mode\' menu"]');
    if (closeButton) {
      closeButton.click();
    }
  }

  closeInputArea() {
    // Click the close button with aria-label="Close text input"
    const closeButton = document.querySelector('[aria-label="Close text input"]');
    if (closeButton) {
      // First blur the active element before clicking close
      if (document.activeElement) {
        document.activeElement.blur();
      }
      
      closeButton.click();
      
      // Remove focus from the input to prevent hidden keystrokes
      // Use setTimeout to ensure focus change happens after the close action completes
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
        // Make body focusable and focus it
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      }, 50);
    }
  }

  isInputAreaOpen() {
    // Check if the input area is visible by looking for the "Change input mode" button
    return !!document.querySelector('[aria-label="Change input mode"]');
  }

  async openInputArea(operationId = null) {
    // If input area is already open, return true
    if (this.isInputAreaOpen()) return true;
    
    // Click "Take a Turn" to open the input area
    const takeATurnButton = document.querySelector('[aria-label="Command: take a turn"]');
    if (!takeATurnButton) {
      return false;
    }
    
    takeATurnButton.click();
    
    // Wait for the input area to appear with operation validation
    return new Promise(resolve => {
      let attempts = 0;
      const checkInputArea = setInterval(() => {
        // Check if operation was cancelled
        if (operationId !== null && !this.isOperationValid(operationId)) {
          clearInterval(checkInputArea);
          resolve(false);
          return;
        }
        
        attempts++;
        if (this.isInputAreaOpen()) {
          clearInterval(checkInputArea);
          resolve(true);
        } else if (attempts > 30) {
          clearInterval(checkInputArea);
          resolve(false);
        }
      }, 50);
    });
  }

  setupKeyboardListener() {
    const handleKeyDown = async (e) => {
      // Don't trigger hotkeys when user is typing, EXCEPT for Escape key
      if (this.isUserTyping() && e.key.toLowerCase() !== 'escape') return;
      
      // Don't trigger on modifier key combinations (except our own)
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      
      const key = e.key.toLowerCase();
      const hotkeyConfig = this.hotkeyMap[key];
      
      if (!hotkeyConfig) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      // ==================== STABILITY: Debouncing ====================
      // Prevent rapid repeated key presses from causing issues
      const now = Date.now();
      if (now - this.lastKeyTime < this.KEY_DEBOUNCE_MS) {
        this.log('[Hotkey] Key debounced:', key);
        return;
      }
      this.lastKeyTime = now;
      
      // Handle special actions (like closeInputArea) - these don't need locking
      if (hotkeyConfig.action) {
        if (hotkeyConfig.action === 'closeInputArea') {
          // If we're processing an action, abort it first
          if (this.isProcessingAction) {
            this.abortCurrentOperation('User pressed Escape');
          }
          this.closeInputArea();
        }
        return;
      }
      
      // ==================== STABILITY: Operation Locking ====================
      // Prevent concurrent async operations
      if (this.isProcessingAction) {
        this.log('[Hotkey] Ignoring key - already processing an action:', key);
        return;
      }
      
      // Start new operation with unique ID for async actions
      this.currentOperationId++;
      const operationId = this.currentOperationId;
      
      // Handle input mode selection (requires opening input area and menu first)
      if (hotkeyConfig.requiresMenu) {
        this.isProcessingAction = true;
        
        try {
          // First, ensure the input area is open (click Take a Turn if needed)
          const inputAreaOpen = await this.openInputArea(operationId);
          if (!inputAreaOpen || !this.isOperationValid(operationId)) {
            this.log('[Hotkey] Failed to open input area or operation cancelled');
            return;
          }
          
          // Small delay to ensure input area is fully rendered
          await this.waitWithValidation(150, operationId);
          if (!this.isOperationValid(operationId)) return;
          
          // Now open the input mode menu
          const menuOpened = await this.openInputModeMenu(operationId);
          if (!menuOpened || !this.isOperationValid(operationId)) {
            this.log('[Hotkey] Failed to open menu or operation cancelled');
            return;
          }
          
          // Small delay to ensure menu is fully rendered
          await this.waitWithValidation(100, operationId);
          if (!this.isOperationValid(operationId)) return;
          
          // Check feature dependency AFTER menu is open (so we can see if button exists)
          if (hotkeyConfig.featureDependent && !this.isFeatureEnabled(hotkeyConfig.featureDependent)) {
            this.closeInputModeMenu();
            return;
          }
          
          // Find and click the target element
          const targetElement = document.querySelector(hotkeyConfig.selector);
          if (targetElement) {
            // Check if element is disabled
            const isDisabled = targetElement.getAttribute('aria-disabled') === 'true';
            if (!isDisabled) {
              targetElement.click();
            }
          } else {
            // Close menu if we couldn't find the option
            this.closeInputModeMenu();
          }
        } catch (error) {
          console.error('[Hotkey] Error during hotkey action:', error);
          this.safeCleanupUI();
        } finally {
          // Only reset if this is still the current operation
          if (this.isOperationValid(operationId)) {
            this.isProcessingAction = false;
          }
        }
        return;
      }
      
      // Handle simple actions (no menu required)
      const targetElement = document.querySelector(hotkeyConfig.selector);
      if (targetElement) {
        // Check if element is disabled
        const isDisabled = targetElement.getAttribute('aria-disabled') === 'true';
        if (isDisabled) {
          return;
        }
        
        // Dispatch custom event for Continue action so other features can detect it
        if (hotkeyConfig.actionId === 'continue') {
          document.dispatchEvent(new CustomEvent('betterdungeon:continue-hotkey'));
        }
        
        targetElement.click();
      }
    };

    this.boundKeyHandler = handleKeyDown;
    document.addEventListener('keydown', handleKeyDown, true);
  }

  /**
   * Wait helper that checks operation validity
   * @param {number} ms - Milliseconds to wait
   * @param {number} operationId - Current operation ID
   * @returns {Promise<boolean>} True if operation is still valid after wait
   */
  async waitWithValidation(ms, operationId) {
    await new Promise(resolve => setTimeout(resolve, ms));
    return this.isOperationValid(operationId);
  }

}

// Make available globally
if (typeof window !== 'undefined') {
  window.HotkeyFeature = HotkeyFeature;
}
