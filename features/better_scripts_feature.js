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
 * 
 * Supported Widget Types:
 * - stat: Label + value display (e.g., "Turn: 5")
 * - bar: Progress bar with fill (e.g., HP bar)
 * - text: Styled text display
 * - panel: Container with title and items
 * - list: Simple list of items
 * - custom: Custom HTML (sanitized)
 * 
 * Supported Message Types:
 * - widget: Create/update/destroy widgets
 * - register: Register a script with BetterDungeon
 * - notify: Show a temporary notification
 * - ping: Test connectivity
 */

class BetterScriptsFeature {
  static id = 'betterScripts';
  
  // Protocol version for compatibility checking
  static PROTOCOL_VERSION = '1.1.0';
  
  // Message delimiters for protocol messages
  static MESSAGE_PREFIX = '[[BD:';
  static MESSAGE_SUFFIX = ':BD]]';
  
  // Notification defaults
  static NOTIFY_DURATION_DEFAULT = 3000;
  static NOTIFY_DURATION_MAX = 10000;
  static NOTIFY_MAX_COUNT = 5; // Max notifications visible at once

  constructor() {
    // DOM observation
    this.observer = null;
    this.gameplayObserver = null;
    this.waitForGameplayObserver = null;
    this.debounceTimer = null;
    
    // State tracking
    this.currentAdventureId = null;
    this.processedMessageHashes = new Set(); // Track processed messages by hash
    this.messageHashExpiry = 5000; // Clear old hashes after 5 seconds
    this.registeredWidgets = new Map();
    this.registeredScripts = new Map();
    
    // UI containers
    this.widgetContainer = null;
    this.notificationContainer = null;
    
    // URL change detection
    this.boundUrlChangeHandler = null;
    this.originalPushState = null;
    this.originalReplaceState = null;
    
    // Debug logging (disable in production)
    this.debug = true;
  }

  // ==================== LOGGING ====================

  log(message, ...args) {
    if (this.debug) {
      console.log(`[BetterScripts] ${message}`, ...args);
    }
  }
  
  warn(message, ...args) {
    console.warn(`[BetterScripts] ${message}`, ...args);
  }
  
