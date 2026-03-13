// BetterDungeon - Story Card Scanner Service
// Automatically scans all story cards to extract triggers and build a database of rich card data

class StoryCardScanner {
  constructor() {
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.scannedIndices = new Set(); // Track which card position-indices have been scanned
    this.scannedNames = new Set();  // Secondary dedup by card name (bulletproof against position shifts)
    
    // Rich card data storage: Map of cardName -> { type, description, triggers, keys, name }
    this.cardDatabase = new Map();
    
    // Track which adventure was last scanned
    this.lastScannedAdventureId = null;
    
    // Performance optimization: adaptive timing
    this.totalCardTime = 0;
    this.cardCount = 0;
    this.averageCardTime = null;
    
    // Debug mode - set to true to enable verbose logging
    this.debug = false;
    
    // Timing constants (ms) - optimized for speed
    this.TIMING = {
      CARD_OPEN_WAIT: 150,      // Wait after clicking card (reduced from 400)
      CARD_CLOSE_WAIT: 100,     // Wait after closing card (reduced from 300)
      SCROLL_WAIT: 150,         // Wait after scrolling (reduced from 300)
      TAB_LOAD_WAIT: 300,       // Wait for tab content to load (reduced from 500)
      MIN_WAIT: 50,             // Minimum wait time
      MAX_RETRIES: 3            // Max retries for element detection
    };
    
    // Known card types in AI Dungeon
    this.CARD_TYPES = ['character', 'location', 'item', 'faction', 'lore', 'other'];
  }

  // ==================== PRE-VALIDATION ====================

  // Check if the scanner can run (validates page state BEFORE starting)
  validatePageState() {
    // Check if we're on AI Dungeon
    if (!window.location.hostname.includes('aidungeon.com')) {
      return { valid: false, error: 'Not on AI Dungeon website' };
    }

    // Check if we're on an adventure page
    if (!window.location.pathname.includes('/adventure/')) {
      return { valid: false, error: 'Navigate to an adventure first' };
    }

    // Check if a scan is already in progress
    if (this.isScanning) {
      return { valid: false, error: 'Scan already in progress' };
    }

    return { valid: true };
  }

  // Get current adventure ID from URL
  getCurrentAdventureId() {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    return match ? match[1] : null;
  }

  // Reset scanner state (call when adventure changes)
  reset() {
    this.log('Resetting scanner state...');
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.scannedIndices = new Set();
    this.scannedNames = new Set();
    this.cardDatabase = new Map();
    this.totalCardTime = 0;
    this.cardCount = 0;
    this.averageCardTime = null;
    this.lastScannedAdventureId = null;
  }

  // Reset if adventure has changed since last scan
  resetIfAdventureChanged() {
    const currentId = this.getCurrentAdventureId();
    if (currentId && this.lastScannedAdventureId && currentId !== this.lastScannedAdventureId) {
      this.log(`Adventure changed from ${this.lastScannedAdventureId} to ${currentId}, resetting...`);
      this.reset();
    }
  }

