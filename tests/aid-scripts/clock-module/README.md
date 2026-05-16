# Frontier Clock Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Frontier Clock module
(`modules/clock/module.js`) over the live Frontier protocol from inside an
AI Dungeon scenario. Use this any time you change the Clock module, the
`ops-dispatcher`, the registry, the envelope helpers, or any other Frontier
plumbing — if the system is healthy this suite turns green; if it isn't, the
trace card pinpoints what broke.

## What it covers

The suite runs a fixed plan of requests, one per turn, in order:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `now-default` | `clock` | `now` | ok + ISO string, epoch, timezone |
| `now-with-tz` | `clock` | `now` | ok + timezone matches `America/New_York` |
| `tz-list` | `clock` | `tz` | ok + non-empty `timezones[]` including UTC |
| `format-default` | `clock` | `format` | ok + non-empty formatted string |
| `format-custom-pattern` | `clock` | `format` | ok + `YYYY-MM-DD HH:mm:ss` shaped output |
| `format-with-tz` | `clock` | `format` | ok + `HH:mm` shaped output for Europe/London |
| `err-bad-timezone` | `clock` | `now` | err `invalid_args` |
| `err-bad-format-tz` | `clock` | `format` | err `invalid_args` |
| `err-unknown-op` | `clock` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `now` | err `unknown_module` |

It also verifies:

- The `frontier:heartbeat` card exists and lists `clock` with all three ops.
- Pending → terminal response transitions on `frontier:in:clock`.
- Ack-driven cleanup of response cards after responses are seen.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Frontier** and enable Frontier and the **Clock**
   module.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take a few turns. Each generation advances one step.

## Reading results

Open the `frontier:test:clock` story card after a few turns to see:

- `phase` — current driver state (`queueing X`, `awaiting X`,
  `complete`, `complete-with-failures`).
- `counts` — pass/fail/pending tally.
- `results[label]` — per-step outcome with `pass`, `reason`, `status`,
  `error`, and preview data (ISO time, formatted string, timezone count).
- `events` — rolling log of queue/ack/completion events.
- `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.
Anything else points you at the failing step's `error.code` or `reason`.

## Reset

To re-run from scratch without editing anything, type any of these phrases
into your input on a turn:

- `clock test reset`
- `frontier clock reset`
- `[[clock-test:reset]]`

The suite clears `frontier:out`, wipes its in-state, and starts over on the
next turn.
