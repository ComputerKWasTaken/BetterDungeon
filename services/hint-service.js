/**
 * HintService - Manages contextual first-use hints for BetterDungeon features
 * Shows brief tooltips when features are used for the first time
 */

class HintService {
  constructor() {
    this.STORAGE_KEY = 'betterDungeon_hints';
    this.shownHints = new Set();
    this.activeHint = null;
    this.hintContainer = null;
    this.initialized = false;
    
    // Define all available hints
    this.hints = {
      'command-mode': {
        title: 'Command Mode',
        content: 'Your input will be formatted as a story command (## Your Command:). Great for scene changes, time skips, and narrative directions!',
        duration: 6000
      },
      'attempt-mode': {
        title: 'Attempt Mode',
        content: 'Roll the dice! Your action will have a random outcome: critical fail, fail, succeed, or critical success. Use ↑↓ arrows to adjust odds.',
        duration: 7000
      },
      'attempt-result': {
        title: 'Dice Roll Result',
        content: 'The result is based on RNG. You can adjust the critical chance in the BetterDungeon popup settings.',
        duration: 5000
      },
      'character-autofill': {
        title: 'Character Auto-Fill',
        content: 'BetterDungeon detected entry fields! Select a saved character to auto-fill, or save new values as you type.',
        duration: 6000
      },
      'trigger-highlight': {
        title: 'Story Card Trigger',
        content: 'This highlighted word is linked to a Story Card. Hover to see which card it triggers!',
        duration: 5000
      },
      'suggested-trigger': {
        title: 'Suggested Story Card',
        content: 'This name appears frequently but has no Story Card. Consider creating one to give the AI more context!',
        duration: 6000
      },
      'markdown-applied': {
        title: 'Markdown Instructions Applied',
        content: 'The AI now knows how to format text with bold, italic, underline, and more. Check the popup for the full syntax guide.',
        duration: 5000
      },
      'hotkey-used': {
        title: 'Keyboard Shortcut',
        content: 'BetterDungeon adds hotkeys for quick actions. Press keys like T (Turn), C (Continue), R (Retry) when not typing. See all in the popup!',
        duration: 6000
      },
      'hotkeys-available': {
        title: 'Hotkeys Available',
        content: 'BetterDungeon adds keyboard shortcuts! Press T to take a turn, C to continue, R to retry, and more. Works when not typing.',
        duration: 6000
      }
    };
  }

  async init() {
    if (this.initialized) return;
    
    await this.loadState();
    this.createContainer();
    this.injectStyles();
    this.initialized = true;
    
    console.log('[BetterDungeon] HintService initialized');
  }

