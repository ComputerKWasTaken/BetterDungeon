// BetterDungeon - Frontier Feature
// FeatureManager wrapper for the Frontier platform lifecycle.

class FrontierFeature {
  static id = 'frontier';

  constructor(context = {}) {
    this.aiDungeonService = context.aiDungeonService || null;
    this.enabled = false;
  }

  async init() {
    const core = window.Frontier?.core;
    const registry = window.Frontier?.registry;
    const opsDispatcher = window.Frontier?.opsDispatcher;

    if (!core || !registry) {
      console.warn('[FrontierFeature] Frontier Core/Registry not loaded; Frontier disabled.');
      return;
    }

    core.setAIService?.(this.aiDungeonService);
    core.setEnabled?.(true);

    try {
      await registry.start();
      opsDispatcher?.start?.(core);
      this.enabled = true;
      console.log('[FrontierFeature] Frontier online.');
    } catch (err) {
      console.warn('[FrontierFeature] Frontier startup failed.', err);
    }
  }

  destroy() {
    window.Frontier?.opsDispatcher?.stop?.();
    window.Frontier?.registry?.stop?.();
    window.Frontier?.core?.setEnabled?.(false);
    this.enabled = false;
  }
}

if (typeof window !== 'undefined') {
  window.FrontierFeature = FrontierFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FrontierFeature;
}
