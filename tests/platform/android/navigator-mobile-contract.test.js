'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ANDROID_ROOT, composeAndroidRuntime } = require('../../harness/android-runtime');

const APP_ROOT = ANDROID_ROOT;
const ASSETS = composeAndroidRuntime();

function readAsset(relativePath) {
  return fs.readFileSync(path.join(ASSETS, relativePath), 'utf8');
}

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : !!force;
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
  };
}

function styleStore() {
  const values = new Map();
  return {
    height: '',
    setProperty(name, value) { values.set(name, value); },
    getPropertyValue(name) { return values.get(name) || ''; },
  };
}

function testStaticMobileContracts() {
  const feature = readAsset('features/navigator_feature.js');
  const styles = readAsset('styles.css');
  const session = readAsset('services/navigator/session.js');
  const tools = readAsset('services/navigator/tools.js');
  const popup = readAsset('popup.html');
  const tutorial = readAsset('services/tutorial-service.js');
  const readme = fs.readFileSync(path.join(APP_ROOT, 'README.md'), 'utf8');
  const activity = fs.readFileSync(
    path.join(APP_ROOT, 'app', 'src', 'main', 'java', 'com', 'computerk', 'betterdungeon', 'MainActivity.kt'),
    'utf8'
  );

  for (const [name, source] of [['Navigator UI', feature], ['popup', popup], ['tutorial', tutorial], ['README', readme]]) {
    assert.match(source, /an AI agent designed to help you improve and modify your adventures/i, `${name} must use Navigator's canonical description`);
  }

  assert.match(feature, /this\.useSettingsPanel = true/);
  assert.match(feature, /GAMEPLAY_SETTINGS_SURFACE_ID = 'keyboard-field-reveal-scroll-surface-settings-gameplay'/);
  assert.match(feature, /scheduleSettingsIntegrationSync\(\)/);
  assert.match(feature, /this\.scheduleSettingsIntegrationSync\(\);\s*if \(this\.detectionDebounce\)/);
  assert.match(feature, /classList\?\.contains\('is_ScrollView'\)/);
  assert.match(feature, /bd-navigator-settings-surface/);
  assert.match(feature, /aria-controls', 'bd-navigator-settings-content'/);
  assert.match(feature, /activateSettingsNavigator\(\{ focus: false \}\)/);
  assert.doesNotMatch(feature, /activateSettingsNavigator\(\{ focus: true \}\)/);
  assert.doesNotMatch(feature, /createLauncher\(|shouldUseSheet\(|betterDungeon_navigator_(?:width|position)/);
  assert.doesNotMatch(feature, /createSettingsTabOverflowControls|updateSettingsTabOverflow|settingsTabs(?:Left|Right)Button/);

  assert.match(feature, /compositionstart/);
  assert.match(feature, /event\.isComposing/);
  assert.match(feature, /window\.__bdNavigatorHandleBack/);
  assert.match(feature, /handleAndroidBack\(\)[\s\S]*inspectionPanel[\s\S]*setInspectorOpen\(false, \{ focus: false \}\)[\s\S]*closeDrawer\(\)/);

  assert.equal((feature.match(/type="radio" name="bd-navigator-change-mode"/g) || []).length, 3);
  assert.match(feature, /data-nav-setting="changeMode"/);
  assert.doesNotMatch(feature, /data-nav-context-section|data-nav-setting="readOnly"|data-nav-setting="applyMode"/);
  assert.doesNotMatch(feature, /createMessageAction|copyAssistantMessage|retryAssistantMessage|replaceFromUserMessage|navigator\.clipboard/);
  assert.match(feature, /class="bd-navigator-inspection-back" aria-label="Back to chat"/);
  assert.match(feature, /createInspectionDisclosure\('Context sent'/);
  assert.match(feature, /createInspectionDisclosure\('Conversation sent'/);
  assert.match(feature, /createInspectionDisclosure\('Tool activity'/);
  assert.match(feature, /createInspectionDisclosure\('Technical details'/);
  assert.doesNotMatch(feature, /Copy round JSON|clipboard\.writeText|get_plot_components/);

  assert.match(styles, /\.bd-navigator-settings-surface\.bd-navigator-settings-active/);
  assert.match(styles, /NAVIGATOR — ANDROID ADAPTATION/);
  assert.match(styles, /\.bd-navigator-drawer\.bd-navigator-embedded \.bd-navigator-icon-btn,[\s\S]*min-height: 44px/);
  assert.match(styles, /\.bd-navigator-drawer button,[\s\S]*font-family: 'IBM Plex Sans'/);
  assert.match(styles, /IBMPlexSans-VariableFont_wdth,wght\.ttf/);
  assert.doesNotMatch(styles, /play\.aidungeon\.com\/_next\/static\/media\/IBMPlexSans/);
  assert.match(styles, /\.bd-navigator-drawer\.bd-navigator-embedded \.bd-navigator-input \{[\s\S]*box-sizing: border-box;[\s\S]*padding-top: 14px;[\s\S]*padding-bottom: 10px;[\s\S]*font-size: 16px/);
  assert.match(styles, /\.bd-navigator-send,[\s\S]*\.bd-navigator-stop \{[\s\S]*width: 44px;[\s\S]*height: 44px;[\s\S]*line-height: 1/);
  assert.match(styles, /\.bd-navigator-ime-visible \.bd-navigator-inspection-content/);
  assert.match(styles, /\.bd-navigator-inspection-panel \{[\s\S]*flex: 1;[\s\S]*overflow: hidden/);
  assert.doesNotMatch(styles, /bd-navigator-(?:message-action|message-actions|edit-banner|context-sections|toggle-control)/);
  assert.doesNotMatch(styles, /bd-navigator-settings-tabs-(?:host|arrow|native-button)/);

  assert.match(session, /const CHANGE_MODES = \['automatic', 'proposed', 'none'\]/);
  assert.match(session, /const DEFAULT_CHANGE_MODE = 'automatic'/);
  assert.doesNotMatch(tools, /get_plot_components/);
  assert.match(readme, /BetterDungeon Mobile v2\.1\.0/);
  assert.doesNotMatch(readme, /Navigator[\s\S]{0,80}(?:Review mode|Read-only mode|player-selected context sections)/i);

  const backHandler = activity.slice(activity.indexOf('private fun setupBackNavigation()'));
  const popupPriority = backHandler.indexOf('popupContainer.visibility == View.VISIBLE');
  const pendingGuard = backHandler.indexOf('if (backNavigationPending) return');
  const navigatorDispatch = backHandler.indexOf('window.__bdNavigatorHandleBack');
  const webViewFallback = backHandler.indexOf('mainWebView.canGoBack()');
  assert.ok(popupPriority >= 0 && popupPriority < pendingGuard);
  assert.ok(pendingGuard < navigatorDispatch && navigatorDispatch < webViewFallback);
  assert.match(backHandler, /result\.trim\(\)\.equals\("true", ignoreCase = true\)/);
}

function testFeatureRuntimeContracts() {
  global.window = global;
  global.innerHeight = 800;
  global.visualViewport = { height: 620 };
  global.document = {
    activeElement: null,
    body: { classList: classList() },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };

  const filename = path.join(ASSETS, 'features', 'navigator_feature.js');
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });

  const feature = new window.NavigatorFeature();
  feature.isOpen = true;
  feature.inspectionPanel = { hidden: false };
  let inspectorReturns = 0;
  let closes = 0;
  let cancellations = 0;
  feature.setInspectorOpen = open => {
    feature.inspectionPanel.hidden = !open;
    inspectorReturns += 1;
  };
  feature.closeDrawer = () => { closes += 1; feature.isOpen = false; };
  feature.installAndroidBackHandler();
  assert.equal(window.__bdNavigatorHandleBack(), true);
  assert.equal(inspectorReturns, 1, 'Android Back must leave Inspector before closing Navigator');
  assert.equal(closes, 0);

  feature.isOpen = true;
  feature.confirmationPanel = { hidden: false };
  feature.resolveConfirmation = accepted => {
    assert.equal(accepted, false);
    cancellations += 1;
    feature.confirmationPanel.hidden = true;
  };
  assert.equal(window.__bdNavigatorHandleBack(), true);
  assert.equal(cancellations, 1, 'confirmation dialogs keep highest Navigator Back priority');
  assert.equal(closes, 0);

  feature.isOpen = true;
  feature.inspectionPanel.hidden = true;
  assert.equal(window.__bdNavigatorHandleBack(), true);
  assert.equal(closes, 1);
  assert.equal(window.__bdNavigatorHandleBack(), false);
  feature.uninstallAndroidBackHandler();
  assert.equal(window.__bdNavigatorHandleBack, undefined);

  const viewportFeature = new window.NavigatorFeature();
  const drawerClasses = classList();
  drawerClasses.add('bd-navigator-embedded');
  viewportFeature.drawer = { classList: drawerClasses, style: styleStore() };
  viewportFeature.settingsSurface = {
    getBoundingClientRect: () => ({ bottom: 700 }),
  };
  viewportFeature.settingsContentPanel = {
    style: {},
    getBoundingClientRect: () => ({ top: 200 }),
  };
  viewportFeature.syncVisualViewport();
  assert.equal(viewportFeature.drawer.style.getPropertyValue('--bd-navigator-viewport-height'), '620px');
  assert.equal(viewportFeature.drawer.style.height, '500px');
  assert.equal(viewportFeature.settingsContentPanel.style.height, '500px');
  assert.equal(drawerClasses.contains('bd-navigator-ime-visible'), true);

  let activationFocus = null;
  viewportFeature.syncSettingsIntegration = () => true;
  viewportFeature.applyActiveSettingsView = ({ focus }) => { activationFocus = focus; };
  assert.equal(viewportFeature.activateSettingsNavigator({ focus: false }), true);
  assert.equal(activationFocus, false);
}

testStaticMobileContracts();
testFeatureRuntimeContracts();
console.log('Navigator v2.1 Mobile contract tests passed');
