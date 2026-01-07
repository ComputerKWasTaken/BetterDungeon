// BetterDungeon - Command Input Feature
// Adds a "Command" input mode that formats input as story headers

class CommandFeature {
  static id = 'command';

  constructor() {
    this.observer = null;
    this.commandButton = null;
    this.isCommandMode = false;
    this.boundKeyHandler = null;
    this.submitClickHandler = null;
    this.modeChangeHandler = null;
  }

  init() {
    console.log('CommandFeature: Initializing...');
    this.setupObserver();
    this.injectCommandButton();
  }

  destroy() {
    console.log('CommandFeature: Destroying...');
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.modeChangeHandler) {
      document.removeEventListener('click', this.modeChangeHandler, true);
      this.modeChangeHandler = null;
    }
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    if (this.submitClickHandler) {
      document.removeEventListener('click', this.submitClickHandler, true);
      this.submitClickHandler = null;
    }
    this.removeCommandButton();
    this.restoreModeDisplay();
    this.isCommandMode = false;
  }

  setupObserver() {
    this.observer = new MutationObserver((mutations) => {
      this.injectCommandButton();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  findInputModeMenu() {
    // Find the input mode menu by looking for the container with the mode buttons
    // The menu has buttons with aria-labels like "Set to 'Do' mode", "Set to 'Say' mode", etc.
    const storyButton = document.querySelector('[aria-label="Set to \'Story\' mode"]');
    if (storyButton) {
      return storyButton.parentElement;
    }
    return null;
  }

  injectCommandButton() {
    const menu = this.findInputModeMenu();
    if (!menu) return;

    // Check if we already added the button
    if (menu.querySelector('[aria-label="Set to \'Command\' mode"]')) {
      return;
    }

    // Find an existing button to clone its structure
    const storyButton = menu.querySelector('[aria-label="Set to \'Story\' mode"]');
    if (!storyButton) return;

    // Clone the Story button as a template
    const commandButton = storyButton.cloneNode(true);
    
    // Update aria-label
    commandButton.setAttribute('aria-label', "Set to 'Command' mode");
    
    // Update the icon text - use the AI icon
    const iconElement = commandButton.querySelector('.font_icons');
    if (iconElement) {
      iconElement.textContent = 'w_ai';
    }
    
    // Update the label text
    const labelElement = commandButton.querySelector('.font_body');
    if (labelElement) {
      labelElement.textContent = 'Command';
    }

    // Remove any existing click handlers by cloning without event listeners
    const cleanButton = commandButton.cloneNode(true);
    
    // Add our click handler
    cleanButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.activateCommandMode();
    });

    // Insert the button after the See button (last one) or after Story button
    const seeButton = menu.querySelector('[aria-label="Set to \'See\' mode"]');
    if (seeButton && seeButton.nextSibling) {
      menu.insertBefore(cleanButton, seeButton.nextSibling);
    } else if (seeButton) {
      menu.appendChild(cleanButton);
    } else {
      // Insert after Story button
      if (storyButton.nextSibling) {
        menu.insertBefore(cleanButton, storyButton.nextSibling);
      } else {
        menu.appendChild(cleanButton);
      }
    }

    this.commandButton = cleanButton;
    console.log('CommandFeature: Command button injected');
  }

  removeCommandButton() {
    const button = document.querySelector('[aria-label="Set to \'Command\' mode"]');
    if (button) {
      button.remove();
    }
    this.commandButton = null;
  }

  activateCommandMode() {
    console.log('CommandFeature: Command mode activated');
    this.isCommandMode = true;

    // Click the Story button first to set the base mode
    const storyButton = document.querySelector('[aria-label="Set to \'Story\' mode"]');
    if (storyButton) {
      storyButton.click();
    }

    // Close the menu by clicking the back arrow
    setTimeout(() => {
      const closeButton = document.querySelector('[aria-label="Close \'Input Mode\' menu"]');
      if (closeButton) {
        closeButton.click();
      }
      
      // After menu closes, update the UI to show "Command" mode
      setTimeout(() => {
        this.updateModeDisplay();
      }, 50);
    }, 50);

    // Setup interception for the next submission
    this.setupSubmitInterception();
    
    // Watch for mode changes (user clicking on input mode button)
    this.watchForModeChanges();
  }

  watchForModeChanges() {
    // Clean up any existing observer
    if (this.modeChangeObserver) {
      this.modeChangeObserver.disconnect();
    }

    // Watch for clicks on the "Change input mode" button or any mode selection
    const handleModeChange = (e) => {
      if (!this.isCommandMode) return;

      const target = e.target.closest('[aria-label]');
      if (!target) return;

      const ariaLabel = target.getAttribute('aria-label') || '';
      
      // If user clicks "Change input mode" or selects a different mode, cancel command mode
      if (ariaLabel === 'Change input mode' ||
          ariaLabel.startsWith("Set to '") && !ariaLabel.includes("Command")) {
        console.log('CommandFeature: User changed input mode, canceling command mode');
        this.deactivateCommandMode();
      }
    };

    document.addEventListener('click', handleModeChange, true);
    
    // Store reference for cleanup
    this.modeChangeHandler = handleModeChange;
  }

  updateModeDisplay() {
    // Update the current input mode button text from "story" to "command"
    const modeButton = document.querySelector('[aria-label="Change input mode"]');
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText && modeText.textContent.toLowerCase() === 'story') {
        modeText.textContent = 'command';
      }
    }

    // Update the placeholder text
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      textarea.placeholder = 'Give an instruction to the AI.';
      textarea.setAttribute('data-placeholder', 'Give an instruction to the AI.');
    }

    // Update the send button icon from paper plane to AI icon
    const submitButton = document.querySelector('[aria-label="Submit action"]');
    if (submitButton) {
      const iconElement = submitButton.querySelector('.font_icons');
      if (iconElement && iconElement.textContent === 'w_paper_plane') {
        iconElement.textContent = 'w_ai';
      }
    }
  }

  restoreModeDisplay() {
    // Restore the original mode text
    const modeButton = document.querySelector('[aria-label="Change input mode"]');
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText && modeText.textContent.toLowerCase() === 'command') {
        modeText.textContent = 'story';
      }
    }

    // Restore the placeholder text
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      textarea.placeholder = 'What happens next?';
      textarea.setAttribute('data-placeholder', 'What happens next?');
    }

    // Restore the send button icon from AI icon back to paper plane
    const submitButton = document.querySelector('[aria-label="Submit action"]');
    if (submitButton) {
      const iconElement = submitButton.querySelector('.font_icons');
      if (iconElement && iconElement.textContent === 'w_ai') {
        iconElement.textContent = 'w_paper_plane';
      }
    }
  }

  setupSubmitInterception() {
    // Intercept Enter key for submission
    this.setupKeyboardListener();
    
    // Intercept click on submit button
    this.setupSubmitButtonListener();
  }

  setupKeyboardListener() {
    const handleKeyDown = (e) => {
      if (!this.isCommandMode) {
        document.removeEventListener('keydown', handleKeyDown, true);
        return;
      }

      // Check for Enter without Shift (submit)
      if (e.key === 'Enter' && !e.shiftKey) {
        const textarea = document.querySelector('#game-text-input');
        if (textarea && e.target === textarea) {
          const content = textarea.value || '';
          
          if (content.trim()) {
            // Format the content as a command header
            const formattedContent = this.formatAsCommand(content);
            textarea.value = formattedContent;
            
            // Trigger input event so React picks up the change
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Reset command mode after submission
            this.deactivateCommandMode();
            console.log('CommandFeature: Command formatted via Enter key');
          }
        }
      }
    };

    // Remove any existing listener first
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
    }
    this.boundKeyHandler = handleKeyDown;
    document.addEventListener('keydown', handleKeyDown, true);
  }

  setupSubmitButtonListener() {
    const handleClick = (e) => {
      if (!this.isCommandMode) return;
      
      // Check if the click is on the submit button
      const submitButton = e.target.closest('[aria-label="Submit action"]');
      if (!submitButton) return;

      const textarea = document.querySelector('#game-text-input');
      if (textarea) {
        const content = textarea.value || '';
        if (content.trim()) {
          // Format the content as a command header
          const formattedContent = this.formatAsCommand(content);
          textarea.value = formattedContent;
          
          // Trigger input event so React picks up the change
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Reset command mode after submission
          this.deactivateCommandMode();
          console.log('CommandFeature: Command formatted via submit button');
        }
      }
    };

    // Store reference and add listener
    if (this.submitClickHandler) {
      document.removeEventListener('click', this.submitClickHandler, true);
    }
    this.submitClickHandler = handleClick;
    document.addEventListener('click', handleClick, true);
    
    // Auto-cleanup after 30 seconds
    setTimeout(() => {
      if (this.isCommandMode) {
        this.deactivateCommandMode();
        console.log('CommandFeature: Command mode timed out');
      }
    }, 30000);
  }

  deactivateCommandMode() {
    this.isCommandMode = false;
    this.restoreModeDisplay();
    
    // Clean up listeners
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    if (this.submitClickHandler) {
      document.removeEventListener('click', this.submitClickHandler, true);
      this.submitClickHandler = null;
    }
    if (this.modeChangeHandler) {
      document.removeEventListener('click', this.modeChangeHandler, true);
      this.modeChangeHandler = null;
    }
  }

  formatAsCommand(content) {
    // Format: \n\n## ${content.replace(/^[\s#]+/, "").replace(/[\s.?!:]+$/, "")}:\n\n
    const cleanedContent = content
      .replace(/^[\s#]+/, '')  // Remove leading whitespace and # characters
      .replace(/[\s.?!:]+$/, ''); // Remove trailing punctuation and whitespace
    
    return `\n\n## ${cleanedContent}:\n\n`;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.CommandFeature = CommandFeature;
}
