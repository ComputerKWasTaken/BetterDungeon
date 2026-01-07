// Better Dungeon - Popup Script
// Handles the extension popup interface and feature settings

const STORAGE_KEY = 'betterDungeonFeatures';

// Default feature states
const DEFAULT_FEATURES = {
  markdown: true,
  command: true
};

document.addEventListener('DOMContentLoaded', function() {
  checkTabStatus();
  loadFeatureStates();
  setupFeatureToggles();
  setupApplyInstructionsButton();
});

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
