// BetterDungeon - Tutorial Service
// Manages the user guide/tutorial system for introducing features

class TutorialService {
  constructor() {
    this.STORAGE_KEY = 'betterDungeon_tutorial';
    this.currentStep = 0;
    this.isActive = false;
    this.onStepChange = null;
    this.onComplete = null;
    this.onExit = null;
    
    // Define tutorial steps - Ordered to match popup.html element structure
    this.steps = [
      // Welcome Modal
      {
        id: 'welcome',
        type: 'modal',
        title: 'Welcome to BetterDungeon!',
        content: 'This quick tour will introduce you to the features that enhance your AI Dungeon experience.',
        icon: 'icon-wand-sparkles'
      },
      // Features Tab Navigation
      {
        id: 'features-tab',
        type: 'spotlight',
        target: '[data-tab="features"]',
        title: 'Features Tab',
        content: 'All your configurable features are organized here by category. Click any card to expand and see more options!',
        position: 'bottom'
      },
      // === Input Modes Section ===
      {
        id: 'command-mode',
        type: 'spotlight',
        target: '[data-feature="command"]',
        title: 'Command Mode',
        content: 'Send narrative commands like "Time Skip" or "Scene Change" directly to the AI. Great for guiding your story!',
        position: 'bottom',
        expandCard: true
      },
      {
        id: 'try-mode',
        type: 'spotlight',
        target: '[data-feature="try"]',
        title: 'Try Mode',
        content: 'Add RNG-based outcomes to your actions! Roll for success or failure with configurable critical chances.',
        position: 'bottom',
        expandCard: true
      },
      // === Formatting & Visuals Section ===
      {
        id: 'markdown',
        type: 'spotlight',
        target: '[data-feature="markdown"]',
        title: 'Markdown Formatting',
        content: 'Renders rich text in AI responses. Click "Apply Instructions" to teach the AI the syntax!',
        position: 'bottom',
        expandCard: true
      },
      {
        id: 'input-mode-colors',
        type: 'spotlight',
        target: '[data-feature="inputModeColor"]',
        title: 'Input Mode Colors',
        content: 'Color-codes your input box based on the current mode. Click "Customize Colors" to pick your own palette!',
        position: 'bottom',
        expandCard: true
      },
      // === Tools Section ===
      {
        id: 'hotkeys',
        type: 'spotlight',
        target: '[data-feature="hotkey"]',
        title: 'Keyboard Shortcuts',
        content: 'Quick hotkeys for common actions! Press T to take a turn, C to continue, and number keys to switch modes. Fully customizable via the "Customize Hotkeys" button!',
        position: 'bottom',
        expandCard: true
      },
      {
        id: 'trigger-highlight',
        type: 'spotlight',
        target: '[data-feature="triggerHighlight"]',
        title: 'Trigger Highlighting',
        content: 'Visualizes story card triggers in the context viewer. Hover over highlights to see which cards are active!',
        position: 'bottom',
        expandCard: true
      },
      {
        id: 'notes',
        type: 'spotlight',
        target: '[data-feature="notes"]',
        title: 'Adventure Notes',
        content: 'Jot down anything you want to remember about your adventure! Notes appear at the bottom of Plot Components and are saved per adventure.',
        position: 'top',
        expandCard: true
      },
      {
        id: 'story-card-analytics',
        type: 'spotlight',
        target: '[data-feature="storyCardAnalytics"]',
        title: 'Story Card Analytics',
        content: 'Displays detailed stats about your story cards including token counts, trigger analysis, and optimization tips. Always active!',
        position: 'top',
        expandCard: true
      },
      {
        id: 'better-scripts',
        type: 'spotlight',
        target: '[data-feature="betterScripts"]',
        title: 'BetterScripts',
        content: 'Enables scripts to display dynamic UI widgets like HP bars, stats, and game state. Scripts using this feature will just work!',
        position: 'top',
        expandCard: true
      },
      {
        id: 'story-card-modal-dock',
        type: 'spotlight',
        target: '[data-feature="storyCardModalDock"]',
        title: 'Story Card Modal Dock',
        content: 'Docks the story card editor to the side so you can scroll through your story while editing. Toggle this off if you prefer the original modal.',
        position: 'top',
        expandCard: true
      },
      // === Automations Section ===
      {
        id: 'auto-see',
        type: 'spotlight',
        target: '[data-feature="autoSee"]',
        title: 'Auto See',
        content: 'Automatically triggers a See action after AI responses to visualize the scene. Set it to run every turn or at custom intervals!',
        position: 'top',
        expandCard: true
      },
      // Presets Tab Navigation
      {
        id: 'presets-tab',
        type: 'spotlight',
        target: '[data-tab="presets"]',
        title: 'Presets Tab',
        content: 'Save and manage your plot configurations and character presets here!',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'presets'
      },
      // === Plot Presets Section ===
      {
        id: 'plot-presets',
        type: 'spotlight',
        target: '#preset-list',
        title: 'Plot Presets',
        content: 'Save your current AI Instructions, Plot Essentials, and Author\'s Note as reusable presets. Apply them to any adventure with one click!',
        position: 'bottom'
      },
      // === Character Presets Section ===
      {
        id: 'character-presets',
        type: 'spotlight',
        target: '#character-list',
        title: 'Character Presets',
        content: 'Tired of retyping character info? Save character profiles and auto-fill scenario entry questions with one click!',
        position: 'top'
      }
    ];
    
    // Completion modal is separate from steps - shown after all steps are done
    this.completionModal = {
      id: 'complete',
      type: 'modal',
      title: 'You\'re All Set!',
      content: 'You now know the essentials of BetterDungeon. Toggle features on/off anytime, and enjoy your enhanced AI Dungeon experience!',
      icon: 'icon-badge-check'
    };
    
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async init() {
    const state = await this.loadState();
    this.hasCompletedTutorial = state.completed || false;
    this.hasSeenWelcome = state.seenWelcome || false;
    return state;
  }

  async loadState() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(this.STORAGE_KEY, (result) => {
        resolve(result[this.STORAGE_KEY] || { completed: false, seenWelcome: false, lastStep: 0 });
      });
    });
  }

  async saveState(updates) {
    const currentState = await this.loadState();
    const newState = { ...currentState, ...updates };
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [this.STORAGE_KEY]: newState }, resolve);
    });
  }

  async markCompleted() {
    await this.saveState({ completed: true, seenWelcome: true });
    this.hasCompletedTutorial = true;
    this.hasSeenWelcome = true;
  }

  async markSeenWelcome() {
    await this.saveState({ seenWelcome: true });
    this.hasSeenWelcome = true;
  }

  async resetTutorial() {
    await this.saveState({ completed: false, seenWelcome: false, lastStep: 0 });
    this.hasCompletedTutorial = false;
    this.hasSeenWelcome = false;
    this.currentStep = 0;
  }

  shouldShowWelcome() {
    return !this.hasSeenWelcome;
  }

  start() {
    this.isActive = true;
    this.currentStep = 0;
    this.showCurrentStep();
  }

  next() {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      this.showCurrentStep();
    } else {
      this.complete();
    }
  }

  previous() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.showCurrentStep();
    }
  }

  goToStep(index) {
    if (index >= 0 && index < this.steps.length) {
      this.currentStep = index;
      this.showCurrentStep();
    }
  }

  showCurrentStep() {
    const step = this.steps[this.currentStep];
    if (this.onStepChange) {
      this.onStepChange(step, this.currentStep, this.steps.length);
    }
  }

  getCurrentStep() {
    return this.steps[this.currentStep];
  }
  
  getCompletionModal() {
    return this.completionModal;
  }

  getProgress() {
    return {
      current: this.currentStep + 1,
      total: this.steps.length,
      percentage: Math.round(((this.currentStep + 1) / this.steps.length) * 100)
    };
  }

  async complete() {
    this.isActive = false;
    await this.markCompleted();
    if (this.onComplete) {
      this.onComplete(this.completionModal);
    }
  }

  exit() {
    this.isActive = false;
    if (this.onExit) {
      this.onExit();
    }
  }

  isRunning() {
    return this.isActive;
  }
}

// Export for popup use
if (typeof window !== 'undefined') {
  window.TutorialService = TutorialService;
}
