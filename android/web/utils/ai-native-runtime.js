// Android host: provider logic lives in the shared runtime.
(function () {
  if (window.__bdAiRuntime) return;
  window.__bdAiRuntime = BetterDungeonAIRuntime.install({
    runtime: chrome.runtime,
    storage: chrome.storage.local,
    fetch: window.__bdNativeAiFetch,
  });
})();
