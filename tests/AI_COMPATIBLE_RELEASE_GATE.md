# OpenAI-Compatible V2.1 Release Gate

The compatibility layer remains a release-risk boundary. Run these checks with
temporary credentials and remove them afterward. Do not release V2.1 if Gemini
tool continuation loses opaque thought signatures or behaves worse than the
previous direct backend.

## Automated

```powershell
node tests/ai-compatible-contract.test.js
```

The fixture covers the clean storage break, all three profile rules, one
registered executor provider, text/JSON payloads, Gemini reasoning and 429-only
stepdown, generic JSON mode, streaming, timeout, cancellation, authentication,
safety, malformed responses, parallel tools, sequential tools, exact thought
signature replay, and cross-service continuation rejection.

## Chrome and Firefox

- Configure Gemini automatic mode and run Ultrascripts text and schema-backed
  JSON queries at minimal and high thinking.
- Run Character Prefill.
- Run Navigator streaming and cancellation.
- Exercise read tools, parallel calls, and at least two sequential tool rounds.
- Approve one mutation proposal in a disposable adventure and verify read-back.
- Confirm only HTTP 429 steps Gemini down the automatic model chain.
- Confirm manual Gemini, OpenRouter, and Custom never switch models or services.
- Confirm **Save & test** persists and activates the selected service before the
  test request.

## Android

Run the Mobile repository's `docs/V2.1_STAGE2_DEVICE_TESTS.md`, followed by its
Navigator and mutation device gates.

## Ship decision

Release only if the compatible Gemini path matches the prior behavior. If a
live Gemini 3 sequential tool call reports a missing thought signature, or if
signature-bearing assistant messages cannot be replayed intact, stop the V2.1
release and restore the direct backend for that release rather than shipping a
degraded agent loop.
