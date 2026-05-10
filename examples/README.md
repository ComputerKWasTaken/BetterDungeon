# BetterDungeon Examples

Reference scripts that *use* BetterDungeon's Frontier modules to enhance
real gameplay. These are the showcase counterpart to `tests/` — tests prove
the system works, examples prove it's worth using.

## Layout

- **`aid-scripts/`** — AI Dungeon-side scripts (Library + modifier hooks)
  that paste into a scenario's Scripting panel.

  - **`aid-scripts/auto-lorebook/`** — Auto-Lorebook Builder. Watches
    each AI generation, asks the Frontier AI module to extract named
    entities (people, places, items, factions, concepts) using a strict
    JSON schema, and auto-creates story cards for them so AID's own
    context selector pulls the new lore into subsequent generations.
    Demonstrates `chat` + `responseFormat: json_schema`, cost discipline,
    and idempotent integration with the AID story-card system.

## Adding a new example

1. Create `examples/aid-scripts/<feature>/` with a `README.md`,
   `library.js`, and the modifier file that drives it.
2. Always degrade gracefully if Frontier or the relevant module isn't
   mounted — the example must never break gameplay for users who haven't
   enabled the feature yet.
3. Throttle paid AI calls (e.g. every N turns or after specific triggers).
   Examples run on real OpenRouter credits, not test ones.
