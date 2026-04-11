// BetterDungeon - Story Card Cache Service
// Shared cache for story card trigger data, accessible by all features.
// Both TriggerHighlightFeature and StoryCardAnalyticsFeature read/write
// through this singleton so that a scan initiated by either feature
// makes its trigger data available to the other.

class StoryCardCache {
  constructor() {
    // Shared trigger map: trigger (lowercase) -> cardName(s)
    this.triggers = new Map();
  }

  // --------------- Write ---------------

  // Add or update a trigger entry.
  // If the trigger already exists under a different card name, the card
  // names are concatenated (e.g. "Card A, Card B").
  setTrigger(trigger, cardName) {
    if (!trigger || !cardName) return;
    const key = trigger.toLowerCase().trim();
    if (!key) return;

    const existing = this.triggers.get(key);
    if (existing && existing !== cardName && !existing.includes(cardName)) {
      this.triggers.set(key, `${existing}, ${cardName}`);
    } else if (!existing) {
      this.triggers.set(key, cardName);
    }
  }

  // Bulk-import triggers from a Map (trigger -> cardName).
  // Existing entries are merged, not overwritten.
  importTriggers(triggerMap) {
    if (!triggerMap) return;
    triggerMap.forEach((cardName, trigger) => {
      this.setTrigger(trigger, cardName);
    });
  }

  // --------------- Read ---------------

  // Get the card name(s) associated with a trigger.
  getTrigger(trigger) {
    return this.triggers.get(trigger);
  }

  // Check whether a trigger exists in the cache.
  hasTrigger(trigger) {
    return this.triggers.has(trigger);
  }

  // Return the underlying Map (read-only access by convention).
  getTriggers() {
    return this.triggers;
  }

  // Number of cached triggers.
  get size() {
    return this.triggers.size;
  }

  // --------------- Lifecycle ---------------

  // Clear all cached triggers (e.g. on adventure change).
  clear() {
    this.triggers.clear();
  }
}

// Singleton instance — available globally after this script loads.
const storyCardCache = new StoryCardCache();

// Make available globally
if (typeof window !== 'undefined') {
  window.StoryCardCache = StoryCardCache;
  window.storyCardCache = storyCardCache;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StoryCardCache, storyCardCache };
}
