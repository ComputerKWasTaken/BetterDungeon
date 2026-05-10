# Auto-Lorebook Builder

A reference AI Dungeon script that uses the BetterDungeon Frontier **AI
module** to grow a scenario's lorebook automatically as the story unfolds.

## What it does

After every AI generation, the script:

1. Checks the `frontier:heartbeat` card to confirm the AI module is mounted.
2. If it's been at least `LORE_RUN_EVERY_N_TURNS` turns since the last
   extraction (default: 2), gathers the last few history entries.
3. Sends a single `chat` request through the Frontier AI module asking for
   a strict-schema JSON list of named entities (people, places, items,
   factions, concepts) explicitly introduced in the excerpt.
4. Parses the result and creates one **story card** per new entity, with
   the entity's name as the card title and any aliases folded into the
   card's keys. The card type matches the entity kind (`Character`,
   `Location`, `Item`, `Faction`, `Concept`).
5. Writes a human-readable `lorebook:status` card summarizing what's been
   built so you can watch the lorebook grow.

AID's own context selector picks up the new cards on subsequent turns,
which means the underlying AI Dungeon model gets richer, scenario-specific
context for free — without you ever opening the lorebook editor.

## What it demonstrates

- **End-to-end use of the Frontier AI module** from inside a real AID
  scenario (not a test harness).
- **Strict structured output** via `responseFormat: json_schema`. The AI
  module's `chat` op forwards the schema to OpenRouter, which guarantees
  the response is valid JSON matching it. No fragile regex parsing.
- **Cost discipline.** One chat completion at most every two turns,
  capped at 800 max tokens, with a tight history window. Crank the
  config knobs at the top of `library.js` to tune for your scenario.
- **Idempotent integration with the AID story-card system.** Existing
  cards are never overwritten — the script only fills gaps.
- **Graceful degradation.** If Frontier or the AI module isn't mounted,
  the script silently no-ops and never breaks gameplay.

## Setup

1. Install BetterDungeon and open AI Dungeon.
2. Open BetterDungeon → **Frontier** → enable Frontier and the **AI**
   module.
3. Open Frontier → **AI Providers** → save an OpenRouter API key.
   Optionally set a default model.
4. In AI Dungeon, edit your scenario's **Scripting** panel:
   - Paste `library.js` into the **Library** script.
   - Paste `output-modifier.js` into the **Output Modifier**.
5. Save and start (or resume) an adventure. Take a few turns. After the
   first eligible turn you'll see new story cards appear and
   `lorebook:status` populate with a tally.

## Tuning

All knobs live at the top of `library.js`:

| Constant | Default | Effect |
| --- | --- | --- |
| `LORE_RUN_EVERY_N_TURNS` | `2` | Lower = more coverage, higher cost. |
| `LORE_HISTORY_WINDOW` | `6` | History entries fed to the extractor. |
| `LORE_DESCRIPTION_MAX_CHARS` | `280` | Per-card description cap. |
| `LORE_MAX_TOKENS` | `800` | Output budget per extraction call. |
| `LORE_MODEL` | `''` | Override the OpenRouter model. Empty = BD default. |
| `LORE_IGNORE_NAMES` | `['you', 'i', ...]` | Names always skipped. |

## Manual commands

Type any of these in your input on a turn (consumed once, then ignored):

- **`lorebook reset`** or `[[lorebook:reset]]` — wipe internal state and
  reset totals. Existing entity cards stay; only the script's tracking is
  cleared.
- **`lorebook rebuild`** or `[[lorebook:rebuild]]` — force the next turn
  to run an extraction immediately, ignoring the throttle.

## Reading the status card

Open the `lorebook:status` card in AID's Story Cards panel:

```
Auto-Lorebook Builder
Run: lorebook-mox12abc
Turn: 14 (live key 15)
AI module: ready
Frontier: protocol 1, profile full
Last extraction at turn: 13
In flight: none

Totals:
  people:    4
  places:    3
  items:     2
  factions:  1
  concepts:  0

Last run added 1, skipped 2:
  + Sage Elara (person)
  - You [ignored]
  - The Wastes [already exists]
```

`In flight` shows whether an extraction is currently waiting for a
response. `Last run` shows what changed on the most recent extraction —
including any error code if the call failed.

## Caveats

- Each extraction is a real paid OpenRouter call. Watch your credits if
  you crank `LORE_RUN_EVERY_N_TURNS` to 1 in a long scenario.
- Entity quality depends on the model. Cheap free-tier models will
  produce noisier entries than premium ones; the strict JSON schema
  prevents shape errors but not content errors.
- Existing cards (player-curated or from another script) are deliberately
  preserved — the lorebook only grows.
