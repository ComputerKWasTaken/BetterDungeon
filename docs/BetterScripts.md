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

1. Your script embeds a **protocol message** in the AI's output text
2. BetterDungeon detects the message via DOM observation
3. The message is parsed and executed (e.g., widget created)
4. The protocol text is **stripped from the DOM** so the user never sees it

## Protocol Format

Messages use this format:
```
[[BD:{"type":"...", ...}:BD]]
```

The JSON payload must be valid and include a `type` field.

---

## Two-Hook Pattern (Recommended)

To keep protocol messages invisible to both the AI and the user, use two modifiers:

### Context Modifier (strips messages from AI context)
```javascript
const modifier = (text) => {
  text = text.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
  return { text };
};
modifier(text);
```

### Output Modifier (appends messages after AI output)
```javascript
// Your logic here...
const message = {
  type: 'widget',
  widgetId: 'my-widget',
  action: 'create',
  config: { type: 'stat', label: 'Score', value: 42 }
};

const protocol = '[[BD:' + JSON.stringify(message) + ':BD]]';
const modifier = (text) => ({ text: text + protocol });
modifier(text);
```

---

## Message Types

### 1. Widget Messages

Create, update, or destroy UI widgets.

```javascript
{
  type: 'widget',
  widgetId: 'unique-id',    // Required: unique identifier
  action: 'create',         // 'create' | 'update' | 'destroy'
  config: { ... }           // Widget configuration (see below)
}
```

### 2. Register Messages

Register your script with BetterDungeon (optional, for identification).

```javascript
{
  type: 'register',
  scriptId: 'my-script',
  scriptName: 'My Awesome Script',
  version: '1.0.0',
  capabilities: ['widgets', 'stats']
}
```

### 3. Update Messages

Generic update message for custom handling.

```javascript
{
  type: 'update',
  target: 'widget-id',
  data: { ... }
}
```

### 4. Remove Messages

Remove a widget.

```javascript
{
  type: 'remove',
  target: 'widget-id'
}
```

---

## Widget Types

### Stat Widget
Displays a label and value.

```javascript
{
  type: 'stat',
  label: 'Health',
  value: 75,
  color: '#22c55e'  // Optional: value color
}
```

**Result:** `Health: 75`

---

### Bar Widget
Displays a progress bar.

```javascript
{
  type: 'bar',
  label: 'HP',
  value: 75,
  max: 100,
  color: '#22c55e',
  showValue: true   // Optional: show "75/100" text
}
```

**Result:** A progress bar at 75%

---

### Text Widget
Displays simple text.

```javascript
{
  type: 'text',
  text: 'Welcome to the adventure!',
  style: {          // Optional: CSS styles
    color: '#fbbf24',
    fontWeight: 'bold'
  }
}
```

---

### Panel Widget
Displays a titled panel with multiple items.

```javascript
{
  type: 'panel',
  title: 'Player Stats',
  items: [
    { label: 'HP', value: '75/100', color: '#22c55e' },
    { label: 'Gold', value: '42', color: '#fbbf24' },
    { label: 'Level', value: '5', color: '#a855f7' }
  ]
}
```

**Result:** A panel displaying multiple stat rows

---

## Complete Example

Here's a full example that tracks player health:

### Context Modifier
```javascript
// Strip protocol messages from AI context
const modifier = (text) => {
  text = text.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
  return { text };
};
modifier(text);
```

### Output Modifier
```javascript
// Initialize state
if (!state.player) {
  state.player = { hp: 100, maxHp: 100, gold: 0 };
}

// Simulate taking damage (example logic)
if (text.toLowerCase().includes('hit') || text.toLowerCase().includes('attack')) {
  state.player.hp = Math.max(0, state.player.hp - Math.floor(Math.random() * 20));
}

// Create health bar widget
const hpWidget = {
  type: 'widget',
  widgetId: 'player-hp',
  action: 'create',
  config: {
    type: 'bar',
    label: 'HP',
    value: state.player.hp,
    max: state.player.maxHp,
    color: state.player.hp > 50 ? '#22c55e' : state.player.hp > 25 ? '#fbbf24' : '#ef4444'
  }
};

// Send to BetterDungeon
const protocol = '[[BD:' + JSON.stringify(hpWidget) + ':BD]]';
const modifier = (text) => ({ text: text + protocol });
modifier(text);
```

---

## Best Practices

1. **Always use the two-hook pattern** - Context Modifier strips, Output Modifier appends
2. **Use unique widget IDs** - Prevents conflicts between scripts
3. **Keep payloads small** - Large JSON may impact performance
4. **Prefix widget IDs** - e.g., `myscript-health` to avoid collisions
5. **Handle missing state** - Always initialize `state` properties with defaults

---

## Debugging

Open browser DevTools (F12) and look for `[BetterScripts]` logs:

```
[BetterScripts] Found message in DOM: {type: 'widget', ...}
[BetterScripts] Widget created: player-hp
```

---

## API Reference

### Widget Config Properties

| Property | Type | Description |
|----------|------|-------------|
| `type` | string | Widget type: `stat`, `bar`, `text`, `panel` |
| `label` | string | Display label |
| `value` | any | Current value |
| `max` | number | Maximum value (for `bar` type) |
| `color` | string | CSS color for value/bar |
| `title` | string | Panel title (for `panel` type) |
| `items` | array | Panel items (for `panel` type) |
| `text` | string | Display text (for `text` type) |
| `style` | object | CSS styles (for `text` type) |

### Message Actions

| Action | Description |
|--------|-------------|
| `create` | Create or replace a widget |
| `update` | Update existing widget properties |
| `destroy` | Remove a widget |

---

## Troubleshooting

**Widget not appearing?**
- Ensure you're in an active adventure (not the home page)
- Check DevTools console for `[BetterScripts]` errors
- Verify JSON is valid (use `JSON.stringify()`)

**Protocol text visible to user?**
- Make sure BetterDungeon extension is installed and enabled
- Reload the page after installing

**AI seeing protocol messages?**
- Add the Context Modifier to strip messages from history

---

## Version History

- **1.0.0** - Initial release with widget support
