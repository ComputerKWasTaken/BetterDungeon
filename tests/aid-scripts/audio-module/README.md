# Ultrascripts Audio Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Ultrascripts Audio
module (`modules/audio/module.js`) over the live Ultrascripts protocol from
inside an AI Dungeon scenario.

The Audio module is state-driven: scripts declare desired playback on the
`ultrascripts:state:audio` story card and never receive per-cue responses.
Each suite step therefore writes a state payload, then calls the read-only
`audio.state` op and asserts the reported playback matches the declaration.
The suite verifies the contract plumbing; whether it *sounds* right is
verified by ear (remember browsers need one click/keypress on the page
before audio can start).

## What it covers

The suite runs a fixed plan, one step per turn, in order:

| Step | Declares | Expect |
| --- | --- | --- |
| `baseline-state-op` | — | ok + vocabulary version and cue list including `music.lofi.chill` |
| `music-and-prime` | lo-fi music + one-shot seq 1 | ok + music cue active, seq 1 primed (not replayed) |
| `ambience-layer` | + `weather.rain.light` ambience | ok + ambience layer reported |
| `oneshot-advances-seq` | + one-shot seq 2 | ok + `oneshotAckSeq >= 2` |
| `unknown-cue-cascades` | unknown music cue | ok + cascades to `music.calm` |
| `clear-state-silences` | `music: null`, empty ambience | ok + no music, no ambience |
| `err-unknown-op` | — | err `unknown_op` |

It also verifies the `ultrascripts:heartbeat` card lists `audio` with the
`state` op, pending → terminal response transitions on
`ultrascripts:in:audio`, and ack-driven response cleanup.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Ultrascripts** and enable Ultrascripts and the
   **Audio** module.
3. Click anywhere on the AI Dungeon page once so the browser unlocks audio.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take a few turns. Each generation advances one step.

## Reading results

Open the `ultrascripts:test:audio` story card after a few turns to see:

- `phase` — current driver state (`queueing X`, `awaiting X`,
  `complete`, `complete-with-failures`).
- `counts` — pass/fail/pending tally.
- `results[label]` — per-step outcome with `pass`, `reason`, `status`,
  `error`, and preview data (active music, ambience count, ack seq,
  AudioContext state).
- `events` — rolling log of state writes, queue/ack/completion events.
- `checksPass: true` once everything has passed.

Say or write `[[audio-test:reset]]` in the story to reset and rerun the
suite (it also silences any active audio).

A successful run ends with `phase: "complete"` and `checksPass: true`.
