// BetterDungeon - Auto See Feature
// Automatically sends a "See" action after AI outputs
// Detects submitted actions and Continue actions, then triggers See and reverts to original input mode

class AutoSeeFeature {
  static id = 'autoSee';

  constructor() {
    // DOM observation state
    this.observer = null;
    this.debounceTimer = null;
    
    // Track story content to detect AI response completion
    this.lastStoryContent = '';
    this.lastStoryLength = 0;
    this.isProcessing = false;
    this.isWaitingForAIResponse = false;
    
    // Track user's original input mode for restoration
    this.userOriginalMode = 'do'; // Default to 'do' mode
    
    // Settings
    this.enabled = true;
    this.delay = 500; // Fixed 0.5s delay before triggering See action
    this.triggerMode = 'everyTurn'; // 'everyTurn' or 'afterNTurns'
    this.turnInterval = 2; // If triggerMode is 'afterNTurns', trigger every N turns
    this.turnCounter = 0;
    
    // Selectors
    this.storyOutputSelector = '#gameplay-output';
    this.inputAreaSelector = '[aria-label="Change input mode"]';
    this.submitButtonSelector = '[aria-label="Submit action"]';
    this.continueButtonSelector = '[aria-label="Command: continue"]';
    this.inputModeMenuSelector = '[aria-label="Change input mode"]';
    this.closeInputModeMenuSelector = '[aria-label="Close \'Input Mode\' menu"]';
    this.takeATurnSelector = '[aria-label="Command: take a turn"]';
    this.closeInputSelector = '[aria-label="Close text input"]';
    this.textInputSelector = '#game-text-input';
    
    // Mode selectors for switching
    this.modeSelectors = {
      'do': '[aria-label="Set to \'Do\' mode"]',
      'try': '[aria-label="Set to \'Try\' mode"]',
      'say': '[aria-label="Set to \'Say\' mode"]',
      'story': '[aria-label="Set to \'Story\' mode"]',
      'see': '[aria-label="Set to \'See\' mode"]',
      'command': '[aria-label="Set to \'Command\' mode"]'
    };
    
    // Bound event listeners for cleanup
    this.boundClickHandler = null;
    this.boundEnterKeyHandler = null;
    this.boundContinueHotkeyHandler = null;
    this.boundVisibilityHandler = null;
    this.boundUserInterruptHandler = null;
    this.debug = false;
    
    // ==================== STABILITY IMPROVEMENTS ====================
    // Operation tracking for cancellation and staleness detection
    this.currentOperationId = 0;
    this.operationStartTime = null;
    
    // Timeout configurations (in milliseconds)
    this.TIMEOUTS = {
      WAITING_FOR_AI: 60000,      // Max time to wait for AI response (60s)
      PROCESSING_OPERATION: 30000, // Max time for the entire See action (30s)
      STEP_TIMEOUT: 5000,          // Max time for individual steps (5s)
      RATE_LIMIT_COOLDOWN: 1000    // Minimum time between trigger attempts (1s)
    };
    
    // Rate limiting
    this.lastTriggerAttempt = 0;
    
    // Safety reset timer for stuck states
    this.safetyResetTimer = null;
    this.waitingForAITimer = null;
  }

  // ==================== LIFECYCLE ====================

  async init() {
    console.log('[AutoSee] Initializing Auto See feature...');
    await this.loadSettings();
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
    this.setupActionDetection();
    this.setupVisibilityHandling();
    this.setupUserInterruptDetection();
    this.startObserving();
    this.log('[AutoSee] Initialization complete. Enabled:', this.enabled, 'Mode:', this.triggerMode);
  }

  destroy() {
    this.log('[AutoSee] Destroying Auto See feature...');
    
    // Abort any ongoing operation
    this.abortCurrentOperation('Feature destroyed');
    
    // Clean up observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // Clean up all timers
    this.clearAllTimers();
    
    // Clean up action detection listeners
    this.cleanupActionDetection();
    
    // Clean up visibility handler
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    
    // Clean up user interrupt handler
    if (this.boundUserInterruptHandler) {
      document.removeEventListener('click', this.boundUserInterruptHandler, true);
      this.boundUserInterruptHandler = null;
    }
    
    this.resetState();
    this.log('[AutoSee] Cleanup complete');
  }

