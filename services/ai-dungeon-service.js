// BetterDungeon - AI Dungeon Service
// Handles AI Dungeon-specific navigation and interaction logic

class AIDungeonService {
  constructor() {
    this.domUtils = window.DOMUtils;
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  // ==================== VALIDATION ====================

  // Check if we're on the AI Dungeon website
  isOnAIDungeon() {
    return window.location.hostname.includes('aidungeon.com');
  }

  // Check if we're on an adventure page (required for settings)
  isOnAdventurePage() {
    return window.location.pathname.includes('/adventure/');
  }

  // ==================== SETTINGS PANEL DETECTION ====================

  // Check if the settings panel is currently open
  isSettingsPanelOpen() {
    // Settings panel contains tabs like "Adventure", "General", etc.
    // Check for the presence of the settings panel structure
    const adventureTab = this.findTabByText('Adventure');
    const generalTab = this.findTabByText('General');
    return !!(adventureTab || generalTab);
  }

  // Open the settings panel
  async openSettingsPanel() {
    if (this.isSettingsPanelOpen()) {
      return { success: true, alreadyOpen: true };
    }

    // Find and click the settings button (gear icon)
    const settingsBtn = document.querySelector('div[aria-label="Game settings"]');
    if (!settingsBtn) {
      return { success: false, error: 'Settings button not found - are you in an adventure?' };
    }

    settingsBtn.click();
    
    // Wait for the settings panel to open with verification
    for (let i = 0; i < 20; i++) {
      await this.wait(100);
      if (this.isSettingsPanelOpen()) {
        return { success: true };
      }
    }

    return { success: false, error: 'Settings panel failed to open' };
  }

  // ==================== TAB NAVIGATION ====================

  // Find a tab element by its text content
  findTabByText(tabName) {
    const tabs = document.querySelectorAll('[role="tab"]');
    const targetLower = tabName.toLowerCase();
    
    for (const tab of tabs) {
      // Method 1: Check aria-label (e.g., "Selected tab plot" or just "plot")
      const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
      if (ariaLabel === targetLower || ariaLabel.includes(`tab ${targetLower}`)) {
        return tab;
      }
      
      // Method 2: Look for ButtonText span (top-level tabs like Adventure, General)
      const buttonText = tab.querySelector('.is_ButtonText');
      if (buttonText) {
        const text = buttonText.textContent?.trim().toLowerCase();
        if (text === targetLower) {
          return tab;
        }
      }
      
      // Method 3: Look for paragraph text (subtabs like Plot, Story Cards, Details)
      const paragraphs = tab.querySelectorAll('p.is_Paragraph');
      for (const p of paragraphs) {
        const text = p.textContent?.trim().toLowerCase();
        if (text === targetLower) {
          return tab;
        }
      }
      
      // Method 4: Fallback - check if fullText ends with tab name
      const fullText = tab.textContent?.trim().toLowerCase() || '';
      if (fullText === targetLower || fullText.endsWith(targetLower)) {
        return tab;
      }
    }
    return null;
  }

  // Check if a tab is currently selected/active
  isTabSelected(tab) {
    if (!tab) return false;
    
    // Method 1: Check aria-label for "Selected tab" (subtabs like Plot, Story Cards, Details)
    const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
    if (ariaLabel.includes('selected tab')) {
      return true;
    }
    
    // Method 2: Check standard accessibility attributes
    if (tab.getAttribute('aria-selected') === 'true') return true;
    if (tab.getAttribute('data-state') === 'active') return true;
    if (tab.classList.contains('active')) return true;
    
    // Method 3: AI Dungeon class-based styling for top-level tabs:
    // Selected tabs have '_bbc-c-primary' (primary color bottom border)
    const classList = tab.className || '';
    if (classList.includes('_bbc-c-primary') && !classList.includes('_bbc-c-coreA0')) {
      return true;
    }
    
    return false;
  }

  // Navigate to the Adventure top tab
  async selectAdventureTab() {
    const adventureTab = this.findTabByText('Adventure');
    if (!adventureTab) {
      return { success: false, error: 'Adventure tab not found' };
    }

    if (this.isTabSelected(adventureTab)) {
      return { success: true, alreadySelected: true };
    }

    adventureTab.click();
    await this.wait(300);

    // Verify the tab was selected
    for (let i = 0; i < 10; i++) {
      if (this.isTabSelected(adventureTab)) {
        return { success: true };
      }
      await this.wait(100);
    }

    return { success: false, error: 'Failed to select Adventure tab' };
  }

  // Navigate to the Plot subtab
  async selectPlotTab() {
    const plotTab = this.findTabByText('Plot');
    if (!plotTab) {
      return { success: false, error: 'Plot tab not found' };
    }

    if (this.isTabSelected(plotTab)) {
      return { success: true, alreadySelected: true };
    }

    plotTab.click();
    await this.wait(300);

    // Verify the tab was selected
    for (let i = 0; i < 10; i++) {
      if (this.isTabSelected(plotTab)) {
        return { success: true };
      }
      await this.wait(100);
    }

    return { success: false, error: 'Failed to select Plot tab' };
  }

  // ==================== PLOT COMPONENT DETECTION ====================

  // Find the AI Instructions textarea if it exists
  findAIInstructionsTextarea() {
    return document.querySelector('textarea[placeholder*="Influence the AI\'s responses"]');
  }

  // Find the Author's Note textarea if it exists
  findAuthorsNoteTextarea() {
    return document.querySelector('textarea[placeholder*="Influence the AI\'s writing style"]');
  }

  // Check which plot components exist
  detectExistingPlotComponents() {
    const aiInstructions = this.findAIInstructionsTextarea();
    const authorsNote = this.findAuthorsNoteTextarea();
    
    return {
      hasAIInstructions: !!aiInstructions,
      hasAuthorsNote: !!authorsNote,
      aiInstructionsTextarea: aiInstructions,
      authorsNoteTextarea: authorsNote
    };
  }

  // Check if the "No Active Plot Components" message is showing
  hasNoPlotComponentsMessage() {
    const elements = document.querySelectorAll('p, span, div');
    for (const el of elements) {
      if (el.textContent?.includes('No Active Plot Components')) {
        return true;
      }
    }
    return false;
  }

  // Find the "Add Plot Component" button
  findAddPlotComponentButton() {
    // Try multiple selectors to find the add button
    const byAriaLabel = document.querySelector('div[aria-label="Add Plot Component"]');
    if (byAriaLabel) return byAriaLabel;

    // Fallback: look for a button with "Add" text in the Plot section
    const buttons = document.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      if (btn.textContent?.toLowerCase().includes('add plot component')) {
        return btn;
      }
    }
    return null;
  }

