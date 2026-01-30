/* eslint-disable no-redeclare */
// ============================================
// BetterScripts Test Example
// ============================================
// This is an example AI Dungeon script that demonstrates
// how to communicate with BetterDungeon's BetterScripts feature.
//
// ⚠️ NOTE: This file contains SEPARATE script sections meant to be
// copied individually into AI Dungeon's script editor. Each section
// (Library, Input, Context, Output) runs independently in AI Dungeon.
// The duplicate 'modifier' declarations are intentional - they exist
// in separate contexts within AI Dungeon's scripting system.
//
// HOW TO USE:
// 1. Create a new scenario in AI Dungeon (Simple Start or Character Creator)
// 2. Go to Edit → Scripts tab
// 3. Copy each section below into its corresponding script file:
//    - LIBRARY section → Library script
//    - INPUT MODIFIER section → Input Modifier script
//    - CONTEXT MODIFIER section → Context Modifier script
//    - OUTPUT MODIFIER section → Output Modifier script
// 4. Play your adventure with BetterDungeon extension installed
//
// PROTOCOL:
// Scripts communicate with BetterDungeon by embedding JSON messages
// in state.message using the format: [[BD:{json}:BD]]
// BetterDungeon scans for these messages and processes them.
// ============================================


// ============================================
// LIBRARY (sharedLibrary) - Add this to your Library script
// ============================================

// BetterScripts Protocol Helper
// Queues a message to be sent to BetterDungeon
// Messages are embedded in the text output for reliable detection
function sendToBD(message) {
  const json = JSON.stringify(message);
  // Queue the protocol message to be appended to output
  if (!state.bdMessageQueue) {
    state.bdMessageQueue = [];
  }
  state.bdMessageQueue.push(`[[BD:${json}:BD]]`);
}

// Helper to flush queued messages into text output
// Call this in your Output modifier and append result to text
function flushBDMessages() {
  if (!state.bdMessageQueue || state.bdMessageQueue.length === 0) {
    return '';
  }
  const messages = state.bdMessageQueue.join('');
  state.bdMessageQueue = [];
  return messages;
}

// Initialize game state on first run
if (state.bdInitialized === undefined) {
  state.bdInitialized = true;
  state.hp = 100;
  state.maxHp = 100;
  state.gold = 50;
  state.level = 1;
  state.xp = 0;
  state.xpToLevel = 100;
  
  // Register with BetterDungeon on first load
  sendToBD({
    type: 'register',
    scriptId: 'rpg-stats-demo',
    scriptName: 'RPG Stats Demo',
    version: '1.0.0',
    capabilities: ['widgets', 'stats']
  });
}

// Helper to update the stats widget
function updateStatsWidget() {
  sendToBD({
    type: 'widget',
    widgetId: 'player-stats',
    action: 'create',
    config: {
      type: 'panel',
      title: 'Player Stats',
      items: [
        { label: 'Level', value: state.level, color: '#fbbf24' },
        { label: 'HP', value: `${state.hp}/${state.maxHp}`, color: state.hp < 30 ? '#ef4444' : '#22c55e' },
        { label: 'Gold', value: state.gold, color: '#fbbf24' },
        { label: 'XP', value: `${state.xp}/${state.xpToLevel}`, color: '#a855f7' }
      ]
    }
  });
}

// Helper to update the HP bar widget
function updateHpBar() {
  const hpPercent = Math.round((state.hp / state.maxHp) * 100);
  sendToBD({
    type: 'widget',
    widgetId: 'hp-bar',
    action: 'create',
    config: {
      type: 'bar',
      label: 'Health',
      value: hpPercent,
      max: 100,
      color: hpPercent < 30 ? '#ef4444' : hpPercent < 60 ? '#f59e0b' : '#22c55e'
    }
  });
}

