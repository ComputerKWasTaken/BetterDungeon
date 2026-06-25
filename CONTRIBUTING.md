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
├── manifest.json           # Extension configuration and metadata
├── main.js                 # Core content script orchestrator: manages feature lifecycle
├── background.js           # Extension background worker: handles API keys, dynamic routing, and cross-contexts
├── popup.html/js/css       # Extension popup user interface and settings coordinator
├── styles.css              # Main injected styling rules for content script features
├── core/                   # Core system engines
│   ├── feature-manager.js  # Feature registration and lifecycle management
│   └── theme-variables.css # Design system variables and color tokens
├── services/               # Internal services and backend integrations
│   ├── ai-dungeon-service.js # Native AI Dungeon interaction APIs
│   ├── custom-dynamic-router.js # Background network dynamic router
│   ├── graphql-service.js  # GraphQL query and mutation helper backend
│   ├── loading-screen.js   # Loading screen state UI overlays
│   ├── story-card-cache.js # Local caching of story card data
│   ├── story-card-scanner.js # Scrapes and indexes adventure cards via GraphQL
│   ├── tutorial-service.js # Tutorial walkthrough coordinator
│   └── ultrascripts/       # Communication bridge between scenario scripts and extension
├── modules/                # Permission-gated script modules loaded by Ultrascripts (ai, widget, clock, etc.)
├── features/               # Modular, self-contained feature scripts (markdown, try mode, etc.)
├── utils/                  # Shared utility functions and storage interfaces
│   ├── browser-polyfill.js # Browser API polyfill for Firefox compatibility
│   ├── dom.js              # DOM selection and mutation wrappers
│   ├── markdown-config.js  # Markdown presets and configurations
│   └── storage.js          # Storage interfaces (sync and local)
├── fonts/                  # Embedded local typography and icons (IBM Plex Sans, Roboto Mono, Lucide)
├── icons/                  # Extension icons for Chrome and Firefox store listings
├── examples/               # Example configurations, templates, and HUD guides
├── tests/                  # Integration and verification test suites for Ultrascripts
└── scripts/                # Developer automation scripts (empty)
```

### Architecture Patterns

BetterDungeon uses a modular, service-oriented architecture. I divide responsibilities between central orchestration, permission-gated script modules, and feature plugins:

- **main.js**: Core orchestrator that initializes content script features and passes runtime messages.
- **background.js**: Extension background service worker managing cross-context communication, API calls, and custom routing adapters.
- **core/feature-manager.js**: Manages lifecycle hooks (`init`, `destroy`) for all registered features based on user configuration.
- **services/ultrascripts/**: Coordinates the message passing, intercepting, and dispatching pipeline between running scenario scripts and the extension core.
- **modules/**: Gated modules that execute script requests (like Weather, Clock, Geolocation, and Gemini queries) after verifying user preferences and permissions.
- **features/**: Self-contained feature components that handle their own DOM observation, UI mutations, and state management.

Each feature implements:
- `static id` - Unique identifier (e.g., `'markdown'`, `'command'`)
- `init()` - Called when enabled; setup observers, UI, etc.
- `destroy()` - Called when disabled; cleanup observers, restore state

---

## Version History

### Changelog

### v2.0.0
- **Ultrascripts Subsystem:** Introduced the next-generation two-way extension-to-script communication bridge, replacing BetterScripts entirely.
  - Added modules: `ai` (Gemini API queries), `widget` (UI elements, buttons, mobile layouts), `webfetch` (consent-gated HTTP GET requests), `clock` (real-world time and offsets), `sdk` (extension metadata queries), `geolocation` (location context), `weather` (weather forecast queries), `network` (connection details), and `system` (device context details).
- **Mobile Support (Android Port):** Released the official native Android APK build.
- **Firefox Port:** Released on the official Firefox Browser Add-ons Store.
- **Custom Dynamic Rework:** Rebuilt to support user-configured model pools with weighted-random, round-robin, and avoid-repeats routing.
- **Text to Speech:** Added narration features for adventure text.
- **UI Redesign:** Reworked popups and settings panels for a sleeker look.
- **Markdown Rework:** Rewrote the backend to prevent AI refusals and added 6 new instructions sets.
- **Character Presets Rework:** Powered character prefill using Gemini API from the Ultrascripts AI module.
- **Story Card Scanner Rework:** Rewrote scanner to run instantly via GraphQL, supporting 500+ cards.
- **Story Card Analytics & Trigger Highlighting Rework:** Instant loading for dashboards and trigger overlays.
- **Auto See Rework:** Rewrote the auto see engine using a robust GraphQL backend.

### v1.2.2
- Fixed Story Card Dashboard button for AI Dungeon's reworked Story Card menu
- Updated DOM selectors: Filters button removed, "Add Story Card" renamed to "Create Story Card"
- Restyled Dashboard button to match the new Create Story Card button design
- Updated Story Card Scanner to recognize the new "Create Story Card" button

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

## Support

- [Found a bug?](../../issues) Report it on GitHub
- [Feature idea?](../../issues/new?template=feature_request.md) I'd love to hear it
- Need help? Check the [Contributing Guide](CONTRIBUTING.md) for technical details
- Contact me on Discord: `@computerK`

---

**Made with ❤️ for the AI Dungeon community**