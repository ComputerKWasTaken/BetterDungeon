// BetterDungeon - Trigger Highlight Feature
// Highlights story card triggers in the Adventure context viewer

class TriggerHighlightFeature {
  static id = 'triggerHighlight';

  constructor() {
    this.observer = null;
    this.contextObserver = null;
    this.triggerScanObserver = null;
    this.processedElements = new WeakSet();
    this.handledContextModals = new WeakSet();
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

  async init() {
    console.log('[TriggerHighlight] Initializing Trigger Highlight feature...');
    // Load trigger-highlight settings before detecting adventure.
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
      const result = await chrome.storage.sync.get([
        'betterDungeon_suggestedTriggers',
        'betterDungeon_suggestedTriggerThreshold'
      ]);
      this.suggestedTriggersEnabled = (result || {}).betterDungeon_suggestedTriggers ?? true;
      this.suggestedTriggerThreshold = (result || {}).betterDungeon_suggestedTriggerThreshold ?? 3;
    } catch (e) {
      this.suggestedTriggersEnabled = true;
      this.suggestedTriggerThreshold = 3;
    }
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
      if (typeof storyCardCache !== 'undefined') storyCardCache.clear();
      this.processedElements = new WeakSet();
      this._suggestedCache = null;
      
      // Also reset the scanner state for the new adventure
      if (typeof storyCardScanner !== 'undefined') {
        storyCardScanner.reset();
      }
    }
    
