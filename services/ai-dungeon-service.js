// BetterDungeon - AI Dungeon Service
// Handles AI Dungeon-specific navigation and interaction logic

class AIDungeonService {
  constructor() {
    this.domUtils = window.DOMUtils;
  }

  isSettingsPanelOpen() {
    const adventureTab = this.domUtils.findTabByText('Adventure');
    const plotTab = this.domUtils.findTabByText('Plot');
    return !!(adventureTab || plotTab);
  }

  async navigateToPlotSettings() {
    console.log('AIDungeonService: Navigating to Plot settings...');

    // Check if settings panel is already open
    let panelOpen = this.isSettingsPanelOpen();
    
    if (!panelOpen) {
      // Try to find and click the settings button
      const settingsBtn = document.querySelector('div[aria-label="Game settings"]');
      if (!settingsBtn) {
        console.log('AIDungeonService: Settings button not found, checking if already in settings...');
        // Maybe we're already in a settings-like view, check for textareas
        const existingTextarea = document.querySelector('textarea[placeholder*="Influence the AI"]');
        if (existingTextarea) {
          console.log('AIDungeonService: Found textarea, already in correct view');
          return { success: true };
        }
        return { success: false, error: 'Settings button not found' };
      }

      console.log('AIDungeonService: Opening settings panel...');
      settingsBtn.click();
      await this.domUtils.wait(300);
      
      for (let i = 0; i < 10; i++) {
        if (this.isSettingsPanelOpen()) {
          panelOpen = true;
          break;
        }
        await this.domUtils.wait(100);
      }
      
      if (!panelOpen) {
        return { success: false, error: 'Failed to open settings panel' };
      }
    }

    await this.domUtils.wait(200);

    // Click Adventure tab (top level)
    const adventureTab = this.findTabButton('Adventure');
    if (adventureTab) {
      console.log('AIDungeonService: Clicking Adventure tab');
      adventureTab.click();
      await this.domUtils.wait(300);
    }

    // Click Plot tab (section level) - look for it by aria-label or text
    const plotTab = this.findSectionTab('plot');
    if (plotTab) {
      console.log('AIDungeonService: Clicking Plot tab');
      plotTab.click();
      await this.domUtils.wait(300);
    }

    // Verify we can see the textareas
    const textarea = document.querySelector('textarea[placeholder*="Influence the AI"]');
    if (!textarea) {
      console.log('AIDungeonService: Textarea not visible, trying alternate navigation...');
      // Try clicking any visible Plot-related elements
      await this.domUtils.wait(500);
    }

    return { success: true };
  }

