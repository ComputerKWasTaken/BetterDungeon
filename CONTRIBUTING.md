# Contributing to BetterDungeon

Hey! Thanks for being interested in BetterDungeon.

This project is a little unusual compared to a normal web app: the extension runs directly inside AI Dungeon, AI Dungeon can change underneath it, and a lot of the fun features are built around keeping those two systems talking to each other. Contributions that improve compatibility, polish an existing feature, or make Ultrascripts easier to use are all very welcome.

## Contribution permissions

BetterDungeon is source-available under the [BetterDungeon License](LICENSE). You may modify and build it privately. Public source forks, patches, and pull requests are also allowed solely to prepare, submit, and review contributions to the official project. Identify your fork as unofficial and preserve the license and attribution notices.

This contribution exception does not authorize independent releases or sharing binaries and installable packages. Keep your test builds private; do not publish fork releases or make fork CI build artifacts available to others without prior written consent from computerK. Other redistribution, even of unchanged free copies, and selling or charging for access to BetterDungeon also require prior written consent. You can share links to official downloads instead.

You retain ownership of your contributions. By intentionally submitting material for inclusion, you grant computerK the perpetual, irrevocable, worldwide, nonexclusive, royalty-free rights described in Section 3 of the license to use, modify, distribute, and sublicense it in official or authorized versions, including commercially and under different terms. Submit only material you have authority to contribute, and identify third-party material and its license; its existing terms still apply.

Files in `examples/` remain MIT-licensed under Section 8, and contributions to that directory are also provided under those MIT terms. This section summarizes the [full license](LICENSE), which controls. For permission requests, contact `@computerK` on Discord.

## Before you start

You will need:

- Git
- Node.js 24 LTS for the repository smoke checks
- A Chromium-based browser for primary testing
- Firefox 109 or newer if you are testing the Firefox port
- Android Studio with JDK 21 and the Android SDK when changing Mobile
- A basic understanding of JavaScript, browser extensions, and DOM-based interfaces
- An AI Dungeon account for testing features in a real adventure

The test stack has no npm dependencies. The repository root can still be loaded directly as an unpacked extension.

GitHub shows `preview` by default because it is the public, release-ready branch. Start normal work from `dev`. `preview` advances only through the **Promote preview** GitHub Actions workflow after the complete quality gate passes.

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
├── utils/                     Storage, DOM, and browser helpers
├── examples/                  Ultrascripts starter templates and examples
├── android/                   Android Studio project and unique WebView adapters
├── build/                     Checked-in extension packaging allowlist
├── tests/                     Minimal Node repository smoke checks
├── build.ps1                  Unified test and artifact entry point
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

## Automated checks

Run the intentionally small zero-dependency baseline with `./build.ps1 test`. It checks release version parity, the shared platform contract, extension package boundaries, Android runtime composition, and forbidden tracked output. The project deliberately relies on focused manual browser and device checks instead of maintaining a comprehensive Playwright or live-DOM framework.

Every push and pull request runs the Node suite, verifies the extension ZIP, runs Android unit tests, and builds a debug APK. Successful workflow runs retain both downloadable artifacts for 14 days. Tests must use mocks and fixtures rather than real AI providers or AI Dungeon requests.

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

Before submitting work, run `./build.ps1 all`. Manual browser or device testing is still important for UI behavior that the contract suites cannot observe.

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
