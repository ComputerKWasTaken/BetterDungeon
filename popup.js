// Better Dungeon - Popup Script
// Handles the extension popup interface and feature settings

const STORAGE_KEY = 'betterDungeonFeatures';

// Default feature states
const DEFAULT_FEATURES = {
  markdown: true,
  command: true,
  attempt: true,
  triggerHighlight: true,
  hotkey: true,
  favoriteInstructions: true,
  inputModeColor: true
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
  setupHotkeyDetailsToggle();
  setupInputModeColorDetailsToggle();
  setupProfileLinks();
  setupPresetManagement();
  loadPresets();
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
  // Select toggles from both .card and .enhancement-card elements
  const toggles = document.querySelectorAll('input[type="checkbox"][id^="feature-"]');
  
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

// Setup hotkey details toggle
function setupHotkeyDetailsToggle() {
  const chevronBtn = document.querySelector('[data-expand="hotkey-details"]');
  const detailsSection = document.getElementById('hotkey-details');
  
  if (chevronBtn && detailsSection) {
    chevronBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      detailsSection.classList.toggle('expanded');
      
      // Rotate chevron
      const svg = this.querySelector('svg');
      if (svg) {
        svg.style.transform = detailsSection.classList.contains('expanded') 
          ? 'rotate(180deg)' 
          : 'rotate(0deg)';
      }
    });
  }
}

// Setup input mode color details toggle
function setupInputModeColorDetailsToggle() {
  const chevronBtn = document.querySelector('[data-expand="inputModeColor-details"]');
  const detailsSection = document.getElementById('inputModeColor-details');
  
  if (chevronBtn && detailsSection) {
    chevronBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      detailsSection.classList.toggle('expanded');
      
      // Rotate chevron
      const svg = this.querySelector('svg');
      if (svg) {
        svg.style.transform = detailsSection.classList.contains('expanded') 
          ? 'rotate(180deg)' 
          : 'rotate(0deg)';
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

// Setup profile links to open in new tabs
function setupProfileLinks() {
  const profileLinks = document.querySelectorAll('.card-note a');
  
  profileLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const url = this.href;
      
      if (url && url.includes('aidungeon.com/profile/')) {
        chrome.tabs.create({ url: url });
      }
    });
  });
}

// ============================================
// PRESET MANAGEMENT
// ============================================

const PRESETS_STORAGE_KEY = 'betterDungeon_favoritePresets';
let currentEditingPreset = null;
let lastUndoState = null; // Store previous state for undo

// Load presets from storage and render them
async function loadPresets() {
  chrome.storage.sync.get(PRESETS_STORAGE_KEY, function(result) {
    const presets = result[PRESETS_STORAGE_KEY] || [];
    renderPresets(presets);
  });
}

