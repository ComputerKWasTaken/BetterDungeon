# Ambience direction

Ambience is a possible post-v2.1 feature for continuous environmental audio during an adventure. It is separate from the Ultrascripts `audio` module: Ultrascripts provides bounded synthesized sound effects for scripts, while Ambience would be a player-controlled listening experience.

## What PRISM 2.0 demonstrates

PRISM 2.0.40 by Zoocata uses a capable two-layer engine for songs and ambience. Playback lives in the AI Dungeon content page so it survives closing the extension UI. Each layer has two audio elements for optional crossfades, and supports play/pause, previous/next, volume, and looping. Its automatic mode classifies recent scene text with local keyword rules, waits for a classification to stabilize, avoids recent repeats, and keeps an environmental ambience track when only the scene's mood changes.

This is useful design evidence, but importing it directly would work against BetterDungeon's current goals:

- PRISM's bundled catalog contains 70 tracks and is approximately 195 MB, before the rest of the extension.
- Imported audio is stored as data URLs and motivates PRISM's `unlimitedStorage` permission.
- Ten supplied ambience tracks are explicitly marked as not independently license-verified in PRISM's audio notice.
- PRISM's source license permits reuse with its license and visible attribution to Zoocata. BetterDungeon has not copied that source.
- The dual-layer player, import library, crossfading, scene classifier, and large settings surface are more machinery than a first BetterDungeon version needs.

## Recommended first version

Keep the feature deliberately small:

1. Ship one ambience layer, disabled by default.
2. Put selection, play/pause, stop, volume, and loop controls in the BetterDungeon popup.
3. Keep the actual audio element and playback state in the shared content runtime so playback survives popup closure on browser and Android.
4. Require an explicit user action before playback. Automatic scene changes must never begin audio on their own.
5. Store only small settings and track metadata in extension storage; do not store large data URLs in sync storage.
6. Add automatic scene matching, crossfades, music layering, and user imports only if the simple player proves worthwhile.

## Decision needed before implementation

The audio source determines the footprint, permissions, licensing work, offline behavior, and Android compatibility. Choose one of these before implementation:

- a small, independently verified and properly credited bundled ambience pack for reliable offline use; or
- user-selected local files or remote URLs, which keeps the package small but adds persistence, permission, and availability tradeoffs.

Do not copy PRISM's audio catalog based only on its existing notice. Verify every redistributed asset from its original source and preserve the required attribution. If BetterDungeon later derives substantial implementation code from PRISM, include PRISM's license and visible credit to Zoocata.
