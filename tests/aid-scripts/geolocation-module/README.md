# Frontier Geolocation Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Frontier Geolocation
module (`modules/geolocation/module.js`) over the live Frontier protocol from
inside an AI Dungeon scenario.

## What it covers

The suite runs a fixed plan of requests, one per turn, in order:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `permission` | `geolocation` | `permission` | ok + state is granted/denied/prompt/unavailable |
| `getCurrent` | `geolocation` | `getCurrent` | ok (position) or err (permission denied / unavailable) |
| `getCurrent-high-accuracy` | `geolocation` | `getCurrent` | ok (position) or err (known error code) |
| `err-unknown-op` | `geolocation` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `permission` | err `unknown_module` |

### Permission-dependent steps

The `getCurrent` and `getCurrent-high-accuracy` steps use an `ok-or-err`
expectation. If the browser has granted location access, the suite validates
the position shape (latitude, longitude, accuracy, timestamp). If permission
is denied or the API is unavailable, the suite validates that the error code
is one of the known geolocation error codes. Either way, the step passes as
long as the response shape is correct.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Frontier** and enable Frontier and the
   **Geolocation** module.
3. Optionally grant location permission to AI Dungeon in your browser to
   exercise the full position path.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take a few turns. Each generation advances one step.

## Reading results

Open the `frontier:test:geolocation` story card after a few turns to see:

- `phase` — current driver state.
- `counts` — pass/fail/pending tally.
- `results[label]` — per-step outcome with `pass`, `reason`, `status`,
  `error`, and preview data (permission state, lat/lon, accuracy).
- `events` — rolling log of queue/ack/completion events.
- `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.

## Reset

To re-run from scratch without editing anything, type any of these phrases:

- `geo test reset`
- `frontier geo reset`
- `[[geo-test:reset]]`
