// BetterDungeon - Trigger Highlight Feature
// Highlights story card triggers in the Adventure context viewer

class TriggerHighlightFeature {
  static id = 'triggerHighlight';

  constructor() {
    this.observer = null;
    this.contextObserver = null;
    this.triggerScanObserver = null;
    // Map of trigger -> card name (session-only, not persisted)
    this.cachedTriggers = new Map();
    this.processedElements = new WeakSet();
    this.scanDebounceTimer = null;
    // Track current adventure to clear triggers on adventure change
    this.currentAdventureId = null;
  }

  async init() {
    console.log('TriggerHighlightFeature: Initializing...');
    // Load auto-scan setting FIRST before detecting adventure
    await this.loadAutoScanSetting();
    this.detectCurrentAdventure();
    this.startObserving();
    this.startTriggerScanning();
    this.startAdventureChangeDetection();
    // Initial scan for triggers
    this.scanForTriggers();
  }

  async loadAutoScanSetting() {
    try {
      const result = await chrome.storage.sync.get('betterDungeon_autoScanTriggers');
      this.autoScanEnabled = result.betterDungeon_autoScanTriggers ?? false;
      console.log('TriggerHighlightFeature: Auto-scan setting:', this.autoScanEnabled);
    } catch (e) {
      this.autoScanEnabled = false;
    }
  }

  setAutoScan(enabled) {
    this.autoScanEnabled = enabled;
    chrome.storage.sync.set({ betterDungeon_autoScanTriggers: enabled });
    console.log('TriggerHighlightFeature: Auto-scan set to:', enabled);
  }

  // Detect adventure ID from URL to scope triggers
  detectCurrentAdventure(isInitial = false) {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    const newAdventureId = match ? match[1] : null;
    const adventureChanged = this.currentAdventureId !== newAdventureId;
    
    // If adventure changed, clear triggers
    if (adventureChanged && this.currentAdventureId !== null) {
      console.log('TriggerHighlightFeature: Adventure changed, clearing triggers');
      this.cachedTriggers.clear();
      this.processedElements = new WeakSet();
    }
    
    // Auto-scan when entering a new adventure (either on change or initial load)
    if (newAdventureId && adventureChanged && this.autoScanEnabled) {
      console.log('TriggerHighlightFeature: Auto-scanning adventure...');
      // Delay to let the adventure page load
      setTimeout(() => this.scanAllStoryCards(), 2000);
    }
    
    this.currentAdventureId = newAdventureId;
    console.log('TriggerHighlightFeature: Current adventure:', this.currentAdventureId);
  }

  // Scan all story cards automatically using the loading screen
  async scanAllStoryCards() {
    if (typeof loadingScreen === 'undefined' || typeof storyCardScanner === 'undefined') {
      console.error('TriggerHighlightFeature: Loading screen or scanner not available');
      return { success: false, error: 'Required services not loaded' };
    }

    // Use queue to ensure sequential execution with other features
    return loadingScreen.queueOperation(() => this._doScanStoryCards());
  }

  async _doScanStoryCards() {
    // Show loading screen
    loadingScreen.show({
      title: 'Scanning Story Cards',
      subtitle: 'Preparing to scan...',
      showProgress: true
    });

    try {
      const result = await storyCardScanner.scanAllCards(
        // onTriggerFound callback
        (trigger, cardName) => {
          // Add to our cached triggers
          const existingCard = this.cachedTriggers.get(trigger);
          if (existingCard && existingCard !== cardName && !existingCard.includes(cardName)) {
            this.cachedTriggers.set(trigger, `${existingCard}, ${cardName}`);
          } else if (!existingCard) {
            this.cachedTriggers.set(trigger, cardName);
          }
        },
        // onProgress callback
        (current, total, status) => {
          loadingScreen.updateProgress(current, total, status);
        }
      );

      if (result.success) {
        loadingScreen.updateTitle('Scan Complete!');
        loadingScreen.updateSubtitle(`Found ${this.cachedTriggers.size} unique triggers`);
        loadingScreen.updateStatus('✓ Ready to highlight');
        
        console.log('TriggerHighlightFeature: Scan complete, triggers:', Object.fromEntries(this.cachedTriggers));
        
        // Brief delay to show completion
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        loadingScreen.updateTitle('Scan Failed');
        loadingScreen.updateSubtitle(result.error || 'Unknown error');
        loadingScreen.updateStatus('✗ Error');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      return result;

    } catch (error) {
      console.error('TriggerHighlightFeature: Scan error:', error);
      loadingScreen.updateTitle('Scan Failed');
      loadingScreen.updateSubtitle(error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { success: false, error: error.message };

    } finally {
      loadingScreen.hide();
    }
  }

  // Watch for URL/adventure changes
  startAdventureChangeDetection() {
    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', () => this.detectCurrentAdventure());
    
    // Also watch for URL changes via history API
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

  destroy() {
    console.log('TriggerHighlightFeature: Destroying...');
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.contextObserver) {
      this.contextObserver.disconnect();
      this.contextObserver = null;
    }
    if (this.triggerScanObserver) {
      this.triggerScanObserver.disconnect();
      this.triggerScanObserver = null;
    }
    if (this.scanDebounceTimer) {
      clearTimeout(this.scanDebounceTimer);
    }
    this.cachedTriggers.clear();
    this.removeHighlights();
  }

  // Continuously scan for triggers as the page changes
  startTriggerScanning() {
    if (this.triggerScanObserver) {
      this.triggerScanObserver.disconnect();
    }

    this.triggerScanObserver = new MutationObserver((mutations) => {
      // Debounce scanning to avoid excessive calls
      if (this.scanDebounceTimer) {
        clearTimeout(this.scanDebounceTimer);
      }
      this.scanDebounceTimer = setTimeout(() => {
        this.scanForTriggers();
      }, 500);
    });

    this.triggerScanObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['value']
    });
  }

