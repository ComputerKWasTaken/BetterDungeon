// BetterDungeon - Attempt Input Feature
// Adds an "Attempt" input mode that uses RNG to determine success/failure

class AttemptFeature {
  static id = 'attempt';

  constructor() {
    this.observer = null;
    this.attemptButton = null;
    this.isAttemptMode = false;
    this.boundKeyHandler = null;
    this.submitClickHandler = null;
    this.modeChangeHandler = null;
    this.criticalChance = 5; // Default 5%
    this.pendingAttemptText = null; // Track the attempt text we're waiting for
    this.actionIconObserver = null; // Observer for updating action icons
    this.weight = 0; // Weight modifier: -5 (harder) to +5 (easier)
    this.weightKeyHandler = null; // Handler for Up/Down arrow keys
  }

  init() {
    console.log('AttemptFeature: Initializing...');
    this.loadSettings();
    this.setupObserver();
    this.injectAttemptButton();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.actionIconObserver) {
      this.actionIconObserver.disconnect();
      this.actionIconObserver = null;
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
    if (this.weightKeyHandler) {
      document.removeEventListener('keydown', this.weightKeyHandler, true);
      this.weightKeyHandler = null;
    }
    this.removeAttemptButton();
    this.restoreModeDisplay();
    this.isAttemptMode = false;
    this.pendingAttemptText = null;
    this.weight = 0;
  }

