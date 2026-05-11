// Frontier Scripture Module Test Suite — AI Dungeon Input Modifier
//
// Pair with library.js + output-modifier.js. This hook runs ONLY when the
// player submits input, so it does not tick the suite — that would cause the
// suite to skip every AI-only turn (continue, retry, etc.). Ticking happens
// in output-modifier.js which fires on every generation.
//
// AI Dungeon onInput hook constraints (per AID scripting docs):
//   - Returning an empty string from onInput throws "Unable to run scenario scripts".
//   - Returning { stop: true } from onInput throws the same error.
// So if the player's entire input is a /scripture command and we strip it to
// nothing, we MUST substitute a non-empty placeholder. '.' is a minimal "do"
// action that AID accepts; the command's side effects have already fired via
// scrConsumeCommands by then.

var modifier = function (text) {
  if (typeof scrConsumeCommands !== 'function') {
    return { text: text };
  }

  var out = text == null ? '' : String(text);
  try {
    var result = scrConsumeCommands(out);
    if (result && result.matched) {
      var stripped = (result.stripped || '').replace(/^\s+|\s+$/g, '');
      out = stripped.length > 0 ? stripped : '.';
    }
  } catch (e) { /* never break gameplay */ }

  return { text: out };
};

modifier(text);
