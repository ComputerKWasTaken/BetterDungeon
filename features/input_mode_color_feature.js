// BetterDungeon - Input Mode Color Feature
// Adds subtle color coding to the input box border based on the current input mode

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
    this.observer = new MutationObserver((mutations) => {
      // Check for mode changes
      this.detectAndApplyColor();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label']
    });
  }

  // Mode color mapping - subtle, muted colors that complement the dark UI
  getModeColor(mode) {
    const colors = {
      'do': {
        border: 'rgba(59, 130, 246, 0.6)',      // Blue
        glow: 'rgba(59, 130, 246, 0.15)',
        rgb: '59, 130, 246'
      },
      'attempt': {
        border: 'rgba(168, 85, 247, 0.6)',      // Purple
        glow: 'rgba(168, 85, 247, 0.15)',
        rgb: '168, 85, 247'
      },
      'say': {
        border: 'rgba(34, 197, 94, 0.6)',       // Green
        glow: 'rgba(34, 197, 94, 0.15)',
        rgb: '34, 197, 94'
      },
      'story': {
        border: 'rgba(251, 191, 36, 0.6)',      // Amber/Gold
        glow: 'rgba(251, 191, 36, 0.15)',
        rgb: '251, 191, 36'
      },
      'see': {
        border: 'rgba(236, 72, 153, 0.6)',      // Pink
        glow: 'rgba(236, 72, 153, 0.15)',
        rgb: '236, 72, 153'
      },
      'command': {
        border: 'rgba(6, 182, 212, 0.6)',       // Cyan
        glow: 'rgba(6, 182, 212, 0.15)',
        rgb: '6, 182, 212'
      }
    };
    return colors[mode] || null;
  }

  detectCurrentMode() {
    // Look for the mode display button that shows current mode
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
    // Find the main input container that wraps the textarea
    // This is the rounded container with the background
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      // Navigate up to find the container with the border-radius styling
      let container = textarea.closest('.is_Row');
      if (container) {
        // Look for the parent that has the rounded corners and shadow
        const parent = container.closest('div[class*="_bxsh-"]');
        if (parent) {
          return parent;
        }
      }
      // Fallback: find container with specific styling
      container = textarea.parentElement;
      while (container && container !== document.body) {
        const style = window.getComputedStyle(container);
        if (style.borderRadius && parseFloat(style.borderRadius) > 8) {
          return container;
        }
        container = container.parentElement;
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
    // Find all mode selection buttons and apply their respective color gradients
    const modeButtons = [
      { selector: '[aria-label="Set to \'Do\' mode"]', mode: 'do' },
      { selector: '[aria-label="Set to \'Attempt\' mode"]', mode: 'attempt' },
      { selector: '[aria-label="Set to \'Say\' mode"]', mode: 'say' },
      { selector: '[aria-label="Set to \'Story\' mode"]', mode: 'story' },
      { selector: '[aria-label="Set to \'See\' mode"]', mode: 'see' },
      { selector: '[aria-label="Set to \'Command\' mode"]', mode: 'command' }
    ];

    modeButtons.forEach(({ selector, mode }) => {
      const button = document.querySelector(selector);
      if (button && !button.hasAttribute('data-bd-mode-styled')) {
        const colors = this.getModeColor(mode);
        if (colors) {
          button.setAttribute('data-bd-mode-styled', mode);
          button.classList.add('bd-mode-button-colored');
          button.style.setProperty('--bd-button-rgb', colors.rgb);
        }
      }
    });
  }

  applyColorStyling(mode) {
    this.inputContainer = this.findInputContainer();
    if (!this.inputContainer) return;

    const colors = this.getModeColor(mode);
    if (!colors || !this.inputContainer) return;

    // Add the data attribute for CSS targeting
    this.inputContainer.setAttribute('data-bd-input-mode', mode);

    // Apply inline styles for the border effect
    this.inputContainer.style.setProperty('--bd-mode-border', colors.border);
    this.inputContainer.style.setProperty('--bd-mode-glow', colors.glow);
    
    // Add the color class
    this.inputContainer.classList.add('bd-input-mode-colored');

    console.log(`InputModeColorFeature: Applied ${mode} mode color`);
  }

  removeColorStyling() {
    if (this.inputContainer) {
      this.inputContainer.removeAttribute('data-bd-input-mode');
      this.inputContainer.style.removeProperty('--bd-mode-border');
      this.inputContainer.style.removeProperty('--bd-mode-glow');
      this.inputContainer.classList.remove('bd-input-mode-colored');
    }

    // Also clean up any orphaned elements
    document.querySelectorAll('.bd-input-mode-colored').forEach(el => {
      el.removeAttribute('data-bd-input-mode');
      el.style.removeProperty('--bd-mode-border');
      el.style.removeProperty('--bd-mode-glow');
      el.classList.remove('bd-input-mode-colored');
    });

    // Clean up mode button styling
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
