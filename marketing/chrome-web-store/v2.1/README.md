# Chrome Web Store artwork — BetterDungeon 2.1

Five large-type capability illustrations, a small promotional tile, and a marquee tile. They use the local BetterDungeon star, IBM Plex Sans, and dark/amber palette. No captured account or adventure imagery is used; no marketing code or images ship in the extension ZIP.

## Update the set

1. Edit `slides.json` to change a headline, supporting line, three labels, or the `visual` layout (`journey`, `branch`, `world`, `dialogue`, `customize`). Keep headlines to six words or fewer. Shared colors and geometry live in `theme.css`; structure is in `template.html`.
2. Run `./marketing/chrome-web-store/v2.1/render.ps1` from the repository root. Add `-Only 02-shape-the-story-your-way` to export just one image. The script uses installed Chrome or Edge, repository-local assets, and no downloaded libraries or network services.
3. Inspect `.render/review.html` at 100% zoom to judge the five illustrations at the Store's 640×400 display size. Commit source and changed PNGs together.

The rendered images are in `exports/`. `.render/` is an ignored local workspace. The two promo tiles are brand-led compositions designed for their respective sizes.

## Important Store distinction

These five illustrations intentionally favor legibility over miniature UI captures. They are **not actual product screenshots**. [Chrome's image guidance](https://developer.chrome.com/docs/webstore/images) says the screenshot slots should demonstrate the actual extension experience. Treat the illustrations as a design proposal, not guaranteed compliant screenshot uploads. The promo tiles are the appropriate place for fully conceptual branding. If the Store requires literal screenshots, use close, readable captures of one real UI area per image rather than shrinking an entire interface.

## Exports

| Image | Size | Concept |
| --- | --- | --- |
| `01-more-from-every-adventure.png` | 1280×800 | Play, create, explore |
| `02-shape-the-story-your-way.png` | 1280×800 | Player-directed story |
| `03-keep-your-world-in-focus.png` | 1280×800 | People, places, ideas |
| `04-get-help-as-you-play.png` | 1280×800 | Assistance beside play |
| `05-make-it-yours.png` | 1280×800 | Personalization |
| `06-small-promo.png` | 440×280 | Brand mark and wordmark |
| `07-marquee-promo.png` | 1400×560 | Wide brand composition |
