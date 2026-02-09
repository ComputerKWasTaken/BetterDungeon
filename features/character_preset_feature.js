// BetterDungeon - Character Preset Feature
// Allows users to save character presets and auto-fill scenario entry fields

class CharacterPresetFeature {
  static id = 'characterPreset';

  constructor() {
    this.observer = null;
    this.checkInterval = null;
    this.storageKey = 'betterDungeon_characterPresets';
    this.activePresetKey = 'betterDungeon_activeCharacterPreset';
    this.sessionCharacterKey = 'betterDungeon_sessionCharacter';
    this.presets = [];
    this.activePresetId = null;
    this.sessionCharacterId = null; // The character selected for THIS scenario session
    this.currentFieldKey = null;
    this.currentFieldLabel = null;
    this.overlayElement = null;
    this.saveButtonElement = null;
    this.characterIndicator = null;
    this.approvalElement = null;
    this.isProcessing = false;
    this.hasAutoFilled = false; // Track if we already auto-filled current field
    this.scenarioSessionUrl = null; // Track the scenario URL to detect new scenarios
    this.debug = false;
    this._checkDebounceTimer = null; // Debounce timer for checkForEntryField
    this._fieldGraceTimer = null; // Grace period before tearing down UI when field disappears
    this._indicatorCharacterId = null; // Track which character the indicator is showing
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  async init() {
    console.log('[CharacterPreset] Initializing Character Presets feature...');
    await this.loadPresets();
    await this.loadActivePreset();
    await this.loadSessionCharacter();
    await this.loadScenarioSession();
    this.setupObserver();
    this.startPolling();
    this.checkForEntryField();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this._checkDebounceTimer) {
      clearTimeout(this._checkDebounceTimer);
      this._checkDebounceTimer = null;
    }
    if (this._fieldGraceTimer) {
      clearTimeout(this._fieldGraceTimer);
      this._fieldGraceTimer = null;
    }
    this.removeOverlay();
    this.removeSaveButton();
    this.removeCharacterIndicator();
    this.removeApproval();
    this.sessionCharacterId = null;
  }

  // Shared helper: fade out a tracked UI element, null the reference, then
  // remove it from the DOM after the CSS transition and sweep any orphans.
  _removeUIElement(refName, visibleClass, sweepSelector) {
    const el = this[refName];
    if (el) {
      el.classList.remove(visibleClass);
      this[refName] = null;
      setTimeout(() => {
        el?.remove();
        // Sweep orphans, but protect any freshly-created element now tracked by this ref
        const current = this[refName];
        document.querySelectorAll(sweepSelector).forEach(e => {
          if (e !== current) e.remove();
        });
      }, 300); // Match CSS transition duration (0.3s)
    } else {
      document.querySelectorAll(sweepSelector).forEach(e => e.remove());
    }
  }

  removeSaveButton() {
    this._removeUIElement('saveButtonElement', 'bd-save-visible', '.bd-save-continue-wrapper');
  }

  startPolling() {
    // Poll every 500ms as a fallback for detection
    this.checkInterval = setInterval(() => {
      this.debouncedCheck();
    }, 500);
  }

  // Debounce checkForEntryField to avoid excessive calls from MutationObserver
  debouncedCheck() {
    if (this._checkDebounceTimer) return;
    this._checkDebounceTimer = setTimeout(() => {
      this._checkDebounceTimer = null;
      this.checkForEntryField();
    }, 250);
  }

  // ============================================
  // STORAGE OPERATIONS
  // ============================================

