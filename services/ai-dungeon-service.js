// BetterDungeon — AI Dungeon Service
// Centralized DOM query layer for AI Dungeon's adventure page.
// Provides stable selectors based on ARIA labels, roles, and scarce IDs
// so that selector updates only need to happen in one place.
// Reference: Project Management/docs/13-DOM/ for full DOM documentation.

class AIDungeonService {

  // ==================== CENTRALIZED SELECTORS ====================
  // Stable selectors derived from AI Dungeon's ARIA attributes and IDs.
  // These survive framework updates better than volatile atomic CSS classes.

  static SEL = {
    // --- Core IDs (scarce but reliable) ---
    GAMEPLAY_OUTPUT:      '#gameplay-output',
    TEXT_INPUT:           '#game-text-input',
    BLUR_BUTTON:         '#game-blur-button',        // Reused across multiple nav-bar buttons — always disambiguate with aria-label
    SATURATE_FILTER:     '#gameplay-saturate',
    ACTION_ICON:         '#action-icon',
    ACTION_TEXT:         '#action-text',
    TRANSITION_OPACITY:  '#transition-opacity',
    MODEL_SWITCHER_ID:   '#model-switcher-title',

    // --- Navigation Bar ---
    NAV_BAR:             '[aria-label="Navigation bar"]',
    GAME_MENU:           '[aria-label="Game Menu"]',
    GAME_SETTINGS:       '[aria-label="Game settings"]',
    UNDO:                '[aria-label="Undo change"]',
    REDO:                '[aria-label="Redo change"]',
    MODEL_SWITCHER_BTN:  '[aria-label="Model Switcher"]',
    STORY_TITLE:         '[aria-label^="Story title:"]',

    // --- Input Area ---
    SUBMIT_ACTION:       '[aria-label="Submit action"]',
    CLOSE_INPUT:         '[aria-label="Close text input"]',
    CHANGE_MODE:         '[aria-label="Change input mode"]',
    CLOSE_MODE_MENU:     '[aria-label="Close \'Input Mode\' menu"]',

    // --- Command Bar ---
    COMMAND_BAR:         '[aria-label="Command bar"]',
    CMD_TAKE_TURN:       '[aria-label="Command: take a turn"]',
    CMD_CONTINUE:        '[aria-label="Command: continue"]',
    CMD_RETRY:           '[aria-label="Command: retry"]',
    CMD_ERASE:           '[aria-label="Command: erase"]',

    // --- Model Switcher Dialog ---
    MODEL_DIALOG:        '[role="dialog"][aria-labelledby="model-switcher-title"]',

    // --- Settings Panel ---
    CLOSE_SETTINGS:      '[aria-label="Close settings"]',
    SECTION_TABS:        '[aria-label="Section Tabs"]',
    TAB:                 '[role="tab"]',
    TABLIST:             '[role="tablist"]',

    // --- Settings Accordions ---
    ACCESSIBILITY:       '[aria-label="Accessibility"]',
    BEHAVIOR:            '[aria-label="Behavior"]',

    // --- Plot Textareas (targeted by placeholder substring) ---
    AI_INSTRUCTIONS:     'textarea[placeholder*="Influence the AI\'s responses"]',
    AUTHORS_NOTE:        'textarea[placeholder*="Influence the AI\'s writing style"]',
    PLOT_ESSENTIALS:     'textarea[placeholder*="important information about the adventure"]',

    // --- Story Cards Section ---
    GRID_VIEW:           '[aria-label="Grid view"]',
    LIST_VIEW:           '[aria-label="List view"]',
    COMPACT_VIEW:        '[aria-label="Compact view"]',
    FILTERS_BTN:         '[aria-label="Filters"]',
    SEARCH_BOX:          '[role="searchbox"][placeholder="Search"]',
    CARD_TYPE_BADGE:     'span[aria-label^="type:"]',    // e.g. aria-label="type: character"
    CARD_HEADING:        'h1[role="heading"]',            // Card name inside role="button" cards
    ADD_STORY_CARD:      '[aria-label="Add Story Card"]', // "Add a story card" button (grid view)
    IMPORT_CARDS:        '[aria-label="import story cards"]',
    EXPORT_CARDS:        '[aria-label="export story cards"]',

    // --- Structural Classes (Tamagui) ---
    IS_BUTTON:           '.is_Button',
    IS_VIEW:             '.is_View',
    IS_TEXT:             '.is_Text',
    IS_TEXTAREA:         '.is_TextArea',
    FONT_ICONS:          '.font_icons',
    FONT_BODY:           '.font_body',
    FONT_HEADING:        '.font_heading',
    FONT_MONO:           '.font_mono',
  };

  // Input mode selectors keyed by lowercase mode name
  static MODES = {
    do:      '[aria-label="Set to \'Do\' mode"]',
    say:     '[aria-label="Set to \'Say\' mode"]',
    story:   '[aria-label="Set to \'Story\' mode"]',
    see:     '[aria-label="Set to \'See\' mode"]',
    try:     '[aria-label="Set to \'Try\' mode"]',
    command: '[aria-label="Set to \'Command\' mode"]',
  };

  // Icon glyphs for each native input mode (useful for submit-button identification)
  static MODE_ICONS = {
    do:    'w_run',
    say:   'w_comment',
    story: 'w_paper_plane',
    see:   'w_image',
  };