  // Main scan method - now returns rich card data
  // Callbacks: onCardScanned(cardData), onProgress(current, total, status, eta)
  async scanAllCards(onTriggerFound, onProgress, onCardScanned) {
    // Pre-validate page state
    const validation = this.validatePageState();
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Reset if adventure changed
    this.resetIfAdventureChanged();

    this.isScanning = true;
    this.abortController = new AbortController();
    this.scanStartTime = Date.now();
    this.totalCardTime = 0;
    this.cardCount = 0;
    this.averageCardTime = null;
    this.scannedIndices = new Set();
    this.scannedNames = new Set();
    this.cardDatabase = new Map(); // Reset card database
    this.lastScannedAdventureId = this.getCurrentAdventureId();
    const results = new Map(); // trigger -> cardName (kept for backward compatibility)

    try {
      // First, navigate to the Story Cards section if not already there
      const storyCardsTab = await this.findAndClickStoryCardsTab();
      if (!storyCardsTab) {
        throw new Error('Could not find Story Cards tab');
      }

      await this.wait(this.TIMING.TAB_LOAD_WAIT); // Let the tab content load

      // Get the total card count from the tab badge (e.g., "Story Cards | 18")
      const totalCards = this.getTotalCardCount();
      
      if (totalCards === 0) {
        return { success: true, triggers: results, message: 'No story cards found' };
      }

      // Find the scrollable container for story cards (virtualized list)
      const scrollContainer = this.findScrollContainer();
      if (!scrollContainer) {
        console.error('ERROR: Could not find scroll container');
        throw new Error('Could not find story cards scroll container');
      }
      
      this.log('Found scroll container:', {
        scrollHeight: scrollContainer.scrollHeight,
        clientHeight: scrollContainer.clientHeight,
        scrollTop: scrollContainer.scrollTop,
        className: scrollContainer.className?.substring(0, 50)
      });

      let scannedCount = 0;
      let consecutiveEmptyScrolls = 0;
      const maxEmptyScrolls = 3; // Only stop after 3 consecutive scrolls with no new cards

      // Start scanning from the top
      scrollContainer.scrollTop = 0;
      await this.wait(this.TIMING.SCROLL_WAIT);
      
      this.log(`Starting scan: ${totalCards} total cards to scan`);

      // Scroll through the virtualized list to load and scan all cards
      let loopIteration = 0;
      while (scannedCount < totalCards) {
        loopIteration++;
        this.log(`\n=== Loop iteration ${loopIteration} ===`);
        this.log(`scannedCount: ${scannedCount}/${totalCards}, consecutiveEmptyScrolls: ${consecutiveEmptyScrolls}`);
        
        if (this.abortController.signal.aborted) {
          return { success: false, error: 'Scan aborted by user' };
        }

        // Scan all currently visible cards
        const cardsScannedThisRound = await this.scanVisibleCards(
          scrollContainer,
          results, 
          totalCards, 
          onTriggerFound, 
          onProgress,
          () => scannedCount,
          (count) => { scannedCount = count; },
          onCardScanned
        );

        this.log(`Cards scanned this round: ${cardsScannedThisRound}`);
        
        // If we've scanned all cards, we're done
        if (scannedCount >= totalCards) {
          this.log('All cards scanned, breaking loop');
          break;
        }

        // Track if we found new cards this round
        if (cardsScannedThisRound > 0) {
          consecutiveEmptyScrolls = 0;
        } else {
          consecutiveEmptyScrolls++;
          this.log(`No new cards found, consecutiveEmptyScrolls: ${consecutiveEmptyScrolls}`);
          
          // If we've had too many empty scrolls, we might be done
          if (consecutiveEmptyScrolls >= maxEmptyScrolls) {
            this.log(`STOPPING: ${maxEmptyScrolls} consecutive empty scrolls. Scanned ${scannedCount}/${totalCards} cards.`);
            break;
          }
        }

        // Scroll down to load more cards
        this.log('Attempting to scroll...');
        const scrolled = await this.scrollToNextCards(scrollContainer);
        this.log(`Scroll result: ${scrolled}`);
        
        // If we couldn't scroll further, try one more time then exit
        if (!scrolled) {
          this.log('Could not scroll, trying final sweep...');
          // Wait a bit longer and try to find any remaining cards
          await this.wait(this.TIMING.SCROLL_WAIT * 2);
          
          const finalCards = await this.scanVisibleCards(
            scrollContainer,
            results, 
            totalCards, 
            onTriggerFound, 
            onProgress,
            () => scannedCount,
            (count) => { scannedCount = count; },
            onCardScanned
          );
          
          this.log(`Final sweep found: ${finalCards} cards`);
          
          if (finalCards === 0) {
            this.log(`STOPPING: Reached end of scroll. Scanned ${scannedCount}/${totalCards} cards.`);
            break;
          }
        }
      }
      
      this.log(`\n=== Scan complete ===\nTotal scanned: ${scannedCount}/${totalCards}`);

      // Scroll back to top when done
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }

      return { 
        success: true, 
        triggers: results, 
        scannedCount,
        cardDatabase: this.cardDatabase // Include rich card data
      };

    } catch (error) {
      console.error('StoryCardScanner: Scan failed:', error);
      // Check if this is an abort error
      if (error.name === 'AbortError' || this.abortController?.signal.aborted) {
        return { success: false, error: 'Scan aborted by user' };
      }
      return { success: false, error: error.message };
    } finally {
      // Ensure any open card editor is closed before finishing
      await this.closeCardEditorAndWait();
      this.isScanning = false;
      this.abortController = null;
    }
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // Scan all currently visible cards and return count of new cards scanned
  // Now extracts full card data: type, description, triggers, keys
  async scanVisibleCards(scrollContainer, results, totalCards, onTriggerFound, onProgress, getCount, setCount, onCardScanned) {
    const visibleCards = this.findVisibleStoryCards(scrollContainer);
    this.log(`findVisibleStoryCards returned ${visibleCards.length} cards:`, 
      visibleCards.map(c => ({ index: c.index, name: this.getCardNameFromElement(c.element)?.substring(0, 20) })));
    
    let newCardsScanned = 0;

    for (const cardData of visibleCards) {
      if (this.abortController?.signal.aborted) {
        return newCardsScanned;
      }

      const { element: card, index } = cardData;

      // Skip if already scanned (by position index or card name) or if it's the "Add" button
      const cardName = this.getCardNameFromElement(card);
      if (this.scannedIndices.has(index) || this.scannedNames.has(cardName) || this.isAddCardButton(card)) {
        continue;
      }

      // Mark as scanned via both index and name for robust dedup
      this.scannedIndices.add(index);
      this.scannedNames.add(cardName);
      const currentCount = getCount() + 1;
      setCount(currentCount);
      newCardsScanned++;

      // Try to get card type from the list view element first
      const cardTypeFromList = this.getCardTypeFromElement(card);
      const cardStartTime = Date.now();

      // Calculate estimated time remaining
      let estimatedTimeRemaining = null;
      if (this.cardCount > 0) {
        this.averageCardTime = this.totalCardTime / this.cardCount;
        const remainingCards = totalCards - currentCount;
        estimatedTimeRemaining = Math.round(this.averageCardTime * remainingCards / 1000);
      }

      if (onProgress) {
        onProgress(currentCount, totalCards, `Scanning: ${cardName}`, estimatedTimeRemaining);
      }

      try {
        // Click the card to open its editor
        card.click();
        await this.waitForCardEditor();

        // Extract full card data from the opened card
        const fullCardData = this.extractFullCardData(cardName, cardTypeFromList);

        // Store in card database
        this.cardDatabase.set(cardName, fullCardData);

        // Backward compatibility: populate triggers map
        if (fullCardData.triggers.length > 0) {
          for (const trigger of fullCardData.triggers) {
            const existingCard = results.get(trigger);
            if (existingCard && existingCard !== cardName) {
              results.set(trigger, `${existingCard}, ${cardName}`);
            } else {
              results.set(trigger, cardName);
            }

            if (onTriggerFound) {
              onTriggerFound(trigger, cardName);
            }
          }
        }

        // Notify about the full card data
        if (onCardScanned) {
          onCardScanned(fullCardData);
        }

        // Record timing (no per-card close - only close at end of scan)
        const cardDuration = Date.now() - cardStartTime;
        this.totalCardTime += cardDuration;
        this.cardCount++;

      } catch (cardError) {
        console.error(`StoryCardScanner: Error scanning card "${cardName}":`, cardError);
      }
    }

    return newCardsScanned;
  }

