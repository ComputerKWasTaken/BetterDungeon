// BetterDungeon - Hotkey Feature
// Adds keyboard shortcuts for common AI Dungeon actions

class HotkeyFeature {
  static id = 'hotkey';

  constructor() {
    this.boundKeyHandler = null;
    this.hotkeyMap = {
      // Command bar actions
      't': { selector: '[aria-label="Command: take a turn"]', description: 'Take a Turn' },
      'c': { selector: '[aria-label="Command: continue"]', description: 'Continue' },
      'r': { selector: '[aria-label="Command: retry"]', description: 'Retry' },
      'e': { selector: '[aria-label="Command: erase"]', description: 'Erase' },
      
      // Input area control
      'escape': { action: 'closeInputArea', description: 'Exit Input Area' },
      
      // Undo/Redo
      'z': { selector: '[aria-label="Undo change"]', description: 'Undo' },
      'y': { selector: '[aria-label="Redo change"]', description: 'Redo' },
      
      // Input mode selection (number keys)
      '1': { selector: '[aria-label="Set to \'Do\' mode"]', description: 'Do Mode', requiresMenu: true },
      '2': { selector: '[aria-label="Set to \'Attempt\' mode"]', description: 'Attempt Mode', requiresMenu: true, featureDependent: 'attempt' },
      '3': { selector: '[aria-label="Set to \'Say\' mode"]', description: 'Say Mode', requiresMenu: true },
      '4': { selector: '[aria-label="Set to \'Story\' mode"]', description: 'Story Mode', requiresMenu: true },
      '5': { selector: '[aria-label="Set to \'See\' mode"]', description: 'See Mode', requiresMenu: true },
      '6': { selector: '[aria-label="Set to \'Command\' mode"]', description: 'Command Mode', requiresMenu: true, featureDependent: 'command' }
    };
  }

  init() {
    console.log('HotkeyFeature: Initializing...');
    this.setupKeyboardListener();
  }

  destroy() {
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
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
