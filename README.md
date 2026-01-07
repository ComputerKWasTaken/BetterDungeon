
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
├── features/               # Self-contained feature modules
│   └── markdown_feature.js # Markdown formatting feature
├── styles.css              # CSS for all features
├── popup.html              # Extension popup interface
├── popup.js                # Popup settings script
├── icons/                  # Extension icons (16, 32, 48, 128px)
└── README.md               # This file
```

### Architecture

BetterDungeon uses a modular feature system where each feature is fully self-contained:

- **main.js**: Minimal core that handles feature registration, storage-based enable/disable, and message passing from the popup
- **features/**: Each feature manages its own DOM observation, state, and cleanup

Each feature implements:
- `static id`: Unique identifier (e.g., `'markdown'`)
- `init()`: Called when feature is enabled - setup observers, UI, etc.
- `destroy()`: Called when feature is disabled - cleanup observers, restore state

Features are completely independent - a markdown feature watches story text, while a favorites feature might watch a sidebar. They don't share observation logic.

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
```

2. Add to `manifest.json`:
```json
"js": ["features/markdown_feature.js", "features/my_feature.js", "main.js"]
```

3. Register in `main.js` `loadFeaturesFromStorage()`:
```javascript
if (typeof MyFeature !== 'undefined') {
  this.featureClasses.set('my-feature', MyFeature);
}
```

4. Add toggle to `popup.html` and default state in `popup.js`.

## Changelog

### v1.0.0
- Initial release
- Modular feature system with enable/disable toggles
- Markdown formatting support (bold, italic, underline, strikethrough, headers, blockquotes, lists)