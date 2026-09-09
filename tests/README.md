# BetterDungeon smoke checks

The current automated baseline is intentionally small. The test build command
runs only the repository smoke suite, which protects release version parity,
extension package boundaries, Android runtime source resolution, and the rule
against tracked build or signing output.

The Android build itself composes the runtime assets and runs its unit-test
task. Browser and device behavior are reviewed manually until a deliberate live
browser-testing baseline is designed and adopted.

Do not add broad regression suites, runtime simulators, fixtures, or ad-hoc AI
Dungeon scripts here. Future coverage should be introduced only with a clear
test strategy and a stable product baseline.
