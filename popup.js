// Better Dungeon - Popup Script
// Handles the extension popup interface and feature settings

const STORAGE_KEY = 'betterDungeonFeatures';

// Default feature states
const DEFAULT_FEATURES = {
  markdown: true,
  command: true,
  attempt: true,
  triggerHighlight: true
};

const SETTINGS_KEY = 'betterDungeonSettings';

const DEFAULT_SETTINGS = {
  attemptCriticalChance: 5
};

document.addEventListener('DOMContentLoaded', function() {
  loadFeatureStates();
  loadSettings();
  loadAutoScanSetting();
  loadAutoApplySetting();
  setupTabNavigation();
  setupFeatureToggles();
  setupExpandableCards();
  setupSettingsControls();
  setupApplyInstructionsButton();
  setupScanTriggersButton();
  setupAutoScanToggle();
  setupAutoApplyToggle();
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

// Setup expandable cards
function setupExpandableCards() {
  const chevronBtns = document.querySelectorAll('.chevron-btn');
  
  chevronBtns.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const featureId = this.dataset.expand;
      const card = document.querySelector(`.card[data-feature="${featureId}"]`);
      
      if (card) {
        card.classList.toggle('expanded');
      }
    });
  });
  
  // Also allow clicking the header to expand
  const cardHeaders = document.querySelectorAll('.card-header');
  cardHeaders.forEach(header => {
    header.addEventListener('click', function(e) {
      // Don't expand if clicking on toggle
      if (e.target.closest('.toggle')) return;
      
      const card = this.closest('.card');
      if (card) {
        card.classList.toggle('expanded');
      }
    });
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
  const toggles = document.querySelectorAll('.card input[type="checkbox"][id^="feature-"]');
  
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
          type: 'APPLY_INSTRUCTIONS_WITH_LOADING'
        }).then(response => {
          if (response?.success) {
            showApplyButtonStatus(btn, 'success', 'Done!');
          } else {
            showApplyButtonStatus(btn, 'error', response?.error || 'Failed');
          }
        }).catch(() => {
          showApplyButtonStatus(btn, 'error', 'Error');
        });
      }
    });
  });
}

// Show apply button status feedback
function showApplyButtonStatus(btn, status, text) {
  btn.textContent = text;
  if (status === 'success') {
    btn.style.background = 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)';
  } else if (status === 'error') {
    btn.style.background = 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)';
  }
  
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Apply';
    btn.style.background = '';
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
  const attemptOptionRow = document.querySelector('#expanded-attempt .option-row');
  
  if (attemptToggle && attemptOptionRow) {
    attemptOptionRow.style.opacity = attemptToggle.checked ? '1' : '0.5';
    const slider = attemptOptionRow.querySelector('.slider');
    if (slider) {
      slider.disabled = !attemptToggle.checked;
    }
  }
}

// Setup scan triggers button
function setupScanTriggersButton() {
  const scanBtn = document.getElementById('scan-triggers-btn');
  
  if (scanBtn) {
    scanBtn.addEventListener('click', async function() {
      // Disable button during scan
      scanBtn.disabled = true;
      scanBtn.textContent = 'Scanning...';
      scanBtn.classList.add('scanning');
      
      try {
        // Send message to content script to start scanning
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab?.id) {
          throw new Error('No active tab found');
        }
        
        // Check if we're on AI Dungeon
        if (!tab.url?.includes('aidungeon.com')) {
          throw new Error('Navigate to AI Dungeon first');
        }
        
        chrome.tabs.sendMessage(tab.id, { type: 'SCAN_STORY_CARDS' }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Scan error:', chrome.runtime.lastError);
            scanBtn.textContent = 'Error';
            setTimeout(() => resetScanButton(scanBtn), 2000);
            return;
          }
          
          if (response?.success) {
            scanBtn.textContent = 'Done!';
            scanBtn.style.background = 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)';
          } else {
            scanBtn.textContent = response?.error || 'Failed';
          }
          
          setTimeout(() => resetScanButton(scanBtn), 2000);
        });
        
      } catch (error) {
        console.error('Scan error:', error);
        scanBtn.textContent = error.message || 'Error';
        setTimeout(() => resetScanButton(scanBtn), 2000);
      }
    });
  }
}

function resetScanButton(btn) {
  btn.disabled = false;
  btn.textContent = 'Scan';
  btn.classList.remove('scanning');
  btn.style.background = '';
}

// Load auto-scan setting
function loadAutoScanSetting() {
  chrome.storage.sync.get('betterDungeon_autoScanTriggers', function(result) {
    const autoScanToggle = document.getElementById('auto-scan-triggers');
    if (autoScanToggle) {
      autoScanToggle.checked = result.betterDungeon_autoScanTriggers ?? false;
    }
  });
}

// Setup auto-scan toggle
function setupAutoScanToggle() {
  const autoScanToggle = document.getElementById('auto-scan-triggers');
  
  if (autoScanToggle) {
    autoScanToggle.addEventListener('change', async function() {
      const enabled = this.checked;
      
      // Save to storage
      chrome.storage.sync.set({ betterDungeon_autoScanTriggers: enabled });
      
      // Notify content script
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && tab.url?.includes('aidungeon.com')) {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'SET_AUTO_SCAN', 
            enabled: enabled 
          });
        }
      } catch (e) {
        console.log('Could not notify content script:', e);
      }
    });
  }
}

// Load auto-apply instructions setting
function loadAutoApplySetting() {
  chrome.storage.sync.get('betterDungeon_autoApplyInstructions', function(result) {
    const autoApplyToggle = document.getElementById('auto-apply-instructions');
    if (autoApplyToggle) {
      autoApplyToggle.checked = result.betterDungeon_autoApplyInstructions ?? false;
    }
  });
}

// Setup auto-apply instructions toggle
function setupAutoApplyToggle() {
  const autoApplyToggle = document.getElementById('auto-apply-instructions');
  
  if (autoApplyToggle) {
    autoApplyToggle.addEventListener('change', async function() {
      const enabled = this.checked;
      
      // Save to storage
      chrome.storage.sync.set({ betterDungeon_autoApplyInstructions: enabled });
      
      // Notify content script
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && tab.url?.includes('aidungeon.com')) {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'SET_AUTO_APPLY', 
            enabled: enabled 
          });
        }
      } catch (e) {
        console.log('Could not notify content script:', e);
      }
    });
  }
}
