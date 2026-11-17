// BetterDungeon - DOM Utilities
// Reusable DOM manipulation and element finding utilities

class DOMUtils {
  static debug = false;

  static log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  static wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static findTabByText(text) {
    const allElements = document.querySelectorAll('div[role="tab"], button[role="tab"], div[tabindex="0"], button');
    for (const el of allElements) {
      const elText = el.textContent?.trim();
      if (elText === text || elText?.toLowerCase() === text.toLowerCase()) {
        this.log('[DOMUtils] found tab by text:', text);
        return el;
      }
    }
    
    const textElements = document.querySelectorAll('p, span');
    for (const el of textElements) {
      if (el.textContent?.trim() === text) {
        const clickable = el.closest('div[role="tab"], button[role="tab"], div[tabindex="0"], button, div[role="button"]');
        if (clickable) {
          this.log('[DOMUtils] found tab by inner text:', text);
          return clickable;
        }
      }
    }
    
    this.log('[DOMUtils] tab not found:', text);
    return null;
  }

  static async findAndClickTab(tabName) {
    const tab = this.findTabByText(tabName);
    if (tab) {
      const isSelected = tab.getAttribute('aria-selected') === 'true' || 
                         tab.getAttribute('data-state') === 'active' ||
                         tab.classList.contains('active');
      if (!isSelected) {
        tab.click();
        await this.wait(200);
        return true;
      }
    }
    return false;
  }

  static findTextareaByLabel(labelText) {
    const byAriaLabel = document.querySelector(`textarea[aria-label*="${labelText}" i]`);
    if (byAriaLabel) return byAriaLabel;

    const byPlaceholder = document.querySelector(`textarea[placeholder*="${labelText}" i]`);
    if (byPlaceholder) return byPlaceholder;

    const labels = document.querySelectorAll('label, span, p, div');
    for (const label of labels) {
      if (label.textContent.toLowerCase().includes(labelText.toLowerCase())) {
        const container = label.closest('div');
        if (container) {
          const textarea = container.querySelector('textarea');
          if (textarea) return textarea;
          
          let sibling = label.nextElementSibling;
          while (sibling) {
            if (sibling.tagName === 'TEXTAREA') return sibling;
            const nestedTextarea = sibling.querySelector('textarea');
            if (nestedTextarea) return nestedTextarea;
            sibling = sibling.nextElementSibling;
          }
        }
      }
    }

    return null;
  }

  static appendToTextarea(textarea, text) {
    const currentValue = textarea.value || '';
    const separator = currentValue.trim() ? '\n\n' : '';
    const newValue = currentValue + separator + text;
    
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(textarea, newValue);
    
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    });
    textarea.dispatchEvent(inputEvent);
  }

  static injectStyles(href, id) {
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  static makeDraggableButton(button, storageKey) {
    let position;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) position = saved;
    } catch {
      // Use the default placement when storage is blocked or corrupt.
    }

    const update = () => {
      if (!position || !button.getClientRects().length) return null;
      button.classList.add('bd-button-positioned');
      const viewport = document.compatMode === 'BackCompat' ? document.body : document.documentElement;
      const inset = 8;
      const maxX = Math.max(inset, viewport.clientWidth - button.offsetWidth - inset);
      const maxY = Math.max(inset, viewport.clientHeight - button.offsetHeight - inset);
      const x = Math.max(inset, Math.min(position.x, maxX));
      const y = Math.max(inset, Math.min(position.y, maxY));
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      return { x, y };
    };

    let suppressClick = false;
    let gesture = null;
    const lifetime = new AbortController();
    const options = { signal: lifetime.signal };
    button.classList.add('bd-draggable-button');
    button.addEventListener('dragstart', event => event.preventDefault(), options);
    button.addEventListener('click', event => {
      if (suppressClick && event.detail > 0) {
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { ...options, capture: true });

    button.addEventListener('pointerdown', event => {
      if (gesture || !event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      const { pointerId, clientX: startX, clientY: startY } = event;
      const { left, top } = button.getBoundingClientRect();
      gesture = new AbortController();
      const tracking = { signal: gesture.signal, capture: true };
      let moved = false;

      const move = event => {
        if (event.pointerId !== pointerId) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!moved) {
          if (Math.hypot(dx, dy) < 6) return;
          moved = true;
          button.classList.add('bd-button-dragging');
          button.setPointerCapture(pointerId);
        }
        position = { x: left + dx, y: top + dy };
        update();
        event.preventDefault();
        event.stopPropagation();
      };

      const finish = () => {
        gesture.abort();
        gesture = null;
        if (!moved) return;
        button.classList.remove('bd-button-dragging');
        suppressClick = true;
        position = update() || position;
        try {
          localStorage.setItem(storageKey, JSON.stringify(position));
        } catch {
          // The button still keeps its position while mounted.
        }
      };

      const endPointer = event => {
        if (event.pointerId === pointerId) finish();
      };
      window.addEventListener('pointermove', move, tracking);
      window.addEventListener('pointerup', endPointer, tracking);
      window.addEventListener('pointercancel', endPointer, tracking);
      button.addEventListener('lostpointercapture', event => {
        if (event.target === button) endPointer(event);
      }, tracking);
      // Moving focus between page controls is a normal part of mouse down.
      window.addEventListener('blur', finish, { signal: gesture.signal });
      event.stopPropagation();
    }, options);

    update();
    return {
      update,
      destroy() {
        gesture?.abort();
        lifetime.abort();
      },
    };
  }
}

if (typeof window !== 'undefined') {
  window.DOMUtils = DOMUtils;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMUtils;
}
