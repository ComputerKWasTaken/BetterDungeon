# Contributing to BetterDungeon Mobile

Android development now happens in the primary BetterDungeon monorepo. Start from `dev`, open this `android/` directory in Android Studio, and keep shared behavior in the repository root.

## Where changes belong

- Native Kotlin, resources, and Android configuration: `android/app/`
- Unique Android WebView adapters: `android/web/`
- Shared browser and Android behavior: the corresponding root file
- Injection order and source declarations: `android/betterdungeon-runtime.json`
- Offline checks and testing rules: `tests/` (see tests/README.md)

Do not copy the shared tree into `app/src/main/assets`. Gradle generates those assets for every build, and `InjectionEngine.kt` reads the generated runtime manifest.

When adding a unique Android adapter, declare it in the correct ordered runtime list and in `androidFiles`. Do not copy a shared path into Android: expose a native capability and keep the guarded variation in the shared implementation. The build deliberately fails when declarations, files, or paths drift.

## Verify changes

From the repository root:

```powershell
.\build.ps1 test
.\build.ps1 android
```

Also run the app on an Android 8.1+ device or emulator when behavior touches WebViews, navigation, permissions, native transports, or touch UI. Follow the [live testing checklist](../CONTRIBUTING.md#live-testing-checklist) in the root contributing guide.

## Safety and releases

- Validate all JavaScript-provided native bridge input.
- Keep permission failures predictable and graceful.
- Never expose provider keys, tokens, or broad native capabilities.
- Never commit `local.properties`, IDE state, build output, APKs, AABs, keystores, passwords, or signing configuration.
- Keep Android `versionName` equal to the browser manifest version. Increment `versionCode` independently when preparing signed releases.
- Publish signed APKs and version tags manually only after the commit has been promoted to `preview`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) and the [monorepo guide](../docs/MONOREPO.md) for the project-wide testing and branch workflow.