  // CDN base for theme sprite sheets
  static THEME_SPRITE_BASE = 'https://latitude-standard-pull-zone-1.b-cdn.net/site_assets/aidungeon/client/themes/';

  // ==================== MARKDOWN FORMAT OPTIONS ====================
  // Each option defines a toggleable formatting type with its syntax,
  // instruction text for the AI, and whether it's enabled by default.
  // The instruction text follows BetterRepository's one-line dash standard.

  static MARKDOWN_FORMAT_OPTIONS = [
    {
      id: 'bold',
      label: 'Bold',
      syntax: '++text++',
      preview: '<strong>bold</strong>',
      default: true,
      instruction: '- ++Bold++ for emphasis, important names, key objects, or impactful moments',
      example: 'The ++ancient sword++ gleamed in the torchlight.'
    },
    {
      id: 'italic',
      label: 'Italic',
      syntax: '//text//',
      preview: '<em>italic</em>',
      default: true,
      instruction: '- //Italic// for internal thoughts, foreign words, distant sounds, or whispered speech',
      example: '//This can\'t be happening//, she thought.'
    },
    {
      id: 'boldItalic',
      label: 'Bold Italic',
      syntax: '++//text//++',
      preview: '<strong><em>bold italic</em></strong>',
      default: true,
      instruction: '- ++//Bold Italic//++ for intense outbursts, shouting, or extreme emotion; use sparingly',
      example: '++//Never!//++ he roared, slamming his fist on the table.'
    },
    {
      id: 'underline',
      label: 'Underline',
      syntax: '==text==',
      preview: '<u>underline</u>',
      default: true,
      instruction: '- ==Underline== for written or inscribed text, signs, letters, or in-world readable text',
      example: 'The note read: ==Meet me at the docks. Tell no one.=='
    },
    {
      id: 'strikethrough',
      label: 'Strikethrough',
      syntax: '~~text~~',
      preview: '<s>strikethrough</s>',
      default: true,
      instruction: '- ~~Strikethrough~~ for redacted text, crossed-out words, or corrected information',
      example: 'The ledger entry read: ~~500 gold~~ 200 gold.'
    },
    {
      id: 'highlight',
      label: 'Highlight',
      syntax: '::text::',
      preview: '<mark>highlight</mark>',
      default: true,
      instruction: '- ::Highlight:: for magically glowing text, critical clues, or supernaturally emphasized words',
      example: 'The rune pulsed with light: ::Speak thy name::'
    },
    {
      id: 'smallText',
      label: 'Small Text',
      syntax: '~text~',
      preview: '<span class="bd-small-text">whisper</span>',
      default: true,
      instruction: '- ~Small Text~ for barely audible whispers, fading speech, or distant sounds; very rare',
      example: '~"...please... don\'t leave..."~'
    },
    {
      id: 'horizontalRule',
      label: 'Scene Break',
      syntax: '---',
      preview: 'scene break',
      default: true,
      instruction: '- --- for scene breaks, significant time skips, or perspective shifts; place on its own line',
      example: null
    },
    {
      id: 'blockquote',
      label: 'Blockquote',
      syntax: '>> text',
      preview: '<span style="border-left:2px solid;padding-left:6px;opacity:0.85;font-style:italic;">quoted</span>',
      default: true,
      instruction: '- >> Blockquote for letters, excerpts, proclamations, or recalled speech; place >> at the start of the line',
      example: '>> "In the beginning, there was only silence."'
    },
    {
      id: 'list',
      label: 'List',
      syntax: '- item',
      preview: '&bull; list item',
      default: true,
      instruction: '- Unordered lists using "- item" for inventory, choices, or organized information',
      example: null
    }
  ];

  // Default config: all options enabled
  static DEFAULT_MARKDOWN_CONFIG = Object.fromEntries(
    AIDungeonService.MARKDOWN_FORMAT_OPTIONS.map(opt => [opt.id, opt.default])
  );

  // Build markdown instructions dynamically based on user config.
  // Follows BetterRepository's instruction structure:
  // - ## Category header
  // - One-line dash standard
  // - Directive + components
  static buildMarkdownInstructions(config) {
    const enabledOptions = AIDungeonService.MARKDOWN_FORMAT_OPTIONS.filter(opt => config[opt.id]);

    if (enabledOptions.length === 0) {
      return '';
    }

    const lines = [];

    // Header
    lines.push('## Formatting');
    lines.push('Use the following custom Markdown syntax to enrich the narrative:');
    lines.push('');

    // Syntax section — one-line dash standard per enabled option
    for (const opt of enabledOptions) {
      lines.push(opt.instruction);
    }

    return lines.join('\n');
  }

  // Build condensed Author's Note instructions based on user config.
  // Author's Note is for short-form writing style directives, so we
  // condense the enabled formatting options into a single-line reminder.
  static buildAuthorsNoteInstructions(config) {
    const enabledOptions = AIDungeonService.MARKDOWN_FORMAT_OPTIONS.filter(opt => config[opt.id]);

    if (enabledOptions.length === 0) {
      return '';
    }

    const syntaxList = enabledOptions.map(opt => opt.syntax).join(', ');
    return `Apply custom Markdown formatting throughout: ${syntaxList}.`;
  }

