// Browser host for the shared AI service. Kept at this path for package compatibility.
if (typeof importScripts === 'function') importScripts('services/ai/config.js', 'modules/ai/executor.js', 'services/ai/runtime.js');
globalThis.__bdAiRuntime ||= BetterDungeonAIRuntime.install({
  runtime: chrome.runtime,
  storage: chrome.storage.local,
  fetch: globalThis.fetch.bind(globalThis),
});
