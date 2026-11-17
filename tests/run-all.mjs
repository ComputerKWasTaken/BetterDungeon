import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testsRoot = new URL('.', import.meta.url);
const smokeTest = fileURLToPath(new URL('smoke/repository-smoke.test.js', testsRoot));
const aiTest = fileURLToPath(new URL('smoke/ai-service.test.js', testsRoot));
const routinesTest = fileURLToPath(new URL('smoke/navigator-routines.test.js', testsRoot));
const navigatorTabTest = fileURLToPath(new URL('smoke/navigator-settings-tab.test.js', testsRoot));
const navigatorGqlTest = fileURLToPath(new URL('smoke/navigator-gql-shapes.test.js', testsRoot));
const updateCheckTest = fileURLToPath(new URL('smoke/update-check.test.js', testsRoot));
const characterPresetsTest = fileURLToPath(new URL('smoke/character-presets-audit.test.js', testsRoot));
const apolloBridgeTest = fileURLToPath(new URL('smoke/apollo-bridge.test.js', testsRoot));
const commandFeatureTest = fileURLToPath(new URL('smoke/command-feature.test.js', testsRoot));
const tryTest = fileURLToPath(new URL('smoke/try-feature.test.js', testsRoot));
const hotkeyTest = fileURLToPath(new URL('smoke/hotkey-feature.test.js', testsRoot));
const hotkeyEscapeTest = fileURLToPath(new URL('smoke/hotkey-escape-recursion.test.js', testsRoot));
const plotComponentsTest = fileURLToPath(new URL('smoke/plot-components-dom.test.js', testsRoot));
const triggerHighlightTest = fileURLToPath(new URL('smoke/trigger-highlight.test.js', testsRoot));
const inputModeColorTest = fileURLToPath(new URL('smoke/input-mode-color.test.js', testsRoot));
const storyCardAnalyticsTest = fileURLToPath(new URL('smoke/story-card-analytics.test.js', testsRoot));
const inputHistoryTest = fileURLToPath(new URL('smoke/input-history.test.js', testsRoot));
const customDynamicTest = fileURLToPath(new URL('smoke/custom-dynamic-router.test.js', testsRoot));
const commandAutoDeleteTest = fileURLToPath(new URL('smoke/command-auto-delete-toggle.test.js', testsRoot));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', smokeTest, aiTest, routinesTest, navigatorTabTest, navigatorGqlTest, updateCheckTest, characterPresetsTest, apolloBridgeTest, commandFeatureTest, tryTest, hotkeyTest, hotkeyEscapeTest, plotComponentsTest, triggerHighlightTest, inputModeColorTest, storyCardAnalyticsTest, inputHistoryTest, customDynamicTest, commandAutoDeleteTest], {
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
