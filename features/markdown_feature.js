// BetterDungeon - features/markdown_feature.js
// Self-contained markdown formatting feature with its own DOM observation

class MarkdownFeature {
  static id = 'markdown';
  static PROCESSED_ATTR = 'data-bd-processed';

  constructor() {
    this.storyContainerSelector = '#gameplay-output';
    this.storyTextSelectors = [
      '#gameplay-output span[id="transition-opacity"]',
      '#gameplay-output span[id="transition-opacity"] > span'
    ].join(', ');

    // DOM observation state
    this.observer = null;
    this.debounceTimer = null;
    this.animationCheckTimer = null;
    
    // Auto-apply instructions state
    this.autoApplyEnabled = false;
    this.currentAdventureId = null;
    this.applyRunId = 0;
    this.applyQueue = Promise.resolve();
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  // Called when feature is registered
  async init() {
    console.log('[Markdown] Initializing Markdown feature...');
    await this.loadAutoApplySetting();
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
    this.waitForContainer();
  }

  async loadAutoApplySetting() {
    try {
      const result = await chrome.storage.sync.get('betterDungeon_autoApplyInstructions');
      this.autoApplyEnabled = (result || {}).betterDungeon_autoApplyInstructions ?? false;
    } catch (e) {
      this.autoApplyEnabled = false;
    }
  }

  setAutoApply(enabled) {
    this.autoApplyEnabled = enabled;
    chrome.storage.sync.set({ betterDungeon_autoApplyInstructions: enabled });
  }

  detectCurrentAdventure() {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    const newAdventureId = match ? match[1] : null;
    const adventureChanged = this.currentAdventureId !== newAdventureId;
    
    // Auto-apply when entering a new adventure
    if (newAdventureId && adventureChanged && this.autoApplyEnabled) {
      // Wait for the adventure page to fully load before applying
      this.waitForAdventureReady().then(() => {
        this.applyInstructionsQuietly();
      });
    }
    
    this.currentAdventureId = newAdventureId;
  }

  // Wait for the adventure page to be ready (gameplay output visible)
  async waitForAdventureReady(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      // Check if we're on an adventure page with gameplay output
      const gameplayOutput = document.querySelector('#gameplay-output');
      const settingsButton = document.querySelector('div[aria-label="Game settings"]');
      
      if (gameplayOutput && settingsButton) {
        // Additional delay to ensure everything is loaded
        await this.wait(500);
        return true;
      }
      await this.wait(250);
    }
    this.log('MarkdownFeature: Adventure page not ready for auto-apply');
    return false;
  }

