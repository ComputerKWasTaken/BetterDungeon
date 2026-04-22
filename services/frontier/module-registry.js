// services/frontier/module-registry.js
//
// Frontier module lifecycle. Modules register a definition:
//   {
//     id:              string   — unique identifier (e.g. 'scripture')
//     version:         string?  — semver
//     label:           string?  — human-readable label for popup UI
//     stateNames:      string[] — which frontier:state:<name> cards it reads
//     tracksLiveCount: boolean? — if true, re-dispatched on livecount change
//     defaultEnabled:  boolean? — overrides the built-in default-on behavior
//     ops:             object?  — ops handlers (Phase 4)
//     mount(ctx):      function — called when enabled, receives a Core ctx
//     unmount():       function — called when disabled or adventure leaves
//     onEnable(ctx):   function? — called after mount on enable
//     onDisable(ctx):  function? — called before unmount on disable
//     onStateChange(name, parsed, ctx): function? — state-card dispatch
//     onAdventureChange(shortId, ctx):  function? — adventure boundary
//   }
//
// The registry:
//   * Defers registrations received before Core is ready.
//   * Persists enable/disable state in chrome.storage.sync under
//     'frontier_enabled_modules' so the user's choices survive reloads.
//   * Calls mount() + onEnable() the first time the module is enabled.
//   * Calls onDisable() + unmount() and tears down ctx listeners on disable.
//   * On adventure boundary, calls onAdventureChange() on mounted modules
//     instead of a full unmount/remount cycle (lighter, modules control reset).
//   * Replays cached state to freshly-enabled modules via Core.
//
// See:
//   - Project Management/frontier/01-architecture.md (module layer)
//   - Project Management/frontier/03-modules.md (module contract)