  // Scroll to load more cards, returns true if scroll was successful
  async scrollToNextCards(scrollContainer) {
    const beforeScroll = scrollContainer.scrollTop;
    const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    
    this.log(`Scroll state: beforeScroll=${beforeScroll}, maxScroll=${maxScroll}, scrollHeight=${scrollContainer.scrollHeight}, clientHeight=${scrollContainer.clientHeight}`);
    
    // If we're already at or near the bottom, can't scroll more
    if (beforeScroll >= maxScroll - 10) {
      this.log('Already at bottom, cannot scroll further');
      return false;
    }

    // Scroll by approximately 85% of viewport to ensure overlap for card detection
    const scrollAmount = scrollContainer.clientHeight * 0.85;
    const targetScroll = Math.min(beforeScroll + scrollAmount, maxScroll);
    this.log(`Scrolling from ${beforeScroll} to ${targetScroll} (amount: ${scrollAmount})`);
    
    scrollContainer.scrollTop = targetScroll;
    
    // Wait for the virtual list to render new cards
    await this.wait(this.TIMING.SCROLL_WAIT);
    
    // Verify scroll actually happened
    const afterScroll = scrollContainer.scrollTop;
    this.log(`After scroll: ${afterScroll}`);
    
    if (afterScroll <= beforeScroll) {
      this.log('Scroll did not work, trying to force to bottom');
      // Scroll didn't work, try forcing to bottom
      scrollContainer.scrollTop = maxScroll;
      await this.wait(this.TIMING.SCROLL_WAIT);
      const finalScroll = scrollContainer.scrollTop;
      this.log(`After force scroll: ${finalScroll}`);
      return finalScroll > beforeScroll;
    }

    return true;
  }
  
  // Debug logger helper
  log(...args) {
    if (this.debug) {
      console.log('[StoryCardScanner]', ...args);
    }
  }

  async findAndClickStoryCardsTab() {
    // Look for the Story Cards tab in the adventure settings
    const tabs = document.querySelectorAll('[role="tab"], [role="button"]');
    
    for (const tab of tabs) {
      const text = tab.textContent?.trim().toLowerCase();
      const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
      
      if (text === 'story cards' || ariaLabel.includes('story cards')) {
        tab.click();
        await this.wait(this.TIMING.CARD_CLOSE_WAIT);
        return tab;
      }
    }

    // Also check for already selected tab
    const selectedTab = document.querySelector('[aria-selected="true"]');
    if (selectedTab?.textContent?.toLowerCase().includes('story cards')) {
      return selectedTab;
    }

    return null;
  }

