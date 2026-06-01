# Ultrascripts AI Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Ultrascripts AI module
(`modules/ai/module.js`) over the live Ultrascripts protocol from inside an
AI Dungeon scenario. Use this any time you change the AI module, the
`ops-dispatcher`, the registry, the envelope helpers, or any other Ultrascripts
plumbing — if the system is healthy this suite turns green; if it isn't, the
trace card pinpoints what broke.

## What it covers

The suite runs a fixed plan of requests, one per turn, in order:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `testConnection` | `ai` | `testConnection` | ok + safe key metadata |
| `models` | `ai` | `models` | ok + non-empty `models[]` |
| `chat-canonical` | `ai` | `chat` | ok + assistant text |
| `chat-via-alias` | `providerAI` | `chat` | ok (verifies alias routing and ignored legacy `model` arg) |
| `chat-json-object` | `ai` | `chat` | ok + JSON-shaped assistant text |
| `chat-json-schema` | `ai` | `chat` | ok + schema-shaped assistant text |
| `err-empty-messages` | `ai` | `chat` | err `invalid_args` |
| `err-oversized-content` | `ai` | `chat` | err `invalid_args` |
| `err-bad-temperature` | `ai` | `chat` | err `invalid_args` |
| `err-bad-response-format` | `ai` | `chat` | err `invalid_args` |
| `err-bad-provider` | `ai` | `testConnection` | err `invalid_args` |
| `err-unknown-op` | `ai` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `chat` | err `unknown_module` |

It also verifies:

- The `ultrascripts:heartbeat` card exists and lists `ai` with all three real ops.
- Pending → terminal response transitions on `ultrascripts:in:ai` and
  `ultrascripts:in:providerAI`.
- Ack-driven cleanup of response cards (the script removes its own ids from
  the response envelope after acking).

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Ultrascripts** and enable Ultrascripts and the **AI**
   module.
3. Open Ultrascripts → **AI** and save a default model.
4. To avoid OpenRouter requests entirely, set the default model to
   `betterdungeon/dummy:free`. Otherwise use a free default model unless you
   intentionally want the suite to spend paid quota; real OpenRouter models
   still require an API key.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take a few turns. Each generation advances one step.

## Reading results

Two surfaces are written to the adventure's story cards:

- `ultrascripts:out` — the script's request queue. Useful for confirming requests
  reach the dispatcher.
- `ultrascripts:test:ai` — the **trace card**. Open it after a few turns to see:
  - `phase` — current driver state (`queueing X`, `awaiting X`,
    `complete`, `complete-with-failures`).
  - `counts` — pass/fail/pending tally.
  - `results[label]` — per-step outcome with `pass`, `reason`, `status`,
    `error`, and the response card the result came from.
  - `events` — rolling log of queue/ack/completion events.
  - `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.
Anything else points you at the failing step's `error.code` or `reason`.

## Mid-test page reloads

Chat is declared `idempotent: 'unsafe'`, so if you reload AI Dungeon while a
chat request is still in flight the dispatcher correctly refuses to replay
it — the response comes back as `err` with `code: 'unsafe_replay_blocked'`.
This is the desired safety behavior; it prevents duplicate paid model calls.

The driver recognizes this code as a recoverable, environmental failure and
automatically re-queues the affected step under a fresh request id on the
next turn. The `replayResets` field in the trace tells you how many times
each step had to be re-queued. The retry count is capped at 2 per step so a
genuine bug producing this code repeatedly will surface as a real failure
instead of looping forever.

## Reset

To re-run from scratch without editing anything, type any of these phrases
into your input on a turn (the suite consumes them once and then ignores
duplicates):

- `ai test reset`
- `ultrascripts ai reset`
- `[[ai-test:reset]]`

The suite clears `ultrascripts:out`, wipes its in-state, and starts over on the
next turn.

## Manual missing-key check

The suite assumes a configured OpenRouter key. To verify the
`not_configured` error path, clear the key in BetterDungeon, take one turn,
and inspect the `testConnection` step in the trace — its `error.code`
should be `not_configured` instead of `ok`.
