// modules/audio/engine.js
//
// Ultrascripts Audio playback engine. Owns the AudioContext, the bus graph
// (music / ambience / sfx / stinger -> master), crossfades, and the synth
// recipes referenced by vocabulary.js. Everything here is procedural Web
// Audio — no bundled samples.
//
// The context starts suspended under autoplay policy and is resumed by the
// first user gesture on the page.

(function () {
  if (window.UltrascriptsAudioEngine) return;

  const CROSSFADE_SEC = 2.5;
  const ONESHOT_TAIL_SEC = 6;
  const BUS_NAMES = ['music', 'ambience', 'sfx', 'stinger'];

  const DEFAULT_SETTINGS = {
    muted: false,
    masterVolume: 0.7,
    buses: { music: 0.8, ambience: 0.8, sfx: 0.9, stinger: 0.9 },
  };

  function clamp01(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  // ---------- procedural buffers ----------

  function makeNoiseBuffer(ctx, seconds, kind) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
      }
    } else if (kind === 'crackle') {
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() < 0.0012 ? (Math.random() * 2 - 1) * 0.8 : 0;
      }
    } else {
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return buffer;
  }

  // ---------- small node helpers ----------

  function makeLoopingNoise(ctx, kind, seconds = 3) {
    const source = ctx.createBufferSource();
    source.buffer = makeNoiseBuffer(ctx, seconds, kind);
    source.loop = true;
    return source;
  }

  function makeLfo(ctx, frequency, depth, target) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = frequency;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain);
    lfoGain.connect(target);
    lfo.start();
    return lfo;
  }

  function envGain(ctx, destination, { attack = 0.01, peak = 1, decay = 0.3, sustain = 0, release = 0.2, start = 0 }) {
    const gain = ctx.createGain();
    const t = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + attack + decay);
    if (sustain <= 0) {
      gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay + release);
    }
    gain.connect(destination);
    return gain;
  }

  // ---------- voice base ----------
  //
  // A voice is a running recipe instance: { output (GainNode), stop(fadeSec) }.
  // Recipes register their oscillators/sources/timers on the voice so stop()
  // can wind everything down after the fade.

  function makeVoice(ctx, destination) {
    const output = ctx.createGain();
    output.gain.value = 0.0001;
    output.connect(destination);

    const nodes = [];
    const timers = [];
    let stopped = false;

    return {
      output,
      ctx,
      track(node) { nodes.push(node); return node; },
      timer(id) { timers.push(id); return id; },
      fadeTo(level, seconds) {
        const t = ctx.currentTime;
        output.gain.cancelScheduledValues(t);
        output.gain.setValueAtTime(Math.max(output.gain.value, 0.0001), t);
        output.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), t + Math.max(seconds, 0.01));
      },
      get isStopped() { return stopped; },
      stop(fadeSec = CROSSFADE_SEC) {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        try {
          output.gain.cancelScheduledValues(t);
          output.gain.setValueAtTime(Math.max(output.gain.value, 0.0001), t);
          output.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(fadeSec, 0.01));
        } catch { /* context may be closing */ }
        setTimeout(() => {
          for (const id of timers) clearInterval(id);
          for (const node of nodes) {
            try { node.stop?.(); } catch { /* already stopped */ }
            try { node.disconnect?.(); } catch { /* already disconnected */ }
          }
          try { output.disconnect(); } catch { /* already disconnected */ }
        }, (Math.max(fadeSec, 0.01) + 0.25) * 1000);
      },
    };
  }

  // ---------- looping recipes ----------

  function recipeRain(voice, params) {
    const ctx = voice.ctx;
    const intensity = clamp01(params.intensity, 0.5);

    const layers = [
      { freq: 900 + intensity * 500, q: 0.6, gain: 0.5 },
      { freq: 2600 + intensity * 1500, q: 0.9, gain: 0.28 + intensity * 0.2 },
    ];
    for (const layer of layers) {
      const noise = voice.track(makeLoopingNoise(ctx, 'white', 4));
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = layer.freq;
      filter.Q.value = layer.q;
      const gain = ctx.createGain();
      gain.gain.value = layer.gain;
      voice.track(makeLfo(ctx, 0.07 + Math.random() * 0.08, layer.gain * 0.25, gain.gain));
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(voice.output);
      noise.start();
    }
    return { level: 0.35 + intensity * 0.3 };
  }

  function recipeWind(voice, params) {
    const ctx = voice.ctx;
    const intensity = clamp01(params.intensity, 0.5);
    const soft = !!params.soft;

    const noise = voice.track(makeLoopingNoise(ctx, 'pink', 5));
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = soft ? 300 : 400 + intensity * 300;
    filter.Q.value = soft ? 0.4 : 0.8;
    voice.track(makeLfo(ctx, 0.05 + intensity * 0.06, filter.frequency.value * 0.45, filter.frequency));

    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    voice.track(makeLfo(ctx, 0.11, 0.3 + intensity * 0.3, gain.gain));

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(voice.output);
    noise.start();
    return { level: (soft ? 0.2 : 0.3) + intensity * 0.3 };
  }

  function recipeStorm(voice, params) {
    const meta = recipeRain(voice, { intensity: Math.max(0.7, clamp01(params.intensity, 0.8)) });
    recipeWind(voice, { intensity: 0.7 });
    // Distant thunder every 12–35 seconds.
    voice.timer(setInterval(() => {
      if (voice.isStopped || Math.random() > 0.6) return;
      oneshotThunder(voice.ctx, voice.output, { distant: true });
    }, 12000 + Math.random() * 23000));
    return { level: Math.min(0.8, meta.level + 0.1) };
  }

  function recipeFire(voice) {
    const ctx = voice.ctx;
    const rumble = voice.track(makeLoopingNoise(ctx, 'pink', 4));
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 320;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.55;
    voice.track(makeLfo(ctx, 0.6, 0.12, rumbleGain.gain));
    rumble.connect(low);
    low.connect(rumbleGain);
    rumbleGain.connect(voice.output);
    rumble.start();

    const crackle = voice.track(makeLoopingNoise(ctx, 'crackle', 6));
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 1500;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.8;
    crackle.connect(high);
    high.connect(crackleGain);
    crackleGain.connect(voice.output);
    crackle.start();
    return { level: 0.45 };
  }

  function recipeStream(voice) {
    const ctx = voice.ctx;
    const noise = voice.track(makeLoopingNoise(ctx, 'white', 4));
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 0.5;
    voice.track(makeLfo(ctx, 0.9, 350, filter.frequency));
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    voice.track(makeLfo(ctx, 1.7, 0.08, gain.gain));
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(voice.output);
    noise.start();
    return { level: 0.4 };
  }

  function recipeNight(voice) {
    const ctx = voice.ctx;
    recipeWind(voice, { intensity: 0.15, soft: true });
    // Crickets: short high AM chirps at irregular intervals.
    voice.timer(setInterval(() => {
      if (voice.isStopped || Math.random() > 0.75) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 4200 + Math.random() * 600;
      const am = ctx.createGain();
      am.gain.value = 0;
      const trem = makeLfo(ctx, 28, 1, am.gain);
      const env = envGain(ctx, voice.output, { attack: 0.05, peak: 0.05, decay: 0.5, release: 0.2 });
      osc.connect(am);
      am.connect(env);
      osc.start();
      const stopAt = ctx.currentTime + 0.9;
      osc.stop(stopAt);
      trem.stop(stopAt);
    }, 1600));
    return { level: 0.35 };
  }

  function recipeCave(voice) {
    const ctx = voice.ctx;
    const osc = voice.track(ctx.createOscillator());
    osc.type = 'sine';
    osc.frequency.value = 55;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.25;
    voice.track(makeLfo(ctx, 0.05, 0.08, oscGain.gain));
    osc.connect(oscGain);
    oscGain.connect(voice.output);
    osc.start();

    recipeWind(voice, { intensity: 0.1, soft: true });
    // Occasional water drips: falling sine pips.
    voice.timer(setInterval(() => {
      if (voice.isStopped || Math.random() > 0.5) return;
      const drip = ctx.createOscillator();
      drip.type = 'sine';
      const t = ctx.currentTime;
      drip.frequency.setValueAtTime(1400 + Math.random() * 800, t);
      drip.frequency.exponentialRampToValueAtTime(500, t + 0.09);
      const env = envGain(ctx, voice.output, { attack: 0.002, peak: 0.09, decay: 0.12, release: 0.1 });
      drip.connect(env);
      drip.start();
      drip.stop(t + 0.3);
    }, 3500));
    return { level: 0.4 };
  }

  // Chord helper: frequencies for a chord voicing, as MIDI note numbers.
  function midiHz(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  const LOFI_PROGRESSION = [
    [53, 60, 64, 69], // Fmaj7 rootless-ish voicing
    [57, 64, 67, 72], // Am7
    [50, 60, 65, 69], // Dm7
    [48, 59, 64, 67], // Cmaj7
  ];
  const LOFI_PENTATONIC = [69, 72, 74, 76, 79, 81];

  function recipeLofiBed(voice, params) {
    const ctx = voice.ctx;
    const warmth = clamp01(params.warmth, 0.7);
    const sparse = !!params.sparse;
    const barSec = 60 / 72 * 4; // 72 bpm, one chord per bar

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 900 + warmth * 500;
    tone.Q.value = 0.4;
    tone.connect(voice.output);

    // Gentle level breathing across the bar, in place of sidechain pumping.
    const breathe = ctx.createGain();
    breathe.gain.value = 0.9;
    voice.track(makeLfo(ctx, 1 / barSec, 0.08, breathe.gain));
    breathe.connect(tone);

    // Delay line for melody plucks.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = barSec / 8 * 1.5;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const delayMix = ctx.createGain();
    delayMix.gain.value = 0.35;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(delayMix);
    delayMix.connect(tone);

    // Vinyl crackle.
    const crackle = voice.track(makeLoopingNoise(ctx, 'crackle', 8));
    const crackleHp = ctx.createBiquadFilter();
    crackleHp.type = 'highpass';
    crackleHp.frequency.value = 1800;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.35;
    crackle.connect(crackleHp);
    crackleHp.connect(crackleGain);
    crackleGain.connect(voice.output);
    crackle.start();

    let bar = 0;
    let nextBarAt = ctx.currentTime + 0.1;

    function scheduleBar(atTime, chord) {
      for (const note of chord) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midiHz(note);
        osc.detune.value = (Math.random() - 0.5) * 10;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, atTime);
        env.gain.linearRampToValueAtTime(0.11, atTime + barSec * 0.35);
        env.gain.setValueAtTime(0.11, atTime + barSec * 0.7);
        env.gain.exponentialRampToValueAtTime(0.0001, atTime + barSec * 1.15);
        osc.connect(env);
        env.connect(breathe);
        osc.start(atTime);
        osc.stop(atTime + barSec * 1.2);
      }

      // Sparse melody: at most one pluck per bar, randomly placed.
      const pluckChance = sparse ? 0.35 : 0.6;
      if (Math.random() < pluckChance) {
        const note = LOFI_PENTATONIC[Math.floor(Math.random() * LOFI_PENTATONIC.length)];
        const when = atTime + (Math.floor(Math.random() * 4) + Math.random() * 0.08) * (barSec / 4);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = midiHz(note);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, when);
        env.gain.linearRampToValueAtTime(0.12, when + 0.015);
        env.gain.exponentialRampToValueAtTime(0.0001, when + 1.4);
        osc.connect(env);
        env.connect(breathe);
        env.connect(delay);
        osc.start(when);
        osc.stop(when + 1.6);
      }
    }

    // Lookahead scheduler: keep ~2 bars queued.
    voice.timer(setInterval(() => {
      if (voice.isStopped) return;
      while (nextBarAt < ctx.currentTime + barSec * 2) {
        scheduleBar(nextBarAt, LOFI_PROGRESSION[bar % LOFI_PROGRESSION.length]);
        bar += 1;
        nextBarAt += barSec;
      }
    }, 500));

    return { level: 0.5 };
  }

  function recipeDrone(voice, params) {
    const ctx = voice.ctx;
    const tension = clamp01(params.tension, 0.5);
    const root = 41.2; // E1

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 250 + tension * 700;
    filter.Q.value = 0.7;
    voice.track(makeLfo(ctx, 0.06, filter.frequency.value * 0.3, filter.frequency));
    filter.connect(voice.output);

    const intervals = [1, 2.003]; // root + octave, slightly detuned
    if (tension > 0.4) intervals.push(2 * Math.pow(2, 1 / 12)); // minor 2nd above octave
    if (params.shimmer) intervals.push(4.02);

    for (const ratio of intervals) {
      const osc = voice.track(ctx.createOscillator());
      osc.type = tension > 0.6 ? 'sawtooth' : 'triangle';
      osc.frequency.value = root * ratio;
      osc.detune.value = (Math.random() - 0.5) * (6 + tension * 14);
      const gain = ctx.createGain();
      gain.gain.value = 0.16 / intervals.length + 0.1;
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
    }

    if (params.pulse) {
      // Slow kick-like pulse whose rate rises with tension.
      const interval = Math.max(380, 900 - tension * 450);
      voice.timer(setInterval(() => {
        if (voice.isStopped) return;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const t = ctx.currentTime;
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        const env = envGain(ctx, voice.output, { attack: 0.004, peak: 0.35, decay: 0.22, release: 0.1 });
        osc.connect(env);
        osc.start();
        osc.stop(t + 0.5);
      }, interval));
    }

    return { level: 0.35 + tension * 0.2 };
  }

  const LOOP_RECIPES = {
    rain: recipeRain,
    wind: recipeWind,
    storm: recipeStorm,
    fire: recipeFire,
    stream: recipeStream,
    night: recipeNight,
    cave: recipeCave,
    lofiBed: recipeLofiBed,
    drone: recipeDrone,
  };

  // ---------- one-shot recipes ----------

  function oneshotThump(ctx, destination, params = {}) {
    const weight = clamp01(params.weight, 0.6);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 + weight * 60, t);
    osc.frequency.exponentialRampToValueAtTime(30 + weight * 15, t + 0.18);
    const env = envGain(ctx, destination, { attack: 0.003, peak: 0.5 + weight * 0.3, decay: 0.25, release: 0.15 });
    osc.connect(env);
    osc.start();
    osc.stop(t + 0.6);

    if (params.creak) {
      const creak = ctx.createOscillator();
      creak.type = 'sawtooth';
      creak.frequency.setValueAtTime(160, t);
      creak.frequency.linearRampToValueAtTime(90, t + 0.5);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700;
      filter.Q.value = 6;
      const env2 = envGain(ctx, destination, { attack: 0.05, peak: 0.08, decay: 0.5, release: 0.2 });
      creak.connect(filter);
      filter.connect(env2);
      creak.start();
      creak.stop(t + 0.8);
    }
  }

  function oneshotWhoosh(ctx, destination, params = {}) {
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, 1, 'white');
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = params.metallic ? 4 : 1.2;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(params.metallic ? 5200 : 2400, t + 0.28);
    const env = envGain(ctx, destination, { attack: 0.03, peak: 0.4, decay: 0.3, release: 0.15 });
    noise.connect(filter);
    filter.connect(env);
    noise.start();
    noise.stop(t + 0.7);

    if (params.metallic) {
      const ring = ctx.createOscillator();
      ring.type = 'triangle';
      ring.frequency.value = 3400;
      const env2 = envGain(ctx, destination, { attack: 0.11, peak: 0.06, decay: 0.9, release: 0.3, start: 0.08 });
      ring.connect(env2);
      ring.start(t + 0.08);
      ring.stop(t + 1.6);
    }
  }

  function oneshotChime(ctx, destination) {
    const t = ctx.currentTime;
    const base = 880;
    for (const [ratio, level, decay] of [[1, 0.22, 2.2], [2.76, 0.1, 1.4], [5.4, 0.05, 0.8]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * ratio;
      const env = envGain(ctx, destination, { attack: 0.004, peak: level, decay, release: 0.4 });
      osc.connect(env);
      osc.start();
      osc.stop(t + decay + 1);
    }
  }

  function oneshotThunder(ctx, destination, params = {}) {
    const t = ctx.currentTime;
    const distant = !!params.distant;
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, 3, 'pink');
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(distant ? 220 : 900, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 2.2);
    const env = envGain(ctx, destination, {
      attack: distant ? 0.4 : 0.02,
      peak: distant ? 0.18 : 0.5,
      decay: 1.6,
      release: 0.8,
    });
    noise.connect(filter);
    filter.connect(env);
    noise.start();
    noise.stop(t + 3);
  }

  function oneshotHeartbeat(ctx, destination) {
    const beat = (offset, peak) => {
      const t = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const env = envGain(ctx, destination, { attack: 0.005, peak, decay: 0.16, release: 0.1, start: offset });
      osc.connect(env);
      osc.start(t);
      osc.stop(t + 0.4);
    };
    beat(0, 0.4);
    beat(0.28, 0.28);
  }

  function oneshotSting(ctx, destination, params = {}) {
    const t = ctx.currentTime;
    const bright = !!params.bright;
    const chord = bright ? [60, 64, 67, 72] : [57, 60, 63, 66]; // Cmaj vs Adim-ish
    for (const note of chord) {
      const osc = ctx.createOscillator();
      osc.type = bright ? 'triangle' : 'sawtooth';
      osc.frequency.value = midiHz(note);
      osc.detune.value = (Math.random() - 0.5) * 8;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(bright ? 2500 : 500, t);
      filter.frequency.exponentialRampToValueAtTime(bright ? 4000 : 1800, t + 0.7);
      const env = envGain(ctx, destination, { attack: bright ? 0.02 : 0.5, peak: 0.12, decay: 1.6, release: 0.5 });
      osc.connect(filter);
      filter.connect(env);
      osc.start();
      osc.stop(t + 3);
    }
  }

  const ONESHOT_RECIPES = {
    thump: oneshotThump,
    whoosh: oneshotWhoosh,
    chime: oneshotChime,
    thunder: oneshotThunder,
    heartbeat: oneshotHeartbeat,
    sting: oneshotSting,
  };

  // ---------- engine ----------

  class UltrascriptsAudioEngine {
    constructor({ log } = {}) {
      this._log = typeof log === 'function' ? log : () => {};
      this._ctx = null;
      this._master = null;
      this._buses = {};
      this._settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this._music = null;      // { cueId, intensity, voice }
      this._ambience = new Map(); // cueId -> { gain, voice, level }
      this._unlockAttached = false;
      this._destroyed = false;
    }

    get unlocked() {
      return !!this._ctx && this._ctx.state === 'running';
    }

    _ensureContext() {
      if (this._ctx || this._destroyed) return this._ctx;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        this._log('warn', 'Web Audio API unavailable; audio module inert.');
        return null;
      }
      this._ctx = new Ctor();
      this._master = this._ctx.createGain();
      this._master.connect(this._ctx.destination);
      for (const bus of BUS_NAMES) {
        const gain = this._ctx.createGain();
        gain.connect(this._master);
        this._buses[bus] = gain;
      }
      this._applySettings();
      this._attachUnlockListeners();
      return this._ctx;
    }

    _attachUnlockListeners() {
      if (this._unlockAttached) return;
      this._unlockAttached = true;
      const resume = () => {
        if (this._ctx && this._ctx.state === 'suspended') {
          this._ctx.resume().catch(() => {});
        }
        if (this.unlocked) {
          document.removeEventListener('pointerdown', resume, true);
          document.removeEventListener('keydown', resume, true);
        }
      };
      document.addEventListener('pointerdown', resume, true);
      document.addEventListener('keydown', resume, true);
    }

    setSettings(settings) {
      const merged = {
        muted: !!settings?.muted,
        masterVolume: clamp01(settings?.masterVolume, DEFAULT_SETTINGS.masterVolume),
        buses: {},
      };
      for (const bus of BUS_NAMES) {
        merged.buses[bus] = clamp01(settings?.buses?.[bus], DEFAULT_SETTINGS.buses[bus]);
      }
      this._settings = merged;
      this._applySettings();
    }

    _applySettings() {
      if (!this._ctx) return;
      const t = this._ctx.currentTime;
      const master = this._settings.muted ? 0 : this._settings.masterVolume;
      this._master.gain.setTargetAtTime(master, t, 0.05);
      for (const bus of BUS_NAMES) {
        this._buses[bus].gain.setTargetAtTime(this._settings.buses[bus], t, 0.05);
      }
    }

    _startVoice(bus, resolved, extraParams = {}) {
      const ctx = this._ensureContext();
      if (!ctx) return null;
      const recipe = LOOP_RECIPES[resolved.recipe];
      if (!recipe) {
        this._log('warn', `No loop recipe '${resolved.recipe}' for cue '${resolved.id}'`);
        return null;
      }
      const voice = makeVoice(ctx, this._buses[bus]);
      const meta = recipe(voice, { ...resolved.params, ...extraParams }) || { level: 0.4 };
      return { voice, level: clamp01(meta.level, 0.4) };
    }

    setMusic(resolved, intensity) {
      const cueId = resolved ? resolved.id : null;
      const level = clamp01(intensity, 0.7);

      if (this._music && this._music.cueId === cueId) {
        if (this._music.intensity !== level && this._music.voice) {
          this._music.voice.fadeTo(this._music.baseLevel * (0.4 + level * 0.6), 1.2);
          this._music.intensity = level;
        }
        return;
      }

      if (this._music?.voice) this._music.voice.stop(CROSSFADE_SEC);
      this._music = null;
      if (!resolved) return;

      const started = this._startVoice('music', resolved, { intensity: level });
      if (!started) return;
      started.voice.fadeTo(started.level * (0.4 + level * 0.6), CROSSFADE_SEC);
      this._music = {
        cueId,
        requested: resolved.requested,
        intensity: level,
        baseLevel: started.level,
        voice: started.voice,
      };
    }

    setAmbience(entries) {
      const desired = new Map();
      for (const entry of entries) {
        desired.set(entry.resolved.id, entry);
      }

      for (const [cueId, active] of this._ambience) {
        if (!desired.has(cueId)) {
          active.voice.stop(CROSSFADE_SEC);
          this._ambience.delete(cueId);
        }
      }

      for (const [cueId, entry] of desired) {
        const gain = clamp01(entry.gain, 0.6);
        const existing = this._ambience.get(cueId);
        if (existing) {
          if (existing.gain !== gain) {
            existing.voice.fadeTo(existing.level * gain, 1.2);
            existing.gain = gain;
          }
          continue;
        }
        const started = this._startVoice('ambience', entry.resolved);
        if (!started) continue;
        started.voice.fadeTo(started.level * gain, CROSSFADE_SEC);
        this._ambience.set(cueId, {
          gain,
          level: started.level,
          requested: entry.resolved.requested,
          voice: started.voice,
        });
      }
    }

    playOneshot(resolved) {
      const ctx = this._ensureContext();
      if (!ctx) return false;
      const recipe = ONESHOT_RECIPES[resolved.recipe];
      if (!recipe) {
        this._log('warn', `No one-shot recipe '${resolved.recipe}' for cue '${resolved.id}'`);
        return false;
      }
      const bus = this._buses[resolved.bus === 'stinger' ? 'stinger' : 'sfx'];
      if (resolved.bus === 'stinger' && this._music?.voice) {
        // Duck music briefly under the stinger.
        const musicVoice = this._music.voice;
        const level = this._music.baseLevel * (0.4 + this._music.intensity * 0.6);
        musicVoice.fadeTo(level * 0.35, 0.15);
        setTimeout(() => {
          if (!musicVoice.isStopped) musicVoice.fadeTo(level, 1.5);
        }, ONESHOT_TAIL_SEC * 250);
      }
      try {
        recipe(ctx, bus, resolved.params || {});
        return true;
      } catch (err) {
        this._log('warn', `One-shot '${resolved.id}' threw`, err);
        return false;
      }
    }

    stopAll(fadeSec = 0.6) {
      if (this._music?.voice) this._music.voice.stop(fadeSec);
      this._music = null;
      for (const [, active] of this._ambience) active.voice.stop(fadeSec);
      this._ambience.clear();
    }

    destroy() {
      this.stopAll(0.2);
      this._destroyed = true;
      const ctx = this._ctx;
      this._ctx = null;
      if (ctx) {
        setTimeout(() => { ctx.close().catch(() => {}); }, 600);
      }
    }

    inspect() {
      return {
        contextState: this._ctx ? this._ctx.state : 'uninitialized',
        unlocked: this.unlocked,
        settings: JSON.parse(JSON.stringify(this._settings)),
        music: this._music
          ? { cue: this._music.cueId, requested: this._music.requested, intensity: this._music.intensity }
          : null,
        ambience: [...this._ambience.entries()].map(([cue, active]) => ({
          cue,
          requested: active.requested,
          gain: active.gain,
        })),
      };
    }
  }

  window.UltrascriptsAudioEngine = UltrascriptsAudioEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UltrascriptsAudioEngine;
  }
})();
