# Ultrascripts AI Module - AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Ultrascripts AI module
(`modules/ai/module.js`) over the live Ultrascripts protocol from inside an
AI Dungeon scenario. Use this any time you change the AI module, the
`ops-dispatcher`, the registry, the envelope helpers, or native Story Card
generation plumbing.

## What It Covers

The suite runs a fixed plan of requests, one per turn, in order:

`ai.query` is single-flight by design, so the suite advances only one native
generation request at a time.

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `status` | `ai` | `status` | ok + native backend readiness |
| `query-plain` | `ai` | `query` | ok + non-empty generated text |
| `query-xml` | `ai` | `query` | ok + prompt-requested XML validated by the script |
| `err-empty-prompt` | `ai` | `query` | err `invalid_args` |
| `err-oversized-prompt` | `ai` | `query` | err `invalid_args` |
| `err-bad-temperature` | `ai` | `query` | err `invalid_args` |
| `err-unknown-op` | `ai` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `query` | err `unknown_module` |

It also verifies:

- The `ultrascripts:heartbeat` card exists and lists `ai.query` and
  `ai.status`.
- Pending -> terminal response transitions on `ultrascripts:in:ai`.
- Ack-driven cleanup of response cards.
- Unsafe replay handling for in-flight native generation.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon -> **Ultrascripts** and enable Ultrascripts and the
   **AI** module.
3. Open or resume an adventure, then take one normal turn so BetterDungeon can
   hydrate AI Dungeon GraphQL credentials and Story Cards.

No external API key or external setup is required. The backend is AI Dungeon's
native Story Card generator.

## Install In A Scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start or resume an adventure on that scenario.
5. Take a few turns. Each generation advances one step.

## Reading Results

Two surfaces are written to the adventure's story cards:

- `ultrascripts:out` - the script's request queue. Useful for confirming
  requests reach the dispatcher.
- `ultrascripts:test:ai` - the trace card. Open it after a few turns to see:
  - `phase` - current driver state (`queueing X`, `awaiting X`, `complete`,
    `complete-with-failures`).
  - `counts` - pass/fail/pending tally.
  - `results[label]` - per-step outcome with `pass`, `reason`, `status`,
    `error`, and the response card the result came from.
  - `events` - rolling log of queue/ack/completion events.
  - `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.
Anything else points you at the failing step's `error.code` or `reason`.

## Manual Shell Card Checks

After one or more successful query steps, inspect the adventure's Story Cards:

- Exactly one reserved shell card named `ultrascripts:ai:query` should exist.
- Its type should be `Ultrascripts`.
- Its triggers should be empty.
- Its entry should be blank after query completion.
- Its notes should contain BetterDungeon JSON metadata.

## Mid-Test Page Reloads

`query` is declared `idempotent: 'unsafe'`, so if you reload AI Dungeon while a
native generation request is still in flight the dispatcher refuses to replay
it. The response comes back as `err` with `code: 'unsafe_replay_blocked'`.
This is the desired safety behavior; it prevents duplicate native generation.

The driver recognizes this code as a recoverable environmental failure and
automatically re-queues the affected query step under a fresh request id on the
next turn. The `replayResets` field in the trace tells you how many times each
step had to be re-queued. The retry count is capped at 2 per step so a genuine
bug producing this code repeatedly surfaces as a real failure.

## Reset

To re-run from scratch without editing anything, type any of these phrases into
your input on a turn. The suite consumes them once and then ignores duplicates:

- `ai test reset`
- `ultrascripts ai reset`
- `[[ai-test:reset]]`

The suite clears `ultrascripts:out`, wipes its in-state, and starts over on the
next turn.
