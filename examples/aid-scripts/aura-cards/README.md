# Aura Cards

A drop-in upgrade to LewdLeah's open-source **Auto-Cards** script that
routes card-entry generation through BetterDungeon's Frontier **AI module**.
When the AI module is mounted, Aura Cards generates new story-card entries
in the background without ever pausing the story. When it isn't, the script
falls back transparently to the original Auto-Cards behavior.

## What changed vs. stock Auto-Cards

The original Auto-Cards generates a new card by injecting a generation
prompt into the AID context for one turn. The underlying AI Dungeon model
then writes the card text instead of progressing the story — so you "lose"
that turn to lorebook maintenance.

Aura Cards keeps every Auto-Cards feature intact (title detection, banned
titles, memory compression, configure card, debug card, all manual `/AC`
commands, LSIv2, etc.) but re-routes the **generation step** through a
dedicated `chat` request to the Frontier AI module:

| Stage | Original Auto-Cards | Aura Cards (Frontier mounted) |
| --- | --- | --- |
| Title selection | Same | Same |
| Generation prompt | Injected into AID context, hijacks one turn | Sent as a Frontier chat request, **no story pause** |
| Capture | Reads next turn's AI output | Polls `frontier:in:ai` for the response |
| Cleanup / formatting | Sentence dedupe, length cap, bullet mode | Identical (calls into the same `constructCard` path) |
| Cooldown / state reset | Same | Same |

## Files

- **`library.js`** — Auto-Cards with the Frontier integration layer. Three
  surgical insertion points are clearly marked with `// AURA:` comments:
  the `AuraFrontier` IIFE at the top, the `promptGeneration()` branch, and
  the output-side polling block. All Aura state lives in `state.aura`,
  separate from Auto-Cards' validated state schema.
- **`input.js`**, **`output.js`**, **`context.js`** — unchanged from
  stock Auto-Cards. The Frontier flush happens inside `AutoCards` itself,
  so the modifier files need no awareness of Aura.

## Setup

1. Install BetterDungeon, open AI Dungeon.
2. BetterDungeon → **Frontier** → enable Frontier and the **AI** module.
3. Frontier → **AI** → save an OpenRouter API key. Optionally
   pin a default model.
4. In your AI Dungeon scenario's **Scripting** panel:
   - Library tab: paste `library.js`.
   - Input / Output / Context tabs: paste the matching modifier files.
5. Save. In the story, edit the **"Edit to enable Auto-Cards"** card to
   turn it on (same workflow as stock Auto-Cards).
6. Play. After a handful of turns the cooldown elapses and Aura kicks in.
   Cards appear in your Story Cards panel without your turn being hijacked.

## Reading the status card

Aura writes a story card titled **`aura:status`** that updates every turn:

```
Aura Cards — Frontier AI status
AI module: ready (Frontier-driven generation active)
Frontier: protocol 1, profile full
Pending:
  - Sage Elara (12-aura-3)
Recent (last 6):
  - The Wastes: ok
  - Captain Voss: ok
Events:
  offload: Sage Elara
  queued: 12-aura-3 for 'Sage Elara'
  complete: 11-aura-2 ok
```

Field reference:

- **AI module** — `ready` means Frontier-driven generation is active.
  `unavailable` means Aura is dormant and stock Auto-Cards is doing its
  normal context-hijack thing. The script flips between modes turn-by-turn
  if you toggle the module mid-adventure — there's no manual switch.
- **Pending** — generations sent to OpenRouter that haven't returned yet.
  Empty during normal cooldown periods.
- **Recent** — completed generations with their final status. `ok` means
  the entry was written; `err`/`empty`/`abort` means it'll be retried on
  the next eligible turn.
- **Events** — rolling log of `offload`, `queued`, `complete`, `abort`.

## Fallback verification

To prove fallback works, disable the AI module in BetterDungeon and play
a few more turns. The status card flips to:

```
AI module: unavailable (falling back to standard Auto-Cards behavior)
```

and stock Auto-Cards' context-hijack generation resumes immediately. No
restart, no command, no state surgery required — the next call to
`promptGeneration()` simply picks the original branch.

## Tunables

At the top of `library.js`'s `AuraFrontier` IIFE:

| Constant | Default | Effect |
| --- | --- | --- |
| `DEFAULT_MODEL` | `""` | Pin a specific OpenRouter model. Empty = BD default. |
| `MAX_TOKENS` | `800` | Per-extraction output budget. Reasoning models need more. |
| `TEMPERATURE` | `0.4` | Lower = drier, more factual entries. |
| `TIMEOUT_MS` | `60000` | Per-request timeout sent to Frontier. |
| `MAX_ACK_RETRIES` | `6` | Cap on ack retries per request. |

## Why this is interesting

This is the test-of-concept the BetterDungeon Frontier protocol was
designed for: take an existing best-in-class AID script (Auto-Cards is the
gold standard for plot-aware story-card automation) and graft on a smarter,
out-of-band model without rewriting it. Three insertion points, a
self-contained client layer, and a heartbeat probe are enough to swap a
turn-hijack for a real background AI call — and the same script keeps
working unchanged when Frontier isn't around.

## Credit

The bulk of the script in `library.js` is **Auto-Cards** by **LewdLeah**
(May 21, 2025), used and modified under the open-source terms LewdLeah
declared in the script's own header. The Aura Frontier integration layer
and the three insertion points marked `// AURA:` are the only additions.
