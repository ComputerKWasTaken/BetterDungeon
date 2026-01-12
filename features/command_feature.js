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

    // Apply sprite theming for non-Dynamic themes
    // Command uses See's end-cap structure, and we convert See to middle button
    this.applySpriteTheming(cleanButton, seeButton || storyButton);
    
    // Convert See button to use middle button sprite (since Command is now the last button)
    if (seeButton) {
      this.convertToMiddleButton(seeButton, storyButton);
    }
  }

  convertToMiddleButton(targetButton, referenceMiddleButton) {
    if (!targetButton || !referenceMiddleButton) return;

    setTimeout(() => {
      const refSpriteWrapper = referenceMiddleButton.querySelector('div[style*="position: absolute"]');
      if (!refSpriteWrapper) return;

      const refSpriteContainer = refSpriteWrapper.querySelector('div[class*="_ox-hidden"]');
      if (!refSpriteContainer) return;

      const containerStyle = window.getComputedStyle(refSpriteContainer);
      if (parseFloat(containerStyle.width) === 0) return; // Dynamic theme

      const targetSpriteWrapper = targetButton.querySelector('div[style*="position: absolute"]');
      if (!targetSpriteWrapper) return;

      const targetButtonWidth = targetButton.getBoundingClientRect().width;
      const refButtonWidth = referenceMiddleButton.getBoundingClientRect().width;

      if (targetButtonWidth === 0 || refButtonWidth === 0) return;

      // Clear and clone from reference
      while (targetSpriteWrapper.firstChild) {
        targetSpriteWrapper.removeChild(targetSpriteWrapper.firstChild);
      }

      Array.from(refSpriteWrapper.children).forEach(child => {
        targetSpriteWrapper.appendChild(child.cloneNode(true));
      });

      targetSpriteWrapper.style.justifyContent = window.getComputedStyle(refSpriteWrapper).justifyContent;
      targetSpriteWrapper.style.margin = '0';
      targetSpriteWrapper.style.padding = '0';

      // Ensure all cloned containers have no margin
      targetSpriteWrapper.querySelectorAll('div').forEach(div => {
        div.style.margin = '0';
      });

      // Ensure the sprite container fills the button width (middle button = single container)
      const spriteContainers = targetSpriteWrapper.querySelectorAll('div[class*="_ox-hidden"]');
      if (spriteContainers.length === 1) {
        spriteContainers[0].style.width = `${targetButtonWidth}px`;
      }

      // Adjust for width difference
      const widthDiff = targetButtonWidth - refButtonWidth;
      if (Math.abs(widthDiff) > 1) {
        const containers = targetSpriteWrapper.querySelectorAll('div[class*="_ox-hidden"]');
        const refContainers = refSpriteWrapper.querySelectorAll('div[class*="_ox-hidden"]');

        containers.forEach((container, index) => {
          const refContainer = refContainers[index];
          if (!refContainer) return;

          const refWidth = parseFloat(window.getComputedStyle(refContainer).width);
          if (refWidth > 20) {
            const newWidth = refWidth + widthDiff;
            container.style.width = `${newWidth}px`;

            const positioner = container.querySelector('.css-175oi2r');
            if (positioner && positioner.style.width) {
              const scale = newWidth / refWidth;
              positioner.style.width = `${parseFloat(positioner.style.width) * scale}px`;
              positioner.style.left = `${parseFloat(positioner.style.left || 0) * scale}px`;
            }
          }
        });
      }

      // Add hover handling for See button (smaller, needs different offset)
      this.addHoverHandling(targetButton, -180);

      console.log('CommandFeature: Converted See button to middle sprite');
    }, 100);
  }

  applySpriteTheming(customButton, referenceButton) {
    if (!customButton || !referenceButton) return;

    // Wait for button to be in DOM and rendered
    setTimeout(() => {
      // Find sprite wrapper in reference button
      const refSpriteWrapper = referenceButton.querySelector('div[style*="position: absolute"]');
      if (!refSpriteWrapper) return;

      // Check if the wrapper has actual sprite content (for sprite-based themes)
      const refSpriteContainer = refSpriteWrapper.querySelector('div[class*="_ox-hidden"]');
      if (!refSpriteContainer) return;

      // Check if this is a sprite theme by looking at container dimensions
      const containerStyle = window.getComputedStyle(refSpriteContainer);
      if (parseFloat(containerStyle.width) === 0) return; // Dynamic theme, no sprites

      // Find sprite wrapper in custom button
      const customSpriteWrapper = customButton.querySelector('div[style*="position: absolute"]');
      if (!customSpriteWrapper) return;

      // Get button dimensions
      const customButtonWidth = customButton.getBoundingClientRect().width;
      const refButtonWidth = referenceButton.getBoundingClientRect().width;
      
      if (customButtonWidth === 0 || refButtonWidth === 0) return;

      // Deep clone the entire reference sprite wrapper content
      while (customSpriteWrapper.firstChild) {
        customSpriteWrapper.removeChild(customSpriteWrapper.firstChild);
      }
      
      // Clone each child node from reference
      Array.from(refSpriteWrapper.children).forEach(child => {
        const clonedChild = child.cloneNode(true);
        customSpriteWrapper.appendChild(clonedChild);
      });

      // Copy wrapper styles and ensure no gaps
      customSpriteWrapper.style.justifyContent = window.getComputedStyle(refSpriteWrapper).justifyContent;
      customSpriteWrapper.style.margin = '0';
      customSpriteWrapper.style.padding = '0';

      // Ensure all cloned containers have no margin and correct dimensions
      customSpriteWrapper.querySelectorAll('div').forEach(div => {
        div.style.margin = '0';
      });

      // Handle 3-part end cap structure for Command button
      const spriteContainers = customSpriteWrapper.querySelectorAll(':scope > div[class*="_ox-hidden"]');
      if (spriteContainers.length === 3) {
        // End button structure: left cap, middle, right cap
        // Get the original widths from reference
        const refContainers = refSpriteWrapper.querySelectorAll(':scope > div[class*="_ox-hidden"]');
        const leftCapWidth = parseFloat(window.getComputedStyle(refContainers[0]).width);
        const rightCapWidth = parseFloat(window.getComputedStyle(refContainers[2]).width);
        
        // Calculate middle width to fill the remaining space
        const middleWidth = customButtonWidth - leftCapWidth - rightCapWidth;
        spriteContainers[1].style.width = `${middleWidth}px`;
        
        // Scale the inner positioner of the middle section
        const refMiddleWidth = parseFloat(window.getComputedStyle(refContainers[1]).width);
        const positioner = spriteContainers[1].querySelector('.css-175oi2r');
        if (positioner && positioner.style.width && refMiddleWidth > 0) {
          const scale = middleWidth / refMiddleWidth;
          positioner.style.width = `${parseFloat(positioner.style.width) * scale}px`;
          positioner.style.left = `${parseFloat(positioner.style.left || 0) * scale}px`;
        }
      } else if (spriteContainers.length === 1) {
        spriteContainers[0].style.width = `${customButtonWidth}px`;
      }

      // Add hover handling for Command button (3-part structure needs special handling)
      this.addEndCapHoverHandling(customButton);

      console.log('CommandFeature: Applied sprite theming');
    }, 100);
  }

  addEndCapHoverHandling(button) {
    if (!button || button.dataset.hoverHandled) return;
    button.dataset.hoverHandled = 'true';

    const spriteWrapper = button.querySelector('div[style*="position: absolute"]');
    if (!spriteWrapper) return;

    // Get the 3 sprite containers (left cap, middle, right cap)
    const containers = spriteWrapper.querySelectorAll(':scope > div[class*="_ox-hidden"]');
    if (containers.length !== 3) {
      // Fallback to standard hover handling
      const positioner = spriteWrapper.querySelector('.css-175oi2r[style*="left"]');
      if (!positioner) return;
      
      const originalLeft = parseFloat(positioner.style.left) || 0;
      
      button.addEventListener('mouseenter', () => {
        positioner.style.left = `${originalLeft - 240}px`;
      });
      
      button.addEventListener('mouseleave', () => {
        positioner.style.left = `${originalLeft}px`;
      });
      return;
    }

    // Store original left values for each container's positioner
    const positioners = [];
    const originalLefts = [];
    containers.forEach(container => {
      const positioner = container.querySelector('.css-175oi2r[style*="left"]');
      if (positioner) {
        positioners.push(positioner);
        originalLefts.push(parseFloat(positioner.style.left) || 0);
      }
    });

    // Different offsets for each part: left cap, middle, right cap
    // Caps are smaller so need smaller offset
    const hoverOffsets = [0, -200, 0];

    button.addEventListener('mouseenter', () => {
      positioners.forEach((p, i) => {
        if (p && originalLefts[i] !== undefined) {
          p.style.left = `${originalLefts[i] + hoverOffsets[i]}px`;
        }
      });
    });

    button.addEventListener('mouseleave', () => {
      positioners.forEach((p, i) => {
        if (p && originalLefts[i] !== undefined) {
          p.style.left = `${originalLefts[i]}px`;
        }
      });
    });
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
