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
    this.autoDeleteEnabled = false;
    this.pendingCommandDelete = null;
    this.responseObserver = null;
  }

  init() {
    console.log('[Command] Initializing Command feature...');
    this.setupObserver();
    this.injectCommandButton();
    this.loadAutoDeleteSetting();
    this.setupMessageListener();
  }

  loadAutoDeleteSetting() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get('betterDungeon_commandAutoDelete', (result) => {
        this.autoDeleteEnabled = result.betterDungeon_commandAutoDelete ?? false;
      });
    }
  }

  setupMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'SET_COMMAND_AUTO_DELETE') {
          this.autoDeleteEnabled = message.enabled;
          sendResponse({ success: true });
        }
        return false;
      });
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.responseObserver) {
      this.responseObserver.disconnect();
      this.responseObserver = null;
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

    // Find reference buttons for positioning
    const storyButton = menu.querySelector('[aria-label="Set to \'Story\' mode"]');
    if (!storyButton) return;
    const seeButton = menu.querySelector('[aria-label="Set to \'See\' mode"]');

    // Check if we already added the button
    const existingButton = menu.querySelector('[aria-label="Set to \'Command\' mode"]');
    if (existingButton) {
      // Verify it's in the correct position (should be after See, at the end)
      // Correct position: seeButton -> commandButton (last)
      if (seeButton && existingButton.previousElementSibling === seeButton && !existingButton.nextElementSibling) {
        return; // Already in correct position
      }
      // Wrong position - remove and re-add
      existingButton.remove();
    }

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

    }, 100);
  }

  addHoverHandling(button, hoverOffset = -180) {
    if (!button || button.dataset.hoverHandled) return;
    button.dataset.hoverHandled = 'true';

    const spriteWrapper = button.querySelector('div[style*="position: absolute"]');
    if (!spriteWrapper) return;

    const positioner = spriteWrapper.querySelector('.css-175oi2r[style*="left"]');
    if (!positioner) return;

    const originalLeft = parseFloat(positioner.style.left) || 0;

    button.addEventListener('mouseenter', () => {
      positioner.style.left = `${originalLeft + hoverOffset}px`;
    });

    button.addEventListener('mouseleave', () => {
      positioner.style.left = `${originalLeft}px`;
    });
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
        
        // Show first-use hint
        this.showFirstUseHint();
      }, 50);
    }, 50);

    // Setup interception for the next submission
    this.setupSubmitInterception();
    
    // Watch for mode changes (user clicking on input mode button)
    this.watchForModeChanges();
  }

  showFirstUseHint() {
    // Hint service removed - tutorial covers this
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
            
            // Schedule deletion if auto-delete is enabled
            this.scheduleCommandDeletion(formattedContent.trim());
            
            // Reset command mode after submission
            this.deactivateCommandMode();
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
          
          // Schedule deletion if auto-delete is enabled
          this.scheduleCommandDeletion(formattedContent.trim());
          
          // Reset command mode after submission
          this.deactivateCommandMode();
        }
      }
    };

    // Store reference and add listener
    if (this.submitClickHandler) {
      document.removeEventListener('click', this.submitClickHandler, true);
    }
    this.submitClickHandler = handleClick;
    document.addEventListener('click', handleClick, true);
    
    // Auto-cleanup after 30 seconds, but only if user isn't actively using the input
    this.scheduleAutoCleanup();
  }

  scheduleAutoCleanup() {
    if (this.autoCleanupTimer) {
      clearTimeout(this.autoCleanupTimer);
    }
    
    this.autoCleanupTimer = setTimeout(() => {
      if (!this.isCommandMode) return;
      
      const textarea = document.querySelector('#game-text-input');
      const isUserTyping = textarea && (document.activeElement === textarea || textarea.value.trim().length > 0);
      const isInStorySection = document.querySelector('#gameplay-output') !== null;
      
      // Don't auto-deactivate if user is actively typing, has content, or is not in story section
      if (isUserTyping || !isInStorySection) {
        // Reschedule check - user is still active or not in story section
        this.scheduleAutoCleanup();
      } else {
        this.deactivateCommandMode();
      }
    }, 30000);
  }

  deactivateCommandMode() {
    this.isCommandMode = false;
    this.restoreModeDisplay();
    
    // Clean up auto-cleanup timer
    if (this.autoCleanupTimer) {
      clearTimeout(this.autoCleanupTimer);
      this.autoCleanupTimer = null;
    }
    
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
    // Format: [ ## User Input: ]
    const cleanedContent = content
      .replace(/^[\s#]+/, '')  // Remove leading whitespace and # characters
      .replace(/[\s.?!:]+$/, ''); // Remove trailing punctuation and whitespace
    
    return `\n\n[ ## ${cleanedContent}: ]\n\n`;
  }

  scheduleCommandDeletion(commandText) {
    if (!this.autoDeleteEnabled) return;
    
    this.pendingCommandDelete = commandText;
    this.watchForResponseCompletion();
  }

  watchForResponseCompletion() {
    if (this.responseObserver) {
      this.responseObserver.disconnect();
    }

    const storyOutput = document.querySelector('#gameplay-output');
    if (!storyOutput) return;

    let responseStarted = false;
    let stabilityTimer = null;

    this.responseObserver = new MutationObserver((mutations) => {
      // Check if new content is being added (AI is responding)
      const hasNewContent = mutations.some(m => 
        m.addedNodes.length > 0 || 
        (m.type === 'characterData' && m.target.textContent)
      );

      if (hasNewContent) {
        responseStarted = true;
        
        // Reset stability timer - wait for response to stabilize
        if (stabilityTimer) clearTimeout(stabilityTimer);
        
        stabilityTimer = setTimeout(() => {
          this.deleteCommandFromStory();
          
          // Clean up
          if (this.responseObserver) {
            this.responseObserver.disconnect();
            this.responseObserver = null;
          }
          this.pendingCommandDelete = null;
        }, 2000); // Wait 2 seconds of no changes
      }
    });

    this.responseObserver.observe(storyOutput, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Timeout after 60 seconds if no response
    setTimeout(() => {
      if (this.responseObserver) {
        this.responseObserver.disconnect();
        this.responseObserver = null;
      }
      this.pendingCommandDelete = null;
    }, 60000);
  }

  deleteCommandFromStory() {
    if (!this.pendingCommandDelete) return;

    const storyOutput = document.querySelector('#gameplay-output');
    if (!storyOutput) return;

    const commandPattern = this.pendingCommandDelete;
    const allSpans = storyOutput.querySelectorAll('span[id="transition-opacity"]');
    
    for (const span of allSpans) {
      const text = span.textContent || '';
      if (text.includes(commandPattern)) {
        span.click();
        setTimeout(() => this.clearAndSaveEdit(), 500);
        break;
      }
    }
  }

  clearAndSaveEdit() {
    const allTextareas = document.querySelectorAll('textarea');
    
    // Find the edit textarea (not the main game input)
    for (const textarea of allTextareas) {
      if (textarea.id === 'game-text-input') continue;
      this.clearTextareaAndSave(textarea);
      return;
    }

    // Fallback: check for contenteditable elements
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const editable of editables) {
      const searchText = this.pendingCommandDelete?.trim();
      if (searchText && editable.textContent.includes(searchText)) {
        this.clearContentEditableAndSave(editable);
        return;
      }
    }
  }

  clearTextareaAndSave(textarea) {
    textarea.focus();
    textarea.select();
    // Replace with two newlines for better formatting
    textarea.value = '\n\n';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    setTimeout(() => this.clickOutsideToClose(), 200);
  }

  clearContentEditableAndSave(element) {
    // Select all content and delete
    element.focus();
    
    // Select all text
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    
    // Delete the content
    document.execCommand('delete', false, null);
    
    // Dispatch events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Click outside to close edit field
    setTimeout(() => this.clickOutsideToClose(), 200);
  }

  clearInputAndSave(input) {
    input.focus();
    input.select();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Click outside to close edit field
    setTimeout(() => this.clickOutsideToClose(), 200);
  }

  clickOutsideToClose() {
    // Press Escape to close any popup
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true
    }));
    
    // Blur and click outside as backup
    setTimeout(() => {
      document.activeElement?.blur();
      const outsideTarget = document.querySelector('header') ||
                            document.querySelector('nav') ||
                            document.querySelector('[class*="sidebar"]') ||
                            document.body;
      if (outsideTarget) outsideTarget.click();
    }, 100);
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.CommandFeature = CommandFeature;
}
