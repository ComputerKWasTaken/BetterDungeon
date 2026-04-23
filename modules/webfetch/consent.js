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
    style.textContent = `
      .frontier-webfetch-consent-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(8, 12, 18, 0.62);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .frontier-webfetch-consent-dialog {
        width: min(520px, 100%);
        border: 1px solid rgba(230, 235, 244, 0.22);
        border-radius: 8px;
        background: #111827;
        color: #f8fafc;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }
      .frontier-webfetch-consent-body { padding: 20px; }
      .frontier-webfetch-consent-title {
        margin: 0 0 10px;
        font-size: 18px;
        font-weight: 700;
      }
      .frontier-webfetch-consent-copy {
        margin: 0 0 14px;
        color: #cbd5e1;
        line-height: 1.45;
        font-size: 14px;
      }
      .frontier-webfetch-consent-origin {
        display: block;
        margin: 0 0 16px;
        padding: 10px 12px;
        border-radius: 6px;
        background: #0f172a;
        color: #facc15;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 13px;
        overflow-wrap: anywhere;
      }
      .frontier-webfetch-consent-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        padding: 14px 20px;
        background: #0f172a;
        flex-wrap: wrap;
      }
      .frontier-webfetch-consent-actions button {
        min-height: 36px;
        border: 1px solid rgba(230, 235, 244, 0.22);
        border-radius: 6px;
        padding: 0 12px;
        background: #1f2937;
        color: #f8fafc;
        font: inherit;
        cursor: pointer;
      }
      .frontier-webfetch-consent-actions button[data-choice="allow"] {
        background: #0f766e;
        border-color: #14b8a6;
      }
      .frontier-webfetch-consent-actions button[data-choice="deny"] {
        background: #7f1d1d;
        border-color: #ef4444;
      }
      .frontier-webfetch-consent-actions button:hover {
        filter: brightness(1.08);
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
