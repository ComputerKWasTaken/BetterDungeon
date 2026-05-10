# Aura Cards — Frontier-Enhanced Auto Cards

A tasteful remake of LewdLeah's Auto Cards that uses the BetterDungeon Frontier **AI module** to generate story cards asynchronously without pausing gameplay. Falls back gracefully to the original Auto Cards behavior when Frontier is unavailable.

## What Aura Cards does

Aura Cards retains all of Auto Cards' core functionality — automatic card creation, memory compression, title detection, configuration UI — but enhances it with:

- **Non-blocking card generation.** Instead of pausing the game to generate cards via AID's built-in AI, Aura Cards sends chat requests through the Frontier AI module in the background. The story continues while cards are being written.
- **Cost-effective model selection.** Uses a configurable OpenRouter model (defaults to the one set in BetterDungeon's Frontier panel) with explicit token budgets.
- **Graceful degradation.** If Frontier or the AI module isn't mounted, Aura Cards seamlessly falls back to the original Auto Cards behavior (state.message-based generation). No broken gameplay.
- **Observability.** A status card shows whether Frontier is active, which mode is in use, and recent generation results.

## What it demonstrates

- **Frontier as a drop-in enhancement.** The same script works with or without Frontier — the AI module is an optional upgrade, not a hard dependency.
- **Async background processing.** Card generation happens in parallel with story generation, unlike the original's blocking state.message approach.
- **Feature detection via heartbeat.** The script checks `frontier:heartbeat` for the AI module before using it.
- **Integration with existing AID scripts.** Shows how to enhance a mature script (Auto Cards) with Frontier capabilities while preserving all original behavior.