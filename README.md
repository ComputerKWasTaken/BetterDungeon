
# ![BetterDungeon Icon](icons/icon16.png) BetterDungeon

A browser extension that enhances AI Dungeon with additional QOL features and additions to seamlessly improve the experience, no fuss or juggling scripts.

## Features

### Currently Implemented
- **Markdown Support**: Renders markdown formatting in the gamemaster's responses
  
  AI Dungeon's post-processing system heavily discourages the AI from outputting asterisks (`*`) in its responses, making standard markdown syntax unreliable. BetterDungeon provides asterisk-free alternatives that work seamlessly:
  
  | Syntax | Result |
  |--------|--------|
  | `{{bold text}}` | **bold** |
  | `_italic text_` | *italic* |
  | `++underlined text++` | underlined |
  | `~~strikethrough~~` | ~~strikethrough~~ |
  | `# Header` (H1-H6) | Headers |
  | `> quote` | Blockquotes |
  | `- item` or `+ item` | Lists |
  | `{{_bold italic_}}` | ***bold italic*** |
  | `{{++bold underline++}}` | **underlined bold** |

  - Click **"Apply Instructions"** in the extension popup to inject formatting guidelines automagically

- **Command Input Mode**: A new "Command" button in the input mode menu that formats your input as a story header (`## Your Command:`)
  - Select **Command** from the input mode menu (alongside Do, Say, Story, See)
  - Type your command (e.g., "Time Skip" or "Scene Change")
  - Useful for sending narrative commands/headers to the AI that structure the story

### Planned Features
- Favorite AI Instructions (AIN) storage
- Adventure categorization and sorting
- Highlighting story card triggers in the recent story portion of the context viewer
- And more...

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
   ```
   Standard:    The **brave knight** rode his *majestic horse* through the __dark forest__.
   Alternative: The {{brave knight}} rode his _majestic horse_ through the ++dark forest++.
   ```
4. The extension will automatically format the text as it appears in the story

## Settings

Click the BetterDungeon icon in your Chrome toolbar to access settings:
- **Feature Toggles**: Enable or disable individual features
- **Status Indicator**: Shows if extension is active on current page

Settings are synced across your Chrome browsers.

## Development

### Project Structure
```
BetterDungeon/
├── manifest.json           # Extension configuration
├── main.js                 # Core orchestrator - manages feature lifecycle
├── core/                   # Core system components
│   └── feature-manager.js  # Feature registration and lifecycle management
├── services/               # External service integrations
│   └── ai-dungeon-service.js # AI Dungeon specific operations
├── utils/                  # Utility functions
│   ├── dom.js              # DOM manipulation helpers
│   └── storage.js          # Chrome storage abstraction
├── features/               # Self-contained feature modules
│   ├── markdown_feature.js # Markdown formatting feature
│   └── command_feature.js  # Command input mode feature
├── styles.css              # CSS for all features
├── popup.html              # Extension popup interface
├── popup.js                # Popup settings script
├── ai_instructions.txt     # Default AI formatting instructions
├── icons/                  # Extension icons (16, 32, 48, 128px)
└── README.md               # This file
```

### Architecture

BetterDungeon uses a modular, service-oriented architecture with clear separation of concerns:

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