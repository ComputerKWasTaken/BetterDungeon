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

    const isAssistant = message.role === 'assistant';
    body.classList.toggle('bd-navigator-markdown', isAssistant);
    if (isAssistant) this.renderMarkdown(body, message.content || '');
    else this.renderText(body, message.content || '');

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
        code.textContent = codeLines.join('\n');
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
        { pattern: /^___([^_\n]+)___/, tag: 'strong', nested: 'em' },
        { pattern: /^\*\*([^*\n]+)\*\*/, tag: 'strong' },
        { pattern: /^__([^_\n]+)__/, tag: 'strong' },
        { pattern: /^~~([^~\n]+)~~/, tag: 'del' },
        { pattern: /^\*([^*\n]+)\*/, tag: 'em' },
        { pattern: /^_([^_\n]+)_/, tag: 'em' },
      ];
      let formatted = false;
      for (const format of formats) {
        const match = remaining.match(format.pattern);
        if (!match) continue;
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
