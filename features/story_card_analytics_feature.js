// BetterDungeon - Story Card Analytics Feature
// Provides analytics dashboard for scenario creators to analyze their story cards

class StoryCardAnalyticsFeature {
  static id = 'storyCardAnalytics';

  constructor() {
    // Dashboard state
    this.dashboardElement = null;
    this.isOpen = false;
    
    // Cached analytics data
    this.lastAnalytics = null;
    this.lastScanTime = null;
    
    // Settings
    this.autoRefresh = false;
    this.debug = false;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(message, ...args);
    }
  }

  // ==================== LIFECYCLE ====================

  async init() {
    console.log('[StoryCardAnalytics] Initializing Story Card Analytics feature...');
    this.injectStyles();
  }

  destroy() {
    this.closeDashboard();
    this.removeStyles();
  }

  // ==================== DASHBOARD UI ====================

  // Open the analytics dashboard
  async openDashboard() {
    if (this.isOpen) {
      this.closeDashboard();
      return;
    }

    // Check if scanner is available
    if (typeof storyCardScanner === 'undefined') {
      console.error('StoryCardAnalyticsFeature: Scanner not available');
      return;
    }

    this.isOpen = true;
    this.createDashboardElement();
    
    // Show loading state
    this.updateDashboardContent(this.renderLoadingState());
    
    // Check if we have existing data
    const cardDatabase = storyCardScanner.getCardDatabase();
    if (cardDatabase.size > 0) {
      this.lastAnalytics = storyCardScanner.getAnalytics();
      this.lastScanTime = new Date();
      this.updateDashboardContent(this.renderAnalytics(this.lastAnalytics));
    } else {
      this.updateDashboardContent(this.renderEmptyState());
    }
  }

  closeDashboard() {
    if (this.dashboardElement) {
      this.dashboardElement.remove();
      this.dashboardElement = null;
    }
    this.isOpen = false;
  }

  createDashboardElement() {
    this.dashboardElement = document.createElement('div');
    this.dashboardElement.className = 'bd-analytics-dashboard';
    this.dashboardElement.innerHTML = `
      <div class="bd-analytics-overlay"></div>
      <div class="bd-analytics-modal">
        <div class="bd-analytics-header">
          <h2>Story Card Analytics</h2>
          <div class="bd-analytics-header-actions">
            <button class="bd-analytics-scan-btn" title="Scan Story Cards">
              <span class="icon-scan"></span> Scan Cards
            </button>
            <button class="bd-analytics-close-btn" title="Close"><span class="icon-x"></span></button>
          </div>
        </div>
        <div class="bd-analytics-content">
          <!-- Content injected here -->
        </div>
      </div>
    `;

    // Add event listeners
    this.dashboardElement.querySelector('.bd-analytics-overlay').addEventListener('click', () => this.closeDashboard());
    this.dashboardElement.querySelector('.bd-analytics-close-btn').addEventListener('click', () => this.closeDashboard());
    this.dashboardElement.querySelector('.bd-analytics-scan-btn').addEventListener('click', () => this.runScan());

    document.body.appendChild(this.dashboardElement);
  }

  updateDashboardContent(html) {
    if (!this.dashboardElement) return;
    const content = this.dashboardElement.querySelector('.bd-analytics-content');
    if (content) {
      content.innerHTML = html;
      this.attachContentListeners();
    }
  }

  attachContentListeners() {
    // Attach click listeners for expandable sections
    this.dashboardElement?.querySelectorAll('.bd-analytics-expandable').forEach(el => {
      el.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const content = target.nextElementSibling;
        if (content && content.classList.contains('bd-analytics-expand-content')) {
          content.classList.toggle('expanded');
          target.classList.toggle('expanded');
        }
      });
    });

    // Attach click listeners for card names (could jump to card in future)
    this.dashboardElement?.querySelectorAll('.bd-card-link').forEach(el => {
      el.addEventListener('click', (e) => {
        const cardName = e.currentTarget.dataset.cardName;
        this.log('Card clicked:', cardName);
        // Future: Jump to card editor
      });
    });
  }

  // ==================== RENDER METHODS ====================

  renderLoadingState() {
    return `
      <div class="bd-analytics-loading">
        <div class="bd-analytics-spinner"></div>
        <p>Loading analytics...</p>
      </div>
    `;
  }

  renderEmptyState() {
    return `
      <div class="bd-analytics-empty">
        <div class="bd-analytics-empty-icon"><span class="icon-chart-column"></span></div>
        <h3>No Story Card Data</h3>
        <p>Click "Scan Cards" to analyze your story cards.</p>
        <p class="bd-analytics-hint">The scan will open each card briefly to extract its data.</p>
      </div>
    `;
  }

  renderAnalytics(analytics) {
    const { totalCards, byType, withTriggers, withoutTriggers, withDescription, withoutDescription, 
            averageTriggerCount, triggerOverlaps, emptyCards,
            cardsWithDoubleLinebreaks, longCards, veryLongCards, characterNameIssues } = analytics;

    // Calculate percentages
    const triggerPercent = totalCards > 0 ? Math.round((withTriggers / totalCards) * 100) : 0;
    const descPercent = totalCards > 0 ? Math.round((withDescription / totalCards) * 100) : 0;

    // Build type breakdown HTML
    const typeBreakdownHtml = Object.entries(byType)
      .filter(([type, count]) => count > 0)
      .map(([type, count]) => `
        <div class="bd-type-item">
          <span class="bd-type-icon">${this.getTypeIcon(type)}</span>
          <span class="bd-type-name">${this.capitalize(type)}</span>
          <span class="bd-type-count">${count}</span>
        </div>
      `).join('');

    // Build trigger overlaps HTML
    const overlapsHtml = triggerOverlaps.length > 0 
      ? triggerOverlaps.slice(0, 10).map(overlap => `
          <div class="bd-overlap-item">
            <span class="bd-overlap-trigger">"${overlap.trigger}"</span>
            <span class="bd-overlap-cards">${overlap.cards.map(c => `<span class="bd-card-link" data-card-name="${c}">${c}</span>`).join(', ')}</span>
          </div>
        `).join('')
      : '<p class="bd-analytics-none">No overlapping triggers found</p>';

    // Build empty cards HTML
    const emptyCardsHtml = emptyCards.length > 0
      ? emptyCards.map(name => `<span class="bd-card-link bd-empty-card" data-card-name="${name}">${name}</span>`).join(', ')
      : '<p class="bd-analytics-none">All cards have content</p>';

    // Build content quality data (merged section)
    const allLongCards = [...(veryLongCards || []), ...(longCards || [])].sort((a, b) => b.length - a.length);
    const totalQualityIssues = (cardsWithDoubleLinebreaks?.length || 0) + allLongCards.length + (characterNameIssues?.length || 0);
    const hasQualityIssues = totalQualityIssues > 0;

    // Build issues/warnings
    const issues = this.generateIssues(analytics);
    const issuesHtml = issues.length > 0
      ? issues.map(issue => `
          <div class="bd-issue-item bd-issue-${issue.severity}">
            <span class="bd-issue-icon">${issue.icon}</span>
            <span class="bd-issue-text">${issue.message}</span>
          </div>
        `).join('')
      : '<p class="bd-analytics-none">No issues detected</p>';

    return `
      <div class="bd-analytics-grid">
        <!-- Summary Stats -->
        <div class="bd-analytics-section bd-analytics-summary">
          <h3>Summary</h3>
          <div class="bd-stats-grid">
            <div class="bd-stat-card">
              <div class="bd-stat-value">${totalCards}</div>
              <div class="bd-stat-label">Total Cards</div>
            </div>
            <div class="bd-stat-card">
              <div class="bd-stat-value">${averageTriggerCount}</div>
              <div class="bd-stat-label">Avg Triggers/Card</div>
            </div>
            <div class="bd-stat-card">
              <div class="bd-stat-value">${triggerOverlaps.length}</div>
              <div class="bd-stat-label">Trigger Overlaps</div>
            </div>
            <div class="bd-stat-card">
              <div class="bd-stat-value">${emptyCards.length}</div>
              <div class="bd-stat-label">Empty Cards</div>
            </div>
          </div>
        </div>

        <!-- Type Breakdown -->
        <div class="bd-analytics-section">
          <h3>Cards by Type</h3>
          <div class="bd-type-breakdown">
            ${typeBreakdownHtml || '<p class="bd-analytics-none">No cards found</p>'}
          </div>
        </div>

        <!-- Coverage Stats -->
        <div class="bd-analytics-section">
          <h3>Coverage</h3>
          <div class="bd-coverage-bars">
            <div class="bd-coverage-item">
              <div class="bd-coverage-label">
                <span>With Triggers</span>
                <span>${withTriggers}/${totalCards} (${triggerPercent}%)</span>
              </div>
              <div class="bd-coverage-bar">
                <div class="bd-coverage-fill bd-fill-triggers" style="width: ${triggerPercent}%"></div>
              </div>
            </div>
            <div class="bd-coverage-item">
              <div class="bd-coverage-label">
                <span>With Description</span>
                <span>${withDescription}/${totalCards} (${descPercent}%)</span>
              </div>
              <div class="bd-coverage-bar">
                <div class="bd-coverage-fill bd-fill-desc" style="width: ${descPercent}%"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Issues & Warnings -->
        <div class="bd-analytics-section bd-analytics-issues">
          <h3>Issues & Suggestions</h3>
          <div class="bd-issues-list">
            ${issuesHtml}
          </div>
        </div>

        <!-- Trigger Overlaps (Expandable) -->
        <div class="bd-analytics-section">
          <div class="bd-analytics-expandable ${triggerOverlaps.length > 0 ? '' : 'disabled'}">
            <h3>Trigger Overlaps</h3>
            <span class="bd-expand-icon icon-chevron-down"></span>
          </div>
          <div class="bd-analytics-expand-content">
            <p class="bd-analytics-hint">Multiple cards sharing the same trigger may cause unexpected behavior.</p>
            ${overlapsHtml}
          </div>
        </div>

        <!-- Empty Cards (Expandable) -->
        <div class="bd-analytics-section">
          <div class="bd-analytics-expandable ${emptyCards.length > 0 ? '' : 'disabled'}">
            <h3>Empty Cards (${emptyCards.length})</h3>
            <span class="bd-expand-icon icon-chevron-down"></span>
          </div>
          <div class="bd-analytics-expand-content">
            <p class="bd-analytics-hint">Cards without triggers or descriptions won't be useful in gameplay.</p>
            <div class="bd-empty-cards-list">
              ${emptyCardsHtml}
            </div>
          </div>
        </div>

        <!-- Content Quality (Merged Section) -->
        <div class="bd-analytics-section">
          <div class="bd-analytics-expandable ${hasQualityIssues ? '' : 'disabled'}">
            <h3>Content Quality (${totalQualityIssues})</h3>
            <span class="bd-expand-icon icon-chevron-down"></span>
          </div>
          <div class="bd-analytics-expand-content">
            ${hasQualityIssues ? `
              <!-- Double Linebreaks -->
              ${cardsWithDoubleLinebreaks && cardsWithDoubleLinebreaks.length > 0 ? `
                <div class="bd-quality-subsection">
                  <h4><span class="icon-pilcrow"></span> Double Linebreaks (${cardsWithDoubleLinebreaks.length})</h4>
                  <p class="bd-analytics-hint">Blank lines inside entries can confuse the AI into thinking it's a separate card.</p>
                  <div class="bd-issue-cards-list">
                    ${cardsWithDoubleLinebreaks.map(item => `
                      <div class="bd-issue-card-item">
                        <span class="bd-card-link" data-card-name="${item.name}">${item.name}</span>
                        <span class="bd-issue-detail">${item.count} blank line${item.count > 1 ? 's' : ''}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <!-- Long Entries -->
              ${allLongCards.length > 0 ? `
                <div class="bd-quality-subsection">
                  <h4><span class="icon-text"></span> Long Entries (${allLongCards.length})</h4>
                  <p class="bd-analytics-hint">Information near the beginning holds more weight. Consider front-loading important details.</p>
                  <div class="bd-issue-cards-list">
                    ${allLongCards.map(item => `
                      <div class="bd-issue-card-item ${item.length > 1500 ? 'bd-very-long' : ''}">
                        <span class="bd-card-link" data-card-name="${item.name}">${item.name}</span>
                        <span class="bd-issue-detail">${item.length.toLocaleString()} chars</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}

              <!-- Character Name Frequency -->
              ${characterNameIssues && characterNameIssues.length > 0 ? `
                <div class="bd-quality-subsection">
                  <h4><span class="icon-user"></span> Character Name Frequency (${characterNameIssues.length})</h4>
                  <p class="bd-analytics-hint">Mentioning the character's name multiple times improves AI recognition.</p>
                  <div class="bd-issue-cards-list">
                    ${characterNameIssues.map(item => `
                      <div class="bd-issue-card-item">
                        <span class="bd-card-link" data-card-name="${item.name}">${item.name}</span>
                        <span class="bd-issue-detail">${item.occurrences === 0 ? 'never mentioned' : `only ${item.occurrences}×`}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            ` : '<p class="bd-analytics-none">No content quality issues found</p>'}
          </div>
        </div>
      </div>

      <div class="bd-analytics-footer">
        <span class="bd-scan-time">Last scanned: ${this.lastScanTime ? this.formatTime(this.lastScanTime) : 'Never'}</span>
      </div>
    `;
  }

  // Generate issues/warnings based on analytics
  generateIssues(analytics) {
    const issues = [];
    const { totalCards, withTriggers, withDescription, triggerOverlaps, emptyCards,
            cardsWithDoubleLinebreaks, longCards, veryLongCards, characterNameIssues } = analytics;

    // Check for cards without triggers
    const noTriggerCount = totalCards - withTriggers;
    if (noTriggerCount > 0 && noTriggerCount > totalCards * 0.2) {
      issues.push({
        severity: 'warning',
        icon: '<span class="icon-triangle-alert"></span>',
        message: `${noTriggerCount} cards (${Math.round(noTriggerCount/totalCards*100)}%) have no triggers`
      });
    }

    // Check for cards without descriptions
    const noDescCount = totalCards - withDescription;
    if (noDescCount > 0 && noDescCount > totalCards * 0.3) {
      issues.push({
        severity: 'info',
        icon: '<span class="icon-info"></span>',
        message: `${noDescCount} cards have no description or entry text`
      });
    }

    // Check for significant trigger overlaps
    const significantOverlaps = triggerOverlaps.filter(o => o.count >= 3);
    if (significantOverlaps.length > 0) {
      issues.push({
        severity: 'warning',
        icon: '<span class="icon-triangle-alert"></span>',
        message: `${significantOverlaps.length} triggers are shared by 3+ cards`
      });
    }

    // Check for empty cards
    if (emptyCards.length > 0) {
      issues.push({
        severity: 'error',
        icon: '<span class="icon-circle-x"></span>',
        message: `${emptyCards.length} cards are completely empty`
      });
    }

    // Check for content quality issues (consolidated)
    const qualityIssueCount = (cardsWithDoubleLinebreaks?.length || 0) + 
                              (veryLongCards?.length || 0) + 
                              (characterNameIssues?.length || 0);
    
    if (qualityIssueCount > 0) {
      // Determine severity based on most critical issue
      const hasDoubleLinebreaks = cardsWithDoubleLinebreaks && cardsWithDoubleLinebreaks.length > 0;
      const hasNameIssues = characterNameIssues && characterNameIssues.some(c => c.occurrences === 0);
      const severity = (hasDoubleLinebreaks || hasNameIssues) ? 'warning' : 'info';
      
      issues.push({
        severity,
        icon: '<span class="icon-file-warning"></span>',
        message: `${qualityIssueCount} content quality issue${qualityIssueCount > 1 ? 's' : ''} found`
      });
    }

    // Good news if everything looks fine
    if (issues.length === 0 && totalCards > 0) {
      issues.push({
        severity: 'success',
        icon: '<span class="icon-circle-check"></span>',
        message: 'Your story cards look well-configured!'
      });
    }

    return issues;
  }

  // ==================== SCANNING ====================

  async runScan() {
    if (typeof storyCardScanner === 'undefined' || typeof loadingScreen === 'undefined') {
      console.error('StoryCardAnalyticsFeature: Required services not available');
      return;
    }

    // Close dashboard temporarily
    const wasOpen = this.isOpen;
    this.closeDashboard();

    // Use the loading screen queue to ensure sequential execution (same as trigger highlight)
    await loadingScreen.queueOperation(() => this._doScanStoryCards());

    // Reopen dashboard with new data
    if (wasOpen) {
      this.lastAnalytics = storyCardScanner.getAnalytics();
      this.lastScanTime = new Date();
      await this.openDashboard();
    }
  }

  // Internal scan method - mirrors TriggerHighlightFeature._doScanStoryCards()
  async _doScanStoryCards() {
    // Show loading screen with cancel button
    loadingScreen.show({
      title: 'Scanning Story Cards',
      subtitle: 'Initializing...',
      showProgress: true,
      showCancel: true,
      onCancel: () => storyCardScanner.abort()
    });

    try {
      // Navigate to Story Cards tab using AIDungeonService
      if (typeof AIDungeonService !== 'undefined') {
        const service = new AIDungeonService();
        const navResult = await service.navigateToStoryCardsSettings({
          onStepUpdate: (message) => loadingScreen.updateSubtitle(message)
        });
        
        if (!navResult.success) {
          throw new Error(navResult.error || 'Failed to navigate to Story Cards');
        }
        
        // Wait for Story Cards content to load
        loadingScreen.updateSubtitle('Loading story cards...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      loadingScreen.updateSubtitle('Starting scan...');
      
      const result = await storyCardScanner.scanAllCards(
        // onTriggerFound callback - not needed for analytics but keeping for card database population
        null,
        // onProgress callback
        (current, total, status, estimatedTimeRemaining) => {
          let progressText = status;
          if (estimatedTimeRemaining !== null && estimatedTimeRemaining > 0) {
            const minutes = Math.floor(estimatedTimeRemaining / 60);
            const seconds = estimatedTimeRemaining % 60;
            if (minutes > 0) {
              progressText += ` (${minutes}m ${seconds}s remaining)`;
            } else {
              progressText += ` (${seconds}s remaining)`;
            }
          }
          loadingScreen.updateSubtitle(`Scanning card ${current} of ${total}`);
          loadingScreen.updateProgress(current, total, progressText);
        },
        // onCardScanned callback - not needed here
        null
      );

      if (result.success) {
        loadingScreen.updateTitle('Scan Complete!');
        loadingScreen.updateSubtitle(`Scanned ${result.scannedCount} cards`);
        loadingScreen.updateStatus('Ready', 'success');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        if (result.error && result.error.includes('aborted')) {
          loadingScreen.updateTitle('Scan Cancelled');
          loadingScreen.updateSubtitle('Scan was stopped by user');
          loadingScreen.updateStatus('Cancelled', 'success');
        } else {
          loadingScreen.updateTitle('Scan Failed');
          loadingScreen.updateSubtitle(result.error || 'Unknown error');
          loadingScreen.updateStatus('Error', 'error');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      return result;

    } catch (error) {
      console.error('StoryCardAnalyticsFeature: Scan error:', error);
      loadingScreen.updateTitle('Scan Failed');
      loadingScreen.updateSubtitle(error.message);
      loadingScreen.updateStatus('Error', 'error');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { success: false, error: error.message };
    } finally {
      loadingScreen.hide();
    }
  }

  // ==================== HELPERS ====================

  getTypeIcon(type) {
    const icons = {
      character: '<span class="icon-user"></span>',
      location: '<span class="icon-map-pin"></span>',
      item: '<span class="icon-backpack"></span>',
      faction: '<span class="icon-swords"></span>',
      lore: '<span class="icon-scroll"></span>',
      other: '<span class="icon-file"></span>'
    };
    return icons[type] || '<span class="icon-file"></span>';
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ==================== STYLES ====================

  injectStyles() {
    if (document.getElementById('bd-analytics-styles')) return;

    // Build font URLs using chrome.runtime.getURL for proper extension paths
    const fontWoff2 = chrome.runtime.getURL('fonts/lucide/lucide.woff2');
    const fontWoff = chrome.runtime.getURL('fonts/lucide/lucide.woff');
    const fontTtf = chrome.runtime.getURL('fonts/lucide/lucide.ttf');

    const style = document.createElement('style');
    style.id = 'bd-analytics-styles';
    style.textContent = `
      /* ============================================
         Story Card Analytics Dashboard
         Uses BetterDungeon theme-variables.css
         ============================================ */

      /* Lucide Icon Font - injected with proper extension URLs */
      @font-face {
        font-family: "lucide";
        src: url('${fontWoff2}') format('woff2'),
             url('${fontWoff}') format('woff'),
             url('${fontTtf}') format('truetype');
        font-display: swap;
      }

      .bd-analytics-dashboard [class^="icon-"],
      .bd-analytics-dashboard [class*=" icon-"] {
        font-family: 'lucide' !important;
        font-size: inherit;
        font-style: normal;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      /* Dashboard Container - blocks ALL pointer events from reaching elements behind */
      .bd-analytics-dashboard {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: var(--bd-z-modal);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--bd-font-family-primary);
        /* Capture all pointer events - prevents input sinking to elements behind */
        pointer-events: auto;
        isolation: isolate;
      }

      .bd-analytics-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: var(--bd-bg-overlay);
        backdrop-filter: blur(8px);
        /* Ensure overlay catches clicks intended for background */
        pointer-events: auto;
      }

      /* Modal */
      .bd-analytics-modal {
        position: relative;
        width: 90%;
        max-width: 800px;
        max-height: 85vh;
        background: var(--bd-bg-primary);
        border: 1px solid var(--bd-border-subtle);
        border-radius: var(--bd-radius-2xl);
        box-shadow: var(--bd-shadow-xl);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* Header */
      .bd-analytics-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--bd-space-4) var(--bd-space-5);
        background: var(--bd-bg-secondary);
        border-bottom: 1px solid var(--bd-border-subtle);
      }

      .bd-analytics-header h2 {
        margin: 0;
        font-size: var(--bd-font-size-2xl);
        font-weight: var(--bd-font-weight-semibold);
        color: var(--bd-text-primary);
        display: flex;
        align-items: center;
        gap: var(--bd-space-2);
      }

      .bd-analytics-header-actions {
        display: flex;
        gap: var(--bd-space-2);
      }

      .bd-analytics-scan-btn {
        display: flex;
        align-items: center;
        gap: var(--bd-space-2);
        padding: var(--bd-space-2) var(--bd-space-4);
        background: var(--bd-btn-primary-bg);
        border: none;
        border-radius: var(--bd-radius-md);
        color: var(--bd-text-inverse);
        font-family: var(--bd-font-family-primary);
        font-size: var(--bd-font-size-md);
        font-weight: var(--bd-font-weight-medium);
        cursor: pointer;
        transition: all var(--bd-transition-fast);
      }

      .bd-analytics-scan-btn:hover {
        background: var(--bd-btn-primary-hover);
        box-shadow: var(--bd-shadow-glow);
      }

      .bd-analytics-close-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bd-btn-secondary-bg);
        border: 1px solid var(--bd-border-default);
        border-radius: var(--bd-radius-md);
        color: var(--bd-text-secondary);
        font-size: var(--bd-font-size-lg);
        cursor: pointer;
        transition: all var(--bd-transition-fast);
      }

      .bd-analytics-close-btn:hover {
        background: var(--bd-btn-secondary-hover);
        color: var(--bd-text-primary);
        border-color: var(--bd-border-accent);
      }

      /* Content */
      .bd-analytics-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--bd-space-5);
      }

      /* Scrollbar styling */
      .bd-analytics-content::-webkit-scrollbar {
        width: 8px;
      }
      .bd-analytics-content::-webkit-scrollbar-track {
        background: var(--bd-bg-primary);
      }
      .bd-analytics-content::-webkit-scrollbar-thumb {
        background: var(--bd-bg-elevated);
        border-radius: var(--bd-radius-full);
      }
      .bd-analytics-content::-webkit-scrollbar-thumb:hover {
        background: var(--bd-text-muted);
      }

      /* Loading State */
      .bd-analytics-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--bd-space-12) var(--bd-space-5);
        color: var(--bd-text-secondary);
        gap: var(--bd-space-4);
      }

      .bd-analytics-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--bd-bg-elevated);
        border-top-color: var(--bd-accent-primary);
        border-radius: 50%;
        animation: bd-analytics-spin 0.8s linear infinite;
      }

      @keyframes bd-analytics-spin {
        to { transform: rotate(360deg); }
      }

      /* Empty State */
      .bd-analytics-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--bd-space-12) var(--bd-space-5);
        text-align: center;
      }

      .bd-analytics-empty-icon {
        font-size: 56px;
        margin-bottom: var(--bd-space-4);
        color: var(--bd-text-muted);
      }

      .bd-analytics-empty-icon span {
        font-size: inherit;
      }

      .bd-analytics-empty h3 {
        margin: 0 0 var(--bd-space-2);
        font-size: var(--bd-font-size-xl);
        font-weight: var(--bd-font-weight-semibold);
        color: var(--bd-text-primary);
      }

      .bd-analytics-empty p {
        margin: 0;
        font-size: var(--bd-font-size-md);
        color: var(--bd-text-secondary);
        line-height: var(--bd-line-height-relaxed);
      }

      .bd-analytics-hint {
        font-size: var(--bd-font-size-sm) !important;
        color: var(--bd-text-muted) !important;
        margin-top: var(--bd-space-2) !important;
      }

      /* Grid Layout */
      .bd-analytics-grid {
        display: flex;
        flex-direction: column;
        gap: var(--bd-space-4);
      }

      /* Sections */
      .bd-analytics-section {
        background: var(--bd-bg-secondary);
        border: 1px solid var(--bd-border-subtle);
        border-radius: var(--bd-radius-lg);
        padding: var(--bd-space-4);
      }

      .bd-analytics-section h3 {
        margin: 0 0 var(--bd-space-3);
        font-size: var(--bd-font-size-sm);
        font-weight: var(--bd-font-weight-semibold);
        color: var(--bd-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      /* Summary Section (accent border) */
      .bd-analytics-summary {
        border-color: var(--bd-border-accent);
        background: linear-gradient(135deg, var(--bd-bg-secondary) 0%, rgba(255, 149, 0, 0.03) 100%);
      }

      /* Stats Grid */
      .bd-stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--bd-space-3);
      }

      @media (max-width: 600px) {
        .bd-stats-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      .bd-stat-card {
        background: var(--bd-bg-tertiary);
        border: 1px solid var(--bd-border-subtle);
        border-radius: var(--bd-radius-lg);
        padding: var(--bd-space-4);
        text-align: center;
        transition: all var(--bd-transition-fast);
      }

      .bd-stat-card:hover {
        border-color: var(--bd-border-accent);
        transform: translateY(-2px);
      }

      .bd-stat-value {
        font-size: 28px;
        font-weight: var(--bd-font-weight-bold);
        color: var(--bd-accent-primary);
        line-height: 1;
      }

      .bd-stat-label {
        font-size: var(--bd-font-size-xs);
        color: var(--bd-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: var(--bd-space-1);
      }

      /* Type Breakdown */
      .bd-type-breakdown {
        display: flex;
        flex-wrap: wrap;
        gap: var(--bd-space-2);
      }

      .bd-type-item {
        display: flex;
        align-items: center;
        gap: var(--bd-space-2);
        background: var(--bd-bg-tertiary);
        border: 1px solid var(--bd-border-subtle);
        padding: var(--bd-space-2) var(--bd-space-3);
        border-radius: var(--bd-radius-md);
        transition: all var(--bd-transition-fast);
      }

      .bd-type-item:hover {
        border-color: var(--bd-border-default);
        background: var(--bd-bg-elevated);
      }

      .bd-type-icon {
        font-size: var(--bd-font-size-lg);
        display: flex;
        align-items: center;
        color: var(--bd-text-secondary);
      }

      .bd-type-name {
        color: var(--bd-text-primary);
        font-size: var(--bd-font-size-md);
        font-weight: var(--bd-font-weight-medium);
      }

      .bd-type-count {
        background: var(--bd-accent-primary);
        color: var(--bd-text-inverse);
        font-size: var(--bd-font-size-xs);
        font-weight: var(--bd-font-weight-semibold);
        padding: 2px 8px;
        border-radius: var(--bd-radius-full);
      }

      /* Coverage Bars */
      .bd-coverage-bars {
        display: flex;
        flex-direction: column;
        gap: var(--bd-space-3);
      }

      .bd-coverage-item {
        display: flex;
        flex-direction: column;
        gap: var(--bd-space-1);
      }

      .bd-coverage-label {
        display: flex;
        justify-content: space-between;
        font-size: var(--bd-font-size-sm);
        color: var(--bd-text-secondary);
      }

      .bd-coverage-label span:last-child {
        font-family: var(--bd-font-family-mono);
        font-size: var(--bd-font-size-xs);
        color: var(--bd-text-muted);
      }

      .bd-coverage-bar {
        height: 8px;
        background: var(--bd-bg-elevated);
        border-radius: var(--bd-radius-full);
        overflow: hidden;
      }

      .bd-coverage-fill {
        height: 100%;
        border-radius: var(--bd-radius-full);
        transition: width var(--bd-transition-slow);
      }

      .bd-fill-triggers { background: var(--bd-mode-say); }
      .bd-fill-desc { background: var(--bd-mode-do); }

      /* Issues */
      .bd-issues-list {
        display: flex;
        flex-direction: column;
        gap: var(--bd-space-2);
      }

      .bd-issue-item {
        display: flex;
        align-items: center;
        gap: var(--bd-space-3);
        padding: var(--bd-space-3);
        border-radius: var(--bd-radius-md);
        font-size: var(--bd-font-size-md);
        border: 1px solid transparent;
      }

      .bd-issue-error {
        background: var(--bd-error-bg);
        border-color: var(--bd-error-border);
        color: var(--bd-error);
      }
      .bd-issue-warning {
        background: var(--bd-warning-bg);
        border-color: var(--bd-warning-border);
        color: var(--bd-warning);
      }
      .bd-issue-info {
        background: var(--bd-info-bg);
        border-color: var(--bd-info-border);
        color: var(--bd-info);
      }
      .bd-issue-success {
        background: var(--bd-success-bg);
        border-color: var(--bd-success-border);
        color: var(--bd-success);
      }

      .bd-issue-icon {
        font-size: var(--bd-font-size-lg);
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }

      /* Expandable Sections */
      .bd-analytics-expandable {
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        user-select: none;
        padding: var(--bd-space-1);
        margin: calc(-1 * var(--bd-space-1));
        border-radius: var(--bd-radius-sm);
        transition: background var(--bd-transition-fast);
      }

      .bd-analytics-expandable:hover {
        background: var(--bd-bg-tertiary);
      }

      .bd-analytics-expandable.disabled {
        cursor: default;
        opacity: 0.5;
      }

      .bd-analytics-expandable.disabled:hover {
        background: transparent;
      }

      .bd-analytics-expandable h3 {
        margin: 0;
      }

      .bd-expand-icon {
        color: var(--bd-text-muted);
        font-size: var(--bd-font-size-base);
        transition: transform var(--bd-transition-fast);
      }

      .bd-analytics-expandable.expanded .bd-expand-icon {
        transform: rotate(180deg);
      }

      .bd-analytics-expand-content {
        display: none;
        margin-top: var(--bd-space-3);
        padding-top: var(--bd-space-3);
        border-top: 1px solid var(--bd-border-subtle);
      }

      .bd-analytics-expand-content.expanded {
        display: block;
      }

      /* Overlaps */
      .bd-overlap-item {
        display: flex;
        flex-direction: column;
        gap: var(--bd-space-1);
        padding: var(--bd-space-2) 0;
        border-bottom: 1px solid var(--bd-border-subtle);
      }

      .bd-overlap-item:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }

      .bd-overlap-item:first-child {
        padding-top: 0;
      }

      .bd-overlap-trigger {
        color: var(--bd-mode-story);
        font-weight: var(--bd-font-weight-medium);
        font-family: var(--bd-font-family-mono);
        font-size: var(--bd-font-size-md);
      }

      .bd-overlap-cards {
        font-size: var(--bd-font-size-sm);
        color: var(--bd-text-secondary);
        line-height: var(--bd-line-height-relaxed);
      }

      /* Card Links */
      .bd-card-link {
        color: var(--bd-text-primary);
        cursor: pointer;
        transition: color var(--bd-transition-fast);
      }

      .bd-card-link:hover {
        color: var(--bd-accent-primary);
        text-decoration: underline;
      }

      .bd-empty-card {
        display: inline-block;
        background: var(--bd-error-bg);
        border: 1px solid var(--bd-error-border);
        padding: 2px var(--bd-space-2);
        border-radius: var(--bd-radius-sm);
        margin: 2px;
        font-size: var(--bd-font-size-sm);
      }

      .bd-empty-cards-list {
        line-height: var(--bd-line-height-relaxed);
      }

      .bd-analytics-none {
        color: var(--bd-text-muted);
        font-size: var(--bd-font-size-md);
        font-style: italic;
      }

      /* Content Quality Subsections */
      .bd-quality-subsection {
        margin-bottom: var(--bd-space-4);
        padding-bottom: var(--bd-space-4);
        border-bottom: 1px solid var(--bd-border-subtle);
      }

      .bd-quality-subsection:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }

      .bd-quality-subsection h4 {
        display: flex;
        align-items: center;
        gap: var(--bd-space-2);
        margin: 0 0 var(--bd-space-2);
        font-size: var(--bd-font-size-md);
        font-weight: var(--bd-font-weight-semibold);
        color: var(--bd-text-primary);
      }

      .bd-quality-subsection h4 span {
        color: var(--bd-text-muted);
        font-size: var(--bd-font-size-base);
      }

      .bd-quality-subsection .bd-analytics-hint {
        margin-bottom: var(--bd-space-2);
      }

      /* Issue Card Items */
      .bd-issue-cards-list {
        display: flex;
        flex-direction: column;
        gap: var(--bd-space-1);
      }

      .bd-issue-card-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--bd-space-2) var(--bd-space-3);
        background: var(--bd-bg-tertiary);
        border: 1px solid var(--bd-border-subtle);
        border-radius: var(--bd-radius-md);
        transition: all var(--bd-transition-fast);
      }

      .bd-issue-card-item:hover {
        border-color: var(--bd-border-default);
        background: var(--bd-bg-elevated);
      }

      .bd-issue-card-item.bd-very-long {
        border-color: var(--bd-warning-border);
        background: var(--bd-warning-bg);
      }

      .bd-issue-detail {
        font-size: var(--bd-font-size-sm);
        color: var(--bd-text-muted);
        font-family: var(--bd-font-family-mono);
      }

      /* Footer */
      .bd-analytics-footer {
        padding: var(--bd-space-3) var(--bd-space-4);
        border-top: 1px solid var(--bd-border-subtle);
        background: var(--bd-bg-secondary);
        text-align: center;
      }

      .bd-scan-time {
        font-size: var(--bd-font-size-xs);
        color: var(--bd-text-muted);
      }
    `;

    document.head.appendChild(style);
  }

  removeStyles() {
    const style = document.getElementById('bd-analytics-styles');
    if (style) {
      style.remove();
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.StoryCardAnalyticsFeature = StoryCardAnalyticsFeature;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StoryCardAnalyticsFeature;
}
