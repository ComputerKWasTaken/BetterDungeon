// Ultrascripts Audio Module Test Suite — AI Dungeon Library

if (!state.audioTest || typeof state.audioTest !== 'object') {
  state.audioTest = {
    seq: 0,
    ambient: null,
    effect: null,
    lastCommand: 'none',
  };
}

var AUD_TRACKS = ['cavern', 'cozy', 'mystery', 'nature', 'ominous', 'peaceful', 'tension'];

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
    ambient: state.audioTest.ambient,
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
    tracks: AUD_TRACKS,
    commands: [
      '/audio loop <track> — start a bundled ambient loop',
      '/audio volume <0..1> — update ambient volume',
      '/audio effect — play a short rising tone',
      '/audio noise — play a short noise impact',
      '/audio stop — stop active playback',
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

  if (command === 'loop') {
    var track = String(parts[1] || 'peaceful').toLowerCase();
    if (AUD_TRACKS.indexOf(track) >= 0) {
      test.ambient = { id: track, volume: test.ambient ? test.ambient.volume : 0.45 };
      test.lastCommand = 'loop ' + track;
    } else {
      test.lastCommand = 'unknown track ' + track;
    }
  } else if (command === 'volume') {
    var volume = Number(parts[1]);
    if (isFinite(volume)) {
      if (volume < 0) volume = 0;
      if (volume > 1) volume = 1;
      var activeTrack = test.ambient && test.ambient.id ? test.ambient.id : 'peaceful';
      test.ambient = { id: activeTrack, volume: volume };
      test.lastCommand = 'volume ' + volume;
    }
  } else if (command === 'effect') {
    test.effect = {
      id: audNextEffectId('rise'),
      waveform: 'sine',
      frequency: 220,
      endFrequency: 660,
      durationMs: 500,
      attackMs: 10,
      releaseMs: 140,
      volume: 0.7,
    };
    test.lastCommand = 'effect';
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
    test.ambient = null;
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
