/**
 * BetterDungeon - BetterScripts Feature
 * 
 * Enables communication between AI Dungeon scripts and BetterDungeon.
 * Scripts embed protocol messages in their output, which BetterDungeon
 * detects, processes, and strips from the visible DOM.
 * 
 * Communication Flow:
 * 1. AI Dungeon script appends [[BD:{json}:BD]] to output text
 * 2. BetterDungeon's MutationObserver detects the message
 * 3. Message is parsed and processed (e.g., widget created)
 * 4. Protocol text is stripped from DOM before user sees it
 * 
 * Protocol Format: [[BD:{"type":"...", "v":"1.0", ...}:BD]]
 */

class BetterScriptsFeature {
  static id = 'betterScripts';
  
  // Protocol version for compatibility checking
  // Format: major.minor - major changes break compatibility
  static PROTOCOL_VERSION = '1.0';
  static PROTOCOL_VERSION_MAJOR = 1;
  
  // Message delimiters for protocol messages
  static MESSAGE_PREFIX = '[[BD:';
  static MESSAGE_SUFFIX = ':BD]]';
  
  // Maximum message size (16KB) to prevent DoS
  static MAX_MESSAGE_SIZE = 16384;
  
  // Allowed HTML elements for custom widgets
  static ALLOWED_TAGS = new Set([
    'div', 'span', 'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'a',
    'pre', 'code', 'blockquote'
  ]);
  
  // Allowed HTML attributes (per-tag or global)
  static ALLOWED_ATTRS = {
    '*': ['class', 'id', 'style', 'title'],
    'a': ['href', 'target', 'rel'],
    'img': ['src', 'alt', 'width', 'height']
  };
  
  // Allowed CSS properties for inline styles
  static ALLOWED_STYLES = new Set([
    'color', 'background-color', 'background',
    'font-size', 'font-weight', 'font-style', 'font-family',
    'text-align', 'text-decoration', 'text-transform',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border', 'border-radius', 'border-color', 'border-width', 'border-style',
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
    'display', 'flex', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'opacity', 'visibility', 'overflow',
    'position', 'top', 'right', 'bottom', 'left', 'z-index'
  ]);
  
  // Valid widget types
  static WIDGET_TYPES = new Set(['stat', 'bar', 'text', 'panel', 'custom', 'badge', 'list', 'icon', 'counter']);
  
