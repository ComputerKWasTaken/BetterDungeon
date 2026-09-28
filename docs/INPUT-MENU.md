# Alpha input menu integration (v2.1.1)

Updated September 27, 2026 from a BetterDungeon-off Alpha capture and a live inspection of the open See menu. The current action bar is horizontal on desktop and mobile. Older layouts remain supported as fallbacks.

## Current Alpha layout

| Control | Selector / behavior |
| --- | --- |
| Closed mode pill | `[aria-label="Change input mode"]` |
| Open horizontal strip | Parent of native `[aria-label="Set to 'Do' mode"]`; own computed opacity is `1` |
| Writing modes | Do, Say, Story, Guide: `[role="button"][aria-label="Set to '…' mode"]` |
| Custom writing modes | Try after Do; Command after the last native writing mode, before See |
| Media trigger | `[aria-label="See"][aria-haspopup="menu"]` at the end of the strip |
| Media menu | Portal `[role="menu"][aria-label="See"]`, linked through the trigger's `aria-controls` |
| Media choices | Image and Video `[role="menuitemradio"]`, plus `Customize video…` `[role="menuitem"]` |
| Dismiss | Escape closes the See menu first; the strip's `Close 'Input Mode' menu` button closes the strip |

The `.gameplay-action-input-dock` has `data-mobile="true"` on narrow screens and may carry `aria-hidden="true"` even while the horizontal strip is visible. Check the strip's own opacity and display rather than an ancestor's `aria-hidden` value. The See menu is a separate portal; its Image and Video choices must never be included in the writing-mode list or mistaken for `Customize video…`.

`AIDungeonService` owns discovery and navigation: `getInputModeMenu()`, `getSeeMenuTrigger()`, `getSeeActionMenu()`, `openSeeActionMenu()`, `getGenerateButton()`, and `detectCurrentMode()`. Image and Video hotkeys open the writing strip, then See, then select the matching media choice. They do not submit an action. The collapsed pill changes to Image or Video when a media composer is selected, which drives the input-edge color. Do uses red rather than Video's indigo. The See button blends Image's cyan with Video's indigo into blue, and follows either color when customized.

## Older layouts

The previous wide layout had separate `Generate an image` and `Generate a video` buttons in the strip. The previous compact layout used a portal `[role="menu"][aria-label="Input mode"]` with Write and Create groups. A legacy strip had a See writing-mode button. The service still recognizes these; legacy See hotkey settings migrate to the Image action, and input history falls back to Story when a saved See mode is unavailable. AutoSee continues to use the backend image-generation flow.

Compact Radix menus use ArrowDown to open and Escape to dismiss. Their injected Try and Command entries need explicit focus/selection handling because cloned elements are outside Radix's internal collection. The current horizontal strip uses native role buttons and the shared custom-mode insertion path. Opening or dismissing either menu preserves an active Try or Command overlay; choosing another writing mode replaces it. Neither mode submits the input text on selection.

Try's chance controls and Command's style controls float above the input controller. The input-history chip uses the same surface on mobile-width layouts. Mode coloring targets the rounded input row, including while Image or Video composers are open.

## Verification

Run `node tests/run-all.mjs` and `./build.ps1 all`. Check the real Alpha bar and See menu on Chrome, Firefox, and Android before publishing because their DOM can change independently of BetterDungeon.
