---
name: testing-apollo-bridge
description: How to load the BetterDungeon desktop extension in Chrome and exercise the Apollo cache bridge / BetterDungeonApolloCache service against the live AI Dungeon page.
---

# Live-testing BetterDungeon against play.aidungeon.com

## Devin Secrets Needed
- `AIDUNGEON_EMAIL`, `AIDUNGEON_PASSWORD` — only if the browser profile is not already signed in. The prepared box normally has Chrome already logged in; do not re-authenticate unnecessarily.

## Loading the branch build
1. `chrome://extensions` → Developer mode on.
2. Check every loaded copy's **Details → Source → Loaded from** path first. Boxes often ship a stale checkout (e.g. `~\nav-test`, which also contains debug-only files such as `services/navigator/_debug_bridge.js`). Toggle any other copy **Off** before loading the repo checkout, otherwise two isolated worlds inject and results are ambiguous.
3. `Load unpacked` → repo root (the native folder dialog accepts a typed absolute path).
4. Hard-reload the AI Dungeon tab (Ctrl+Shift+R) so `document_start` MAIN-world scripts run.
5. A pre-existing warning under **Errors** — `'background.scripts' requires manifest version of 2 or lower` — is expected (Firefox compat key), not a regression.
6. **Always click the card's Reload (↻) button after checking out/merging branches, even after a full Chrome restart.** Chrome may keep running the previously compiled `importScripts('background-ai-openai-compatible.js')` body for an unpacked extension whose version string did not change, so the worker executes *old* code while `fetch(chrome.runtime.getURL(file))` from the worker returns the *new* file — the two disagree and you will chase phantom regressions (for example, capability limits without the new `resolution`/`resolved` fields).
7. Fast staleness probe from the isolated world: `chrome.runtime.sendMessage({type:'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE', request:{op:'status'}}, r=>console.log(Object.keys(r.data.limits)))`. If a field you know the branch adds is absent from the raw background response, the worker is stale — reload the extension and hard-reload the tab before recording anything.

## Reaching each JS world from DevTools
- MAIN/page world = console context **`top`**: `window.__BD_APOLLO_BRIDGE__` (bridge), and you can post
  `{source:'BD_APOLLO_REQ', id, op, payload}` and listen for `BD_APOLLO_RES`.
- Isolated content-script world = a **`BetterDungeon / Extension`** entry in the console context dropdown: `window.BetterDungeonApolloCache`.
- Gotcha: after reloads/SPA navigations the dropdown often lists **two** `BetterDungeon` entries; one is a dead world where any global is `undefined` / `chrome.runtime` missing. Probe with `typeof BetterDungeonApolloCache` before trusting a `ReferenceError` — the index of the live one changes between page loads, so re-probe each time rather than assuming.
- The lead's `browser_console` tool evaluates in the page/MAIN world only; use it for bridge-level checks, not for `BetterDungeonApolloCache`.

## Useful probes
```js
// isolated world
await BetterDungeonApolloCache.status();                                  // {available, data:{recordCount}}
await BetterDungeonApolloCache.readAdventure({shortId:'<shortId>'});      // adventure/state/storyCards/actions
await BetterDungeonApolloCache.modifyEntity({typename:'Adventure', id:'<numericId>', fields:{title:'X'}});
```
- Cache-only writes (`modifyEntity`) re-render the live UI (adventure header) and issue no network request — verify with
  `performance.getEntriesByType('resource').filter(e=>/graphql/i.test(e.name))` before/after instead of eyeballing the Network panel, and always revert the field immediately.
- Cold-start timing: console history survives reloads, so pre-run a polling probe once, then `Ctrl+Shift+R` and press Up+Enter to re-run it within ~1 s of navigation. Right after a reload the context is already `top`, which is the fastest way to sample the earliest window.
- Expect the earliest post-reload reads to fail with `not_found` (client discovered, cache not yet hydrated) and to succeed within ~2 s.
- The Apollo client is app-wide: non-adventure routes (`/`, `/saves`) still report `available:true`. To get a genuinely client-less in-scope document use `https://play.aidungeon.com/robots.txt` (content scripts inject, no `#__next`).
- Pre-existing console noise on this site: repeated `latitude-standard-pull-zone-1.b-cdn.net net::ERR_NAME_NOT_RESOLVED`, `useNativeDriver` and `smooth scroll` warnings. Filter them out with `-latitude -smooth -useNativeDriver` in the console filter.

