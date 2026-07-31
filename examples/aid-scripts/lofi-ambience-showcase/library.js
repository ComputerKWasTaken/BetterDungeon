// ============================================================
// LIBRARY - Lo-fi Ambience Showcase (Ultrascripts Audio)
// ============================================================
// The smallest useful Audio module script: every turn it declares one
// chill lo-fi music bed via the `ultrascripts:state:audio` story card.
//
// That is the whole trick. The state card is declarative and
// fire-and-forget — the scenario works identically for players without
// BetterDungeon (the card is just inert JSON), while BetterDungeon
// players get a synthesized lo-fi bed under the story.

globalThis.LofiAmbienceShowcase = function LofiAmbienceShowcase(hook, inputText) {
  var AUDIO_STATE = {
    v: 1,
    music: { cue: 'music.lofi.chill', intensity: 0.7 }
  };

  if (hook === 'output') {
    upsertAudioStateCard(AUDIO_STATE);
  }

  return { text: inputText };
};

function upsertAudioStateCard(audioState) {
  var title = 'ultrascripts:state:audio';
  var value = JSON.stringify(audioState);
  var cards = (typeof storyCards !== 'undefined' && Array.isArray(storyCards)) ? storyCards : [];

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (!card) continue;
    var matches = card.title === title || card.key === title || card.keys === title ||
      (Array.isArray(card.keys) && card.keys.indexOf(title) !== -1);
    if (!matches) continue;

    if (card.value === value) return; // already up to date
    if (typeof updateStoryCard === 'function') {
      updateStoryCard(i, card.keys || card.key || card.title || title, value, card.type || 'Ultrascripts');
    }
    return;
  }

  if (typeof addStoryCard === 'function') {
    addStoryCard(title, value, 'Ultrascripts');
  }
}
