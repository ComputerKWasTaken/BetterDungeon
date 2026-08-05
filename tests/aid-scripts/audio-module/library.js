// Ultrascripts Audio Module Test Suite — AI Dungeon Library

if (!state.audioTest || typeof state.audioTest !== 'object') {
  state.audioTest = {
    seq: 0,
    effect: null,
    lastCommand: 'none',
  };
}

var AUD_WAVEFORMS = ['sine', 'square', 'triangle', 'sawtooth', 'noise'];

function audCards() {
  return Array.isArray(storyCards) ? storyCards : [];
}

function audFindCard(title) {
  var cards = audCards();
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (card && (card.title === title || card.keys === title || card.key === title)) {
      return { card: card, index: i };
    }
  }
  return { card: null, index: -1 };
}

function audCardText(card) {
  return card ? (card.value || card.entry || card.description || '') : '';
}

function audReadJson(title) {
  var found = audFindCard(title);
  if (!found.card) return null;
  try { return JSON.parse(audCardText(found.card) || '{}'); }
  catch (e) { return null; }
}

function audWriteCard(title, value, type) {
  var found = audFindCard(title);
  var cardType = type || 'Ultrascripts';
  if (found.card && found.index >= 0 && typeof updateStoryCard === 'function') {
    updateStoryCard(found.index, found.card.keys || found.card.key || title, value, found.card.type || cardType);
    return true;
  }
  if (typeof addStoryCard === 'function') {
    addStoryCard(title, value, cardType);
    return true;
  }
  return false;
}

function audHeartbeatAdvertisesAudio() {
  var heartbeat = audReadJson('ultrascripts:heartbeat');
  var modules = heartbeat && Array.isArray(heartbeat.modules) ? heartbeat.modules : [];
  for (var i = 0; i < modules.length; i++) {
    if (modules[i] && modules[i].id === 'audio') return true;
  }
  return false;
}

function audNextEffectId(label) {
  state.audioTest.seq += 1;
  return 'audio-test-' + label + '-' + state.audioTest.seq;
}

function audPublishState() {
  var payload = {
    v: 1,
    effect: state.audioTest.effect,
  };
  audWriteCard('ultrascripts:state:audio', JSON.stringify(payload), 'Ultrascripts');
  return payload;
}

function audWriteTrace(payload) {
  var trace = {
    v: 1,
    audioAdvertised: audHeartbeatAdvertisesAudio(),
    lastCommand: state.audioTest.lastCommand,
    publishedState: payload,
    waveforms: AUD_WAVEFORMS,
    commands: [
      '/audio tone — play a short sine tone',
      '/audio sweep — play a rising sawtooth sweep',
      '/audio noise — play a short noise impact',
      '/audio stop — stop active effects',
    ],
  };
  audWriteCard('ultrascripts:test:audio', JSON.stringify(trace, null, 2), 'Ultrascripts Test');
}

function audConsumeCommands(text) {
  var raw = text == null ? '' : String(text);
  var match = raw.match(/\/audio(?:\s+([^\n\r]+))?/i);
  if (!match) return { matched: false, stripped: raw };

  var parts = String(match[1] || '').replace(/^\s+|\s+$/g, '').split(/\s+/);
  var command = String(parts[0] || '').toLowerCase();
  var test = state.audioTest;

  if (command === 'tone') {
    test.effect = {
      id: audNextEffectId('tone'),
      waveform: 'sine',
      frequency: 440,
      durationMs: 300,
      attackMs: 10,
      releaseMs: 100,
      volume: 0.5,
    };
    test.lastCommand = 'tone';
  } else if (command === 'sweep') {
    test.effect = {
      id: audNextEffectId('sweep'),
      waveform: 'sawtooth',
      frequency: 180,
      endFrequency: 720,
      durationMs: 500,
      attackMs: 10,
      releaseMs: 160,
      volume: 0.35,
    };
    test.lastCommand = 'sweep';
  } else if (command === 'noise') {
    test.effect = {
      id: audNextEffectId('noise'),
      waveform: 'noise',
      durationMs: 240,
      attackMs: 0,
      releaseMs: 220,
      volume: 0.35,
    };
    test.lastCommand = 'noise';
  } else if (command === 'stop') {
    test.effect = null;
    test.lastCommand = 'stop';
  } else {
    test.lastCommand = 'help';
  }

  return {
    matched: true,
    stripped: raw.replace(match[0], '').replace(/^\s+|\s+$/g, ''),
  };
}

function ultrascriptsAudioTestStep() {
  var payload = audPublishState();
  audWriteTrace(payload);
}
