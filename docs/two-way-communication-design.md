# BetterScripts Two-Way Communication — Design Specification

## Overview

Adds an opt-in **Tier 2 "Interactive"** layer on top of the existing one-way widget system (Tier 1).
Scripts that register with the `interactive` capability unlock widgets that accept user actions.
Actions are queued and flushed to the script via input injection on the user's next turn submission.

---

## Architecture Summary

```
TIER 1 (existing — unchanged):
  Script → [[BD:{...}:BD]] → DOM → MutationObserver → Extension renders widget

TIER 2 (new — opt-in):
  User clicks widget action
    → Optimistic UI update
    → Event pushed to outbound queue
  User submits turn
    → Extension appends [[DB:{events}:DB]] to input text
    → Queue flushed
  Script's onInput hook
    → Parses [[DB:...:DB]], processes events
    → Strips protocol from modifiedInput
    → Updates state, emits [[BD:...:BD]] confirmations on next output
```

---

## 1. Protocol Specification

### 1.1 Reverse Protocol Format (Extension → Script)

```
[[DB:{"v":"1.0","events":[...]}:DB]]
```

- **Delimiters**: `[[DB:` ... `:DB]]` (mirrors `[[BD:` ... `:BD]]`)
- **Always batched**: Events are always sent as an array, even if just one
- **Appended to input**: Protocol text is appended AFTER the user's actual input text
- **Max size**: 8KB (smaller than inbound 16KB — input fields are more constrained)

### 1.2 Event Object Structure

```json
{
  "id": "evt_1707782400000_abc",
  "scriptId": "rpg-system",
  "widgetId": "player-hp",
  "actionId": "heal",
  "data": {},
  "ts": 1707782400000
}
```

| Field      | Type   | Required | Description                                    |
|------------|--------|----------|------------------------------------------------|
| `id`       | string | yes      | Unique event ID (for dedup/ack by script)      |
| `scriptId` | string | yes      | Target script that owns this widget            |
| `widgetId` | string | yes      | Widget that was interacted with                |
| `actionId` | string | yes      | Which action on the widget was triggered       |
| `data`     | object | no       | Action-specific payload (toggle state, etc.)   |
| `ts`       | number | yes      | Timestamp when user performed the action       |

### 1.3 Full Batch Example

User input: "I look around the room"
After injection: "I look around the room[[DB:{"v":"1.0","events":[{"id":"evt_1707782400000_a1b","scriptId":"rpg-system","widgetId":"player-hp","actionId":"heal","data":{},"ts":1707782400000}]}:DB]]"

---

## 2. Interactive Widget Actions

### 2.1 Action Types

Scripts define actions on widgets via the `actions` array in the widget config.

| Action Type  | Description                          | User Interaction       | Data Sent            |
|--------------|--------------------------------------|------------------------|----------------------|
| `button`     | Simple clickable button              | Click                  | `{}`                 |
| `toggle`     | Boolean on/off switch                | Click                  | `{ value: bool }`    |
| `select`     | Choose from options                  | Click option           | `{ value: string }`  |
| `increment`  | +1 on a numeric value                | Click + button         | `{ delta: +1 }`      |
| `decrement`  | -1 on a numeric value                | Click - button         | `{ delta: -1 }`      |

### 2.2 Action Definition in Widget Config

```json
{
  "type": "widget",
  "widgetId": "player-hp",
  "action": "create",
  "config": {
    "type": "counter",
    "icon": "❤️",
    "value": 85,
    "max": 100,
    "interactive": true,
    "actions": [
      {
        "id": "heal",
        "type": "button",
        "label": "+10",
        "icon": "💊",
        "position": "right",
        "optimistic": { "field": "value", "delta": 10, "clampMax": "max" }
      },
      {
        "id": "damage",
        "type": "button",
        "label": "-5",
        "icon": "🗡️",
        "position": "right",
        "optimistic": { "field": "value", "delta": -5, "clampMin": 0 }
      }
    ]
  }
}
```