  // Generic chrome storage get — returns the value for `key`, or `fallback` on any error.
  _chromeGet(area, key, fallback = null) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) { resolve(fallback); return; }
        chrome.storage[area].get(key, (result) => {
          resolve(chrome.runtime.lastError ? fallback : (result[key] ?? fallback));
        });
      } catch { resolve(fallback); }
    });
  }

  // Generic chrome storage set — silently resolves on error.
  _chromeSet(area, data) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) { resolve(); return; }
        chrome.storage[area].set(data, () => resolve());
      } catch { resolve(); }
    });
  }

  async loadPresets() {
    this.presets = await this._chromeGet('sync', this.storageKey, []);
    return this.presets;
  }

  async savePresets() {
    await this._chromeSet('sync', { [this.storageKey]: this.presets });
  }

  async loadActivePreset() {
    this.activePresetId = await this._chromeGet('sync', this.activePresetKey, null);
    return this.activePresetId;
  }

  async setActivePreset(presetId) {
    this.activePresetId = presetId;
    await this._chromeSet('sync', { [this.activePresetKey]: presetId });
  }

  async loadSessionCharacter() {
    this.sessionCharacterId = await this._chromeGet('local', this.sessionCharacterKey, null);
    return this.sessionCharacterId;
  }

  async setSessionCharacter(presetId) {
    this.sessionCharacterId = presetId;
    await this._chromeSet('local', { [this.sessionCharacterKey]: presetId });
  }

  // ============================================
  // SCENARIO SESSION TRACKING
  // ============================================

  async loadScenarioSession() {
    const session = await this._chromeGet('local', 'betterDungeon_scenarioSession', null);
    if (session) this.scenarioSessionUrl = session.url;
  }

  async saveScenarioSession() {
    await this._chromeSet('local', {
      'betterDungeon_scenarioSession': { url: this.scenarioSessionUrl }
    });
  }

  isNewScenario() {
    const currentUrl = window.location.href;
    // Check if URL has changed (different scenario)
    if (this.scenarioSessionUrl !== currentUrl) {
      return true;
    }
    return false;
  }

  async startNewScenarioSession() {
    this.scenarioSessionUrl = window.location.href;
    await this.setSessionCharacter(null);
    await this.saveScenarioSession();
  }

  async createPreset(name) {
    const preset = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      name: name,
      fields: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.presets.unshift(preset);
    await this.savePresets();
    return preset;
  }

  async updatePresetField(presetId, fieldKey, value) {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return null;
    
    preset.fields[fieldKey] = value;
    preset.updatedAt = Date.now();
    
    await this.savePresets();
    return preset;
  }

  async updatePreset(id, updates) {
    const index = this.presets.findIndex(p => p.id === id);
    if (index === -1) return null;
    
    this.presets[index] = {
      ...this.presets[index],
      ...updates,
      updatedAt: Date.now()
    };
    
    await this.savePresets();
    return this.presets[index];
  }

  async deletePreset(id) {
    const index = this.presets.findIndex(p => p.id === id);
    if (index === -1) return false;
    
    this.presets.splice(index, 1);
    
    if (this.activePresetId === id) {
      this.activePresetId = null;
      await this.setActivePreset(null);
    }
    
    await this.savePresets();
    return true;
  }

  getActivePreset() {
    if (!this.activePresetId) return null;
    return this.presets.find(p => p.id === this.activePresetId) || null;
  }

  // ============================================
  // FIELD KEY NORMALIZATION
  // ============================================
  // Simple approach: sanitize the question label and use it as the field key.
  // Same question = same key = auto-filled. Different question = different key.

  // Normalize a label into a consistent field key
  normalizeFieldKey(label) {
    if (!label) return null;
    
    return label.toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')           // Remove (parenthetical content)
      .replace(/[?!.:;,"']/g, '')             // Remove punctuation
      .replace(/[^a-z0-9\s]/g, '')            // Remove special chars
      .trim()
      .replace(/\s+/g, '_');                  // Spaces to underscores
  }

  // Check if a field key looks like a "name" field
  isNameFieldKey(fieldKey) {
    if (!fieldKey) return false;
    // Check for "name" as a distinct word segment in the underscore-separated key
    // Matches: "name", "your_name", "characters_name", "character_name"
    // Avoids: "username", "rename", "filename", "unnamed"
    return fieldKey === 'name' || fieldKey.startsWith('name_') ||
           fieldKey.endsWith('_name') || fieldKey.includes('_name_');
  }

  // Look up a saved value for a field
  lookupFieldValue(preset, label) {
    if (!preset || !preset.fields) return undefined;
    
    const fieldKey = this.normalizeFieldKey(label);
    
    if (fieldKey && preset.fields[fieldKey] !== undefined) {
      this.log(`[CharacterPreset] Found match for "${fieldKey}"`);
      return preset.fields[fieldKey];
    }
    
    this.log(`[CharacterPreset] No match found for "${label}" (key: ${fieldKey})`);
    return undefined;
  }

  // ============================================
  // DOM DETECTION
  // ============================================

  setupObserver() {
    this.observer = new MutationObserver((mutations) => {
      if (this.isProcessing) return;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          this.debouncedCheck();
          break;
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Find a suitable parent container for injecting UI elements near the input.
  // Walks up the DOM from the input until it finds a layout boundary
  // (an ancestor whose parent has multiple children), rather than relying
  // on fragile CSS-in-JS class names that can change between builds.
  getFieldContainer(field) {
    if (!field?.input) return null;
    
    let el = field.input.parentElement;
    let depth = 0;
    
    while (el && el !== document.body && depth < 10) {
      // A layout boundary is reached when the parent has sibling elements,
      // meaning we've exited the single-child wrapper chain around the input.
      if (el.parentElement && el.parentElement.children.length > 1) {
        return el.parentElement;
      }
      el = el.parentElement;
      depth++;
    }
    
    // Fallback: two levels up from the input
    return field.input.parentElement?.parentElement || null;
  }

  findScenarioEntryField() {
    const input = document.getElementById('full-screen-text-input');
    if (!input) return null;

    // Check if this is a scenario entry field by looking at its context
    // The input should have an aria-label describing what it's asking for
    const ariaLabel = input.getAttribute('aria-label');
    if (!ariaLabel) return null;

    // Look for the question/prompt text - scope to the input's ancestor to avoid
    // picking up unrelated headings (e.g. story title in the nav bar).
    let questionText = ariaLabel;
    
    // Walk up from the input to find a reasonable ancestor to scope heading search
    const searchRoot = input.closest('[style*="max-width"]') || input.parentElement?.parentElement?.parentElement;
    if (searchRoot) {
      const headings = searchRoot.querySelectorAll('h1, h2, [role="heading"]');
      for (const heading of headings) {
        const text = heading.textContent?.trim();
        if (text && text.length > 0 && text.length < 100) {
          questionText = text;
          break;
        }
      }
    }

    return {
      input: input,
      label: questionText,
      ariaLabel: ariaLabel,
      fieldKey: this.normalizeFieldKey(ariaLabel) // Use aria-label for key normalization
    };
  }

  async checkForEntryField() {
    if (this.isProcessing) return; // Don't re-detect fields mid-fill
    const field = this.findScenarioEntryField();
    
    if (field) {
      const fieldId = field.ariaLabel;
      
      // Field found — cancel any pending teardown grace timer
      if (this._fieldGraceTimer) {
        clearTimeout(this._fieldGraceTimer);
        this._fieldGraceTimer = null;
      }
      
      // Check if this is a new field
      if (this.currentFieldLabel !== fieldId) {
        this.currentFieldLabel = fieldId;
        this.currentFieldKey = field.fieldKey;
        this.hasAutoFilled = false;
        
        // Clean up previous UI
        this.removeOverlay();
        this.removeSaveButton();
        this.removeApproval();
        
        // Determine what to show based on the field type and state
        await this.handleField(field);
      }
    } else {
      // Field not found — use a grace period before tearing down UI.
      // React re-renders can cause the input to briefly disappear from the DOM.
      if (this.currentFieldLabel !== null && !this._fieldGraceTimer) {
        this._fieldGraceTimer = setTimeout(() => {
          this._fieldGraceTimer = null;
          // Re-check: if field is genuinely gone, tear down
          if (!this.findScenarioEntryField()) {
            this.currentFieldLabel = null;
            this.currentFieldKey = null;
            this.hasAutoFilled = false;
            this._indicatorCharacterId = null;
            this.removeOverlay();
            this.removeSaveButton();
            this.removeCharacterIndicator();
            this.removeApproval();
          }
        }, 400);
      }
    }
  }

  async handleField(field) {
    // Check if this is a name field
    const fieldKey = this.normalizeFieldKey(field.ariaLabel);
    const isNameField = this.isNameFieldKey(fieldKey);
    const sessionCharacter = this.getSessionCharacter();
    
    // Check if this is a new scenario (URL changed)
    if (this.isNewScenario()) {
      await this.startNewScenarioSession();
    }
    
    // Only show the character selector when we detect a name field
    if (isNameField) {
      // Name field resets the session (user might want to switch characters)
      await this.setSessionCharacter(null);
      this.removeCharacterIndicator();
      
      // Show character selector overlay
      await this.showCharacterSelectorOverlay(field);
    } else if (sessionCharacter) {
      // We have a session character - show indicator and handle auto-fill
      this.showCharacterIndicator(field, sessionCharacter);
      
      // Look up saved value for this field
      const savedValue = this.lookupFieldValue(sessionCharacter, field.ariaLabel);
      
      if (savedValue !== undefined && savedValue !== '') {
        // We have a saved value - show approval UI instead of auto-filling
        this.showAutoFillApproval(field, savedValue);
      } else {
        // No saved value - show "Save & Continue" button
        this.showSaveAndContinueButton(field);
      }
    }
    // If no session character and not a name field, show nothing
  }

  getSessionCharacter() {
    if (!this.sessionCharacterId) return null;
    return this.presets.find(p => p.id === this.sessionCharacterId) || null;
  }

  // ============================================
  // UI - CHARACTER SELECTOR (integrated into page)
  // ============================================

  async showCharacterSelectorOverlay(field) {
    this.removeOverlay();
    document.querySelectorAll('.bd-character-selector').forEach(el => el.remove());
    
    // Reload presets to ensure we have the latest
    await this.loadPresets();
    
    // Find the input container to place our selector near it
    const inputContainer = this.getFieldContainer(field);
    if (!inputContainer) {
      return;
    }
    
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'bd-character-selector';
    this.overlayElement.innerHTML = this.buildCharacterSelectorHTML();
    
    // Insert below the input
    inputContainer.appendChild(this.overlayElement);
    
    requestAnimationFrame(() => {
      this.overlayElement?.classList.add('bd-selector-visible');
    });
    
    this.setupCharacterSelectorHandlers(field);
    
  }

  buildCharacterSelectorHTML() {
    const hasPresets = this.presets.length > 0;
    
    if (hasPresets) {
      // Auto-select if we have a session character (e.g., just created one)
      const optionStyle = 'background: var(--bd-bg-secondary); color: var(--bd-text-primary);';
      const options = this.presets.map(p => {
        const isSelected = this.sessionCharacterId === p.id;
        return `<option value="${p.id}" style="${optionStyle}"${isSelected ? ' selected' : ''}>${this.escapeHtml(p.name)}</option>`;
      }).join('');
      
      return `
        <div class="bd-selector-row" style="font-family: var(--bd-font-family-primary);">
          <span class="bd-selector-label" style="color: var(--bd-text-secondary);">Character:</span>
          <select class="bd-selector-dropdown" id="bd-preset-selector" style="
            font-family: var(--bd-font-family-primary);
            color: var(--bd-text-primary);
            background: var(--bd-bg-elevated);
            border: 1px solid var(--bd-border-default);
            border-radius: var(--bd-radius-md);
          ">
            <option value="" style="background: var(--bd-bg-secondary); color: var(--bd-text-primary);">Select...</option>
            ${options}
          </select>
          <button class="bd-selector-add" id="bd-new-preset-btn" title="Create new character" style="
            color: var(--bd-text-secondary);
            background: var(--bd-bg-tertiary);
            border: 1px solid var(--bd-border-default);
            border-radius: var(--bd-radius-md);
          ">+</button>
        </div>
      `;
    } else {
      return `
        <div class="bd-selector-row" style="font-family: var(--bd-font-family-primary);">
          <button class="bd-selector-create" id="bd-new-preset-btn" style="
            font-family: var(--bd-font-family-primary);
            color: #fff;
            background: var(--bd-btn-primary-bg);
            border: none;
            border-radius: var(--bd-radius-md);
          ">
            <span>+ Create Character Preset</span>
          </button>
        </div>
      `;
    }
  }

  setupCharacterSelectorHandlers(field) {
    const selector = this.overlayElement.querySelector('#bd-preset-selector');
    const newPresetBtn = this.overlayElement.querySelector('#bd-new-preset-btn');

    if (selector) {
      selector.addEventListener('change', async (e) => {
        const presetId = e.target.value;
        if (presetId) {
          await this.setSessionCharacter(presetId);
          await this.setActivePreset(presetId);
          
          const character = this.getSessionCharacter();
          if (character) {
            const nameValue = character.fields.name || character.name;
            // Use typewriter effect to properly trigger Continue button
            this.typewriterFill(field.input, nameValue).then(() => {
              this.showToast(`Playing as ${character.name}`, 'success');
            });
          }
        } else {
          await this.setSessionCharacter(null);
        }
      });
    }

    if (newPresetBtn) {
      newPresetBtn.addEventListener('click', async () => {
        await this.createNewCharacterFromNameField(field);
      });
    }
  }

  async createNewCharacterFromNameField(field) {
    const name = field.input.value?.trim();
    
    // Require user to type a name in the field first
    if (!name) {
      this.showToast('Type a character name first', 'error');
      field.input.focus();
      return;
    }
    
    const preset = await this.createPreset(name);
    await this.updatePresetField(preset.id, 'name', name);
    
    await this.setSessionCharacter(preset.id);
    await this.setActivePreset(preset.id);
    
    this.showToast(`Created: ${name}`, 'success');
    this.showCharacterSelectorOverlay(field);
  }

  // ============================================
  // UI - SAVE & CONTINUE BUTTON (for new fields)
  // ============================================

  showSaveAndContinueButton(field) {
    this.removeSaveButton();
    
    const sessionCharacter = this.getSessionCharacter();
    if (!sessionCharacter) return;
    
    // Find the Continue button and the field container
    const continueBtn = this.findContinueButton();
    if (!continueBtn) {
      return;
    }
    
    // Walk up from the Continue button to find the wrapper that is a
    // direct child of the field container (avoids fragile CSS-in-JS selectors)
    const fieldContainer = this.getFieldContainer(field);
    if (!fieldContainer) return;
    
    let continueBtnWrapper = continueBtn;
    while (continueBtnWrapper && continueBtnWrapper.parentElement !== fieldContainer) {
      continueBtnWrapper = continueBtnWrapper.parentElement;
    }
    if (!continueBtnWrapper || continueBtnWrapper.parentElement !== fieldContainer) return;
    
    // Create Save & Continue button
    this.saveButtonElement = document.createElement('div');
    this.saveButtonElement.className = 'bd-save-continue-wrapper';
    this.saveButtonElement.innerHTML = `
      <button class="bd-save-continue-btn" id="bd-save-continue" title="Save to ${this.escapeHtml(sessionCharacter.name)} and continue" style="
        font-family: var(--bd-font-family-primary);
        font-size: var(--bd-font-size-md);
        font-weight: var(--bd-font-weight-medium);
        color: #fff;
        background: var(--bd-success);
        border: 1px solid var(--bd-success-border);
        border-radius: var(--bd-radius-lg);
        padding: var(--bd-space-3) var(--bd-space-6);
        cursor: pointer;
        transition: all var(--bd-transition-fast);
        display: flex;
        align-items: center;
        gap: var(--bd-space-2);
        box-shadow: var(--bd-shadow-md);
      ">
        <span style="font-size: 1.2em;">✓</span>
        <span>Save & Continue</span>
      </button>
    `;
    
    // Insert after the Continue button wrapper within the field container
    fieldContainer.insertBefore(this.saveButtonElement, continueBtnWrapper.nextSibling);
    
    requestAnimationFrame(() => {
      this.saveButtonElement?.classList.add('bd-save-visible');
    });
    
    // Setup click handler — re-query continueBtn at click time to avoid stale references
    const saveBtn = this.saveButtonElement.querySelector('#bd-save-continue');
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const freshContinueBtn = this.findContinueButton();
        if (freshContinueBtn) {
          await this.saveFieldAndContinue(field, freshContinueBtn);
        }
      });
    }
    
  }

  async saveFieldAndContinue(field, continueBtn) {
    const value = field.input.value?.trim();
    
    if (!value) {
      this.showToast('Enter a value first', 'error');
      return;
    }
    
    const sessionCharacter = this.getSessionCharacter();
    if (!sessionCharacter) {
      this.showToast('No character selected', 'error');
      return;
    }
    
    // Save the field value
    await this.saveField(sessionCharacter.id, field.ariaLabel, value);
    this.showToast(`Saved to ${sessionCharacter.name}`, 'success');
    this.removeSaveButton();
    
    // Click continue
    setTimeout(() => continueBtn.click(), 100);
  }

  // Save a field value under its normalized key
  async saveField(presetId, label, value) {
    const fieldKey = this.normalizeFieldKey(label);
    
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return null;
    
    if (fieldKey) {
      preset.fields[fieldKey] = value;
      this.log(`[CharacterPreset] Saved field: "${fieldKey}"`);
    }
    
    preset.updatedAt = Date.now();
    await this.savePresets();
    return preset;
  }

  // Delete a field from a character preset by its label
  async deleteField(presetId, label) {
    const fieldKey = this.normalizeFieldKey(label);
    
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset || !fieldKey) return null;
    
    if (preset.fields.hasOwnProperty(fieldKey)) {
      delete preset.fields[fieldKey];
      this.log(`[CharacterPreset] Deleted field: "${fieldKey}"`);
    }
    
    preset.updatedAt = Date.now();
    await this.savePresets();
    return preset;
  }

  findContinueButton() {
    // Look for a button containing "Continue" text
    const buttons = document.querySelectorAll('[role="button"], button');
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() || '';
      if (text.includes('continue')) {
        return btn;
      }
    }
    return null;
  }

  removeOverlay() {
    this._removeUIElement('overlayElement', 'bd-selector-visible', '.bd-character-selector');
  }

  // ============================================
  // UI - ACTIVE CHARACTER INDICATOR
  // ============================================

  showCharacterIndicator(field, character) {
    // Skip rebuild if already showing indicator for the same character
    if (this._indicatorCharacterId === character.id && this.characterIndicator?.isConnected) return;
    this.removeCharacterIndicator();
    this._indicatorCharacterId = character.id;
    
    // Find the input container
    const inputContainer = this.getFieldContainer(field);
    if (!inputContainer) return;
    
    this.characterIndicator = document.createElement('div');
    this.characterIndicator.className = 'bd-character-indicator';
    this.characterIndicator.innerHTML = `
      <div class="bd-indicator-content">
        <span style="color: var(--bd-accent-primary);">●</span>
        <span>Playing as <strong style="color: var(--bd-text-primary);">${this.escapeHtml(character.name)}</strong></span>
      </div>
    `;
    
    inputContainer.appendChild(this.characterIndicator);
    
    requestAnimationFrame(() => {
      this.characterIndicator?.classList.add('bd-indicator-visible');
    });
  }

  removeCharacterIndicator() {
    this._indicatorCharacterId = null;
    this._removeUIElement('characterIndicator', 'bd-indicator-visible', '.bd-character-indicator');
  }

  // ============================================
  // AUTO-FILL APPROVAL UI
  // ============================================

  showAutoFillApproval(field, savedValue) {
    if (this.hasAutoFilled) return; // Prevent showing approval twice for same field
    this.hasAutoFilled = true;
    this.removeApproval();
    
    const sessionCharacter = this.getSessionCharacter();
    if (!sessionCharacter) return;
    
    // Find the input container to place the approval near the input
    const inputContainer = this.getFieldContainer(field);
    if (!inputContainer) return;
    
    this.approvalElement = document.createElement('div');
    this.approvalElement.className = 'bd-autofill-approval';
    this.approvalElement.innerHTML = `
      <div class="bd-approval-content">
        <div class="bd-approval-header">
          <span style="color: var(--bd-accent-primary);">&#9679;</span>
          <span>Suggested answer from <strong style="color: var(--bd-text-primary);">${this.escapeHtml(sessionCharacter.name)}</strong>:</span>
        </div>
        <div class="bd-approval-value-container">
          <div class="bd-approval-value-display">${this.escapeHtml(savedValue)}</div>
        </div>
        <div class="bd-approval-actions">
          <button class="bd-approval-delete"><span>&#128465;</span> Forget</button>
          <button class="bd-approval-edit"><span>&#9998;</span> Edit</button>
          <button class="bd-approval-accept"><span>&#10003;</span> Use This</button>
        </div>
      </div>
    `;
    
    inputContainer.appendChild(this.approvalElement);
    
    requestAnimationFrame(() => {
      this.approvalElement?.classList.add('bd-approval-visible');
    });
    
    // Helper: fill the field with a value, then click Continue
    const fillAndContinue = async (value) => {
      if (this.isProcessing) return; // Guard against double-clicks
      this.removeApproval();
      this.isProcessing = true;
      
      try {
        // Re-query the input element to avoid stale DOM references
        const freshInput = document.getElementById('full-screen-text-input') || field.input;
        await this.typewriterFill(freshInput, value);
        this.showToast(`Filled: ${this.truncate(value, 25)}`, 'success');
        
        setTimeout(() => {
          const continueBtn = this.findContinueButton();
          if (continueBtn) continueBtn.click();
        }, 300);
      } catch (err) {
        this.showToast('Auto-fill failed', 'error');
      } finally {
        this.isProcessing = false;
      }
    };
    
    // Bind all button handlers (extracted so edit-cancel can re-bind after restoring HTML)
    this._bindApprovalHandlers(field, savedValue, sessionCharacter, fillAndContinue);
  }

  // Binds click handlers for Accept, Edit, and Forget buttons on the approval element.
  // Called both on initial render and after edit-cancel restores the original buttons.
  _bindApprovalHandlers(field, savedValue, sessionCharacter, fillAndContinue) {
    if (!this.approvalElement) return;
    
    // Use This button: fill the saved value and click Continue
    const acceptBtn = this.approvalElement.querySelector('.bd-approval-accept');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await fillAndContinue(savedValue);
      });
    }
    
    // Edit button: swap value display into an editable textarea, then fill + continue
    const editBtn = this.approvalElement.querySelector('.bd-approval-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.approvalElement) return;
        
        // Replace the static value display with an editable textarea
        const valueContainer = this.approvalElement.querySelector('.bd-approval-value-container');
        if (!valueContainer) return;
        
        valueContainer.innerHTML = `
          <textarea class="bd-approval-edit-textarea">${this.escapeHtml(savedValue)}</textarea>
        `;
        
        // Focus the textarea and select all text for easy editing
        const textarea = valueContainer.querySelector('.bd-approval-edit-textarea');
        if (textarea) {
          textarea.focus();
          textarea.select();
        }
        
        // Replace the action buttons with Cancel + Confirm
        const actionsContainer = this.approvalElement?.querySelector('.bd-approval-actions');
        if (!actionsContainer) return;
        
        actionsContainer.innerHTML = `
          <button class="bd-approval-cancel">Cancel</button>
          <button class="bd-approval-confirm"><span>&#10003;</span> Confirm</button>
        `;
        
        // Cancel: revert back to the original approval view in-place (no destroy/recreate)
        const cancelBtn = actionsContainer.querySelector('.bd-approval-cancel');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', (ce) => {
            ce.preventDefault();
            ce.stopPropagation();
            if (!this.approvalElement) return;
            
            // Restore original value display and buttons
            valueContainer.innerHTML = `<div class="bd-approval-value-display">${this.escapeHtml(savedValue)}</div>`;
            actionsContainer.innerHTML = `
              <button class="bd-approval-delete"><span>&#128465;</span> Forget</button>
              <button class="bd-approval-edit"><span>&#9998;</span> Edit</button>
              <button class="bd-approval-accept"><span>&#10003;</span> Use This</button>
            `;
            // Re-bind handlers on the restored buttons
            this._bindApprovalHandlers(field, savedValue, sessionCharacter, fillAndContinue);
          });
        }
        
        // Confirm: save edited value to preset, then fill + continue
        const confirmBtn = actionsContainer.querySelector('.bd-approval-confirm');
        if (confirmBtn) {
          confirmBtn.addEventListener('click', async (ce) => {
            ce.preventDefault();
            ce.stopPropagation();
            
            const editedValue = textarea?.value?.trim() || savedValue;
            
            // Save the edited value back to the character preset
            await this.saveField(sessionCharacter.id, field.ariaLabel, editedValue);
            
            await fillAndContinue(editedValue);
          });
        }
      });
    }
    
    // Forget button: delete this field from the preset and dismiss the approval UI
    const deleteBtn = this.approvalElement.querySelector('.bd-approval-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.approvalElement) return;
        this.hasAutoFilled = false; // Reset so the field can be re-detected if revisited
        this.removeApproval();
        
        // Delete the field key from the character preset
        await this.deleteField(sessionCharacter.id, field.ariaLabel);
        this.showToast(`Removed saved field from ${sessionCharacter.name}`, 'success');
      });
    }
  }

  removeApproval() {
    this._removeUIElement('approvalElement', 'bd-approval-visible', '.bd-autofill-approval');
  }
  
  typewriterFill(input, text) {
    return new Promise((resolve) => {
      input.focus();
      
      // Determine the correct native value setter based on the element type.
      // Using the wrong prototype's setter can fail to trigger React's synthetic events.
      const proto = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      
      if (!nativeSetter) {
        // Fallback: direct assignment if native setter is unavailable
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        resolve();
        return;
      }
      
      // Step 1: Simulate a single keystroke to trigger React's state update.
      // This makes the "Continue" button appear via React's change detection.
      const firstChar = text.charAt(0) || ' ';
      nativeSetter.call(input, firstChar);
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: firstChar
      }));
      
      // Step 2: Brief pause for React to process the state change and show Continue
      setTimeout(() => {
        // Now set the full text instantly using the native setter
        nativeSetter.call(input, text);
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        resolve();
      }, 50);
    });
  }

  // ============================================
  // API FOR POPUP
  // ============================================

  async getAllPresets() {
    await this.loadPresets();
    return this.presets;
  }

  async getPresetById(id) {
    await this.loadPresets();
    return this.presets.find(p => p.id === id) || null;
  }

  // ============================================
  // UTILITIES
  // ============================================

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  showToast(message, type = 'info') {
    const existingToast = document.querySelector('.bd-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `bd-toast bd-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('bd-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('bd-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.CharacterPresetFeature = CharacterPresetFeature;
}
