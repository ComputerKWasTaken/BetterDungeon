// Popup settings never receive saved API keys from the runtime.
function initAIEndpointSettings() {
  const C = window.BetterDungeonAIConfig;
  const ext = window.BetterDungeonPlatform.extension;
  const byId = id => document.getElementById(id);
  const panel = byId('tab-ai');
  let draft, service = 'openrouter', busy = false, dirty = false;
  const message = request => new Promise((resolve, reject) => {
    ext.runtime.sendMessage({ type: 'BETTERDUNGEON_AI', request }, response => {
      if (ext.runtime.lastError) return reject(new Error('AI settings transport is unavailable.'));
      response?.ok ? resolve(response.data) : reject(response?.error || new Error('AI settings request failed.'));
    });
  });
  const setStatus = (text, state = '') => {
    byId('ai-endpoint-validation').textContent = text;
    byId('ai-endpoint-validation').dataset.state = state;
    byId('ai-save-row').hidden = !dirty;
  };
  const keyHint = (id, configured) => {
    byId(id).value = '';
    byId(id).placeholder = configured ? 'Key saved · enter a new key to replace' : 'Paste your API key';
    byId(id === 'ai-simple-key' ? 'ai-simple-clear' : 'ai-endpoint-clear-key').hidden = !configured;
    delete byId(id).dataset.changed;
  };
  function updateAdvancedVisibility() {
    const enabled = byId('ai-advanced-enabled').checked;
    byId('ai-advanced-fields').hidden = !enabled;
    byId('ai-advanced-enabled').setAttribute('aria-expanded', String(enabled));
  }
  function updateModelVisibility() {
    byId('ai-mistral-model-group').hidden = service !== 'mistral';
    byId('ai-endpoint-model-group').hidden = service === 'mistral' && byId('ai-mistral-model').value !== 'custom';
  }
  function renderProfile() {
    const p = draft.advanced.profiles[service];
    const keyLinks = {
      openrouter: { label: 'Get an OpenRouter key', url: 'https://openrouter.ai/settings/keys' },
      mistral: { label: 'Get a Mistral key', url: 'https://console.mistral.ai/home?profile_dialog=api-keys' }
    };
    const keyLink = byId('ai-endpoint-key-link');
    const keySource = keyLinks[service];
    keyLink.hidden = !keySource;
    keyLink.parentElement.hidden = !keySource;
    if (keySource) {
      keyLink.href = keySource.url;
      byId('ai-endpoint-key-link-label').textContent = keySource.label;
    } else {
      keyLink.removeAttribute('href');
      byId('ai-endpoint-key-link-label').textContent = '';
    }
    byId('ai-endpoint-base-url').value = C.urls[service] || p.baseUrl || '';
    byId('ai-endpoint-base-url').readOnly = service !== 'custom';
    byId('ai-endpoint-base-url-group').hidden = service !== 'custom';
    keyHint('ai-endpoint-api-key', p.keyConfigured || !!p.apiKey);
    if (p.apiKey !== undefined) { byId('ai-endpoint-api-key').value = p.apiKey; byId('ai-endpoint-api-key').dataset.changed = 'true'; }
    byId('ai-endpoint-model').value = p.model || '';
    byId('ai-mistral-model').value = p.modelMode === 'auto' ? 'auto' : C.mistral.some(m => m.id === p.model) ? p.model : 'custom';
    updateModelVisibility();
  }
  function collectProfile() {
    const p = draft.advanced.profiles[service];
    if (byId('ai-endpoint-api-key').dataset.changed) p.apiKey = byId('ai-endpoint-api-key').value.trim();
    p.model = byId('ai-endpoint-model').value.trim();
    if (service === 'custom') p.baseUrl = byId('ai-endpoint-base-url').value.trim();
    if (service === 'mistral') {
      const value = byId('ai-mistral-model').value;
      p.modelMode = value === 'auto' ? 'auto' : 'pinned';
      if (value !== 'auto' && value !== 'custom') p.model = value;
    }
  }
  function collect() {
    collectProfile();
    if (byId('ai-simple-key').dataset.changed) draft.simple.apiKey = byId('ai-simple-key').value.trim();
    draft.simple.quotaStrategy = 'separated';
    draft.advanced.enabled = byId('ai-advanced-enabled').checked;
    draft.advanced.activeService = service;
    const cap = Number(byId('ai-endpoint-max-input-tokens').value);
    if (!Number.isSafeInteger(cap) || cap < 0 || cap > 2000000) throw new Error('Input cap must be a whole number from 0 to 2,000,000.');
    draft.advanced.inputCapTokens = cap;
    panel.querySelectorAll('[data-ai-consumer]').forEach(el => { draft.routing[el.dataset.aiConsumer] = el.checked ? 'advanced' : 'simple'; });
    if (draft.advanced.enabled && service === 'custom') {
      let url;
      try { url = new URL(draft.advanced.profiles.custom.baseUrl); } catch { throw new Error('Enter a valid HTTPS base URL.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS base URL without credentials, a query, or a fragment.');
    }
    return draft;
  }
  function latest(status) {
    const el = byId('ai-last-result'), r = status.last;
    el.hidden = !r;
    if (!r) return;
    const label = C.mistral.find(m => m.id === r.model)?.label || r.model;
    const provider = r.providerTier === 'simple' ? 'Gemini Simple' : r.provider + ' · ' + label;
    el.textContent = 'Latest completion: ' + provider + (r.advancedFallback ? ' (fallback from Advanced)' : '') +
      (r.provider === 'mistral' && r.attemptedModels.length > 1 ? ' after ' + (r.attemptedModels.length - 1) + ' model fallbacks' : '') + '.';
  }
  function render(status) {
    draft = status.config;
    service = draft.advanced.activeService;
    byId('ai-endpoint-service').value = service;
    keyHint('ai-simple-key', draft.simple.keyConfigured);
    byId('ai-advanced-enabled').checked = draft.advanced.enabled;
    byId('ai-endpoint-max-input-tokens').value = draft.advanced.inputCapTokens;
    panel.querySelectorAll('[data-ai-consumer]').forEach(el => { el.checked = draft.routing[el.dataset.aiConsumer] === 'advanced'; });
    if (draft.advanced.inputCapTokens) panel.querySelector('.ai-more-options').open = true;
    updateAdvancedVisibility();
    renderProfile(); latest(status); dirty = false;
    byId('ai-save-row').hidden = true;
  }
  async function action(fn) {
    if (busy || !draft) return;
    busy = true; panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
    try { await fn(); } catch (error) { setStatus(error.message || 'AI settings could not be updated.', 'error'); }
    finally { busy = false; panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = false; }); }
  }
  async function save() { const status = await message({ op: 'settings:set', config: collect() }); render(status); setStatus('Settings saved.', 'success'); }
  async function test(tier) {
    await save(); setStatus('Testing connection…');
    const result = await message({ op: 'test', tier });
    latest(result.status);
    setStatus(tier === 'simple' ? 'Gemini connection verified.' : 'Provider connection verified.', 'success');
  }
  const select = byId('ai-mistral-model');
  for (const item of [{ id: 'auto', label: 'Automatic — Recommended' }, ...C.mistral, { id: 'custom', label: 'Custom Mistral model ID' }]) {
    const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; select.append(option);
  }
  for (const id of ['ai-simple-key', 'ai-endpoint-api-key']) byId(id).addEventListener('input', () => {
    byId(id).dataset.changed = 'true';
    const saved = id === 'ai-simple-key' ? draft.simple.keyConfigured : draft.advanced.profiles[service].keyConfigured;
    byId(id === 'ai-simple-key' ? 'ai-simple-clear' : 'ai-endpoint-clear-key').hidden = !saved && !byId(id).value;
  });
  panel.addEventListener('input', () => { if (!busy) { dirty = true; setStatus('Unsaved changes.'); } });
  byId('ai-endpoint-service').addEventListener('change', e => { if (!draft) return; collectProfile(); service = e.target.value; renderProfile(); });
  select.addEventListener('change', updateModelVisibility);
  byId('ai-advanced-enabled').addEventListener('change', e => {
    if (e.target.checked && !draft.advanced.enabled) panel.querySelectorAll('[data-ai-consumer]').forEach(el => { el.checked = true; });
    updateAdvancedVisibility();
  });
  byId('ai-endpoint-save').addEventListener('click', () => action(save));
  byId('ai-simple-test').addEventListener('click', () => action(() => test('simple')));
  byId('ai-endpoint-test').addEventListener('click', () => action(() => test('advanced')));
  for (const [button, key] of [['ai-simple-clear', 'ai-simple-key'], ['ai-endpoint-clear-key', 'ai-endpoint-api-key']]) {
    byId(button).addEventListener('click', () => action(async () => { byId(key).value = ''; byId(key).dataset.changed = 'true'; await save(); }));
  }
  byId('ai-open-settings')?.addEventListener('click', () => document.querySelector('[data-tab="ai"]').click());
  document.querySelector('[data-tab="ai"]').addEventListener('click', () => {
    if (!busy && draft) message({ op: 'status' }).then(s => { latest(s); if (!dirty) render(s); }).catch(() => {});
  });
  panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
  window.BetterDungeonPlatform.whenReady().then(() => message({ op: 'settings:get' })).then(s => {
    render(s); setStatus('');
    panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = false; });
  }).catch(e => setStatus(e.message, 'error'));
}
