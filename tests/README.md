# BetterDungeon smoke checks

The current automated baseline is intentionally small. The test build command
runs only the repository smoke suite, which protects release version parity,
extension package boundaries, Android runtime source resolution, and the rule
against tracked build or signing output.

The Android build itself composes the runtime assets and runs its unit-test
task. Browser and device behavior are reviewed manually on the real product
surfaces.

Do not add broad regression suites, runtime simulators, fixtures, or ad-hoc AI
Dungeon scripts here. Add a deterministic test only when it is small, focused,
and protects a stable release boundary. A comprehensive Playwright, live DOM,
or authenticated AI Dungeon suite is deliberately not part of the project plan.
