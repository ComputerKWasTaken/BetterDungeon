// BetterDungeon - Navigator Feature
//
// Adventure-page copilot shell: a right-pinned overlay drawer with a launcher,
// transcript, and composer. The AI Dungeon play page is an absolutely
// positioned Tamagui layer stack with a fixed-width content container, so
// Navigator overlays the right gutter instead of reflowing the layout, and
// falls back to a full-screen sheet when there is no gutter to occupy.
//
// NavigatorSession owns live streaming chat and a bounded, read-only adventure
// snapshot assembled from Plot Components, Story Cards, and recent actions.

class NavigatorFeature {
  static id = 'navigator';

  static MIN_DRAWER_WIDTH = 340;
  static MAX_DRAWER_WIDTH = 560;
  static SHEET_BREAKPOINT = 900;
  static WIDTH_STORAGE_KEY = 'betterDungeon_navigator_width';

  constructor() {
    this.enabled = true;
    this.debug = false;

    this.currentAdventureId = null;
    this.session = null;
    this.unsubscribe = null;

    this.launcher = null;
    this.drawer = null;
    this.transcriptEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.emptyEl = null;
    this.messageNodes = new Map();

    this.isOpen = false;
    this.drawerWidth = 420;
    this.autoScroll = true;

    this.boundUrlChange = null;
    this.boundResize = null;
    this.boundKeydown = null;
    this.adventureObserver = null;
    this.detectionDebounce = null;
    this.originalPushState = null;
    this.originalReplaceState = null;

    this.dragState = null;
    this.boundDragMove = null;
    this.boundDragEnd = null;
  }

  log(message, ...args) {
    if (this.debug) console.log(message, ...args);
  }

  isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  isOwnNode(node) {
    if (!node) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;
    return !!(this.drawer?.contains(element) || this.launcher?.contains(element));
  }

  // ==================== LIFECYCLE ====================

  async init() {
    console.log('[Navigator] Initializing Navigator feature...');
    await this.loadWidth();
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
    console.log('[Navigator] Initialization complete');
  }

  destroy() {
    console.log('[Navigator] Destroying Navigator feature...');
    this.stopAdventureChangeDetection();
    this.endDrag();
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

    this.boundResize = () => this.applyLayout();
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
    this.unsubscribe = this.session.subscribe((event, payload) => this.onSessionEvent(event, payload));
    // Clear any previous adventure's transcript immediately rather than
    // leaving it on screen until storage resolves.
    this.renderTranscript();
    this.session.load().then(() => this.renderTranscript());
    this.session.refreshContext().catch(error => {
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
    } else if (event === 'append') {
      this.appendMessageNode(payload);
      this.updateEmptyState();
      this.scrollToBottom();
    } else if (event === 'update') {
      this.updateMessageNode(payload);
      this.scrollToBottom();
    } else if (event === 'context') {
      this.updateSubtitle();
    }

    this.updateComposerState();
  }

  // ==================== WIDTH ====================

  async loadWidth() {
    if (!this.isExtensionContextValid()) return;
    const stored = await new Promise((resolve) => {
      try {
        chrome.storage.local.get(
          NavigatorFeature.WIDTH_STORAGE_KEY,
          result => resolve((result || {})[NavigatorFeature.WIDTH_STORAGE_KEY])
        );
      } catch {
        resolve(null);
      }
    });
    if (Number.isFinite(stored)) this.drawerWidth = this.clampWidth(stored);
  }

  saveWidth() {
    if (!this.isExtensionContextValid()) return;
    try {
      chrome.storage.local.set({ [NavigatorFeature.WIDTH_STORAGE_KEY]: this.drawerWidth });
    } catch {
      /* noop */
    }
  }

  clampWidth(width) {
    return Math.max(
      NavigatorFeature.MIN_DRAWER_WIDTH,
      Math.min(NavigatorFeature.MAX_DRAWER_WIDTH, Math.round(width))
    );
  }

  // A drawer is only worth showing when it can sit beside the story instead of
  // on top of it. Otherwise Navigator becomes a full-screen sheet.
  shouldUseSheet() {
    if (window.innerWidth < NavigatorFeature.SHEET_BREAKPOINT) return true;

    const gameplay = document.getElementById('gameplay-output');
    if (!gameplay) return false;

    const rect = gameplay.getBoundingClientRect();
    const availableRight = window.innerWidth - rect.right;
    return !isFinite(availableRight) || availableRight < NavigatorFeature.MIN_DRAWER_WIDTH;
  }

  applyLayout() {
    if (!this.drawer) return;
    const sheet = this.shouldUseSheet();
    this.drawer.classList.toggle('bd-navigator-sheet', sheet);
    this.drawer.style.width = sheet ? '' : `${this.drawerWidth}px`;
  }

  // ==================== UI ====================

  createUI() {
    if (!this.launcher) this.createLauncher();
    if (!this.drawer) this.createDrawer();
  }

  removeUI() {
    this.launcher?.remove();
    this.launcher = null;
    this.drawer?.remove();
    this.drawer = null;
    this.transcriptEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.emptyEl = null;
    this.messageNodes.clear();
    this.isOpen = false;
  }

  createLauncher() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bd-navigator-launcher';
    button.setAttribute('aria-label', 'Open Navigator');
    button.title = 'Navigator (Alt+N)';
    button.innerHTML = '<span class="icon-compass" aria-hidden="true"></span>';
    button.addEventListener('click', () => this.toggleDrawer());

    document.body.appendChild(button);
    this.launcher = button;
  }

