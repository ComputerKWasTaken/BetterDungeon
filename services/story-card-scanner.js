// BetterDungeon - Story Card Scanner Service
// Hydrates story cards from Ultrascripts/GraphQL and exposes trigger analytics.

class StoryCardScanner {
  constructor() {
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.scannedNames = new Set();
    this.cardDatabase = new Map();
    // Full normalized card list from the latest scan. cardDatabase is keyed
    // by card name for backwards compatibility, which collapses cards that
    // share a title; analytics must iterate this list instead.
    this.cardsList = [];
    this.lastScannedAdventureId = null;
    this.debug = false;
    // Native AI Dungeon card types. 'race' and 'class' are first-class types
    // (character-creator sections, verified in the current play bundle's
    // sortedStoryCardTypes ordering); omitting them silently bucketed those
    // cards as 'other' in the type breakdown.
    this.CARD_TYPES = ['character', 'race', 'class', 'location', 'item', 'faction', 'lore', 'other'];
  }

  validatePageState() {
    if (!window.location.hostname.includes('aidungeon.com')) {
      return { valid: false, error: 'Not on AI Dungeon website' };
    }
    if (!/\/(?:adventures?|play)\//.test(window.location.pathname)) {
      return { valid: false, error: 'Navigate to an adventure first' };
    }
    if (this.isScanning) {
      return { valid: false, error: 'Scan already in progress' };
    }
    return { valid: true };
  }

  getCurrentAdventureId() {
    const match = window.location.pathname.match(/\/(?:adventures?|play)\/([^/]+)/);
    return match ? match[1] : null;
  }

  getCurrentShortId() {
    return window.Ultrascripts?.ws?.getAdventureShortId?.() || this.getCurrentAdventureId();
  }

  reset() {
    this.log('Resetting scanner state...');
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.scannedNames = new Set();
    this.cardDatabase = new Map();
    this.cardsList = [];
    this.lastScannedAdventureId = null;
    this.getSharedCache()?.clear?.();
  }

  resetIfAdventureChanged() {
    const currentId = this.getCurrentShortId();
    if (currentId && this.lastScannedAdventureId && currentId !== this.lastScannedAdventureId) {
      this.log(`Adventure changed from ${this.lastScannedAdventureId} to ${currentId}, resetting...`);
      this.reset();
    }
  }

  abort() {
    this.abortController?.abort();
  }

  getSharedCache() {
    if (typeof storyCardCache !== 'undefined') return storyCardCache;
    return window.storyCardCache || null;
  }

  async readStoryCards(shortId) {
    const reader = window.BetterDungeonAdventureRead;
    if (!reader?.readCards) throw new Error('The BetterDungeon adventure reader is unavailable.');
    return reader.readCards({
      shortId,
      signal: this.abortController?.signal,
    });
  }

  async scanAllCards(onTriggerFound = null, onProgress = null, onCardScanned = null) {
    const validation = this.validatePageState();
    if (!validation.valid) return { success: false, error: validation.error };

    this.resetIfAdventureChanged();
    this.isScanning = true;
    this.abortController = new AbortController();
    this.scanStartTime = Date.now();

    try {
      const shortId = this.getCurrentShortId();
      if (!shortId) {
        return { success: false, error: 'Adventure shortId is unknown' };
      }

      const snapshot = await this.readStoryCards(shortId);
      return this.consumeStoryCards(
        snapshot.cards,
        shortId,
        onTriggerFound,
        onProgress,
        onCardScanned,
        snapshot.provenance?.source || 'unavailable',
        snapshot.coverage?.storyCards || null
      );
    } catch (error) {
      if (error.name === 'AbortError' || this.abortController?.signal.aborted) {
        return { success: false, error: 'Scan aborted by user' };
      }
      console.error('StoryCardScanner: Scan failed:', error);
      return { success: false, error: error.message || String(error) };
    } finally {
      this.isScanning = false;
      this.abortController = null;
    }
  }

  consumeStoryCards(cards, shortId, onTriggerFound, onProgress, onCardScanned, source, coverage = null) {
    const results = new Map();
    const normalizedCards = [];

    for (const card of cards || []) {
      if (this.abortController?.signal.aborted) {
        return { success: false, error: 'Scan aborted by user' };
      }
      const normalized = this.normalizeCard(card);
      if (normalized) normalizedCards.push(normalized);
    }

    this.cardDatabase = new Map();
    this.cardsList = normalizedCards;
    this.scannedNames = new Set();
    this.lastScannedAdventureId = shortId;

    const cache = this.getSharedCache();
    cache?.importCards?.(normalizedCards, shortId, { replace: true });

    const total = normalizedCards.length;
    normalizedCards.forEach((card, index) => {
      this.cardDatabase.set(card.name, card);
      this.scannedNames.add(card.name);
      onProgress?.(index + 1, total, `Hydrating: ${card.name}`, null);

      for (const trigger of card.triggers) {
        this.addTriggerResult(results, trigger, card.name);
        cache?.setTrigger?.(trigger, card.name);
        onTriggerFound?.(trigger, card.name);
      }

      onCardScanned?.(card);
    });

    this.log(`Story-card scan hydrated ${total} cards from ${source}.`);

    // Surface an incomplete read instead of silently presenting partial
    // data as complete: the read service reports the authoritative total
    // (adventure.storyCardCount) when it knows it.
    const authoritativeTotal = Number.isFinite(coverage?.authoritativeTotal)
      ? coverage.authoritativeTotal
      : null;
    const incomplete = authoritativeTotal !== null && total < authoritativeTotal;

    return {
      success: true,
      triggers: results,
      scannedCount: total,
      cardDatabase: this.cardDatabase,
      source,
      coverage,
      authoritativeTotal,
      incomplete,
      message: total === 0 ? 'No story cards found' : undefined,
    };
  }

