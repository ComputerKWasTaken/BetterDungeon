# AI setup and routing

Open the popup's **AI** tab. For Simple setup, paste a personal Gemini API key and choose **Save & connect**. BetterDungeon selects models automatically. Keys stay in local storage; provider use follows the account's quotas and billing. The Ultrascripts AI switch controls script permission only; Navigator and Character Prefill use the shared service independently.

## Advanced providers

Enable Advanced, select OpenRouter, Mistral, or Custom, and select which features use it. Advanced works without a Gemini key. OpenRouter and Custom use the supplied model ID; Custom requires an HTTPS base URL. An input cap of 0 uses the default. Saving configuration makes no provider calls; connection tests send a small test request to the selected provider.

Mistral's default Automatic option tries `mistral-large-2512`, `ministral-14b-2512`, `ministral-8b-2512`, then `ministral-3b-2512`. Selecting a model pins it; Custom Mistral model ID accepts another model available to the account. Discovery uses the model-list endpoint with the ordinary API key, never an admin key. Automatic models have 256k context windows. Their supplied account limits inform the chosen order, but are not guaranteed quotas for every user.

Model-specific rate limits and missing/retired models advance the automatic chain. Rate-limited models wait until Retry-After, or 60 seconds without it, increasing to 15 minutes for repeated headerless limits. Small cooldown records and the single latest completion persist across worker restarts; there is no usage-history log. Credential changes clear those records. Organization-wide limits stop the Mistral chain.

If Advanced is unavailable and a Gemini key is configured, the request is retried with Gemini. This sends the same request content to Google as well as the original provider. Cancellation, invalid input, context-window errors, and policy blocks stop execution. A partly delivered stream also stops without mixing in a second response. The popup displays the last completed provider; result metadata includes the exact model and fallback route.

## Internal routing and compatibility

`services/ai/config.js` owns configuration and the model catalog. `services/ai/runtime.js` owns request routing, Gemini native REST, OpenAI-compatible payloads, streaming, error normalization, and continuations. Browser and Android hosts install this same runtime with browser fetch or cancellable native HTTPS respectively. No provider SDK dependency is required.

Simple defaults to separate feature pools: Navigator and Ultrascripts use Gemini 3.5 Flash-Lite then 3.1 Flash-Lite; Character Prefill and future Ambience use Gemma 4 31B then 26B A4B. There is no capacity selector in the popup. The internal `quotaStrategy: shared` compatibility setting permits cross-pool fallback; saving through the popup selects the automatic separated policy. Navigator requests above an estimated 12,000 tokens including reserved output never fall back to Gemma. Token estimates include prompts, tools, and continuation state and are approximate; a provider context rejection remains terminal.

The public `BetterDungeonAI` executor retains the `UltrascriptsAIExecutor` alias temporarily. The Ultrascripts query API still accepts at most 12,000 prompt characters. Each adventure's script environment permits one request at a time; an overlapping request receives `busy`. Fallbacks share a 115-second deadline, within the script operation's 120-second timeout.

The local-only `betterdungeon_ai_config_v2` key stores Simple and Advanced profiles plus per-consumer routing. The old endpoint key migrates once. Saved Gemini, OpenRouter, and Custom keys are preserved. Existing Advanced users stay on Advanced; existing Gemini users receive Simple routing. Old manual Gemini model preferences become automatic routing. Migration verifies the new write before deleting the old key. Saved keys are omitted from status responses; an omitted key on save means preserve, while an explicit empty key means clear.

Ambience's consumer is reserved, but Ambience playback and scene awareness are not implemented here.

## Verification before stable

Run `./build.ps1 all` with Node 24. Offline tests cover migration, routing, rate-limit suppression, pinned models, cancellation, secret redaction, streaming continuations, and script concurrency. CI makes no live provider requests.

On browser and Android, verify Simple connection setup, every available Mistral pinned model and Automatic, OpenRouter/Custom, per-feature assignments, Navigator streaming/tool results, Character Prefill JSON, and Ultrascripts permissions. Verify saved-key preservation and explicit clearing. Live provider success and model quality require real account access and manual testing; build success does not establish them.
