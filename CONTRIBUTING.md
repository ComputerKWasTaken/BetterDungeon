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
│   └── story-card-scanner.js   # Story card scanning
├── utils/                  # Utility functions
│   ├── dom.js              # DOM manipulation helpers
│   └── storage.js          # Chrome storage abstraction
├── features/               # Self-contained feature modules
├── styles.css              # CSS for all features
├── popup.html/js/css       # Extension popup interface
├── markdown_ai_instruction.txt # Default AI formatting instructions for Markdown
└── icons/                  # Extension icons (16, 32, 48, 128px)
```

### Architecture Patterns

BetterDungeon uses a modular, service-oriented architecture. Each feature is self-contained and independently managed.

- **main.js** — Core orchestrator that initializes the system and handles message passing from the popup
- **core/feature-manager.js** — Manages feature registration, lifecycle, and storage-based enable/disable
- **services/** — Handles AI Dungeon-specific operations like instruction application
- **utils/** — Shared utility functions for DOM manipulation and Chrome storage abstraction
- **features/** — Self-contained modules that manage their own DOM observation, state, and cleanup

Each feature implements:
- `static id` — Unique identifier (e.g., `'markdown'`, `'command'`)
- `init()` — Called when enabled; setup observers, UI, etc.
- `destroy()` — Called when disabled; cleanup observers, restore state

---

## Version History

### Changelog

### v1.0.0 (in progress)
- Added **BetterScripts**, a brand new communication layer between the extension and AI Dungeon scripts to allow for the creation of dynamic UI widgets
- Ported over and improved the **Attempt** feature to be the **Try** feature
- Improved **Try** feature formatting with **dynamic templates** and **varied outcome phrases** to reduce monotony
- Outcomes are now **bolded** in the story to improve AI model adherence and visibility (not real Markdown formatting, just emphasizes it to the AI model)
- Added intelligent **sentence connectors** ('and'/'but') and punctuation handling for better narrative flow
- Embedded **Adventure Notes** directly in Plot Components (no floating panel or resizer)
- **Improved the roll system** within the Try feature for more consistent odds and logic
- Fixed and improved the **Input Mode Color** feature
- Added **Story Card Modal Dock** feature, which docks the story card modal to the right side of the screen and allows you to scroll through your story
- Fixed color bleed issue on the buttons with the Input Mode color feature in custom themes

### v0.9.5
- Added **"Auto See"** feature, which automatically triggers a See input command after every AI response or after a certain amount of turns
- Added **Story Card Analytics** feature, which provides intelligent feedback and information about your story card setup to find weakpoints and address them
- Added **Adventure Notes** feature, which allows you write down anything and everything you want to remember about your current adventure
- Added **"Auto Enable Scripts"** feature, which automatically retoggles the "Enable Scripts" option in the Scenario Creation page
- **Improved the design of the Popup UI** to include icons for each feature
- Added the ability to **customize your hotkeys** via the popup
- Added the ability to **customize input mode colors** via the popup
- **Improved Story Card Scanner** to be much faster and be able to handle more cards at once
- **Reorganized the Popup UI's feature content** to be more organized and easier to navigate
- Updated the Tutorial to include information about the new features
- Improved debug logs system for better troubleshooting
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

## Design System

### Stylization Standard

BetterDungeon follows a dark mode design system for consistency. All variables are defined in `core/theme-variables.css`.

### Color Palette

#### Backgrounds
| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#0d0d0f` | Deepest background |
| Secondary | `#16161a` | Cards, panels |
| Tertiary | `#1e1e24` | Nested cards, hover states |
| Elevated | `#252530` | Inputs, raised elements |

#### Text
| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#e8e8ec` | Main content |
| Secondary | `#a0a0a8` | Descriptions |
| Muted | `#6b6b75` | Hints, disabled |

#### Brand
| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#ff9500` | Accents, primary actions |
| Secondary | `#e07800` | Hover states |
| Light | `#ffb84d` | Highlights |

#### Input Modes
| Mode | Color | Hex |
|------|-------|-----|
| Do | Blue | `#3b82f6` |
| Try | Purple | `#a855f7` |
| Say | Green | `#22c55e` |
| Story | Amber | `#fbbf24` |
| See | Pink | `#ec4899` |
| Command | Cyan | `#06b6d4` |

#### Status
| Status | Hex |
|--------|-----|
| Success | `#22c55e` |
| Error | `#ef4444` |
| Warning | `#f59e0b` |
| Info | `#3b82f6` |

### Typography

**Font Stack:**
- Primary: `'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- Monospace: `'Roboto Mono', 'Consolas', 'Monaco', 'Courier New', monospace`

**Sizes:** 10px (XS) → 12px (Base) → 14px (LG) → 18px (2XL) → 22px (3XL)

### Spacing

4px increments: `4px` (1) → `8px` (2) → `12px` (3) → `16px` (4) → `24px` (6) → `32px` (8)

### Border Radius

`4px` (SM) → `6px` (MD) → `8px` (LG) → `12px` (2XL) → `16px` (3XL)

### Shadows

| Size | Value |
|------|-------|
| SM | `0 1px 2px rgba(0,0,0,0.2)` |
| MD | `0 2px 8px rgba(0,0,0,0.3)` |
| LG | `0 4px 16px rgba(0,0,0,0.4)` |
| XL | `0 8px 32px rgba(0,0,0,0.5)` |

### Transitions

- Fast: `0.15s` — Hover states
- Normal: `0.2s` — Default
- Slow: `0.3s` — Complex animations

### Usage Example

```css
.my-component {
  background: var(--bd-card-bg);
  border: 1px solid var(--bd-card-border);
  border-radius: var(--bd-radius-lg);
  padding: var(--bd-space-4);
  transition: all var(--bd-transition-fast);
}
```

---

## Resources

### Icons

- **AI Dungeon Icons (w_icons)** — Use for features that integrate with AI Dungeon's UI
- **Lucide Icons** — Use for BetterDungeon-specific UI (popup, overlays)

The Lucide icon font is in `fonts/lucide/`. Browse icons at [lucide.dev/icons](https://lucide.dev/icons).

```html
<span class="icon-star"></span>
<span class="icon-user"></span>
<span class="icon-keyboard"></span>
```

---

### Accessibility Guidelines

- All interactive elements have visible focus states
- Text contrast meets WCAG AA
- Supports `prefers-reduced-motion`
- Semantic HTML for screen readers