  // Scan the entire page for trigger values
  scanForTriggers() {
    const previousCount = this.cachedTriggers.size;
    
    // Look for TRIGGERS label and associated inputs
    document.querySelectorAll('p.is_Paragraph').forEach(p => {
      const text = p.textContent?.trim().toUpperCase() || '';
      if (text === 'TRIGGERS' || text === 'TRIGGER') {
        const container = p.closest('.is_Column') || p.parentElement;
        if (container) {
          // Try to find the card name from the modal/editor
          const cardName = this.findCardName(container);
          
          container.querySelectorAll('input, textarea').forEach(input => {
            if (input.value) {
              this.parseTriggers(input.value, cardName);
            }
          });
        }
      }
    });

    // Also scan all inputs on the page for ones that look like trigger fields
    document.querySelectorAll('input, textarea').forEach(input => {
      const value = input.value || '';
      if (!value) return;
      
      // Check if this input is in a container with a TRIGGERS label
      const container = input.closest('.is_Column');
      if (container) {
        const labels = container.querySelectorAll('p.is_Paragraph');
        for (const label of labels) {
          if (label.textContent?.trim().toUpperCase() === 'TRIGGERS') {
            const cardName = this.findCardName(container);
            this.parseTriggers(value, cardName);
            break;
          }
        }
      }
    });

    if (this.cachedTriggers.size !== previousCount) {
      console.log('TriggerHighlightFeature: Triggers updated:', Object.fromEntries(this.cachedTriggers));
    }
  }

