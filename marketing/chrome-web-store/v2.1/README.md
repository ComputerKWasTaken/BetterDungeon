# BetterDungeon 2.1 Store images

Five 1280 × 800 screenshots pair real, fictional BetterDungeon UI captures with a headline, a short description, and optional feature chips or bullets. Captures sit in floating window frames (titlebar with label) at exact 1:1 pixels — never upscaled — on a layered dark backdrop with a warm accent glow. The 440 × 280 small tile and 1400 × 560 marquee tile share the same backdrop and are brand-led. Nothing in this directory ships with the extension.

| Order | Image | Focus |
| ---: | --- | --- |
| 1 | `01-more-from-every-adventure.png` | BetterDungeon at a glance |
| 2 | `02-navigator-and-routines.png` | Navigator and recurring Routines |
| 3 | `03-command-and-try.png` | Command and Try modes |
| 4 | `04-presets.png` | Character and Plot Presets |
| 5 | `05-make-it-yours.png` | Supporting tools and call to action |
| 6–7 | `06-small-promo.png`, `07-marquee-promo.png` | Brand identity |

## Edit and export

1. Change headlines, supporting copy, `chips` groups, `bullets`, `cta`, or capture references and titlebar labels in `slides.json`. Keep each screenshot focused on one idea. Per-layout frame positions, window heights, and image offsets are in `theme.css`; shared structure is in `template.html`.
2. Replace a capture in `captures/` with a sanitized image from the real product, and update its natural width/height and crop offset in `theme.css` so it still renders at 1:1. Do not include account information, API keys, private stories, or provider usage. Keep different screens in visibly separate frames; never present them as one fabricated interface.
3. From the repository root, run `powershell -NoProfile -File ./marketing/chrome-web-store/v2.1/render.ps1`. Use `-Only 03-command-and-try` to regenerate one image. The script uses installed Chrome or Edge and local assets only, and re-renders all seven images including the promo tiles. Source files carry a UTF-8 BOM so Windows PowerShell 5.1 reads the `—`, `·`, and `→` glyphs correctly; keep it when saving.
4. Open `.render/review.html` at 100% browser zoom. It displays screenshots at the Store's 640 × 400 presentation size. Check legibility, capture fidelity, and the absence of sensitive information before uploading.

Final PNGs live in `exports/`. `.render/` is ignored. Commit the source captures, editable files, and changed exports together. The source captures are deliberately close crops of genuine UI, while the surrounding text and framing are marketing design rather than simulated product UI.

Chrome's [screenshot guidance](https://developer.chrome.com/docs/webstore/images#screenshots) calls for actual extension experience, square corners, and 1280 × 800 or 640 × 400 images; it currently displays screenshots at 640 × 400. The canvases themselves have square corners; the rounded window frames are content inside them. These branded compositions use genuine product captures, but their text panels should be reviewed in the Developer Dashboard before treating them as approved Store screenshots. The two promotional tiles are separate assets. The same 1280 × 800 PNGs are suitable for Firefox Add-ons (AMO) screenshots, which accept any size and display captions separately.
