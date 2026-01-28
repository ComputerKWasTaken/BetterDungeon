# ![BetterDungeon Icon](icons/icon16.png) BetterDungeon

**🚧 Early Access** — Things might break, features might change, feedback is welcome!

The all-in-one browser extension for AI Dungeon that enhances the experience with QOL additions and brand new features.

## Installation

**For now (Chrome Web Store coming eventually):**

1. Clone/download this repo
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select the `BetterDungeon` folder
5. You're in

## Usage

1. Head to [AI Dungeon](https://aidungeon.com)
2. Click the BetterDungeon icon to toggle features and access settings
3. Play your adventure with all the new goodies

Settings sync across Chromium browsers.

## Features

### New Input Modes

- **Command Mode** — Send narrative commands like "Time Skip" or "Scene Change" as story headers. The easiest way to steer your story without awkward workarounds.

- **Try Mode** — RNG-based action outcomes. Type what you want to try, roll the dice. Critical fails and critical successes included.
  - Configurable crit chance (0-20%)
  - Adjust success chance from 5% to 95% with arrow keys (↑↓)
  - Visual success bar shows your current odds

### Quality of Life

- **Markdown Support** — Asterisk-free formatting that actually works with AI models. Bold, italic, underline, whisper text, scene breaks, and lists.
  - Hit "Apply Instructions" in the popup to teach the AI when to use each format

- **Hotkeys** — Keyboard shortcuts when you're not typing. **Fully customizable** via the popup.
  
  | Key | Action | | Key | Action |
  |-----|--------|-|-----|--------|
  | `T` | Take a Turn | | `1-6` | Input modes |
  | `C` | Continue | | `Z` | Undo |
  | `R` | Retry | | `Y` | Redo |
  | `E` | Erase | | `Esc` | Exit Input |

- **Input Mode Colors** — Color-coded input box so you know what mode you're in at a glance. **Fully customizable** via the popup. Default colors: Blue (Do), Purple (Try), Green (Say), Gold (Story), Cyan (See), Orange (Command).

- **Trigger Highlighting** — Story card triggers get highlighted in the context viewer. Hover to jump to the card. Also suggests proper nouns that might deserve their own story cards.

- **Auto See** — Automatically triggers a See input command after every AI response or after a certain amount of turns.

- **Adventure Notes** — An embedded Plot Components notes card that saves per adventure. Track plot points, character details, or session notes without leaving the game.

### Presets

- **Plot Presets** - Allows you to save your own custom Plot Components for use in scenarios.

- **Character Presets** — Stop typing your character's name 47 times. Save profiles, auto-fill scenario entry questions, never suffer again.

### Small QOL Improvements

- **Readable Tab Fix** — Moves the "Readable" tab back where it belongs. You're welcome.

- **Auto Enable Scripts** - A small QOL feature that automatically retoggles the "Enable Scripts" option in the Scenario Creation page.

## Support

- 🐛 [Found a bug?](../../issues) Report it on GitHub
- 💡 [Feature idea?](../../issues/new?template=feature_request.md) I'd love to hear it
- 📖 Need help? Check the [Contributing Guide](CONTRIBUTING.md) for technical details
- 📱 Contact me on Discord: `@computerK`

---

**Made with ❤️ for the AI Dungeon community**