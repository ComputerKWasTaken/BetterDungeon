// BetterDungeon - Story Card Modal Dock Feature
//
// Goals:
// - Dock the "Story Card Edit Modal" to the right side (when there is enough space)
// - Remove the dark overlay while docked
// - Allow click-outside-to-close while docked
// - Allow reading/scrolling the story behind the modal while docked
//
// Notes:
// AI Dungeon applies an aggressive scroll-lock when dialogs are open (often using
// inline styles and/or !important rules). To keep the dock usable, we forcibly
// override scroll-lock styles while docked, then restore them on close/undock.

class StoryCardModalDockFeature {
  static id = 'storyCardModalDock';

  constructor() {
    this.observer = null;
    this.styleObserver = null;
    this.debounceTimer = null;
    this.resizeHandler = null;
    this.clickHandler = null;
    this.wheelHandler = null;
    this.touchMoveHandler = null;
    this.scrollOverrideState = null;
    this.baseScrollStyles = null;
    this._lastTouch = null;
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  // Capture an element's inline style value and priority so we can restore it
  // precisely later.
  captureInlineStyle(el, prop) {
    return {
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop)
    };
  }

  // Restore an element's inline style value and priority.
  // If no value exists, remove the property entirely.
  restoreInlineStyle(el, prop, entry) {
    if (!el) return;
    if (!entry || entry.value === '') {
      el.style.removeProperty(prop);
      return;
    }
    el.style.setProperty(prop, entry.value, entry.priority || '');
  }

