# Contributing to BetterDungeon

Hey! Thanks for being interested in BetterDungeon.

This project is a little unusual compared to a normal web app: the extension runs directly inside AI Dungeon, AI Dungeon can change underneath it, and a lot of the fun features are built around keeping those two systems talking to each other. Contributions that improve compatibility, polish an existing feature, or make Ultrascripts easier to use are all very welcome.

## Before you start

You will need:

- Git
- A Chromium-based browser for primary testing
- Firefox 109 or newer if you are testing the Firefox port
- A basic understanding of JavaScript, browser extensions, and DOM-based interfaces
- An AI Dungeon account for testing features in a real adventure

There is currently no package manager, build tool, or dependency installation step for the extension itself. The repository can be loaded directly as an unpacked extension.

## Run BetterDungeon locally

### Chromium

1. Fork and clone the repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository folder.
5. Open [AI Dungeon](https://play.aidungeon.com/) and test your change.
6. After editing, return to the extensions page and click **Reload**.

### Firefox

1. Fork and clone the repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**.
4. Select the repository's `manifest.json` file.
5. Open [AI Dungeon](https://play.aidungeon.com/) and test your change.
6. Click **Reload** in Firefox's debugging page after editing.

When testing, try both the popup and the content-script experience. A feature can look correct in one context and still fail in another.

## How the project is organized

```text
BetterDungeon/
├── manifest.json              Extension metadata and script loading order
├── main.js                    Content-script entry point and feature startup
├── background.js              Background worker and cross-context messaging
├── popup.html/js/css          Settings popup and feature controls
├── styles.css                 Main injected styles
├── core/                      Shared lifecycle and theme systems
├── features/                  Self-contained user-facing features
├── services/                  AI Dungeon, GraphQL, caching, and bridge services
├── modules/                   Permission-gated Ultrascripts modules
├── utils/                     Storage, DOM, browser, and Markdown helpers
├── examples/                  Ultrascripts starter templates and examples
├── tests/                     Ultrascripts verification notes and test material
├── icons/                     Extension icons
└── fonts/                     Local fonts and icon assets
```

### A few important patterns

- `main.js` is the main content-script entry point.
- `background.js` handles background work, API requests, routing, and communication across extension contexts.
- `core/feature-manager.js` controls feature registration and lifecycle.
- Files in `features/` should own their setup, observers, UI changes, and cleanup.
- Files in `services/ultrascripts/` implement the communication pipeline between AI Dungeon scripts and BetterDungeon.
- Files in `modules/` handle individual permission-gated operations exposed through Ultrascripts.

Most features follow the same lifecycle shape:

```javascript
class MyFeature {
  static id = 'my-feature';

  init() {
    // Set up listeners, observers, and UI.
  }

  destroy() {
    // Remove everything created by init().
  }
}
```

If a feature adds an observer, event listener, timer, or injected element, it should also clean that resource up in `destroy()`. This matters because BetterDungeon can enable and disable features without reloading the page.

## Adding a feature

1. Create the feature in `features/` using the existing naming style.
2. Register it in the loading order in `manifest.json` if it needs to be loaded by the content script.
3. Add its setting or toggle to `popup.html` and connect the control in `popup.js`.
4. Reuse existing helpers in `utils/`, `core/`, and `services/` instead of creating a second version of the same system.
5. Keep feature state scoped and clean up all resources in `destroy()`.
6. Test with the feature enabled and disabled, then reload the extension and test again.

For changes that touch AI Dungeon's UI or network behavior, test against the current live site and document any assumptions in the pull request. Those assumptions are often the first thing that breaks when AI Dungeon ships an update.

## Working on Ultrascripts

Ultrascripts is permission-gated by design. New modules should:

- Request only the permissions they actually need.
- Validate incoming script data before using it.
- Fail clearly when BetterDungeon, a capability, or user consent is unavailable.
- Avoid leaking API keys or other sensitive values into story text, logs, or messages.
- Keep external requests and paid AI calls explicit, bounded, and easy for users to understand.
- Preserve graceful fallback behavior for scripts that can still function without Ultrascripts.

The `examples/aid-scripts/` directory contains two starting points:

- `ultrascripts-starter-template` for scripts that should degrade gracefully.
- `ultrascripts-required-template` for scripts that cannot function without BetterDungeon.

Please keep the `bd.us` helper surface consistent unless a module-specific change genuinely requires otherwise.

## Testing checklist

Before opening a pull request, please check the parts relevant to your change:

- [ ] The extension loads without console errors.
- [ ] The feature works on an active AI Dungeon adventure.
- [ ] The feature can be disabled without leaving observers, timers, or UI behind.
- [ ] The popup still opens and saves settings correctly.
- [ ] Chromium behavior is verified.
- [ ] Firefox behavior is verified when the change touches browser APIs or compatibility code.
- [ ] Permission-gated features handle denial and unavailable capabilities cleanly.
- [ ] No API keys, tokens, personal data, or generated secrets are committed.
- [ ] Documentation and examples are updated when behavior or public APIs change.

There is no automated build command at the moment, so manual browser testing is especially important.

## Pull requests

A good pull request should explain:

- What changed and why.
- Which AI Dungeon surfaces or extension contexts it touches.
- How you tested it.
- Whether the change affects existing settings, scripts, or permissions.
- Any screenshots or short recordings that make a UI change easier to review.

Please keep pull requests focused when possible. A small, well-explained change is much easier to test and merge than a giant cleanup mixed with unrelated feature work.

## Reporting bugs and suggesting features

Before opening an issue, check whether it already exists. When reporting a bug, include:

- Browser and browser version.
- BetterDungeon version.
- The AI Dungeon page or feature where it happened.
- Reproduction steps.
- Relevant console errors or screenshots, with private information removed.

Feature ideas are welcome too. Tell me what problem you are trying to solve and how you imagine the feature fitting into the AI Dungeon experience.

## A final note

BetterDungeon is built by one person, but it has grown because people keep testing it, suggesting ideas, and building alongside it. Thank you for taking the time to contribute.

Much love.

— computerK
