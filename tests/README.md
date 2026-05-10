# BetterDungeon Tests

Test artifacts for BetterDungeon. Keep this directory free of production
code — anything here is for verifying behavior, not for shipping.

## Layout

- **`aid-scripts/`** — AI Dungeon-side scripts (Library / Input / Output /
  Context modifiers) that drive the BetterDungeon extension end-to-end via
  the live Full Frontier protocol. Pasted into a scenario's Scripting panel.
  Each subfolder targets one Frontier module or feature.

  - **`aid-scripts/ai-module/`** — End-to-end suite for the Frontier AI
    module (`modules/ai/module.js`). Exercises `chat`, `models`,
    `testConnection`, alias routing, validation paths, dispatcher routing
    errors, and the `unsafe_replay_blocked` recovery path. See its
    `README.md` for setup and reading the trace card.

## Adding a new suite

1. Create `tests/aid-scripts/<target>/` for AID-side suites or a sibling
   sub-tree (e.g. `tests/unit/`) for any future automated tests.
2. Include a `README.md` in the suite folder covering: what it covers, how
   to install it in a scenario (or run it), and how to read its outputs.
3. Pair `library.js` with whichever modifier hook drives the suite.
   Keep error handling defensive so a failing test never breaks gameplay
   for the user running it.
