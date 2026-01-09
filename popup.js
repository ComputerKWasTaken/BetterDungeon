// Better Dungeon - Popup Script
// Handles the extension popup interface and feature settings

const STORAGE_KEY = 'betterDungeonFeatures';

// Default feature states
const DEFAULT_FEATURES = {
  markdown: true,
  command: true,
  attempt: true
};

const SETTINGS_KEY = 'betterDungeonSettings';

const DEFAULT_SETTINGS = {
  attemptCriticalChance: 5
};

document.addEventListener('DOMContentLoaded', function() {
  checkTabStatus();
  loadFeatureStates();
  loadSettings();
  setupTabNavigation();
  setupFeatureToggles();
  setupExpandableCards();
  setupSettingsControls();
  setupApplyInstructionsButton();
});

// Setup tab navigation
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const targetTab = this.dataset.tab;
      
      // Update button states
      tabButtons.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      // Update content visibility
      tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `tab-${targetTab}`);
      });
    });
  });
}

// Setup expandable feature cards
function setupExpandableCards() {
  const expandButtons = document.querySelectorAll('.expand-btn');
  
  expandButtons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const featureId = this.dataset.expand;
      const card = document.querySelector(`.feature-card[data-feature="${featureId}"]`);
      
      if (card) {
        card.classList.toggle('expanded');
      }
    });
  });
  
  // Also allow clicking the header to expand
  const featureHeaders = document.querySelectorAll('.feature-header');
  featureHeaders.forEach(header => {
    header.addEventListener('click', function(e) {
      // Don't expand if clicking on toggle
      if (e.target.closest('.toggle')) return;
      
      const card = this.closest('.feature-card');
      if (card) {
        card.classList.toggle('expanded');
      }
    });
  });
}

// Check if current tab is AI Dungeon
function checkTabStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const currentTab = tabs[0];
    const url = currentTab?.url || '';
    
    const isAIDungeon = url.includes('aidungeon.com') || url.includes('play.aidungeon.com');
    const statusElement = document.getElementById('status');
    const statusText = statusElement.querySelector('.status-text');
    
    if (isAIDungeon) {
      statusText.textContent = 'Extension Active on AI Dungeon';
      statusElement.className = 'status active';
    } else {
      statusText.textContent = 'Navigate to AI Dungeon to use';
      statusElement.className = 'status inactive';
    }
  });
}

// Load saved feature states from storage
function loadFeatureStates() {
  chrome.storage.sync.get(STORAGE_KEY, function(result) {
    const features = result[STORAGE_KEY] || DEFAULT_FEATURES;
    
    // Update toggle states
    Object.keys(features).forEach(featureId => {
      const toggle = document.getElementById(`feature-${featureId}`);
      if (toggle) {
        toggle.checked = features[featureId];
      }
    });
  });
}

// Setup event listeners for feature toggles
function setupFeatureToggles() {
  const toggles = document.querySelectorAll('.feature-item input[type="checkbox"]');
  
  toggles.forEach(toggle => {
    toggle.addEventListener('change', function() {
      const featureId = this.id.replace('feature-', '');
      const enabled = this.checked;
      
      // Save to storage
      chrome.storage.sync.get(STORAGE_KEY, function(result) {
        const features = result[STORAGE_KEY] || DEFAULT_FEATURES;
        features[featureId] = enabled;
        
        chrome.storage.sync.set({ [STORAGE_KEY]: features }, function() {
          console.log(`Feature "${featureId}" ${enabled ? 'enabled' : 'disabled'}`);
          
          // Notify content script of the change
          notifyContentScript(featureId, enabled);
        });
      });
    });
  });
}

// Notify content script about feature toggle
function notifyContentScript(featureId, enabled) {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const tab = tabs[0];
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'FEATURE_TOGGLE',
        featureId: featureId,
        enabled: enabled
      }).catch(() => {
        // Tab might not have content script loaded
      });
    }
  });
}

// Setup Apply Instructions button
function setupApplyInstructionsButton() {
  const btn = document.getElementById('apply-instructions-btn');
  if (!btn) return;

  btn.addEventListener('click', function() {
    btn.disabled = true;
    btn.textContent = 'Applying...';

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const tab = tabs[0];
      const url = tab?.url || '';
      const isAIDungeon = url.includes('aidungeon.com') || url.includes('play.aidungeon.com');

      if (!isAIDungeon) {
        showButtonStatus(btn, 'error', 'Not on AI Dungeon');
        return;
      }

      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'APPLY_INSTRUCTIONS'
        }).then(response => {
          if (response?.success) {
            showButtonStatus(btn, 'success', 'Applied!');
          } else {
            showButtonStatus(btn, 'error', response?.error || 'Failed');
          }
        }).catch(() => {
          showButtonStatus(btn, 'error', 'Extension not loaded');
        });
      }
    });
  });
}

// Show button status feedback
function showButtonStatus(btn, status, text) {
  btn.textContent = text;
  btn.classList.add(status);
  
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Apply Instructions';
    btn.classList.remove('success', 'error');
  }, 2000);
}

// Load saved settings from storage
function loadSettings() {
  chrome.storage.sync.get(SETTINGS_KEY, function(result) {
    const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
    
    // Update critical chance slider
    const slider = document.getElementById('critical-chance');
    const valueDisplay = document.getElementById('critical-chance-value');
    if (slider && valueDisplay) {
      slider.value = settings.attemptCriticalChance;
      valueDisplay.textContent = settings.attemptCriticalChance + '%';
    }
    
    // Update visibility of attempt settings based on feature state
    updateAttemptSettingsVisibility();
  });
}

// Setup settings controls (sliders, etc.)
function setupSettingsControls() {
  const slider = document.getElementById('critical-chance');
  const valueDisplay = document.getElementById('critical-chance-value');
  
  if (slider && valueDisplay) {
    slider.addEventListener('input', function() {
      const value = parseInt(this.value);
      valueDisplay.textContent = value + '%';
      
      // Save to storage
      chrome.storage.sync.get(SETTINGS_KEY, function(result) {
        const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;
        settings.attemptCriticalChance = value;
        
        chrome.storage.sync.set({ [SETTINGS_KEY]: settings }, function() {
          console.log('Critical chance set to', value + '%');
        });
      });
    });
  }
  
  // Watch for attempt feature toggle to show/hide settings
  const attemptToggle = document.getElementById('feature-attempt');
  if (attemptToggle) {
    attemptToggle.addEventListener('change', function() {
      updateAttemptSettingsVisibility();
    });
  }
}

// Update visibility of attempt settings based on feature state
function updateAttemptSettingsVisibility() {
  const attemptToggle = document.getElementById('feature-attempt');
  const attemptSettings = document.getElementById('attempt-settings');
  const attemptSettingRow = document.querySelector('#expanded-attempt .setting-row');
  
  // Handle legacy setting-item
  if (attemptToggle && attemptSettings) {
    attemptSettings.style.display = attemptToggle.checked ? 'flex' : 'none';
  }
  
  // Handle new setting-row inside expanded card
  if (attemptToggle && attemptSettingRow) {
    attemptSettingRow.style.opacity = attemptToggle.checked ? '1' : '0.5';
    const slider = attemptSettingRow.querySelector('.slider');
    if (slider) {
      slider.disabled = !attemptToggle.checked;
    }
  }
}
