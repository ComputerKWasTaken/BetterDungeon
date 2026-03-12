// BetterDungeon - Try Input Feature
// Adds a "Try" input mode that uses RNG to determine success/failure

class TryFeature {
  static id = 'try';

  constructor() {
    this.observer = null;
    this.tryButton = null;
    this.isTryMode = false;
    this.boundKeyHandler = null;
    this.submitClickHandler = null;
    this.modeChangeHandler = null;
    this.criticalChance = 5; // Default 5%
    this.pendingTryText = null; // Track the try text we're waiting for
    this.actionIconObserver = null; // Observer for updating action icons
    this.weight = 0; // Weight modifier: -9 (5% success) to +9 (95% success)
    this.weightKeyHandler = null; // Handler for Up/Down arrow keys
    this.successBar = null; // The visible success chance bar element
    this.debug = false;

    // Outcome phrase pools for variety
    this.phrases = {
      crit_success: [
        'succeed beyond expectations',
        'achieve it perfectly',
        'pull it off with incredible style',
        'succeed spectacularly',
        'masterfully succeed'
      ],
      success: [
        'manage to do it',
        'are successful',
        'pull it off',
        'succeed',
        'make it happen'
      ],
      failure: [
        'can\'t quite manage it',
        'fall short',
        'don\'t succeed',
        'fail',
        'falter'
      ],
      crit_fail: [
        'fail catastrophically',
        'make a complete mess of it',
        'fail in the worst way possible',
        'fail miserably',
        'suffer a disastrous failure'
      ]
    };

    // Sentence templates for variety
    // {action} = the user's action
    // {outcome} = the result phrase (usually bolded)
    // {connector} = 'and' or 'but'
    this.templates = [
      'try to {action}, {connector} you {outcome}.',
      'In an attempt to {action}, you {outcome}.',
      'You {outcome} in your attempt to {action}.',
      '{action}... you {outcome}.'
    ];
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  init() {
    console.log('[Try] Initializing Try feature...');
    this.loadSettings();
    this.setupObserver();
    this.injectTryButton();
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
    this.removeTryButton();
    this.removeSuccessBar();
    this.restoreModeDisplay();
    this.isTryMode = false;
    this.pendingTryText = null;
    this.weight = 0;
  }

  loadSettings() {
    // Load critical chance from storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get('betterDungeonSettings', (result) => {
        const settings = (result || {}).betterDungeonSettings || {};
        this.criticalChance = settings.tryCriticalChance ?? 5;
      });

