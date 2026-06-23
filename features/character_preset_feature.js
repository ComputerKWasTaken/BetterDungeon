// BetterDungeon - Character Preset Feature
// AI-assisted scenario placeholder prefill using simple character dossiers.

class CharacterPresetFeature {
  static id = 'characterPreset';

  constructor(context = {}) {
    this.context = context;
    this.storageKey = 'betterDungeon_characterPresets';
    this.activePresetKey = 'betterDungeon_activeCharacterPreset';
    this.sessionKey = 'betterDungeon_characterPresetSessionV2';

    this.presets = [];
    this.activePresetId = null;
    this.session = null;
    this.scenario = null;
    this.scenarioSignature = null;
    this.scenarioShortId = null;

    this.status = 'idle';
    this.statusMessage = '';
    this.currentFieldLabel = null;
    this.currentFieldKey = null;
    this.panelElement = null;
    this.manualDismissedQuestions = new Set();
    this.observer = null;
    this.checkInterval = null;
    this._checkDebounceTimer = null;
    this._fieldGraceTimer = null;
    this._handleToken = 0;
    this.isApplying = false;
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) console.log('[CharacterPreset]', message, ...args);
  }

  async init() {
    console.log('[CharacterPreset] Initializing AI-assisted Character Presets feature...');
    await this.loadPresets();
    await this.clearLegacyStorage();
    await this.loadActivePreset();
    await this.loadSession();
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
    this.removePanel();
  }

  // ============================================
  // STORAGE
  // ============================================

  _chromeGet(area, key, fallback = null) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve(fallback);
          return;
        }
        chrome.storage[area].get(key, (result) => {
          resolve(chrome.runtime.lastError ? fallback : ((result || {})[key] ?? fallback));
        });
      } catch {
        resolve(fallback);
      }
    });
  }

  _chromeSet(area, data) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve();
          return;
        }
        chrome.storage[area].set(data, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  _chromeRemove(area, key) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          resolve();
          return;
        }
        chrome.storage[area].remove(key, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  isV2Character(value) {
    return !!(
      value &&
      typeof value === 'object' &&
      value.schemaVersion === 2 &&
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.description === 'string' &&
      !value.fields
    );
  }

  normalizeCharacter(value) {
    const now = Date.now();
    return {
      schemaVersion: 2,
      id: String(value.id),
      name: String(value.name || 'Unnamed Character').trim() || 'Unnamed Character',
      description: String(value.description || ''),
      createdAt: Number(value.createdAt) || now,
      updatedAt: Number(value.updatedAt) || now,
    };
  }

  async loadPresets() {
    const raw = await this._chromeGet('local', this.storageKey, []);
    const list = Array.isArray(raw) ? raw : [];
    const v2Presets = list.filter(item => this.isV2Character(item)).map(item => this.normalizeCharacter(item));

    if (v2Presets.length !== list.length) {
      await this._chromeSet('local', { [this.storageKey]: v2Presets });
      if (this.activePresetId && !v2Presets.some(p => p.id === this.activePresetId)) {
        await this.setActivePreset(null);
      }
    }

    this.presets = v2Presets;
    return this.presets;
  }

  async clearLegacyStorage() {
    await this._chromeRemove('sync', this.storageKey);
    await this._chromeRemove('sync', this.activePresetKey);
    await this._chromeRemove('local', 'betterDungeon_sessionCharacter');
    await this._chromeRemove('local', 'betterDungeon_scenarioSession');
  }

  async savePresets() {
    await this._chromeSet('local', { [this.storageKey]: this.presets });
  }

  async loadActivePreset() {
    const activeId = await this._chromeGet('local', this.activePresetKey, null);
    this.activePresetId = activeId && this.presets.some(p => p.id === activeId) ? activeId : null;
    if (activeId !== this.activePresetId) {
      await this._chromeSet('local', { [this.activePresetKey]: this.activePresetId });
    }
    return this.activePresetId;
  }

  async setActivePreset(presetId) {
    this.activePresetId = presetId || null;
    await this._chromeSet('local', { [this.activePresetKey]: this.activePresetId });
  }

  async loadSession() {
    const session = await this._chromeGet('local', this.sessionKey, null);
    this.session = this.isValidSession(session) ? session : null;
    return this.session;
  }

  async saveSession() {
    await this._chromeSet('local', { [this.sessionKey]: this.session });
  }

  async clearSession() {
    this.session = null;
    await this._chromeRemove('local', this.sessionKey);
  }

  isValidSession(session) {
    return !!(
      session &&
      typeof session === 'object' &&
      typeof session.scenarioShortId === 'string' &&
      typeof session.scenarioSignature === 'string' &&
      typeof session.characterId === 'string' &&
      Array.isArray(session.placeholders) &&
      session.answers &&
      typeof session.answers === 'object'
    );
  }

  createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async createPreset(name, description = '') {
    await this.loadPresets();
    const now = Date.now();
    const preset = {
      schemaVersion: 2,
      id: this.createId(),
      name: String(name || 'Unnamed Character').trim() || 'Unnamed Character',
      description: String(description || ''),
      createdAt: now,
      updatedAt: now,
    };
    this.presets.unshift(preset);
    await this.savePresets();
    return preset;
  }

  async updatePreset(id, updates = {}) {
    await this.loadPresets();
    const index = this.presets.findIndex(p => p.id === id);
    if (index === -1) return null;

    const current = this.presets[index];
    this.presets[index] = {
      ...current,
      schemaVersion: 2,
      name: updates.name !== undefined
        ? (String(updates.name).trim() || current.name)
        : current.name,
      description: updates.description !== undefined
        ? String(updates.description || '')
        : current.description,
      updatedAt: Date.now(),
    };

    await this.savePresets();
    return this.presets[index];
  }

  async deletePreset(id) {
    await this.loadPresets();
    const index = this.presets.findIndex(p => p.id === id);
    if (index === -1) return false;

    this.presets.splice(index, 1);
    if (this.activePresetId === id) await this.setActivePreset(null);
    if (this.session?.characterId === id) await this.clearSession();
    await this.savePresets();
    return true;
  }

  async getAllPresets() {
    await this.loadPresets();
    return [...this.presets].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async getPresetById(id) {
    await this.loadPresets();
    return this.presets.find(p => p.id === id) || null;
  }

  getActivePreset() {
    if (!this.activePresetId) return null;
    return this.presets.find(p => p.id === this.activePresetId) || null;
  }

  // ============================================
  // DETECTION
  // ============================================

  setupObserver() {
    this.observer = new MutationObserver((mutations) => {
      if (this.isApplying) return;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          this.debouncedCheck();
          break;
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  startPolling() {
    this.checkInterval = setInterval(() => this.debouncedCheck(), 500);
  }

  debouncedCheck() {
    if (this._checkDebounceTimer) return;
    this._checkDebounceTimer = setTimeout(() => {
      this._checkDebounceTimer = null;
      this.checkForEntryField();
    }, 250);
  }

  findScenarioEntryField() {
    const input = document.getElementById('full-screen-text-input');
    if (!input) return null;

    const ariaLabel = input.getAttribute('aria-label');
    if (!ariaLabel) return null;

    let questionText = ariaLabel;
    const searchRoot = input.closest('[style*="max-width"]') || input.parentElement?.parentElement?.parentElement;
    if (searchRoot) {
      const headings = searchRoot.querySelectorAll('h1, h2, [role="heading"]');
      for (const heading of headings) {
        const text = heading.textContent?.trim();
        if (text && text.length > 0 && text.length < 160) {
          questionText = text;
          break;
        }
      }
    }

    return {
      input,
      label: questionText,
      ariaLabel,
      question: ariaLabel.trim(),
    };
  }

  getFieldContainer(field) {
    if (!field?.input) return null;

    let el = field.input.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth < 10) {
      if (el.parentElement && el.parentElement.children.length > 1) {
        return el.parentElement;
      }
      el = el.parentElement;
      depth++;
    }
    return field.input.parentElement?.parentElement || null;
  }

  async checkForEntryField() {
    if (this.isApplying) return;
    const field = this.findScenarioEntryField();

    if (field) {
      if (this._fieldGraceTimer) {
        clearTimeout(this._fieldGraceTimer);
        this._fieldGraceTimer = null;
      }

      const fieldId = field.ariaLabel;
      if (this.currentFieldLabel !== fieldId || !this.panelElement?.isConnected) {
        this.currentFieldLabel = fieldId;
        this.currentFieldKey = field.question;
        await this.handleField(field);
      }
      return;
    }

    if (this.currentFieldLabel !== null && !this._fieldGraceTimer) {
      this._fieldGraceTimer = setTimeout(() => {
        this._fieldGraceTimer = null;
        if (!this.findScenarioEntryField()) {
          this.currentFieldLabel = null;
          this.currentFieldKey = null;
          this.removePanel();
        }
      }, 400);
    }
  }

  // ============================================
  // SCENARIO + AI SESSION
  // ============================================

  parseScenarioShortIdFromUrl() {
    const match = window.location.pathname.match(/\/scenario\/([^/]+)/);
    return match ? match[1] : null;
  }

  async handleField(field) {
    const token = ++this._handleToken;
    try {
      await this.prepareScenarioState();
      if (token !== this._handleToken) return;

      if (this.status === 'ready') {
        this.showAnswerPanel(field);
      } else if (this.status === 'needCharacter') {
        this.showCharacterPicker(field);
      } else if (this.status === 'generating') {
        this.showGeneratingPanel(field);
      } else if (this.status === 'blocked' || this.status === 'error') {
        this.showBlockedPanel(field, this.statusMessage);
      } else {
        this.showCharacterPicker(field);
      }
    } catch (error) {
      this.status = 'error';
      this.statusMessage = error?.message || 'Character Presets could not prepare this scenario.';
      this.showBlockedPanel(field, this.statusMessage);
    }
  }

  async prepareScenarioState() {
    const shortId = this.parseScenarioShortIdFromUrl();
    if (!shortId) {
      this.status = 'blocked';
      this.statusMessage = 'Character Presets only works on scenario start pages.';
      return;
    }

    if (!this.scenario || this.scenarioShortId !== shortId) {
      await this.loadScenario(shortId);
    }

    if (!this.scenario?.placeholders?.length) {
      this.status = 'blocked';
      this.statusMessage = 'This scenario has no placeholder questions to prefill.';
      return;
    }

    await this.loadPresets();
    await this.loadSession();

    if (this.sessionMatchesScenario(this.session)) {
      const character = this.presets.find(p => p.id === this.session.characterId);
      if (character) {
        this.activePresetId = character.id;
        this.status = 'ready';
        this.statusMessage = '';
        return;
      }
      await this.clearSession();
    }

    if (this.presets.length === 0) {
      this.status = 'blocked';
      this.statusMessage = 'Create a character in the BetterDungeon popup before using AI prefill.';
      return;
    }

    const aiReady = await this.ensureAIReady();
    if (!aiReady.ready) {
      this.status = 'blocked';
      this.statusMessage = aiReady.message || 'Configure a Gemini API key in BetterDungeon AI settings to use Character Presets.';
      return;
    }

    this.status = 'needCharacter';
    this.statusMessage = '';
  }

  async loadScenario(shortId) {
    const gql = window.BetterDungeonGQL;
    if (!gql?.getScenarioStart) {
      throw new Error('BetterDungeon GraphQL service is not available.');
    }

    const scenario = await gql.getScenarioStart(shortId, { timeoutMs: 30000, viewPublished: true });
    const placeholders = this.extractPlaceholders(scenario);
    const signature = this.computeScenarioSignature(scenario, placeholders);

    this.scenario = {
      raw: scenario,
      placeholders,
      signature,
    };
    this.scenarioSignature = signature;
    this.scenarioShortId = scenario.shortId || shortId;
    this.manualDismissedQuestions.clear();
  }

  sessionMatchesScenario(session) {
    return !!(
      this.isValidSession(session) &&
      session.scenarioShortId === this.scenarioShortId &&
      session.scenarioSignature === this.scenarioSignature &&
      session.status === 'ready'
    );
  }

  extractPlaceholders(scenario) {
    const seen = new Set();
    const out = [];
    const addFromText = (text) => {
      if (typeof text !== 'string' || !text) return;
      const re = /\$\{([^{}]+)\}/g;
      let match;
      while ((match = re.exec(text))) {
        const question = String(match[1] || '').trim();
        if (!question || seen.has(question)) continue;
        seen.add(question);
        out.push(question);
      }
    };

    const state = scenario?.state || {};
    addFromText(state.plotEssentials);
    addFromText(state.prompt);
    addFromText(state.authorsNote);

    const cards = Array.isArray(scenario?.storyCards) ? scenario.storyCards : [];
    for (const card of cards) {
      addFromText(card?.value);
      addFromText(card?.description);
      addFromText(card?.title);
      if (Array.isArray(card?.keys)) addFromText(card.keys.join('\n'));
    }

    return out;
  }

  computeScenarioSignature(scenario, placeholders) {
    const state = scenario?.state || {};
    const cards = Array.isArray(scenario?.storyCards) ? scenario.storyCards : [];
    const payload = JSON.stringify({
      id: scenario?.id || null,
      shortId: scenario?.shortId || null,
      editedAt: scenario?.editedAt || null,
      publishedUpdatedAt: scenario?.publishedUpdatedAt || null,
      title: scenario?.title || '',
      placeholders,
      prompt: state.prompt || '',
      plotEssentials: state.plotEssentials || '',
      authorsNote: state.authorsNote || '',
      storyCards: cards.map(card => ({
        id: card?.id || null,
        updatedAt: card?.updatedAt || null,
        value: card?.value || '',
        description: card?.description || '',
      })),
    });
    return String(this.hashString(payload));
  }

  hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
  }

  async ensureAIReady() {
    try {
      window.UltrascriptsAIGeminiBackend?.register?.();
      await window.UltrascriptsAIGeminiBackend?.refreshStatus?.();
      const status = window.UltrascriptsAIExecutor?.status?.();
      if (status?.ready) return { ready: true };
      return {
        ready: false,
        message: status?.message || 'Configure a Gemini API key in BetterDungeon AI settings to use Character Presets.',
      };
    } catch (error) {
      return {
        ready: false,
        message: error?.message || 'Gemini status could not be checked.',
      };
    }
  }

  async generateSessionForCharacter(characterId, field) {
    const character = this.presets.find(p => p.id === characterId);
    if (!character) {
      this.showToast('Character not found', 'error');
      return;
    }

    const aiReady = await this.ensureAIReady();
    if (!aiReady.ready) {
      this.status = 'blocked';
      this.statusMessage = aiReady.message;
      this.showBlockedPanel(field, this.statusMessage);
      return;
    }

    this.status = 'generating';
    this.showGeneratingPanel(field);

    try {
      const result = await window.UltrascriptsAIExecutor.query({
        prompt: this.buildAIPrompt(character),
        output: {
          type: 'json',
          schema: this.buildAnswerSchema(),
        },
        thinking: { level: 'low' },
      }, {
        requestId: `character-prefill-${this.scenarioShortId}-${Date.now()}`,
      });

      this.session = this.normalizeAISession(character, result?.json);
      this.manualDismissedQuestions.clear();
      await this.saveSession();
      await this.setActivePreset(character.id);
      this.status = 'ready';
      this.statusMessage = '';
      this.showAnswerPanel(field);
      this.showToast(`Generated answers for ${character.name}`, 'success');
    } catch (error) {
      console.error('[CharacterPreset] AI generation failed:', error);
      this.status = 'error';
      this.statusMessage = error?.message || 'Gemini could not generate placeholder answers.';
      this.showBlockedPanel(field, this.statusMessage);
    }
  }

  buildAIPrompt(character) {
    const scenario = this.scenario?.raw || {};
    const state = scenario.state || {};
    const placeholders = this.scenario?.placeholders || [];
    const storyCards = Array.isArray(scenario.storyCards) ? scenario.storyCards : [];

    const context = [
      `Title: ${scenario.title || '(untitled)'}`,
      scenario.description ? `Description:\n${scenario.description}` : '',
      scenario.advancedDescription ? `Advanced Description:\n${scenario.advancedDescription}` : '',
      state.plotEssentials ? `Plot Essentials:\n${state.plotEssentials}` : '',
      state.prompt ? `Opening Prompt:\n${state.prompt}` : '',
      state.authorsNote ? `Author's Note:\n${state.authorsNote}` : '',
      state.instructions ? `Instructions:\n${typeof state.instructions === 'string' ? state.instructions : JSON.stringify(state.instructions)}` : '',
      storyCards.length ? `Story Cards:\n${this.formatStoryCardsForPrompt(storyCards)}` : '',
    ].filter(Boolean).join('\n\n');

    const maxContextChars = Math.max(2000, 10500 - character.description.length - placeholders.join('\n').length);
    const trimmedContext = this.truncate(context, maxContextChars);

    return [
      'You generate AI Dungeon scenario placeholder prefill answers.',
      'Use the selected character profile and scenario context to answer each placeholder question.',
      'Return JSON that exactly matches the provided schema.',
      'Rules:',
      '- Include one answer object for every placeholder question, using the exact question text.',
      '- If the question can be answered from or reasonably adapted from the character profile, set deferToPlayer to false and provide a concise answer.',
      '- If the question is a scenario choice, asks about another entity not described, requires personal preference, or cannot be answered safely, set deferToPlayer to true and use an empty answer.',
      '- Do not invent major biographical facts that are not implied by the character profile.',
      '- Keep answers ready to paste directly into the scenario prefill field.',
      '',
      `Character Name: ${character.name}`,
      `Character Profile:\n${character.description || character.name}`,
      '',
      `Placeholder Questions:\n${placeholders.map(q => `- ${q}`).join('\n')}`,
      '',
      `Scenario Context:\n${trimmedContext}`,
    ].join('\n');
  }

  formatStoryCardsForPrompt(cards) {
    return cards.slice(0, 20).map((card, index) => {
      const parts = [
        `Card ${index + 1}: ${card?.title || '(untitled)'}`,
        Array.isArray(card?.keys) && card.keys.length ? `Keys: ${card.keys.join(', ')}` : '',
        card?.description ? `Description: ${card.description}` : '',
        card?.value ? `Value: ${card.value}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    }).join('\n\n');
  }

  buildAnswerSchema() {
    return {
      type: 'object',
      properties: {
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' },
              deferToPlayer: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: ['question', 'answer', 'deferToPlayer', 'reason'],
          },
        },
      },
      required: ['answers'],
    };
  }

  normalizeAISession(character, json) {
    const placeholders = this.scenario?.placeholders || [];
    const returned = Array.isArray(json?.answers) ? json.answers : [];
    const byQuestion = new Map();
    for (const item of returned) {
      if (!item || typeof item.question !== 'string') continue;
      byQuestion.set(item.question.trim(), item);
    }

    const answers = {};
    for (const question of placeholders) {
      const item = byQuestion.get(question) || null;
      answers[question] = {
        answer: String(item?.answer || '').trim(),
        deferToPlayer: item ? item.deferToPlayer === true : true,
        reason: String(item?.reason || ''),
      };
      if (answers[question].deferToPlayer) answers[question].answer = '';
    }

    return {
      schemaVersion: 1,
      scenarioShortId: this.scenarioShortId,
      scenarioSignature: this.scenarioSignature,
      characterId: character.id,
      placeholders: [...placeholders],
      answers,
      generatedAt: Date.now(),
      status: 'ready',
    };
  }

  // ============================================
  // UI
  // ============================================

  renderPanel(field, html) {
    const container = document.body;
    if (!container) return null;

    this.removePanel();
    const panel = document.createElement('div');
    panel.className = 'bd-character-ai-panel';
    panel.innerHTML = html;
    container.appendChild(panel);
    this.panelElement = panel;
    requestAnimationFrame(() => panel.classList.add('bd-character-ai-panel-visible'));
    return panel;
  }

  removePanel() {
    const current = this.panelElement;
    this.panelElement = null;
    if (current) {
      current.classList.remove('bd-character-ai-panel-visible');
      setTimeout(() => current.remove(), 200);
    }
    document.querySelectorAll('.bd-character-ai-panel').forEach(el => {
      if (el !== current) el.remove();
    });
  }

  showCharacterPicker(field) {
    const selectedId = this.activePresetId && this.presets.some(p => p.id === this.activePresetId)
      ? this.activePresetId
      : this.presets[0]?.id || '';
    const options = this.presets.map(character => `
      <option value="${this.escapeHtml(character.id)}"${character.id === selectedId ? ' selected' : ''}>
        ${this.escapeHtml(character.name)}
      </option>
    `).join('');

    const panel = this.renderPanel(field, `
      <div class="bd-character-ai-header">
        <div>
          <div class="bd-character-ai-title">Character Prefill</div>
          <div class="bd-character-ai-subtitle">${this.scenario?.placeholders?.length || 0} placeholder questions found</div>
        </div>
      </div>
      <div class="bd-character-ai-body">
        <label class="bd-character-ai-label" for="bd-character-ai-select">Play as</label>
        <div class="bd-character-ai-picker">
          <select id="bd-character-ai-select" class="bd-character-ai-select">
            ${options}
          </select>
          <button id="bd-character-ai-generate" class="bd-character-ai-btn bd-character-ai-btn-primary">Generate</button>
        </div>
      </div>
    `);
    if (!panel) return;

    const select = panel.querySelector('#bd-character-ai-select');
    const generate = panel.querySelector('#bd-character-ai-generate');
    generate?.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const characterId = select?.value || selectedId;
      if (!characterId) return;
      await this.generateSessionForCharacter(characterId, field);
    });
  }

  showGeneratingPanel(field) {
    this.renderPanel(field, `
      <div class="bd-character-ai-header">
        <div>
          <div class="bd-character-ai-title">Generating Character Answers</div>
          <div class="bd-character-ai-subtitle">Gemini is reading the scenario placeholders.</div>
        </div>
        <div class="bd-character-ai-spinner"></div>
      </div>
    `);
  }

  showBlockedPanel(field, message) {
    this.renderPanel(field, `
      <div class="bd-character-ai-header">
        <div>
          <div class="bd-character-ai-title">Character Prefill Unavailable</div>
          <div class="bd-character-ai-subtitle">${this.escapeHtml(message || 'Character Presets cannot run right now.')}</div>
        </div>
      </div>
    `);
  }

  showAnswerPanel(field) {
    if (this.manualDismissedQuestions.has(field.question)) {
      this.removePanel();
      return;
    }

    const question = this.findBestQuestionMatch(field.question);
    const answer = question ? this.session?.answers?.[question] : null;
    const character = this.presets.find(p => p.id === this.session?.characterId);

    if (!question || !answer || answer.deferToPlayer || !answer.answer) {
      const panel = this.renderPanel(field, `
        <div class="bd-character-ai-header">
          <div>
            <div class="bd-character-ai-title">Answer Manually</div>
            <div class="bd-character-ai-subtitle">Gemini was not confident enough to answer this placeholder.</div>
          </div>
        </div>
        ${answer?.reason ? `<div class="bd-character-ai-reason">${this.escapeHtml(answer.reason)}</div>` : ''}
        <div class="bd-character-ai-actions">
          <button id="bd-character-ai-manual" class="bd-character-ai-btn bd-character-ai-btn-secondary">Answer Manually</button>
        </div>
      `);
      panel?.querySelector('#bd-character-ai-manual')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.manualDismissedQuestions.add(field.question);
        this.removePanel();
        field.input.focus();
      });
      return;
    }

    const panel = this.renderPanel(field, `
      <div class="bd-character-ai-header">
        <div>
          <div class="bd-character-ai-title">${this.escapeHtml(character?.name || 'Character')} Suggestion</div>
          <div class="bd-character-ai-subtitle">${this.escapeHtml(field.question)}</div>
        </div>
      </div>
      <div class="bd-character-ai-answer">${this.escapeHtml(answer.answer)}</div>
      ${answer.reason ? `<div class="bd-character-ai-reason">${this.escapeHtml(answer.reason)}</div>` : ''}
      <div class="bd-character-ai-actions">
        <button id="bd-character-ai-manual" class="bd-character-ai-btn bd-character-ai-btn-secondary">Answer Manually</button>
        <button id="bd-character-ai-edit" class="bd-character-ai-btn bd-character-ai-btn-secondary">Edit</button>
        <button id="bd-character-ai-use" class="bd-character-ai-btn bd-character-ai-btn-primary">Use</button>
      </div>
    `);
    if (!panel) return;

    panel.querySelector('#bd-character-ai-use')?.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.fillAndContinue(field, answer.answer);
    });

    panel.querySelector('#bd-character-ai-manual')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.manualDismissedQuestions.add(field.question);
      this.removePanel();
      field.input.focus();
    });

    panel.querySelector('#bd-character-ai-edit')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showEditPanel(field, question, answer.answer);
    });
  }

  showEditPanel(field, question, value) {
    const panel = this.renderPanel(field, `
      <div class="bd-character-ai-header">
        <div>
          <div class="bd-character-ai-title">Edit Suggested Answer</div>
          <div class="bd-character-ai-subtitle">${this.escapeHtml(field.question)}</div>
        </div>
      </div>
      <textarea id="bd-character-ai-edit-text" class="bd-character-ai-textarea">${this.escapeHtml(value)}</textarea>
      <div class="bd-character-ai-actions">
        <button id="bd-character-ai-cancel" class="bd-character-ai-btn bd-character-ai-btn-secondary">Cancel</button>
        <button id="bd-character-ai-use-edit" class="bd-character-ai-btn bd-character-ai-btn-primary">Use Edited</button>
      </div>
    `);
    if (!panel) return;

    const textarea = panel.querySelector('#bd-character-ai-edit-text');
    textarea?.focus();
    textarea?.select();

    panel.querySelector('#bd-character-ai-cancel')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showAnswerPanel(field);
    });

    panel.querySelector('#bd-character-ai-use-edit')?.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const edited = textarea?.value?.trim() || value;
      if (this.session?.answers?.[question]) {
        this.session.answers[question] = {
          ...this.session.answers[question],
          answer: edited,
          deferToPlayer: false,
          reason: 'Edited for this scenario session.',
        };
        await this.saveSession();
      }
      await this.fillAndContinue(field, edited);
    });
  }

  findBestQuestionMatch(question) {
    if (!this.session?.answers) return null;
    if (this.session.answers[question]) return question;
    const trimmed = String(question || '').trim();
    if (this.session.answers[trimmed]) return trimmed;
    const lower = trimmed.toLowerCase();
    return Object.keys(this.session.answers).find(key => key.trim().toLowerCase() === lower) || null;
  }

  async fillAndContinue(field, value) {
    if (this.isApplying) return;
    this.isApplying = true;
    this.removePanel();

    try {
      const input = document.getElementById('full-screen-text-input') || field.input;
      await this.typewriterFill(input, value);
      const continueBtn = this.findAdvanceButton(field);
      if (continueBtn) {
        setTimeout(() => continueBtn.click(), 150);
      }
    } catch (error) {
      console.error('[CharacterPreset] Fill failed:', error);
      this.showToast('Could not fill the answer', 'error');
    } finally {
      setTimeout(() => {
        this.isApplying = false;
        this.debouncedCheck();
      }, 300);
    }
  }

  findAdvanceButton(field) {
    const searchRoot = field ? (this.getFieldContainer(field) || document) : document;
    const buttons = searchRoot.querySelectorAll('[role="button"], button');
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() || '';
      if ((text.includes('next') || text.includes('start') || text.includes('continue')) && !text.includes('back')) {
        return btn;
      }
    }
    return null;
  }

  typewriterFill(input, text) {
    return new Promise((resolve) => {
      input.focus();

      const proto = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const value = String(text || '');

      if (!nativeSetter) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        resolve();
        return;
      }

      const firstChar = value.charAt(0) || ' ';
      nativeSetter.call(input, firstChar);
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: firstChar,
      }));

      setTimeout(() => {
        nativeSetter.call(input, value);
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value,
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        resolve();
      }, 50);
    });
  }

  // ============================================
  // UTILITIES
  // ============================================

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
  }

  truncate(text, maxLength) {
    const value = String(text || '');
    if (value.length <= maxLength) return value;
    return value.slice(0, Math.max(0, maxLength - 24)) + '\n[truncated for length]';
  }

  showToast(message, type = 'info') {
    const existingToast = document.querySelector('.bd-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `bd-toast bd-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('bd-toast-visible'));

    setTimeout(() => {
      toast.classList.remove('bd-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

if (typeof window !== 'undefined') {
  window.CharacterPresetFeature = CharacterPresetFeature;
}
