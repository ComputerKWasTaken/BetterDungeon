// BetterDungeon - Story Card Cache Service
// Shared cache for story card trigger data, accessible by all features.
// Both TriggerHighlightFeature and StoryCardAnalyticsFeature read/write
// through this singleton so that a scan initiated by either feature
// makes its trigger data available to the other.

class StoryCardCache {
  constructor() {
    // Shared trigger map: trigger (lowercase) -> cardName(s)
    this.triggers = new Map();
    // Canonical card records keyed by story card id.
    this.cards = new Map();
    this.adventureShortId = null;
    this.updatedAt = 0;
  }

  // --------------- Write ---------------

  setAdventure(shortId) {
    const normalized = shortId ? String(shortId) : null;
    if (normalized && this.adventureShortId && normalized !== this.adventureShortId) {
      this.clear();
    }
    if (normalized) this.adventureShortId = normalized;
  }

  normalizeTriggerParts(value) {
    if (!value || typeof value !== 'string') return [];
    return value
      .split(',')
      .map(part => part.trim().toLowerCase())
      .filter(part => part.length > 0 && part.length < 50);
  }

  normalizeCard(card) {
    if (!card || card.deletedAt) return null;

    const id = card.id != null ? String(card.id) : null;
    const title = String(card.title || card.name || card.keys || (id ? `Story Card ${id}` : 'Unknown Card')).trim();
    const value = String(card.value || card.entryText || '');
    const keys = typeof card.keys === 'string'
      ? card.keys
      : Array.isArray(card.keys)
        ? card.keys.join(',')
        : '';
    const triggers = Array.isArray(card.triggers) && card.triggers.length > 0
      ? card.triggers.map(trigger => String(trigger).trim().toLowerCase()).filter(trigger => trigger.length > 0 && trigger.length < 50)
      : this.normalizeTriggerParts(keys);

    return {
      id,
      type: String(card.type || 'other').toLowerCase(),
      title,
      name: title,
      description: String(card.description || value || ''),
      keys,
      value,
      entryText: value,
      triggers,
      updatedAt: card.updatedAt || null,
      deletedAt: card.deletedAt || null,
      useForCharacterCreation: !!card.useForCharacterCreation,
      raw: card.raw || card,
    };
  }

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

  setCard(card, shortId = null) {
    this.setAdventure(shortId);
    const normalized = this.normalizeCard(card);
    if (!normalized) return null;

    const id = normalized.id || normalized.name;
    this.cards.set(id, normalized);
    for (const trigger of normalized.triggers) {
      this.setTrigger(trigger, normalized.name);
    }
    this.updatedAt = Date.now();
    return normalized;
  }

  importCards(cards, shortId = null, options = {}) {
    this.setAdventure(shortId);
    if (options.replace) {
      this.triggers.clear();
      this.cards.clear();
    }

    let count = 0;
    const iterable = cards instanceof Map ? cards.values() : cards;
    if (!iterable || typeof iterable[Symbol.iterator] !== 'function') return count;

    for (const card of iterable) {
      if (this.setCard(card, shortId)) count++;
    }
    this.updatedAt = Date.now();
    return count;
  }

  removeCard(cardId) {
    if (cardId == null) return;
    this.cards.delete(String(cardId));
    this.rebuildTriggers();
    this.updatedAt = Date.now();
  }

  rebuildTriggers() {
    this.triggers.clear();
    for (const card of this.cards.values()) {
      for (const trigger of card.triggers || []) {
        this.setTrigger(trigger, card.name);
      }
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

  getCards() {
    return this.cards;
  }

  getCardArray() {
    return Array.from(this.cards.values());
  }

  // Number of cached triggers.
  get size() {
    return this.triggers.size;
  }

  // --------------- Lifecycle ---------------

  // Clear all cached triggers (e.g. on adventure change).
  clear() {
    this.triggers.clear();
    this.cards.clear();
    this.adventureShortId = null;
    this.updatedAt = 0;
  }
}

// Singleton instance — available globally after this script loads.
const storyCardCache = new StoryCardCache();

// Make available globally
if (typeof window !== 'undefined') {
  window.StoryCardCache = StoryCardCache;
  window.storyCardCache = storyCardCache;

  const getCurrentStoryCardShortId = () => (
    window.Ultrascripts?.ws?.getAdventureShortId?.() ||
    window.location.pathname.match(/\/adventure\/([^/]+)/)?.[1] ||
    null
  );

  const hydrateFromCards = (cards, options = {}) => {
    storyCardCache.importCards(cards || [], getCurrentStoryCardShortId(), options);
  };

  document.addEventListener('ultrascripts:cards:full', (event) => {
    hydrateFromCards(event.detail?.cards || [], { replace: true });
  });

  document.addEventListener('ultrascripts:cards:diff', (event) => {
    const liveCards = window.Ultrascripts?.ws?.getCards?.();
    if (liveCards) {
      hydrateFromCards(liveCards instanceof Map ? liveCards.values() : liveCards, { replace: true });
      return;
    }

    hydrateFromCards([...(event.detail?.added || []), ...(event.detail?.updated || [])]);
    for (const card of event.detail?.removed || []) {
      storyCardCache.removeCard(card.id);
    }
    storyCardCache.rebuildTriggers();
  });

  document.addEventListener('ultrascripts:adventure:change', (event) => {
    storyCardCache.clear();
    storyCardCache.setAdventure(event.detail?.shortId || getCurrentStoryCardShortId());
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StoryCardCache, storyCardCache };
}
