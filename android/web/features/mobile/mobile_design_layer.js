// ═══ mobile_design_layer.js ═══
// Mobile-specific UI enhancements for the input mode switcher menu.
// Converts the input mode menu from a static element to a scrollable
// container whenever the expanded mode list overflows on narrow screens.
// Also injects a gradient fade affordance so the player knows the
// menu is scrollable.

(function () {
  'use strict';

  const STYLE_ID = 'bd-mobile-mode-menu-styles';
  const GRADIENT_CLASS = 'bd-mode-menu-gradient';
  const TOUCH_DRAG_THRESHOLD = 6;
  const touchBindings = new Map();
  const gradientBindings = new Map();

  function findInputModeMenu() {
    const button = document.querySelector('[aria-label="Set to \'Do\' mode"]') ||
      document.querySelector('[aria-label="Set to \'Story\' mode"]') ||
      document.querySelector('[aria-label="Set to \'Guide\' mode"]') ||
      document.querySelector('[aria-label="Set to \'Try\' mode"]') ||
      document.querySelector('[aria-label="Set to \'Command\' mode"]');
    return button?.parentElement || null;
  }

  function markMenu(menu) {
    if (!menu) return null;
    menu.setAttribute('data-bd-mode-menu', 'true');
    const menuLeft = parseFloat(menu.style.left) || Math.max(8, Math.round(menu.getBoundingClientRect().left || 12));
    menu.style.setProperty('--bd-menu-left', `${menuLeft}px`);
    return menu;
  }

  /** Inject the <style> tag that makes [data-bd-mode-menu] scrollable. */
  function injectScrollStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Make the expanded input-mode menu horizontally scrollable.
         React sets overflow:hidden as an inline style on the container;
         !important overrides it so our scroll behaviour persists. */
      [data-bd-mode-menu] {
        /* Size the rail to its contents, then cap only the visible viewport.
           This creates real horizontal overflow without pixel measurements. */
        width: max-content !important;
        max-width: calc(100vw - var(--bd-menu-left, 12px) - 8px) !important;
        flex: 0 0 auto !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        touch-action: pan-x;
        flex-wrap: nowrap !important;
      }

      /* The rail, rather than individual controls, absorbs the overflow. */
      [data-bd-mode-menu] > [role="button"] {
        flex: 0 0 auto !important;
      }

      /* Hide the scrollbar but keep scroll functional */
      [data-bd-mode-menu]::-webkit-scrollbar {
        display: none;
      }
      [data-bd-mode-menu] {
        scrollbar-width: none;   /* Firefox */
        -ms-overflow-style: none; /* IE/Edge */
      }

      /* Sticky overlays remain pinned to the visible edges while the menu's
         buttons move underneath them. Opacity is updated from scroll state. */
      [data-bd-mode-menu] > .${GRADIENT_CLASS} {
        position: sticky;
        top: 0;
        align-self: stretch;
        flex: 0 0 24px;
        min-width: 24px;
        pointer-events: none;
        z-index: 3;
        opacity: 0;
        transition: opacity 160ms ease;
      }
      [data-bd-mode-menu] > .${GRADIENT_CLASS}--left {
        left: 0;
        margin-right: -24px;
        background: linear-gradient(to right, var(--bd-mode-menu-background, rgb(47, 53, 57)), transparent);
      }
      [data-bd-mode-menu] > .${GRADIENT_CLASS}--right {
        right: 0;
        margin-left: -24px;
        background: linear-gradient(to left, var(--bd-mode-menu-background, rgb(47, 53, 57)), transparent);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * AI Dungeon's keyboard/scroll rewrite can claim the touch gesture from an
   * ancestor before WebView performs native overflow scrolling. Keep a small
   * manual drag fallback on the menu itself. Taps and vertical gestures are
   * left alone so mode buttons and the game scroller retain normal behavior.
   */
  function enableTouchScrolling(menu) {
    if (!menu || touchBindings.has(menu)) return;

    const state = {
      tracking: false,
      dragging: false,
      startX: 0,
      startY: 0,
      startScrollLeft: 0,
      suppressClickUntil: 0
    };

    const onTouchStart = (event) => {
      if (event.touches.length !== 1 || menu.scrollWidth <= menu.clientWidth) return;
      const touch = event.touches[0];
      state.tracking = true;
      state.dragging = false;
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.startScrollLeft = menu.scrollLeft;
    };

    const onTouchMove = (event) => {
      if (!state.tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;

      if (!state.dragging) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < TOUCH_DRAG_THRESHOLD) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY)) {
          state.tracking = false;
          return;
        }
        state.dragging = true;
        state.suppressClickUntil = Date.now() + 400;
      }

      menu.scrollLeft = state.startScrollLeft - deltaX;
      event.preventDefault();
      event.stopPropagation();
    };

    const onTouchEnd = () => {
      state.tracking = false;
      state.dragging = false;
    };

    const onTouchCancel = () => {
      state.tracking = false;
      state.dragging = false;
    };

    const onClick = (event) => {
      if (Date.now() > state.suppressClickUntil) return;
      state.suppressClickUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    menu.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    menu.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    menu.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    menu.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    menu.addEventListener('click', onClick, true);

    touchBindings.set(menu, () => {
      menu.removeEventListener('touchstart', onTouchStart, true);
      menu.removeEventListener('touchmove', onTouchMove, true);
      menu.removeEventListener('touchend', onTouchEnd, true);
      menu.removeEventListener('touchcancel', onTouchCancel, true);
      menu.removeEventListener('click', onClick, true);
    });
  }

  function disableTouchScrolling() {
    for (const removeListeners of touchBindings.values()) removeListeners();
    touchBindings.clear();
  }

  /** Remove the scroll styles. */
  function removeScrollStyles() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  /** Inject edge fades that track whether more content exists in each direction. */
  function injectGradient(menu) {
    if (!menu || gradientBindings.has(menu)) return;

    const background = getComputedStyle(menu).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)') {
      menu.style.setProperty('--bd-mode-menu-background', background);
    }

    const leftGradient = document.createElement('div');
    leftGradient.className = `${GRADIENT_CLASS} ${GRADIENT_CLASS}--left`;
    leftGradient.setAttribute('aria-hidden', 'true');
    const rightGradient = document.createElement('div');
    rightGradient.className = `${GRADIENT_CLASS} ${GRADIENT_CLASS}--right`;
    rightGradient.setAttribute('aria-hidden', 'true');
    menu.insertBefore(leftGradient, menu.firstChild);
    menu.appendChild(rightGradient);

    const updateGradientVisibility = () => {
      const canScroll = menu.scrollWidth > menu.clientWidth + 2;
      const atStart = menu.scrollLeft <= 2;
      const atEnd = menu.scrollLeft + menu.clientWidth >= menu.scrollWidth - 2;
      leftGradient.style.opacity = canScroll && !atStart ? '1' : '0';
      rightGradient.style.opacity = canScroll && !atEnd ? '1' : '0';
    };
    menu.addEventListener('scroll', updateGradientVisibility, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(updateGradientVisibility)
      : null;
    resizeObserver?.observe(menu);
    gradientBindings.set(menu, () => {
      menu.removeEventListener('scroll', updateGradientVisibility);
      resizeObserver?.disconnect();
      leftGradient.remove();
      rightGradient.remove();
      menu.style.removeProperty('--bd-mode-menu-background');
    });
    requestAnimationFrame(updateGradientVisibility);
  }

  /** Remove gradient elements from the menu. */
  function removeGradient() {
    for (const removeGradientBinding of gradientBindings.values()) removeGradientBinding();
    gradientBindings.clear();
  }

  /** Guide makes the native list overflow too, so every rendered menu qualifies. */
  function shouldBeActive() {
    return !!(document.querySelector('[data-bd-mode-menu]') || findInputModeMenu());
  }

  function activateMenu(menu) {
    menu = markMenu(menu);
    if (!menu) return null;

    // React replaces this menu rather than updating it in place. Release
    // listeners held for detached versions before binding the current one.
    for (const [boundMenu, removeListeners] of touchBindings.entries()) {
      if (boundMenu.isConnected) continue;
      removeListeners();
      touchBindings.delete(boundMenu);
    }
    for (const [boundMenu, removeListeners] of gradientBindings.entries()) {
      if (boundMenu.isConnected) continue;
      removeListeners();
      gradientBindings.delete(boundMenu);
    }

    injectScrollStyles();
    enableTouchScrolling(menu);
    injectGradient(menu);
    return menu;
  }

  /** Apply or tear down the scrollable treatment with the menu lifecycle. */
  function sync() {
    const active = shouldBeActive();
    if (active) {
      activateMenu(document.querySelector('[data-bd-mode-menu]') || findInputModeMenu());
    } else {
      removeScrollStyles();
      removeGradient();
      disableTouchScrolling();
    }
  }

  // --- Lifecycle ---

  // Re-entrancy guard: prevent the observer from reacting to DOM changes
  // caused by our own gradient injection (which would trigger an infinite loop).
  let injecting = false;

  // 1. MutationObserver: whenever the menu appears/re-renders, sync.
  const observer = new MutationObserver(() => {
    if (injecting) return;
    if (!shouldBeActive()) {
      removeScrollStyles();
      removeGradient();
      disableTouchScrolling();
      return;
    }

    const menu = document.querySelector('[data-bd-mode-menu]') || findInputModeMenu();
    if (menu && (!gradientBindings.has(menu) || !touchBindings.has(menu))) {
      injecting = true;
      activateMenu(menu);
      injecting = false;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 2. Custom mode toggles can resize a menu that is already open.
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'FEATURE_TOGGLE' &&
          (message.featureId === 'command' || message.featureId === 'try')) {
        // Small delay so FeatureManager has time to update its state
        setTimeout(sync, 50);
      }
    });
  }

  // 3. Initial sync (features may already be loaded by now)
  sync();
})();
