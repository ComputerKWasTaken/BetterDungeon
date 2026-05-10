// Chronos V2 - Input Modifier
//
// Handles fallback chat commands such as :time, :advance, and :sleep.

var modifier = function (text) {
  if (typeof chronosV2Input === 'function') {
    try {
      text = chronosV2Input(text);
    } catch (err) {
      // Never break gameplay because Chronos command parsing failed.
    }
  }
  return { text: text };
};

modifier(text);