## Navigator: capturing the real context snapshot
The Navigator context snapshot (`services/navigator/context.js`) is the evidence for anything about
Navigator context/budgeting — capture the returned object, not UI screenshots.

- The live feature instance is NOT on `window`; `main.js` keeps it in a top-level `let`, which is still
  reachable by name from the isolated-world console:
  ```js
  const S = betterDungeonInstance.featureManager.getFeature('navigator').session; // NavigatorSession
  ```
  (`window.NavigatorContext` / `NavigatorFeature` are only the classes.)
- Reproduce the budget a real turn uses instead of the builder default, mirroring `session.js`:
  ```js
  const st  = await UltrascriptsAIExecutor.refreshStatus({consumer:'navigator'});
  const B   = Math.max(8000, st.limits.maxInputChars - JSON.stringify(S.getToolDefinitions()).length - 16000 - 16000);
  const r   = await S.buildTurnContext(null, B);   // same path send() takes
  const snap = r.snapshot;   // systemInstruction, segments, summary, partial, warnings
  ```
With no provider configured Navigator's first-party default ledger is `384000` characters (`128000` tokens at
`CHARS_PER_TOKEN: 3`).
- `buildTurnContext` mutates the session's cached context, so after deliberately building at a hostile small
  budget, rebuild at the real budget to leave the session in a sane state (the header no longer displays
  coverage, so this is not visible in the UI — check the returned snapshot).
- The `COVERAGE` block sits **before** the data sections, so splitting on `'COVERAGE\n'` grabs the wrong text
  (the primer/plot text mentions it). Locate it by line index:
  `const L = t.split('\n'); const i = L.findIndex(l => l.trim() === 'COVERAGE');`
  Section order is: primer → untrusted-data line → COVERAGE → IDENTITY → PLOT COMPONENTS → RECENT STORY ACTIONS →
  MEMORY BANK → STORY CARD DIRECTORY → `=== END CURRENT ADVENTURE SNAPSHOT ===`. `buildTurnContext` appends
  BetterDungeon's own TOOL/MUTATION guidance *after* the closing marker — compare `r.snapshot.systemInstruction`
  (data) vs `r.instruction` (full prompt) when checking untrusted-data framing.
- Hostile-budget probing is cheap and finds real bugs: build at the session floor (`8000`–`9000`), where the
  primer alone (~8,300 chars) exceeds the allowance. Expect a `SNAPSHOT DEGRADED:` notice plus coverage naming
  the dropped sections; a build whose data sections vanish while COVERAGE still says `Snapshot warnings: none.`
  is a bug — always check `snapshot.warnings` against the coverage *text*, not just one of them.
- Memory Bank rows must contain only the memory `text`. Assert no entity metadata leaks and quantify any
  regression with `sec.match(/"__typename":"Memory","actionIds":\[[^\]]*\],/g)`.
- Cross-check every COVERAGE claim against `snapshot.segments` numerically (included/omitted/total per section);
  a coverage line and the matching `segments.*.truncatedReason` disagreeing is a bug, not a display quirk.
- Any check that needs an actual Navigator answer requires an LLM key: `UltrascriptsAIExecutor.refreshStatus`
  returns `ready:false, reason:"ai_backend_not_configured"` on a clean profile, and the drawer replies
  "Configure the gemini profile to enable AI queries". A Gemini / OpenRouter / custom OpenAI-compatible key must
  be entered in the popup (Ultrascripts > AI) first — there is no offline substitute.
- Navigator UI path on a live adventure: Saves → `Continue` on the target card (direct `/adventure/<shortId>`
  URLs redirect to Home) → orange compass launcher on the right edge → composer `Ask Navigator...`. Clicking the
  composer once before typing is required; typing without focusing it silently drops the text.

