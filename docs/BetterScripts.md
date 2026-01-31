# BetterScripts Developer Guide

**Protocol Version: 1.1.0**

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

> **Note:** Multiple messages can be sent in a single output. BetterDungeon processes them all.

---

# Script Structure

BetterScripts use three parts: **Library**, **Context Modifier**, and **Output Modifier**.
The **Input Modifier** is unused and is therefore irrelevant.

## 1. Library (sharedLibrary)
Use the Library to define shared state and helper functions.

```javascript
// Initialize state (persists across turns)
state.game = state.game ?? { hp: 100, gold: 0 };

// ============================================
// BETTERSCRIPTS PROTOCOL HELPERS
// ============================================

// Build a protocol message
function bdMessage(message) {
  return `[[BD:${JSON.stringify(message)}:BD]]`;
}

// Create or update a widget
function bdWidget(widgetId, config) {
  return bdMessage({
    type: 'widget',
    widgetId: widgetId,
    action: 'create',
    config: config
  });
}

// Destroy a widget
function bdDestroyWidget(widgetId) {
  return bdMessage({
    type: 'widget',
    widgetId: widgetId,
    action: 'destroy'
  });
}

// Show a notification toast
function bdNotify(text, options) {
  options = options || {};
  return bdMessage({
    type: 'notify',
    text: text,
    title: options.title,
    notifyType: options.notifyType || 'info',  // info, success, warning, error
    duration: options.duration || 3000
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
  // Update game state based on story content
  state.game.gold += 10;
  
  // Build protocol messages (can send multiple)
  let protocol = '';
  
  // Update widget
  protocol += bdWidget('gold-stat', { 
    type: 'stat', 
    label: 'Gold', 
    value: state.game.gold 
  });
  
  // Show notification
  protocol += bdNotify('Found 10 gold!', { notifyType: 'success' });
  
  return { text: text + protocol };
};
modifier(text);
```

---

# Protocol Reference

Messages use the format `[[BD:{json}:BD]]`.

## Message Types

| Type | Purpose |
|------|---------|
| `widget` | Create, update, or destroy UI widgets |
| `notify` | Show a temporary toast notification |
| `register` | Register a script with BetterDungeon |
| `ping` | Test connectivity |

---

## Widget Message
The primary message type for UI interaction.

```javascript
{
  "type": "widget",
  "widgetId": "unique-id",
  "action": "create",  // 'create', 'update', or 'destroy'
  "config": { ... }    // See Widget Types below
}
```

### Widget Options

| Property | Type | Description |
|----------|------|-------------|
| `widgetId` | string | Unique identifier for this widget |
| `action` | string | `create` (default), `update`, or `destroy`. Note: `create` acts as an upsert—it updates if the widget already exists |
| `config.type` | string | Widget type (see below) |
| `config.priority` | number | Higher values appear first (default: 0) |

---

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
Progress bar with smooth animation on value changes.
```javascript
{
  "type": "bar",
  "label": "HP",
  "value": 75,
  "max": 100,
  "color": "#ef4444",
  "showValue": true  // Shows "75/100"
}
```

### Panel Widget
A container for multiple stat items with optional icons and badges.
```javascript
{
  "type": "panel",
  "title": "Character",
  "items": [
    { "icon": "⚔️", "label": "Weapon", "value": "Sword" },
    { "label": "LVL", "value": 5, "color": "#a855f7" },
    { "label": "Quest", "value": "Active", "badge": "NEW", "badgeColor": "#22c55e" }
  ]
}
```

#### Panel Item Properties
| Property | Type | Description |
|----------|------|-------------|
| `icon` | string | Emoji or text prefix |
| `label` | string | Item label |
| `value` | any | Item value |
| `color` | string | Value text color |
| `badge` | string | Small badge text |
| `badgeColor` | string | Badge background color |

### List Widget
Simple list of items.
```javascript
{
  "type": "list",
  "title": "Quest Log",
  "items": [
    "Find the ancient sword",
    "Defeat the dragon",
    { "text": "Return home", "color": "#22c55e" }
  ]
}
```

### Text Widget
Styled text display.
```javascript
{
  "type": "text",
  "text": "Level Up!",
  "style": { "fontWeight": "bold", "color": "#fbbf24", "fontSize": "16px" }
}
```

### Custom Widget
For advanced use cases. HTML is sanitized (escaped) for security.
```javascript
{
  "type": "custom",
  "html": "<strong>Custom content</strong>"
}
```

> **Note:** Custom HTML is escaped to prevent XSS. For rich content, prefer using Panel or Text widgets with styling.

---

## Notify Message
Show a temporary toast notification that auto-dismisses.

```javascript
{
  "type": "notify",
  "text": "You found a sword!",
  "title": "Item Found",        // Optional
  "notifyType": "success",      // info, success, warning, error
  "duration": 3000              // ms (max: 10000)
}
```

> **Note:** A maximum of 5 notifications can be visible at once. Older notifications are removed when the limit is exceeded.

### Notification Types
| Type | Color | Use Case |
|------|-------|----------|
| `info` | Blue | General information |
| `success` | Green | Positive events (loot, level up) |
| `warning` | Yellow | Caution, low resources |
| `error` | Red | Damage, death, failure |

---

# Best Practices

1. **Strips are Mandatory:** Always use a Context Modifier to strip `[[BD:...:BD]]` tags. If you don't, the AI will start hallucinating protocol messages.

2. **Unique IDs:** Prefix your widget IDs (e.g., `rpg_hp`, `inv_panel`) to avoid conflicts with other scripts.

3. **State Safety:** Always use `state.obj = state.obj ?? {}` to initialize data.

4. **No Async:** AI Dungeon scripts do not support `async/await` or `Promises`.

5. **Widget Priority:** Use `priority` to control widget order. Higher values appear first:
   ```javascript
   bdWidget('hp-bar', { type: 'bar', priority: 10, ... });  // Appears first
   bdWidget('stats', { type: 'panel', priority: 5, ... });  // Appears second
   ```

6. **Destroy Unused Widgets:** Clean up widgets when they're no longer needed:
   ```javascript
   if (state.inventory.length === 0) {
     protocol += bdDestroyWidget('inventory-panel');
   }
   ```

7. **Use Notifications Sparingly:** Notifications are great for important events, but don't spam them every turn. A maximum of 5 can be visible at once.

---

# Troubleshooting

| Problem | Solution |
|---------|----------|
| **Visible Tags** | Extension not running, or tags in unmonitored area |
| **AI Hallucinations** | Context Modifier not stripping tags correctly |
| **Missing Widgets** | Check browser console (F12) for `[BetterScripts]` errors |
| **Duplicate Widgets** | Using the same widgetId in multiple scripts |
| **Widget Not Updating** | Make sure you're returning the protocol in `{ text: text + protocol }` |

---

# Events (Advanced)

BetterScripts emits events on `window` that you can listen to from other extensions:

```javascript
// Widget lifecycle events
window.addEventListener('betterscripts:widget:created', (e) => {
  console.log('Widget created:', e.detail.widgetId);
});

window.addEventListener('betterscripts:widget:updated', (e) => {
  console.log('Widget updated:', e.detail.widgetId);
});

window.addEventListener('betterscripts:widget:destroyed', (e) => {
  console.log('Widget destroyed:', e.detail.widgetId);
});

// Script registration
window.addEventListener('betterscripts:registered', (e) => {
  console.log('Script registered:', e.detail.scriptId);
});
```
