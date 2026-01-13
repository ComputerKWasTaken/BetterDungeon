// BetterDungeon - Story Card Scanner Service
// Automatically scans all story cards to extract triggers

class StoryCardScanner {
  constructor() {
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.cardTimes = [];
    this.averageCardTime = null;
  }

  async scanAllCards(onTriggerFound, onProgress) {
    if (this.isScanning) {
      console.log('StoryCardScanner: Scan already in progress');
      return { success: false, error: 'Scan already in progress' };
    }

    this.isScanning = true;
    this.abortController = new AbortController();
    this.scanStartTime = Date.now();
    this.cardTimes = [];
    this.averageCardTime = null;
    const results = new Map(); // trigger -> cardName

    try {
      // First, navigate to the Story Cards section if not already there
      const storyCardsTab = await this.findAndClickStoryCardsTab();
      if (!storyCardsTab) {
        throw new Error('Could not find Story Cards tab');
      }

      await this.wait(500); // Let the tab content load

      // Find all story card buttons/items
      const cardElements = await this.findAllStoryCards();
      const totalCards = cardElements.length;

      if (totalCards === 0) {
        console.log('StoryCardScanner: No story cards found');
        return { success: true, triggers: results, message: 'No story cards found' };
      }

      console.log(`StoryCardScanner: Found ${totalCards} story cards`);

      for (let i = 0; i < totalCards; i++) {
        if (this.abortController.signal.aborted) {
          console.log('StoryCardScanner: Scan aborted');
          return { success: false, error: 'Scan aborted by user' };
        }

        // Re-find cards each iteration as DOM may have changed
        const currentCards = await this.findAllStoryCards();
        const card = currentCards[i];
        
        if (!card) {
          console.log(`StoryCardScanner: Card ${i} not found, skipping`);
          continue;
        }

        const cardName = this.getCardNameFromElement(card);
        const cardStartTime = Date.now();
        
        // Calculate estimated time remaining
        let estimatedTimeRemaining = null;
        if (this.cardTimes.length > 0) {
          this.averageCardTime = this.cardTimes.reduce((a, b) => a + b, 0) / this.cardTimes.length;
          const remainingCards = totalCards - i;
          estimatedTimeRemaining = Math.round(this.averageCardTime * remainingCards / 1000);
        }
        
        if (onProgress) {
          onProgress(i + 1, totalCards, `Scanning: ${cardName}`, estimatedTimeRemaining);
        }

        try {
          // Click the card to open its editor
          card.click();
          await this.wait(400);

          // Extract triggers from the opened card
          const triggers = await this.extractTriggersFromOpenCard();
          
          if (triggers.length > 0) {
            triggers.forEach(trigger => {
              const existingCard = results.get(trigger);
              if (existingCard && existingCard !== cardName) {
                results.set(trigger, `${existingCard}, ${cardName}`);
              } else {
                results.set(trigger, cardName);
              }
              
              if (onTriggerFound) {
                onTriggerFound(trigger, cardName);
              }
            });
            console.log(`StoryCardScanner: Found triggers for "${cardName}":`, triggers);
          }

          // Close the card editor by clicking outside or pressing escape
          await this.closeCardEditor();
          await this.wait(300);

          // Record the time taken for this card
          const cardEndTime = Date.now();
          const cardDuration = cardEndTime - cardStartTime;
          this.cardTimes.push(cardDuration);

        } catch (cardError) {
          console.error(`StoryCardScanner: Error scanning card "${cardName}":`, cardError);
        }
      }

      console.log('StoryCardScanner: Scan complete. Found triggers:', Object.fromEntries(results));
      return { success: true, triggers: results };

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

  async findAndClickStoryCardsTab() {
    // Look for the Story Cards tab in the adventure settings
    const tabs = document.querySelectorAll('[role="tab"], [role="button"]');
    
    for (const tab of tabs) {
      const text = tab.textContent?.trim().toLowerCase();
      const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
      
      if (text === 'story cards' || ariaLabel.includes('story cards')) {
        tab.click();
        await this.wait(300);
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

  async findAllStoryCards() {
    // Story cards are typically buttons with specific structure
    // Look for card-like elements in the story cards section
    const cards = [];
    
    // Method 1: Look for elements with top-down-mask (card thumbnails)
    document.querySelectorAll('[id="top-down-mask"]').forEach(mask => {
      const cardButton = mask.closest('[role="button"]');
      if (cardButton) {
        cards.push(cardButton);
      }
    });

    // Method 2: If no cards found, look for button elements that look like cards
    if (cards.length === 0) {
      document.querySelectorAll('[role="button"].is_Button').forEach(btn => {
        // Check if this looks like a story card (has certain child structure)
        const hasImage = btn.querySelector('img, [id="top-down-mask"]');
        const hasText = btn.querySelector('h1, p.is_Paragraph');
        if (hasImage || (hasText && btn.closest('[class*="grid"], [class*="list"]'))) {
          cards.push(btn);
        }
      });
    }

    return cards;
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

  async extractTriggersFromOpenCard() {
    const triggers = [];
    
    // Look for TRIGGERS label and associated input
    const paragraphs = document.querySelectorAll('p.is_Paragraph');
    
    for (const p of paragraphs) {
      const text = p.textContent?.trim().toUpperCase();
      if (text === 'TRIGGERS' || text === 'TRIGGER') {
        const container = p.closest('.is_Column') || p.parentElement;
        if (container) {
          // Find inputs in the same container
          const inputs = container.querySelectorAll('input, textarea');
          for (const input of inputs) {
            if (input.value) {
              const parsed = input.value.split(',')
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0 && t.length < 50);
              triggers.push(...parsed);
            }
          }
        }
      }
    }

    return triggers;
  }

  async closeCardEditor() {
    // Method 1: Press Escape key
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true
    }));

    await this.wait(200);

    // Method 2: Look for close/back button
    const closeButtons = document.querySelectorAll('[aria-label="Close"], [aria-label="Back"], button');
    for (const btn of closeButtons) {
      const text = btn.textContent?.toLowerCase() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      if (text.includes('close') || text.includes('back') || text.includes('finish') ||
          ariaLabel.includes('close') || ariaLabel.includes('back')) {
        btn.click();
        break;
      }
    }

    // Method 3: Click the FINISH button if present
    const finishButton = Array.from(document.querySelectorAll('[role="button"]'))
      .find(btn => btn.textContent?.trim().toUpperCase() === 'FINISH');
    if (finishButton) {
      finishButton.click();
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
