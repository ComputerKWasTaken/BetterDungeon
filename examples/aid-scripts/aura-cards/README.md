# Aura Cards (Dynamic Profile Curator Edition)

Aura Cards is an example AI Dungeon scenario script that acts as an automated, non-blocking **Story Card Curator** built on top of Ultrascripts's AI module.

Instead of hijacking the main story model and pausing gameplay while card text is generated, Aura Cards sends sidecar `ai.chat` requests asynchronously through Ultrascripts. Normal gameplay continues uninterrupted. The script polls AI responses on later turns and creates or updates story cards when the AI returns structured JSON.

## What It Demonstrates

- Ultrascripts `ai.chat` calls from an AI Dungeon script.
- `responseFormat: json_schema` for highly reliable card creations and rewrites.
- **Dynamic Profile Updates**: As characters and locations evolve in your story (e.g. getting wounded, changing alliances, dying), Aura Cards automatically rewrites their core entries to integrate these developments.
- Clean coordination with AI Dungeon's native Memory Bank (letting AID's vector database handle global history retrieval, while Aura Cards maintains up-to-date character profiles).
- Graceful degradation when Ultrascripts or the AI module is not enabled.

## Setup

1. Load BetterDungeon and open AI Dungeon.
2. Open BetterDungeon -> Ultrascripts and enable Ultrascripts plus the AI module.
3. In Ultrascripts -> AI, save an OpenRouter API key and optionally a default model.
4. Paste `library.js` into the scenario Library tab.
5. Paste `output.js` into the Output Modifier tab.
6. Start or resume the adventure.

Aura Cards is enabled by default. Open the `Configure Aura Cards` story card to tune usage parameters or set `"enabled": false` to pause it.

`input.js` and `context.js` are intentionally no-ops. They are included only for scenarios or docs that expect all four script tabs to exist.

## Runtime Cards

- `Configure Aura Cards` - editable JSON configuration.
- `Aura Cards Trace` - status, pending request IDs, stats, and recent engine events.
- `ultrascripts:out` - request queue consumed by BetterDungeon.
- `ultrascripts:in:ai` - AI responses written by BetterDungeon.

Generated cards are ordinary story cards marked in their descriptions with `Aura Cards metadata:` so Aura can identify and update only its own generated cards, avoiding overwriting user-authored lore.

## Stability & Defaults

Aura Cards keeps the last valid configuration if the config card JSON is malformed, prunes old request bookkeeping from `state`, and ignores completed sidecar results while disabled.

The showcase defaults assume free or low-cost models:
- **4-turn cooldown** between sweeps.
- **18-action lookback** for story events.
- **5 cards per sweep** maximum.
- **2 concurrent requests** in flight.
