# Ultrascripts Starter Template

Clean starter for AI Dungeon scripts enhanced by BetterDungeon Ultrascripts.

Paste the files into the matching AI Dungeon script panes:

1. `library.js` -> Library
2. `input.js` -> Input Modifier
3. `context.js` -> Context Modifier
4. `output.js` -> Output Modifier

The template is intentionally modest. It gives new scripts a stable foundation:

- heartbeat-based runtime/module detection
- a `bd.us` helper surface that matches the public Ultrascripts docs
- request queueing through `ultrascripts:out`
- response polling and acknowledgement
- latest-response helpers
- safe `sdk.config` and `clock.now` examples
- Scripture dashboard publishing
- command handling with `:us-template status` and `:us-template reset`
- graceful fallback when BetterDungeon is missing

## How To Build From It

- Put script-specific settings in the `CONFIG` object near the top of
  `library.js`.
- Keep the SDK helper intact until a module-specific review says otherwise.
- Add new module calls near the existing `sdk.config` and `clock.now` examples.
- Read responses with `us.latest(moduleId, opName)`.
- Compare `completedLiveCount` with `us.liveCount()` before applying side-effect
  responses such as `webfetch.fetch`.
- Publish widgets through `publishTemplateDashboard` or replace it with your
  own Scripture manifest.

By default this is an **enhanced** script: plain AI Dungeon still works, and
BetterDungeon players get the extra dashboard and module integration.
