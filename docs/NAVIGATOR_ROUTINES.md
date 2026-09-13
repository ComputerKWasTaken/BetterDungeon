# Navigator Routines

Open **Game Menu → Gameplay → Navigator → Routines**. A Routine is a name,
an instruction for Navigator, and an interval from 1 to 100 actions. Enable it
to run in every adventure on this device. There is no additional master switch
or daily allowance. Provider quotas and any billing still apply; frequent
Routines can consume substantial usage.

**Auto Cards** and **Story Arc** are editable examples, initially off. They ask
Navigator to maintain useful Story Cards or a Story Arc section in Plot
Essentials. They use normal Navigator context and tools; results depend on the
story, instructions, and chosen AI model.

## When a Routine runs

Intervals use absolute adventure action-count milestones. Every 5 actions
means milestones 5, 10, 15, and so on. AI Dungeon can add both a player action
and an AI response in one generation, so five actions does not necessarily mean
five clicks of Send. Continue and Retry can also advance the count. A completed
generation that crosses a milestone runs the Routine once, even if the exact
count was skipped.

Opening an adventure or enabling a Routine establishes a baseline; neither
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
separate.

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
leave existing rules intact. Files contain rule instructions only, with no
provider keys, adventure transcripts, or activity. Review imported instructions
before enabling them. Rule libraries support up to 100 Routines and 1 MB;
invalid imports leave the current library untouched.

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
