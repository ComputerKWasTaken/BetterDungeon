# BetterDungeon Tests

Test artifacts for BetterDungeon. Keep this directory free of production
code — anything here is for verifying behavior, not for shipping.

## Layout

- **`aid-scripts/`** — AI Dungeon-side scripts (Library / Input / Output /
  Context modifiers) that drive the BetterDungeon extension end-to-end via
  the live Full Ultrascripts protocol. Pasted into a scenario's Scripting panel.
  Each subfolder targets one Ultrascripts module or feature.

  - **`aid-scripts/ai-module/`** — Placeholder suite for the Ultrascripts AI
    module (`modules/ai/module.js`). Verifies heartbeat advertises only
    `status` and `query`, that `ai.status` reports Gemini readiness, and that
    text, schema-backed JSON, missing-key, and schema guard paths behave. See
    its `README.md` for setup and reading the trace card.

  - **`aid-scripts/sdk-module/`** — End-to-end suite for the Ultrascripts SDK
    module (`modules/sdk/module.js`). Exercises `version` and `config` ops.

  - **`aid-scripts/scripture-module/`** — Behavior-focused suite for the
    Ultrascripts Scripture module. Eight scenario commands exercising every
    widget type, value transitions, edge cases, custom HTML, and panels.

  - **`aid-scripts/clock-module/`** — End-to-end suite for the Ultrascripts
    Clock module (`modules/clock/module.js`). Exercises `now`, `tz`,
    `format` ops, timezone validation, custom format patterns, and error
    paths.

  - **`aid-scripts/system-module/`** — End-to-end suite for the Ultrascripts
    System module (`modules/system/module.js`). Exercises `info` and `power`
    ops, validating device classification, platform, browser, screen,
    hardware, and battery payloads.

  - **`aid-scripts/network-module/`** — End-to-end suite for the Ultrascripts
    Network module (`modules/network/module.js`). Exercises the `status` op,
    validating online state, connection quality, and connection details.

  - **`aid-scripts/geolocation-module/`** — End-to-end suite for the
    Ultrascripts Geolocation module (`modules/geolocation/module.js`). Exercises
    `permission` and `getCurrent` ops with permission-aware validation.

  - **`aid-scripts/weather-module/`** — End-to-end suite for the Ultrascripts
    Weather module (`modules/weather/module.js`). Exercises `current` and
    `forecast` ops with coordinate/place lookups, unit systems, and error
    validation.

  - **`aid-scripts/webfetch-module/`** — End-to-end suite for the Ultrascripts
    WebFetch module (`modules/webfetch/module.js`). Exercises `fetch` and
    `search` ops with consent-aware validation, SSRF protection checks, and
    rate limit handling.

## Adding a new suite

1. Create `tests/aid-scripts/<target>/` for AID-side suites or a sibling
   sub-tree (e.g. `tests/unit/`) for any future automated tests.
2. Include a `README.md` in the suite folder covering: what it covers, how
   to install it in a scenario (or run it), and how to read its outputs.
3. Pair `library.js` with whichever modifier hook drives the suite.
   Keep error handling defensive so a failing test never breaks gameplay
   for the user running it.
