// services/frontier/module-registry.js
//
// Frontier module lifecycle. Modules register a definition:
//   {
//     id:           string   — unique identifier (e.g. 'scripture')
//     version:      string?  — semver
//     stateNames:   string[] — which frontier:state:<name> cards it reads
//     mount(ctx):   function — called when enabled, receives a Core ctx
//     unmount():    function — called when disabled or adventure leaves
//   }
//
// The registry:
//   * Defers registrations received before Core is ready.
//   * Calls mount() with a fresh ctx the first time the module is enabled.
//   * Calls unmount() and tears down ctx listeners on disable.
//   * Re-mounts all active modules on adventure:enter so they can rebind
//     to the new adventure's state. (This is the simplest correct behavior
//     and avoids subtle stale-state bugs.)
//
// See:
//   - Project Management/frontier/01-architecture.md (module layer)
//   - Project Management/frontier/03-modules.md (module contract)

(function () {
  if (window.Frontier?.registry) return;

  const TAG = '[Frontier/registry]';

  const definitions = new Map();  // id -> module definition
  const mounted = new Map();       // id -> { def, ctx }
  let coreReady = false;

  function assertCore() {
    const core = window.Frontier?.core;
    if (!core) throw new Error(`${TAG} Frontier Core not loaded yet`);
    return core;
  }

  function mountOne(def) {
    if (mounted.has(def.id)) return; // already mounted
    const core = assertCore();
    const ctx = core._makeModuleCtx(def);
    try {
      def.mount(ctx);
      mounted.set(def.id, { def, ctx });
      console.log(TAG, `mounted '${def.id}'`);
    } catch (err) {
      console.error(TAG, `mount of '${def.id}' threw`, err);
      // Best-effort: tear down the ctx so any listeners registered before
      // the throw are cleaned up.
      try { ctx._tearDown(); } catch { /* noop */ }
    }
  }

  function unmountOne(id) {
    const entry = mounted.get(id);
    if (!entry) return;
    try { entry.def.unmount?.(); }
    catch (err) { console.warn(TAG, `unmount of '${id}' threw`, err); }
    try { entry.ctx._tearDown(); }
    catch { /* noop */ }
    mounted.delete(id);
    console.log(TAG, `unmounted '${id}'`);
  }

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

    // If Core is already up, mount immediately. Otherwise defer until start().
    if (coreReady) mountOne(def);
  }

  function unregister(id) {
    unmountOne(id);
    definitions.delete(id);
  }

  function list() {
    return [...definitions.values()].map(d => ({
      id: d.id,
      version: d.version || null,
      stateNames: Array.isArray(d.stateNames) ? d.stateNames.slice() : [],
      mounted: mounted.has(d.id),
    }));
  }

  // Called by main.js after Core is instantiated. Mounts every deferred
  // registration and wires the remount-on-adventure-enter hook.
  function start() {
    if (coreReady) return;
    const core = assertCore();
    coreReady = true;

    for (const def of definitions.values()) mountOne(def);

    // Re-mount all modules on adventure boundary. Modules are expected to
    // treat mount() as idempotent and may use it to refresh state from the
    // new adventure's cards.
    core.on('adventure:enter', () => {
      const ids = [...mounted.keys()];
      for (const id of ids) unmountOne(id);
      for (const def of definitions.values()) mountOne(def);
    });
  }

  const registry = {
    register,
    unregister,
    list,
    start,
    inspect: () => ({
      registered: [...definitions.keys()],
      mounted: [...mounted.keys()],
      coreReady,
    }),
  };

  window.Frontier = window.Frontier || {};
  window.Frontier.registry = registry;
})();
