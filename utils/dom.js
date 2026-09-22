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
}

if (typeof window !== 'undefined') {
  window.DOMUtils = DOMUtils;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMUtils;
}
