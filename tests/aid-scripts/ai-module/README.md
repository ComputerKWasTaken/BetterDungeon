# Ultrascripts AI Gemini - AI Dungeon Test Suite

End-to-end contract test scripts for the BetterDungeon Ultrascripts AI module
and Gemini backend.

## What It Covers

The suite verifies:

- `ultrascripts:heartbeat` advertises module `ai`.
- `ai` advertises exactly the Phase 1 public ops: `status` and `query`.
- Legacy ops are not advertised: `chat`, `models`, and `testConnection`.
- The legacy provider alias is not advertised as a heartbeat module.
- `ai.status` reports Gemini backend readiness, selected model, and key
  configuration state.
- Plain text `ai.query` returns text when Gemini is configured, or
  `not_configured` when no key is saved.
- Schema-backed JSON `ai.query` returns parsed JSON when Gemini is configured,
  or `not_configured` when no key is saved.
- `ai.query` accepts a `thinking` level and defaults to `minimal`.
- Schema-less JSON `ai.query` returns terminal `invalid_args`.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon -> **Ultrascripts** and enable Ultrascripts and the
   **AI** module.
3. For live generation checks, add a Gemini API key in the AI module card.
4. Open or resume an adventure, then take one normal turn so BetterDungeon can
   write the heartbeat.

Without a Gemini API key, the suite still verifies the contract and missing-key
errors, but live generation checks will not run.

## Install In A Scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start or resume an adventure on that scenario.
5. Take a few turns. The suite queues `ai.status`, one text `ai.query`, one
   schema-backed JSON `ai.query` with `thinking: "low"`, one schema-less JSON
   guard check, reads the responses, and writes a trace card.

## Reading Results

Two surfaces are written to the adventure's story cards:

- `ultrascripts:out` - the script's request queue.
- `ultrascripts:test:ai` - the trace card.

A successful run ends with:

- `phase: "complete"`
- `checksPass: true`
- `heartbeat.aiOps: ["status", "query"]`
- `status.data.backend: "gemini"`
- `status.data.executor.version: "0.3.0-gemini-thinking"`
- `status.data.contract.defaultThinking: "minimal"`
- `status.data.config.keyConfigured: true` for live generation
- `textQuery.response.status: "ok"` when configured
- `jsonQuery.response.status: "ok"` when configured
- `jsonNoSchemaQuery.response.error.code: "invalid_args"`

If no key is configured, the text and schema-backed JSON checks pass when they
return `not_configured` from the Gemini backend instead.
