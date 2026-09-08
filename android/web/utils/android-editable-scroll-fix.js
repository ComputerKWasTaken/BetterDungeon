/*
 * Android WebView asks Blink to scroll the focused editable (and every
 * scrollable DOM ancestor) whenever the IME opens or reports a caret update.
 * AI Dungeon uses fixed html/body elements and nested React scrollers, so the
 * native View.requestRectangleOnScreen() filter cannot intercept that DOM
 * scroll.
 *
 * Preserve the scroll position that existed immediately before an editing
 * action. The guard runs before paint and is released as soon as the pointer
 * becomes a drag, so normal one-finger scrolling is unaffected.
 */
(function installBetterDungeonCaretScrollGuard() {
  'use strict';

  if (window.__betterDungeonCaretScrollGuardInstalled) return;
  window.__betterDungeonCaretScrollGuardInstalled = true;

  const STORAGE_KEY = 'betterDungeon_androidCaretScrollFix';
  const EDITABLE_SELECTOR = [
    'textarea',
    'input:not([type="button"]):not([type="checkbox"]):not([type="color"])' +
      ':not([type="file"]):not([type="hidden"]):not([type="image"])' +
      ':not([type="radio"]):not([type="range"]):not([type="reset"])' +
      ':not([type="submit"])',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="textbox"]'
  ].join(',');
  const DRAG_THRESHOLD_PX = 10;
  const TAP_GUARD_MS = 1200;
  const EDIT_GUARD_MS = 300;

  let enabled = false;
  let guard = null;
  let guardGeneration = 0;
  let pointer = null;
  let restoring = false;

  try {
    if (
      window.BetterDungeonBridge &&
      typeof window.BetterDungeonBridge.storageGet === 'function'
    ) {
      const stored = window.BetterDungeonBridge.storageGet(STORAGE_KEY);
      enabled = stored !== '' && JSON.parse(stored) === true;
    } else {
      // This workaround is Android-only. Keep it inert if the shared popup is
      // opened as a regular browser extension without the native bridge.
      enabled = false;
    }
  } catch {
    enabled = false;
  }

  function applyEnabledClass() {
    document.documentElement?.classList.toggle(
      'bd-caret-scroll-fix-disabled',
      !enabled
    );
  }

  function parentAcrossShadowRoot(element) {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode && element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function editableFromEvent(event) {
    const path = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [event.target];

    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node.matches(EDITABLE_SELECTOR)) return node;
      const editable = node.closest(EDITABLE_SELECTOR);
      if (editable) return editable;
    }
    return null;
  }

  function activeEditable() {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof Element && active.matches(EDITABLE_SELECTOR)
      ? active
      : null;
  }

  function isScrollable(element) {
    const style = getComputedStyle(element);
    const scrollableOverflow = /(auto|scroll|overlay|hidden)/;
    return (
      element.scrollHeight > element.clientHeight + 1 &&
      scrollableOverflow.test(style.overflowY)
    ) || (
      element.scrollWidth > element.clientWidth + 1 &&
      scrollableOverflow.test(style.overflowX)
    );
  }

  function captureScrollChain(editor) {
    const states = [];
    const viewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;

    // A very tall editor may itself be scrollable. Preserve it only when it
    // occupies most of the viewport; small textareas still follow their caret.
    if (isScrollable(editor) && editor.clientHeight >= viewportHeight * 0.75) {
      states.push({
        element: editor,
        left: editor.scrollLeft,
        top: editor.scrollTop
      });
    }

    for (let element = parentAcrossShadowRoot(editor);
      element;
      element = parentAcrossShadowRoot(element)) {
      if (
        element !== document.body &&
        element !== document.documentElement &&
        isScrollable(element)
      ) {
        states.push({
          element,
          left: element.scrollLeft,
          top: element.scrollTop
        });
      }
    }

    const root = document.scrollingElement;
    if (root) {
      states.push({
        element: root,
        left: root.scrollLeft,
        top: root.scrollTop
      });
    }
    return states;
  }

  function restoreScrollChain() {
    if (
      !enabled ||
      restoring ||
      !guard ||
      performance.now() > guard.expiresAt ||
      (pointer && pointer.dragging)
    ) {
      return;
    }

    restoring = true;
    try {
      let changed = false;
      for (const state of guard.states) {
        if (!state.element.isConnected) continue;
        if (Math.abs(state.element.scrollLeft - state.left) > 0.5) {
          state.element.scrollLeft = state.left;
          changed = true;
        }
        if (Math.abs(state.element.scrollTop - state.top) > 0.5) {
          state.element.scrollTop = state.top;
          changed = true;
        }
      }
      if (changed && !guard.reported) {
        guard.reported = true;
        console.debug('[BetterDungeon] Suppressed Android caret-follow scroll');
      }
    } finally {
      restoring = false;
    }
  }

  function keepStable(generation) {
    if (
      !enabled ||
      !guard ||
      generation !== guardGeneration ||
      performance.now() > guard.expiresAt ||
      (pointer && pointer.dragging)
    ) {
      if (generation === guardGeneration) guard = null;
      return;
    }

    restoreScrollChain();
    requestAnimationFrame(() => keepStable(generation));
  }

  function armGuard(editor, duration, refreshSnapshot) {
    if (!enabled || !editor) return;

    if (!guard || guard.editor !== editor || refreshSnapshot) {
      guard = {
        editor,
        states: captureScrollChain(editor),
        expiresAt: performance.now() + duration,
        reported: false
      };
      guardGeneration += 1;
      const generation = guardGeneration;
      requestAnimationFrame(() => keepStable(generation));
    } else {
      guard.expiresAt = Math.max(
        guard.expiresAt,
        performance.now() + duration
      );
    }
  }

  function cancelGuard() {
    guard = null;
    guardGeneration += 1;
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    if (!enabled) {
      pointer = null;
      cancelGuard();
    }
    applyEnabledClass();
    return enabled;
  }

  window.BetterDungeonCaretScrollFix = Object.freeze({
    isEnabled: () => enabled,
    setEnabled
  });

  applyEnabledClass();
  document.addEventListener('DOMContentLoaded', applyEnabledClass, {
    once: true
  });

  document.addEventListener('pointerdown', event => {
    if (!enabled) return;
    const editor = editableFromEvent(event);
    if (!editor) return;

    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false
    };
    armGuard(editor, TAP_GUARD_MS, true);
  }, true);

  document.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id || pointer.dragging) return;

    if (
      Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >=
      DRAG_THRESHOLD_PX
    ) {
      pointer.dragging = true;
      cancelGuard();
    }
  }, true);

  function finishPointer(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const wasDragging = pointer.dragging;
    pointer = null;

    if (!wasDragging) {
      armGuard(activeEditable(), TAP_GUARD_MS, false);
    }
  }

  document.addEventListener('pointerup', finishPointer, true);
  document.addEventListener('pointercancel', finishPointer, true);

  document.addEventListener('focusin', event => {
    const editor = editableFromEvent(event);
    const keepPointerSnapshot = !!pointer && !pointer.dragging;
    armGuard(editor, TAP_GUARD_MS, !keepPointerSnapshot);
  }, true);

  document.addEventListener('keydown', () => {
    armGuard(activeEditable(), EDIT_GUARD_MS, !guard);
  }, true);

  document.addEventListener('beforeinput', () => {
    armGuard(activeEditable(), EDIT_GUARD_MS, !guard);
  }, true);

  document.addEventListener('input', () => {
    armGuard(activeEditable(), EDIT_GUARD_MS, false);
  }, true);

  document.addEventListener('compositionupdate', () => {
    armGuard(activeEditable(), EDIT_GUARD_MS, false);
  }, true);

  document.addEventListener('selectionchange', () => {
    armGuard(activeEditable(), EDIT_GUARD_MS, !guard);
  }, true);

  // Scroll events fire before the next frame is painted. Restoring here avoids
  // the visible "down then back up" jitter of a timeout-based workaround.
  document.addEventListener('scroll', restoreScrollChain, true);
  window.addEventListener('scroll', restoreScrollChain, true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('scroll', restoreScrollChain);
    window.visualViewport.addEventListener('resize', restoreScrollChain);
  }
})();
