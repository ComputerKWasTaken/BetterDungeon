// modules/webfetch/consent.js
//
// Small consent broker for Frontier WebFetch. The module asks before a script
// can access a new origin, then remembers allow/deny decisions in
// chrome.storage.sync.

(function () {
  if (window.FrontierWebFetchConsent) return;

  const STORAGE_KEY = 'frontier_webfetch_allowlist';
  const TAG = '[WebFetch/consent]';

  const sessionDecisions = new Map(); // origin -> 'allow' | 'deny'
  const pendingPrompts = new Map();   // origin -> Promise

  function extensionApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }

  function normalizeOrigin(originOrUrl) {
    const parsed = new URL(String(originOrUrl || ''));
    return parsed.origin;
  }

  function normalizeStore(value) {
    const out = {};
    if (!value || typeof value !== 'object') return out;
    for (const [origin, entry] of Object.entries(value)) {
      if (!origin || !entry || typeof entry !== 'object') continue;
      if (entry.decision !== 'allow' && entry.decision !== 'deny') continue;
      out[origin] = {
        decision: entry.decision,
        updatedAt: Number(entry.updatedAt || Date.now()),
      };
    }
    return out;
  }

  function readStore() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(normalizeStore(value));
      };

      try {
        const area = extensionApi()?.storage?.sync;
        if (!area?.get) return done({});
        const maybePromise = area.get(STORAGE_KEY, (result) => done(result?.[STORAGE_KEY]));
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then((result) => done(result?.[STORAGE_KEY])).catch(() => done({}));
        }
      } catch {
        done({});
      }
    });
  }

  function writeStore(store) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      try {
        const area = extensionApi()?.storage?.sync;
        if (!area?.set) return done();
        const maybePromise = area.set({ [STORAGE_KEY]: normalizeStore(store) }, done);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done).catch(done);
        }
      } catch {
        done();
      }
    });
  }

  async function setOrigin(originOrUrl, decision) {
    const origin = normalizeOrigin(originOrUrl);
    const store = await readStore();

    if (decision === 'clear' || decision === null || decision === undefined) {
      delete store[origin];
      sessionDecisions.delete(origin);
      await writeStore(store);
      return { origin, decision: null };
    }

    if (decision !== 'allow' && decision !== 'deny') {
      throw new Error(`${TAG} decision must be 'allow', 'deny', or 'clear'`);
    }

    store[origin] = { decision, updatedAt: Date.now() };
    sessionDecisions.delete(origin);
    await writeStore(store);
    return { origin, decision };
  }

  function ensureStyles() {
    if (document.getElementById('frontier-webfetch-consent-style')) return;
    const style = document.createElement('style');
    style.id = 'frontier-webfetch-consent-style';
    // Values fall back to literal tokens from Project Management/design/theme-variables.css
    // because this style is injected into a third-party page where --bd-* may not exist.
    style.textContent = `
      .frontier-webfetch-consent-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--bd-z-modal-backdrop, 9000);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--bd-space-6, 24px);
        background: var(--bd-bg-overlay, rgba(0, 0, 0, 0.85));
        font-family: var(--bd-font-family-primary, 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      }
      .frontier-webfetch-consent-dialog {
        width: min(520px, 100%);
        border: 1px solid var(--bd-border-default, rgba(255, 255, 255, 0.10));
        border-radius: var(--bd-radius-xl, 10px);
        background: var(--bd-bg-secondary, #16161a);
        color: var(--bd-text-primary, #e8e8ec);
        box-shadow: var(--bd-shadow-2xl, 0 24px 80px rgba(0, 0, 0, 0.6));
        overflow: hidden;
      }
      .frontier-webfetch-consent-body { padding: var(--bd-space-5, 20px); }
      .frontier-webfetch-consent-title {
        margin: 0 0 var(--bd-space-2, 8px);
        color: var(--bd-text-primary, #e8e8ec);
        font-size: var(--bd-font-size-2xl, 18px);
        font-weight: var(--bd-font-weight-bold, 700);
        letter-spacing: var(--bd-tracking-tight, -0.3px);
      }
      .frontier-webfetch-consent-copy {
        margin: 0 0 var(--bd-space-3, 12px);
        color: var(--bd-text-secondary, #a0a0a8);
        line-height: var(--bd-line-height-normal, 1.5);
        font-size: var(--bd-font-size-md, 13px);
      }
      .frontier-webfetch-consent-origin {
        display: block;
        margin: 0 0 var(--bd-space-4, 16px);
        padding: var(--bd-space-3, 12px) var(--bd-space-3, 12px);
        border: 1px solid var(--bd-border-subtle, rgba(255, 255, 255, 0.06));
        border-radius: var(--bd-radius-md, 6px);
        background: var(--bd-bg-primary, #0d0d0f);
        color: var(--bd-accent-primary, #ff9500);
        font-family: var(--bd-font-family-mono, 'Roboto Mono', 'Consolas', 'Monaco', 'Courier New', monospace);
        font-size: var(--bd-font-size-base, 12px);
        overflow-wrap: anywhere;
      }
      .frontier-webfetch-consent-actions {
        display: flex;
        gap: var(--bd-space-2, 8px);
        justify-content: flex-end;
        padding: var(--bd-space-3, 12px) var(--bd-space-5, 20px);
        border-top: 1px solid var(--bd-border-subtle, rgba(255, 255, 255, 0.06));
        background: var(--bd-bg-primary, #0d0d0f);
        flex-wrap: wrap;
      }
      .frontier-webfetch-consent-actions button {
        min-height: 36px;
        border: 1px solid var(--bd-border-default, rgba(255, 255, 255, 0.10));
        border-radius: var(--bd-radius-md, 6px);
        padding: 0 var(--bd-space-3, 12px);
        background: var(--bd-btn-secondary-bg, rgba(255, 255, 255, 0.08));
        color: var(--bd-text-primary, #e8e8ec);
        font: inherit;
        font-weight: var(--bd-font-weight-medium, 500);
        cursor: pointer;
        transition: var(--bd-transition-fast, 0.15s ease);
      }
      .frontier-webfetch-consent-actions button:hover {
        background: var(--bd-btn-secondary-hover, rgba(255, 255, 255, 0.12));
        border-color: var(--bd-border-strong, rgba(255, 255, 255, 0.15));
      }
      .frontier-webfetch-consent-actions button:focus-visible {
        outline: none;
        border-color: var(--bd-border-focus, #ff9500);
        box-shadow: var(--bd-input-focus-ring, 0 0 0 3px rgba(255, 149, 0, 0.12));
      }
      .frontier-webfetch-consent-actions button[data-choice="allow"] {
        background: var(--bd-btn-primary-bg, linear-gradient(135deg, #ff9500 0%, #e07800 100%));
        border-color: transparent;
        color: var(--bd-text-on-accent, #ffffff);
        box-shadow: var(--bd-shadow-glow-xl, 0 4px 12px rgba(255, 149, 0, 0.30));
      }
      .frontier-webfetch-consent-actions button[data-choice="allow"]:hover {
        background: var(--bd-btn-primary-hover, linear-gradient(135deg, #ffb84d 0%, #ff9500 100%));
        border-color: transparent;
      }
      .frontier-webfetch-consent-actions button[data-choice="deny"] {
        background: var(--bd-error-bg, rgba(239, 68, 68, 0.15));
        border-color: var(--bd-error-border, rgba(239, 68, 68, 0.3));
        color: var(--bd-error-light, #f87171);
      }
      .frontier-webfetch-consent-actions button[data-choice="deny"]:hover {
        background: rgba(239, 68, 68, 0.25);
        border-color: var(--bd-error, #ef4444);
      }
    `;
    document.head.appendChild(style);
  }

  function promptUser(origin, details = {}) {
    if (pendingPrompts.has(origin)) return pendingPrompts.get(origin);

    const promise = new Promise((resolve) => {
      ensureStyles();

      const backdrop = document.createElement('div');
      backdrop.className = 'frontier-webfetch-consent-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');

      const method = details.method || 'GET';
      backdrop.innerHTML = `
        <div class="frontier-webfetch-consent-dialog">
          <div class="frontier-webfetch-consent-body">
            <h2 class="frontier-webfetch-consent-title">Allow Frontier web access?</h2>
            <p class="frontier-webfetch-consent-copy">
              This AI Dungeon script wants BetterDungeon to make a ${method} request to:
            </p>
            <code class="frontier-webfetch-consent-origin"></code>
            <p class="frontier-webfetch-consent-copy">
              Approve only origins you trust. Request and response data are written through Frontier story cards.
            </p>
          </div>
          <div class="frontier-webfetch-consent-actions">
            <button type="button" data-choice="deny">Deny</button>
            <button type="button" data-choice="once">Allow once</button>
            <button type="button" data-choice="allow">Always allow</button>
          </div>
        </div>
      `;
      backdrop.querySelector('.frontier-webfetch-consent-origin').textContent = origin;

      function finish(choice) {
        backdrop.remove();
        pendingPrompts.delete(origin);
        resolve(choice);
      }

      backdrop.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button[data-choice]');
        if (!button) return;
        finish(button.getAttribute('data-choice'));
      });

      (document.body || document.documentElement).appendChild(backdrop);
      backdrop.querySelector('button[data-choice="once"]')?.focus?.();
    });

    pendingPrompts.set(origin, promise);
    return promise;
  }

  async function ensureAllowed(originOrUrl, details = {}) {
    const origin = normalizeOrigin(originOrUrl);

    const sessionDecision = sessionDecisions.get(origin);
    if (sessionDecision === 'allow') return { origin, decision: 'allow_once' };
    if (sessionDecision === 'deny') {
      throw { code: 'consent_denied', message: `User denied ${origin}` };
    }

    const store = await readStore();
    const persisted = store[origin]?.decision || null;
    if (persisted === 'allow') return { origin, decision: 'allow' };
    if (persisted === 'deny') {
      throw { code: 'consent_denied', message: `User denied ${origin}` };
    }

    const choice = await promptUser(origin, details);
    if (choice === 'allow') {
      store[origin] = { decision: 'allow', updatedAt: Date.now() };
      await writeStore(store);
      return { origin, decision: 'allow' };
    }
    if (choice === 'once') {
      sessionDecisions.set(origin, 'allow');
      return { origin, decision: 'allow_once' };
    }

    store[origin] = { decision: 'deny', updatedAt: Date.now() };
    await writeStore(store);
    throw { code: 'consent_denied', message: `User denied ${origin}` };
  }

  async function inspect() {
    return {
      persisted: await readStore(),
      session: Object.fromEntries(sessionDecisions),
      pending: [...pendingPrompts.keys()],
    };
  }

  window.FrontierWebFetchConsent = {
    ensureAllowed,
    setOrigin,
    inspect,
    _readStore: readStore,
    _writeStore: writeStore,
  };
})();
