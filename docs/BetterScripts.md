# BetterScripts Developer Guide

BetterScripts enables AI Dungeon scripts to communicate with the BetterDungeon extension, allowing you to create dynamic UI widgets that display game state, stats, and other information.

## How It Works

```
┌─────────────────────┐                    ┌─────────────────────┐
│  AI Dungeon Script  │  [[BD:...:BD]]     │    BetterDungeon    │
│  (Output Modifier)  │ ────────────────►  │  (MutationObserver) │
└─────────────────────┘   DOM Text         └─────────────────────┘
                                                     │
                                                     ▼
                                           ┌─────────────────────┐
                                           │   Widget Created    │
                                           │  Protocol Stripped  │
                                           └─────────────────────┘
```

1. Your script embeds a **protocol message** in the AI's output text.
2. BetterDungeon detects the message via DOM observation.
3. The message is parsed and executed (e.g., widget created).
4. The protocol text is **stripped from the DOM** so the user never sees it.

---

# Script Structure

Our scripts consist of three parts: **Library**, **Context Modifier**, and **Output Modifier**.
The **Input Modifier** is unused and is therefore irrelevant.

## 1. Library (sharedLibrary)
Use the Library to define shared state and helper functions.

```javascript
// Initialize state
state.game = state.game ?? { hp: 100, gold: 0 };

// Helper: Build a protocol message
function bdMessage(message) {
  return `[[BD:${JSON.stringify(message)}:BD]]`;
}

// Helper: Create/update a widget
function bdWidget(widgetId, config) {
  return bdMessage({
    type: 'widget',
    widgetId: widgetId,
    action: 'create',
    config: config
  });
}

// Helper: Destroy a widget
function bdDestroyWidget(widgetId) {
  return bdMessage({
    type: 'widget',
    widgetId: widgetId,
    action: 'destroy'
  });
}
```

## 2. Context Modifier (onModelContext)
**CRITICAL:** You must strip protocol messages from the context so the AI doesn't see or repeat them.

```javascript
const modifier = (text) => {
  // Remove protocol messages from context
  text = text.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
  return { text };
};
modifier(text);
```

## 3. Output Modifier (onOutput)
This is where you update your game state and send widget commands.

```javascript
const modifier = (text) => {
  // Logic to update state...
  state.game.gold += 10;
  
  // Append widget update to the AI's output
  const widget = bdWidget('gold-stat', { 
    type: 'stat', 
    label: 'Gold', 
    value: state.game.gold 
  });
  
  return { text: text + widget };
};
modifier(text);
```

---

# Protocol Reference

Messages use the format `[[BD:{json}:BD]]`.

## Widget Message
The primary message type for UI interaction.

```javascript
{
  "type": "widget",
  "widgetId": "unique-id",
  "action": "create", // 'create' (or update), 'destroy'
  "config": { ... }    // See Widget Types below
}
```

## Widget Types

### Stat Widget
Simple label and value display.
```javascript
{
  "type": "stat",
  "label": "Health",
  "value": 75,
  "color": "#22c55e"
}
```

### Bar Widget
Progress bar for resources.
```javascript
{
  "type": "bar",
  "label": "HP",
  "value": 75,
  "max": 100,
  "color": "#ef4444",
  "showValue": true
}
```

### Panel Widget
A container for multiple stat items.
```javascript
{
  "type": "panel",
  "title": "Character",
  "items": [
    { "label": "LVL", "value": 5 },
    { "label": "XP", "value": "450/1000" }
  ]
}
```

### Text Widget
Simple text or notification.
```javascript
{
  "type": "text",
  "text": "Level Up!",
  "style": { "fontWeight": "bold", "color": "#fbbf24" }
}
```

### Custom Widget
Custom HTML content (sanitized for security).
```javascript
{
  "type": "custom",
  "html": "<div>Custom content here</div>"
}
```

---

# Best Practices

1. **Strips are Mandatory:** Always use a Context Modifier to strip `[[BD:...:BD]]` tags. If you don't, the AI will start hallucinating protocol messages.
2. **Unique IDs:** Prefix your widget IDs (e.g., `rpg_hp`) to avoid conflicts with other scripts.
3. **State Safety:** Always use `state.obj = state.obj ?? {}` to initialize data.
4. **No Async:** AI Dungeon scripts do not support `async/await` or `Promises`.

---

# Troubleshooting

- **Visible Tags:** If you see `[[BD:...]]` in the story text, the extension isn't running or the tags are being rendered in an area the extension doesn't monitor.
- **AI Hallucinations:** If the AI starts typing protocol tags, your Context Modifier isn't stripping them correctly.
- **Missing Widgets:** Check the browser console (F12) for `[BetterScripts]` error messages.
