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
    this.oocBracketsEnabled = false;
    this.pendingCommandDelete = null;
    this.responseObserver = null;
    this._lastSpriteState = null; // track sprite/dynamic theme for reactive re-injection
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  init() {
    console.log('[Command] Initializing Command feature...');
    this.setupObserver();
    this.injectCommandButton();
    this.loadAutoDeleteSetting();
    this.loadOocBracketsSetting();
    this.setupMessageListener();
  }

  loadAutoDeleteSetting() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get('betterDungeon_commandAutoDelete', (result) => {
        this.autoDeleteEnabled = (result || {}).betterDungeon_commandAutoDelete ?? false;
      });
    }
  }

  loadOocBracketsSetting() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get('betterDungeon_commandOocBrackets', (result) => {
        this.oocBracketsEnabled = (result || {}).betterDungeon_commandOocBrackets ?? false;
        // If already in command mode, refresh the display to reflect the setting
        if (this.isCommandMode) this.updateModeDisplay();
      });
    }
  }

  setupMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'SET_COMMAND_AUTO_DELETE') {
          this.autoDeleteEnabled = message.enabled;
          sendResponse({ success: true });
        } else if (message.type === 'SET_COMMAND_OOC_BRACKETS') {
          this.oocBracketsEnabled = message.enabled;
          // Refresh display immediately if already in command mode
          if (this.isCommandMode) this.updateModeDisplay();
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

  // Check whether a native button has a sprite-based theme active
  _isSpriteActive(nativeButton) {
    if (!nativeButton) return false;
    const wrapper = nativeButton.querySelector('div[style*="position: absolute"]');
    if (!wrapper) return false;
    const viewport = wrapper.querySelector('div[class*="_ox-hidden"]');
    if (!viewport) return false;
    return parseFloat(window.getComputedStyle(viewport).width) > 0;
  }

  injectCommandButton() {
    const menu = this.findInputModeMenu();
    if (!menu) return;

    // Find reference buttons for positioning
    const storyButton = menu.querySelector('[aria-label="Set to \'Story\' mode"]');
    if (!storyButton) return;
    const seeButton = menu.querySelector('[aria-label="Set to \'See\' mode"]');

    // Detect theme switches (sprite <-> dynamic) and force re-inject
    const isSpriteNow = this._isSpriteActive(storyButton);
    if (this._lastSpriteState !== null && this._lastSpriteState !== isSpriteNow) {
      const stale = menu.querySelector('[aria-label="Set to \'Command\' mode"]');
      if (stale) stale.remove();
      this.commandButton = null;
    }
    this._lastSpriteState = isSpriteNow;

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

  // Convert an end-cap button (3-part sprite) to a middle button (single viewport).
  // Used when See is no longer the last button because Command was appended after it.
  convertToMiddleButton(targetButton, referenceMiddleButton) {
    if (!targetButton || !referenceMiddleButton) return;

    setTimeout(() => {
      const refWrapper = referenceMiddleButton.querySelector('div[style*="position: absolute"]');
      if (!refWrapper) return;

      const refViewport = refWrapper.querySelector('div[class*="_ox-hidden"]');
      if (!refViewport) return;

      const refWidth = parseFloat(window.getComputedStyle(refViewport).width);
      if (refWidth === 0) return; // Dynamic theme

      const targetWrapper = targetButton.querySelector('div[style*="position: absolute"]');
      if (!targetWrapper) return;

      const targetWidth = targetButton.getBoundingClientRect().width;
      if (targetWidth === 0) return;

      // Replace target's sprite content with a cloned middle-button sprite
      while (targetWrapper.firstChild) targetWrapper.removeChild(targetWrapper.firstChild);
      for (const child of refWrapper.children) {
        targetWrapper.appendChild(child.cloneNode(true));
      }
      targetWrapper.style.justifyContent = window.getComputedStyle(refWrapper).justifyContent;

      // Scale the cloned viewport to match the target button's width
      const clonedViewport = targetWrapper.querySelector('div[class*="_ox-hidden"]');
      if (clonedViewport && refWidth > 0) {
        const scale = targetWidth / refWidth;
        clonedViewport.style.width = `${targetWidth}px`;

        const positioner = clonedViewport.firstElementChild;
        if (positioner?.style) {
          const w = parseFloat(positioner.style.width) || 0;
          const l = parseFloat(positioner.style.left) || 0;
          if (w > 0) {
            positioner.style.width = `${w * scale}px`;
            positioner.style.left = `${l * scale}px`;
          }
        }
      }

      // Wire up hover — React can no longer manage it after we replaced the sprite
      this.addSpriteHover(targetButton);
    }, 100);
  }

  // Clone the end-cap sprite from the reference button (See) into Command,
  // then scale the center section to fit Command's width and wire up hover.
  applySpriteTheming(customButton, referenceButton) {
    if (!customButton || !referenceButton) return;

    setTimeout(() => {
      const refWrapper = referenceButton.querySelector('div[style*="position: absolute"]');
      if (!refWrapper) return;

      const refViewports = refWrapper.querySelectorAll(':scope > div[class*="_ox-hidden"]');
      if (refViewports.length === 0) return;

      // Check if sprite theme is active (non-zero viewport width)
      if (parseFloat(window.getComputedStyle(refViewports[0]).width) === 0) return;

      const customWrapper = customButton.querySelector('div[style*="position: absolute"]');
      if (!customWrapper) return;

      const buttonWidth = customButton.getBoundingClientRect().width;
      if (buttonWidth === 0) return;

      // Clone reference sprite content into our button
      while (customWrapper.firstChild) customWrapper.removeChild(customWrapper.firstChild);
      for (const child of refWrapper.children) {
        customWrapper.appendChild(child.cloneNode(true));
      }
      customWrapper.style.justifyContent = window.getComputedStyle(refWrapper).justifyContent;

      const clonedViewports = customWrapper.querySelectorAll(':scope > div[class*="_ox-hidden"]');

      if (refViewports.length === 3 && clonedViewports.length === 3) {
        // 3-part end-cap: left cap (fixed), center (stretch), right cap (fixed)
        const leftCapW = parseFloat(window.getComputedStyle(refViewports[0]).width);
        const rightCapW = parseFloat(window.getComputedStyle(refViewports[2]).width);
        const refCenterW = parseFloat(window.getComputedStyle(refViewports[1]).width);
        const newCenterW = buttonWidth - leftCapW - rightCapW;

        if (newCenterW > 0 && refCenterW > 0) {
          clonedViewports[1].style.width = `${newCenterW}px`;

          // Scale center positioner proportionally
          const scale = newCenterW / refCenterW;
          const positioner = clonedViewports[1].firstElementChild;
          if (positioner?.style) {
            const w = parseFloat(positioner.style.width) || 0;
            const l = parseFloat(positioner.style.left) || 0;
            if (w > 0) {
              positioner.style.width = `${w * scale}px`;
              positioner.style.left = `${l * scale}px`;
            }
          }
        }
      } else if (clonedViewports.length === 1) {
        // Fallback: reference was a middle button — scale single viewport
        const refW = parseFloat(window.getComputedStyle(refViewports[0]).width);
        if (refW > 0) {
          const scale = buttonWidth / refW;
          clonedViewports[0].style.width = `${buttonWidth}px`;

          const positioner = clonedViewports[0].firstElementChild;
          if (positioner?.style) {
            const w = parseFloat(positioner.style.width) || 0;
            const l = parseFloat(positioner.style.left) || 0;
            if (w > 0) {
              positioner.style.width = `${w * scale}px`;
              positioner.style.left = `${l * scale}px`;
            }
          }
        }
      }

      // Wire up hover state (shift sprite to hover region)
      this.addSpriteHover(customButton);
    }, 100);
  }

  // Shift all sprite positioners on hover to reveal the hover-state region.
  // Each viewport's positioner is displaced by 17/90 of its own width — a
  // fixed fraction mapping to the horizontal gap between non-hover and hover
  // regions in every AI Dungeon sprite sheet.
  addSpriteHover(button) {
    if (button.dataset.bdSpriteHover) return;
    button.dataset.bdSpriteHover = 'true';

    const spriteWrapper = button.querySelector('div[style*="position: absolute"]');
    if (!spriteWrapper) return;

    const viewports = spriteWrapper.querySelectorAll(':scope > div[class*="_ox-hidden"]');
    if (viewports.length === 0) return;

    const hoverData = [];
    for (const viewport of viewports) {
      const positioner = viewport.firstElementChild;
      if (!positioner?.style) continue;

      const posWidth = parseFloat(positioner.style.width) || 0;
      const restLeft = parseFloat(positioner.style.left) || 0;
      if (posWidth === 0) continue;

      // Hover region offset: 17/90 of positioner width (empirically derived)
      const hoverLeft = restLeft - (posWidth * 17 / 90);
      hoverData.push({ positioner, restLeft, hoverLeft });
    }

    if (hoverData.length === 0) return;

    button.addEventListener('mouseenter', () => {
      for (const { positioner, hoverLeft } of hoverData) {
        positioner.style.left = `${hoverLeft}px`;
      }
    });
    button.addEventListener('mouseleave', () => {
      for (const { positioner, restLeft } of hoverData) {
        positioner.style.left = `${restLeft}px`;
      }
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
      if (modeText) {
        const lower = modeText.textContent.toLowerCase();
        if (lower === 'story' || lower === 'command' || lower === 'command [ooc]') {
          modeText.textContent = this.oocBracketsEnabled ? 'command [OOC]' : 'command';
        }
      }
    }

    // Update the placeholder text
    const textarea = document.querySelector('#game-text-input');
    if (textarea) {
      const placeholder = this.oocBracketsEnabled
        ? 'Give a subtle instruction to the AI.'
        : 'Give an instruction to the AI.';
      textarea.placeholder = placeholder;
      textarea.setAttribute('data-placeholder', placeholder);
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
      if (modeText) {
        const lower = modeText.textContent.toLowerCase();
        if (lower === 'command' || lower === 'command [ooc]') {
          modeText.textContent = 'story';
        }
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
    // Default format: ## User Input:
    // OOC format:     [## User Input:]
    const cleanedContent = content
      .replace(/^[\s#]+/, '')  // Remove leading whitespace and # characters
      .replace(/[\s.?!:]+$/, ''); // Remove trailing punctuation and whitespace
    
    const command = `## ${cleanedContent}:`;
    
    if (this.oocBracketsEnabled) {
      return `\n\n[${command}]\n\n`;
    }
    return `\n\n${command}\n\n`;
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