  // Get the total card count from the Story Cards tab badge
  getTotalCardCount() {
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
      const tabText = tab.textContent?.toLowerCase() || '';

      if (ariaLabel.includes('story cards') || tabText.includes('story cards')) {
        // Method 1: The count badge is a span.font_body inside a divider child
        // Structure: tab > ... > div._blw-1px > span.font_body  (contains just the number)
        const divider = tab.querySelector('div[class*="_blw-1px"]');
        if (divider) {
          const countSpan = divider.querySelector('.font_body');
          if (countSpan) {
            const count = parseInt(countSpan.textContent?.trim(), 10);
            if (!isNaN(count)) return count;
          }
        }

        // Method 2: Any numeric span inside the tab that isn't the label
        const spans = tab.querySelectorAll('span.font_body');
        for (const span of spans) {
          const text = span.textContent?.trim();
          if (text && /^\d+$/.test(text)) {
            return parseInt(text, 10);
          }
        }

        // Method 3: Extract number from full tab text (e.g., "Story Cards4")
        const match = tabText.match(/(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }

    // Fallback: count currently visible cards (may be incomplete due to virtualization)
    const visibleCards = this.findVisibleStoryCards();
    return visibleCards.length;
  }

  // Find the scrollable container for the story cards list
  // The Story Cards section uses a virtualized list whose scroll wrapper
  // is a div with class r-150rngu (React Native Web's ScrollView).
  // The outer wrapper has overflow:hidden; the inner r-150rngu div is the
  // actual scrollable element.
  findScrollContainer() {
    // Strategy: locate card elements first, then walk up to their scroll ancestor.

    // Method 1: Find absolutely-positioned card wrappers and walk up to the scrollable ancestor.
    // In all view modes (Grid/List/Compact), card items are absolutely positioned inside
    // a virtualized content div. The scroll container is the nearest ancestor with
    // r-150rngu class or actual overflow scrolling.
    const cardHeadings = document.querySelectorAll('h1[role="heading"]');
    for (const heading of cardHeadings) {
      // Walk up from the heading to find a role="button" card, then find the scroll container
      const cardBtn = heading.closest('[role="button"]');
      if (!cardBtn) continue;

      // The card button lives inside an absolutely-positioned wrapper div,
      // which lives inside a content div, which lives inside the scroll container
      let current = cardBtn.parentElement;
      while (current && current !== document.body) {
        const cls = current.className || '';
        // The virtualized scroll container has the r-150rngu class (RNW ScrollView)
        if (cls.includes('r-150rngu')) {
          return current;
        }
        // Also check computed overflow — some views may use native scrolling
        const style = window.getComputedStyle(current);
        const hasScrollableOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll';
        if (hasScrollableOverflow && current.scrollHeight > current.clientHeight + 10) {
          // Verify this container actually holds story cards
          const hasCards = current.querySelector('h1[role="heading"]');
          if (hasCards) return current;
        }
        current = current.parentElement;
      }
    }

    // Method 2: Find the Story Cards content area by locating view toggle buttons
    // and walking up to the scrollable ancestor
    const viewToggle = document.querySelector('[aria-label="Grid view"], [aria-label="List view"], [aria-label="Compact view"]');
    if (viewToggle) {
      // The view toggles are siblings of the search bar, above the scroll container
      // Walk up to their common settings column, then find the scroll container within
      let settingsCol = viewToggle.closest('.is_Column');
      if (settingsCol) {
        // Look for r-150rngu scroll wrapper inside this settings column
        const scrollDiv = settingsCol.querySelector('.r-150rngu');
        if (scrollDiv) return scrollDiv;

        // Fallback: find child with flex:1 and overflow:hidden wrapping the virtual list
        const flexChildren = settingsCol.querySelectorAll('div[style*="flex: 1"]');
        for (const child of flexChildren) {
          const innerScroll = child.querySelector('.r-150rngu');
          if (innerScroll) return innerScroll;
        }
      }
    }

    // Method 3: Broad search for r-150rngu containers that hold card buttons
    const scrollCandidates = document.querySelectorAll('.r-150rngu');
    for (const candidate of scrollCandidates) {
      const hasCards = candidate.querySelector('[role="button"] h1[role="heading"]');
      if (hasCards) return candidate;
    }

    this.log('findScrollContainer: no container found');
    return null;
  }

  // Find currently visible story cards in the DOM (works with Grid, List, and Compact views)
  // Cards are absolutely-positioned wrapper divs inside a virtualized content container.
  // Each wrapper holds a role="button" with an h1[role="heading"] for the card name.
  // There are no [index] attributes — we derive sort order from the CSS `top` value.
  findVisibleStoryCards(scrollContainer = null) {
    const cards = [];
    const seenElements = new Set();

    // Get the scroll container bounds for visibility filtering
    const containerRect = scrollContainer?.getBoundingClientRect();
    const viewportTop = containerRect?.top ?? 0;
    const viewportBottom = containerRect?.bottom ?? window.innerHeight;

    // Primary strategy: find all card buttons with headings inside the Story Cards area.
    // Cards live inside absolutely-positioned wrapper divs within the scroll container.
    const searchRoot = scrollContainer || document;
    const cardButtons = searchRoot.querySelectorAll('[role="button"] h1[role="heading"]');

    for (const heading of cardButtons) {
      const btn = heading.closest('[role="button"]');
      if (!btn || seenElements.has(btn)) continue;

      // Skip "Add Story Card" or similar non-card buttons
      if (this.isAddCardButton(btn)) continue;

      // The wrapper div is the absolutely-positioned ancestor (has style.top set)
      const wrapper = btn.closest('div[style*="position: absolute"]') || btn.parentElement;

      // Visibility check: is the card (or its wrapper) within the scroll viewport?
      const checkEl = wrapper || btn;
      const rect = checkEl.getBoundingClientRect();
      const isVisible = rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportBottom;

      if (!isVisible) continue;

      seenElements.add(btn);

      // Derive a sort index from the wrapper's top position (virtualized list ordering)
      let sortTop = 0;
      if (wrapper?.style?.top) {
        sortTop = parseFloat(wrapper.style.top) || 0;
      }
      // For grid views also factor in left position so cards read left-to-right, top-to-bottom
      let sortLeft = 0;
      if (wrapper?.style?.left) {
        sortLeft = parseFloat(wrapper.style.left) || 0;
      }

      cards.push({
        element: btn,
        index: sortTop * 10000 + sortLeft, // Composite index for stable ordering
      });
    }

    // Fallback: if primary strategy found nothing, try broader search
    // (handles edge cases where cards may not have headings visible yet)
    if (cards.length === 0) {
      const allButtons = searchRoot.querySelectorAll('[role="button"].is_Button');
      let idx = 0;
      for (const btn of allButtons) {
        if (seenElements.has(btn) || this.isAddCardButton(btn)) continue;

        // Must have a type badge or heading to qualify as a story card
        const hasHeading = btn.querySelector('h1, h2, [role="heading"]');
        const hasTypeBadge = btn.querySelector('span[aria-label^="type:"]');
        if (!hasHeading && !hasTypeBadge) continue;

        const rect = btn.getBoundingClientRect();
        const isVisible = rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportBottom;
        if (!isVisible) continue;

        seenElements.add(btn);
        cards.push({ element: btn, index: idx++ });
      }
    }

    // Sort by composite index (top-to-bottom, left-to-right)
    cards.sort((a, b) => a.index - b.index);

    return cards;
  }

  // Check if an element is the "Add Story Card" button (not an actual card)
  isAddCardButton(element) {
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    const text = element.textContent?.toLowerCase() || '';
    
    // Check for "Add" button characteristics via aria-label
    if (ariaLabel.includes('add story card') || ariaLabel.includes('add plot component') ||
        ariaLabel.includes('add character info')) {
      return true;
    }

    // Check text content for add-related phrases
    if (text.includes('add a story card') || text.includes('add character info')) {
      return true;
    }

    // Check for the add icon (w_add) without a heading — handles both span and p icon elements
    const iconEl = element.querySelector('.font_icons');
    const hasAddIcon = iconEl?.textContent?.includes('w_add');
    const hasHeading = element.querySelector('h1, h2, [role="heading"]');
    if (hasAddIcon && !hasHeading) {
      return true;
    }

    return false;
  }

  async findAllStoryCards() {
    // Legacy method - now uses findVisibleStoryCards internally
    return this.findVisibleStoryCards().map(card => card.element);
  }

  getCardNameFromElement(cardElement) {
    // Try to extract the card name from the card element
    const heading = cardElement.querySelector('h1, h2, [role="heading"]');
    if (heading) {
      return heading.textContent?.trim() || 'Unknown Card';
    }

    // Try paragraph elements
    const paragraph = cardElement.querySelector('p.is_Paragraph');
    if (paragraph) {
      const text = paragraph.textContent?.trim();
      if (text && text.length < 50) {
        return text;
      }
    }

    return 'Unknown Card';
  }

  // Extract card type from the list view element (before opening)
  getCardTypeFromElement(cardElement) {
    // Method 1: Type badge is a span with aria-label="type: character" (etc.)
    const typeLabel = cardElement.querySelector('span[aria-label^="type:"]');
    if (typeLabel) {
      const ariaLabel = typeLabel.getAttribute('aria-label') || '';
      const typeMatch = ariaLabel.match(/type:\s*(\w+)/i);
      if (typeMatch) {
        return typeMatch[1].toLowerCase();
      }
      // The span's text content is the type name in uppercase (e.g., "CHARACTER")
      const text = typeLabel.textContent?.trim().toLowerCase();
      if (text && this.CARD_TYPES.includes(text)) {
        return text;
      }
    }

    // Method 2: Check all text elements for type keywords
    const textElements = cardElement.querySelectorAll('span.font_body, p.is_Paragraph');
    for (const el of textElements) {
      const text = el.textContent?.trim().toLowerCase() || '';
      for (const cardType of this.CARD_TYPES) {
        if (text === cardType) {
          return cardType;
        }
      }
    }

    return null;
  }

  // Extract full card data from the opened card editor modal.
  // The modal uses labeled fields with stable IDs (scTypeLabel, scTitleLabel,
  // scEntryLabel, scTriggersLabel, scNotesLabel). Inputs reference their label
  // via aria-labelledby. The type field is a combobox button.
  extractFullCardData(cardName, cardTypeFromList = null) {
    const cardData = {
      name: cardName,
      type: cardTypeFromList || 'other',
      description: '',
      triggers: [],
      keys: [],
      entryText: '',
      hasImage: false
    };

    // Find the card editor modal as our search root
    const modal = document.querySelector('[role="alertdialog"][aria-label*="Story Card"]') ||
                  document.querySelector('[role="dialog"]');

    const root = modal || document;

    // --- Type: combobox with aria-labelledby="scTypeLabel" ---
    const typeCombobox = root.querySelector('button[role="combobox"][aria-labelledby="scTypeLabel"]');
    if (typeCombobox) {
      const typeText = typeCombobox.querySelector('span.font_body')?.textContent?.trim().toLowerCase();
      if (typeText && this.CARD_TYPES.includes(typeText)) {
        cardData.type = typeText;
      }
    }

    // --- Name: input with aria-labelledby="scTitleLabel" ---
    const nameInput = root.querySelector('input[aria-labelledby="scTitleLabel"]');
    if (nameInput?.value) {
      cardData.name = nameInput.value.trim();
    }

    // --- Entry: textarea with aria-labelledby="scEntryLabel" ---
    const entryTextarea = root.querySelector('textarea[aria-labelledby="scEntryLabel"]');
    if (entryTextarea?.value) {
      cardData.entryText = entryTextarea.value.trim();
      cardData.description = cardData.entryText;
    }

    // --- Triggers: input with aria-labelledby="scTriggersLabel" (comma-separated) ---
    const triggersInput = root.querySelector('input[aria-labelledby="scTriggersLabel"]');
    if (triggersInput?.value) {
      const parts = triggersInput.value.split(',');
      for (const part of parts) {
        const t = part.trim().toLowerCase();
        if (t.length > 0 && t.length < 50) {
          cardData.triggers.push(t);
        }
      }
    }

    // --- Notes: textarea with aria-labelledby="scNotesLabel" ---
    const notesTextarea = root.querySelector('textarea[aria-labelledby="scNotesLabel"]');
    if (notesTextarea?.value) {
      // Store notes in description if entry is empty, otherwise keep entry
      if (!cardData.description) {
        cardData.description = notesTextarea.value.trim();
      }
    }

    // --- Fallback: if aria-labelledby selectors fail, try label ID + sibling approach ---
    if (cardData.triggers.length === 0 && cardData.entryText === '') {
      this.log('Primary extraction failed, trying fallback label scan...');
      this._extractViaLabelScan(root, cardData);
    }

    // Check for image presence
    const imageElement = root.querySelector('[id="top-down-mask"], img[src*="story"], img[src*="card"]');
    cardData.hasImage = !!imageElement;

    this.log('Extracted card data:', cardData);
    return cardData;
  }

  // Fallback extraction: scan all label spans by text content and find sibling inputs
  _extractViaLabelScan(root, cardData) {
    // Labels are uppercase span.font_body elements (e.g., "TYPE", "TRIGGERS", "ENTRY")
    const labels = root.querySelectorAll('span.font_body');

    for (const label of labels) {
      const labelText = label.textContent?.trim().toUpperCase();
      if (!labelText) continue;

      // The input/textarea is a sibling or near-sibling of the label within the same column
      const container = label.closest('.is_Column') || label.parentElement;
      if (!container) continue;

      switch (labelText) {
        case 'TYPE': {
          const combobox = container.querySelector('button[role="combobox"]');
          const typeText = combobox?.querySelector('span.font_body')?.textContent?.trim().toLowerCase();
          if (typeText && this.CARD_TYPES.includes(typeText)) {
            cardData.type = typeText;
          }
          break;
        }
        case 'TRIGGERS':
        case 'TRIGGER': {
          const input = container.querySelector('input');
          if (input?.value) {
            for (const part of input.value.split(',')) {
              const t = part.trim().toLowerCase();
              if (t.length > 0 && t.length < 50) cardData.triggers.push(t);
            }
          }
          break;
        }
        case 'KEYS':
        case 'KEY': {
          const input = container.querySelector('input');
          if (input?.value) {
            for (const part of input.value.split(',')) {
              const k = part.trim().toLowerCase();
              if (k.length > 0 && k.length < 50) cardData.keys.push(k);
            }
          }
          break;
        }
        case 'ENTRY': {
          const textarea = container.querySelector('textarea');
          if (textarea?.value && textarea.value.length > cardData.entryText.length) {
            cardData.entryText = textarea.value.trim();
            if (!cardData.description) cardData.description = cardData.entryText;
          }
          break;
        }
        case 'NAME': {
          const input = container.querySelector('input');
          if (input?.value && !cardData.name) {
            cardData.name = input.value.trim();
          }
          break;
        }
      }
    }
  }

  // Get the card database (for external access)
  getCardDatabase() {
    return this.cardDatabase;
  }

  // Get analytics summary of scanned cards
  getAnalytics() {
    const analytics = {
      totalCards: this.cardDatabase.size,
      byType: {},
      withTriggers: 0,
      withoutTriggers: 0,
      withDescription: 0,
      withoutDescription: 0,
      withKeys: 0,
      averageTriggerCount: 0,
      triggerOverlaps: [], // Cards sharing the same trigger
      emptyCards: [], // Cards with no useful data
      
      // New analytics: formatting issues
      cardsWithDoubleLinebreaks: [], // Cards with \n\n in entry (confuses AI)
      
      // New analytics: entry length analysis
      longCards: [], // Cards with very long entries (>800 chars)
      veryLongCards: [], // Cards with extremely long entries (>1500 chars)
      
      // New analytics: character name frequency
      characterNameIssues: [] // Character cards where name appears <3 times
    };

    // Initialize type counts
    for (const type of this.CARD_TYPES) {
      analytics.byType[type] = 0;
    }

    let totalTriggers = 0;
    const triggerToCards = new Map(); // trigger -> [cardNames]

    this.cardDatabase.forEach((card, name) => {
      // Count by type
      const type = card.type || 'other';
      analytics.byType[type] = (analytics.byType[type] || 0) + 1;

      // Count triggers
      if (card.triggers.length > 0) {
        analytics.withTriggers++;
        totalTriggers += card.triggers.length;

        // Track trigger overlaps
        for (const trigger of card.triggers) {
          const existing = triggerToCards.get(trigger) || [];
          existing.push(name);
          triggerToCards.set(trigger, existing);
        }
      } else {
        analytics.withoutTriggers++;
      }

      // Count descriptions
      const entryContent = card.entryText || card.description || '';
      if (card.description || card.entryText) {
        analytics.withDescription++;
      } else {
        analytics.withoutDescription++;
      }

      // Count keys
      if (card.keys && card.keys.length > 0) {
        analytics.withKeys++;
      }

      // Track empty cards
      if (!card.triggers.length && !card.description && !card.entryText) {
        analytics.emptyCards.push(name);
      }

      // ===== NEW ANALYTICS =====

      // Check for double linebreaks in entry text (confuses AI into thinking it's a new card)
      if (entryContent && entryContent.includes('\n\n')) {
        const doubleLinebreakCount = (entryContent.match(/\n\n/g) || []).length;
        analytics.cardsWithDoubleLinebreaks.push({
          name,
          count: doubleLinebreakCount
        });
      }

      // Check entry length (very long cards may lose context weight at the end)
      if (entryContent.length > 800) {
        if (entryContent.length > 1500) {
          analytics.veryLongCards.push({
            name,
            length: entryContent.length
          });
        } else {
          analytics.longCards.push({
            name,
            length: entryContent.length
          });
        }
      }

      // Check character name frequency (for character cards only)
      if (type === 'character' && entryContent) {
        // Create regex to match the card name (case insensitive, whole word)
        // Escape special regex characters in the name
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp(`\\b${escapedName}\\b`, 'gi');
        const nameMatches = entryContent.match(nameRegex) || [];
        const nameCount = nameMatches.length;
        
        // If character name appears fewer than 3 times, it's a potential issue
        if (nameCount < 3) {
          analytics.characterNameIssues.push({
            name,
            occurrences: nameCount,
            entryLength: entryContent.length
          });
        }
      }
    });

    // Calculate average triggers
    if (analytics.withTriggers > 0) {
      analytics.averageTriggerCount = (totalTriggers / analytics.withTriggers).toFixed(1);
    }

    // Find trigger overlaps (same trigger used by multiple cards)
    triggerToCards.forEach((cards, trigger) => {
      if (cards.length > 1) {
        analytics.triggerOverlaps.push({
          trigger,
          cards,
          count: cards.length
        });
      }
    });

    // Sort overlaps by count (most overlapping first)
    analytics.triggerOverlaps.sort((a, b) => b.count - a.count);

    return analytics;
  }

  // Optimized: Wait for card editor modal to appear with smart detection
  async waitForCardEditor() {
    const maxWait = 500; // Maximum wait time
    const checkInterval = 25; // Check every 25ms
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      // The modal is role="alertdialog" with aria-label containing "Story Card"
      const modal = document.querySelector('[role="alertdialog"][aria-label*="Story Card"]');
      // Also check for the triggers input (most reliable field indicator)
      const triggersInput = document.querySelector('input[aria-labelledby="scTriggersLabel"]');
      
      if (modal || triggersInput) {
        // Give a tiny bit more time for input values to populate
        await this.wait(this.TIMING.MIN_WAIT);
        return true;
      }
      
      await this.wait(checkInterval);
    }
    
    // Fallback: just wait a bit if detection failed
    await this.wait(this.TIMING.CARD_OPEN_WAIT);
    return false;
  }

  // Find trigger label in the card editor modal
  findTriggerLabel() {
    // Primary: label has a stable ID
    const label = document.querySelector('#scTriggersLabel');
    if (label) return label;

    // Fallback: scan uppercase span.font_body elements
    const spans = document.querySelectorAll('span.font_body');
    for (const span of spans) {
      const text = span.textContent?.trim().toUpperCase();
      if (text === 'TRIGGERS' || text === 'TRIGGER') {
        return span;
      }
    }
    return null;
  }

  // Extract triggers from the currently open card editor (synchronous)
  extractTriggersFromOpenCard() {
    const triggers = [];

    // Primary: use aria-labelledby to find the triggers input directly
    const triggersInput = document.querySelector('input[aria-labelledby="scTriggersLabel"]');
    if (triggersInput?.value) {
      const parts = triggersInput.value.split(',');
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim().toLowerCase();
        if (t.length > 0 && t.length < 50) {
          triggers.push(t);
        }
      }
      return triggers;
    }

    // Fallback: find the TRIGGERS label and get sibling input
    const triggerLabel = this.findTriggerLabel();
    if (triggerLabel) {
      const container = triggerLabel.closest('.is_Column') || triggerLabel.parentElement;
      if (container) {
        const input = container.querySelector('input');
        if (input?.value) {
          const parts = input.value.split(',');
          for (let i = 0; i < parts.length; i++) {
            const t = parts[i].trim().toLowerCase();
            if (t.length > 0 && t.length < 50) {
              triggers.push(t);
            }
          }
        }
      }
    }

    return triggers;
  }

