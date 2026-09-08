# BetterDungeon monorepo

BetterDungeon's browser extension and Android app are developed from this repository. The extension remains at the repository root so it can be loaded unpacked without a build. The complete Android Studio project lives in `android/`.

## Branches and releases

- `dev` is the default branch and normal workspace for contributors and agents.
- `stable` contains tested, release-ready commits.
- The manual **Promote stable** workflow validates an exact commit already contained in `dev`, confirms the update is a fast-forward, runs the complete quality gate, and then advances `stable`.
- Version tags and GitHub Releases are created manually after promotion. Chrome Web Store submission and signed Android releases remain manual.

The migration started from these recorded commits:

- BetterDungeon PC: `00c5c76315b2410bcee8b0f0e9a6416a78cf13ba`
- BetterDungeon Mobile: `352b7b1323d34e876d64318f06541a528e8cd78b`
- Mobile safety branch: `migration/monorepo-snapshot-2026-09-08`

The former BetterDungeon-Mobile repository remains the historical record and should be archived only after the first successful unified stable release.

## Source layout

```text
BetterDungeon/
├── manifest.json                    Browser extension manifest
├── core/, features/, modules/ ...   Shared browser and Android web code
├── android/
│   ├── app/                         Native Android application
│   ├── web/                         Mobile-only WebView files
│   ├── overrides/                   Intentional same-path Mobile variants
│   └── betterdungeon-runtime.json   Ordered Android composition manifest
├── tests/
│   ├── contracts/                   Shared public behavior
│   ├── unit/                        Focused helpers and repository policy
│   ├── platform/android/            WebView, bridge, and override behavior
│   ├── harness/                     Chrome, AI Dungeon, Android, and Ultrascripts mocks
│   └── fixtures/                    Deterministic test data
├── build/extension-files.txt        Extension package allowlist
└── build.ps1                        Unified local interface
```

`android/betterdungeon-runtime.json` is the only source of Android injection order. Gradle resolves ordinary paths from the repository root, Mobile-only paths from `android/web/`, and explicitly listed replacements from `android/overrides/`. It rejects missing, duplicate, or undeclared files and writes composed assets plus the runtime manifest under `android/app/build/generated/` before every Android build.

To add an Android-only file, place it under `android/web/` and declare it in both a runtime list and `mobileFiles`. To intentionally replace a root file on Android, place the same path under `android/overrides/` and declare it in `overrides`. Prefer moving generally useful fixes into the shared root file.

## Local commands

```powershell
.\build.ps1 test
.\build.ps1 extension
.\build.ps1 android
.\build.ps1 all
.\build.ps1 clean
```

The extension command uses the checked-in allowlist and creates `dist/BetterDungeon-<version>.zip`. The Android command runs local unit tests and `assembleDebug`, then creates `dist/BetterDungeon-Mobile-<version>-debug.apk`. The browser manifest version and Android `versionName` must match.

Open the `android/` directory in Android Studio for Sync, Run, Debug, and manual signed-release generation. Generated assets, packages, local SDK configuration, and signing material must never be committed.

## CI/CD boundary

The reusable quality gate runs on every push, every pull request, manual dispatches, and stable promotions. It uses Node.js 24, JDK 21, the checked-in Gradle wrapper, read-only permissions, SHA-pinned actions, and GitHub-hosted runners. Normal CI receives no repository secrets and does not publish releases or store builds.

Playwright, DOM emulation packages, authenticated AI Dungeon checks, live canaries, emulator instrumentation, automatic store publishing, and signed-release automation are intentionally deferred.