  init() {
    console.log('[StoryCardModalDock] Initializing Story Card Modal Dock feature...');

    // Capture the page's initial inline styles so we can restore them when the
    // modal closes (or the feature is torn down).
    this.captureBaseScrollStyles();

    // Watch for the modal to appear/disappear and for the app to mutate the DOM.
    this.startObserving();
    this.applyDockingIfPresent();

    // Re-evaluate docking on resize; sometimes the available right-side space
    // changes depending on layout/breakpoints.
    this.resizeHandler = () => this.debouncedApply();
    window.addEventListener('resize', this.resizeHandler);

    // Click-outside-to-close (capture phase) so it triggers before AID handlers.
    this.clickHandler = (e) => this.handleDocumentClick(e);
    document.addEventListener('click', this.clickHandler, true);

    // Scroll forwarding: even with scroll-lock defeated, some apps still stop
    // wheel/touchmove events while dialogs are open. We forward those inputs to
    // the real scroll container when the pointer is outside the modal.
    this.wheelHandler = (e) => this.handleGlobalWheel(e);
    window.addEventListener('wheel', this.wheelHandler, { capture: true, passive: false });

    this.touchMoveHandler = (e) => this.handleGlobalTouchMove(e);
    window.addEventListener('touchmove', this.touchMoveHandler, { capture: true, passive: false });
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.styleObserver) {
      this.styleObserver.disconnect();
      this.styleObserver = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }
    if (this.wheelHandler) {
      window.removeEventListener('wheel', this.wheelHandler, true);
      this.wheelHandler = null;
    }
    if (this.touchMoveHandler) {
      window.removeEventListener('touchmove', this.touchMoveHandler, true);
      this.touchMoveHandler = null;
    }
    this.removeDocking();
  }

  // Force scrolling + interactions to remain enabled while docked.
  //
  // This is intentionally aggressive: AID tends to set overflow hidden and
  // pointer-events none when opening a modal. We override those with inline
  // !important styles (and keep re-applying via MutationObserver).
  ensurePageScrollUnlocked() {
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    const setImportant = (el, prop, value) => {
      if (el.style.getPropertyValue(prop) !== value || el.style.getPropertyPriority(prop) !== 'important') {
        el.style.setProperty(prop, value, 'important');
      }
    };

    if (!this.scrollOverrideState) {
      const state = {
        htmlOverflow: this.captureInlineStyle(html, 'overflow'),
        htmlOverflowX: this.captureInlineStyle(html, 'overflow-x'),
        htmlOverflowY: this.captureInlineStyle(html, 'overflow-y'),

        bodyOverflow: this.captureInlineStyle(body, 'overflow'),
        bodyOverflowX: this.captureInlineStyle(body, 'overflow-x'),
        bodyOverflowY: this.captureInlineStyle(body, 'overflow-y'),
        bodyPosition: this.captureInlineStyle(body, 'position'),
        bodyTop: this.captureInlineStyle(body, 'top'),
        bodyLeft: this.captureInlineStyle(body, 'left'),
        bodyRight: this.captureInlineStyle(body, 'right'),
        bodyWidth: this.captureInlineStyle(body, 'width'),
        bodyPointerEvents: this.captureInlineStyle(body, 'pointer-events'),
        lockedScrollY: null,
        lockedScrollX: null,
        didRestoreScroll: false
      };

      const top = parseInt(body.style.top || '0', 10);
      const left = parseInt(body.style.left || '0', 10);
      if (body.style.position === 'fixed') {
        if (Number.isFinite(top)) state.lockedScrollY = Math.abs(top);
        if (Number.isFinite(left)) state.lockedScrollX = Math.abs(left);
      }

      this.scrollOverrideState = state;
    } else {
      const state = this.scrollOverrideState;
      if (state.lockedScrollY === null || state.lockedScrollX === null) {
        const top = parseInt(body.style.top || '0', 10);
        const left = parseInt(body.style.left || '0', 10);
        if (body.style.position === 'fixed') {
          if (state.lockedScrollY === null && Number.isFinite(top)) state.lockedScrollY = Math.abs(top);
          if (state.lockedScrollX === null && Number.isFinite(left)) state.lockedScrollX = Math.abs(left);
        }
      }
    }

    setImportant(html, 'overflow', 'auto');
    setImportant(html, 'overflow-x', 'auto');
    setImportant(html, 'overflow-y', 'auto');

    setImportant(body, 'overflow', 'auto');
    setImportant(body, 'overflow-x', 'auto');
    setImportant(body, 'overflow-y', 'auto');
    setImportant(body, 'position', 'static');
    setImportant(body, 'top', 'auto');
    setImportant(body, 'left', 'auto');
    setImportant(body, 'right', 'auto');
    setImportant(body, 'width', 'auto');
    setImportant(body, 'pointer-events', 'auto');

    const state = this.scrollOverrideState;
    if (!state.didRestoreScroll && (state.lockedScrollY !== null || state.lockedScrollX !== null)) {
      window.scrollTo(state.lockedScrollX || window.scrollX, state.lockedScrollY || window.scrollY);
      state.didRestoreScroll = true;
    }
  }

  captureBaseScrollStyles() {
    if (this.baseScrollStyles) return;

    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    this.baseScrollStyles = {
      html: {
        overflow: this.captureInlineStyle(html, 'overflow'),
        overflowX: this.captureInlineStyle(html, 'overflow-x'),
        overflowY: this.captureInlineStyle(html, 'overflow-y')
      },
      body: {
        overflow: this.captureInlineStyle(body, 'overflow'),
        overflowX: this.captureInlineStyle(body, 'overflow-x'),
        overflowY: this.captureInlineStyle(body, 'overflow-y'),
        position: this.captureInlineStyle(body, 'position'),
        top: this.captureInlineStyle(body, 'top'),
        left: this.captureInlineStyle(body, 'left'),
        right: this.captureInlineStyle(body, 'right'),
        width: this.captureInlineStyle(body, 'width'),
        pointerEvents: this.captureInlineStyle(body, 'pointer-events')
      }
    };
  }

  restorePageScrollLockIfNeeded() {
    if (!this.scrollOverrideState) return;

    // If docking is turned off while the modal is still open (e.g. due to
    // window resize), restore the styles captured at the moment we unlocked.

    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) {
      this.scrollOverrideState = null;
      return;
    }

    const state = this.scrollOverrideState;

    this.restoreInlineStyle(html, 'overflow', state.htmlOverflow);
    this.restoreInlineStyle(html, 'overflow-x', state.htmlOverflowX);
    this.restoreInlineStyle(html, 'overflow-y', state.htmlOverflowY);

    this.restoreInlineStyle(body, 'overflow', state.bodyOverflow);
    this.restoreInlineStyle(body, 'overflow-x', state.bodyOverflowX);
    this.restoreInlineStyle(body, 'overflow-y', state.bodyOverflowY);
    this.restoreInlineStyle(body, 'position', state.bodyPosition);
    this.restoreInlineStyle(body, 'top', state.bodyTop);
    this.restoreInlineStyle(body, 'left', state.bodyLeft);
    this.restoreInlineStyle(body, 'right', state.bodyRight);
    this.restoreInlineStyle(body, 'width', state.bodyWidth);
    this.restoreInlineStyle(body, 'pointer-events', state.bodyPointerEvents);

    this.scrollOverrideState = null;
  }

  restoreBaseScrollStylesIfNeeded() {
    if (!this.scrollOverrideState) return;

    // When the modal is closed, restore the page's original (pre-modal) styles.

    const html = document.documentElement;
    const body = document.body;

    const base = this.baseScrollStyles;
    if (!base) {
      this.scrollOverrideState = null;
      return;
    }

    this.restoreInlineStyle(html, 'overflow', base.html.overflow);
    this.restoreInlineStyle(html, 'overflow-x', base.html.overflowX);
    this.restoreInlineStyle(html, 'overflow-y', base.html.overflowY);

    this.restoreInlineStyle(body, 'overflow', base.body.overflow);
    this.restoreInlineStyle(body, 'overflow-x', base.body.overflowX);
    this.restoreInlineStyle(body, 'overflow-y', base.body.overflowY);
    this.restoreInlineStyle(body, 'position', base.body.position);
    this.restoreInlineStyle(body, 'top', base.body.top);
    this.restoreInlineStyle(body, 'left', base.body.left);
    this.restoreInlineStyle(body, 'right', base.body.right);
    this.restoreInlineStyle(body, 'width', base.body.width);
    this.restoreInlineStyle(body, 'pointer-events', base.body.pointerEvents);

    this.scrollOverrideState = null;
  }

  shouldDock() {
    // Dock only when we can compute a usable right-side width.
    return this.getAvailableDockWidth() !== null;
  }

  getAvailableDockWidth() {
    // Compute how much space exists to the right of the gameplay output.
    // If there isn't enough room, we avoid docking to prevent covering content.
    const gameplay = document.getElementById('gameplay-output');
    let availableRight = null;

    if (gameplay) {
      const rect = gameplay.getBoundingClientRect();
      availableRight = window.innerWidth - rect.right;
    }

    if (availableRight === null || !isFinite(availableRight)) {
      availableRight = window.innerWidth * 0.33;
    }

    const width = Math.floor(Math.min(520, availableRight - 24));
    if (width < 320) return null;
    return width;
  }

  handleDocumentClick(e) {
    // Click outside the docked modal closes it.
    //
    // We only do this while docked to avoid changing default AID behavior.
    const modal = this.findStoryCardModal();
    if (!modal) return;
    if (!this.shouldDock()) return;

    if (e.target?.closest?.('.bd-analytics-dashboard')) return;

    if (modal.contains(e.target)) {
      return;
    }

    // Prevent click-through to the underlying page.
    e.preventDefault();
    e.stopPropagation();

    const backdrop = this.findBackdropForModal(modal);
    if (backdrop) {
      backdrop.click();
      return;
    }

    this.tryCloseModal(modal);
  }

  handleGlobalWheel(e) {
    // Forward wheel scrolling to the story area when the pointer is outside the
    // docked modal.
    if (!document.documentElement.classList.contains('bd-story-card-dock-active')) return;

    // Don't interfere with browser zoom gestures.
    if (e.ctrlKey || e.metaKey) return;

    const modal = this.findStoryCardModal();
    if (!modal) return;
    if (modal.contains(e.target)) return;

    const container = this.getStoryScrollContainer();
    if (!container) return;

    const dx = e.deltaX || 0;
    const dy = e.deltaY || 0;
    if (dx === 0 && dy === 0) return;

    if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
      const beforeX = window.scrollX;
      const beforeY = window.scrollY;
      window.scrollBy(dx, dy);
      if (window.scrollX !== beforeX || window.scrollY !== beforeY) {
        e.preventDefault();
      }
      return;
    }

    const beforeTop = container.scrollTop;
    const beforeLeft = container.scrollLeft;
    if (typeof container.scrollBy === 'function') {
      container.scrollBy(dx, dy);
    } else {
      container.scrollLeft += dx;
      container.scrollTop += dy;
    }
    if (container.scrollTop !== beforeTop || container.scrollLeft !== beforeLeft) {
      e.preventDefault();
    }
  }

  handleGlobalTouchMove(e) {
    // Touch equivalent of wheel forwarding.
    if (!document.documentElement.classList.contains('bd-story-card-dock-active')) return;

    // Ignore multi-touch (pinch zoom, etc.).
    if ((e.touches?.length || 0) > 1) {
      this._lastTouch = null;
      return;
    }

    const modal = this.findStoryCardModal();
    if (!modal) return;
    if (modal.contains(e.target)) {
      this._lastTouch = null;
      return;
    }

    const container = this.getStoryScrollContainer();
    if (!container) return;

    if (!this._lastTouch) {
      const t = e.touches?.[0];
      if (!t) return;
      this._lastTouch = { x: t.clientX, y: t.clientY };
      return;
    }

    const t = e.touches?.[0];
    if (!t) return;

    const dx = this._lastTouch.x - t.clientX;
    const dy = this._lastTouch.y - t.clientY;
    this._lastTouch = { x: t.clientX, y: t.clientY };

    if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
      const beforeX = window.scrollX;
      const beforeY = window.scrollY;
      window.scrollBy(dx, dy);
      if (window.scrollX !== beforeX || window.scrollY !== beforeY) {
        e.preventDefault();
      }
      return;
    }

    const beforeTop = container.scrollTop;
    const beforeLeft = container.scrollLeft;
    if (typeof container.scrollBy === 'function') {
      container.scrollBy(dx, dy);
    } else {
      container.scrollLeft += dx;
      container.scrollTop += dy;
    }
    if (container.scrollTop !== beforeTop || container.scrollLeft !== beforeLeft) {
      e.preventDefault();
    }
  }

  isScrollableElement(el) {
    // Heuristic: treat an element as scrollable if its overflow allows scrolling
    // and its scroll size exceeds its client size.
    if (!el) return false;
    const style = getComputedStyle(el);

    const overflowY = style.overflowY;
    const overflowX = style.overflowX;

    const canScrollY = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && el.scrollHeight > el.clientHeight + 1;
    const canScrollX = (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') && el.scrollWidth > el.clientWidth + 1;

    return canScrollY || canScrollX;
  }

  findScrollableAncestor(startEl) {
    // Walk up the DOM to find the nearest scrollable ancestor.
    let el = startEl;
    for (let i = 0; i < 25 && el; i++) {
      if (this.isScrollableElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  getStoryScrollContainer() {
    // Try common AID containers first, then fall back to the document scroller.
    const gameplay = document.getElementById('gameplay-output');
    const viewport = document.querySelector('#gameplay-output [data-overlayscrollbars-viewport]');
    const start = viewport || gameplay;

    const ancestor = start ? this.findScrollableAncestor(start) : null;
    if (ancestor) return ancestor;

    const scrolling = document.scrollingElement;
    if (scrolling) return scrolling;

    return document.documentElement || document.body || null;
  }

  tryCloseModal(modal) {
    if (!modal) return false;

    const candidates = modal.querySelectorAll('button, [role="button"]');
    for (const el of candidates) {
      const text = el.textContent?.trim().toUpperCase();
      if (text === 'FINISH' || text === 'DONE' || text === 'CLOSE') {
        el.click();
        return true;
      }
    }

    const close = modal.querySelector('[aria-label="Close"], [aria-label="close"], [data-testid*="close"]');
    if (close) {
      close.click();
      return true;
    }

    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  findStoryCardModal() {
    return (
      document.querySelector('[aria-label="Story Card Edit Modal"][role="alertdialog"]') ||
      document.querySelector('[aria-label="Story Card Edit Modal"][role="dialog"]') ||
      document.querySelector('[aria-label="Story Card Edit Modal"]')
    );
  }

  findBackdropForModal(modal) {
    if (!modal) return null;

    let current = modal;
    for (let i = 0; i < 12 && current; i++) {
      const backdrop = current.querySelector?.('button[aria-label="Close Dialog"]');
      if (backdrop) return backdrop;
      current = current.parentElement;
    }

    return null;
  }

  applyDockingIfPresent() {
    // Main state machine:
    // - If modal isn't present: clear docking + restore styles.
    // - If modal is present but docking isn't possible: undock and restore AID lock.
    // - If docking is possible: dock, remove overlay, unlock scrolling.
    const modal = this.findStoryCardModal();
    if (!modal) {
      this.removeDocking();
      return;
    }

    const backdrop = this.findBackdropForModal(modal);

    const dockWidth = this.getAvailableDockWidth();

    if (dockWidth === null) {
      modal.classList.remove('bd-story-card-dock-modal');
      backdrop?.classList.remove('bd-story-card-dock-backdrop');
      document.documentElement.style.removeProperty('--bd-story-card-dock-width');
      document.documentElement.classList.remove('bd-story-card-dock-active');

      this.restorePageScrollLockIfNeeded();
      return;
    }

    document.documentElement.style.setProperty('--bd-story-card-dock-width', `${dockWidth}px`);
    modal.classList.add('bd-story-card-dock-modal');
    if (backdrop) {
      backdrop.classList.add('bd-story-card-dock-backdrop');
    }
    document.documentElement.classList.add('bd-story-card-dock-active');

    this.ensurePageScrollUnlocked();
  }

  removeDocking() {
    // Remove any docking-related classes/styles and restore page styles.
    document.querySelectorAll('.bd-story-card-dock-modal').forEach(el => {
      el.classList.remove('bd-story-card-dock-modal');
    });
    document.querySelectorAll('.bd-story-card-dock-backdrop').forEach(el => {
      el.classList.remove('bd-story-card-dock-backdrop');
    });
    document.documentElement.style.removeProperty('--bd-story-card-dock-width');
    document.documentElement.classList.remove('bd-story-card-dock-active');

    this.restoreBaseScrollStylesIfNeeded();
    this._lastTouch = null;
  }

  debouncedApply() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.applyDockingIfPresent();
    }, 80);
  }

  startObserving() {
    // Observe DOM changes for modal appearance/disappearance.
    // Also observe style changes to keep our scroll unlock applied.
    if (this.observer) {
      this.observer.disconnect();
    }

    if (this.styleObserver) {
      this.styleObserver.disconnect();
    }

    this.observer = new MutationObserver(() => {
      this.debouncedApply();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.styleObserver = new MutationObserver(() => {
      if (document.documentElement.classList.contains('bd-story-card-dock-active')) {
        this.ensurePageScrollUnlocked();
      }
    });

    if (document.documentElement) {
      this.styleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    }
    if (document.body) {
      this.styleObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    }
  }
}

if (typeof window !== 'undefined') {
  window.StoryCardModalDockFeature = StoryCardModalDockFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StoryCardModalDockFeature;
}