  async loadState() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(this.STORAGE_KEY, (result) => {
        const state = result[this.STORAGE_KEY] || {};
        this.shownHints = new Set(state.shown || []);
        resolve();
      });
    });
  }

  async saveState() {
    return new Promise((resolve) => {
      chrome.storage.sync.set({
        [this.STORAGE_KEY]: {
          shown: Array.from(this.shownHints)
        }
      }, resolve);
    });
  }

  createContainer() {
    // Remove existing container if present
    const existing = document.getElementById('bd-hint-container');
    if (existing) existing.remove();
    
    this.hintContainer = document.createElement('div');
    this.hintContainer.id = 'bd-hint-container';
    document.body.appendChild(this.hintContainer);
  }

  injectStyles() {
    if (document.getElementById('bd-hint-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'bd-hint-styles';
    styles.textContent = `
      #bd-hint-container {
        position: fixed;
        z-index: 999999;
        pointer-events: none;
      }
      
      .bd-hint {
        position: fixed;
        max-width: 320px;
        background: linear-gradient(135deg, #1a1a1f 0%, #16161a 100%);
        border: 1px solid rgba(255, 149, 0, 0.3);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 149, 0, 0.15);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(10px) scale(0.95);
        transition: opacity 0.3s ease, transform 0.3s ease;
        font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      
      .bd-hint.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      
      .bd-hint.hiding {
        opacity: 0;
        transform: translateY(-10px) scale(0.95);
      }
      
      .bd-hint-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      
      .bd-hint-title {
        font-size: 14px;
        font-weight: 600;
        color: #e8e8ec;
        margin: 0;
        flex: 1;
      }
      
      .bd-hint-badge {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #ff9500;
        background: rgba(255, 149, 0, 0.15);
        padding: 3px 6px;
        border-radius: 4px;
      }
      
      .bd-hint-content {
        font-size: 13px;
        line-height: 1.5;
        color: #a0a0a8;
        margin: 0;
      }
      
      .bd-hint-arrow {
        position: absolute;
        width: 12px;
        height: 12px;
        background: #1a1a1f;
        border: 1px solid rgba(255, 149, 0, 0.3);
        transform: rotate(45deg);
      }
      
      .bd-hint-arrow.top {
        bottom: -7px;
        left: 50%;
        margin-left: -6px;
        border-top: none;
        border-left: none;
      }
      
      .bd-hint-arrow.bottom {
        top: -7px;
        left: 50%;
        margin-left: -6px;
        border-bottom: none;
        border-right: none;
      }
      
      .bd-hint-arrow.left {
        right: -7px;
        top: 50%;
        margin-top: -6px;
        border-bottom: none;
        border-left: none;
      }
      
      .bd-hint-arrow.right {
        left: -7px;
        top: 50%;
        margin-top: -6px;
        border-top: none;
        border-right: none;
      }
    `;
    document.head.appendChild(styles);
  }

  /**
   * Show a hint for a feature if it hasn't been shown before
   * @param {string} hintId - The hint identifier
   * @param {HTMLElement} targetElement - The element to position the hint near
   * @param {string} position - Position relative to target: 'top', 'bottom', 'left', 'right'
   * @param {Object} options - Additional options (force: true to show even if already seen)
   */
  async show(hintId, targetElement, position = 'top', options = {}) {
    // Don't show if already shown (unless forced)
    if (this.shownHints.has(hintId) && !options.force) {
      return false;
    }
    
    // Don't show if there's already an active hint
    if (this.activeHint) {
      return false;
    }
    
    const hintData = this.hints[hintId];
    if (!hintData) {
      console.warn(`[BetterDungeon] Unknown hint: ${hintId}`);
      return false;
    }
    
    // Mark as shown
    this.shownHints.add(hintId);
    await this.saveState();
    
    // Create hint element
    const hint = this.createHintElement(hintId, hintData, position);
    this.hintContainer.appendChild(hint);
    
    // Position the hint
    this.positionHint(hint, targetElement, position);
    
    // Show with animation
    requestAnimationFrame(() => {
      hint.classList.add('visible');
    });
    
    this.activeHint = hint;
    
    // Setup auto-dismiss timer
    this.startDismissTimer(hint, hintData.duration || 5000);
    
    return true;
  }

  createHintElement(hintId, hintData, position) {
    const hint = document.createElement('div');
    hint.className = 'bd-hint';
    hint.dataset.hintId = hintId;
    
    hint.innerHTML = `
      <div class="bd-hint-arrow ${position}"></div>
      <div class="bd-hint-header">
        <h4 class="bd-hint-title">${hintData.title}</h4>
        <span class="bd-hint-badge">Tip</span>
      </div>
      <p class="bd-hint-content">${hintData.content}</p>
    `;
    
    // Click anywhere on hint to dismiss
    hint.addEventListener('click', () => {
      this.dismiss(hint);
    });
    
    return hint;
  }

  positionHint(hint, targetElement, position) {
    if (!targetElement) {
      // Default to bottom-right corner if no target
      hint.style.right = '20px';
      hint.style.bottom = '20px';
      return;
    }
    
    const targetRect = targetElement.getBoundingClientRect();
    const hintRect = hint.getBoundingClientRect();
    const gap = 16;
    const padding = 20;
    
    let left, top;
    
    switch (position) {
      case 'top':
        left = targetRect.left + (targetRect.width / 2) - (hintRect.width / 2);
        top = targetRect.top - hintRect.height - gap;
        break;
      case 'bottom':
        left = targetRect.left + (targetRect.width / 2) - (hintRect.width / 2);
        top = targetRect.bottom + gap;
        break;
      case 'left':
        left = targetRect.left - hintRect.width - gap;
        top = targetRect.top + (targetRect.height / 2) - (hintRect.height / 2);
        break;
      case 'right':
        left = targetRect.right + gap;
        top = targetRect.top + (targetRect.height / 2) - (hintRect.height / 2);
        break;
    }
    
    // Keep within viewport
    left = Math.max(padding, Math.min(left, window.innerWidth - hintRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - hintRect.height - padding));
    
    hint.style.left = `${left}px`;
    hint.style.top = `${top}px`;
  }

  startDismissTimer(hint, duration) {
    setTimeout(() => {
      if (this.activeHint === hint) {
        this.dismiss(hint);
      }
    }, duration);
  }

  dismiss(hint) {
    if (!hint) return;
    
    hint.classList.add('hiding');
    hint.classList.remove('visible');
    
    setTimeout(() => {
      hint.remove();
      if (this.activeHint === hint) {
        this.activeHint = null;
      }
    }, 300);
  }

  /**
   * Check if a hint has been shown before
   * @param {string} hintId - The hint identifier
   * @returns {boolean}
   */
  hasBeenShown(hintId) {
    return this.shownHints.has(hintId);
  }

  /**
   * Reset all hints (for testing or user preference)
   */
  async resetAll() {
    this.shownHints.clear();
    await this.saveState();
  }

  /**
   * Reset a specific hint
   * @param {string} hintId - The hint identifier
   */
  async resetHint(hintId) {
    this.shownHints.delete(hintId);
    await this.saveState();
  }
}

// Create singleton instance
window.BetterDungeonHints = new HintService();
