// BetterDungeon - Trigger Highlight Feature
// Highlights story card triggers in the Adventure context viewer

class TriggerHighlightFeature {
  static id = 'triggerHighlight';

  constructor() {
    this.observer = null;
    this.contextObserver = null;
    this.triggerScanObserver = null;
    // Map of trigger -> card name (persisted to chrome.storage.local per adventure)
    this.cachedTriggers = new Map();
    this.processedElements = new WeakSet();
    this.scanDebounceTimer = null;
    // Track current adventure to clear triggers on adventure change
    this.currentAdventureId = null;
    // Suggested triggers settings
    this.suggestedTriggersEnabled = true;
    this.suggestedTriggerThreshold = 3; // Minimum occurrences to suggest
    // Cache for noun frequencies in current context
    this.nounFrequencies = new Map();
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  // ── Storage helpers ────────────────────────────────────────────────
  // Wrap chrome.storage in Promises so they work on both the Chrome
  // extension (MV3 Promise API) and the mobile WebView polyfill
  // (callback-only API).

  _storageGet(storageArea, keys) {
    return new Promise((resolve) => {
      try {
        storageArea.get(keys, (data) => resolve(data || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  _storageSet(storageArea, items) {
    return new Promise((resolve) => {
      try {
        storageArea.set(items, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  // ── Trigger cache persistence ─────────────────────────────────────
  // Keyed by adventure ID so triggers survive across modal opens,
  // tab switches, and page state changes within the same adventure.

  async saveTriggerCache() {
    if (!this.currentAdventureId || this.cachedTriggers.size === 0) return;
    const key = `bd_triggers_${this.currentAdventureId}`;
    const data = Object.fromEntries(this.cachedTriggers);
    await this._storageSet(chrome.storage.local, { [key]: data });
    console.log(`[TriggerHighlight] Saved ${this.cachedTriggers.size} triggers to storage for adventure ${this.currentAdventureId}`);
  }

  async loadTriggerCache() {
    if (!this.currentAdventureId) return;
    const key = `bd_triggers_${this.currentAdventureId}`;
    const result = await this._storageGet(chrome.storage.local, [key]);
    const data = result[key];
    if (data && typeof data === 'object') {
      let loaded = 0;
      for (const [trigger, cardName] of Object.entries(data)) {
        if (!this.cachedTriggers.has(trigger)) {
          this.cachedTriggers.set(trigger, cardName);
          loaded++;
        }
      }
      if (loaded > 0) {
        console.log(`[TriggerHighlight] Loaded ${loaded} triggers from storage (total: ${this.cachedTriggers.size})`);
      }
    }
  }

  async init() {
    console.log('[TriggerHighlight] Initializing Trigger Highlight feature...');
    // Load auto-scan setting FIRST before detecting adventure
    await this.loadAutoScanSetting();
    this.detectCurrentAdventure();
    // Load any previously-saved triggers for this adventure
    await this.loadTriggerCache();
    console.log(`[TriggerHighlight] Initialized — ${this.cachedTriggers.size} cached triggers for adventure ${this.currentAdventureId || '(none)'}`);
    this.startObserving();
    this.startTriggerScanning();
    this.startAdventureChangeDetection();
    // Initial scan for triggers
    this.scanForTriggers();
  }

  async loadAutoScanSetting() {
    try {
      const result = await this._storageGet(chrome.storage.sync, [
        'betterDungeon_autoScanTriggers',
        'betterDungeon_suggestedTriggers',
        'betterDungeon_suggestedTriggerThreshold'
      ]);
      this.autoScanEnabled = result.betterDungeon_autoScanTriggers ?? false;
      this.suggestedTriggersEnabled = result.betterDungeon_suggestedTriggers ?? true;
      this.suggestedTriggerThreshold = result.betterDungeon_suggestedTriggerThreshold ?? 3;
    } catch (e) {
      this.autoScanEnabled = false;
      this.suggestedTriggersEnabled = true;
      this.suggestedTriggerThreshold = 3;
    }
  }

  setAutoScan(enabled) {
    this.autoScanEnabled = enabled;
    chrome.storage.sync.set({ betterDungeon_autoScanTriggers: enabled });
  }

  setSuggestedTriggers(enabled) {
    this.suggestedTriggersEnabled = enabled;
    chrome.storage.sync.set({ betterDungeon_suggestedTriggers: enabled });
  }

  setSuggestedTriggerThreshold(threshold) {
    this.suggestedTriggerThreshold = Math.max(2, Math.min(10, threshold));
    chrome.storage.sync.set({ betterDungeon_suggestedTriggerThreshold: this.suggestedTriggerThreshold });
  }

  // Detect adventure ID from URL to scope triggers
  detectCurrentAdventure(isInitial = false) {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    const newAdventureId = match ? match[1] : null;
    const adventureChanged = this.currentAdventureId !== newAdventureId;
    
    // If adventure changed, clear triggers and reset scanner
    if (adventureChanged && this.currentAdventureId !== null) {
      this.cachedTriggers.clear();
      this.processedElements = new WeakSet();
      
      // Also reset the scanner state for the new adventure
      if (typeof storyCardScanner !== 'undefined') {
        storyCardScanner.reset();
      }
    }
    
    // Auto-scan when entering a new adventure (either on change or initial load)
    if (newAdventureId && adventureChanged && this.autoScanEnabled) {
      // Delay to let the adventure page load fully
      setTimeout(() => this.scanAllStoryCards(), 2500);
    }
    
    this.currentAdventureId = newAdventureId;

    // Load any previously-saved triggers for the new adventure
    if (newAdventureId && adventureChanged) {
      this.loadTriggerCache();
    }
  }

  // Scan all story cards automatically using the loading screen
  async scanAllStoryCards() {
    // Check service availability first
    if (typeof loadingScreen === 'undefined' || typeof storyCardScanner === 'undefined') {
      console.error('TriggerHighlightFeature: Loading screen or scanner not available');
      return { success: false, error: 'Required services not loaded' };
    }

    // Pre-validate page state BEFORE queueing/showing loading screen
    const validation = storyCardScanner.validatePageState();
    if (!validation.valid) {
      console.warn('TriggerHighlightFeature: Cannot scan -', validation.error);
      return { success: false, error: validation.error };
    }

    // Use queue to ensure sequential execution with other features
    return loadingScreen.queueOperation(() => this._doScanStoryCards());
  }

  async _doScanStoryCards() {
    // Double-check page state in case it changed while queued
    const validation = storyCardScanner.validatePageState();
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Show loading screen with cancel button
    loadingScreen.show({
      title: 'Scanning Story Cards',
      subtitle: 'Initializing...',
      showProgress: true,
      showCancel: true,
      onCancel: () => {
        storyCardScanner.abort();
      }
    });

    try {
      // First, navigate to the Story Cards tab autonomously
      if (typeof AIDungeonService !== 'undefined') {
        const service = new AIDungeonService();
        const navResult = await service.navigateToStoryCardsSettings({
          onStepUpdate: (message) => {
            loadingScreen.updateSubtitle(message);
          }
        });
        
        if (!navResult.success) {
          throw new Error(navResult.error || 'Failed to navigate to Story Cards');
        }
        
        // Wait for Story Cards content to load
        loadingScreen.updateSubtitle('Loading story cards...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      loadingScreen.updateSubtitle('Starting scan...');
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
        (current, total, status, estimatedTimeRemaining) => {
          let progressText = status;
          if (estimatedTimeRemaining !== null && estimatedTimeRemaining > 0) {
            const minutes = Math.floor(estimatedTimeRemaining / 60);
            const seconds = estimatedTimeRemaining % 60;
            if (minutes > 0) {
              progressText += ` (${minutes}m ${seconds}s remaining)`;
            } else {
              progressText += ` (${seconds}s remaining)`;
            }
          }
          // Update subtitle to show actual progress
          loadingScreen.updateSubtitle(`Scanning card ${current} of ${total}`);
          loadingScreen.updateProgress(current, total, progressText);
        }
      );

      if (result.success) {
        console.log(`[TriggerHighlight] Scan complete — ${this.cachedTriggers.size} triggers in cache`);
        // Persist triggers so they survive page state changes
        await this.saveTriggerCache();
        loadingScreen.updateTitle('Scan Complete!');
        loadingScreen.updateSubtitle(`Found ${this.cachedTriggers.size} unique triggers`);
        loadingScreen.updateStatus('Ready to highlight', 'success');
        
        
        // Brief delay to show completion
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // Check if scan was aborted
        if (result.error && result.error.includes('aborted')) {
          loadingScreen.updateTitle('Scan Cancelled');
          loadingScreen.updateSubtitle('Scan was stopped by user');
          loadingScreen.updateStatus('Cancelled', 'success');
        } else {
          loadingScreen.updateTitle('Scan Failed');
          loadingScreen.updateSubtitle(result.error || 'Unknown error');
          loadingScreen.updateStatus('Error', 'error');
        }
        
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
    this.log('[TriggerHighlight] Passive scan running...');

    // Method 1 (Primary): Use stable aria-labelledby selector for the triggers input.
    // This matches the approach used by the story card scanner's extractFullCardData().
    const triggersInput = document.querySelector('input[aria-labelledby="scTriggersLabel"]');
    if (triggersInput?.value) {
      const cardName = this.findCardName(triggersInput);
      this.parseTriggers(triggersInput.value, cardName);
    }

    // Method 2 (Fallback): Scan span.font_body labels for "TRIGGERS" text.
    // AI Dungeon labels are uppercase span.font_body elements, not p.is_Paragraph.
    document.querySelectorAll('span.font_body').forEach(span => {
      const text = span.textContent?.trim().toUpperCase() || '';
      if (text === 'TRIGGERS' || text === 'TRIGGER') {
        const container = span.closest('.is_Column') || span.parentElement;
        if (container) {
          const cardName = this.findCardName(container);
          container.querySelectorAll('input, textarea').forEach(input => {
            if (input.value) {
              this.parseTriggers(input.value, cardName);
            }
          });
        }
      }
    });

    // Method 3 (Legacy fallback): Also check p.is_Paragraph labels in case
    // some DOM contexts still use them.
    document.querySelectorAll('p.is_Paragraph').forEach(p => {
      const text = p.textContent?.trim().toUpperCase() || '';
      if (text === 'TRIGGERS' || text === 'TRIGGER') {
        const container = p.closest('.is_Column') || p.parentElement;
        if (container) {
          const cardName = this.findCardName(container);
          container.querySelectorAll('input, textarea').forEach(input => {
            if (input.value) {
              this.parseTriggers(input.value, cardName);
            }
          });
        }
      }
    });

    // Log and persist when new triggers are found
    if (this.cachedTriggers.size > previousCount) {
      console.log(`[TriggerHighlight] Passive scan found ${this.cachedTriggers.size - previousCount} new triggers (total: ${this.cachedTriggers.size})`);
      this.saveTriggerCache();
    }
  }

  // Find the story card name from the current editor/modal context
  findCardName(triggerContainer) {
    // Method 1 (Primary): Use the stable aria-labelledby title input.
    // The card editor uses input[aria-labelledby="scTitleLabel"] for the card name.
    const titleInput = document.querySelector('input[aria-labelledby="scTitleLabel"]');
    if (titleInput?.value) {
      return titleInput.value.trim();
    }

    // Method 2: Look for a modal/dialog ancestor and find its header
    const modal = triggerContainer.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
    if (modal) {
      const header = modal.querySelector('h1, [role="heading"]');
      if (header) {
        const name = header.textContent?.trim();
        if (name && !['Adventure', 'Complete Text', 'Story Cards', 'Settings'].includes(name)) {
          return name;
        }
      }
      
      // Also check for input fields that might contain the card name
      const nameInput = modal.querySelector('input[placeholder*="name"], input[placeholder*="Name"]');
      if (nameInput?.value) {
        return nameInput.value.trim();
      }
    }
    
    // Method 3: Look for nearby heading elements
    let parent = triggerContainer.parentElement;
    for (let i = 0; i < 10 && parent; i++) {
      const heading = parent.querySelector('h1, h2, [role="heading"]');
      if (heading) {
        const name = heading.textContent?.trim();
        if (name && name.length < 100 && !['Adventure', 'Complete Text', 'Story Cards', 'Settings', 'TRIGGERS', 'DETAILS'].includes(name)) {
          return name;
        }
      }
      parent = parent.parentElement;
    }
    
    // Method 4: Look for the card title in the page structure
    const allHeadings = document.querySelectorAll('h1, [role="heading"]');
    for (const h of allHeadings) {
      const text = h.textContent?.trim();
      if (text && text.length > 0 && text.length < 50 && 
          !['Adventure', 'Complete Text', 'Story Cards', 'Settings', 'TRIGGERS', 'DETAILS', 'GENERATOR SETTINGS', 'NOTES'].includes(text.toUpperCase())) {
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
  }

  isAdventureModal(element) {
    // The adventure context viewer is a modal/alertdialog that contains the
    // story text. AI Dungeon changed the heading from "Adventure" to
    // "Complete Text", so match both and also look for characteristic
    // tab structure ("Text" / "Tokens" tabs) as a fallback.
    const header = element.querySelector('h1[role="heading"]');
    const headerText = header?.textContent?.trim() || '';
    if (headerText === 'Adventure' || headerText === 'Complete Text') return true;

    // Fallback: check for Text/Tokens tab pair that identifies the context viewer
    const tabs = element.querySelectorAll('[role="tab"]');
    const tabTexts = Array.from(tabs).map(t => t.textContent?.trim().toLowerCase());
    if (tabTexts.includes('text') && tabTexts.includes('tokens')) return true;

    return false;
  }

  async handleAdventureModal(modal) {
    // Ensure we have any previously-saved triggers for this adventure
    await this.loadTriggerCache();
    // Also check for any currently-visible trigger inputs (e.g. open card editor)
    this.scanForTriggers();
    console.log(`[TriggerHighlight] Adventure modal opened — ${this.cachedTriggers.size} identified triggers in cache`);
    
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

  // Extended common words list for suggested triggers (more restrictive)
  isCommonWordExtended(word) {
    if (this.isCommonWord(word)) return true;
    
    const extendedCommonWords = new Set([
      // Common story words
      'said', 'says', 'told', 'asked', 'replied', 'answered', 'spoke', 'whispered',
      'shouted', 'yelled', 'called', 'cried', 'screamed', 'muttered', 'murmured',
      'looked', 'looks', 'saw', 'see', 'seen', 'watching', 'watched', 'stared',
      'walked', 'walk', 'ran', 'run', 'running', 'went', 'go', 'goes', 'going', 'gone',
      'came', 'come', 'comes', 'coming', 'left', 'leave', 'leaves', 'leaving',
      'took', 'take', 'takes', 'taking', 'taken', 'gave', 'give', 'gives', 'giving', 'given',
      'made', 'make', 'makes', 'making', 'got', 'get', 'gets', 'getting',
      'put', 'puts', 'putting', 'set', 'sets', 'setting',
      'stood', 'stand', 'stands', 'standing', 'sat', 'sit', 'sits', 'sitting',
      'turned', 'turn', 'turns', 'turning', 'moved', 'move', 'moves', 'moving',
      'felt', 'feel', 'feels', 'feeling', 'thought', 'think', 'thinks', 'thinking',
      'knew', 'know', 'knows', 'knowing', 'known', 'seemed', 'seem', 'seems', 'seeming',
      'began', 'begin', 'begins', 'beginning', 'started', 'start', 'starts', 'starting',
      'tried', 'try', 'tries', 'trying', 'wanted', 'want', 'wants', 'wanting',
      'needed', 'needs', 'needing', 'found', 'find', 'finds', 'finding',
      // Common nouns that aren't interesting
      'way', 'ways', 'time', 'times', 'day', 'days', 'night', 'nights',
      'thing', 'things', 'something', 'nothing', 'everything', 'anything',
      'someone', 'anyone', 'everyone', 'no one', 'nobody', 'somebody', 'everybody',
      'place', 'places', 'room', 'rooms', 'door', 'doors', 'floor', 'floors',
      'wall', 'walls', 'window', 'windows', 'hand', 'hands', 'head', 'heads',
      'eye', 'eyes', 'face', 'faces', 'voice', 'voices', 'word', 'words',
      'moment', 'moments', 'second', 'seconds', 'minute', 'minutes', 'hour', 'hours',
      'part', 'parts', 'side', 'sides', 'end', 'ends', 'back', 'front',
      'top', 'bottom', 'left', 'right', 'middle', 'center',
      // Pronouns and determiners
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
      'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
      'here', 'there', 'now', 'then', 'today', 'tomorrow', 'yesterday',
      'just', 'still', 'already', 'yet', 'even', 'also', 'too', 'very', 'really',
      'only', 'well', 'much', 'more', 'most', 'less', 'least', 'other', 'another',
      'same', 'different', 'such', 'own', 'first', 'last', 'next', 'new', 'old',
      'good', 'bad', 'great', 'little', 'big', 'small', 'large', 'long', 'short',
      'high', 'low', 'young', 'few', 'many', 'some', 'any', 'all', 'both', 'each', 'every',
      // Common adjectives
      'able', 'sure', 'certain', 'clear', 'hard', 'easy', 'possible', 'impossible',
      'true', 'false', 'real', 'right', 'wrong', 'dark', 'light', 'black', 'white',
      'red', 'blue', 'green', 'yellow', 'brown', 'gray', 'grey',
      // Story formatting words
      'chapter', 'scene', 'act', 'part', 'section', 'story', 'tale',
      // Common conjunctions and prepositions
      'after', 'before', 'during', 'until', 'while', 'through', 'across', 'against',
      'between', 'into', 'onto', 'upon', 'within', 'without', 'about', 'above', 'below',
      'under', 'over', 'around', 'near', 'far', 'along', 'toward', 'towards', 'away'
    ]);
    return extendedCommonWords.has(word.toLowerCase());
  }

  // Extract potential nouns from text (capitalized words, proper nouns)
  extractPotentialNouns(text) {
    const nouns = new Map(); // word -> { total: count, midSentence: count }
    
    // Split on sentence boundaries (periods, exclamations, questions, newlines)
    const sentences = text.split(/[.!?\n]+/);
    
    sentences.forEach(sentence => {
      const trimmed = sentence.trim();
      if (!trimmed) return;
      
      // Get all words in the sentence
      const words = trimmed.split(/\s+/);
      
      words.forEach((word, index) => {
        // Clean the word of punctuation
        const cleanWord = word.replace(/[^a-zA-Z'-]/g, '');
        if (!cleanWord || cleanWord.length < 3) return;
        
        // Skip if it's a common word
        if (this.isCommonWordExtended(cleanWord)) return;
        
        // Check if word is capitalized
        const isCapitalized = /^[A-Z]/.test(cleanWord);
        if (!isCapitalized) return;
        
        const lowerWord = cleanWord.toLowerCase();
        const existing = nouns.get(lowerWord) || { total: 0, midSentence: 0 };
        
        existing.total++;
        if (index > 0) {
          existing.midSentence++;
        }
        
        nouns.set(lowerWord, existing);
      });
    });
    
    // Filter: include words that either appear mid-sentence at least once,
    // OR appear frequently enough (5+ times) even if only at sentence starts
    const filtered = new Map();
    nouns.forEach((counts, word) => {
      if (counts.midSentence > 0) {
        // Has at least one mid-sentence occurrence - count all
        filtered.set(word, counts.total);
      } else if (counts.total >= 5) {
        // Appears very frequently, likely a proper noun even without mid-sentence proof
        filtered.set(word, counts.total);
      }
    });
    
    return filtered;
  }

  // Get suggested triggers (frequent nouns without story cards)
  getSuggestedTriggers(text) {
    if (!this.suggestedTriggersEnabled) return new Map();
    
    const nounFrequencies = this.extractPotentialNouns(text);
    const suggested = new Map();
    
    nounFrequencies.forEach((count, noun) => {
      // Skip if this noun already has a story card
      if (this.cachedTriggers.has(noun)) return;
      
      // Skip if below threshold
      if (count < this.suggestedTriggerThreshold) return;
      
      suggested.set(noun, count);
    });
    
    return suggested;
  }

  highlightTriggersInModal(modal) {
    const hasTriggers = this.cachedTriggers.size > 0;
    const suggestedEnabled = this.suggestedTriggersEnabled;
    
    if (!hasTriggers && !suggestedEnabled) {
      console.log('[TriggerHighlight] No cached triggers and suggested triggers disabled — skipping highlight');
      return;
    }

    // Find the story text content within the Adventure modal.
    // Try multiple selectors for robustness against AI Dungeon DOM changes:
    // 1. .font_mono.is_Paragraph (original Tamagui structure)
    // 2. .font_mono.is_Text (alternate Tamagui text component)
    // 3. .font_mono (broadest - any monospace text element in the modal)
    let storyTextElements = modal.querySelectorAll('.font_mono.is_Paragraph');
    if (storyTextElements.length === 0) {
      storyTextElements = modal.querySelectorAll('.font_mono.is_Text');
    }
    if (storyTextElements.length === 0) {
      // Broadest fallback: any .font_mono elements that contain substantial text
      const allMono = modal.querySelectorAll('.font_mono');
      const filtered = Array.from(allMono).filter(el => {
        const text = el.textContent?.trim() || '';
        // Only include elements with meaningful text content (not labels/buttons)
        return text.length > 20 && !el.closest('button, [role="button"], [role="tab"]');
      });
      storyTextElements = filtered;
    }
    
    // Collect all text for noun frequency analysis
    let allText = '';
    const elements = Array.from(storyTextElements);
    elements.forEach(element => {
      allText += element.textContent + ' ';
    });
    
    // Get suggested triggers from the combined text
    const suggestedTriggers = this.getSuggestedTriggers(allText);
    
    console.log(`[TriggerHighlight] Highlighting: ${elements.length} text elements, ${this.cachedTriggers.size} identified triggers, ${suggestedTriggers.size} suggested triggers`);
    
    elements.forEach(element => {
      if (!this.processedElements.has(element)) {
        this.highlightElement(element, suggestedTriggers);
        this.processedElements.add(element);
      }
    });
  }

  highlightElement(element, suggestedTriggers = new Map()) {
    if (!element || !element.textContent) return;
    
    const originalText = element.textContent;
    let html = this.escapeHtml(originalText);
    
    // Sort triggers by length (longest first) to avoid partial replacements
    const sortedTriggers = Array.from(this.cachedTriggers.keys())
      .sort((a, b) => b.length - a.length);
    
    // ── Phase 1: Identified triggers (yellow) — these take priority ──
    let identifiedMatches = 0;
    sortedTriggers.forEach(trigger => {
      const cardName = this.cachedTriggers.get(trigger) || 'Unknown Card';
      const escapedCardName = this.escapeHtml(cardName);
      const escapedTrigger = this.escapeRegExp(trigger);
      const regex = new RegExp(`\\b(${escapedTrigger})\\b`, 'gi');
      const before = html;
      html = html.replace(regex, `<span class="bd-trigger-highlight" data-card-name="${escapedCardName}">$1</span>`);
      if (html !== before) identifiedMatches++;
    });
    
    // Snapshot the HTML after all identified triggers are placed.
    // Suggested triggers must NOT replace text that is already inside
    // an identified-trigger <span>.
    const htmlAfterIdentified = html;
    
    // ── Phase 2: Suggested triggers (cyan) — skip already-highlighted text ──
    let suggestedMatches = 0;
    if (suggestedTriggers.size > 0) {
      const sortedSuggested = Array.from(suggestedTriggers.keys())
        .sort((a, b) => b.length - a.length);
      
      sortedSuggested.forEach(noun => {
        const count = suggestedTriggers.get(noun);
        const escapedNoun = this.escapeRegExp(noun);
        const regex = new RegExp(`\\b(${escapedNoun})\\b`, 'gi');
        
        // Capture current html state before this noun's replacement pass
        const htmlBeforeReplace = html;
        const before = html;
        
        html = html.replace(regex, (match, p1, offset) => {
          // Check if this match is inside an existing highlight span.
          // Walk backwards from offset to see if we're between <span...> and </span>.
          const beforeMatch = htmlBeforeReplace.substring(0, offset);
          const lastOpenSpan = beforeMatch.lastIndexOf('<span');
          const lastCloseSpan = beforeMatch.lastIndexOf('</span>');
          if (lastOpenSpan > lastCloseSpan) {
            return match; // Inside an identified or earlier suggested span — don't override
          }
          return `<span class="bd-suggested-trigger" data-occurrences="${count}">${p1}</span>`;
        });
        if (html !== before) suggestedMatches++;
      });
    }
    
    // Only update if we made changes
    if (html !== this.escapeHtml(originalText)) {
      this.log(`[TriggerHighlight] Element: ${identifiedMatches} identified matches, ${suggestedMatches} suggested matches`);
      element.innerHTML = html;
      
      // Show first-use hint for trigger highlights
      this.showTriggerHint(element);
    }
  }

  showTriggerHint(element) {
    // Hint service removed - tutorial covers this
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
    document.querySelectorAll('.bd-trigger-highlight, .bd-suggested-trigger').forEach(span => {
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
