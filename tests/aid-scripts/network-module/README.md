# Frontier Network Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Frontier Network module
(`modules/network/module.js`) over the live Frontier protocol from inside an
AI Dungeon scenario. Use this any time you change the Network module or any
Frontier plumbing.

## What it covers

The suite runs a fixed plan of requests, one per turn, in order:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `status` | `network` | `status` | ok + online boolean, quality classification, timestamp |
| `status-online-check` | `network` | `status` | ok + `online: true` (must be true in AID) |
| `status-connection-detail` | `network` | `status` | ok + connection object present |
| `err-unknown-op` | `network` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `status` | err `unknown_module` |

It also verifies:

- The `frontier:heartbeat` card exists and lists `network` with `status`.
- Pending → terminal response transitions on `frontier:in:network`.
- Ack-driven cleanup of response cards after responses are seen.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Frontier** and enable Frontier and the **Network**
   module.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take a few turns. Each generation advances one step.

## Reading results

Open the `frontier:test:network` story card after a few turns to see:

- `phase` — current driver state.
- `counts` — pass/fail/pending tally.
- `results[label]` — per-step outcome with `pass`, `reason`, `status`,
  `error`, and preview data (online, quality, effectiveType).
- `events` — rolling log of queue/ack/completion events.
- `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.

## Reset

To re-run from scratch without editing anything, type any of these phrases:

- `network test reset`
- `frontier network reset`
- `[[network-test:reset]]`
