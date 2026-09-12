# BetterDungeon monorepo

BetterDungeon's browser extension and Android app are developed from this repository. The extension remains at the repository root so it can be loaded unpacked without a build. The complete Android Studio project lives in `android/`.

## Branches and releases

- `release`: source for the version published on the Chrome Web Store, Firefox Add-ons, and GitHub Releases. Initially this is the submitted v2.0.3 hotfix ZIP, recorded exactly with the v2.0.2 source commit as its parent. Store approval timing can differ; the branch records the common submitted release source, not per-store review status.
- `preview`: the newest tested build available for people who want updates before store publication. This is GitHub's default branch (formerly `stable`). A preview is not a promise that it has been published to stores.
- `dev`: daily development. Normal delivery flows `dev → preview → release`.

The manual **Promote preview** workflow validates an exact commit, runs the complete quality gate, and fast-forwards `preview`. It defaults to `dev`; a `maintenance/preview-*` branch based on current preview can be selected for an isolated hotfix without pulling in unfinished dev work. The target must be contained in the selected source and descend from the current preview head, both before validation and immediately before the push.

Preview's ruleset restricts updates/deletion and blocks force pushes. The existing promotion deploy key is its only bypass actor. The secret remains named `STABLE_DEPLOY_KEY` and the workflow file remains `promote-stable.yml` to preserve the existing credentials and dispatch identity after the rename; the displayed name and all branch references use preview. Normal CI remains read-only.

### Emergency hotfixes

1. Branch from `origin/release`, fix only the reported regression, and verify the published-version behavior. Update that branch's release version/notes and build the store packages.
2. Advance `release` to the source being submitted/published; create the corresponding version tag and GitHub Release with the actual artifacts. Store submission, approvals, and signed releases remain manual. Do not point release at unfinished v2.1 work.
3. Port the implementation commits to `maintenance/preview-<fix>` created from `origin/preview`. Keep the newer version metadata and unrelated features intact; cherry-pick the fix rather than merging the whole old package snapshot. Run **Promote preview** with that maintenance branch and exact SHA after review. This keeps the quality gate and fast-forward protections in place.
4. Merge `origin/preview` back into `dev` and resolve any overlap with ongoing work. Do not reset dev or replace it with release files.

For a normal release, finish and validate dev, promote the chosen commit to preview, then deliberately advance release to the published source. Because the initial release branch records an older package snapshot, reconcile its one-time snapshot/version differences when merging preview forward; retain preview's newer implementation and ensure the resulting package matches the release artifacts. Never force-push away hotfix history.

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

Playwright, DOM emulation packages, authenticated AI Dungeon checks, live canaries, emulator instrumentation, automatic store publishing, and signed-release automation are intentionally deferred.
