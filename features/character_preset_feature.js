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
  // FIELD KEY NORMALIZATION (DUAL-KEY SYSTEM)
  // ============================================
  // 
  // We use a dual-key approach:
  // 1. PRIMARY KEY (exact): A sanitized version of the original question label
  //    - Used for exact matching within the same scenario type
  //    - Prevents false matches on unrelated questions
  // 2. ARCHETYPE KEY (optional): A canonical field type (name, age, etc.)
  //    - Only assigned when there's HIGH confidence the question matches
  //    - Used as a fallback when exact match fails
  //
  // Fields are stored as: { exactKey: value } AND optionally { archetype: value }
  // Lookup order: exact match first, then archetype fallback

  // High-confidence archetype patterns
  // These patterns must be VERY specific to avoid false matches
  static ARCHETYPE_PATTERNS = {
    // Name - only match explicit name questions
    'name': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+name\??$/i,
      /^name\??$/i,
      /^(?:enter|type|input)\s+(?:your|a|the)?\s*name$/i,
      /^what\s+(?:are|should)\s+(?:you|they|we)\s+called\??$/i,
    ],
    // Age - only explicit age questions
    'age': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+age\??$/i,
      /^age\??$/i,
      /^how\s+old\s+(?:are|is)\s+(?:you|your\s+character|they)\??$/i,
    ],
    // Gender - explicit gender questions
    'gender': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+gender\??$/i,
      /^gender\??$/i,
    ],
    // Pronouns
    'pronouns': [
      /^(?:what(?:'?s|\s+are)\s+)?(?:your|the|their|character'?s?)\s+pronouns?\??$/i,
      /^pronouns?\??$/i,
    ],
    // Species/Race - must explicitly mention species or race
    'species': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+(?:species|race)\??$/i,
      /^(?:species|race)\??$/i,
      /^what\s+(?:species|race)\s+(?:are|is)\s+(?:you|your\s+character|they)\??$/i,
    ],
    // Class/Role - explicit class or role questions
    'class': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+(?:class|role)\??$/i,
      /^(?:class|role)\??$/i,
    ],
    // Appearance - must clearly ask about looks/appearance
    'appearance': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+(?:appearance|physical\s+description)\??$/i,
      /^(?:describe|what\s+does?)\s+(?:your|the)?\s*(?:character'?s?)?\s*(?:look\s+like|appearance)\??$/i,
      /^(?:appearance|looks?)\??$/i,
      /^what\s+do\s+(?:you|they)\s+look\s+like\??$/i,
    ],
    // Personality - explicit personality questions
    'personality': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+personality\??$/i,
      /^(?:describe|what\s+is)\s+(?:your|the)?\s*personality\??$/i,
      /^personality\??$/i,
    ],
    // Backstory/Background - explicit backstory questions
    'backstory': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+(?:backstory|background|history)\??$/i,
      /^(?:backstory|background|history)\??$/i,
      /^tell\s+(?:me|us)\s+about\s+(?:your|the)?\s*(?:character'?s?)?\s*(?:past|backstory|background)\??$/i,
    ],
    // Occupation - explicit job/occupation questions
    'occupation': [
      /^(?:what(?:'?s|\s+is)\s+)?(?:your|the|their|character'?s?)\s+(?:occupation|job|profession)\??$/i,
      /^(?:occupation|job|profession)\??$/i,
      /^what\s+do\s+(?:you|they)\s+do\s+(?:for\s+(?:a\s+)?(?:living|work))\??$/i,
    ],
    // Goals/Motivation - explicit goal questions
    'goal': [
      /^(?:what(?:'?s|\s+are|\s+is)\s+)?(?:your|the|their|character'?s?)\s+(?:goal|goals|objective|motivation)s?\??$/i,
      /^(?:goal|goals|objective|motivation)s?\??$/i,
    ],
    // Skills/Abilities - explicit skills questions
    'skills': [
      /^(?:what(?:'?s|\s+are)\s+)?(?:your|the|their|character'?s?)\s+(?:skills?|abilities|powers?)\??$/i,
      /^(?:skills?|abilities|powers?)\??$/i,
    ],
    // Inventory/Equipment
    'inventory': [
      /^(?:what(?:'?s|\s+are|\s+is)\s+)?(?:your|the|their|character'?s?)\s+(?:inventory|equipment|items?|gear|belongings)\??$/i,
      /^(?:what\s+(?:do\s+)?(?:you|they)\s+(?:have|carry|bring))\??$/i,
      /^(?:inventory|equipment|items?|gear)\??$/i,
    ],
  };

  // Simple word-to-archetype mapping for SINGLE-WORD labels only
  // These are only used when the entire cleaned label is just one word
  static SINGLE_WORD_ARCHETYPES = {
    'name': 'name',
    'age': 'age',
    'gender': 'gender',
    'pronouns': 'pronouns',
    'species': 'species',
    'race': 'species',
    'class': 'class',
    'role': 'class',
    'appearance': 'appearance',
    'looks': 'appearance',
    'personality': 'personality',
    'backstory': 'backstory',
    'background': 'backstory',
    'history': 'backstory',
    'occupation': 'occupation',
    'job': 'occupation',
    'profession': 'occupation',
    'goal': 'goal',
    'goals': 'goal',
    'skills': 'skills',
    'abilities': 'skills',
    'inventory': 'inventory',
    'equipment': 'inventory',
  };

  // Generate a consistent exact key from the label
  // This creates a sanitized, deterministic key from the original question
  generateExactKey(label) {
    if (!label) return null;
    
    return label.toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')           // Remove (parenthetical content)
      .replace(/\s*-\s*preceded by.*$/i, '')  // Remove "- preceded by ..." suffix
      .replace(/\s*-\s*followed by.*$/i, '')  // Remove "- followed by ..." suffix
      .replace(/[?!.:;,"']/g, '')             // Remove punctuation
      .replace(/[^a-z0-9\s]/g, '')            // Remove special chars
      .trim()
      .replace(/\s+/g, '_');                  // Spaces to underscores
  }

  // Attempt to detect a high-confidence archetype from the label
  // Returns null if no confident match - this is intentional!
  detectArchetype(label) {
    if (!label) return null;
    
    const cleaned = label.toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/[?!.:;,"']/g, '')
      .replace(/[^a-z0-9\s]/g, '')            // Remove curly apostrophes and other special chars
      .trim();
    
    // First check: If it's a single word, check simple mappings
    const words = cleaned.split(/\s+/);
    if (words.length === 1) {
      const singleWord = words[0];
      if (CharacterPresetFeature.SINGLE_WORD_ARCHETYPES[singleWord]) {
        return CharacterPresetFeature.SINGLE_WORD_ARCHETYPES[singleWord];
      }
    }
    
    // Second check: Test against high-confidence patterns
    for (const [archetype, patterns] of Object.entries(CharacterPresetFeature.ARCHETYPE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(cleaned)) {
          return archetype;
        }
      }
    }
    
    // No confident match - return null (this is fine!)
    return null;
  }

  // Generate both keys for a field
  // Returns { exactKey, archetype (or null) }
  getFieldKeys(label) {
    return {
      exactKey: this.generateExactKey(label),
      archetype: this.detectArchetype(label)
    };
  }

  // DEPRECATED: Keep for backward compatibility during migration
  // New code should use getFieldKeys() instead
  normalizeFieldKey(label) {
    // Return exact key for storage - archetype matching happens at lookup time
    return this.generateExactKey(label);
  }

  // Look up a saved value for a field, trying exact match first, then archetype
  lookupFieldValue(preset, label) {
    if (!preset || !preset.fields) return undefined;
    
    const { exactKey, archetype } = this.getFieldKeys(label);
    
    // Priority 1: Exact key match (most reliable)
    if (exactKey && preset.fields[exactKey] !== undefined) {
      this.log(`[CharacterPreset] Found exact match for "${exactKey}"`);
      return { value: preset.fields[exactKey], matchType: 'exact' };
    }
    
    // Priority 2: Archetype match (only if high confidence)
    if (archetype && preset.fields[archetype] !== undefined) {
      this.log(`[CharacterPreset] Found archetype match "${archetype}" for label "${label}"`);
      return { value: preset.fields[archetype], matchType: 'archetype' };
    }
    
    // Priority 3: Check if any stored key has this archetype
    // This handles cases where we saved "whats_your_name" but now see "name"
    if (archetype) {
      for (const [storedKey, storedValue] of Object.entries(preset.fields)) {
        // Check if the stored key resolves to the same archetype
        const storedArchetype = this.detectArchetype(storedKey.replace(/_/g, ' '));
        if (storedArchetype === archetype) {
          this.log(`[CharacterPreset] Found cross-archetype match: stored "${storedKey}" matches archetype "${archetype}"`);
          return { value: storedValue, matchType: 'cross-archetype' };
        }
      }
    }
    
    this.log(`[CharacterPreset] No match found for "${label}" (exactKey: ${exactKey}, archetype: ${archetype})`);
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
    // Check if this is a name field using archetype detection (not exact key)
    const fieldArchetype = this.detectArchetype(field.ariaLabel);
    const isNameField = fieldArchetype === 'name';
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
      
      // Use the new dual-key lookup system: tries exact match first, then archetype
      const lookupResult = this.lookupFieldValue(sessionCharacter, field.ariaLabel);
      
      if (lookupResult && lookupResult.value !== undefined && lookupResult.value !== '') {
        // We have a saved value - auto-fill it
        this.log(`[CharacterPreset] Auto-filling via ${lookupResult.matchType} match`);
        this.autoFillField(field, lookupResult.value);
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
    
    // Use the dual-key save system
    await this.saveFieldWithDualKey(sessionCharacter.id, field.ariaLabel, value);
    this.showToast(`Saved to ${sessionCharacter.name}`, 'success');
    this.removeSaveButton();
    
    // Click continue
    setTimeout(() => continueBtn.click(), 100);
  }

  // Save a field value using the dual-key system
  // Saves under exact key, and ALSO under archetype key if one is detected
  // This ensures values can be found both by exact match and archetype fallback
  async saveFieldWithDualKey(presetId, label, value) {
    const { exactKey, archetype } = this.getFieldKeys(label);
    
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return null;
    
    // Always save under exact key
    if (exactKey) {
      preset.fields[exactKey] = value;
      this.log(`[CharacterPreset] Saved under exact key: "${exactKey}"`);
    }
    
    // Also save under archetype key if we detected one with high confidence
    // This enables cross-scenario matching for recognized fields
    if (archetype && archetype !== exactKey) {
      preset.fields[archetype] = value;
      this.log(`[CharacterPreset] Also saved under archetype: "${archetype}"`);
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
