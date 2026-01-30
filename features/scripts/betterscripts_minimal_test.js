/* eslint-disable no-redeclare */
// ============================================
// BetterScripts MINIMAL Test - Two-Hook Pattern
// ============================================
// NOTE: This file contains TWO SEPARATE SCRIPTS.
// Copy each section into its respective modifier in AI Dungeon.
// ============================================
// This pattern ensures protocol messages are INVISIBLE to the AI:
// 1. CONTEXT MODIFIER strips messages BEFORE AI sees context
// 2. OUTPUT MODIFIER appends messages AFTER AI generates
// 3. BetterDungeon removes messages from DOM before user sees them
// ============================================


// ============================================
// CONTEXT MODIFIER (onModelContext)
// ============================================
// Add this to your scenario's Context Modifier script.
// This strips any protocol messages from history/context
// BEFORE the AI model sees them.
// ============================================

const modifier = (text) => {
  // Strip all BetterScripts protocol messages from context
  // This ensures the AI never sees [[BD:...:BD]] patterns
  text = text.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
  return { text };
};

modifier(text);


// ============================================
// OUTPUT MODIFIER (onOutput)
// ============================================
// Add this to your scenario's Output Modifier script.
// This appends protocol messages AFTER the AI has generated,
// so the AI never sees them. BetterDungeon removes them from DOM.
// ============================================

// Initialize turn counter on first run
if (state.turnCount === undefined) {
  state.turnCount = 0;
}
state.turnCount++;

// Build the BetterScripts protocol message
const widgetMessage = {
  type: 'widget',
  widgetId: 'turn-counter',
  action: 'create',
  config: {
    type: 'stat',
    label: 'Turn',
    value: state.turnCount,
    color: '#22c55e'
  }
};

// Create the protocol string
const protocolMessage = '[[BD:' + JSON.stringify(widgetMessage) + ':BD]]';

// The modifier function - append protocol AFTER AI output
const modifier = (text) => {
  // Append protocol message to the end
  // BetterDungeon will detect and remove it from DOM
  return { text: text + protocolMessage };
};

modifier(text);