// Render preset list
function renderPresets(presets) {
  const listContainer = document.getElementById('preset-list');
  const emptyState = document.getElementById('preset-empty');
  
  if (!listContainer) return;
  
  // Clear existing preset cards (but keep empty state)
  const existingCards = listContainer.querySelectorAll('.preset-card');
  existingCards.forEach(card => card.remove());
  
  if (presets.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  
  // Sort by use count (most used first)
  const sortedPresets = [...presets].sort((a, b) => b.useCount - a.useCount);
  
  sortedPresets.forEach(preset => {
    const card = createPresetCard(preset);
    listContainer.appendChild(card);
  });
}

// Create a preset card element
function createPresetCard(preset) {
  const card = document.createElement('div');
  card.className = 'preset-card';
  card.dataset.presetId = preset.id;
  
  // Build component badges
  const componentBadges = [];
  if (preset.components.aiInstructions) componentBadges.push('AI Instructions');
  if (preset.components.plotEssentials) componentBadges.push('Plot Essentials');
  if (preset.components.authorsNote) componentBadges.push("Author's Note");
  
  card.innerHTML = `
    <div class="preset-header">
      <div class="preset-info">
        <h4 class="preset-name">${escapeHtml(preset.name)}</h4>
        <div class="preset-meta">
          <span class="preset-uses">${preset.useCount} uses</span>
          <span class="preset-components">${componentBadges.join(' • ')}</span>
        </div>
      </div>
      <button class="preset-menu-btn" aria-label="Preset options">⋮</button>
    </div>
    <div class="preset-actions-row">
      <button class="preset-apply-btn" data-mode="replace">Replace</button>
      <button class="preset-apply-btn preset-apply-append" data-mode="append">Append</button>
    </div>
    <div class="preset-menu" style="display: none;">
      <button class="preset-menu-item preset-preview-btn">Preview / Edit</button>
      <button class="preset-menu-item preset-delete-btn">Delete</button>
    </div>
  `;
  
  // Setup event handlers
  setupPresetCardHandlers(card, preset);
  
  return card;
}

// Setup handlers for a preset card
function setupPresetCardHandlers(card, preset) {
  // Menu toggle
  const menuBtn = card.querySelector('.preset-menu-btn');
  const menu = card.querySelector('.preset-menu');
  
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close all other menus first
    document.querySelectorAll('.preset-menu').forEach(m => {
      if (m !== menu) m.style.display = 'none';
    });
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  
  // Close menu when clicking elsewhere
  document.addEventListener('click', () => {
    menu.style.display = 'none';
  });
  
  // Apply buttons
  card.querySelectorAll('.preset-apply-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      await applyPreset(preset.id, mode);
    });
  });
  
  // Preview/Edit button
  card.querySelector('.preset-preview-btn').addEventListener('click', async () => {
    menu.style.display = 'none';
    openPresetModal(preset);
  });
  
  // Delete button
  card.querySelector('.preset-delete-btn').addEventListener('click', async () => {
    menu.style.display = 'none';
    if (confirm(`Delete preset "${preset.name}"?`)) {
      await deletePreset(preset.id);
    }
  });
}

// Apply a preset to current adventure
async function applyPreset(presetId, mode) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id || !tab.url?.includes('aidungeon.com')) {
      showPresetStatus('Navigate to AI Dungeon first', 'error');
      return;
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'APPLY_PRESET',
      presetId: presetId,
      mode: mode
    });
    
    if (response?.success) {
      // Store undo state if provided
      if (response.previousState) {
        lastUndoState = response.previousState;
        updateUndoButton();
      }
      showPresetStatus(`Applied (${mode})!`, 'success');
      // Reload presets to update use count
      loadPresets();
    } else {
      showPresetStatus(response?.error || 'Failed to apply', 'error');
    }
  } catch (error) {
    console.error('Apply preset error:', error);
    showPresetStatus('Error applying preset', 'error');
  }
}

// Update undo button visibility
function updateUndoButton() {
  const undoBtn = document.getElementById('undo-preset-btn');
  if (undoBtn) {
    undoBtn.style.display = lastUndoState ? 'flex' : 'none';
  }
}

// Update a preset
async function updatePreset(presetId, updates) {
  chrome.storage.sync.get(PRESETS_STORAGE_KEY, function(result) {
    const presets = result[PRESETS_STORAGE_KEY] || [];
    const index = presets.findIndex(p => p.id === presetId);
    
    if (index !== -1) {
      presets[index] = { ...presets[index], ...updates, updatedAt: Date.now() };
      chrome.storage.sync.set({ [PRESETS_STORAGE_KEY]: presets }, () => {
        loadPresets();
        showPresetStatus('Preset updated!', 'success');
      });
    }
  });
}

// Delete a preset
async function deletePreset(presetId) {
  chrome.storage.sync.get(PRESETS_STORAGE_KEY, function(result) {
    const presets = result[PRESETS_STORAGE_KEY] || [];
    const filtered = presets.filter(p => p.id !== presetId);
    
    chrome.storage.sync.set({ [PRESETS_STORAGE_KEY]: filtered }, () => {
      loadPresets();
      showPresetStatus('Preset deleted', 'success');
    });
  });
}

