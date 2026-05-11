// Frontier Scripture Module Test Suite — AI Dungeon Output Modifier
//
// Pair with library.js + input-modifier.js. The output hook fires on every
// generation (player turns AND AI continue/retry turns), so this is where we
// tick the suite — polling the inbox, advancing the auto-run, publishing the
// state envelope, and writing the trace. The text is returned untouched.

var modifier = function (text) {
  if (typeof frontierScriptureTestStep === 'function') {
    try { frontierScriptureTestStep(text); } catch (e) { /* never break gameplay */ }
  }
  return { text: text };
};

modifier(text);
