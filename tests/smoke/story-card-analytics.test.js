'use strict';

// Regression checks for the Story Card Analytics audit (2026-11-17):
// duplicate card titles collapsed every count, "Avg Triggers/Card" divided
// by only the cards that have triggers, native race/class cards were
// bucketed as "other", trigger->card membership used substring matching,
// cache lookups were not case-normalized like writes, card-derived strings
// were interpolated into the dashboard unescaped, and incomplete scans were
// presented as complete.

const test = require('node:test');
const assert = require('node:assert/strict');

// The scanner's shared-cache lookup falls back to window in the browser,
// and the cache registers document listeners when window exists.
global.window = {};
global.document = { addEventListener() {} };

const { StoryCardScanner } = require('../../services/story-card-scanner.js');
const { StoryCardCache } = require('../../services/story-card-cache.js');
const StoryCardAnalyticsFeature = require('../../features/story_card_analytics_feature.js');

function scan(scanner, cards, coverage = null) {
  return scanner.consumeStoryCards(cards, 'adv1', null, null, null, 'test', coverage);
}

test('cards that share a title are all counted', () => {
  const scanner = new StoryCardScanner();
  scan(scanner, [
    { id: '1', type: 'character', title: 'Twins', keys: 'twin', value: 'First twin entry text' },
    { id: '2', type: 'character', title: 'Twins', keys: 'twin', value: 'Second twin entry text' },
  ]);
  const analytics = scanner.getAnalytics();
  assert.equal(analytics.totalCards, 2);
  assert.equal(analytics.byType.character, 2);
});

test('average triggers is per card overall, matching its label', () => {
  const scanner = new StoryCardScanner();
  scan(scanner, [
    { id: '1', type: 'character', title: 'A', keys: 'one,two', value: 'A entry' },
    { id: '2', type: 'location', title: 'B', keys: '', value: 'B entry' },
  ]);
  const analytics = scanner.getAnalytics();
  // 2 triggers across 2 cards = 1.0 (the old code divided by the 1 card
  // that has triggers and reported 2.0).
  assert.equal(analytics.averageTriggerCount, '1.0');
});

test('native race and class cards get their own type buckets', () => {
  const scanner = new StoryCardScanner();
  scan(scanner, [
    { id: '1', type: 'race', title: 'Elf', keys: 'elf', value: 'Elf entry' },
    { id: '2', type: 'class', title: 'Wizard', keys: 'wizard', value: 'Wizard entry' },
  ]);
  const analytics = scanner.getAnalytics();
  assert.equal(analytics.byType.race, 1);
  assert.equal(analytics.byType.class, 1);
  assert.equal(analytics.byType.other, 0);
});

test('trigger membership is an exact name match, not a substring', () => {
  const scanner = new StoryCardScanner();
  const result = scan(scanner, [
    { id: '1', type: 'character', title: 'Anna', keys: 'hero', value: 'Anna entry' },
    { id: '2', type: 'character', title: 'Ann', keys: 'hero', value: 'Ann entry' },
  ]);
  assert.equal(result.triggers.get('hero'), 'Anna, Ann');
  const analytics = scanner.getAnalytics();
  assert.equal(analytics.triggerOverlaps.length, 1);
  assert.deepEqual(analytics.triggerOverlaps[0].cards.sort(), ['Ann', 'Anna']);
});

test('an incomplete scan is flagged against the authoritative total', () => {
  const scanner = new StoryCardScanner();
  const result = scan(scanner, [
    { id: '1', type: 'character', title: 'A', keys: 'a', value: 'A entry' },
    { id: '2', type: 'character', title: 'B', keys: 'b', value: 'B entry' },
  ], { authoritativeTotal: 5 });
  assert.equal(result.incomplete, true);
  assert.equal(result.authoritativeTotal, 5);

  const complete = scan(new StoryCardScanner(), [
    { id: '1', type: 'character', title: 'A', keys: 'a', value: 'A entry' },
  ], { authoritativeTotal: 1 });
  assert.equal(complete.incomplete, false);
});

test('cache trigger lookups normalize case like writes do', () => {
  const cache = new StoryCardCache();
  cache.setTrigger('Hero', 'Anna');
  cache.setTrigger('hero', 'Ann');
  assert.equal(cache.getTrigger('HERO'), 'Anna, Ann');
  assert.equal(cache.hasTrigger('HeRo'), true);
});

test('dashboard escapes card-derived strings in text and attributes', () => {
  const feature = new StoryCardAnalyticsFeature();
  const evil = '"><script>alert(1)</script>';
  const html = feature.renderAnalytics({
    totalCards: 1,
    byType: { character: 1 },
    withTriggers: 1,
    withoutTriggers: 0,
    withDescription: 0,
    withoutDescription: 1,
    averageTriggerCount: '1.0',
    triggerOverlaps: [{ trigger: evil, cards: [evil], count: 2 }],
    emptyCards: [evil],
    cardsWithDoubleLinebreaks: [],
    longCards: [],
    veryLongCards: [],
    characterNameIssues: [],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not be interpolated');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form should be rendered');
  assert.ok(!html.includes(`data-card-name="${evil}"`), 'attribute must not be breakable');
});
