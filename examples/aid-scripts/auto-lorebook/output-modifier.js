// Auto-Lorebook Builder — AI Dungeon Output Modifier
//
// Pair with library.js. Drives one lorebook step per generation. Text is
// returned untouched — the script only writes story cards as a side
// effect, never alters the story itself.

var modifier = function (text) {
  if (typeof autoLorebookStep === 'function') {
    try { autoLorebookStep(text); } catch (e) { /* never break gameplay */ }
  }
  return { text: text };
};

modifier(text);
