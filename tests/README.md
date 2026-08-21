# BetterDungeon Tests

Test artifacts for BetterDungeon. Keep this directory free of production
code - anything here is for verifying behavior, not for shipping.

## Node contract suites

These dependency-free Node suites protect shared extension services and the
write paths Navigator relies on. Run an individual suite with:

`node tests/<name>.test.js`

- **`adventure-read-contract.test.js`** - Apollo-first adventure reads, GraphQL and WebSocket fallback merging, provenance and coverage diagnostics, post-write memory bypasses, action refresh coordination, and Desktop/Mobile reader wiring.
- **`adventure-write-hydration-contract.test.js`** - Verified Plot, Story Card, and Memory Bank hydration, refetch diagnostics, unsupported routing, and guarded Plot editor hydration with mounted-sibling checks and the outstanding-field ledger.
- **`ai-compatible-contract.test.js`** - Compatible AI profile and capability behavior, text and JSON requests, Gemini reasoning and rate-limit handling, streaming, cancellation, timeouts, errors, and opaque thought-signature replay across tool rounds.
- **`apollo-cache-contract.test.js`** - Apollo bridge wiring, operation allowlisting, unavailable and direct-error handling, Adventure denormalization, memo invalidation, relay pairing, and timeout recovery.
- **`apollo-consumer-contract.test.js`** - Apollo-first Story Card scanning with fallback behavior, Ultrascripts history compatibility, and Auto See warm-tail refresh coordination.

## Live Ultrascripts suites

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
