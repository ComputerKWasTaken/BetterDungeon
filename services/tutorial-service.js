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
    
    // Premise provides the main introduction. Focused guides use bounded ranges
    // within this list, so opening one guide never spills into another.
    this.steps = [
      {
        id: 'welcome',
        type: 'modal',
        title: 'Welcome to BetterDungeon',
        content: 'Start with Premise to learn what BetterDungeon is, how it fits into AI Dungeon, and what it can do—or jump directly to a focused guide.',
        icon: 'icon-wand-sparkles'
      },
      {
        id: 'premise-identity',
        type: 'spotlight',
        target: '.header-brand',
        title: 'What BetterDungeon is',
        content: 'BetterDungeon is a companion toolkit for AI Dungeon. It enhances the experience you already use with optional interface improvements, workflow tools, AI assistance, script capabilities, and reusable content. It does not replace AI Dungeon or become part of your story model.',
        icon: 'icon-sparkles',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features'
      },
      {
        id: 'premise-operation',
        type: 'spotlight',
        target: '.nav',
        title: 'How BetterDungeon works',
        content: 'This popup is BetterDungeon’s control center. Your selections determine which enhancements appear on supported AI Dungeon pages. Features stay out of unrelated pages, settings persist between sessions, and almost everything remains optional so you control the experience.',
        icon: 'icon-settings',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features'
      },
      {
        id: 'premise-features',
        type: 'spotlight',
        target: '[data-tab="features"]',
        title: 'Improve everyday play and creation',
        content: 'Features can refine input modes, add navigation and writing controls, improve Story Card workflows, automate repetitive actions, and provide Navigator—an adventure-aware assistant whose proposed changes always require your approval.',
        icon: 'icon-sliders-horizontal',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features'
      },
      {
        id: 'premise-ultrascripts',
        type: 'spotlight',
        target: '[data-tab="ultrascripts"]',
        title: 'Extend what adventure scripts can do',
        content: 'Ultrascripts gives compatible AI Dungeon scripts access to focused capabilities that the normal scripting sandbox cannot provide, including widgets, audio, web data, time, weather, and AI. You decide which modules attached scripts are allowed to use.',
        icon: 'icon-radio-tower',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'ultrascripts'
      },
      {
        id: 'premise-presets',
        type: 'spotlight',
        target: '[data-tab="presets"]',
        title: 'Reuse characters and story foundations',
        content: 'Presets help you carry useful material between experiences. Character Presets can answer scenario-start questions from a reusable character profile, while Plot Presets capture selected Plot Components so a setup can be applied to another adventure.',
        icon: 'icon-bookmark',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'presets'
      },
      {
        id: 'navigator-overview',
        type: 'spotlight',
        target: '[data-feature="navigator"] .feature-row',
        title: 'Meet Navigator',
        content: 'Navigator is BetterDungeon’s adventure-aware AI assistant. It can inspect your current story and Story Cards, answer questions about them, and help you plan improvements without interrupting the adventure itself.',
        icon: 'icon-compass',
        position: 'top',
        action: 'switchTab',
        actionTarget: 'features',
        expandCard: true
      },
      {
        id: 'navigator-enable',
        type: 'spotlight',
        target: '[data-feature="navigator"] .toggle',
        title: 'Enable and open Navigator',
        content: 'This switch controls whether Navigator appears on AI Dungeon adventure pages. When enabled, open it with the draggable compass button or press Alt+N. Navigator uses the AI service configured in the Ultrascripts tab.',
        icon: 'icon-compass',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features',
        expandCard: true
      },
      {
        id: 'navigator-approval',
        type: 'spotlight',
        target: '[data-feature="navigator"] .feature-hints',
        title: 'You remain in control',
        content: 'Navigator can recommend edits to Plot Components and Story Cards, but recommendations are not applied immediately. You review the proposed changes first and explicitly approve them, so a conversation cannot silently rewrite your adventure.',
        icon: 'icon-badge-check',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features',
        expandCard: true
      },
      {
        id: 'feature-library',
        type: 'spotlight',
        target: '[data-section="input-modes"] .section-header',
        title: 'Understand the feature library',
        content: 'Features are organized by purpose: input modes, controls, writing tools, scenario building, and automations. Section headers collapse groups you do not need, making the library easier to scan without changing whether any feature is enabled.',
        icon: 'icon-sliders-horizontal',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features'
      },
      {
        id: 'feature-card-controls',
        type: 'spotlight',
        target: '[data-feature="command"] .feature-row',
        title: 'Every feature uses the same pattern',
        content: 'The title and summary explain what a feature changes. Click the card to expand its full description, then use the switch on the right to enable or disable it. Your selection is saved automatically and applies on supported AI Dungeon pages.',
        icon: 'icon-sliders-horizontal',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features',
        expandCard: true
      },
      {
        id: 'feature-card-settings',
        type: 'spotlight',
        target: '[data-feature="command"] .feature-details',
        title: 'Some features include extra controls',
        content: 'Expanded cards contain important behavior notes and, when needed, feature-specific settings. These controls only affect that feature. Read this area when a feature changes how input is interpreted or needs additional configuration.',
        icon: 'icon-settings',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features',
        expandCard: true
      },
      {
        id: 'scenario-tools',
        type: 'spotlight',
        target: '[data-section="scenario"] .section-header',
        title: 'Scenario tools are context-sensitive',
        content: 'Scenario-building tools appear where AI Dungeon exposes the matching editor or Story Card interface. If a feature seems inactive, first confirm that you are on the kind of page it supports; BetterDungeon avoids inserting controls where they do not belong.',
        icon: 'icon-book-open-text',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'features'
      },
      {
        id: 'automation-tools',
        type: 'spotlight',
        target: '[data-section="automations"] .section-header',
        title: 'Automations act on your behalf',
        content: 'Automations perform repeatable actions such as transforming input or triggering See. Their expanded cards explain exactly when they run. Configure them deliberately, especially when combining multiple automations that respond to the same action.',
        icon: 'icon-zap',
        position: 'top',
        action: 'switchTab',
        actionTarget: 'features'
      },
      {
        id: 'ultrascripts-runtime',
        type: 'spotlight',
        target: '[data-feature="ultrascripts"] .feature-row',
        title: 'Understand the Ultrascripts runtime',
        content: 'Ultrascripts is the bridge between AI Dungeon scripts and BetterDungeon. The master switch enables that bridge; turning it off blocks every Ultrascripts module at once without changing the individual module choices below.',
        icon: 'icon-radio-tower',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'ultrascripts-status',
        type: 'spotlight',
        target: '#ultrascripts-status-panel',
        title: 'Check the live connection',
        content: 'The status panel reports whether BetterDungeon can currently detect Ultrascripts on the open adventure. Open an AI Dungeon adventure before checking it, use Refresh after changing scripts, and reserve Debug for troubleshooting because it produces additional diagnostic information.',
        icon: 'icon-activity',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'ultrascripts-modules',
        type: 'spotlight',
        target: '[data-ultrascripts-module-card="widget"] .feature-row',
        title: 'Modules grant focused capabilities',
        content: 'Each module exposes one bounded capability to compatible scripts. Widget, for example, lets scripts render persistent interface elements outside story text. A script can only use a module while both the runtime and that module are enabled.',
        icon: 'icon-layers',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'ultrascripts-permissions',
        type: 'spotlight',
        target: '[data-ultrascripts-module-card="webfetch"] .feature-row',
        title: 'Treat modules as permissions',
        content: 'Modules such as WebFetch, Audio, Weather, and AI allow scripts to interact beyond ordinary story state. Expand a module to see its boundaries, then disable capabilities you do not want scripts to use. Module choices apply across compatible attached scripts.',
        icon: 'icon-globe-lock',
        position: 'bottom',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'ai-module',
        type: 'spotlight',
        target: '#ai-settings-card .feature-row',
        title: 'Know what the AI module powers',
        content: 'The AI module provides one shared language-model connection for Navigator and compatible AI-powered scripts. Its module switch controls access to that connection; the settings inside the card choose which external service BetterDungeon actually uses.',
        icon: 'icon-brain-circuit',
        position: 'top',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'ai-setup',
        type: 'spotlight',
        target: '#ai-endpoint-service',
        title: 'Choose one AI service',
        content: 'Gemini is the default choice. OpenRouter can expose other supported models, while Custom connects to a compatible HTTPS endpoint. BetterDungeon uses only the service you save and never silently falls back to a different provider.',
        icon: 'icon-brain-circuit',
        position: 'top',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'ai-credentials',
        type: 'spotlight',
        target: '#ai-endpoint-api-key',
        title: 'Complete the service profile',
        content: 'Enter the API key issued by your selected service. Official provider URLs are locked automatically; custom services require a secure HTTPS base URL. Manual model selection must use the exact model identifier accepted by that provider.',
        icon: 'icon-key-round',
        position: 'top',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'ai-verify',
        type: 'spotlight',
        target: '#ai-endpoint-test',
        title: 'Save and verify the connection',
        content: 'Save stores the profile without contacting the provider. Save & test stores it and performs a connection check, making it the best final step after setup. Read the status card above these buttons if validation fails before changing unrelated settings.',
        icon: 'icon-circle-check',
        position: 'top',
        action: 'switchTab',
        actionTarget: 'ultrascripts',
        expandCard: true
      },
      {
        id: 'preset-types',
        type: 'spotlight',
        target: '.preset-view-tabs',
        title: 'Presets solve two different problems',
        content: 'Character Presets store reusable character profiles for scenario-start answers. Plot Presets store reusable Plot Component configurations from an adventure. The tabs keep these workflows separate so selecting a character never changes a saved plot setup.',
        icon: 'icon-bookmark',
        position: 'bottom',
        action: 'switchPresetView',
        actionTarget: 'characters'
      },
      {
        id: 'character-presets',
        type: 'spotlight',
        target: '.character-prefill-toggle',
        title: 'Character Prefill has a master switch',
        content: 'The Prefill switch enables or disables automatic scenario-start answering without deleting your saved characters. When it is off, the selected character remains saved but BetterDungeon leaves scenario placeholders untouched.',
        icon: 'icon-users',
        position: 'bottom',
        action: 'switchPresetView',
        actionTarget: 'characters'
      },
      {
        id: 'character-create',
        type: 'spotlight',
        target: '#create-character-btn',
        title: 'Build a reusable character',
        content: 'Create one preset per character and describe the details that should inform scenario questions: identity, appearance, personality, background, abilities, relationships, and other durable facts. Clear natural language gives the AI better material than disconnected keywords.',
        icon: 'icon-user-plus',
        position: 'bottom',
        action: 'switchPresetView',
        actionTarget: 'characters'
      },
      {
        id: 'character-select',
        type: 'spotlight',
        target: '#character-list',
        title: 'Select the character used for Prefill',
        content: 'Saved character cards can be edited, deleted, or chosen with Use for Prefill. Only one character is active at a time. Selection and the master Prefill switch are separate, so you can pause Prefill without losing which character should be used later.',
        icon: 'icon-users',
        position: 'top',
        action: 'switchPresetView',
        actionTarget: 'characters'
      },
      {
        id: 'plot-presets',
        type: 'spotlight',
        target: '#save-current-preset-btn',
        title: 'Capture a plot configuration',
        content: 'Open an AI Dungeon adventure before saving a Plot Preset. BetterDungeon reads the current Plot Components, lets you choose what belongs in the preset, and stores that reusable configuration under a name you provide.',
        icon: 'icon-star',
        position: 'top',
        action: 'switchPresetView',
        actionTarget: 'plot'
      },
      {
        id: 'plot-apply',
        type: 'spotlight',
        target: '#preset-list',
        title: 'Apply plot presets deliberately',
        content: 'A saved Plot Preset can replace the destination adventure’s matching components or append its contents, depending on the choice you make while applying it. BetterDungeon exposes Undo Last Apply after a successful change so the most recent application can be reversed.',
        icon: 'icon-clipboard',
        position: 'top',
        action: 'switchPresetView',
        actionTarget: 'plot'
      }
    ];

    this.topics = [
      {
        id: 'premise',
        title: 'Premise',
        description: 'What BetterDungeon is, how it works, and what it can do',
        icon: 'icon-sparkles',
        stepId: 'premise-identity'
      },
      {
        id: 'navigator',
        title: 'Navigator',
        description: 'Setup, usage, and approval-first changes',
        icon: 'icon-compass',
        stepId: 'navigator-overview'
      },
      {
        id: 'features',
        title: 'Features',
        description: 'Sections, cards, settings, and automations',
        icon: 'icon-sliders-horizontal',
        stepId: 'feature-library'
      },
      {
        id: 'ultrascripts',
        title: 'Ultrascripts',
        description: 'Runtime status, modules, and permissions',
        icon: 'icon-radio-tower',
        stepId: 'ultrascripts-runtime'
      },
      {
        id: 'ai',
        title: 'AI Setup',
        description: 'Provider, credentials, and verification',
        icon: 'icon-brain-circuit',
        stepId: 'ai-module'
      },
      {
        id: 'presets',
        title: 'Presets',
        description: 'Character Prefill and reusable plot setups',
        icon: 'icon-bookmark',
        stepId: 'preset-types'
      }
    ];
    
    // Completion modal is separate from steps - shown after all steps are done
    this.completionModal = {
      id: 'complete',
      type: 'modal',
      title: 'You understand the premise',
      content: 'You now know what BetterDungeon adds, how its optional systems fit around AI Dungeon, and where to find each major capability. Continue with any focused guide when you want the details.',
      icon: 'icon-badge-check'
    };

    this.activeStart = 0;
    this.activeEnd = this.steps.length - 1;
    this.activeTopicId = null;
    this.lastCompletionModal = this.completionModal;
    
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
        resolve((result || {})[this.STORAGE_KEY] || { completed: false, seenWelcome: false, lastStep: 0 });
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
    this.activeStart = 0;
    this.activeEnd = 0;
    this.activeTopicId = null;
    this.lastCompletionModal = this.completionModal;
    this.currentStep = 0;
    this.markSeenWelcome();
    this.showCurrentStep();
  }

  next() {
    if (this.currentStep < this.activeEnd) {
      this.currentStep++;
      this.showCurrentStep();
    } else {
      this.complete();
    }
  }

  previous() {
    if (this.currentStep > this.activeStart) {
      this.currentStep--;
      this.showCurrentStep();
    }
  }

  goToStep(index) {
    if (index >= this.activeStart && index <= this.activeEnd) {
      this.currentStep = index;
      this.showCurrentStep();
      return true;
    }
    return false;
  }

  goToStepId(stepId) {
    const index = this.steps.findIndex(step => step.id === stepId);
    if (index === -1) return false;
    return this.goToStep(index);
  }

  goToTopic(topicId) {
    const topic = this.getTopics().find(item => item.id === topicId);
    if (!topic) return false;
    this.isActive = true;
    this.activeStart = topic.startIndex;
    this.activeEnd = topic.endIndex;
    this.activeTopicId = topic.id;
    this.currentStep = topic.startIndex;
    this.lastCompletionModal = this.completionModal;
    this.markSeenWelcome();
    this.showCurrentStep();
    return true;
  }

  showCurrentStep() {
    const step = this.steps[this.currentStep];
    if (this.onStepChange) {
      this.onStepChange(
        step,
        this.currentStep - this.activeStart,
        this.activeEnd - this.activeStart + 1
      );
    }
  }

  getCurrentStep() {
    return this.steps[this.currentStep];
  }
  
  getCompletionModal() {
    return this.lastCompletionModal;
  }

  getTopics() {
    return this.topics.map((topic, index) => {
      const startIndex = this.steps.findIndex(step => step.id === topic.stepId);
      const nextTopic = this.topics[index + 1];
      const nextIndex = nextTopic
        ? this.steps.findIndex(step => step.id === nextTopic.stepId)
        : this.steps.length;

      return {
        ...topic,
        startIndex,
        endIndex: Math.max(startIndex, nextIndex - 1),
        stepCount: Math.max(1, nextIndex - startIndex)
      };
    }).filter(topic => topic.startIndex >= 0);
  }

  getTopicForStep(index = this.currentStep) {
    if (this.activeTopicId) {
      return this.getTopics().find(topic => topic.id === this.activeTopicId) || null;
    }
    const topics = this.getTopics();
    let currentTopic = null;
    for (const topic of topics) {
      if (topic.startIndex <= index) currentTopic = topic;
      else break;
    }
    return currentTopic;
  }

  getProgress() {
    const current = this.currentStep - this.activeStart + 1;
    const total = this.activeEnd - this.activeStart + 1;
    return {
      current,
      total,
      percentage: Math.round((current / total) * 100)
    };
  }

  async complete() {
    this.isActive = false;
    const completedPremise = this.activeTopicId === 'premise';
    const topic = this.activeTopicId
      ? this.getTopics().find(item => item.id === this.activeTopicId)
      : null;

    if (completedPremise) await this.markCompleted();
    else await this.markSeenWelcome();

    this.lastCompletionModal = topic && !completedPremise
      ? {
        ...this.completionModal,
        title: `${topic.title} guide complete`,
        content: `You finished the ${topic.title} guide. Use the help button anytime to revisit this topic or start Premise.`
      }
      : this.completionModal;

    if (this.onComplete) {
      this.onComplete(this.lastCompletionModal);
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
