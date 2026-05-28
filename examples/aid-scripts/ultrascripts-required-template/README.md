# Requires Ultrascripts Template

Starter for AI Dungeon scripts whose core behavior depends on BetterDungeon
Ultrascripts.

Paste the files into the matching AI Dungeon script panes:

1. `library.js` -> Library
2. `input.js` -> Input Modifier
3. `context.js` -> Context Modifier
4. `output.js` -> Output Modifier

Use this template when a script should not pretend to work in plain AI
Dungeon. It gives new required scripts a stable foundation:

- a `bd.us` helper surface that matches the public Ultrascripts docs
- heartbeat-based runtime/module detection
- hard gating through `CONFIG.requiredCapabilities`
- clear player-facing requirement messages
- request queueing through `ultrascripts:out`
- response polling and acknowledgement
- latest-response helpers
- safe `sdk.config` and `clock.now` examples
- Scripture dashboard publishing
- command handling with `:us-required status` and `:us-required reset`

## How To Build From It

- Put script-specific settings in the `CONFIG` object near the top of
  `library.js`.
- Add required modules or ops to `CONFIG.requiredCapabilities`.
- Keep the SDK helper intact until a module-specific review says otherwise.
- Add new module calls near the existing `sdk.config` and `clock.now` examples.
- Read responses with `bd.us.latest(moduleId, opName)`.
- Compare `completedLiveCount` with `bd.us.liveCount()` before applying unsafe
  side-effect responses such as `ai.chat` or `webfetch.fetch`.
- Publish widgets through `publishTemplateDashboard` or replace it with your
  own Scripture manifest.

By default this is a **required** script: missing Ultrascripts stops player
input and explains that BetterDungeon/Ultrascripts must be enabled.
