// BetterDungeon popup controller for the unified OpenAI-compatible endpoint.

const AI_ENDPOINT_MESSAGE = 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE';
const AI_ENDPOINT_URLS = Object.freeze({
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
});
const AI_ENDPOINT_DEFAULT_MODEL = 'gemini-3.5-flash-lite';

let aiEndpointStatus = null;
let aiEndpointLoaded = false;
let aiEndpointPending = false;
let aiEndpointDirty = false;
let aiEndpointError = null;

function sendAIEndpointMessage(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: AI_ENDPOINT_MESSAGE, request }, response => {
      const lastError = chrome.runtime.lastError;
      if (lastError) return reject(new Error(lastError.message || 'AI endpoint request failed.'));
      if (response?.ok) return resolve(response.data);
      reject(response?.error || { code: 'backend_failed', message: 'AI endpoint request failed.' });
    });
  });
}

function aiServiceLabel(service) {
  return service === 'openrouter' ? 'OpenRouter' : service === 'custom' ? 'Custom endpoint' : 'Google Gemini';
}

function setCharacterAIStatus(text, state = 'unknown') {
  const element = document.getElementById('character-ai-status');
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state;
}

function openAISettingsFromCharacters() {
  activateTab('ultrascripts');
  requestAnimationFrame(() => {
    const card = document.getElementById('ai-settings-card');
    card?.classList.add('expanded');
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('ai-endpoint-api-key')?.focus(), 250);
  });
}

function setEndpointBadge(text, state = 'pending', detail = '') {
  const badge = document.getElementById('ai-endpoint-status');
  if (!badge) return;
  badge.textContent = text;
  badge.dataset.state = state;
  badge.title = detail || text;
}

function endpointErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'auth_failed') return 'The selected service rejected the API key.';
  if (code === 'rate_limit') return 'The selected service is rate limited. Try again later.';
  if (code === 'safety_blocked' || code === 'prohibited_content') return 'The selected service blocked the test for safety.';
  if (code === 'timeout') return 'The selected service did not respond before the timeout.';
  if (code === 'not_configured') return 'Complete the selected profile before testing.';
  return error?.message || 'The endpoint could not complete the connection test.';
}

function updateEndpointStatus({ status = null, pending = '', error = null, dirty = false } = {}) {
  const card = document.getElementById('ai-endpoint-status-card');
  const title = document.getElementById('ai-endpoint-status-title');
  const detail = document.getElementById('ai-endpoint-status-detail');
  if (pending) {
    setEndpointBadge(pending, 'pending');
    if (card) card.dataset.state = 'pending';
    if (title) title.textContent = pending;
    if (detail) detail.textContent = 'Please keep the popup open.';
    return;
  }
  if (dirty) {
    aiEndpointDirty = true;
    aiEndpointError = null;
    setEndpointBadge('Unsaved', 'dirty');
    if (card) card.dataset.state = 'dirty';
    if (title) title.textContent = 'Unsaved profile changes';
    if (detail) detail.textContent = 'Saving activates the service selected above.';
    setCharacterAIStatus('AI endpoint has unsaved settings', 'missing');
    return;
  }
  if (error) {
    const message = endpointErrorMessage(error);
    aiEndpointError = error;
    setEndpointBadge('Test failed', 'error', message);
    if (card) card.dataset.state = 'error';
    if (title) title.textContent = 'Connection failed';
    if (detail) detail.textContent = message;
    setCharacterAIStatus('AI endpoint connection failed', 'missing');
    return;
  }

  aiEndpointStatus = status;
  aiEndpointLoaded = true;
  aiEndpointDirty = false;
  aiEndpointError = null;
  if (!status) {
    setEndpointBadge('Unavailable', 'error');
    if (card) card.dataset.state = 'error';
    if (title) title.textContent = 'Endpoint unavailable';
    if (detail) detail.textContent = 'BetterDungeon could not read the endpoint configuration.';
    setCharacterAIStatus('AI endpoint unavailable', 'missing');
    return;
  }
  const service = status.service || status.config?.service || 'gemini';
  const model = status.config?.activeModel || status.config?.lastResolvedModel || status.config?.model || '';
  if (!status.ready) {
    setEndpointBadge('Setup needed', 'warning');
    if (card) card.dataset.state = 'warning';
    if (title) title.textContent = `${aiServiceLabel(service)} setup required`;
    if (detail) detail.textContent = 'Complete this profile, then save or save and test.';
    setCharacterAIStatus('Selected AI service needs setup', 'missing');
    return;
  }
  const verified = !!status.config?.activeModel;
  setEndpointBadge(verified ? 'Connected' : 'Configured', 'ready', model);
  if (card) card.dataset.state = 'ready';
  if (title) title.textContent = `${aiServiceLabel(service)} ${verified ? 'verified' : 'configured'}`;
  if (detail) detail.textContent = model ? `${model}${verified ? ' responded successfully.' : ' is ready to test.'}` : 'Profile saved.';
  setCharacterAIStatus(`${aiServiceLabel(service)} ready`, 'ready');
}