  normalizeCard(card) {
    if (!card || card.deletedAt) return null;

    const id = card.id != null ? String(card.id) : null;
    const value = String(card.value || card.entryText || '');
    const title = String(card.title || card.name || card.keys || (id ? `Story Card ${id}` : 'Unknown Card')).trim();
    const triggers = this.parseCardTriggers(Array.isArray(card.keys) ? card.keys.join(',') : card.keys);
    const type = String(card.type || 'other').toLowerCase();

    return {
      id,
      name: title || 'Unknown Card',
      type: this.CARD_TYPES.includes(type) ? type : 'other',
      description: String(card.description || value || ''),
      triggers,
      keys: [...triggers],
      entryText: value,
      value,
      hasImage: false,
      updatedAt: card.updatedAt || null,
      deletedAt: card.deletedAt || null,
      useForCharacterCreation: !!card.useForCharacterCreation,
      raw: card.raw || card,
    };
  }

  parseCardTriggers(value) {
    if (!value || typeof value !== 'string') return [];
    return value
      .split(',')
      .map(part => part.trim().toLowerCase())
      .filter(part => part.length > 0 && part.length < 50);
  }

  addTriggerResult(results, trigger, cardName) {
    const existingCard = results.get(trigger);
    // Membership must be an exact name match: a substring check drops a card
    // whose name is a prefix of an existing one ("Ann" vs "Anna").
    if (existingCard && existingCard !== cardName && !existingCard.split(', ').includes(cardName)) {
      results.set(trigger, `${existingCard}, ${cardName}`);
    } else if (!existingCard) {
      results.set(trigger, cardName);
    }
  }

  getCardDatabase() {
    return this.cardDatabase;
  }

  getAnalytics() {
    // Iterate the full scan list, not the name-keyed cardDatabase: cards
    // that share a title would otherwise collapse into one and every count
    // (total, by-type, coverage) would silently under-report.
    const cards = this.cardsList.length > 0
      ? this.cardsList
      : Array.from(this.cardDatabase.values());

    const analytics = {
      totalCards: cards.length,
      byType: {},
      withTriggers: 0,
      withoutTriggers: 0,
      withDescription: 0,
      withoutDescription: 0,
      withKeys: 0,
      averageTriggerCount: 0,
      triggerOverlaps: [],
      emptyCards: [],
      cardsWithDoubleLinebreaks: [],
      longCards: [],
      veryLongCards: [],
      characterNameIssues: [],
    };

    for (const type of this.CARD_TYPES) {
      analytics.byType[type] = 0;
    }

    let totalTriggers = 0;
    const triggerToCards = new Map();

    cards.forEach((card) => {
      const name = card.name;
      const type = card.type || 'other';
      analytics.byType[type] = (analytics.byType[type] || 0) + 1;

      if (card.triggers.length > 0) {
        analytics.withTriggers++;
        totalTriggers += card.triggers.length;
        for (const trigger of card.triggers) {
          const existing = triggerToCards.get(trigger) || [];
          existing.push(name);
          triggerToCards.set(trigger, existing);
        }
      } else {
        analytics.withoutTriggers++;
      }

      const entryContent = card.entryText || card.description || '';
      if (entryContent) analytics.withDescription++;
      else analytics.withoutDescription++;

      if (card.keys && card.keys.length > 0) analytics.withKeys++;
      if (!card.triggers.length && !entryContent) analytics.emptyCards.push(name);

      if (entryContent.includes('\n\n')) {
        analytics.cardsWithDoubleLinebreaks.push({
          name,
          count: (entryContent.match(/\n\n/g) || []).length,
        });
      }

      if (entryContent.length > 1500) {
        analytics.veryLongCards.push({ name, length: entryContent.length });
      } else if (entryContent.length > 800) {
        analytics.longCards.push({ name, length: entryContent.length });
      }

      if (type === 'character' && entryContent) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp(`\\b${escapedName}\\b`, 'gi');
        const nameCount = (entryContent.match(nameRegex) || []).length;
        if (nameCount < 3) {
          analytics.characterNameIssues.push({
            name,
            occurrences: nameCount,
            entryLength: entryContent.length,
          });
        }
      }
    });

    // The dashboard labels this "Avg Triggers/Card" — that is per card
    // overall, not per card-that-has-triggers (the old denominator, which
    // inflated the average whenever any card had no triggers).
    if (analytics.totalCards > 0) {
      analytics.averageTriggerCount = (totalTriggers / analytics.totalCards).toFixed(1);
    }

    triggerToCards.forEach((cards, trigger) => {
      if (cards.length > 1) {
        analytics.triggerOverlaps.push({ trigger, cards, count: cards.length });
      }
    });
    analytics.triggerOverlaps.sort((a, b) => b.count - a.count);

    return analytics;
  }

  log(...args) {
    if (this.debug) console.log('[StoryCardScanner]', ...args);
  }
}

const storyCardScanner = new StoryCardScanner();

if (typeof window !== 'undefined') {
  window.StoryCardScanner = StoryCardScanner;
  window.storyCardScanner = storyCardScanner;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StoryCardScanner, storyCardScanner };
}
