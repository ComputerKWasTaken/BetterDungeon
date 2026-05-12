// Frontier SDK Module Test Suite - AI Dungeon Output Modifier
//
// Pair with library.js. Each generation advances the SDK test driver and
// appends the latest diagnostic block directly into story text.

var modifier = function (text) {
  var report = '';
  if (typeof frontierSdkTestStep === 'function') {
    try { report = frontierSdkTestStep(text); } catch (e) { report = ''; }
  }

  if (!report) return { text: text };
  return { text: String(text || '') + '\n\n' + report };
};

modifier(text);
