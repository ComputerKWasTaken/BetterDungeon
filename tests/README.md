# BetterDungeon testing rules

BetterDungeon is tested **live**: in a real AI Dungeon adventure, on the real
browser or device. The small offline suite in this folder only guards things
live testing cannot reliably catch. There is no test framework, no npm
dependency, and no Playwright/DOM-emulation suite, and there will not be one.

## Permanent tests

Permanent tests are `tests/*.test.js` files run by Node's built-in `node:test`
through `.\build.ps1 test` (or `node tests/run-all.mjs`). `run-all.mjs` picks up
every `tests/*.test.js` file automatically; nothing else runs.

A test may be committed only if it protects one of these:

1. **Release and packaging boundaries**: browser/Android version parity, the
   extension manifest and package allowlist, Android runtime sources, and no
   tracked build or signing output.
2. **Secret and data-loss safety**: API keys are never exposed in status or
   diagnostics and never silently lost; saved user settings survive migrations
   and failed writes.
3. **Pure logic that live testing rarely exercises**: deterministic code such
   as version comparison, throttling, or parsing, where the interesting cases
   are hard to reach by hand.
4. **Browser/Android parity**: contracts that both hosts must honor
   identically.

Every permanent test must also be:

- **Offline and deterministic.** Mock providers and AI Dungeon; never make live
  network requests, spend generation credits, or depend on timing.
- **Small and focused.** Test the contract, not the implementation. No broad
  regression suites, runtime simulators, fake AI Dungeon DOMs, HTML harnesses,
  or shared fixture libraries.
- **Durable.** If the test only exists to prove that one specific bug was fixed,
  it is a scratch test (below), not a permanent one.

Do not write permanent tests for UI, DOM integration, feature behavior inside
an adventure, provider-specific quirks, or anything AI Dungeon can change
under us. Verify those live.

## Scratch tests

Throwaway checks for reproducing a bug or exploring a change go in
`tests/scratch/`, which is gitignored and never run by `run-all.mjs`. Use any
format you like (Node scripts, HTML pages, console snippets).

Delete a scratch test once the change it supports has been verified live. Never
move a scratch test into `tests/` unless it meets the permanent-test criteria
above.

Live testing steps and the merge checklist are in
[CONTRIBUTING.md](../CONTRIBUTING.md#live-testing-checklist).
