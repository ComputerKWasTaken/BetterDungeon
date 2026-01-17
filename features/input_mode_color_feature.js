// BetterDungeon - Input Mode Color Feature
// Adds color coding to the input box border and mode selection buttons based on input mode

class InputModeColorFeature {
  static id = 'inputModeColor';

  constructor() {
    this.observer = null;
    this.currentMode = null;
    this.inputContainer = null;
  }

  init() {
    console.log('InputModeColorFeature: Initializing...');
    this.setupObserver();
    this.detectAndApplyColor();
  }

  destroy() {
    console.log('InputModeColorFeature: Destroying...');
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.removeColorStyling();
    this.currentMode = null;
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
