# Frontier Weather Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Frontier Weather module
(`modules/weather/module.js`) over the live Frontier protocol from inside an
AI Dungeon scenario. Use this any time you change the Weather module or any
Frontier plumbing.

## What it covers

The suite runs a fixed plan of requests, one per turn, in order:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `current-coords` | `weather` | `current` | ok + temperature, units, location for NYC coords |
| `current-place` | `weather` | `current` | ok + temperature, location name for "London" |
| `current-units-imperial` | `weather` | `current` | ok + temperature in fahrenheit for Paris coords |
| `forecast-coords` | `weather` | `forecast` | ok + days array with temperatureMax, date for Tokyo coords |
| `forecast-place` | `weather` | `forecast` | ok + days array, location name for "Tokyo" |
| `forecast-imperial` | `weather` | `forecast` | ok + days array with fahrenheit units for NYC coords |
| `err-no-location` | `weather` | `current` | err `invalid_args` (no lat/lon or place) |
| `err-bad-place` | `weather` | `current` | err with valid error code (unresolvable place name) |
| `err-forecast-no-location` | `weather` | `forecast` | err `invalid_args` (no lat/lon or place) |
| `err-unknown-op` | `weather` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `current` | err `unknown_module` |

It also verifies:

- The `frontier:heartbeat` card exists and lists `weather` with `current`
  and `forecast` ops.
- Pending → terminal response transitions on `frontier:in:weather`.
- Ack-driven cleanup of response cards after responses are seen.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Frontier** and enable Frontier and the **Weather**
   module.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take several turns. Each generation advances one step.

## Reading results

Open the `frontier:test:weather` story card after several turns to see:

- `phase` — current driver state.
- `counts` — pass/fail/pending tally.
- `results[label]` — per-step outcome with `pass`, `reason`, `status`,
  `error`, and preview data (temperature, location name, days count, units).
- `events` — rolling log of queue/ack/completion events.
- `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.

> **Note:** Weather API steps depend on network access. If your network is
> slow or Open-Meteo is rate-limiting, some steps may time out. Reset and
> retry in that case.

## Reset

To re-run from scratch without editing anything, type any of these phrases:

- `weather test reset`
- `frontier weather reset`
- `[[weather-test:reset]]`