  // Close any open card editor - tries multiple methods for reliability
  closeCardEditor() {
    // Method 1: Find and click the Finish button inside the modal
    // The button text is "Finish" rendered as uppercase via CSS (is_ButtonText)
    const modal = document.querySelector('[role="alertdialog"][aria-label*="Story Card"]');
    if (modal) {
      const buttons = modal.querySelectorAll('[role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toUpperCase();
        if (text === 'FINISH' || text === 'DONE' || text === 'CLOSE') {
          btn.click();
          return;
        }
      }
    }

    // Method 2: Send Escape key to dismiss the modal
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // Method 3: Click any close/X button in card editor overlays
    const closeButtons = document.querySelectorAll('[aria-label="Close"], [aria-label="close"]');
    closeButtons.forEach(btn => btn.click());
  }

  // Async version that waits for card to close
  async closeCardEditorAndWait(maxWaitMs = 500) {
    this.closeCardEditor();
    
    // Wait a bit for the UI to respond
    await this.wait(100);
    
    // Check if the alertdialog modal is still open, try again
    const stillOpen = document.querySelector('[role="alertdialog"][aria-label*="Story Card"]');
    if (stillOpen) {
      this.closeCardEditor();
      await this.wait(100);
    }
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
const storyCardScanner = new StoryCardScanner();

// Make available globally
if (typeof window !== 'undefined') {
  window.StoryCardScanner = StoryCardScanner;
  window.storyCardScanner = storyCardScanner;
}
