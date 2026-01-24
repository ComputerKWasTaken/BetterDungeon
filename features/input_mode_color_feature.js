// BetterDungeon - Input Mode Color Feature
// Adds color coding to the input box border and mode selection buttons based on input mode
// Supports custom colors via Chrome storage

class InputModeColorFeature {
  static id = 'inputModeColor';
  
  // Storage key for custom colors
  static STORAGE_KEY = 'betterDungeon_customModeColors';
  
  // Default colors (hex format for easy editing)
  static DEFAULT_COLORS = {
    do: '#3b82f6',       // Blue
    attempt: '#a855f7',  // Purple
    say: '#22c55e',      // Green
    story: '#fbbf24',    // Amber/Gold
    see: '#ec4899',      // Pink
    command: '#06b6d4'   // Cyan
  };

  constructor() {
    this.observer = null;
    this.currentMode = null;
    this.inputContainer = null;
    this.customColors = { ...InputModeColorFeature.DEFAULT_COLORS };
    this.styleElement = null;
    this.boundMessageListener = null;
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async init() {
    console.log('[InputModeColor] Initializing Input Mode Colors feature...');
    await this.loadCustomColors();
    this.injectCustomColorStyles();
    this.setupObserver();
    this.detectAndApplyColor();
    this.listenForColorUpdates();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.boundMessageListener) {
      chrome.runtime.onMessage.removeListener(this.boundMessageListener);
      this.boundMessageListener = null;
    }
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
    this.removeColorStyling();
    this.currentMode = null;
  }

