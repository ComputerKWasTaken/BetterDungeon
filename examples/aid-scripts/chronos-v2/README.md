# Chronos V2

Chronos V2 is a Frontier showcase script for AI Dungeon: a complete time and
weather engine with an interactive Scripture dashboard, optional Clock sync,
and optional real weather.

It is designed to stay friendly. By default, Chronos is enabled, advances
story time by a small simulated amount each turn, keeps a six-phase day/night
cycle, tracks the Gregorian calendar with leap years, and runs a fast
season-aware weather simulation. Frontier modules add power when available,
but gameplay continues normally when they are missing.

## What It Demonstrates

- Multiple Scripture widgets in one script, including compact stats, badges,
  toggles, buttons, a select, and an input.
- Clock-backed initial time grounding and manual clock sync.
- Weather-backed real current-weather sync by manual place.
- Frontier request polling, acknowledgements, stale request cleanup, and
  graceful fallback to local simulation.

## Setup

1. Load BetterDungeon and open AI Dungeon.
2. Open BetterDungeon -> Frontier and enable Frontier.
3. Enable Scripture for widgets. Enable Clock and Weather for the full
   showcase.
4. Paste `library.js` into the scenario Library tab.
5. Paste `input.js`, `context.js`, and `output.js` into their matching tabs.
6. Start or resume the adventure.

Chronos V2 creates `Configure Chronos V2`, `Chronos V2 Commands`, and
`Chronos V2 Trace` story cards. It also writes Frontier protocol cards such as
`frontier:out`, `frontier:in:*`, and `frontier:state:scripture`.

## Dashboard

The widget dashboard favors a compact first glance: readable current time,
phase, and weather plus temperature. Common controls are available directly
from the dashboard:

- pause/resume automatic time
- toggle real elapsed time
- advance 15 minutes or 1 hour
- sleep until the configured wake hour
- sync available Clock and Weather data
- switch simulated/real weather
- enter a manual place

Real weather uses the manual place field. Leaving it blank keeps weather in
the fast simulated mode.

## Config Defaults

Chronos is enabled by default with these core settings:

```json
{
  "enabled": true,
  "minutesPerTurn": 2,
  "timeMode": "simulated",
  "useClockStart": true,
  "weatherMode": "simulated",
  "place": "",
  "temperatureUnit": "F",
  "showContext": true,
  "widgetHistoryLimit": 80
}
```

The widgets update this config for normal use, but advanced users can still
edit the card directly.

## Commands

Widgets are the preferred interface, but commands remain available:

- `:time`, `:date`, `:weather`, `:chronos`
- `:advance <N> <minutes|hours|days>`
- `:sleep`
- `:settime <HH:MM>`
- `:setdate <day> <month> <year>`
- `:pause`, `:resume`
- `:setweather <condition>`
- `:chronos help`, `:chronos reset`

## Stability Notes

Chronos keeps the last valid config if the config card JSON is malformed,
acknowledges processed Scripture widget events, prunes old request bookkeeping,
and lets simulated weather continue if real weather fails or times out.

The Context Modifier injects one compact line like:

```text
[Chronos V2: Current story date is Tuesday, June 2, 2026. Current story time is 7:15 AM (Morning). Season: Summer. Weather: Clear, 70 F (sim). Use these as the current scene environment unless the story says otherwise.]
```

That line gives the model enough situational grounding without turning the
context into a logbook.
