// BetterDungeon - Navigator Feature
//
// Adventure-page AI agent shell with a transcript and composer. On desktop the
// existing Navigator surface is mounted into AI Dungeon's Gameplay settings as
// an injected subtab.
//
// NavigatorSession owns live streaming chat, adventure context, and confirmed
// mutation proposals assembled from Plot Components, Story Cards, and actions.

class NavigatorFeature {
  static id = 'navigator';

  static GAMEPLAY_SETTINGS_SURFACE_ID = 'keyboard-field-reveal-scroll-surface-settings-gameplay';

  constructor() {
    this.enabled = true;
    this.debug = false;
    this.currentAdventureId = null;
    this.session = null;
    this.unsubscribe = null;

    this.drawer = null;
    this.transcriptEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.emptyEl = null;
    this.readOnlyBadge = null;
    this.settingsPanel = null;
    this.inspectionPanel = null;
    this.editBanner = null;
    this.confirmationPanel = null;
    this.confirmationResolve = null;
    this.confirmationReturnFocus = null;
    this.editingMessageId = null;
    this.settingsTablist = null;
    this.settingsSurface = null;
    this.settingsTabWrapper = null;
    this.settingsTab = null;
    this.settingsContentPanel = null;
    this.settingsNavigationRoot = null;
    this.settingsContentParent = null;
    this.settingsNativeTabState = null;
    this.settingsActiveThemeClass = '';
    this.settingsInactiveThemeClass = '';
    this.settingsTabActive = false;
    this.settingsTabPreferred = false;
    this.boundSettingsTablistClick = null;
    this.boundSettingsTablistScroll = null;
    this.settingsTabsOverflowHost = null;
    this.settingsTabsLeftButton = null;
    this.settingsTabsRightButton = null;
    this.inspectionRound = 0;
    this.messageNodes = new Map();

    this.isOpen = false;
    this.autoScroll = true;

    this.boundUrlChange = null;
    this.boundResize = null;
    this.boundKeydown = null;
    this.adventureObserver = null;
    this.detectionDebounce = null;
    this.originalPushState = null;
    this.originalReplaceState = null;

  }

  log(message, ...args) {
    if (this.debug) console.log(message, ...args);
  }

  isOwnNode(node) {
    if (!node) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;
    return !!(
      this.drawer?.contains(element) ||
      this.settingsTabWrapper?.contains(element) ||
      this.settingsContentPanel?.contains(element) ||
      this.settingsTabsLeftButton?.contains(element) ||
      this.settingsTabsRightButton?.contains(element)
    );
  }

  // ==================== LIFECYCLE ====================

  async init() {
    console.log('[Navigator] Initializing Navigator feature...');
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
    console.log('[Navigator] Initialization complete');
  }

  destroy() {
    console.log('[Navigator] Destroying Navigator feature...');
    this.stopAdventureChangeDetection();
    this.teardownSession();
    this.removeUI();
    console.log('[Navigator] Cleanup complete');
  }

  // ==================== ADVENTURE DETECTION ====================

  isAdventureUIPresent() {
    const gameplayOutput = document.querySelector('#gameplay-output');
    const settingsButton = document.querySelector(
      '[aria-label="Game settings"], [aria-label="Game Settings"], [aria-label="Game Menu"], [aria-label="Game menu"]'
    );
    const navigationBar = document.querySelector('[aria-label="Navigation bar"]');
    return !!(gameplayOutput && (settingsButton || navigationBar));
  }

  getAdventureIdFromUrl() {
    const fromWs = window.Ultrascripts?.ws?.getAdventureShortId?.();
    if (fromWs) return fromWs;
    const match = window.location.pathname.match(/\/adventure\/([^/]+)/);
    return match ? match[1] : null;
  }

  detectCurrentAdventure() {
    const adventureId = this.getAdventureIdFromUrl();
    const onAdventure = !!(adventureId && this.isAdventureUIPresent());

    if (!onAdventure) {
      if (this.currentAdventureId) {
        this.teardownSession();
        this.removeUI();
        this.currentAdventureId = null;
      }
      return;
    }

    if (adventureId !== this.currentAdventureId) {
      this.teardownSession();
      this.currentAdventureId = adventureId;
      this.closeDrawer();
      this.startSession(adventureId);
    }

    this.createUI();
  }

  startAdventureChangeDetection() {
    this.boundUrlChange = () => this.detectCurrentAdventure();
    window.addEventListener('popstate', this.boundUrlChange);

    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      this.originalPushState.apply(history, args);
      this.detectCurrentAdventure();
    };
    history.replaceState = (...args) => {
      this.originalReplaceState.apply(history, args);
      this.detectCurrentAdventure();
    };

    // Navigator's own DOM churn (notably streaming deltas) must not feed back
    // into adventure detection.
    this.adventureObserver = new MutationObserver((mutations) => {
      if (mutations.every(mutation => this.isOwnNode(mutation.target))) return;
      if (this.detectionDebounce) clearTimeout(this.detectionDebounce);
      this.detectionDebounce = setTimeout(() => this.detectCurrentAdventure(), 150);
    });
    this.adventureObserver.observe(document.body, { childList: true, subtree: true });

    this.boundResize = () => {
      this.applyLayout();
      this.syncSettingsIntegration();
      this.updateSettingsTabOverflow();
    };
    window.addEventListener('resize', this.boundResize);

