// BetterDungeon - Story Card Scanner Service
// Automatically scans all story cards to extract triggers

class StoryCardScanner {
  constructor() {
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.scannedIndices = new Set(); // Track which card indices have been scanned
    
    // Performance optimization: adaptive timing
    this.totalCardTime = 0;
    this.cardCount = 0;
    this.averageCardTime = null;
    
    // Debug mode - set to true to enable verbose logging
    this.DEBUG = false;
    
    // Timing constants (ms) - optimized for speed
    this.TIMING = {
      CARD_OPEN_WAIT: 100,      // Wait after clicking card
      CARD_CLOSE_WAIT: 75,      // Wait after closing card
      SCROLL_WAIT: 100,         // Wait after scrolling
      TAB_LOAD_WAIT: 200,       // Wait for tab content to load
      MIN_WAIT: 30,             // Minimum wait time
      MAX_RETRIES: 3            // Max retries for element detection
    };
    
    // Scroll multiplier - how much of the viewport to scroll (1.5 = 150%)
    this.SCROLL_MULTIPLIER = 1.5;
  }

  async scanAllCards(onTriggerFound, onProgress) {
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
    const results = new Map(); // trigger -> cardName

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
          (count) => { scannedCount = count; }
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
            (count) => { scannedCount = count; }
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

      return { success: true, triggers: results, scannedCount };

    } catch (error) {
      console.error('StoryCardScanner: Scan failed:', error);
      // Check if this is an abort error
      if (error.name === 'AbortError' || this.abortController?.signal.aborted) {
        return { success: false, error: 'Scan aborted by user' };
      }
      return { success: false, error: error.message };
    } finally {
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
  async scanVisibleCards(scrollContainer, results, totalCards, onTriggerFound, onProgress, getCount, setCount) {
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

        // Extract triggers from the opened card
        const triggers = this.extractTriggersFromOpenCard();

        if (triggers.length > 0) {
          for (const trigger of triggers) {
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

        // Close the card editor
        this.closeCardEditor();
        await this.wait(this.TIMING.CARD_CLOSE_WAIT);

        // Record timing
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

    // Scroll by larger amount for faster scanning
    const scrollAmount = scrollContainer.clientHeight * this.SCROLL_MULTIPLIER;
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

  // Optimized: Close card editor (synchronous, faster)
  closeCardEditor() {
    // Primary method: Press Escape key (fastest and most reliable)
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true,
      cancelable: true
    }));

    // Backup: Find and click FINISH button if visible (no loop, direct query)
    const finishButton = document.querySelector('[role="button"] .is_ButtonText');
    if (finishButton?.textContent?.trim().toUpperCase() === 'FINISH') {
      finishButton.closest('[role="button"]')?.click();
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
