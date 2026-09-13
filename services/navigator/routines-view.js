// Navigator's Routines editor and activity navigation. All adventure work stays
// in NavigatorSession; this view only selects conversations and queues work.
(function () {
  'use strict';
  if (globalThis.NavigatorRoutinesView) return;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, fn) => {
    const node = element('button', 'bd-routine-button', label);
    node.type = 'button';
    node.addEventListener('click', fn);
    return node;
  };

  class NavigatorRoutinesView {
    constructor(feature) {
      this.feature = feature;
      this.runner = feature.routines;
      this.view = 'chat';
      this.renderVersion = 0;
      this.fileRequests = new Map();
      this.nav = element('nav', 'bd-routine-nav');
      this.nav.setAttribute('aria-label', 'Navigator views');
      for (const [view, label] of [['chat', 'Chat'], ['routines', 'Routines'], ['activity', 'Activity']]) {
        const tab = button(label, () => this.show(view));
        tab.dataset.view = view;
        this.nav.append(tab);
      }
      feature.drawer.querySelector('.bd-navigator-header').after(this.nav);
      this.panel = element('section', 'bd-routine-panel');
      this.panel.hidden = true;
      feature.transcriptEl.before(this.panel);
      this.threadLabel = element('div', 'bd-routine-thread-label');
      this.threadLabel.hidden = true;
      feature.transcriptEl.before(this.threadLabel);
      this.status = element('div', 'bd-routine-status');
      this.status.setAttribute('role', 'status');
      this.status.hidden = true;
      this.notice = element('div', 'bd-routine-notice');
      this.notice.setAttribute('role', 'status');
      this.notice.hidden = true;
      document.body.append(this.status, this.notice);
      this.nativeCallback = (requestId, result) => {
        const pending = this.fileRequests.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.fileRequests.delete(requestId);
        if (result?.error) pending.reject(new Error(result.error));
        else pending.resolve(result?.cancelled ? null : result?.text ?? '');
      };
      if (globalThis.BetterDungeonPlatform?.has('nativeBridge')) globalThis.__bdRoutineFileResult = this.nativeCallback;
      this.show('chat');
    }

    owns(node) { return this.status.contains(node) || this.notice.contains(node); }

    async show(view, routineId = null, runId = null) {
      const version = ++this.renderVersion;
      this.view = view;
      this.editing = false;
      const feature = this.feature;
      feature.setInspectorOpen(false, { focus: false });
      feature.settingsPanel.hidden = true;
      feature.drawer.classList.remove('bd-navigator-secondary-open');
      this.panel.replaceChildren();
      this.panel.hidden = !['routines', 'activity'].includes(view);
      feature.drawer.dataset.routineView = view;
      feature.transcriptEl.hidden = this.panel.hidden === false;
      feature.composerEl.hidden = this.panel.hidden === false;
      feature.inspectionToggle.disabled = !this.panel.hidden;
      this.threadLabel.hidden = view !== 'thread';
      for (const tab of this.nav.children) {
        tab.setAttribute('aria-current', String(tab.dataset.view === (view === 'thread' ? 'activity' : view)));
      }
      try {
        if (view === 'chat') feature.selectSession(feature.chatSession);
        else if (view === 'routines') this.renderRules();
        else if (view === 'activity') await this.renderActivity(version);
        else if (view === 'thread') {
          const session = await this.runner.sessionFor(routineId);
          if (version !== this.renderVersion) return;
          if (!session.isBusy) await session.refreshStoredConversation();
          if (version !== this.renderVersion) return;
          feature.selectSession(session);
          const name = this.runner.rules.find(rule => rule.id === routineId)?.name || 'Routine history';
          this.threadLabel.replaceChildren(button('← Activity', () => this.show('activity')), element('span', '', name));
          if (runId) {
            const message = session.getMessages().find(item => item.runId === runId);
            feature.messageNodes.get(message?.id)?.node.scrollIntoView({ block: 'start' });
          }
        }
      } catch (error) { this.error(error); }
      feature.updateComposerState();
    }

    error(error) {
      const node = element('p', 'bd-routine-error', error?.message || 'Routines could not complete that action.');
      node.setAttribute('role', 'alert');
      this.panel.querySelector('.bd-routine-error')?.remove();
      this.panel.prepend(node);
    }

    async act(operation) {
      try { await operation(); } catch (error) { this.error(error); }
    }

    renderRules() {
      this.panel.replaceChildren();
      this.panel.append(element('p', 'bd-routine-hint', 'Enabled Routines run in every adventure on this device. Each uses Navigator’s AI connection and this adventure’s change settings.'));
      const actions = element('div', 'bd-routine-actions');
      actions.append(button('New Routine', () => this.editor()), button('Import', () => this.act(() => this.importFile())), button('Export', () => this.act(() => this.exportFile())));
      this.panel.append(actions);
      if (this.runner.error) this.panel.append(element('p', 'bd-routine-error', this.runner.error));
      if (!this.runner.rules.length) this.panel.append(element('p', 'bd-routine-hint', 'Create a Routine with instructions for Navigator.'));
      for (const rule of this.runner.rules) {
        const card = element('article', 'bd-routine-card');
        const row = element('div', 'bd-routine-row');
        const label = element('label', 'bd-routine-toggle');
        const input = element('input');
        input.type = 'checkbox';
        input.checked = rule.enabled;
        input.setAttribute('aria-label', `Enable ${rule.name} in every adventure`);
        input.addEventListener('change', () => this.act(async () => {
          input.disabled = true;
          try { await this.runner.saveRule({ ...rule, enabled: input.checked }); this.renderRules(); }
          finally { input.disabled = false; }
        }));
        label.append(input, element('strong', '', rule.name));
        row.append(label, button('Edit', () => this.editor(rule)));
        card.append(row, element('p', 'bd-routine-hint', `Every ${rule.interval} action${rule.interval === 1 ? '' : 's'} · ${rule.enabled ? 'On in all adventures' : 'Off'}`));
        if (rule.interval <= 2) card.append(element('p', 'bd-routine-hint', 'Frequent runs can use substantial provider quota or paid usage.'));
        const preview = element('p', 'bd-routine-preview', rule.instruction);
        card.append(preview);
        this.panel.append(card);
      }
    }

    editor(existing = null) {
      this.editing = true;
      this.panel.replaceChildren();
      const rule = existing || { id: NavigatorRoutines.createId(), name: '', instruction: '', interval: 5, enabled: false };
      this.panel.append(element('h3', '', existing ? 'Edit Routine' : 'New Routine'));
      const field = (label, tag, value, maxLength) => {
        const wrapper = element('label', 'bd-routine-field');
        const input = element(tag);
        input.value = value;
        if (maxLength) input.maxLength = maxLength;
        wrapper.append(element('span', '', label), input);
        this.panel.append(wrapper);
        return input;
      };
      const name = field('Name', 'input', rule.name, 80);
      const instruction = field('Instructions for Navigator', 'textarea', rule.instruction, 7000);
      instruction.rows = 8;
      const interval = field('Every N actions', 'input', rule.interval);
      interval.type = 'number'; interval.min = '1'; interval.max = '100'; interval.step = '1';
      const enabled = element('input'); enabled.type = 'checkbox'; enabled.checked = rule.enabled;
      const toggle = element('label', 'bd-routine-toggle');
      toggle.append(enabled, element('span', '', 'Enabled in every adventure on this device'));
      this.panel.append(toggle);
      const warning = element('p', 'bd-routine-hint', 'Frequent runs can use substantial provider quota or paid usage.');
      const updateWarning = () => { warning.hidden = Number(interval.value) > 2; };
      interval.addEventListener('input', updateWarning); updateWarning();
      this.panel.append(warning);
      const actions = element('div', 'bd-routine-actions');
      const save = button('Save Routine', () => this.act(async () => {
        save.disabled = true;
        try {
          await this.runner.saveRule({ id: rule.id, name: name.value, instruction: instruction.value, interval: Number(interval.value), enabled: enabled.checked });
          this.show('routines');
        } finally { save.disabled = false; }
      }));
      actions.append(save, button('Cancel', () => this.show('routines')));
      if (existing) actions.append(button('Delete', () => this.act(async () => {
        const confirmed = await this.feature.showConfirmation({ title: 'Delete Routine?', message: 'Remove this Routine from every adventure on this device? Past activity is retained. A current run will finish.', confirmLabel: 'Delete Routine', danger: true });
        if (confirmed) { await this.runner.removeRule(rule.id); this.show('routines'); }
      })));
      this.panel.append(actions);
      name.focus();
    }

    async renderActivity(version = this.renderVersion) {
      const activity = await this.runner.readActivity();
      if (this.view !== 'activity' || version !== this.renderVersion) return;
      this.panel.replaceChildren(element('p', 'bd-routine-hint', 'Routine activity for this adventure. Open a run to review its changes or reply in that Routine’s conversation. History is kept locally and older entries are trimmed.'));
      if (!activity.length) this.panel.append(element('p', '', 'No Routine runs yet.'));
      for (const record of activity) {
        const card = element('article', 'bd-routine-card');
        const row = element('div', 'bd-routine-row');
        row.append(element('strong', '', record.name), button('Open', () => this.show('thread', record.routineId, record.id)));
        const labels = { approval: 'Approval needed', expired: 'Approval expired', complete: 'Complete', error: 'Needs attention', stopped: 'Stopped', interrupted: 'Interrupted', running: 'Working' };
        card.append(row, element('p', 'bd-routine-hint', `${labels[record.status] || record.status} · ${record.milestone ? `Action ${record.milestone}` : 'Follow-up'} · ${new Date(record.startedAt).toLocaleString()}`));
        if (record.applied) card.append(element('p', 'bd-routine-hint', `${record.applied} change${record.applied === 1 ? '' : 's'} applied`));
        if (record.summary) card.append(element('p', 'bd-routine-preview', record.summary));
        if (record.status === 'expired') card.append(element('p', 'bd-routine-hint', 'The page reloaded before review. Open the conversation and ask Navigator for a fresh proposal.'));
        this.panel.append(card);
      }
    }

    async openActivity(record = null) {
      try {
        if (!this.feature.activateSettingsNavigator()) {
          await new globalThis.AIDungeonService().navigateToGameplaySettings();
          if (!this.feature.activateSettingsNavigator()) throw new Error('Open Game Menu → Gameplay → Navigator to review this run.');
        }
        await this.show(record?.routineId ? 'thread' : 'activity', record?.routineId, record?.id);
      } catch (error) { this.notice.hidden = false; this.notice.textContent = error.message; }
    }

    changed(notice) {
      if (this.destroyed) return;
      const active = this.runner.active;
      this.status.replaceChildren();
      this.status.hidden = !active && !this.runner.manual.length;
      if (active) {
        const name = active.record?.name || this.runner.rules.find(rule => rule.id === active.ruleId)?.name || 'Navigator';
        this.status.append(button(`${name} · working`, () => active.session?.routineId ? this.openActivity(active.record || { routineId: active.session.routineId }) : this.openChat()), button('Stop', () => this.runner.stop()));
      }
      if (this.runner.manual.length) this.status.append(button('Message waiting · cancel', () => {
        const [waiting] = this.runner.cancelWaiting();
        if (waiting?.text && waiting.session === this.feature.session && !this.feature.inputEl.value) {
          this.feature.inputEl.value = waiting.text;
          this.feature.autosizeInput();
        }
      }));
      if (notice?.record) {
        const record = notice.record;
        const result = record.status === 'error' ? 'needs attention' : record.pending ? 'approval needed' : `${record.applied} change${record.applied === 1 ? '' : 's'} applied`;
        this.notice.replaceChildren(button(`${record.name}: ${result}`, () => record.routineId ? this.openActivity(record) : this.openChat()), button('Dismiss', () => { this.notice.hidden = true; }));
        this.notice.hidden = false;
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => { this.notice.hidden = true; }, 10000);
      }
      if (this.view === 'activity') void this.renderActivity().catch(error => this.error(error));
      // Avoid replacing editor inputs while storage or streaming events arrive.
      if (this.view === 'routines' && !this.editing) this.renderRules();
      this.feature.updateComposerState();
    }

    async openChat() {
      await this.openActivity();
      await this.show('chat');
    }

    nativeFile(operation, text = '') {
      return new Promise((resolve, reject) => {
        const requestId = NavigatorRoutines.createId();
        const timer = setTimeout(() => {
          this.fileRequests.delete(requestId);
          reject(new Error('The file operation timed out. Try again.'));
        }, 300000);
        this.fileRequests.set(requestId, { resolve, reject, timer });
        try {
          if (operation === 'import') globalThis.BetterDungeonBridge.openRoutineFile(requestId);
          else globalThis.BetterDungeonBridge.saveRoutineFile(requestId, text);
        } catch (error) { clearTimeout(timer); this.fileRequests.delete(requestId); reject(error); }
      });
    }

    async importFile() {
      let text;
      if (globalThis.BetterDungeonPlatform?.has('nativeBridge')) text = await this.nativeFile('import');
      else text = await new Promise((resolve, reject) => {
        const input = element('input');
        input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
        this.panel.append(input);
        input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
        input.addEventListener('change', async () => {
          try {
            const file = input.files?.[0];
            if (!file) return resolve(null);
            if (file.size > NavigatorRoutines.MAX_FILE_BYTES) throw new Error('Choose a Routine file smaller than 1 MB.');
            resolve(await file.text());
          } catch (error) { reject(error); } finally { input.remove(); }
        }, { once: true });
        input.click();
      });
      if (text === null || this.destroyed) return;
      await this.runner.importRules(text);
      this.show('routines');
      this.panel.prepend(element('p', 'bd-routine-hint', 'Imported as new, disabled copies. Review each Routine before enabling it.'));
    }

    async exportFile() {
      const text = this.runner.exportRules();
      if (globalThis.BetterDungeonPlatform?.has('nativeBridge')) { await this.nativeFile('export', text); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = element('a'); link.href = url; link.download = 'BetterDungeon-Routines.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    destroy() {
      this.destroyed = true;
      this.renderVersion++;
      clearTimeout(this.noticeTimer);
      for (const pending of this.fileRequests.values()) { clearTimeout(pending.timer); pending.resolve(null); }
      this.fileRequests.clear();
      if (globalThis.__bdRoutineFileResult === this.nativeCallback) delete globalThis.__bdRoutineFileResult;
      this.nav.remove(); this.panel.remove(); this.threadLabel.remove(); this.status.remove(); this.notice.remove();
    }
  }
  globalThis.NavigatorRoutinesView = NavigatorRoutinesView;
})();
