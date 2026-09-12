// Run this page in an ordinary browser: real DOM, MutationObserver, focus,
// keyboard events and animation frames, without a DOM emulation dependency.
(async () => {
  const output = document.getElementById('results');
  const fixture = document.getElementById('fixture');
  const aid = new AIDungeonService();
  const messages = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, message) => {
    const deadline = Date.now() + 5000;
    while (!condition() && Date.now() < deadline) await sleep(50);
    assert(condition(), message);
  };
  const settle = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (aid.getModeButtonByName('command') && aid.getModeButtonByName('try')) return;
      await sleep(50);
    }
    throw new Error('Custom modes did not settle within five seconds');
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  let nativeClicks = [], generated = 0, command, attempt, colors;
  const modeNames = ['Do', 'Say', 'Story', 'Guide'];
  const nativeButton = (name, mobile) => mobile
    ? `<div role="menuitemradio" aria-checked="${name === 'Do'}" tabindex="-1" data-radix-collection-item=""><span data-slot="aid-dropdown-menu-radio-indicator-container"></span><svg aria-hidden="true"></svg>${name}</div>`
    : `<div role="button" aria-label="Set to '${name}' mode"><span class="font_icons">w_run</span><span class="font_body">${name}</span></div>`;

  function render(layout) {
    const mobile = layout === 'mobile';
    fixture.innerHTML = `<div id="game-text-input-controller"><div><textarea id="game-text-input"></textarea><button aria-label="Submit action"><span class="font_icons">w_run</span></button></div><button aria-label="Change input mode" ${mobile ? 'aria-haspopup="menu" aria-expanded="false"' : ''}><span class="font_body">do</span></button></div>`;
    const trigger = aid.getModeButton();
    function open() {
      if (aid.getInputModeMenu()) return;
      const menu = document.createElement('div');
      if (mobile) {
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Input mode');
        menu.setAttribute('data-state', 'open');
        menu.innerHTML = `<div role="group"><div data-slot="aid-dropdown-menu-label">Write</div>${modeNames.map(n => nativeButton(n, true)).join('')}<div role="separator"></div><div data-slot="aid-dropdown-menu-label">Create</div>${['Image', 'Video'].map(n => nativeButton(n, true)).join('')}</div><div role="menuitem" tabindex="-1">Customize video…</div>`;
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        const names = layout === 'legacy' ? [...modeNames, 'See'] : modeNames;
        menu.innerHTML = `<button aria-label="Close 'Input Mode' menu">Back</button>${names.map(n => nativeButton(n, false)).join('')}`;
        if (layout !== 'legacy') menu.innerHTML += '<button role="button" aria-label="Generate an image">Image</button><button role="button" aria-label="Generate a video">Video</button>';
      }
      fixture.append(menu);
      const close = () => { menu.remove(); trigger.setAttribute('aria-expanded', 'false'); };
      menu.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
      menu.querySelector('[aria-label="Close \'Input Mode\' menu"]')?.addEventListener('click', close);
      menu.querySelectorAll('[role="button"], [role="menuitemradio"], button').forEach(button => {
        button.addEventListener('click', () => {
          const name = aid.getInputMenuEntryName(button);
          if (name === 'image' || name === 'video') { generated++; if (mobile) close(); return; }
          if (!name) return;
          nativeClicks.push(name);
          trigger.querySelector('.font_body').textContent = name;
          if (mobile) close();
        });
      });
    }
    trigger.addEventListener(mobile ? 'keydown' : 'click', e => {
      if (!mobile || ['ArrowDown', 'Enter', ' '].includes(e.key)) open();
    });
  }

  try {
    const params = new URLSearchParams(location.search);
    if (['try', 'command'].includes(params.get('demo'))) {
      render('mobile');
      fixture.className = 'demo';
      fixture.style.width = `${Math.max(280, Math.min(700, Number(params.get('width')) || 390))}px`;
      command = new CommandFeature(); attempt = new TryFeature(); colors = new InputModeColorFeature();
      command.setupObserver(); attempt.setupObserver(); colors.setupObserver();
      await aid.openModeMenu(); await settle();
      aid.getModeButtonByName(params.get('demo')).click();
      await until(() => fixture.querySelector('.bd-compact-mode-controls'), 'Demo controls appeared');
      output.textContent = 'Interactive compact controls — offline, no submissions.';
      return;
    }
    for (const layout of ['desktop', 'legacy', 'mobile']) {
      nativeClicks = []; generated = 0;
      render(layout);
      command = new CommandFeature(); attempt = new TryFeature(); colors = new InputModeColorFeature();
      // Test the real observers and injection, without storage / network setup.
      command.setupObserver(); attempt.setupObserver(); colors.setupObserver();
      assert(await aid.openModeMenu(), `${layout}: open menu`);
      await settle();
      const firstCommand = aid.getModeButtonByName('command');
      const firstTry = aid.getModeButtonByName('try');
      assert(firstCommand && firstTry, `${layout}: both modes inserted`);
      assert(aid.getInputMenuEntryName(firstTry.previousElementSibling) === 'do', `${layout}: Try follows Do`);
      assert(aid.getInputMenuEntryName(firstCommand.previousElementSibling) === (layout === 'legacy' ? 'see' : 'guide'), `${layout}: Command follows last mode`);
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(aid.getInputModeMenu(), { childList: true, subtree: true });
      for (let i = 0; i < 50; i++) { command.injectCommandButton(); attempt.injectTryButton(); colors.detectAndApplyColor(); }
      await sleep(180);
      assert(mutations === 0, `${layout}: menu must settle, observed ${mutations} mutations`);
      assert(aid.getModeButtonByName('command') === firstCommand && aid.getModeButtonByName('try') === firstTry, `${layout}: retain button identity`);
      observer.disconnect();
      const hotkeys = new HotkeyFeature();
      const migrated = HotkeyFeature.migrateBindings({9: 'modeSee'});
      assert(migrated[9] === 'generateImage' && !Object.values(HotkeyFeature.DEFAULT_BINDINGS).includes('generateVideo'), 'saved hotkeys migrate; Video remains unbound');
      assert(hotkeys.getMenuActionTarget({actionId:'generateImage'}), `${layout}: Image hotkey resolves`);
      if (layout !== 'legacy') {
        assert(!aid.getAllModeButtons().includes(aid.getGenerateButton('image')), `${layout}: media is not a mode`);
        assert(aid.getGenerateButton('image').dataset.bdModeStyled === 'image', `${layout}: Image color`);
        assert(aid.getGenerateButton('video').dataset.bdModeStyled === 'video', `${layout}: Video color`);
      }
      if (layout === 'mobile') {
        aid.getModeButtonByName('do').focus();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
        assert(document.activeElement === firstTry, 'mobile: arrow navigation includes Try');
        assert(firstTry.textContent === 'Try' && !firstTry.querySelector('svg'), 'mobile: no cloned Do text or icon');
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      } else firstTry.click();
      await until(() => attempt.isTryMode && aid.detectCurrentMode() === 'try' && nativeClicks.at(-1) === 'do', `${layout}: Try activates native Do`);
      if (layout === 'mobile') {
        const bar = document.getElementById('bd-success-bar-container');
        assert(bar.parentElement.id === 'game-text-input-controller', 'mobile: Try bar outside clipped input row');
        const up = bar.querySelector('#bd-weight-up');
        assert(up.getBoundingClientRect().width >= 44 && up.getBoundingClientRect().height >= 44, 'mobile: Try touch target');
        up.click();
        assert(attempt.getSuccessChance() === 55 && bar.querySelector('#bd-success-percent').textContent === '55%', 'mobile: increase chance');
        for (let i=0;i<20;i++) up.click();
        assert(attempt.getSuccessChance() === 95 && up.disabled, 'mobile: clamp and disable upper limit');
        bar.querySelector('#bd-weight-down').click();
        assert(attempt.getSuccessChance() === 90 && !up.disabled, 'mobile: decrease re-enables upper control');
      }
      assert(await aid.openModeMenu(), `${layout}: reopen`); await sleep(100);
      assert(attempt.isTryMode, `${layout}: opening menu preserves Try`);
      aid.closeModeMenu(); await sleep(60);
      assert(attempt.isTryMode, `${layout}: dismissing menu preserves Try`);
      await aid.openModeMenu(); await settle();
      aid.getModeButtonByName('command').click();
      await until(() => command.isCommandMode && !attempt.isTryMode && aid.detectCurrentMode() === 'command' && nativeClicks.at(-1) === 'story', `${layout}: Command activates Story and cancels Try`);
      if (layout === 'mobile') {
        const bar = document.getElementById('bd-command-submode-bar');
        assert(bar.parentElement.id === 'game-text-input-controller' && !document.getElementById('bd-success-bar-container'), 'mobile: only active controls remain');
        const next = bar.querySelector('#bd-submode-next');
        assert(next.getBoundingClientRect().width >= 44 && next.getBoundingClientRect().height >= 44, 'mobile: Command touch target');
        next.click();
        assert(command.subMode === 'subtle' && aid.detectCurrentMode() === 'command', 'mobile: cycle command preserves logical mode');
        bar.querySelector('#bd-submode-prev').click();
        assert(command.subMode === 'standard', 'mobile: previous command style');
      }
      await aid.openModeMenu(); await settle();
      aid.getModeButtonByName('say').click(); await sleep(180);
      assert(!command.isCommandMode && aid.detectCurrentMode() === 'say', `${layout}: native mode cancels Command`);
      if (layout !== 'mobile') aid.closeModeMenu();
      await aid.openModeMenu(); await settle();
      const anchor = aid.getModeButtonByName(layout === 'legacy' ? 'see' : 'guide');
      const newMode = document.createElement('div');
      newMode.setAttribute('role',layout === 'mobile' ? 'menuitemradio' : 'button');
      newMode.setAttribute('aria-label',"Set to 'Explore' mode"); newMode.textContent = 'Explore';
      anchor.parentElement.insertBefore(newMode, aid.getModeButtonByName('command').nextSibling);
      await until(() => aid.getModeButtonByName('command')?.previousElementSibling === newMode, `${layout}: future mode reanchors once`);
      const movedCommand = aid.getModeButtonByName('command');
      for (let i=0;i<50;i++) command.injectCommandButton();
      assert(aid.getModeButtonByName('command') === movedCommand, `${layout}: reanchor settles`);
      if (layout === 'mobile') {
        newMode.remove();
        await new InputHistoryFeature().setInputMode('see');
        assert(aid.detectCurrentMode() === 'story' && generated === 0, 'history: legacy See falls back to Story without generating media');
      }
      command.destroy(); attempt.destroy(); colors.destroy();
      await sleep(180);
      assert(!fixture.querySelector('[data-bd-custom-mode]'), `${layout}: destroy removes custom entries`);
      assert(!aid.getInputModeMenu()?._bdModeKeyHandler, `${layout}: destroy removes keyboard handler`);
      assert(generated === 0, `${layout}: no accidental generation`);
      messages.push(`PASS ${layout}: placement, observer stability, colors, hotkeys, activation, dismissal, reanchor, cleanup`);
      output.textContent = messages.join('\n');
    }
    // React replaces the input around the 700px breakpoint; active overlays
    // must rebuild their controls without losing the user's mode or draft.
    for (const mode of ['try', 'command']) {
      render('desktop');
      command = new CommandFeature(); attempt = new TryFeature();
      command.setupObserver(); attempt.setupObserver();
      await aid.openModeMenu(); await settle();
      aid.getModeButtonByName(mode).click();
      await until(() => aid.detectCurrentMode() === mode, `${mode}: activate before resize`);
      for (const layout of ['mobile', 'desktop']) {
        render(layout);
        aid.getModeButton().querySelector('.font_body').textContent = mode === 'try' ? 'do' : 'story';
        document.getElementById('game-text-input').value = 'Unsubmitted draft';
        await until(() => aid.detectCurrentMode() === mode && fixture.querySelector(layout === 'mobile' ? '.bd-compact-mode-controls' : '#bd-success-bar-container:not(.bd-compact-mode-controls), #bd-command-submode-bar:not(.bd-compact-mode-controls)'), `${mode}: controls rebuild on ${layout}`);
        assert(document.getElementById('game-text-input').value === 'Unsubmitted draft', `${mode}: resize preserves draft`);
      }
      command.destroy(); attempt.destroy();
    }
    output.textContent += '\nPASS responsive replacement: active modes, control layout, draft preservation';
    output.textContent += '\nALL CHECKS PASSED';
    document.title = 'PASS — BetterDungeon input menu checks';
  } catch (error) {
    messages.push(JSON.stringify({commandWindow:command?._modeInjectionWindow, tryWindow:attempt?._modeInjectionWindow}));
    command?.destroy(); attempt?.destroy(); colors?.destroy();
    output.textContent = messages.join('\n') + '\nFAIL: ' + error.stack;
    document.title = 'FAIL — BetterDungeon input menu checks';
  }
})();
