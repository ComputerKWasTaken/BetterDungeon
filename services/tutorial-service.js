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
    
    // Define tutorial steps - Updated for v0.9.2 features
    this.steps = [
      {
        id: 'welcome',
        type: 'modal',
        title: 'Welcome to BetterDungeon!',
        content: 'This quick tour will introduce you to the features that enhance your AI Dungeon experience.',
        icon: 'icon-wand-sparkles'
      },
      {
        id: 'features-tab',
        type: 'spotlight',
        target: '[data-tab="features"]',
        title: 'Features Tab',
        content: 'All your configurable features are organized here by category. Click any card to expand and see more options!',
        position: 'bottom'
      },
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
        id: 'attempt-mode',
        type: 'spotlight',
        target: '[data-feature="attempt"]',
        title: 'Attempt Mode',
        content: 'Add RNG-based outcomes to your actions! Roll for success or failure with configurable critical chances.',
        position: 'bottom',
        expandCard: true
      },
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
        id: 'trigger-highlight',
        type: 'spotlight',
        target: '[data-feature="triggerHighlight"]',
        title: 'Trigger Highlighting',
        content: 'Visualizes story card triggers in the context viewer. Hover over highlights to see which cards are active!',
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
        id: 'auto-see',
        type: 'spotlight',
        target: '[data-feature="autoSee"]',
        title: 'Auto See',
        content: 'Automatically triggers a See action after AI responses to visualize the scene. Set it to run every turn or at custom intervals!',
        position: 'top',
        expandCard: true
      },
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
      {
        id: 'character-presets',
        type: 'spotlight',
        target: '#character-list',
        title: 'Character Presets',
        content: 'Tired of retyping character info? Save character profiles and auto-fill scenario entry questions with one click!',
        position: 'top'
      },
      {
        id: 'complete',
        type: 'modal',
        title: 'You\'re All Set!',
        content: 'You now know the essentials of BetterDungeon. Toggle features on/off anytime, and enjoy your enhanced AI Dungeon experience!',
        icon: 'icon-badge-check',
        isComplete: true
      }
    ];
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

  async saveState(state) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [this.STORAGE_KEY]: state }, resolve);
    });
  }

  async markCompleted() {
    await this.saveState({ completed: true, seenWelcome: true, lastStep: this.steps.length - 1 });
    this.hasCompletedTutorial = true;
  }

  async markSeenWelcome() {
    const state = await this.loadState();
    state.seenWelcome = true;
    await this.saveState(state);
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
      this.onComplete();
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
