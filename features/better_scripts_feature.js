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
 * Protocol Format: [[BD:{"type":"...", ...}:BD]]
 */

class BetterScriptsFeature {
  static id = 'betterScripts';
  
  // Protocol version for compatibility checking
  static PROTOCOL_VERSION = '1.0.0';
  
  // Message delimiters for protocol messages
  static MESSAGE_PREFIX = '[[BD:';
  static MESSAGE_SUFFIX = ':BD]]';

  constructor() {
    // DOM observation
    this.observer = null;
    this.gameplayObserver = null;
    this.waitForGameplayObserver = null;
    this.debounceTimer = null;
    
    // State tracking
    this.currentAdventureId = null;
    this.processedMessageHashes = new Set();
    this.messageHashCleanupTimer = null;
    this.registeredWidgets = new Map();
    this.registeredScripts = new Map();
    
    // UI container for script widgets
    this.widgetContainer = null;
    
    // URL change detection
    this.boundUrlChangeHandler = null;
    this.originalPushState = null;
    this.originalReplaceState = null;
    
    // Layout detection and resize handling
    this.boundResizeHandler = null;
    this.resizeDebounceTimer = null;
    this.layoutObserver = null;
    this.cachedLayout = null;
    
    // Debug logging (set to false for production)
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(`[BetterScripts] ${message}`, ...args);
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
   * Clears hashes after 500ms to allow repeated intentional updates
   * while preventing duplicate processing from rapid mutation observer calls
   */
  scheduleHashCleanup() {
    if (this.messageHashCleanupTimer) return;
    
    this.messageHashCleanupTimer = setTimeout(() => {
      this.processedMessageHashes.clear();
      this.messageHashCleanupTimer = null;
    }, 500);
  }

  // ==================== LIFECYCLE ====================

  init() {
    console.log('[BetterScripts] Initializing BetterScripts feature...');
    
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
      if (!gameplayOutput || gameplayOutput._bdGameplayObserved) return;
      gameplayOutput._bdGameplayObserved = true;
      
      this.log('Setting up immediate gameplay output observer');
      
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
      if (!document.querySelector('#gameplay-output')?._bdGameplayObserved) {
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
    const gameplayOutput = document.querySelector('#gameplay-output');
    if (!gameplayOutput) return;
    
    const protocolRegex = /\[\[BD:([\s\S]*?):BD\]\]/g;
    
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
      if (node.textContent && node.textContent.includes('[[BD:')) {
        nodesToProcess.push(node);
      }
    }
    
    // Process nodes (separate loop to avoid walker invalidation)
    for (const textNode of nodesToProcess) {
      const originalText = textNode.textContent;
      let match;
      
      // First, extract and process any messages we haven't seen recently
      while ((match = protocolRegex.exec(originalText)) !== null) {
        const rawMessage = match[1];
        const messageHash = this.hashMessage(rawMessage);
        
        // Skip if we've processed this exact message very recently (prevents duplicates from mutation observer firing multiple times)
        if (!this.processedMessageHashes.has(messageHash)) {
          this.processedMessageHashes.add(messageHash);
          
          // Schedule cleanup of old hashes to allow repeated intentional updates
          this.scheduleHashCleanup();
          
          try {
            const message = JSON.parse(rawMessage);
            this.log('Processing message:', message.type);
            this.processMessage(message);
          } catch (e) {
            this.log('Failed to parse message:', e.message);
          }
        }
      }
      protocolRegex.lastIndex = 0;
      
      // Then strip all protocol text from the node
      textNode.textContent = originalText.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
    }
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
    
    // Clear DOM flag before disconnecting gameplay observer
    const gameplayOutput = document.querySelector('#gameplay-output');
    if (gameplayOutput && gameplayOutput._bdGameplayObserved) {
      delete gameplayOutput._bdGameplayObserved;
    }
    
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
   * Process a parsed BetterScripts message
   */
  processMessage(message) {
    this.log('Processing message:', message);
    
    if (!message || typeof message !== 'object') {
      this.log('Invalid message format');
      return;
    }
    
    if (!message.type) {
      this.log('Message missing type field');
      return;
    }
    
    try {
      switch (message.type) {
        case 'register':
          this.handleRegister(message);
          break;
        case 'widget':
        case 'update':
        case 'remove':
          this.handleWidgetCommand(message);
          break;
        case 'ping':
          this.handlePing(message);
          break;
        default:
          this.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[BetterScripts] Error processing message:', error);
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
      this.log('Register message missing scriptId');
      return;
    }
    
    this.log(`Script registered: ${scriptName || scriptId} v${version || '?'}`);
    
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
    
    // Support both 'widget' type and legacy 'update'/'remove' types
    // Default to 'create' for 'widget' type, 'update' for legacy 'update', 'destroy' for 'remove'
    let effectiveAction = action;
    if (!effectiveAction) {
      if (message.type === 'remove') effectiveAction = 'destroy';
      else if (message.type === 'update') effectiveAction = 'update';
      else effectiveAction = 'create'; // Default for 'widget' type
    }
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
    this.log('Ping received:', message.data);
    
    // Emit pong event
    window.dispatchEvent(new CustomEvent('betterscripts:pong', {
      detail: { 
        timestamp: Date.now(),
        requestTimestamp: message.timestamp,
        data: message.data
      }
    }));
  }

  // ==================== WIDGET SYSTEM ====================

  createWidgetContainer() {
    if (this.widgetContainer && document.body.contains(this.widgetContainer)) {
      return;
    }
    
    this.widgetContainer = document.createElement('div');
    this.widgetContainer.className = 'bd-betterscripts-container';
    this.widgetContainer.id = 'bd-betterscripts-widgets';
    
    // Base styles - will be dynamically adjusted
    Object.assign(this.widgetContainer.style, {
      position: 'fixed',
      zIndex: '1000',
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'flex-start',
      boxSizing: 'border-box',
      pointerEvents: 'none',
      transition: 'top 0.2s ease, left 0.2s ease, width 0.2s ease'
    });
    
    document.body.appendChild(this.widgetContainer);
    
    // Apply initial positioning
    this.updateContainerPosition();
    
    // Set up layout monitoring
    this.setupLayoutMonitoring();
    
    this.log('Widget container created');
  }

  /**
   * Detect current page layout elements and calculate positioning
   */
  detectLayout() {
    const layout = {
      navHeight: 56,       // Default fallback
      contentLeft: 0,
      contentWidth: window.innerWidth,
      contentTop: 56,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
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
    
    // Try to detect main content area for width/positioning
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
   */
  updateContainerPosition() {
    if (!this.widgetContainer) return;
    
    const layout = this.detectLayout();
    const vw = layout.viewportWidth;
    
    // Calculate responsive values based on viewport
    let padding, gap, fontSize;
    if (vw < 640) {
      padding = 4;
      gap = 4;
      fontSize = 12;
    } else if (vw < 1024) {
      padding = 6;
      gap = 6;
      fontSize = 13;
    } else {
      padding = 8;
      gap = 8;
      fontSize = 14;
    }
    
    // Calculate container width - match content area or use responsive max
    const maxWidth = Math.min(900, layout.contentWidth, vw - 16);
    
    // Position horizontally - center over content area
    const contentCenter = layout.contentLeft + (layout.contentWidth / 2);
    const left = Math.max(padding, contentCenter - (maxWidth / 2));
    
    Object.assign(this.widgetContainer.style, {
      top: `${layout.contentTop}px`,
      left: `${left}px`,
      width: `${maxWidth}px`,
      padding: `${padding}px`,
      gap: `${gap}px`,
      fontSize: `${fontSize}px`,
      transform: 'none'  // Remove transform since we calculate exact position
    });
    
    this.log('Container positioned:', { top: layout.contentTop, left, width: maxWidth });
  }

  /**
   * Set up monitoring for layout changes
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
        }, 100);
      };
      
      window.addEventListener('resize', this.boundResizeHandler);
      window.addEventListener('orientationchange', this.boundResizeHandler);
    }
    
    // Use ResizeObserver on content area if available
    if (window.ResizeObserver && !this.layoutObserver) {
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
    if (this.widgetContainer) {
      this.widgetContainer.remove();
      this.widgetContainer = null;
    }
    
    // Clean up observers first (they may reference handlers)
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
   * Create a widget based on configuration from script
   */
  createWidget(widgetId, config) {
    if (!config || !config.type) {
      this.log('Widget config missing type');
      return;
    }
    
    // Remove existing widget with same ID first (before container check)
    if (this.registeredWidgets.has(widgetId)) {
      this.destroyWidget(widgetId);
    }
    
    // Create container on-demand (after destroy, so it's recreated if needed)
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
      default:
        this.log('Unknown widget type:', config.type);
        return;
    }
    
    if (widgetElement && this.widgetContainer) {
      this.widgetContainer.appendChild(widgetElement);
      this.registeredWidgets.set(widgetId, { element: widgetElement, config });
      this.log('Widget created:', widgetId);
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
   * Create a custom HTML widget (use with caution)
   */
  createCustomWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-custom';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto'; // Re-enable interactions on widget
    
    // Only allow safe HTML (no scripts)
    if (config.html) {
      const sanitized = this.sanitizeHTML(config.html);
      widget.innerHTML = sanitized;
    }
    
    return widget;
  }

  /**
   * Basic HTML sanitization to prevent XSS
   */
  sanitizeHTML(html) {
    const temp = document.createElement('div');
    temp.textContent = html;
    
    // For now, just escape everything
    // In the future, we could implement a whitelist-based sanitizer
    return temp.innerHTML;
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
          Object.assign(element.style, config.style);
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
        break;
    }
    
    // Update stored config
    this.registeredWidgets.set(widgetId, { element, config: mergedConfig });
    this.log('Widget updated:', widgetId);
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
