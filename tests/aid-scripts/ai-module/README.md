# Ultrascripts AI Module - AI Dungeon Test Suite

End-to-end contract test scripts for the BetterDungeon Ultrascripts AI module.
The current default backend is Gemini, but the suite is centered on the public
`status` and `query` contract.

## What It Covers

The suite verifies:

- `ultrascripts:heartbeat` advertises module `ai`.
- `ai` advertises exactly the Phase 1 public ops: `status` and `query`.
- Legacy ops are not advertised: `chat`, `models`, and `testConnection`.
- The legacy provider alias is not advertised as a heartbeat module.
- `ai.status` reports query readiness, configured model selection, and key
  configuration state.
- Plain text `ai.query` returns text when the backend is configured, or
  `not_configured` when no key is saved.
- Schema-backed JSON `ai.query` returns parsed JSON when the backend is configured,
  or `not_configured` when no key is saved.
- `ai.query` accepts a `thinking` level and defaults to `minimal`.
- Successful query responses expose diagnostics under `data.meta`, including
  backend, model, output type, prompt size, generated timestamp, and thinking
  metadata.
- Schema-less JSON `ai.query` returns terminal `invalid_args`.
- Invalid thinking levels return terminal `invalid_args`.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon -> **Ultrascripts** and enable Ultrascripts and the
   **AI** module.
3. For live generation checks, add an API key in the AI module card.
4. Open or resume an adventure, then take one normal turn so BetterDungeon can
   write the heartbeat.

Without an API key, the suite still verifies the contract and missing-key
errors, but live generation checks will not run.

## Install In A Scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start or resume an adventure on that scenario.
5. Take a few turns. The suite queues `ai.status`, one text `ai.query`, one
   schema-backed JSON `ai.query` with `thinking: "low"`, one schema-less JSON
   guard check, one invalid-thinking guard check, reads the responses, and
   writes a trace card.

## Reading Results

Two surfaces are written to the adventure's story cards:

- `ultrascripts:out` - the script's request queue.
- `ultrascripts:test:ai` - the trace card.

A successful run ends with:

- `phase: "complete"`
- `checksPass: true`
- `heartbeat.aiOps: ["status", "query"]`
- `status.data.backend: "gemini"`
- `status.data.executor.version: "0.4.0-gemini-meta"`
- `status.data.contract.defaultThinking: "minimal"`
- `status.data.config.keyConfigured: true` for live generation
- `textQuery.response.status: "ok"` when configured
- `textQuery.response.data.meta.thinking.requestedLevel: "minimal"` when configured
- `jsonQuery.response.status: "ok"` when configured
- `jsonQuery.response.data.meta.thinking.requestedLevel: "low"` when configured
- `jsonNoSchemaQuery.response.error.code: "invalid_args"`
- `invalidThinkingQuery.response.error.code: "invalid_args"`

If no key is configured, the text and schema-backed JSON checks pass when they
return `not_configured` instead.
