# Brainiac Prototype

Brainiac is a private, experimental AI Dungeon script that uses the
BetterDungeon Ultrascripts AI module as a rolling editorial mind. It does not
replace or delay AI Dungeon's story model. Instead, it reviews completed story
turns asynchronously, maintains a short editable brain, and gently supplies
that brain to later story generations.

## Requirements

- BetterDungeon with Ultrascripts enabled
- the Ultrascripts `ai` module enabled
- a configured AI provider and API key in BetterDungeon

The adventure stops with a setup message when the Ultrascripts runtime itself
is missing or stale. If only the AI module or provider is unavailable, normal
AI Dungeon play continues without Brainiac guidance.

## Installation

Paste each file into its matching AI Dungeon script pane:

1. `library.js` -> Library
2. `input.js` -> Input Modifier
3. `context.js` -> Context Modifier
4. `output.js` -> Output Modifier

The script creates two Story Cards:

- `Configure Brainiac` exposes `Enabled: true` and the current status. Change
  only `true` to `false` to pause Brainiac without deleting its brain.
- `Brainiac Brain` is the authoritative freeform editorial memory. You may edit
  it at any time to correct Brainiac or guide the story. A result already in
  flight will be discarded rather than overwrite a newer manual edit.

## Timing

Brainiac submits at most one `ai.query` request at a time. Turns played while a
request is pending continue with the last completed brain and do not queue more
requests. A late result is still accepted, and the next request made after it
finishes reviews the newer story context to catch up.

Queries request medium thinking and plain-text output. Generated brains are
limited to 3,000 characters. The Context Modifier is cache-compatible: it
preserves AI Dungeon's assembled context exactly and only appends the current
brain.

## Testing

1. Confirm `Configure Brainiac` moves from `AI unavailable` to `Ready` after
   the asynchronous status request completes.
2. Play a turn and confirm the status becomes `Thinking`.
3. Continue playing normally; when the query completes, inspect `Brainiac
   Brain` and verify later Context Viewer output contains the appended
   `<brainiac-editorial-memory>` block.
4. Edit the Brain Card while a request is pending and verify your edit remains.
5. Set `Enabled: false` and verify the brain is neither injected nor updated.
6. Temporarily disable the AI module and verify vanilla play continues without
   the Brainiac block.

The prototype is intentionally general-purpose and single-player-first. Judge
it by whether stories feel more logical, attentive, and cohesive without the
native story model sounding constrained or mechanically directed.