### 2.3 Action Config Fields

| Field        | Type   | Required | Description                                         |
|--------------|--------|----------|-----------------------------------------------------|
| `id`         | string | yes      | Unique action ID within the widget                  |
| `type`       | string | yes      | One of: button, toggle, select, increment, decrement|
| `label`      | string | no       | Button text / toggle label                          |
| `icon`       | string | no       | Emoji or symbol for the action button               |
| `position`   | string | no       | Where to render: "left", "right", "below"           |
| `options`    | array  | select   | Array of { value, label } for select type           |
| `optimistic` | object | no       | How to update widget state optimistically           |
| `confirm`    | string | no       | Optional confirmation prompt text                   |
| `cooldown`   | number | no       | Milliseconds before action can be triggered again   |
| `disabled`   | bool   | no       | Whether action is currently disabled                |

### 2.4 Optimistic Update Definitions

The `optimistic` object tells the extension how to temporarily update the widget
before the script confirms on the next turn.

```json
// Add delta to a field, clamp to max
{ "field": "value", "delta": 10, "clampMax": "max", "clampMin": 0 }

// Set a field to a specific value
{ "field": "value", "set": 100 }

// Toggle a boolean
{ "field": "active", "toggle": true }

// No optimistic update (wait for script)
// Simply omit the "optimistic" field
```

If `optimistic` is omitted, the widget shows a "pending" state with no value change,
and waits for the script to provide the real update.

---

## 3. State Management

### 3.1 Widget State Layers

Each interactive widget tracks three state layers:

```
confirmedState  — Last state confirmed by the script (source of truth)
pendingActions  — Array of unconfirmed optimistic updates
displayState    — What the user sees (confirmed + all pending optimistics applied)
```

### 3.2 State Flow

```
1. Script creates widget → confirmedState = config, pendingActions = [], displayState = config
2. User clicks action   → pendingActions.push(optimistic), displayState recalculated
3. User clicks another  → pendingActions.push(optimistic), displayState recalculated
4. User submits turn    → Events flushed via [[DB:...:DB]]
5. Script responds       → confirmedState = new config, pendingActions = [], displayState = new config
```

### 3.3 Confirmation & Rollback

When the script sends a widget update after events were flushed:
- The new state from the script **always wins** (script is source of truth)
- `pendingActions` is cleared
- `displayState` snaps to the new `confirmedState`
- If the confirmed state differs from what optimistic predicted, a brief 
  visual "correction" is shown (subtle flash/transition)

### 3.4 When Does Pending State Clear?

Pending state clears when ANY of these happen:
- Script sends a widget update for that widget (confirmation/correction)
- Script sends a `clearAll` message
- Adventure changes (URL navigation)
- Extension is destroyed/disabled

Pending state does NOT clear on:
- Turn submission alone (events are sent, but pending holds until script responds)

---

## 4. Outbound Event Queue

### 4.1 Queue Properties

```js
this.outboundQueue = [];           // Pending events
this.maxQueueSize = 50;            // Hard cap — oldest events dropped
this.queuedForScripts = new Set(); // Which scriptIds have pending events
```

### 4.2 Queue Operations

- **push(event)** — Add event, enforce max size (drop oldest if full)
- **flush()** — Serialize all events, clear queue, return protocol string
- **clear()** — Discard all events (adventure change, etc.)
- **hasEvents()** — Quick check if queue is non-empty

### 4.3 Event ID Generation

```js
generateEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}
```

---

## 5. Input Injection Mechanism

### 5.1 When To Inject

Input injection is ONLY active when:
- At least one script is registered with `interactive` capability
- The outbound queue has events

### 5.2 How To Inject (based on existing patterns in try_feature.js / command_feature.js)

Two interception points (both using capture phase):