  // Find a plot component type option in the dropdown/dialog
  findPlotComponentOption(optionName) {
    // Look for menu items, options, or clickable elements with the option name
    const selectors = [
      '[role="menuitem"]',
      '[role="option"]',
      '[data-radix-collection-item]',
      'div[role="button"]',
      'button'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent?.trim().toLowerCase();
        if (text && text.includes(optionName.toLowerCase())) {
          return el;
        }
      }
    }
    return null;
  }

  // Create a specific plot component by clicking Add and selecting the option
  async createPlotComponent(componentName) {
    const addButton = this.findAddPlotComponentButton();
    if (!addButton) {
      return { success: false, error: 'Add Plot Component button not found' };
    }

    addButton.click();
    await this.wait(300);

    // Wait for the dropdown/dialog to appear and find the option
    for (let i = 0; i < 15; i++) {
      const option = this.findPlotComponentOption(componentName);
      if (option) {
        option.click();
        await this.wait(500);
        return { success: true };
      }
      await this.wait(100);
    }

    // Close any open dropdown if option wasn't found
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await this.wait(100);

    return { success: false, error: `${componentName} option not found in menu` };
  }

  // Ensure both required plot components exist, creating them if needed
  async ensurePlotComponentsExist(callbacks = {}) {
    let componentsCreated = [];

    // First check what we currently have
    let detection = this.detectExistingPlotComponents();

    // If we have "No Active Plot Components" message or missing components, create them
    const needsAI = !detection.hasAIInstructions;
    const needsNote = !detection.hasAuthorsNote;

    if (!needsAI && !needsNote) {
      return { success: true, created: false, componentsCreated: [] };
    }

    // Create AI Instructions if missing
    if (needsAI) {
      if (callbacks.onCreating) callbacks.onCreating('AI Instructions');
      const result = await this.createPlotComponent('AI Instructions');
      if (result.success) {
        componentsCreated.push('AI Instructions');
        await this.wait(500);
      }
    }

    // Refresh detection after creating the first component
    detection = this.detectExistingPlotComponents();

    // Create Author's Note if missing
    if (!detection.hasAuthorsNote) {
      if (callbacks.onCreating) callbacks.onCreating("Author's Note");
      const result = await this.createPlotComponent("Author's Note");
      if (result.success) {
        componentsCreated.push("Author's Note");
        await this.wait(500);
      }
    }

    return { 
      success: true, 
      created: componentsCreated.length > 0, 
      componentsCreated 
    };
  }

  // ==================== FULL NAVIGATION FLOW ====================

  // Navigate to the Plot settings tab and ensure it's ready
  async navigateToPlotSettings(options = {}) {
    const { onStepUpdate = null } = options;
    
    // Step 1: Validate we're on AI Dungeon
    if (!this.isOnAIDungeon()) {
      return { success: false, error: 'Not on AI Dungeon website' };
    }

    // Step 2: Validate we're on an adventure page
    if (!this.isOnAdventurePage()) {
      return { success: false, error: 'Navigate to an adventure first' };
    }

    // Step 3: Open settings panel if not open
    if (onStepUpdate) onStepUpdate('Opening settings panel...');
    const settingsResult = await this.openSettingsPanel();
    if (!settingsResult.success) {
      return settingsResult;
    }
    await this.wait(200);

    // Step 4: Select Adventure tab
    if (onStepUpdate) onStepUpdate('Selecting Adventure tab...');
    const adventureResult = await this.selectAdventureTab();
    if (!adventureResult.success) {
      return adventureResult;
    }
    await this.wait(200);

    // Step 5: Select Plot subtab
    if (onStepUpdate) onStepUpdate('Selecting Plot tab...');
    const plotResult = await this.selectPlotTab();
    if (!plotResult.success) {
      return plotResult;
    }
    await this.wait(300);

    if (onStepUpdate) onStepUpdate('Applying instructions...');
    return { success: true };
  }

  // Navigate to the Story Cards settings tab
  async navigateToStoryCardsSettings(options = {}) {
    const { onStepUpdate = null } = options;
    
    // Step 1: Validate we're on AI Dungeon
    if (!this.isOnAIDungeon()) {
      return { success: false, error: 'Not on AI Dungeon website' };
    }

    // Step 2: Validate we're on an adventure page
    if (!this.isOnAdventurePage()) {
      return { success: false, error: 'Navigate to an adventure first' };
    }

    // Step 3: Open settings panel if not open
    if (onStepUpdate) onStepUpdate('Opening settings panel...');
    const settingsResult = await this.openSettingsPanel();
    if (!settingsResult.success) {
      return settingsResult;
    }
    await this.wait(200);

    // Step 4: Select Adventure tab
    if (onStepUpdate) onStepUpdate('Selecting Adventure tab...');
    const adventureResult = await this.selectAdventureTab();
    if (!adventureResult.success) {
      return adventureResult;
    }
    await this.wait(200);

    // Step 5: Select Story Cards subtab
    if (onStepUpdate) onStepUpdate('Selecting Story Cards tab...');
    const storyCardsResult = await this.selectStoryCardsTab();
    if (!storyCardsResult.success) {
      return storyCardsResult;
    }
    await this.wait(300);

    return { success: true };
  }

  // Navigate to the Story Cards subtab
  async selectStoryCardsTab() {
    const storyCardsTab = this.findTabByText('Story Cards');
    if (!storyCardsTab) {
      return { success: false, error: 'Story Cards tab not found' };
    }

    if (this.isTabSelected(storyCardsTab)) {
      return { success: true, alreadySelected: true };
    }

    storyCardsTab.click();
    await this.wait(300);

    // Verify the tab was selected
    for (let i = 0; i < 10; i++) {
      if (this.isTabSelected(storyCardsTab)) {
        return { success: true };
      }
      await this.wait(100);
    }

    return { success: false, error: 'Failed to select Story Cards tab' };
  }

  // Wait for both textareas to be available
  async waitForTextareas(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const detection = this.detectExistingPlotComponents();
      
      if (detection.hasAIInstructions && detection.hasAuthorsNote) {
        return { 
          success: true, 
          aiInstructionsTextarea: detection.aiInstructionsTextarea, 
          authorsNoteTextarea: detection.authorsNoteTextarea 
        };
      }
      
      await this.wait(150);
    }
    
    const detection = this.detectExistingPlotComponents();
    
    if (!detection.hasAIInstructions && !detection.hasAuthorsNote) {
      return { success: false, error: 'Neither textarea found - plot components may need to be created' };
    } else if (!detection.hasAIInstructions) {
      return { success: false, error: 'AI Instructions textarea not found' };
    } else {
      return { success: false, error: "Author's Note textarea not found" };
    }
  }

  // ==================== INSTRUCTION APPLICATION ====================

  // Check if markdown instructions are already present in a textarea
  containsInstructions(textarea) {
    if (!textarea) return false;
    const currentValue = textarea.value || '';
    
    // Check for unique markers from the instruction file
    const markers = [
      '[FORMATTING]',
      'ALWAYS use Markdown in your responses',
      '++Bold++',
      '//Italic//',
      '~Small Text~'
    ];
    
    return markers.some(marker => currentValue.includes(marker));
  }

  // Main method to apply instructions to textareas
  async applyInstructionsToTextareas(instructionsText, options = {}) {
    const { forceApply = false, onCreatingComponents = null, onStepUpdate = null } = options;
    
    // Navigate to Plot settings with step callbacks
    const navResult = await this.navigateToPlotSettings({ onStepUpdate });
    if (!navResult.success) {
      return navResult;
    }

    // Initial attempt to find textareas
    let textareas = await this.waitForTextareas(5);
    
    let componentsCreated = false;

    // If textareas not found, create the missing plot components
    if (!textareas.success) {
      if (onCreatingComponents) {
        onCreatingComponents();
      }
      
      const ensureResult = await this.ensurePlotComponentsExist({
        onCreating: onCreatingComponents ? (name) => onCreatingComponents(`Creating ${name}...`) : null
      });
      
      if (ensureResult.created) {
        componentsCreated = true;
        // Wait longer for newly created components to render
        textareas = await this.waitForTextareas(30);
      } else {
        // Components exist but textareas not found - wait longer
        textareas = await this.waitForTextareas(20);
      }
    }
    
    if (!textareas.success) {
      return textareas;
    }

    const { aiInstructionsTextarea, authorsNoteTextarea } = textareas;

    // Check if instructions already exist
    const aiHasInstructions = this.containsInstructions(aiInstructionsTextarea);
    const noteHasInstructions = this.containsInstructions(authorsNoteTextarea);

    if (aiHasInstructions && noteHasInstructions && !forceApply) {
      return { success: true, alreadyApplied: true };
    }

    let appliedCount = 0;

    // Apply to AI Instructions if needed
    if (!aiHasInstructions || forceApply) {
      this.domUtils.appendToTextarea(aiInstructionsTextarea, instructionsText);
      appliedCount++;
    }

    // Apply to Author's Note if needed
    if (!noteHasInstructions || forceApply) {
      this.domUtils.appendToTextarea(authorsNoteTextarea, instructionsText);
      appliedCount++;
    }

    return { success: true, appliedCount, componentsCreated };
  }

  // ==================== FILE FETCHING ====================

  async fetchInstructionsFile() {
    try {
      const instructionsUrl = chrome.runtime.getURL('markdown_ai_instruction.txt');
      const response = await fetch(instructionsUrl);
      if (!response.ok) {
        return { success: false, error: 'Failed to load instructions file' };
      }
      const instructionsText = await response.text();
      return { success: true, data: instructionsText };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== UTILITIES ====================

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (typeof window !== 'undefined') {
  window.AIDungeonService = AIDungeonService;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIDungeonService;
}
