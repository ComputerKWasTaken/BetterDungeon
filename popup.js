// BetterDungeon - Popup Script (Revamped)
// Cleaner architecture with modular organization

// ============================================
// CONSTANTS & STATE
// ============================================

const DEBUG = false;

const STORAGE_KEYS = {
  features: 'betterDungeonFeatures',
  settings: 'betterDungeonSettings',
  presets: 'betterDungeon_favoritePresets',
  characters: 'betterDungeon_characterPresets',
  autoScan: 'betterDungeon_autoScanTriggers',
  autoApply: 'betterDungeon_autoApplyInstructions',
  customHotkeys: 'betterDungeon_customHotkeys',
  customModeColors: 'betterDungeon_customModeColors',
};

// Default mode colors (hex format)
const DEFAULT_MODE_COLORS = {
  do: '#3b82f6',       // Blue - Primary action, confidence
  try: '#a855f7',      // Purple - Uncertainty, magic, RNG
  say: '#22c55e',      // Green - Dialogue, communication
  story: '#fbbf24',    // Amber/Gold - Authorial, creativity
  see: '#06b6d4',      // Cyan - Clarity, vision, perception
  command: '#f97316'   // Orange - Authority, directives
};

// Hotkey action definitions (must match hotkey_feature.js)
const HOTKEY_ACTIONS = {
  'takeATurn': { description: 'Take a Turn', category: 'actions' },
  'continue': { description: 'Continue', category: 'actions' },
  'retry': { description: 'Retry', category: 'actions' },
  'erase': { description: 'Erase', category: 'actions' },
  'exitInput': { description: 'Exit Input', category: 'actions' },
  'undo': { description: 'Undo', category: 'history' },
  'redo': { description: 'Redo', category: 'history' },
  'modeDo': { description: 'Do Mode', category: 'modes' },
  'modeTry': { description: 'Try Mode*', category: 'modes' },
  'modeSay': { description: 'Say Mode', category: 'modes' },
  'modeStory': { description: 'Story Mode', category: 'modes' },
  'modeSee': { description: 'See Mode', category: 'modes' },
  'modeCommand': { description: 'Command Mode*', category: 'modes' }
};

// Default hotkey bindings (key -> action ID)
const DEFAULT_HOTKEY_BINDINGS = {
  't': 'takeATurn',
  'c': 'continue',
  'r': 'retry',
  'e': 'erase',
  'escape': 'exitInput',
  'z': 'undo',
  'y': 'redo',
  '1': 'modeDo',
  '2': 'modeTry',
  '3': 'modeSay',
  '4': 'modeStory',
  '5': 'modeSee',
  '6': 'modeCommand'
};

const DEFAULT_FEATURES = {
  markdown: true,
  command: true,
  try: true,
  triggerHighlight: true,
  hotkey: true,
  favoriteInstructions: true,
  inputModeColor: true,
  characterPreset: true,
  autoSee: false,
  notes: true,
  storyCardModalDock: true
};

const DEFAULT_SETTINGS = {
  tryCriticalChance: 5
};

// State
let currentEditingPreset = null;
let currentEditingCharacter = null;
let lastUndoState = null;

// Hotkey editor state
let currentHotkeyBindings = { ...DEFAULT_HOTKEY_BINDINGS };
let editingHotkeyAction = null;
let hotkeyKeyListener = null;

// Mode color editor state
let currentModeColors = { ...DEFAULT_MODE_COLORS };

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] Initializing popup...');
  initNavigation();
  initFeatureCards();
  initToggles();
  initSettings();
  initPresets();
  initCharacters();
  initModals();
  initTools();
  initHotkeys();
  initModeColors();
  initTutorial();
});

// ============================================
// HELPERS
// ============================================

function log(message, ...args) {
  if (DEBUG) {
    console.log(message, ...args);
  }
}

// ============================================
// NAVIGATION
// ============================================

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.tab-panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      
      // Update nav
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      
      // Update panels
      panels.forEach(p => {
        p.classList.toggle('active', p.id === `tab-${tab}`);
      });
    });
  });
}

// ============================================
// FEATURE CARDS (Expandable)
// ============================================

function initFeatureCards() {
  const cards = document.querySelectorAll('.feature-card');
  
  cards.forEach(card => {
    const row = card.querySelector('.feature-row');
    if (!row) return;
    
    row.addEventListener('click', (e) => {
      // Don't toggle if clicking on the toggle switch
      if (e.target.closest('.toggle')) return;
      
      card.classList.toggle('expanded');
    });
  });
}

// ============================================
// FEATURE TOGGLES
// ============================================

function initToggles() {
  console.log('[Popup] Initializing toggles...');
  // Load saved states
  chrome.storage.sync.get(STORAGE_KEYS.features, (result) => {
    const features = result[STORAGE_KEYS.features] || DEFAULT_FEATURES;
    
    Object.entries(features).forEach(([id, enabled]) => {
      const toggle = document.getElementById(`feature-${id}`);
      if (toggle) toggle.checked = enabled;
    });
  });

  // Load auto-scan setting
  chrome.storage.sync.get(STORAGE_KEYS.autoScan, (result) => {
    const toggle = document.getElementById('auto-scan-triggers');
    if (toggle) toggle.checked = result[STORAGE_KEYS.autoScan] ?? false;
  });

  // Load auto-apply setting
  chrome.storage.sync.get(STORAGE_KEYS.autoApply, (result) => {
    const toggle = document.getElementById('auto-apply-instructions');
    if (toggle) toggle.checked = result[STORAGE_KEYS.autoApply] ?? false;
  });

  // Setup change handlers
  document.querySelectorAll('input[type="checkbox"][id^="feature-"]').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const featureId = toggle.id.replace('feature-', '');
      saveFeatureState(featureId, toggle.checked);
    });
  });

  // Auto-scan toggle
  document.getElementById('auto-scan-triggers')?.addEventListener('change', (e) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.autoScan]: e.target.checked });
    notifyContentScript('SET_AUTO_SCAN', { enabled: e.target.checked });
  });

  // Auto-apply toggle
  document.getElementById('auto-apply-instructions')?.addEventListener('change', (e) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.autoApply]: e.target.checked });
    notifyContentScript('SET_AUTO_APPLY', { enabled: e.target.checked });
  });
}

function saveFeatureState(featureId, enabled) {
  log('[Popup] Saving feature state:', featureId, enabled);
  chrome.storage.sync.get(STORAGE_KEYS.features, (result) => {
    const features = result[STORAGE_KEYS.features] || DEFAULT_FEATURES;
    features[featureId] = enabled;
    
    chrome.storage.sync.set({ [STORAGE_KEYS.features]: features }, () => {
      notifyContentScript('FEATURE_TOGGLE', { featureId, enabled });
    });
  });
}

