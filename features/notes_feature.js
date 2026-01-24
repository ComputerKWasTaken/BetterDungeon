// BetterDungeon - Notes Feature
// A resizable notes panel that saves per-adventure

class NotesFeature {
  static id = 'notes';

  constructor() {
    // DOM elements
    this.notesPanel = null;
    this.toggleButton = null;
    this.textarea = null;
    
    // State
    this.currentAdventureId = null;
    this.isVisible = false;
    this.saveDebounceTimer = null;
    
    // Settings
    this.enabled = true;
    this.storageKeyPrefix = 'betterDungeon_notes_';
    this.positionStorageKey = 'betterDungeon_notesPosition';
    
    // Default position and size
    this.defaultPosition = {
      right: 16,
      bottom: 100,
      width: 320,
      height: 240
    };
    
    // Bound event handlers for cleanup
    this.boundUrlChangeHandler = null;
    
    // DOM observer for adventure detection
    this.adventureObserver = null;
    this.adventureDetectionDebounce = null;
    
    // History API originals for cleanup
    this.originalPushState = null;
    this.originalReplaceState = null;
    
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
    const settingsButton = document.querySelector('div[aria-label="Game settings"]');
    return !!(gameplayOutput && settingsButton);
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
        // Save notes for previous adventure before switching
        if (this.currentAdventureId && this.textarea) {
          this.saveNotes();
        }
        
        this.currentAdventureId = newAdventureId;
        
        // Create UI if needed and load notes
        if (!this.notesPanel) {
          this.createUI();
        }
        this.loadNotes();
      } else if (!this.notesPanel) {
        // Same adventure but UI was removed - recreate it
        this.createUI();
        this.loadNotes();
      }
    } else {
      // Not on an adventure page or UI not ready - hide UI
      if (this.currentAdventureId && this.textarea) {
        this.saveNotes();
      }
      this.currentAdventureId = null;
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

  createUI() {
    if (this.notesPanel) return;
    
    // Create toggle button
    this.toggleButton = document.createElement('button');
    this.toggleButton.className = 'bd-notes-toggle';
    this.toggleButton.innerHTML = '<span class="bd-notes-toggle-icon icon-notebook-pen"></span>';
    this.toggleButton.title = 'Toggle Notes';
    this.toggleButton.addEventListener('click', () => this.toggleVisibility());
    document.body.appendChild(this.toggleButton);
    
    // Create notes panel
    this.notesPanel = document.createElement('div');
    this.notesPanel.className = 'bd-notes-panel';
    this.notesPanel.innerHTML = `
      <div class="bd-notes-header">
        <div class="bd-notes-title">
          <span class="bd-notes-icon icon-notebook-pen"></span>
          <span>Notes</span>
        </div>
        <button class="bd-notes-close" title="Close">
          <span class="icon-x"></span>
        </button>
      </div>
      <div class="bd-notes-resize-handle"></div>
      <div class="bd-notes-body">
        <textarea class="bd-notes-textarea" placeholder="Write your notes here..."></textarea>
      </div>
    `;
    
    document.body.appendChild(this.notesPanel);
    
    // Get references to elements
    this.textarea = this.notesPanel.querySelector('.bd-notes-textarea');
    const closeBtn = this.notesPanel.querySelector('.bd-notes-close');
    const header = this.notesPanel.querySelector('.bd-notes-header');
    const resizeHandle = this.notesPanel.querySelector('.bd-notes-resize-handle');
    
    // Event listeners
    closeBtn.addEventListener('click', () => this.toggleVisibility());
    this.textarea.addEventListener('input', () => this.debouncedSave());
    
    // Dragging and resizing
    this.setupDragging(header);
    this.setupResizing(resizeHandle);
    
    // Load saved position
    this.loadPosition();
    
    // Start hidden
    this.notesPanel.classList.remove('bd-notes-visible');
    this.isVisible = false;
  }

  removeUI() {
    if (this.toggleButton) {
      this.toggleButton.remove();
      this.toggleButton = null;
    }
    
    if (this.notesPanel) {
      this.notesPanel.remove();
      this.notesPanel = null;
      this.textarea = null;
    }
    
    this.isVisible = false;
  }

  // ==================== VISIBILITY ====================

  toggleVisibility() {
    this.isVisible = !this.isVisible;
    
    if (this.notesPanel) {
      this.notesPanel.classList.toggle('bd-notes-visible', this.isVisible);
    }
    
    if (this.toggleButton) {
      this.toggleButton.classList.toggle('bd-notes-toggle-active', this.isVisible);
    }
  }

  show() {
    if (!this.isVisible) {
      this.toggleVisibility();
    }
  }

  hide() {
    if (this.isVisible) {
      this.toggleVisibility();
    }
  }

  // ==================== DRAGGING ====================

  setupDragging(header) {
    let isDragging = false;
    let startX, startY, startRight, startBottom;
    
    const onMouseDown = (e) => {
      if (e.target.closest('.bd-notes-close')) return;
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = this.notesPanel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      
      this.notesPanel.classList.add('bd-notes-dragging');
      e.preventDefault();
    };
    
    const onMouseMove = (e) => {
      if (!isDragging) return;
      
      const deltaX = startX - e.clientX;
      const deltaY = startY - e.clientY;
      
      const newRight = Math.max(0, Math.min(window.innerWidth - 200, startRight + deltaX));
      const newBottom = Math.max(0, Math.min(window.innerHeight - 100, startBottom + deltaY));
      
      this.notesPanel.style.right = newRight + 'px';
      this.notesPanel.style.bottom = newBottom + 'px';
    };
    
    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      this.notesPanel.classList.remove('bd-notes-dragging');
      this.savePosition();
    };
    
    header.addEventListener('mousedown', onMouseDown);
  }

  // ==================== RESIZING ====================

  setupResizing(handle) {
    let isResizing = false;
    let startX, startY, startWidth, startHeight, startRight, startBottom;
    
    const onMouseDown = (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = this.notesPanel.offsetWidth;
      startHeight = this.notesPanel.offsetHeight;
      
      const rect = this.notesPanel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };
    
    const onMouseMove = (e) => {
      if (!isResizing) return;
      
      // Resize from top-left: expanding left increases width, expanding up increases height
      const deltaX = startX - e.clientX;
      const deltaY = startY - e.clientY;
      
      const newWidth = Math.max(240, Math.min(600, startWidth + deltaX));
      const newHeight = Math.max(150, Math.min(500, startHeight + deltaY));
      
      this.notesPanel.style.width = newWidth + 'px';
      this.notesPanel.style.height = newHeight + 'px';
    };
    
    const onMouseUp = () => {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this.savePosition();
    };
    
    handle.addEventListener('mousedown', onMouseDown);
  }

  // ==================== STORAGE ====================

  async loadNotes() {
    if (!this.currentAdventureId || !this.textarea) return;
    
    const key = this.storageKeyPrefix + this.currentAdventureId;
    
    try {
      const result = await chrome.storage.local.get(key);
      const notes = result[key] || '';
      this.textarea.value = notes;
    } catch (e) {
      console.error('[Notes] Error loading notes:', e);
    }
  }

  async saveNotes() {
    if (!this.currentAdventureId || !this.textarea) return;
    
    const key = this.storageKeyPrefix + this.currentAdventureId;
    const notes = this.textarea.value;
    
    try {
      await chrome.storage.local.set({ [key]: notes });
    } catch (e) {
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

  async loadPosition() {
    try {
      const result = await chrome.storage.local.get(this.positionStorageKey);
      if (!this.notesPanel) return;
      
      const position = result[this.positionStorageKey] || this.defaultPosition;
      
      this.notesPanel.style.right = position.right + 'px';
      this.notesPanel.style.bottom = position.bottom + 'px';
      this.notesPanel.style.width = position.width + 'px';
      this.notesPanel.style.height = position.height + 'px';
    } catch (e) {
      console.error('[Notes] Error loading position:', e);
      if (!this.notesPanel) return;
      
      // Apply defaults
      this.notesPanel.style.right = this.defaultPosition.right + 'px';
      this.notesPanel.style.bottom = this.defaultPosition.bottom + 'px';
      this.notesPanel.style.width = this.defaultPosition.width + 'px';
      this.notesPanel.style.height = this.defaultPosition.height + 'px';
    }
  }

  async savePosition() {
    if (!this.notesPanel) return;
    
    const rect = this.notesPanel.getBoundingClientRect();
    const position = {
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      width: rect.width,
      height: rect.height
    };
    
    try {
      await chrome.storage.local.set({ [this.positionStorageKey]: position });
    } catch (e) {
      console.error('[Notes] Error saving position:', e);
    }
  }

  // ==================== PUBLIC API ====================

  // Get notes for a specific adventure
  async getNotesForAdventure(adventureId) {
    const key = this.storageKeyPrefix + adventureId;
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] || '';
    } catch (e) {
      console.error('[Notes] Error getting notes:', e);
      return '';
    }
  }

  // Set notes for a specific adventure
  async setNotesForAdventure(adventureId, notes) {
    const key = this.storageKeyPrefix + adventureId;
    try {
      await chrome.storage.local.set({ [key]: notes });
      
      // Update textarea if viewing the same adventure
      if (adventureId === this.currentAdventureId && this.textarea) {
        this.textarea.value = notes;
      }
    } catch (e) {
      console.error('[Notes] Error setting notes:', e);
    }
  }

  // Clear notes for a specific adventure
  async clearNotesForAdventure(adventureId) {
    const key = this.storageKeyPrefix + adventureId;
    try {
      await chrome.storage.local.remove(key);
      
      // Clear textarea if viewing the same adventure
      if (adventureId === this.currentAdventureId && this.textarea) {
        this.textarea.value = '';
      }
    } catch (e) {
      console.error('[Notes] Error clearing notes:', e);
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.NotesFeature = NotesFeature;
}
