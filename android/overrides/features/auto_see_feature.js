// BetterDungeon - Auto See Feature
// Automatically sends an empty "See" action after AI outputs.

class AutoSeeFeature {
  static id = 'autoSee';

  constructor() {
    this.enabled = true;
    this.debug = false;
    this.warnedKeys = new Set();

    this.currentAdventureId = null; // AI Dungeon URL shortId
    this.isProcessing = false;
    this.isWaitingForAIResponse = false;
    this.currentOperationId = 0;
    this.operationStartTime = null;

    this.triggerMode = 'everyTurn';
    this.turnInterval = 2;
    this.turnCounter = 0;

    this.inputModeMenuSelector = '[aria-label="Change input mode"]';
    this.submitButtonSelector = '[aria-label="Submit action"]';
    this.continueButtonSelector = '[aria-label="Command: continue"]';
    this.textInputSelector = '#game-text-input';

    this.boundClickHandler = null;
    this.boundEnterKeyHandler = null;
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
          type
          updatedAt
          __typename
        }
        __typename
      }
    }`;

  }

  async init() {
    this.log('[AutoSee] Initializing Auto See feature...');
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
        this.log(`[AutoSee] Safety timeout triggered: ${context}`);
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
      this.warnOnce('settings-load', '[AutoSee] Error loading settings:', error);
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

    document.addEventListener('click', this.boundClickHandler, true);
    document.addEventListener('keydown', this.boundEnterKeyHandler, true);
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
  }

  handleEnterKeySubmit(event) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const activeElement = document.activeElement;
    if (!activeElement?.matches?.(this.textInputSelector)) return;
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
      this.warnOnce('missing-gql-wait', '[AutoSee] BetterDungeonGQL is not available; cannot wait for action updates.');
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
        this.log('[AutoSee] Timeout waiting for AI response');
        this.waitingForAITimer = null;
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
        this.log('[AutoSee] Failed while waiting for AI response:', error);
        if (this.waitingForAITimer) {
          clearTimeout(this.waitingForAITimer);
          this.waitingForAITimer = null;
        }
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
      this.warnOnce('missing-gql-action', '[AutoSee] BetterDungeonGQL is not available; cannot send See action.');
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
      const completion = gql.waitForActionUpdate(
        (detail) => (
          this.isOperationValid(operationId) &&
          this.currentAdventureId === adventureAtStart &&
          this.isSeeActionComplete(detail, requestKey)
        ),
        this.TIMEOUTS.PROCESSING_OPERATION - 1000
      );
      const shortId = identity.shortId || adventureAtStart;

      const batchResults = await gql.requestBatch([
        this.createSubmitTelemetryOperation(identity),
        this.createLatestActionOperation(shortId),
        this.createActionRequestOperation(identity, requestKey),
      ], { timeoutMs: this.TIMEOUTS.PROCESSING_OPERATION });

      const actionRequest = this.findBatchResult(batchResults, 'actionRequest')?.data?.actionRequest;
      if (actionRequest?.success === false) {
        throw new Error(actionRequest.message || 'ActionRequest failed.');
      }

      let completionDetail;
      try {
        completionDetail = await completion;
      } catch (error) {
        if (!this.isOperationValid(operationId)) return;
        const fallback = await gql.request(
          'GetLatestActionForTimeout',
          this.createLatestActionOperation(shortId).variables,
          this.GET_LATEST_ACTION_FOR_TIMEOUT_QUERY,
          { timeoutMs: 10000 }
        );
        const latest = fallback?.data?.adventure?.actionWindow?.[0];
        const landed = !!(
          latest &&
          String(latest.type || '').toLowerCase() === 'see' &&
          this.isAfterBaseline(latest.id, baseline)
        );
        this.log(
          landed
            ? '[AutoSee] Matching actionUpdates frame timed out, but latest-action fallback confirms See landed; completion telemetry skipped.'
            : '[AutoSee] Matching actionUpdates frame timed out and latest-action fallback did not confirm See; completion telemetry skipped.',
          { requestKey, latest, error: error.message || error }
        );
        return;
      }
      const completedAt = Date.now();
      await gql.request(
        'SendEvent',
        this.createCompletionTelemetryVariables(identity, requestKey, completionDetail, completedAt),
        this.SEND_EVENT_QUERY,
        { timeoutMs: this.TIMEOUTS.PROCESSING_OPERATION }
      );
      this.log('[AutoSee] See action completed through matching action update', completionDetail);
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

  createSubmitTelemetryOperation(identity) {
    const clientInfo = {
      platform: 'web',
      userAgent: String(navigator.userAgent || '').toLowerCase(),
      nativeAppPlatform: null,
      surface: 'aidungeon',
      adventureId: identity.adventureId,
      actionType: 'see',
    };

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

  createLatestActionOperation(shortId) {
    return {
      operationName: 'GetLatestActionForTimeout',
      variables: {
        shortId,
        limit: 1,
        desc: true,
      },
      query: this.GET_LATEST_ACTION_FOR_TIMEOUT_QUERY,
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

  createCompletionTelemetryVariables(identity, requestKey, detail, completedAt) {
    return {
      input: {
        eventType: 'user',
        eventName: 'action_roundtrip_completed',
        metadata: {
          clientInfo: {
            platform: 'web',
            userAgent: String(navigator.userAgent || '').toLowerCase(),
            nativeAppPlatform: null,
            surface: 'aidungeon',
            actionType: 'see',
            requestKey,
            roundtripMs: completedAt - this.operationStartTime,
            actionCount: Array.isArray(detail?.actions) ? detail.actions.length : 0,
            adventureId: identity.adventureId,
            scenarioId: identity.scenarioId || undefined,
            submittedAt: this.operationStartTime,
            completedAt,
          },
        },
      },
    };
  }

  findBatchResult(batchResults, dataKey) {
    const items = Array.isArray(batchResults) ? batchResults : [batchResults];
    return items.find(item => item?.data && Object.prototype.hasOwnProperty.call(item.data, dataKey)) || null;
  }

  isSeeActionComplete(detail, requestKey) {
    if (!detail || detail.source === 'initial') return false;
    return !!(detail.key && requestKey && detail.key === requestKey);
  }

  getActionBaseline() {
    const ws = window.Ultrascripts?.ws;
    const actions = ws?.getActions ? Array.from(ws.getActions().values()) : [];
    const liveActions = actions.filter(action => this.isLiveAction(action));
    let tail = ws?.getTail?.() || liveActions[liveActions.length - 1]?.id || null;
    let warmTailUsed = false;
    if (actions.length === 0) {
      const reader = window.BetterDungeonAdventureRead;
      const shortId = ws?.getAdventureShortId?.() || null;
      const warmTail = reader?.getLatestActionId?.();
      if (warmTail?.id != null && (!shortId || !warmTail.shortId || warmTail.shortId === shortId)) {
        tail = warmTail.id;
        warmTailUsed = true;
      } else {
        reader?.refreshLatestActionId?.({ shortId }).catch?.(() => {});
      }
    }
    const liveCount = Number.isFinite(ws?.getLiveCount?.())
      ? ws.getLiveCount()
      : liveActions.length;

    let tailNum = -Infinity;
    for (const action of liveActions) {
      const idNum = Number(action.id);
      if (Number.isFinite(idNum) && idNum > tailNum) tailNum = idNum;
    }
    if (warmTailUsed && !Number.isFinite(tailNum) && Number.isFinite(Number(tail))) {
      tailNum = Number(tail);
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

  detectCurrentInputMode() {
    const modeButton = document.querySelector(this.inputModeMenuSelector);
    const modeText = modeButton?.querySelector('.font_body');
    return modeText ? modeText.textContent.toLowerCase().trim() : null;
  }

  log(...args) {
    if (this.debug) console.log(...args);
  }

  warnOnce(key, ...args) {
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    console.warn(...args);
  }
}

if (typeof window !== 'undefined') {
  window.AutoSeeFeature = AutoSeeFeature;
}
