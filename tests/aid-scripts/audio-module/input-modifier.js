// Ultrascripts Audio Module Test Suite — AI Dungeon Input Modifier

var modifier = function (text) {
  if (typeof audConsumeCommands !== 'function') return { text: text };

  var out = text == null ? '' : String(text);
  try {
    var result = audConsumeCommands(out);
    if (result && result.matched) out = result.stripped || '.';
  } catch (e) { /* never break gameplay */ }

  return { text: out };
};

modifier(text);
