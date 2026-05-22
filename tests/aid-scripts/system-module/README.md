# Ultrascripts System Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Ultrascripts System module
(`modules/system/module.js`) over the live Ultrascripts protocol from inside an
AI Dungeon scenario. Use this any time you change the System module or any
Ultrascripts plumbing — if the system is healthy this suite turns green; if it
isn't, the trace card pinpoints what broke.

## What it covers

The suite runs a fixed plan of requests, one per turn, in order:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `info` | `system` | `info` | ok + deviceClass, platform, browser, locale, screen, hardware, preferences |
| `info-platform-detail` | `system` | `info` | ok + valid platform family and mobile boolean |
| `info-browser-detail` | `system` | `info` | ok + valid browser name and userAgentData support flag |
| `info-screen-detail` | `system` | `info` | ok + screen width/height are numbers or null |
| `power` | `system` | `power` | ok + supported boolean, state if battery available |
| `err-unknown-op` | `system` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `info` | err `unknown_module` |

It also verifies:

- The `ultrascripts:heartbeat` card exists and lists `system` with both `info`
  and `power` ops.
- Pending → terminal response transitions on `ultrascripts:in:system`.
- Ack-driven cleanup of response cards after responses are seen.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Ultrascripts** and enable Ultrascripts and the **System**
   module.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take a few turns. Each generation advances one step.

## Reading results

Open the `ultrascripts:test:system` story card after a few turns to see:

- `phase` — current driver state.
- `counts` — pass/fail/pending tally.
- `results[label]` — per-step outcome with `pass`, `reason`, `status`,
  `error`, and preview data (deviceClass, platformFamily, browserName, etc.).
- `events` — rolling log of queue/ack/completion events.
- `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.

## Reset

To re-run from scratch without editing anything, type any of these phrases:

- `system test reset`
- `ultrascripts system reset`
- `[[system-test:reset]]`
