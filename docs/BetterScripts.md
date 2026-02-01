# BetterScripts Developer Guide

BetterScripts is a powerful bridge between AI Dungeon's scripting system and the BetterDungeon browser extension. It enables scripts to create dynamic, real-time UI widgets that display game state, statistics, progress bars, and custom content. This allows for rich visual feedback without lackluster vanilla implementations to communicate with the user of the script.

---

## Quick Start

**1. Add helper functions to your Library:**
```javascript
state.game = state.game ?? { hp: 100, gold: 0 };

function bdMessage(msg) {
  return `[[BD:${JSON.stringify(msg)}:BD]]`;
}

function bdWidget(id, config) {
  return bdMessage({ type: 'widget', widgetId: id, action: 'create', config });
}
```

**2. Strip protocol messages in Context Modifier:**
```javascript
const modifier = (text) => {
  return { text: text.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '') };
};
modifier(text);
```

**3. Create widgets in Output Modifier:**
```javascript
const modifier = (text) => {
  const widget = bdWidget('hp-bar', { 
    type: 'bar', label: 'HP', value: state.game.hp, max: 100, color: '#22c55e' 
  });
  return { text: text + widget };
};
modifier(text);
```

---

## How It Works

```
Script (Output Modifier)  →  [[BD:{json}:BD]]  →  BetterDungeon  →  Widget Created
                                                        ↓
                                              Protocol text stripped from DOM
```

1. Your script embeds a protocol message in the AI's output
2. BetterDungeon detects and parses the message
3. Widget is created/updated based on the message
4. Protocol text is removed so the user never sees it

---

## Script Structure

Scripts use three parts: **Library**, **Context Modifier**, and **Output Modifier**.

### Library
Define state and helper functions that all modifiers can use.

```javascript
state.game = state.game ?? { hp: 100, gold: 0 };

function bdMessage(msg) { return `[[BD:${JSON.stringify(msg)}:BD]]`; }
function bdWidget(id, cfg) { return bdMessage({ type: 'widget', widgetId: id, action: 'create', config: cfg }); }
function bdUpdate(id, cfg) { return bdMessage({ type: 'widget', widgetId: id, action: 'update', config: cfg }); }
function bdDestroy(id) { return bdMessage({ type: 'widget', widgetId: id, action: 'destroy' }); }
function bdClearAll() { return bdMessage({ type: 'clearAll' }); }
```

### Context Modifier
**Required:** Strip protocol messages so the AI doesn't see or repeat them.

```javascript
const modifier = (text) => {
  return { text: text.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '') };
};
modifier(text);
```

### Output Modifier
Update game state and append widget commands to the AI's response.

```javascript
const modifier = (text) => {
  state.game.gold += 10;
  return { text: text + bdWidget('gold', { type: 'stat', label: 'Gold', value: state.game.gold }) };
};
modifier(text);
```

---

## Widget Types

### Stat
Label + value display.
```javascript
{ type: 'stat', label: 'Gold', value: 100, color: '#fbbf24', order: 1 }
```

### Bar
Progress bar with fill indicator.
```javascript
{ type: 'bar', label: 'HP', value: 75, max: 100, color: '#22c55e', showValue: true, order: 2 }
```

### Panel
Container for multiple stats.
```javascript
{ type: 'panel', title: 'Character', items: [
  { label: 'LVL', value: 5 },
  { label: 'XP', value: '450/1000', color: '#60a5fa' }
], order: 3 }
```

### Text
Simple text display.
```javascript
{ type: 'text', text: 'Level Up!', style: { fontWeight: 'bold', color: '#fbbf24' }, order: 4 }
```

### Custom
Custom HTML content (sanitized).
```javascript
{ type: 'custom', html: '<strong>HP:</strong> <span style="color:#22c55e">100</span>', order: 5 }
```

---

## Widget Properties

