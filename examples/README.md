# BetterDungeon Examples

Reference starter scripts for BetterDungeon's Ultrascripts modules. This folder
is intentionally small: complete showcase scripts should be built from the
standard template after each module has been reviewed and finalized.

## Layout

- **`aid-scripts/`** - AI Dungeon-side scripts (Library + modifier hooks)
  that paste into a scenario's Scripting panel.

  - **`aid-scripts/ultrascripts-starter-template/`** - The canonical
    SDK-based starter. It includes heartbeat checks, response polling, acks,
    op calls, the `bd.us` helper surface, Scripture publishing, and safe
    fallback behavior.

## Adding a new example

1. Start by copying `aid-scripts/ultrascripts-starter-template/`.
2. Keep the `bd.us`-style helper surface intact unless the module review for a
   specific script requires changing it.
3. Always degrade gracefully if Ultrascripts or the relevant module is not
   mounted. A template-derived script should never break plain AI Dungeon
   gameplay unless it is explicitly documented as requiring Ultrascripts.
4. Throttle paid AI calls and cache slow or permissioned sidecar calls such as
   weather/location lookups. Examples run in real adventures, not test harnesses.