// ============================================
// SETTINGS
// ============================================

function initSettings() {
  // Load settings
  chrome.storage.sync.get(STORAGE_KEYS.settings, (result) => {
    const settings = result[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    
    const slider = document.getElementById('critical-chance');
    const display = document.getElementById('critical-chance-value');
    
    if (slider && display) {
      slider.value = settings.tryCriticalChance;
      display.textContent = `${settings.tryCriticalChance}%`;
    }
  });

  // Slider handler
  const slider = document.getElementById('critical-chance');
  const display = document.getElementById('critical-chance-value');
  
  if (slider && display) {
    slider.addEventListener('input', () => {
      const value = parseInt(slider.value);
      display.textContent = `${value}%`;
      
      chrome.storage.sync.get(STORAGE_KEYS.settings, (result) => {
        const settings = result[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
        settings.tryCriticalChance = value;
        chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings });
      });
    });
  }

  // Auto See settings
  initAutoSeeSettings();
}

function initAutoSeeSettings() {
  const triggerModeSelect = document.getElementById('auto-see-trigger-mode');
  const intervalSlider = document.getElementById('auto-see-interval');
  const intervalDisplay = document.getElementById('auto-see-interval-value');
  const intervalOption = document.getElementById('auto-see-interval-option');

  // Load saved Auto See settings
  chrome.storage.sync.get([
    'betterDungeon_autoSeeTriggerMode',
    'betterDungeon_autoSeeTurnInterval'
  ], (result) => {
    const triggerMode = result.betterDungeon_autoSeeTriggerMode ?? 'everyTurn';
    const interval = result.betterDungeon_autoSeeTurnInterval ?? 2;

    if (triggerModeSelect) {
      triggerModeSelect.value = triggerMode;
      updateAutoSeeIntervalVisibility(triggerMode);
    }

    if (intervalSlider && intervalDisplay) {
      intervalSlider.value = interval;
      intervalDisplay.textContent = interval;
    }
  });

  // Trigger mode select handler
  if (triggerModeSelect) {
    triggerModeSelect.addEventListener('change', () => {
      const mode = triggerModeSelect.value;
      chrome.storage.sync.set({ betterDungeon_autoSeeTriggerMode: mode });
      notifyContentScript('SET_AUTO_SEE_TRIGGER_MODE', { mode });
      updateAutoSeeIntervalVisibility(mode);
    });
  }

  // Interval slider handler
  if (intervalSlider && intervalDisplay) {
    intervalSlider.addEventListener('input', () => {
      const value = parseInt(intervalSlider.value);
      intervalDisplay.textContent = value;
      chrome.storage.sync.set({ betterDungeon_autoSeeTurnInterval: value });
      notifyContentScript('SET_AUTO_SEE_TURN_INTERVAL', { interval: value });
    });
  }

  function updateAutoSeeIntervalVisibility(mode) {
    if (intervalOption) {
      intervalOption.style.display = mode === 'afterNTurns' ? 'flex' : 'none';
    }
  }
}

// ============================================
// TOOLS
// ============================================

function initTools() {
  // Apply Instructions button (in Markdown feature card)
  const applyBtn = document.getElementById('apply-instructions-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => applyInstructions(applyBtn));
  }

  // Scan Triggers button (in Trigger Highlighting feature card)
  const scanBtn = document.getElementById('scan-triggers-btn');
  if (scanBtn) {
    scanBtn.addEventListener('click', () => scanTriggers(scanBtn));
  }

  // Open Analytics button (in Tools section)
  const analyticsBtn = document.getElementById('open-analytics-btn');
  if (analyticsBtn) {
    analyticsBtn.addEventListener('click', () => openAnalyticsDashboard(analyticsBtn));
  }
}

async function applyInstructions(btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="icon-loader"></span> Applying...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url?.includes('aidungeon.com')) {
      showButtonStatus(btn, 'error', 'Not on AI Dungeon', originalText);
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'APPLY_INSTRUCTIONS_WITH_LOADING'
    });

    if (response?.success) {
      showButtonStatus(btn, 'success', 'Done!', originalText);
    } else {
      showButtonStatus(btn, 'error', response?.error || 'Failed', originalText);
    }
  } catch (error) {
    showButtonStatus(btn, 'error', 'Error', originalText);
  }
}

async function scanTriggers(btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="icon-loader"></span> Scanning...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url?.includes('aidungeon.com')) {
      showButtonStatus(btn, 'error', 'Not on AI Dungeon', originalText);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'SCAN_STORY_CARDS' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        showButtonStatus(btn, 'error', response?.error || 'Failed', originalText);
      } else {
        showButtonStatus(btn, 'success', 'Done!', originalText);
      }
    });
  } catch (error) {
    showButtonStatus(btn, 'error', 'Error', originalText);
  }
}

async function openAnalyticsDashboard(btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="icon-loader"></span> Opening...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url?.includes('aidungeon.com')) {
      showButtonStatus(btn, 'error', 'Not on AI Dungeon', originalText);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'OPEN_STORY_CARD_ANALYTICS' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        showButtonStatus(btn, 'error', response?.error || 'Failed', originalText);
      } else {
        // Close the popup after opening the dashboard
        btn.disabled = false;
        btn.innerHTML = originalText;
        window.close();
      }
    });
  } catch (error) {
    showButtonStatus(btn, 'error', 'Error', originalText);
  }
}

function showButtonStatus(btn, status, text, originalText) {
  btn.classList.remove('success', 'error');
  btn.classList.add(status);
  btn.innerHTML = text;

  setTimeout(() => {
    btn.disabled = false;
    btn.classList.remove('success', 'error');
    btn.innerHTML = originalText;
  }, 2000);
}

// ============================================
// HOTKEYS
// ============================================

function initHotkeys() {
  loadHotkeyBindings();
  
  // Customize button
  document.getElementById('customize-hotkeys-btn')?.addEventListener('click', openHotkeyModal);
  
  // Modal buttons
  document.getElementById('hotkey-modal-save')?.addEventListener('click', saveHotkeyBindings);
  document.getElementById('hotkey-modal-cancel')?.addEventListener('click', () => closeModal('hotkey-modal'));
  document.getElementById('hotkey-modal-close')?.addEventListener('click', () => closeModal('hotkey-modal'));
  document.getElementById('hotkey-reset-btn')?.addEventListener('click', resetHotkeyBindings);
  
  // Close modal on backdrop click
  document.getElementById('hotkey-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'hotkey-modal') closeModal('hotkey-modal');
  });
}

