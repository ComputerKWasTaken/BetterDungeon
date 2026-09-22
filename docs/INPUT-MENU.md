# Alpha input menu integration (v2.1.0)

Updated September 12, 2026 from supplied desktop/mobile DOM captures and a live Alpha menu inspection. The captures had BetterDungeon enabled; do not mistake injected nodes for native UI. This contract supersedes the older four-mode / numeric-ID input-menu notes.

## Two layouts, one service

| Surface | Desktop, wider than 700px | Compact, 700px or narrower |
| --- | --- | --- |
| Trigger | `[aria-label="Change input mode"]` | Same label, plus `aria-haspopup="menu"` |
| Menu | Parent of native `[aria-label="Set to 'Do' mode"]` | Portal `[role="menu"][aria-label="Input mode"]` |
| Text modes | Role button, `Set to '…' mode` labels | Role menuitemradio, SVG and bare text |
| Writing section | Do, Say, Story, Guide | Write group: Do, Say, Story, Guide |
| Media actions | `Generate an image`, `Generate a video` | Create group: Image, Video |
| Dismiss | `Close 'Input Mode' menu` | Escape (or native outside dismissal) |

The compact menu also has a separate **Customize video…** item. Image and Video are one-shot actions, not text input modes. The backend image action may still be named `see`; that does not imply a See selector exists. Legacy UI with a real See button is still supported.

Use `AIDungeonService`, not numeric IDs, generated class names, globally matched radio items, or a hardcoded See end-cap:

- `getInputModeMenu()`, `isMobileModeMenu()`, `usesCompactInput()` discover the current layout. Compact controls also apply to the Android touch-controls capability.
- `getInputMenuEntryName(element)` resolves a scoped native/custom entry; `getModeButtonByName(name)` only resolves known text modes.
- `getAllModeButtons()` excludes Image/Video and supports future native writing-mode labels for anchoring. `getGenerateButton('image' | 'video')` is explicitly separate.
- `openModeMenu()` sends ArrowDown to the compact Radix trigger because a synthetic click alone does not open it. `closeModeMenu()` uses the correct native dismissal path.
- `detectCurrentMode()` normalizes Command's sub-mode labels to `command` and reports `image`/`video` while a media composer is open (pill label first, then the submit icon glyph, then the textarea placeholder). `switchToMode()` verifies the result and never treats media generation as a text-mode change.

## Injection and lifecycle

`injectCustomModeButton()` places Try after Do and Command after the last native writing mode, before the Create section. A correctly placed, correctly themed node is reused with **no structural mutation**. A move preserves identity and event handlers; a theme change can replace the clone. Both feature observers coalesce work into animation frames, with a 25-rewrites-per-two-seconds backstop per feature.

Compact clones discard SVG/text from the native template, selection indicators, IDs and Radix collection markers. BetterDungeon supplies its own icon, label, checked state and keyboard navigation because externally injected nodes are not registered in Radix's internal collection. Arrow keys/Home/End traverse all menu entries; Enter/Space activate custom items. Cleanup removes the owned handler when the last custom item is removed.

Try activates native Do; Command activates native Story. Opening/dismissing the selector or invoking a media action does not itself cancel either overlay. Selecting another writing mode cancels it. Activation timers are cancelled during teardown, and active controls recover after input DOM replacement or desktop/compact layout changes. Input text is not submitted by selecting a mode.

## Mode controls and colors

Try's success-chance controls and Command's style controls share one floating pill design on every layout: right-docked above `#game-text-input-controller`, **not** inside its overflow-clipped textarea row — 32px round buttons, compact uppercase labels, focus outlines and live value announcements. ↑/↓ still adjust while the textarea has focus (the pill's tooltip notes this). The action dock reserves 44px above the controller while a pill exists (84px when the history chip is raised above it). The input-history chip reuses the same pill surface on the same right edge and floats a step higher while a mode pill is open so the two never overlap; it appears only while the compact input layout is active (`usesCompactInput()` — mobile-width menus and Android). Try clamps to 5–95% in five-point steps and disables controls at the limits. Command cycles Standard, Subtle and OOC. Neither overlay auto-reverts on a timer — they stay active until the user submits or picks a native mode.

Colors distinguish Image (cyan) and Video (indigo), including edge borders around the input box while their composers are open. Mode coloring targets the visible rounded input row (`getInputContainer()`), never the outer controller, and follows the box's own border-radius. Saved See colors migrate to Image; saved See hotkeys migrate to the Image action. Video is bound to `8` by default. The compact menu is styled as a native dropdown even when the desktop theme uses sprites. Input history containing a legacy See mode falls back to Story when See is unavailable, without generating an image. AutoSee retains its backend image-generation flow.

## Regression checks

Run `node tests/run-all.mjs` and `./build.ps1 all` for repository, extension-package and Android checks. Serve the repository on loopback and open `tests/browser/input-mode-menu.html` in a browser for real-DOM tests (no npm or DOM-emulation dependency). The fixture does not call AI Dungeon or generate media.

The browser suite exercises desktop, legacy See and compact menus: placement, repeated-observer stability, future-mode reanchoring, keyboard activation, colors, binding migration, overlay switching/dismissal, touch controls, history safety and cleanup. Use `?demo=try&width=320` or `?demo=command&width=390` for an interactive compact-control fixture. Also manually check widths around 700px, sprite themes, touch scrolling and a physical Android/Firefox device before publication; fixture coverage is not an end-to-end guarantee against future Alpha changes.
