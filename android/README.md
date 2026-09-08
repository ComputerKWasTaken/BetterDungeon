# BetterDungeon Mobile

BetterDungeon Mobile is the Android WebView edition of BetterDungeon. Its native application, mobile-only web code, and intentional mobile variants live here, while shared JavaScript, CSS, fonts, icons, modules, and services live once at the repository root.

Navigator is an AI agent designed to help you improve and modify your adventures, with a touch-oriented interface and native streaming transport on Android.

The current application release is BetterDungeon Mobile v2.1.0.

Official APKs are published from the primary [BetterDungeon Releases](https://github.com/ComputerKWasTaken/BetterDungeon/releases) page. Debug APKs attached to GitHub Actions runs are development builds, not releases.

## Open in Android Studio

1. Clone the BetterDungeon repository and check out `dev`.
2. Open the repository's `android/` directory in Android Studio.
3. Let Gradle sync and download the declared Android dependencies.
4. Connect an Android 8.1+ device or start an emulator.
5. Run or debug the `app` configuration.

Android Studio builds need no asset-copy step. Gradle composes the WebView assets automatically before `preBuild`.

From the repository root, create the standard debug artifact with:

```powershell
.\build.ps1 android
```

The APK is copied to `dist/BetterDungeon-Mobile-<version>-debug.apk`. You can also run the checked-in Gradle wrapper directly from this directory. Use Android Studio's **Generate Signed Bundle / APK** flow for a manual signed release; never commit signing material or store-ready binaries.

## Web asset composition

- Shared files remain at the repository root.
- Mobile-only WebView files live in `android/web/`.
- Intentional replacements for root files live at matching paths in `android/overrides/`.
- `betterdungeon-runtime.json` declares injection order and every Mobile-only file or override.
- Generated assets and the manifest consumed by `InjectionEngine.kt` live under `app/build/generated/` and are ignored.

The build rejects missing sources, duplicate runtime entries, and undeclared Mobile files or overrides. See the repository's [monorepo guide](../docs/MONOREPO.md) for the complete layout and workflow.

## Development notes

The app hosts AI Dungeon in a main WebView and BetterDungeon settings in a secondary WebView. `BetterDungeonBridge.kt` connects JavaScript to native storage and transports; the WebView polyfill supplies compatible extension APIs. Mobile-specific behavior should stay narrow and should preserve the shared browser contracts whenever possible.

Run `../build.ps1 test` from this directory, or `./build.ps1 test` from the repository root, before submitting changes. Android platform contracts live under `tests/platform/android/` in the repository root.
