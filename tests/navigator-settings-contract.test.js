'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const feature = fs.readFileSync(path.join(ROOT, 'features', 'navigator_feature.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

assert.match(
  feature,
  /\[role="tablist"\]\[aria-label="Section Tabs" i\]/,
  'Navigator must match both Stable "Section Tabs" and Alpha "Section tabs" labels'
);
assert.match(feature, /GAMEPLAY_SETTINGS_SURFACE_ID = 'keyboard-field-reveal-scroll-surface-settings-gameplay'/);
assert.match(feature, /insertBefore\(wrapper, modelsTab\.parentElement\)/);
assert.doesNotMatch(feature, /event\.altKey[\s\S]*event\.key\?\.toLowerCase\(\) === 'n'/);
assert.match(feature, /hasPlotUILimitation[\s\S]*proposal\.field === 'memory'[\s\S]*proposal\.field === 'authorsNote'/);
assert.match(feature, /hasPlotUILimitation && proposal\.status === 'applied'/);
assert.match(feature, /Plot Essentials and Author's Note changes don't update the UI due to technical limitations\./);
assert.match(feature, /bd-navigator-proposal-refresh/);
assert.match(feature, /refresh\.addEventListener\('click', \(\) => window\.location\.reload\(\)\)/);
assert.match(styles, /\.bd-navigator-proposal-refresh[\s\S]*text-decoration: underline/);
assert.match(styles, /\.bd-navigator-proposal-value pre \{[\s\S]*display: block;[\s\S]*min-width: 0;[\s\S]*max-width: 100%/);
assert.doesNotMatch(styles, /\.bd-navigator-markdown code \{[\s\S]*box-decoration-break: clone/);

console.log('Navigator settings integration contract tests passed');
