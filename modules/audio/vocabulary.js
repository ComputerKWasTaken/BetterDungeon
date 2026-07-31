// modules/audio/vocabulary.js
//
// Ultrascripts Audio cue vocabulary, v1. The vocabulary is closed and
// versioned: scripts reference cue IDs, never files or synth internals.
// Every cue resolves to a synth recipe (see engine.js). Unknown cues
// cascade toward a parent cue, so no cue can hard-fail — worst case a
// request degrades to a generic bed or silence.

(function () {
  if (window.UltrascriptsAudioVocabulary) return;

  const VOCABULARY_VERSION = 1;

  // Each cue: { recipe, params?, bus? }. `bus` is a hint used when a
  // one-shot cue is played on the sfx/stinger path; looping cues are
  // placed on the bus the state entry arrived on (music or ambience).
  const CUES = {
    // --- music ---
    'music.lofi.chill': { recipe: 'lofiBed', params: { warmth: 0.8 } },
    'music.calm': { recipe: 'lofiBed', params: { warmth: 0.6, sparse: true } },
    'music.mystery': { recipe: 'drone', params: { tension: 0.35, shimmer: true } },
    'music.tension': { recipe: 'drone', params: { tension: 0.6 } },
    'music.combat': { recipe: 'drone', params: { tension: 0.85, pulse: true } },
    'music.combat.boss': { recipe: 'drone', params: { tension: 1, pulse: true } },

    // --- weather ---
    'weather.rain.light': { recipe: 'rain', params: { intensity: 0.35 } },
    'weather.rain.heavy': { recipe: 'rain', params: { intensity: 0.85 } },
    'weather.storm': { recipe: 'storm', params: { intensity: 0.8 } },
    'weather.wind': { recipe: 'wind', params: { intensity: 0.5 } },
    'weather.wind.howling': { recipe: 'wind', params: { intensity: 0.9 } },
    'weather.snow': { recipe: 'wind', params: { intensity: 0.25, soft: true } },

    // --- places ---
    'place.forest.night': { recipe: 'night', params: {} },
    'place.cave': { recipe: 'cave', params: {} },
    'place.fire': { recipe: 'fire', params: {} },
    'place.water.stream': { recipe: 'stream', params: {} },

    // --- one-shot sfx ---
    'sfx.impact': { recipe: 'thump', params: { weight: 0.7 }, bus: 'sfx' },
    'sfx.door.open': { recipe: 'thump', params: { weight: 0.4, creak: true }, bus: 'sfx' },
    'sfx.door.close': { recipe: 'thump', params: { weight: 0.8 }, bus: 'sfx' },
    'sfx.sword.draw': { recipe: 'whoosh', params: { metallic: true }, bus: 'sfx' },
    'sfx.whoosh': { recipe: 'whoosh', params: {}, bus: 'sfx' },
    'sfx.chime': { recipe: 'chime', params: {}, bus: 'sfx' },
    'sfx.thunder': { recipe: 'thunder', params: {}, bus: 'sfx' },
    'sfx.heartbeat': { recipe: 'heartbeat', params: {}, bus: 'sfx' },

    // --- stingers ---
    'stinger.reveal': { recipe: 'sting', params: { bright: true }, bus: 'stinger' },
    'stinger.danger': { recipe: 'sting', params: { bright: false }, bus: 'stinger' },
  };

  // Where a cue family cascades when no entry (or ancestor entry) matches.
  const FAMILY_DEFAULTS = {
    music: 'music.calm',
    weather: 'weather.wind',
    place: 'place.forest.night',
    sfx: 'sfx.impact',
    stinger: 'stinger.reveal',
  };

  function normalizeCueId(cueId) {
    if (typeof cueId !== 'string') return '';
    return cueId.trim().toLowerCase().slice(0, 64);
  }

  // Resolves a cue ID to { id, recipe, params, bus }, walking up the
  // dot-hierarchy, then to the family default. Returns null only when the
  // family itself is unknown (caller treats that as silence).
  function resolve(cueId) {
    const id = normalizeCueId(cueId);
    if (!id) return null;

    const segments = id.split('.');
    for (let end = segments.length; end >= 1; end -= 1) {
      const candidate = segments.slice(0, end).join('.');
      if (CUES[candidate]) {
        return { id: candidate, requested: id, ...CUES[candidate] };
      }
    }

    const fallbackId = FAMILY_DEFAULTS[segments[0]];
    if (fallbackId && CUES[fallbackId]) {
      return { id: fallbackId, requested: id, ...CUES[fallbackId] };
    }
    return null;
  }

  window.UltrascriptsAudioVocabulary = {
    version: VOCABULARY_VERSION,
    resolve,
    normalizeCueId,
    listCues: () => Object.keys(CUES),
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.UltrascriptsAudioVocabulary;
  }
})();
