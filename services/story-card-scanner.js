// BetterDungeon - Story Card Scanner Service
// Automatically scans all story cards to extract triggers

class StoryCardScanner {
  constructor() {
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.scannedIndices = new Set(); // Track which card indices have been scanned
    
    // Rich card data storage: Map of cardName -> { type, description, triggers, keys, name }
    this.cardDatabase = new Map();
    
    // Performance optimization: adaptive timing
    this.totalCardTime = 0;
    this.cardCount = 0;
    this.averageCardTime = null;
    
    // Debug mode - set to true to enable verbose logging
    this.DEBUG = false;
    
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

  // Main scan method - now returns rich card data
  // Callbacks: onCardScanned(cardData), onProgress(current, total, status, eta)
  async scanAllCards(onTriggerFound, onProgress, onCardScanned) {
    if (this.isScanning) {
      return { success: false, error: 'Scan already in progress' };
    }

    this.isScanning = true;
    this.abortController = new AbortController();
    this.scanStartTime = Date.now();
    this.totalCardTime = 0;
    this.cardCount = 0;
    this.averageCardTime = null;
    this.scannedIndices = new Set();
    this.cardDatabase = new Map(); // Reset card database
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
        this.log('ERROR: Could not find scroll container');
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

      // Skip if already scanned (by index) or if it's the "Add" button
      if (this.scannedIndices.has(index) || this.isAddCardButton(card)) {
        continue;
      }

      // Mark as scanned and update count
      this.scannedIndices.add(index);
      const currentCount = getCount() + 1;
      setCount(currentCount);
      newCardsScanned++;

      const cardName = this.getCardNameFromElement(card);
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

    // Scroll by approximately 60% of viewport to ensure overlap for card detection
    const scrollAmount = scrollContainer.clientHeight * 0.6;
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
  
  // Debug logging helper
  log(...args) {
    if (this.DEBUG) {
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
    // Look for the Story Cards tab which shows the count (e.g., "Story Cards" with a number badge)
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const text = tab.textContent?.toLowerCase() || '';
      if (text.includes('story cards')) {
        // Look for a number in the tab (the count badge)
        const countElement = tab.querySelector('p.is_Paragraph');
        if (countElement) {
          const countText = countElement.textContent?.trim();
          const count = parseInt(countText, 10);
          if (!isNaN(count)) {
            return count;
          }
        }
        // Try extracting from full text
        const match = text.match(/(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    }

    // Fallback: count currently visible cards (may be incomplete due to virtualization)
    const visibleCards = this.findVisibleStoryCards();
    return visibleCards.length;
  }

  // Find the scrollable container for the story cards list
  findScrollContainer() {
    // The virtualized list container typically has overflow:auto/scroll and contains the cards
    // Look for containers with virtualized list characteristics
    
    // Method 1: Find by the structure - look for scrollable div containing card elements
    const cardContainers = document.querySelectorAll('[style*="overflow"], [class*="scroll"]');
    for (const container of cardContainers) {
      const style = window.getComputedStyle(container);
      const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                          style.overflow === 'auto' || style.overflow === 'scroll';
      
      if (hasOverflow) {
        // Check if this container has story cards inside
        const hasCards = container.querySelector('[role="button"][index], [role="button"] h1, [id="top-down-mask"]');
        if (hasCards) {
          return container;
        }
      }
    }

    // Method 2: Look for virtualized list patterns (elements with index attribute and transform)
    const virtualizedItems = document.querySelectorAll('[index][style*="transform"]');
    if (virtualizedItems.length > 0) {
      // Find the common scrollable ancestor
      let current = virtualizedItems[0].parentElement;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
            style.overflow === 'auto' || style.overflow === 'scroll') {
          return current;
        }
        // Also check for r-scroll classes (common in the AI Dungeon UI)
        if (current.className?.includes('scroll') || current.className?.includes('r-150rngu')) {
          return current;
        }
        current = current.parentElement;
      }
    }

    // Method 3: Find scrollable panel in the adventure settings area
    const panels = document.querySelectorAll('.is_Column');
    for (const panel of panels) {
      const style = window.getComputedStyle(panel);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && 
          panel.scrollHeight > panel.clientHeight) {
        const hasCardContent = panel.querySelector('[role="button"] h1, [id="top-down-mask"]');
        if (hasCardContent) {
          return panel;
        }
      }
    }

    return null;
  }

  // Find currently visible story cards in the DOM (works with any view mode)
  // Now filters by actual visual position to handle virtual lists properly
  findVisibleStoryCards(scrollContainer = null) {
    const cards = [];
    const seenElements = new Set();
    
    // Get the scroll container bounds if provided
    const containerRect = scrollContainer?.getBoundingClientRect();
    const viewportTop = containerRect?.top ?? 0;
    const viewportBottom = containerRect?.bottom ?? window.innerHeight;

    // Method 1: Look for virtualized items with index attribute (most reliable for virtual lists)
    document.querySelectorAll('[index][style*="transform"]').forEach(item => {
      const index = parseInt(item.getAttribute('index'), 10);
      const cardButton = item.querySelector('[role="button"]') || 
                         (item.matches('[role="button"]') ? item : null);
      
      if (cardButton && !seenElements.has(cardButton) && !isNaN(index)) {
        // Check if the card is actually visible in the viewport
        const rect = item.getBoundingClientRect();
        const isVisible = rect.bottom > viewportTop && rect.top < viewportBottom;
        
        if (isVisible) {
          seenElements.add(cardButton);
          cards.push({ element: cardButton, index });
        }
      }
    });

    // Method 2: Look for cards with top-down-mask (Large view)
    if (cards.length === 0) {
      document.querySelectorAll('[id="top-down-mask"]').forEach((mask, idx) => {
        const cardButton = mask.closest('[role="button"]');
        if (cardButton && !seenElements.has(cardButton)) {
          // Check visibility
          const rect = cardButton.getBoundingClientRect();
          const isVisible = rect.bottom > viewportTop && rect.top < viewportBottom;
          
          if (isVisible) {
            seenElements.add(cardButton);
            const parent = cardButton.closest('[index]');
            const index = parent ? parseInt(parent.getAttribute('index'), 10) : idx;
            cards.push({ element: cardButton, index: isNaN(index) ? idx : index });
          }
        }
      });
    }

    // Method 3: Look for list-style cards (List view) - buttons with headings
    if (cards.length === 0) {
      document.querySelectorAll('[role="button"].is_Button').forEach((btn, idx) => {
        // Check if this looks like a story card
        const hasHeading = btn.querySelector('h1, h2, [role="heading"]');
        const hasCardType = btn.querySelector('p[aria-label*="type:"]');
        const isInCardArea = btn.closest('[class*="grid"], [class*="Column"]');
        
        if ((hasHeading || hasCardType) && isInCardArea && !seenElements.has(btn)) {
          // Check visibility
          const rect = btn.getBoundingClientRect();
          const isVisible = rect.bottom > viewportTop && rect.top < viewportBottom;
          
          if (isVisible) {
            seenElements.add(btn);
            const parent = btn.closest('[index]');
            const index = parent ? parseInt(parent.getAttribute('index'), 10) : idx;
            cards.push({ element: btn, index: isNaN(index) ? idx : index });
          }
        }
      });
    }

    // Sort by index to ensure consistent ordering
    cards.sort((a, b) => a.index - b.index);

    return cards;
  }

  // Check if an element is the "Add Story Card" button (not an actual card)
  isAddCardButton(element) {
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    const text = element.textContent?.toLowerCase() || '';
    
    // Check for "Add" button characteristics
    if (ariaLabel.includes('add') || text.includes('add character info') || 
        text.includes('add a story card')) {
      return true;
    }

    // Check for the add icon (w_add) without a heading
    const hasAddIcon = element.querySelector('p.font_icons')?.textContent?.includes('w_add');
    const hasHeading = element.querySelector('h1, h2');
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
    // Look for type indicator in the card preview
    // AI Dungeon typically shows type as a label like "type: character"
    const typeLabel = cardElement.querySelector('p[aria-label*="type:"]');
    if (typeLabel) {
      const ariaLabel = typeLabel.getAttribute('aria-label') || '';
      const typeMatch = ariaLabel.match(/type:\s*(\w+)/i);
      if (typeMatch) {
        return typeMatch[1].toLowerCase();
      }
    }

    // Check for type in text content
    const paragraphs = cardElement.querySelectorAll('p.is_Paragraph');
    for (const p of paragraphs) {
      const text = p.textContent?.trim().toLowerCase() || '';
      for (const cardType of this.CARD_TYPES) {
        if (text === cardType || text.includes(`type: ${cardType}`)) {
          return cardType;
        }
      }
    }

    return null;
  }

  // Extract full card data from the opened card editor
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

    // Find all labeled sections in the card editor
    const labels = document.querySelectorAll('.is_Column > p.is_Paragraph, .is_Row > p.is_Paragraph');
    
    for (const label of labels) {
      const labelText = label.textContent?.trim().toUpperCase() || '';
      const container = label.closest('.is_Column') || label.parentElement;
      
      if (!container) continue;

      // Get all inputs/textareas in this section
      const inputs = container.querySelectorAll('input, textarea');
      const inputValues = Array.from(inputs).map(i => i.value).filter(v => v);

      switch (labelText) {
        case 'TYPE':
          // Extract type from dropdown or text
          const typeValue = this.extractTypeFromSection(container);
          if (typeValue) {
            cardData.type = typeValue.toLowerCase();
          }
          break;

        case 'TRIGGERS':
        case 'TRIGGER':
          // Extract triggers (comma-separated)
          for (const value of inputValues) {
            const parts = value.split(',');
            for (const part of parts) {
              const t = part.trim().toLowerCase();
              if (t.length > 0 && t.length < 50) {
                cardData.triggers.push(t);
              }
            }
          }
          break;

        case 'KEYS':
        case 'KEY':
          // Extract keys (comma-separated)
          for (const value of inputValues) {
            const parts = value.split(',');
            for (const part of parts) {
              const k = part.trim().toLowerCase();
              if (k.length > 0 && k.length < 50) {
                cardData.keys.push(k);
              }
            }
          }
          break;

        case 'ENTRY':
        case 'ENTRY TEXT':
          // Extract entry/description text
          for (const value of inputValues) {
            if (value.length > cardData.entryText.length) {
              cardData.entryText = value;
            }
          }
          break;

        case 'DESCRIPTION':
        case 'DETAILS':
          // Extract description
          for (const value of inputValues) {
            if (value.length > cardData.description.length) {
              cardData.description = value;
            }
          }
          break;
      }
    }

    // If no description found, use entry text as fallback
    if (!cardData.description && cardData.entryText) {
      cardData.description = cardData.entryText;
    }

    // Check for image presence
    const imageElement = document.querySelector('[id="top-down-mask"], img[src*="story"], img[src*="card"]');
    cardData.hasImage = !!imageElement;

    this.log('Extracted card data:', cardData);
    return cardData;
  }

  // Extract type from a TYPE section (handles dropdowns and text)
  extractTypeFromSection(container) {
    // Check for selected option in dropdown-like elements
    const selectedOption = container.querySelector('[aria-selected="true"], [data-selected="true"]');
    if (selectedOption) {
      return selectedOption.textContent?.trim();
    }

    // Check for button text (AI Dungeon uses buttons for type selection)
    const buttons = container.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase();
      if (this.CARD_TYPES.includes(text)) {
        return text;
      }
    }

    // Check paragraph elements
    const paragraphs = container.querySelectorAll('p.is_Paragraph');
    for (const p of paragraphs) {
      const text = p.textContent?.trim().toLowerCase();
      if (this.CARD_TYPES.includes(text)) {
        return text;
      }
    }

    return null;
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
      emptyCards: [] // Cards with no useful data
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

  // Optimized: Wait for card editor to appear with smart detection
  async waitForCardEditor() {
    const maxWait = 500; // Maximum wait time
    const checkInterval = 25; // Check every 25ms
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      // Look for card editor indicators (TRIGGERS label or card editing UI)
      const hasEditor = document.querySelector('input[placeholder*="trigger"], p.is_Paragraph');
      const triggerLabel = this.findTriggerLabel();
      
      if (triggerLabel || hasEditor) {
        // Give a tiny bit more time for inputs to populate
        await this.wait(this.TIMING.MIN_WAIT);
        return true;
      }
      
      await this.wait(checkInterval);
    }
    
    // Fallback: just wait a bit if detection failed
    await this.wait(this.TIMING.CARD_OPEN_WAIT);
    return false;
  }

