// modules/audio/module.js
//
// Ultrascripts Audio module. Consumes `ultrascripts:state:audio` and
// reconciles the local soundscape toward it: one crossfaded music bed,
// up to MAX_AMBIENCE looping ambience beds, and seq-guarded one-shots.
//
// The contract is declarative and fire-and-forget: scripts write desired
// state and never receive a per-cue response. The only op is the read-only
// `state` query. Volumes, mute, and the module toggle belong to the user
// (popup) and are never script-controllable.
//
// State card shape (all fields optional):
//   {
//     "v": 1,
//     "music":    { "cue": "music.lofi.chill", "intensity": 0.8 } | null,
//     "ambience": [ { "cue": "weather.rain.light", "gain": 0.6 }, ... ],
//     "oneshots": [ { "seq": 41, "cue": "sfx.door.close" }, ... ]
//   }
//
// One-shots replay-guard: the module keeps an in-memory high-water seq.
// The first state seen after mount/adventure-change primes the mark
// without playing, so reloading a page never re-fires old door slams.

(function () {
  if (window.UltrascriptsAudioModule) return;

  const MODULE_ID = 'audio';
  const STATE_NAME = 'audio';
  const SETTINGS_STORAGE_KEY = 'ultrascripts_audio_settings';
  const MAX_AMBIENCE = 4;
  const MAX_ONESHOTS_PER_STATE = 8;

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clamp01(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  function getVocabulary() {
    return window.UltrascriptsAudioVocabulary || null;
  }

  function normalizeMusic(raw, warnings) {
    if (raw === null || raw === undefined) return null;
    if (!isObject(raw)) {
      warnings.push('music must be an object or null');
      return null;
    }
    const vocabulary = getVocabulary();
    const resolved = vocabulary?.resolve(raw.cue);
    if (!resolved) {
      warnings.push(`music cue '${raw.cue}' did not resolve; muting music`);
      return null;
    }
    return { resolved, intensity: clamp01(raw.intensity, 0.7) };
  }

  function normalizeAmbience(raw, warnings) {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) {
      warnings.push('ambience must be an array');
      return [];
    }
    const vocabulary = getVocabulary();
    const entries = [];
    for (const item of raw) {
      if (entries.length >= MAX_AMBIENCE) {
        warnings.push(`ambience truncated to ${MAX_AMBIENCE} entries`);
        break;
      }
      if (!isObject(item)) continue;
      const resolved = vocabulary?.resolve(item.cue);
      if (!resolved) {
        warnings.push(`ambience cue '${item.cue}' did not resolve; skipped`);
        continue;
      }
      if (entries.some(entry => entry.resolved.id === resolved.id)) continue;
      entries.push({ resolved, gain: clamp01(item.gain, 0.6) });
    }
    return entries;
  }

  function normalizeOneshots(raw, warnings) {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) {
      warnings.push('oneshots must be an array');
      return [];
    }
    return raw
      .filter(item => isObject(item) && Number.isFinite(Number(item.seq)))
      .map(item => ({ seq: Math.floor(Number(item.seq)), cue: item.cue }))
      .sort((a, b) => a.seq - b.seq)
      .slice(-MAX_ONESHOTS_PER_STATE);
  }

  const UltrascriptsAudioModule = {
    id: MODULE_ID,
    version: '0.1.0',
    label: 'Audio',
    description: 'Plays script-declared music, ambience, and sound-effect cues through a local synthesizer.',
    stateNames: [STATE_NAME],

    _ctx: null,
    _engine: null,
    _settingsListener: null,
    _oneshotHigh: 0,
    _oneshotPrimed: false,
    _warnedMessages: new Set(),

    ops: {
      state: {
        idempotent: 'safe',
        timeoutMs: 1000,
        handler(_args, _ctx) {
          const engine = window.UltrascriptsAudioModule._engine;
          const vocabulary = getVocabulary();
          return {
            vocabularyVersion: vocabulary?.version ?? null,
            cues: vocabulary?.listCues() ?? [],
            playback: engine ? engine.inspect() : null,
            oneshotAckSeq: window.UltrascriptsAudioModule._oneshotHigh,
          };
        },
      },
    },

    mount(ctx) {
      this._ctx = ctx;
      this._engine = new window.UltrascriptsAudioEngine({
        log: (level, ...args) => ctx.log(level, ...args),
      });
      this._oneshotHigh = 0;
      this._oneshotPrimed = false;
      this._loadSettings();
      this._attachSettingsListener();
      ctx.log('debug', 'Audio mounted');
    },

    unmount() {
      this._detachSettingsListener();
      this._engine?.destroy();
      this._engine = null;
      this._ctx = null;
      this._oneshotPrimed = false;
    },

    onDisable(ctx) {
      ctx.log('debug', 'Audio disabled');
      this._engine?.stopAll(0.4);
    },

    onAdventureChange(_shortId, ctx) {
      ctx.log('debug', 'Adventure changed; stopping audio');
      this._engine?.stopAll(0.8);
      this._oneshotHigh = 0;
      this._oneshotPrimed = false;
      this._warnedMessages.clear();
    },

    onStateChange(name, parsed, ctx) {
      if (name !== STATE_NAME) return;
      try {
        if (!this._engine) this.mount(ctx);

        if (parsed == null) {
          this._engine.stopAll();
          this._oneshotPrimed = false;
          return;
        }
        this.applyState(parsed, ctx);
      } catch (err) {
        ctx.log('warn', 'Audio onStateChange failed:', err);
      }
    },

    applyState(parsed, ctx) {
      if (!isObject(parsed)) {
        this.warnOnce(ctx, 'shape', 'Audio state card payload must be an object');
        return;
      }
      if (parsed.v !== 1) {
        this.warnOnce(ctx, 'version', `Unsupported Audio state version: ${parsed.v}`);
        return;
      }

      const warnings = [];
      const music = normalizeMusic(parsed.music, warnings);
      const ambience = normalizeAmbience(parsed.ambience, warnings);
      const oneshots = normalizeOneshots(parsed.oneshots, warnings);

      if (warnings.length) {
        this.warnOnce(ctx, 'state-warnings', 'Audio state warnings:', warnings);
      }

      this._engine.setMusic(music ? music.resolved : null, music ? music.intensity : 0);
      this._engine.setAmbience(ambience);
      this.playPendingOneshots(oneshots, ctx);
    },

    playPendingOneshots(oneshots, ctx) {
      const maxSeq = oneshots.reduce((max, item) => Math.max(max, item.seq), 0);

      if (!this._oneshotPrimed) {
        // First state after mount/adventure-change: prime without playing so
        // page reloads never replay old one-shots.
        this._oneshotHigh = Math.max(this._oneshotHigh, maxSeq);
        this._oneshotPrimed = true;
        return;
      }

      const vocabulary = getVocabulary();
      for (const item of oneshots) {
        if (item.seq <= this._oneshotHigh) continue;
        this._oneshotHigh = item.seq;
        const resolved = vocabulary?.resolve(item.cue);
        if (!resolved) {
          this.warnOnce(ctx, 'oneshot-cue', `One-shot cue '${item.cue}' did not resolve; skipped`);
          continue;
        }
        this._engine.playOneshot(resolved);
      }
    },

    warnOnce(ctx, key, message, details) {
      let detailKey;
      try { detailKey = JSON.stringify(details); }
      catch { detailKey = String(details); }
      const cacheKey = `${key}:${detailKey}`;
      if (this._warnedMessages.has(cacheKey)) return;
      this._warnedMessages.add(cacheKey);
      if (this._warnedMessages.size > 200) this._warnedMessages.clear();
      ctx?.log?.('warn', message, details ?? '');
    },

    _loadSettings() {
      try {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        api?.storage?.sync?.get?.(SETTINGS_STORAGE_KEY, (result) => {
          const saved = result?.[SETTINGS_STORAGE_KEY];
          if (this._engine) this._engine.setSettings(isObject(saved) ? saved : {});
        });
      } catch { /* storage unavailable — engine keeps defaults */ }
    },

    _attachSettingsListener() {
      try {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        if (!api?.storage?.onChanged?.addListener) return;
        this._settingsListener = (changes, area) => {
          if (area !== 'sync' || !changes[SETTINGS_STORAGE_KEY]) return;
          const value = changes[SETTINGS_STORAGE_KEY].newValue;
          if (this._engine) this._engine.setSettings(isObject(value) ? value : {});
        };
        api.storage.onChanged.addListener(this._settingsListener);
      } catch { /* storage unavailable */ }
    },

    _detachSettingsListener() {
      try {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        if (this._settingsListener && api?.storage?.onChanged?.removeListener) {
          api.storage.onChanged.removeListener(this._settingsListener);
        }
      } catch { /* storage unavailable */ }
      this._settingsListener = null;
    },

    inspect() {
      return {
        mounted: !!this._engine,
        vocabularyVersion: getVocabulary()?.version ?? null,
        oneshotAckSeq: this._oneshotHigh,
        oneshotPrimed: this._oneshotPrimed,
        playback: this._engine ? this._engine.inspect() : null,
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