  // Find the story card name from the current editor/modal context
  findCardName(triggerContainer) {
    // Look for the card name in the modal header or nearby elements
    // The card name is typically in an h1 or prominent text element
    
    // Method 1: Look for a modal/dialog ancestor and find its header
    const modal = triggerContainer.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
    if (modal) {
      // Look for the card name - usually in header area
      const header = modal.querySelector('h1, [role="heading"]');
      if (header) {
        const name = header.textContent?.trim();
        // Skip generic headers like "Adventure", "Story Cards", etc.
        if (name && !['Adventure', 'Story Cards', 'Settings'].includes(name)) {
          return name;
        }
      }
      
      // Also check for input fields that might contain the card name
      // Card name is often the first prominent text or in a specific input
      const nameInput = modal.querySelector('input[placeholder*="name"], input[placeholder*="Name"]');
      if (nameInput?.value) {
        return nameInput.value.trim();
      }
    }
    
    // Method 2: Look for nearby heading elements
    let parent = triggerContainer.parentElement;
    for (let i = 0; i < 10 && parent; i++) {
      const heading = parent.querySelector('h1, h2, [role="heading"]');
      if (heading) {
        const name = heading.textContent?.trim();
        if (name && name.length < 100 && !['Adventure', 'Story Cards', 'Settings', 'TRIGGERS', 'DETAILS'].includes(name)) {
          return name;
        }
      }
      parent = parent.parentElement;
    }
    
    // Method 3: Look for the card title in the page structure
    // Story card editors often have the name displayed prominently
    const allHeadings = document.querySelectorAll('h1, [role="heading"]');
    for (const h of allHeadings) {
      const text = h.textContent?.trim();
      // Check if this looks like a card name (not a section header)
      if (text && text.length > 0 && text.length < 50 && 
          !['Adventure', 'Story Cards', 'Settings', 'TRIGGERS', 'DETAILS', 'GENERATOR SETTINGS', 'NOTES'].includes(text.toUpperCase())) {
        // Check if this heading is in a visible modal context
        const headingModal = h.closest('[role="dialog"], [role="alertdialog"]');
        if (headingModal && headingModal.contains(triggerContainer)) {
          return text;
        }
      }
    }
    
    return 'Unknown Card';
  }

  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check for Adventure context viewer modal
              if (this.isAdventureModal(node)) {
                this.handleAdventureModal(node);
              } else if (node.querySelector) {
                const modal = node.querySelector('[aria-label="Modal"]');
                if (modal && this.isAdventureModal(modal)) {
                  this.handleAdventureModal(modal);
                }
              }
            }
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Check if modal is already open
    const existingModal = document.querySelector('[aria-label="Modal"]');
    if (existingModal && this.isAdventureModal(existingModal)) {
      this.handleAdventureModal(existingModal);
    }

    console.log('TriggerHighlightFeature: Observer started');
  }

  isAdventureModal(element) {
    // Check if this modal has "Adventure" as its header
    const header = element.querySelector('h1[role="heading"]');
    return header && header.textContent.trim() === 'Adventure';
  }

  handleAdventureModal(modal) {
    console.log('TriggerHighlightFeature: Adventure modal detected');
    console.log('TriggerHighlightFeature: Current cached triggers:', Array.from(this.cachedTriggers));
    
    // Do a fresh scan in case triggers changed
    this.scanForTriggers();
    
    // Highlight triggers in the adventure text
    this.highlightTriggersInModal(modal);
    
    // Watch for tab changes within the modal
    this.watchModalForChanges(modal);
  }

  parseTriggers(value, cardName = 'Unknown Card') {
    if (!value || typeof value !== 'string') return;
    
    // Split by comma and clean up each trigger
    const triggers = value.split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0 && t.length < 50); // Filter out empty or very long strings
    
    triggers.forEach(trigger => {
      if (trigger && !this.isCommonWord(trigger)) {
        // Store trigger with its card name
        // If trigger already exists, append card name if different
        const existingCard = this.cachedTriggers.get(trigger);
        if (existingCard && existingCard !== cardName && !existingCard.includes(cardName)) {
          this.cachedTriggers.set(trigger, `${existingCard}, ${cardName}`);
        } else if (!existingCard) {
          this.cachedTriggers.set(trigger, cardName);
        }
      }
    });
  }

  isCommonWord(word) {
    // Filter out common words that are unlikely to be intentional triggers
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'dare', 'ought', 'used', 'this', 'that', 'these', 'those', 'i', 'you',
      'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom',
      'trigger', 'triggers', 'when', 'where', 'why', 'how'
    ]);
    return commonWords.has(word.toLowerCase());
  }

  highlightTriggersInModal(modal) {
    if (this.cachedTriggers.size === 0) {
      console.log('TriggerHighlightFeature: No triggers to highlight');
      console.log('TriggerHighlightFeature: Cached triggers map:', Object.fromEntries(this.cachedTriggers));
      return;
    }
    console.log('TriggerHighlightFeature: Highlighting with triggers:', Object.fromEntries(this.cachedTriggers));

    // Find the story text content within the Adventure modal
    // The story text is in a scrollable area with font_mono class
    const storyTextElements = modal.querySelectorAll('.font_mono.is_Paragraph');
    
    storyTextElements.forEach(element => {
      if (!this.processedElements.has(element)) {
        this.highlightElement(element);
        this.processedElements.add(element);
      }
    });
  }

  highlightElement(element) {
    if (!element || !element.textContent) return;
    
    const originalText = element.textContent;
    let html = this.escapeHtml(originalText);
    
    // Sort triggers by length (longest first) to avoid partial replacements
    const sortedTriggers = Array.from(this.cachedTriggers.keys())
      .sort((a, b) => b.length - a.length);
    
    // Create a regex pattern for all triggers
    sortedTriggers.forEach(trigger => {
      const cardName = this.cachedTriggers.get(trigger) || 'Unknown Card';
      // Escape the card name for use in HTML attribute
      const escapedCardName = this.escapeHtml(cardName);
      
      // Case-insensitive word boundary match
      const escapedTrigger = this.escapeRegExp(trigger);
      const regex = new RegExp(`\\b(${escapedTrigger})\\b`, 'gi');
      html = html.replace(regex, `<span class="bd-trigger-highlight" data-card-name="${escapedCardName}">$1</span>`);
    });
    
    // Only update if we made changes
    if (html !== this.escapeHtml(originalText)) {
      element.innerHTML = html;
      console.log('TriggerHighlightFeature: Highlighted triggers in element');
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  watchModalForChanges(modal) {
    if (this.contextObserver) {
      this.contextObserver.disconnect();
    }

    this.contextObserver = new MutationObserver((mutations) => {
      // Re-highlight when content changes (e.g., switching tabs)
      let shouldReprocess = false;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          shouldReprocess = true;
          break;
        }
      }
      
      if (shouldReprocess) {
        // Small delay to let DOM settle
        setTimeout(() => {
          this.highlightTriggersInModal(modal);
        }, 100);
      }
    });

    this.contextObserver.observe(modal, {
      childList: true,
      subtree: true
    });
  }

  removeHighlights() {
    // Remove all highlight spans and restore original text
    document.querySelectorAll('.bd-trigger-highlight').forEach(span => {
      const parent = span.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize(); // Merge adjacent text nodes
      }
    });
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.TriggerHighlightFeature = TriggerHighlightFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TriggerHighlightFeature;
}
