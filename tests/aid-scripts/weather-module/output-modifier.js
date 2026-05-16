// Frontier Weather Module Test Suite — AI Dungeon Output Modifier
//
// Pair with library.js. Drives one suite step per generation so the test runs
// turn-by-turn alongside normal play. The text is returned untouched.

var modifier = function (text) {
  if (typeof frontierWeatherTestStep === 'function') {
    try { frontierWeatherTestStep(text); } catch (e) { /* never break gameplay */ }
  }
  return { text: text };
};

modifier(text);
