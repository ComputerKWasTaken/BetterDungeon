// BetterDungeon - Story Card Scanner Service
// Hydrates story cards from Ultrascripts/GraphQL and exposes trigger analytics.

class StoryCardScanner {
  constructor() {
    this.isScanning = false;
    this.abortController = null;
    this.scanStartTime = null;
    this.scannedNames = new Set();
    this.cardDatabase = new Map();
    this.lastScannedAdventureId = null;
    this.debug = false;
    this.CARD_TYPES = ['character', 'location', 'item', 'faction', 'lore', 'other'];
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

  getWsStoryCards() {
    const cards = window.Ultrascripts?.ws?.getCards?.();
    if (!cards) return [];
    return cards instanceof Map ? Array.from(cards.values()) : Array.from(cards);
  }

  async fetchStoryCardsViaGraphQL(shortId) {
    const gql = window.BetterDungeonGQL;
    if (!gql?.request) {
      throw new Error('GraphQL service unavailable');
    }

    const result = await gql.request(
      'GetBetterDungeonStoryCards',
      { shortId },
      window.BetterDungeonGQLService?.QUERIES?.storyCards || `query GetBetterDungeonStoryCards($shortId: String) {
        adventure(shortId: $shortId) {
          id
          shortId
          storyCardCount
          storyCards {
            id
            type
            title
            description
            keys
            value
            deletedAt
            updatedAt
            useForCharacterCreation
            __typename
          }
          __typename
        }
      }`,
      { timeoutMs: 30000, signal: this.abortController?.signal }
    );

    const adventure = result?.data?.adventure;
    if (!adventure) {
      throw new Error('GraphQL story-card lookup returned no adventure data.');
    }
    return Array.isArray(adventure.storyCards) ? adventure.storyCards : [];
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

      const wsCards = this.getWsStoryCards();
      const cards = wsCards.length > 0
        ? wsCards
        : await this.fetchStoryCardsViaGraphQL(shortId);

      return this.consumeStoryCards(
        cards,
        shortId,
        onTriggerFound,
        onProgress,
        onCardScanned,
        wsCards.length > 0 ? 'ws' : 'graphql'
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

  consumeStoryCards(cards, shortId, onTriggerFound, onProgress, onCardScanned, source) {
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

    return {
      success: true,
      triggers: results,
      scannedCount: total,
      cardDatabase: this.cardDatabase,
      source,
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
    if (existingCard && existingCard !== cardName && !existingCard.includes(cardName)) {
      results.set(trigger, `${existingCard}, ${cardName}`);
    } else if (!existingCard) {
      results.set(trigger, cardName);
    }
  }

  getCardDatabase() {
    return this.cardDatabase;
  }

  getAnalytics() {
    const analytics = {
      totalCards: this.cardDatabase.size,
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

    this.cardDatabase.forEach((card, name) => {
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

    if (analytics.withTriggers > 0) {
      analytics.averageTriggerCount = (totalTriggers / analytics.withTriggers).toFixed(1);
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
