// BetterDungeon - Text To Speech Feature
// Narrates the latest AI story output using the browser's free speechSynthesis voices.

class TextToSpeechFeature {
  static id = 'textToSpeech';

  constructor() {
    this.enabled = true;
    this.debug = false;

    this.storyContainerSelector = '#gameplay-output';
    this.settingsStorageKey = 'betterDungeon_textToSpeechSettings';
    this.defaultSettings = {
      voiceURI: 'auto',
      voiceName: '',
      rate: 0.96,
      pitch: 1,
      volume: 1,
      stableDelay: 1600,
      maxCharacters: 4500,
      minCharacters: 8,
      interrupt: true
    };

    this.settings = { ...this.defaultSettings };
    this.observer = null;
    this.debounceTimer = null;
    this.waitTimer = null;
    this.resumeTimer = null;
    this.currentUtterance = null;
    this.voices = [];
    this.hasPrimedCurrentStory = false;
    this.lastNarratedHash = null;
    this.lastObservedHash = null;

    this.boundVoiceChangeHandler = this.handleVoicesChanged.bind(this);
    this.boundStorageChangeHandler = this.handleStorageChanged.bind(this);
  }

  log(...args) {
    if (this.debug) {
      console.log('[TextToSpeech]', ...args);
    }
  }

  async init() {
    console.log('[TextToSpeech] Initializing Text To Speech feature...');

    if (!this.isSpeechAvailable()) {
      console.warn('[TextToSpeech] Browser speech synthesis is not available.');
      return;
    }

    await this.loadSettings();
    if (!this.enabled) return;

    await this.loadVoices();
    if (!this.enabled) return;

    this.attachGlobalListeners();
    this.startObserving();
    this.waitForStoryContainer();
  }

  destroy() {
    console.log('[TextToSpeech] Destroying Text To Speech feature...');
    this.enabled = false;
    this.stop();
    this.detachGlobalListeners();

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
  }

  isSpeechAvailable() {
    return typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof window.SpeechSynthesisUtterance !== 'undefined';
  }

