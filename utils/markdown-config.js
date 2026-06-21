// BetterDungeon - Markdown Config
// Shared Markdown syntax metadata and generated AI instruction text.

(function initBetterDungeonMarkdownConfig(global) {
  const BEGIN_MARKER = '[BetterDungeon Markdown: Begin]';
  const END_MARKER = '[BetterDungeon Markdown: End]';
  const NOTE_MARKER = '[BetterDungeon Markdown]';

  const FORMATS = [
    {
      id: 'bold',
      label: 'Bold',
      syntax: '++text++',
      preview: '<strong>bold</strong>',
      role: 'Important names, discoveries, actions, threats, items, or consequences.',
    },
    {
      id: 'italic',
      label: 'Italic',
      syntax: '//text//',
      preview: '<em>italic</em>',
      role: 'Thoughts, whispers, sensory details, memories, dreams, or distant voices.',
    },
    {
      id: 'boldItalic',
      label: 'Bold Italic',
      syntax: '++//text//++',
      preview: '<strong><em>bold italic</em></strong>',
      role: 'Climactic emotion, shouted words, supernatural force, sudden danger, or high-impact moments.',
    },
  ];

  const INSTRUCTIONS = [
    BEGIN_MARKER,
    '## BetterDungeon Markdown',
    'Use BetterDungeon custom Markdown in every response to make important story moments visually distinct.',
    '',
    '- Use ++bold++ for important names, discoveries, decisive actions, threats, items, or consequences. Example: ++the obsidian key++.',
    '- Use //italic// for thoughts, whispers, sensory details, memories, dreams, distant voices, or subtle emphasis. Example: //too quiet//.',
    '- Use ++//bold italic//++ for climactic emotion, shouted words, supernatural force, sudden danger, or high-impact moments. Example: ++//Run!//++.',
    '',
    'Mark short phrases, not whole paragraphs.',
    END_MARKER,
  ].join('\n');

  const AUTHORS_NOTE = `${NOTE_MARKER} Every response should use custom Markdown: ++key phrase++, //thought or sensory detail//, ++//high-impact moment//++; mark short phrases only.`;

  const config = {
    formats: FORMATS,
    beginMarker: BEGIN_MARKER,
    endMarker: END_MARKER,
    noteMarker: NOTE_MARKER,
    buildInstructions() {
      return INSTRUCTIONS;
    },
    buildAuthorsNote() {
      return AUTHORS_NOTE;
    },
  };

  global.BetterDungeonMarkdownConfig = config;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  }
})(typeof window !== 'undefined' ? window : globalThis);
