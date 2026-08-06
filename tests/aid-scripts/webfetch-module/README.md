# Ultrascripts WebFetch Module — AI Dungeon Test Suite

End-to-end scripts that exercise `modules/webfetch/module.js` through the live
Ultrascripts Story Card protocol. Use this suite whenever the WebFetch module,
transport policy, rate limiter, or shared Ultrascripts plumbing changes.

## Coverage

The suite runs one request per turn:

| Step | Expected result |
| --- | --- |
| Public JSON `GET` | Text response with status and byte metadata |
| Public `HEAD` | Headers with an empty body |
| Sanitized custom header | Successful text response |
| Public redirect | One validated redirect |
| HTTP URL | `scheme_blocked` |
| Localhost/private IP | `host_blocked` |
| Missing URL, POST, or body | `invalid_args` |
| Binary response | `content_type_blocked` |
| Removed `search` op | `unknown_op` |
| Unknown operation/module | `unknown_op` / `unknown_module` |

No origin prompt should appear. Enabling the WebFetch module is the player’s
single control for allowing bounded public HTTPS reads.

## Setup

1. Load BetterDungeon and open AI Dungeon.
2. Enable Ultrascripts and the WebFetch module.
3. Paste `library.js` into the scenario Library script.
4. Paste `output-modifier.js` into the Output Modifier.
5. Start or resume an adventure and take one turn per test step.

The public request steps use `httpbin.org` and require an internet connection.

## Results

Inspect the `ultrascripts:test:webfetch` Story Card. A successful run ends with
`phase: "complete"` and `checksPass: true`. Each result records the request id,
terminal status, validation result, error, and a small response preview.

Reset with any of:

- `webfetch test reset`
- `ultrascripts webfetch reset`
- `[[webfetch-test:reset]]`
