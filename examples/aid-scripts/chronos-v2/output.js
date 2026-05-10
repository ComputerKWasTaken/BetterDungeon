// Chronos - Output Modifier
//
// Publishes widgets, polls Frontier module responses, and replaces generated
// text with command output when the player uses a Chronos chat command.

var modifier = function (text) {
  if (typeof chronosOutput === 'function') {
    try {
      text = chronosOutput(text);
    } catch (err) {
      // Never break gameplay because the dashboard worker had a problem.
    }
  }
  return { text: text };
};

modifier(text);
