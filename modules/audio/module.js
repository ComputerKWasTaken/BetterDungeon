// modules/audio/module.js
//
// Ultrascripts Audio module. Consumes `ultrascripts:state:audio` and turns a
// small declarative state object into bounded Web Audio synthesis.

(function () {
  if (window.UltrascriptsAudioModule) return;

  const MODULE_ID = 'audio';
  const STATE_NAME = 'audio';
  const SUPPORTED_WAVEFORMS = new Set(['sine', 'square', 'triangle', 'sawtooth', 'noise']);
  const MAX_EFFECT_ID_LENGTH = 160;
  const MIN_FREQUENCY = 20;
  const MAX_FREQUENCY = 20000;
  const MIN_DURATION_MS = 20;
  const MAX_DURATION_MS = 10000;

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeVolume(value, fallback = 1) {
    return clamp(finiteNumber(value, fallback), 0, 1);
  }

  function normalizeTone(raw) {
    if (!isObject(raw)) return { error: 'effect must be an object' };

    const waveform = String(raw.waveform || 'sine').toLowerCase();
    if (!SUPPORTED_WAVEFORMS.has(waveform)) {
      return { error: `unsupported waveform '${waveform}'` };
    }

    const durationMs = finiteNumber(raw.durationMs, 250);
    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      return { error: `durationMs must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}` };
    }

    let frequency = null;
    let endFrequency = null;
    if (waveform !== 'noise') {
      frequency = finiteNumber(raw.frequency, NaN);
      if (!Number.isFinite(frequency) || frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) {
        return { error: `frequency must be between ${MIN_FREQUENCY} and ${MAX_FREQUENCY}` };
      }

      if (raw.endFrequency !== undefined && raw.endFrequency !== null) {
        endFrequency = finiteNumber(raw.endFrequency, NaN);
        if (!Number.isFinite(endFrequency)
          || endFrequency < MIN_FREQUENCY
          || endFrequency > MAX_FREQUENCY) {
          return { error: `endFrequency must be between ${MIN_FREQUENCY} and ${MAX_FREQUENCY}` };
        }
      }
    }

    const attackMs = clamp(finiteNumber(raw.attackMs, 5), 0, durationMs);
    const releaseMs = clamp(finiteNumber(raw.releaseMs, Math.min(80, durationMs / 2)), 0, durationMs);
    if (attackMs + releaseMs > durationMs) {
      return { error: 'attackMs and releaseMs cannot exceed durationMs when combined' };
    }

    return {
      tone: {
        waveform,
        frequency,
        endFrequency,
        durationMs,
        attackMs,
        releaseMs,
        volume: normalizeVolume(raw.volume, 0.7),
      },
    };
  }

  function normalizeState(raw) {
    if (!isObject(raw)) return { error: 'Audio state must be an object' };
    if (raw.v !== 1) return { error: `Unsupported Audio state version: ${raw.v}` };

    let effect = null;
    if (raw.effect !== undefined && raw.effect !== null) {
      if (!isObject(raw.effect)) return { error: 'effect must be an object or null' };
      const id = String(raw.effect.id || '').trim();
      if (!id) return { error: 'effect.id is required' };
      if (id.length > MAX_EFFECT_ID_LENGTH) {
        return { error: `effect.id cannot exceed ${MAX_EFFECT_ID_LENGTH} characters` };
      }

      const normalized = normalizeTone(raw.effect);
      if (normalized.error) return normalized;
      effect = { id, ...normalized.tone };
    }

    return { state: { effect } };
  }

  const UltrascriptsAudioModule = {
    id: MODULE_ID,
    version: '1.0.0',
    label: 'Audio',
    description: 'Plays bounded synthesized sound effects from Audio state.',
    stateNames: [STATE_NAME],

    _ctx: null,
    _audioContext: null,
    _masterGain: null,
    _sources: new Set(),
    _desiredState: null,
    _lastEffectId: null,
    _unlockHandler: null,
    _warnedUnsupported: false,

    mount(ctx) {
      this._ctx = ctx;
      this._lastEffectId = this.readLastEffectId();
      this.installUnlockListeners();
      ctx.log('debug', 'Audio mounted');
    },

    unmount() {
      this.removeUnlockListeners();
      this.stopAll();
      const audioContext = this._audioContext;
      this._audioContext = null;
      this._masterGain = null;
      this._desiredState = null;
      this._ctx = null;
      if (audioContext && audioContext.state !== 'closed') {
        try { audioContext.close(); } catch { /* noop */ }
      }
    },

    onDisable(ctx) {
      ctx.log('debug', 'Audio disabled; stopping playback');
      this.stopAll();
    },

    onAdventureChange(_newAdventureShortId, ctx) {
      this.stopAll();
      this._desiredState = null;
      this._lastEffectId = this.readLastEffectId(ctx.getAdventureId());
    },

    onStateChange(name, parsed, ctx) {
      if (name !== STATE_NAME) return;

      if (parsed == null) {
        this._desiredState = null;
        this.stopAll();
        return;
      }

      const normalized = normalizeState(parsed);
      if (normalized.error) {
        ctx.log('warn', `Ignoring invalid Audio state: ${normalized.error}`);
        return;
      }

      this._desiredState = normalized.state;
      this.applyDesiredState();
    },

    installUnlockListeners() {
      if (this._unlockHandler) return;
      this._unlockHandler = () => {
        this.unlockAudio().catch((err) => {
          this._ctx?.log?.('warn', 'Audio could not be unlocked:', err?.message || err);
        });
      };
      document.addEventListener('pointerdown', this._unlockHandler, true);
      document.addEventListener('keydown', this._unlockHandler, true);
      document.addEventListener('touchstart', this._unlockHandler, true);
    },

    removeUnlockListeners() {
      if (!this._unlockHandler) return;
      document.removeEventListener('pointerdown', this._unlockHandler, true);
      document.removeEventListener('keydown', this._unlockHandler, true);
      document.removeEventListener('touchstart', this._unlockHandler, true);
      this._unlockHandler = null;
    },

    ensureAudioContext() {
      if (this._audioContext && this._audioContext.state !== 'closed') return this._audioContext;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        if (!this._warnedUnsupported) {
          this._warnedUnsupported = true;
          this._ctx?.log?.('warn', 'Web Audio is unavailable on this client.');
        }
        return null;
      }

      const audioContext = new AudioContextClass();
      const masterGain = audioContext.createGain();
      masterGain.gain.value = 0.8;
      masterGain.connect(audioContext.destination);
      this._audioContext = audioContext;
      this._masterGain = masterGain;
      return audioContext;
    },

    async unlockAudio() {
      if (!this._desiredState?.effect) return true;
      const audioContext = this.ensureAudioContext();
      if (!audioContext) return false;
      if (audioContext.state === 'suspended') await audioContext.resume();
      this.applyDesiredState();
      return audioContext.state === 'running';
    },

    applyDesiredState() {
      const desired = this._desiredState;
      if (!desired) {
        this.stopAll();
        return;
      }

      if (!desired.effect) {
        this.stopAll();
        return;
      }

      const audioContext = this.ensureAudioContext();
      if (!audioContext || audioContext.state !== 'running') return;

      if (desired.effect && desired.effect.id !== this._lastEffectId) {
        try {
          this.scheduleTone(desired.effect, audioContext.currentTime + 0.01, this._masterGain);
          this._lastEffectId = desired.effect.id;
          this.writeLastEffectId(desired.effect.id);
        } catch (err) {
          this._ctx?.log?.('warn', 'Audio effect failed:', err?.message || err);
        }
      }
    },

    stopSources() {
      for (const entry of [...this._sources]) {
        try { entry.source.stop(); } catch { /* already stopped */ }
        try { entry.source.disconnect(); } catch { /* noop */ }
        try { entry.gain.disconnect(); } catch { /* noop */ }
        this._sources.delete(entry);
      }
    },

    stopAll() {
      this.stopSources();
    },

    createNoiseSource(audioContext, durationSeconds) {
      const frameCount = Math.max(1, Math.ceil(audioContext.sampleRate * durationSeconds));
      const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2) - 1;
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      return source;
    },

    scheduleTone(tone, startTime, output) {
      const audioContext = this._audioContext;
      if (!audioContext || !output) return;

      const durationSeconds = tone.durationMs / 1000;
      const endTime = startTime + durationSeconds;
      const attackSeconds = tone.attackMs / 1000;
      const releaseSeconds = tone.releaseMs / 1000;
      const releaseStart = Math.max(startTime + attackSeconds, endTime - releaseSeconds);
      const gain = audioContext.createGain();
      const volume = normalizeVolume(tone.volume, 0.7);

      gain.gain.setValueAtTime(attackSeconds > 0 ? 0 : volume, startTime);
      if (attackSeconds > 0) {
        gain.gain.linearRampToValueAtTime(volume, startTime + attackSeconds);
      }
      gain.gain.setValueAtTime(volume, releaseStart);
      if (releaseSeconds > 0) gain.gain.linearRampToValueAtTime(0, endTime);
      else gain.gain.setValueAtTime(0, endTime);
      gain.connect(output);

      let source;
      if (tone.waveform === 'noise') {
        source = this.createNoiseSource(audioContext, durationSeconds);
      } else {
        source = audioContext.createOscillator();
        source.type = tone.waveform;
        source.frequency.setValueAtTime(tone.frequency, startTime);
        if (tone.endFrequency) {
          source.frequency.exponentialRampToValueAtTime(tone.endFrequency, endTime);
        }
      }

      const entry = { source, gain };
      this._sources.add(entry);
      source.connect(gain);
      source.onended = () => {
        try { source.disconnect(); } catch { /* noop */ }
        try { gain.disconnect(); } catch { /* noop */ }
        this._sources.delete(entry);
      };
      source.start(startTime);
      source.stop(endTime + 0.02);
    },

    effectStorageKey(adventureId = this._ctx?.getAdventureId?.()) {
      return adventureId ? `ultrascripts_audio_effect_${adventureId}` : null;
    },

    readLastEffectId(adventureId) {
      const key = this.effectStorageKey(adventureId);
      if (!key) return null;
      try { return sessionStorage.getItem(key); }
      catch { return null; }
    },

    writeLastEffectId(id) {
      const key = this.effectStorageKey();
      if (!key) return;
      try { sessionStorage.setItem(key, id); } catch { /* storage unavailable */ }
    },

    inspect() {
      return {
        mounted: !!this._ctx,
        supported: !!(window.AudioContext || window.webkitAudioContext),
        contextState: this._audioContext?.state || 'not-created',
        activeSources: this._sources.size,
        lastEffectId: this._lastEffectId,
        waveforms: [...SUPPORTED_WAVEFORMS],
      };
    },
  };

  window.UltrascriptsAudioModule = UltrascriptsAudioModule;

  if (window.Ultrascripts?.registry) {
    window.Ultrascripts.registry.register(UltrascriptsAudioModule);
  } else {
    console.warn('[Audio] Ultrascripts registry not available; Audio module not registered.');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UltrascriptsAudioModule;
  }
})();
