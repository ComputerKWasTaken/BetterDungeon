// Aura Cards intentionally does not use the Context Modifier.
// The old Auto-Cards approach inserted card prompts into context; Aura Cards
// sends those requests through Frontier's AI module instead.

var modifier = function (text) {
  return { text: text};
};

modifier(text);