  // Find a top-level tab button by text
  findTabButton(tabName) {
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const text = tab.textContent?.trim();
      if (text?.toUpperCase() === tabName.toUpperCase()) {
        return tab;
      }
    }
    return null;
  }

  // Find a section tab (like Plot, Story Cards, Details)
  findSectionTab(tabName) {
    // Look for tabs with aria-label containing the tab name
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
      const text = tab.textContent?.trim().toLowerCase();
      
      if (ariaLabel.includes(tabName.toLowerCase()) || text === tabName.toLowerCase()) {
        return tab;
      }
    }
    return null;
  }

  // Check if no plot components exist
  hasNoPlotComponents() {
    const noComponentsText = Array.from(document.querySelectorAll('p'))
      .find(p => p.textContent?.includes('No Active Plot Components'));
    return !!noComponentsText;
  }

  // Find the "Add Plot Component" button
  findAddPlotComponentButton() {
    return document.querySelector('div[aria-label="Add Plot Component"]');
  }

  // Find a plot component type option in the dialog
  findPlotComponentOption(optionName) {
    // Look for clickable elements containing the option name
    const allElements = document.querySelectorAll('div[role="button"], button, div[tabindex="0"]');
    for (const el of allElements) {
      const text = el.textContent?.trim();
      if (text && text.toLowerCase().includes(optionName.toLowerCase())) {
        return el;
      }
    }
    // Also search for menu items or list items
    const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item]');
    for (const item of menuItems) {
      if (item.textContent?.toLowerCase().includes(optionName.toLowerCase())) {
        return item;
      }
    }
    return null;
  }

  // Create a specific plot component
  async createPlotComponent(componentName) {
    console.log(`AIDungeonService: Creating ${componentName} plot component...`);
    
    const addButton = this.findAddPlotComponentButton();
    if (!addButton) {
      console.log('AIDungeonService: Add Plot Component button not found');
      return { success: false, error: 'Add Plot Component button not found' };
    }

    addButton.click();
    await this.domUtils.wait(300);

    // Wait for the dialog/menu to appear
    for (let i = 0; i < 10; i++) {
      const option = this.findPlotComponentOption(componentName);
      if (option) {
        console.log(`AIDungeonService: Found ${componentName} option, clicking...`);
        option.click();
        await this.domUtils.wait(500);
        return { success: true };
      }
      await this.domUtils.wait(100);
    }

    // Try pressing Escape to close any dialog if option wasn't found
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await this.domUtils.wait(100);

    return { success: false, error: `${componentName} option not found in menu` };
  }

  // Create required plot components if they don't exist
  async ensurePlotComponentsExist() {
    console.log('AIDungeonService: Checking for existing plot components...');
    
    // Check if we're in the "no components" state
    if (!this.hasNoPlotComponents()) {
      console.log('AIDungeonService: Plot components already exist or not in expected state');
      return { success: true, created: false };
    }

    console.log('AIDungeonService: No plot components found, creating them...');
    
    // Create AI Instructions component
    const aiResult = await this.createPlotComponent('AI Instructions');
    if (!aiResult.success) {
      console.log('AIDungeonService: Failed to create AI Instructions:', aiResult.error);
      // Continue to try Author's Note anyway
    } else {
      await this.domUtils.wait(500);
    }

    // Check if we still need to add more (button might have moved)
    if (this.findAddPlotComponentButton()) {
      // Create Author's Note component
      const noteResult = await this.createPlotComponent("Author's Note");
      if (!noteResult.success) {
        console.log('AIDungeonService: Failed to create Author\'s Note:', noteResult.error);
      }
    }

    await this.domUtils.wait(500);
    return { success: true, created: true };
  }

  async waitForTextareas(maxAttempts = 20) {
    console.log('AIDungeonService: Waiting for textareas...');
    
    for (let i = 0; i < maxAttempts; i++) {
      const aiInstructionsTextarea = document.querySelector('textarea[placeholder*="Influence the AI\'s responses"]');
      const authorsNoteTextarea = document.querySelector('textarea[placeholder*="Influence the AI\'s writing style"]');
      
      if (aiInstructionsTextarea && authorsNoteTextarea) {
        console.log('AIDungeonService: Found both textareas');
        return { 
          success: true, 
          aiInstructionsTextarea, 
          authorsNoteTextarea 
        };
      }
      
      await this.domUtils.wait(150);
    }
    
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

  // Check if instructions are already present in a textarea
  containsInstructions(textarea, instructionsText) {
    if (!textarea || !instructionsText) return false;
    const currentValue = textarea.value || '';
    
    // Check for unique phrases from the actual instruction file
    // These are specific enough to avoid false positives
    const markers = [
      'ALWAYS format your responses with Markdown',
      '{{Bold}}',
      '{{_Bold Italic_}}',
      '{{++Bold Underlined++}}'
    ];
    
    // Return true if ANY marker is found
    const found = markers.some(marker => currentValue.includes(marker));
    console.log('AIDungeonService: Checking for instructions, found:', found);
    return found;
  }

  async applyInstructionsToTextareas(instructionsText, options = {}) {
    const { forceApply = false, onCreatingComponents = null } = options;
    
    const navResult = await this.navigateToPlotSettings();
    if (!navResult.success) {
      return navResult;
    }

    // First try to find textareas
    let textareas = await this.waitForTextareas(5);
    
    // Track if we created components
    let componentsCreated = false;
    
    // If textareas not found, check if we need to create plot components
    if (!textareas.success) {
      console.log('AIDungeonService: Textareas not found, checking if plot components need to be created...');
      
      // Notify caller that we're creating components
      if (onCreatingComponents) {
        onCreatingComponents();
      }
      
      const ensureResult = await this.ensurePlotComponentsExist();
      if (ensureResult.created) {
        componentsCreated = true;
        console.log('AIDungeonService: Plot components created, waiting for textareas again...');
        textareas = await this.waitForTextareas(20);
      } else {
        // Try waiting longer in case they're just loading slowly
        textareas = await this.waitForTextareas(15);
      }
    }
    
    if (!textareas.success) {
      return textareas;
    }

    const { aiInstructionsTextarea, authorsNoteTextarea } = textareas;

    // Check if instructions already exist
    const aiHasInstructions = this.containsInstructions(aiInstructionsTextarea, instructionsText);
    const noteHasInstructions = this.containsInstructions(authorsNoteTextarea, instructionsText);

    if (aiHasInstructions && noteHasInstructions && !forceApply) {
      console.log('AIDungeonService: Instructions already present in both fields');
      return { success: true, alreadyApplied: true };
    }

    let appliedCount = 0;

    if (!aiHasInstructions || forceApply) {
      console.log('AIDungeonService: Appending to AI Instructions...');
      this.domUtils.appendToTextarea(aiInstructionsTextarea, instructionsText);
      appliedCount++;
    } else {
      console.log('AIDungeonService: AI Instructions already has BetterDungeon formatting');
    }

    if (!noteHasInstructions || forceApply) {
      console.log('AIDungeonService: Appending to Author\'s Note...');
      this.domUtils.appendToTextarea(authorsNoteTextarea, instructionsText);
      appliedCount++;
    } else {
      console.log('AIDungeonService: Author\'s Note already has BetterDungeon formatting');
    }

    console.log(`AIDungeonService: Applied instructions to ${appliedCount} field(s)`);
    return { success: true, appliedCount, componentsCreated };
  }

  async fetchInstructionsFile() {
    try {
      const instructionsUrl = chrome.runtime.getURL('ai_instruction.txt');
      const response = await fetch(instructionsUrl);
      if (!response.ok) {
        return { success: false, error: 'Failed to load instructions' };
      }
      const instructionsText = await response.text();
      return { success: true, data: instructionsText };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

if (typeof window !== 'undefined') {
  window.AIDungeonService = AIDungeonService;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIDungeonService;
}