  attachGlobalListeners() {
    if (window.speechSynthesis?.addEventListener) {
      window.speechSynthesis.addEventListener('voiceschanged', this.boundVoiceChangeHandler);
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.boundStorageChangeHandler);
    }
  }

  detachGlobalListeners() {
    if (window.speechSynthesis?.removeEventListener) {
      window.speechSynthesis.removeEventListener('voiceschanged', this.boundVoiceChangeHandler);
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.boundStorageChangeHandler);
    }
  }

  async loadSettings() {
    try {
      const result = await this.getStorageValue(this.settingsStorageKey);
      const saved = result?.[this.settingsStorageKey];
      if (saved && typeof saved === 'object') {
        this.settings = this.normalizeSettings(saved);
      }
    } catch (error) {
      console.warn('[TextToSpeech] Failed to load settings:', error);
      this.settings = { ...this.defaultSettings };
    }
  }

  setSettings(settings = {}) {
    this.settings = this.normalizeSettings({ ...this.settings, ...settings });
    this.saveSettings();
    this.log('Updated settings', this.settings);
  }

  normalizeSettings(settings = {}) {
    const merged = { ...this.defaultSettings, ...settings };
    return {
      ...merged,
      voiceURI: typeof merged.voiceURI === 'string' ? merged.voiceURI : 'auto',
      voiceName: typeof merged.voiceName === 'string' ? merged.voiceName : '',
      rate: this.clampNumber(merged.rate, 0.65, 1.35, this.defaultSettings.rate),
      pitch: this.clampNumber(merged.pitch, 0.75, 1.35, this.defaultSettings.pitch),
      volume: this.clampNumber(merged.volume, 0, 1, this.defaultSettings.volume),
      stableDelay: Math.round(this.clampNumber(merged.stableDelay, 700, 5000, this.defaultSettings.stableDelay)),
      maxCharacters: Math.round(this.clampNumber(merged.maxCharacters, 500, 8000, this.defaultSettings.maxCharacters)),
      minCharacters: Math.round(this.clampNumber(merged.minCharacters, 1, 100, this.defaultSettings.minCharacters)),
      interrupt: merged.interrupt !== false
    };
  }

  clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  getStorageValue(key) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
        resolve({});
        return;
      }

      chrome.storage.sync.get(key, (result) => {
        resolve(result || {});
      });
    });
  }

  saveSettings() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.set({ [this.settingsStorageKey]: this.settings });
      }
    } catch (error) {
      console.warn('[TextToSpeech] Failed to save settings:', error);
    }
  }

  handleStorageChanged(changes, areaName) {
    if (areaName !== 'sync') return;
    const change = changes?.[this.settingsStorageKey];
    if (!change?.newValue) return;
    this.settings = this.normalizeSettings(change.newValue);
  }

  async loadVoices() {
    if (!this.isSpeechAvailable()) return [];

    this.voices = window.speechSynthesis.getVoices() || [];
    if (this.voices.length > 0) {
      return this.voices;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    this.voices = window.speechSynthesis.getVoices() || [];
    return this.voices;
  }

  handleVoicesChanged() {
    this.voices = window.speechSynthesis.getVoices() || [];
  }

  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      if (!this.enabled) return;

      for (const mutation of mutations) {
        if (this.isRelevantMutation(mutation)) {
          this.scheduleNarrationCheck();
          return;
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-hidden', 'class', 'style']
    });
  }

  waitForStoryContainer() {
    if (!this.enabled) return;

    const container = this.findStoryContainer();
    if (container) {
      this.primeCurrentStory();
      return;
    }

    this.waitTimer = setTimeout(() => this.waitForStoryContainer(), 500);
  }

  isRelevantMutation(mutation) {
    const container = this.findStoryContainer();
    if (!container) return true;

    if (container.contains(mutation.target)) return true;

    for (const node of mutation.addedNodes || []) {
      if (node.nodeType === Node.ELEMENT_NODE && (node === container || container.contains(node) || node.querySelector?.(this.storyContainerSelector))) {
        return true;
      }
    }

    return false;
  }

  primeCurrentStory() {
    const text = this.getLatestStoryText();
    if (!text) return;

    const hash = this.hashText(text);
    this.hasPrimedCurrentStory = true;
    this.lastObservedHash = hash;
    this.lastNarratedHash = hash;
    this.log('Primed current story text');
  }

  scheduleNarrationCheck() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.narrateLatestStoryIfChanged();
    }, this.settings.stableDelay);
  }

  narrateLatestStoryIfChanged() {
    if (!this.enabled || !this.isSpeechAvailable()) return;

    const text = this.getLatestStoryText();
    if (!text) {
      this.waitForStoryContainer();
      return;
    }

    const hash = this.hashText(text);
    this.lastObservedHash = hash;

    if (!this.hasPrimedCurrentStory) {
      this.hasPrimedCurrentStory = true;
      this.lastNarratedHash = hash;
      return;
    }

    if (hash === this.lastNarratedHash) return;

    this.lastNarratedHash = hash;
    this.speak(text);
  }

  findStoryContainer() {
    return document.querySelector(this.storyContainerSelector);
  }

  getLatestStoryText() {
    const element = this.findLatestStoryElement();
    if (!element) return '';
    return this.cleanTextForSpeech(this.extractElementText(element));
  }

  findLatestStoryElement() {
    const container = this.findStoryContainer();
    if (!container) return null;

    const lastActionElements = Array.from(container.querySelectorAll('[aria-label^="Last action:"]'))
      .filter((element) => this.isNarratableStoryElement(element));

    if (lastActionElements.length > 0) {
      return lastActionElements[lastActionElements.length - 1];
    }

    const storyDocuments = Array.from(container.querySelectorAll('[role="document"]'))
      .filter((element) => this.isNarratableStoryElement(element));

    if (storyDocuments.length > 0) {
      return storyDocuments[storyDocuments.length - 1];
    }

    const storySpans = Array.from(container.querySelectorAll('span[id="transition-opacity"]'))
      .filter((element) => this.isNarratableStoryElement(element));

    return storySpans.length > 0 ? storySpans[storySpans.length - 1] : null;
  }

  isNarratableStoryElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;

    if (element.closest('#action-text')) return false;
    if (element.closest('[aria-label^="Action "]')) return false;
    if (element.closest('[aria-label="Command bar"]')) return false;
    if (element.closest('[role="toolbar"]')) return false;
    if (element.closest('textarea, input, button')) return false;

    const text = this.cleanTextForSpeech(this.extractElementText(element));
    return text.length >= this.settings.minCharacters;
  }

  extractElementText(element) {
    if (!element) return '';
    return element.innerText || element.textContent || '';
  }

  cleanTextForSpeech(text) {
    let clean = String(text || '');

    clean = clean.replace(/^\s*Last action:\s*/i, '');
    clean = clean.replace(/\u00a0/g, ' ');
    clean = clean.replace(/https?:\/\/\S+/gi, ' link ');
    clean = clean.replace(/\b[\w-]*_icon\b/gi, ' ');
    clean = clean.replace(/\bw_[a-z0-9_]+\b/gi, ' ');
    clean = clean.replace(/^\s*>>\s?/gm, '');
    clean = clean.replace(/^\s*[-*]\s+/gm, '');
    clean = clean.replace(/(\+\+|\/\/|==|~~|::)/g, '');
    clean = clean.replace(/\s+/g, ' ').trim();

    if (clean.length > this.settings.maxCharacters) {
      const clipped = clean.slice(0, this.settings.maxCharacters);
      clean = `${clipped.replace(/\s+\S*$/, '').trim()}...`;
    }

    return clean;
  }

  async speak(text) {
    if (!text) return;

    await this.loadVoices();
    if (!this.enabled) return;

    const synth = window.speechSynthesis;
    if (this.settings.interrupt) {
      this.stop();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.resolveVoice();

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || navigator.language || 'en-US';
    } else {
      utterance.lang = navigator.language || 'en-US';
    }

    utterance.rate = this.settings.rate;
    utterance.pitch = this.settings.pitch;
    utterance.volume = this.settings.volume;

    utterance.onstart = () => this.startResumeWatch();
    utterance.onend = () => this.clearResumeWatch();
    utterance.onerror = (event) => {
      this.clearResumeWatch();
      this.log('Speech error', event);
    };

    this.currentUtterance = utterance;
    synth.speak(utterance);

    if (synth.paused) {
      synth.resume();
    }
  }

  resolveVoice() {
    const voices = this.voices.length > 0 ? this.voices : window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    if (this.settings.voiceURI && this.settings.voiceURI !== 'auto') {
      const selected = voices.find((voice) => voice.voiceURI === this.settings.voiceURI) ||
        voices.find((voice) => `${voice.name}|${voice.lang}` === this.settings.voiceURI) ||
        voices.find((voice) => voice.name === this.settings.voiceName);

      if (selected) return selected;
    }

    return this.pickBestNaturalVoice(voices);
  }

  pickBestNaturalVoice(voices) {
    const preferredLanguage = (navigator.language || 'en-US').toLowerCase();
    const preferredBase = preferredLanguage.split('-')[0];

    return [...voices].sort((a, b) => {
      return this.scoreVoice(b, preferredLanguage, preferredBase) - this.scoreVoice(a, preferredLanguage, preferredBase);
    })[0] || null;
  }

  scoreVoice(voice, preferredLanguage, preferredBase) {
    const name = `${voice.name || ''} ${voice.voiceURI || ''}`.toLowerCase();
    const lang = (voice.lang || '').toLowerCase();
    let score = 0;

    if (lang === preferredLanguage) score += 50;
    if (lang.split('-')[0] === preferredBase) score += 30;
    if (preferredBase === 'en' && lang.startsWith('en')) score += 15;
    if (voice.default) score += 8;
    if (voice.localService) score += 4;
    if (/natural|neural|premium|enhanced|online|google|microsoft|samantha|alex|ava|jenny|aria|guy|libby|sonia|daniel/.test(name)) score += 25;
    if (/compact|novelty|whisper|robot|zarvox/.test(name)) score -= 20;

    return score;
  }

  startResumeWatch() {
    this.clearResumeWatch();
    this.resumeTimer = setInterval(() => {
      const synth = window.speechSynthesis;
      if (synth.speaking && synth.paused) {
        synth.resume();
      }
      if (!synth.speaking) {
        this.clearResumeWatch();
      }
    }, 10000);
  }

  clearResumeWatch() {
    if (this.resumeTimer) {
      clearInterval(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.currentUtterance = null;
  }

  stop() {
    this.clearResumeWatch();
    if (this.isSpeechAvailable()) {
      window.speechSynthesis.cancel();
    }
  }

  hashText(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    }
    return `${text.length}:${hash >>> 0}`;
  }
}

if (typeof window !== 'undefined') {
  window.TextToSpeechFeature = TextToSpeechFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextToSpeechFeature;
}
