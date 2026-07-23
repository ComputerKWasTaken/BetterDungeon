# Ultrascripts Widget Module — AI Dungeon Test Suite

Behavior-focused test scripts for the BetterDungeon Widget module. Each scenario loads a curated manifest designed to exercise specific widget types so you can verify rendering, interactivity, value transitions, and graceful error handling.

## What it is for

Use this suite when you change any of the following:

- `modules/widget/renderer.js` — widget factories or update methods
- `modules/widget/validators.js` — widget config validation rules
- `styles.css` — widget appearance, colors, or transitions
- Smooth value transitions or animation behavior
- New widget types or promoted concept widgets
- Custom widget HTML rendering and sanitization

## Scenarios

| Command | Widgets tested | What to verify |
| --- | --- | --- |
| `/widget display` | stat, bar, counter, progress, taggroup, divider, icon, badge, text | All display widgets render with correct values, colors, alignment. Bars and progress fills animate smoothly. |
| `/widget interactive` | radio, stepper, confirm, chipselect, button, toggle, select, slider, input, textarea | Each widget is interactive. Click them and check `ultrascripts:test:widget` → `interactions.recentEvents` for the emitted events. |
| `/widget containers` | accordion, tabs, dropdown, sortable | Containers expand/collapse, switch tabs, open menus, and reorder items. Events carry the correct selected IDs. |
| `/widget invalid` | valid stat/progress/badge plus intentionally broken configs | The module should skip duplicate IDs, malformed `items` / `options`, missing option values, oversized labels/HTML/options, and bad numeric fields with console warnings. `ok`, `ok2`, and the first `dup` should still render. |
| `/widget transitions` | stat, bar, counter, progress | Values change every turn. Watch numbers count up/down and bars/progress fills smoothly animate. |
| `/widget edge` | taggroup, stat, bar, divider, text, icon, counter | Edge cases: empty tag list, missing value, 0-width bar, over-max bar, negative bar, missing label, empty text, empty icon. |
| `/widget custom` | custom (HTML), divider | Exercises the custom widget renderer: tables, lists, code blocks, formatted text, blockquotes, links, images, and inline CSS layouts. Verify that HTML is sanitized and styled correctly. |
| `/widget panels` | panel, divider | Panel widgets with titles and item lists (label/value pairs with optional colors), plus a plain content panel. Verify layout and color styling. |

## Surfaces written

| Card | Direction | Purpose |
| --- | --- | --- |
| `ultrascripts:state:widget` | script &rarr; BD | Manifest + history values + `interactions.ackSeq`. Rebuilt every turn. |
| `ultrascripts:in:widget` | BD &rarr; script | Read-only. We poll widget interaction events and accumulate them in the trace. |
| `ultrascripts:test:widget` | script &rarr; you | Human-readable trace: current scenario, widget list with values, recent events, and command help. |

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon &rarr; **Ultrascripts** and enable Ultrascripts and the **Widget** module.
3. In AI Dungeon, edit a scenario and open the **Scripting** panel.
4. Paste the contents of `library.js` into the **Library** script.
5. Paste the contents of `input-modifier.js` into the **Input Modifier**.
6. Paste the contents of `output-modifier.js` into the **Output Modifier**.
7. Save and start (or resume) an adventure on that scenario.

> **Why both modifiers?** AI Dungeon's `onInput` hook only fires when the player **submits input**, so AI-only turns (continue, retry) wouldn't advance the suite. The input modifier consumes `/widget` commands; the output modifier ticks the suite once per generation so it progresses every turn regardless of who acted.

## Commands

Type these into normal player input. They are stripped from the text before it reaches the model.

> **Note:** If your entire input is a `/widget` command, the modifier substitutes a single `.` so the turn still advances.

| Command | Effect |
| --- | --- |
| `/widget display` | Load display widget scenario |
| `/widget interactive` | Load interactive widget scenario |
| `/widget containers` | Load container widget scenario |
| `/widget invalid` | Load broken configs (module should skip bad widgets) |
| `/widget transitions` | Load animated value-change scenario |
| `/widget edge` | Load edge-case scenario |
| `/widget custom` | Load custom HTML widget scenario |
| `/widget panels` | Load panel widget scenario |
| `/widget value <id> <val>` | Manually set a widget's value (e.g., `/widget value hp 100`) |
| `/widget next` | Advance transition scenario to the next phase manually |
| `/widget ack` | Force-ack all pending widget events |
| `/widget clear` | Unmount all widgets |
| `/widget reset` | Reset suite state |

### Value syntax

`val` is parsed intelligently:
- Integers become numbers (`/widget value gold 250`)
- `true` / `false` / `null` become JS booleans/null
- JSON arrays work (`/widget value party ["a","t"]`) — useful for chipselect
- Everything else is a string

## Reading the trace

Open the `ultrascripts:test:widget` story card after a few turns:

