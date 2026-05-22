# Aura Cards

Aura Cards is an example AI Dungeon scenario script that rebuilds the core
Auto-Cards idea on top of Ultrascripts's AI module.

Instead of hijacking the story model and asking the player to press Continue
while card text is generated, Aura Cards sends a sidecar `ai.chat` request
through Ultrascripts. Normal gameplay continues; the script polls the response on
later turns and writes or updates story cards when the AI returns structured
JSON.

## What It Demonstrates

- Ultrascripts `ai.chat` calls from an AI Dungeon script.
- `responseFormat: json_schema` for reliable card operations.
- Automatic story-card creation and updates.
- Memory-bank accumulation and sidecar compression.
- Graceful degradation when Ultrascripts or the AI module is not enabled.

## Setup

1. Load BetterDungeon and open AI Dungeon.
2. Open BetterDungeon -> Ultrascripts and enable Ultrascripts plus the AI module.
3. In Ultrascripts -> AI, save an OpenRouter API key and optionally a default model.
4. Paste `library.js` into the scenario Library tab.
5. Paste `output.js` into the Output Modifier tab.
6. Start or resume the adventure.

Aura Cards is enabled by default. Open the `Configure Aura Cards` story card
to tune usage or set `"enabled": false` to pause it.

`input.js` and `context.js` are intentionally no-ops. They are included only
for scenarios or docs that expect all four script tabs to exist.

## Runtime Cards

- `Configure Aura Cards` - editable JSON config.
- `Aura Cards Trace` - status, pending request ids, stats, and recent events.
- `ultrascripts:out` - request queue consumed by BetterDungeon.
- `ultrascripts:in:ai` - AI responses written by BetterDungeon.

Generated cards are ordinary story cards marked in their notes with
`Aura Cards metadata:` so Aura can update only its own cards and avoid
overwriting user-authored cards.

## Stability Notes

Aura Cards keeps the last valid config if the config card JSON is malformed,
prunes old request bookkeeping from `state`, ignores completed sidecar results
while disabled, and tolerates imperfect free-model JSON when the important
card fields are still recoverable.

## Usage Defaults

Aura Cards keeps a small number of sidecar AI requests in flight, waits
`cooldownTurns` turns between sweeps, limits each sweep to
`maxCardsPerSweep` cards, and allows up to `maxConcurrentRequests` in-flight
sidecar requests. The showcase defaults assume free or low-cost models:
4-turn cooldown, 18-action lookback, 5 cards per sweep, and 2 concurrent
requests.
