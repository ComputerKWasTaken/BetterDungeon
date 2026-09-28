# AGENTS.md

Rules for AI coding agents working in this repository. Human contributor
guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md); read it for the project
layout, architecture conventions, and branch flow. This file only adds what
agents most often get wrong.

## Project in one paragraph

BetterDungeon is a browser extension (Chromium and Firefox) and an Android
WebView app for AI Dungeon, built from one source tree. The repository root
loads directly as an unpacked extension; `android/` is the Android Studio
project. Shared code lives at the root. See
[CONTRIBUTING.md](CONTRIBUTING.md#find-the-code) for where things are and
[docs/MONOREPO.md](docs/MONOREPO.md) for Android composition, branches, and CI.

## AI Dungeon reference

AI Dungeon reference documentation lives outside this repository, in
`../Project Management/docs/` (start at its `index.md`). It covers scripting,
context assembly, story cards, the GraphQL schema (`12-graphql-schema/`), the
DOM (`13-DOM/`), and release history.

- Check it before relying on AI Dungeon's DOM, GraphQL, or scripting behavior.
- Keep it accurate: when you confirm that AI Dungeon behaves differently from
  what it says (changed selectors, fields, or script behavior), update the
  relevant page in the same piece of work.

## Keep changes minimal

- Make the smallest change in the layer that owns the behavior. Do not refactor,
  rename, or reformat unrelated code in the same change.
- Follow the existing patterns in neighboring files. Reuse existing services and
  helpers instead of adding new layers, wrappers, or parallel paths.
- No speculative options, settings, flags, or extension points nobody asked for.
- Handle errors at real boundaries (storage, network, messaging, AI Dungeon DOM).
  Do not wrap every line in `try`/`catch` or add defensive checks for states
  that cannot happen.
- Write compact code, and do not add or remove comments unless asked.

## Testing

BetterDungeon is tested live, in a real AI Dungeon adventure.
[tests/README.md](tests/README.md) defines what may be committed as a test;
follow it exactly.

- Do **not** add test frameworks, npm dependencies, Playwright, DOM emulation,
  HTML harnesses, fake AI Dungeon pages, or regression suites.
- Do **not** add permanent tests to `tests/` unless they meet the criteria in
  [tests/README.md](tests/README.md). A test that only proves one bug is fixed
  is not permanent.
- You **may** write throwaway checks in `tests/scratch/` (gitignored, never run
  by the suite) to reproduce a bug or check an idea. Delete them once the work
  is done.

After a change:

1. Run `.\build.ps1 test`. Also run `.\build.ps1 extension` if packaging,
   the manifest, or `build/extension-files.txt` changed, and
   `.\build.ps1 android` if `android/` or the Android runtime manifest changed.
2. If the change affects runtime behavior, give the user a short, specific list
   of what to check live: which surfaces (Chromium, Firefox, Android, popup),
   which states, and what they should see. Skip it when nothing live changed.

## Docs

- When public behavior changes, update the existing guide that covers it
  (README, `docs/`, `examples/`, popup text).
- Do not create new Markdown files, plans, summaries, or changelogs unless asked.

## Git and releases

- You may commit finished work on `dev` (or the current topic branch). Keep
  commits focused.
- Never push, and never touch `preview` or `release`.
- Never bump versions (`manifest.json`, Android `versionName`/`versionCode`,
  popup version and What's New) unless asked.
- Never commit credentials, API keys, personal adventure content, signing
  material, or build output (`dist/`, `out/`, `.build/`, APKs).
