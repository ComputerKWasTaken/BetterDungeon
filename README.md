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

- **Attempt Mode** — RNG-based action outcomes. Type what you want to attempt, roll the dice. Critical fails and critical successes included.
  - Configurable crit chance (0-20%)
  - Tweak odds with arrow keys (↑↓)

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

- **Input Mode Colors** — Color-coded input box so you know what mode you're in at a glance. **Fully customizable** via the popup. Default colors: Blue (Do), Purple (Attempt), Green (Say), Gold (Story), Pink (See), Cyan (Command).

- **Trigger Highlighting** — Story card triggers get highlighted in the context viewer. Hover to jump to the card. Also suggests proper nouns that might deserve their own story cards.

- **Auto See** — Automatically triggers a See input command after every AI response or after a certain amount of turns.

### Presets

- **Plot Presets** - Allows you to save your own custom Plot Components for use in scenarios.

- **Character Presets** — Stop typing your character's name 47 times. Save profiles, auto-fill scenario entry questions, never suffer again.

### Small QOL Improvements

- **Readable Tab Fix** — Moves the "Readable" tab back where it belongs. You're welcome.

## Development

### Project Structure
```
BetterDungeon/
├── main.js                 # Core orchestrator
├── core/feature-manager.js # Feature lifecycle management
├── services/               # AI Dungeon integrations
├── utils/                  # DOM & storage helpers
├── features/               # Self-contained feature modules
├── styles.css              # Injected styles
├── popup.*                 # Extension popup UI
└── manifest.json           # Extension config
```

### Adding Features

Each feature is a class with `static id`, `init()`, and `destroy()` methods. Drop it in `features/`, add to `manifest.json`, wire up a toggle in the popup. The feature manager handles the rest.

See `core/theme-variables.css` for the design system if you want things to look consistent.

## Changelog

### v0.9.5 (in progress)
- Added **"Auto See"** feature, which automatically triggers a See input command after every AI response or after a certain amount of turns
- Added **Story Card Analytics** feature, which provides intelligent feedback and information about your story card setup to find weakpoints and address them
- **Improved the design of the popup UI** to include icons for each feature
- Added the ability to **customize your hotkeys** via the popup
- Added the ability to **customize input mode colors** via the popup
- **Improved Story Card Scanner** to be much faster and be able to handle more cards at once
- Updated the Tutorial to include information about the new features
- Bugfixes

### v0.9.1
- Improved **Command** mode formatting to include brackets [] for better AI adherence
- Added an option to automatically delete the command text after being sent
- Improved the **Markdown** formatting instructions and system to use an alternative system that avoids asterisks AND underscores (new)
- **Improved the popup UI** to be more compact, organized, and easier to navigate
- **Improved the Tutorial** to be more adaptive and handle edge cases better
- **Removed the Tip popup/tooltip system** as it was too intrusive
- Added **"Exit Input" hotkey (Esc)** to exit input mode
- Bugfixes

### v0.9.0.2
- Fixed an issue with the Apply button, should fix Markdown instruction application
- Improved MD file flow

### v0.9.0
- Early Access release