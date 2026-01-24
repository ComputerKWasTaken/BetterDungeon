// BetterDungeon - features/auto_enable_scripts_feature.js
// Automatically enables the "Allow Scripts" toggle on the Scenario Editing page
// Respects user preference - if user disables scripts, we remember that choice

class AutoEnableScriptsFeature {
  static id = 'autoEnableScripts';
  static STORAGE_KEY = 'bd_scriptsDisabledScenarios';

  constructor() {
    this.observer = null;
    this.debounceTimer = null;
    this.hasProcessedCurrentPage = false;
    this.currentToggle = null;
    this.toggleClickHandler = null;
  }

  init() {
    console.log('[AutoEnableScripts] Initializing Auto Enable Scripts feature...');
    this.startObserving();
    this.tryEnableScripts();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.removeToggleListener();
  }

  // Extract scenario ID from the current URL
  getScenarioId() {
    const url = window.location.href;
    // URL pattern: /scenario/{shortId}/... or /Scenario/{shortId}/...
    const match = url.match(/\/[Ss]cenario\/([^/]+)/);
    return match ? match[1] : null;
  }

  // Get list of scenarios where user has disabled scripts
  getDisabledScenarios() {
    try {
      const stored = localStorage.getItem(AutoEnableScriptsFeature.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  // Save scenario to disabled list
  saveScenarioAsDisabled(scenarioId) {
    const disabled = this.getDisabledScenarios();
    if (!disabled.includes(scenarioId)) {
      disabled.push(scenarioId);
      localStorage.setItem(AutoEnableScriptsFeature.STORAGE_KEY, JSON.stringify(disabled));
      console.log('[AutoEnableScripts] Saved user preference: scripts disabled for scenario', scenarioId);
    }
  }

  // Remove scenario from disabled list (user re-enabled scripts)
  removeScenarioFromDisabled(scenarioId) {
    const disabled = this.getDisabledScenarios();
    const index = disabled.indexOf(scenarioId);
    if (index !== -1) {
      disabled.splice(index, 1);
      localStorage.setItem(AutoEnableScriptsFeature.STORAGE_KEY, JSON.stringify(disabled));
      console.log('[AutoEnableScripts] Removed user preference: scripts enabled for scenario', scenarioId);
    }
  }

  // Check if user has disabled scripts for this scenario
  isScenarioDisabledByUser(scenarioId) {
    return this.getDisabledScenarios().includes(scenarioId);
  }

  // Check if we're on a scenario editing page
  isOnScenarioEditPage() {
    const url = window.location.href;
    return url.includes('/edit') && (url.includes('/scenario/') || url.includes('/Scenario/'));
  }

  // Find the scripts toggle switch
  findScriptsToggle() {
    const allSwitches = document.querySelectorAll('button[role="switch"]');
    
    for (const switchBtn of allSwitches) {
      const parent = switchBtn.closest('div');
      if (parent) {
        const textContent = parent.textContent || '';
        if (textContent.includes('Scripts Disabled') || textContent.includes('Scripts Enabled')) {
          return switchBtn;
        }
      }
    }
    
    return null;
  }

  // Check if the toggle is currently disabled (scripts are off)
  isScriptsDisabled(toggle) {
    return toggle.getAttribute('aria-checked') === 'false';
  }

  // Remove listener from previous toggle
  removeToggleListener() {
    if (this.currentToggle && this.toggleClickHandler) {
      this.currentToggle.removeEventListener('click', this.toggleClickHandler);
      this.currentToggle = null;
      this.toggleClickHandler = null;
    }
  }

  // Watch for user manually toggling scripts
  watchToggleForUserChanges(toggle) {
    this.removeToggleListener();
    
    const scenarioId = this.getScenarioId();
    if (!scenarioId) return;

    this.currentToggle = toggle;
    this.toggleClickHandler = () => {
      // Check state AFTER the click (use setTimeout to let state update)
      setTimeout(() => {
        const isNowDisabled = this.isScriptsDisabled(toggle);
        if (isNowDisabled) {
          // User disabled scripts - save their preference
          this.saveScenarioAsDisabled(scenarioId);
        } else {
          // User enabled scripts - remove from disabled list
          this.removeScenarioFromDisabled(scenarioId);
        }
      }, 50);
    };

    toggle.addEventListener('click', this.toggleClickHandler);
  }

  // Enable scripts by clicking the toggle
  enableScripts(toggle) {
    if (this.isScriptsDisabled(toggle)) {
      console.log('[AutoEnableScripts] Enabling scripts toggle...');
      toggle.click();
      return true;
    }
    return false;
  }

  tryEnableScripts() {
    if (!this.isOnScenarioEditPage()) {
      return;
    }

    const toggle = this.findScriptsToggle();
    if (!toggle) {
      return;
    }

    // Already processed this page
    if (this.hasProcessedCurrentPage) {
      return;
    }

    this.hasProcessedCurrentPage = true;

    // Always watch for user changes
    this.watchToggleForUserChanges(toggle);

    // Check if user has previously disabled scripts for this scenario
    const scenarioId = this.getScenarioId();
    if (scenarioId && this.isScenarioDisabledByUser(scenarioId)) {
      console.log('[AutoEnableScripts] Respecting user preference: scripts stay disabled for scenario', scenarioId);
      return;
    }

    // Auto-enable if not disabled by user preference
    this.enableScripts(toggle);
  }

  debouncedTryEnable() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.tryEnableScripts();
    }, 200);
  }

  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    let lastUrl = window.location.href;

    this.observer = new MutationObserver((mutations) => {
      // Check for URL changes (SPA navigation)
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        this.hasProcessedCurrentPage = false;
        this.removeToggleListener();
      }

      if (!this.isOnScenarioEditPage()) {
        return;
      }

      let shouldTryEnable = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches?.('button[role="switch"]') ||
                  node.querySelector?.('button[role="switch"]')) {
                shouldTryEnable = true;
                break;
              }
            }
          }
        }
        if (shouldTryEnable) break;
      }

      if (shouldTryEnable) {
        this.debouncedTryEnable();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutoEnableScriptsFeature;
}