  // Load custom colors from Chrome storage
  async loadCustomColors() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(InputModeColorFeature.STORAGE_KEY, (result) => {
        const customColors = result[InputModeColorFeature.STORAGE_KEY];
        if (customColors && typeof customColors === 'object') {
          this.customColors = { ...InputModeColorFeature.DEFAULT_COLORS, ...customColors };
          this.log('[InputModeColor] Loaded custom colors', this.customColors);
        } else {
          this.customColors = { ...InputModeColorFeature.DEFAULT_COLORS };
        }
        resolve();
      });
    });
  }

  // Convert hex color to RGB values
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
    }
    return null;
  }

  // Generate lighter version of a color
  lightenColor(hex, percent = 20) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
  }

  // Inject custom color CSS variables into the document
  injectCustomColorStyles() {
    // Remove existing style element if any
    if (this.styleElement) {
      this.styleElement.remove();
    }

    // Build CSS for custom colors
    let cssVars = ':root {\n';
    for (const [mode, color] of Object.entries(this.customColors)) {
      const rgb = this.hexToRgb(color);
      const lightColor = this.lightenColor(color);
      if (rgb) {
        cssVars += `  --bd-mode-${mode}: ${color};\n`;
        cssVars += `  --bd-mode-${mode}-light: ${lightColor};\n`;
        cssVars += `  --bd-mode-${mode}-glow: rgba(${rgb}, 0.15);\n`;
        cssVars += `  --bd-mode-${mode}-rgb: ${rgb};\n`;
      }
    }
    cssVars += '}';

    // Create and inject style element
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'bd-custom-mode-colors';
    this.styleElement.textContent = cssVars;
    document.head.appendChild(this.styleElement);
  }

  // Listen for color updates from the popup
  listenForColorUpdates() {
    this.boundMessageListener = (message, sender, sendResponse) => {
      if (message.type === 'MODE_COLORS_UPDATED') {
        this.customColors = message.colors;
        this.injectCustomColorStyles();
        // Force re-apply current mode styling
        if (this.currentMode) {
          this.removeColorStyling();
          this.detectAndApplyColor();
        }
        this.log('[InputModeColor] Colors updated', this.customColors);
        sendResponse({ success: true });
      }
      return true;
    };
    chrome.runtime.onMessage.addListener(this.boundMessageListener);
  }

  setupObserver() {
    this.observer = new MutationObserver(() => {
      this.detectAndApplyColor();
    });

    // Watch for DOM changes to detect mode menu opening and mode changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label']
    });
  }

  // Mode color mapping handled in CSS via data attributes
  
  detectCurrentMode() {
    // The "Change input mode" button displays the current mode name
    const modeButton = document.querySelector('[aria-label="Change input mode"]');
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText) {
        return modeText.textContent.toLowerCase().trim();
      }
    }
    return null;
  }

  findInputContainer() {
    // Find the input container with border-radius (the rounded input box)
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      // Look for parent with border-top-left-radius class (_btlr-)
      const container = textarea.closest('div[class*="_btlr-"]');
      if (container) {
        return container;
      }
      // Fallback: traverse up to find container with visible border-radius
      let parent = textarea.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        if (style.borderRadius && parseFloat(style.borderRadius) > 8) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }
    return null;
  }

  detectAndApplyColor() {
    const mode = this.detectCurrentMode();
    
    // Always try to style mode buttons when menu is open
    this.styleModeButtons();
    
    if (mode === this.currentMode) {
      // Mode hasn't changed, but ensure styling is still applied
      if (mode && !this.inputContainer) {
        this.applyColorStyling(mode);
      }
      return;
    }

    this.currentMode = mode;
    
    if (mode) {
      this.applyColorStyling(mode);
    } else {
      this.removeColorStyling();
    }
  }

  styleModeButtons() {
    // Style mode selection buttons in the input mode menu (is_Button elements)
    const modeSelectors = [
      { selector: '[aria-label="Set to \'Do\' mode"]', mode: 'do' },
      { selector: '[aria-label="Set to \'Attempt\' mode"]', mode: 'attempt' },
      { selector: '[aria-label="Set to \'Say\' mode"]', mode: 'say' },
      { selector: '[aria-label="Set to \'Story\' mode"]', mode: 'story' },
      { selector: '[aria-label="Set to \'See\' mode"]', mode: 'see' },
      { selector: '[aria-label="Set to \'Command\' mode"]', mode: 'command' }
    ];

    modeSelectors.forEach(({ selector, mode }) => {
      const button = document.querySelector(selector);
      if (button && !button.hasAttribute('data-bd-mode-styled')) {
        button.setAttribute('data-bd-mode-styled', mode);
        button.classList.add('bd-mode-button-colored');
        
        // Map mode to CSS variable for button gradient
        const modeColorMap = {
          'do': 'var(--bd-mode-do-rgb)',
          'attempt': 'var(--bd-mode-attempt-rgb)',
          'say': 'var(--bd-mode-say-rgb)',
          'story': 'var(--bd-mode-story-rgb)',
          'see': 'var(--bd-mode-see-rgb)',
          'command': 'var(--bd-mode-command-rgb)'
        };
        
        if (modeColorMap[mode]) {
          button.style.setProperty('--bd-button-rgb', modeColorMap[mode]);
        }
      }
    });
  }

  applyColorStyling(mode) {
    this.inputContainer = this.findInputContainer();
    if (!this.inputContainer) return;

    // Apply mode-specific class for styling (handled in CSS)
    this.inputContainer.setAttribute('data-bd-input-mode', mode);
    this.inputContainer.classList.add('bd-input-mode-colored');
  }

  removeColorStyling() {
    // Clean up input container styling
    if (this.inputContainer) {
      this.inputContainer.removeAttribute('data-bd-input-mode');
      this.inputContainer.classList.remove('bd-input-mode-colored');
    }

    // Clean up any orphaned input containers
    document.querySelectorAll('.bd-input-mode-colored').forEach(el => {
      el.removeAttribute('data-bd-input-mode');
      el.classList.remove('bd-input-mode-colored');
    });

    // Clean up mode selection button styling
    document.querySelectorAll('.bd-mode-button-colored').forEach(el => {
      el.removeAttribute('data-bd-mode-styled');
      el.style.removeProperty('--bd-button-rgb');
      el.classList.remove('bd-mode-button-colored');
    });

    this.inputContainer = null;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.InputModeColorFeature = InputModeColorFeature;
}
