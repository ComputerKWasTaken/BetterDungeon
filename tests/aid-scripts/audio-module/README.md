# Ultrascripts Audio Module — AI Dungeon Test Suite

Manual live test for the first state-driven Audio implementation.

## Setup

1. Load the unpacked BetterDungeon extension and refresh AI Dungeon.
2. Enable Ultrascripts and Audio in the BetterDungeon popup.
3. Add `library.js`, `input-modifier.js`, and `output-modifier.js` to an AI
   Dungeon scenario's matching script hooks.
4. Start or resume an adventure and submit one of the commands below.

The first click or key press unlocks Web Audio. Browsers may keep playback
suspended until that interaction occurs.

## Commands

| Command | Expected result |
|---|---|
| `/audio loop cavern` | Starts the selected bundled ambient track and loops it |
| `/audio volume 0.2` | Changes the active ambient volume without replacing its track |
| `/audio effect` | Plays one rising sine tone |
| `/audio noise` | Plays one short noise impact |
| `/audio stop` | Stops active playback and leaves Audio silent |

Open `ultrascripts:test:audio` to confirm the state published by the suite and
whether the heartbeat advertises Audio.

Available track ids: `cavern`, `cozy`, `mystery`, `nature`, `ominous`,
`peaceful`, and `tension`.

## Regression checks

- Reloading or rehydrating the same effect id does not replay it.
- Repeating `/audio effect` or `/audio noise` produces a new id and plays again.
- Changing tracks stops the old loop and begins the new one.
- Re-publishing the same track changes volume without restarting it.
- Every MP3 reaches its end and wraps without an unacceptable gap or click.
- Disabling Audio immediately stops all sources.
- Removing the Audio state card or leaving the adventure stops all sources.
- Invalid waveforms or out-of-bounds parameters do not start playback.