// Setup preset management buttons
function setupPresetManagement() {
  const saveBtn = document.getElementById('save-current-preset-btn');
  
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab?.id || !tab.url?.includes('aidungeon.com')) {
          showPresetStatus('Navigate to AI Dungeon first', 'error');
          return;
        }
        
        // Open save modal instead of prompt
        openSaveModal();
      } catch (error) {
        console.error('Save preset error:', error);
        showPresetStatus('Error opening save dialog', 'error');
      }
    });
  }
  
  // Setup modal handlers
  setupModalHandlers();
}

// Show status message for preset operations
function showPresetStatus(message, type) {
  // Remove existing status
  const existingStatus = document.querySelector('.preset-status');
  if (existingStatus) existingStatus.remove();
  
  const status = document.createElement('div');
  status.className = `preset-status preset-status-${type}`;
  status.textContent = message;
  
  const presetList = document.getElementById('preset-list');
  if (presetList) {
    presetList.insertBefore(status, presetList.firstChild);
    
    setTimeout(() => {
      status.classList.add('preset-status-fade');
      setTimeout(() => status.remove(), 300);
    }, 2000);
  }
}

// Escape HTML for safe rendering
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// MODAL HANDLING
// ============================================

// Open preset preview/edit modal
function openPresetModal(preset) {
  currentEditingPreset = preset;
  
  const modal = document.getElementById('preset-modal');
  const nameInput = document.getElementById('modal-preset-name');
  const aiTextarea = document.getElementById('modal-ai-instructions');
  const essentialsTextarea = document.getElementById('modal-plot-essentials');
  const noteTextarea = document.getElementById('modal-authors-note');
  const aiCheck = document.getElementById('modal-check-ai');
  const essentialsCheck = document.getElementById('modal-check-essentials');
  const noteCheck = document.getElementById('modal-check-note');
  
  // Populate fields
  nameInput.value = preset.name;
  aiTextarea.value = preset.components.aiInstructions || '';
  essentialsTextarea.value = preset.components.plotEssentials || '';
  noteTextarea.value = preset.components.authorsNote || '';
  
  // Set checkboxes based on whether content exists
  aiCheck.checked = !!preset.components.aiInstructions;
  essentialsCheck.checked = !!preset.components.plotEssentials;
  noteCheck.checked = !!preset.components.authorsNote;
  
  // Update textarea disabled state
  aiTextarea.disabled = !aiCheck.checked;
  essentialsTextarea.disabled = !essentialsCheck.checked;
  noteTextarea.disabled = !noteCheck.checked;
  
  modal.style.display = 'flex';
}

// Close preset modal
function closePresetModal() {
  const modal = document.getElementById('preset-modal');
  modal.style.display = 'none';
  currentEditingPreset = null;
}

// Save preset modal changes
async function savePresetModalChanges() {
  if (!currentEditingPreset) return;
  
  const nameInput = document.getElementById('modal-preset-name');
  const aiTextarea = document.getElementById('modal-ai-instructions');
  const essentialsTextarea = document.getElementById('modal-plot-essentials');
  const noteTextarea = document.getElementById('modal-authors-note');
  const aiCheck = document.getElementById('modal-check-ai');
  const essentialsCheck = document.getElementById('modal-check-essentials');
  const noteCheck = document.getElementById('modal-check-note');
  
  const updates = {
    name: nameInput.value.trim() || currentEditingPreset.name,
    components: {}
  };
  
  // Only include checked components
  if (aiCheck.checked && aiTextarea.value.trim()) {
    updates.components.aiInstructions = aiTextarea.value;
  }
  if (essentialsCheck.checked && essentialsTextarea.value.trim()) {
    updates.components.plotEssentials = essentialsTextarea.value;
  }
  if (noteCheck.checked && noteTextarea.value.trim()) {
    updates.components.authorsNote = noteTextarea.value;
  }
  
  await updatePreset(currentEditingPreset.id, updates);
  closePresetModal();
}

