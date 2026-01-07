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

    const settingsBtn = document.querySelector('div[aria-label="Game settings"]');
    if (!settingsBtn) {
      return { success: false, error: 'Settings button not found' };
    }

    let panelOpen = this.isSettingsPanelOpen();
    
    if (!panelOpen) {
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
    const adventureTab = await this.domUtils.findAndClickTab('Adventure');
    if (!adventureTab) {
      console.log('AIDungeonService: Adventure tab not found or already selected');
    }

    await this.domUtils.wait(200);
    const plotTab = await this.domUtils.findAndClickTab('Plot');
    if (!plotTab) {
      console.log('AIDungeonService: Plot tab not found or already selected');
    }

    await this.domUtils.wait(300);
    return { success: true };
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

  async applyInstructionsToTextareas(instructionsText) {
    const navResult = await this.navigateToPlotSettings();
    if (!navResult.success) {
      return navResult;
    }

    const textareas = await this.waitForTextareas();
    if (!textareas.success) {
      return textareas;
    }

    const { aiInstructionsTextarea, authorsNoteTextarea } = textareas;

    console.log('AIDungeonService: Appending to AI Instructions...');
    this.domUtils.appendToTextarea(aiInstructionsTextarea, instructionsText);
    console.log('AIDungeonService: Appending to Author\'s Note...');
    this.domUtils.appendToTextarea(authorsNoteTextarea, instructionsText);

    console.log('AIDungeonService: Applied instructions to AI Instructions and Author\'s Note');
    return { success: true };
  }

  async fetchInstructionsFile() {
    try {
      const instructionsUrl = chrome.runtime.getURL('ai_instructions.txt');
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
