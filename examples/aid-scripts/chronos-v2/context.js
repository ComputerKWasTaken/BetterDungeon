// Chronos V2 - Context Modifier
//
// Advances time once per live turn and injects a compact time/weather line
// so the story model can keep the scene grounded.

var modifier = function (text) {
  if (typeof chronosV2Context === 'function') {
    try {
      text = chronosV2Context(text);
    } catch (err) {
      // Never break gameplay because the time context helper failed.
    }
  }
  return { text: text };
};

modifier(text);
