// BetterDungeon - DOM Utilities
// Reusable DOM manipulation and element finding utilities

class DOMUtils {
  static wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static findTabByText(text) {
    const allElements = document.querySelectorAll('div[role="tab"], button[role="tab"], div[tabindex="0"], button');
    for (const el of allElements) {
      const elText = el.textContent?.trim();
      if (elText === text || elText?.toLowerCase() === text.toLowerCase()) {
        return el;
      }
    }
    
    const textElements = document.querySelectorAll('p, span');
    for (const el of textElements) {
      if (el.textContent?.trim() === text) {
        const clickable = el.closest('div[role="tab"], button[role="tab"], div[tabindex="0"], button, div[role="button"]');
        if (clickable) return clickable;
      }
    }
    
    return null;
  }

  static async findAndClickTab(tabName) {
    const tab = this.findTabByText(tabName);
    if (tab) {
      const isSelected = tab.getAttribute('aria-selected') === 'true' || 
                         tab.getAttribute('data-state') === 'active' ||
                         tab.classList.contains('active');
      if (!isSelected) {
        console.log(`BetterDungeon: Clicking ${tabName} tab...`);
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
    
    console.log('BetterDungeon: Appending to textarea, current length:', currentValue.length, 'new length:', newValue.length);
    
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
    
    console.log('BetterDungeon: Textarea value after update:', textarea.value.length, 'chars');
  }

  static injectStyles(href, id) {
    if (document.getElementById(id)) return;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    console.log('BetterDungeon: Styles injected');
  }
}

if (typeof window !== 'undefined') {
  window.DOMUtils = DOMUtils;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMUtils;
}
