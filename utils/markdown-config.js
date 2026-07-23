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

  const DEFAULT_INSTRUCTION_PRESET = 'behaviorContract';

  const INSTRUCTION_PRESETS = [
    {
      id: 'behaviorContract',
      label: 'Balanced',
      description: 'Selective, natural emphasis for most adventures.',
      instructions: [
        '## BetterDungeon Markdown',
        'Use custom emphasis marks in every narrative response. Mark 1-3 short phrases, not full sentences or paragraphs.',
        '',
        '- ++phrase++ for important names, objects, discoveries, actions, threats, or consequences.',
        '- //phrase// for thoughts, whispers, memories, sensory details, distant voices, or subtle mood.',
        '- ++//phrase//++ for urgent danger, intense emotion, shouted words, supernatural force, or climactic moments.',
        '',
        'Prefer vivid, meaningful emphasis over decoration.',
      ],
      authorsNote: `${NOTE_MARKER} Every narrative response should mark 1-3 short phrases with custom emphasis: ++important thing++, //inner/sensory detail//, ++//urgent moment//++.`,
    },
    {
      id: 'strongCompliance',
      label: 'Strict',
      description: 'Higher compliance pressure with clear limits.',
      instructions: [
        '## BetterDungeon Markdown',
        'Every narrative response must include BetterDungeon custom emphasis. Use at least one marked phrase unless the response is purely mechanical or out-of-character.',
        '',
        'Use:',
        '- ++text++ for key story elements: names, items, threats, discoveries, choices, consequences.',
        '- //text// for quiet or inward material: thoughts, whispers, memories, instincts, sensations, atmosphere.',
        '- ++//text//++ for high-impact moments: danger, panic, shouting, magic, violence, revelation, emotional peaks.',
        '',
        'Only mark short phrases of 1-6 words.',
      ],
      authorsNote: `${NOTE_MARKER} Include at least one custom-emphasized short phrase in every narrative response; use ++key element++, //inner detail//, or ++//high-impact moment//++.`,
    },
    {
      id: 'narratorStyle',
      label: 'Narrative',
      description: 'Frames emphasis as part of pacing and voice.',
      instructions: [
        '## BetterDungeon Markdown',
        'Use BetterDungeon custom emphasis as part of the narrator\'s prose style. Each narrative response should visually highlight a few important story beats.',
        '',
        '- Use ++text++ when the phrase anchors the scene: a name, object, clue, threat, action, or consequence.',
        '- Use //text// when the phrase is quiet, inward, sensory, remembered, whispered, uncertain, or atmospheric.',
        '- Use ++//text//++ when the phrase lands with intensity: urgency, danger, magic, pain, shock, shouting, or revelation.',
        '',
        'Keep emphasis selective: short phrases only.',
      ],
      authorsNote: `${NOTE_MARKER} Narration should highlight a few short, meaningful phrases with ++concrete story focus++, //quiet inner detail//, or ++//urgent intensity//++.`,
    },
    {
      id: 'minimal',
      label: 'Minimal',
      description: 'Shortest instruction footprint.',
      instructions: [
        '## BetterDungeon Markdown',
        'In every narrative response, mark 1-3 short phrases with custom emphasis:',
        '++key story element++ for important plot, action, danger, item, clue, or consequence.',
        '//inner or sensory detail// for thought, whisper, memory, mood, instinct, or atmosphere.',
        '++//urgent peak//++ for danger, shouting, shock, magic, revelation, or intense emotion.',
        '',
        'Never mark whole paragraphs.',
      ],
      authorsNote: `${NOTE_MARKER} Every narrative response: mark 1-3 short phrases, never whole paragraphs: ++key++, //inner/sensory//, ++//urgent//++.`,
    },
    {
      id: 'roleMap',
      label: 'Role Map',
      description: 'Teaches the model to choose syntax by scene function.',
      instructions: [
        '## BetterDungeon Markdown',
        'Use BetterDungeon custom emphasis in every narrative response. Choose marks based on what the phrase does in the scene.',
        '',
        '++text++ = the phrase is important to the plot, action, danger, inventory, clue, choice, or consequence.',
        '//text// = the phrase is internal, quiet, sensory, remembered, atmospheric, whispered, or uncertain.',
        '++//text//++ = the phrase is a peak moment: panic, shouting, pain, magic, revelation, shock, or immediate threat.',
        '',
        'Emphasize short phrases only.',
      ],
      authorsNote: `${NOTE_MARKER} In every narrative response, emphasize short phrases by role: ++plot/action importance++, //inner or sensory detail//, ++//peak intensity//++.`,
    },
    {
      id: 'fewShot',
      label: 'Examples',
      description: 'Uses examples to nudge format and placement.',
      instructions: [
        '## BetterDungeon Markdown',
        'Use BetterDungeon custom emphasis in every narrative response. Mark 1-3 short phrases, not full sentences.',
        '',
        'Examples:',
        'The door opens to reveal ++fresh blood on the stones++.',
        '//Something is watching// from beyond the trees.',
        'The sigil ignites and the room shakes: ++//Get down!//++',
        '',
        'Use ++text++ for important concrete story elements, //text// for inner/sensory/quiet details, and ++//text//++ for urgent or intense moments.',
      ],
      authorsNote: `${NOTE_MARKER} Every narrative response should include 1-3 short custom-emphasized phrases: ++important++, //quiet/internal//, or ++//urgent//++.`,
    },
  ];

  function getInstructionPreset(presetId) {
    return INSTRUCTION_PRESETS.find(preset => preset.id === presetId)
      || INSTRUCTION_PRESETS.find(preset => preset.id === DEFAULT_INSTRUCTION_PRESET)
      || INSTRUCTION_PRESETS[0];
  }

  function wrapInstructions(lines) {
    return [
      BEGIN_MARKER,
      ...lines,
      END_MARKER,
    ].join('\n');
  }

  const config = {
    formats: FORMATS,
    instructionPresets: INSTRUCTION_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
    defaultInstructionPreset: DEFAULT_INSTRUCTION_PRESET,
    beginMarker: BEGIN_MARKER,
    endMarker: END_MARKER,
    noteMarker: NOTE_MARKER,
    getInstructionPreset,
    buildInstructions(presetId = DEFAULT_INSTRUCTION_PRESET) {
      return wrapInstructions(getInstructionPreset(presetId).instructions);
    },
    buildAuthorsNote(presetId = DEFAULT_INSTRUCTION_PRESET) {
      return getInstructionPreset(presetId).authorsNote;
    },
  };

  global.BetterDungeonMarkdownConfig = config;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
  }
})(typeof window !== 'undefined' ? window : globalThis);
