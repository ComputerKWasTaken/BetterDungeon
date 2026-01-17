// BetterDungeon - Character Preset Feature
// Allows users to save character presets and auto-fill scenario entry fields

class CharacterPresetFeature {
  static id = 'characterPreset';

  constructor() {
    this.observer = null;
    this.checkInterval = null;
    this.domUtils = window.DOMUtils;
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
    this.isProcessing = false;
    this.hasAutoFilled = false; // Track if we already auto-filled current field
  }

  async init() {
    console.log('CharacterPresetFeature: Initializing...');
    await this.loadPresets();
    await this.loadActivePreset();
    this.setupObserver();
    this.startPolling();
    this.checkForEntryField();
  }

  destroy() {
    console.log('CharacterPresetFeature: Destroying...');
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
          console.log('CharacterPresetFeature: Extension context invalidated, using cached presets');
          resolve(this.presets);
          return;
        }
        chrome.storage.sync.get(this.storageKey, (result) => {
          if (chrome.runtime.lastError) {
            console.log('CharacterPresetFeature: Storage error, using cached presets');
            resolve(this.presets);
            return;
          }
          this.presets = result[this.storageKey] || [];
          console.log('CharacterPresetFeature: Loaded', this.presets.length, 'presets');
          resolve(this.presets);
        });
      } catch (e) {
        console.log('CharacterPresetFeature: Extension context invalidated');
        resolve(this.presets);
      }
    });
  }

  async savePresets() {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          console.log('CharacterPresetFeature: Extension context invalidated, cannot save');
          resolve();
          return;
        }
        chrome.storage.sync.set({ [this.storageKey]: this.presets }, () => {
          if (chrome.runtime.lastError) {
            console.log('CharacterPresetFeature: Storage error on save');
            resolve();
            return;
          }
          console.log('CharacterPresetFeature: Saved', this.presets.length, 'presets');
          resolve();
        });
      } catch (e) {
        console.log('CharacterPresetFeature: Extension context invalidated, cannot save');
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
          console.log('CharacterPresetFeature: Active preset:', this.activePresetId);
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
          console.log('CharacterPresetFeature: Set active preset to:', presetId);
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
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

  normalizeFieldKey(label) {
    if (!label) return null;
    
    // Clean up the label first - remove parenthetical content, dashes with qualifiers
    let cleaned = label.toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')           // Remove (parenthetical content)
      .replace(/\s*-\s*preceded by.*$/i, '')  // Remove "- preceded by ..." suffix
      .replace(/\s*-\s*followed by.*$/i, '')  // Remove "- followed by ..." suffix
      .trim();
    
    const normalized = cleaned
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    
    const commonMappings = {
      // Name variations
      'your_name': 'name',
      'character_name': 'name',
      'enter_your_name': 'name',
      'enter_your_characters_name': 'name',
      'whats_your_name': 'name',
      'name': 'name',
      // Age variations
      'your_age': 'age',
      'character_age': 'age',
      'how_old_are_you': 'age',
      'age': 'age',
      // Gender variations
      'your_gender': 'gender',
      'character_gender': 'gender',
      'gender': 'gender',
      // Species/Race variations
      'your_race': 'species',
      'character_race': 'species',
      'your_species': 'species',
      'species': 'species',
      'race': 'species',
      // Class variations
      'your_class': 'class',
      'character_class': 'class',
      'class': 'class',
      // Appearance variations
      'your_appearance': 'appearance',
      'describe_your_appearance': 'appearance',
      'what_do_you_look_like': 'appearance',
      'appearance': 'appearance',
      'your_appearance_preceded_by_you_are': 'appearance',
      // Personality variations
      'your_personality': 'personality',
      'describe_your_personality': 'personality',
      'personality': 'personality',
      // Backstory variations
      'your_backstory': 'backstory',
      'your_background': 'backstory',
      'describe_your_backstory': 'backstory',
      'backstory': 'backstory',
      'background': 'backstory',
      // Occupation variations
      'your_occupation': 'occupation',
      'what_is_your_occupation': 'occupation',
      'occupation': 'occupation',
      'job': 'occupation',
      // Goal variations
      'your_goal': 'goal',
      'your_goals': 'goal',
      'what_is_your_goal': 'goal',
      'goal': 'goal',
      'goals': 'goal',
      // Title/Role variations
      'your_title': 'title',
      'title': 'title',
      'role': 'title',
      // Pronouns
      'your_pronouns': 'pronouns',
      'pronouns': 'pronouns',
      'he_him_his': 'pronouns',
      'she_her_hers': 'pronouns',
      'they_them_theirs': 'pronouns',
      // Skills/Abilities
      'your_skills': 'skills',
      'skills': 'skills',
      'abilities': 'skills',
    };
    
    return commonMappings[normalized] || normalized;
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
        
        console.log('CharacterPresetFeature: Detected entry field:', field.label, '(aria-label:', field.ariaLabel, ') -> key:', field.fieldKey);
        
        // Clean up previous UI
        this.removeOverlay();
        this.removeSaveButton();
        
        // Determine what to show based on the field type and state
        await this.handleField(field);
      }
    } else {
      if (this.currentFieldLabel !== null) {
        console.log('CharacterPresetFeature: Entry field no longer detected');
        this.currentFieldLabel = null;
        this.currentFieldKey = null;
        this.hasAutoFilled = false;
        this.removeOverlay();
        this.removeSaveButton();
      }
    }
  }

  async handleField(field) {
    const isNameField = field.fieldKey === 'name';
    const sessionCharacter = this.getSessionCharacter();
    
    if (isNameField) {
      // Name field: Show character selector overlay
      await this.showCharacterSelectorOverlay(field);
    } else if (sessionCharacter) {
      // Non-name field with active character: check if we have a saved value
      const savedValue = sessionCharacter.fields[field.fieldKey];
      
      if (savedValue !== undefined && savedValue !== '') {
        // We have a saved value - auto-fill it
        this.autoFillField(field, savedValue);
      } else {
        // No saved value - show "Save & Continue" button
        this.showSaveAndContinueButton(field);
      }
    }
    // If no session character selected and not a name field, do nothing
  }

  getSessionCharacter() {
    if (!this.sessionCharacterId) return null;
    return this.presets.find(p => p.id === this.sessionCharacterId) || null;
  }

  // ============================================
  // PRIORITY FIELDS (for sorting in editor)
  // ============================================

  static PRIORITY_FIELDS = [
    'name', 'age', 'gender', 'pronouns', 'species', 'title', 'class',
    'appearance', 'personality', 'backstory', 'occupation', 'goal',
    'skills', 'inventory'
  ];

  getFieldPriority(fieldKey) {
    const index = CharacterPresetFeature.PRIORITY_FIELDS.indexOf(fieldKey);
    return index === -1 ? 999 : index;
  }

  getSortedFields(fields) {
    return Object.entries(fields).sort((a, b) => {
      return this.getFieldPriority(a[0]) - this.getFieldPriority(b[0]);
    });
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
      console.log('CharacterPresetFeature: Could not find input container');
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
    
    console.log('CharacterPresetFeature: Showing character selector with', this.presets.length, 'presets');
  }

  buildCharacterSelectorHTML() {
    const hasPresets = this.presets.length > 0;
    
    if (hasPresets) {
      // Always default to "Select..." - don't auto-select based on sessionCharacterId
      const options = this.presets.map(p => 
        `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`
      ).join('');
      
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
          this.sessionCharacterId = presetId;
          await this.setActivePreset(presetId);
          
          const character = this.getSessionCharacter();
          if (character) {
            const nameValue = character.fields.name || character.name;
            field.input.value = nameValue;
            field.input.dispatchEvent(new Event('input', { bubbles: true }));
            field.input.dispatchEvent(new Event('change', { bubbles: true }));
            
            this.showToast(`Playing as ${character.name}`, 'success');
            console.log('CharacterPresetFeature: Selected character:', character.name);
          }
        } else {
          this.sessionCharacterId = null;
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
      field.input.value = name;
      field.input.dispatchEvent(new Event('input', { bubbles: true }));
      field.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    const preset = await this.createPreset(name);
    await this.updatePresetField(preset.id, 'name', name);
    
    this.sessionCharacterId = preset.id;
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
      console.log('CharacterPresetFeature: Could not find Continue button');
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
    
    console.log('CharacterPresetFeature: Showing Save & Continue for field:', field.fieldKey);
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
    
    await this.updatePresetField(sessionCharacter.id, field.fieldKey, value);
    this.showToast(`Saved to ${sessionCharacter.name}`, 'success');
    this.removeSaveButton();
    
    // Click continue
    setTimeout(() => continueBtn.click(), 100);
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
  // AUTO-FILL LOGIC
  // ============================================

  autoFillField(field, savedValue) {
    if (this.hasAutoFilled) return; // Prevent double auto-fill
    
    if (savedValue === undefined || savedValue === '') {
      return;
    }

    this.hasAutoFilled = true;
    this.isProcessing = true;
    
    // Fill the field
    field.input.value = savedValue;
    field.input.dispatchEvent(new Event('input', { bubbles: true }));
    field.input.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('CharacterPresetFeature: Auto-filled field:', field.fieldKey, '=', savedValue);
    this.showToast(`Auto-filled: ${this.truncate(savedValue, 25)}`, 'success');
    
    // Wait a moment then click Continue
    setTimeout(() => {
      const continueBtn = this.findContinueButton();
      if (continueBtn) {
        console.log('CharacterPresetFeature: Auto-clicking Continue');
        continueBtn.click();
      }
      this.isProcessing = false;
    }, 300);
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
  console.log('CharacterPresetFeature: Class loaded and registered globally');
}