// Load hotkey bindings from storage
function loadHotkeyBindings() {
  chrome.storage.sync.get(STORAGE_KEYS.customHotkeys, (result) => {
    const customBindings = result[STORAGE_KEYS.customHotkeys];
    if (customBindings && typeof customBindings === 'object') {
      currentHotkeyBindings = { ...DEFAULT_HOTKEY_BINDINGS, ...customBindings };
    } else {
      currentHotkeyBindings = { ...DEFAULT_HOTKEY_BINDINGS };
    }
    updateHotkeyDisplay();
  });
}

// Update the hotkey display in the feature card
function updateHotkeyDisplay() {
  const grid = document.getElementById('hotkey-display-grid');
  if (!grid) return;
  
  // Create a reverse map: action -> key
  const actionToKey = {};
  for (const [key, actionId] of Object.entries(currentHotkeyBindings)) {
    actionToKey[actionId] = key;
  }
  
  // Update each hotkey element
  grid.querySelectorAll('.hotkey[data-action]').forEach(el => {
    const actionId = el.dataset.action;
    const key = actionToKey[actionId];
    const kbd = el.querySelector('kbd');
    if (kbd && key) {
      kbd.textContent = formatKeyDisplay(key);
    }
  });
}

// Format key for display (capitalize, handle special keys)
function formatKeyDisplay(key) {
  const specialKeys = {
    'escape': 'Esc',
    'arrowup': '↑',
    'arrowdown': '↓',
    'arrowleft': '←',
    'arrowright': '→',
    'backspace': '⌫',
    'delete': 'Del',
    'enter': '↵',
    'space': '␣',
    'tab': 'Tab'
  };
  
  const lowerKey = key.toLowerCase();
  if (specialKeys[lowerKey]) return specialKeys[lowerKey];
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// Open the hotkey customization modal
function openHotkeyModal() {
  // Reset to current saved bindings
  chrome.storage.sync.get(STORAGE_KEYS.customHotkeys, (result) => {
    const customBindings = result[STORAGE_KEYS.customHotkeys];
    if (customBindings && typeof customBindings === 'object') {
      currentHotkeyBindings = { ...DEFAULT_HOTKEY_BINDINGS, ...customBindings };
    } else {
      currentHotkeyBindings = { ...DEFAULT_HOTKEY_BINDINGS };
    }
    renderHotkeyEditor();
    openModal('hotkey-modal');
  });
}

// Render the hotkey editor lists
function renderHotkeyEditor() {
  const containers = {
    actions: document.getElementById('hotkey-editor-actions'),
    history: document.getElementById('hotkey-editor-history'),
    modes: document.getElementById('hotkey-editor-modes')
  };
  
  // Clear existing content
  Object.values(containers).forEach(c => { if (c) c.innerHTML = ''; });
  
  // Create reverse map: action -> key
  const actionToKey = {};
  for (const [key, actionId] of Object.entries(currentHotkeyBindings)) {
    actionToKey[actionId] = key;
  }
  
  // Render each action
  for (const [actionId, config] of Object.entries(HOTKEY_ACTIONS)) {
    const container = containers[config.category];
    if (!container) continue;
    
    const key = actionToKey[actionId] || '';
    const item = document.createElement('div');
    item.className = 'hotkey-editor-item';
    item.dataset.action = actionId;
    
    item.innerHTML = `
      <span class="hotkey-editor-action">${config.description}</span>
      <button class="hotkey-editor-key" data-action="${actionId}">${formatKeyDisplay(key)}</button>
    `;
    
    // Add click handler for key button
    const keyBtn = item.querySelector('.hotkey-editor-key');
    keyBtn.addEventListener('click', () => startRecordingKey(actionId, keyBtn));
    
    container.appendChild(item);
  }
}

// Start recording a new key for an action
function startRecordingKey(actionId, keyBtn) {
  // Cancel any existing recording
  stopRecordingKey();
  
  editingHotkeyAction = actionId;
  keyBtn.classList.add('recording');
  keyBtn.textContent = '';
  keyBtn.closest('.hotkey-editor-item').classList.add('recording');
  
  // Listen for key press
  hotkeyKeyListener = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Escape cancels recording
    if (e.key === 'Escape') {
      stopRecordingKey();
      renderHotkeyEditor();
      return;
    }
    
    // Get the key
    const newKey = e.key.toLowerCase();
    
    // Check for conflicts
    const existingAction = findActionForKey(newKey);
    if (existingAction && existingAction !== actionId) {
      // Swap the keys - remove the key from the existing action
      removeKeyBinding(newKey);
    }
    
    // Remove old key binding for this action
    for (const [key, action] of Object.entries(currentHotkeyBindings)) {
      if (action === actionId) {
        delete currentHotkeyBindings[key];
        break;
      }
    }
    
    // Set new binding
    currentHotkeyBindings[newKey] = actionId;
    
    stopRecordingKey();
    renderHotkeyEditor();
  };
  
  document.addEventListener('keydown', hotkeyKeyListener, true);
}

// Stop recording key
function stopRecordingKey() {
  if (hotkeyKeyListener) {
    document.removeEventListener('keydown', hotkeyKeyListener, true);
    hotkeyKeyListener = null;
  }
  editingHotkeyAction = null;
  
  // Remove recording classes
  document.querySelectorAll('.hotkey-editor-item.recording').forEach(el => {
    el.classList.remove('recording');
  });
  document.querySelectorAll('.hotkey-editor-key.recording').forEach(el => {
    el.classList.remove('recording');
  });
}

// Find which action is bound to a key
function findActionForKey(key) {
  return currentHotkeyBindings[key.toLowerCase()];
}

// Remove a key binding
function removeKeyBinding(key) {
  delete currentHotkeyBindings[key.toLowerCase()];
}

// Save hotkey bindings
async function saveHotkeyBindings() {
  log('[Popup] Saving hotkey bindings:', currentHotkeyBindings);
  // Save to storage
  await chrome.storage.sync.set({ [STORAGE_KEYS.customHotkeys]: currentHotkeyBindings });
  
  // Notify content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('aidungeon.com')) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'HOTKEY_BINDINGS_UPDATED',
        bindings: currentHotkeyBindings
      });
    }
  } catch (e) {
    // Tab might not be on AI Dungeon, that's fine
  }
  
  updateHotkeyDisplay();
  closeModal('hotkey-modal');
  showToast('Hotkeys saved!', 'success');
}

// Reset hotkey bindings to defaults
async function resetHotkeyBindings() {
  const confirmed = await showDialog({
    title: 'Reset Hotkeys',
    message: 'Reset all hotkeys to their default values?',
    confirmText: 'Reset',
    confirmClass: 'btn-danger'
  });
  if (!confirmed) return;
  
  currentHotkeyBindings = { ...DEFAULT_HOTKEY_BINDINGS };
  renderHotkeyEditor();
  showToast('Reset to defaults', 'success');
}

