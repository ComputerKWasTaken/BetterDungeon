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
assert.match(feature, /role="alertdialog" aria-modal="true"/);
assert.match(feature, /renderToolTrail\(toolTrail, message\)/);
assert.match(feature, /data-nav-setting="changeMode"/);
assert.match(feature, /Automatic — apply edits immediately \(Recommended\)/);
assert.match(feature, /Proposed changes — approve each change/);
assert.match(feature, /No changes — Navigator cannot make changes/);
assert.equal((feature.match(/type="radio" name="bd-navigator-change-mode"/g) || []).length, 3);
assert.match(feature, /value="automatic"[\s\S]*icon-zap/);
assert.match(feature, /value="proposed"[\s\S]*icon-badge-check/);
assert.match(feature, /value="none"[\s\S]*icon-ban/);
assert.doesNotMatch(feature, /<select[^>]*data-nav-setting="changeMode"/);
assert.match(feature, /modeLabels = \{ automatic: 'Automatic', proposed: 'Approval', none: 'No changes' \}/);
assert.doesNotMatch(feature, /changeModeBadge|bd-navigator-change-mode-badge|bd-navigator-setting-description/);
assert.doesNotMatch(feature, /data-nav-context-section|data-nav-setting="readOnly"|data-nav-setting="applyMode"/);
assert.doesNotMatch(feature, /createMessageAction|copyAssistantMessage|retryAssistantMessage|replaceFromUserMessage|navigator\.clipboard/);
assert.doesNotMatch(styles, /bd-navigator-(?:message-action|message-actions|edit-banner|context-sections|toggle-control)/);
assert.match(feature, /class="bd-navigator-inspection-back" aria-label="Back to chat"/);
assert.match(feature, /setInspectorOpen\(open/);
assert.match(feature, /if \(event\.key === 'Escape' && this\.inspectionPanel && !this\.inspectionPanel\.hidden\)/);
assert.match(feature, /createInspectionDisclosure\('Context sent'/);
assert.match(feature, /createInspectionDisclosure\('Conversation sent'/);
assert.match(feature, /createInspectionDisclosure\('Tool activity'/);
assert.match(feature, /createInspectionDisclosure\('Technical details'/);
assert.doesNotMatch(feature, /Copy round JSON|clipboard\.writeText/);
assert.match(styles, /\.bd-navigator-inspection-panel \{[\s\S]*flex: 1;[\s\S]*overflow: hidden/);
assert.match(styles, /\.bd-navigator-transcript\[hidden\],[\s\S]*\.bd-navigator-composer\[hidden\][\s\S]*display: none;/);
assert.match(styles, /\.bd-navigator-drawer\.bd-navigator-embedded \.bd-navigator-inspection-panel,[\s\S]*background: transparent;/);
assert.match(styles, /\.bd-navigator-change-toggle \{[\s\S]*grid-template-columns: repeat\(3/);
assert.match(styles, /\.bd-navigator-change-option input:checked \+ \.bd-navigator-change-segment/);
assert.doesNotMatch(styles, /bd-navigator-change-mode-badge|bd-navigator-setting-description/);
assert.match(styles, /\.bd-navigator-inspection-disclosure-heading \{[\s\S]*align-items: center/);
assert.match(styles, /\.bd-navigator-inspection-metrics \{[\s\S]*grid-template-columns: repeat\(2/);
assert.match(styles, /\.bd-navigator-tool-trail-region \{[\s\S]*grid-template-rows: 0fr;[\s\S]*transition: grid-template-rows 180ms ease/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.bd-navigator-tool-trail-region \{ transition: none; \}/);

console.log('Navigator settings integration contract tests passed');
