// Chronos V2 - Output Modifier
//
// Publishes widgets, polls Frontier module responses, and replaces generated
// text with command output when the player uses a Chronos chat command.

var modifier = function (text) {
  if (typeof chronosV2Output === 'function') {
    try {
      text = chronosV2Output(text);
    } catch (err) {
      // Never break gameplay because the dashboard worker had a problem.
    }
  }
  return { text: text };
};

modifier(text);
