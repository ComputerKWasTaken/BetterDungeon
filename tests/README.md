# BetterDungeon Tests

Test artifacts for BetterDungeon. Keep this directory free of production
code - anything here is for verifying behavior, not for shipping.

## Automated Node suites

These dependency-free Node suites protect shared extension services, Android
composition, Ultrascripts transport behavior, and the write paths Navigator
relies on. Run the complete suite with `./build.ps1 test`, or an individual
suite with:

`node --test tests/contracts/<name>.test.js`

- `contracts/` contains shared public behavior and compatibility checks.
- `unit/` contains focused service, harness, package-policy, and repository-policy checks.
- `platform/android/` contains WebView, native transport, override, and Mobile behavior checks.
- `harness/` contains reusable Chrome, AI Dungeon, Android composition, and Ultrascripts simulators.
- `fixtures/` contains deterministic provider and AI Dungeon-shaped data.

- **`adventure-read-contract.test.js`** - Apollo-first adventure reads, GraphQL and WebSocket fallback merging, provenance and coverage diagnostics, post-write memory bypasses, action refresh coordination, and Desktop/Mobile reader wiring.
- **`adventure-write-hydration-contract.test.js`** - Verified Plot, Story Card, and Memory Bank hydration, refetch diagnostics, unsupported routing, and guarded Plot editor hydration with mounted-sibling checks and the outstanding-field ledger.
- **`ai-compatible-contract.test.js`** - Compatible AI profile and capability behavior, text and JSON requests, Gemini reasoning and rate-limit handling, streaming, cancellation, timeouts, errors, and opaque thought-signature replay across tool rounds.
- **`apollo-cache-contract.test.js`** - Apollo bridge wiring, operation allowlisting, unavailable and direct-error handling, Adventure denormalization, memo invalidation, relay pairing, and timeout recovery.
- **`apollo-consumer-contract.test.js`** - Apollo-first Story Card scanning with fallback behavior, Ultrascripts history compatibility, and Auto See warm-tail refresh coordination.
- **`brainiac-prototype-contract.test.js`** - Brainiac's cache-compatible context suffix, two-card controls, one-query async loop, late-result and player-edit behavior, prompt bounds, and unavailable/error paths.
- **`navigator-chat-qol.test.js`** - Navigator mode migration and tool exposure, Automatic versus Proposed changes behavior, approval-gated permanent deletions, sanitized ordered tool activity, Inspector lifecycle, and persisted-transcript privacy.
- **`navigator-change-mode-contract.test.js`** - Canonical mode precedence, legacy Read-only fallbacks, and the independent fail-closed storage gate immediately before writes.
- **`navigator-context-contract.test.js`** - Always-attempted Plot Components, recent story, Memory Bank, and Story Card context plus exact Inspector-to-system-instruction section parity.
- **`navigator-settings-contract.test.js`** - PC controls and Inspector structure, including required desktop tab-overflow arrows and the absence of Context selectors, message action rows, Edit/Retry state, and clipboard access.
- **`navigator-tools-contract.test.js`** - Bounded retrieval tools and the intentional absence of the former Plot Components retrieval tool.

## Manual AI Dungeon script material

The following AI Dungeon-side scripts are retained as development material, but normal CI does not run them or contact AI Dungeon or an AI provider. Their public module and operation catalog, permission outcomes, response failures, timeouts, cancellation, reload, serialization, and secret boundaries are exercised offline by `unit/ultrascripts-harness.test.js`.

- **`aid-scripts/ai-module/`** - Live suite for the Ultrascripts AI module. It verifies heartbeat capabilities, readiness, text and schema-backed JSON, metadata, thinking, missing-key, schema-guard, and thinking-guard paths. See its `README.md` for setup and trace-card guidance.
- **`aid-scripts/sdk-module/`** - End-to-end suite for the Ultrascripts SDK module, covering `version` and `config` operations.
- **`aid-scripts/widget-module/`** - Behavior-focused suite covering every widget type, value transitions, edge cases, custom HTML, and panels.
- **`aid-scripts/audio-module/`** - Live V2.1 Audio suite covering oscillator and noise effects, replay prevention, validation, and stop behavior.
- **`aid-scripts/clock-module/`** - End-to-end Clock module suite covering `now`, `tz`, and `format`, including timezone validation, custom formats, and errors.
- **`aid-scripts/system-module/`** - End-to-end System module suite covering `info` and `power`, including device, platform, browser, screen, hardware, and battery payloads.
- **`aid-scripts/network-module/`** - End-to-end Network module suite covering connection status, quality, and connection details.
- **`aid-scripts/weather-module/`** - End-to-end Weather module suite covering current and forecast lookups, units, coordinates, places, and validation.
- **`aid-scripts/webfetch-module/`** - End-to-end WebFetch module suite covering prompt-free HTTPS reads, validation, redirect and private-target protection, text-only responses, and rate limits.

## Adding a new suite

1. Create `tests/aid-scripts/<target>/` for AI Dungeon-side suites or a
   sibling subtree for future automated tests.
2. Include a `README.md` in the suite folder covering what it tests, how to
   install it in a scenario (or run it), and how to read its output.
3. Pair `library.js` with whichever modifier hook drives the suite.
   Keep error handling defensive so a failing test never breaks gameplay for
   the user running it.
