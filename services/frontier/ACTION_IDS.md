# ACTION_IDS — Phase 0 empirical findings

This file records the ground-truth observations about AI Dungeon's action system that inform the Frontier transport layer. It is the source of truth for test harness assumptions and for regression triage if AID ever changes behavior.

Source: Phase 0 instrumentation via `Project Management/frontier/action-hunter.user.js` (server-side WS hunter) and a minimal Output Modifier probe (script-side). Captured April 2026 against `play.aidungeon.com`.

## TL;DR

- Action ids on the wire are **stable, monotonic, numeric strings, never reused**. See [Action lifecycle](#action-lifecycle).
- The script environment does **not** expose action ids at all. `history[i]` has `{ text, type, rawText }` only. See [Script-side observations](#script-side-observations).
- Soft deletion via `undoneAt` covers undo / restore / delete / rewind. See [Mutation semantics](#mutation-semantics).
- Retry is **Behavior A**: new action at `tail+1` with `retriedActionId` pointing to the original. See [Retry](#retry).
- Frontier keys per-turn state by **live count** (`actions.filter(!undoneAt).length`), which both sides compute independently. See [Live-count convention](#live-count-convention).

## Observation channels

All three travel on a single GraphQL-over-WebSocket connection to `wss://api.aidungeon.com/graphql`. Payload shape under `msg.payload.data.<name>`.

| Name | Cadence | Shape highlights |
|------|---------|------------------|
| `adventureStoryCardsUpdate` | Every turn, unconditional | `{ storyCards: Card[] }`. Full list every time; BD diffs. |
| `contextUpdate` | Every turn at prompt-build time | `{ actionId, key, ... }`. Tail id + correlation UUID. |
| `actionUpdates` | Every action mutation | `{ type, key, retriedActionId, actions: Action[] }`. Full recent `actions` window with every field. |

`actionUpdates.type` values observed: `create`, `update`.

`contextUpdate` and `actionUpdates` share a `key` UUID when both fire for the same turn.

## Action lifecycle

- **ID format:** decimal-integer strings (`"0"`, `"1"`, `"2"`, …).
- **Monotonic +1.** Each new action's id is prev + 1. No gaps during a single session; no reuse after gaps appear via undo.
- **Two ids per user-driven turn.** Story / Do / Say / Take-a-turn creates `n=2` in one `actionUpdates CREATE` frame (user input, then AI response). Continue creates `n=1` (AI response only). Retry creates `n=1` (the replacement) but the frame carries `n=2` because the original is included with its freshly-set `undoneAt`.
- **Never reused.** Rewind marked ids 2–6 as undone; subsequent submit got ids 7 and 8.
- **Persists across reload.** IDs live in the server-side adventure record.
- **Scoped per adventure.** Two different adventures each start at `"0"`.

## Mutation semantics

All mutations preserve `id`. The visible change on `actionUpdates type=update` is always one of: `text`, `undoneAt`, or (on retry) the appearance of a new action alongside an updated one.

| User action | `contextUpdate` | `actionUpdates` | `SendEvent` |
|---|:---:|:---|:---|
| Story / Do / Say submit | yes (tail +1) | `type=create`, n=2 | `submit_button_pressed`, `action_roundtrip_completed` |
| Continue | yes (tail +1) | `type=create`, n=1 | `continue_button_pressed`, `action_roundtrip_completed` |
| Take-a-turn | yes (tail +1) | `type=create`, n=1 or 2 | `take_a_turn_button_pressed`, `action_roundtrip_completed` |
| Retry | yes (tail +1) | `type=create`, n=2, top-level `retriedActionId` set | `retry_button_pressed`, `action_roundtrip_completed` |
| Edit | no | `type=update`, n=1 (`text` changed) | `edit-action` (carries `actionId`) |
| Undo | **no** | `type=update`, n=1 (`undoneAt` set) | **none** |
| Restore (redo) | **no** | `type=update`, n=1 (`undoneAt` cleared) | **none** |
| Delete (erase) | no | `type=update`, n=1 (`undoneAt` set) | `erase_button_pressed` |
| Rewind | no | `type=update`, n=(# rewound past) (`undoneAt` set on each) | `rewind-to-here` (carries `actionId`, `position`) |

### Retry

Phase 0 capture (abbreviated):

```
SendEvent retry_button_pressed actionType=retry
contextUpdate tail=5 (was 4)
actionUpdates RETRY n=2 key=43c0813d
SendEvent action_roundtrip_completed actionType=retry
```

Interpretation: the retry frame contains the original (now `undoneAt=<timestamp>`) and the replacement (new id = tail+1, `retriedActionId = originalId`). Tail advanced by 1. Original's `id` unchanged.

This is **Behavior A** from Q11 — new id + back-reference, NOT in-place text replacement.

### Undo and restore are silent wrt `SendEvent`

Unlike every other mutation, undo and restore produce **no** `SendEvent` telemetry. They are observable only via `actionUpdates`. Any code path that infers undo from event telemetry would be wrong.

## Script-side observations

Captured via a minimal Output Modifier that logs `info.actionCount`, `history.length`, and `Object.keys(history[history.length-1])` on every AI-output generation:

- **`history[i]` fields:** `text`, `type`, `rawText`. There is **no** `id` field. Wire action ids are inaccessible to scripts.
- **`history[i].type` values observed:** `story`, `continue`, `do`. Match `actions[i].type` on the wire.
- **`history` excludes undone actions.** Retry example: at modifier-time for the retry's new AI response, `history.length === 4` while `info.actionCount === 5`. The original (now undone) is counted by `actionCount` but filtered from `history`.
- **`info.actionCount` semantics:** at modifier time it equals the count of finalized actions on the adventure **before this turn's user input was submitted**. Excludes both the current turn's user input and the AI response being generated. Verified across 4/4 data points:
  - Story submit (fresh adventure, generating id=1): `count=0 histLen=1`.
  - Do submit (ids 0,1 prior, generating id=3): `count=2 histLen=3`.
  - Continue (ids 0–3 prior, generating id=4): `count=4 histLen=4`.
  - Retry (ids 0–4 prior, generating id=5): `count=5 histLen=4` (id=4 excluded from history because undone).

## Live-count convention

Both sides independently compute the same integer, used as the history-map key:

- **Script-side**, at modifier time: `history.length + 1`. `history` excludes undone entries; adding 1 accounts for the AI response being generated that will become live when the turn finalizes.
- **BD-side**, at any moment: `actions.filter(a => a.undoneAt === null).length`.

Example walk-through from the captured session:

| Turn | Wire ids added | `actions` live after turn | Script writes key | BD reads key |
|------|----------------|----------------------------|-------------------|---------------|
| story submit | 0, 1 | [0, 1] | `"2"` | `"2"` |
| do submit | 2, 3 | [0, 1, 2, 3] | `"4"` | `"4"` |
| continue | 4 | [0, 1, 2, 3, 4] | `"5"` | `"5"` |
| retry | 5 (+ id=4 undone) | [0, 1, 2, 3, 5] | `"5"` (overwrites prior) | `"5"` |
| undo (reverts retry) | — | [0, 1, 2, 3] | (no modifier) | `"4"` |
| rewind to pos 1 | — | [0] | (no modifier) | `"1"` → fallback to `"2"` |

Both sides match by construction. On missing keys, BD SHOULD fall back to the nearest-earlier available entry, then to manifest defaults.

## Injection requirements (non-negotiable)

- Shim `window.WebSocket` with `class extends NativeWebSocket`, **not** a function wrapper. Apollo Client performs `instanceof WebSocket` checks during subscription setup; a function-wrapped shim fails those checks silently and the extension receives zero frames.
- Install before AID's bundle constructs its socket. In the extension: `"world": "MAIN"` + `"run_at": "document_start"` in the manifest. Via userscript: `@run-at document-start`.
- Post-load console install does not work. Apollo captures the native `WebSocket` reference at import time, and any later monkey-patch is ignored.

## Open follow-ups

- Multiplayer-mode scenarios not yet probed. If ids are scoped differently (e.g. per-participant), the live-count convention may need a per-participant variant. Revisit before BetterDungeon V2 ships if Multiplayer support is in scope.
- Take-a-turn in character-creation / scenario-preview screens not probed. Expected harmless but unverified.
- Size limit of `storyCard.value` still empirically unknown. Deferred to Phase 1.

## Provenance

- `Project Management/frontier/action-hunter.user.js` — the canonical Frontier Hunter userscript. Captures all three WS subscriptions plus `UpdateActions` and `SendEvent` fetch traffic. Install via Violentmonkey at `document-start`. Exposes live state on `window.__frontierActions` with `.summary()`, `.cardSummary()`, `.lastTurn()` helpers.
- Script-side probe (not committed; paste into an AID scenario's Output Modifier to reproduce):

```js
log('count=' + info.actionCount + ' histLen=' + history.length + ' lastKeys=' + Object.keys(history[history.length-1] || {}).join(','));
```

Regenerate this file if any of the above assumptions break in future AID releases.
