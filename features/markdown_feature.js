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
  }

  // Called when feature is registered
  init() {
    console.log('MarkdownFeature: Initializing...');
    this.waitForContainer();
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
      /\{\{.+?\}\}/,      // Bold {{text}}
      /(?<!_)_(?!_).+?(?<!_)_(?!_)/, // Italic _text_
      /\+\+.+?\+\+/,      // Underline ++text++
      /~~.+?~~/,          // Strikethrough ~~text~~
      /^#{1,6}\s/m,       // Headers # ## ###
      /^\s*[-+]\s/m,      // Lists
      /^\s*>/m,           // Blockquotes
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

    // Headers (must be at start of line)
    html = this.processHeaders(html);

    // Bold + Underline: {{++text++}}
    html = html.replace(/\{\{\+\+(.+?)\+\+\}\}/g, '<strong><u>$1</u></strong>');

    // Bold + Italic: {{_text_}}
    html = html.replace(/\{\{_(.+?)_\}\}/g, '<strong><em>$1</em></strong>');
    
    // Bold: {{text}}
    html = html.replace(/\{\{(.+?)\}\}/g, '<strong>$1</strong>');

    // Italic: _text_
    html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

    // Underline: ++text++
    html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');

    // Strikethrough: ~~text~~
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // Blockquotes
    html = this.processBlockquotes(html);

    // Horizontal rules
    html = html.replace(/^(\s*)([-_]){3,}\s*$/gm, '$1<hr class="bd-hr">');

    // Lists
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

  processHeaders(html) {
    html = html.replace(/^(\s*)######\s+(.+)$/gm, '$1<span class="bd-h6">$2</span>');
    html = html.replace(/^(\s*)#####\s+(.+)$/gm, '$1<span class="bd-h5">$2</span>');
    html = html.replace(/^(\s*)####\s+(.+)$/gm, '$1<span class="bd-h4">$2</span>');
    html = html.replace(/^(\s*)###\s+(.+)$/gm, '$1<span class="bd-h3">$2</span>');
    html = html.replace(/^(\s*)##\s+(.+)$/gm, '$1<span class="bd-h2">$2</span>');
    html = html.replace(/^(\s*)#\s+(.+)$/gm, '$1<span class="bd-h1">$2</span>');
    return html;
  }

  processBlockquotes(html) {
    const lines = html.split('\n');
    const result = [];
    let inBlockquote = false;
    let blockquoteContent = [];

    for (const line of lines) {
      const match = line.match(/^(\s*)&gt;\s?(.*)$/);
      if (match) {
        if (!inBlockquote) {
          inBlockquote = true;
          blockquoteContent = [];
        }
        blockquoteContent.push(match[1] + match[2]);
      } else {
        if (inBlockquote) {
          result.push(`<span class="bd-blockquote">${blockquoteContent.join('\n')}</span>`);
          inBlockquote = false;
          blockquoteContent = [];
        }
        result.push(line);
      }
    }

    if (inBlockquote) {
      result.push(`<span class="bd-blockquote">${blockquoteContent.join('\n')}</span>`);
    }

    return result.join('\n');
  }

  processLists(html) {
    // Use - or + only (no asterisk) for list markers
    html = html.replace(/^(\s*)[-+]\s+(.+)$/gm, '$1<span class="bd-list-item">• $2</span>');
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
