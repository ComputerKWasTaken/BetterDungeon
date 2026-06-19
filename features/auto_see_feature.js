// BetterDungeon - Auto See Feature
// Automatically sends an empty "See" action after AI outputs.

class AutoSeeFeature {
  static id = 'autoSee';

  constructor() {
    this.enabled = true;
    this.debug = false;

    this.currentAdventureId = null; // AI Dungeon URL shortId
    this.isProcessing = false;
    this.isWaitingForAIResponse = false;
    this.currentOperationId = 0;
    this.operationStartTime = null;

    this.triggerMode = 'everyTurn';
    this.turnInterval = 2;
    this.turnCounter = 0;

    this.inputAreaSelector = '[aria-label="Change input mode"]';
    this.inputModeMenuSelector = '[aria-label="Change input mode"]';
    this.submitButtonSelector = '[aria-label="Submit action"]';
    this.continueButtonSelector = '[aria-label="Command: continue"]';
    this.textInputSelector = '#game-text-input';

    this.boundClickHandler = null;
    this.boundEnterKeyHandler = null;
    this.boundContinueHotkeyHandler = null;
    this.boundVisibilityHandler = null;
    this.boundUserInterruptHandler = null;
    this.originalPushState = null;
    this.originalReplaceState = null;

    this.waitingForAITimer = null;
    this.safetyResetTimer = null;
    this.lastTriggerAttempt = 0;
    this.lastObservedActionEvent = null;

    this.TIMEOUTS = {
      WAITING_FOR_AI: 60000,
      PROCESSING_OPERATION: 45000,
      RATE_LIMIT_COOLDOWN: 1000,
    };

    this.ACTION_REQUEST_QUERY = `mutation ActionRequest($input: ActionRequestInput!) {
      actionRequest(input: $input) {
        success
        message
        errorContext
        __typename
      }
    }`;

    this.SEND_EVENT_QUERY = `mutation SendEvent($input: EventStreamInput) {
      sendEvent(input: $input) {
        success
        __typename
      }
    }`;

    this.GET_LATEST_ACTION_FOR_TIMEOUT_QUERY = `query GetLatestActionForTimeout($shortId: String, $limit: Int, $desc: Boolean) {
      adventure(shortId: $shortId) {
        id
        actionCount
        actionWindow(limit: $limit, desc: $desc) {
          id
          adventureId
          updatedAt
          __typename
        }
        __typename
      }
    }`;

    this.REFETCH_LATEST_ACTION_FOR_TIMEOUT_QUERY = `query RefetchLatestActionForTimeout($shortId: String, $limit: Int, $desc: Boolean) {
      adventure(shortId: $shortId) {
        id
        actionCount
        actionWindow(limit: $limit, desc: $desc) {
          id
          adventureId
          updatedAt
          __typename
        }
        __typename
      }
    }`;
  }

  async init() {
    console.log('[AutoSee] Initializing Auto See feature...');
    await this.loadSettings();
    this.detectCurrentAdventure();
    this.startAdventureChangeDetection();
    this.setupActionDetection();
    this.setupVisibilityHandling();
    this.setupUserInterruptDetection();
    this.log('[AutoSee] Initialization complete. Enabled:', this.enabled, 'Mode:', this.triggerMode);
  }

  destroy() {
    this.log('[AutoSee] Destroying Auto See feature...');
    this.abortCurrentOperation('Feature destroyed');
    this.clearAllTimers();
    this.cleanupActionDetection();

    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    if (this.boundUserInterruptHandler) {
      document.removeEventListener('click', this.boundUserInterruptHandler, true);
      this.boundUserInterruptHandler = null;
    }
    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }

