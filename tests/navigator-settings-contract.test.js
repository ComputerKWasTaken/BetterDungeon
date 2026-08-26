'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const feature = fs.readFileSync(path.join(ROOT, 'features', 'navigator_feature.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const popup = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const tutorial = fs.readFileSync(path.join(ROOT, 'services', 'tutorial-service.js'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const navigatorDescription = /an AI agent designed to help you improve and modify your adventures/i;

for (const [name, source] of [['Navigator UI', feature], ['popup', popup], ['tutorial', tutorial], ['README', readme]]) {
  assert.match(source, navigatorDescription, `${name} must use Navigator's canonical description`);
}
assert.doesNotMatch(`${popup}\n${tutorial}`, /adventure-aware AI assistant|Your AI agent for improving/i);

assert.match(
  feature,
  /\[role="tablist"\]\[aria-label="Section Tabs" i\]/,
  'Navigator must match both Stable "Section Tabs" and Alpha "Section tabs" labels'
);
assert.match(feature, /GAMEPLAY_SETTINGS_SURFACE_ID = 'keyboard-field-reveal-scroll-surface-settings-gameplay'/);
assert.match(feature, /insertBefore\(wrapper, modelsTab\.parentElement\)/);
assert.match(feature, /createSettingsTabOverflowControls\(tablist\)/);
assert.match(feature, /tablist\.scrollBy\(\{ left: direction === 'right'/);
assert.match(feature, /tablist\.scrollWidth - tablist\.clientWidth/);
assert.match(feature, /_w-t-size-4--5[\s\S]*w_arrow_\$\{direction\}/);
assert.doesNotMatch(feature, /event\.altKey[\s\S]*event\.key\?\.toLowerCase\(\) === 'n'/);
assert.doesNotMatch(feature, /betterDungeon_navigator_(?:width|position)/);
assert.doesNotMatch(feature, /createLauncher\(\)/);
assert.match(feature, /class="bd-navigator-header-identity"[\s\S]*class="bd-navigator-mark icon-compass"[\s\S]*class="bd-navigator-title">Navigator/);
assert.match(feature, /this\.settingsTabPreferred = true/);
assert.match(feature, /if \(this\.settingsTabPreferred && !this\.settingsTabActive\)/);
assert.match(feature, /preservePreference: true/);
assert.match(feature, /hasPlotUILimitation[\s\S]*proposal\.field === 'memory'[\s\S]*proposal\.field === 'authorsNote'/);
assert.match(feature, /hasPlotUILimitation && proposal\.status === 'applied'/);
assert.match(feature, /Plot Essentials and Author's Note changes don't update the UI due to technical limitations\./);
assert.match(feature, /bd-navigator-proposal-refresh/);
assert.match(feature, /refresh\.addEventListener\('click', \(\) => window\.location\.reload\(\)\)/);
assert.match(styles, /\.bd-navigator-proposal-refresh[\s\S]*text-decoration: underline/);
assert.match(styles, /\.bd-navigator-proposal-value pre \{[\s\S]*display: block;[\s\S]*min-width: 0;[\s\S]*max-width: 100%/);
assert.doesNotMatch(styles, /\.bd-navigator-markdown code \{[\s\S]*box-decoration-break: clone/);
assert.doesNotMatch(
  styles,
  /\.bd-navigator-drawer\.bd-navigator-embedded\.bd-navigator-secondary-open \.bd-navigator-empty-(?:icon|text)[^{]*\{[^}]*display:\s*none/
);
assert.match(styles, /\.bd-navigator-drawer\.bd-navigator-embedded \.bd-navigator-composer \{[\s\S]*padding: 6px 0 10px/);
assert.match(styles, /\.bd-navigator-settings-tabs-arrow-right \{[^}]*right: -22px/);
assert.match(styles, /\.bd-navigator-settings-tabs-native-button \{[^}]*width: 36px;[^}]*height: 36px;[^}]*border-radius: 50%/);
assert.match(styles, /\.bd-navigator-settings-tabs-arrow \{[^}]*opacity: 0;[^}]*transition: opacity 160ms ease/);
assert.match(styles, /\.bd-navigator-settings-tabs-host:hover \.bd-navigator-settings-tabs-arrow/);
assert.match(styles, /\.bd-navigator-drawer\.bd-navigator-embedded \.bd-navigator-header-actions \{[^}]*margin-left: auto/);
assert.match(styles, /\.bd-navigator-mark \{[^}]*width: 30px;[^}]*height: 30px;[^}]*border-radius: 50%/);

console.log('Navigator settings integration contract tests passed');