## Navigator: testing a real, model-backed turn
- Configure the provider through the popup only (Ultrascripts > AI): paste the key into the API key field and press
  **Save & test** (validation/persistence requires it). Leave model selection at the default; no other setting is
  needed to get a turn to run. Never echo/log/screenshot the key or put it in a console command.
- The current AI model input setting defaults to `128000` tokens (`AI_INPUT_CAP_DEFAULT` in
  `popup-ai-endpoint.js`). Navigator's shared `CHARS_PER_TOKEN` value is `3`, so its default input ledger cap is
  `384000` characters; `MAX_OUTPUT_TOKENS` remains `2048`. Provider status may report a different available input
  limit for a turn, so always read the request inspector's captured budget and payload rather than inferring it from
  a pre-turn status poll.
- Capture what was actually sent with a read-only pass-through wrapper around `UltrascriptsAIExecutor.chat`
  recording, per round, `systemInstruction.length`, `JSON.stringify(tools).length`,
  `JSON.stringify(toolResults).length`, message chars and `options.limits`, then calling through unchanged. Also read
  the final assistant message's `meta` (`budget`, `inputChars`, `systemInstructionChars`, `toolRounds`,
  `toolResultChars`, `toolResultsOmitted`, `toolsUsed`, `readToolsCompleted`, `inputLimitReached`).
