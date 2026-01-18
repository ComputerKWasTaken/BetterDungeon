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
    
    // Define tutorial steps
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
        content: 'This is where you\'ll find configurable additions that add new functionality to AI Dungeon.',
        position: 'bottom'
      },
      {
        id: 'command-mode',
        type: 'spotlight',
        target: '[data-feature="command"]',
        title: 'Command Mode',
        content: 'Send narrative commands like "Time Skip" or "Scene Change" directly to the AI. Great for guiding your story\'s direction!',
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
        content: 'Renders rich text formatting in AI responses. Click "Apply Instructions" to teach the AI the syntax!',
        position: 'bottom',
        expandCard: true
      },
      {
        id: 'trigger-highlight',
        type: 'spotlight',
        target: '[data-feature="triggerHighlight"]',
        title: 'Trigger Highlighting',
        content: 'Visualizes story card triggers in the context viewer. Hover over highlights to see which cards are active!',
        position: 'bottom'
      },
      {
        id: 'enhancements-tab',
        type: 'spotlight',
        target: '[data-tab="enhancements"]',
        title: 'Enhancements Tab',
        content: 'Automatic improvements that work in the background. Let\'s take a look!',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'enhancements'
      },
      {
        id: 'hotkeys',
        type: 'spotlight',
        target: '[data-feature="hotkey"]',
        title: 'Keyboard Shortcuts',
        content: 'Quick hotkeys for common actions! Press T to take a turn, C to continue, R to retry, and number keys to switch input modes.',
        position: 'bottom'
      },
      {
        id: 'input-colors',
        type: 'spotlight',
        target: '[data-feature="inputModeColor"]',
        title: 'Input Mode Colors',
        content: 'Color-coded borders on the input box help you instantly know which mode you\'re in.',
        position: 'top'
      },
      {
        id: 'presets-tab',
        type: 'spotlight',
        target: '[data-tab="presets"]',
        title: 'Presets Tab',
        content: 'Save your favorite plot configurations and character presets here!',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'presets'
      },
      {
        id: 'character-presets',
        type: 'spotlight',
        target: '.presets-section:last-child',
        title: 'Character Presets',
        content: 'Tired of retyping character info? Save character profiles and auto-fill scenario entry questions with one click!',
        position: 'top'
      },
      {
        id: 'complete',
        type: 'modal',
        title: 'You\'re All Set!',
        content: 'You now know the essentials of BetterDungeon. Toggle features on/off anytime, and enjoy your enhanced AI Dungeon experience!',
        icon: 'icon-circle-check',
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
