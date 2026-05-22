// BetterDungeon - Ultrascripts Feature
// FeatureManager wrapper for the Ultrascripts platform lifecycle.

class UltrascriptsFeature {
  static id = 'ultrascripts';

  constructor(context = {}) {
    this.aiDungeonService = context.aiDungeonService || null;
    this.enabled = false;
  }

  async init() {
    const core = window.Ultrascripts?.core;
    const registry = window.Ultrascripts?.registry;
    const opsDispatcher = window.Ultrascripts?.opsDispatcher;

    if (!core || !registry) {
      console.warn('[UltrascriptsFeature] Ultrascripts Core/Registry not loaded; Ultrascripts disabled.');
      return;
    }

    core.setAIService?.(this.aiDungeonService);
    core.setEnabled?.(true);

    try {
      await registry.start();
      opsDispatcher?.start?.(core);
      this.enabled = true;
      console.log('[UltrascriptsFeature] Ultrascripts online.');
    } catch (err) {
      console.warn('[UltrascriptsFeature] Ultrascripts startup failed.', err);
    }
  }

  destroy() {
    window.Ultrascripts?.opsDispatcher?.stop?.();
    window.Ultrascripts?.registry?.stop?.();
    window.Ultrascripts?.core?.setEnabled?.(false);
    this.enabled = false;
  }
}

if (typeof window !== 'undefined') {
  window.UltrascriptsFeature = UltrascriptsFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UltrascriptsFeature;
}
