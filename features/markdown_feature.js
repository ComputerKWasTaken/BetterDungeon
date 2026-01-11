// BetterDungeon - features/markdown_feature.js
// Self-contained markdown formatting feature with its own DOM observation

class MarkdownFeature {
  static id = 'markdown';
  static PROCESSED_ATTR = 'data-bd-processed';
  static ORIGINAL_ATTR = 'data-bd-original';

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
  }

  // Called when feature is registered
  async init() {
    console.log('MarkdownFeature: Initializing...');
    await this.loadAutoApplySetting();
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
    this.waitForContainer();
  }

  async loadAutoApplySetting() {
    try {
      const result = await chrome.storage.sync.get('betterDungeon_autoApplyInstructions');
      this.autoApplyEnabled = result.betterDungeon_autoApplyInstructions ?? false;
      console.log('MarkdownFeature: Auto-apply setting:', this.autoApplyEnabled);
    } catch (e) {
      this.autoApplyEnabled = false;
    }
  }

  setAutoApply(enabled) {
    this.autoApplyEnabled = enabled;
    chrome.storage.sync.set({ betterDungeon_autoApplyInstructions: enabled });
    console.log('MarkdownFeature: Auto-apply set to:', enabled);
  }

  detectCurrentAdventure() {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    const newAdventureId = match ? match[1] : null;
    const adventureChanged = this.currentAdventureId !== newAdventureId;
    
    // Auto-apply when entering a new adventure
    if (newAdventureId && adventureChanged && this.autoApplyEnabled) {
      console.log('MarkdownFeature: Auto-applying instructions for new adventure...');
      setTimeout(() => this.applyInstructionsWithLoadingScreen(), 2500);
    }
    
    this.currentAdventureId = newAdventureId;
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

    // Use queue to ensure sequential execution with other features
    return loadingScreen.queueOperation(() => this._doApplyInstructions());
  }

  async _doApplyInstructions() {
    loadingScreen.show({
      title: 'Applying Instructions',
      subtitle: 'Preparing...',
      showProgress: false
    });

    try {
      if (typeof AIDungeonService === 'undefined') {
        throw new Error('AIDungeonService not available');
      }

      const service = new AIDungeonService();
      
      loadingScreen.updateSubtitle('Loading instruction file...');
      const instructionsResult = await service.fetchInstructionsFile();
      
      if (!instructionsResult.success) {
        throw new Error(instructionsResult.error || 'Failed to fetch instructions');
      }

      loadingScreen.updateSubtitle('Opening adventure settings...');
      await this.wait(300);
      
      // Pass a callback to update loading screen during component creation
      const applyResult = await service.applyInstructionsToTextareas(instructionsResult.data, {
        onCreatingComponents: () => {
          loadingScreen.updateSubtitle('Creating plot components...');
        }
      });
      
      if (!applyResult.success) {
        throw new Error(applyResult.error || 'Failed to apply instructions');
      }

      // Handle different outcomes
      if (applyResult.alreadyApplied) {
        loadingScreen.updateTitle('Already Applied');
        loadingScreen.updateSubtitle('Markdown instructions are already present');
        await this.wait(1200);
        return { success: true, alreadyApplied: true };
      }

      if (applyResult.appliedCount === 0) {
        loadingScreen.updateTitle('Already Applied');
        loadingScreen.updateSubtitle('Instructions were already in place');
        await this.wait(1200);
        return { success: true, alreadyApplied: true };
      }

      loadingScreen.updateTitle('Instructions Applied!');
      if (applyResult.componentsCreated) {
        loadingScreen.updateSubtitle('Created plot components & added instructions');
      } else if (applyResult.appliedCount === 2) {
        loadingScreen.updateSubtitle('Added to AI Instructions & Author\'s Note');
      } else {
        loadingScreen.updateSubtitle('Markdown formatting guidelines are now active');
      }
      
      await this.wait(1500);
      
      return { success: true };

    } catch (error) {
      console.error('MarkdownFeature: Apply instructions error:', error);
      loadingScreen.updateTitle('Failed to Apply');
      loadingScreen.updateSubtitle(error.message);
      
      await this.wait(2000);
      
      return { success: false, error: error.message };

    } finally {
      loadingScreen.hide();
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Called when feature is unregistered
  destroy() {
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
    console.log('MarkdownFeature: Destroyed');
  }

  // Wait for gameplay container to exist
  waitForContainer() {
    const container = this.findStoryContainer();
    if (container) {
      console.log('MarkdownFeature: Found gameplay container');
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

    console.log('MarkdownFeature: Observer started');
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

    if (processedCount > 0) {
      console.log(`MarkdownFeature: Processed ${processedCount} element(s)`);
    }

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
      /___.+?___/,         // Bold Italic ___text___
      /(?:^|[^_])__.+?__(?:[^_]|$)/, // Bold __text__
      /(?:^|[^_])_[^_]+?_(?:[^_]|$)/, // Italic _text_
      /==.+?==/,           // Underline ==text==
      /\^.+?\^/,           // Superscript ^text^
      /(?:^|[^~])~[^~]+?~(?:[^~]|$)/, // Subscript ~text~
      /^\s*[-]{3,}\s*$/m,  // Horizontal rules ---
      /^\s*[-]\s/m,        // Unordered lists
    ];

    return markdownIndicators.some(pattern => pattern.test(text));
  }

  convertMarkdown(element) {
    try {
      if (!element) return false;

      if (element.getAttribute(MarkdownFeature.PROCESSED_ATTR) === 'true') {
        return false;
      }

      const originalText = element.textContent || '';
      if (!originalText || originalText.trim() === '') return false;

      if (!this.hasMarkdownSyntax(originalText)) {
        return false;
      }

      element.setAttribute(MarkdownFeature.ORIGINAL_ATTR, originalText);

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

    // Bold + Italic: ___text___
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

    // Bold + Underline: __==text==__ or ==__text__==
    html = html.replace(/__==(.+?)==__/g, '<strong><u>$1</u></strong>');
    html = html.replace(/==__(.+?)__==/g, '<u><strong>$1</strong></u>');
    
    // Bold: __text__ (not preceded/followed by another _)
    html = html.replace(/(^|[^_])__([^_]+?)__([^_]|$)/g, '$1<strong>$2</strong>$3');

    // Italic: _text_ (not preceded/followed by another _)
    html = html.replace(/(^|[^_])_([^_]+?)_([^_]|$)/g, '$1<em>$2</em>$3');

    // Underline: ==text==
    html = html.replace(/==(.+?)==/g, '<u>$1</u>');

    // Superscript: ^text^
    html = html.replace(/\^(.+?)\^/g, '<sup class="bd-superscript">$1</sup>');

    // Subscript: ~text~ (not preceded/followed by another ~)
    html = html.replace(/(^|[^~])~([^~]+?)~([^~]|$)/g, '$1<sub class="bd-subscript">$2</sub>$3');

    // Horizontal rules (--- only, no underscores to avoid conflicts)
    html = html.replace(/^(\s*)[-]{3,}\s*$/gm, '$1<hr class="bd-hr">');

    // Unordered lists
    html = this.processLists(html);

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

  // Headers and blockquotes removed - they conflict with AI Dungeon's command system
  // # headers are treated as commands by the AI
  // > blockquotes conflict with player action syntax

  processLists(html) {
    // Unordered lists: - item (minus sign only)
    // Each line starting with - followed by space becomes a bullet point
    html = html.replace(/^(\s*)[-]\s+(.+)$/gm, '$1<span class="bd-list-item">• $2</span>');
    return html;
  }

  restoreOriginal(element) {
    if (!element) return;

    const original = element.getAttribute(MarkdownFeature.ORIGINAL_ATTR);
    if (original) {
      element.textContent = original;
      element.removeAttribute(MarkdownFeature.PROCESSED_ATTR);
      element.removeAttribute(MarkdownFeature.ORIGINAL_ATTR);
      element.classList.remove('bd-markdown');
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarkdownFeature;
}
