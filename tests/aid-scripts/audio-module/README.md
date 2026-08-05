# Ultrascripts Audio Module — AI Dungeon Test Suite

Manual live test for the state-driven Audio synthesizer.

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
| `/audio tone` | Plays one short sine tone |
| `/audio sweep` | Plays one rising sawtooth sweep |
| `/audio noise` | Plays one short noise impact |
| `/audio stop` | Stops active effects and leaves Audio silent |

Open `ultrascripts:test:audio` to confirm the state published by the suite and
whether the heartbeat advertises Audio.

Available waveforms: `sine`, `square`, `triangle`, `sawtooth`, and `noise`.

## Regression checks

- Reloading or rehydrating the same effect id does not replay it.
- Repeating `/audio tone`, `/audio sweep`, or `/audio noise` produces a new id
  and plays again.
- Pitch sweeps, attack, release, duration, and volume are applied correctly.
- Disabling Audio immediately stops all sources.
- Removing the Audio state card or leaving the adventure stops all sources.
- Invalid waveforms or out-of-bounds parameters do not start playback.