- To force a read-tool round, ask for something only a tool can answer (e.g. "use your read tools to look up the
  story cards and give the exact title and type"). Expect `[Navigator] Read tool executed: get_story_card` in the
  console, a "Read Story Card" chip in the drawer, and a second recorded round carrying the tool-result chars.
- Score grounding programmatically, not by eye: normalize whitespace and locate the model's quoted fragments in the
  live `instructions` / `storySummary` / `state.memories[*].text`, and report the match offsets (a match past the old
  1600/2100 cutoffs is the actual evidence). Expect paraphrase, so search for short distinctive fragments. Also
  verify any suspicious concrete detail (e.g. a timestamp) really exists in `snapshot.systemInstruction` before
  crediting the answer — models will mix story history into "Memory Bank" claims and invent specifics.
- A much larger discovered budget may not increase delivered content: per-section ceilings can bind, so the
  snapshot can stay ~54k chars at a ~554k budget with memories/actions still omitted. Compare
  `segments.total.budgetChars` with the snapshot length before claiming the bigger ceiling helped. With scaled
  ceilings expect ~252k chars / 48-of-48 memories / all available actions at a ~554k budget.
- The context object from `await session.buildTurnContext(null, maxChars)` is `{instruction, snapshot}`; the
  model-facing text is `snapshot.systemInstruction` (`instruction` appends ~1.2k chars of tool guidance *after* the
  closing marker, so assert the marker on `snapshot.systemInstruction`, not on `instruction`).
- Hostile budgets take two different code paths in `services/navigator/context.js`: a degraded path (~9000) that keeps
  primer + `SNAPSHOT DEGRADED:` + COVERAGE + IDENTITY + history + marker, and a primer-clipped path when
  `primer.length > maxChars` (~8000) that emits *only* the clipped primer — no IDENTITY and **no closing marker**.
  Check both, and cross-check `segments.*.included` against rendered rows: `droppedMeta()` zeroes `includedChars`
  but not `included`, so dropped sections may still advertise a nonzero `included` count.

## Navigator: Memory Bank and Story Card write paths
- After any verified Navigator memory write, `readMemories` deliberately **bypasses Apollo** and reports
  `provenance.source:"graphql"` with fallback `"Apollo Memory Bank state bypassed after verified Navigator memory write."`
  The marker is per-adventure and cleared only by a page reload, so a fresh load reads `source:"apollo"`,
  `fallback:null` again. Reading `source:"apollo"` right after a write is a regression; reading it after a reload is not.
- `getNavigatorRecentMemories(shortId)` is the authoritative post-write read. It returns a **bare array** on this
  build, so assert defensively against both an array and a `{memories:[]}` shape.
- Memory tool results are wrapped under `data`, and read-only mode can be forced from the adventure drawer, which is
  the quickest way to prove the proposal tools are suppressed rather than merely unused.
- `readAdventure` takes an options object: `readAdventure({shortId:'<shortId>'})`. Passing the bare string silently
  reads nothing.
- Full `/adventure/<shortId>/<slug>/play` URLs do load an adventure directly; only bare `/adventure/<shortId>` URLs
  redirect to Home. Saves search does not match throwaway adventures titled "custom", so navigate by URL for those.
- Story Card ids are **client-supplied and echoed back by the server**, never reassigned, and the same id is accepted
  in two different adventures (per-adventure server namespace). Apollo keys cards `StoryCard:<id>` with no adventure
  qualifier, so one slot serves both — never assume a cached card belongs to the adventure you are looking at.

## Navigator: the last-request inspector (drawer braces button)
- The drawer header has no subtitle any more; it is compass + `Navigator` + optional `Read-only` badge + four icon
  buttons (`.bd-navigator-inspection` braces, `.bd-navigator-settings`, `.bd-navigator-clear`, `.bd-navigator-close`).
- Ground truth for "was this really what we sent?" is a pass-through wrapper around `UltrascriptsAIExecutor.chat`
  (isolated world) recording `systemInstruction` and `JSON.stringify` of `messages`/`tools`/`toolResults`/`budget` per
  round. Compare the panel `<pre>` text (`h4` headings index the `<pre>` siblings) against that array, and align the
  arrays with `offset = wire.length - inspection.rounds.length` so earlier turns in the same page session do not skew it.
- Panel state is memory-only. `chrome.storage.local` should only ever contain `systemInstructionChars` (a number);
  finding `rounds` or instruction text there is a regression.
- Panel gotchas worth re-checking each run:
  - The `pre` elements compute to `display:inline` on this site, so the `max-height:220px; overflow:auto` per-block
    rule does not apply and a 258k-char system instruction renders ~61,000 px tall inside the panel.
  - Because of that, mouse scrolling to `Tool results` is impractical. Use Chrome find-in-page (Ctrl+F, e.g.
    `Tool results`, `callId`, `Captured 2026`) — it scrolls the panel container to the match and is a legitimate UI
    action for the recording.
  - `Clear` nulls the retained record but does not re-render an already-open panel; toggle the braces button to refresh.
  - Opening the inspector hides settings, but opening settings does not hide the inspector, so both can stack and push
    the composer out of a short drawer.
- Forcing an aborted turn: send a multi-tool prompt and click the composer Stop button within ~5 s. Waiting ~8 s is
  usually too late (the turn completes). An oversize paste (>8,000 chars, use `Set-Clipboard` from PowerShell then
  Ctrl+V) is the cheap way to get the "no executor round was captured" + `Error:` state.

## Navigator: post-write hydration (plot editor fill + Memory Bank inline state)
- Hydration diagnostics live on the proposal objects in the isolated world:
  `betterDungeonInstance.featureManager.getFeature('navigator').session` → messages → `proposals[*].hydration`
  (`{attempted, ok, entity, reason?, refetch:{...}, editor:{...}}`). Stash them into
  `document.documentElement.dataset.<key>` from a DevTools `setInterval` so the MAIN-world console tool can read them.
  **That interval dies on every page reload** — re-arm it from DevTools after any `Ctrl+Shift+R`, or you will apply a
  proposal and find no diagnostic afterwards.
- UI-level substitute for `hydration.editor.ok`: the applied `plot_component` card renders
  `The change is saved and verified on the server. The open editor will show it after a page reload.` **only** when
  `editor.ok !== true`. Counting `.bd-navigator-proposal-note` nodes before/after an apply is a reliable check that
  needs no isolated-world access.
- Distinguishing Navigator's own server write from AI Dungeon's page-originated save: wrap **MAIN-world**
  `window.fetch` and log `operationName` for `/graphql` calls. Navigator's writes do not go through the page's fetch,
  so anything you see there is page-originated. Watch for `UpdateAdventurePlot` plus a `SendEvent` with
  `eventName:"adventure_plot_saved"` — as of the hydration-labels branch, the editor fill's `input`/`change` events
  do trigger AI Dungeon's own debounced plot save (~1-2 s after apply), while a closed-editor apply emits neither.
  Re-check this on any change to `fillEditorTextarea`; it may still be an open defect.
- The two editor-skip guards are not equally reachable. The value-mismatch guard
  (`Plot editor holds different or unsaved text; editor hydration was skipped`) is easy to produce: apply a change with
  the plot panel closed (the reopened panel keeps the stale value, since AI Dungeon does not refetch plot fields), then
  apply a second proposal whose `before` is the new server value. The `document.activeElement` guard is hard to reach
  because clicking Apply blurs the textarea first.
- AI Dungeon's plot panel scrolls in a container that swallows wheel events over textareas. Click a non-input row
  (e.g. the `Scenario Default / AI Instructions` header) and use `Page_Down`/`Page_Up` to bring Plot Essentials or
  Author's Note into view. Author's Note (~92 chars) is fully visible without internal scrolling, so it is the best
  target for before/after screenshots.
- AI Dungeon exposes **no** Memory Bank editor in the live Adventure UI (only Plot / Story Cards / Details). Verify
  memory hydration through the Apollo bridge (`readAdventure`) plus Navigator's own Memory Bank read, and say in the
  report that the native view does not exist.
- Byte-for-byte restore proof: SHA-256 the current textarea/memory text in the page with `crypto.subtle.digest` and
  compare to a hash of the pre-captured original computed in Node from the saved originals JSON. Note that
  `crypto.subtle` is async, so stash the result in a `dataset` key and read it back in a second console call — the
  console tool returns `{}` for a pending promise.
- A bridge `readAdventure` can transiently return a `state` key list without `storyCards`; a later read after a hard
  reload showed all 12 keys, so treat a single missing-key observation as read/selection variance, not a hydration
  regression, and re-read before reporting.

## Window sizing on this VM (needed for GUI recordings)
- Screen is 1280x720 with a 1280x680 working area, but Chrome often starts at 1300x740, which pushes the Navigator
  composer below the visible screen. Resize with a small PowerShell script calling `user32!MoveWindow` on the Chrome
  main window (the `exec` tool strips `$`, so put PowerShell in a `.ps1` file and run it with `-File`).
- Computer-tool coordinates are the 1024-wide scaled space: multiply DOM `getBoundingClientRect()` values by
  1024/1280 = 0.8 and add ~112 real px of browser chrome above the viewport before clicking.
- Chrome cannot be sized narrower than ~500 px here, so a `max-width: 480px` media query cannot be reached by
  resizing the window. Use browser zoom instead (150 % on a 500 px-wide window gives a 400 px layout viewport) and
  say so in the report — it is the same computed condition by a different route.
- The Navigator drawer stays in sheet mode (`bd-navigator-sheet`) at every window size this VM allows and
  `.bd-navigator-resize` is `display:none`, so drawer width can only be varied through the viewport, never by
  dragging the handle.
- The AI input cap lives in the popup at Ultrascripts > AI card > `#ai-endpoint-max-input-tokens` and requires an
  explicit Save; lowering it is the cheapest way to make budget/allocator behaviour observable on a real turn.
- Screenshot coordinates are a non-uniform scaling of the real screen. Calibrate by attaching a `mousemove` listener
  that records `clientX/clientY`, moving the mouse to a known screenshot point, and reading the captured values.
- The DevTools console context resets to `top` every time DevTools is reopened — reselect `BetterDungeon / Extension`
  before each isolated-world command. To get isolated-world results out without reading them from a screenshot, stash
  them in `document.documentElement.dataset.<key>` and read that from the MAIN-world console tool.

## Safety rules for live-account testing
Never use the adventure editor/save UI, never type into adventure fields, never create/delete/undo actions or cards. Cache-only mutations plus an immediate revert leave the server untouched — confirm by hard-reloading and seeing the original value refetched.
