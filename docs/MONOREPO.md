# BetterDungeon monorepo

BetterDungeon's browser extension and Android app are developed from this repository. The extension remains at the repository root so it can be loaded unpacked without a build. The complete Android Studio project lives in `android/`.

## Branches and releases

- `stable` is GitHub's default branch and the recommended public view of the repository. It contains tested, release-ready commits.
- `dev` is the normal workspace for contributors and agents. New work starts here even though it is not GitHub's default branch.
- The manual **Promote stable** workflow validates an exact commit already contained in `dev`, confirms the update is a fast-forward, runs the complete quality gate, and then advances `stable`.
- A dedicated write-enabled deploy key is available only to the promotion workflow; normal CI remains read-only and receives no repository secrets.
- Version tags and GitHub Releases are created manually after promotion. Chrome Web Store submission and signed Android releases remain manual.

This repository is the authoritative development and release history for both
surfaces. There is no separate Android source mirror or migration branch to
keep synchronized.

## Source layout

```text
BetterDungeon/
├── manifest.json                    Browser extension manifest
├── core/, features/, modules/ ...   Shared browser and Android web code
├── android/
│   ├── app/                         Native Android application
│   ├── web/                         Unique Android WebView adapters
│   └── betterdungeon-runtime.json   Ordered Android composition manifest
├── tests/
│   └── smoke/                       Minimal release-boundary checks
├── build/extension-files.txt        Extension package allowlist
└── build.ps1                        Unified local interface
```

`android/betterdungeon-runtime.json` is the only source of Android injection order. Gradle resolves shared paths from the repository root and unique `androidFiles` from `android/web/`. It rejects missing, duplicate, undeclared, unsafe, or colliding paths and writes composed assets plus the runtime manifest under `android/app/build/generated/` before every Android build.

Android capabilities come from the native bridge and are exposed to shared code through `window.BetterDungeonPlatform`. Put common behavior in the root implementation and guard only the touch, WebView, storage, or native behavior that truly differs. Add a file under `android/web/` only when it is a unique adapter with no browser implementation, then declare it in both an ordered runtime list and `androidFiles`. Android-only paths may not replace root paths.

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

The reusable quality gate runs on every push, every pull request, manual dispatches, and stable promotions. Its Node step runs only the repository smoke checks; extension packaging and the Android build provide the remaining baseline verification. It uses Node.js 24, JDK 21, the checked-in Gradle wrapper, read-only permissions, SHA-pinned actions, and GitHub-hosted runners. Normal CI receives no repository secrets and does not publish releases or store builds.

The quality gate is intentionally a build-and-policy safety net, not a comprehensive product test framework. Playwright, DOM emulation packages, authenticated AI Dungeon checks, live canaries, and emulator instrumentation are not planned. User-facing behavior is checked manually on the real browser and Android surfaces. Small deterministic tests may still be added when they protect a stable, high-value contract without recreating AI Dungeon.

Automatic store publishing and signed-release automation also remain out of scope; releases stay deliberate and manual.