    this.resetState();
  }

  resetState() {
    this.isProcessing = false;
    this.isWaitingForAIResponse = false;
    this.operationStartTime = null;
  }

  clearAllTimers() {
    if (this.waitingForAITimer) {
      clearTimeout(this.waitingForAITimer);
      this.waitingForAITimer = null;
    }
    if (this.safetyResetTimer) {
      clearTimeout(this.safetyResetTimer);
      this.safetyResetTimer = null;
    }
  }

  abortCurrentOperation(reason) {
    if (this.isProcessing || this.isWaitingForAIResponse) {
      this.log('[AutoSee] Aborting current operation:', reason);
      this.currentOperationId++;
      this.clearAllTimers();
      this.resetState();
    }
  }

  isOperationValid(operationId) {
    return operationId === this.currentOperationId;
  }

  setupSafetyTimeout(timeout, context) {
    if (this.safetyResetTimer) clearTimeout(this.safetyResetTimer);
    this.safetyResetTimer = setTimeout(() => {
      if (this.isProcessing || this.isWaitingForAIResponse) {
        console.warn(`[AutoSee] Safety timeout triggered: ${context}`);
        this.abortCurrentOperation(`Safety timeout: ${context}`);
      }
    }, timeout);
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'betterDungeon_autoSeeTriggerMode',
        'betterDungeon_autoSeeTurnInterval',
      ]);
      this.triggerMode = (result || {}).betterDungeon_autoSeeTriggerMode ?? 'everyTurn';
      this.turnInterval = (result || {}).betterDungeon_autoSeeTurnInterval ?? 2;
    } catch (error) {
      console.error('[AutoSee] Error loading settings:', error);
    }
  }

  setTriggerMode(mode) {
    this.triggerMode = mode;
    chrome.storage.sync.set({ betterDungeon_autoSeeTriggerMode: mode });
  }

  setTurnInterval(interval) {
    this.turnInterval = Math.max(2, Math.min(10, interval));
    chrome.storage.sync.set({ betterDungeon_autoSeeTurnInterval: this.turnInterval });
  }

  detectCurrentAdventure() {
    const nextAdventureId = this.getCurrentAdventureShortId();

    if (nextAdventureId !== this.currentAdventureId) {
      this.abortCurrentOperation('Adventure changed');
      this.turnCounter = 0;
      this.currentAdventureId = nextAdventureId;
      this.log('[AutoSee] Adventure changed to', this.currentAdventureId);
    }
  }

  getCurrentAdventureShortId() {
    return (
      window.Ultrascripts?.ws?.getAdventureShortId?.() ||
      window.location.pathname.match(/\/(?:adventures?|play)\/([^/]+)/)?.[1] ||
      null
    );
  }

  startAdventureChangeDetection() {
    window.addEventListener('popstate', () => this.detectCurrentAdventure());

    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      this.originalPushState.apply(history, args);
      this.detectCurrentAdventure();
    };

    history.replaceState = (...args) => {
      this.originalReplaceState.apply(history, args);
      this.detectCurrentAdventure();
    };
  }

  setupVisibilityHandling() {
    this.boundVisibilityHandler = () => {
      if (document.hidden && (this.isProcessing || this.isWaitingForAIResponse)) {
        this.abortCurrentOperation('Page hidden');
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  setupUserInterruptDetection() {
    this.boundUserInterruptHandler = (event) => {
      if (!this.isProcessing && !this.isWaitingForAIResponse) return;
      if (!event.isTrusted) return;
      if (this.isSameObservedActionEvent(event)) return;

      const target = event.target.closest('[aria-label]');
      if (!target) return;

      const ariaLabel = target.getAttribute('aria-label');
      const interruptLabels = [
        'Command: take a turn',
        'Command: continue',
        'Command: retry',
        'Command: erase',
        'Close text input',
        'Undo change',
        'Redo change',
      ];

      if (interruptLabels.includes(ariaLabel)) {
        this.abortCurrentOperation(`User interaction: ${ariaLabel}`);
      }
    };

    document.addEventListener('click', this.boundUserInterruptHandler, true);
  }

  setupActionDetection() {
    this.boundClickHandler = (event) => this.handleActionClick(event);
    this.boundEnterKeyHandler = (event) => this.handleEnterKeySubmit(event);
    this.boundContinueHotkeyHandler = () => this.handleContinueHotkey();

    document.addEventListener('click', this.boundClickHandler, true);
    document.addEventListener('keydown', this.boundEnterKeyHandler, true);
    document.addEventListener('betterdungeon:continue-hotkey', this.boundContinueHotkeyHandler);
  }

  cleanupActionDetection() {
    if (this.boundClickHandler) {
      document.removeEventListener('click', this.boundClickHandler, true);
      this.boundClickHandler = null;
    }
    if (this.boundEnterKeyHandler) {
      document.removeEventListener('keydown', this.boundEnterKeyHandler, true);
      this.boundEnterKeyHandler = null;
    }
    if (this.boundContinueHotkeyHandler) {
      document.removeEventListener('betterdungeon:continue-hotkey', this.boundContinueHotkeyHandler);
      this.boundContinueHotkeyHandler = null;
    }
  }

  handleContinueHotkey() {
    if (!this.canProcessAction('Continue hotkey')) return;
    this.prepareForAIResponse({ captureMode: false, source: 'continue hotkey' });
  }

  handleEnterKeySubmit(event) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const activeElement = document.activeElement;
    if (!activeElement || activeElement.id !== 'game-text-input') return;
    if (!this.canProcessAction('Enter key')) return;
    this.recordObservedActionEvent(event, 'Submit action');
    this.prepareForAIResponse({ captureMode: true, source: 'enter key' });
  }

  handleActionClick(event) {
    if (event.target.closest(this.submitButtonSelector)) {
      if (!this.canProcessAction('click')) return;
      this.recordObservedActionEvent(event, 'Submit action');
      this.prepareForAIResponse({ captureMode: true, source: 'submit click' });
    } else if (event.target.closest(this.continueButtonSelector)) {
      if (!this.canProcessAction('click')) return;
      this.recordObservedActionEvent(event, 'Command: continue');
      this.prepareForAIResponse({ captureMode: false, source: 'continue click' });
    }
  }

  recordObservedActionEvent(event, ariaLabel) {
    this.lastObservedActionEvent = {
      timeStamp: event?.timeStamp ?? null,
      ariaLabel,
      recordedAt: Date.now(),
    };
  }

  isSameObservedActionEvent(event) {
    const observed = this.lastObservedActionEvent;
    if (!observed || observed.timeStamp == null || event?.timeStamp == null) return false;
    return observed.timeStamp === event.timeStamp && Date.now() - observed.recordedAt < 1000;
  }

  canProcessAction(source) {
    if (!this.enabled || !this.currentAdventureId) return false;

    const now = Date.now();
    if (now - this.lastTriggerAttempt < this.TIMEOUTS.RATE_LIMIT_COOLDOWN) {
      this.log('[AutoSee] Ignoring', source, '- rate limited');
      return false;
    }
    if (this.isProcessing || this.isWaitingForAIResponse) {
      this.log('[AutoSee] Ignoring', source, '- operation already active');
      return false;
    }

    this.lastTriggerAttempt = now;
    return true;
  }

  prepareForAIResponse({ captureMode, source }) {
    if (captureMode && this.detectCurrentInputMode() === 'see') {
      this.log('[AutoSee] Ignoring manual See submission');
      return;
    }

    const gql = window.BetterDungeonGQL;
    if (!gql?.waitForActionUpdate) {
      console.warn('[AutoSee] BetterDungeonGQL is not available; cannot wait for action updates.');
      return;
    }

    const baseline = this.getActionBaseline();
    this.currentOperationId++;
    const operationId = this.currentOperationId;
    const adventureAtStart = this.currentAdventureId;

    this.isWaitingForAIResponse = true;
    this.log('[AutoSee] Waiting for AI response after', source, baseline);

    this.waitingForAITimer = setTimeout(() => {
      if (this.isWaitingForAIResponse && this.isOperationValid(operationId)) {
        console.warn('[AutoSee] Timeout waiting for AI response');
        this.isWaitingForAIResponse = false;
      }
    }, this.TIMEOUTS.WAITING_FOR_AI);

    gql.waitForActionUpdate(
      (detail) => (
        this.isOperationValid(operationId) &&
        this.currentAdventureId === adventureAtStart &&
        this.isUserTurnComplete(detail, baseline)
      ),
      this.TIMEOUTS.WAITING_FOR_AI
    ).then((detail) => {
      this.handleUserTurnComplete(operationId, adventureAtStart, detail);
    }).catch((error) => {
      if (this.isOperationValid(operationId) && this.isWaitingForAIResponse) {
        console.warn('[AutoSee] Failed while waiting for AI response:', error);
        this.isWaitingForAIResponse = false;
      }
    });
  }

  handleUserTurnComplete(operationId, adventureAtStart, detail) {
    if (!this.isOperationValid(operationId) || !this.isWaitingForAIResponse) return;

    if (this.waitingForAITimer) {
      clearTimeout(this.waitingForAITimer);
      this.waitingForAITimer = null;
    }

    this.isWaitingForAIResponse = false;
    this.turnCounter++;
    this.log('[AutoSee] User turn complete. Turn counter:', this.turnCounter, detail);

    if (!this.shouldTriggerSee()) return;

    setTimeout(() => {
      if (this.currentAdventureId !== adventureAtStart) return;
      this.triggerSeeAction();
    }, 300);
  }

  isUserTurnComplete(detail, baseline) {
    if (!detail || detail.source === 'initial') return false;

    const candidates = Array.isArray(detail.changed) && detail.changed.length > 0
      ? detail.changed
      : (Array.isArray(detail.actions) ? detail.actions : []);

    const newLiveActions = candidates.filter(action =>
      this.isLiveAction(action) && this.isAfterBaseline(action.id, baseline)
    );

    if (newLiveActions.length > 0) {
      return newLiveActions.some(action => String(action.type || '').toLowerCase() !== 'see');
    }

    if (detail.tail && detail.tail !== baseline.tail) {
      return true;
    }

    const liveCount = Number.isFinite(detail.liveCount)
      ? detail.liveCount
      : window.Ultrascripts?.ws?.getLiveCount?.();
    return Number.isFinite(liveCount) && liveCount > baseline.liveCount;
  }

  shouldTriggerSee() {
    if (this.triggerMode === 'everyTurn') return true;
    if (this.triggerMode === 'afterNTurns') return this.turnCounter % this.turnInterval === 0;
    return false;
  }

  async triggerSeeAction() {
    if (this.isProcessing || !this.currentAdventureId) return;

    const gql = window.BetterDungeonGQL;
    if (!gql?.requestBatch || !gql?.getAdventureIdentity) {
      console.warn('[AutoSee] BetterDungeonGQL is not available; cannot send See action.');
      return;
    }

    this.currentOperationId++;
    const operationId = this.currentOperationId;
    const adventureAtStart = this.currentAdventureId;
    const requestKey = this.createRequestKey();
    const baseline = this.getActionBaseline();

    this.isProcessing = true;
    this.operationStartTime = Date.now();
    this.setupSafetyTimeout(this.TIMEOUTS.PROCESSING_OPERATION, 'See action');

    try {
      this.log('[AutoSee] Sending GraphQL See action', { operationId, requestKey, baseline });
      const identity = await gql.getAdventureIdentity(adventureAtStart, { timeoutMs: 10000 });
      const shortId = identity.shortId || adventureAtStart;

      const completion = gql.waitForActionUpdate(
        (detail) => (
          this.isOperationValid(operationId) &&
          this.currentAdventureId === adventureAtStart &&
          this.isSeeActionComplete(detail, baseline, requestKey)
        ),
        this.TIMEOUTS.PROCESSING_OPERATION
      ).catch((error) => {
        if (this.isOperationValid(operationId) && this.isProcessing) {
          console.warn('[AutoSee] Timed out waiting for See action update:', error.message || error);
        }
        return null;
      });

      const batchResults = await gql.requestBatch([
        this.createSubmitTelemetryOperation(identity),
        this.createLatestActionOperation('GetLatestActionForTimeout', shortId),
        this.createActionRequestOperation(identity, requestKey),
      ], { timeoutMs: this.TIMEOUTS.PROCESSING_OPERATION });

      const actionRequest = this.findBatchResult(batchResults, 'actionRequest')?.data?.actionRequest;
      if (actionRequest?.success === false) {
        throw new Error(actionRequest.message || 'ActionRequest failed.');
      }

      const latestBefore = this.extractLatestActionSnapshot(
        this.findBatchResult(batchResults, 'adventure')
      );
      const refetchCompletion = this.refetchLatestActionForTimeout(
        gql,
        shortId,
        latestBefore,
        operationId,
        adventureAtStart,
        this.TIMEOUTS.PROCESSING_OPERATION
      )
        .catch((error) => {
          if (this.isOperationValid(operationId)) {
            console.warn('[AutoSee] Failed to refetch latest action after See:', error.message || error);
          }
          return null;
        });

      const completionResult = await this.waitForCompletionSignals([
        completion.then(detail => detail ? { source: 'ws', detail } : null),
        refetchCompletion,
      ], this.TIMEOUTS.PROCESSING_OPERATION);

      if (!completionResult) {
        console.warn('[AutoSee] See action submitted, but no completion signal was observed.');
      } else {
        this.log('[AutoSee] See action completed through', completionResult.source);
      }
    } catch (error) {
      if (this.isOperationValid(operationId)) {
        console.error('[AutoSee] Error during GraphQL See action:', error);
      }
    } finally {
      if (this.isOperationValid(operationId)) {
        this.isProcessing = false;
        this.operationStartTime = null;
        if (this.safetyResetTimer) {
          clearTimeout(this.safetyResetTimer);
          this.safetyResetTimer = null;
        }
      }
    }
  }

  async sendSubmitTelemetry(gql, identity) {
    return gql.request(
      'SendEvent',
      this.createSubmitTelemetryOperation(identity).variables,
      this.SEND_EVENT_QUERY,
      { timeoutMs: 10000 }
    );
  }

  createSubmitTelemetryOperation(identity) {
    const clientInfo = {
      platform: 'web',
      userAgent: String(navigator.userAgent || '').toLowerCase(),
      nativeAppPlatform: null,
      surface: 'aidungeon',
      adventureId: identity.adventureId,
      actionType: 'see',
    };

    if (identity.scenarioId) clientInfo.scenarioId = identity.scenarioId;

    return {
      operationName: 'SendEvent',
      variables: {
        input: {
          eventType: 'user',
          eventName: 'submit_button_pressed',
          metadata: { clientInfo },
        },
      },
      query: this.SEND_EVENT_QUERY,
    };
  }

  createLatestActionOperation(operationName, shortId) {
    return {
      operationName,
      variables: {
        shortId,
        limit: 1,
        desc: true,
      },
      query: operationName === 'RefetchLatestActionForTimeout'
        ? this.REFETCH_LATEST_ACTION_FOR_TIMEOUT_QUERY
        : this.GET_LATEST_ACTION_FOR_TIMEOUT_QUERY,
    };
  }

  createActionRequestOperation(identity, requestKey) {
    return {
      operationName: 'ActionRequest',
      variables: {
        input: {
          adventureId: identity.adventureId,
          type: 'see',
          classicStoryStreamingEnabled: false,
          text: '',
          key: requestKey,
        },
      },
      query: this.ACTION_REQUEST_QUERY,
    };
  }

  findBatchResult(batchResults, dataKey) {
    const items = Array.isArray(batchResults) ? batchResults : [batchResults];
    return items.find(item => item?.data && Object.prototype.hasOwnProperty.call(item.data, dataKey)) || null;
  }

  extractLatestActionSnapshot(result) {
    const adventure = result?.data?.adventure;
    const latest = Array.isArray(adventure?.actionWindow) ? adventure.actionWindow[0] : null;
    return {
      actionCount: Number.isFinite(adventure?.actionCount) ? adventure.actionCount : null,
      latestActionId: latest?.id != null ? String(latest.id) : null,
      latestUpdatedAt: latest?.updatedAt || null,
      adventureId: adventure?.id != null ? String(adventure.id) : null,
    };
  }

  async refetchLatestActionForTimeout(gql, shortId, baseline, operationId, adventureAtStart, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!this.isOperationValid(operationId) || this.currentAdventureId !== adventureAtStart) return null;

      const requestTimeoutMs = Math.max(1000, Math.min(15000, deadline - Date.now()));
      const result = await gql.request(
        'RefetchLatestActionForTimeout',
        this.createLatestActionOperation('RefetchLatestActionForTimeout', shortId).variables,
        this.REFETCH_LATEST_ACTION_FOR_TIMEOUT_QUERY,
        { timeoutMs: requestTimeoutMs }
      );
      const snapshot = this.extractLatestActionSnapshot(result);

      if (this.hasLatestActionAdvanced(snapshot, baseline)) {
        return {
          source: 'latest-action-refetch',
          snapshot,
        };
      }

      await this.wait(Math.min(1500, Math.max(0, deadline - Date.now())));
    }

    return null;
  }

  hasLatestActionAdvanced(snapshot, baseline) {
    if (!snapshot || !baseline) return true;
    if (Number.isFinite(snapshot.actionCount) && Number.isFinite(baseline.actionCount)) {
      if (snapshot.actionCount > baseline.actionCount) return true;
    }
    if (snapshot.latestActionId && baseline.latestActionId && snapshot.latestActionId !== baseline.latestActionId) {
      return true;
    }
    if (snapshot.latestUpdatedAt && baseline.latestUpdatedAt && snapshot.latestUpdatedAt !== baseline.latestUpdatedAt) {
      return true;
    }
    return false;
  }

  waitForCompletionSignals(promises, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      let remaining = promises.length;
      const timer = setTimeout(() => finish(null), timeoutMs);

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      for (const promise of promises) {
        Promise.resolve(promise).then((result) => {
          if (result) {
            finish(result);
            return;
          }
          remaining--;
          if (remaining <= 0) finish(null);
        }).catch(() => {
          remaining--;
          if (remaining <= 0) finish(null);
        });
      }
    });
  }

  isSeeActionComplete(detail, baseline, requestKey) {
    if (!detail || detail.source === 'initial') return false;
    if (detail.key && requestKey && detail.key === requestKey) return true;

    const candidates = Array.isArray(detail.changed) && detail.changed.length > 0
      ? detail.changed
      : (Array.isArray(detail.actions) ? detail.actions : []);

    return candidates.some(action =>
      this.isLiveAction(action) &&
      String(action.type || '').toLowerCase() === 'see' &&
      this.isAfterBaseline(action.id, baseline)
    );
  }

  getActionBaseline() {
    const ws = window.Ultrascripts?.ws;
    const actions = ws?.getActions ? Array.from(ws.getActions().values()) : [];
    const liveActions = actions.filter(action => this.isLiveAction(action));
    const tail = ws?.getTail?.() || liveActions[liveActions.length - 1]?.id || null;
    const liveCount = Number.isFinite(ws?.getLiveCount?.())
      ? ws.getLiveCount()
      : liveActions.length;

    let tailNum = -Infinity;
    for (const action of liveActions) {
      const idNum = Number(action.id);
      if (Number.isFinite(idNum) && idNum > tailNum) tailNum = idNum;
    }

    return {
      tail,
      tailNum,
      liveCount,
    };
  }

  isLiveAction(action) {
    return !!action && action.undoneAt == null && action.deletedAt == null;
  }

  isAfterBaseline(actionId, baseline) {
    const idNum = Number(actionId);
    if (Number.isFinite(idNum) && Number.isFinite(baseline.tailNum)) {
      return idNum > baseline.tailNum;
    }
    return actionId !== baseline.tail;
  }

  createRequestKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isInputAreaOpen() {
    return !!document.querySelector(this.inputAreaSelector);
  }

  detectCurrentInputMode() {
    const modeButton = document.querySelector(this.inputModeMenuSelector);
    const modeText = modeButton?.querySelector('.font_body');
    return modeText ? modeText.textContent.toLowerCase().trim() : null;
  }

  log(...args) {
    if (this.debug) console.log(...args);
  }
}

if (typeof window !== 'undefined') {
  window.AutoSeeFeature = AutoSeeFeature;
}
