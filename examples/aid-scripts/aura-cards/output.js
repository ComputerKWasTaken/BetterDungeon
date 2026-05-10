// Aura Cards - Output Modifier
//
// Drives one non-blocking Aura Cards tick after each normal generation.
// The story text is always returned unchanged.

var modifier = function (text) {
  if (typeof auraCardsStep === 'function') {
    try {
      auraCardsStep(text);
    } catch (err) {
      // Never break gameplay because the sidecar card worker had a problem.
    }
  }
  return { text: text };
};

modifier(text);
