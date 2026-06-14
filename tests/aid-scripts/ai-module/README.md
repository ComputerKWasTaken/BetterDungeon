# Ultrascripts AI Contract - AI Dungeon Test Suite

End-to-end contract test scripts for the BetterDungeon Ultrascripts AI module
while the generation backend is not configured.

## What It Covers

The suite verifies:

- `ultrascripts:heartbeat` advertises module `ai`.
- `ai` advertises exactly the Phase 1 public ops: `status` and `query`.
- Legacy ops are not advertised: `chat`, `models`, and `testConnection`.
- The legacy provider alias is not advertised as a heartbeat module.
- `ai.status` returns the contract/unavailable state with
  `reason: "ai_backend_not_configured"`.
- Valid text and JSON `ai.query` requests return terminal `not_configured`
  errors until a backend is connected.

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
5. Take a few turns. The suite queues `ai.status`, one text `ai.query`, one JSON
   `ai.query`, reads the responses, and writes a trace card.

## Reading Results

Two surfaces are written to the adventure's story cards:

- `ultrascripts:out` - the script's request queue.
- `ultrascripts:test:ai` - the trace card.

A successful run ends with:

- `phase: "complete"`
- `checksPass: true`
- `heartbeat.aiOps: ["status", "query"]`
- `status.data.phase: "contract"`
- `status.data.reason: "ai_backend_not_configured"`
- `textQuery.response.error.code: "not_configured"`
- `jsonQuery.response.error.code: "not_configured"`

Anything else points to either heartbeat discovery drift or an unexpected AI
module contract shape.