  // ==================== STATE MANAGEMENT ====================

  /**
   * Resets all state flags to their initial values
   */
  resetState() {
    this.isProcessing = false;
    this.isWaitingForAIResponse = false;
    this.operationStartTime = null;
    this.log('[AutoSee] State reset complete');
  }

  /**
   * Clears all active timers to prevent memory leaks and stale callbacks
   */
  clearAllTimers() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.safetyResetTimer) {
      clearTimeout(this.safetyResetTimer);
      this.safetyResetTimer = null;
    }
    if (this.waitingForAITimer) {
      clearTimeout(this.waitingForAITimer);
      this.waitingForAITimer = null;
    }
  }

  /**
   * Aborts the current operation if one is in progress
   * @param {string} reason - Reason for aborting
   */
  abortCurrentOperation(reason) {
    if (this.isProcessing || this.isWaitingForAIResponse) {
      this.log('[AutoSee] Aborting current operation:', reason);
      this.currentOperationId++; // Invalidate any ongoing async operations
      this.clearAllTimers();
      this.resetState();
      
      // Try to clean up any open UI elements
      this.safeCleanupUI();
    }
  }

  /**
   * Safely attempts to close any open UI elements without throwing errors
   */
  safeCleanupUI() {
    try {
      this.closeInputModeMenu();
      this.closeInputArea();
    } catch (e) {
      this.log('[AutoSee] Error during UI cleanup:', e);
    }
  }

  /**
   * Checks if an operation is still valid (not stale/cancelled)
   * @param {number} operationId - The operation ID to check
   * @returns {boolean} True if operation is still valid
   */
  isOperationValid(operationId) {
    return operationId === this.currentOperationId;
  }

  /**
   * Sets up a safety timeout that will reset stuck states
   * @param {number} timeout - Timeout duration in milliseconds
   * @param {string} context - Description of what we're timing out
   */
  setupSafetyTimeout(timeout, context) {
    this.clearSafetyTimeout();
    this.safetyResetTimer = setTimeout(() => {
      if (this.isProcessing || this.isWaitingForAIResponse) {
        console.warn(`[AutoSee] Safety timeout triggered: ${context} - resetting state`);
        this.abortCurrentOperation(`Safety timeout: ${context}`);
      }
    }, timeout);
  }

  /**
   * Clears the safety timeout
   */
  clearSafetyTimeout() {
    if (this.safetyResetTimer) {
      clearTimeout(this.safetyResetTimer);
      this.safetyResetTimer = null;
    }
  }

  // ==================== SETTINGS ====================

  async loadSettings() {
    this.log('[AutoSee] Loading settings...');
    try {
      const result = await chrome.storage.sync.get([
        'betterDungeon_autoSeeTriggerMode',
        'betterDungeon_autoSeeTurnInterval'
      ]);
      // NOTE: We don't touch this.enabled here - FeatureManager sets it before init()
      // This ensures FeatureManager is the single source of truth for enabled state
      this.triggerMode = result.betterDungeon_autoSeeTriggerMode ?? 'everyTurn';
      this.turnInterval = result.betterDungeon_autoSeeTurnInterval ?? 2;
      this.log('[AutoSee] Settings loaded - Enabled:', this.enabled, 'TriggerMode:', this.triggerMode, 'TurnInterval:', this.turnInterval);
    } catch (e) {
      console.error('[AutoSee] ERROR: Error loading settings:', e);
    }
  }

  setTriggerMode(mode) {
    this.log('[AutoSee] Setting trigger mode:', mode);
    this.triggerMode = mode;
    chrome.storage.sync.set({ betterDungeon_autoSeeTriggerMode: mode });
  }

  setTurnInterval(interval) {
    this.turnInterval = Math.max(2, Math.min(10, interval));
    this.log('[AutoSee] Setting turn interval:', this.turnInterval);
    chrome.storage.sync.set({ betterDungeon_autoSeeTurnInterval: this.turnInterval });
  }

  // ==================== ADVENTURE DETECTION ====================

  detectCurrentAdventure() {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    const newAdventureId = match ? match[1] : null;
    
    if (newAdventureId !== this.currentAdventureId) {
      this.log('[AutoSee] Adventure changed from', this.currentAdventureId, 'to', newAdventureId);
      // Reset state on adventure change
      this.lastStoryContent = '';
      this.lastStoryLength = 0;
      this.turnCounter = 0;
      this.isProcessing = false;
      this.isWaitingForAIResponse = false;
      this.userOriginalMode = 'do';
    }
    
    this.currentAdventureId = newAdventureId;
  }

  startAdventureChangeDetection() {
    this.log('[AutoSee] Starting adventure change detection...');
    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => {
      this.abortCurrentOperation('Navigation detected (popstate)');
      this.detectCurrentAdventure();
    });
    
    // Watch for URL changes via history API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.abortCurrentOperation('Navigation detected (pushState)');
      this.detectCurrentAdventure();
    };
    
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.abortCurrentOperation('Navigation detected (replaceState)');
      this.detectCurrentAdventure();
    };
  }

  /**
   * Sets up visibility change handling to abort operations when user switches tabs
   */
  setupVisibilityHandling() {
    this.boundVisibilityHandler = () => {
      if (document.hidden && (this.isProcessing || this.isWaitingForAIResponse)) {
        this.log('[AutoSee] Page hidden, aborting current operation');
        this.abortCurrentOperation('Page hidden');
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  /**
   * Sets up detection for unexpected user interactions that should abort Auto See
   */
  setupUserInterruptDetection() {
    this.boundUserInterruptHandler = (e) => {
      // Only check during processing phase (not waiting for AI)
      if (!this.isProcessing) return;
      // Ignore synthetic clicks triggered by Auto See itself
      if (!e.isTrusted) return;
      
      // Check if user clicked something that indicates they want to take control
      const target = e.target.closest('[aria-label]');
      if (!target) return;
      
      const ariaLabel = target.getAttribute('aria-label');
      const interruptLabels = [
        'Command: take a turn',
        'Command: continue',
        'Command: retry',
        'Command: erase',
        'Close text input',
        'Undo change',
        'Redo change'
      ];
      
      if (interruptLabels.includes(ariaLabel)) {
        this.log('[AutoSee] User interaction detected during processing:', ariaLabel);
        this.abortCurrentOperation('User interaction: ' + ariaLabel);
      }
    };
    // Use capture phase with lower priority than action detection
    document.addEventListener('click', this.boundUserInterruptHandler, true);
  }

  // ==================== ACTION DETECTION ====================
  // Detects when user submits an action or clicks Continue to trigger Auto See

  setupActionDetection() {
    this.log('[AutoSee] Setting up action detection listeners...');
    
    // Click handler for Submit and Continue buttons (event delegation)
    this.boundClickHandler = (e) => this.handleActionClick(e);
    
    // Enter key handler for text input submissions
    this.boundEnterKeyHandler = (e) => this.handleEnterKeySubmit(e);
    
    // Custom event handler for Continue hotkey from HotkeyFeature
    this.boundContinueHotkeyHandler = () => this.handleContinueHotkey();
    
    // Attach listeners (capture phase to catch before action is processed)
    document.addEventListener('click', this.boundClickHandler, true);
    document.addEventListener('keydown', this.boundEnterKeyHandler, true);
    document.addEventListener('betterdungeon:continue-hotkey', this.boundContinueHotkeyHandler);
    
    this.log('[AutoSee] Action detection listeners attached (click + Enter key + Continue hotkey)');
  }

  cleanupActionDetection() {
    this.log('[AutoSee] Cleaning up action detection listeners...');
    if (this.boundClickHandler) {
      document.removeEventListener('click', this.boundClickHandler, true);
      this.boundClickHandler = null;
    }
    if (this.boundEnterKeyHandler) {
      document.removeEventListener('keydown', this.boundEnterKeyHandler, true);
      this.boundEnterKeyHandler = null;
    }
    if (this.boundContinueHotkeyHandler) {
      document.removeEventListener('betterdungeon:continue-hotkey', this.boundContinueHotkeyHandler);
      this.boundContinueHotkeyHandler = null;
    }
  }

  /**
   * Handles Continue action triggered via hotkey (from HotkeyFeature)
   */
  handleContinueHotkey() {
    if (!this.canProcessAction('Continue hotkey')) return;
    this.log('[AutoSee] === CONTINUE HOTKEY DETECTED ===');
    this.prepareForAIResponse(false); // false = don't capture mode (Continue doesn't have input open)
  }

  /**
   * Handles Enter key press to detect submit action when user presses Enter in the text input
   */
  handleEnterKeySubmit(e) {
    // Only handle Enter key (not Shift+Enter which is typically newline)
    if (e.key !== 'Enter' || e.shiftKey) return;
    
    // Check if the active element is the game text input
    const activeElement = document.activeElement;
    if (!activeElement || activeElement.id !== 'game-text-input') return;
    
    // Check if input area is open (submit button should be visible)
    if (!this.isInputAreaOpen()) return;
    
    if (!this.canProcessAction('Enter key')) return;
    this.log('[AutoSee] === ENTER KEY SUBMIT DETECTED ===');
    this.prepareForAIResponse(true); // true = capture current mode
  }

  /**
   * Handles click events on Submit and Continue buttons
   */
  handleActionClick(e) {
    const target = e.target.closest('[aria-label]');
    if (!target) return;
    
    const ariaLabel = target.getAttribute('aria-label');
    
    if (ariaLabel === 'Submit action') {
      if (!this.canProcessAction('click')) return;
      this.log('[AutoSee] === SUBMIT ACTION DETECTED ===');
      this.prepareForAIResponse(true); // true = capture current mode
    } else if (ariaLabel === 'Command: continue') {
      if (!this.canProcessAction('click')) return;
      this.log('[AutoSee] === CONTINUE ACTION DETECTED ===');
      this.prepareForAIResponse(false); // false = don't capture mode
    }
  }

  /**
   * Checks if we can process a new action
   * @param {string} source - Source of the action for logging
   * @returns {boolean} True if action can be processed
   */
  canProcessAction(source) {
    if (!this.enabled || !this.currentAdventureId) return false;
    
    // Rate limiting check
    const now = Date.now();
    if (now - this.lastTriggerAttempt < this.TIMEOUTS.RATE_LIMIT_COOLDOWN) {
      this.log(`[AutoSee] Ignoring ${source} - rate limited (${now - this.lastTriggerAttempt}ms since last attempt)`);
      return false;
    }
    
    if (this.isProcessing) {
      this.log(`[AutoSee] Ignoring ${source} - currently processing Auto See`);
      return false;
    }
    if (this.isWaitingForAIResponse) {
      this.log(`[AutoSee] Ignoring ${source} - already waiting for AI response`);
      return false;
    }
    
    this.lastTriggerAttempt = now;
    return true;
  }

  /**
   * Prepares the feature to wait for an AI response after a user action
   * @param {boolean} captureMode - Whether to capture the current input mode
   */
  prepareForAIResponse(captureMode) {
    // Capture current input mode if requested (for Submit actions where input is open)
    if (captureMode) {
      const currentMode = this.detectCurrentInputMode();
      if (currentMode && currentMode !== 'see') {
        this.userOriginalMode = currentMode;
        this.log('[AutoSee] Stored user original mode:', this.userOriginalMode);
      } else {
        this.log('[AutoSee] Current mode is "see" or unknown, keeping previous mode:', this.userOriginalMode);
      }
    } else {
      this.log('[AutoSee] Using stored original mode:', this.userOriginalMode);
    }
    
    // Capture current story content as baseline for detecting AI response
    this.captureCurrentStoryContent();
    this.log('[AutoSee] Captured story content at action time, length:', this.lastStoryLength);
    
    // Set flag and increment turn counter
    this.isWaitingForAIResponse = true;
    this.turnCounter++;
    this.log('[AutoSee] Turn counter incremented to:', this.turnCounter);
    this.log('[AutoSee] Waiting for AI response (content must change from current state)...');
    
    // Set up timeout for waiting for AI response
    if (this.waitingForAITimer) {
      clearTimeout(this.waitingForAITimer);
    }
    this.waitingForAITimer = setTimeout(() => {
      if (this.isWaitingForAIResponse) {
        console.warn('[AutoSee] Timeout waiting for AI response - resetting state');
        this.isWaitingForAIResponse = false;
        this.turnCounter--; // Decrement since we didn't actually process this turn
        this.log('[AutoSee] Turn counter decremented back to:', this.turnCounter);
      }
    }, this.TIMEOUTS.WAITING_FOR_AI);
  }

  // ==================== OUTPUT OBSERVATION ====================
  // Watches for AI response completion to trigger the See action

  startObserving() {
    this.log('[AutoSee] Starting output observation...');
    
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      // Only process if we're on an adventure page and feature is enabled
      if (!this.currentAdventureId || !this.enabled) return;
      
      // Only check for new output if we're waiting for an AI response
      if (!this.isWaitingForAIResponse) return;
      
      // Debounce to avoid triggering on partial updates (streaming)
      // Use a longer delay to let the AI finish generating
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      this.debounceTimer = setTimeout(() => {
        this.checkForAIResponseComplete();
      }, this.delay);
    });

    // Observe the entire document for story output changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    // NOTE: We do NOT capture initial content here anymore
    // Content is captured when the user clicks Submit/Continue
    // This prevents false positives from page load
    this.log('[AutoSee] Output observation started (waiting for user action to capture baseline)');
  }

  captureCurrentStoryContent() {
    const storyOutput = document.querySelector(this.storyOutputSelector);
    if (storyOutput) {
      this.lastStoryContent = storyOutput.textContent?.trim() || '';
      this.lastStoryLength = this.lastStoryContent.length;
      this.log('[AutoSee] Captured story content, length:', this.lastStoryLength);
    }
  }

  checkForAIResponseComplete() {
    // Don't trigger if already processing
    if (this.isProcessing) {
      this.log('[AutoSee] Skipping check - already processing');
      return;
    }
    
    // Don't trigger if input area is open (user is typing or about to submit something)
    // Note: Input area is CLOSED during AI generation, this check prevents interference with user input
    if (this.isInputAreaOpen()) {
      this.log('[AutoSee] Skipping check - input area is open (user may be typing)');
      return;
    }

    const storyOutput = document.querySelector(this.storyOutputSelector);
    if (!storyOutput) {
      this.log('[AutoSee] Skipping check - story output not found');
      return;
    }

    const currentContent = storyOutput.textContent?.trim() || '';
    const currentLength = currentContent.length;
    
    // Must have a baseline to compare against
    if (this.lastStoryLength === 0) {
      this.log('[AutoSee] Skipping check - no baseline content captured yet');
      return;
    }
    
    // Check if content has actually grown from our captured baseline
    if (currentLength > this.lastStoryLength) {
      this.log('[AutoSee] AI response detected! Content grew from', this.lastStoryLength, 'to', currentLength, '(+' + (currentLength - this.lastStoryLength) + ' chars)');
      
      // Update tracked content
      this.lastStoryContent = currentContent;
      this.lastStoryLength = currentLength;
      
      // Clear the waiting flag
      this.isWaitingForAIResponse = false;
      
      // Check if we should trigger based on mode
      if (this.shouldTriggerSee()) {
        this.log('[AutoSee] AI response complete - waiting 300ms before triggering See action...');
        // Add a small delay after AI response completes before triggering See
        // This ensures the response is fully rendered and stable
        setTimeout(() => {
          this.log('[AutoSee] Delay complete - triggering See action now');
          this.triggerSeeAction();
        }, 300);
      } else {
        this.log('[AutoSee] Skipping See trigger - turn interval not reached (turn', this.turnCounter, ', interval', this.turnInterval, ')');
      }
    } else {
      this.log('[AutoSee] Content unchanged or shrunk - current:', currentLength, 'baseline:', this.lastStoryLength);
    }
  }

  shouldTriggerSee() {
    if (this.triggerMode === 'everyTurn') {
      this.log('[AutoSee] shouldTriggerSee: everyTurn mode - returning true');
      return true;
    } else if (this.triggerMode === 'afterNTurns') {
      const shouldTrigger = this.turnCounter % this.turnInterval === 0;
      this.log('[AutoSee] shouldTriggerSee: afterNTurns mode - turn', this.turnCounter, 'interval', this.turnInterval, '- returning', shouldTrigger);
      return shouldTrigger;
    }
    this.log('[AutoSee] shouldTriggerSee: unknown mode - returning false');
    return false;
  }

  // ==================== SEE ACTION TRIGGERING ====================

  isInputAreaOpen() {
    return !!document.querySelector(this.inputAreaSelector);
  }

  /**
   * Detects the current input mode from the mode button text
   * @returns {string|null} The current mode name (lowercase) or null if not found
   */
  detectCurrentInputMode() {
    const modeButton = document.querySelector(this.inputModeMenuSelector);
    if (modeButton) {
      const modeText = modeButton.querySelector('.font_body');
      if (modeText) {
        const mode = modeText.textContent.toLowerCase().trim();
        this.log('[AutoSee] Detected current input mode:', mode);
        return mode;
      }
    }
    this.log('[AutoSee] Could not detect current input mode');
    return null;
  }

  async triggerSeeAction() {
    if (this.isProcessing) {
      this.log('[AutoSee] triggerSeeAction called but already processing - skipping');
      return;
    }
    
    // Start new operation with unique ID
    this.currentOperationId++;
    const operationId = this.currentOperationId;
    this.isProcessing = true;
    this.operationStartTime = Date.now();
    
    this.log('[AutoSee] ========== STARTING SEE ACTION (Op ID:', operationId, ') ==========');
    this.log('[AutoSee] User original mode to restore:', this.userOriginalMode);
    
    // Set up overall operation timeout
    this.setupSafetyTimeout(this.TIMEOUTS.PROCESSING_OPERATION, 'See action processing');

    try {
      // Step 1: Open the input area by clicking "Take a Turn"
      this.log('[AutoSee] Step 1: Opening input area...');
      if (!this.isOperationValid(operationId)) {
        this.log('[AutoSee] Operation cancelled before step 1');
        return;
      }
      
      const takeATurnBtn = document.querySelector(this.takeATurnSelector);
      if (!takeATurnBtn) {
        this.log('[AutoSee] ERROR: Take a Turn button not found!');
        return;
      }

      takeATurnBtn.click();
      await this.waitWithValidation(300, operationId);
      if (!this.isOperationValid(operationId)) return;
      this.log('[AutoSee] Input area opened');

      // Step 2: Open the input mode menu
      this.log('[AutoSee] Step 2: Opening input mode menu...');
      const menuOpened = await this.openInputModeMenuWithValidation(operationId);
      if (!this.isOperationValid(operationId)) return;
      if (!menuOpened) {
        console.error('[AutoSee] ERROR: Failed to open input mode menu!');
        this.safeCleanupUI();
        return;
      }
      this.log('[AutoSee] Input mode menu opened');

      // Step 3: Select "See" mode
      this.log('[AutoSee] Step 3: Selecting See mode...');
      await this.waitWithValidation(150, operationId);
      if (!this.isOperationValid(operationId)) return;
      
      const seeModeSelector = this.modeSelectors['see'];
      const seeModeBtn = document.querySelector(seeModeSelector);
      if (!seeModeBtn) {
        console.error('[AutoSee] ERROR: See mode button not found!');
        this.safeCleanupUI();
        return;
      }

      seeModeBtn.click();
      await this.waitWithValidation(200, operationId);
      if (!this.isOperationValid(operationId)) return;
      this.log('[AutoSee] See mode selected');

      // Step 4: Clear the input field (See with empty input generates current scene)
      this.log('[AutoSee] Step 4: Clearing input field...');
      const textInput = document.querySelector(this.textInputSelector);
      if (textInput) {
        textInput.value = '';
        // Trigger React's onChange
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        this.log('[AutoSee] Input field cleared');
      } else {
        this.log('[AutoSee] WARNING: Text input not found, proceeding anyway');
      }

      // Step 5: Submit the See action
      this.log('[AutoSee] Step 5: Submitting See action...');
      await this.waitWithValidation(100, operationId);
      if (!this.isOperationValid(operationId)) return;
      
      const submitBtn = document.querySelector(this.submitButtonSelector);
      if (!submitBtn) {
        console.error('[AutoSee] ERROR: Submit button not found!');
        this.safeCleanupUI();
        return;
      }

      submitBtn.click();
      this.log('[AutoSee] See action submitted!');

      // Step 6: Wait for See/image generation to complete
      this.log('[AutoSee] Step 6: Waiting for image generation to complete...');
      await this.waitForImageGenerationCompleteWithValidation(operationId);
      if (!this.isOperationValid(operationId)) return;
      this.log('[AutoSee] Image generation complete');
      
      // Update the story content after See completes
      this.captureCurrentStoryContent();

      // Step 7: Restore the user's original input mode
      this.log('[AutoSee] Step 7: Restoring original input mode:', this.userOriginalMode);
      await this.restoreOriginalInputModeWithValidation(operationId);
      
      if (this.isOperationValid(operationId)) {
        this.log('[AutoSee] ========== SEE ACTION COMPLETE (Op ID:', operationId, ') ==========');
      }

    } catch (error) {
      console.error('[AutoSee] ERROR during See action:', error);
    } finally {
      // Only reset if this is still the current operation
      if (this.isOperationValid(operationId)) {
        this.isProcessing = false;
        this.operationStartTime = null;
        this.clearSafetyTimeout();
        this.log('[AutoSee] Processing flag cleared');
      }
    }
  }

  /**
   * Wait helper that checks operation validity
   * @param {number} ms - Milliseconds to wait
   * @param {number} operationId - Current operation ID
   * @returns {Promise<boolean>} True if operation is still valid after wait
   */
  async waitWithValidation(ms, operationId) {
    await this.wait(ms);
    return this.isOperationValid(operationId);
  }

  /**
   * Waits for image generation with operation validity checking
   * @param {number} operationId - Current operation ID
   */
  async waitForImageGenerationCompleteWithValidation(operationId) {
    this.log('[AutoSee] Waiting for input area to close...');
    
    // Wait for input area to close (indicates action was accepted)
    let attempts = 0;
    while (this.isInputAreaOpen() && attempts < 60 && this.isOperationValid(operationId)) {
      await this.wait(100);
      attempts++;
    }
    
    if (!this.isOperationValid(operationId)) {
      this.log('[AutoSee] Operation cancelled while waiting for input area to close');
      return;
    }
    
    if (attempts >= 60) {
      this.log('[AutoSee] WARNING: Input area did not close after 6 seconds');
    } else {
      this.log('[AutoSee] Input area closed after', attempts * 100, 'ms');
    }
    
    // Additional wait for image generation (typically takes 2-5 seconds)
    // Split into smaller chunks to allow for cancellation
    this.log('[AutoSee] Waiting additional time for image generation...');
    for (let i = 0; i < 6; i++) {
      if (!this.isOperationValid(operationId)) {
        this.log('[AutoSee] Operation cancelled during image generation wait');
        return;
      }
      await this.wait(500);
    }
  }

  /**
   * Restores the user's original input mode with operation validity checking
   * @param {number} operationId - Current operation ID
   */
  async restoreOriginalInputModeWithValidation(operationId) {
    this.log('[AutoSee] Starting mode restoration to:', this.userOriginalMode);
    
    // Don't restore if the original mode was 'see' (unlikely but possible)
    if (this.userOriginalMode === 'see') {
      this.log('[AutoSee] Original mode was "see", no restoration needed');
      return;
    }
    
    // Check if mode selector exists for the original mode
    const modeSelector = this.modeSelectors[this.userOriginalMode];
    if (!modeSelector) {
      this.log('[AutoSee] WARNING: No selector found for mode:', this.userOriginalMode);
      return;
    }
    
    try {
      // Step 1: Open the input area by clicking "Take a Turn"
      this.log('[AutoSee] Restore Step 1: Opening input area...');
      if (!this.isOperationValid(operationId)) return;
      
      const takeATurnBtn = document.querySelector(this.takeATurnSelector);
      if (!takeATurnBtn) {
        this.log('[AutoSee] ERROR: Take a Turn button not found for restoration!');
        return;
      }
      
      takeATurnBtn.click();
      await this.waitWithValidation(300, operationId);
      if (!this.isOperationValid(operationId)) return;
      this.log('[AutoSee] Input area opened for restoration');
      
      // Step 2: Open the input mode menu
      this.log('[AutoSee] Restore Step 2: Opening input mode menu...');
      const menuOpened = await this.openInputModeMenuWithValidation(operationId);
      if (!this.isOperationValid(operationId)) return;
      if (!menuOpened) {
        this.log('[AutoSee] ERROR: Failed to open input mode menu for restoration!');
        this.safeCleanupUI();
        return;
      }
      this.log('[AutoSee] Input mode menu opened for restoration');
      
      // Step 3: Select the original mode
      this.log('[AutoSee] Restore Step 3: Selecting original mode:', this.userOriginalMode);
      await this.waitWithValidation(150, operationId);
      if (!this.isOperationValid(operationId)) return;
      
      const modeBtn = document.querySelector(modeSelector);
      if (!modeBtn) {
        this.log('[AutoSee] ERROR: Mode button not found for:', this.userOriginalMode);
        this.safeCleanupUI();
        return;
      }
      
      modeBtn.click();
      await this.waitWithValidation(200, operationId);
      if (!this.isOperationValid(operationId)) return;
      this.log('[AutoSee] Original mode selected:', this.userOriginalMode);
      
      // Step 4: Close the input area
      this.log('[AutoSee] Restore Step 4: Closing input area...');
      this.closeInputArea();
      await this.waitWithValidation(100, operationId);
      this.log('[AutoSee] Mode restoration complete!');
      
    } catch (error) {
      this.log('[AutoSee] ERROR during mode restoration:', error);
    }
  }

  /**
   * Opens the input mode menu with operation validity checking
   * @param {number} operationId - Current operation ID
   * @returns {Promise<boolean>} True if menu was opened successfully
   */
  async openInputModeMenuWithValidation(operationId) {
    if (!this.isOperationValid(operationId)) return false;
    
    const menuButton = document.querySelector(this.inputModeMenuSelector);
    if (!menuButton) {
      this.log('[AutoSee] openInputModeMenu: Menu button not found');
      return false;
    }
    
    // Check if menu is already open by looking for any mode button
    const existingMenu = document.querySelector(this.modeSelectors['do']);
    if (existingMenu) {
      this.log('[AutoSee] openInputModeMenu: Menu already open');
      return true;
    }
    
    this.log('[AutoSee] openInputModeMenu: Clicking menu button...');
    menuButton.click();
    
    // Wait for menu to appear with validation
    for (let i = 0; i < 20; i++) {
      if (!this.isOperationValid(operationId)) {
        this.log('[AutoSee] openInputModeMenu: Operation cancelled while waiting for menu');
        return false;
      }
      await this.wait(50);
      const menu = document.querySelector(this.modeSelectors['do']);
      if (menu) {
        this.log('[AutoSee] openInputModeMenu: Menu appeared after', (i + 1) * 50, 'ms');
        return true;
      }
    }
    
    this.log('[AutoSee] openInputModeMenu: Menu did not appear after 1 second');
    return false;
  }

  closeInputModeMenu() {
    this.log('[AutoSee] Closing input mode menu...');
    const closeButton = document.querySelector(this.closeInputModeMenuSelector);
    if (closeButton) {
      closeButton.click();
      this.log('[AutoSee] Input mode menu close button clicked');
    } else {
      this.log('[AutoSee] Input mode menu close button not found');
    }
  }

  closeInputArea() {
    this.log('[AutoSee] Closing input area...');
    const closeButton = document.querySelector(this.closeInputSelector);
    if (closeButton) {
      closeButton.click();
      this.log('[AutoSee] Input area close button clicked');
    } else {
      this.log('[AutoSee] Input area close button not found');
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Logs a message if debug mode is enabled
   * @param {...any} args - Arguments to pass to console.log
   */
  log(...args) {
    if (this.debug) {
      console.log(...args);
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.AutoSeeFeature = AutoSeeFeature;
}
