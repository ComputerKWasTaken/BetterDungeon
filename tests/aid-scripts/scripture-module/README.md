# Frontier Scripture Module — AI Dungeon Test Suite

End-to-end AI Dungeon-side test scripts for the BetterDungeon Scripture module (`modules/scripture/module.js`).

This suite is **command-driven**: you install the `library.js` and `input-modifier.js` pair, then control the suite primarily with `/scripture ...` slash commands typed into normal player input. The suite publishes `frontier:state:scripture`, consumes `frontier:in:scripture` widget events, acknowledges them, and writes a trace card so you can inspect what happened.

## What it is for

Use this suite when you change any of the following:

- `modules/scripture/module.js`
- `modules/scripture/renderer.js`
- `modules/scripture/validators.js`
- widget affordance behavior (`loading`, `pending`, `stale`, `error`, `empty`)
- event ack / replay / history selection logic
- manifest validation or state-patch filtering

## What it covers

The suite gives you two main scenarios and one auto-run checklist.

| Scenario | Purpose |
| --- | --- |
| `smoke` | Renders a broad dashboard with representative widget types and live interaction handling |
| `affordances` | Lets you intentionally force `normal`, `empty`, `error`, `stale`, and `loading` turn states while also testing `pending` via real widget interactions |
| `run` | Walks every step in `affordances` then `smoke` automatically, one step per turn, validating heartbeat + ack flow and prompting you to eyeball each affordance |

The smoke scene includes representative coverage for:

- **Display widgets** — `stat`, `bar`, `counter`, `taggroup`, `timer`, `progress`
- **Interactive widgets** — `radio`, `stepper`, `confirm`
- **Container widgets** — `tabs`

## Surfaces written

| Card | Direction | Purpose |
| --- | --- | --- |
| `frontier:state:scripture` | script &rarr; BD | Manifest + history + `interactions.ackSeq`. Rebuilt every turn from current scenario / forced state. |
| `frontier:in:scripture` | BD &rarr; script | Read-only here. We poll widget interaction events, accumulate them in the trace, and advance our local `ackSeq` to clear `pending` on the BD side. |
| `frontier:test:scripture` | script &rarr; you | Human-readable trace with current phase, published envelope summary, recent widget events, auto-run progress, and command help. |

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon &rarr; **Frontier** and enable Frontier and the **Scripture** module.
3. In AI Dungeon, edit a scenario and open the **Scripting** panel.
4. Paste the contents of `library.js` into the **Library** script.
5. Paste the contents of `input-modifier.js` into the **Input Modifier**.
6. Paste the contents of `output-modifier.js` into the **Output Modifier**.
7. Save and start (or resume) an adventure on that scenario.

> **Why both modifiers?** AI Dungeon's `onInput` hook only fires when the player **submits input**, so AI-only turns (continue, retry) wouldn't advance the suite. The input modifier consumes `/scripture` commands; the output modifier ticks the suite once per generation so it progresses every turn regardless of who acted.

## Commands

Type these into normal player input. They are stripped from the text before it reaches the model.

> **Note:** AI Dungeon's `onInput` hook throws an error if a script returns empty text (`Unable to run scenario scripts`). If your entire input is a `/scripture` command and nothing else, the modifier substitutes a single `.` so the turn still advances. You can also append a command to regular input (e.g., `I look around. /scripture state empty`) and only the command portion is removed.

| Command | Effect |
| --- | --- |
| `/scripture run` | Start the auto checklist (recommended on first run) |
| `/scripture next` | Skip the current auto step (use if a step is gated on you and you want to move on) |
| `/scripture stop` | Pause the auto run |
| `/scripture smoke` | Load smoke scenario manually |
| `/scripture affordances` | Load affordance scenario manually |
| `/scripture state normal` | Force normal values (clears affordance markers) |
| `/scripture state empty` | History entry exists for `liveCount` but with no widget values |
| `/scripture state stale` | History only has older entries; `liveCount` has no entry &mdash; renderer falls back |
| `/scripture state error` | Inject an invalid value (e.g., `progress.max = -1`) so validation fails post-value |
| `/scripture state loading` | Wipe history entirely so widgets render with no data |
| `/scripture ack` | Force-advance `ackSeq` past every observed event (clears any held pending state) |
| `/scripture clear` | Unmount all widgets (publishes empty manifest) |
| `/scripture reset` | Reset all suite state and republish empty envelope |

## Reading the trace

Open the `frontier:test:scripture` story card after a few turns. Top-level fields:

- **`phase`** &mdash; current driver state (`auto: state-empty`, `auto-wait: pending-prompt`, `affordances:error`, `idle`, etc.).
- **`scenario` / `forcedState`** &mdash; what the suite is currently asking BD to render.
- **`heartbeat.scriptureAdvertised`** &mdash; whether BD is publishing the scripture module via heartbeat.
- **`publishedEnvelope`** &mdash; widgets in the manifest, history keys present, current `ackSeq`. Quick sanity check that the envelope you wrote matches your intent.
- **`interactions.recentEvents`** &mdash; tail of widget events received from BD (proves the interaction queue is alive).
- **`auto.counts` / `auto.checksPass`** &mdash; auto-run summary. `checksPass: true` when every step has run and passed.
- **`auto.currentStep.note`** &mdash; **read this**; it tells you what to look at on screen for the current step.
- **`auto.results[label].observed`** &mdash; what the suite expected you to see for each completed step.
- **`events`** &mdash; rolling internal log of suite-side activity.

## Auto-run flow

`/scripture run` walks this plan, one step per turn:

1. **heartbeat** &mdash; protocol-level: BD must advertise the `scripture` module.
2. **mount-affordances** &mdash; small affordance manifest with normal values; baseline render.
3. **state-loading** &mdash; clear history; expect skeleton shimmer.
4. **state-normal** &mdash; restore values; affordances clear.
5. **state-empty** &mdash; entry exists but has no widget values; expect empty hint per widget.
6. **state-stale** &mdash; only previous-turn history exists; expect dimmed/stale style.
7. **state-error** &mdash; `shield` widget gets invalid `max=-1`; expect error overlay.
8. **pending-prompt** &mdash; suite stops auto-acking. **Click any widget**; the suite advances once it observes the event.
9. **pending-ack** &mdash; suite releases ack; pending pulse should clear.
10. **mount-smoke** &mdash; switch to broader smoke manifest.
11. **unmount** &mdash; publish empty manifest; widget container should disappear.

A successful run ends with `phase: "auto-complete"` and `auto.checksPass: true`. Steps that fail leave a `reason` in their result.

## Pending state caveat

`pending` cannot be fully automated &mdash; it requires a real widget interaction from you. The auto-run handles this by:

- Setting an internal `_pendingHold` flag so `scrPollInbox` does **not** advance `ackSeq` while the prompt is active.
- Waiting until it observes a new event from BD and at least one full turn has elapsed.
- Then validating that the event arrived and releasing the ack on the next step.

If you take a turn without clicking anything during `pending-prompt`, the step stays open until you do (or you type `/scripture next` to skip).

## Mid-test reload safety

The suite's state envelope is rebuilt every turn from `state.scriptureTest`, so a page reload simply re-publishes the same envelope on the next turn. There are no in-flight requests that would be lost.

If `state.scriptureTest` itself was wiped (for example by a script edit), type `/scripture reset` to start over cleanly.

## Manual missing-module check

To verify the module-not-loaded path: disable the Scripture module in BetterDungeon &rarr; Frontier, take a turn, and confirm `heartbeat.scriptureAdvertised` is `false` in the trace. Re-enable and the next turn should flip it to `true`.
