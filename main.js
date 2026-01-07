// BetterDungeon - main.js
// The core orchestrator that manages feature lifecycle

const STORAGE_KEY = 'betterDungeonFeatures';

class BetterDungeon {
  constructor() {
    this.features = new Map();
    this.featureClasses = new Map();
    this.init();
  }

  init() {
    console.log('BetterDungeon: Initializing...');
    this.injectStyles();
    this.setupMessageListener();
    this.loadFeaturesFromStorage();
  }

  // Setup listener for messages from popup
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'FEATURE_TOGGLE') {
        this.handleFeatureToggle(message.featureId, message.enabled);
      } else if (message.type === 'APPLY_INSTRUCTIONS') {
        this.handleApplyInstructions().then(sendResponse);
        return true; // Keep channel open for async response
      }
    });
  }

  // Handle feature toggle from popup
  handleFeatureToggle(featureId, enabled) {
    if (enabled) {
      this.enableFeature(featureId);
    } else {
      this.disableFeature(featureId);
    }
  }

  // Load feature states from storage and register accordingly
  loadFeaturesFromStorage() {
    // Register available feature classes
    if (typeof MarkdownFeature !== 'undefined') {
      this.featureClasses.set('markdown', MarkdownFeature);
    }

    if (typeof CommandFeature !== 'undefined') {
      this.featureClasses.set('command', CommandFeature);
    }

    // Future features will be registered here
    // if (typeof FavoritesFeature !== 'undefined') {
    //   this.featureClasses.set('favorites', FavoritesFeature);
    // }

    // Load saved states
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      const savedStates = result[STORAGE_KEY] || {};

      // Enable features based on saved state (default to true if not set)
      this.featureClasses.forEach((FeatureClass, id) => {
        const enabled = savedStates[id] !== false; // Default true
        if (enabled) {
          this.enableFeature(id);
        }
      });
    });
  }

  // Enable a feature by id
  enableFeature(id) {
    if (this.features.has(id)) return; // Already enabled

    const FeatureClass = this.featureClasses.get(id);
    if (!FeatureClass) {
      console.warn(`BetterDungeon: Unknown feature "${id}"`);
      return;
    }

    const feature = new FeatureClass();
    this.features.set(id, feature);

    if (typeof feature.init === 'function') {
      feature.init();
    }

    console.log(`BetterDungeon: Enabled feature "${id}"`);
  }

  // Disable a feature by id
  disableFeature(id) {
    const feature = this.features.get(id);
    if (!feature) return; // Not enabled

    if (typeof feature.destroy === 'function') {
      feature.destroy();
    }

    this.features.delete(id);
    console.log(`BetterDungeon: Disabled feature "${id}"`);
  }

  // Get a feature by id
  getFeature(id) {
    return this.features.get(id);
  }

  // Check if a feature is enabled
  isFeatureEnabled(id) {
    return this.features.has(id);
  }

  // Handle Apply Instructions action
  async handleApplyInstructions() {
    try {
      // Fetch the instructions text from the extension
      const instructionsUrl = chrome.runtime.getURL('ai_instructions.txt');
      const response = await fetch(instructionsUrl);
      if (!response.ok) {
        return { success: false, error: 'Failed to load instructions' };
      }
      const instructionsText = await response.text();

      // Navigate to the correct settings panel and tab
      const navResult = await this.navigateToPlotSettings();
      if (!navResult.success) {
        return navResult;
      }

      // Wait for textareas to appear after navigation
      const textareas = await this.waitForTextareas();
      if (!textareas.success) {
        return textareas;
      }

      const { aiInstructionsTextarea, authorsNoteTextarea } = textareas;

      // Append instructions to both with 2 newlines for spacing
      console.log('BetterDungeon: Appending to AI Instructions...');
      this.appendToTextarea(aiInstructionsTextarea, instructionsText);
      console.log('BetterDungeon: Appending to Author\'s Note...');
      this.appendToTextarea(authorsNoteTextarea, instructionsText);

      console.log('BetterDungeon: Applied instructions to AI Instructions and Author\'s Note');
      return { success: true };
    } catch (error) {
      console.error('BetterDungeon: Error applying instructions:', error);
      return { success: false, error: error.message };
    }
  }

  // Navigate to Settings > Adventure > Plot
  async navigateToPlotSettings() {
    console.log('BetterDungeon: Navigating to Plot settings...');

    // Step 1: Open settings panel if not already open
    const settingsBtn = document.querySelector('div[aria-label="Game settings"]');
    if (!settingsBtn) {
      return { success: false, error: 'Settings button not found' };
    }

    // Check if settings panel is already open by looking for the panel content
    let panelOpen = this.isSettingsPanelOpen();
    
    if (!panelOpen) {
      console.log('BetterDungeon: Opening settings panel...');
      settingsBtn.click();
      await this.wait(300);
      
      // Wait for panel to open
      for (let i = 0; i < 10; i++) {
        if (this.isSettingsPanelOpen()) {
          panelOpen = true;
          break;
        }
        await this.wait(100);
      }
      
      if (!panelOpen) {
        return { success: false, error: 'Failed to open settings panel' };
      }
    }

    // Step 2: Click Adventure tab if not already selected
    await this.wait(200);
    const adventureTab = await this.findAndClickTab('Adventure');
    if (!adventureTab) {
      console.log('BetterDungeon: Adventure tab not found or already selected');
    }

    // Step 3: Click Plot subtab if not already selected
    await this.wait(200);
    const plotTab = await this.findAndClickTab('Plot');
    if (!plotTab) {
      console.log('BetterDungeon: Plot tab not found or already selected');
    }

    await this.wait(300);
    return { success: true };
  }

  // Check if settings panel is open
  isSettingsPanelOpen() {
    // Look for elements that only exist when panel is open
    // The panel contains tabs like "Adventure", "Plot", etc.
    const adventureTab = this.findTabByText('Adventure');
    const plotTab = this.findTabByText('Plot');
    return !!(adventureTab || plotTab);
  }

  // Find a tab button by its text content
  findTabByText(text) {
    // Look for buttons/divs with role="tab" or tab-like elements
    const allElements = document.querySelectorAll('div[role="tab"], button[role="tab"], div[tabindex="0"], button');
    for (const el of allElements) {
      const elText = el.textContent?.trim();
      if (elText === text || elText?.toLowerCase() === text.toLowerCase()) {
        return el;
      }
    }
    
    // Also check for p/span elements that might be tab labels
    const textElements = document.querySelectorAll('p, span');
    for (const el of textElements) {
      if (el.textContent?.trim() === text) {
        // Find clickable parent
        const clickable = el.closest('div[role="tab"], button[role="tab"], div[tabindex="0"], button, div[role="button"]');
        if (clickable) return clickable;
      }
    }
    
    return null;
  }

  // Find and click a tab, returns true if clicked
  async findAndClickTab(tabName) {
    const tab = this.findTabByText(tabName);
    if (tab) {
      // Check if already selected
      const isSelected = tab.getAttribute('aria-selected') === 'true' || 
                         tab.getAttribute('data-state') === 'active' ||
                         tab.classList.contains('active');
      if (!isSelected) {
        console.log(`BetterDungeon: Clicking ${tabName} tab...`);
        tab.click();
        await this.wait(200);
        return true;
      }
    }
    return false;
  }

  // Wait for textareas to appear
  async waitForTextareas(maxAttempts = 20) {
    console.log('BetterDungeon: Waiting for textareas...');
    
    for (let i = 0; i < maxAttempts; i++) {
      const aiInstructionsTextarea = document.querySelector('textarea[placeholder*="Influence the AI\'s responses"]');
      const authorsNoteTextarea = document.querySelector('textarea[placeholder*="Influence the AI\'s writing style"]');
      
      if (aiInstructionsTextarea && authorsNoteTextarea) {
        console.log('BetterDungeon: Found both textareas');
        return { 
          success: true, 
          aiInstructionsTextarea, 
          authorsNoteTextarea 
        };
      }
      
      await this.wait(150);
    }
    
    // Provide specific error
    const aiFound = !!document.querySelector('textarea[placeholder*="Influence the AI\'s responses"]');
    const noteFound = !!document.querySelector('textarea[placeholder*="Influence the AI\'s writing style"]');
    
    if (!aiFound && !noteFound) {
      return { success: false, error: 'Neither textarea found - check Plot tab' };
    } else if (!aiFound) {
      return { success: false, error: 'AI Instructions textarea not found' };
    } else {
      return { success: false, error: "Author's Note textarea not found" };
    }
  }

  // Simple wait utility
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Find a textarea by its label text
  findTextareaByLabel(labelText) {
    // Method 1: Find by aria-label attribute
    const byAriaLabel = document.querySelector(`textarea[aria-label*="${labelText}" i]`);
    if (byAriaLabel) return byAriaLabel;

    // Method 2: Find by placeholder
    const byPlaceholder = document.querySelector(`textarea[placeholder*="${labelText}" i]`);
    if (byPlaceholder) return byPlaceholder;

    // Method 3: Find by associated label element
    const labels = document.querySelectorAll('label, span, p, div');
    for (const label of labels) {
      if (label.textContent.toLowerCase().includes(labelText.toLowerCase())) {
        // Check for textarea in parent container
        const container = label.closest('div');
        if (container) {
          const textarea = container.querySelector('textarea');
          if (textarea) return textarea;
          
          // Check sibling elements
          let sibling = label.nextElementSibling;
          while (sibling) {
            if (sibling.tagName === 'TEXTAREA') return sibling;
            const nestedTextarea = sibling.querySelector('textarea');
            if (nestedTextarea) return nestedTextarea;
            sibling = sibling.nextElementSibling;
          }
        }
      }
    }

    return null;
  }

  // Append text to a textarea with proper spacing
  appendToTextarea(textarea, text) {
    const currentValue = textarea.value || '';
    const separator = currentValue.trim() ? '\n\n' : '';
    const newValue = currentValue + separator + text;
    
    console.log('BetterDungeon: Appending to textarea, current length:', currentValue.length, 'new length:', newValue.length);
    
    // Use the native setter to bypass React's controlled input
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(textarea, newValue);
    
    // Create and dispatch a proper InputEvent (React 16+ listens for this)
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    });
    textarea.dispatchEvent(inputEvent);
    
    console.log('BetterDungeon: Textarea value after update:', textarea.value.length, 'chars');
  }

  // Inject CSS styles
  injectStyles() {
    if (document.getElementById('better-dungeon-styles')) return;

    const link = document.createElement('link');
    link.id = 'better-dungeon-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles.css');
    document.head.appendChild(link);
    console.log('BetterDungeon: Styles injected');
  }

  // Cleanup
  destroy() {
    this.features.forEach((feature, id) => {
      if (typeof feature.destroy === 'function') {
        feature.destroy();
      }
    });
    this.features.clear();
    this.featureClasses.clear();
    console.log('BetterDungeon: Destroyed');
  }
}

// Global instance
let betterDungeonInstance = null;

// Initialize when DOM is ready
function initBetterDungeon() {
  if (betterDungeonInstance) {
    betterDungeonInstance.destroy();
  }
  betterDungeonInstance = new BetterDungeon();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBetterDungeon);
} else {
  initBetterDungeon();
}