(function () {
  if (window.Frontier?.registry) return;

  const TAG = '[Frontier/registry]';
  const STORAGE_KEY = 'frontier_enabled_modules';

  const definitions = new Map();  // id -> module definition
  const mounted = new Map();       // id -> { def, ctx }
  const enabledState = new Map();  // id -> boolean (persisted)
  let coreReady = false;
  let persistedLoaded = false;

  function assertCore() {
    const core = window.Frontier?.core;
    if (!core) throw new Error(`${TAG} Frontier Core not loaded yet`);
    return core;
  }

  // ---------- persistence ----------

  function loadPersistedState() {
    return new Promise((resolve) => {
      try {
        const api = typeof browser !== 'undefined' ? browser : chrome;
        api?.storage?.sync?.get?.(STORAGE_KEY, (result) => {
          const saved = result?.[STORAGE_KEY];
          if (saved && typeof saved === 'object') {
            for (const [id, enabled] of Object.entries(saved)) {
              enabledState.set(id, !!enabled);
            }
          }
          persistedLoaded = true;
          resolve();
        });
      } catch {
        persistedLoaded = true;
        resolve();
      }
    });
  }

  function persistEnabledState() {
    try {
      const api = typeof browser !== 'undefined' ? browser : chrome;
      const obj = Object.create(null);
      for (const [id, enabled] of enabledState) obj[id] = enabled;
      api?.storage?.sync?.set?.({ [STORAGE_KEY]: obj });
    } catch { /* storage unavailable */ }
  }

  // Returns whether a module should be enabled. Built-in modules (no '.' in
  // id) default to true; third-party modules default to false. The user's
  // persisted preference always takes priority.
  function isEnabled(id) {
    if (enabledState.has(id)) return enabledState.get(id);
    const def = definitions.get(id);
    if (typeof def?.defaultEnabled === 'boolean') return def.defaultEnabled;
    // Default: built-in modules are enabled, third-party are disabled.
    return !id.includes('.');
  }

  // ---------- mount / unmount ----------

  function mountOne(def) {
    if (mounted.has(def.id)) return;
    const core = assertCore();
    const ctx = core._makeModuleCtx(def);
    try {
      def.mount(ctx);
      mounted.set(def.id, { def, ctx });
      try { def.onEnable?.(ctx); } catch (err) {
        console.warn(TAG, `onEnable of '${def.id}' threw`, err);
      }
      // Replay cached state so the module doesn't wait for the next card change.
      core._replayStateToModule(def, ctx);
      core._scheduleHeartbeat?.();
      console.log(TAG, `mounted '${def.id}'`);
    } catch (err) {
      console.error(TAG, `mount of '${def.id}' threw`, err);
      try { ctx._tearDown(); } catch { /* noop */ }
    }
  }

  function unmountOne(id) {
    const entry = mounted.get(id);
    if (!entry) return;
    try { entry.def.onDisable?.(entry.ctx); }
    catch (err) { console.warn(TAG, `onDisable of '${id}' threw`, err); }
    try { entry.def.unmount?.(); }
    catch (err) { console.warn(TAG, `unmount of '${id}' threw`, err); }
    try { entry.ctx._tearDown(); }
    catch { /* noop */ }
    mounted.delete(id);
    try { assertCore()._scheduleHeartbeat?.(); } catch { /* Core may be gone during teardown */ }
    console.log(TAG, `unmounted '${id}'`);
  }

  // ---------- public API ----------

  function register(def) {
    if (!def || typeof def !== 'object') {
      throw new TypeError(`${TAG} register: definition must be an object`);
    }
    if (typeof def.id !== 'string' || !def.id) {
      throw new TypeError(`${TAG} register: module.id required`);
    }
    if (typeof def.mount !== 'function') {
      throw new TypeError(`${TAG} register('${def.id}'): mount() required`);
    }
    if (definitions.has(def.id)) {
      throw new Error(`${TAG} '${def.id}' is already registered`);
    }

    definitions.set(def.id, def);
    console.log(TAG, `registered '${def.id}'`);

    // If Core is already up and the module is enabled, mount immediately.
    if (coreReady && isEnabled(def.id)) mountOne(def);
  }

  function unregister(id) {
    unmountOne(id);
    definitions.delete(id);
  }

  function enable(id) {
    const def = definitions.get(id);
    if (!def) {
      console.warn(TAG, `enable('${id}'): module not registered`);
      return;
    }
    enabledState.set(id, true);
    persistEnabledState();
    if (coreReady && !mounted.has(id)) mountOne(def);
  }

  function disable(id) {
    enabledState.set(id, false);
    persistEnabledState();
    unmountOne(id);
  }

  function setModuleEnabled(id, enabled) {
    if (enabled) enable(id);
    else disable(id);
  }

  function list() {
    return [...definitions.values()].map(d => ({
      id: d.id,
      version: d.version || null,
      label: d.label || d.id,
      stateNames: Array.isArray(d.stateNames) ? d.stateNames.slice() : [],
      ops: d.ops ? Object.keys(d.ops) : [],
      tracksLiveCount: !!d.tracksLiveCount,
      defaultEnabled: typeof d.defaultEnabled === 'boolean' ? d.defaultEnabled : !d.id.includes('.'),
      mounted: mounted.has(d.id),
      enabled: isEnabled(d.id),
    }));
  }

  // Called by main.js after Core is instantiated. Loads persisted state and
  // mounts enabled modules.
  async function start() {
    if (coreReady) return;
    const core = assertCore();

    // Load persisted enabled/disabled state before mounting.
    await loadPersistedState();
    coreReady = true;

    // Mount all registered modules that are enabled.
    for (const def of definitions.values()) {
      if (isEnabled(def.id)) mountOne(def);
    }

    // Core owns adventure-boundary dispatch; the registry only owns module
    // enablement and lifecycle.
  }

  // ---------- internal helpers for Core dispatch ----------

  // Iterates all mounted modules with their definition and context.
  // Used by Core for state-card dispatch and adventure-change notification.
  function _forEachMounted(fn) {
    for (const [_id, entry] of mounted) {
      try { fn(entry.def, entry.ctx); }
      catch (err) { console.warn(TAG, `_forEachMounted callback threw for '${entry.def.id}'`, err); }
    }
  }

  function _getMounted(id) {
    const entry = mounted.get(id);
    return entry ? { def: entry.def, ctx: entry.ctx } : null;
  }

  const registry = {
    register,
    unregister,
    enable,
    disable,
    setModuleEnabled,
    list,
    start,
    _forEachMounted,
    _getMounted,
    inspect: () => ({
      registered: [...definitions.keys()],
      mounted: [...mounted.keys()],
      enabled: Object.fromEntries(enabledState),
      coreReady,
      persistedLoaded,
    }),
  };

  window.Frontier = window.Frontier || {};
  window.Frontier.registry = registry;
})();