  createDrawer() {
    const drawer = document.createElement('aside');
    drawer.className = 'bd-navigator-drawer';
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Navigator');
    drawer.hidden = true;

    const resize = document.createElement('div');
    resize.className = 'bd-navigator-resize';
    resize.setAttribute('role', 'separator');
    resize.setAttribute('aria-label', 'Resize Navigator');
    resize.addEventListener('mousedown', event => this.beginDrag(event));

    const header = document.createElement('header');
    header.className = 'bd-navigator-header';
    header.innerHTML = `
      <span class="bd-navigator-mark icon-compass" aria-hidden="true"></span>
      <div class="bd-navigator-heading">
        <h2 class="bd-navigator-title">Navigator</h2>
        <p class="bd-navigator-subtitle"></p>
      </div>
      <button type="button" class="bd-navigator-icon-btn bd-navigator-clear" aria-label="Clear conversation" title="Clear conversation">
        <span class="icon-eraser" aria-hidden="true"></span>
      </button>
      <button type="button" class="bd-navigator-icon-btn bd-navigator-close" aria-label="Close Navigator" title="Close">
        <span class="icon-x" aria-hidden="true"></span>
      </button>
    `;

    const transcript = document.createElement('div');
    transcript.className = 'bd-navigator-transcript';
    transcript.setAttribute('role', 'log');
    transcript.setAttribute('aria-live', 'polite');

    const empty = document.createElement('div');
    empty.className = 'bd-navigator-empty';
    empty.innerHTML = `
      <span class="bd-navigator-empty-icon icon-compass" aria-hidden="true"></span>
      <p class="bd-navigator-empty-title">Ask Navigator</p>
      <p class="bd-navigator-empty-text">Navigator can help you plan Plot Component rewrites, draft Story Cards, and think through where your story is going.</p>
      <p class="bd-navigator-empty-note">Navigator reads a budgeted snapshot of this adventure. It can draft changes, but cannot apply them.</p>
    `;
    transcript.appendChild(empty);

    // Deliberately not a <form>: a form on the AI Dungeon page risks a stray
    // submit navigating away from the adventure.
    const composer = document.createElement('div');
    composer.className = 'bd-navigator-composer';
    composer.innerHTML = `
      <textarea class="bd-navigator-input" rows="1" placeholder="Ask Navigator..." aria-label="Message Navigator"></textarea>
      <div class="bd-navigator-composer-actions">
        <span class="bd-navigator-hint">Enter to send &middot; Shift+Enter for a new line</span>
        <button type="button" class="bd-navigator-stop" hidden>
          <span class="icon-square" aria-hidden="true"></span> Stop
        </button>
        <button type="button" class="bd-navigator-send" aria-label="Send message">
          <span class="icon-send" aria-hidden="true"></span>
        </button>
      </div>
    `;

    drawer.append(resize, header, transcript, composer);
    document.body.appendChild(drawer);

    this.drawer = drawer;
    this.transcriptEl = transcript;
    this.emptyEl = empty;
    this.inputEl = composer.querySelector('.bd-navigator-input');
    this.sendBtn = composer.querySelector('.bd-navigator-send');
    this.stopBtn = composer.querySelector('.bd-navigator-stop');

    header.querySelector('.bd-navigator-close').addEventListener('click', () => this.closeDrawer());
    header.querySelector('.bd-navigator-clear').addEventListener('click', () => this.handleClear());
    this.stopBtn.addEventListener('click', () => this.session?.abort());

    this.sendBtn.addEventListener('click', () => this.handleSend());

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
    this.updateSubtitle();
    this.updateComposerState();
    this.renderTranscript();
  }

  // ==================== OPEN / CLOSE ====================

  toggleDrawer() {
    if (this.isOpen) this.closeDrawer();
    else this.openDrawer();
  }

  openDrawer() {
    if (!this.drawer) return;
    this.isOpen = true;
    this.drawer.hidden = false;
    this.launcher?.classList.add('bd-navigator-launcher-active');
    this.applyLayout();
    this.updateSubtitle();
    this.scrollToBottom(true);
    this.inputEl?.focus();
  }

