// BetterDungeon - features/readable_position_feature.js
// Moves the "Readable" tab button to appear right after the "All" button

class ReadablePositionFeature {
  static id = 'readablePosition';

  constructor() {
    this.observer = null;
    this.debounceTimer = null;
    this.lastTabListId = null;
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  init() {
    console.log('[ReadablePosition] Initializing Readable Tab Fix feature...');
    this.startObserving();
    this.relocateReadableTab();
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  debouncedRelocate() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.relocateReadableTab();
    }, 100);
  }

  findTabList() {
    return document.querySelector('[role="tablist"][aria-label="Section Tabs"]');
  }

  findAllTab(tabList) {
    return tabList.querySelector('[aria-label="Selected tab All"], [aria-label="Tab All"]');
  }

  findReadableTab(tabList) {
    return tabList.querySelector('[aria-label="Tab Readable"], [aria-label="Selected tab Readable"]');
  }

  relocateReadableTab() {
    const tabList = this.findTabList();
    if (!tabList) return;

    const allTab = this.findAllTab(tabList);
    const readableTab = this.findReadableTab(tabList);

    if (!allTab || !readableTab) {
      return;
    }

    // Get the parent span wrappers (the tabs are wrapped in span elements)
    const allTabWrapper = allTab.closest('span._dsp_contents');
    const readableTabWrapper = readableTab.closest('span._dsp_contents');

    if (!allTabWrapper || !readableTabWrapper) {
      return;
    }

    // Check if Readable is already right after All
    if (allTabWrapper.nextElementSibling === readableTabWrapper) {
      return;
    }

    // Move Readable tab wrapper to be right after All tab wrapper
    const parent = allTabWrapper.parentNode;
    if (parent && allTabWrapper.nextSibling) {
      parent.insertBefore(readableTabWrapper, allTabWrapper.nextSibling);
    }
  }

  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      let shouldRelocate = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if a tab list was added or if we're on a new page
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the added node is or contains a Section Tabs tablist
              if (node.matches?.('[role="tablist"][aria-label="Section Tabs"]') ||
                  node.querySelector?.('[role="tablist"][aria-label="Section Tabs"]')) {
                shouldRelocate = true;
                break;
              }
            }
          }
        }
        if (shouldRelocate) break;
      }

      if (shouldRelocate) {
        this.debouncedRelocate();
      }
    });

    // Observe the entire document body for page navigation changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReadablePositionFeature;
}
