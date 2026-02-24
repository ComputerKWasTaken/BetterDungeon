// Browser compatibility polyfill for Chrome and Firefox extension APIs
// This file provides a unified API for both browsers

if (typeof browser === 'undefined') {
  // Chrome environment - create browser namespace
  window.browser = window.chrome;
} else if (typeof chrome === 'undefined') {
  // Firefox environment - create chrome namespace  
  window.chrome = window.browser;
}

// Export for module systems if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { browser: window.browser, chrome: window.chrome };
}
