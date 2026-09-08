// ═══ mobile_settings_layer.js ═══
// Injects BetterDungeon settings access directly into the AI Dungeon UI on mobile.

(function() {
    'use strict';

    console.log('[BetterDungeon] Starting Mobile Settings Layer Injection');

    const settingsCogSvg = `
<svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="url(#bd-gradient-cog)" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bd-gradient-cog" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="var(--bd-accent-primary)" />
      <stop offset="100%" stop-color="var(--bd-accent-secondary)" />
    </linearGradient>
  </defs>
  <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
</svg>
    `;

    const gearAdventureHtml = `
<span class="bd-mobile-settings t_sub_theme t_gameplayTopButton is_Theme" style="color: var(--color); display: contents;"><div id="bd-game-settings-button" aria-label="BetterDungeon Settings" role="button" style="background-color: rgba(0,0,0,1) !important;" class="is_Button is_View _bg-0hover-backgroundH3423444 _btc-0hover-borderColor69916956 _brc-0hover-borderColor69916956 _bbc-0hover-borderColor69916956 _blc-0hover-borderColor69916956 _bxsh-0hover-0px0px0pxva926910726 _bg-0active-backgroundP3496915 _btc-0active-borderColor77378595 _brc-0active-borderColor77378595 _bbc-0active-borderColor77378595 _blc-0active-borderColor77378595 _bxsh-0active-0px0px0pxva695599917 _bg-0focus-backgroundF3405682 _btc-0focus-borderColor68052152 _brc-0focus-borderColor68052152 _bbc-0focus-borderColor68052152 _blc-0focus-borderColor68052152 _bxsh-0focus-0px0px0pxva984719650 _cur-pointer _ussel-none _ox-visible _oy-visible _pos-relative _jc-center _ai-center _h-t-size-5 _btlr-t-radius-10 _btrr-t-radius-10 _bbrr-t-radius-10 _bblr-t-radius-10 _pr-t-space-0 _pl-t-space-0 _fd-row _bg-blackA7 _btc-borderColor _brc-borderColor _bbc-borderColor _blc-borderColor _btw-1px _brw-1px _bbw-1px _blw-1px _gap-t-space-1 _outlineColor-coreA0 _pt-t-space-0 _pb-t-space-0 _w-t-size-5 _mah-t-size-5 _maw-t-size-5 _bbs-solid _bts-solid _bls-solid _brs-solid _bxsh-0px0px0pxva26674076"><div class="is_View _pos-relative _fd-column _t-2--6537 _l-0px _ai-center _jc-center">
${settingsCogSvg}
</div></div></span>
    `;

    // Clone the current drawer action so the injected control inherits AI
    // Dungeon's live styling instead of relying on hashed class names.
    function createDrawerSettingsButton(sourceButton) {
        const button = sourceButton.cloneNode(true);
        const icon = button.querySelector('.font_icons');
        const label = Array.from(button.querySelectorAll('span'))
            .find(span => span.textContent.trim() === 'Guidebook');
        if (!icon || !label) return null;

        button.classList.add('bd-mobile-settings');
        button.setAttribute('aria-label', 'BetterDungeon Settings');
        button.setAttribute('title', 'BetterDungeon Settings');
        button.removeAttribute('aria-haspopup');
        button.removeAttribute('aria-expanded');
        button.removeAttribute('data-state');
        button.removeAttribute('data-slot');
        button.removeAttribute('id');
        icon.outerHTML = settingsCogSvg.trim();
        label.textContent = 'BetterDungeon';
        button.addEventListener('click', onSettingsClick);
        return button;
    }

    function onSettingsClick(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        console.log('[BetterDungeon] Triggering Settings Popup');
        if (window.BetterDungeonBridge && typeof window.BetterDungeonBridge.showPopup === 'function') {
            window.BetterDungeonBridge.showPopup();
        } else {
            console.warn('[BetterDungeon] BetterDungeonBridge is not available.');
        }
    }
    function injectSettingsButtons() {
        // 1. Home Page Target - directly above Guidebook in the drawer.
        const guidebookButtons = document.querySelectorAll('button[aria-label="Guidebook"]');
        guidebookButtons.forEach(guidebookButton => {
            const drawerGroup = guidebookButton.parentElement;
            if (!drawerGroup || drawerGroup.querySelector('.bd-mobile-settings')) return;

            const node = createDrawerSettingsButton(guidebookButton);
            if (node) drawerGroup.insertBefore(node, guidebookButton);
        });

        // 2. Adventure Page Target (next to the Model Switcher / Undo / Redo)
        // Find the specific wrapper by looking for the "Game settings" or "Undo change" aria-labels
        const adventureMenuTargets = document.querySelectorAll('div[aria-label="Game settings"]');
        adventureMenuTargets.forEach(target => {
            const rowWrapper = target.closest('.is_Row');
            if (rowWrapper && rowWrapper.querySelector('div[aria-label="Undo change"]') && !rowWrapper.querySelector('.bd-mobile-settings')) {
                const template = document.createElement('template');
                template.innerHTML = gearAdventureHtml.trim();
                const node = template.content.firstChild;
                node.addEventListener('click', onSettingsClick);
                // Insert at the start of the row to position on the left side
                rowWrapper.insertBefore(node, rowWrapper.firstElementChild);
            }
        });
    }

    // Set up a MutationObserver to watch for these elements as they are dynamically rendered via React
    const observer = new MutationObserver(() => {
        injectSettingsButtons();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    injectSettingsButtons();

})();
