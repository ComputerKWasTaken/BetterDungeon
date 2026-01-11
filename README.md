
# ![BetterDungeon Icon](icons/icon16.png) BetterDungeon

An all-in-one browser extension that enhances AI Dungeon with additional QOL additions and brand new features to improve the AI Dungeon experience.

## Features

### Currently Implemented Features
- **Markdown Support**: Renders markdown formatting in the gamemaster's responses
  
  BetterDungeon uses an **asterisk-free markdown syntax** (for compatibility with models that can't output asterisks) with specific AI instructions that tell the model *when* to use each format:
  
  | Syntax | Result | AI Usage |
  |--------|--------|----------|
  | `__bold__` | **bold** | Important words, names, dramatic impact |
  | `_italic_` | *italic* | Thoughts, foreign words, titles |
  | `___bold italic___` | ***bold italic*** | Intense outbursts, shouted words |
  | `==underline==` | underline | Written/inscribed text, labels |
  | `~small text~` | small faint text | Whispers, quiet speech, ethereal voices |
  | `---` | ─────── | Scene breaks, time skips |
  | `- item` | • item | Unordered lists (inventory, options, etc.) |

  **Note:** Headers (`#`) and blockquotes (`>`) are intentionally excluded as they conflict with AI Dungeon's command system.

  - Click **"Apply Instructions"** in the extension popup to inject formatting guidelines
  - The instructions tell the AI *when* to use each format, not just that it can

- **Command Input Mode**: A new "Command" button in the input mode menu that formats your input as a story header (`## Your Command:`)
  - Select **Command** from the input mode menu (alongside Do, Say, Story, See)
  - Type your command (e.g., "Time Skip" or "Scene Change")
  - Useful for sending narrative commands/headers to the AI that structure the story, and makes it far easier to guide and adjust the story's direction

- **Attempt Input Mode**: A new "Attempt" button (between Do and Say) that uses RNG to determine action outcomes
  - Select **Attempt** from the input mode menu
  - Type what you want to attempt (e.g., "pick the lock" or "jump across the gap")
  - The action is formatted as: `You attempt to [action], you [result].`
  - Possible outcomes: **critically fail**, **fail**, **succeed**, **critically succeed**
  - Outcome distribution:
    - Critical fail: 0% to X% (configurable)
    - Fail: X% to 50%
    - Succeed: 50% to (100-X)%
    - Critical succeed: (100-X)% to 100%
  - Configure critical chance (0-20%, default 5%) in the extension popup
  - Adjust odds with arrow keys (↑↓)
  - Increases or decreases the chance of success or failure

### Currently Implemented Enhancements

- **Readable Tab Repositioning**: Automatically moves the "Readable" tab button to appear right after "All" in the Section Tabs
  - Returns the "Readable" tab back to its rightful place :D

- **Story Card Triggers Highlighting**: Scans for story card triggers in the recent story portion of the context viewer and highlights them, including a hover tooltip that links to the story card
  - **Suggested Triggers**: Automatically detects frequently mentioned proper nouns (names, places, etc.) that don't have associated story cards and highlights them in cyan with a dashed underline
  - Hover over suggested triggers to see how many times they appear in the context
  - Helps identify potential story cards you may want to create
  - Configurable threshold (default: 3 mentions) for when a noun is suggested

- **Hotkeys**: Keyboard shortcuts for common AI Dungeon actions
  - Works only when not typing in a text field
  
  | Key | Action |
  |-----|--------|
  | `T` | Take a Turn |
  | `C` | Continue |
  | `R` | Retry |
  | `E` | Erase |
  | `Z` | Undo |
  | `Y` | Redo |
  | `1` | Do mode |
  | `2` | Attempt mode* |
  | `3` | Say mode |
  | `4` | Story mode |
  | `5` | See mode |
  | `6` | Command mode* |
  
  *Requires the respective feature to be enabled

### Planned Features
- Adventure categorization and sorting
- And more...

### Planned Enhancements
- (None currently planned)

## Bugs/Issues

### Urgent

### High Priority
- **Command/Attempt button styling**: The Command/Attempt button doesn't connect to the other buttons in any theme other than the default Dynamic theme

### Low Priority  

### Backlog

## Installation

### Development Installation
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `BetterDungeon` folder
5. The extension should now appear in your extensions list

### Production Installation
I may put this on the Chrome Web Store at some point, but for now you'll have to use the development installation method, sorry bub

## Usage

1. Navigate to [AI Dungeon](https://aidungeon.com)
2. Start or continue an adventure
3. Use markdown syntax in your story inputs:
   `The __brave knight__ rode his _majestic horse_ through the ==dark forest==.`
4. The extension will automatically format the text as it appears in the story

## Settings

Click the BetterDungeon icon in your Chrome toolbar to access settings:
- **Feature Toggles**: Enable or disable individual features
- **Enhancement Descriptions**: Discover what each enhancement does

Settings are synced across your Chromium-based browsers.

## Development

### Project Structure
```
BetterDungeon/
├── manifest.json           # Extension configuration
├── main.js                 # Core orchestrator - manages feature lifecycle
├── core/                   # Core system components
│   └── feature-manager.js  # Feature registration and lifecycle management
├── services/               # External service integrations
│   ├── ai-dungeon-service.js # AI Dungeon specific operations
│   ├── loading-screen-service.js # Loading screen management
│   └── story-card-scanner.js # Story card scanning
├── utils/                  # Utility functions
│   ├── dom.js              # DOM manipulation helpers
│   └── storage.js          # Chrome storage abstraction
├── features/               # Self-contained feature modules
│   ├── markdown_feature.js # Markdown formatting feature
│   ├── command_feature.js  # Command input mode feature
│   ├── attempt_feature.js  # Attempt input mode feature
│   ├── readable_position_feature.js # Readable tab repositioning
│   ├── trigger_highlight_feature.js # Story card trigger highlighting
│   ├── hotkey_feature.js   # Keyboard shortcuts
│   └── favorite_instructions_feature.js # Plot presets storage
├── styles.css              # CSS for all features
├── popup.html              # Extension popup interface
├── popup.js                # Popup settings script
├── ai_instruction.txt      # Default AI formatting instructions
├── icons/                  # Extension icons (16, 32, 48, 128px)
└── README.md               # This file
```

### Architecture

BetterDungeon uses a modular, service-oriented architecture that allows for each feature to be developed, self-contained, and independently managed.

- **main.js**: Core orchestrator that initializes the system and handles message passing from the popup
- **core/feature-manager.js**: Manages feature registration, lifecycle, and storage-based enable/disable
- **services/ai-dungeon-service.js**: Handles AI Dungeon-specific operations like instruction application
- **utils/**: Shared utility functions for DOM manipulation and Chrome storage abstraction
- **features/**: Self-contained feature modules that manage their own DOM observation, state, and cleanup

Each feature implements:
- `static id`: Unique identifier (e.g., `'markdown'`, `'command'`)
- `init()`: Called when feature is enabled - setup observers, UI, etc.
- `destroy()`: Called when feature is disabled - cleanup observers, restore state

Features are completely independent and communicate through the central feature manager. The architecture supports:
- Dynamic feature loading and unloading
- Persistent feature state across browser sessions
- Modular development with clear boundaries
- Shared utilities to prevent code duplication

### Adding New Features

1. Create a new file in `features/`:

```javascript
class MyFeature {
  static id = 'my-feature';
  
  constructor() {
    this.observer = null;
  }

  init() {
    // Setup your own DOM observers, UI, etc.
    console.log('MyFeature: Initialized');
  }

  destroy() {
    // Cleanup observers, restore state
    if (this.observer) {
      this.observer.disconnect();
    }
    console.log('MyFeature: Destroyed');
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.MyFeature = MyFeature;
}
```

2. Add to `manifest.json` content scripts array (maintaining load order):
```json
"js": [
  "utils/dom.js",
  "utils/storage.js", 
  "services/ai-dungeon-service.js",
  "core/feature-manager.js",
  "features/markdown_feature.js",
  "features/command_feature.js",
  "features/my_feature.js",
  "main.js"
]
```

3. The feature will be automatically registered by the FeatureManager if it follows the naming convention and is globally available

4. Add toggle to `popup.html` and default state in `popup.js`:
```html
<div class="feature-item" data-feature="my-feature">
  <div class="feature-info">
    <span class="feature-name">My Feature</span>
    <span class="feature-desc">Brief description</span>
  </div>
  <label class="toggle">
    <input type="checkbox" id="feature-my-feature" checked>
    <span class="toggle-slider"></span>
  </label>
</div>
```

## Changelog

### v1.0.0
- Initial release