  error(message, ...args) {
    console.error(`[BetterScripts] ${message}`, ...args);
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
    this.removeNotificationContainer();
    this.registeredWidgets.clear();
    this.registeredScripts.clear();
    this.processedMessageHashes.clear();
    this.currentAdventureId = null;
    
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
   * Generate a simple hash for message deduplication
   */
  hashMessage(message) {
    return JSON.stringify(message);
  }
  
  /**
   * Check if a message has already been processed (deduplication)
   */
  isMessageProcessed(messageHash) {
    return this.processedMessageHashes.has(messageHash);
  }
  
  /**
   * Mark a message as processed with auto-expiry
   */
  markMessageProcessed(messageHash) {
    this.processedMessageHashes.add(messageHash);
    
    // Auto-expire old hashes to prevent memory buildup
    setTimeout(() => {
      this.processedMessageHashes.delete(messageHash);
    }, this.messageHashExpiry);
  }

  /**
   * Immediately strips all [[BD:...:BD]] protocol messages from gameplay output
   * Called synchronously on every mutation to prevent flash of protocol text
   * Handles multiple messages in a single output (batch processing)
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
      const messagesToProcess = [];
      
      // First, extract ALL messages from this text node
      while ((match = protocolRegex.exec(originalText)) !== null) {
        const rawMessage = match[1];
        try {
          const message = JSON.parse(rawMessage);
          const messageHash = this.hashMessage(message);
          
          // Only process if we haven't seen this exact message recently
          if (!this.isMessageProcessed(messageHash)) {
            messagesToProcess.push({ message, hash: messageHash });
          }
        } catch (e) {
          this.warn('Failed to parse protocol message:', e.message);
        }
      }
      protocolRegex.lastIndex = 0;
      
      // Process all unique messages found
      for (const { message, hash } of messagesToProcess) {
        this.markMessageProcessed(hash);
        this.log('Processing message:', message.type, message.widgetId || message.scriptId || '');
        this.processMessage(message);
      }
      
      // Strip all protocol text from the node
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
   * Supports: register, widget, update, remove, notify, ping
   */
  processMessage(message) {
    if (!message || typeof message !== 'object') {
      this.warn('Invalid message format');
      return;
    }
    
    if (!message.type) {
      this.warn('Message missing type field');
      return;
    }
    
    switch (message.type) {
      case 'register':
        this.handleRegister(message);
        break;
      case 'widget':
      case 'update':
      case 'remove':
        this.handleWidgetCommand(message);
        break;
      case 'notify':
        this.handleNotify(message);
        break;
      case 'ping':
        this.handlePing(message);
        break;
      default:
        this.warn('Unknown message type:', message.type);
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
      this.warn('Register message missing scriptId');
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
      this.warn('Widget message missing ID');
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
  
  /**
   * Handle notification messages (temporary toast notifications)
   */
  handleNotify(message) {
    const { text, title, notifyType, type, duration } = message;
    
    if (!text) {
      this.warn('Notify message missing text');
      return;
    }
    
    // Support both 'notifyType' (preferred) and legacy 'type' for notification style
    const effectiveType = notifyType || type || 'info';
    
    this.showNotification({
      text,
      title,
      type: effectiveType, // info, success, warning, error
      duration: Math.min(duration || BetterScriptsFeature.NOTIFY_DURATION_DEFAULT, 
                         BetterScriptsFeature.NOTIFY_DURATION_MAX)
    });
  }

  // ==================== WIDGET SYSTEM ====================

  createWidgetContainer() {
    if (this.widgetContainer && document.body.contains(this.widgetContainer)) {
      return;
    }
    
    this.widgetContainer = document.createElement('div');
    this.widgetContainer.className = 'bd-betterscripts-container';
    this.widgetContainer.id = 'bd-betterscripts-widgets';
    
    // Use fixed positioning so widgets stay visible and don't get pushed by content
    // Position below the navigation bar (approximately 56px from top)
    Object.assign(this.widgetContainer.style, {
      position: 'fixed',
      top: '56px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '1000',
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: '8px',
      padding: '8px',
      maxWidth: '900px',
      pointerEvents: 'none' // Allow clicks to pass through container gaps
    });
    
    // Append directly to body for fixed positioning
    document.body.appendChild(this.widgetContainer);
    
    this.log('Widget container created (fixed position)');
  }

  removeWidgetContainer() {
    if (this.widgetContainer) {
      this.widgetContainer.remove();
      this.widgetContainer = null;
    }
  }
  
  // ==================== NOTIFICATION SYSTEM ====================
  
  createNotificationContainer() {
    if (this.notificationContainer && document.body.contains(this.notificationContainer)) {
      return;
    }
    
    this.notificationContainer = document.createElement('div');
    this.notificationContainer.className = 'bd-betterscripts-notifications';
    this.notificationContainer.id = 'bd-betterscripts-notifications';
    
    Object.assign(this.notificationContainer.style, {
      position: 'fixed',
      top: '60px',
      right: '16px',
      zIndex: '1100',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxWidth: '320px',
      pointerEvents: 'none'
    });
    
    document.body.appendChild(this.notificationContainer);
  }
  
  removeNotificationContainer() {
    if (this.notificationContainer) {
      this.notificationContainer.remove();
      this.notificationContainer = null;
    }
  }
  
  /**
   * Show a notification toast
   * @param {Object} options - Notification options
   * @param {string} options.text - Notification message
   * @param {string} [options.title] - Optional title
   * @param {string} [options.type] - Type: info, success, warning, error
   * @param {number} [options.duration] - Duration in ms
   */
  showNotification({ text, title, type = 'info', duration = 3000 }) {
    this.createNotificationContainer();
    
    const notification = document.createElement('div');
    notification.className = `bd-notification bd-notification-${type}`;
    notification.style.pointerEvents = 'auto';
    
    // Type-based colors
    const colors = {
      info: { bg: 'rgba(59, 130, 246, 0.9)', border: '#3b82f6' },
      success: { bg: 'rgba(34, 197, 94, 0.9)', border: '#22c55e' },
      warning: { bg: 'rgba(251, 191, 36, 0.9)', border: '#fbbf24' },
      error: { bg: 'rgba(239, 68, 68, 0.9)', border: '#ef4444' }
    };
    const color = colors[type] || colors.info;
    
    Object.assign(notification.style, {
      background: color.bg,
      border: `1px solid ${color.border}`,
      borderRadius: '8px',
      padding: '12px 16px',
      color: '#fff',
      fontSize: '14px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      animation: 'bd-notify-in 0.3s ease-out',
      cursor: 'pointer'
    });
    
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.style.fontWeight = 'bold';
      titleEl.style.marginBottom = '4px';
      titleEl.textContent = title;
      notification.appendChild(titleEl);
    }
    
    const textEl = document.createElement('div');
    textEl.textContent = text;
    notification.appendChild(textEl);
    
    // Click to dismiss
    notification.addEventListener('click', () => {
      this.dismissNotification(notification);
    });
    
    this.notificationContainer.appendChild(notification);
    
    // Enforce max notification limit (remove oldest)
    while (this.notificationContainer.children.length > BetterScriptsFeature.NOTIFY_MAX_COUNT) {
      const oldest = this.notificationContainer.firstChild;
      if (oldest) oldest.remove();
    }
    
    // Auto-dismiss
    setTimeout(() => {
      this.dismissNotification(notification);
    }, duration);
    
    this.log('Notification shown:', title || text);
  }
  
  dismissNotification(notification) {
    if (!notification || !notification.parentNode) return;
    
    notification.style.animation = 'bd-notify-out 0.2s ease-in forwards';
    setTimeout(() => {
      notification.remove();
      
      // Remove container if empty
      if (this.notificationContainer && this.notificationContainer.children.length === 0) {
        this.removeNotificationContainer();
      }
    }, 200);
  }

  /**
   * Create a widget based on configuration from script
   */
  createWidget(widgetId, config) {
    if (!config || !config.type) {
      this.warn('Widget config missing type for:', widgetId);
      return;
    }
    
    // Remove existing widget with same ID first (before container check)
    if (this.registeredWidgets.has(widgetId)) {
      this.destroyWidget(widgetId, true); // Silent destroy for recreation
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
      case 'list':
        widgetElement = this.createListWidget(widgetId, config);
        break;
      case 'custom':
        widgetElement = this.createCustomWidget(widgetId, config);
        break;
      default:
        this.warn('Unknown widget type:', config.type);
        return;
    }
    
    if (widgetElement && this.widgetContainer) {
      // Apply widget ordering based on priority
      this.insertWidgetWithPriority(widgetElement, config.priority || 0);
      this.registeredWidgets.set(widgetId, { element: widgetElement, config });
      this.log('Widget created:', widgetId);
      
      // Emit widget created event
      this.emitWidgetEvent('created', widgetId, config);
    }
  }
  
  /**
   * Insert widget at correct position based on priority (higher = first)
   */
  insertWidgetWithPriority(widgetElement, priority) {
    widgetElement.dataset.priority = priority;
    
    // Find the right position
    const children = Array.from(this.widgetContainer.children);
    const insertBefore = children.find(child => {
      const childPriority = parseInt(child.dataset.priority || '0', 10);
      return childPriority < priority;
    });
    
    if (insertBefore) {
      this.widgetContainer.insertBefore(widgetElement, insertBefore);
    } else {
      this.widgetContainer.appendChild(widgetElement);
    }
  }
  
  /**
   * Emit a widget lifecycle event
   */
  emitWidgetEvent(eventType, widgetId, data) {
    window.dispatchEvent(new CustomEvent(`betterscripts:widget:${eventType}`, {
      detail: { widgetId, ...data }
    }));
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
   * Create a progress bar widget with smooth animation
   */
  createBarWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-bar';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto';
    
    const label = document.createElement('span');
    label.className = 'bd-widget-label';
    label.textContent = config.label || 'Progress';
    
    const barContainer = document.createElement('div');
    barContainer.className = 'bd-widget-bar-container';
    
    const barFill = document.createElement('div');
    barFill.className = 'bd-widget-bar-fill';
    barFill.style.transition = 'width 0.3s ease-out, background-color 0.3s ease';
    
    const max = config.max || 100;
    const value = this.clamp(config.value || 0, 0, max);
    const percentage = (value / max) * 100;
    barFill.style.width = `${percentage}%`;
    
    if (config.color) {
      barFill.style.backgroundColor = config.color;
    }
    
    const valueText = document.createElement('span');
    valueText.className = 'bd-widget-bar-text';
    valueText.textContent = config.showValue !== false ? `${value}/${max}` : '';
    
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
    widget.style.pointerEvents = 'auto';
    
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
      this.renderPanelItems(content, config.items);
    } else if (config.content) {
      content.textContent = config.content;
    }
    
    widget.appendChild(content);
    
    return widget;
  }
  
  /**
   * Render panel items with icon/badge support
   */
  renderPanelItems(container, items) {
    container.innerHTML = '';
    
    items.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'bd-widget-panel-item';
      
      // Support icon prefix
      if (item.icon) {
        const icon = document.createElement('span');
        icon.className = 'bd-widget-panel-item-icon';
        icon.textContent = item.icon;
        icon.style.marginRight = '4px';
        itemEl.appendChild(icon);
      }
      
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
      
      // Support badge
      if (item.badge) {
        const badge = document.createElement('span');
        badge.className = 'bd-widget-panel-item-badge';
        badge.textContent = item.badge;
        badge.style.cssText = `
          background: ${item.badgeColor || '#6366f1'};
          color: #fff;
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 8px;
          margin-left: 6px;
        `;
        itemEl.appendChild(badge);
      }
      
      container.appendChild(itemEl);
    });
  }
  
  /**
   * Create a simple list widget
   */
  createListWidget(widgetId, config) {
    const widget = document.createElement('div');
    widget.className = 'bd-widget bd-widget-list';
    widget.id = `bd-widget-${widgetId}`;
    widget.style.pointerEvents = 'auto';
    
    if (config.title) {
      const title = document.createElement('div');
      title.className = 'bd-widget-list-title';
      title.textContent = config.title;
      widget.appendChild(title);
    }
    
    const list = document.createElement('ul');
    list.className = 'bd-widget-list-items';
    list.style.cssText = 'list-style: none; margin: 0; padding: 0;';
    
    if (config.items && Array.isArray(config.items)) {
      config.items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'bd-widget-list-item';
        li.textContent = typeof item === 'string' ? item : item.text || '';
        if (typeof item === 'object' && item.color) {
          li.style.color = item.color;
        }
        list.appendChild(li);
      });
    }
    
    widget.appendChild(list);
    
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
      case 'stat':
        this.updateStatWidget(element, config);
        break;
        
      case 'bar':
        this.updateBarWidget(element, config, existingConfig);
        break;
        
      case 'text':
        this.updateTextWidget(element, config);
        break;
        
      case 'panel':
        this.updatePanelWidget(element, config);
        break;
        
      case 'list':
        this.updateListWidget(element, config);
        break;
        
      case 'custom':
        this.updateCustomWidget(element, config);
        break;
    }
    
    // Update stored config
    this.registeredWidgets.set(widgetId, { element, config: mergedConfig });
    this.log('Widget updated:', widgetId);
    
    // Emit widget updated event
    this.emitWidgetEvent('updated', widgetId, mergedConfig);
  }
  
  updateStatWidget(element, config) {
    const valueEl = element.querySelector('.bd-widget-value');
    const labelEl = element.querySelector('.bd-widget-label');
    
    if (valueEl && config.value !== undefined) {
      valueEl.textContent = config.value;
    }
    if (valueEl && config.color) {
      valueEl.style.color = config.color;
    }
    if (labelEl && config.label !== undefined) {
      labelEl.textContent = config.label;
    }
  }
  
  updateBarWidget(element, config, existingConfig) {
    const barFill = element.querySelector('.bd-widget-bar-fill');
    const barText = element.querySelector('.bd-widget-bar-text');
    const labelEl = element.querySelector('.bd-widget-label');
    
    const max = config.max || existingConfig.max || 100;
    const value = this.clamp(config.value ?? existingConfig.value ?? 0, 0, max);
    
    if (barFill && config.value !== undefined) {
      const percentage = (value / max) * 100;
      barFill.style.width = `${percentage}%`;
    }
    if (barText && config.value !== undefined) {
      barText.textContent = `${value}/${max}`;
    }
    if (barFill && config.color) {
      barFill.style.backgroundColor = config.color;
    }
    if (labelEl && config.label !== undefined) {
      labelEl.textContent = config.label;
    }
  }
  
  updateTextWidget(element, config) {
    if (config.text !== undefined) {
      element.textContent = config.text;
    }
    if (config.style) {
      Object.assign(element.style, config.style);
    }
  }
  
  updatePanelWidget(element, config) {
    // Update title if provided
    if (config.title !== undefined) {
      const titleEl = element.querySelector('.bd-widget-panel-title');
      if (titleEl) {
        titleEl.textContent = config.title;
      }
    }
    
    // Recreate panel content if items changed
    if (config.items) {
      const content = element.querySelector('.bd-widget-panel-content');
      if (content) {
        this.renderPanelItems(content, config.items);
      }
    }
  }
  
  updateListWidget(element, config) {
    if (config.title !== undefined) {
      const titleEl = element.querySelector('.bd-widget-list-title');
      if (titleEl) titleEl.textContent = config.title;
    }
    
    if (config.items) {
      const list = element.querySelector('.bd-widget-list-items');
      if (list) {
        list.innerHTML = '';
        config.items.forEach(item => {
          const li = document.createElement('li');
          li.className = 'bd-widget-list-item';
          li.textContent = typeof item === 'string' ? item : item.text || '';
          if (typeof item === 'object' && item.color) {
            li.style.color = item.color;
          }
          list.appendChild(li);
        });
      }
    }
  }
  
  updateCustomWidget(element, config) {
    // For custom widgets, re-sanitize and replace HTML
    if (config.html !== undefined) {
      element.innerHTML = this.sanitizeHTML(config.html);
    }
  }

  /**
   * Destroy a widget
   * @param {string} widgetId - Widget ID to destroy
   * @param {boolean} silent - If true, don't log or emit events
   */
  destroyWidget(widgetId, silent = false) {
    const widgetData = this.registeredWidgets.get(widgetId);
    if (widgetData) {
      widgetData.element.remove();
      this.registeredWidgets.delete(widgetId);
      
      if (!silent) {
        this.log('Widget destroyed:', widgetId);
        this.emitWidgetEvent('destroyed', widgetId, {});
      }
      
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
    this.registeredWidgets.forEach((data, id) => {
      data.element.remove();
    });
    this.registeredWidgets.clear();
    this.processedMessageHashes.clear();
    
    // Remove container when all widgets are cleared
    this.removeWidgetContainer();
    
    this.log('All widgets cleared');
  }
  
  // ==================== UTILITY METHODS ====================
  
  /**
   * Clamp a value between min and max
   */
  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  
  /**
   * Check if a widget exists
   */
  hasWidget(widgetId) {
    return this.registeredWidgets.has(widgetId);
  }
  
  /**
   * Get the number of active widgets
   */
  getWidgetCount() {
    return this.registeredWidgets.size;
  }
  
  /**
   * Get all widget IDs
   */
  getWidgetIds() {
    return Array.from(this.registeredWidgets.keys());
  }
  
  /**
   * Get widget configuration by ID
   */
  getWidgetConfig(widgetId) {
    const widgetData = this.registeredWidgets.get(widgetId);
    return widgetData ? { ...widgetData.config } : null;
  }
  
  /**
   * Check if any scripts are registered
   */
  hasRegisteredScripts() {
    return this.registeredScripts.size > 0;
  }
  
  /**
   * Get all registered script IDs
   */
  getRegisteredScriptIds() {
    return Array.from(this.registeredScripts.keys());
  }
  
  /**
   * Check if currently on an adventure
   */
  isOnAdventure() {
    return this.currentAdventureId !== null;
  }
  
  /**
   * Get the current adventure ID
   */
  getCurrentAdventureId() {
    return this.currentAdventureId;
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.BetterScriptsFeature = BetterScriptsFeature;
  
  // Add CSS for notification animations
  if (!document.getElementById('bd-betterscripts-styles')) {
    const style = document.createElement('style');
    style.id = 'bd-betterscripts-styles';
    style.textContent = `
      @keyframes bd-notify-in {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes bd-notify-out {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(100%); }
      }
    `;
    document.head.appendChild(style);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BetterScriptsFeature;
}
