# Lo-fi Ambience Showcase

The simplest possible Ultrascripts Audio script: it adds a chill lo-fi
music bed to any scenario, and nothing else.

Paste the files into the matching AI Dungeon script panes:

1. `library.js` -> Library
2. `input.js` -> Input Modifier
3. `context.js` -> Context Modifier
4. `output.js` -> Output Modifier

## How it works

Each turn, the script upserts a single story card:

- title: `ultrascripts:state:audio`
- value: `{"v":1,"music":{"cue":"music.lofi.chill","intensity":0.7}}`

That is the entire integration. The Audio state card is declarative and
fire-and-forget: the script never waits for a response, and the scenario
behaves identically whether or not the player has BetterDungeon.

- With BetterDungeon + the Audio module enabled, the extension resolves
  `music.lofi.chill` to a locally synthesized lo-fi bed (warm chords,
  vinyl crackle, sparse melody) and crossfades it in.
- Without BetterDungeon, the card is inert JSON and nothing happens.

Browsers block sound until the player interacts with the page, so the
bed starts after the first click or keypress on AI Dungeon.

## Making it yours

- Swap the cue: try `music.calm`, `music.mystery`, or `music.tension`.
- Lower `intensity` for something even more understated.
- Add an ambience layer, e.g.
  `"ambience": [{ "cue": "weather.rain.light", "gain": 0.5 }]`.
- Set `"music": null` to fade the bed out.

Unknown cues degrade gracefully (they cascade to a family default), so
audio can never break the scenario.
