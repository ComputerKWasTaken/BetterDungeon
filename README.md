# ![BetterDungeon Icon](icons/icon16.png) BetterDungeon

<div align="center">

**AI Dungeon, but with a whole lot more control.**

An all-in-one browser extension for AI Dungeon that adds quality-of-life improvements, powerful scenario tools, and features I genuinely wished the game had built in.

[![Version](https://img.shields.io/badge/version-2.0.0-7c3aed?style=for-the-badge)](manifest.json)
[![License](https://img.shields.io/github/license/computerkwastaken/BetterDungeon?style=for-the-badge)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/betterdungeon/ppliljfopejamemejnnchehpbacpebjf)

</div>

> BetterDungeon is built for players, scenario creators, and scripters who want to push AI Dungeon a little further.

## What is BetterDungeon?

Hey everyone, it's computerK here. BetterDungeon is my attempt to turn AI Dungeon into a more flexible, more personal, and honestly just more fun writing platform.

It started as a collection of small quality-of-life features. It has grown into a full ecosystem of tools for input, formatting, scenario building, automation, and script-to-extension communication. Whether you want cleaner formatting, smarter presets, a better way to manage Story Cards, or completely new capabilities inside your scripts, BetterDungeon is built to get out of your way and let you play.

The current release is **BetterDungeon V2**, which is the biggest version of the project so far. V2 introduced Ultrascripts, the Firefox port, the Android port, a major UI refresh, and a pretty serious rework of several original features.

## Install BetterDungeon

### Chrome, Edge, and other Chromium browsers

Install the official release from the [Chrome Web Store](https://chromewebstore.google.com/detail/betterdungeon/ppliljfopejamemejnnchehpbacpebjf). It should also work in Chromium-based browsers that support Chrome extensions.

### Firefox

Install the official release from [Firefox Browser Add-ons](https://addons.mozilla.org). The extension requires Firefox 109 or newer.

For development builds, load the repository through `about:debugging#/runtime/this-firefox` and select `manifest.json` with **Load Temporary Add-on...**.

### Android

Android builds are distributed through the [GitHub Releases](../../releases) page when available. Download the latest APK, install it on your device, and launch BetterDungeon from there.

### Manual installation

1. Clone or download this repository.
2. Open `chrome://extensions/` in a Chromium-based browser.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the BetterDungeon directory.
5. Open [AI Dungeon](https://play.aidungeon.com/) and start playing.

## The feature lineup

### Make writing feel better

- **Markdown** — Add reliable formatting to generated text with six instruction presets designed for different writing styles.
- **Command Mode** — Send direct narrative instructions without cluttering the story. Subtle and OOC sub-modes are included.
- **Try Mode** — Add configurable, RNG-based action checks with live rolls, critical success, and critical failure margins.
- **Text to Speech** — Have new story text narrated using the voices available through your browser or device.
- **Adventure Notes** — Keep private notes attached to each adventure, saved locally in your browser.

### Take control of your input

- **Custom Hotkeys** — Remap common actions and input mode switches to the keys you prefer.
- **Input History** — Cycle through your previous 50 inputs with `Ctrl`/`Cmd` + `Up` and `Down`.
- **Input Mode Colors** — Give each action mode its own customizable color so you always know what you are about to send.

### Build better scenarios

- **Plot Presets** — Save and swap Plot Essentials, AI Instructions, and Author's Notes.
- **Character Presets** — Save character descriptions and use the Ultrascripts AI module to generate scenario prefill answers.
- **Story Card Scanner** — Quickly index Story Cards through AI Dungeon's GraphQL systems, including large scenarios.
- **Story Card Analytics** — Find card counts, overlapping triggers, empty descriptors, and other cleanup opportunities.
- **Trigger Highlighting** — See which Story Card keys are active directly in the View Context window.
- **Story Card Modal Dock** — Keep the adventure visible while editing Story Cards in a docked editor.

### Automate the boring bits

- **Custom Dynamic** — Configure a pool of generation models with weighted-random, round-robin, or avoid-last routing.
- **Auto See** — Automatically send See requests after a configurable number of turns.
- **Auto Enable Scripts** — Keep scenario scripts enabled when AI Dungeon tries to turn them off.

## Ultrascripts: the part I'm really excited about

Ultrascripts is BetterDungeon's two-way communication layer between the extension and AI Dungeon scripts. Instead of hiding protocol messages inside story text or relying on fragile DOM tricks, it exposes permission-gated modules that scripts can call directly.

That gives scenario creators access to things that normally live outside the scripting sandbox: interactive widgets, external model calls, real-world context, and more. BetterDungeon handles the transport, lifecycle, permissions, and fallback behavior so scripts can focus on what they are actually trying to do.

Available modules include:

| Module | What it enables |
| --- | --- |
| `ai` | Asynchronous Gemini requests for script-side logic |
| `widget` | RPG HUDs, stat bars, inventories, buttons, and status panels |
| `webfetch` | Consent-gated HTTP requests and basic web searches |
| `clock` | Local time, timestamps, offsets, and IANA timezones |
| `geolocation` | Consent-based approximate location data |
| `weather` | Current conditions and short-term forecasts |
| `system` | Screen, touch, browser, and battery information |
| `network` | Connection status, downlink, RTT, and data-saver state |
| `sdk` | Curated BetterDungeon state and configuration |

Check out the [Ultrascripts examples](examples/README.md) if you want to start building a script.

## Basic usage

1. Install BetterDungeon and open [AI Dungeon](https://play.aidungeon.com/).
2. Open the BetterDungeon popup from your browser toolbar or the in-game sidebar.
3. Enable the features you want to use.
4. If you want to use Gemini-powered features or script-side AI, configure your API key in the **Ultrascripts** settings.

Some Ultrascripts modules are permission-gated. BetterDungeon will ask for consent when a script needs access to sensitive capabilities such as location or external requests.

## For contributors

BetterDungeon is open source, and contributions are welcome. If you want to work on a feature, fix compatibility with AI Dungeon, or build an Ultrascripts example, start with the [contributing guide](CONTRIBUTING.md).

The project is intentionally dependency-light: there is no build step or package installation required for the extension itself. Load the repository as an unpacked extension, make your changes, and reload it in the browser.

## Support and feedback

- Found a bug? [Open an issue](../../issues/new/choose).
- Have an idea? [Open a feature request](../../issues/new).
- Want to discuss the project? Find me on Discord at `@computerK`.
- Want to support continued development? [Visit my Ko-fi page](https://ko-fi.com/computerk).

If BetterDungeon makes AI Dungeon more enjoyable for you, I would love to hear what you are building with it.

---

**Made with love for the AI Dungeon community.**

— computerK