function setEndpointValidation(message = '', fields = []) {
  const validation = document.getElementById('ai-endpoint-validation');
  if (validation) validation.textContent = message;
  const invalid = new Set(fields);
  ['ai-endpoint-base-url', 'ai-endpoint-api-key', 'ai-endpoint-model'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    if (invalid.has(id)) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  });
}

function profileSnapshot(service) {
  return aiEndpointStatus?.config?.profiles?.[service] || {};
}

function renderEndpointProfile(service, options = {}) {
  const normalized = ['gemini', 'openrouter', 'custom'].includes(service) ? service : 'gemini';
  const profile = profileSnapshot(normalized);
  const serviceSelect = document.getElementById('ai-endpoint-service');
  const baseUrl = document.getElementById('ai-endpoint-base-url');
  const key = document.getElementById('ai-endpoint-api-key');
  const modelMode = document.getElementById('ai-endpoint-model-mode');
  const model = document.getElementById('ai-endpoint-model');
  const modeGroup = document.getElementById('ai-endpoint-model-mode-group');
  const modelGroup = document.getElementById('ai-endpoint-model-group');
  const optional = document.getElementById('ai-endpoint-key-optional');
  const geminiHelp = document.getElementById('ai-endpoint-gemini-help');
  if (serviceSelect) serviceSelect.value = normalized;
  if (baseUrl) {
    baseUrl.value = AI_ENDPOINT_URLS[normalized] || profile.baseUrl || '';
    baseUrl.disabled = normalized !== 'custom' || aiEndpointPending;
  }
  if (key) {
    key.value = '';
    key.placeholder = profile.keyConfigured ? 'Saved locally' : normalized === 'gemini' ? 'AIza...' : 'Paste a key';
  }
  const mode = normalized === 'gemini' && profile.modelMode === 'manual' ? 'manual' : 'auto';
  if (modelMode) modelMode.value = mode;
  if (modeGroup) modeGroup.style.display = normalized === 'gemini' ? '' : 'none';
  if (model) {
    model.value = profile.model || (normalized === 'gemini' ? AI_ENDPOINT_DEFAULT_MODEL : '');
    model.placeholder = normalized === 'gemini' ? AI_ENDPOINT_DEFAULT_MODEL : normalized === 'openrouter' ? 'openai/gpt-5-mini' : 'model-id';
  }
  if (modelGroup) modelGroup.style.display = normalized === 'gemini' && mode === 'auto' ? 'none' : '';
  if (optional) optional.textContent = normalized === 'custom' ? 'optional' : 'required';
  if (geminiHelp) geminiHelp.style.display = normalized === 'gemini' ? '' : 'none';
  setEndpointValidation();
  if (options.markDirty) updateEndpointStatus({ dirty: true });
  setEndpointControlsPending(aiEndpointPending);
}

function normalizeCustomUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { error: 'Enter the custom endpoint base URL.' };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return { error: 'Custom endpoints must use HTTPS.' };
    if (url.search || url.hash) return { error: 'The base URL cannot contain a query string or fragment.' };
    return { value: url.toString().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') };
  } catch {
    return { error: 'Enter a complete HTTPS endpoint URL.' };
  }
}

function collectEndpointConfig({ clearKey = false } = {}) {
  const service = document.getElementById('ai-endpoint-service')?.value || 'gemini';
  const keyInput = document.getElementById('ai-endpoint-api-key');
  const modelInput = document.getElementById('ai-endpoint-model');
  const modelMode = document.getElementById('ai-endpoint-model-mode')?.value === 'manual' ? 'manual' : 'auto';
  const saved = profileSnapshot(service);
  const enteredKey = String(keyInput?.value || '').trim();
  const model = String(modelInput?.value || '').trim();
  const errors = [];
  const fields = [];
  const profile = {};
  if (clearKey) profile.apiKey = '';
  else if (enteredKey) profile.apiKey = enteredKey;
  const keyConfigured = clearKey ? false : !!(enteredKey || saved.keyConfigured);

  if (service === 'gemini') {
    profile.modelMode = modelMode;
    profile.model = model || AI_ENDPOINT_DEFAULT_MODEL;
    if (!keyConfigured) { errors.push('Enter a Gemini API key.'); fields.push('ai-endpoint-api-key'); }
    if (modelMode === 'manual' && !model) { errors.push('Enter a Gemini model ID.'); fields.push('ai-endpoint-model'); }
  } else if (service === 'openrouter') {
    profile.model = model;
    if (!keyConfigured) { errors.push('Enter an OpenRouter API key.'); fields.push('ai-endpoint-api-key'); }
    if (!model) { errors.push('Enter an OpenRouter model ID.'); fields.push('ai-endpoint-model'); }
  } else {
    const customUrl = normalizeCustomUrl(document.getElementById('ai-endpoint-base-url')?.value);
    if (customUrl.error) { errors.push(customUrl.error); fields.push('ai-endpoint-base-url'); }
    else profile.baseUrl = customUrl.value;
    profile.model = model;
    if (!model) { errors.push('Enter the custom endpoint model ID.'); fields.push('ai-endpoint-model'); }
  }
  if (errors.length && !clearKey) {
    setEndpointValidation(errors.join(' '), fields);
    return null;
  }
  setEndpointValidation();
  return { version: 1, activeService: service, profiles: { [service]: profile } };
}

