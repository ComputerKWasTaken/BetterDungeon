// BetterDungeon - Notes Feature
// An embedded notes card in Plot Components that saves per-adventure

class NotesFeature {
  static id = 'notes';

  constructor() {
    // DOM elements
    this.notesCard = null;
    this.notesCardWrapper = null;
    this.textarea = null;
    
    // State
    this.currentAdventureId = null;
    this.loadedAdventureId = null;
    this.saveDebounceTimer = null;
    
    // Settings
    this.enabled = true;
    this.storageKeyPrefix = 'betterDungeon_notes_';
    
    // Bound event handlers for cleanup
    this.boundUrlChangeHandler = null;
    
    // DOM observer for adventure detection
    this.adventureObserver = null;
    this.adventureDetectionDebounce = null;

    this.uiRetryTimer = null;
    this.uiRetryCount = 0;
    this.maxUiRetries = 12;
    
    // History API originals for cleanup
    this.originalPushState = null;
    this.originalReplaceState = null;
    
    this.debug = false;
  }

  // Check if the Chrome extension runtime is still alive.
  // Returns false after extension reload/update/disable while the content script lingers.
  isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  // ==================== LIFECYCLE ====================

  async init() {
    console.log('[Notes] Initializing Notes feature...');
    
    this.detectCurrentAdventure();
    
    if (this.currentAdventureId) {
      this.createUI();
      await this.loadNotes();
    }
    
    this.startAdventureChangeDetection();
    console.log('[Notes] Initialization complete');
  }

  destroy() {
    console.log('[Notes] Destroying Notes feature...');
    
    // Save any pending notes
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveNotes();
    }
    
    // Remove UI elements
    this.removeUI();
    
    // Clean up event listeners and observers
    this.stopAdventureChangeDetection();
    