// ============================================
// MODE COLORS
// ============================================

function initModeColors() {
  loadModeColors();
  
  // Customize button
  document.getElementById('customize-colors-btn')?.addEventListener('click', openColorModal);
  
  // Modal buttons
  document.getElementById('color-modal-done')?.addEventListener('click', () => closeModal('color-modal'));
  document.getElementById('color-modal-close')?.addEventListener('click', () => closeModal('color-modal'));
  document.getElementById('color-reset-btn')?.addEventListener('click', resetModeColors);
  
  // Close modal on backdrop click
  document.getElementById('color-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'color-modal') closeModal('color-modal');
  });
  
  // Color input change handlers
  document.querySelectorAll('.color-editor-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const mode = e.target.dataset.mode;
      const color = e.target.value;
      currentModeColors[mode] = color;
      updateModeColorDisplay();
      saveModeColors();
    });
  });
}

// Load mode colors from storage
function loadModeColors() {
  chrome.storage.sync.get(STORAGE_KEYS.customModeColors, (result) => {
    const customColors = result[STORAGE_KEYS.customModeColors];
    if (customColors && typeof customColors === 'object') {
      currentModeColors = { ...DEFAULT_MODE_COLORS, ...customColors };
    } else {
      currentModeColors = { ...DEFAULT_MODE_COLORS };
    }
    updateModeColorDisplay();
    updateColorEditorInputs();
  });
}

// Update the color display in the feature card
function updateModeColorDisplay() {
  const grid = document.getElementById('mode-color-display');
  if (!grid) return;
  
  grid.querySelectorAll('.color-chip[data-mode]').forEach(chip => {
    const mode = chip.dataset.mode;
    const color = currentModeColors[mode];
    if (color) {
      chip.style.setProperty('--chip-color', color);
    }
  });
}

// Update the color inputs in the modal
function updateColorEditorInputs() {
  document.querySelectorAll('.color-editor-input').forEach(input => {
    const mode = input.dataset.mode;
    const color = currentModeColors[mode];
    if (color) {
      input.value = color;
    }
  });
}

// Open the color customization modal
function openColorModal() {
  // Reload from storage to ensure we have latest
  chrome.storage.sync.get(STORAGE_KEYS.customModeColors, (result) => {
    const customColors = result[STORAGE_KEYS.customModeColors];
    if (customColors && typeof customColors === 'object') {
      currentModeColors = { ...DEFAULT_MODE_COLORS, ...customColors };
    } else {
      currentModeColors = { ...DEFAULT_MODE_COLORS };
    }
    updateColorEditorInputs();
    openModal('color-modal');
  });
}

// Save mode colors to storage and notify content script
async function saveModeColors() {
  log('[Popup] Saving mode colors:', currentModeColors);
  // Save to storage
  await chrome.storage.sync.set({ [STORAGE_KEYS.customModeColors]: currentModeColors });
  
  // Notify content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('aidungeon.com')) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'MODE_COLORS_UPDATED',
        colors: currentModeColors
      });
    }
  } catch (e) {
    // Tab might not be on AI Dungeon, that's fine
  }
}

// Reset mode colors to defaults
async function resetModeColors() {
  const confirmed = await showDialog({
    title: 'Reset Colors',
    message: 'Reset all colors to their default values?',
    confirmText: 'Reset',
    confirmClass: 'btn-danger'
  });
  if (!confirmed) return;
  
  currentModeColors = { ...DEFAULT_MODE_COLORS };
  updateColorEditorInputs();
  updateModeColorDisplay();
  await saveModeColors();
  showToast('Colors reset to defaults', 'success');
}

// ============================================
// PRESETS
// ============================================

function initPresets() {
  loadPresets();
  
  // Save button
  document.getElementById('save-current-preset-btn')?.addEventListener('click', () => {
    openModal('save-modal');
    document.getElementById('save-preset-name')?.focus();
  });

  // Undo button
  document.getElementById('undo-preset-btn')?.addEventListener('click', undoLastApply);
}

async function loadPresets() {
  chrome.storage.sync.get(STORAGE_KEYS.presets, (result) => {
    const presets = result[STORAGE_KEYS.presets] || [];
    renderPresets(presets);
  });
}