      // Listen for settings changes
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.betterDungeonSettings) {
          const newSettings = changes.betterDungeonSettings.newValue || {};
          this.criticalChance = newSettings.tryCriticalChance ?? 5;
        }
      });
    }
  }

  setupObserver() {
    this.observer = new MutationObserver((mutations) => {
      this.injectTryButton();
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

  injectTryButton() {
    const menu = this.findInputModeMenu();
    if (!menu) return;

    // Find the reference buttons for positioning
    const doButton = menu.querySelector('[aria-label="Set to \'Do\' mode"]');
    if (!doButton) return;
    const sayButton = menu.querySelector('[aria-label="Set to \'Say\' mode"]');

    // Check if we already added the button
    const existingButton = menu.querySelector('[aria-label="Set to \'Try\' mode"]');
    if (existingButton) {
      // Verify it's in the correct position (should be between Do and Say)
      // Correct position: doButton -> tryButton -> sayButton
      if (existingButton.previousElementSibling === doButton) {
        return; // Already in correct position
      }
      // Wrong position - remove and re-add
      existingButton.remove();
    }

    // Clone the Do button as a template
    const tryButton = doButton.cloneNode(true);
    
    // Update aria-label
    tryButton.setAttribute('aria-label', "Set to 'Try' mode");
    
    // Update the icon text - use controller icon (w_controller)
    const iconElement = tryButton.querySelector('.font_icons');
    if (iconElement) {
      iconElement.textContent = 'w_controller'; // Using controller icon
    }
    
    // Update the label text
    const labelElement = tryButton.querySelector('.font_body');
    if (labelElement) {
      labelElement.textContent = 'Try';
    }

    // Remove any existing click handlers by cloning without event listeners
    const cleanButton = tryButton.cloneNode(true);
    
    // Add our click handler
    cleanButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.activateTryMode();
    });

    // Insert the button after the Do button (between Do and Say)
    if (sayButton) {
      menu.insertBefore(cleanButton, sayButton);
    } else if (doButton.nextSibling) {
      menu.insertBefore(cleanButton, doButton.nextSibling);
    } else {
      menu.appendChild(cleanButton);
    }

    this.tryButton = cleanButton;

    // Scale sprite viewport if a sprite theme is active (pass Do as reference
    // in case the clone was created before AI Dungeon populated the sprite)
    this.applySpriteTheming(cleanButton, doButton);
  }

  // Scale the cloned button's sprite viewport to match its rendered width,
  // then wire up hover to shift the sprite to its hover region.
  // If the clone's sprite is empty (cloned before AI Dungeon populated it),
  // we re-clone the sprite content from the reference button.
  applySpriteTheming(customButton, referenceButton) {
    if (!customButton || !referenceButton) return;

    setTimeout(() => {
      // Check the reference button to determine if a sprite theme is active
      const refWrapper = referenceButton.querySelector('div[style*="position: absolute"]');
      if (!refWrapper) return;

      const refViewport = refWrapper.querySelector('div[class*="_ox-hidden"]');
      if (!refViewport) return;

      const refWidth = parseFloat(window.getComputedStyle(refViewport).width);
      if (refWidth === 0) return; // Dynamic theme — no sprites

      // Get our button's sprite wrapper
      const spriteWrapper = customButton.querySelector('div[style*="position: absolute"]');
      if (!spriteWrapper) return;

      let viewport = spriteWrapper.querySelector('div[class*="_ox-hidden"]');
      let srcWidth = viewport ? parseFloat(window.getComputedStyle(viewport).width) : 0;

      // If our sprite is empty (cloned before sprites loaded), clone from reference
      if (srcWidth === 0) {
        while (spriteWrapper.firstChild) spriteWrapper.removeChild(spriteWrapper.firstChild);
        for (const child of refWrapper.children) {
          spriteWrapper.appendChild(child.cloneNode(true));
        }
        spriteWrapper.style.justifyContent = window.getComputedStyle(refWrapper).justifyContent;

        // Re-query the now-populated viewport
        viewport = spriteWrapper.querySelector('div[class*="_ox-hidden"]');
        srcWidth = viewport ? parseFloat(window.getComputedStyle(viewport).width) : 0;
        if (srcWidth === 0) return; // Still empty, bail
      }

      const buttonWidth = customButton.getBoundingClientRect().width;
      if (buttonWidth === 0) return;

      // Scale viewport + positioner if button width differs from source
      if (Math.abs(buttonWidth - srcWidth) >= 1) {
        const scale = buttonWidth / srcWidth;
        viewport.style.width = `${buttonWidth}px`;

        const positioner = viewport.firstElementChild;
        if (positioner?.style) {
          const w = parseFloat(positioner.style.width) || 0;
          const l = parseFloat(positioner.style.left) || 0;
          if (w > 0) {
            positioner.style.width = `${w * scale}px`;
            positioner.style.left = `${l * scale}px`;
          }
        }
      }

      // Wire up hover state (shift sprite to hover region)
      this.addSpriteHover(customButton);
    }, 100);
  }

  // Shift the sprite positioner on hover to reveal the hover-state region.
  // Native buttons displace left by 17/90 of positioner width — a fixed
  // fraction that maps to the horizontal offset between non-hover and hover
  // regions in every AI Dungeon sprite sheet.
  addSpriteHover(button) {
    if (button.dataset.bdSpriteHover) return;
    button.dataset.bdSpriteHover = 'true';

    const spriteWrapper = button.querySelector('div[style*="position: absolute"]');
    if (!spriteWrapper) return;

    const viewport = spriteWrapper.querySelector('div[class*="_ox-hidden"]');
    if (!viewport) return;

    const positioner = viewport.firstElementChild;
    if (!positioner?.style) return;

    const posWidth = parseFloat(positioner.style.width) || 0;
    const restLeft = parseFloat(positioner.style.left) || 0;
    if (posWidth === 0) return;

    // Hover region offset: 17/90 of positioner width (empirically derived)
    const hoverLeft = restLeft - (posWidth * 17 / 90);

    button.addEventListener('mouseenter', () => {
      positioner.style.left = `${hoverLeft}px`;
    });
    button.addEventListener('mouseleave', () => {
      positioner.style.left = `${restLeft}px`;
    });
  }

  removeTryButton() {
    const button = document.querySelector('[aria-label="Set to \'Try\' mode"]');
    if (button) {
      button.remove();
    }
    this.tryButton = null;
  }

  activateTryMode() {
    this.isTryMode = true;

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
      
      // After menu closes, update the UI to show "Try" mode
      setTimeout(() => {
        this.updateModeDisplay();
        this.injectSuccessBar();
        
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
      if (!this.isTryMode) return;
      
      const textarea = document.querySelector('#game-text-input');
      if (!textarea || document.activeElement !== textarea) return;
      
      // Only handle Up/Down arrows (ignore if Ctrl/Cmd is held for input history navigation)
      if (e.ctrlKey || e.metaKey) return;
      
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
    this.weight = Math.max(-9, Math.min(9, this.weight + delta));
    
    if (this.weight !== oldWeight) {
      this.updateSuccessBar();
    }
  }

  getSuccessChance() {
    // Weight shifts the success threshold by 5% per level
    // Weight -9: 5% success, Weight 0: 50% success, Weight +9: 95% success
    const baseChance = 50;
    const weightShift = this.weight * 5;
    return Math.max(5, Math.min(95, baseChance + weightShift));
  }

  injectSuccessBar() {
    this.removeSuccessBar();

    const textarea = document.querySelector('#game-text-input');
    if (!textarea) return;

    // The input row (textarea's parent) has position:absolute and 32px bottom padding
    const inputRow = textarea.parentElement;
    if (!inputRow) return;

    const bar = document.createElement('div');
    bar.id = 'bd-success-bar-container';
    bar.style.cssText = `
      position: absolute;
      bottom: 6px;
      left: 32px;
      right: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 14px;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      font-family: var(--bd-font-family-primary, 'IBM Plex Sans', sans-serif);
      font-size: 11px;
      color: rgba(255, 255, 255, 0.45);
      z-index: 2;
      pointer-events: none;
    `;

    bar.innerHTML = `
      <span style="white-space:nowrap; font-weight:600; font-size:10px; letter-spacing:0.4px; text-transform:uppercase;">Success</span>
      <div style="flex:1; height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
        <div id="bd-success-bar-fill" style="height:100%; border-radius:3px; transition:width .3s cubic-bezier(.4,0,.2,1), background .3s;"></div>
      </div>
      <span id="bd-success-percent" style="min-width:28px; text-align:right; font-weight:700; font-size:12px; font-variant-numeric:tabular-nums; transition:color .3s;"></span>
      <span style="opacity:0.3; font-size:9px;">↑↓</span>
    `;

    inputRow.appendChild(bar);
    this.successBar = bar;
    this.updateSuccessBar();
  }

  updateSuccessBar() {
    const fill = document.querySelector('#bd-success-bar-fill');
    const percentText = document.querySelector('#bd-success-percent');
    if (!fill || !percentText) return;

    const chance = this.getSuccessChance();
    percentText.textContent = `${chance}%`;
    fill.style.width = `${chance}%`;

    // Color gradient: red (low) -> yellow (mid) -> green (high)
    let color;
    if (chance <= 25) {
      color = '#ef4444';
    } else if (chance <= 40) {
      color = '#f97316';
    } else if (chance <= 60) {
      color = '#eab308';
    } else if (chance <= 75) {
      color = '#84cc16';
    } else {
      color = '#22c55e';
    }
    fill.style.background = color;
    // Tint the percentage text to match the bar fill
    percentText.style.color = color;
  }

  removeSuccessBar() {
    const bar = document.querySelector('#bd-success-bar-container');
    if (bar) {
      bar.remove();
    }
    this.successBar = null;
  }

  watchForModeChanges() {
    // Clean up any existing handler
    if (this.modeChangeHandler) {
      document.removeEventListener('click', this.modeChangeHandler, true);
    }

    // Watch for clicks on the "Change input mode" button or any mode selection
    const handleModeChange = (e) => {
      if (!this.isTryMode) return;

      const target = e.target.closest('[aria-label]');
      if (!target) return;

      const ariaLabel = target.getAttribute('aria-label') || '';
      
      // If user clicks "Change input mode" or selects a different mode, cancel try mode
      if (ariaLabel === 'Change input mode' ||
          ariaLabel.startsWith("Set to '") && !ariaLabel.includes("Try")) {
        this.deactivateTryMode();
      }
    };

    document.addEventListener('click', handleModeChange, true);
    
    // Store reference for cleanup
    this.modeChangeHandler = handleModeChange;
  }

  updateModeDisplay() {
    // Update the current input mode button text from "do" to "try"
    const modeButton = document.querySelector('[aria-label="Change input mode"]');
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText && modeText.textContent.toLowerCase() === 'do') {
        modeText.textContent = 'try';
      }
      
      // Update the icon to w_controller
      const iconElement = modeButton.querySelector('.font_icons');
      if (iconElement && iconElement.textContent === 'w_run') {
        iconElement.textContent = 'w_controller';
      }
    }

    // Update the placeholder text
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      textarea.placeholder = 'What do you try to do?';
    }

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
      if (modeText && modeText.textContent.toLowerCase() === 'try') {
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
    
    // Remove success bar
    this.removeSuccessBar();
  }

  setupSubmitInterception() {
    // Intercept Enter key for submission
    this.setupKeyboardListener();
    
    // Intercept click on submit button
    this.setupSubmitButtonListener();
  }

  setupKeyboardListener() {
    const handleKeyDown = (e) => {
      if (!this.isTryMode) {
        document.removeEventListener('keydown', handleKeyDown, true);
        return;
      }

      // Check for Enter without Shift (submit)
      if (e.key === 'Enter' && !e.shiftKey) {
        const textarea = document.querySelector('#game-text-input');
        if (textarea && e.target === textarea) {
          const content = textarea.value || '';
          
          if (content.trim()) {
            // Format the content as a try with RNG result
            const formattedContent = this.formatAsTry(content);
            textarea.value = formattedContent;
            
            // Trigger input event so React picks up the change
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Watch for the new action element to appear and update its icon
            this.watchForTryAction(formattedContent);
            
            // Reset try mode after submission
            this.deactivateTryMode();
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
      if (!this.isTryMode) return;
      
      // Check if the click is on the submit button
      const submitButton = e.target.closest('[aria-label="Submit action"]');
      if (!submitButton) return;

      const textarea = document.querySelector('#game-text-input');
      if (textarea) {
        const content = textarea.value || '';
        if (content.trim()) {
          // Format the content as a try with RNG result
          const formattedContent = this.formatAsTry(content);
          textarea.value = formattedContent;
          
          // Trigger input event so React picks up the change
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Watch for the new action element to appear and update its icon
          this.watchForTryAction(formattedContent);
          
          // Reset try mode after submission
          this.deactivateTryMode();
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
      if (!this.isTryMode) return;
      
      const textarea = document.querySelector('#game-text-input');
      const isUserTyping = textarea && (document.activeElement === textarea || textarea.value.trim().length > 0);
      const isInStorySection = document.querySelector('#gameplay-output') !== null;
      
      // Don't auto-deactivate if user is actively typing, has content, or is not in story section
      if (isUserTyping || !isInStorySection) {
        // Reschedule check - user is still active or not in story section
        this.scheduleAutoCleanup();
      } else {
        this.deactivateTryMode();
      }
    }, 30000);
  }

  deactivateTryMode() {
    this.isTryMode = false;
    this.restoreModeDisplay();
    
    // Clean up auto-cleanup timer
    if (this.autoCleanupTimer) {
      clearTimeout(this.autoCleanupTimer);
      this.autoCleanupTimer = null;
    }
    
    // Reset weight for next try
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
    // Two-roll system: more intuitive odds
    // Roll 1: Success or fail based on success chance slider
    // Roll 2: Was it a critical?
    
    const roll = Math.random() * 100;
    const successChance = this.getSuccessChance();
    const succeeded = roll < successChance;
    
    // Second roll for critical
    const critRoll = Math.random() * 100;
    const isCrit = critRoll < this.criticalChance;
    
    let status = '';
    if (succeeded) {
      status = isCrit ? 'crit_success' : 'success';
    } else {
      status = isCrit ? 'crit_fail' : 'failure';
    }

    // Pick a random phrase from the pool
    const phrasePool = this.phrases[status];
    const phrase = phrasePool[Math.floor(Math.random() * phrasePool.length)];
    
    return {
      status,
      succeeded,
      isCrit,
      phrase: `**${phrase}**` // Apply Markdown bolding (we use standard because we aren't actually formatting)
    };
  }

  watchForTryAction(tryText) {
    // Store the text we're looking for (partial match since AI Dungeon may modify it)
    this.pendingTryText = tryText.toLowerCase().substring(0, 30);
    
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
        // New action element appeared - check if it's our try
        const latestAction = actionTexts[actionTexts.length - 1];
        const actionContent = latestAction.textContent?.toLowerCase() || '';
        
        // Check if this action contains our try text
        if (actionContent.includes('try to') || 
            (this.pendingTryText && actionContent.includes(this.pendingTryText.substring(0, 15)))) {
          
          // Find the action icon in the parent container
          const actionContainer = latestAction.closest('.is_Row, [id="transition-opacity"]');
          if (actionContainer) {
            const iconElement = actionContainer.querySelector('#action-icon');
            if (iconElement && iconElement.textContent === 'w_run') {
              iconElement.textContent = 'w_controller';
            }
          }
          
          // Clean up
          this.pendingTryText = null;
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
        this.pendingTryText = null;
      }
    }, 30000);
  }

  formatAsTry(content) {
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
    
    // Ensure the action starts lowercase (since it follows "try to" in some templates)
    if (action.length > 0) {
      action = action.charAt(0).toLowerCase() + action.slice(1);
    }
    
    // Remove trailing punctuation
    action = action.replace(/[.!?]+$/, '');
    
    // Roll for the outcome
    const result = this.rollOutcome();
    
    // Select a random template
    const template = this.templates[Math.floor(Math.random() * this.templates.length)];
    
    // Prepare variables for template replacement
    const connector = result.succeeded ? 'and' : 'but';
    
    // If the template starts with {action}, we might want to capitalize it
    let formattedAction = action;
    if (template.startsWith('{action}')) {
      formattedAction = action.charAt(0).toUpperCase() + action.slice(1);
    }

    // Perform replacement
    let finalOutput = template
      .replace('{action}', formattedAction)
      .replace('{outcome}', result.phrase)
      .replace('{connector}', connector);

    // Ensure it ends with a period
    if (!finalOutput.endsWith('.')) {
      finalOutput += '.';
    }

    return finalOutput;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.TryFeature = TryFeature;
}
