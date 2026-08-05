// Ultrascripts Audio Module Test Suite — AI Dungeon Output Modifier

var modifier = function (text) {
  if (typeof ultrascriptsAudioTestStep === 'function') {
    try { ultrascriptsAudioTestStep(); } catch (e) { /* never break gameplay */ }
  }
  return { text: text };
};

modifier(text);
