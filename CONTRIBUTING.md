# Contributing to BetterDungeon

Developer documentation for contributors and maintainers.

---

## Future Additions

These are future additions to the extension that I want to implement, both before Early Access, at launch, and after.

### Most Likely Happening
- **Notes** - A feature that allows users to write in a notes section for their adventures
- **Automatic Model Selection** - A system added to the AI Dungeon that can automatically switch and select the best model for the user's needs, depending on their configuration.
- **Scenario/Adventure Folder Organization** - Group scenarios and adventures into collapsible folders for better management. (WARNING: This is an extensively difficult task from what I've experimented with.)
- **Adventure Statistics** — Track word count, turn count, and session duration for your adventures. Just for funsies.
- **Auto Enable Scripts** - A small QOL feature that automatically retoggles the "Enable Scripts" option in the Scenario Creation page.

### Considering
- **BetterScripts** - A system that allows AI Dungeon scripts to interface and interact with the extension, allowing for things like an "in game clock" with actual UI elements on the page, with a time management script.
- **Quick Actions Menu** — A floating action button with common actions that aren't typically present on the main Adventure page, like "Add Story Card", "Change Image Generator", etc.
- **Story Card Folder Organization** — Group story cards into collapsible folders for better management. In fact, just improve Story Cards overall. They lowkey reek.
- **Correction** - An action (not a story input action) next to Retry that allows the user to instruct and specify a story correction that gets sent to the AI. Instead of hitting Retry over and over again, the user can specify what is wrong with the output and the AI will retry with the correction. (The issue is that this may be impossible without adjusting the way AI Dungeon sends information to the AI. And due to the nature of how the DOM works and how Chromium handles what extensions can or can't do with websites, I don't think it's possible. Not only that, why not just use Command? It works the same way and is probably clearer to the AI over longer contexts.)

### Long-Term Ideas
- **Text to Speech** - Reads your story aloud with text to speech.
- **Background Music** - Plays background music while you play.
- **Customizable UI** - Let users customize the UI to their liking.

### Alternative Resource Ideas
- **BetterRepository** - A community-driven platform for sharing and discovering BetterDungeon resources like AI Instructions, plot components, story cards, scripts, etc. May also include BetterScripts.

---

## To-Do List

### 🔴 Urgent
<!-- Critical items blocking release or severely impacting users -->

### 🟠 High
<!-- Important features or improvements to prioritize -->

### 🟢 Low
<!-- Nice-to-have improvements when time permits -->

### 📋 Backlog
<!-- Future ideas and long-term goals -->

---

## Bug List

### 🔴 Urgent
<!-- Critical bugs causing crashes or data loss -->

### 🟠 High
<!-- Bugs significantly impacting user experience -->

### 🟢 Low
<!-- Minor bugs or edge cases -->

### 📋 Backlog
<!-- Known issues with workarounds or minimal impact -->

---

## Project Structure

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

## Architecture

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

## Adding New Features

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

## Stylization Standard

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
| Attempt | Purple | `#a855f7` |
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

## Icons

- **AI Dungeon Icons (w_icons)** — Use for features that integrate with AI Dungeon's UI
- **Lucide Icons** — Use for BetterDungeon-specific UI (popup, overlays)

The Lucide icon font is in `fonts/lucide/`. Browse icons at [lucide.dev/icons](https://lucide.dev/icons).

```html
<span class="icon-star"></span>
<span class="icon-user"></span>
<span class="icon-keyboard"></span>
```

---

## Accessibility

- All interactive elements have visible focus states
- Text contrast meets WCAG AA
- Supports `prefers-reduced-motion`
- Semantic HTML for screen readers