  startAdventureChangeDetection() {
    window.addEventListener('popstate', () => this.detectCurrentAdventure());
    
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.detectCurrentAdventure();
    };
    
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.detectCurrentAdventure();
    };
  }

  async applyInstructionsWithLoadingScreen() {
    if (typeof loadingScreen === 'undefined') {
      console.error('MarkdownFeature: Loading screen not available');
      return { success: false, error: 'Loading screen not available' };
    }

    const token = ++this.applyRunId;
    this.applyQueue = this.applyQueue
      .catch(() => null)
      .then(() => {
        if (token !== this.applyRunId) return { success: false, canceled: true };
        return loadingScreen.queueOperation(() => this._doApplyInstructions({
          token,
          forceApply: true,
          showOverlay: true,
        }));
      });

    return this.applyQueue;
  }

  async applyInstructionsQuietly() {
    const token = ++this.applyRunId;
    this.applyQueue = this.applyQueue
      .catch(() => null)
      .then(() => {
        if (token !== this.applyRunId) return { success: false, canceled: true };
        return this._doApplyInstructions({
          token,
          forceApply: false,
          showOverlay: false,
        });
      });

    return this.applyQueue;
  }

  async _doApplyInstructions(options = {}) {
    const { token, forceApply = false, showOverlay = false } = options;

    if (showOverlay) {
      loadingScreen.show({
        title: 'Applying Instructions',
        subtitle: 'Initializing...',
        showProgress: false
      });
    }

    try {
      if (typeof AIDungeonService === 'undefined') {
        throw new Error('AIDungeonService not available');
      }

      const service = new AIDungeonService();

      // Step 1: Validate we're on AI Dungeon
      if (!service.isOnAIDungeon()) {
        throw new Error('Not on AI Dungeon - navigate to aidungeon.com');
      }

      // Step 2: Validate we're on an adventure page
      if (!service.isOnAdventurePage()) {
        throw new Error('Open an adventure first');
      }
      
      // Step 3: Load instruction file
      if (showOverlay) loadingScreen.updateSubtitle('Loading instruction file...');
      const instructionsResult = await service.fetchInstructionsFile();
      
      if (!instructionsResult.success) {
        throw new Error(instructionsResult.error || 'Failed to fetch instructions');
      }

      // Step 4: Navigate to settings and apply (with live status updates)
      await this.wait(200);
      
      // Pass callbacks to update loading screen during the process
      const applyResult = await service.applyInstructionsToTextareas(instructionsResult.data, {
        forceApply,
        authorsNoteText: instructionsResult.authorsNoteData || null,
        shouldCancel: () => token !== this.applyRunId,
        onStepUpdate: (message) => {
          if (showOverlay) loadingScreen.updateSubtitle(message);
        },
        onCreatingComponents: (message) => {
          if (showOverlay) {
            if (message) {
              loadingScreen.updateSubtitle(message);
            } else {
              loadingScreen.updateSubtitle('Creating plot components...');
            }
          }
        }
      });

      if (applyResult.canceled) {
        return { success: false, canceled: true };
      }
      
      if (!applyResult.success) {
        throw new Error(applyResult.error || 'Failed to apply instructions');
      }

      // Handle different outcomes
      if (applyResult.alreadyApplied) {
        if (showOverlay) {
          loadingScreen.updateTitle('Already Applied');
          loadingScreen.updateSubtitle('Markdown instructions are already present');
          await this.wait(1200);
        }
        return { success: true, alreadyApplied: true };
      }

      if (applyResult.appliedCount === 0) {
        if (showOverlay) {
          loadingScreen.updateTitle(applyResult.partial ? 'Partially Applied' : 'Already Applied');
          loadingScreen.updateSubtitle(applyResult.partial ? "Author's Note was unavailable" : 'Instructions were already in place');
          await this.wait(1200);
        } else if (applyResult.partial) {
          this.showToast('Markdown partially applied', 'info');
        }
        return { success: true, alreadyApplied: !applyResult.partial, partial: applyResult.partial };
      }

      if (showOverlay) {
        loadingScreen.updateTitle(applyResult.partial ? 'Partially Applied' : 'Instructions Applied!');
        if (applyResult.partial) {
          loadingScreen.updateSubtitle("Author's Note was unavailable");
        } else if (applyResult.componentsCreated) {
          loadingScreen.updateSubtitle('Created plot components & added formatting instructions');
        } else {
          loadingScreen.updateSubtitle('Markdown formatting guidelines applied');
        }
        await this.wait(1500);
      } else {
        this.showToast(applyResult.partial ? 'Markdown partially applied' : 'Markdown instructions applied', applyResult.partial ? 'info' : 'success');
      }
      
      return { success: true, partial: applyResult.partial };

    } catch (error) {
      console.error('MarkdownFeature: Apply instructions error:', error);
      if (showOverlay) {
        loadingScreen.updateTitle('Failed to Apply');
        loadingScreen.updateSubtitle(error.message);
        await this.wait(2000);
      } else if (token === this.applyRunId) {
        this.showToast('Markdown apply failed', 'error');
      }
      
      return { success: false, error: error.message };

    } finally {
      if (showOverlay) {
        loadingScreen.hide();
      }
    }
  }

  showToast(message, type = 'info') {
    const existingToast = document.querySelector('.bd-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `bd-toast bd-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('bd-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('bd-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Called when feature is unregistered
  destroy() {
    this.applyRunId++;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.animationCheckTimer) {
      clearTimeout(this.animationCheckTimer);
    }
  }

  // Wait for gameplay container to exist
  waitForContainer() {
    const container = this.findStoryContainer();
    if (container) {
      this.startObserving();
      this.processElements();
    } else {
      setTimeout(() => this.waitForContainer(), 500);
    }
  }

  // Start observing DOM changes
  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      let shouldProcess = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (this.isInputElement(node)) continue;
            if (this.isRelevantNode(node)) {
              shouldProcess = true;
              break;
            }
          }
        }

        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          if (parent && this.isInStoryContainer(parent)) {
            shouldProcess = true;
          }
        }

        if (shouldProcess) break;
      }

      if (shouldProcess) {
        this.debouncedProcess();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // Check if node is relevant to this feature
  isRelevantNode(node) {
    if (this.isInStoryContainer(node)) return true;
    if (node.querySelector && node.querySelector(this.storyContainerSelector)) return true;
    return false;
  }

  // Check if element is in story container
  isInStoryContainer(element) {
    const container = this.findStoryContainer();
    return container && container.contains(element);
  }

  // Debounced processing
  debouncedProcess() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.safeProcess();
    }, 100);
  }

  // Check for active word-fade animations
  hasActiveAnimations() {
    const container = this.findStoryContainer();
    if (!container) return false;
    return container.querySelectorAll('.word-fade').length > 0;
  }

  // Wait for animations before processing
  safeProcess() {
    if (this.hasActiveAnimations()) {
      if (this.animationCheckTimer) {
        clearTimeout(this.animationCheckTimer);
      }
      this.animationCheckTimer = setTimeout(() => {
        this.safeProcess();
      }, 100);
      return;
    }
    this.processElements();
  }

  // Process all unprocessed elements
  processElements() {
    const container = this.findStoryContainer();
    if (!container) return 0;

    const elements = this.findStoryTextElements(container);
    let processedCount = 0;

    elements.forEach(element => {
      if (element.getAttribute(MarkdownFeature.PROCESSED_ATTR) === 'true') return;
      if (this.isInputElement(element)) return;

      if (this.convertMarkdown(element)) {
        processedCount++;
      }
    });

    return processedCount;
  }

  // ==================== Element Finding ====================

  findStoryContainer() {
    return document.querySelector(this.storyContainerSelector);
  }

  findStoryTextElements(container = document) {
    return container.querySelectorAll(this.storyTextSelectors);
  }

  isStoryTextElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const gameplayOutput = document.querySelector(this.storyContainerSelector);
    if (!gameplayOutput || !gameplayOutput.contains(element)) return false;

    if (element.id === 'transition-opacity') return true;

    const parent = element.parentElement;
    if (parent && parent.id === 'transition-opacity' && element.tagName === 'SPAN') {
      return true;
    }

    return false;
  }

  isInputElement(element) {
    if (!element) return false;
    return element.tagName === 'TEXTAREA' || element.tagName === 'INPUT';
  }

  // ==================== Markdown Conversion ====================

  hasMarkdownSyntax(text) {
    if (!text) return false;

    const markdownIndicators = [
      /\+\+\/\/[^\n]+?\/\/\+\+/, // Bold italic ++//text//++
      /(?<![+])\+\+[^+\n]+?\+\+(?![+])/, // Bold ++text++
      /(?<![:/])\/\/[^/\n]+?\/\/(?![/])/, // Italic //text//
    ];

    return markdownIndicators.some(pattern => pattern.test(text));
  }

  // Check if element contains icons or other HTML elements that should be preserved
  containsPreservableElements(element) {
    if (!element) return false;
    // Check for SVG icons, icon classes (like AI Dungeon's w_triangle_warn), or any nested SVG/icon elements
    const preservableSelectors = [
      'svg',
      '[class*="icon"]',
      '[class*="w_"]',  // AI Dungeon's icon class naming convention (e.g., w_triangle_warn)
      'i[class]',       // Common icon element pattern
      'img'
    ];
    return element.querySelector(preservableSelectors.join(', ')) !== null;
  }

  convertMarkdown(element) {
    try {
      if (!element) return false;

      if (element.getAttribute(MarkdownFeature.PROCESSED_ATTR) === 'true') {
        return false;
      }

      // Skip elements that contain icons or other HTML that should be preserved
      if (this.containsPreservableElements(element)) {
        return false;
      }

      const originalText = element.textContent || '';
      if (!originalText || originalText.trim() === '') return false;

      if (!this.hasMarkdownSyntax(originalText)) {
        return false;
      }

      const html = this.formatText(originalText);

      if (html !== originalText && element.parentNode && document.contains(element)) {
        element.innerHTML = html;
        element.setAttribute(MarkdownFeature.PROCESSED_ATTR, 'true');
        element.classList.add('bd-markdown');
        return true;
      }

      return false;
    } catch (error) {
      console.warn('MarkdownFeature: Error in convertMarkdown:', error);
      return false;
    }
  }

  formatText(text) {
    if (!text) return text;

    let html = this.escapeHtml(text);

    // Bold italic: ++//text//++
    html = html.replace(/\+\+\/\/([^\n]+?)\/\/\+\+/g, '<strong><em>$1</em></strong>');
    
    // Bold: ++text++
    html = html.replace(/(?<![+])\+\+([^+\n]+?)\+\+(?![+])/g, '<strong>$1</strong>');

    // Italic: //text//
    html = html.replace(/(?<![:/])\/\/([^/\n]+?)\/\/(?![/])/g, '<em>$1</em>');

    return html;
  }

  escapeHtml(text) {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
    };
    return text.replace(/[&<>]/g, char => escapeMap[char]);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarkdownFeature;
}