  // Valid alignment values for in-bar positioning
  static VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);
  
  // Valid message types
  static MESSAGE_TYPES = new Set(['register', 'widget', 'ping', 'clearAll']);

  constructor() {
    // DOM observation
    this.observer = null;
    this.gameplayObserver = null;
    this.waitForGameplayObserver = null;
    this.debounceTimer = null;
    
    // WeakMap for tracking observed elements (prevents memory leaks, survives DOM changes)
    this.observedElements = new WeakMap();
    
    // State tracking
    this.currentAdventureId = null;
    this.processedMessageHashes = new Map(); // hash -> timestamp for LRU cleanup
    this.messageHashCleanupTimer = null;
    this.registeredWidgets = new Map();
    this.registeredScripts = new Map();
    
    // UI container for script widgets (top bar only)
    this.widgetContainer = null;
    this.widgetZones = { left: null, center: null, right: null };
    
    // URL change detection
    this.boundUrlChangeHandler = null;
    this.originalPushState = null;
    this.originalReplaceState = null;
    
    // Layout detection and resize handling
    this.boundResizeHandler = null;
    this.resizeDebounceTimer = null;
    this.layoutObserver = null;
    this.gameTextMaskObserver = null;
    this.cachedLayout = null;
    
    // Cached regex pattern for protocol messages
    this.protocolRegex = /\[\[BD:([\s\S]*?):BD\]\]/g;
    
    // Re-entry guard for stripProtocolMessagesFromGameplay
    this.isStrippingMessages = false;
    
    // Debug logging (controlled only by this property)
    this.debug = false;
  }

  // ==================== LOGGING ====================

  /**
   * Log a debug message (only when debug mode is enabled)
   */
  log(message, ...args) {
    if (this.debug) {
      console.log(`[BetterScripts] ${message}`, ...args);
    }
  }
  
  /**
   * Set debug mode on/off
   * When enabled: verbose console logging + protocol messages remain visible in the DOM
   */
  setDebugMode(enabled) {
    this.debug = enabled;
    console.log(`[BetterScripts] Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    
    // Expose on window for console access
    if (window.betterScripts) {
      window.betterScripts.debug = enabled;
    }
  }

  /**
   * Log a warning (always shown)
   */
  warn(message, ...args) {
    console.warn(`[BetterScripts] ${message}`, ...args);
  }
  
  /**
   * Log an error (always shown)
   */
  error(message, error = null) {
    if (error) {
      console.error(`[BetterScripts] ${message}`, error);
    } else {
      console.error(`[BetterScripts] ${message}`);
    }
  }

  /**
   * Simple hash function for message deduplication
   * Uses a fast string hash to detect duplicate messages
   */
  hashMessage(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Schedule cleanup of processed message hashes
   * Uses LRU-style cleanup: removes hashes older than 500ms
   * This prevents duplicate processing while allowing intentional repeated updates
   */
  scheduleHashCleanup() {
    if (this.messageHashCleanupTimer) return;
    
    this.messageHashCleanupTimer = setTimeout(() => {
      const now = Date.now();
      const maxAge = 500;
      
      // Remove entries older than maxAge
      for (const [hash, timestamp] of this.processedMessageHashes) {
        if (now - timestamp > maxAge) {
          this.processedMessageHashes.delete(hash);
        }
      }
      
      this.messageHashCleanupTimer = null;
      
      // Reschedule if there are still entries
      if (this.processedMessageHashes.size > 0) {
        this.scheduleHashCleanup();
      }
    }, 250);
  }

  // ==================== LIFECYCLE ====================

  init() {
    console.log('[BetterScripts] Initializing BetterScripts feature...');
    
    // Load persisted debug mode state from storage
    chrome.storage.sync.get('betterDungeon_betterScriptsDebug', (result) => {
      const enabled = result['betterDungeon_betterScriptsDebug'] ?? false;
      if (enabled) {
        this.debug = true;
        console.log('[BetterScripts] Debug mode enabled (restored from settings)');
      }
    });
    
    this.detectCurrentAdventure();
    this.startObserving();
    
    // Widget container is created on-demand when first widget is added
    
    console.log('[BetterScripts] Initialization complete');
  }

  destroy() {
    console.log('[BetterScripts] Destroying BetterScripts feature...');
    
    this.stopObserving();
    this.clearAllWidgets();
    this.removeWidgetContainer();
    this.registeredWidgets.clear();
    this.registeredScripts.clear();
    this.currentAdventureId = null;
    this.processedMessageHashes.clear();
    if (this.messageHashCleanupTimer) {
      clearTimeout(this.messageHashCleanupTimer);
      this.messageHashCleanupTimer = null;
    }
    
    console.log('[BetterScripts] Cleanup complete');
  }

  // ==================== ADVENTURE DETECTION ====================

  getAdventureIdFromUrl() {
    const match = window.location.pathname.match(/\/adventure\/([^\/]+)/);
    return match ? match[1] : null;
  }

  isAdventureUIPresent() {
    const gameplayOutput = document.querySelector('#gameplay-output');
    const settingsButton = document.querySelector(
      '[aria-label="Game settings"], [aria-label="Game Settings"], [aria-label="Game Menu"], [aria-label="Game menu"]'
    );
    return !!(gameplayOutput && settingsButton);
  }

  detectCurrentAdventure() {
    const newAdventureId = this.getAdventureIdFromUrl();
    const adventureUIPresent = this.isAdventureUIPresent();
    const isOnAdventure = newAdventureId && adventureUIPresent;
    
    if (isOnAdventure) {
      if (newAdventureId !== this.currentAdventureId) {
        this.log('Adventure changed:', newAdventureId);
        
        // Clear widgets from previous adventure
        this.clearAllWidgets();
        this.currentAdventureId = newAdventureId;
      }
      
      // Don't create container here - only create when first widget is added
    } else {
      if (this.currentAdventureId) {
        this.log('Left adventure');
        this.clearAllWidgets();
        this.removeWidgetContainer();
      }
      this.currentAdventureId = null;
    }
  }

  // ==================== OBSERVATION ====================

  startObserving() {
    // URL change detection
    this.boundUrlChangeHandler = () => this.detectCurrentAdventure();
    window.addEventListener('popstate', this.boundUrlChangeHandler);
    
    // History API interception
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
    
    // DOM observer for general changes (debounced)
    this.observer = new MutationObserver((mutations) => {
      this.debouncedProcessMutations(mutations);
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    // Immediate observer for gameplay output - strips protocol messages instantly
    this.setupGameplayOutputObserver();
  }
  
  /**
   * Sets up an immediate observer for #gameplay-output
   * Strips [[BD:...:BD]] protocol messages from text nodes as soon as they appear
   * This prevents the user from ever seeing the protocol text
   */
  setupGameplayOutputObserver() {
    const observeGameplayOutput = () => {
      const gameplayOutput = document.querySelector('#gameplay-output');
      if (!gameplayOutput) return;
      
      // Use WeakMap instead of DOM property to track observed elements
      if (this.observedElements.has(gameplayOutput)) return;
      this.observedElements.set(gameplayOutput, { type: 'gameplay', observedAt: Date.now() });
      
      this.log('Setting up immediate gameplay output observer');
      
      // Disconnect existing observer if any
      if (this.gameplayObserver) {
        this.gameplayObserver.disconnect();
      }
      
      this.gameplayObserver = new MutationObserver((mutations) => {
        // Strip protocol messages IMMEDIATELY - no debounce
        this.stripProtocolMessagesFromGameplay();
      });
      
      this.gameplayObserver.observe(gameplayOutput, {
        childList: true,
        subtree: true,
        characterData: true
      });
      
      // Also strip any existing messages
      this.stripProtocolMessagesFromGameplay();
    };
    
    // Try to find existing gameplay output
    observeGameplayOutput();
    
    // Watch for gameplay output to be added (page navigation)
    this.waitForGameplayObserver = new MutationObserver((mutations) => {
      const gameplayOutput = document.querySelector('#gameplay-output');
      if (gameplayOutput && !this.observedElements.has(gameplayOutput)) {
        observeGameplayOutput();
      }
    });
    
    this.waitForGameplayObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  /**
   * Immediately strips all [[BD:...:BD]] protocol messages from gameplay output
   * Called synchronously on every mutation to prevent flash of protocol text
   */
  stripProtocolMessagesFromGameplay() {
    // Re-entry guard - prevent recursive calls from MutationObserver
    if (this.isStrippingMessages) {
      return;
    }
    this.isStrippingMessages = true;
    
    // Disconnect observer to prevent infinite loop from our own DOM changes
    const gameplayOutput = document.querySelector('#gameplay-output');
    if (this.gameplayObserver && gameplayOutput) {
      this.gameplayObserver.disconnect();
    }
    
    try {
      this.stripProtocolMessagesFromGameplayInternal();
    } finally {
      // Reconnect observer after our changes are done
      if (this.gameplayObserver && gameplayOutput) {
        this.gameplayObserver.observe(gameplayOutput, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
      this.isStrippingMessages = false;
    }
  }
  
  /**
   * Internal implementation of protocol message stripping
   */
  stripProtocolMessagesFromGameplayInternal() {
    const gameplayOutput = document.querySelector('#gameplay-output');
    if (!gameplayOutput) return;
    
    // Walk through all text nodes and strip protocol messages
    const walker = document.createTreeWalker(
      gameplayOutput,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    const nodesToProcess = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.includes(BetterScriptsFeature.MESSAGE_PREFIX)) {
        nodesToProcess.push(node);
      }
    }
    
    // Process nodes (separate loop to avoid walker invalidation)
    for (const textNode of nodesToProcess) {
      const originalText = textNode.textContent;
      
      // Reset regex lastIndex before use
      this.protocolRegex.lastIndex = 0;
      
      let match;
      // First, extract and process any messages we haven't seen recently
      while ((match = this.protocolRegex.exec(originalText)) !== null) {
        const rawMessage = match[1];
        
        // Check message size limit
        if (rawMessage.length > BetterScriptsFeature.MAX_MESSAGE_SIZE) {
          this.warn(`Message exceeds size limit (${rawMessage.length} > ${BetterScriptsFeature.MAX_MESSAGE_SIZE}), skipping`);
          continue;
        }
        
        const messageHash = this.hashMessage(rawMessage);
        
        // Skip if we've processed this exact message very recently
        // (prevents duplicates from mutation observer firing multiple times)
        if (!this.processedMessageHashes.has(messageHash)) {
          this.processedMessageHashes.set(messageHash, Date.now());
          
          // Schedule cleanup of old hashes
          this.scheduleHashCleanup();
          
          // Parse and validate the message
          const message = this.parseAndValidateMessage(rawMessage);
          if (message) {
            this.log('Processing message:', message.type);
            this.processMessage(message);
          }
        }
      }
      
      // Strip protocol text from the node (skip when debug mode is on)
      if (!this.debug) {
        this.protocolRegex.lastIndex = 0;
        textNode.textContent = originalText.replace(this.protocolRegex, '');
      }
    }
  }
  
  /**
   * Parse and validate a raw JSON message string
   * Returns the parsed message object or null if invalid
   */
  parseAndValidateMessage(rawMessage) {
    let message;
    
    // Parse JSON
    try {
      message = JSON.parse(rawMessage);
    } catch (e) {
      this.warn('Failed to parse message JSON:', e.message);
      return null;
    }
    
    // Validate message structure
    if (!message || typeof message !== 'object') {
      this.warn('Invalid message format: not an object');
      return null;
    }
    
    // Validate message type
    if (!message.type) {
      this.warn('Message missing required "type" field');
      return null;
    }
    
    if (!BetterScriptsFeature.MESSAGE_TYPES.has(message.type)) {
      this.warn(`Unknown message type: "${message.type}"`);
      return null;
    }
    
    // Validate protocol version if provided
    if (message.v !== undefined) {
      const versionParts = String(message.v).split('.');
      const majorVersion = parseInt(versionParts[0], 10);
      
      if (isNaN(majorVersion) || majorVersion !== BetterScriptsFeature.PROTOCOL_VERSION_MAJOR) {
        this.warn(`Protocol version mismatch: message v${message.v}, expected v${BetterScriptsFeature.PROTOCOL_VERSION}`);
        // Continue anyway - we'll try to process it
      }
    }
    
    return message;
  }

  stopObserving() {
    if (this.boundUrlChangeHandler) {
      window.removeEventListener('popstate', this.boundUrlChangeHandler);
      this.boundUrlChangeHandler = null;
    }
    
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // WeakMap entries are automatically cleaned up when elements are removed from DOM
    // No need to manually clear - just disconnect observers
    
    if (this.gameplayObserver) {
      this.gameplayObserver.disconnect();
      this.gameplayObserver = null;
    }
    
    if (this.waitForGameplayObserver) {
      this.waitForGameplayObserver.disconnect();
      this.waitForGameplayObserver = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  debouncedProcessMutations(mutations) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this.detectCurrentAdventure();
    }, 100);
  }

  // ==================== MESSAGE PROCESSING ====================

  /**
   * Process a validated BetterScripts message
   * Note: Message validation is done in parseAndValidateMessage before this is called
   */
  processMessage(message) {
    this.log('Processing message:', message);
    
    try {
      switch (message.type) {
        case 'register':
          this.handleRegister(message);
          break;
        case 'widget':
          this.handleWidgetCommand(message);
          break;
        case 'ping':
          this.handlePing(message);
          break;
        case 'clearAll':
          this.handleClearAll(message);
          break;
        default:
          // This shouldn't happen if parseAndValidateMessage is working correctly
          this.warn('Unhandled message type:', message.type);
      }
    } catch (error) {
      this.error('Error processing message:', error);
      
      // Emit error event for debugging
      window.dispatchEvent(new CustomEvent('betterscripts:error', {
        detail: { 
          type: 'processing_error',
          message: message,
          error: error.message
        }
      }));
    }
  }

  // ==================== MESSAGE HANDLERS ====================

  /**
   * Handle script registration
   * Scripts should register themselves to establish communication
   */
  handleRegister(message) {
    const { scriptId, scriptName, version, capabilities } = message;
    
    if (!scriptId) {
      console.warn('[BetterScripts] Register message missing scriptId');
      return;
    }
    
    // Always log registration to console
    console.log(`[BetterScripts] 📝 Script registered: ${scriptName || scriptId} v${version || '?'}`);
    this.log('Registration details:', message);
    
    // Store script info locally (content script context)
    this.registeredScripts.set(scriptId, {
      name: scriptName,
      version: version,
      capabilities: capabilities || [],
      registeredAt: Date.now()
    });
    
    // Emit event for other features to listen to
    window.dispatchEvent(new CustomEvent('betterscripts:registered', {
      detail: { scriptId, scriptName, version, capabilities }
    }));
  }

  /**
   * Handle widget creation/update commands
   */
  handleWidgetCommand(message) {
    const { widgetId, target, action, config, data } = message;
    const id = widgetId || target;
    
    if (!id) {
      this.log('Widget message missing ID');
      return;
    }
    
    // Determine the action to perform (default to 'create')
    const effectiveAction = action || 'create';
    const effectiveConfig = config || data;
    
    switch (effectiveAction) {
      case 'create':
        this.createWidget(id, effectiveConfig);
        break;
      case 'update':
        this.updateWidget(id, effectiveConfig);
        break;
      case 'destroy':
        this.destroyWidget(id);
        break;
      default:
        this.log('Unknown widget action:', effectiveAction);
    }
  }

  /**
   * Handle ping messages (for testing connectivity)
   */
  handlePing(message) {
    // Always log to console (not just debug mode) so user can verify connectivity
    console.log('[BetterScripts] 🏓 PONG - Ping received:', message.data);
    this.log('Ping details:', message);
    
    // Emit pong event
    window.dispatchEvent(new CustomEvent('betterscripts:pong', {
      detail: { 
        timestamp: Date.now(),
        requestTimestamp: message.timestamp,
        data: message.data
      }
    }));
  }

  /**
   * Handle clearAll message - efficiently clears all widgets with a single message
   */
  handleClearAll(message) {
    const count = this.registeredWidgets.size;
    console.log(`[BetterScripts] 🧹 Clearing all widgets (${count} widgets)`);
    
    this.clearAllWidgets();
    
    // Emit event
    window.dispatchEvent(new CustomEvent('betterscripts:cleared', {
      detail: { 
        count: count,
        timestamp: Date.now()
      }
    }));
  }

  // ==================== WIDGET SYSTEM ====================

  createWidgetContainer() {
    // Check if container already exists
    if (this.widgetContainer && document.body.contains(this.widgetContainer)) return;
    
    // Create wrapper for widget area
    const wrapper = document.createElement('div');
    wrapper.className = 'bd-betterscripts-wrapper';
    wrapper.id = 'bd-betterscripts-wrapper';
    Object.assign(wrapper.style, {
      position: 'fixed',
      zIndex: '1000',
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column'
    });
    
    // Create widget container (horizontal bar at top)
    this.widgetContainer = document.createElement('div');
    this.widgetContainer.className = 'bd-betterscripts-container';
    this.widgetContainer.id = 'bd-betterscripts-top';
    
    // Create alignment zones within the container (left / center / right)
    const leftZone = document.createElement('div');
    leftZone.className = 'bd-bar-zone bd-bar-left';
    
    const centerZone = document.createElement('div');
    centerZone.className = 'bd-bar-zone bd-bar-center';
    
    const rightZone = document.createElement('div');
    rightZone.className = 'bd-bar-zone bd-bar-right';
    
    this.widgetContainer.appendChild(leftZone);
    this.widgetContainer.appendChild(centerZone);
    this.widgetContainer.appendChild(rightZone);
    
    this.widgetZones = { left: leftZone, center: centerZone, right: rightZone };
    
    wrapper.appendChild(this.widgetContainer);
    
    document.body.appendChild(wrapper);
    this.widgetWrapper = wrapper;
    
    // Apply initial positioning
    this.updateContainerPosition();
    
    // Set up layout monitoring
    this.setupLayoutMonitoring();
    
    this.log('Widget container created');
  }

  /**
   * Detect current page layout elements and calculate positioning
   * Prioritizes game-text-mask for accurate width matching
   */
  detectLayout() {
    const layout = {
      navHeight: 56,       // Default fallback
      contentLeft: 0,
      contentWidth: window.innerWidth,
      contentTop: 56,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      gameTextMask: null   // Reference to the game-text-mask element
    };
    
    // Try to detect actual nav bar height
    const navSelectors = [
      'nav',
      '[role="navigation"]',
      'header',
      '.navbar',
      '#navbar'
    ];
    
    for (const selector of navSelectors) {
      const nav = document.querySelector(selector);
      if (nav) {
        const rect = nav.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 100) {
          layout.navHeight = rect.height;
          layout.contentTop = rect.bottom;
          break;
        }
      }
    }
    
    // PRIMARY: Try to find game-text-mask for exact width matching
    const gameTextMask = document.querySelector('.game-text-mask');
    if (gameTextMask) {
      const rect = gameTextMask.getBoundingClientRect();
      if (rect.width > 100) {
        layout.contentLeft = rect.left;
        layout.contentWidth = rect.width;
        layout.gameTextMask = gameTextMask;
        // Cache the layout
        this.cachedLayout = layout;
        return layout;
      }
    }
    
    // FALLBACK: Try other content selectors
    const contentSelectors = [
      '#gameplay-output',
      '[class*="gameplay"]',
      'main',
      '[role="main"]',
      '.main-content'
    ];
    
    for (const selector of contentSelectors) {
      const content = document.querySelector(selector);
      if (content) {
        const rect = content.getBoundingClientRect();
        if (rect.width > 100) {
          layout.contentLeft = rect.left;
          layout.contentWidth = rect.width;
          break;
        }
      }
    }
    
    // Cache the layout
    this.cachedLayout = layout;
    return layout;
  }

  /**
   * Update container position based on detected layout
   * Aligns with game-text-mask width and positions at top of viewport
   */
  updateContainerPosition() {
    if (!this.widgetWrapper) return;
    
    const layout = this.detectLayout();
    
    // Position wrapper to match game-text-mask
    // Only dynamic positioning is set here — visual styling
    // (padding, gap, font-size) is handled by CSS media queries
    const contentWidth = layout.contentWidth;
    const contentLeft = layout.contentLeft;
    
    Object.assign(this.widgetWrapper.style, {
      top: `${layout.contentTop + 6}px`,
      left: `${contentLeft}px`,
      width: `${contentWidth}px`
    });
    
    this.log('Container positioned:', { top: layout.contentTop + 6, left: contentLeft, width: contentWidth });
  }

  /**
   * Set up monitoring for layout changes
   * Specifically observes game-text-mask for width changes
   */
  setupLayoutMonitoring() {
    // Debounced resize handler
    if (!this.boundResizeHandler) {
      this.boundResizeHandler = () => {
        if (this.resizeDebounceTimer) {
          clearTimeout(this.resizeDebounceTimer);
        }
        this.resizeDebounceTimer = setTimeout(() => {
          this.updateContainerPosition();
        }, 50); // Faster response for smoother updates
      };
      
      window.addEventListener('resize', this.boundResizeHandler);
      window.addEventListener('orientationchange', this.boundResizeHandler);
    }
    
    // PRIMARY: Observe game-text-mask for width changes
    if (window.ResizeObserver && !this.gameTextMaskObserver) {
      const gameTextMask = document.querySelector('.game-text-mask');
      if (gameTextMask) {
        this.gameTextMaskObserver = new ResizeObserver(() => {
          this.boundResizeHandler();
        });
        this.gameTextMaskObserver.observe(gameTextMask);
        this.log('Observing game-text-mask for size changes');
      }
    }
    
    // FALLBACK: Use ResizeObserver on content area if game-text-mask not found
    if (window.ResizeObserver && !this.layoutObserver && !this.gameTextMaskObserver) {
      const contentArea = document.querySelector('#gameplay-output') || 
                          document.querySelector('main') ||
                          document.body;
      
      this.layoutObserver = new ResizeObserver(() => {
        this.boundResizeHandler();
      });
      
      this.layoutObserver.observe(contentArea);
    }
  }
  
  removeWidgetContainer() {
    // Remove wrapper (which contains all containers)
    if (this.widgetWrapper) {
      this.widgetWrapper.remove();
      this.widgetWrapper = null;
    }
    
    // Clear container and zone references
    this.widgetContainer = null;
    this.widgetZones = { left: null, center: null, right: null };
    
    // Clean up observers first (they may reference handlers)
    if (this.gameTextMaskObserver) {
      this.gameTextMaskObserver.disconnect();
      this.gameTextMaskObserver = null;
    }
    
    if (this.layoutObserver) {
      this.layoutObserver.disconnect();
      this.layoutObserver = null;
    }
    
    // Then clean up handlers and timers
    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      window.removeEventListener('orientationchange', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
    
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }
    
    this.cachedLayout = null;
  }

  /**
   * Validate widget configuration
   * Returns an object with { valid: boolean, errors: string[] }
   */
  validateWidgetConfig(widgetId, config) {
    const errors = [];
    
    // Check widget ID
    if (!widgetId || typeof widgetId !== 'string') {
      errors.push('Widget ID must be a non-empty string');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(widgetId)) {
      errors.push('Widget ID must contain only alphanumeric characters, underscores, and hyphens');
    }
    
    // Check config exists
    if (!config || typeof config !== 'object') {
      errors.push('Widget config must be an object');
      return { valid: false, errors };
    }
    
    // Check widget type
    if (!config.type) {
      errors.push('Widget config missing required "type" field');
    } else if (!BetterScriptsFeature.WIDGET_TYPES.has(config.type)) {
      errors.push(`Unknown widget type: "${config.type}". Valid types: ${[...BetterScriptsFeature.WIDGET_TYPES].join(', ')}`);
    }
    
    // Type-specific validation
    if (config.type === 'bar') {
      if (config.max !== undefined && (typeof config.max !== 'number' || config.max <= 0)) {
        errors.push('Bar widget "max" must be a positive number');
      }
      if (config.value !== undefined && typeof config.value !== 'number') {
        errors.push('Bar widget "value" must be a number');
      }
    }
    
    if (config.type === 'panel' && config.items !== undefined) {
      if (!Array.isArray(config.items)) {
        errors.push('Panel widget "items" must be an array');
      }
    }
    
    if (config.type === 'custom' && config.html !== undefined) {
      if (typeof config.html !== 'string') {
        errors.push('Custom widget "html" must be a string');
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Create a widget based on configuration from script
   */
  createWidget(widgetId, config) {
    // Validate configuration
    const validation = this.validateWidgetConfig(widgetId, config);
    if (!validation.valid) {
      this.warn(`Invalid widget config for "${widgetId}":`, validation.errors.join('; '));
      
      // Emit validation error event
      window.dispatchEvent(new CustomEvent('betterscripts:error', {
        detail: { 
          type: 'validation_error',
          widgetId: widgetId,
          errors: validation.errors
        }
      }));
      return;
    }
    
    // If widget already exists, update it in place instead of destroying/recreating
    // Exception: if widget type changed, we need to recreate
    if (this.registeredWidgets.has(widgetId)) {
      const existingData = this.registeredWidgets.get(widgetId);
      if (existingData.config.type === config.type) {
        this.log('Widget exists, updating in place:', widgetId);
        this.updateWidget(widgetId, config);
        return;
      } else {
        // Type changed - destroy old widget and continue to create new one
        this.log('Widget type changed, recreating:', widgetId);
        this.destroyWidget(widgetId);
      }
    }
    
    // Create container on-demand for new widgets
    this.createWidgetContainer();
    
    let widgetElement;
    
    switch (config.type) {
      case 'stat':
        widgetElement = this.createStatWidget(widgetId, config);
        break;
      case 'bar':
        widgetElement = this.createBarWidget(widgetId, config);
        break;
      case 'text':
        widgetElement = this.createTextWidget(widgetId, config);
        break;
      case 'panel':
        widgetElement = this.createPanelWidget(widgetId, config);
        break;
      case 'custom':
        widgetElement = this.createCustomWidget(widgetId, config);
        break;
      case 'badge':
        widgetElement = this.createBadgeWidget(widgetId, config);
        break;
      case 'list':
        widgetElement = this.createListWidget(widgetId, config);
        break;
      case 'icon':
        widgetElement = this.createIconWidget(widgetId, config);
        break;
      case 'counter':
        widgetElement = this.createCounterWidget(widgetId, config);
        break;
      default:
        // This shouldn't happen after validation, but just in case
        this.warn('Unknown widget type:', config.type);
        return;
    }
    
    // Determine alignment zone and append widget
    if (widgetElement && this.widgetContainer) {
      const align = BetterScriptsFeature.VALID_ALIGNMENTS.has(config.align) ? config.align : 'center';
      const zone = this.widgetZones[align];
      if (zone) {
        zone.appendChild(widgetElement);
      } else {
        this.widgetContainer.appendChild(widgetElement);
      }
      this.registeredWidgets.set(widgetId, { element: widgetElement, config });
      this.log('Widget created:', widgetId);
      
      // Emit widget created event
      window.dispatchEvent(new CustomEvent('betterscripts:widget', {
        detail: { action: 'created', widgetId, config }
      }));
    }
  }

  /**
   * Create a stat display widget (label + value)
   */
  createStatWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-stat';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto'; // Re-enable interactions on widget
    
    // Apply order if specified (for flex ordering)
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    const label = document.createElement('span');
    label.className = 'bd-widget-label';
    label.textContent = config.label || 'Stat';
    
    const value = document.createElement('span');
    value.className = 'bd-widget-value';
    value.textContent = config.value ?? '0';
    
    if (config.color) {
      value.style.color = config.color;
    }
    
    widget.appendChild(label);
    widget.appendChild(value);
    
    return widget;
  }

  /**
   * Create a progress bar widget
   */
  createBarWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-bar';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto'; // Re-enable interactions on widget
    
    // Apply order if specified (for flex ordering)
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    const label = document.createElement('span');
    label.className = 'bd-widget-label';
    label.textContent = config.label || 'Progress';
    
    const barContainer = document.createElement('div');
    barContainer.className = 'bd-widget-bar-container';
    
    const barFill = document.createElement('div');
    barFill.className = 'bd-widget-bar-fill';
    
    const max = config.max || 100;
    const percentage = Math.min(100, Math.max(0, ((config.value || 0) / max) * 100));
    barFill.style.width = `${percentage}%`;
    
    if (config.color) {
      barFill.style.backgroundColor = config.color;
    }
    
    const valueText = document.createElement('span');
    valueText.className = 'bd-widget-bar-text';
    valueText.textContent = config.showValue !== false ? `${config.value}/${config.max || 100}` : '';
    
    barContainer.appendChild(barFill);
    barContainer.appendChild(valueText);
    
    widget.appendChild(label);
    widget.appendChild(barContainer);
    
    return widget;
  }

  /**
   * Create a simple text widget
   */
  createTextWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-text';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto'; // Re-enable interactions on widget
    
    // Apply order if specified (for flex ordering)
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    widget.textContent = config.text || '';
    
    if (config.style) {
      Object.assign(widget.style, config.style);
    }
    
    return widget;
  }

  /**
   * Create a panel widget (container with title and content)
   */
  createPanelWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-panel';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto'; // Re-enable interactions on widget
    
    // Apply order if specified (for flex ordering)
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    if (config.title) {
      const title = document.createElement('div');
      title.className = 'bd-widget-panel-title';
      title.textContent = config.title;
      widget.appendChild(title);
    }
    
    const content = document.createElement('div');
    content.className = 'bd-widget-panel-content';
    
    // Support for multiple items in the panel
    if (config.items && Array.isArray(config.items)) {
      config.items.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'bd-widget-panel-item';
        
        if (item.label) {
          const itemLabel = document.createElement('span');
          itemLabel.className = 'bd-widget-panel-item-label';
          itemLabel.textContent = item.label;
          itemEl.appendChild(itemLabel);
        }
        
        if (item.value !== undefined) {
          const itemValue = document.createElement('span');
          itemValue.className = 'bd-widget-panel-item-value';
          itemValue.textContent = item.value;
          if (item.color) itemValue.style.color = item.color;
          itemEl.appendChild(itemValue);
        }
        
        content.appendChild(itemEl);
      });
    } else if (config.content) {
      content.textContent = config.content;
    }
    
    widget.appendChild(content);
    
    return widget;
  }

  /**
   * Create a custom HTML widget with sanitized content
   */
  createCustomWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-custom';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto'; // Re-enable interactions on widget
    
    // Apply order if specified (for flex ordering)
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    // Sanitize and apply HTML content
    if (config.html) {
      const sanitized = this.sanitizeHTML(config.html);
      widget.innerHTML = sanitized;
    }
    
    // Apply custom styles if provided (sanitized)
    if (config.style && typeof config.style === 'object') {
      const sanitizedStyles = this.sanitizeStyleObject(config.style);
      Object.assign(widget.style, sanitizedStyles);
    }
    
    return widget;
  }

  /**
   * Create a badge widget (compact status tag)
   */
  createBadgeWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-badge';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto';
    
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    // Optional icon/emoji prefix
    if (config.icon) {
      const icon = document.createElement('span');
      icon.className = 'bd-widget-badge-icon';
      icon.textContent = config.icon;
      widget.appendChild(icon);
    }
    
    const text = document.createElement('span');
    text.className = 'bd-widget-badge-text';
    text.textContent = config.text || config.label || '';
    widget.appendChild(text);
    
    // Apply color as background tint
    if (config.color) {
      widget.style.setProperty('--badge-color', config.color);
    }
    
    // Variant: outline, solid, subtle (default: subtle)
    if (config.variant) {
      widget.dataset.variant = config.variant;
    }
    
    return widget;
  }

  /**
   * Create a list widget (simple item list)
   */
  createListWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-list';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto';
    
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    // Optional title
    if (config.title) {
      const title = document.createElement('div');
      title.className = 'bd-widget-list-title';
      title.textContent = config.title;
      widget.appendChild(title);
    }
    
    // List items
    const list = document.createElement('ul');
    list.className = 'bd-widget-list-items';
    
    if (config.items && Array.isArray(config.items)) {
      config.items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'bd-widget-list-item';
        
        // Item can be string or object with icon/text/color
        if (typeof item === 'string') {
          li.textContent = item;
        } else {
          if (item.icon) {
            const icon = document.createElement('span');
            icon.className = 'bd-widget-list-item-icon';
            icon.textContent = item.icon;
            li.appendChild(icon);
          }
          const text = document.createElement('span');
          text.textContent = item.text || item.label || '';
          if (item.color) text.style.color = item.color;
          li.appendChild(text);
        }
        
        list.appendChild(li);
      });
    }
    
    widget.appendChild(list);
    return widget;
  }

  /**
   * Create an icon widget (compact icon-only display)
   */
  createIconWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-icon';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto';
    
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    widget.textContent = config.icon || config.text || '●';
    
    if (config.color) {
      widget.style.color = config.color;
    }
    
    if (config.size) {
      widget.style.fontSize = typeof config.size === 'number' ? `${config.size}px` : config.size;
    }
    
    // Optional tooltip
    if (config.tooltip || config.title) {
      widget.title = config.tooltip || config.title;
    }
    
    return widget;
  }

  /**
   * Create a counter widget (compact number with optional delta indicator)
   */
  createCounterWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-counter';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto';
    
    if (config.order !== undefined) {
      widget.style.order = config.order;
    }
    
    // Optional icon/emoji
    if (config.icon) {
      const icon = document.createElement('span');
      icon.className = 'bd-widget-counter-icon';
      icon.textContent = config.icon;
      widget.appendChild(icon);
    }
    
    // Value
    const value = document.createElement('span');
    value.className = 'bd-widget-counter-value';
    value.textContent = config.value ?? 0;
    if (config.color) value.style.color = config.color;
    widget.appendChild(value);
    
    // Optional delta indicator (+5, -3, etc.)
    if (config.delta !== undefined && config.delta !== 0) {
      const delta = document.createElement('span');
      delta.className = 'bd-widget-counter-delta';
      const sign = config.delta > 0 ? '+' : '';
      delta.textContent = sign + config.delta;
      delta.dataset.positive = config.delta > 0 ? 'true' : 'false';
      widget.appendChild(delta);
    }
    
    return widget;
  }

  // ==================== HTML SANITIZATION ====================

  /**
   * Sanitize HTML content using a whitelist-based approach
   * Allows safe tags and attributes while stripping dangerous content
   */
  sanitizeHTML(html) {
    if (typeof html !== 'string') {
      return '';
    }
    
    // Parse HTML into a temporary container
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Recursively sanitize all nodes
    this.sanitizeNode(temp);
    
    return temp.innerHTML;
  }
  
  /**
   * Recursively sanitize a DOM node and its children
   */
  sanitizeNode(node) {
    // Process child nodes in reverse order (so removal doesn't skip nodes)
    const children = Array.from(node.childNodes);
    
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toLowerCase();
        
        // Remove disallowed elements entirely
        if (!BetterScriptsFeature.ALLOWED_TAGS.has(tagName)) {
          // For script/style tags, remove completely
          if (tagName === 'script' || tagName === 'style' || tagName === 'iframe' || tagName === 'object' || tagName === 'embed') {
            child.remove();
            continue;
          }
          
          // For other disallowed tags, unwrap (keep safe content only)
          // Process each grandchild - remove dangerous ones, sanitize and keep safe ones
          const childrenToUnwrap = Array.from(child.childNodes);
          for (const grandchild of childrenToUnwrap) {
            if (grandchild.nodeType === Node.ELEMENT_NODE) {
              const grandchildTag = grandchild.tagName.toLowerCase();
              // Remove dangerous tags entirely - don't let them escape via unwrapping
              if (grandchildTag === 'script' || grandchildTag === 'style' || 
                  grandchildTag === 'iframe' || grandchildTag === 'object' || grandchildTag === 'embed') {
                grandchild.remove();
                continue;
              }
              // Recursively sanitize safe grandchildren
              this.sanitizeNode(grandchild);
            }
            // Move safe content to parent
            child.parentNode.insertBefore(grandchild, child);
          }
          child.remove();
          continue;
        }
        
        // Sanitize attributes
        this.sanitizeAttributes(child, tagName);
        
        // Recursively sanitize children
        this.sanitizeNode(child);
      }
      // Text nodes and comments are safe, leave them as-is
    }
  }
  
  /**
   * Sanitize attributes on an element
   */
  sanitizeAttributes(element, tagName) {
    const allowedGlobal = BetterScriptsFeature.ALLOWED_ATTRS['*'] || [];
    const allowedForTag = BetterScriptsFeature.ALLOWED_ATTRS[tagName] || [];
    const allAllowed = new Set([...allowedGlobal, ...allowedForTag]);
    
    // Get list of attributes to remove (can't modify while iterating)
    const attrsToRemove = [];
    
    for (const attr of element.attributes) {
      const attrName = attr.name.toLowerCase();
      
      // Remove event handlers (onclick, onload, etc.)
      if (attrName.startsWith('on')) {
        attrsToRemove.push(attr.name);
        continue;
      }
      
      // Remove disallowed attributes
      if (!allAllowed.has(attrName)) {
        attrsToRemove.push(attr.name);
        continue;
      }
      
      // Special handling for specific attributes
      if (attrName === 'href') {
        // Only allow safe URL protocols
        const href = attr.value.trim().toLowerCase();
        if (href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('vbscript:')) {
          attrsToRemove.push(attr.name);
          continue;
        }
      }
      
      if (attrName === 'src') {
        // Only allow safe URL protocols for images
        const src = attr.value.trim().toLowerCase();
        if (src.startsWith('javascript:') || src.startsWith('vbscript:')) {
          attrsToRemove.push(attr.name);
          continue;
        }
      }
      
      if (attrName === 'style') {
        // Sanitize inline styles
        element.setAttribute('style', this.sanitizeStyleString(attr.value));
      }
    }
    
    // Remove flagged attributes
    for (const attrName of attrsToRemove) {
      element.removeAttribute(attrName);
    }
    
    // Force rel="noopener noreferrer" on links with target
    if (tagName === 'a' && element.hasAttribute('target')) {
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }
  
  /**
   * Sanitize a CSS style string, keeping only allowed properties
   */
  sanitizeStyleString(styleString) {
    if (!styleString || typeof styleString !== 'string') {
      return '';
    }
    
    const sanitizedParts = [];
    
    // Parse style declarations
    const declarations = styleString.split(';');
    
    for (const declaration of declarations) {
      const colonIndex = declaration.indexOf(':');
      if (colonIndex === -1) continue;
      
      const property = declaration.substring(0, colonIndex).trim().toLowerCase();
      const value = declaration.substring(colonIndex + 1).trim();
      
      // Check if property is allowed
      if (!BetterScriptsFeature.ALLOWED_STYLES.has(property)) {
        continue;
      }
      
      // Check for dangerous values (url(), expression(), javascript:, etc.)
      const lowerValue = value.toLowerCase();
      if (lowerValue.includes('url(') || 
          lowerValue.includes('expression(') || 
          lowerValue.includes('javascript:') ||
          lowerValue.includes('behavior:')) {
        continue;
      }
      
      sanitizedParts.push(`${property}: ${value}`);
    }
    
    return sanitizedParts.join('; ');
  }
  
  /**
   * Sanitize a style object (from config.style)
   */
  sanitizeStyleObject(styleObj) {
    if (!styleObj || typeof styleObj !== 'object') {
      return {};
    }
    
    const sanitized = {};
    
    for (const [property, value] of Object.entries(styleObj)) {
      // Convert camelCase to kebab-case for checking
      const kebabProperty = property.replace(/([A-Z])/g, '-$1').toLowerCase();
      
      // Check if property is allowed
      if (!BetterScriptsFeature.ALLOWED_STYLES.has(kebabProperty)) {
        continue;
      }
      
      // Check for dangerous values
      if (typeof value === 'string') {
        const lowerValue = value.toLowerCase();
        if (lowerValue.includes('url(') || 
            lowerValue.includes('expression(') || 
            lowerValue.includes('javascript:') ||
            lowerValue.includes('behavior:')) {
          continue;
        }
      }
      
      sanitized[property] = value;
    }
    
    return sanitized;
  }

  /**
   * Update an existing widget (auto-creates if not found)
   */
  updateWidget(widgetId, config) {
    const widgetData = this.registeredWidgets.get(widgetId);
    if (!widgetData) {
      // Auto-create widget if it doesn't exist
      this.log('Widget not found for update, creating:', widgetId);
      this.createWidget(widgetId, config);
      return;
    }
    
    const { element, config: existingConfig } = widgetData;
    const mergedConfig = { ...existingConfig, ...config };
    
    // Handle alignment zone change
    if (config.align !== undefined && config.align !== existingConfig.align) {
      const newAlign = BetterScriptsFeature.VALID_ALIGNMENTS.has(config.align) ? config.align : 'center';
      const targetZone = this.widgetZones[newAlign];
      if (targetZone && element.parentNode !== targetZone) {
        targetZone.appendChild(element);
        this.log('Widget moved to zone:', widgetId, newAlign);
      }
    }
    
    // Update based on widget type
    switch (existingConfig.type) {
      case 'stat': {
        const labelEl = element.querySelector('.bd-widget-label');
        const valueEl = element.querySelector('.bd-widget-value');
        if (labelEl && config.label !== undefined) {
          labelEl.textContent = config.label;
        }
        if (valueEl && config.value !== undefined) {
          valueEl.textContent = config.value;
        }
        if (valueEl && config.color) {
          valueEl.style.color = config.color;
        }
        break;
      }
        
      case 'bar': {
        const labelEl = element.querySelector('.bd-widget-label');
        const barFill = element.querySelector('.bd-widget-bar-fill');
        const barText = element.querySelector('.bd-widget-bar-text');
        if (labelEl && config.label !== undefined) {
          labelEl.textContent = config.label;
        }
        if (barFill && config.value !== undefined) {
          const max = config.max || existingConfig.max || 100;
          const percentage = Math.min(100, Math.max(0, ((config.value || 0) / max) * 100));
          barFill.style.width = `${percentage}%`;
        }
        if (barText && config.value !== undefined) {
          barText.textContent = `${config.value}/${config.max || existingConfig.max || 100}`;
        }
        if (barFill && config.color) {
          barFill.style.backgroundColor = config.color;
        }
        break;
      }
        
      case 'text':
        if (config.text !== undefined) {
          element.textContent = config.text;
        }
        if (config.style) {
          // Sanitize styles before applying
          const sanitizedStyles = this.sanitizeStyleObject(config.style);
          Object.assign(element.style, sanitizedStyles);
        }
        break;
        
      case 'panel': {
        // Update title if changed
        const titleEl = element.querySelector('.bd-widget-panel-title');
        if (config.title !== undefined) {
          if (titleEl) {
            titleEl.textContent = config.title;
          } else if (config.title) {
            // Create title if it didn't exist
            const newTitle = document.createElement('div');
            newTitle.className = 'bd-widget-panel-title';
            newTitle.textContent = config.title;
            element.insertBefore(newTitle, element.firstChild);
          }
        }
        
        // Recreate panel content if items changed
        if (config.items) {
          const content = element.querySelector('.bd-widget-panel-content');
          if (content) {
            content.innerHTML = '';
            config.items.forEach(item => {
              const itemEl = document.createElement('div');
              itemEl.className = 'bd-widget-panel-item';
              
              if (item.label) {
                const itemLabel = document.createElement('span');
                itemLabel.className = 'bd-widget-panel-item-label';
                itemLabel.textContent = item.label;
                itemEl.appendChild(itemLabel);
              }
              
              if (item.value !== undefined) {
                const itemValue = document.createElement('span');
                itemValue.className = 'bd-widget-panel-item-value';
                itemValue.textContent = item.value;
                if (item.color) itemValue.style.color = item.color;
                itemEl.appendChild(itemValue);
              }
              
              content.appendChild(itemEl);
            });
          }
        }
        break;
      }
      
      case 'custom':
        if (config.html !== undefined) {
          element.innerHTML = this.sanitizeHTML(config.html);
        }
        if (config.style) {
          const sanitizedStyles = this.sanitizeStyleObject(config.style);
          Object.assign(element.style, sanitizedStyles);
        }
        break;
      
      case 'badge': {
        const textEl = element.querySelector('.bd-widget-badge-text');
        if (textEl && (config.text !== undefined || config.label !== undefined)) {
          textEl.textContent = config.text || config.label;
        }
        if (config.color) {
          element.style.setProperty('--badge-color', config.color);
        }
        if (config.variant) {
          element.dataset.variant = config.variant;
        }
        break;
      }
      
      case 'list': {
        const titleEl = element.querySelector('.bd-widget-list-title');
        if (titleEl && config.title !== undefined) {
          titleEl.textContent = config.title;
        }
        if (config.items) {
          const list = element.querySelector('.bd-widget-list-items');
          if (list) {
            list.innerHTML = '';
            config.items.forEach(item => {
              const li = document.createElement('li');
              li.className = 'bd-widget-list-item';
              if (typeof item === 'string') {
                li.textContent = item;
              } else {
                if (item.icon) {
                  const icon = document.createElement('span');
                  icon.className = 'bd-widget-list-item-icon';
                  icon.textContent = item.icon;
                  li.appendChild(icon);
                }
                const text = document.createElement('span');
                text.textContent = item.text || item.label || '';
                if (item.color) text.style.color = item.color;
                li.appendChild(text);
              }
              list.appendChild(li);
            });
          }
        }
        break;
      }
      
      case 'icon':
        if (config.icon !== undefined || config.text !== undefined) {
          element.textContent = config.icon || config.text;
        }
        if (config.color) {
          element.style.color = config.color;
        }
        if (config.size) {
          element.style.fontSize = typeof config.size === 'number' ? `${config.size}px` : config.size;
        }
        if (config.tooltip || config.title) {
          element.title = config.tooltip || config.title;
        }
        break;
      
      case 'counter': {
        const valueEl = element.querySelector('.bd-widget-counter-value');
        const deltaEl = element.querySelector('.bd-widget-counter-delta');
        if (valueEl && config.value !== undefined) {
          valueEl.textContent = config.value;
        }
        if (valueEl && config.color) {
          valueEl.style.color = config.color;
        }
        if (config.delta !== undefined) {
          if (deltaEl) {
            if (config.delta === 0) {
              deltaEl.remove();
            } else {
              const sign = config.delta > 0 ? '+' : '';
              deltaEl.textContent = sign + config.delta;
              deltaEl.dataset.positive = config.delta > 0 ? 'true' : 'false';
            }
          } else if (config.delta !== 0) {
            const delta = document.createElement('span');
            delta.className = 'bd-widget-counter-delta';
            const sign = config.delta > 0 ? '+' : '';
            delta.textContent = sign + config.delta;
            delta.dataset.positive = config.delta > 0 ? 'true' : 'false';
            element.appendChild(delta);
          }
        }
        break;
      }
    }
    
    // Update order property (applies to all widget types)
    if (config.order !== undefined) {
      element.style.order = config.order;
    }
    
    // Update stored config
    this.registeredWidgets.set(widgetId, { element, config: mergedConfig });
    this.log('Widget updated:', widgetId);
    
    // Emit widget updated event
    window.dispatchEvent(new CustomEvent('betterscripts:widget', {
      detail: { action: 'updated', widgetId, config: mergedConfig }
    }));
  }

  /**
   * Destroy a widget
   */
  destroyWidget(widgetId) {
    const widgetData = this.registeredWidgets.get(widgetId);
    if (widgetData) {
      widgetData.element.remove();
      this.registeredWidgets.delete(widgetId);
      this.log('Widget destroyed:', widgetId);
      
      // Emit widget destroyed event
      window.dispatchEvent(new CustomEvent('betterscripts:widget', {
        detail: { action: 'destroyed', widgetId }
      }));
      
      // Remove container if no widgets remain
      if (this.registeredWidgets.size === 0) {
        this.removeWidgetContainer();
      }
    }
  }

  /**
   * Clear all widgets
   */
  clearAllWidgets() {
    this.registeredWidgets.forEach((data) => {
      data.element.remove();
    });
    this.registeredWidgets.clear();
    this.processedMessageHashes.clear();
    
    // Remove container when all widgets are cleared
    this.removeWidgetContainer();
    
    this.log('All widgets cleared');
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.BetterScriptsFeature = BetterScriptsFeature;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BetterScriptsFeature;
}
