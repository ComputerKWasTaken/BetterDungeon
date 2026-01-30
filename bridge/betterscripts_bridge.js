// BetterScripts Bridge API
// This script runs in the page context and provides the API for DevTools/scripts
// It communicates with the content script via custom events

(function() {
  'use strict';
  
  // Prevent double initialization
  if (window.BetterScriptsBridge) {
    console.log('[BetterScripts] Bridge already initialized');
    return;
  }
  
  const PROTOCOL_VERSION = '1.0.0';
  
  // BetterScripts Bridge API - accessible from page context and DevTools
  window.BetterScriptsBridge = {
    version: PROTOCOL_VERSION,
    available: true,
    registeredScripts: new Map(),
    
    // Check if BetterScripts is available
    isAvailable: function() { 
      return true; 
    },
    
    // Get protocol version
    getVersion: function() { 
      return this.version; 
    },
    
    // Send command to content script via custom event
    _sendCommand: function(command, data) {
      window.dispatchEvent(new CustomEvent('betterscripts:command', {
        detail: { command: command, data: data }
      }));
    },
    
    // Manual widget control
    createWidget: function(id, config) {
      this._sendCommand('createWidget', { id: id, config: config });
    },
    
    updateWidget: function(id, config) {
      this._sendCommand('updateWidget', { id: id, config: config });
    },
    
    destroyWidget: function(id) {
      this._sendCommand('destroyWidget', { id: id });
    },
    
    clearWidgets: function() {
      this._sendCommand('clearWidgets', {});
    },
    
    // Get registered scripts
    getRegisteredScripts: function() {
      return Array.from(this.registeredScripts.entries());
    },
    
    // Send a test message
    testMessage: function(message) {
      this._sendCommand('testMessage', { message: message });
    },
    
    // Demo: Create sample widgets
    demo: function() {
      console.log('[BetterScripts] Running demo...');
      this._sendCommand('demo', {});
    },
    
    // Force scan for messages
    forceScan: function() {
      console.log('[BetterScripts] Force scanning...');
      this._sendCommand('forceScan', {});
    },
    
    // Get current state (async - logs to console)
    getState: function() {
      this._sendCommand('getState', {});
      console.log('[BetterScripts] State request sent. Check console for response.');
    }
  };
  
  // Signal that bridge is ready
  window.dispatchEvent(new CustomEvent('betterscripts:ready', {
    detail: { version: PROTOCOL_VERSION }
  }));
  
  console.log('[BetterScripts] Bridge API v' + PROTOCOL_VERSION + ' loaded');
})();