// Open save modal (for new presets)
function openSaveModal() {
  const modal = document.getElementById('save-modal');
  const nameInput = document.getElementById('save-preset-name');
  
  // Reset form
  nameInput.value = '';
  document.getElementById('save-check-ai').checked = true;
  document.getElementById('save-check-essentials').checked = true;
  document.getElementById('save-check-note').checked = true;
  
  modal.style.display = 'flex';
  nameInput.focus();
}

// Close save modal
function closeSaveModal() {
  const modal = document.getElementById('save-modal');
  modal.style.display = 'none';
}

// Confirm save from modal
async function confirmSavePreset() {
  const nameInput = document.getElementById('save-preset-name');
  const name = nameInput.value.trim();
  
  if (!name) {
    nameInput.focus();
    return;
  }
  
  const includeAi = document.getElementById('save-check-ai').checked;
  const includeEssentials = document.getElementById('save-check-essentials').checked;
  const includeNote = document.getElementById('save-check-note').checked;
  
  if (!includeAi && !includeEssentials && !includeNote) {
    showPresetStatus('Select at least one component', 'error');
    return;
  }
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id || !tab.url?.includes('aidungeon.com')) {
      showPresetStatus('Navigate to AI Dungeon first', 'error');
      return;
    }
    
    closeSaveModal();
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'SAVE_CURRENT_AS_PRESET',
      name: name,
      includeComponents: {
        aiInstructions: includeAi,
        plotEssentials: includeEssentials,
        authorsNote: includeNote
      }
    });
    
    if (response?.success) {
      showPresetStatus('Preset saved!', 'success');
      loadPresets();
    } else {
      showPresetStatus(response?.error || 'Failed to save preset', 'error');
    }
  } catch (error) {
    console.error('Save preset error:', error);
    showPresetStatus('Error saving preset', 'error');
  }
}

// Undo last apply
async function undoLastApply() {
  if (!lastUndoState) return;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id || !tab.url?.includes('aidungeon.com')) {
      showPresetStatus('Navigate to AI Dungeon first', 'error');
      return;
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'UNDO_PRESET_APPLY',
      previousState: lastUndoState
    });
    
    if (response?.success) {
      showPresetStatus('Undone!', 'success');
      lastUndoState = null;
      updateUndoButton();
    } else {
      showPresetStatus(response?.error || 'Failed to undo', 'error');
    }
  } catch (error) {
    console.error('Undo error:', error);
    showPresetStatus('Error undoing', 'error');
  }
}

// Setup modal event handlers
function setupModalHandlers() {
  // Preview/Edit modal
  document.getElementById('modal-close')?.addEventListener('click', closePresetModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closePresetModal);
  document.getElementById('modal-save')?.addEventListener('click', savePresetModalChanges);
  
  // Checkbox toggles for textareas
  ['ai', 'essentials', 'note'].forEach(type => {
    const checkId = `modal-check-${type}`;
    const textareaId = type === 'ai' ? 'modal-ai-instructions' : 
                       type === 'essentials' ? 'modal-plot-essentials' : 'modal-authors-note';
    
    document.getElementById(checkId)?.addEventListener('change', (e) => {
      const textarea = document.getElementById(textareaId);
      if (textarea) {
        textarea.disabled = !e.target.checked;
      }
    });
  });
  
  // Save modal
  document.getElementById('save-modal-close')?.addEventListener('click', closeSaveModal);
  document.getElementById('save-modal-cancel')?.addEventListener('click', closeSaveModal);
  document.getElementById('save-modal-confirm')?.addEventListener('click', confirmSavePreset);
  
  // Close modals on overlay click
  document.getElementById('preset-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'preset-modal') closePresetModal();
  });
  document.getElementById('save-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'save-modal') closeSaveModal();
  });
  
  // Undo button
  document.getElementById('undo-preset-btn')?.addEventListener('click', undoLastApply);
}
