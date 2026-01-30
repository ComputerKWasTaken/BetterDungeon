/**
 * ============================================================================
 * BetterScripts Example - Widget System Showcase
 * ============================================================================
 * 
 * This file contains THREE separate scripts that go into different slots
 * in the AI Dungeon Scenario Editor:
 * 
 *   1. LIBRARY (sharedLibrary) - Runs first, defines helpers and state
 *   2. CONTEXT MODIFIER (onModelContext) - Strips protocol messages from AI context
 *   3. OUTPUT MODIFIER (onOutput) - Appends widget commands after AI response
 * 
 * IMPORTANT: Copy each section into its respective script slot!
 * 
 * WIDGET TYPES:
 *   - stat: Simple label + value (e.g., "Gold: 100")
 *   - bar: Progress bar with label (e.g., health bar)
 *   - text: Simple text display
 *   - panel: Container with title and multiple stat items
 * 
 * PROTOCOL FORMAT: [[BD:{json}:BD]]
 * 
 * HOW IT WORKS:
 *   1. Library initializes game state and helper functions
 *   2. Context Modifier strips protocol messages so AI doesn't see them
 *   3. Output Modifier appends protocol messages after AI response
 *   4. BetterDungeon extension reads DOM, processes messages, updates widgets
 *   5. Protocol messages are stripped from display before user sees them
 */


// ############################################################################
// #                                                                          #
// #   LIBRARY (sharedLibrary) - Copy this into your Library script slot      #
// #                                                                          #
// ############################################################################
// Runs FIRST before every modifier. Define state, helpers, and shared logic.
// This is NOT a modifier - no `const modifier = (text) => {}` wrapper needed.

// Initialize game state (persists across turns)
state.game = state.game ?? {
  turn: 0,
  hp: 100,
  maxHp: 100,
  gold: 0,
  level: 1,
  xp: 0,
  xpToLevel: 100,
  status: 'Healthy'
};

/**
 * Helper: Build a BetterScripts protocol message
 * @param {Object} message - The message object to encode
 * @returns {string} - Formatted protocol string
 */
function bdMessage(message) {
  return `[[BD:${JSON.stringify(message)}:BD]]`;
}

/**
 * Helper: Create/update a widget
 * @param {string} widgetId - Unique widget identifier
 * @param {Object} config - Widget configuration
 * @returns {string} - Protocol message string
 */
function bdWidget(widgetId, config) {
  return bdMessage({
    type: 'widget',
    widgetId: widgetId,
    action: 'create',
    config: config
  });
}

/**
 * Helper: Destroy a widget
 * @param {string} widgetId - Widget to destroy
 * @returns {string} - Protocol message string
 */
function bdDestroyWidget(widgetId) {
  return bdMessage({
    type: 'widget',
    widgetId: widgetId,
    action: 'destroy'
  });
}

/**
 * Helper: Get HP color based on percentage
 * @param {number} current - Current HP
 * @param {number} max - Maximum HP
 * @returns {string} - Hex color code
 */
function getHpColor(current, max) {
  const percent = (current / max) * 100;
  if (percent > 50) return '#22c55e';  // Green
  if (percent > 25) return '#fbbf24';  // Yellow
  return '#ef4444';                     // Red
}

/**
 * Helper: Get status text based on HP
 * @param {number} current - Current HP
 * @param {number} max - Maximum HP
 * @returns {string} - Status text
 */
function getStatus(current, max) {
  const percent = (current / max) * 100;
  if (percent <= 0) return 'Dead';
  if (percent <= 25) return 'Critical';
  if (percent <= 50) return 'Wounded';
  if (percent <= 75) return 'Injured';
  return 'Healthy';
}

// END LIBRARY


// ############################################################################
// #                                                                          #
// #   CONTEXT MODIFIER (onModelContext) - Copy into Context Modifier slot    #
// #                                                                          #
// ############################################################################
// Modifies text sent to the AI. We strip protocol messages so AI doesn't see them.

const modifier = (text) => {
  // Remove all BetterScripts protocol messages from context
  // This prevents the AI from seeing or repeating our widget commands
  text = text.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
  
  return { text };
};

modifier(text);

// END CONTEXT MODIFIER


// ############################################################################
// #                                                                          #
// #   OUTPUT MODIFIER (onOutput) - Copy this into Output Modifier slot       #
// #                                                                          #
// ############################################################################
// Modifies AI output before displaying. We append widget commands here.

