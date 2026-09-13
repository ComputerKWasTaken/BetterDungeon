# Navigator Routines

Open **Game Menu → Gameplay → Navigator → Routines**. A Routine is a name,
instructions, and a setting for how often it runs (1–100 actions). Enabling it schedules
it after that many completed actions in every adventure on this device. You can also ask Navigator in main Chat
to run any saved Routine by name, even when its automatic trigger is off. For
example, “Run NPC Brains now and focus on the innkeeper.” Navigator queues the
run after its current chat reply; review its eventual result in **Activity**.
There is no additional master switch or daily allowance. Provider quotas and
any billing still apply; frequent scheduled Routines can consume substantial
usage.

Six editable examples start disabled. The first four show how Routines can
replace common script workflows; the last two are Navigator-native ideas:

| Routine | Interval | Responsibility |
| --- | ---: | --- |
| **NPC Brains** | 5 actions | Dedicated, compact brain cards for significant recurring NPCs, separating observed experiences from inferred inner life. |
| **Automatic Story Cards** | 5 actions | Durable characters, places, objects, and lore that emerge through play; not brain cards. |
| **Story Arcs** | 10 actions | A flexible, forward-looking outline of roughly 3–5 beats in Plot Essentials; not a recap. |
| **State Management** | 5 actions | A compact Adventure State section in Plot Essentials, updated only from established changes and player-defined rules. |
| **Scene Compass** | 10 actions | A short, current-scene pacing or tone cue in Author’s Note, without dictating events. |
| **Continuity Watch** | 10 actions | Small corrections to clear, evidenced contradictions in existing lore; reports uncertain issues instead of inventing fixes. |

Each example asks Navigator to review current context, compare existing content,
then change or skip. It reads matching cards before editing, avoids duplicates,
and preserves unrelated material. State Management treats player-edited values
as authoritative until a clear story event changes them; it does not invent
numeric mechanics. These are prompts, not specialized script engines, and
results depend on the story and chosen AI model. The pre-release template
upgrade replaces only untouched, disabled old examples; customized or enabled
rules remain as they were.

Navigator can make persistent changes outside story generation, use provider
thinking, and reach controls scripts may not have. The tradeoffs are provider
usage, asynchronous updates that may lag behind play, imperfect model judgment,
and story-context cost: Plot Essentials is persistent context, while a brain
card's Entry uses context when triggered. Routines are not deterministic state
engines. Navigator can edit existing Memory Bank entries but cannot create one.

Navigator knows how Routines work. Ask it to draft a reusable workflow and it
can propose a new Routine. The proposal always requires
your approval and creates a disabled rule. Review its instruction and enable it
yourself when ready. Navigator will not silently add a rule that runs across
adventures.

## When a Routine runs

Intervals use absolute adventure action-count milestones. Every 5 actions
means milestones 5, 10, 15, and so on. AI Dungeon can add both a player action
and an AI response in one generation, so five actions does not necessarily mean
five clicks of Send. Continue and Retry can also advance the count. A completed
generation that crosses a milestone runs the Routine once, even if the exact
count was skipped.

Opening an adventure or enabling a scheduled Routine establishes a baseline; neither
starts a run immediately. Edits, undo, restored history, and page reloads do not
trigger runs. There is no catch-up for closed pages. Work continues when
Navigator or Settings is closed, and while an open browser tab is hidden.
Closing the adventure or the app ends its live work; a suspended mobile app
cannot guarantee background execution.

Navigator runs one operation at a time in an adventure. A due Routine waits if
Navigator is busy, retaining only its latest milestone. A waiting manual message
gets the next slot before queued Routines. **Stop** cancels the current work;
changes already applied remain applied. Switching a Routine off removes its
waiting runs and prevents new triggers, but lets its current run finish.

## Review and guidance

The gameplay status chip shows current work and provides Stop. A brief notice
links to applied changes, required approvals, or errors. **Activity** lists
Routine runs for the current adventure. Open one to review its transcript and
change cards, then reply to guide that Routine with fresh adventure context.
Each Routine has a separate conversation in each adventure; normal Chat remains
separate. Player-requested runs appear in the same Activity view and use that
Routine’s conversation. Asking for a run does not enable its automatic trigger.

Routines inherit the adventure's Navigator provider, thinking setting, and
**Automatic**, **Proposed changes**, or **No changes** mode. Permanent deletions
always require approval. Pending approvals expire when the page reloads; their
records remain visible and you can ask Navigator for a fresh proposal. A failed
run is recorded and waits for the next milestone, rather than silently retrying.

Activity retains the latest 100 runs per adventure. Each Routine conversation
retains up to 40 messages and approximately 48,000 characters of persisted
history; older context is trimmed. These histories are convenience records,
not permanent archives. Deleting a Routine removes its global rule and retains
its past activity.

## Moving Routines between devices

Use **Export** to save a JSON file, then **Import** on another installation.
Android uses the system document picker. Imports add new, disabled copies and
leave existing rules intact. Files contain rule names, triggers, and instructions, with no
provider keys, adventure transcripts, or activity. Review imported instructions
before enabling them. Rule libraries support up to 100 Routines and 1 MB;
invalid imports leave the current library untouched. Older manual-only rules
import as disabled every-5-actions Routines, preserving their instructions;
they can still be run on request from Chat.

## Implementation and verification

When updating an unpacked browser extension, reload **BetterDungeon** from the
browser's extensions page before refreshing AI Dungeon. A page refresh alone
does not reload changes to the extension manifest. The feature entry point
loads the shared platform contract itself as well as at document start; if
storage initialization fails, Routines shows an actionable error instead of
preventing Navigator from opening.

`NavigatorRoutines` owns the global local-storage library, action baselines,
pending work, and a durable per-adventure milestone ledger. Browser tabs share
an origin-scoped Web Lock while doing Navigator work. The fired milestone and
run record are saved before the provider request. Browser Routines pause if
Web Locks are unavailable; manual chat remains available. Android can use its
single main WebView's local queue.

`NavigatorSession(adventureId, { routineId })` isolates Routine storage while
preserving the existing manual-chat key. `send(text, metadata)` records run
provenance without changing the public shared AI consumer (`navigator`).
The view selects sessions and queues work; hiding it does not own cancellation.

The small offline suite checks milestones, duplicates, queue priority,
configuration transfer, and conversation/approval restoration. Before release,
manually verify PC and Android: a disabled template, enable/edit, a completed
milestone with Settings closed, hidden-tab continuation, duplicate browser
tabs, Stop, adventure navigation, approval expiry, follow-up chat, and JSON
import/export. CI does not call an AI provider or a live adventure.