  closeDrawer() {
    if (!this.drawer) return;
    if (this.session?.isBusy) this.session.abort();
    this.isOpen = false;
    this.drawer.hidden = true;
    this.launcher?.classList.remove('bd-navigator-launcher-active');
  }

  handleGlobalKeydown(event) {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key?.toLowerCase() === 'n') {
      if (!this.drawer) return;
      event.preventDefault();
      this.toggleDrawer();
      return;
    }

    if (event.key === 'Escape' && this.isOpen && this.drawer?.contains(document.activeElement)) {
      event.preventDefault();
      this.closeDrawer();
    }
  }

  // ==================== RESIZE ====================

  beginDrag(event) {
    if (this.drawer?.classList.contains('bd-navigator-sheet')) return;
    event.preventDefault();

    this.dragState = { startX: event.clientX, startWidth: this.drawerWidth };
    this.boundDragMove = moveEvent => this.onDrag(moveEvent);
    this.boundDragEnd = () => this.endDrag();

    document.addEventListener('mousemove', this.boundDragMove);
    document.addEventListener('mouseup', this.boundDragEnd);
    document.body.classList.add('bd-navigator-resizing');
  }

  onDrag(event) {
    if (!this.dragState) return;
    // The drawer is pinned right, so dragging left widens it.
    const delta = this.dragState.startX - event.clientX;
    this.drawerWidth = this.clampWidth(this.dragState.startWidth + delta);
    this.applyLayout();
  }

  endDrag() {
    if (!this.dragState) return;
    this.dragState = null;
    if (this.boundDragMove) document.removeEventListener('mousemove', this.boundDragMove);
    if (this.boundDragEnd) document.removeEventListener('mouseup', this.boundDragEnd);
    this.boundDragMove = null;
    this.boundDragEnd = null;
    document.body.classList.remove('bd-navigator-resizing');
    this.saveWidth();
  }

  // ==================== COMPOSER ====================

  autosizeInput() {
    if (!this.inputEl) return;
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 160)}px`;
  }

  handleSend() {
    if (!this.session || !this.inputEl) return;
    const text = this.inputEl.value;
    if (!text.trim() || this.session.isBusy) return;

    this.inputEl.value = '';
    this.autosizeInput();
    this.autoScroll = true;
    this.session.send(text);
    this.updateComposerState();
  }

  handleClear() {
    if (!this.session) return;
    this.session.clear();
    this.autoScroll = true;
  }

  updateComposerState() {
    const busy = !!this.session?.isBusy;
    if (this.sendBtn) this.sendBtn.disabled = busy;
    if (this.stopBtn) this.stopBtn.hidden = !busy;
  }

  updateSubtitle() {
    const subtitle = this.drawer?.querySelector('.bd-navigator-subtitle');
    if (!subtitle) return;

    const context = this.session?.getContextSummary?.();
    if (!context || context.state === 'idle') {
      subtitle.textContent = 'Preparing adventure context…';
      return;
    }
    if (context.state === 'loading') {
      subtitle.textContent = 'Refreshing adventure context…';
      return;
    }
    if (context.state === 'error') {
      subtitle.textContent = 'Adventure context unavailable';
      return;
    }

    const title = context.title ? `${context.title} · ` : '';
    const coverage = `${context.plotPopulated || 0}/4 plot · ${context.cardsIncluded || 0}/${context.cardsTotal || 0} cards · ${context.actionsIncluded || 0} actions`;
    subtitle.textContent = `${title}${coverage}${context.partial ? ' · partial' : ''}`;
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

    const status = document.createElement('div');
    status.className = 'bd-navigator-message-status';

    node.append(body, status);
    this.transcriptEl.appendChild(node);
    this.messageNodes.set(message.id, { node, body, status });
    this.updateMessageNode(message);
  }

  updateMessageNode(message) {
    const parts = this.messageNodes.get(message.id);
    if (!parts) {
      this.appendMessageNode(message);
      return;
    }

    const { node, body, status } = parts;
    node.dataset.status = message.status;

    this.renderText(body, message.content || '');

    if (message.status === 'pending') {
      status.replaceChildren(this.createThinkingIndicator());
    } else if (message.status === 'error') {
      status.replaceChildren(this.createErrorNode(message.error));
    } else if (message.status === 'aborted') {
      status.textContent = 'Stopped.';
      status.className = 'bd-navigator-message-status bd-navigator-status-muted';
    } else {
      status.replaceChildren();
      status.className = 'bd-navigator-message-status';
    }
  }

  // Model output is untrusted text. It is written with textContent only.
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

  createThinkingIndicator() {
    const wrap = document.createElement('span');
    wrap.className = 'bd-navigator-thinking';
    wrap.setAttribute('aria-label', 'Navigator is thinking');
    for (let i = 0; i < 3; i++) {
      wrap.appendChild(document.createElement('i'));
    }
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
