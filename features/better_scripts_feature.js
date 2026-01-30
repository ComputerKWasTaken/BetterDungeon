// BetterDungeon - BetterScripts Feature
// A compatibility layer between AI Dungeon scripts and BetterDungeon
// Allows scripts to create UI elements and communicate with the extension

class BetterScriptsFeature {
  static id = 'betterScripts';
  
  // Protocol version for compatibility checking
  static PROTOCOL_VERSION = '1.0.0';
  
  // Message prefix to identify BetterScripts messages in state.message
  static MESSAGE_PREFIX = '[[BD:';
  static MESSAGE_SUFFIX = ':BD]]';

  constructor() {
    // DOM observation
    this.observer = null;
    this.messageObserver = null;
    this.debounceTimer = null;
    
    // State tracking
    this.currentAdventureId = null;
    this.lastProcessedMessage = null;
    this.registeredWidgets = new Map();
    this.registeredScripts = new Map();
    
    // UI container for script widgets
    this.widgetContainer = null;
    
    // Event handlers
    this.boundUrlChangeHandler = null;
    this.originalPushState = null;
    this.originalReplaceState = null;
    
    // Message queue for outbound messages to scripts
    this.outboundQueue = [];
    
    // Debug mode
    this.debug = true; // Enable for testing
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(`[BetterScripts] ${message}`, ...args);
    }
  }

  // ==================== LIFECYCLE ====================

  init() {
    console.log('[BetterScripts] Initializing BetterScripts feature...');
    
    this.detectCurrentAdventure();
    this.injectBridgeAPI();
    this.startObserving();
    
    if (this.currentAdventureId) {
      this.createWidgetContainer();
    }
    
    console.log('[BetterScripts] Initialization complete');
  }

  destroy() {
    console.log('[BetterScripts] Destroying BetterScripts feature...');
    
    this.stopObserving();
    this.removeBridgeAPI();
    this.removeWidgetContainer();
    this.registeredWidgets.clear();
    
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
      
      this.createWidgetContainer();
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
    
    // Aggressive observer specifically for toast/notification area
    // This runs immediately without debouncing to catch state.message
    this.setupToastObserver();
    
    // Aggressive observer for gameplay output - strips protocol messages immediately
    this.setupGameplayOutputObserver();
    
    // Also scan existing content
    this.scanForMessages();
  }
  
  /**
   * Sets up an aggressive observer for the toast/notification area
   * to catch state.message content immediately and hide it
   */
  setupToastObserver() {
    // Function to observe a toast container
    const observeToastContainer = (container) => {
      if (!container || container._bdObserved) return;
      container._bdObserved = true;
      
      const toastObserver = new MutationObserver((mutations) => {
        // Process immediately without debouncing
        for (const mutation of mutations) {
          // Check added nodes for protocol messages
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent || '';
              if (text.includes('[[BD:')) {
                this.log('Toast message detected, processing immediately...');
                this.processToastMessage(node);
              }
            }
          }
        }
      });
      
      toastObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true
      });
      
      this.log('Toast observer attached to:', container.className || container.tagName);
    };
    
    // Try to find existing toast containers
    const findAndObserveToasts = () => {
      const selectors = [
        '[aria-label*="Notifications"]',
        '[role="region"][aria-label*="Notification"]',
        '.is_ToastViewport',
        '.is_ViewportWrapper',
        '[class*="Toast"]',
        '[class*="toast"]'
      ];
      
      selectors.forEach(selector => {
        try {
          document.querySelectorAll(selector).forEach(observeToastContainer);
        } catch (e) {}
      });
    };
    
    // Find existing containers
    findAndObserveToasts();
    
    // Also watch for new toast containers being added
    const containerObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a toast container
            const isToast = node.matches && (
              node.matches('[aria-label*="Notifications"]') ||
              node.matches('[class*="Toast"]') ||
              node.matches('.is_ViewportWrapper')
            );
            if (isToast) {
              observeToastContainer(node);
            }
            // Also check children
            if (node.querySelectorAll) {
              findAndObserveToasts();
            }
          }
        }
      }
    });
    
    containerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
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
      
      const gameplayObserver = new MutationObserver((mutations) => {
        // Strip protocol messages IMMEDIATELY - no debounce
        this.stripProtocolMessagesFromGameplay();
      });
      
      gameplayObserver.observe(gameplayOutput, {
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
    const waitForGameplay = new MutationObserver((mutations) => {
      if (!document.querySelector('#gameplay-output')?._bdGameplayObserved) {
        observeGameplayOutput();
      }
    });
    
    waitForGameplay.observe(document.body, {
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
      
      // First, extract and process any messages we haven't seen
      while ((match = protocolRegex.exec(originalText)) !== null) {
        const rawMessage = match[1];
        if (rawMessage !== this.lastProcessedMessage) {
          try {
            const message = JSON.parse(rawMessage);
            this.lastProcessedMessage = rawMessage;
            this.log('Immediate strip - processing message:', message.type);
            this.processMessage(message);
          } catch (e) {
            this.log('Failed to parse stripped message:', e);
          }
        }
      }
      protocolRegex.lastIndex = 0;
      
      // Then strip all protocol text from the node
      textNode.textContent = originalText.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
    }
  }
  
  /**
   * Process a toast message immediately and hide it
   */
  processToastMessage(node) {
    const text = node.textContent || '';
    const messageRegex = /\[\[BD:([\s\S]*?):BD\]\]/g;
    let match;
    
    while ((match = messageRegex.exec(text)) !== null) {
      const rawMessage = match[1];
      const fullMatch = match[0];
      
      // Skip if already processed
      if (rawMessage === this.lastProcessedMessage) continue;
      
      try {
        const message = JSON.parse(rawMessage);
        this.lastProcessedMessage = rawMessage;
        this.log('Processing toast message:', message);
        this.processMessage(message);
        
        // Hide the toast element containing the protocol message
        this.hideToastElement(node, fullMatch);
      } catch (e) {
        this.log('Failed to parse toast message:', rawMessage, e);
      }
    }
  }
  
  /**
   * Hides a toast element containing protocol messages
   */
  hideToastElement(node, fullMatch) {
    // Try to find the parent toast element and hide it entirely
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    
    // Walk up to find the toast container
    while (element && element !== document.body) {
      // Check if this looks like a toast item
      if (element.matches && (
        element.matches('[role="status"]') ||
        element.matches('[role="alert"]') ||
        element.className.includes('Toast') ||
        element.className.includes('toast')
      )) {
        // Hide the entire toast
        element.style.display = 'none';
        this.log('Toast element hidden');
        return;
      }
      element = element.parentElement;
    }
    
    // Fallback: just remove the text from the node
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = node.textContent.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
    } else if (node.innerHTML) {
      node.innerHTML = node.innerHTML.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
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
      this.scanForMessages();
    }, 100);
  }

  // ==================== MESSAGE PARSING ====================

  /**
   * Scans the DOM for BetterScripts messages embedded in state.message output
   * Messages are formatted as: [[BD:{json}:BD]]
   * 
   * AI Dungeon displays state.message in several places:
   * 1. Toast notifications (aria-label="Notifications")
   * 2. Inline in the story text
   * 3. System message areas
   */
  scanForMessages() {
    if (!this.currentAdventureId) return;
    
    const messageRegex = /\[\[BD:([\s\S]*?):BD\]\]/g;
    const foundMessages = new Set();
    
    // Track if we found any messages that need hiding
    let messagesFound = false;
    
    // Helper to process text for messages
    const processTextForMessages = (text, sourceElement = null) => {
      let match;
      while ((match = messageRegex.exec(text)) !== null) {
        const rawMessage = match[1];
        const fullMatch = match[0];
        
        // Use hash of message to track duplicates within this scan
        const messageKey = rawMessage;
        if (foundMessages.has(messageKey)) continue;
        if (rawMessage === this.lastProcessedMessage) continue;
        
        foundMessages.add(messageKey);
        messagesFound = true;
        
        try {
          const message = JSON.parse(rawMessage);
          this.lastProcessedMessage = rawMessage;
          this.log('Found message in DOM:', message);
          this.processMessage(message);
          
          // Hide the protocol message from UI
          if (message.hideMessage !== false) {
            this.hideMessageElement(sourceElement, fullMatch);
          }
        } catch (e) {
          this.log('Failed to parse message:', rawMessage, e);
        }
      }
      // Reset regex lastIndex for reuse
      messageRegex.lastIndex = 0;
    };
    
    // 1. Scan gameplay output (main story area)
    const gameplayOutput = document.querySelector('#gameplay-output');
    if (gameplayOutput) {
      processTextForMessages(gameplayOutput.textContent || '');
    }
    
    // 2. Scan notifications/toast area (where state.message often appears)
    const notificationsArea = document.querySelector('[aria-label*="Notifications"], [role="region"][aria-label*="Notification"]');
    if (notificationsArea) {
      processTextForMessages(notificationsArea.textContent || '', notificationsArea);
    }
    
    // 3. Scan toast viewport elements
    const toastElements = document.querySelectorAll('.is_ToastViewport, [class*="Toast"], [class*="toast"]');
    toastElements.forEach(el => {
      processTextForMessages(el.textContent || '', el);
    });
    
    // 4. Scan for any element that might contain our protocol message
    // This is broader but catches edge cases
    const allTextNodes = document.evaluate(
      '//text()[contains(., "[[BD:")]',
      document.body,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    
    for (let i = 0; i < allTextNodes.snapshotLength; i++) {
      const textNode = allTextNodes.snapshotItem(i);
      if (textNode && textNode.textContent) {
        processTextForMessages(textNode.textContent, textNode.parentElement);
      }
    }
    
    // 5. Also check common info/system message selectors
    const infoSelectors = [
      '[class*="info"]',
      '[class*="system"]', 
      '[class*="message"]',
      '[class*="alert"]',
      '[class*="notice"]',
      '[role="alert"]',
      '[role="status"]'
    ];
    
    infoSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          const text = el.textContent || '';
          if (text.includes('[[BD:')) {
            processTextForMessages(text, el);
          }
        });
      } catch (e) {
        // Selector might be invalid, ignore
      }
    });
  }

  /**
   * Hides the BetterScripts protocol message from the visible UI
   * Uses multiple strategies to find and remove the protocol text
   */
  hideMessageElement(element, fullMatch) {
    this.log('Hiding message from UI:', fullMatch.substring(0, 50) + '...');
    
    // Strategy 1: Direct innerHTML replacement on the element
    if (element && element.innerHTML) {
      element.innerHTML = element.innerHTML.replace(fullMatch, '');
    }
    
    // Strategy 2: Search the entire gameplay output for the message
    this.hideFromGameplayOutput(fullMatch);
  }
  
  /**
   * Searches the gameplay output and removes protocol messages
   */
  hideFromGameplayOutput(fullMatch) {
    const gameplayOutput = document.querySelector('#gameplay-output');
    if (!gameplayOutput) return;
    
    // Walk through all text nodes and remove the protocol message
    const walker = document.createTreeWalker(
      gameplayOutput,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.includes('[[BD:')) {
        // Replace all protocol messages in this text node
        node.textContent = node.textContent.replace(/\[\[BD:[\s\S]*?:BD\]\]/g, '');
      }
    }
  }

  /**
   * Process a parsed BetterScripts message
   */
  processMessage(message) {
    this.log('Processing message:', message);
    
    if (!message.type) {
      this.log('Message missing type field');
      return;
    }
    
    switch (message.type) {
      case 'register':
        this.handleRegister(message);
        break;
      case 'widget':
        this.handleWidgetCommand(message);
        break;
      case 'update':
        this.handleUpdate(message);
        break;
      case 'remove':
        this.handleRemove(message);
        break;
      case 'ping':
        this.handlePing(message);
        break;
      default:
        this.log('Unknown message type:', message.type);
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
    const { widgetId, action, config } = message;
    
    if (!widgetId) {
      this.log('Widget message missing widgetId');
      return;
    }
    
    switch (action) {
      case 'create':
        this.createWidget(widgetId, config);
        break;
      case 'update':
        this.updateWidget(widgetId, config);
        break;
      case 'destroy':
        this.destroyWidget(widgetId);
        break;
      default:
        this.log('Unknown widget action:', action);
    }
  }

  /**
   * Handle generic update messages
   */
  handleUpdate(message) {
    const { target, data } = message;
    
    if (target && this.registeredWidgets.has(target)) {
      this.updateWidget(target, data);
    }
    
    // Emit event for custom handling
    window.dispatchEvent(new CustomEvent('betterscripts:update', {
      detail: message
    }));
  }

  /**
   * Handle remove messages
   */
  handleRemove(message) {
    const { target } = message;
    
    if (target && this.registeredWidgets.has(target)) {
      this.destroyWidget(target);
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
    
    // Find suitable location for widgets (near game settings)
    const settingsButton = document.querySelector(
      '[aria-label="Game settings"], [aria-label="Game Settings"], [aria-label="Game Menu"], [aria-label="Game menu"]'
    );
    
    this.widgetContainer = document.createElement('div');
    this.widgetContainer.className = 'bd-betterscripts-container';
    this.widgetContainer.id = 'bd-betterscripts-widgets';
    
    // Insert near the top of the game area
    const gameplayOutput = document.querySelector('#gameplay-output');
    if (gameplayOutput && gameplayOutput.parentElement) {
      gameplayOutput.parentElement.insertBefore(this.widgetContainer, gameplayOutput);
    } else {
      document.body.appendChild(this.widgetContainer);
    }
    
    this.log('Widget container created');
  }

  removeWidgetContainer() {
    if (this.widgetContainer) {
      this.widgetContainer.remove();
      this.widgetContainer = null;
    }
  }

  /**
   * Create a widget based on configuration from script
   */
  createWidget(widgetId, config) {
    if (!config || !config.type) {
      this.log('Widget config missing type');
      return;
    }
    
    // Remove existing widget with same ID
    if (this.registeredWidgets.has(widgetId)) {
      this.destroyWidget(widgetId);
    }
    
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
    
    const label = document.createElement('span');
    label.className = 'bd-widget-label';
    label.textContent = config.label || 'Progress';
    
    const barContainer = document.createElement('div');
    barContainer.className = 'bd-widget-bar-container';
    
    const barFill = document.createElement('div');
    barFill.className = 'bd-widget-bar-fill';
    
    const percentage = Math.min(100, Math.max(0, config.value || 0));
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
   * Update an existing widget
   */
  updateWidget(widgetId, config) {
    const widgetData = this.registeredWidgets.get(widgetId);
    if (!widgetData) {
      this.log('Widget not found for update:', widgetId);
      return;
    }
    
    const { element, config: existingConfig } = widgetData;
    const mergedConfig = { ...existingConfig, ...config };
    
    // Update based on widget type
    switch (existingConfig.type) {
      case 'stat':
        const valueEl = element.querySelector('.bd-widget-value');
        if (valueEl && config.value !== undefined) {
          valueEl.textContent = config.value;
        }
        if (valueEl && config.color) {
          valueEl.style.color = config.color;
        }
        break;
        
      case 'bar':
        const barFill = element.querySelector('.bd-widget-bar-fill');
        const barText = element.querySelector('.bd-widget-bar-text');
        if (barFill && config.value !== undefined) {
          const percentage = Math.min(100, Math.max(0, config.value || 0));
          barFill.style.width = `${percentage}%`;
        }
        if (barText && config.value !== undefined) {
          barText.textContent = `${config.value}/${config.max || existingConfig.max || 100}`;
        }
        if (barFill && config.color) {
          barFill.style.backgroundColor = config.color;
        }
        break;
        
      case 'text':
        if (config.text !== undefined) {
          element.textContent = config.text;
        }
        break;
        
      case 'panel':
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
    this.lastProcessedMessage = null;
    this.log('All widgets cleared');
  }

  // ==================== BRIDGE API ====================

  /**
   * Inject global API for BetterDungeon to communicate with scripts.
   * Content scripts run in an isolated context, so we need to inject
   * an external script file to bypass CSP restrictions.
   */
  injectBridgeAPI() {
    // Store reference to this for event handlers
    const self = this;
    
    // Create the bridge script that runs in page context
    // Use external file to bypass CSP restrictions
    const bridgeScript = document.createElement('script');
    bridgeScript.id = 'betterscripts-bridge';
    bridgeScript.src = chrome.runtime.getURL('bridge/betterscripts_bridge.js');
    
    // Inject script into page
    (document.head || document.documentElement).appendChild(bridgeScript);
    
    // Listen for commands from the page context
    window.addEventListener('betterscripts:command', (event) => {
      const { command, data } = event.detail || {};
      
      switch (command) {
        case 'createWidget':
          self.createWidget(data.id, data.config);
          break;
        case 'updateWidget':
          self.updateWidget(data.id, data.config);
          break;
        case 'destroyWidget':
          self.destroyWidget(data.id);
          break;
        case 'clearWidgets':
          self.clearAllWidgets();
          break;
        case 'testMessage':
          self.processMessage(data.message);
          break;
        case 'demo':
          self.runDemo();
          break;
        case 'forceScan':
          self.scanForMessages();
          break;
        case 'getState':
          console.log('[BetterScripts] Current State:', {
            adventureId: self.currentAdventureId,
            widgetCount: self.registeredWidgets.size,
            widgets: Array.from(self.registeredWidgets.keys()),
            lastMessage: self.lastProcessedMessage,
            containerExists: !!self.widgetContainer && document.body.contains(self.widgetContainer)
          });
          break;
        default:
          self.log('Unknown command:', command);
      }
    });
    
    this.log('Bridge API injected');
  }

  /**
   * Run demo to create sample widgets
   */
  runDemo() {
    console.log('[BetterScripts] Creating demo widgets...');
    
    this.processMessage({
      type: 'register',
      scriptId: 'demo-script',
      scriptName: 'Demo Script',
      version: '1.0.0'
    });
    
    this.processMessage({
      type: 'widget',
      widgetId: 'demo-stats',
      action: 'create',
      config: {
        type: 'panel',
        title: 'Player Stats (Demo)',
        items: [
          { label: 'HP', value: '75/100', color: '#22c55e' },
          { label: 'Gold', value: '42', color: '#fbbf24' },
          { label: 'Level', value: '5', color: '#a855f7' }
        ]
      }
    });
    
    this.processMessage({
      type: 'widget',
      widgetId: 'demo-hp-bar',
      action: 'create',
      config: {
        type: 'bar',
        label: 'Health',
        value: 75,
        max: 100,
        color: '#22c55e'
      }
    });
    
    console.log('[BetterScripts] Demo widgets created. Call BetterScriptsBridge.clearWidgets() to remove.');
  }

  removeBridgeAPI() {
    const bridgeScript = document.getElementById('betterscripts-bridge');
    if (bridgeScript) {
      bridgeScript.remove();
    }
    
    // Inject removal script
    const removeScript = document.createElement('script');
    removeScript.textContent = `
      if (window.BetterScriptsBridge) {
        delete window.BetterScriptsBridge;
      }
    `;
    (document.head || document.documentElement).appendChild(removeScript);
    removeScript.remove();
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