// Process commands from player input
function processCommand(input) {
  const cmd = input.toLowerCase().trim();
  
  if (cmd === ':stats' || cmd === '/stats') {
    updateStatsWidget();
    updateHpBar();
    return true;
  }
  
  if (cmd === ':heal' || cmd === '/heal') {
    if (state.gold >= 10) {
      state.gold -= 10;
      state.hp = Math.min(state.hp + 30, state.maxHp);
      updateStatsWidget();
      updateHpBar();
      state.message = `You spend 10 gold to heal. HP restored to ${state.hp}/${state.maxHp}.`;
    } else {
      state.message = "You don't have enough gold to heal (costs 10 gold).";
    }
    return true;
  }
  
  if (cmd === ':damage' || cmd === '/damage') {
    // Test command to simulate taking damage
    const damage = Math.floor(Math.random() * 20) + 5;
    state.hp = Math.max(0, state.hp - damage);
    updateStatsWidget();
    updateHpBar();
    state.message = `You take ${damage} damage! HP: ${state.hp}/${state.maxHp}`;
    return true;
  }
  
  if (cmd === ':xp' || cmd === '/xp') {
    // Test command to gain XP
    const xpGain = Math.floor(Math.random() * 30) + 10;
    state.xp += xpGain;
    
    // Level up check
    if (state.xp >= state.xpToLevel) {
      state.level += 1;
      state.xp -= state.xpToLevel;
      state.xpToLevel = Math.floor(state.xpToLevel * 1.5);
      state.maxHp += 10;
      state.hp = state.maxHp;
      state.message = `You gained ${xpGain} XP and leveled up! You are now level ${state.level}!`;
    } else {
      state.message = `You gained ${xpGain} XP! (${state.xp}/${state.xpToLevel})`;
    }
    
    updateStatsWidget();
    updateHpBar();
    return true;
  }
  
  if (cmd === ':ping' || cmd === '/ping') {
    // Test connectivity with BetterDungeon
    sendToBD({
      type: 'ping',
      timestamp: Date.now(),
      data: 'Hello from AI Dungeon script!'
    });
    return true;
  }
  
  if (cmd === ':clear' || cmd === '/clear') {
    // Clear all widgets
    sendToBD({
      type: 'widget',
      widgetId: 'player-stats',
      action: 'destroy'
    });
    sendToBD({
      type: 'widget',
      widgetId: 'hp-bar',
      action: 'destroy'
    });
    state.message = 'Widgets cleared.';
    return true;
  }
  
  return false;
}


// ============================================
// INPUT MODIFIER (onInput) - Add this to your Input script
// ============================================

const modifier = (text) => {
  // Check for commands
  if (processCommand(text)) {
    return { text, stop: true };
  }
  
  // Normal input processing continues
  return { text };
};

modifier(text);


// ============================================
// CONTEXT MODIFIER (onModelContext) - Add this to your Context script
// ============================================

const modifier = (text) => {
  // Inject current stats into context so the AI knows about them
  const statsContext = `[Player Stats: Level ${state.level}, HP ${state.hp}/${state.maxHp}, Gold ${state.gold}]`;
  
  // Add stats at the beginning of context
  text = statsContext + '\n\n' + text;
  
  return { text };
};

modifier(text);


// ============================================
// OUTPUT MODIFIER (onOutput) - Add this to your Output script
// ============================================

const modifier = (text) => {
  // Update widgets after each AI response
  updateStatsWidget();
  updateHpBar();
  
  // Simulate random events
  if (Math.random() < 0.1) {
    // 10% chance to find gold
    const goldFound = Math.floor(Math.random() * 10) + 1;
    state.gold += goldFound;
    text += `\n\n[You found ${goldFound} gold!]`;
    updateStatsWidget();
  }
  
  if (Math.random() < 0.05) {
    // 5% chance to take random damage
    const damage = Math.floor(Math.random() * 10) + 1;
    state.hp = Math.max(0, state.hp - damage);
    text += `\n\n[You stumble and take ${damage} damage!]`;
    updateStatsWidget();
    updateHpBar();
  }
  
  // IMPORTANT: Flush all queued BetterScripts messages into the output
  // This embeds the protocol messages in the DOM for BetterDungeon to detect
  const bdMessages = flushBDMessages();
  if (bdMessages) {
    text += bdMessages;
  }
  
  return { text };
};

modifier(text);


// ============================================
// AVAILABLE COMMANDS (for players)
// ============================================
// :stats or /stats - Show/update the stats widgets
// :heal or /heal - Spend 10 gold to heal 30 HP
// :damage or /damage - Test: take random damage
// :xp or /xp - Test: gain random XP
// :ping or /ping - Test connectivity with BetterDungeon
// :clear or /clear - Remove all widgets
// ============================================