  loadSettings() {
    // Load critical chance from storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get('betterDungeonSettings', (result) => {
        const settings = result.betterDungeonSettings || {};
        this.criticalChance = settings.attemptCriticalChance ?? 5;
      });

      // Listen for settings changes
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.betterDungeonSettings) {
          const newSettings = changes.betterDungeonSettings.newValue || {};
          this.criticalChance = newSettings.attemptCriticalChance ?? 5;
        }
      });
    }
  }

  setupObserver() {
    this.observer = new MutationObserver((mutations) => {
      this.injectAttemptButton();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  findInputModeMenu() {
    // Find the input mode menu by looking for the container with the mode buttons
    const doButton = document.querySelector('[aria-label="Set to \'Do\' mode"]');
    if (doButton) {
      return doButton.parentElement;
    }
    return null;
  }

  injectAttemptButton() {
    const menu = this.findInputModeMenu();
    if (!menu) return;

    // Find the reference buttons for positioning
    const doButton = menu.querySelector('[aria-label="Set to \'Do\' mode"]');
    if (!doButton) return;
    const sayButton = menu.querySelector('[aria-label="Set to \'Say\' mode"]');

    // Check if we already added the button
    const existingButton = menu.querySelector('[aria-label="Set to \'Attempt\' mode"]');
    if (existingButton) {
      // Verify it's in the correct position (should be between Do and Say)
      // Correct position: doButton -> attemptButton -> sayButton
      if (existingButton.previousElementSibling === doButton) {
        return; // Already in correct position
      }
      // Wrong position - remove and re-add
      existingButton.remove();
    }

    // Clone the Do button as a template
    const attemptButton = doButton.cloneNode(true);
    
    // Update aria-label
    attemptButton.setAttribute('aria-label', "Set to 'Attempt' mode");
    
    // Update the icon text - use controller icon (w_controller)
    const iconElement = attemptButton.querySelector('.font_icons');
    if (iconElement) {
      iconElement.textContent = 'w_controller'; // Using controller icon
    }
    
    // Update the label text
    const labelElement = attemptButton.querySelector('.font_body');
    if (labelElement) {
      labelElement.textContent = 'Attempt';
    }

    // Remove any existing click handlers by cloning without event listeners
    const cleanButton = attemptButton.cloneNode(true);
    
    // Add our click handler
    cleanButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.activateAttemptMode();
    });

    // Insert the button after the Do button (between Do and Say)
    if (sayButton) {
      menu.insertBefore(cleanButton, sayButton);
    } else if (doButton.nextSibling) {
      menu.insertBefore(cleanButton, doButton.nextSibling);
    } else {
      menu.appendChild(cleanButton);
    }

    this.attemptButton = cleanButton;

    // Apply sprite theming for non-Dynamic themes
    this.applySpriteTheming(cleanButton, sayButton || doButton);
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

      // Ensure the sprite containers fill the button width
      const spriteContainers = customSpriteWrapper.querySelectorAll('div[class*="_ox-hidden"]');
      if (spriteContainers.length === 1) {
        // Middle button - single container should match button width
        spriteContainers[0].style.width = `${customButtonWidth}px`;
      }

      // Adjust the middle section width if button sizes differ
      const widthDiff = customButtonWidth - refButtonWidth;
      if (Math.abs(widthDiff) > 1) {
        const customContainers = customSpriteWrapper.querySelectorAll('div[class*="_ox-hidden"]');
        const refContainers = refSpriteWrapper.querySelectorAll('div[class*="_ox-hidden"]');
        
        customContainers.forEach((container, index) => {
          const refContainer = refContainers[index];
          if (!refContainer) return;

          const refWidth = parseFloat(window.getComputedStyle(refContainer).width);
          
          // Only scale non-end-cap containers (width > 20px)
          if (refWidth > 20) {
            const newWidth = refWidth + widthDiff;
            container.style.width = `${newWidth}px`;
            
            // Also scale the inner positioner
            const positioner = container.querySelector('.css-175oi2r');
            if (positioner && positioner.style.width) {
              const posWidth = parseFloat(positioner.style.width);
              const posLeft = parseFloat(positioner.style.left) || 0;
              const scale = newWidth / refWidth;
              positioner.style.width = `${posWidth * scale}px`;
              positioner.style.left = `${posLeft * scale}px`;
            }
          }
        });
      }

      // Add hover handling for the custom button
      this.addHoverHandling(customButton);

    }, 100);
  }

  addHoverHandling(button) {
    if (!button || button.dataset.hoverHandled) return;
    button.dataset.hoverHandled = 'true';

    const spriteWrapper = button.querySelector('div[style*="position: absolute"]');
    if (!spriteWrapper) return;

    // Find all positioner elements that have a left style
    const getPositioners = () => spriteWrapper.querySelectorAll('.css-175oi2r[style*="left"]');

    // Store original left values
    const positioners = getPositioners();
    const originalLefts = [];
    positioners.forEach(p => {
      originalLefts.push(parseFloat(p.style.left) || 0);
    });

    // Hover offset - hover sprite is to the RIGHT, so shift LEFT (more negative)
    const hoverOffset = -250;

    button.addEventListener('mouseenter', () => {
      const ps = getPositioners();
      ps.forEach((p, i) => {
        const origLeft = originalLefts[i] !== undefined ? originalLefts[i] : parseFloat(p.style.left) || 0;
        p.style.left = `${origLeft + hoverOffset}px`;
      });
    });

    button.addEventListener('mouseleave', () => {
      const ps = getPositioners();
      ps.forEach((p, i) => {
        if (originalLefts[i] !== undefined) {
          p.style.left = `${originalLefts[i]}px`;
        }
      });
    });
  }

  removeAttemptButton() {
    const button = document.querySelector('[aria-label="Set to \'Attempt\' mode"]');
    if (button) {
      button.remove();
    }
    this.attemptButton = null;
  }

  activateAttemptMode() {
    this.isAttemptMode = true;

    // Click the Do button first to set the base mode (action text, not story text)
    const doButton = document.querySelector('[aria-label="Set to \'Do\' mode"]');
    if (doButton) {
      doButton.click();
    }

    // Close the menu by clicking the back arrow
    setTimeout(() => {
      const closeButton = document.querySelector('[aria-label="Close \'Input Mode\' menu"]');
      if (closeButton) {
        closeButton.click();
      }
      
      // After menu closes, update the UI to show "Attempt" mode
      setTimeout(() => {
        this.updateModeDisplay();
        
        // Show first-use hint
        this.showFirstUseHint();
      }, 50);
    }, 50);

    // Setup interception for the next submission
    this.setupSubmitInterception();
    
    // Setup weight adjustment keys (Up/Down arrows)
    this.setupWeightKeyHandler();
    
    // Watch for mode changes (user clicking on input mode button)
    this.watchForModeChanges();
  }

  showFirstUseHint() {
    // Hint service removed - tutorial covers this
  }

  setupWeightKeyHandler() {
    // Clean up any existing handler
    if (this.weightKeyHandler) {
      document.removeEventListener('keydown', this.weightKeyHandler, true);
    }

    const handleWeightKey = (e) => {
      if (!this.isAttemptMode) return;
      
      const textarea = document.querySelector('#game-text-input');
      if (!textarea || document.activeElement !== textarea) return;
      
      // Only handle Up/Down arrows
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.adjustWeight(1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.adjustWeight(-1);
      }
    };

    this.weightKeyHandler = handleWeightKey;
    document.addEventListener('keydown', handleWeightKey, true);
  }

  adjustWeight(delta) {
    const oldWeight = this.weight;
    this.weight = Math.max(-5, Math.min(5, this.weight + delta));
    
    if (this.weight !== oldWeight) {
      this.updatePlaceholderWithWeight();
    }
  }

  getWeightLabel() {
    if (this.weight === 0) return '';
    if (this.weight > 0) return ` [+${this.weight} Advantage]`;
    return ` [${this.weight} Disadvantage]`;
  }

  updatePlaceholderWithWeight() {
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      const baseText = 'What do you attempt to do?';
      const weightLabel = this.getWeightLabel();
      const hint = this.weight === 0 ? ' (↑↓ with arrow keys to adjust odds)' : '';
      textarea.placeholder = baseText + weightLabel + hint;
    }
  }

  watchForModeChanges() {
    // Clean up any existing handler
    if (this.modeChangeHandler) {
      document.removeEventListener('click', this.modeChangeHandler, true);
    }

    // Watch for clicks on the "Change input mode" button or any mode selection
    const handleModeChange = (e) => {
      if (!this.isAttemptMode) return;

      const target = e.target.closest('[aria-label]');
      if (!target) return;

      const ariaLabel = target.getAttribute('aria-label') || '';
      
      // If user clicks "Change input mode" or selects a different mode, cancel attempt mode
      if (ariaLabel === 'Change input mode' ||
          ariaLabel.startsWith("Set to '") && !ariaLabel.includes("Attempt")) {
        this.deactivateAttemptMode();
      }
    };

    document.addEventListener('click', handleModeChange, true);
    
    // Store reference for cleanup
    this.modeChangeHandler = handleModeChange;
  }

  updateModeDisplay() {
    // Update the current input mode button text from "do" to "attempt"
    const modeButton = document.querySelector('[aria-label="Change input mode"]');
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText && modeText.textContent.toLowerCase() === 'do') {
        modeText.textContent = 'attempt';
      }
      
      // Update the icon to w_controller
      const iconElement = modeButton.querySelector('.font_icons');
      if (iconElement && iconElement.textContent === 'w_run') {
        iconElement.textContent = 'w_controller';
      }
    }

    // Update the placeholder text with weight info
    this.updatePlaceholderWithWeight();

    // Update the send button icon
    const submitButton = document.querySelector('[aria-label="Submit action"]');
    if (submitButton) {
      const iconElement = submitButton.querySelector('.font_icons');
      if (iconElement && iconElement.textContent === 'w_run') {
        iconElement.textContent = 'w_controller';
      }
    }
  }

  restoreModeDisplay() {
    // Restore the original mode text
    const modeButton = document.querySelector('[aria-label="Change input mode"]');
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText && modeText.textContent.toLowerCase() === 'attempt') {
        modeText.textContent = 'do';
      }
      
      // Restore the icon
      const iconElement = modeButton.querySelector('.font_icons');
      if (iconElement && iconElement.textContent === 'w_controller') {
        iconElement.textContent = 'w_run';
      }
    }

    // Restore the placeholder text
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      textarea.placeholder = 'What do you do?';
      textarea.setAttribute('data-placeholder', 'What do you do?');
    }

    // Restore the send button icon
    const submitButton = document.querySelector('[aria-label="Submit action"]');
    if (submitButton) {
      const iconElement = submitButton.querySelector('.font_icons');
      if (iconElement && iconElement.textContent === 'w_controller') {
        iconElement.textContent = 'w_run';
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
      if (!this.isAttemptMode) {
        document.removeEventListener('keydown', handleKeyDown, true);
        return;
      }

      // Check for Enter without Shift (submit)
      if (e.key === 'Enter' && !e.shiftKey) {
        const textarea = document.querySelector('#game-text-input');
        if (textarea && e.target === textarea) {
          const content = textarea.value || '';
          
          if (content.trim()) {
            // Format the content as an attempt with RNG result
            const formattedContent = this.formatAsAttempt(content);
            textarea.value = formattedContent;
            
            // Trigger input event so React picks up the change
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Watch for the new action element to appear and update its icon
            this.watchForAttemptAction(formattedContent);
            
            // Reset attempt mode after submission
            this.deactivateAttemptMode();
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
      if (!this.isAttemptMode) return;
      
      // Check if the click is on the submit button
      const submitButton = e.target.closest('[aria-label="Submit action"]');
      if (!submitButton) return;

      const textarea = document.querySelector('#game-text-input');
      if (textarea) {
        const content = textarea.value || '';
        if (content.trim()) {
          // Format the content as an attempt with RNG result
          const formattedContent = this.formatAsAttempt(content);
          textarea.value = formattedContent;
          
          // Trigger input event so React picks up the change
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Watch for the new action element to appear and update its icon
          this.watchForAttemptAction(formattedContent);
          
          // Reset attempt mode after submission
          this.deactivateAttemptMode();
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
    this.autoCleanupTimer = setTimeout(() => {
      if (this.isAttemptMode) {
        const textarea = document.querySelector('#game-text-input');
        const isUserTyping = textarea && (document.activeElement === textarea || textarea.value.trim().length > 0);
        const isInStorySection = document.querySelector('#gameplay-output') !== null;
        
        // Don't auto-deactivate if user is actively typing or has content in the input
        if (!isUserTyping && isInStorySection) {
          this.deactivateAttemptMode();
        } else if (this.isAttemptMode) {
          // Reschedule check if user is still active
          this.autoCleanupTimer = setTimeout(() => {
            if (this.isAttemptMode) {
              this.deactivateAttemptMode();
            }
          }, 30000);
        }
      }
    }, 30000);
  }

  deactivateAttemptMode() {
    this.isAttemptMode = false;
    this.restoreModeDisplay();
    
    // Clean up auto-cleanup timer
    if (this.autoCleanupTimer) {
      clearTimeout(this.autoCleanupTimer);
      this.autoCleanupTimer = null;
    }
    
    // Reset weight for next attempt
    this.weight = 0;
    
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
    if (this.weightKeyHandler) {
      document.removeEventListener('keydown', this.weightKeyHandler, true);
      this.weightKeyHandler = null;
    }
  }

  rollOutcome() {
    // Roll a random number between 0 and 100
    const roll = Math.random() * 100;
    
    // Weight shifts the success threshold by 5% per level
    // Weight -5: 25% threshold (harder), Weight +5: 75% threshold (easier)
    const baseThreshold = 50;
    const weightShift = this.weight * 5; // Each weight level = 5% shift
    const successThreshold = baseThreshold - weightShift;
    
    // Critical zones are at the extremes
    // Critical fail: 0 to criticalChance%
    // Fail: criticalChance% to successThreshold%
    // Succeed: successThreshold% to (100 - criticalChance)%
    // Critical succeed: (100 - criticalChance)% to 100%
    
    if (roll < this.criticalChance) {
      return 'critically fail';
    } else if (roll < successThreshold) {
      return 'fail';
    } else if (roll < (100 - this.criticalChance)) {
      return 'succeed';
    } else {
      return 'critically succeed';
    }
  }

  watchForAttemptAction(attemptText) {
    // Store the text we're looking for (partial match since AI Dungeon may modify it)
    this.pendingAttemptText = attemptText.toLowerCase().substring(0, 30);
    
    // Clean up any existing observer
    if (this.actionIconObserver) {
      this.actionIconObserver.disconnect();
    }
    
    // Count existing action elements so we can detect new ones
    const existingActionCount = document.querySelectorAll('#action-text').length;
    
    // Create observer to watch for new action elements
    this.actionIconObserver = new MutationObserver((mutations) => {
      // Look for new action-text elements
      const actionTexts = document.querySelectorAll('#action-text');
      
      if (actionTexts.length > existingActionCount) {
        // New action element appeared - check if it's our attempt
        const latestAction = actionTexts[actionTexts.length - 1];
        const actionContent = latestAction.textContent?.toLowerCase() || '';
        
        // Check if this action contains our attempt text
        if (actionContent.includes('attempt to') || 
            (this.pendingAttemptText && actionContent.includes(this.pendingAttemptText.substring(0, 15)))) {
          
          // Find the action icon in the parent container
          const actionContainer = latestAction.closest('.is_Row, [id="transition-opacity"]');
          if (actionContainer) {
            const iconElement = actionContainer.querySelector('#action-icon');
            if (iconElement && iconElement.textContent === 'w_run') {
              iconElement.textContent = 'w_controller';
            }
          }
          
          // Clean up
          this.pendingAttemptText = null;
          this.actionIconObserver.disconnect();
          this.actionIconObserver = null;
        }
      }
    });
    
    // Start observing
    const storyOutput = document.querySelector('#gameplay-output') || document.body;
    this.actionIconObserver.observe(storyOutput, {
      childList: true,
      subtree: true
    });
    
    // Auto-cleanup after 30 seconds if action never appears
    setTimeout(() => {
      if (this.actionIconObserver) {
        this.actionIconObserver.disconnect();
        this.actionIconObserver = null;
        this.pendingAttemptText = null;
      }
    }, 30000);
  }

  formatAsAttempt(content) {
    // Clean up the content - remove leading "I " or "You " if present
    let action = content.trim();
    
    // Remove common prefixes that would make the sentence awkward
    const prefixPatterns = [
      /^(I\s+)/i,
      /^(You\s+)/i,
      /^(to\s+)/i,
      /^(attempt\s+to\s+)/i,
      /^(try\s+to\s+)/i
    ];
    
    for (const pattern of prefixPatterns) {
      action = action.replace(pattern, '');
    }
    
    // Ensure the action starts lowercase (since it follows "attempt to")
    if (action.length > 0) {
      action = action.charAt(0).toLowerCase() + action.slice(1);
    }
    
    // Remove trailing punctuation
    action = action.replace(/[.!?]+$/, '');
    
    // Roll for the outcome
    const outcome = this.rollOutcome();
    
    // Format: "You attempt to [action], you [result]."
    return `attempt to ${action}, you ${outcome}.`;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.AttemptFeature = AttemptFeature;
}