    this.currentAdventureId = newAdventureId;
  }

  // Hydrate story cards directly from Ultrascripts/GraphQL.
  async scanAllStoryCards() {
    if (typeof storyCardScanner === 'undefined') {
      console.error('TriggerHighlightFeature: Scanner not available');
      return { success: false, error: 'Required services not loaded' };
    }

    const validation = storyCardScanner.validatePageState();
    if (!validation.valid) {
      console.warn('TriggerHighlightFeature: Cannot scan -', validation.error);
      return { success: false, error: validation.error };
    }

    try {
      const result = await storyCardScanner.scanAllCards(null, null, null);
      if (!result.success) {
        console.warn('TriggerHighlightFeature: Story-card hydration failed -', result.error);
      }
      return result;
    } catch (error) {
      console.error('TriggerHighlightFeature: Scan error:', error);
      return { success: false, error: error.message };
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
    this.handledContextModals = new WeakSet();
    if (typeof storyCardCache !== 'undefined') storyCardCache.clear();
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

  // Find the card name for a field in the current (Tailwind) story card
  // editor: the name field in the same editor form is labelled by
  // #scTitleLabel via aria-labelledby (verified in the current bundle,
  // story card editor chunk: fieldKey "title" / "keys").
  findEditorCardName(field) {
    let root = field?.parentElement || null;
    for (let i = 0; i < 12 && root; i++) {
      const titleField = root.querySelector?.('input[aria-labelledby="scTitleLabel"], textarea[aria-labelledby="scTitleLabel"]');
      if (titleField) {
        const name = titleField.value?.trim();
        if (name) return name;
        break; // Found the editor form; the name is just empty for now.
      }
      root = root.parentElement;
    }
    return this.findCardName(field);
  }

  // Scan open story card editors for trigger values
  scanForTriggers() {
    const previousCount = typeof storyCardCache !== 'undefined' ? storyCardCache.size : 0;

    // Current editor (Tailwind UI): the triggers field carries
    // aria-labelledby="scTriggersLabel" (label id verified in the current
    // bundle). The old Tamagui anchors below no longer match this editor:
    // its label is a <label> element and its field wrapper is a plain
    // flex <div>, so p.is_Paragraph / .is_Column find nothing there.
    document.querySelectorAll('input[aria-labelledby="scTriggersLabel"], textarea[aria-labelledby="scTriggersLabel"]').forEach(input => {
      if (input.value) {
        this.parseTriggers(input.value, this.findEditorCardName(input));
      }
    });
    // Label-anchored variant of the same editor, in case the field's
    // aria-labelledby is dropped but the stable label id remains.
    const triggersLabel = document.getElementById('scTriggersLabel');
    if (triggersLabel) {
      const container = triggersLabel.parentElement;
      container?.querySelectorAll('input, textarea').forEach(input => {
        if (input.value) {
          this.parseTriggers(input.value, this.findEditorCardName(input));
        }
      });
    }

    // Legacy editor: look for TRIGGERS label and associated inputs
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

    // Also scan all inputs on the page for ones that look like trigger fields.
    // This is a full-document sweep, so only run it when the legacy editor
    // structure it targets is actually present on the page.
    if (!document.querySelector('.is_Column')) return;
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
              this.checkForAdventureModal(node);
            }
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Check if the context viewer is already open
    document.querySelectorAll('[aria-label="Modal"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]').forEach(el => {
      if (this.isAdventureModal(el)) {
        this.handleAdventureModal(el);
      }
    });
  }

  // Present a newly added subtree to the adventure-modal check. Discovery
  // used to rely solely on a descendant carrying aria-label="Modal"; that
  // literal no longer appears anywhere in AI Dungeon's current bundles, so
  // also consider dialog-role elements and — as a signature fallback — any
  // subtree that contains the context viewer's characteristic text.
  checkForAdventureModal(root) {
    const candidates = new Set();
    if (root.matches?.('[aria-label="Modal"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
      candidates.add(root);
    }
    root.querySelectorAll?.('[aria-label="Modal"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')
      .forEach(el => candidates.add(el));

    if (candidates.size === 0 && root.textContent?.includes('Context used for this action')) {
      candidates.add(root.closest?.('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') || root);
    }

    for (const candidate of candidates) {
      if (this.isAdventureModal(candidate)) {
        this.handleAdventureModal(candidate);
        return;
      }
    }
    if (candidates.size === 0 && this.isAdventureModal(root)) {
      this.handleAdventureModal(root);
    }
  }

  isAdventureModal(element) {
    // The adventure context viewer is a modal/alertdialog that contains the
    // story text. AI Dungeon changed the heading from "Adventure" to
    // "Complete Text", and the current viewer titles itself "View Context",
    // so match all three and also look for characteristic tab structure
    // ("Text" / "Tokens" tabs) as a fallback. The heading element itself is
    // a Tamagui text element, so accept an h1 with an implicit heading role
    // as well as an explicit role="heading" element.
    const header = element.querySelector('h1, [role="heading"]');
    const headerText = header?.textContent?.trim() || '';
    if (headerText === 'Adventure' || headerText === 'Complete Text' || headerText === 'View Context') return true;

    const text = element.textContent || '';
    if (text.includes('View Context') && text.includes('Context used for this action')) return true;

    // Fallback: check for Text/Tokens tab pair that identifies the context viewer
    const tabs = element.querySelectorAll('[role="tab"]');
    const tabTexts = Array.from(tabs).map(t => t.textContent?.trim().toLowerCase());
    if (tabTexts.includes('text') && tabTexts.includes('tokens')) return true;

    return false;
  }

  async handleAdventureModal(modal) {
    if (this.handledContextModals.has(modal)) return;
    this.handledContextModals.add(modal);

    const result = await this.scanAllStoryCards();
    if (result?.success) {
      this.processedElements = new WeakSet();
    } else {
      this.handledContextModals.delete(modal);
    }

    this.scanForTriggers();
    this.highlightTriggersInModal(modal);
    this.watchModalForChanges(modal);
  }

  parseTriggers(value, cardName = 'Unknown Card') {
    if (!value || typeof value !== 'string') return;
    if (typeof storyCardCache === 'undefined') return;
    
    // Split by comma and clean up each trigger
    const triggers = value.split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0 && t.length < 50); // Filter out empty or very long strings
    
    triggers.forEach(trigger => {
      if (trigger && !this.isCommonWord(trigger)) {
        storyCardCache.setTrigger(trigger, cardName);
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
      if (typeof storyCardCache !== 'undefined' && storyCardCache.hasTrigger(noun)) return;
      
      // Skip if below threshold
      if (count < this.suggestedTriggerThreshold) return;
      
      suggested.set(noun, count);
    });
    
    return suggested;
  }

  getSuggestedTriggersMemoized(allText) {
    const triggerCount = typeof storyCardCache !== 'undefined' ? storyCardCache.size : 0;
    // Cheap sampled hash: distinguishes same-length edits well enough for
    // a cache key; a rare collision only costs a stale suggestion set for
    // one modal session.
    let hash = 0;
    for (let i = 0; i < allText.length; i += 97) {
      hash = (hash * 31 + allText.charCodeAt(i)) | 0;
    }
    const key = `${allText.length}:${hash}:${this.suggestedTriggerThreshold}:${this.suggestedTriggersEnabled}:${triggerCount}`;
    if (this._suggestedCache?.key === key) {
      return this._suggestedCache.map;
    }
    const map = this.getSuggestedTriggers(allText);
    this._suggestedCache = { key, map };
    return map;
  }

  highlightTriggersInModal(modal) {
    const hasTriggers = typeof storyCardCache !== 'undefined' && storyCardCache.size > 0;
    const suggestedEnabled = this.suggestedTriggersEnabled;
    
    if (!hasTriggers && !suggestedEnabled) {
      return;
    }

    // Find the story text content within the Context Viewer modal
    // The story text is displayed in span elements with is_Text and font_mono classes
    // within the scrollable content area (is_Paragraph was removed in a DOM update)
    const storyTextElements = modal.querySelectorAll('.is_Text.font_mono');
    
    // Collect all text for noun frequency analysis
    let allText = '';
    storyTextElements.forEach(element => {
      allText += element.textContent + ' ';
    });
    
    // Get suggested triggers from the combined text. This re-runs on every
    // modal content mutation, and noun extraction over a long adventure's
    // full context is the most expensive work this feature does — memoize
    // it on the text (plus the inputs that change the result) so unchanged
    // context isn't re-analyzed for every mutation batch.
    const suggestedTriggers = this.getSuggestedTriggersMemoized(allText);
    
    storyTextElements.forEach(element => {
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
    const triggers = typeof storyCardCache !== 'undefined' ? storyCardCache.getTriggers() : new Map();
    const sortedTriggers = Array.from(triggers.keys())
      .sort((a, b) => b.length - a.length);
    
    // Highlight existing triggers (yellow) in a single pass with one
    // combined regex. The previous per-trigger passes re-scanned markup
    // inserted by earlier passes, so a shorter trigger could match inside
    // a previous span's data-card-name attribute (e.g. trigger "larion"
    // matching the card name of the "kingdom" span) and corrupt the HTML.
    // Longest-first alternation makes the longest trigger win at each
    // position, and matches are resolved against the trigger map directly.
    if (sortedTriggers.length > 0) {
      const pattern = sortedTriggers.map(t => this.escapeRegExp(t)).join('|');
      const regex = new RegExp(`\\b(?:${pattern})\\b`, 'gi');
      html = html.replace(regex, (match, offset) => {
        // Don't match inside an HTML entity (e.g. trigger "amp" in "&amp;")
        if (offset > 0 && html[offset - 1] === '&') return match;
        const cardName = triggers.get(match.toLowerCase()) || 'Unknown Card';
        const escapedCardName = this.escapeHtml(cardName);
        return `<span class="bd-trigger-highlight" data-card-name="${escapedCardName}">${match}</span>`;
      });
    }
    
    // Highlight suggested triggers (cyan) - only if not already highlighted
    if (suggestedTriggers.size > 0) {
      const sortedSuggested = Array.from(suggestedTriggers.keys())
        .sort((a, b) => b.length - a.length);
      
      sortedSuggested.forEach(noun => {
        const count = suggestedTriggers.get(noun);
        const escapedNoun = this.escapeRegExp(noun);
        const regex = new RegExp(`\\b(${escapedNoun})\\b`, 'gi');
        
        // Capture current html state before this replacement
        const htmlBeforeReplace = html;
        
        html = html.replace(regex, (match, p1, offset) => {
          // Check if this match is inside an existing highlight span using the pre-replace state
          const beforeMatch = htmlBeforeReplace.substring(0, offset);
          const lastOpenSpan = beforeMatch.lastIndexOf('<span');
          const lastCloseSpan = beforeMatch.lastIndexOf('</span>');
          // If there's an open span tag after the last close span, we're inside a span
          if (lastOpenSpan > lastCloseSpan) {
            return match; // Don't highlight, already inside a span
          }
          return `<span class="bd-suggested-trigger" data-occurrences="${count}">${p1}</span>`;
        });
      });
    }
    
    // Only update if we made changes
    if (html !== this.escapeHtml(originalText)) {
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