**A. Enter key submission:**
```
document.addEventListener('keydown', handler, true)  // capture phase
→ Check: e.key === 'Enter' && !e.shiftKey
→ Check: e.target === textarea (#game-text-input)
→ Append [[DB:...:DB]] to textarea.value
→ Dispatch new Event('input', { bubbles: true })
→ Let event propagate (don't preventDefault — we want the submit to happen)
```

**B. Submit button click:**
```
document.addEventListener('click', handler, true)  // capture phase
→ Check: e.target.closest('[aria-label="Submit action"]')
→ Append [[DB:...:DB]] to textarea.value
→ Dispatch new Event('input', { bubbles: true })
→ Let event propagate
```

### 5.3 Important: Non-Destructive Append

Unlike Try/Command features which REPLACE the input text, we APPEND to it.
The user's original text is preserved. The protocol block is tacked on at the end.

```
BEFORE: "I search the chest"
AFTER:  "I search the chest[[DB:{"v":"1.0","events":[...]}:DB]]"
```

### 5.4 Empty Input Handling

If the queue has events but the user submits with an empty input:
- We do NOT inject on empty submits
- Events remain queued for the next non-empty submission
- Rationale: Empty submits in AI Dungeon trigger "continue" behavior, 
  which may not invoke script hooks reliably

### 5.5 Coexistence with Try/Command Features

Try and Command features also intercept input submission. Order of operations:
1. Try/Command modifies the input text (their handlers fire first in capture phase)
2. BetterScripts appends [[DB:...:DB]] AFTER their modifications
3. Result: formatted text + protocol suffix

This means BetterScripts input handler should be registered AFTER Try/Command,
or should read the textarea value at append-time (after other handlers ran).
Using a slight setTimeout(0) or registering last ensures correct ordering.

---

## 6. Registration & Capability System

### 6.1 Extended Register Message

```json
{
  "type": "register",
  "scriptId": "rpg-system",
  "scriptName": "RPG System",
  "version": "2.0",
  "v": "1.0",
  "capabilities": ["interactive"]
}
```

### 6.2 Capability Flags

| Capability    | Effect                                                   |
|---------------|----------------------------------------------------------|
| (none)        | Tier 1: Display-only widgets, no actions, no injection   |
| `interactive` | Tier 2: Widget actions enabled, queue + injection active |

### 6.3 Extension Behavior Based on Capabilities

```
if (script.capabilities.includes('interactive')) {
  → Enable action rendering on that script's widgets
  → Activate input interception (if not already active)
  → Track scriptId in queuedForScripts
} else {
  → Render widgets as display-only (existing behavior)
  → Ignore any "actions" in widget configs
}
```

---

## 7. Interactive Widget Rendering

### 7.1 Action Buttons

Actions are rendered as small buttons/controls within or adjacent to the widget.

For a counter widget with increment/decrement:
```
┌──────────────────────────┐
│ ❤️  85/100   [+] [-]     │
└──────────────────────────┘
```

For a stat widget with a button action:
```
┌──────────────────────────┐
│ Gold: 500    [Shop 🛒]   │
└──────────────────────────┘
```

### 7.2 CSS Classes for Interactive States

```css
.bd-widget-interactive       — Widget has actions (shows subtle affordance)
.bd-widget-action            — An action button element
.bd-widget-action:hover      — Hover state
.bd-widget-action:active     — Click state
.bd-widget-action--disabled  — Greyed out, not clickable
.bd-widget-action--cooldown  — In cooldown period after click
.bd-widget--pending          — Widget has unconfirmed optimistic state
.bd-widget--corrected        — Brief flash when script corrects optimistic prediction
```

### 7.3 Pending State Visual

When a widget has pending actions:
- Subtle pulsing border or glow (indicates "waiting for confirmation")
- Action button that was clicked shows a small spinner or checkmark
- After script confirms, the indicator fades away

---

## 8. Edge Cases & Safety

### 8.1 Queue Overflow
- Hard cap at 50 events
- If exceeded, oldest events are dropped with a warning

### 8.2 Adventure Change
- Queue is cleared
- All pending states are cleared
- Interactive scripts are unregistered (they re-register on new adventure)

