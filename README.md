# ![BetterDungeon Icon](icons/icon16.png) BetterDungeon

An all-in-one browser extension and mobile app for AI Dungeon that enhances the experience with QOL additions and brand new features.


## Installation

### Chrome Web Store (Recommended for Chrome/Edge/Opera)

1. Visit the [Chrome Web Store](https://chromewebstore.google.com/detail/betterdungeon/ppliljfopejamemejnnchehpbacpebjf)
2. Click **"Add to Chrome"**
3. You're in!

### Firefox Add-ons Store (Official Release)

1. Visit the [Firefox Browser Add-ons Store](https://addons.mozilla.org) and search for **BetterDungeon**
2. Click **"Add to Firefox"**
3. You're in! No more reloading temporary add-ons.

*(For developers loading manually in Firefox: open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on...", and select `manifest.json` inside the repository).*

### Android Native App (APK)

Take BetterDungeon on the go with my native mobile port!
1. Navigate to the [Releases](../../releases) tab on GitHub or check the pins in our thread.
2. Download the latest native `.apk` file.
3. Install the APK on your Android device (ensure "Install from Unknown Sources" is toggled on in your device settings).
4. Launch the application and play AI Dungeon on your phone with all premium extension features pre-loaded.

### Manual Developer Install (Chromium)

1. Clone or download this repository.
2. Open Chrome or any Chromium-based browser and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right.
4. Click **"Load unpacked"** and select the `BetterDungeon` directory.
5. You're in!

---

## Features

### 🎮 Input Modes
- **Command Mode**: Direct narrative commands to steer your story (e.g., `## Skip forward to nightfall`) without cluttering story text. Includes **Subtle** (brackets) and **OOC** (out-of-character AI chat) sub-modes via arrow keys.
- **Try Mode**: RNG-based action checks with live dice rolling. Configure critical hit/fail margins (0-20%) and watch the success bar change dynamically.

### 🧭 Control & Navigation
- **Custom Hotkeys**: Remap any game action (Continue, Erase, Retry, Mode switches) to keyboard keys.
- **Input History**: Press `Ctrl + Up/Down` inside the input box to cycle through your last 50 actions.
- **Input Mode Colors**: Color-code the input box border automatically based on your current action mode. Fully customizable hex color palettes!

### ✨ Writing & Formatting
- **Markdown Support**: Render formatted headers and styling safely without AI Dungeon stripping your formatting. Includes 6 custom instruction presets to align generation behaviors.
- **Adventure Notes**: An embedded notes card built directly inside the Plot Components section that saves locally per adventure.
- **Text to Speech**: Narrates incoming story text out loud like a custom audiobook. Adjust volume, pitch, speed, and select from any of your system's natural browser voices.

### 📋 Presets
- **Plot Presets**: Save custom Plot Essentials, AI Instructions, and Author's Notes to quickly swap configurations. Works perfectly alongside BetterRepository!
- **Character Presets**: Save character sheets and descriptions. Integrated with my Gemini module to **automatically write scenario prefill answers** for you!

### 🔧 Scenario Building
- **Trigger Highlighting**: Highlights activated story card keys in cyan with dashed underlines inside the View Context window.
- **Story Card Scanner**: Rebuilt using a GQL-optimized backend to instantly scrape, index, and highlight story cards, scaling easily to scenarios with 500+ cards.
- **Story Card Analytics**: Instantly check card count, overlapping triggers, empty descriptors, or layout optimizations.
- **Story Card Modal Dock**: Docks the editor modal to the right margin of your screen so you can inspect your adventure log while editing cards.

### ⚡ Automations
- **Custom Dynamic**: Build your own pool of generation models. Route requests via *weighted-random*, *round-robin*, or *avoid-last* mode selection. (Directly inspired by Zoocata's PRISM extension).
- **Auto See**: Automatically sends background image generation actions after a set number of turns.
- **Auto Enable Scripts**: Auto-retoggles the "Enable Scripts" box in the Scenario Creator to prevent unintentional script shutdowns.

---

## 📡 The Ultrascripts Subsystem

Ultrascripts is my next-generation extension-to-script communication pipeline. Instead of messy DOM scraping or injecting context-eating zero-width spaces, Ultrascripts exposes native, permission-gated modules to scenario scripts.

- **`ai` (Gemini API)**: Query Gemini models asynchronously inside scripts for auxiliary logic. Also powers character prefill!
- **`widget` (Interactive UI)**: Renders custom RPG HUDs, stats bars, inventory tables, and status meters outside the text log. Supports mobile and collapsible panels.
- **`webfetch`**: Perform consent-gated HTTP GET requests and basic web searches on user-approved domains.
- **`clock`**: Ground your story with the user's real-world local time, ISO timestamps, offsets, and IANA timezone parameters.
- **`geolocation`**: Consent-based lookup of approximate coordinates to adapt the scenario to where the player is in real life.
- **`weather`**: Queries current weather conditions and short-term forecasts for coordinates or place names.
- **`system`**: Exposes screen size, Touch UI support, browser engines, and battery status to scripts.
- **`network`**: Inspect connection state details (downlink speeds, RTT, data-saver mode) to drop heavier tasks on slow connections.
- **`sdk`**: Exposes curated BetterDungeon extension state configurations.

---

## Usage

1. Head to [AI Dungeon](https://aidungeon.com) on desktop or launch the native Android package.
2. Click the **BetterDungeon** icon in the extensions toolbar (or sidebar) to configure features.
3. Configure your Gemini API key under the **Ultrascripts** tab to enable advanced features like character presets generation and script-driven AI.

---

## Support

- Found a bug? [Report it on GitHub](../../issues)
- Have an idea? [Submit a feature request](../../issues/new)
- Technical questions? See [CONTRIBUTING.md](CONTRIBUTING.md)
- Community Discord contact: `@computerK`

**Made with ❤️ for the AI Dungeon community**