const modifier = (text) => {
  const game = state.game;
  
  // -------------------------------------------------------------------------
  // GAME LOGIC - Update state based on story content
  // -------------------------------------------------------------------------
  const lowerText = text.toLowerCase();
  
  // Increment turn counter
  game.turn++;
  
  // Detect damage taken
  if (lowerText.includes('hit') || lowerText.includes('wound') || 
      lowerText.includes('hurt') || lowerText.includes('damage')) {
    const damage = Math.floor(Math.random() * 15) + 5;
    game.hp = Math.max(0, game.hp - damage);
  }
  
  // Detect healing
  if (lowerText.includes('heal') || lowerText.includes('potion') || 
      lowerText.includes('rest') || lowerText.includes('recover')) {
    const healing = Math.floor(Math.random() * 20) + 10;
    game.hp = Math.min(game.maxHp, game.hp + healing);
  }
  
  // Detect gold found
  if (lowerText.includes('gold') || lowerText.includes('coin') || 
      lowerText.includes('treasure') || lowerText.includes('loot')) {
    game.gold += Math.floor(Math.random() * 50) + 10;
    game.xp += 10;
  }
  
  // Detect combat victory
  if (lowerText.includes('defeat') || lowerText.includes('slay') || 
      lowerText.includes('kill') || lowerText.includes('victory')) {
    game.xp += 25;
  }
  
  // Level up check
  if (game.xp >= game.xpToLevel) {
    game.level++;
    game.xp -= game.xpToLevel;
    game.xpToLevel = Math.floor(game.xpToLevel * 1.5);
    game.maxHp += 10;
    game.hp = game.maxHp;
  }
  
  // Update status
  game.status = getStatus(game.hp, game.maxHp);
  const hpColor = getHpColor(game.hp, game.maxHp);
  
  // -------------------------------------------------------------------------
  // BUILD WIDGET MESSAGES
  // -------------------------------------------------------------------------
  let widgets = '';
  
  // Turn counter (stat widget)
  widgets += bdWidget('turn-counter', {
    type: 'stat',
    label: 'Turn',
    value: game.turn,
    color: '#60a5fa'
  });
  
  // HP bar (bar widget)
  widgets += bdWidget('hp-bar', {
    type: 'bar',
    label: 'HP',
    value: game.hp,
    max: game.maxHp,
    color: hpColor,
    showValue: true
  });
  
  // Character panel (panel widget)
  widgets += bdWidget('player-stats', {
    type: 'panel',
    title: 'Character',
    items: [
      { label: 'Level', value: game.level, color: '#a855f7' },
      { label: 'XP', value: game.xp + '/' + game.xpToLevel, color: '#60a5fa' },
      { label: 'Gold', value: game.gold, color: '#fbbf24' },
      { label: 'Status', value: game.status, color: hpColor }
    ]
  });
  
  // Conditional: Low health warning (text widget)
  const hpPercent = (game.hp / game.maxHp) * 100;
  if (hpPercent <= 25 && hpPercent > 0) {
    widgets += bdWidget('danger-warning', {
      type: 'text',
      text: '⚠️ DANGER: Low Health!',
      style: { color: '#ef4444', fontWeight: 'bold' }
    });
  } else {
    widgets += bdDestroyWidget('danger-warning');
  }
  
  // Append widget messages to output
  return { text: text + widgets };
};

modifier(text);

// END OUTPUT MODIFIER


// ############################################################################
// #                                                                          #
// #   WIDGET QUICK REFERENCE                                                 #
// #                                                                          #
// ############################################################################
/*
STAT WIDGET - Simple label + value display
  bdWidget('my-stat', {
    type: 'stat',
    label: 'Gold',
    value: 100,
    color: '#fbbf24'
  });

BAR WIDGET - Progress bar
  bdWidget('my-bar', {
    type: 'bar',
    label: 'HP',
    value: 75,
    max: 100,
    color: '#22c55e',
    showValue: true
  });

TEXT WIDGET - Simple text
  bdWidget('my-text', {
    type: 'text',
    text: 'Hello World!',
    style: { color: '#60a5fa', fontWeight: 'bold' }
  });

PANEL WIDGET - Multiple stats in container
  bdWidget('my-panel', {
    type: 'panel',
    title: 'Stats',
    items: [
      { label: 'HP', value: '100/100', color: '#22c55e' },
      { label: 'Gold', value: '50', color: '#fbbf24' }
    ]
  });

DESTROY WIDGET
  bdDestroyWidget('widget-id');

COLOR PALETTE:
  #22c55e - Green  (health, success)
  #fbbf24 - Yellow (gold, warning)
  #ef4444 - Red    (danger, damage)
  #60a5fa - Blue   (mana, info)
  #a855f7 - Purple (XP, special)
  #9ca3af - Gray   (neutral)
*/
