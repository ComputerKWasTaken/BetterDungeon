// BetterDungeon - Navigator Session
//
// Owns a single adventure's Navigator conversation: the transcript, streaming
// request lifecycle, abort, input budgeting, and per-adventure persistence.
//
// The drawer UI talks only to this class, and this class talks only to the
// first-party chat surface on UltrascriptsAIExecutor. Grounding stays behind
// buildSystemInstruction() and buildRequestMessages() so later tools do not
// change the drawer contract.

(function () {
  if (typeof window === 'undefined' || window.NavigatorSession) return;

  const CONSUMER = 'navigator';
  const STORAGE_PREFIX = 'betterDungeon_navigator_session_';

  // Budget for the first-party chat surface. Independent of the frozen
  // script-facing ai.query cap, which stays at 12k characters.
  const MAX_INPUT_CHARS = 60000;
  const MAX_OUTPUT_TOKENS = 2048;
  const MAX_HISTORY_CHARS = 12000;

  // A single user turn longer than this can never fit alongside a system
  // instruction, so it is rejected before a request is attempted.
  const MAX_USER_MESSAGE_CHARS = 8000;

  // Persistence bounds. Transcripts are convenience state, not archives.
  const MAX_PERSISTED_MESSAGES = 80;
  const MAX_PERSISTED_CHARS = 120000;

  function createId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  class NavigatorSession {
    constructor(adventureId) {
      this.adventureId = adventureId || null;
      this.messages = [];
      this.listeners = new Set();
      this.controller = null;
      this.streamingMessageId = null;
      this.sending = false;
      this.loaded = false;
      this.saveTimer = null;
      this.contextReader = typeof NavigatorContext !== 'undefined'
        ? new NavigatorContext(this.adventureId)
        : null;
      this.contextSnapshot = null;
      this.contextState = 'idle';
      this.contextRevision = 0;
      this.contextControllers = new Set();
      this.debug = false;
    }

    log(message, ...args) {
      if (this.debug) console.log(message, ...args);
    }

    // ==================== SUBSCRIPTIONS ====================

    // Listeners receive (event, payload). Events:
    //   'reset'  — the whole transcript changed, re-render everything
    //   'append' — a single message was added
    //   'update' — a single message changed in place (streaming, completion)
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(event, payload) {
      for (const listener of this.listeners) {
        try {
          listener(event, payload);
        } catch (error) {
          console.error('[Navigator] Session listener failed:', error);
        }
      }
    }

    // ==================== STATE ====================

    // True from the moment a send is accepted until the turn settles, so the
    // async readiness check cannot be raced by a second submit.
    get isBusy() {
      return this.sending || this.streamingMessageId !== null;
    }

    getMessages() {
      return this.messages;
    }

    findMessage(id) {
      return this.messages.find(message => message.id === id) || null;
    }

    addMessage(message) {
      const record = {
        id: createId('msg'),
        createdAt: Date.now(),
        status: 'complete',
        content: '',
        ...message,
      };
      this.messages.push(record);
      this.emit('append', record);
      return record;
    }

    updateMessage(id, updates) {
      const message = this.findMessage(id);
      if (!message) return null;
      Object.assign(message, updates);
      this.emit('update', message);
      return message;
    }

    clear() {
      this.abort();
      this.messages = [];
      this.emit('reset', this.messages);
      this.persist();
    }

    // ==================== PERSISTENCE ====================

    get storageKey() {
      return this.adventureId ? `${STORAGE_PREFIX}${this.adventureId}` : null;
    }

    async load() {
      const key = this.storageKey;
      if (!key || !isExtensionContextValid()) {
        this.loaded = true;
        return;
      }

      const stored = await new Promise((resolve) => {
        try {
          chrome.storage.local.get(key, result => resolve((result || {})[key] || null));
        } catch {
          resolve(null);
        }
      });

      // A transcript persisted mid-stream is restored as an interrupted turn
      // rather than as a message that is still arriving.
      this.messages = Array.isArray(stored?.messages)
        ? stored.messages.map(message => (
          message.status === 'streaming' || message.status === 'pending'
            ? { ...message, status: message.content ? 'aborted' : 'error' }
            : message
        ))
        : [];
      this.loaded = true;
      this.emit('reset', this.messages);
    }

    // Debounced so streaming deltas do not thrash extension storage.
    schedulePersist() {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.persist();
      }, 500);
    }

    persist() {
      const key = this.storageKey;
      if (!key || !isExtensionContextValid()) return;

      let kept = this.messages.slice(-MAX_PERSISTED_MESSAGES);
      let total = kept.reduce((sum, message) => sum + (message.content?.length || 0), 0);
      while (kept.length > 1 && total > MAX_PERSISTED_CHARS) {
        total -= kept[0].content?.length || 0;
        kept = kept.slice(1);
      }

      try {
        chrome.storage.local.set({ [key]: { v: 1, messages: kept, updatedAt: Date.now() } });
      } catch (error) {
        this.log('[Navigator] Failed to persist transcript:', error);
      }
    }

    // ==================== GROUNDING ====================

    getContextSummary() {
      return {
        state: this.contextState,
        partial: this.contextSnapshot?.partial === true,
        capturedAtIso: this.contextSnapshot?.capturedAtIso || null,
        ...(this.contextSnapshot?.summary || {}),
      };
    }

    async refreshContext(options = {}) {
      if (!this.contextReader) {
        const error = {
          code: 'unavailable',
          message: 'Navigator adventure grounding is not loaded. Reload the page and try again.',
          retryable: true,
        };
        this.contextState = 'error';
        this.emit('context', this.getContextSummary());
        throw error;
      }

      const revision = ++this.contextRevision;
      const ownController = options.signal ? null : new AbortController();
      const signal = options.signal || ownController.signal;
      if (ownController) this.contextControllers.add(ownController);
      this.contextState = 'loading';
      this.emit('context', this.getContextSummary());

      try {
        const snapshot = await this.contextReader.build({ signal });
        if (revision === this.contextRevision) {
          this.contextSnapshot = snapshot;
          this.contextState = snapshot.partial ? 'partial' : 'ready';
          this.emit('context', this.getContextSummary());
        }
        return snapshot;
      } catch (error) {
        if (revision === this.contextRevision && String(error?.code || '').toLowerCase() !== 'aborted') {
          this.contextState = 'error';
          this.emit('context', this.getContextSummary());
        }
        throw error;
      } finally {
        if (ownController) this.contextControllers.delete(ownController);
      }
    }

    // ==================== PROVIDER READINESS ====================

    async checkReady() {
      const executor = window.UltrascriptsAIExecutor;
      if (!executor?.chat) {
        return { ready: false, message: 'The BetterDungeon AI layer is not loaded. Try reloading the page.' };
      }

      try {
        const status = executor.refreshStatus
          ? await executor.refreshStatus({ consumer: CONSUMER })
          : executor.status?.({ consumer: CONSUMER });
        if (status?.ready) return { ready: true, status };
        return {
          ready: false,
          status,
          message: `${status?.message || 'The configured AI provider is not ready.'} Open the BetterDungeon popup and go to Ultrascripts > AI to configure it.`,
        };
      } catch (error) {
        return {
          ready: false,
          message: `${error?.message || 'AI provider status could not be checked.'} Open the BetterDungeon popup and go to Ultrascripts > AI to configure it.`,
        };
      }
    }

    // ==================== REQUEST ASSEMBLY ====================

    async buildSystemInstruction(signal) {
      const snapshot = await this.refreshContext({ signal });
      return snapshot.systemInstruction;
    }

    // Select the newest history that fits the input budget. The final user
    // message is mandatory; older turns are dropped oldest-first to make room.
    buildRequestMessages(systemInstruction) {
      const usable = this.messages.filter(message => (
        (message.role === 'user' || message.role === 'assistant') &&
        message.status !== 'error' &&
        message.excluded !== true &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0
      ));

      if (!usable.length || usable[usable.length - 1].role !== 'user') {
        throw new Error('Navigator has no pending question to send.');
      }

      const budget = Math.min(MAX_HISTORY_CHARS, MAX_INPUT_CHARS - systemInstruction.length);
      const selected = [];
      let used = 0;

      for (let i = usable.length - 1; i >= 0; i--) {
        const length = usable[i].content.length;
        if (used + length > budget) break;
        selected.unshift({ role: usable[i].role, content: usable[i].content });
        used += length;
      }

      if (!selected.length || selected[selected.length - 1].role !== 'user') {
        throw new Error('That message is too long for Navigator to send. Try shortening it.');
      }

      // A leading assistant turn is a truncation artifact, not a real opening.
      while (selected.length && selected[0].role === 'assistant') {
        selected.shift();
      }

      return {
        messages: selected,
        truncated: selected.length < usable.length,
        historyChars: selected.reduce((sum, message) => sum + message.content.length, 0),
        omittedMessages: Math.max(0, usable.length - selected.length),
      };
    }

    // ==================== SEND ====================

    async send(text) {
      const trimmed = String(text || '').trim();
      if (!trimmed) return;
      if (this.isBusy) return;

      this.sending = true;
      try {
        await this.runTurn(trimmed);
      } finally {
        this.sending = false;
        this.emit('idle', null);
      }
    }

    async runTurn(trimmed) {
      if (trimmed.length > MAX_USER_MESSAGE_CHARS) {
        this.addMessage({ role: 'user', content: trimmed });
        this.addMessage({
          role: 'assistant',
          status: 'error',
          content: '',
          error: {
            code: 'invalid_args',
            message: `That message is ${trimmed.length} characters. Navigator accepts up to ${MAX_USER_MESSAGE_CHARS}.`,
          },
        });
        this.persist();
        return;
      }

      this.addMessage({ role: 'user', content: trimmed });

      const ready = await this.checkReady();
      if (!ready.ready) {
        this.addMessage({
          role: 'assistant',
          status: 'error',
          content: '',
          error: { code: 'not_configured', message: ready.message },
        });
        this.persist();
        return;
      }

      const assistant = this.addMessage({ role: 'assistant', status: 'pending', content: '' });
      this.streamingMessageId = assistant.id;
      const turnController = new AbortController();
      this.controller = turnController;

      let request;
      try {
        const systemInstruction = await this.buildSystemInstruction(turnController.signal);
        const built = this.buildRequestMessages(systemInstruction);
        request = {
          systemInstruction,
          messages: built.messages,
          truncated: built.truncated,
          historyChars: built.historyChars,
          omittedMessages: built.omittedMessages,
        };
      } catch (error) {
        this.finishWithError(
          assistant.id,
          error?.code ? error : { code: 'invalid_args', message: error?.message || 'Navigator context could not be assembled.' }
        );
        return;
      }

      if (request.truncated) {
        this.updateMessage(assistant.id, { truncated: true });
      }

      try {
        const result = await window.UltrascriptsAIExecutor.chat({
          systemInstruction: request.systemInstruction,
          messages: request.messages,
          budget: { maxInputChars: MAX_INPUT_CHARS, maxOutputTokens: MAX_OUTPUT_TOKENS },
          thinking: { level: 'low' },
        }, {
          consumer: CONSUMER,
          requestId: `navigator-${this.adventureId || 'unknown'}-${Date.now()}`,
          signal: turnController.signal,
          onDelta: (delta) => {
            if (this.streamingMessageId !== assistant.id) return;
            const message = this.findMessage(assistant.id);
            if (!message) return;
            message.content += delta.text;
            message.status = 'streaming';
            this.emit('update', message);
            this.schedulePersist();
          },
        });

        if (this.streamingMessageId !== assistant.id) return;
        this.streamingMessageId = null;
        this.controller = null;
        this.updateMessage(assistant.id, {
          status: 'complete',
          content: typeof result?.text === 'string' && result.text ? result.text : (this.findMessage(assistant.id)?.content || ''),
          meta: result?.meta || null,
        });
        this.persist();
      } catch (error) {
        if (this.streamingMessageId !== assistant.id) return;
        this.finishWithError(assistant.id, error);
      }
    }

    finishWithError(messageId, error) {
      this.streamingMessageId = null;
      this.controller = null;

      const message = this.findMessage(messageId);
      const partial = message?.content || '';
      const code = String(error?.code || '').toLowerCase();

      // An aborted turn with partial text is kept as a readable partial answer.
      if (code === 'aborted') {
        this.updateMessage(messageId, { status: partial ? 'aborted' : 'error', error: partial ? null : this.describeError(error) });
      } else {
        this.updateMessage(messageId, { status: 'error', error: this.describeError(error) });
      }

      // A provider refusal is caused by the content of the turn that triggered
      // it. Left in history it would re-trigger on every later request, so the
      // offending user message is dropped from future context. It stays visible
      // in the transcript.
      if (code === 'prohibited_content' || code === 'safety_blocked') {
        this.excludePrecedingUserMessage(messageId);
      }

      this.persist();
    }

    excludePrecedingUserMessage(assistantMessageId) {
      const index = this.messages.findIndex(message => message.id === assistantMessageId);
      for (let i = index - 1; i >= 0; i--) {
        if (this.messages[i].role === 'user') {
          this.updateMessage(this.messages[i].id, { excluded: true });
          return;
        }
      }
    }

    describeError(error) {
      const code = String(error?.code || '').toLowerCase();
      switch (code) {
        case 'prohibited_content':
          return { code, message: 'The AI provider refused this request under its content policy. This is a known limitation while Gemini is the only provider.' };
        case 'safety_blocked':
          return { code, message: 'The AI provider blocked this request under its safety filters. Try rephrasing.' };
        case 'not_configured':
        case 'auth_failed':
          return { code, message: 'Navigator needs an AI provider. Open the BetterDungeon popup and go to Ultrascripts > AI.' };
        case 'rate_limit':
          return { code, message: 'The AI provider hit a rate limit. Wait a moment and try again.' };
        case 'timeout':
          return { code, message: 'The AI provider took too long to respond. Try again.' };
        case 'aborted':
          return { code, message: 'Stopped.' };
        default:
          return {
            code: code || 'unknown',
            message: error?.message || 'Navigator could not complete that request.',
          };
      }
    }

    abort() {
      if (!this.controller) return;
      try {
        this.controller.abort();
      } catch {
        /* noop */
      }
      this.controller = null;
    }

    destroy() {
      this.abort();
      for (const controller of this.contextControllers) {
        try { controller.abort(); } catch { /* noop */ }
      }
      this.contextControllers.clear();
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        this.persist();
      }
      this.listeners.clear();
    }
  }

  NavigatorSession.CONSUMER = CONSUMER;
  NavigatorSession.MAX_INPUT_CHARS = MAX_INPUT_CHARS;
  NavigatorSession.MAX_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS;
  NavigatorSession.MAX_HISTORY_CHARS = MAX_HISTORY_CHARS;
  NavigatorSession.MAX_USER_MESSAGE_CHARS = MAX_USER_MESSAGE_CHARS;

  window.NavigatorSession = NavigatorSession;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigatorSession;
  }
})();
