# Chrome Web Store artwork — BetterDungeon 2.1

Five UI-led screenshots, a small promotional tile, and a marquee tile. The screenshots show real BetterDungeon 2.1 in two fictional AI Dungeon adventures: **The Lantern Archive** and **The Glass Station**. The artwork does not ship in the extension ZIP.

## Update the set

1. Edit the headlines and local capture paths in `slides.json`. Keep screenshot headlines to six words or fewer. The layout and brand colors live in `theme.css` and `template.html`.
2. For a new screenshot, use the actual shipped extension in a clean fictional adventure. Capture a stable UI state with no menus in transition, private adventures, account details, API keys, or provider dashboards. Put the sanitized screenshot in `captures/` and point the slide at it. The editable captures are committed; unreviewed originals go in ignored `raw/`.
3. Run `./marketing/chrome-web-store/v2.1/render.ps1` from the repository root, or run it with `-Only 02-shape-the-story-your-way` to update a single image. The script uses an installed Chrome or Edge and no downloaded tools, packages, or network assets. If needed, specify `-BrowserPath 'C:/path/to/chrome.exe'`.
4. Inspect `.render/review.html` at 100% zoom: screenshots display at the Store's 640×400 viewing size. Check all final `exports/*.png` images at their full size, too. Commit changed captures and exports together.

The two tiles share the same local logo and typography but have layouts specific to their dimensions. Every export uses the repository's IBM Plex Sans font and icon. `.render/` is an ignored, disposable local workspace; `exports/` is the upload-ready set.

## Current exports

| Image | Size | Real UI subject |
| --- | --- | --- |
| `01-more-from-every-adventure.png` | 1280×800 | Story and fictional Story Cards |
| `02-shape-the-story-your-way.png` | 1280×800 | Input choices in The Glass Station |
| `03-keep-your-world-in-focus.png` | 1280×800 | Plot Essentials beside the story |
| `04-get-help-as-you-play.png` | 1280×800 | Real Navigator chat during play |
| `05-make-it-yours.png` | 1280×800 | Editable Routine in The Glass Station |
| `06-small-promo.png` | 440×280 | Brand mark and wordmark |
| `07-marquee-promo.png` | 1400×560 | Wider brand composition |

These are Chrome Web Store listing assets, not extension runtime assets. The renderer is local-only and is excluded by the extension's checked-in package allowlist.
