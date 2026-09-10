# BetterDungeon Examples

Reference starter scripts for BetterDungeon's Ultrascripts modules. This folder
is intentionally small: complete showcase scripts should be built from the
standard templates after each module has been reviewed and finalized.

## License

Files in this `examples/` directory, including scripts, templates, previews, and
their documentation, remain MIT-licensed under Section 8 of the root
[LICENSE](../LICENSE). You may copy, modify, share, and use them commercially,
including in your own scenarios, provided you include the copyright and MIT
permission notice in copies or substantial portions. Their MIT permissions
continue to apply when you copy or adapt them outside this directory.

This exception does not apply to BetterDungeon's browser extension or Android
implementation. Moving other project code into `examples/` does not change its
license. Separately licensed third-party material retains its own terms.

## Layout

- **`aid-scripts/`** - AI Dungeon-side scripts (Library + modifier hooks)
  that paste into a scenario's Scripting panel.

  - **`aid-scripts/ultrascripts-starter-template/`** - The canonical
    Enhanced with Ultrascripts starter. It includes heartbeat checks, response
    polling, acks, op calls, the `bd.us` helper surface, Widget publishing,
    and safe fallback behavior.
  - **`aid-scripts/ultrascripts-required-template/`** - The canonical Requires
    Ultrascripts starter. It uses the same helper surface, plus hard runtime
    and capability gates for scripts that cannot run meaningfully without
    BetterDungeon.

## Adding a new example

1. Start by copying `aid-scripts/ultrascripts-starter-template/` for graceful
   fallback scripts, or `aid-scripts/ultrascripts-required-template/` for hard
   dependency scripts.
2. Keep the `bd.us`-style helper surface intact unless the module review for a
   specific script requires changing it.
3. Enhanced scripts should degrade gracefully if Ultrascripts or the relevant
   module is not mounted. Required scripts should stop clearly and explain the
   missing runtime or capability.
4. Throttle paid AI calls and cache slow or permissioned sidecar calls such as
   weather/location lookups. Examples run in real adventures, not test harnesses.
