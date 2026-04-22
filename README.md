# ![BetterDungeon Icon](icons/icon16.png) BetterDungeon

The all-in-one browser extension for AI Dungeon that enhances the experience with QOL additions and brand new features.

## Installation

### Chrome Web Store (Recommended)

1. Visit the [Chrome Web Store](https://chromewebstore.google.com/detail/betterdungeon/ppliljfopejamemejnnchehpbacpebjf)
2. Click "Add to Chrome"
3. You're in!

### Firefox (Manual Install)

No Firefox Add-ons listing yet — install manually for now:

1. Clone/download this repo
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Select any file inside the `BetterDungeon` folder (e.g. `manifest.json`)
5. You're in!

> **Note:** Temporary add-ons are removed when Firefox closes. You'll need to re-load the extension each session until a signed version is available on the Firefox Add-ons store.

### Manual Installation (Chromium)

For developers or if you prefer manual installation:

1. Clone/download this repo
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select the `BetterDungeon` folder
5. You're in

## Features

### 🎮 Input Modes

- **Command Mode** — Send narrative commands like "Skip time forward to the next day" or "Change the scene" as story commands. The easiest way to steer your story without awkward workarounds.
  - 2 submodes for even more control: Subtle and OOC!
- **Try Mode** — RNG-based action outcomes with dice rolling mechanics. Type what you want to try, roll the dice, and see what happens!
  - Configurable critical hit/fail chance (0-20%)
  - Adjust success chance from 5% to 95% with arrow keys
  - Visual success bar shows your current odds
  - Critical successes and failures for dramatic moments

### 🧭 Control & Navigation

- **Hotkeys** — Keyboard shortcuts to easily and seamlessly navigate and play AI Dungeon. All keys can be remapped to your preference!
- **Input History** — Terminal-style input history with arrow keys. Press Ctrl + Up/Down to cycle through your previous inputs. Remembers up to 50 recent actions and their respective input modes.
- **Input Mode Colors** — Color-coded input box so you always know what mode you're in. Fully customizable colors for each mode.

### ✨ Writing & Formatting

- **Markdown Support** — Custom Markdown-like formatting system that works with AI models:
  - Bold, italic, underline, whisper text, scene breaks, lists and more!
  - One-click AI instruction application
  - Auto-apply on adventure option
- **Adventure Notes** — Embedded Plot Components notes card that saves per adventure. Track plot points, character details, or session notes without AI interference.

### 🔧 Scenario Building

- **Trigger Highlighting** — Story card triggers get highlighted in the context viewer. Hover to jump to the card. Also suggests proper nouns that might deserve their own story cards.
- **Story Card Analytics Dashboard** — For scenario creators showing card statistics, trigger overlaps, coverage analysis, and potential issues. Helps identify missing triggers, empty cards, and optimization opportunities.
- **Story Card Modal Dock** — Docks the story card modal to the right side, allowing you to scroll through your story while editing Story Cards.
- **Scripture** — A Frontier module for dynamic AI Dungeon script widgets. Enables scripts to create HP bars, stats, and game state displays through story-card state.

### ⚡ Automations

- **Auto See** — Automatically triggers a See input command after every AI response or after a set number of turns. Configurable frequency with credit usage warnings.
- **Auto Enable Scripts** — Automatically retoggles "Enable Scripts" in Scenario Creation. Saves you from manually re-enabling scripts every time.

### 📋 Presets

- **Plot Presets** — Save custom Plot Components for reuse across scenarios. Works best with BetterRepository!
- **Character Presets** — Save character profiles and auto-fill scenario entry questions. Never type your character's details repeatedly again!

## Usage

1. Head to [AI Dungeon](https://aidungeon.com)
2. Click the BetterDungeon icon to toggle features and access settings
3. Play your adventure with all the new goodies

Settings sync across Chromium and Firefox browsers.

## Support

- [Found a bug?](../../issues) Report it on GitHub
- [Feature idea?](../../issues/new?template=feature_request.md) I'd love to hear it
- Need help? Check the [Contributing Guide](CONTRIBUTING.md) for technical details
- Contact me on Discord: `@computerK`

---

**Made with ❤️ for the AI Dungeon community**
