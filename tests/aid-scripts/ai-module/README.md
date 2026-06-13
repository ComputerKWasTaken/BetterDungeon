# Ultrascripts AI Placeholder - AI Dungeon Test Suite

End-to-end placeholder test scripts for the BetterDungeon Ultrascripts AI module
while the generation backend is being rebuilt.

## What It Covers

The suite verifies:

- `ultrascripts:heartbeat` advertises module `ai`.
- `ai` advertises only the `status` op.
- Old generation ops are not advertised: `query`, `chat`, `models`, and
  `testConnection`.
- The legacy provider alias is not advertised as a heartbeat module.
- `ai.status` returns the rebuild/unavailable state with
  `reason: "ai_module_rebuild"`.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon -> **Ultrascripts** and enable Ultrascripts and the
   **AI** module.
3. Open or resume an adventure, then take one normal turn so BetterDungeon can
   write the heartbeat.

No API key, external account, or AI backend is required.

## Install In A Scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start or resume an adventure on that scenario.
5. Take a few turns. The suite queues `ai.status`, reads the response, and
   writes a trace card.

## Reading Results

Two surfaces are written to the adventure's story cards:

- `ultrascripts:out` - the script's request queue.
- `ultrascripts:test:ai` - the trace card.

A successful run ends with:

- `phase: "complete"`
- `checksPass: true`
- `heartbeat.aiOps: ["status"]`
- `status.data.phase: "rebuild"`
- `status.data.reason: "ai_module_rebuild"`

Anything else points to either heartbeat discovery drift or an unexpected AI
module status shape.
