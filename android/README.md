# BetterDungeon Mobile

BetterDungeon Mobile is the Android WebView edition of BetterDungeon. Its native application and unique WebView adapters live here, while shared JavaScript, CSS, HTML, fonts, icons, modules, and services live once at the repository root.

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
- Unique Android WebView adapters live in `android/web/`.
- `betterdungeon-runtime.json` declares injection order and every `androidFiles` entry.
- Generated assets and the manifest consumed by `InjectionEngine.kt` live under `app/build/generated/` and are ignored.

The build rejects missing sources, duplicate runtime entries, undeclared Android files, and Android files that collide with shared root paths. See the repository's [monorepo guide](../docs/MONOREPO.md) for the complete layout and workflow.

## Development notes

The app hosts AI Dungeon in a main WebView and the shared BetterDungeon settings popup in a secondary WebView. `BetterDungeonBridge.kt` declares platform capabilities and connects JavaScript to native storage and transports; `window.BetterDungeonPlatform` scopes touch and WebView behavior inside shared files.

Run `../build.ps1 test` from this directory, or `./build.ps1 test` from the repository root, before submitting changes. The intentionally small repository smoke suite also checks Android composition boundaries.
