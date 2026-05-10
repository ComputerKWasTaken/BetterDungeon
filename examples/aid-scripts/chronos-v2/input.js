// Chronos - Input Modifier
//
// Handles fallback chat commands such as /time, /advance, and /sleep.

var modifier = function (text) {
  if (typeof chronosInput === 'function') {
    try {
      text = chronosInput(text);
    } catch (err) {
      // Never break gameplay because Chronos command parsing failed.
    }
  }
  return { text: text };
};

modifier(text);
