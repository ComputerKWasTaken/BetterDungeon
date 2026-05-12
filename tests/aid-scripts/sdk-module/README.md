# Frontier SDK Module - AI Dungeon Test Suite

End-to-end test scripts that exercise the BetterDungeon Frontier `sdk` module
from inside an AI Dungeon scenario. This suite is intentionally simple and
visible: it appends the returned SDK payload directly into story text so you
can watch the module work live without opening DevTools first.

## What it covers

The suite currently queues the shipped SDK ops:

| Step | Module | Op | Expect |
| --- | --- | --- | --- |
| `version` | `sdk` | `version` | ok + SDK / BetterDungeon / Frontier version data |
| `config` | `sdk` | `config` | ok + curated BetterDungeon configuration snapshot |

It also verifies:

- the `frontier:heartbeat` card exists
- the heartbeat advertises `sdk` with both `version` and `config`
- `frontier:in:sdk` receives terminal responses
- ack cleanup runs after responses are seen

## Setup

1. Load the BetterDungeon extension and open AI Dungeon.
2. Open BetterDungeon -> **Frontier** and enable Frontier and the **SDK**
   module.
3. Start or resume an adventure with a scenario that uses these scripts.

## Install in a scenario

1. In AI Dungeon, edit a scenario and open the **Scripting** panel.
2. Paste the contents of `library.js` into the **Library** script.
3. Paste the contents of `output-modifier.js` into the **Output Modifier**.
4. Save and start the scenario.
5. Take a few turns. The output modifier advances one SDK request at a time.

## What you will see

Each generated story output gets a block appended like:

```text
[Frontier SDK Test]
phase: awaiting capabilities
heartbeat: present
sdk ops advertised: version, config
version: ok
{
  ...
}
config: waiting
...
```

That makes it easy to confirm the real data shape the script is seeing.

## Trace card

The suite also writes a story card:

- `frontier:test:sdk`

Use it when you want the raw JSON trace without reading it from story text.

## Reset

To restart the suite without editing scripts, type one of these into your
input and take a turn:

- `sdk test reset`
- `frontier sdk reset`
- `[[sdk-test:reset]]`

The suite clears its own state and starts from the first request again.
