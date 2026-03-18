# Contributing to BetterDungeon

Developer documentation for contributors and maintainers.

---

## Development Guide

### Getting Started

#### Prerequisites
- Chrome, Edge, or any Chromium-based browser
- Git
- Basic knowledge of JavaScript and browser extensions

### Development Workflow

#### Setup
1. Fork/clone this repository
2. Open your browser and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" → select the `BetterDungeon` folder
5. Make changes to the code
6. Click the reload icon in the extensions page to update
7. Test on [AI Dungeon](https://aidungeon.com)

---

## Architecture & Structure

### Project Overview

```
BetterDungeon/
├── manifest.json           # Extension configuration
├── main.js                 # Core orchestrator - manages feature lifecycle
├── core/                   # Core system components
│   ├── feature-manager.js  # Feature registration and lifecycle management
│   └── theme-variables.css # Design system variables
├── services/               # External service integrations
│   ├── ai-dungeon-service.js   # AI Dungeon specific operations
│   ├── loading-screen.js       # Loading screen management
│   ├── story-card-scanner.js   # Story card scanning
│   └── tutorial-service.js     # Tutorial management
├── utils/                  # Utility functions
│   ├── browser-polyfill.js     # Browser API polyfill for Firefox compatibility
│   ├── dom.js                  # DOM manipulation helpers
│   └── storage.js              # Chrome storage abstraction
├── features/               # Self-contained feature modules
├── styles.css              # CSS for all features
├── popup.html/js/css       # Extension popup interface
└── icons/                  # Extension icons (16, 32, 48, 128px)
```

### Architecture Patterns

BetterDungeon uses a modular, service-oriented architecture. Each feature is self-contained and independently managed.

- **main.js** - Core orchestrator that initializes the system and handles message passing from the popup
- **core/feature-manager.js** - Manages feature registration, lifecycle, and storage-based enable/disable
- **services/** - Handles AI Dungeon-specific operations like instruction application
- **utils/** - Shared utility functions for DOM manipulation and Chrome storage abstraction
- **features/** - Self-contained modules that manage their own DOM observation, state, and cleanup

Each feature implements:
- `static id` - Unique identifier (e.g., `'markdown'`, `'command'`)
- `init()` - Called when enabled; setup observers, UI, etc.
- `destroy()` - Called when disabled; cleanup observers, restore state

---

## Version History

### Changelog

### v1.2.0
- **Command Mode Submodes:** Added "Subtle" (brackets) and "OOC" (direct AI query) submodes
- **Markdown Formatting:** Toggle individual formatting types; added quoted, highlight, and list options
- **Popup UI Overhaul:** Feature search, collapsible sections, quick toggles grid, revised layout
- **Bugfixes:** Ported fixes from v1.1.2 and v1.1.1 (Try mode, Story Card Scanner, etc.)

### v1.1.2
- Fixed Story Card Scanner compatibility with Story Card Modal Dock
- Fixed Plot Presets DOM navigation and state management
- Migrated Plot/Character Presets from sync to local storage (fixes 8KB limit issues)

### v1.1.1
- Major DOM compatibility fixes for AI Dungeon's framework overhaul
- Fixed Story Card Scanner, Markdown auto-apply, Try Mode layout, and sprite theme compatibility

### v1.1.0
- **Firefox Support:** Added browser polyfill system
- **Input History:** Navigate previous inputs with CTRL/Cmd + Up/Down arrows
- **What's New Banner:** Added to popup Features tab
- **Character/Plot Presets:** UI updates, placeholder system compatibility, various fixes

### v1.0.1
- **BetterScripts:** Debug mode, alignment system, dynamic resizing, reworked examples, full documentation
- **Character Presets:** Autofill approval UI, improved editing and intelligence

### v1.0.0
- **BetterScripts:** New extension-to-script communication layer for dynamic UI widgets
- **Try Feature:** Dynamic templates, varied outcome phrases, improved roll system
- **Story Card Modal Dock:** Docks modal to right side with scrolling
- **Adventure Notes:** Embedded directly in Plot Components
- Various fixes for Input Mode Color, Markdown rendering, Character Presets

### v0.9.5
- **New Features:** Auto See, Story Card Analytics, Adventure Notes, Auto Enable Scripts
- **Improvements:** Popup UI redesign with icons, customizable hotkeys and input mode colors
- Improved Story Card Scanner performance

### v0.9.1
- Improved Command mode formatting with brackets
- Alternative Markdown formatting system (avoids asterisks and underscores)
- Compact popup UI, improved tutorial, Exit Input hotkey (Esc)

### v0.9.0
- Early Access release

---

## Feature Development

### Adding New Features

1. Create a new file in `features/`:

```javascript
class MyFeature {
  static id = 'my-feature';
  
  constructor() {
    this.observer = null;
  }

  init() {
    console.log('MyFeature: Initialized');
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    console.log('MyFeature: Destroyed');
  }
}

if (typeof window !== 'undefined') {
  window.MyFeature = MyFeature;
}
```

2. Add to `manifest.json` content scripts array:
```json
"js": [
  "utils/dom.js",
  "utils/storage.js", 
  "services/ai-dungeon-service.js",
  "core/feature-manager.js",
  "features/my_feature.js",
  "main.js"
]
```

3. Add toggle to `popup.html`:
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

---

## Support & Resources

### Getting Help
- **Issues:** Report bugs or request features via [GitHub Issues](https://github.com/ComputerKWasTaken/BetterDungeon/issues)

### Useful Links
- [AI Dungeon](https://aidungeon.com) - The game BetterDungeon enhances
- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Firefox Extension Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

### License
This project is open source. See the LICENSE file for details.

---

Thank you for contributing to BetterDungeon! Your efforts help make AI Dungeon a better experience for everyone.