| Property | Type | Description |
|----------|------|-------------|
| `type` | string | **Required.** `stat`, `bar`, `panel`, `text`, or `custom` |
| `label` | string | Display label (stat, bar) |
| `value` | any | Display value (stat, bar, panel items) |
| `max` | number | Maximum value for bar (default: 100) |
| `color` | string | CSS color for value/fill |
| `showValue` | boolean | Show value text on bar (default: true) |
| `title` | string | Panel title |
| `items` | array | Panel items: `[{ label, value, color }]` |
| `text` | string | Text widget content |
| `html` | string | Custom widget HTML (sanitized) |
| `style` | object | CSS styles for text/custom widgets |
| `order` | number | Display order (lower = first) |

---

## Message Types

### Widget Actions
```javascript
{ type: 'widget', widgetId: 'hp', action: 'create', config: { ... } }  // Create or update
{ type: 'widget', widgetId: 'hp', action: 'update', config: { value: 50 } }  // Update properties
{ type: 'widget', widgetId: 'hp', action: 'destroy' }  // Remove widget
```

| Action | Behavior |
|--------|----------|
| `create` | Creates widget, or updates in place if ID exists |
| `update` | Updates specific properties; auto-creates if missing |
| `destroy` | Removes the widget |

### Other Messages
```javascript
{ type: 'clearAll' }  // Remove all widgets
{ type: 'ping', data: 'test' }  // Test connectivity (logs to console)
{ type: 'register', scriptId: 'my-script', scriptName: 'My Script', version: '1.0' }  // Announce script
```

### Widget ID Rules
- Alphanumeric, underscores, and hyphens only
- Examples: `hp-bar`, `gold_stat`, `player1Health`

---

## Custom HTML Reference

**Allowed Tags:**
`div`, `span`, `p`, `br`, `hr`, `strong`, `b`, `em`, `i`, `u`, `s`, `mark`, `h1`-`h6`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `img`, `a`, `pre`, `code`, `blockquote`

**Allowed Attributes:**
- All: `class`, `id`, `style`, `title`
- Links: `href`, `target`, `rel`
- Images: `src`, `alt`, `width`, `height`

**Allowed CSS:**
`color`, `background-color`, `background`, `font-size`, `font-weight`, `font-style`, `font-family`, `text-align`, `text-decoration`, `padding`, `margin`, `border`, `border-radius`, `width`, `height`, `max-width`, `max-height`, `display`, `flex`, `flex-direction`, `justify-content`, `align-items`, `gap`, `opacity`

**Blocked:**
- Tags: `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`
- Attributes: `onclick`, `onload`, etc.
- URLs: `javascript:`, `vbscript:`

---

## Best Practices

1. **Always strip context** — Use Context Modifier to remove `[[BD:...:BD]]` tags
2. **Use unique IDs** — Prefix with script name: `myscript_hp`, `myscript_gold`
3. **Initialize state safely** — `state.x = state.x ?? defaultValue`
4. **Prefer `update` action** — For value changes, preserves existing config
5. **Keep widgets minimal** — Focus on essential game state

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Visible `[[BD:...]]` tags | Ensure BetterDungeon is enabled |
| AI repeats protocol tags | Add Context Modifier to strip tags |
| Widgets not appearing | Check browser console (F12) for errors |
| Widget not updating | Use `update` action, check widget ID matches |
| Custom HTML stripped | Check allowed tags/attributes above |

---

## Debugging

Console logs (F12) show widget activity:
```
[BetterScripts] Widget created: hp-bar
[BetterScripts] Widget updated: hp-bar
[BetterScripts] 🏓 PONG - Ping received
```

---

## JavaScript Events

Listen to widget lifecycle from browser console or other extensions:

```javascript
window.addEventListener('betterscripts:widget', (e) => {
  console.log(e.detail.action, e.detail.widgetId);  // 'created'/'updated'/'destroyed'
});

window.addEventListener('betterscripts:cleared', (e) => {
  console.log('Cleared', e.detail.count, 'widgets');
});

window.addEventListener('betterscripts:registered', (e) => {
  console.log('Script registered:', e.detail.scriptName);
});

window.addEventListener('betterscripts:pong', (e) => {
  console.log('Ping response:', e.detail.timestamp);
});

window.addEventListener('betterscripts:error', (e) => {
  console.error('Error:', e.detail.type, e.detail.errors);
});
```