    console.log('[Notes] Cleanup complete');
  }

  // ==================== ADVENTURE DETECTION ====================

  // Check if adventure UI elements are present in the DOM
  isAdventureUIPresent() {
    // These elements are always present on an active adventure page
    const gameplayOutput = document.querySelector('#gameplay-output');
    const settingsButton = document.querySelector(
      '[aria-label="Game settings"], [aria-label="Game Settings"], [aria-label="Game Menu"], [aria-label="Game menu"]'
    );
    const navigationBar = document.querySelector('[aria-label="Navigation bar"]');
    return !!(gameplayOutput && (settingsButton || navigationBar));
  }

  // Extract adventure ID from URL
  getAdventureIdFromUrl() {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    return match ? match[1] : null;
  }

  detectCurrentAdventure() {
    const newAdventureId = this.getAdventureIdFromUrl();
    const adventureUIPresent = this.isAdventureUIPresent();
    
    // Only consider us "on an adventure" if both URL matches AND UI is present
    const isOnAdventure = newAdventureId && adventureUIPresent;
    
    if (isOnAdventure) {
      if (newAdventureId !== this.currentAdventureId) {
        if (this.currentAdventureId && this.textarea) {
          this.saveNotes();
        }

        this.currentAdventureId = newAdventureId;
        this.loadedAdventureId = null;
      }

      this.createUI();

      if (this.currentAdventureId && this.textarea && this.loadedAdventureId !== this.currentAdventureId) {
        this.loadNotes();
        this.loadedAdventureId = this.currentAdventureId;
      }
    } else {
      if (this.currentAdventureId && this.textarea) {
        this.saveNotes();
      }
      this.currentAdventureId = null;
      this.loadedAdventureId = null;
      this.removeUI();
    }
  }

  startAdventureChangeDetection() {
    // URL change detection
    this.boundUrlChangeHandler = () => this.detectCurrentAdventure();
    window.addEventListener('popstate', this.boundUrlChangeHandler);
    
    // Watch for URL changes via history API
    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;
    
    history.pushState = (...args) => {
      this.originalPushState.apply(history, args);
      this.detectCurrentAdventure();
    };
    
    history.replaceState = (...args) => {
      this.originalReplaceState.apply(history, args);
      this.detectCurrentAdventure();
    };
    
    // DOM observer with debounce to detect when adventure UI appears/disappears
    this.adventureObserver = new MutationObserver(() => {
      // Debounce to prevent excessive calls during rapid DOM changes
      if (this.adventureDetectionDebounce) {
        clearTimeout(this.adventureDetectionDebounce);
      }
      this.adventureDetectionDebounce = setTimeout(() => {
        this.detectCurrentAdventure();
      }, 100);
    });
    
    this.adventureObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  stopAdventureChangeDetection() {
    // Remove popstate listener
    if (this.boundUrlChangeHandler) {
      window.removeEventListener('popstate', this.boundUrlChangeHandler);
      this.boundUrlChangeHandler = null;
    }
    
    // Restore original history methods
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
    
    // Disconnect observer
    if (this.adventureObserver) {
      this.adventureObserver.disconnect();
      this.adventureObserver = null;
    }
    
    // Clear debounce timer
    if (this.adventureDetectionDebounce) {
      clearTimeout(this.adventureDetectionDebounce);
      this.adventureDetectionDebounce = null;
    }
  }

  // ==================== UI CREATION ====================

  findPlotTab() {
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
      if (ariaLabel.includes('plot')) {
        return tab;
      }
    }
    return null;
  }

  scheduleUiRetry() {
    if (this.uiRetryTimer || this.uiRetryCount >= this.maxUiRetries) return;

    this.uiRetryTimer = setTimeout(() => {
      this.uiRetryTimer = null;
      this.uiRetryCount += 1;
      this.createUI();
    }, 400);
  }

  isTabSelected(tab) {
    if (!tab) return false;

    const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
    if (ariaLabel.includes('selected tab')) {
      return true;
    }

    if (tab.getAttribute('aria-selected') === 'true') return true;
    if (tab.getAttribute('data-state') === 'active') return true;
    if (tab.classList.contains('active')) return true;

    const classList = tab.className || '';
    if (classList.includes('_bbc-c-primary') && !classList.includes('_bbc-c-coreA0')) {
      return true;
    }

    return false;
  }

  isPlotTabActive() {
    const plotTab = this.findPlotTab();
    if (plotTab && this.isTabSelected(plotTab)) return true;

    return !!this.findAddPlotComponentButton();
  }

  findAddPlotComponentButton() {
    const byAriaLabel = document.querySelector('[aria-label="Add Plot Component"]');
    if (byAriaLabel) return byAriaLabel;

    const buttons = document.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      if (btn.textContent?.toLowerCase().includes('add plot component')) {
        return btn;
      }
    }
    return null;
  }

  findPlotComponentCardByTitle(title) {
    const normalizedTitle = title.toLowerCase();
    const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div');

    // Walk up from the title to the card container with a textarea.
    for (const el of elements) {
      if (el.closest('.bd-notes-card')) continue;
      const text = el.textContent?.trim().toLowerCase();
      if (!text || !text.startsWith(normalizedTitle)) continue;

      let card = el.closest('[class*="Column"], [class*="Card"], section, article, div');
      while (card && !card.querySelector('textarea')) {
        card = card.parentElement;
      }
      if (card) {
        return card;
      }
    }

    return null;
  }

  findPlotComponentsContainer() {
    const addButton = this.findAddPlotComponentButton();
    if (addButton) {
      const addColumn = addButton.closest('[class*="Column"], [class*="column"]') || addButton.parentElement;
      if (addColumn) {
        let child = addColumn;
        let node = addColumn.parentElement;
        while (node) {
          const className = node.className || '';
          const isColumn = className.includes('Column') || className.includes('column');
          const isStretch = className.includes('_ai-stretch') || className.includes('stretch');
          const isCentered = className.includes('_ai-center') || className.includes('center');

          if (isColumn && isStretch && !isCentered) {
            // Insert above the Add Plot Component area, but inside the full-width Plot Components column.
            return { container: node, insertBefore: child };
          }

          child = node;
          node = node.parentElement;
        }
      }

      const addRow = addButton.closest('[class*="Row"], [class*="row"]') || addButton.parentElement;
      const container = addRow?.parentElement || addRow;
      if (container) {
        // Insert above the Add Plot Component button so it stays last.
        return { container, insertBefore: addRow };
      }
    }

    // Fallback: append after the last existing plot component.
    const plotEssentialsCard = this.findPlotComponentCardByTitle('plot essentials');
    if (plotEssentialsCard?.parentElement) {
      return { container: plotEssentialsCard.parentElement, insertBefore: null };
    }

    const authorNoteCard = this.findPlotComponentCardByTitle("author's note");
    if (authorNoteCard?.parentElement) {
      return { container: authorNoteCard.parentElement, insertBefore: null };
    }

    const fallbackCard = this.findPlotComponentCardByTitle('ai instructions');
    if (fallbackCard?.parentElement) {
      return { container: fallbackCard.parentElement, insertBefore: null };
    }

    return null;
  }

  buildNotesCardMarkup() {
    return `
      <div class="bd-notes-card-header">
        <div class="bd-notes-card-title">
          <span class="bd-notes-icon icon-notebook-pen"></span>
          <span>Notes</span>
        </div>
      </div>
      <div class="bd-notes-card-body">
        <div class="bd-notes-helper">Private to you — not sent to the AI.</div>
        <textarea class="bd-notes-textarea" placeholder="Write your notes here..."></textarea>
      </div>
    `;
  }

  createUI() {
    const wrapperDetached = this.notesCardWrapper && !document.body.contains(this.notesCardWrapper);
    const cardDetached = this.notesCard && !document.body.contains(this.notesCard);
    if (wrapperDetached || cardDetached) {
      this.notesCard = null;
      this.notesCardWrapper = null;
      this.textarea = null;
    }

    const insertion = this.findPlotComponentsContainer();
    if (!this.isPlotTabActive() && !insertion?.container) {
      this.removeUI();
      return;
    }

    if (!insertion?.container) {
      this.scheduleUiRetry();
      return;
    }

    this.uiRetryCount = 0;
    if (this.uiRetryTimer) {
      clearTimeout(this.uiRetryTimer);
      this.uiRetryTimer = null;
    }

    const existingContainer = this.notesCardWrapper || this.notesCard;
    if (existingContainer && insertion.container.contains(existingContainer)) {
      if (!this.textarea) {
        this.textarea = this.notesCard.querySelector('.bd-notes-textarea');
      }
      return;
    }

    document.querySelectorAll('.bd-notes-card-wrapper').forEach(wrapper => wrapper.remove());
    document.querySelectorAll('.bd-notes-card').forEach(card => card.remove());

    this.notesCardWrapper = document.createElement('div');
    this.notesCardWrapper.className = 'bd-notes-card-wrapper';
    this.notesCardWrapper.setAttribute('data-bd-notes-wrapper', 'true');

    this.notesCard = document.createElement('div');
    this.notesCard.className = 'bd-notes-card';
    this.notesCard.setAttribute('data-bd-notes-card', 'true');
    this.notesCard.innerHTML = this.buildNotesCardMarkup();

    this.notesCardWrapper.appendChild(this.notesCard);

    if (insertion.insertBefore && insertion.container.contains(insertion.insertBefore)) {
      insertion.container.insertBefore(this.notesCardWrapper, insertion.insertBefore);
    } else {
      insertion.container.appendChild(this.notesCardWrapper);
    }

    this.textarea = this.notesCard.querySelector('.bd-notes-textarea');

    this.textarea?.addEventListener('input', () => this.debouncedSave());
  }

  removeUI() {
    if (this.notesCardWrapper) {
      this.notesCardWrapper.remove();
      this.notesCardWrapper = null;
    } else if (this.notesCard) {
      this.notesCard.remove();
    }

    this.notesCard = null;
    this.textarea = null;
    this.loadedAdventureId = null;

    if (this.uiRetryTimer) {
      clearTimeout(this.uiRetryTimer);
      this.uiRetryTimer = null;
    }
  }

  // ==================== STORAGE ====================

  async loadNotes() {
    if (!this.currentAdventureId || !this.textarea) return;
    if (!this.isExtensionContextValid()) return;
    
    const key = this.storageKeyPrefix + this.currentAdventureId;
    
    try {
      const result = await chrome.storage.local.get(key);
      const notes = result[key] || '';
      if (this.textarea) {
        this.textarea.value = notes;
      }
    } catch (e) {
      // Silently ignore extension context invalidation — this is a benign
      // race that occurs when the extension reloads while the page is open.
      if (String(e).includes('Extension context invalidated')) {
        this.log('[Notes] Extension context invalidated, skipping load');
        return;
      }
      console.error('[Notes] Error loading notes:', e);
    }
  }

  async saveNotes() {
    if (!this.currentAdventureId || !this.textarea) return;
    if (!this.isExtensionContextValid()) return;
    
    const key = this.storageKeyPrefix + this.currentAdventureId;
    const notes = this.textarea.value;
    
    try {
      await chrome.storage.local.set({ [key]: notes });
    } catch (e) {
      if (String(e).includes('Extension context invalidated')) {
        this.log('[Notes] Extension context invalidated, skipping save');
        return;
      }
      console.error('[Notes] Error saving notes:', e);
    }
  }

  debouncedSave() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = setTimeout(() => {
      this.saveNotes();
    }, 500);
  }

  // ==================== PUBLIC API ====================

  // Get notes for a specific adventure
  async getNotesForAdventure(adventureId) {
    if (!this.isExtensionContextValid()) return '';
    const key = this.storageKeyPrefix + adventureId;
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] || '';
    } catch (e) {
      if (String(e).includes('Extension context invalidated')) return '';
      console.error('[Notes] Error getting notes:', e);
      return '';
    }
  }

  // Set notes for a specific adventure
  async setNotesForAdventure(adventureId, notes) {
    if (!this.isExtensionContextValid()) return;
    const key = this.storageKeyPrefix + adventureId;
    try {
      await chrome.storage.local.set({ [key]: notes });
      
      // Update textarea if viewing the same adventure
      if (adventureId === this.currentAdventureId && this.textarea) {
        this.textarea.value = notes;
      }
    } catch (e) {
      if (String(e).includes('Extension context invalidated')) return;
      console.error('[Notes] Error setting notes:', e);
    }
  }

  // Clear notes for a specific adventure
  async clearNotesForAdventure(adventureId) {
    if (!this.isExtensionContextValid()) return;
    const key = this.storageKeyPrefix + adventureId;
    try {
      await chrome.storage.local.remove(key);
      
      // Clear textarea if viewing the same adventure
      if (adventureId === this.currentAdventureId && this.textarea) {
        this.textarea.value = '';
      }
    } catch (e) {
      if (String(e).includes('Extension context invalidated')) return;
      console.error('[Notes] Error clearing notes:', e);
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.NotesFeature = NotesFeature;
}
