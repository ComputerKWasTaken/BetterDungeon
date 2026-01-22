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
    'modeAttempt': { selector: '[aria-label="Set to \'Attempt\' mode"]', description: 'Attempt Mode', requiresMenu: true, featureDependent: 'attempt', category: 'modes' },
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
    '2': 'modeAttempt',
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
  }

  async init() {
    console.log('HotkeyFeature: Initializing...');
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
          console.log('HotkeyFeature: Loaded custom bindings', this.keyBindings);
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
        console.log('HotkeyFeature: Bindings updated', this.keyBindings);
        sendResponse({ success: true });
      }
      return true;
    };
    chrome.runtime.onMessage.addListener(this.boundMessageListener);
  }

  destroy() {
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    if (this.boundMessageListener) {
      chrome.runtime.onMessage.removeListener(this.boundMessageListener);
      this.boundMessageListener = null;
    }
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
    if (featureId === 'attempt') {
      return !!document.querySelector('[aria-label="Set to \'Attempt\' mode"]');
    }
    if (featureId === 'command') {
      return !!document.querySelector('[aria-label="Set to \'Command\' mode"]');
    }
    return true;
  }

  async openInputModeMenu() {
    const menuButton = document.querySelector('[aria-label="Change input mode"]');
    if (!menuButton) return false;
    
    // Check if menu is already open
    const existingMenu = document.querySelector('[aria-label="Set to \'Do\' mode"]');
    if (existingMenu) return true;
    
    // Click to open the menu
    menuButton.click();
    
    // Wait for menu to appear
    return new Promise(resolve => {
      let attempts = 0;
      const checkMenu = setInterval(() => {
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

  async openInputArea() {
    // If input area is already open, return true
    if (this.isInputAreaOpen()) return true;
    
    // Click "Take a Turn" to open the input area
    const takeATurnButton = document.querySelector('[aria-label="Command: take a turn"]');
    if (!takeATurnButton) {
      return false;
    }
    
    takeATurnButton.click();
    
    // Wait for the input area to appear
    return new Promise(resolve => {
      let attempts = 0;
      const checkInputArea = setInterval(() => {
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
      
      // Handle special actions (like closeInputArea)
      if (hotkeyConfig.action) {
        if (hotkeyConfig.action === 'closeInputArea') {
          this.closeInputArea();
        }
        return;
      }
      
      // Handle input mode selection (requires opening input area and menu first)
      if (hotkeyConfig.requiresMenu) {
        // First, ensure the input area is open (click Take a Turn if needed)
        const inputAreaOpen = await this.openInputArea();
        if (!inputAreaOpen) {
          return;
        }
        
        // Small delay to ensure input area is fully rendered
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Now open the input mode menu
        const menuOpened = await this.openInputModeMenu();
        if (!menuOpened) {
          return;
        }
        
        // Small delay to ensure menu is fully rendered
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check feature dependency AFTER menu is open (so we can see if button exists)
        if (hotkeyConfig.featureDependent && !this.isFeatureEnabled(hotkeyConfig.featureDependent)) {
          this.closeInputModeMenu();
          return;
        }
      }
      
      // Find and click the target element
      const targetElement = document.querySelector(hotkeyConfig.selector);
      if (targetElement) {
        // Check if element is disabled
        const isDisabled = targetElement.getAttribute('aria-disabled') === 'true';
        if (isDisabled) {
          return;
        }
        
        targetElement.click();
      } else {
        // Close menu if we opened it but couldn't find the option
        if (hotkeyConfig.requiresMenu) {
          this.closeInputModeMenu();
        }
      }
    };

    this.boundKeyHandler = handleKeyDown;
    document.addEventListener('keydown', handleKeyDown, true);
  }

}

// Make available globally
if (typeof window !== 'undefined') {
  window.HotkeyFeature = HotkeyFeature;
}
