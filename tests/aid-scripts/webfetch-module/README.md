# Frontier WebFetch Module — AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Frontier WebFetch module
(`modules/webfetch/module.js`) over the live Frontier protocol from inside an
AI Dungeon scenario. Use this any time you change the WebFetch module, consent
broker, rate limiter, or any Frontier plumbing.

## What it covers

The suite runs a fixed plan of requests, one per turn, in order:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `fetch-json` | `webfetch` | `fetch` | ok (status, body, url) or consent\_denied |
| `fetch-head` | `webfetch` | `fetch` | ok (status, headers) or consent\_denied |
| `fetch-with-headers` | `webfetch` | `fetch` | ok (status, body) or consent\_denied |
| `search` | `webfetch` | `search` | ok (results array) or consent\_denied |
| `err-blocked-localhost` | `webfetch` | `fetch` | err scheme\_blocked or invalid\_args |
| `err-blocked-private-ip` | `webfetch` | `fetch` | err scheme\_blocked or invalid\_args |
| `err-no-url` | `webfetch` | `fetch` | err `invalid_args` |
| `err-bad-method` | `webfetch` | `fetch` | err `invalid_args` (POST not allowed) |
| `err-no-query` | `webfetch` | `search` | err `invalid_args` |
| `err-unknown-op` | `webfetch` | `thisOpDoesNotExist` | err `unknown_op` |
| `err-unknown-module` | `definitelyNotAModule` | `fetch` | err `unknown_module` |

### Consent-dependent steps

The `fetch-json`, `fetch-head`, `fetch-with-headers`, and `search` steps use
an `ok-or-consent` expectation. If consent is granted for the origin, the
suite validates the response shape. If consent is denied, the suite accepts
`consent_denied` as a passing result. Either way, the step passes as long as
the response is well-formed.

### Security validation

The `err-blocked-localhost` and `err-blocked-private-ip` steps verify that the
module's SSRF protection works — requests to `localhost` and private IP ranges
should be rejected before any network call is made.

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon → **Frontier** and enable Frontier and the **WebFetch**
   module.
3. When consent prompts appear, approve them to exercise the full fetch path
   (or deny them to test the consent-denied path).

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start (or resume) an adventure on that scenario.
5. Take several turns. Each generation advances one step.

## Reading results

Open the `frontier:test:webfetch` story card after several turns to see:

- `phase` — current driver state.
- `counts` — pass/fail/pending tally.
- `results[label]` — per-step outcome with `pass`, `reason`, `status`,
  `error`, and preview data (httpStatus, url, bodyLength, resultCount).
- `events` — rolling log of queue/ack/completion events.
- `checksPass: true` once everything has passed.

A successful run ends with `phase: "complete"` and `checksPass: true`.

> **Note:** Steps that hit real URLs (httpbin.org, DuckDuckGo) require an
> internet connection and may time out on slow networks. The consent broker
> may also pause the test while waiting for user input.

## Reset

To re-run from scratch without editing anything, type any of these phrases:

- `webfetch test reset`
- `frontier webfetch reset`
- `[[webfetch-test:reset]]`