### 8.3 Script Not Responding
- Pending state stays indefinitely until cleared
- No timeout on pending state (script might take multiple turns)
- User can continue clicking actions (they stack in the queue)

### 8.4 Multiple Interactive Scripts
- Events are tagged with `scriptId` — each script only receives its own events
- Queue contains mixed events, all flushed together
- Each script parses and filters by its own `scriptId`

### 8.5 Rapid Clicking
- Cooldown on actions prevents spam (configurable per-action)
- Default cooldown: 200ms if not specified

### 8.6 Input Size Limits
- If appending the protocol would exceed reasonable input length, 
  truncate the oldest events from the batch
- Log a warning

### 8.7 Security
- Action data is validated (no arbitrary code execution)
- Event payloads are sanitized before injection
- Protocol text is limited to MAX size

---

## 9. Script-Side Implementation Guide (for documentation)

### 9.1 Minimal Script-Side Code

```javascript
// In the AI Dungeon script's onInput hook:
const onInput = (text) => {
  // Check for BetterDungeon reverse protocol
  const dbMatch = text.match(/\[\[DB:([\s\S]*?):DB\]\]/);
  
  if (dbMatch) {
    try {
      const payload = JSON.parse(dbMatch[1]);
      const events = payload.events || [];
      
      // Process events
      for (const event of events) {
        if (event.scriptId !== 'my-script-id') continue;
        
        switch (event.actionId) {
          case 'heal':
            state.hp = Math.min(state.hp + 10, state.maxHp);
            break;
          case 'use-potion':
            if (state.potions > 0) {
              state.potions--;
              state.hp = Math.min(state.hp + 50, state.maxHp);
            }
            break;
        }
      }
      
      // Strip protocol from input (so AI doesn't see it)
      state.modifiedInput = text.replace(/\[\[DB:[\s\S]*?:DB\]\]/, '');
    } catch (e) {
      // Parse error — ignore
      state.modifiedInput = text.replace(/\[\[DB:[\s\S]*?:DB\]\]/, '');
    }
  }
};
```

### 9.2 Emitting Confirmation

```javascript
// In onOutput hook, emit updated widget state:
const onOutput = (text) => {
  const widgetUpdate = JSON.stringify({
    type: 'widget',
    widgetId: 'player-hp',
    action: 'update',
    v: '1.0',
    config: {
      value: state.hp,
      max: state.maxHp
    }
  });
  
  return text + `[[BD:${widgetUpdate}:BD]]`;
};
```

---

## 10. Implementation Order

### Phase 1: Foundation
1. Add `interactive` capability detection to `handleRegister()`
2. Add outbound event queue class/methods
3. Add event ID generation

### Phase 2: Widget Actions
4. Extend widget config parsing to recognize `actions` array
5. Render action buttons on interactive widgets
6. Wire click handlers to queue events + apply optimistic updates

### Phase 3: Input Injection
7. Implement input interception (Enter key + submit button)
8. Implement queue flush → protocol string serialization
9. Implement append-to-textarea logic
10. Handle coexistence with Try/Command features

### Phase 4: State Management
11. Implement confirmed/pending/display state layers
12. Implement confirmation handling (script update clears pending)
13. Implement correction visual (when script disagrees with optimistic)

### Phase 5: Polish
14. CSS for interactive widget states, pending indicators, corrections
15. Edge case handling (overflow, adventure change, empty input, etc.)
16. Documentation in BetterScriptsGuide.vue

---

## 11. Files To Modify

| File | Changes |
|------|---------|
| `features/better_scripts_feature.js` | Core: queue, injection, state management, action rendering |
| `styles/better_scripts.css` | Interactive widget styles, pending/correction states |
| `BetterScriptsGuide.vue` | Documentation for Tier 2 interactive system |

All changes are contained within the existing BetterScripts feature — no new files needed
for the extension side. The feature class grows, but stays self-contained.
