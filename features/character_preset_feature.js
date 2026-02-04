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
    this.isProcessing = false;
    this.hasAutoFilled = false; // Track if we already auto-filled current field
    this.scenarioSessionUrl = null; // Track the scenario URL to detect new scenarios
    this.isFirstFieldOfScenario = true; // Track if this is the first field we've seen
    this.debug = false;
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
    this.removeOverlay();
    this.removeSaveButton();
    this.removeCharacterIndicator();
    this.sessionCharacterId = null;
  }

  removeSaveButton() {
    if (this.saveButtonElement) {
      this.saveButtonElement.classList.remove('bd-save-visible');
      const el = this.saveButtonElement;
      this.saveButtonElement = null;
      setTimeout(() => el?.remove(), 200);
    }
    document.querySelectorAll('.bd-save-continue-wrapper').forEach(el => el.remove());
  }

  startPolling() {
    // Poll every 500ms as a fallback for detection
    this.checkInterval = setInterval(() => {
      this.checkForEntryField();
    }, 500);
  }

  // ============================================
  // STORAGE OPERATIONS
  // ============================================

  async loadPresets() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve(this.presets);
          return;
        }
        chrome.storage.sync.get(this.storageKey, (result) => {
          if (chrome.runtime.lastError) {
            resolve(this.presets);
            return;
          }
          this.presets = result[this.storageKey] || [];
          resolve(this.presets);
        });
      } catch (e) {
        resolve(this.presets);
      }
    });
  }

  async savePresets() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve();
          return;
        }
        chrome.storage.sync.set({ [this.storageKey]: this.presets }, () => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  async loadActivePreset() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve(this.activePresetId);
          return;
        }
        chrome.storage.sync.get(this.activePresetKey, (result) => {
          if (chrome.runtime.lastError) {
            resolve(this.activePresetId);
            return;
          }
          this.activePresetId = result[this.activePresetKey] || null;
          resolve(this.activePresetId);
        });
      } catch (e) {
        resolve(this.activePresetId);
      }
    });
  }

  async setActivePreset(presetId) {
    this.activePresetId = presetId;
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve();
          return;
        }
        chrome.storage.sync.set({ [this.activePresetKey]: presetId }, () => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  async loadSessionCharacter() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve(this.sessionCharacterId);
          return;
        }
        chrome.storage.local.get(this.sessionCharacterKey, (result) => {
          if (chrome.runtime.lastError) {
            resolve(this.sessionCharacterId);
            return;
          }
          this.sessionCharacterId = result[this.sessionCharacterKey] || null;
          resolve(this.sessionCharacterId);
        });
      } catch (e) {
        resolve(this.sessionCharacterId);
      }
    });
  }

  async setSessionCharacter(presetId) {
    this.sessionCharacterId = presetId;
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve();
          return;
        }
        chrome.storage.local.set({ [this.sessionCharacterKey]: presetId }, () => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  // ============================================
  // SCENARIO SESSION TRACKING
  // ============================================

  async loadScenarioSession() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve();
          return;
        }
        chrome.storage.local.get('betterDungeon_scenarioSession', (result) => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          const session = result['betterDungeon_scenarioSession'];
          if (session) {
            this.scenarioSessionUrl = session.url;
            this.isFirstFieldOfScenario = session.isFirstField !== false;
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  async saveScenarioSession() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve();
          return;
        }
        const session = {
          url: this.scenarioSessionUrl,
          isFirstField: this.isFirstFieldOfScenario
        };
        chrome.storage.local.set({ 'betterDungeon_scenarioSession': session }, () => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
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
    this.isFirstFieldOfScenario = true;
    await this.setSessionCharacter(null);
    await this.saveScenarioSession();
  }

  async markFirstFieldHandled() {
    this.isFirstFieldOfScenario = false;
    await this.saveScenarioSession();
  }

  async createPreset(name) {
    const preset = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
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
    // Simple check: key is exactly "name" or ends with "_name" or contains "your_name"
    return fieldKey === 'name' || 
           fieldKey.endsWith('_name') || 
           fieldKey.includes('your_name') ||
           fieldKey.includes('characters_name');
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
          this.checkForEntryField();
          break;
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  findScenarioEntryField() {
    const input = document.getElementById('full-screen-text-input');
    if (!input) return null;

    // Check if this is a scenario entry field by looking at its context
    // The input should have an aria-label describing what it's asking for
    const ariaLabel = input.getAttribute('aria-label');
    if (!ariaLabel) return null;

    // Look for the question/prompt text - first try h1, then fall back to aria-label
    let questionText = ariaLabel;
    
    // Try to find a heading that describes the field
    const headings = document.querySelectorAll('h1, h2, [role="heading"]');
    for (const heading of headings) {
      const text = heading.textContent?.trim();
      // Skip if it looks like a page title or navigation
      if (text && text.length > 0 && text.length < 100 && !text.includes('AI Dungeon')) {
        questionText = text;
        break;
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
    const field = this.findScenarioEntryField();
    
    if (field) {
      const fieldId = field.ariaLabel;
      
      // Check if this is a new field
      if (this.currentFieldLabel !== fieldId) {
        this.currentFieldLabel = fieldId;
        this.currentFieldKey = field.fieldKey;
        this.hasAutoFilled = false;
        
        // Clean up previous UI
        this.removeOverlay();
        this.removeSaveButton();
        
        // Determine what to show based on the field type and state
        await this.handleField(field);
      }
    } else {
      if (this.currentFieldLabel !== null) {
        this.currentFieldLabel = null;
        this.currentFieldKey = null;
        this.hasAutoFilled = false;
        this.removeOverlay();
        this.removeSaveButton();
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
    
    // Determine if we should show the character selector
    // Show it if: it's a name field, OR it's the first field of a scenario with no character selected
    const shouldShowSelector = isNameField || (this.isFirstFieldOfScenario && !sessionCharacter);
    
    if (shouldShowSelector) {
      if (isNameField) {
        // Name field always resets the session (user might want to switch characters)
        await this.setSessionCharacter(null);
      }
      this.removeCharacterIndicator();
      
      // Show character selector overlay
      await this.showCharacterSelectorOverlay(field);
      
      // Mark that we've shown the selector for first field
      if (this.isFirstFieldOfScenario) {
        await this.markFirstFieldHandled();
      }
    } else if (sessionCharacter) {
      // We have a session character - show indicator and handle auto-fill
      this.showCharacterIndicator(field, sessionCharacter);
      
      // Look up saved value for this field
      const savedValue = this.lookupFieldValue(sessionCharacter, field.ariaLabel);
      
      if (savedValue !== undefined && savedValue !== '') {
        // We have a saved value - auto-fill it
        this.autoFillField(field, savedValue);
      } else {
        // No saved value - show "Save & Continue" button
        this.showSaveAndContinueButton(field);
      }
      
      // Mark first field as handled
      if (this.isFirstFieldOfScenario) {
        await this.markFirstFieldHandled();
      }
    } else {
      // No session character and not first field - show nothing special
      // but mark first field as handled so we don't keep asking
      if (this.isFirstFieldOfScenario) {
        await this.markFirstFieldHandled();
      }
    }
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
    const inputContainer = field.input.closest('div[class*="css-175oi2r"]')?.parentElement;
    if (!inputContainer) {
      return;
    }
    
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'bd-character-selector';
    this.overlayElement.innerHTML = this.buildCharacterSelectorHTML();
    
    // Insert below the input
    inputContainer.appendChild(this.overlayElement);
    
    requestAnimationFrame(() => {
      this.overlayElement.classList.add('bd-selector-visible');
    });
    
    this.setupCharacterSelectorHandlers(field);
    
  }

  buildCharacterSelectorHTML() {
    const hasPresets = this.presets.length > 0;
    
    if (hasPresets) {
      // Auto-select if we have a session character (e.g., just created one)
      const options = this.presets.map(p => {
        const isSelected = this.sessionCharacterId === p.id;
        return `<option value="${p.id}"${isSelected ? ' selected' : ''}>${this.escapeHtml(p.name)}</option>`;
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
            ${options.replace(/<option/g, '<option style="background: var(--bd-bg-secondary); color: var(--bd-text-primary);"') }
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
    const currentValue = field.input.value?.trim();
    const name = currentValue || prompt('Enter character name:');
    
    if (!name) return;
    
    if (!currentValue) {
      // Use typewriter effect to properly trigger Continue button
      await this.typewriterFill(field.input, name);
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
    
    // Find the Continue button
    const continueBtn = this.findContinueButton();
    if (!continueBtn) {
      return;
    }
    
    // Find the container that holds the Continue button
    const continueBtnWrapper = continueBtn.closest('div[class*="css-175oi2r"]');
    if (!continueBtnWrapper) return;
    
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
    
    // Insert after the Continue button wrapper
    continueBtnWrapper.parentElement.insertBefore(this.saveButtonElement, continueBtnWrapper.nextSibling);
    
    requestAnimationFrame(() => {
      this.saveButtonElement.classList.add('bd-save-visible');
    });
    
    // Setup click handler
    const saveBtn = this.saveButtonElement.querySelector('#bd-save-continue');
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.saveFieldAndContinue(field, continueBtn);
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
    if (this.overlayElement) {
      this.overlayElement.classList.remove('bd-selector-visible');
      const el = this.overlayElement;
      this.overlayElement = null;
      setTimeout(() => el?.remove(), 200);
    }
    document.querySelectorAll('.bd-character-selector').forEach(el => el.remove());
  }

  // ============================================
  // UI - ACTIVE CHARACTER INDICATOR
  // ============================================

  showCharacterIndicator(field, character) {
    this.removeCharacterIndicator();
    
    // Find the input container
    const inputContainer = field.input.closest('div[class*="css-175oi2r"]')?.parentElement;
    if (!inputContainer) return;
    
    this.characterIndicator = document.createElement('div');
    this.characterIndicator.className = 'bd-character-indicator';
    this.characterIndicator.innerHTML = `
      <div class="bd-indicator-content" style="
        font-family: var(--bd-font-family-primary);
        font-size: var(--bd-font-size-sm);
        color: var(--bd-text-secondary);
        background: var(--bd-bg-tertiary);
        border: 1px solid var(--bd-border-default);
        border-radius: var(--bd-radius-md);
        padding: var(--bd-space-1) var(--bd-space-3);
        display: inline-flex;
        align-items: center;
        gap: var(--bd-space-2);
        margin-top: var(--bd-space-2);
      ">
        <span style="color: var(--bd-brand-primary);">●</span>
        <span>Playing as <strong style="color: var(--bd-text-primary);">${this.escapeHtml(character.name)}</strong></span>
      </div>
    `;
    
    inputContainer.appendChild(this.characterIndicator);
    
    requestAnimationFrame(() => {
      this.characterIndicator?.classList.add('bd-indicator-visible');
    });
  }

  removeCharacterIndicator() {
    if (this.characterIndicator) {
      this.characterIndicator.classList.remove('bd-indicator-visible');
      const el = this.characterIndicator;
      this.characterIndicator = null;
      setTimeout(() => el?.remove(), 200);
    }
    document.querySelectorAll('.bd-character-indicator').forEach(el => el.remove());
  }

  // ============================================
  // AUTO-FILL LOGIC
  // ============================================

  autoFillField(field, savedValue) {
    if (this.hasAutoFilled) return; // Prevent double auto-fill
    
    if (savedValue === undefined || savedValue === '') {
      return;
    }

    this.hasAutoFilled = true;
    this.isProcessing = true;
    
    // Use typewriter effect to properly trigger React state updates
    // This ensures the Continue button appears correctly
    this.typewriterFill(field.input, savedValue).then(() => {
      this.showToast(`Auto-filled: ${this.truncate(savedValue, 25)}`, 'success');
      
      // Wait a moment then click Continue
      setTimeout(() => {
        const continueBtn = this.findContinueButton();
        if (continueBtn) {
          continueBtn.click();
        }
        this.isProcessing = false;
      }, 300);
    });
  }
  
  typewriterFill(input, text, charDelay = 15) {
    return new Promise((resolve) => {
      // Clear any existing content first
      input.value = '';
      input.focus();
      
      const characters = text.split('');
      let currentIndex = 0;
      
      const typeNextChar = () => {
        if (currentIndex >= characters.length) {
          // Typing complete - dispatch final events
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          resolve();
          return;
        }
        
        const char = characters[currentIndex];
        
        // Simulate keydown event
        const keydownEvent = new KeyboardEvent('keydown', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          charCode: char.charCodeAt(0),
          keyCode: char.charCodeAt(0),
          which: char.charCodeAt(0),
          bubbles: true,
          cancelable: true
        });
        input.dispatchEvent(keydownEvent);
        
        // Add character to input value
        input.value += char;
        
        // Simulate input event (critical for React)
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char
        });
        input.dispatchEvent(inputEvent);
        
        // Simulate keyup event
        const keyupEvent = new KeyboardEvent('keyup', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          charCode: char.charCodeAt(0),
          keyCode: char.charCodeAt(0),
          which: char.charCodeAt(0),
          bubbles: true,
          cancelable: true
        });
        input.dispatchEvent(keyupEvent);
        
        currentIndex++;
        setTimeout(typeNextChar, charDelay);
      };
      
      // Start typing
      typeNextChar();
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
