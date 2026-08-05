const assert = require('node:assert/strict');

class FakeParam {
  constructor() {
    this.value = 0;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.events.push(['set', value, time]);
  }

  linearRampToValueAtTime(value, time) {
    this.events.push(['linear', value, time]);
  }

  exponentialRampToValueAtTime(value, time) {
    this.events.push(['exponential', value, time]);
  }
}

class FakeNode {
  constructor() {
    this.connected = false;
    this.disconnected = false;
    this.stopCalls = [];
  }

  connect() {
    this.connected = true;
  }

  disconnect() {
    this.disconnected = true;
  }

  start(time) {
    this.startTime = time;
  }

  stop(time) {
    this.stopCalls.push(time);
  }
}

class FakeAudioContext {
  static initialState = 'running';
  static instances = [];

  constructor() {
    this.state = FakeAudioContext.initialState;
    this.currentTime = 2;
    this.sampleRate = 100;
    this.destination = {};
    this.oscillators = [];
    this.bufferSources = [];
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const gain = new FakeNode();
    gain.gain = new FakeParam();
    return gain;
  }

  createOscillator() {
    const oscillator = new FakeNode();
    oscillator.frequency = new FakeParam();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createBuffer(_channels, frameCount) {
    const data = new Float32Array(frameCount);
    return { getChannelData: () => data };
  }

  createBufferSource() {
    const source = new FakeNode();
    this.bufferSources.push(source);
    return source;
  }

  async resume() {
    this.state = 'running';
  }

  close() {
    this.state = 'closed';
  }
}

const listeners = new Map();
global.document = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  removeEventListener(name) { listeners.delete(name); },
};

const stored = new Map();
global.sessionStorage = {
  getItem(key) { return stored.has(key) ? stored.get(key) : null; },
  setItem(key, value) { stored.set(key, String(value)); },
};

let registeredModule = null;
global.window = {
  AudioContext: FakeAudioContext,
  Ultrascripts: {
    registry: {
      register(moduleDefinition) { registeredModule = moduleDefinition; },
    },
  },
};

require('../../modules/audio/module.js');
const audio = registeredModule;
const logs = [];
const ctx = {
  getAdventureId: () => 'test-adventure',
  log: (...args) => logs.push(args),
};

assert.ok(audio, 'Audio registers with the Ultrascripts registry');
assert.equal(audio.version, '0.3.0');
assert.equal(audio.description, 'Plays bounded synthesized sound effects from Audio state.');

audio.mount(ctx);
assert.equal(listeners.has('pointerdown'), true);

const toneState = {
  v: 1,
  effect: {
    id: 'tone-1',
    waveform: 'sine',
    frequency: 220,
    endFrequency: 660,
    durationMs: 500,
    attackMs: 10,
    releaseMs: 140,
    volume: 0.5,
  },
};

audio.onStateChange('audio', toneState, ctx);
const runningContext = FakeAudioContext.instances.at(-1);
assert.equal(runningContext.oscillators.length, 1, 'tone creates one oscillator');
assert.equal(runningContext.oscillators[0].type, 'sine');
assert.deepEqual(
  runningContext.oscillators[0].frequency.events,
  [['set', 220, 2.01], ['exponential', 660, 2.51]],
  'tone applies its start frequency and pitch sweep',
);
assert.equal(audio.inspect().lastEffectId, 'tone-1');
assert.deepEqual(audio.inspect().waveforms, ['sine', 'square', 'triangle', 'sawtooth', 'noise']);
assert.equal(Object.hasOwn(audio.inspect(), 'tracks'), false, 'inspect has no media catalog');

audio.onStateChange('audio', toneState, ctx);
assert.equal(runningContext.oscillators.length, 1, 'repeated effect id does not replay');

audio.onStateChange('audio', {
  v: 1,
  effect: {
    id: 'noise-1',
    waveform: 'noise',
    durationMs: 240,
    attackMs: 0,
    releaseMs: 220,
    volume: 0.35,
  },
}, ctx);
assert.equal(runningContext.bufferSources.length, 1, 'noise creates one generated buffer source');

audio.onStateChange('audio', {
  v: 1,
  effect: { id: 'bad', waveform: 'invalid', frequency: 440 },
}, ctx);
assert.equal(runningContext.oscillators.length, 1, 'invalid waveform starts no source');
assert.equal(logs.some((entry) => entry.join(' ').includes('unsupported waveform')), true);

audio.onStateChange('audio', { v: 1, effect: null }, ctx);
assert.equal(audio.inspect().activeSources, 0, 'null effect stops active sources');

audio.unmount();
assert.equal(runningContext.state, 'closed');
assert.equal(listeners.size, 0);

stored.clear();
FakeAudioContext.initialState = 'suspended';
audio.mount(ctx);
audio.onStateChange('audio', {
  v: 1,
  effect: { id: 'delayed-1', waveform: 'triangle', frequency: 330 },
}, ctx);
const suspendedContext = FakeAudioContext.instances.at(-1);
assert.equal(suspendedContext.oscillators.length, 0, 'suspended context defers playback');

audio.unlockAudio().then((ready) => {
  assert.equal(ready, true);
  assert.equal(suspendedContext.oscillators.length, 1, 'unlock plays the pending effect once');
  audio.onDisable(ctx);
  assert.equal(audio.inspect().activeSources, 0, 'disable stops active sources');
  audio.unmount();
  console.log('Audio module tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