  // Optimized: Find trigger label with cached selector
  findTriggerLabel() {
    // Use more specific selector to find TRIGGERS label faster
    const labels = document.querySelectorAll('.is_Column > p.is_Paragraph');
    for (const p of labels) {
      const text = p.textContent?.trim().toUpperCase();
      if (text === 'TRIGGERS' || text === 'TRIGGER') {
        return p;
      }
    }
    return null;
  }

  // Optimized: Extract triggers with targeted DOM queries (synchronous - no async needed)
  extractTriggersFromOpenCard() {
    const triggers = [];
    
    // Find the TRIGGERS label using optimized method
    const triggerLabel = this.findTriggerLabel();
    
    if (triggerLabel) {
      const container = triggerLabel.closest('.is_Column') || triggerLabel.parentElement;
      if (container) {
        // Find inputs in the same container - use direct query
        const inputs = container.querySelectorAll('input, textarea');
        for (const input of inputs) {
          const value = input.value;
          if (value) {
            // Optimized string splitting
            const parts = value.split(',');
            for (let i = 0; i < parts.length; i++) {
              const t = parts[i].trim().toLowerCase();
              if (t.length > 0 && t.length < 50) {
                triggers.push(t);
              }
            }
          }
        }
      }
    }

    return triggers;
  }