    this.boundKeydown = (event) => this.handleGlobalKeydown(event);
    document.addEventListener('keydown', this.boundKeydown);
  }

  stopAdventureChangeDetection() {
    if (this.boundUrlChange) {
      window.removeEventListener('popstate', this.boundUrlChange);
      this.boundUrlChange = null;
    }
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
    if (this.adventureObserver) {
      this.adventureObserver.disconnect();
      this.adventureObserver = null;
    }
    if (this.detectionDebounce) {
      clearTimeout(this.detectionDebounce);
      this.detectionDebounce = null;
    }
    if (this.boundResize) {
      window.removeEventListener('resize', this.boundResize);
      this.boundResize = null;
    }
    if (this.boundKeydown) {
      document.removeEventListener('keydown', this.boundKeydown);
      this.boundKeydown = null;
    }
  }

  // ==================== SESSION ====================

  startSession(adventureId) {
    if (typeof NavigatorSession === 'undefined') {
      console.warn('[Navigator] NavigatorSession is unavailable.');
      return;
    }

    this.session = new NavigatorSession(adventureId);
    const session = this.session;
    this.unsubscribe = this.session.subscribe((event, payload) => this.onSessionEvent(event, payload));
    // Clear any previous adventure's transcript immediately rather than
    // leaving it on screen until storage resolves.
    this.renderTranscript();
    this.session.settingsReady?.then(() => this.renderNavigatorSettings());
    this.session.load().then(() => this.renderTranscript());
    session.refreshContext().then(async snapshot => {
      if (!session.isApolloPreviewRetryable?.()) return;
      for (const delay of [250, 500, 1000]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        if (this.session !== session || session.isBusy || session.contextState === 'loading') return;
        await session.refreshContext();
        if (!session.isApolloPreviewRetryable?.()) return;
      }
    }).catch(error => {
      this.log('[Navigator] Initial context refresh failed:', error);
    });
  }

  teardownSession() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.session) {
      this.session.destroy();
      this.session = null;
    }
    this.messageNodes.clear();
  }

  onSessionEvent(event, payload) {
    if (!this.drawer) return;

    if (event === 'reset') {
      this.renderTranscript();
      if (this.inspectionPanel && !this.inspectionPanel.hidden) {
        this.renderRequestInspection();
      }
    } else if (event === 'append') {
      this.appendMessageNode(payload);
      this.updateEmptyState();
      this.scrollToBottom();
    } else if (event === 'update') {
      this.updateMessageNode(payload);
      this.scrollToBottom();
    } else if (event === 'inspection') {
      if (this.inspectionPanel && !this.inspectionPanel.hidden) this.renderRequestInspection(payload);
    } else if (event === 'permissions' || event === 'idle') {
      this.updatePermissionUI();
      this.renderAllProposalStates();
      this.renderAllMessageActions();
      if (event === 'idle') this.focusComposer();
    } else if (event === 'settings') {
      this.renderNavigatorSettings();
      this.updatePermissionUI();
    }

    this.updateComposerState();
  }

  applyLayout() {
    if (!this.drawer) return;
    if (this.drawer.classList.contains('bd-navigator-embedded')) this.updateEmbeddedHeight();
  }

  // ==================== UI ====================

  createUI() {
    if (!this.drawer) this.createDrawer();
    this.syncSettingsIntegration();
  }

  removeUI() {
    if (this.confirmationPanel && !this.confirmationPanel.hidden) this.resolveConfirmation(false);
    this.resetSettingsIntegration({ preserveActive: false });
    this.drawer?.remove();
    this.drawer = null;
    this.transcriptEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.emptyEl = null;
    this.readOnlyBadge = null;
    this.settingsPanel = null;
    this.inspectionPanel = null;
    this.editBanner = null;
    this.confirmationPanel = null;
    this.confirmationResolve = null;
    this.confirmationReturnFocus = null;
    this.editingMessageId = null;
    this.messageNodes.clear();
    this.isOpen = false;
  }

  getGameplaySettingsSurface() {
    return document.getElementById(NavigatorFeature.GAMEPLAY_SETTINGS_SURFACE_ID);
  }

  getSectionTablist(surface = this.getGameplaySettingsSurface()) {
    return surface?.querySelector('[role="tablist"][aria-label="Section Tabs" i]') || null;
  }

  getNativeSectionTabs(tablist = this.settingsTablist) {
    return [...(tablist?.querySelectorAll('[role="tab"]') || [])]
      .filter(tab => !tab.classList.contains('bd-navigator-settings-tab'));
  }

  findModelsTab(tablist) {
    return this.getNativeSectionTabs(tablist).find(tab => {
      const ariaLabel = tab.getAttribute('aria-label') || '';
      return /^(?:selected )?tab models$/i.test(ariaLabel) || tab.textContent?.trim().toLowerCase() === 'models';
    }) || null;
  }

  findSettingsNavigationRoot(tablist, surface) {
    let current = tablist;
    while (current?.parentElement && current.parentElement !== surface) {
      if (current.nextElementSibling) return current;
      current = current.parentElement;
    }
    return null;
  }

  setSettingsWrapperTheme(wrapper, className, markerClass = '') {
    if (!wrapper) return;
    if (className) wrapper.className = className;
    if (markerClass) wrapper.classList.add(markerClass);
  }

  updateSettingsTabAppearance(active) {
    if (!this.settingsTab || !this.settingsTabWrapper) return;
    const baseClass = active ? this.settingsActiveThemeClass : this.settingsInactiveThemeClass;
    this.setSettingsWrapperTheme(this.settingsTabWrapper, baseClass, 'bd-navigator-settings-tab-theme');
    this.settingsTab.setAttribute('aria-label', active ? 'Selected tab navigator' : 'Tab navigator');
    this.settingsTab.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  suppressNativeSelectedTab() {
    const selected = this.getNativeSectionTabs().find(tab => {
      const ariaLabel = tab.getAttribute('aria-label') || '';
      return /^selected tab /i.test(ariaLabel) || tab.getAttribute('aria-selected') === 'true';
    });
    if (!selected) return;

    if (this.settingsNativeTabState?.tab !== selected) {
      this.restoreNativeSelectedTab();
      const wrapper = selected.parentElement;
      this.settingsNativeTabState = {
        tab: selected,
        wrapper,
        ariaLabel: selected.getAttribute('aria-label'),
        ariaSelected: selected.getAttribute('aria-selected'),
        wrapperClass: wrapper?.className || '',
      };
    }

    const wrapper = selected.parentElement;
    this.setSettingsWrapperTheme(wrapper, this.settingsInactiveThemeClass);
    const ariaLabel = selected.getAttribute('aria-label') || this.settingsNativeTabState.ariaLabel || '';
    selected.setAttribute('aria-label', ariaLabel.replace(/^Selected tab /i, 'Tab '));
    selected.setAttribute('aria-selected', 'false');
  }

  restoreNativeSelectedTab() {
    const state = this.settingsNativeTabState;
    this.settingsNativeTabState = null;
    if (!state?.tab?.isConnected) return;

    if (state.ariaLabel === null) state.tab.removeAttribute('aria-label');
    else state.tab.setAttribute('aria-label', state.ariaLabel);
    if (state.ariaSelected === null) state.tab.removeAttribute('aria-selected');
    else state.tab.setAttribute('aria-selected', state.ariaSelected);
    if (state.wrapper?.isConnected) state.wrapper.className = state.wrapperClass;
  }

  createSettingsTabOverflowControls(tablist) {
    const directParent = tablist?.parentElement;
    const host = directParent?.classList?.contains('_dsp_contents')
      ? directParent.parentElement
      : directParent;
    if (!host) return;

    host.classList.add('bd-navigator-settings-tabs-host');
    const createControl = (direction) => {
      const control = document.createElement('div');
      control.className = `css-g5y9jx r-633pao bd-navigator-settings-tabs-arrow bd-navigator-settings-tabs-arrow-${direction}`;
      control.innerHTML = `
        <div class="css-g5y9jx r-633pao bd-navigator-settings-tabs-arrow-align">
          <span class="t_sub_theme t_core9 is_Theme" style="color: var(--color); display: contents;">
            <div role="button" aria-label="scroll ${direction}" tabindex="0" class="is_Button is_View _bg-0hover-backgroundH3423444 _btc-0hover-borderColor69916956 _brc-0hover-borderColor69916956 _bbc-0hover-borderColor69916956 _blc-0hover-borderColor69916956 _bxsh-0hover-0px0px0pxva926910726 _bg-0active-backgroundP3496915 _btc-0active-borderColor77378595 _brc-0active-borderColor77378595 _bbc-0active-borderColor77378595 _blc-0active-borderColor77378595 _bxsh-0active-0px0px0pxva695599917 _bg-0focus-backgroundF3405682 _btc-0focus-borderColor68052152 _brc-0focus-borderColor68052152 _bbc-0focus-borderColor68052152 _blc-0focus-borderColor68052152 _bxsh-0focus-0px0px0pxva984719650 _cur-pointer _ussel-none _ox-hidden _oy-hidden _pos-relative _jc-center _ai-center _h-t-size-5 _btlr-t-radius-10 _btrr-t-radius-10 _bbrr-t-radius-10 _bblr-t-radius-10 _pr-t-space-0 _pl-t-space-0 _fd-row _bg-background _btc-borderColor _brc-borderColor _bbc-borderColor _blc-borderColor _btw-1px _brw-1px _bbw-1px _blw-1px _gap-t-space-1 _outlineColor-coreA0 _pe-auto _pt-t-space-0 _pb-t-space-0 _w-t-size-4--5 _mah-t-size-4--5 _maw-t-size-5 _bbs-solid _bts-solid _bls-solid _brs-solid _bxsh-0px0px0pxva26674076 bd-navigator-settings-tabs-native-button" style="box-shadow: rgb(0, 0, 0) 0 0 32px;">
              <div class="is_View _pos-relative _fd-column _t-2--6537 _l-0px _ai-center _jc-center">
                <span aria-hidden="true" class="is_Text font_icons _col-color _ff-f-family _lh-f-lineHeigh112920 _ls-f-letterSpa1360334204 _mt-0px _mb-0px _fow-500 _ws-break-space115 _pe-none _mr-0px _ml-0px _pt-t-space-0--53 _pb-t-space-0--53 _fos-f-size-1 _zi-1" style="pointer-events: none;">w_arrow_${direction}</span>
              </div>
            </div>
          </span>
        </div>
      `;
      const button = control.querySelector('[role="button"]');
      const scroll = () => {
        const distance = Math.max(120, Math.floor(tablist.clientWidth * 0.65));
        tablist.scrollBy({ left: direction === 'right' ? distance : -distance, behavior: 'smooth' });
      };
      button.addEventListener('click', scroll);
      button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        scroll();
      });
      host.appendChild(control);
      return control;
    };

    this.settingsTabsOverflowHost = host;
    this.settingsTabsLeftButton = createControl('left');
    this.settingsTabsRightButton = createControl('right');
    this.boundSettingsTablistScroll = () => this.updateSettingsTabOverflow();
    tablist.addEventListener('scroll', this.boundSettingsTablistScroll, { passive: true });
    const schedule = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
    schedule(() => this.updateSettingsTabOverflow());
  }

  updateSettingsTabOverflow() {
    const tablist = this.settingsTablist;
    if (!tablist || !this.settingsTabsLeftButton || !this.settingsTabsRightButton) return;
    const maxScroll = Math.max(0, tablist.scrollWidth - tablist.clientWidth);
    const overflowing = maxScroll > 2;
    const atStart = tablist.scrollLeft <= 2;
    const atEnd = tablist.scrollLeft >= maxScroll - 2;
    this.settingsTabsOverflowHost?.classList.toggle('bd-navigator-settings-tabs-overflowing', overflowing);
    this.settingsTabsLeftButton.hidden = !overflowing || atStart;
    this.settingsTabsRightButton.hidden = !overflowing || atEnd;
  }

  removeSettingsTabOverflowControls() {
    if (this.settingsTablist && this.boundSettingsTablistScroll) {
      this.settingsTablist.removeEventListener('scroll', this.boundSettingsTablistScroll);
    }
    this.settingsTabsLeftButton?.remove();
    this.settingsTabsRightButton?.remove();
    this.settingsTabsOverflowHost?.classList.remove(
      'bd-navigator-settings-tabs-host',
      'bd-navigator-settings-tabs-overflowing'
    );
    this.boundSettingsTablistScroll = null;
    this.settingsTabsOverflowHost = null;
    this.settingsTabsLeftButton = null;
    this.settingsTabsRightButton = null;
  }

  getNativeSettingsContentNodes() {
    if (!this.settingsContentParent || !this.settingsNavigationRoot) return [];
    return [...this.settingsContentParent.children].filter(node => (
      node !== this.settingsNavigationRoot && node !== this.settingsContentPanel
    ));
  }

  setNativeSettingsContentHidden(hidden) {
    for (const node of this.getNativeSettingsContentNodes()) {
      node.classList.toggle('bd-navigator-settings-native-hidden', hidden);
    }
  }

  parkNavigatorDrawer() {
    if (!this.drawer) return;
    this.drawer.hidden = true;
    this.drawer.classList.remove('bd-navigator-embedded');
    this.drawer.style.width = '';
    this.drawer.style.height = '';
    if (document.body && this.drawer.parentElement !== document.body) {
      document.body.appendChild(this.drawer);
    }
  }

  resetSettingsIntegration({ preserveActive = false } = {}) {
    const wasActive = this.settingsTabActive;
    this.settingsSurface?.classList.remove('bd-navigator-settings-active');
    this.restoreNativeSelectedTab();
    this.setNativeSettingsContentHidden(false);
    this.parkNavigatorDrawer();

    if (this.settingsTablist && this.boundSettingsTablistClick) {
      this.settingsTablist.removeEventListener('click', this.boundSettingsTablistClick, true);
    }
    this.removeSettingsTabOverflowControls();
    this.settingsTabWrapper?.remove();
    this.settingsContentPanel?.remove();

    this.settingsTablist = null;
    this.settingsSurface = null;
    this.settingsTabWrapper = null;
    this.settingsTab = null;
    this.settingsContentPanel = null;
    this.settingsNavigationRoot = null;
    this.settingsContentParent = null;
    this.settingsNativeTabState = null;
    this.settingsActiveThemeClass = '';
    this.settingsInactiveThemeClass = '';
    this.boundSettingsTablistClick = null;
    this.settingsTabActive = preserveActive ? wasActive : false;
    if (!preserveActive) this.isOpen = false;
  }

  createSettingsTab(tablist, modelsTab) {
    const nativeTabs = this.getNativeSectionTabs(tablist);
    const selectedTab = nativeTabs.find(tab => /^selected tab /i.test(tab.getAttribute('aria-label') || ''));
    const inactiveTab = nativeTabs.find(tab => tab !== selectedTab) || modelsTab;
    const activeWrapper = selectedTab?.parentElement || modelsTab.parentElement;
    const inactiveWrapper = inactiveTab?.parentElement || modelsTab.parentElement;
    this.settingsActiveThemeClass = activeWrapper?.className || '';
    this.settingsInactiveThemeClass = inactiveWrapper?.className || this.settingsActiveThemeClass;

    const wrapper = inactiveWrapper.cloneNode(true);
    wrapper.removeAttribute('id');
    wrapper.classList.add('bd-navigator-settings-tab-theme');
    const tab = wrapper.querySelector('[role="tab"]');
    if (!tab) return null;

    tab.removeAttribute('id');
    tab.classList.add('bd-navigator-settings-tab');
    tab.setAttribute('aria-label', 'Tab navigator');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('tabindex', '0');

    const icon = tab.querySelector('[aria-hidden="true"]');
    if (icon) {
      icon.textContent = '';
      icon.className = 'bd-navigator-settings-tab-icon icon-compass';
    }
    const label = [...tab.querySelectorAll('span')].reverse().find(node => node.textContent?.trim());
    if (label) {
      label.textContent = 'navigator';
      label.classList.add('bd-navigator-settings-tab-label');
    }

    tab.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.activateSettingsNavigator({ focus: true });
    });
    tab.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      this.activateSettingsNavigator({ focus: true });
    });

    modelsTab.parentElement.parentElement.insertBefore(wrapper, modelsTab.parentElement);
    this.settingsTabWrapper = wrapper;
    this.settingsTab = tab;
    return tab;
  }

  createSettingsContentPanel(contentParent, navigationRoot) {
    const panel = document.createElement('section');
    panel.className = 'bd-navigator-settings-content';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-label', 'Navigator');
    panel.hidden = true;
    contentParent.insertBefore(panel, navigationRoot.nextElementSibling);
    this.settingsContentPanel = panel;
    return panel;
  }

  injectSettingsIntegration(surface, tablist) {
    const modelsTab = this.findModelsTab(tablist);
    const navigationRoot = this.findSettingsNavigationRoot(tablist, surface);
    const contentParent = navigationRoot?.parentElement;
    if (!modelsTab?.parentElement?.parentElement || !navigationRoot || !contentParent) return false;

    document.querySelectorAll('.bd-navigator-settings-tab-theme, .bd-navigator-settings-content').forEach(node => {
      if (node !== this.settingsTabWrapper && node !== this.settingsContentPanel) node.remove();
    });

    this.settingsTablist = tablist;
    this.settingsSurface = surface;
    this.settingsNavigationRoot = navigationRoot;
    this.settingsContentParent = contentParent;
    if (!this.createSettingsTab(tablist, modelsTab)) return false;
    this.createSettingsContentPanel(contentParent, navigationRoot);
    this.createSettingsTabOverflowControls(tablist);

    this.boundSettingsTablistClick = event => {
      const clickedTab = event.target?.closest?.('[role="tab"]');
      if (!clickedTab || clickedTab === this.settingsTab) return;
      this.deactivateSettingsNavigator({ abort: true, preservePreference: false });
    };
    tablist.addEventListener('click', this.boundSettingsTablistClick, true);
    return true;
  }

  syncSettingsIntegration() {
    if (!this.drawer) return false;
    const surface = this.getGameplaySettingsSurface();
    const tablist = this.getSectionTablist(surface);

    if (!surface || !tablist) {
      const wasActive = this.settingsTabActive;
      if (wasActive && this.session?.isChatBusy) this.session.abort();
      this.resetSettingsIntegration({ preserveActive: false });
      return false;
    }

    const integrationMissing = (
      this.settingsTablist !== tablist ||
      !this.settingsTabWrapper?.isConnected ||
      !this.settingsContentPanel?.isConnected ||
      !this.settingsTabsLeftButton?.isConnected ||
      !this.settingsTabsRightButton?.isConnected
    );
    if (integrationMissing) {
      const preserveActive = this.settingsTabActive;
      this.resetSettingsIntegration({ preserveActive });
      if (!this.injectSettingsIntegration(surface, tablist)) return false;
    }

    if (this.settingsTabPreferred && !this.settingsTabActive) {
      this.settingsTabActive = true;
      this.isOpen = true;
    }

    if (this.settingsTabActive) this.applyActiveSettingsView({ focus: false });
    else {
      this.updateSettingsTabAppearance(false);
      this.setNativeSettingsContentHidden(false);
      this.settingsContentPanel.hidden = true;
      this.drawer.hidden = true;
    }
    this.updateSettingsTabOverflow();
    return true;
  }

  applyActiveSettingsView({ focus = false } = {}) {
    if (!this.settingsContentPanel || !this.drawer) return;
    this.suppressNativeSelectedTab();
    this.updateSettingsTabAppearance(true);
    this.setNativeSettingsContentHidden(true);
    this.settingsContentPanel.hidden = false;
    if (this.settingsSurface) {
      this.settingsSurface.classList.add('bd-navigator-settings-active');
      this.settingsSurface.scrollTop = 0;
    }
    if (this.drawer.parentElement !== this.settingsContentPanel) {
      this.settingsContentPanel.appendChild(this.drawer);
    }
    this.drawer.classList.add('bd-navigator-embedded');
    this.drawer.hidden = false;
    this.applyLayout();
    this.scrollToBottom(true);
    if (focus) setTimeout(() => this.inputEl?.focus(), 0);
  }

  updateEmbeddedHeight() {
    if (!this.settingsSurface || !this.settingsContentPanel || !this.drawer) return;
    if (!this.drawer.classList.contains('bd-navigator-embedded')) return;
    const surfaceRect = this.settingsSurface.getBoundingClientRect();
    const panelRect = this.settingsContentPanel.getBoundingClientRect();
    const availableHeight = Math.floor(surfaceRect.bottom - panelRect.top);
    const height = Math.max(320, availableHeight);
    this.settingsContentPanel.style.height = `${height}px`;
    this.drawer.style.height = `${height}px`;
  }

  activateSettingsNavigator({ focus = false } = {}) {
    if (!this.syncSettingsIntegration()) return false;
    this.settingsTabActive = true;
    this.settingsTabPreferred = true;
    this.isOpen = true;
    this.applyActiveSettingsView({ focus });
    return true;
  }

  deactivateSettingsNavigator({ abort = false, preservePreference = false } = {}) {
    if (abort && this.session?.isChatBusy) this.session.abort();
    if (!preservePreference) this.settingsTabPreferred = false;
    this.settingsTabActive = false;
    this.isOpen = false;
    this.restoreNativeSelectedTab();
    this.updateSettingsTabAppearance(false);
    this.setNativeSettingsContentHidden(false);
    this.settingsSurface?.classList.remove('bd-navigator-settings-active');
    if (this.settingsContentPanel) this.settingsContentPanel.hidden = true;
    if (this.drawer) this.drawer.hidden = true;
  }

  createDrawer() {
    const drawer = document.createElement('aside');
    drawer.className = 'bd-navigator-drawer';
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Navigator');
    drawer.hidden = true;

    const header = document.createElement('header');
    header.className = 'bd-navigator-header';
    header.innerHTML = `
      <div class="bd-navigator-header-identity">
        <span class="bd-navigator-mark icon-compass" aria-hidden="true"></span>
        <h2 class="bd-navigator-title">Navigator</h2>
      </div>
      <div class="bd-navigator-header-actions">
        <span class="bd-navigator-read-only" hidden>Read-only</span>
        <button type="button" class="bd-navigator-icon-btn bd-navigator-inspection" aria-label="View last request context" title="View last request context" aria-controls="bd-navigator-inspection-panel" aria-expanded="false">
          <span class="icon-file-braces" aria-hidden="true"></span>
        </button>
        <button type="button" class="bd-navigator-icon-btn bd-navigator-settings" aria-label="Navigator settings" title="Navigator settings" aria-controls="bd-navigator-settings-panel" aria-expanded="false">
          <span class="icon-sliders-horizontal" aria-hidden="true"></span>
        </button>
        <button type="button" class="bd-navigator-icon-btn bd-navigator-clear" aria-label="Clear conversation" title="Clear conversation">
          <span class="icon-eraser" aria-hidden="true"></span>
        </button>
      </div>
    `;
    const settings = document.createElement('section');
    settings.className = 'bd-navigator-settings-panel';
    settings.id = 'bd-navigator-settings-panel';
    settings.hidden = true;
    settings.setAttribute('aria-label', 'Navigator adventure settings');
    settings.innerHTML = `
      <div class="bd-navigator-settings-grid">
        <label class="bd-navigator-thinking-control">Thinking level
          <input type="range" min="0" max="0" step="1" value="0" data-nav-setting="thinkingLevel" aria-label="Thinking level">
          <span class="bd-navigator-thinking-value" aria-live="polite"></span>
        </label>
        <label class="bd-navigator-toggle-control">Read-only
          <input type="checkbox" data-nav-setting="readOnly" aria-label="Read-only mode">
        </label>
        <fieldset class="bd-navigator-context-sections">
          <legend>Context sections</legend>
          <label><input type="checkbox" data-nav-context-section="plot"> Plot Components</label>
          <label><input type="checkbox" data-nav-context-section="history"> Recent story actions</label>
          <label><input type="checkbox" data-nav-context-section="memory"> Memory Bank</label>
          <label><input type="checkbox" data-nav-context-section="cards"> Story Card directory</label>
        </fieldset>
      </div>
    `;

    const inspection = document.createElement('section');
    inspection.className = 'bd-navigator-inspection-panel';
    inspection.id = 'bd-navigator-inspection-panel';
    inspection.hidden = true;
    inspection.setAttribute('aria-label', 'Last request context');
    inspection.innerHTML = '<div class="bd-navigator-inspection-summary"></div><div class="bd-navigator-inspection-toolbar"></div><div class="bd-navigator-inspection-body"></div>';

    const transcript = document.createElement('div');
    transcript.className = 'bd-navigator-transcript';
    transcript.setAttribute('role', 'log');
    transcript.setAttribute('aria-live', 'polite');

    const empty = document.createElement('div');
    empty.className = 'bd-navigator-empty';
    empty.innerHTML = `
      <span class="bd-navigator-empty-icon icon-compass" aria-hidden="true"></span>
      <p class="bd-navigator-empty-text"><strong>I'm Navigator.</strong> I'm an AI agent designed to help you improve and modify your adventures. Let's get started.</p>
      <div class="bd-navigator-quick-actions" aria-label="Suggested prompts">
        <button type="button" data-prompt="Review my Plot Components and suggest the most important improvements.">Review my plot</button>
        <button type="button" data-prompt="Review my AI Instructions and propose a clearer, more effective version.">Improve AI Instructions</button>
        <button type="button" data-prompt="Check my Story Cards for gaps, contradictions, or weak entries.">Check Story Cards</button>
        <button type="button" data-prompt="Use the recent story and adventure context to suggest what should happen next.">Brainstorm what happens next</button>
      </div>
    `;
    transcript.appendChild(empty);

    // Deliberately not a <form>: a form on the AI Dungeon page risks a stray
    // submit navigating away from the adventure.
    const composer = document.createElement('div');
    composer.className = 'bd-navigator-composer';
    composer.innerHTML = `
      <div class="bd-navigator-edit-banner" hidden>
        <span><span class="icon-pencil" aria-hidden="true"></span> Editing message</span>
        <button type="button" class="bd-navigator-edit-cancel">Cancel</button>
      </div>
      <div class="bd-navigator-input-shell">
        <textarea class="bd-navigator-input" rows="1" placeholder="Ask Navigator..." aria-label="Message Navigator"></textarea>
        <button type="button" class="bd-navigator-stop" aria-label="Stop generating" title="Stop generating" hidden>
          <span class="icon-square" aria-hidden="true"></span>
        </button>
        <button type="button" class="bd-navigator-send" aria-label="Send message">
          <span class="icon-send" aria-hidden="true"></span>
        </button>
      </div>
    `;

    const confirmation = document.createElement('div');
    confirmation.className = 'bd-navigator-confirmation-backdrop';
    confirmation.hidden = true;
    confirmation.innerHTML = `
      <section class="bd-navigator-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="bd-navigator-confirmation-title" aria-describedby="bd-navigator-confirmation-message">
        <h3 id="bd-navigator-confirmation-title">Confirm action</h3>
        <p id="bd-navigator-confirmation-message"></p>
        <div class="bd-navigator-confirmation-actions">
          <button type="button" class="bd-navigator-confirmation-cancel">Cancel</button>
          <button type="button" class="bd-navigator-confirmation-accept">Confirm</button>
        </div>
      </section>
    `;

    drawer.append(header, settings, inspection, transcript, composer, confirmation);
    document.body.appendChild(drawer);

    this.drawer = drawer;
    this.transcriptEl = transcript;
    this.emptyEl = empty;
    this.inputEl = composer.querySelector('.bd-navigator-input');
    this.sendBtn = composer.querySelector('.bd-navigator-send');
    this.stopBtn = composer.querySelector('.bd-navigator-stop');
    this.readOnlyBadge = header.querySelector('.bd-navigator-read-only');
    this.settingsPanel = settings;
    this.inspectionPanel = inspection;
    this.editBanner = composer.querySelector('.bd-navigator-edit-banner');
    this.confirmationPanel = confirmation;

    const inspectionToggle = header.querySelector('.bd-navigator-inspection');
    const settingsToggle = header.querySelector('.bd-navigator-settings');
    const syncDisclosureState = () => {
      drawer.classList.toggle('bd-navigator-secondary-open', !inspection.hidden || !settings.hidden);
      inspectionToggle.setAttribute('aria-expanded', String(!inspection.hidden));
      settingsToggle.setAttribute('aria-expanded', String(!settings.hidden));
    };

    inspectionToggle.addEventListener('click', () => {
      inspection.hidden = !inspection.hidden;
      settings.hidden = true;
      syncDisclosureState();
      if (!inspection.hidden) this.renderRequestInspection();
    });
    header.querySelector('.bd-navigator-clear').addEventListener('click', () => this.handleClear());
    settingsToggle.addEventListener('click', () => {
      settings.hidden = !settings.hidden;
      inspection.hidden = true;
      syncDisclosureState();
      if (!settings.hidden) {
        this.renderNavigatorSettings();
        this.session?.checkReady?.().then(() => this.renderNavigatorSettings());
      }
    });
    settings.querySelectorAll('[data-nav-setting]').forEach(control => {
      if (control.tagName === 'FIELDSET') return;
      control.addEventListener('change', () => {
        const value = control.type === 'checkbox' ? control.checked : control.value;
        this.saveNavigatorSetting(control.dataset.navSetting, value);
      });
    });
    settings.querySelector('[data-nav-setting="thinkingLevel"]')?.addEventListener('input', event => {
      this.updateThinkingLevelLabel(Number(event.target.value));
    });
    settings.querySelectorAll('[data-nav-context-section]').forEach(control => {
      control.addEventListener('change', () => {
        const contextSections = [...settings.querySelectorAll('[data-nav-context-section]:checked')]
          .map(input => input.dataset.navContextSection);
        this.saveNavigatorSetting('contextSections', contextSections);
      });
    });
    this.stopBtn.addEventListener('click', () => this.session?.abort());
    composer.querySelector('.bd-navigator-edit-cancel').addEventListener('click', () => this.cancelMessageEdit());
    confirmation.querySelector('.bd-navigator-confirmation-cancel').addEventListener('click', () => this.resolveConfirmation(false));
    confirmation.querySelector('.bd-navigator-confirmation-accept').addEventListener('click', () => this.resolveConfirmation(true));
    confirmation.addEventListener('click', event => {
      if (event.target === confirmation) this.resolveConfirmation(false);
    });

    this.sendBtn.addEventListener('click', () => this.handleSend());
    empty.querySelectorAll('.bd-navigator-quick-actions button').forEach(button => {
      button.addEventListener('click', () => this.handleQuickAction(button.dataset.prompt));
    });

    this.inputEl.addEventListener('input', () => this.autosizeInput());
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.handleSend();
      }
    });

    // Pausing auto-scroll when the player scrolls up keeps long answers readable.
    transcript.addEventListener('scroll', () => {
      const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
      this.autoScroll = distanceFromBottom < 48;
    });

    this.applyLayout();
    this.updatePermissionUI();
    this.updateComposerState();
    this.renderTranscript();
  }

  renderNavigatorSettings() {
    if (!this.settingsPanel || !this.session) return;
    const settings = this.session.getSettings?.();
    if (!settings) return;
    const supported = settings.providerThinkingLevels || [];
    const thinking = this.settingsPanel.querySelector('[data-nav-setting="thinkingLevel"]');
    if (thinking) {
      const index = supported.indexOf(settings.thinkingLevel);
      const preferredLevels = ['minimal', 'low', 'medium', 'high'];
      const storedRank = preferredLevels.indexOf(settings.thinkingLevel);
      const nearestIndex = index >= 0
        ? index
        : supported.reduce((best, level, candidate) => {
          if (best < 0) return candidate;
          const rank = preferredLevels.indexOf(level);
          const bestRank = preferredLevels.indexOf(supported[best]);
          if (storedRank < 0 || rank < 0 || bestRank < 0) return best;
          return Math.abs(rank - storedRank) < Math.abs(bestRank - storedRank)
            ? candidate
            : best;
        }, -1);
      thinking.min = '0';
      thinking.max = String(Math.max(0, supported.length - 1));
      thinking.value = String(nearestIndex >= 0 ? nearestIndex : 0);
      thinking.disabled = supported.length === 0;
      thinking.title = supported.length
        ? index >= 0 ? '' : 'The stored thinking level is not advertised by the configured provider.'
        : 'The configured provider advertises no thinking-level support.';
      this.updateThinkingLevelLabel(nearestIndex);
    }
    const readOnly = this.settingsPanel.querySelector('[data-nav-setting="readOnly"]');
    if (readOnly) readOnly.checked = settings.readOnly === true;
    const selectedSections = Array.isArray(settings.contextSections)
      ? settings.contextSections
      : ['plot', 'history', 'memory', 'cards'];
    for (const control of this.settingsPanel.querySelectorAll('[data-nav-context-section]')) {
      control.checked = selectedSections.includes(control.dataset.navContextSection);
    }
  }

  updateThinkingLevelLabel(index) {
    const label = this.settingsPanel?.querySelector('.bd-navigator-thinking-value');
    if (!label) return;
    const supported = this.session?.getSettings?.()?.providerThinkingLevels || [];
    label.textContent = supported[Number(index)] || 'Unavailable';
  }

  async saveNavigatorSetting(key, rawValue) {
    if (!this.session) return;
    const value = key === 'readOnly' ? rawValue === true : rawValue;
    if (key === 'thinkingLevel') {
      const supported = this.session.getSettings?.().providerThinkingLevels || [];
      const selected = supported[Number(rawValue)];
      if (!selected) return;
      await this.session.saveSettings({ [key]: selected });
      this.renderNavigatorSettings();
      return;
    }
    await this.session.saveSettings({ [key]: value });
    this.renderNavigatorSettings();
  }

  renderRequestInspection(inspection = this.session?.getLastRequestInspection?.()) {
    if (!this.inspectionPanel) return;
    const summary = this.inspectionPanel.querySelector('.bd-navigator-inspection-summary');
    const toolbar = this.inspectionPanel.querySelector('.bd-navigator-inspection-toolbar');
    const body = this.inspectionPanel.querySelector('.bd-navigator-inspection-body');
    summary.replaceChildren(); toolbar.replaceChildren(); body.replaceChildren();
    if (!inspection) { summary.textContent = 'Nothing has been captured yet in this page session. This inspection is not saved across reloads.'; return; }
    const flags = ['toolsDropped', 'inputLimitReached', 'toolLimitReached', 'toolResultsOmitted'].filter(key => inspection.meta?.[key]);
    const charsPerToken = Number(NavigatorSession.CHARS_PER_TOKEN);
    const formatCapacity = value => {
      const chars = Number(value);
      return Number.isFinite(chars) && chars >= 0
        ? `${value} chars (~${Math.round(chars / charsPerToken)} tokens)`
        : 'unknown';
    };
    summary.textContent = `Captured ${inspection.capturedAt || 'unknown time'} | ${inspection.model || 'model unknown'} | thinking ${inspection.thinkingLevel || 'unknown'} | input cap ${formatCapacity(inspection.inputCap)} | peak ${formatCapacity(inspection.meta?.peakInputChars || 0)} | tool rounds ${inspection.meta?.toolRounds || 0}${flags.length ? ` | ${flags.join(', ')}` : ''}`;
    if (inspection.error) summary.appendChild(document.createTextNode(` | Error: ${inspection.error.message}`));
    const rounds = Array.isArray(inspection.rounds) ? inspection.rounds : [];
    if (!rounds.length) { body.textContent = 'No executor round was captured. Nothing is saved across reloads.'; return; }
    if (rounds.length > 1) {
      const label = document.createElement('label'); label.textContent = 'Round ';
      const select = document.createElement('select'); select.className = 'bd-navigator-inspection-round';
      rounds.forEach((round, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = round.omitted ? `${round.round + 1} (text omitted)` : String(round.round + 1); select.appendChild(option); });
      select.value = String(Math.min(this.inspectionRound, rounds.length - 1));
      select.addEventListener('change', () => { this.inspectionRound = Number(select.value); this.renderRequestInspection(inspection); }); label.appendChild(select); toolbar.appendChild(label);
    }
    const round = rounds[Math.min(this.inspectionRound, rounds.length - 1)];
    if (round.omitted && !round.truncated) { body.textContent = round.omissionReason || 'Intermediate round text omitted due to the inspection retention limit.'; return; }
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy round JSON'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify(round, null, 2)); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy unavailable'; } }); toolbar.appendChild(copy);
    for (const [title, value] of [['System instruction', round.systemInstruction], ['Messages', round.messages], ['Tool schemas', round.tools], ['Tool results', round.toolResults], ['Round budget', { budget: round.budget, thinking: round.thinking, continuationPresent: round.continuationPresent, projectedInputChars: round.projectedInputChars }]]) { const heading = document.createElement('h4'); heading.textContent = title; body.appendChild(heading); const pre = document.createElement('pre'); pre.textContent = value === undefined ? '(nothing was sent)' : typeof value === 'string' ? value : JSON.stringify(value, null, 2); body.appendChild(pre); }
  }

  // ==================== OPEN / CLOSE ====================

  closeDrawer() {
    if (!this.drawer) return;
    this.deactivateSettingsNavigator({ abort: true, preservePreference: true });
    document.querySelector('[aria-label="Close settings"]')?.click();
  }

  handleGlobalKeydown(event) {
    if (this.confirmationPanel && !this.confirmationPanel.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.resolveConfirmation(false);
        return;
      }
      if (event.key === 'Tab') {
        const controls = [...this.confirmationPanel.querySelectorAll('button:not(:disabled)')];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !this.confirmationPanel.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !this.confirmationPanel.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (event.key === 'Escape' && this.isOpen && this.drawer?.contains(document.activeElement)) {
      event.preventDefault();
      this.closeDrawer();
    }
  }

  // ==================== COMPOSER ====================

  autosizeInput() {
    if (!this.inputEl) return;
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 160)}px`;
  }

  focusComposer(force = false) {
    if (!this.inputEl || !this.settingsTabActive || this.drawer?.hidden) return;
    if (!this.settingsPanel?.hidden || !this.inspectionPanel?.hidden || !this.confirmationPanel?.hidden) return;
    const active = document.activeElement;
    const mayRestore = force
      || !active
      || active === document.body
      || active === this.inputEl
      || active === this.sendBtn
      || active === this.stopBtn;
    if (mayRestore) setTimeout(() => this.inputEl?.focus(), 0);
  }

  beginMessageEdit(messageId) {
    if (!this.session || this.session.isBusy || !this.inputEl) return;
    const message = this.session.findMessage?.(messageId);
    if (!message || message.role !== 'user') return;
    this.editingMessageId = messageId;
    this.inputEl.value = message.content || '';
    this.inputEl.setAttribute('aria-label', 'Edit message and resend');
    this.sendBtn?.setAttribute('aria-label', 'Save edit and resend');
    if (this.editBanner) this.editBanner.hidden = false;
    this.autosizeInput();
    this.focusComposer(true);
  }

  cancelMessageEdit({ focus = true } = {}) {
    this.editingMessageId = null;
    if (this.inputEl) {
      this.inputEl.value = '';
      this.inputEl.setAttribute('aria-label', 'Message Navigator');
    }
    this.sendBtn?.setAttribute('aria-label', 'Send message');
    if (this.editBanner) this.editBanner.hidden = true;
    this.autosizeInput();
    if (focus) this.focusComposer(true);
  }

  showConfirmation({ title, message, confirmLabel = 'Confirm', danger = false }) {
    if (!this.confirmationPanel) return Promise.resolve(false);
    if (this.confirmationResolve) this.resolveConfirmation(false);
    this.confirmationReturnFocus = document.activeElement;
    this.confirmationPanel.querySelector('#bd-navigator-confirmation-title').textContent = title;
    this.confirmationPanel.querySelector('#bd-navigator-confirmation-message').textContent = message;
    const accept = this.confirmationPanel.querySelector('.bd-navigator-confirmation-accept');
    accept.textContent = confirmLabel;
    accept.classList.toggle('bd-navigator-confirmation-danger', danger);
    this.confirmationPanel.hidden = false;
    this.confirmationPanel.querySelector('.bd-navigator-confirmation-cancel')?.focus();
    return new Promise(resolve => {
      this.confirmationResolve = resolve;
    });
  }

  resolveConfirmation(accepted) {
    if (!this.confirmationPanel || this.confirmationPanel.hidden) return;
    const resolve = this.confirmationResolve;
    const returnFocus = this.confirmationReturnFocus;
    this.confirmationResolve = null;
    this.confirmationReturnFocus = null;
    this.confirmationPanel.hidden = true;
    resolve?.(accepted === true);
    if (!accepted && returnFocus?.isConnected) setTimeout(() => returnFocus.focus(), 0);
  }

  async handleSend() {
    if (!this.session || !this.inputEl) return;
    const text = this.inputEl.value;
    if (!text.trim() || this.session.isBusy) return;

    if (this.editingMessageId) {
      const messageId = this.editingMessageId;
      const index = this.session.findMessageIndex?.(messageId) ?? -1;
      const hasLaterTurns = index >= 0 && this.session.getMessages().slice(index + 1)
        .some(message => message.role === 'user' || message.role === 'assistant');
      if (hasLaterTurns) {
        const confirmed = await this.showConfirmation({
          title: 'Replace later messages?',
          message: 'Resending this edit will remove every response and message that follows it.',
          confirmLabel: 'Replace and resend',
          danger: true,
        });
        if (!confirmed) return;
      }
      this.cancelMessageEdit({ focus: false });
      this.autoScroll = true;
      await this.session.replaceFromUserMessage?.(messageId, text);
      this.updateComposerState();
      this.focusComposer(true);
      return;
    }

    this.inputEl.value = '';
    this.autosizeInput();
    this.autoScroll = true;
    this.session.send(text).finally(() => this.focusComposer());
    this.updateComposerState();
  }

  handleQuickAction(prompt) {
    if (!this.inputEl || !prompt || this.session?.isBusy) return;
    if (this.editingMessageId) this.cancelMessageEdit({ focus: false });
    this.inputEl.value = prompt;
    this.autosizeInput();
    this.handleSend();
  }

  updatePermissionUI() {
    const readOnly = this.session?.getPermissionState?.().readOnly === true;
    if (this.readOnlyBadge) this.readOnlyBadge.hidden = !readOnly;
  }

  async handleClear() {
    if (!this.session || this.session.isBusy || !this.session.getMessages().length) return;
    const confirmed = await this.showConfirmation({
      title: 'Clear conversation?',
      message: 'This permanently removes this adventure\'s Navigator messages and proposal history.',
      confirmLabel: 'Clear conversation',
      danger: true,
    });
    if (!confirmed) return;
    this.cancelMessageEdit({ focus: false });
    this.session.clear();
    this.autoScroll = true;
    this.focusComposer(true);
  }

  updateComposerState() {
    const busy = !!this.session?.isBusy;
    const chatBusy = !!this.session?.isChatBusy;
    if (this.sendBtn) {
      this.sendBtn.disabled = busy;
      this.sendBtn.hidden = chatBusy;
    }
    if (this.stopBtn) this.stopBtn.hidden = !chatBusy;
    if (this.inputEl) this.inputEl.disabled = busy && !chatBusy;
    this.editBanner?.querySelector('button')?.toggleAttribute('disabled', busy);
    const clear = this.drawer?.querySelector('.bd-navigator-clear');
    if (clear) clear.disabled = busy || !(this.session?.getMessages().length > 0);
    this.emptyEl?.querySelectorAll('.bd-navigator-quick-actions button').forEach(button => {
      button.disabled = busy;
    });
  }

  // ==================== TRANSCRIPT RENDERING ====================

  renderTranscript() {
    if (!this.transcriptEl) return;

    this.messageNodes.clear();
    this.transcriptEl.replaceChildren();
    if (this.emptyEl) this.transcriptEl.appendChild(this.emptyEl);

    for (const message of this.session?.getMessages() || []) {
      this.appendMessageNode(message);
    }

    this.updateEmptyState();
    this.updateComposerState();
    this.scrollToBottom(true);
  }

  updateEmptyState() {
    if (!this.emptyEl) return;
    this.emptyEl.hidden = (this.session?.getMessages().length || 0) > 0;
  }

  appendMessageNode(message) {
    if (!this.transcriptEl || this.messageNodes.has(message.id)) return;

    const node = document.createElement('article');
    node.className = `bd-navigator-message bd-navigator-message-${message.role}`;
    node.dataset.messageId = message.id;

    const body = document.createElement('div');
    body.className = 'bd-navigator-message-body';

    const toolTrail = document.createElement('section');
    toolTrail.className = 'bd-navigator-tool-trail';
    toolTrail.hidden = true;

    const status = document.createElement('div');
    status.className = 'bd-navigator-message-status';

    const proposals = document.createElement('div');
    proposals.className = 'bd-navigator-proposals';

    const actions = document.createElement('div');
    actions.className = 'bd-navigator-message-actions';

    node.append(toolTrail, body, proposals, status, actions);
    this.transcriptEl.appendChild(node);
    this.messageNodes.set(message.id, { node, body, toolTrail, proposals, status, actions });
    this.updateMessageNode(message);
  }

  updateMessageNode(message) {
    const parts = this.messageNodes.get(message.id);
    if (!parts) {
      this.appendMessageNode(message);
      return;
    }

    const { node, body, toolTrail, proposals, status, actions } = parts;
    node.dataset.status = message.status;

    const isAssistant = message.role === 'assistant';
    body.classList.toggle('bd-navigator-markdown', isAssistant);
    if (isAssistant) this.renderMarkdown(body, message.content || '');
    else this.renderText(body, message.content || '');
    this.renderToolTrail(toolTrail, message);
    this.renderProposals(proposals, message);
    this.renderMessageActions(actions, message);

    const hasRunningTool = Array.isArray(message.toolActivityTrail)
      && message.toolActivityTrail.some(activity => activity.status === 'running');
    if (message.status === 'error') {
      status.replaceChildren(this.createErrorNode(message.error));
    } else if (message.status === 'aborted') {
      status.textContent = 'Stopped.';
      status.className = 'bd-navigator-message-status bd-navigator-status-muted';
    } else if (message.status === 'pending' && !hasRunningTool) {
      status.replaceChildren(this.createThinkingIndicator());
      status.className = 'bd-navigator-message-status';
    } else {
      status.replaceChildren();
      status.className = 'bd-navigator-message-status';
    }
  }

  renderAllProposalStates() {
    for (const message of this.session?.getMessages?.() || []) {
      const parts = this.messageNodes.get(message.id);
      if (parts?.proposals) this.renderProposals(parts.proposals, message);
    }
  }

  renderAllMessageActions() {
    for (const message of this.session?.getMessages?.() || []) {
      const parts = this.messageNodes.get(message.id);
      if (parts?.actions) this.renderMessageActions(parts.actions, message);
    }
  }

  toolActivityLabel(name) {
    const labels = {
      get_plot_components: 'Read Plot Components',
      search_story_cards: 'Search Story Cards',
      get_story_card: 'Read Story Card',
      search_story_history: 'Search story history',
      get_story_actions: 'Read story actions',
      search_memory_bank: 'Search Memory Bank',
      get_memory: 'Read Memory Bank entry',
    };
    return labels[name] || 'Use Navigator tool';
  }

  toolActivityMeta(activity) {
    const summary = activity?.summary || {};
    const parts = [];
    if (summary.query) parts.push(`“${summary.query}”`);
    if (summary.target) parts.push(summary.target);
    if (Number.isFinite(summary.resultCount)) {
      parts.push(Number.isFinite(summary.resultTotal)
        ? `${summary.resultCount} of ${summary.resultTotal} results`
        : `${summary.resultCount} ${summary.resultCount === 1 ? 'result' : 'results'}`);
    }
    if (summary.detail) parts.push(summary.detail);
    if (Number.isFinite(activity?.durationMs)) {
      parts.push(activity.durationMs < 1000 ? `${activity.durationMs} ms` : `${(activity.durationMs / 1000).toFixed(1)} s`);
    }
    return parts.join(' · ');
  }

  renderToolTrail(container, message) {
    if (!container) return;
    const activities = Array.isArray(message.toolActivityTrail)
      ? message.toolActivityTrail.filter(activity => activity && !String(activity.name || '').startsWith('propose_'))
      : [];
    if (!activities.length) {
      container.hidden = true;
      container.replaceChildren();
      return;
    }

    const wasLive = container.dataset.live === 'true';
    const isLive = activities.some(activity => activity.status === 'running');
    const failures = activities.filter(activity => activity.status === 'error').length;
    container.hidden = false;
    container.dataset.live = String(isLive);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'bd-navigator-tool-trail-toggle';
    const summary = document.createElement('span');
    summary.className = 'bd-navigator-tool-trail-summary';
    summary.textContent = isLive
      ? `Using ${activities.length} ${activities.length === 1 ? 'tool' : 'tools'}`
      : `Used ${activities.length} ${activities.length === 1 ? 'tool' : 'tools'}${failures ? ` · ${failures} failed` : ''}`;
    const chevron = document.createElement('span');
    chevron.className = 'icon-chevron-down bd-navigator-tool-trail-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.append(summary, chevron);

    const region = document.createElement('div');
    region.className = 'bd-navigator-tool-trail-region';
    const list = document.createElement('ol');
    list.className = 'bd-navigator-tool-steps';
    for (const activity of activities) {
      const item = document.createElement('li');
      item.className = 'bd-navigator-tool-step';
      item.dataset.status = activity.status || 'error';
      const icon = document.createElement('span');
      icon.className = activity.status === 'running'
        ? 'bd-navigator-tool-step-icon bd-navigator-tool-step-running'
        : activity.status === 'success'
          ? 'icon-circle-check bd-navigator-tool-step-icon'
          : 'icon-triangle-alert bd-navigator-tool-step-icon';
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'bd-navigator-tool-step-text';
      const label = document.createElement('strong');
      label.textContent = this.toolActivityLabel(activity.name);
      text.appendChild(label);
      const metaText = this.toolActivityMeta(activity);
      if (metaText) {
        const meta = document.createElement('small');
        meta.textContent = metaText;
        text.appendChild(meta);
      }
      item.append(icon, text);
      list.appendChild(item);
    }
    region.appendChild(list);
    container.replaceChildren(toggle, region);

    const setExpanded = expanded => {
      container.dataset.expanded = String(expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
    };
    if (isLive) {
      delete container.dataset.manuallyToggled;
      setExpanded(true);
    } else if (wasLive) {
      setExpanded(true);
      requestAnimationFrame(() => {
        if (container.isConnected && container.dataset.live === 'false') setExpanded(false);
      });
    } else if (container.dataset.manuallyToggled !== 'true') {
      setExpanded(false);
    } else {
      setExpanded(container.dataset.expanded === 'true');
    }
    toggle.addEventListener('click', () => {
      container.dataset.manuallyToggled = 'true';
      setExpanded(container.dataset.expanded !== 'true');
    });
  }

  createMessageAction(label, iconClass, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bd-navigator-message-action';
    button.setAttribute('aria-label', label);
    button.title = label;
    const icon = document.createElement('span');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    button.append(icon, text);
    button.addEventListener('click', onClick);
    return button;
  }

  renderMessageActions(container, message) {
    if (!container) return;
    container.replaceChildren();
    const state = this.session?.getMessageActionState?.(message.id) || { busy: false };
    if (message.role === 'assistant' && message.content) {
      const copy = this.createMessageAction('Copy', 'icon-copy', () => this.copyAssistantMessage(message.id, copy));
      container.appendChild(copy);
    }
    if (message.role === 'user' && state.editable) {
      const edit = this.createMessageAction('Edit', 'icon-pencil', () => this.beginMessageEdit(message.id));
      edit.disabled = state.busy;
      container.appendChild(edit);
    }
    if (message.role === 'assistant' && state.retryable) {
      const retry = this.createMessageAction('Retry', 'icon-rotate-ccw', () => this.retryMessage(message.id));
      retry.disabled = state.busy;
      container.appendChild(retry);
    }
  }

  async copyAssistantMessage(messageId, button) {
    const message = this.session?.findMessage?.(messageId);
    if (!message?.content || !button) return;
    const original = button.querySelector('span:last-child')?.textContent || 'Copy';
    try {
      await navigator.clipboard.writeText(message.content);
      button.querySelector('span:last-child').textContent = 'Copied';
      button.setAttribute('aria-label', 'Copied');
    } catch {
      button.querySelector('span:last-child').textContent = 'Copy unavailable';
      button.setAttribute('aria-label', 'Copy unavailable');
    }
    setTimeout(() => {
      if (!button.isConnected) return;
      button.querySelector('span:last-child').textContent = original;
      button.setAttribute('aria-label', original);
    }, 1600);
  }

  async retryMessage(messageId) {
    if (!this.session || this.session.isBusy) return;
    this.cancelMessageEdit({ focus: false });
    this.autoScroll = true;
    await this.session.retryAssistantMessage?.(messageId);
    this.updateComposerState();
    this.focusComposer(true);
  }

  renderProposals(container, message) {
    container.replaceChildren();
    const proposals = Array.isArray(message.proposals) ? message.proposals : [];
    if (!proposals.length) return;

    const readOnly = this.session?.getPermissionState?.().readOnly === true;
    const chatBusy = this.session?.isBusy === true;
    for (const proposal of proposals) {
      container.appendChild(this.createProposalCard(message.id, proposal, { readOnly, chatBusy }));
    }
  }

  createProposalCard(messageId, proposal, state) {
    const card = document.createElement('section');
    card.className = 'bd-navigator-proposal';
    card.dataset.status = proposal.status;

    const header = document.createElement('div');
    header.className = 'bd-navigator-proposal-header';
    const heading = document.createElement('div');
    heading.className = 'bd-navigator-proposal-heading';
    const action = document.createElement('span');
    action.className = 'bd-navigator-proposal-action';
    action.textContent = this.proposalActionLabel(proposal);
    const target = document.createElement('strong');
    target.className = 'bd-navigator-proposal-target';
    target.textContent = proposal.targetLabel || 'Proposed change';
    heading.append(action, target);
    const status = document.createElement('span');
    status.className = 'bd-navigator-proposal-status';
    status.textContent = this.proposalStatusLabel(proposal.status);
    header.append(heading, status);
    card.appendChild(header);

    if (proposal.reason) {
      const reason = document.createElement('p');
      reason.className = 'bd-navigator-proposal-reason';
      reason.textContent = proposal.reason;
      card.appendChild(reason);
    }

    const changes = document.createElement('div');
    changes.className = 'bd-navigator-proposal-changes';
    for (const change of proposal.changes || []) {
      changes.appendChild(this.createProposalChange(change));
    }
    card.appendChild(changes);

    if (proposal.irreversible) {
      const warning = document.createElement('p');
      warning.className = 'bd-navigator-proposal-warning';
      warning.textContent = 'Deletion is permanent. Navigator cannot undo this action.';
      card.appendChild(warning);
    }

    if (proposal.error?.message) {
      const error = document.createElement('p');
      error.className = 'bd-navigator-proposal-error';
      error.textContent = proposal.error.message;
      card.appendChild(error);
    }
    if (proposal.updatedAtDrift) {
      const drift = document.createElement('p');
      drift.className = 'bd-navigator-proposal-note';
      drift.textContent = 'The card had an unrelated timestamp update while Navigator applied this change.';
      card.appendChild(drift);
    }
    const hasPlotUILimitation = proposal.kind === 'plot_component' && (
      proposal.field === 'memory'
      || proposal.field === 'authorsNote'
      || proposal.targetLabel === 'Plot Essentials'
      || proposal.targetLabel === "Author's Note"
    );
    if (hasPlotUILimitation && proposal.status === 'applied') {
      const limitation = document.createElement('p');
      limitation.className = 'bd-navigator-proposal-note';
      limitation.appendChild(document.createTextNode("Plot Essentials and Author's Note changes don't update the UI due to technical limitations. "));
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'bd-navigator-proposal-refresh';
      refresh.textContent = 'Refresh';
      refresh.setAttribute('aria-label', 'Refresh AI Dungeon to show the applied Plot changes');
      refresh.addEventListener('click', () => window.location.reload());
      limitation.appendChild(refresh);
      card.appendChild(limitation);
    }
    if (proposal.status !== 'pending') return card;
    const actions = document.createElement('div');
    actions.className = 'bd-navigator-proposal-buttons';
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'bd-navigator-proposal-reject';
    reject.textContent = 'Reject';
    const apply = document.createElement('button');
    apply.type = 'button';
    const destructive = proposal.irreversible === true || proposal.action === 'delete';
    apply.className = destructive
      ? 'bd-navigator-proposal-apply bd-navigator-proposal-delete'
      : 'bd-navigator-proposal-apply';
    apply.textContent = destructive ? 'Delete' : 'Apply';

    reject.disabled = state.chatBusy;
    apply.disabled = state.chatBusy || state.readOnly;
    if (state.readOnly) apply.title = 'Read-only mode is enabled.';
    else if (state.chatBusy) apply.title = 'Wait for Navigator to finish this response.';
    reject.addEventListener('click', () => this.session?.rejectProposal(messageId, proposal.id));
    apply.addEventListener('click', () => this.session?.applyProposal(messageId, proposal.id));
    actions.append(reject, apply);
    card.appendChild(actions);
    return card;
  }

  createProposalChange(change) {
    const row = document.createElement('div');
    row.className = 'bd-navigator-proposal-change';
    const label = document.createElement('span');
    label.className = 'bd-navigator-proposal-field';
    label.textContent = change.label || 'Value';
    const comparison = document.createElement('div');
    comparison.className = 'bd-navigator-proposal-comparison';
    comparison.append(
      this.createProposalValue('Before', change.before),
      this.createProposalValue('After', change.after)
    );
    row.append(label, comparison);
    return row;
  }

  createProposalValue(labelText, value) {
    const wrap = document.createElement('div');
    wrap.className = 'bd-navigator-proposal-value';
    const label = document.createElement('span');
    label.textContent = labelText;
    const content = document.createElement('pre');
    const normalized = value === null || value === undefined ? '' : String(value);
    content.textContent = normalized || '(empty)';
    wrap.append(label, content);
    return wrap;
  }

  proposalActionLabel(proposal) {
    const labels = {
      add: 'Add',
      modify: 'Modify',
      remove: 'Remove',
      enable: 'Enable',
      disable: 'Disable',
      create: 'Create',
      delete: 'Delete',
    };
    return labels[proposal.action] || 'Change';
  }

  proposalStatusLabel(status) {
    const labels = {
      pending: 'Needs approval',
      queued: 'Queued',
      applying: 'Applying…',
      applied: 'Applied',
      rejected: 'Rejected',
      conflict: 'Conflict',
      error: 'Failed',
      expired: 'Expired',
    };
    return labels[status] || String(status || 'Pending');
  }

  renderText(container, text) {
    container.replaceChildren();
    if (!text) return;

    for (const block of text.split(/\n{2,}/)) {
      if (!block.trim()) continue;
      const paragraph = document.createElement('p');
      paragraph.className = 'bd-navigator-paragraph';

      const lines = block.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) paragraph.appendChild(document.createElement('br'));
        paragraph.appendChild(document.createTextNode(line));
      });

      container.appendChild(paragraph);
    }
  }

  // Model output is untrusted. Markdown is converted with DOM nodes only;
  // raw HTML is never parsed or assigned to innerHTML.
  renderMarkdown(container, text) {
    container.replaceChildren();
    if (!text) return;

    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index++;
        continue;
      }

      const fence = this.matchMarkdownFence(line);
      if (fence) {
        const codeLines = [];
        index++;
        while (index < lines.length && !this.isMarkdownFenceClose(lines[index], fence)) {
          codeLines.push(lines[index]);
          index++;
        }
        if (index < lines.length) index++;

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (fence.language) code.dataset.language = fence.language;
        codeLines.forEach((codeLine, lineIndex) => {
          if (lineIndex > 0) code.appendChild(document.createElement('br'));
          code.appendChild(document.createTextNode(codeLine));
        });
        pre.appendChild(code);
        container.appendChild(pre);
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = Math.min(heading[1].length + 2, 6);
        const node = document.createElement(`h${level}`);
        this.renderInlineMarkdown(node, heading[2]);
        container.appendChild(node);
        index++;
        continue;
      }

      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        container.appendChild(document.createElement('hr'));
        index++;
        continue;
      }

      const tableHeader = this.splitMarkdownTableRow(line);
      const tableDivider = this.parseMarkdownTableDivider(lines[index + 1]);
      if (tableHeader && tableDivider && tableHeader.length === tableDivider.length) {
        const table = document.createElement('table');
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        tableHeader.forEach((cellText, cellIndex) => {
          const cell = document.createElement('th');
          if (tableDivider[cellIndex]) cell.dataset.align = tableDivider[cellIndex];
          this.renderInlineMarkdown(cell, cellText);
          headRow.appendChild(cell);
        });
        head.appendChild(headRow);
        table.appendChild(head);
        index += 2;

        const body = document.createElement('tbody');
        while (index < lines.length) {
          const cells = this.splitMarkdownTableRow(lines[index]);
          if (!cells || cells.length !== tableHeader.length) break;
          const row = document.createElement('tr');
          cells.forEach((cellText, cellIndex) => {
            const cell = document.createElement('td');
            if (tableDivider[cellIndex]) cell.dataset.align = tableDivider[cellIndex];
            this.renderInlineMarkdown(cell, cellText);
            row.appendChild(cell);
          });
          body.appendChild(row);
          index++;
        }
        if (body.children.length) table.appendChild(body);
        container.appendChild(table);
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoted = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quoted.push(lines[index].replace(/^\s*>\s?/, ''));
          index++;
        }
        const quote = document.createElement('blockquote');
        this.renderMarkdown(quote, quoted.join('\n'));
        container.appendChild(quote);
        continue;
      }

      const listMatch = this.matchMarkdownListItem(line);
      if (listMatch) {
        const parsedList = this.parseMarkdownList(lines, index);
        container.appendChild(parsedList.node);
        index = parsedList.index;
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !this.isMarkdownBlockStart(lines[index], lines[index + 1])
      ) {
        paragraphLines.push(lines[index]);
        index++;
      }
      if (!paragraphLines.length) {
        paragraphLines.push(lines[index]);
        index++;
      }

      const paragraph = document.createElement('p');
      paragraph.className = 'bd-navigator-paragraph';
      paragraphLines.forEach((paragraphLine, lineIndex) => {
        const visibleLine = paragraphLine.replace(/(?: {2,}|\\)$/, '');
        this.renderInlineMarkdown(paragraph, visibleLine);
        if (lineIndex >= paragraphLines.length - 1) return;
        paragraph.appendChild(document.createElement('br'));
      });
      container.appendChild(paragraph);
    }
  }

  matchMarkdownFence(line) {
    const match = String(line || '').match(/^\s{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^\r\n]*$/);
    if (!match) return null;
    return {
      marker: match[1][0],
      length: match[1].length,
      language: (match[2] || '').toLowerCase(),
    };
  }

  isMarkdownFenceClose(line, fence) {
    const match = String(line || '').match(/^\s{0,3}(`+|~+)\s*$/);
    return !!(
      match &&
      match[1][0] === fence.marker &&
      match[1].length >= fence.length
    );
  }

  splitMarkdownTableRow(line) {
    const source = String(line || '').trim();
    if (!source || !source.includes('|')) return null;

    const value = source.replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cell = '';
    let escaped = false;
    for (const char of value) {
      if (escaped) {
        cell += char;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '|') {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += char;
      }
    }
    if (escaped) cell += '\\';
    cells.push(cell.trim());
    return cells.length > 1 ? cells : null;
  }

  parseMarkdownTableDivider(line) {
    const cells = this.splitMarkdownTableRow(line);
    if (!cells || cells.some(cell => !/^:?-{3,}:?$/.test(cell))) return null;
    return cells.map(cell => {
      const left = cell.startsWith(':');
      const right = cell.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      return 'left';
    });
  }

  markdownIndent(value) {
    return String(value || '').replace(/\t/g, '    ').length;
  }

  matchMarkdownListItem(line) {
    const match = String(line || '').match(/^([ \t]*)(?:([-+*])|(\d+)[.)])[ \t]+(.+)$/);
    if (!match) return null;
    return {
      indent: this.markdownIndent(match[1]),
      ordered: !!match[3],
      start: match[3] ? Number(match[3]) : null,
      content: match[4],
    };
  }

  parseMarkdownList(lines, startIndex) {
    const first = this.matchMarkdownListItem(lines[startIndex]);
    const list = document.createElement(first.ordered ? 'ol' : 'ul');
    if (first.ordered && first.start > 1) list.start = first.start;

    const baseIndent = first.indent;
    const ordered = first.ordered;
    let index = startIndex;

    while (index < lines.length) {
      const itemMatch = this.matchMarkdownListItem(lines[index]);
      if (!itemMatch || itemMatch.indent !== baseIndent || itemMatch.ordered !== ordered) break;

      const item = document.createElement('li');
      this.renderInlineMarkdown(item, itemMatch.content);
      index++;

      while (index < lines.length) {
        let contentIndex = index;
        while (contentIndex < lines.length && !lines[contentIndex].trim()) contentIndex++;

        const nestedItem = this.matchMarkdownListItem(lines[contentIndex]);
        if (nestedItem && nestedItem.indent > baseIndent) {
          const nested = this.parseMarkdownList(lines, contentIndex);
          item.appendChild(nested.node);
          index = nested.index;
          continue;
        }

        const nestedBlock = String(lines[contentIndex] || '').match(/^([ \t]+)>\s?(.*)$/);
        if (nestedBlock && this.markdownIndent(nestedBlock[1]) > baseIndent) {
          const quoted = [];
          index = contentIndex;
          while (index < lines.length) {
            const quoteLine = String(lines[index] || '').match(/^([ \t]+)>\s?(.*)$/);
            if (!quoteLine || this.markdownIndent(quoteLine[1]) <= baseIndent) break;
            quoted.push(quoteLine[2]);
            index++;
          }
          const quote = document.createElement('blockquote');
          this.renderMarkdown(quote, quoted.join('\n'));
          item.appendChild(quote);
          continue;
        }

        const continuation = String(lines[contentIndex] || '').match(/^([ \t]+)(\S.*)$/);
        if (continuation && this.markdownIndent(continuation[1]) > baseIndent) {
          item.appendChild(document.createElement('br'));
          this.renderInlineMarkdown(item, continuation[2]);
          index = contentIndex + 1;
          continue;
        }
        break;
      }

      list.appendChild(item);

      let nextItemIndex = index;
      while (nextItemIndex < lines.length && !lines[nextItemIndex].trim()) nextItemIndex++;
      const nextItem = this.matchMarkdownListItem(lines[nextItemIndex]);
      if (!nextItem || nextItem.indent !== baseIndent || nextItem.ordered !== ordered) break;
      index = nextItemIndex;
    }

    return { node: list, index };
  }

  isMarkdownBlockStart(line, nextLine = '') {
    if (!line || !line.trim()) return true;
    if (this.matchMarkdownFence(line)) return true;
    if (/^\s*#{1,6}\s+/.test(line)) return true;
    if (/^\s*>\s?/.test(line)) return true;
    if (this.matchMarkdownListItem(line)) return true;
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
    const tableHeader = this.splitMarkdownTableRow(line);
    const tableDivider = this.parseMarkdownTableDivider(nextLine);
    if (tableHeader && tableDivider && tableHeader.length === tableDivider.length) return true;
    return false;
  }

  renderInlineMarkdown(container, text) {
    let remaining = String(text || '');
    let plain = '';

    const flushPlain = () => {
      if (!plain) return;
      container.appendChild(document.createTextNode(plain));
      plain = '';
    };

    while (remaining) {
      const escaped = remaining.match(/^\\([\\`*_[\]~])/);
      if (escaped) {
        plain += escaped[1];
        remaining = remaining.slice(escaped[0].length);
        continue;
      }

      const code = remaining.match(/^`([^`\n]+)`/);
      if (code) {
        flushPlain();
        const node = document.createElement('code');
        node.textContent = code[1];
        container.appendChild(node);
        remaining = remaining.slice(code[0].length);
        continue;
      }

      const link = remaining.match(/^\[([^\]\n]+)]\(([^)\s]+)\)/);
      if (link) {
        const node = this.createSafeMarkdownLink(link[1], link[2]);
        if (node) {
          flushPlain();
          container.appendChild(node);
          remaining = remaining.slice(link[0].length);
          continue;
        }
      }

      const formats = [
        { pattern: /^\*\*\*([^*\n]+)\*\*\*/, tag: 'strong', nested: 'em' },
        { pattern: /^___([^_\n]+)___/, tag: 'strong', nested: 'em', underscore: true },
        { pattern: /^\*\*([^*\n]+)\*\*/, tag: 'strong' },
        { pattern: /^__([^_\n]+)__/, tag: 'strong', underscore: true },
        { pattern: /^~~([^~\n]+)~~/, tag: 'del' },
        { pattern: /^\*([^*\n]+)\*/, tag: 'em' },
        { pattern: /^_([^_\n]+)_/, tag: 'em', underscore: true },
      ];
      let formatted = false;
      for (const format of formats) {
        const match = remaining.match(format.pattern);
        if (!match) continue;
        if (format.underscore) {
          const previous = plain.slice(-1) || container.textContent.slice(-1);
          const following = remaining[match[0].length] || '';
          if (/^[\p{L}\p{N}]$/u.test(previous) || /^[\p{L}\p{N}]$/u.test(following)) continue;
        }
        flushPlain();
        const node = document.createElement(format.tag);
        const target = format.nested ? document.createElement(format.nested) : node;
        this.renderInlineMarkdown(target, match[1]);
        if (target !== node) node.appendChild(target);
        container.appendChild(node);
        remaining = remaining.slice(match[0].length);
        formatted = true;
        break;
      }
      if (formatted) continue;

      plain += remaining[0];
      remaining = remaining.slice(1);
    }

    flushPlain();
  }

  createSafeMarkdownLink(label, href) {
    try {
      const url = new URL(href, window.location.href);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
      const link = document.createElement('a');
      link.textContent = label;
      link.href = url.href;
      link.rel = 'noopener noreferrer';
      if (url.protocol !== 'mailto:') link.target = '_blank';
      return link;
    } catch {
      return null;
    }
  }

  createThinkingIndicator() {
    const wrap = document.createElement('span');
    wrap.className = 'bd-navigator-thinking';
    wrap.setAttribute('aria-label', 'Navigator is thinking');

    const label = document.createElement('span');
    label.className = 'bd-navigator-activity-label';
    label.textContent = 'Thinking';
    wrap.appendChild(label);

    const dots = document.createElement('span');
    dots.className = 'bd-navigator-thinking-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) {
      dots.appendChild(document.createElement('i'));
    }
    wrap.appendChild(dots);
    return wrap;
  }

  createErrorNode(error) {
    const wrap = document.createElement('div');
    wrap.className = 'bd-navigator-error';

    const icon = document.createElement('span');
    icon.className = 'icon-triangle-alert';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.textContent = error?.message || 'Navigator could not complete that request.';

    wrap.append(icon, text);
    return wrap;
  }

  scrollToBottom(force = false) {
    if (!this.transcriptEl) return;
    if (!force && !this.autoScroll) return;
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }
}

if (typeof window !== 'undefined') {
  window.NavigatorFeature = NavigatorFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NavigatorFeature;
}
