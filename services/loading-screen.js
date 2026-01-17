// BetterDungeon - Loading Screen Service
// A reusable, visually appealing loading screen for async operations

class LoadingScreen {
  constructor() {
    this.overlay = null;
    this.progressBar = null;
    this.statusText = null;
    this.subStatusText = null;
    this.currentProgress = 0;
    this.isVisible = false;
    this.iconUrl = chrome.runtime.getURL('icons/icon128.png');
    this.queue = [];
    this.isProcessingQueue = false;
  }

  // Queue an async operation to run with loading screen
  async queueOperation(operationFn, options = {}) {
    return new Promise((resolve) => {
      this.queue.push({ operationFn, options, resolve });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const { operationFn, options, resolve } = this.queue.shift();
      
      try {
        const result = await operationFn();
        resolve(result);
      } catch (error) {
        console.error('LoadingScreen: Queued operation error:', error);
        resolve({ success: false, error: error.message });
      }

      // Small delay between operations
      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    this.isProcessingQueue = false;
  }

  show(options = {}) {
    const {
      title = 'Loading...',
      subtitle = '',
      showProgress = true,
      showCancel = false,
      onCancel = null,
      icon = null // custom icon URL, defaults to BetterDungeon icon
    } = options;

    if (this.isVisible) {
      this.updateTitle(title);
      this.updateSubtitle(subtitle);
      return;
    }

    this.onCancel = onCancel;
    this.createOverlay(title, subtitle, showProgress, showCancel, icon);
    this.isVisible = true;
    
    // Animate in
    requestAnimationFrame(() => {
      if (this.overlay) {
        this.overlay.classList.add('bd-loading-visible');
      }
    });
  }

  createOverlay(title, subtitle, showProgress, showCancel, customIcon) {
    // Remove existing if any
    this.hide();

    const iconSrc = customIcon || this.iconUrl;

    this.overlay = document.createElement('div');
    this.overlay.className = 'bd-loading-overlay';
    this.overlay.innerHTML = `
      <div class="bd-loading-container">
        <div class="bd-loading-icon">
          <img src="${iconSrc}" class="bd-loading-icon-img" alt="Loading">
        </div>
        <h2 class="bd-loading-title">${this.escapeHtml(title)}</h2>
        <p class="bd-loading-subtitle">${this.escapeHtml(subtitle)}</p>
        ${showProgress ? `
          <div class="bd-loading-progress-container">
            <div class="bd-loading-progress-bar"></div>
          </div>
          <p class="bd-loading-status"></p>
        ` : ''}
        ${showCancel ? `
          <button class="bd-loading-cancel-btn">Cancel</button>
        ` : ''}
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Cache references
    this.progressBar = this.overlay.querySelector('.bd-loading-progress-bar');
    this.statusText = this.overlay.querySelector('.bd-loading-status');
    this.subStatusText = this.overlay.querySelector('.bd-loading-subtitle');
    this.titleText = this.overlay.querySelector('.bd-loading-title');

    // Setup cancel button if present
    const cancelBtn = this.overlay.querySelector('.bd-loading-cancel-btn');
    if (cancelBtn && this.onCancel) {
      cancelBtn.addEventListener('click', () => {
        this.onCancel();
        this.hide();
      });
    }
  }

  updateTitle(title) {
    if (this.titleText) {
      this.titleText.textContent = title;
    }
  }

  updateSubtitle(subtitle) {
    if (this.subStatusText) {
      this.subStatusText.textContent = subtitle;
    }
  }

  updateProgress(current, total, statusMessage = '') {
    const percent = total > 0 ? (current / total) * 100 : 0;
    this.currentProgress = percent;

    if (this.progressBar) {
      this.progressBar.style.width = `${percent}%`;
    }

    if (this.statusText && statusMessage) {
      this.statusText.textContent = statusMessage;
    } else if (this.statusText) {
      this.statusText.textContent = `${current} / ${total}`;
    }
  }

  updateStatus(message, type = 'default') {
    if (this.statusText) {
      // Add status type class for styling
      this.statusText.className = 'bd-loading-status';
      if (type === 'success') {
        this.statusText.classList.add('bd-status-success');
      } else if (type === 'error') {
        this.statusText.classList.add('bd-status-error');
      }
      this.statusText.textContent = message;
    }
  }

  async hide(delay = 300) {
    if (!this.isVisible || !this.overlay) return;

    // Animate out
    this.overlay.classList.remove('bd-loading-visible');
    this.overlay.classList.add('bd-loading-hiding');

    await new Promise(resolve => setTimeout(resolve, delay));

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    this.overlay = null;
    this.progressBar = null;
    this.statusText = null;
    this.subStatusText = null;
    this.titleText = null;
    this.isVisible = false;
    this.currentProgress = 0;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Singleton instance for global use
const loadingScreen = new LoadingScreen();

// Make available globally
if (typeof window !== 'undefined') {
  window.LoadingScreen = LoadingScreen;
  window.loadingScreen = loadingScreen;
}