function setEndpointControlsPending(pending) {
  aiEndpointPending = pending;
  const enabled = document.querySelector('[data-ultrascripts-module-toggle="ai"]')?.checked !== false;
  document.querySelectorAll('#ai-endpoint-panel input, #ai-endpoint-panel select, #ai-endpoint-panel button').forEach(control => {
    control.disabled = pending || !enabled;
  });
  const service = document.getElementById('ai-endpoint-service')?.value || 'gemini';
  const baseUrl = document.getElementById('ai-endpoint-base-url');
  if (baseUrl) baseUrl.disabled = pending || !enabled || service !== 'custom';
  document.getElementById('ai-endpoint-panel')?.setAttribute('aria-busy', String(pending));
}

async function loadAIEndpointSettings() {
  try {
    const status = await sendAIEndpointMessage({ op: 'status' });
    updateEndpointStatus({ status });
    renderEndpointProfile(status.service || status.config?.service || 'gemini');
  } catch (error) {
    aiEndpointLoaded = true;
    updateEndpointStatus({ error });
  }
}

async function persistEndpointSettings() {
  const config = collectEndpointConfig();
  if (!config) return null;
  const status = await sendAIEndpointMessage({ op: 'settings:set', config });
  updateEndpointStatus({ status });
  renderEndpointProfile(status.service || config.activeService);
  return status;
}

async function saveAIEndpointSettings() {
  if (aiEndpointPending) return;
  setEndpointControlsPending(true);
  updateEndpointStatus({ pending: 'Saving...' });
  try {
    if (await persistEndpointSettings()) showToast('AI endpoint profile saved and activated', 'success');
    else updateEndpointStatus({ dirty: true });
  } catch (error) {
    updateEndpointStatus({ error });
    showToast(error?.message || 'AI endpoint settings failed to save', 'error');
  } finally {
    setEndpointControlsPending(false);
  }
}

async function testAIEndpointSettings() {
  if (aiEndpointPending) return;
  setEndpointControlsPending(true);
  updateEndpointStatus({ pending: 'Saving...' });
  try {
    const saved = await persistEndpointSettings();
    if (!saved) return updateEndpointStatus({ dirty: true });
    updateEndpointStatus({ pending: 'Testing...' });
    const result = await sendAIEndpointMessage({ op: 'test' });
    updateEndpointStatus({ status: result.status });
    renderEndpointProfile(result.service || result.status?.service || saved.service);
    showToast('AI endpoint test succeeded', 'success');
  } catch (error) {
    updateEndpointStatus({ error });
    showToast(endpointErrorMessage(error), 'error');
  } finally {
    setEndpointControlsPending(false);
  }
}

async function clearAIEndpointKey() {
  if (aiEndpointPending) return;
  const service = document.getElementById('ai-endpoint-service')?.value || 'gemini';
  const config = collectEndpointConfig({ clearKey: true });
  setEndpointControlsPending(true);
  updateEndpointStatus({ pending: 'Clearing key...' });
  try {
    const status = await sendAIEndpointMessage({ op: 'settings:set', config });
    updateEndpointStatus({ status });
    renderEndpointProfile(service);
    showToast(`${aiServiceLabel(service)} API key cleared`, 'success');
  } catch (error) {
    updateEndpointStatus({ error });
    showToast(error?.message || 'The API key could not be cleared', 'error');
  } finally {
    setEndpointControlsPending(false);
  }
}

function markAIEndpointDirty() {
  if (!aiEndpointLoaded || aiEndpointPending) return;
  updateEndpointStatus({ dirty: true });
}

function initAIEndpointSettings() {
  loadAIEndpointSettings();
  document.getElementById('ai-endpoint-service')?.addEventListener('change', event => {
    renderEndpointProfile(event.target.value, { markDirty: true });
  });
  document.getElementById('ai-endpoint-model-mode')?.addEventListener('change', event => {
    const modelGroup = document.getElementById('ai-endpoint-model-group');
    if (modelGroup) modelGroup.style.display = event.target.value === 'manual' ? '' : 'none';
    markAIEndpointDirty();
  });
  ['ai-endpoint-base-url', 'ai-endpoint-api-key', 'ai-endpoint-model'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      setEndpointValidation();
      markAIEndpointDirty();
    });
  });
  document.getElementById('ai-endpoint-save')?.addEventListener('click', saveAIEndpointSettings);
  document.getElementById('ai-endpoint-test')?.addEventListener('click', testAIEndpointSettings);
  document.getElementById('ai-endpoint-clear-key')?.addEventListener('click', clearAIEndpointKey);
  document.querySelector('[data-ultrascripts-module-toggle="ai"]')?.addEventListener('change', () => setEndpointControlsPending(false));
}