- **`phase`** — current scenario (`display`, `interactive`, `transitions`, etc.) or `idle`.
- **`scenario`** — same as phase.
- **`publishedEnvelope.values`** — the current widget values being sent to BD.
- **`widgets`** — list of every widget in the current manifest with its type and current value.
- **`interactions.recentEvents`** — last 6 widget events received from BD. Click an interactive widget, take a turn, and confirm its event appears here with the correct `widgetId`, `action`, and `value`.
- **`transitionPhase`** — only present for `transitions`; shows current phase index and total.
- **`events`** — rolling internal log.

## Verifying behavior

### Display widgets
```
/widget display
```
Check that:
- Stats show `87` (HP) and `23` (MP)
- XP bar is 60% filled, Shield bar is 12% with no text
- Gold counter shows `137` with a coin icon, Reputation shows `-3` in red
- Quest progress is `65%`, Loadout is `100%`
- Tags render with colors and icons
- Both dividers appear (plain line + labeled break)

### Interactive widgets
```
/widget interactive
```
Click each widget and verify events:
- **Button** → `action: "click"`, `value: "strike"`
- **Toggle** → `action: "toggle"`, value flips `true`/`false`
- **Select** → `action: "change"`, value is `"auto"` or `"manual"`
- **Slider** → `action: "change"`, value is a number
- **Radio** → `action: "change"`, value is `"aggro"` / `"def"` / `"sneak"`
- **Stepper** → `action: "change"`, value increments/decrements
- **Confirm** → first click arms (`action: none, UI changes`), second click → `action: "confirm"`, `value: true`
- **Chipselect** → `action: "change"`, value is an array of selected IDs

The suite applies stateful interactive event values back into `state.widgetTest.overrides`
before acking them. After the next turn, toggles, selects, sliders, inputs,
radio, stepper, chipselect, accordion, tabs, dropdown, and sortable should keep
the player's selected value instead of snapping back to the default.

### Invalid widget configs
```
/widget invalid
```
Check that:
- `ok`, `ok2`, and the first `dup` render normally.
- The second `dup` is skipped as a duplicate widget ID.
- `badmax`, `badtype`, `nostep`, `badselect`, `badradio`, `badpanel`, `badlist`, `biglabel`, `bightml`, `too-many-options`, `baddropdown`, and `badsortable` are skipped with warnings.
- The `ultrascripts:test:widget` trace includes `invalidExpectedSkip` so you can compare expected skips against what appears on screen.
- Valid siblings keep rendering even when invalid widgets are present.

### Value transitions
```
/widget transitions
```
Take several turns. Each turn advances through a preset sequence:
- HP: 87 &rarr; 64 &rarr; 42 &rarr; 12 &rarr; 0 &rarr; 100
- XP bar: 20 &rarr; 60 &rarr; 120 &rarr; 180 &rarr; 200 &rarr; 0
- Gold counter: 0 &rarr; 12 &rarr; 55 &rarr; 128 &rarr; 250 &rarr; 0
- Quest progress: 5% &rarr; 33% &rarr; 67% &rarr; 92% &rarr; 100% &rarr; 0%

Numbers should count smoothly. Bar and progress widths should animate with CSS transitions.

### Custom widgets
```
/widget custom
```
Check that:
- Tables render with headers, borders, and colored `<mark>` tags
- Blockquotes have the left accent border and italic text
- Inline code (`<code>`) and code blocks (`<pre><code>`) have dark backgrounds
- Ordered and unordered lists are indented and spaced correctly
- Data URI images render without external network requests
- CSS Grid layouts (e.g., the stat grid) align properly

> **Note on `<script>`:** Custom widgets intentionally do **not** execute inline scripts. AI Dungeon's CSP blocks `unsafe-inline`, and our sanitizer strips `<script>` tags and `on*` event handlers. Custom widgets are for **static HTML/CSS only**.

### Panel widgets
```
/widget panels
```
Check that:
- Panels render with titles and item lists aligned properly
- Item labels and values are spaced with `justify-content: space-between`
- Colored values use the correct CSS variables
- The plain content panel renders raw text without items or title

### Entrance & exit animations
All widgets animate when they appear or disappear:
- **Entrance**: fade in + slight translateY(8px → 0) + scale(0.97 → 1), 240ms ease-out
- **Exit**: fade out + translateY(0 → -6px) + scale(1 → 0.96), 180ms ease-in

Switch scenarios (e.g., `/widget display` → `/widget interactive`) to watch widgets exit and new ones enter. The animations should feel snappy, not sluggish.

### Manual override
```
/widget value hp 42
/widget value quest 80
```
Overrides persist until you switch scenarios or reset. Use this to test specific boundary conditions on demand.

## Mid-test reload safety

The suite's state envelope is rebuilt every turn from `state.widgetTest`, so a page reload simply re-publishes the same envelope on the next turn.

If `state.widgetTest` itself was wiped (for example by a script edit), type `/widget reset` to start over cleanly.