  // Close any open card editor - tries multiple methods for reliability
  closeCardEditor() {
    // Method 1: Find and click FINISH button if visible
    const buttons = document.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toUpperCase();
      if (text === 'FINISH' || text === 'DONE' || text === 'CLOSE') {
        btn.click();
        break;
      }
    }

    // Method 2: Click any close/X button in card editor overlays
    const closeButtons = document.querySelectorAll('[aria-label="Close"], [aria-label="close"], .close-button, [data-testid="close"]');
    closeButtons.forEach(btn => btn.click());

    // Method 3: Try clicking outside the card editor modal (backdrop click)
    const cardEditorBackdrop = document.querySelector('.is_Modal__backdrop, [class*="backdrop"], [class*="overlay"]');
    if (cardEditorBackdrop && !cardEditorBackdrop.closest('.bd-analytics-dashboard')) {
      cardEditorBackdrop.click();
    }
  }

  // Async version that waits for card to close
  async closeCardEditorAndWait(maxWaitMs = 500) {
    this.closeCardEditor();
    
    // Wait a bit for the UI to respond
    await this.wait(100);
    
    // Check if card editor is still open, try again
    const stillOpen = document.querySelector('[class*="CardEditor"], [class*="card-editor"], [data-testid*="card-editor"]');
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