  // Legacy static property for backward compatibility
  static get MARKDOWN_INSTRUCTIONS() {
    return AIDungeonService.buildMarkdownInstructions(AIDungeonService.DEFAULT_MARKDOWN_CONFIG);
  }

  // ==================== CONSTRUCTOR & DEBUG ====================

  constructor() {
    this.domUtils = window.DOMUtils;
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log('[AIDungeonService]', message, ...args);
    }
  }

  // ==================== PAGE DETECTION ====================

  // Whether the current hostname is AI Dungeon
  isOnAIDungeon() {
    return window.location.hostname.includes('aidungeon.com');
  }

  // Whether the URL indicates an active adventure
  isOnAdventurePage() {
    return window.location.pathname.includes('/adventure/');
  }

  // Extract the adventure UUID from the URL, or null
  getAdventureId() {
    const match = window.location.pathname.match(/\/adventure\/([^/]+)/);
    return match ? match[1] : null;
  }

  // Checks for actual adventure UI elements, not just the URL
  isAdventureUIReady() {
    return !!(this.getGameplayOutput() && (this.getSettingsButton() || this.getNavBar()));
  }

  // ==================== ELEMENT QUERIES ====================
  // Single-element getters returning the DOM node or null.
  // Features should prefer these over raw querySelector calls so
  // selector updates only need to happen here.

  // --- Navigation Bar ---
  getNavBar()             { return document.querySelector(AIDungeonService.SEL.NAV_BAR); }
  getGameMenuButton()     { return document.querySelector(AIDungeonService.SEL.GAME_MENU); }
  getSettingsButton()     { return document.querySelector(AIDungeonService.SEL.GAME_SETTINGS); }
  getUndoButton()         { return document.querySelector(AIDungeonService.SEL.UNDO); }
  getRedoButton()         { return document.querySelector(AIDungeonService.SEL.REDO); }
  getModelSwitcherButton(){ return document.querySelector(AIDungeonService.SEL.MODEL_SWITCHER_BTN); }
  getStoryTitle()         { return document.querySelector(AIDungeonService.SEL.STORY_TITLE); }

  // Returns the story title text, e.g. "You're the Eccentric Cousin"
  getStoryTitleText() {
    return this.getStoryTitle()?.textContent?.trim() || null;
  }

  // Returns the current AI model name from the Model Switcher button image alt
  getCurrentModelName() {
    const img = this.getModelSwitcherButton()?.querySelector('img');
    return img?.alt || null;
  }

  // --- Story Output ---
  getGameplayOutput()     { return document.querySelector(AIDungeonService.SEL.GAMEPLAY_OUTPUT); }
  getTransitionOpacity()  { return document.querySelector(AIDungeonService.SEL.TRANSITION_OPACITY); }

  // Returns all #action-icon elements (one per story action block)
  getActionIcons()        { return document.querySelectorAll(AIDungeonService.SEL.ACTION_ICON); }
  // Returns all #action-text elements
  getActionTexts()        { return document.querySelectorAll(AIDungeonService.SEL.ACTION_TEXT); }

  // --- Input Area ---
  getTextInput()          { return document.querySelector(AIDungeonService.SEL.TEXT_INPUT); }
  getSubmitButton()       { return document.querySelector(AIDungeonService.SEL.SUBMIT_ACTION); }
  getCloseInputButton()   { return document.querySelector(AIDungeonService.SEL.CLOSE_INPUT); }
  getModeButton()         { return document.querySelector(AIDungeonService.SEL.CHANGE_MODE); }
  getCloseModeMenuButton(){ return document.querySelector(AIDungeonService.SEL.CLOSE_MODE_MENU); }

  // --- Command Bar ---
  getCommandBar()         { return document.querySelector(AIDungeonService.SEL.COMMAND_BAR); }
  getTakeATurnButton()    { return document.querySelector(AIDungeonService.SEL.CMD_TAKE_TURN); }
  getContinueButton()     { return document.querySelector(AIDungeonService.SEL.CMD_CONTINUE); }
  getRetryButton()        { return document.querySelector(AIDungeonService.SEL.CMD_RETRY); }
  getEraseButton()        { return document.querySelector(AIDungeonService.SEL.CMD_ERASE); }

  // --- Model Switcher Dialog ---
  getModelDialog()        { return document.querySelector(AIDungeonService.SEL.MODEL_DIALOG); }
  isModelSwitcherOpen()   { return !!this.getModelDialog(); }

  // --- Settings Panel ---
  getCloseSettingsButton(){ return document.querySelector(AIDungeonService.SEL.CLOSE_SETTINGS); }
  getSectionTabsContainer() { return document.querySelector(AIDungeonService.SEL.SECTION_TABS); }

  // ==================== INPUT MODE QUERIES ====================

  // Returns the expanded input mode menu container, or null if closed
  getInputModeMenu() {
    // The menu parent wraps all mode buttons; detect via the Do button's parent
    const doBtn = document.querySelector(AIDungeonService.MODES.do);
    return doBtn ? doBtn.parentElement : null;
  }

  // Returns a specific mode button by lowercase name (e.g., 'do', 'try', 'command')
  getModeButtonByName(modeName) {
    const sel = AIDungeonService.MODES[modeName.toLowerCase()];
    return sel ? document.querySelector(sel) : null;
  }

  // Returns all currently visible mode buttons inside the expanded menu
  getAllModeButtons() {
    const menu = this.getInputModeMenu();
    if (!menu) return [];
    return Array.from(menu.children).filter(el =>
      el.getAttribute('aria-label')?.startsWith("Set to '")
    );
  }

  // Reads the currently active input mode from the collapsed mode bar label
  detectCurrentMode() {
    const modeBtn = this.getModeButton();
    if (!modeBtn) return null;
    const label = modeBtn.querySelector('.font_body');
    return label ? label.textContent.trim().toLowerCase() : null;
  }

  // Whether the expanded input mode menu is currently visible
  isModeMenuOpen() {
    return !!document.querySelector(AIDungeonService.MODES.do);
  }

  // Opens the expanded mode menu and waits for it to appear
  async openModeMenu(maxWaitMs = 1000) {
    if (this.isModeMenuOpen()) return true;
    const btn = this.getModeButton();
    if (!btn) return false;
    btn.click();
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await this.wait(50);
      if (this.isModeMenuOpen()) return true;
    }
    return false;
  }

  // Closes the expanded mode menu via the back/close button
  closeModeMenu() {
    const closeBtn = this.getCloseModeMenuButton();
    if (closeBtn) closeBtn.click();
  }

  // Switches to the specified input mode (opens menu, clicks mode, verifies)
  async switchToMode(modeName, options = {}) {
    const { maxWaitMs = 1500 } = options;
    const target = modeName.toLowerCase();

    // Already active — no-op
    if (this.detectCurrentMode() === target) {
      return { success: true, alreadyActive: true };
    }

    if (!(await this.openModeMenu())) {
      return { success: false, error: 'Could not open input mode menu' };
    }
    await this.wait(50);

    const modeBtn = this.getModeButtonByName(target);
    if (!modeBtn) {
      this.closeModeMenu();
      return { success: false, error: `Mode '${target}' button not found` };
    }

    modeBtn.click();
    await this.wait(200);

    // Verify the switch happened
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (this.detectCurrentMode() === target) return { success: true };
      await this.wait(100);
    }
    return { success: false, error: `Failed to confirm switch to '${target}' mode` };
  }

  // ==================== THEME & SPRITE DETECTION ====================

  // Returns true when the active theme is "Dynamic" (no custom sprite sheet)
  isDynamicTheme() {
    // Sprite themes render absolute-positioned divs with background-image inside buttons.
    // Dynamic themes have no such sprites, or the sprite div has zero width.
    const refBtn = this.getModeButton()
      || document.querySelector('[aria-label^="Set to"]');
    if (refBtn) {
      const spriteDiv = refBtn.querySelector('div[style*="position: absolute"]');
      if (spriteDiv) {
        return parseFloat(window.getComputedStyle(spriteDiv).width) === 0;
      }
    }
    return true; // Default to Dynamic when undetectable
  }

  // Extracts the theme sprite URL from a reference element's background-image
  getThemeSpriteUrl(referenceElement) {
    if (!referenceElement) return null;
    const bgDiv = referenceElement.querySelector('[style*="background-image"]')
      || referenceElement.closest('[style*="background-image"]');
    const match = bgDiv?.style?.backgroundImage?.match(/url\("([^"]+)"\)/);
    return match?.[1] || null;
  }

  // Extracts the theme UUID from a sprite URL
  getThemeIdFromUrl(spriteUrl) {
    const match = spriteUrl?.match(/themes\/([a-f0-9-]+)\.png/);
    return match?.[1] || null;
  }

  // Returns the active text style name ('Print', 'Clean', or 'Hacker'), or null
  getActiveTextStyle() {
    // Text style buttons live inside a blackA2-background container on the Gameplay tab
    const labels = document.querySelectorAll('.is_Text.font_body');
    const header = Array.from(labels).find(el => el.textContent.trim() === 'Text Style');
    const container = header?.closest('.is_Column');
    if (!container) return null;

    const buttons = container.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      // The active button's theme wrapper uses t_coreA0 (bright), inactive uses t_coreA1
      const wrapper = btn.closest('.is_Theme');
      if (wrapper?.classList.contains('t_coreA0')) {
        return btn.querySelector('.is_Text')?.textContent?.trim() || null;
      }
    }
    return null;
  }

  // Reads sprite coordinates from an existing 9-slice cell for replication
  getSpriteCoords(nineSliceCell) {
    const inner = nineSliceCell?.querySelector('[style*="left"]');
    if (!inner) return null;
    const s = inner.style;
    return {
      width:  parseFloat(s.width),
      height: parseFloat(s.height),
      left:   parseFloat(s.left),
      top:    parseFloat(s.top),
      spriteUrl: this.getThemeSpriteUrl(inner),
    };
  }

  // ==================== SETTINGS PANEL ====================

  // Whether the settings panel sidebar is currently open
  isSettingsPanelOpen() {
    // Fastest check: the Close Settings button only exists when the panel is rendered
    if (this.getCloseSettingsButton()) return true;

    // Fallback: look for the top-level tabs (Adventure / Gameplay)
    const adventureTab = this.findTabByText('Adventure');
    const gameplayTab  = this.findTabByText('Gameplay');
    return !!(adventureTab || gameplayTab);
  }

  // Opens the settings panel and waits for it to appear
  async openSettingsPanel() {
    if (this.isSettingsPanelOpen()) {
      return { success: true, alreadyOpen: true };
    }

    const settingsBtn = this.getSettingsButton();
    if (!settingsBtn) {
      return { success: false, error: 'Settings button not found — are you in an adventure?' };
    }

    settingsBtn.click();

    for (let i = 0; i < 20; i++) {
      await this.wait(100);
      if (this.isSettingsPanelOpen()) {
        return { success: true };
      }
    }

    return { success: false, error: 'Settings panel failed to open' };
  }

  // Closes the settings panel via the Close button
  closeSettingsPanel() {
    const btn = this.getCloseSettingsButton();
    if (btn) { btn.click(); return true; }
    return false;
  }

  // ==================== TAB NAVIGATION ====================

  // Locate a role="tab" element by its visible text using multiple strategies
  findTabByText(tabName) {
    const tabs = document.querySelectorAll(AIDungeonService.SEL.TAB);
    const target = tabName.toLowerCase();

    for (const tab of tabs) {
      // 1. aria-label match — handles both "Selected tab plot" and "Tab Story Cards"
      const aria = tab.getAttribute('aria-label')?.toLowerCase() || '';
      if (aria === target || aria.includes(`tab ${target}`)) return tab;

      // 2. ButtonText span (top-level tabs: Adventure, Gameplay)
      const btnText = tab.querySelector('.is_ButtonText');
      if (btnText?.textContent?.trim().toLowerCase() === target) return tab;

      // 3. Paragraph text (section subtabs: Plot, Story Cards, Details, Assets)
      for (const p of tab.querySelectorAll('p.is_Paragraph')) {
        if (p.textContent?.trim().toLowerCase() === target) return tab;
      }

      // 4. Plain font_body span inside subtabs (fallback for non-paragraph labels)
      for (const span of tab.querySelectorAll('.font_body')) {
        if (span.textContent?.trim().toLowerCase() === target) return tab;
      }

      // 5. Full-text fallback
      const full = tab.textContent?.trim().toLowerCase() || '';
      if (full === target || full.endsWith(target)) return tab;
    }
    return null;
  }

  // Whether a given tab element is in the selected/active state
  isTabSelected(tab) {
    if (!tab) return false;

    // Subtabs use "Selected tab ..." prefix in aria-label
    const aria = tab.getAttribute('aria-label')?.toLowerCase() || '';
    if (aria.includes('selected tab')) return true;

    // Standard a11y attributes
    if (tab.getAttribute('aria-selected') === 'true') return true;
    if (tab.getAttribute('data-state') === 'active') return true;

    // AI Dungeon class-based indicator: primary-color bottom border
    // Selected top-level tabs get _bbc-primary, unselected get _bbc-coreA0
    const cls = tab.className || '';
    if (cls.includes('_bbc-primary') || cls.includes('_bbc-c-primary')) {
      if (!cls.includes('_bbc-coreA0') && !cls.includes('_bbc-c-coreA0')) {
        return true;
      }
    }

    return false;
  }

  // Generic: select any tab by name with click + verification polling
  async selectTab(tabName, maxAttempts = 10) {
    const tab = this.findTabByText(tabName);
    if (!tab) {
      return { success: false, error: `${tabName} tab not found` };
    }

    if (this.isTabSelected(tab)) {
      return { success: true, alreadySelected: true };
    }

    tab.click();
    await this.wait(300);

    for (let i = 0; i < maxAttempts; i++) {
      // Re-find in case the DOM rebuilt after the click
      const freshTab = this.findTabByText(tabName);
      if (this.isTabSelected(freshTab || tab)) {
        return { success: true };
      }
      await this.wait(100);
    }

    return { success: false, error: `Failed to select ${tabName} tab` };
  }

  // Convenience wrappers — preserve backward compatibility for callers
  async selectAdventureTab()  { return this.selectTab('Adventure'); }
  async selectGameplayTab()   { return this.selectTab('Gameplay'); }
  async selectPlotTab()       { return this.selectTab('Plot'); }
  async selectStoryCardsTab() { return this.selectTab('Story Cards'); }
  async selectDetailsTab()    { return this.selectTab('Details'); }
  async selectAssetsTab()     { return this.selectTab('Assets'); }

  // ==================== PLOT COMPONENT DETECTION ====================

  // Fallback textarea finder: locates a textarea by its plot component heading text.
  // This handles cases where placeholder-based CSS selectors fail due to
  // unicode apostrophe mismatches (e.g. U+2019 vs U+0027) or placeholder text changes.
  _findTextareaByComponentHeading(headingText) {
    const normalize = (s) => s.replace(/[\u2018\u2019\u2032\u02BC]/g, "'");
    const target = normalize(headingText).toLowerCase();

    for (const heading of document.querySelectorAll('[role="heading"]')) {
      const text = normalize(heading.textContent?.trim() || '').toLowerCase();
      if (text === target) {
        // Plot component DOM structure:
        //   container (.is_Column) > header row (.is_Row) > heading
        //   container (.is_Column) > content area (.is_Column) > textarea
        const container = heading.closest('.is_Column') || heading.parentElement?.parentElement;
        if (container) {
          const textarea = container.querySelector('textarea');
          if (textarea) return textarea;
        }
      }
    }
    return null;
  }

  // Find the AI Instructions textarea if it exists
  findAIInstructionsTextarea() {
    const byPlaceholder = document.querySelector(AIDungeonService.SEL.AI_INSTRUCTIONS);
    if (byPlaceholder) return byPlaceholder;
    // Fallback: locate by component heading (handles unicode apostrophe mismatches)
    return this._findTextareaByComponentHeading('AI Instructions');
  }

  // Find the Author's Note textarea if it exists
  findAuthorsNoteTextarea() {
    const byPlaceholder = document.querySelector(AIDungeonService.SEL.AUTHORS_NOTE);
    if (byPlaceholder) return byPlaceholder;
    // Fallback: locate by component heading (handles unicode apostrophe mismatches)
    return this._findTextareaByComponentHeading("Author's Note");
  }

  // Find the Plot Essentials textarea if it exists
  findPlotEssentialsTextarea() {
    return document.querySelector(AIDungeonService.SEL.PLOT_ESSENTIALS);
  }

  // Check which plot components are currently rendered
  detectExistingPlotComponents() {
    const aiInstructions = this.findAIInstructionsTextarea();
    const authorsNote    = this.findAuthorsNoteTextarea();

    return {
      hasAIInstructions:      !!aiInstructions,
      hasAuthorsNote:         !!authorsNote,
      aiInstructionsTextarea: aiInstructions,
      authorsNoteTextarea:    authorsNote,
    };
  }

  // Check if the "No Active Plot Components" message is showing
  hasNoPlotComponentsMessage() {
    const elements = document.querySelectorAll('p, span, div');
    for (const el of elements) {
      if (el.textContent?.includes('No Active Plot Components')) {
        return true;
      }
    }
    return false;
  }

  // Find the "Add Plot Component" button
  findAddPlotComponentButton() {
    const byAria = document.querySelector('div[aria-label="Add Plot Component"]');
    if (byAria) return byAria;

    // Fallback: scan for a button with matching text
    for (const btn of document.querySelectorAll('button, div[role="button"]')) {
      if (btn.textContent?.toLowerCase().includes('add plot component')) return btn;
    }
    return null;
  }

  // Find a plot component type option in the dropdown/dialog
  findPlotComponentOption(optionName) {
    const selectors = [
      '[role="menuitem"]',
      '[role="option"]',
      '[data-radix-collection-item]',
      'div[role="button"]',
      'button',
    ];
    // Normalize apostrophes — AI Dungeon may use typographic quotes (U+2019)
    const normalize = (s) => s.replace(/[\u2018\u2019\u2032\u02BC]/g, "'");
    const target = normalize(optionName.toLowerCase());

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (normalize(el.textContent?.trim().toLowerCase() || '').includes(target)) return el;
      }
    }
    return null;
  }

  // Create a specific plot component by clicking Add and selecting the option
  async createPlotComponent(componentName) {
    const addBtn = this.findAddPlotComponentButton();
    if (!addBtn) {
      return { success: false, error: 'Add Plot Component button not found' };
    }

    addBtn.click();
    await this.wait(300);

    // Wait for the dropdown/dialog to appear and find the option
    for (let i = 0; i < 15; i++) {
      const option = this.findPlotComponentOption(componentName);
      if (option) {
        option.click();

        // Verify the component rendered by polling for its textarea
        // instead of a flat wait — returns early once detected
        for (let v = 0; v < 8; v++) {
          await this.wait(250);
          if (this._findTextareaByComponentHeading(componentName)) {
            return { success: true };
          }
        }

        // Click registered but textarea not yet detected — still report success
        // as the component may finish rendering during the broader wait cycle
        console.warn(`AIDungeonService: ${componentName} selected but textarea not yet detected`);
        return { success: true };
      }
      await this.wait(100);
    }

    // Close any open dropdown if option wasn't found
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await this.wait(100);

    return { success: false, error: `${componentName} option not found in menu` };
  }

  // Ensure both required plot components exist, creating them if needed
  async ensurePlotComponentsExist(callbacks = {}) {
    let created = [];
    let detection = this.detectExistingPlotComponents();

    const needsAI   = !detection.hasAIInstructions;
    const needsNote = !detection.hasAuthorsNote;

    if (!needsAI && !needsNote) {
      return { success: true, created: false, componentsCreated: [] };
    }

    // Create AI Instructions if missing
    if (needsAI) {
      callbacks.onCreating?.('AI Instructions');
      const r = await this.createPlotComponent('AI Instructions');
      if (r.success) { created.push('AI Instructions'); await this.wait(500); }
    }

    // Refresh detection after creating the first component
    detection = this.detectExistingPlotComponents();

    // Create Author's Note if missing
    if (!detection.hasAuthorsNote) {
      callbacks.onCreating?.("Author's Note");
      const r = await this.createPlotComponent("Author's Note");
      if (r.success) { created.push("Author's Note"); await this.wait(500); }
    }

    return { success: true, created: created.length > 0, componentsCreated: created };
  }

  // ==================== NAVIGATION FLOWS ====================

  // Internal helper: validate page → open settings → select top tab → select sub tab
  // Handles all possible states: panel closed, wrong top tab, wrong subtab.
  async _navigateToSettingsTab(topTab, subTab, options = {}) {
    const { onStepUpdate = null } = options;

    if (!this.isOnAIDungeon()) {
      return { success: false, error: 'Not on AI Dungeon website' };
    }
    if (!this.isOnAdventurePage()) {
      return { success: false, error: 'Navigate to an adventure first' };
    }

    // Step 1: Ensure the settings panel is open
    onStepUpdate?.('Opening settings panel...');
    const panelResult = await this.openSettingsPanel();
    if (!panelResult.success) return panelResult;
    await this.wait(200);

    // Step 2: Select the top-level tab (Adventure / Gameplay)
    onStepUpdate?.(`Selecting ${topTab} tab...`);
    const topResult = await this.selectTab(topTab);
    if (!topResult.success) return topResult;

    // Step 3: If a subtab is requested, wait for it to render then select it
    if (subTab) {
      onStepUpdate?.(`Waiting for ${subTab} tab...`);
      // After switching top tabs, subtabs re-render — poll until the target exists
      const subTabEl = await this.waitFor(
        () => this.findTabByText(subTab),
        { interval: 100, timeout: 3000 }
      );
      if (!subTabEl) {
        return { success: false, error: `${subTab} tab did not appear after selecting ${topTab}` };
      }

      onStepUpdate?.(`Selecting ${subTab} tab...`);
      const subResult = await this.selectTab(subTab);
      if (!subResult.success) return subResult;
      await this.wait(300);
    }

    return { success: true };
  }

  // Navigate to Adventure → Plot
  async navigateToPlotSettings(options = {}) {
    const result = await this._navigateToSettingsTab('Adventure', 'Plot', options);
    if (result.success) options.onStepUpdate?.('Applying instructions...');
    return result;
  }

  // Navigate to Adventure → Story Cards
  async navigateToStoryCardsSettings(options = {}) {
    return this._navigateToSettingsTab('Adventure', 'Story Cards', options);
  }

  // Navigate to Adventure → Details
  async navigateToDetailsSettings(options = {}) {
    return this._navigateToSettingsTab('Adventure', 'Details', options);
  }

  // Navigate to Adventure → Assets
  async navigateToAssetsSettings(options = {}) {
    return this._navigateToSettingsTab('Adventure', 'Assets', options);
  }

  // Navigate to Gameplay tab (no subtab)
  async navigateToGameplaySettings(options = {}) {
    return this._navigateToSettingsTab('Gameplay', null, options);
  }

  // ==================== TEXTAREA WAITING ====================

  // Polls until both AI Instructions and Author's Note textareas are rendered
  async waitForTextareas(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const d = this.detectExistingPlotComponents();
      if (d.hasAIInstructions && d.hasAuthorsNote) {
        return {
          success: true,
          aiInstructionsTextarea: d.aiInstructionsTextarea,
          authorsNoteTextarea:    d.authorsNoteTextarea,
        };
      }
      await this.wait(150);
    }

    const d = this.detectExistingPlotComponents();
    if (!d.hasAIInstructions && !d.hasAuthorsNote) {
      return { success: false, error: 'Neither textarea found — plot components may need to be created' };
    }
    return {
      success: false,
      error: d.hasAIInstructions ? "Author's Note textarea not found" : 'AI Instructions textarea not found',
    };
  }

  // Waits for the adventure UI to be fully loaded (gameplay output + nav controls)
  async waitForAdventureReady(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      if (this.isAdventureUIReady()) {
        await this.wait(300); // Allow remaining elements to settle
        return true;
      }
      await this.wait(250);
    }
    return false;
  }

  // ==================== INSTRUCTION APPLICATION ====================

  // Check if markdown instructions are already present in a textarea.
  // Checks markers from both the full AI Instructions format and the
  // condensed Author's Note format.
  containsInstructions(textarea) {
    if (!textarea) return false;
    const val = textarea.value || '';

    // Markers from full instructions (AI Instructions textarea)
    // and condensed format (Author's Note textarea)
    const markers = [
      '## Formatting',
      'custom Markdown syntax',
      'custom Markdown formatting',
      '[FORMATTING]',
      '++Bold++',
      '//Italic//',
    ];

    return markers.some(m => val.includes(m));
  }

  // Main method to apply instructions to both AI Instructions and Author's Note textareas
  async applyInstructionsToTextareas(instructionsText, options = {}) {
    const { forceApply = false, onCreatingComponents = null, onStepUpdate = null, authorsNoteText = null } = options;

    // Navigate to Plot settings with step callbacks
    const navResult = await this.navigateToPlotSettings({ onStepUpdate });
    if (!navResult.success) return navResult;

    // Initial attempt to find textareas
    let textareas = await this.waitForTextareas(5);
    let componentsCreated = false;

    // If textareas not found, create the missing plot components
    if (!textareas.success) {
      onCreatingComponents?.();
      const ensureResult = await this.ensurePlotComponentsExist({
        onCreating: onCreatingComponents ? (name) => onCreatingComponents(`Creating ${name}...`) : null,
      });

      if (ensureResult.created) {
        componentsCreated = true;
        textareas = await this.waitForTextareas(30); // Longer wait for newly created
      } else {
        textareas = await this.waitForTextareas(20);
      }
    }

    // If full detection failed, try to locate AI Instructions alone.
    // Author's Note being undetectable should not block AI Instructions application.
    if (!textareas.success) {
      const aiTextarea = this.findAIInstructionsTextarea();
      if (aiTextarea) {
        textareas = {
          success: true,
          aiInstructionsTextarea: aiTextarea,
          authorsNoteTextarea: this.findAuthorsNoteTextarea(),
        };
      } else {
        return textareas;
      }
    }

    const { aiInstructionsTextarea, authorsNoteTextarea } = textareas;

    // Check each textarea independently
    const aiHas = this.containsInstructions(aiInstructionsTextarea);
    const noteHas = authorsNoteTextarea ? this.containsInstructions(authorsNoteTextarea) : true;

    // Only report "already applied" when ALL available textareas have instructions
    if (aiHas && noteHas && !forceApply) {
      return { success: true, alreadyApplied: true };
    }

    let appliedCount = 0;

    // Apply to AI Instructions if needed
    if (!aiHas || forceApply) {
      this.domUtils.appendToTextarea(aiInstructionsTextarea, instructionsText);
      appliedCount++;
    }

    // Apply to Author's Note if needed
    if (authorsNoteTextarea && authorsNoteText && (!noteHas || forceApply)) {
      this.domUtils.appendToTextarea(authorsNoteTextarea, authorsNoteText);
      appliedCount++;
    }

    return { success: true, appliedCount, componentsCreated };
  }

  // ==================== INPUT AREA HELPERS ====================

  // Finds the rounded input container that wraps #game-text-input
  getInputContainer() {
    const textarea = this.getTextInput();
    if (!textarea) return null;
    // Walk up to the container with visible border-radius (the styled row)
    const byClass = textarea.closest('div[class*="_btlr-"]');
    if (byClass) return byClass;
    let parent = textarea.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (style.borderRadius && parseFloat(style.borderRadius) > 8) return parent;
      parent = parent.parentElement;
    }
    return null;
  }

  // Detects whether the input drawer is currently open (visible and interactive)
  isInputDrawerOpen() {
    const textarea = this.getTextInput();
    if (!textarea) return false;
    const drawer = textarea.closest('[aria-hidden]');
    // Open state: aria-hidden removed or set to "false"
    return !drawer || drawer.getAttribute('aria-hidden') !== 'true';
  }

  // Gets the icon glyph name from the submit button (varies by active mode)
  getSubmitIconGlyph() {
    const btn = this.getSubmitButton();
    const icon = btn?.querySelector('.font_icons');
    return icon?.textContent?.trim() || null;
  }

  // Whether the submit button is currently enabled (textarea has content)
  isSubmitEnabled() {
    const btn = this.getSubmitButton();
    return btn?.getAttribute('aria-disabled') !== 'true';
  }

  // Sets the text input value using React-compatible native setter
  setTextInputValue(text) {
    const input = this.getTextInput();
    if (!input) return false;

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (setter) {
      setter.call(input, text);
    } else {
      input.value = text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // Returns the current text input value
  getTextInputValue() {
    return this.getTextInput()?.value || '';
  }

  // ==================== INSTRUCTION DATA ====================

  // Builds and returns markdown formatting instructions based on user config.
  // Returns both the full AI Instructions text and the condensed Author's Note text.
  async fetchInstructionsFile() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.sync.get('betterDungeon_markdownOptions', (data) => {
          resolve((data || {}).betterDungeon_markdownOptions || null);
        });
      });
      const config = result || AIDungeonService.DEFAULT_MARKDOWN_CONFIG;
      const instructions = AIDungeonService.buildMarkdownInstructions(config);
      const authorsNote = AIDungeonService.buildAuthorsNoteInstructions(config);
      return { success: true, data: instructions, authorsNoteData: authorsNote };
    } catch (e) {
      // Fallback to default config if storage fails
      const defaultConfig = AIDungeonService.DEFAULT_MARKDOWN_CONFIG;
      return {
        success: true,
        data: AIDungeonService.MARKDOWN_INSTRUCTIONS,
        authorsNoteData: AIDungeonService.buildAuthorsNoteInstructions(defaultConfig),
      };
    }
  }

  // ==================== UTILITIES ====================

  // Simple delay promise
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Polls a condition function until it returns a truthy value or timeout
  async waitFor(conditionFn, { interval = 100, timeout = 2000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = conditionFn();
      if (result) return result;
      await this.wait(interval);
    }
    return null;
  }

  // Returns a promise that resolves when a matching element appears in the DOM
  async waitForElement(selector, { timeout = 3000, root = document } = {}) {
    const existing = root.querySelector(selector);
    if (existing) return existing;

    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; observer.disconnect(); resolve(null); }
      }, timeout);

      const observer = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el && !resolved) {
          resolved = true;
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    });
  }
}

// ==================== GLOBAL & MODULE EXPORTS ====================

if (typeof window !== 'undefined') {
  window.AIDungeonService = AIDungeonService;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIDungeonService;
}