function renderPresets(presets) {
  const container = document.getElementById('preset-list');
  const emptyState = document.getElementById('preset-empty');
  if (!container) return;

  // Clear existing cards
  container.querySelectorAll('.preset-card').forEach(c => c.remove());

  if (presets.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  // Sort by use count
  const sorted = [...presets].sort((a, b) => b.useCount - a.useCount);

  sorted.forEach(preset => {
    const card = createPresetCard(preset);
    container.appendChild(card);
  });
}

function createPresetCard(preset) {
  const card = document.createElement('div');
  card.className = 'preset-card';
  card.dataset.presetId = preset.id;

  const components = [];
  if (preset.components.aiInstructions) components.push('AI');
  if (preset.components.plotEssentials) components.push('Plot');
  if (preset.components.authorsNote) components.push('Note');

  card.innerHTML = `
    <div class="preset-header">
      <div>
        <h4 class="preset-name">${escapeHtml(preset.name)}</h4>
        <div class="preset-meta">
          <span class="preset-uses">${preset.useCount} uses</span>
          <span class="preset-components">${components.join(' • ')}</span>
        </div>
      </div>
      <button class="preset-menu-btn" aria-label="Options">⋮</button>
    </div>
    <div class="preset-actions">
      <button class="btn btn-primary" data-mode="replace">Replace</button>
      <button class="btn btn-ghost" data-mode="append">Append</button>
    </div>
    <div class="preset-menu">
      <button class="preset-menu-item preset-edit-btn">Edit</button>
      <button class="preset-menu-item danger preset-delete-btn">Delete</button>
    </div>
  `;

  // Menu toggle
  const menuBtn = card.querySelector('.preset-menu-btn');
  const menu = card.querySelector('.preset-menu');
  
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.preset-menu.open').forEach(m => m.classList.remove('open'));
    menu.classList.toggle('open');
  });

  // Close menu on outside click
  document.addEventListener('click', () => menu.classList.remove('open'));

  // Apply buttons
  card.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(preset.id, btn.dataset.mode));
  });

  // Edit button
  card.querySelector('.preset-edit-btn').addEventListener('click', () => {
    menu.classList.remove('open');
    openPresetEditModal(preset);
  });

  // Delete button
  card.querySelector('.preset-delete-btn').addEventListener('click', async () => {
    menu.classList.remove('open');
    const confirmed = await showDialog({
      title: 'Delete Preset',
      message: `Delete "${preset.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      confirmClass: 'btn-danger'
    });
    if (confirmed) deletePreset(preset.id);
  });

  return card;
}

async function applyPreset(presetId, mode) {
  log('[Popup] Applying preset:', presetId, mode);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url?.includes('aidungeon.com')) {
      showToast('Navigate to AI Dungeon first', 'error');
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'APPLY_PRESET',
      presetId,
      mode
    });

    if (response?.success) {
      if (response.previousState) {
        lastUndoState = response.previousState;
        updateUndoButton();
      }
      showToast(`Preset applied (${mode})`, 'success');
      loadPresets();
    } else {
      showToast(response?.error || 'Failed to apply', 'error');
    }
  } catch {
    showToast('Error applying preset', 'error');
  }
}

async function saveNewPreset() {
  const nameInput = document.getElementById('save-preset-name');
  const name = nameInput?.value.trim();
  
  if (!name) {
    nameInput?.focus();
    return;
  }

  const includeAi = document.getElementById('save-check-ai')?.checked;
  const includeEssentials = document.getElementById('save-check-essentials')?.checked;
  const includeNote = document.getElementById('save-check-note')?.checked;

  if (!includeAi && !includeEssentials && !includeNote) {
    showToast('Select at least one component', 'error');
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url?.includes('aidungeon.com')) {
      showToast('Navigate to AI Dungeon first', 'error');
      return;
    }

    closeModal('save-modal');

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'SAVE_CURRENT_AS_PRESET',
      name,
      includeComponents: {
        aiInstructions: includeAi,
        plotEssentials: includeEssentials,
        authorsNote: includeNote
      }
    });

    if (response?.success) {
      showToast('Preset saved!', 'success');
      loadPresets();
    } else {
      showToast(response?.error || 'Failed to save', 'error');
    }
  } catch {
    showToast('Error saving preset', 'error');
  }
}

function openPresetEditModal(preset) {
  currentEditingPreset = preset;
  
  document.getElementById('modal-preset-name').value = preset.name;
  document.getElementById('modal-ai-instructions').value = preset.components.aiInstructions || '';
  document.getElementById('modal-plot-essentials').value = preset.components.plotEssentials || '';
  document.getElementById('modal-authors-note').value = preset.components.authorsNote || '';
  
  document.getElementById('modal-check-ai').checked = !!preset.components.aiInstructions;
  document.getElementById('modal-check-essentials').checked = !!preset.components.plotEssentials;
  document.getElementById('modal-check-note').checked = !!preset.components.authorsNote;

  updateTextareaStates();
  openModal('preset-modal');
}

function savePresetChanges() {
  if (!currentEditingPreset) return;

  const updates = {
    name: document.getElementById('modal-preset-name').value.trim() || currentEditingPreset.name,
    components: {}
  };

  if (document.getElementById('modal-check-ai').checked) {
    updates.components.aiInstructions = document.getElementById('modal-ai-instructions').value;
  }
  if (document.getElementById('modal-check-essentials').checked) {
    updates.components.plotEssentials = document.getElementById('modal-plot-essentials').value;
  }
  if (document.getElementById('modal-check-note').checked) {
    updates.components.authorsNote = document.getElementById('modal-authors-note').value;
  }

  chrome.storage.sync.get(STORAGE_KEYS.presets, (result) => {
    const presets = result[STORAGE_KEYS.presets] || [];
    const index = presets.findIndex(p => p.id === currentEditingPreset.id);
    
    if (index !== -1) {
      presets[index] = { ...presets[index], ...updates, updatedAt: Date.now() };
      chrome.storage.sync.set({ [STORAGE_KEYS.presets]: presets }, () => {
        loadPresets();
        showToast('Preset updated', 'success');
        closeModal('preset-modal');
      });
    }
  });
}

function deletePreset(presetId) {
  chrome.storage.sync.get(STORAGE_KEYS.presets, (result) => {
    const presets = (result[STORAGE_KEYS.presets] || []).filter(p => p.id !== presetId);
    chrome.storage.sync.set({ [STORAGE_KEYS.presets]: presets }, () => {
      loadPresets();
      showToast('Preset deleted', 'success');
    });
  });
}

async function undoLastApply() {
  if (!lastUndoState) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.url?.includes('aidungeon.com')) {
      showToast('Navigate to AI Dungeon first', 'error');
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'UNDO_PRESET_APPLY',
      previousState: lastUndoState
    });

    if (response?.success) {
      showToast('Undone!', 'success');
      lastUndoState = null;
      updateUndoButton();
    } else {
      showToast(response?.error || 'Failed to undo', 'error');
    }
  } catch {
    showToast('Error undoing', 'error');
  }
}

function updateUndoButton() {
  const btn = document.getElementById('undo-preset-btn');
  if (btn) btn.style.display = lastUndoState ? 'flex' : 'none';
}

function updateTextareaStates() {
  ['ai', 'essentials', 'note'].forEach(type => {
    const check = document.getElementById(`modal-check-${type}`);
    const textarea = document.getElementById(
      type === 'ai' ? 'modal-ai-instructions' :
      type === 'essentials' ? 'modal-plot-essentials' : 'modal-authors-note'
    );
    if (check && textarea) {
      textarea.disabled = !check.checked;
    }
  });
}

// ============================================
// CHARACTERS
// ============================================

function initCharacters() {
  loadCharacters();
  
  document.getElementById('create-character-btn')?.addEventListener('click', async () => {
    const name = await showDialog({
      title: 'New Character',
      message: 'Enter a name for the new character:',
      confirmText: 'Create',
      inputPlaceholder: 'Character name'
    });
    if (!name) return;
    
    createCharacter(name);
  });
}

async function loadCharacters() {
  chrome.storage.sync.get(STORAGE_KEYS.characters, (result) => {
    const characters = result[STORAGE_KEYS.characters] || [];
    renderCharacters(characters);
  });
}

function renderCharacters(characters) {
  const container = document.getElementById('character-list');
  const emptyState = document.getElementById('character-empty');
  if (!container) return;

  container.querySelectorAll('.character-card').forEach(c => c.remove());

  if (characters.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  characters.forEach(char => {
    const card = createCharacterCard(char);
    container.appendChild(card);
  });
}

function createCharacterCard(character) {
  const card = document.createElement('div');
  card.className = 'character-card';
  
  const fieldCount = Object.keys(character.fields || {}).length;

  card.innerHTML = `
    <div>
      <h4 class="character-name">${escapeHtml(character.name)}</h4>
      <div class="character-meta">
        <span class="character-field-count">${fieldCount} field${fieldCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <button class="character-edit-btn" aria-label="Edit">
      <span class="icon-pencil"></span>
    </button>
  `;

  card.querySelector('.character-edit-btn').addEventListener('click', () => {
    openCharacterModal(character);
  });

  return card;
}

function createCharacter(name) {
  chrome.storage.sync.get(STORAGE_KEYS.characters, (result) => {
    const characters = result[STORAGE_KEYS.characters] || [];
    
    const newChar = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      name,
      fields: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    characters.unshift(newChar);
    
    chrome.storage.sync.set({ [STORAGE_KEYS.characters]: characters }, () => {
      loadCharacters();
      showToast('Character created!', 'success');
    });
  });
}

function openCharacterModal(character) {
  currentEditingCharacter = character;
  
  document.getElementById('character-name-input').value = character.name;
  
  // Reset search state
  const searchWrapper = document.getElementById('fields-search-wrapper');
  const searchInput = document.getElementById('character-fields-search');
  if (searchInput) searchInput.value = '';
  
  renderCharacterFields(character.fields || {});
  setupFieldSearch();
  
  openModal('character-modal');
}

// Humanize a normalized field key for display (e.g. "whats_your_age" -> "Whats Your Age")
function humanizeFieldKey(key) {
  if (!key) return '';
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Setup search/filter for character fields
function setupFieldSearch() {
  const searchInput = document.getElementById('character-fields-search');
  if (!searchInput) return;
  
  // Remove old listeners by cloning
  const newSearch = searchInput.cloneNode(true);
  searchInput.parentNode.replaceChild(newSearch, searchInput);
  
  newSearch.addEventListener('input', () => {
    const query = newSearch.value.toLowerCase().trim();
    const items = document.querySelectorAll('#character-fields-list .field-item');
    
    items.forEach(item => {
      const key = (item.dataset.key || '').toLowerCase();
      const value = (item.querySelector('.field-value')?.value || '').toLowerCase();
      const matches = !query || key.includes(query) || value.includes(query);
      item.classList.toggle('field-item-hidden', !matches);
    });
  });
}

function renderCharacterFields(fields) {
  const container = document.getElementById('character-fields-list');
  const countEl = document.getElementById('character-fields-count');
  const searchWrapper = document.getElementById('fields-search-wrapper');
  if (!container) return;

  const entries = Object.entries(fields);
  
  // Update field count badge
  if (countEl) {
    countEl.textContent = entries.length > 0 ? `${entries.length} field${entries.length !== 1 ? 's' : ''}` : '';
  }
  
  // Show search bar only when there are enough fields to warrant it
  if (searchWrapper) {
    searchWrapper.style.display = entries.length >= 4 ? 'block' : 'none';
  }
  
  if (entries.length === 0) {
    container.innerHTML = '<p class="fields-empty">No fields saved yet. Fields are saved automatically when you fill in scenario entry questions.</p>';
    return;
  }

  // Sort alphabetically by key
  const sorted = entries.sort((a, b) => a[0].localeCompare(b[0]));

  container.innerHTML = sorted.map(([key, value]) => {
    const displayKey = humanizeFieldKey(key);
    // Show raw key only if it differs meaningfully from the display key
    const showRaw = displayKey.toLowerCase().replace(/\s/g, '') !== key.replace(/_/g, '');
    return `
      <div class="field-item" data-key="${escapeHtml(key)}">
        <div class="field-item-header">
          <span class="field-key">
            ${escapeHtml(displayKey)}${showRaw ? `<span class="field-key-raw">${escapeHtml(key)}</span>` : ''}
          </span>
          <button class="field-delete" data-key="${escapeHtml(key)}" title="Delete field">×</button>
        </div>
        <textarea class="field-value" data-key="${escapeHtml(key)}" rows="1">${escapeHtml(value)}</textarea>
      </div>
    `;
  }).join('');

  // Auto-resize textareas to fit content
  container.querySelectorAll('.field-value').forEach(textarea => {
    autoResizeTextarea(textarea);
    textarea.addEventListener('input', () => autoResizeTextarea(textarea));
  });

  // Delete handlers
  container.querySelectorAll('.field-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      delete currentEditingCharacter.fields[key];
      renderCharacterFields(currentEditingCharacter.fields);
    });
  });
}

// Auto-resize a textarea to fit its content (up to max-height set in CSS)
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}

function addCharacterField() {
  if (!currentEditingCharacter) return;

  const keyInput = document.getElementById('new-field-key');
  const valueInput = document.getElementById('new-field-value');
  
  const key = keyInput.value.trim().toLowerCase().replace(/\s+/g, '_');
  const value = valueInput.value.trim();

  if (!key) {
    keyInput.focus();
    return;
  }

  currentEditingCharacter.fields[key] = value;
  renderCharacterFields(currentEditingCharacter.fields);
  
  keyInput.value = '';
  valueInput.value = '';
  keyInput.focus();
}

function saveCharacterChanges() {
  if (!currentEditingCharacter) return;

  const nameInput = document.getElementById('character-name-input');
  currentEditingCharacter.name = nameInput.value.trim() || currentEditingCharacter.name;

  // Update field values from textareas
  document.querySelectorAll('#character-fields-list .field-value').forEach(textarea => {
    const key = textarea.dataset.key;
    if (key && currentEditingCharacter.fields.hasOwnProperty(key)) {
      currentEditingCharacter.fields[key] = textarea.value;
    }
  });

  currentEditingCharacter.updatedAt = Date.now();

  chrome.storage.sync.get(STORAGE_KEYS.characters, (result) => {
    const characters = result[STORAGE_KEYS.characters] || [];
    const index = characters.findIndex(c => c.id === currentEditingCharacter.id);
    
    if (index !== -1) {
      characters[index] = currentEditingCharacter;
      chrome.storage.sync.set({ [STORAGE_KEYS.characters]: characters }, () => {
        loadCharacters();
        showToast('Character updated', 'success');
        closeModal('character-modal');
      });
    }
  });
}

async function deleteCharacter() {
  if (!currentEditingCharacter) return;
  const confirmed = await showDialog({
    title: 'Delete Character',
    message: `Delete "${currentEditingCharacter.name}"? This cannot be undone.`,
    confirmText: 'Delete',
    confirmClass: 'btn-danger'
  });
  if (!confirmed) return;

  chrome.storage.sync.get(STORAGE_KEYS.characters, (result) => {
    const characters = (result[STORAGE_KEYS.characters] || [])
      .filter(c => c.id !== currentEditingCharacter.id);
    
    chrome.storage.sync.set({ [STORAGE_KEYS.characters]: characters }, () => {
      loadCharacters();
      showToast('Character deleted', 'success');
      closeModal('character-modal');
    });
  });
}

// ============================================
// MODALS
// ============================================

function initModals() {
  // Close buttons
  document.querySelectorAll('.modal-close, [id$="-cancel"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-backdrop');
      if (modal) closeModal(modal.id);
    });
  });

  // Backdrop click to close (exclude dialog-modal since its Promise handles its own cleanup)
  document.querySelectorAll('.modal-backdrop:not(#dialog-modal)').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  // Preset modal
  document.getElementById('modal-save')?.addEventListener('click', savePresetChanges);
  
  // Checkbox toggles for textareas
  ['ai', 'essentials', 'note'].forEach(type => {
    document.getElementById(`modal-check-${type}`)?.addEventListener('change', updateTextareaStates);
  });

  // Save modal
  document.getElementById('save-modal-confirm')?.addEventListener('click', saveNewPreset);

  // Character modal
  document.getElementById('character-modal-save')?.addEventListener('click', saveCharacterChanges);
  document.getElementById('character-delete-btn')?.addEventListener('click', deleteCharacter);
  document.getElementById('add-field-btn')?.addEventListener('click', addCharacterField);
  
  document.getElementById('new-field-value')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCharacterField();
  });
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  
  if (id === 'preset-modal') currentEditingPreset = null;
  if (id === 'character-modal') currentEditingCharacter = null;
}

// ============================================
// REUSABLE DIALOG (replaces alert/confirm/prompt)
// ============================================

/**
 * Show a dialog modal that replaces native alert/confirm/prompt.
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message
 * @param {string} [options.confirmText='Confirm'] - Confirm button text
 * @param {string} [options.cancelText='Cancel'] - Cancel button text
 * @param {string} [options.confirmClass='btn-primary'] - CSS class for confirm button
 * @param {string} [options.inputPlaceholder] - If set, shows an input field (prompt mode)
 * @param {string} [options.inputValue=''] - Default value for the input field
 * @returns {Promise<boolean|string|null>} true/false for confirm, string/null for prompt
 */
function showDialog(options = {}) {
  return new Promise((resolve) => {
    const {
      title = 'Confirm',
      message = '',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      confirmClass = 'btn-primary',
      inputPlaceholder,
      inputValue = ''
    } = options;
    
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const inputEl = document.getElementById('dialog-input');
    const confirmBtn = document.getElementById('dialog-confirm');
    const cancelBtn = document.getElementById('dialog-cancel');
    
    // Set content
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (confirmBtn) {
      confirmBtn.textContent = confirmText;
      confirmBtn.className = `btn ${confirmClass} btn-sm`;
    }
    if (cancelBtn) cancelBtn.textContent = cancelText;
    
    // Prompt mode: show input field
    const isPrompt = inputPlaceholder !== undefined;
    if (inputEl) {
      inputEl.style.display = isPrompt ? 'block' : 'none';
      inputEl.value = inputValue;
      if (isPrompt) inputEl.placeholder = inputPlaceholder;
    }
    
    // Backdrop element for click-outside-to-cancel
    const backdropEl = document.getElementById('dialog-modal');
    
    // Cleanup function to remove listeners and close
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      closeModal('dialog-modal');
      confirmBtn?.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
      backdropEl?.removeEventListener('click', onBackdropClick);
      document.removeEventListener('keydown', onKeydown);
    };
    
    const onConfirm = () => {
      cleanup();
      if (isPrompt) {
        const val = inputEl?.value?.trim();
        resolve(val || null);
      } else {
        resolve(true);
      }
    };
    
    const onCancel = () => {
      cleanup();
      resolve(isPrompt ? null : false);
    };
    
    const onBackdropClick = (e) => {
      if (e.target === backdropEl) onCancel();
    };
    
    const onKeydown = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    
    confirmBtn?.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);
    backdropEl?.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeydown);
    
    openModal('dialog-modal');
    
    // Focus the input in prompt mode, otherwise focus confirm button
    if (isPrompt && inputEl) {
      setTimeout(() => inputEl.focus(), 100);
    } else {
      setTimeout(() => confirmBtn?.focus(), 100);
    }
  });
}

// ============================================
// TUTORIAL
// ============================================

let tutorialService = null;

async function initTutorial() {
  if (typeof TutorialService === 'undefined') return;

  tutorialService = new TutorialService();
  await tutorialService.init();

  tutorialService.onStepChange = handleTutorialStep;
  tutorialService.onComplete = handleTutorialComplete;
  tutorialService.onExit = handleTutorialExit;

  setupTutorialHandlers();

  if (tutorialService.shouldShowWelcome()) {
    showTutorialBanner();
  }
}

function setupTutorialHandlers() {
  document.getElementById('tutorial-help-btn')?.addEventListener('click', startTutorial);
  document.getElementById('tutorial-banner-start')?.addEventListener('click', () => {
    hideTutorialBanner();
    startTutorial();
  });
  document.getElementById('tutorial-banner-dismiss')?.addEventListener('click', () => {
    hideTutorialBanner();
    tutorialService?.markSeenWelcome();
  });
  document.getElementById('tutorial-next')?.addEventListener('click', () => tutorialService?.next());
  document.getElementById('tutorial-prev')?.addEventListener('click', () => tutorialService?.previous());
  document.getElementById('tutorial-skip')?.addEventListener('click', exitTutorial);
  
  document.getElementById('tutorial-modal-primary')?.addEventListener('click', () => {
    // Check if we're on the completion modal (shown after all steps)
    const modalTitle = document.getElementById('tutorial-modal-title')?.textContent;
    const completionModal = tutorialService?.getCompletionModal();
    
    if (completionModal && modalTitle === completionModal.title) {
      // This is the completion modal - finish up
      closeTutorialModal();
      switchToTab('features');
    } else {
      // Regular step modal - proceed to next
      closeTutorialModal();
      tutorialService?.next();
    }
  });
  
  document.getElementById('tutorial-modal-secondary')?.addEventListener('click', () => {
    closeTutorialModal();
    exitTutorial();
  });

  document.getElementById('tutorial-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'tutorial-overlay') tutorialService?.next();
  });
}

function showTutorialBanner() {
  const banner = document.getElementById('tutorial-welcome-banner');
  const main = document.querySelector('.main');
  if (banner && main) {
    banner.classList.remove('hidden');
    main.insertBefore(banner, main.firstChild);
  }
}

function hideTutorialBanner() {
  document.getElementById('tutorial-welcome-banner')?.classList.add('hidden');
}

function startTutorial() {
  if (!tutorialService) return;
  hideTutorialBanner();
  // Always start on Features tab to ensure tutorial elements are visible
  switchToTab('features');
  tutorialService.start();
}

function exitTutorial() {
  tutorialService?.exit();
}

let previouslyExpandedCard = null;

function handleTutorialStep(step, currentIndex, totalSteps) {
  if (!step) return;
  cleanupTutorialStep();

  if (step.type === 'modal') {
    showTutorialModal(step);
  } else if (step.type === 'spotlight') {
    if (step.action === 'switchTab') {
      switchToTab(step.actionTarget);
      setTimeout(() => showSpotlight(step, currentIndex, totalSteps), 100);
    } else {
      showSpotlight(step, currentIndex, totalSteps);
    }
  }
}

function showTutorialModal(step) {
  const modal = document.getElementById('tutorial-modal');
  if (!modal) return;

  document.getElementById('tutorial-modal-icon').innerHTML = `<span class="${step.icon || 'icon-sparkles'}"></span>`;
  document.getElementById('tutorial-modal-title').textContent = step.title;
  document.getElementById('tutorial-modal-text').textContent = step.content;

  const primaryBtn = document.getElementById('tutorial-modal-primary');
  const secondaryBtn = document.getElementById('tutorial-modal-secondary');

  if (step.isComplete) {
    primaryBtn.textContent = 'Got It!';
    secondaryBtn.style.display = 'none';
  } else {
    primaryBtn.textContent = 'Start Tour';
    secondaryBtn.style.display = 'block';
    secondaryBtn.textContent = 'Maybe Later';
  }

  modal.classList.add('visible');
}

function closeTutorialModal() {
  document.getElementById('tutorial-modal')?.classList.remove('visible');
}

function showSpotlight(step, currentIndex, totalSteps) {
  const target = document.querySelector(step.target);
  if (!target) {
    tutorialService?.next();
    return;
  }

  const overlay = document.getElementById('tutorial-overlay');
  const spotlight = document.getElementById('tutorial-spotlight');
  const tooltip = document.getElementById('tutorial-tooltip');
  if (!overlay || !spotlight || !tooltip) return;

  // Expand card if needed
  if (step.expandCard) {
    const card = target.closest('.feature-card') || target;
    if (card && !card.classList.contains('expanded')) {
      previouslyExpandedCard = card;
      card.classList.add('expanded');
    }
  }

  // Scroll with extra space for tooltip (scroll to start to leave room below)
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });

  setTimeout(() => {
    const rect = target.getBoundingClientRect();
    const padding = 8;
    const tooltipHeight = 150; // Approximate tooltip height
    const viewportHeight = window.innerHeight;
    
    // If target is too close to bottom, scroll up more to make room for tooltip
    if (rect.bottom + tooltipHeight + 32 > viewportHeight) {
      const main = document.querySelector('.main');
      if (main) {
        main.scrollTop = Math.max(0, main.scrollTop - (rect.bottom + tooltipHeight + 32 - viewportHeight));
      }
    }

    // Re-get rect after potential scroll adjustment
    const finalRect = target.getBoundingClientRect();

    spotlight.style.left = `${finalRect.left - padding}px`;
    spotlight.style.top = `${finalRect.top - padding}px`;
    spotlight.style.width = `${finalRect.width + padding * 2}px`;
    spotlight.style.height = `${finalRect.height + padding * 2}px`;

    target.classList.add('tutorial-highlighted');
    overlay.classList.add('active');

    positionTooltip(tooltip, finalRect, step.position || 'bottom');
    updateTooltipContent(step, currentIndex, totalSteps);

    setTimeout(() => tooltip.classList.add('visible'), 200);
  }, 300);
}

function positionTooltip(tooltip, targetRect, position) {
  const width = 260;
  const gap = 16;
  const padding = 16;
  const tooltipHeight = tooltip.offsetHeight || 150; // Estimate if not yet rendered
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  
  let left, top;
  let actualPosition = position;

  // Calculate positions for both top and bottom
  const bottomTop = targetRect.bottom + gap;
  const topTop = targetRect.top - gap - tooltipHeight;
  
  // Check if preferred position would clip, and flip if needed
  if (position === 'bottom' && bottomTop + tooltipHeight > viewportHeight - padding) {
    // Would clip at bottom, try top instead
    if (topTop >= padding) {
      actualPosition = 'top';
    }
  } else if (position === 'top' && topTop < padding) {
    // Would clip at top, try bottom instead
    if (bottomTop + tooltipHeight <= viewportHeight - padding) {
      actualPosition = 'bottom';
    }
  }

  tooltip.setAttribute('data-position', actualPosition);

  switch (actualPosition) {
    case 'top':
      left = targetRect.left + (targetRect.width / 2) - (width / 2);
      top = targetRect.top - gap - tooltipHeight;
      break;
    case 'bottom':
    default:
      left = targetRect.left + (targetRect.width / 2) - (width / 2);
      top = targetRect.bottom + gap;
      break;
  }

  // Constrain to viewport
  left = Math.max(padding, Math.min(left, viewportWidth - width - padding));
  top = Math.max(padding, Math.min(top, viewportHeight - tooltipHeight - padding));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function updateTooltipContent(step, currentIndex, totalSteps) {
  document.getElementById('tutorial-tooltip-title').textContent = step.title;
  document.getElementById('tutorial-tooltip-content').textContent = step.content;

  const progress = ((currentIndex + 1) / totalSteps) * 100;
  document.getElementById('tutorial-progress-fill').style.width = `${progress}%`;
  document.getElementById('tutorial-progress-text').textContent = `${currentIndex + 1}/${totalSteps}`;

  const prevBtn = document.getElementById('tutorial-prev');
  const nextBtn = document.getElementById('tutorial-next');
  
  if (prevBtn) prevBtn.style.display = currentIndex > 1 ? 'block' : 'none';
  if (nextBtn) nextBtn.textContent = currentIndex === totalSteps - 2 ? 'Finish' : 'Next';
}

function cleanupTutorialStep() {
  document.getElementById('tutorial-overlay')?.classList.remove('active');
  document.getElementById('tutorial-tooltip')?.classList.remove('visible');
  document.querySelectorAll('.tutorial-highlighted').forEach(el => el.classList.remove('tutorial-highlighted'));

  if (previouslyExpandedCard) {
    previouslyExpandedCard.classList.remove('expanded');
    previouslyExpandedCard = null;
  }
}

function switchToTab(tabName) {
  document.querySelector(`[data-tab="${tabName}"]`)?.click();
}

function handleTutorialComplete(completionModal) {
  cleanupTutorialStep();
  
  // If completion modal data is provided, show it
  if (completionModal) {
    showTutorialModal({ ...completionModal, isComplete: true });
  } else {
    closeTutorialModal();
    switchToTab('features');
  }
}

function handleTutorialExit() {
  cleanupTutorialStep();
  closeTutorialModal();
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function notifyContentScript(type, data = {}) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id && tab.url?.includes('aidungeon.com')) {
      chrome.tabs.sendMessage(tab.id, { type, ...data }).catch(() => {});
    }
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Setup profile links
document.querySelectorAll('.feature-credit a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: link.href });
  });
});

