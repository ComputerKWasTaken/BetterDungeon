# BetterScripts Developer Guide

BetterScripts enables AI Dungeon scripts to communicate with the BetterDungeon extension, allowing you to create dynamic UI widgets that display game state, stats, and other information.

## Features

- **5 Widget Types:** Stat, Bar, Panel, Text, Custom
- **Real-time Updates:** Widgets update instantly with smooth transitions
- **Auto-creation:** Update commands auto-create widgets if they don't exist
- **Clean Integration:** Protocol messages are stripped before display
- **Adventure-scoped:** Widgets automatically clear when changing adventures
- **Secure Custom HTML:** Whitelist-based sanitization for custom widgets
- **Event System:** Listen to widget lifecycle events from JavaScript

---

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

// Helper: Update specific widget properties
function bdUpdateWidget(widgetId, config) {
  return bdMessage({
    type: 'widget',
    widgetId: widgetId,
    action: 'update',
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

// Helper: Clear all widgets at once
function bdClearAll() {
  return bdMessage({ type: 'clearAll' });
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

**Protocol Version:** `1.0` (optional `v` field for future compatibility)

## Widget Message
The primary message type for UI interaction.

```javascript
{
  "type": "widget",
  "v": "1.0",           // Optional: protocol version
  "widgetId": "unique-id",
  "action": "create",  // 'create', 'update', or 'destroy'
  "config": { ... }    // See Widget Types below
}
```

### Widget ID Rules
- Must be a non-empty string
- Only alphanumeric characters, underscores, and hyphens allowed
- Example valid IDs: `hp-bar`, `gold_stat`, `player1Health`

### Actions

| Action | Behavior |
|--------|----------|
| `create` | Creates widget or updates in place if same ID exists |
| `update` | Updates specific properties; auto-creates if missing |
| `destroy` | Removes the widget from display |

## Other Message Types

### Clear All Widgets
Efficiently removes all widgets with a single message.
```javascript
{ "type": "clearAll" }
```

### Ping
Test connectivity between script and extension.
```javascript
{ "type": "ping", "data": "optional-payload" }
```

### Register
Announce script presence (for debugging/logging).
```javascript
{
  "type": "register",
  "scriptId": "my-script",
  "scriptName": "My Script Name",
  "version": "1.0.0"
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
Progress bar for resources with visual depth and glow effect.
```javascript
{
  "type": "bar",
  "label": "HP",
  "value": 75,
  "max": 100,
  "color": "#ef4444",
  "showValue": true  // Optional, defaults to true
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
Custom HTML content with whitelist-based sanitization.
```javascript
{
  "type": "custom",
  "html": "<div class='my-widget'><strong>HP:</strong> <span style='color: #22c55e'>100</span></div>",
  "style": { "padding": "8px", "backgroundColor": "#1a1a2e" }
}
```

**Allowed HTML Tags:**
`div`, `span`, `p`, `br`, `hr`, `strong`, `b`, `em`, `i`, `u`, `s`, `mark`, `h1`-`h6`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `img`, `a`, `pre`, `code`, `blockquote`

**Allowed Attributes:**
- Global: `class`, `id`, `style`, `title`
- Links (`a`): `href`, `target`, `rel`
- Images (`img`): `src`, `alt`, `width`, `height`

**Allowed CSS Properties:**
`color`, `background-color`, `background`, `font-size`, `font-weight`, `font-style`, `font-family`, `text-align`, `text-decoration`, `text-transform`, `padding`, `margin`, `border`, `border-radius`, `width`, `height`, `max-width`, `max-height`, `min-width`, `min-height`, `display`, `flex`, `flex-direction`, `justify-content`, `align-items`, `gap`, `opacity`, `visibility`, `overflow`, `position`, `top`, `right`, `bottom`, `left`, `z-index`

**Security Notes:**
- `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>` tags are removed
- Event handlers (`onclick`, `onload`, etc.) are stripped
- `javascript:` and `vbscript:` URLs are blocked
- Links with `target` automatically get `rel="noopener noreferrer"`

---

# Updatable Properties

When using the `update` action, you can modify these properties per widget type:

| Widget | Updatable Properties |
|--------|----------------------|
| **stat** | `label`, `value`, `color` |
| **bar** | `label`, `value`, `max`, `color` |
| **text** | `text`, `style` |
| **panel** | `title`, `items` |
| **custom** | `html`, `style` |

---

# Best Practices

1. **Context Stripping is Mandatory:** Always use a Context Modifier to strip `[[BD:...:BD]]` tags. If you don't, the AI will start hallucinating protocol messages.
2. **Unique IDs:** Prefix your widget IDs (e.g., `rpg_hp`, `inv_gold`) to avoid conflicts with other scripts. IDs must be alphanumeric with underscores/hyphens only.
3. **State Safety:** Always use `state.obj = state.obj ?? {}` to initialize persistent data.
4. **No Async:** AI Dungeon scripts do not support `async/await` or `Promises`.
5. **Use `update` for Changes:** Prefer the `update` action for value changes—it preserves existing config and enables smooth transitions.
6. **Keep Widgets Minimal:** Don't overwhelm the UI; focus on essential game state.
7. **Message Size Limit:** Protocol messages are limited to 16KB. Keep your HTML content concise.

---

# Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| Visible `[[BD:...]]` tags | Extension not running or DOM area not monitored | Ensure BetterDungeon is enabled |
| AI types protocol tags | Context Modifier missing or broken | Verify Context Modifier strips tags |
| Widgets not appearing | Invalid config or JS error | Check browser console (F12) for `[BetterScripts]` warnings |
| Widgets not updating | Same message sent too fast | Updates within 500ms are deduplicated |
| Old widgets persist | Adventure change not detected | Widgets auto-clear on adventure change |
| Invalid widget ID | ID contains special characters | Use only alphanumeric, underscore, hyphen |
| Custom HTML not rendering | Tags/attributes stripped | Check allowed tags and attributes list above |

---

# Debugging

Enable debug logging in the extension by setting `debug = true` in `better_scripts_feature.js`. This logs all message processing to the browser console.

```
[BetterScripts] Processing message: widget
[BetterScripts] Widget created: my-stat
[BetterScripts] Widget updated: my-stat
```

Warnings and errors are always logged (even without debug mode):
```
[BetterScripts] Invalid widget config for "my-widget": Widget config missing required "type" field
[BetterScripts] Message exceeds size limit (20000 > 16384), skipping
```

---

# JavaScript Events

BetterScripts emits custom events you can listen to from browser console or other extensions:

```javascript
// Widget lifecycle events
window.addEventListener('betterscripts:widget', (e) => {
  console.log(e.detail.action);   // 'created', 'updated', or 'destroyed'
  console.log(e.detail.widgetId); // Widget ID
  console.log(e.detail.config);   // Widget config (not present for 'destroyed')
});

// Script registration events
window.addEventListener('betterscripts:registered', (e) => {
  console.log(e.detail.scriptId);
  console.log(e.detail.scriptName);
});

// Error events (for debugging)
window.addEventListener('betterscripts:error', (e) => {
  console.log(e.detail.type);    // 'validation_error' or 'processing_error'
  console.log(e.detail.errors);  // Array of error messages
});

// Ping/pong for connectivity testing
window.addEventListener('betterscripts:pong', (e) => {
  console.log(e.detail.timestamp);
});

// Clear all widgets event
window.addEventListener('betterscripts:cleared', (e) => {
  console.log('Widgets cleared:', e.detail.count);
});
```
