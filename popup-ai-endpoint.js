// BetterDungeon popup controller for the unified OpenAI-compatible endpoint.

const AI_ENDPOINT_MESSAGE = 'ULTRASCRIPTS_AI_OPENAI_COMPATIBLE';
const AI_ENDPOINT_URLS = Object.freeze({
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
});
const AI_ENDPOINT_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const AI_INPUT_CAP_DEFAULT = 128000;
const AI_INPUT_CAP_FLOOR = 4000;
const AI_INPUT_CAP_CEILING = 2000000;
const AI_INPUT_CAP_PRESETS = Object.freeze([32000, 64000, 128000, 256000, 1000000]);

let aiEndpointStatus = null;
let aiEndpointLoaded = false;
let aiEndpointPending = false;
let aiEndpointDirty = false;
let aiEndpointError = null;
let aiEndpointCapDirty = false;

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
    return;
  }
  if (error) {
    const message = endpointErrorMessage(error);
    aiEndpointError = error;
    setEndpointBadge('Test failed', 'error', message);
    if (card) card.dataset.state = 'error';
    if (title) title.textContent = 'Connection failed';
    if (detail) detail.textContent = message;
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
    return;
  }
  const service = status.service || status.config?.service || 'gemini';
  const model = status.config?.activeModel || status.config?.lastResolvedModel || status.config?.model || '';
  if (!status.ready) {
    setEndpointBadge('Setup needed', 'warning');
    if (card) card.dataset.state = 'warning';
    if (title) title.textContent = `${aiServiceLabel(service)} setup required`;
    if (detail) detail.textContent = 'Complete this profile, then save or save and test.';
    return;
  }
  const verified = !!status.config?.activeModel;
  setEndpointBadge(verified ? 'Connected' : 'Configured', 'ready', model);
  if (card) card.dataset.state = 'ready';
  if (title) title.textContent = `${aiServiceLabel(service)} ${verified ? 'verified' : 'configured'}`;
  if (detail) detail.textContent = model ? `${model}${verified ? ' responded successfully.' : ' is ready to test.'}` : 'Profile saved.';
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

function parseInputCap(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return { error: 'Enter an input cap.' };
  const match = raw.match(/^([0-9][0-9,_ ]*)([km])?$/);
  if (!match) return { error: 'Input cap must be a number, optionally ending in k or m.' };
  const digits = match[1].replace(/[,_ ]/g, '');
  const number = Number(digits) * (match[2] === 'k' ? 1000 : match[2] === 'm' ? 1000000 : 1);
  if (!Number.isSafeInteger(number)) return { error: 'Input cap must be a whole number.' };
  if (number < AI_INPUT_CAP_FLOOR) return { error: `Input cap must be at least ${AI_INPUT_CAP_FLOOR.toLocaleString()} tokens.` };
  if (number > AI_INPUT_CAP_CEILING) return { error: `Input cap must be at most ${AI_INPUT_CAP_CEILING.toLocaleString()} tokens.` };
  return { value: number };
}

function renderInputCap(config) {
  const select = document.getElementById('ai-endpoint-max-input-tokens');
  const custom = document.getElementById('ai-endpoint-max-input-custom');
  if (!select || !custom) return;
  if (aiEndpointCapDirty) return;
  const cap = Number(config?.inputCapTokens) > 0 ? Math.floor(Number(config.inputCapTokens)) : AI_INPUT_CAP_DEFAULT;
  const preset = AI_INPUT_CAP_PRESETS.includes(cap);
  select.value = preset ? String(cap) : 'custom';
  select.dataset.previousValue = select.value;
  custom.hidden = preset;
  if (!preset) custom.value = String(cap);
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
  renderInputCap(aiEndpointStatus?.config);
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
  const maxInputInput = document.getElementById('ai-endpoint-max-input-tokens');
  const maxInputCustom = document.getElementById('ai-endpoint-max-input-custom');
  const modelMode = document.getElementById('ai-endpoint-model-mode')?.value === 'manual' ? 'manual' : 'auto';
  const saved = profileSnapshot(service);
  const enteredKey = String(keyInput?.value || '').trim();
  const model = String(modelInput?.value || '').trim();
  const inputCapRaw = maxInputInput?.value === 'custom'
    ? maxInputCustom?.value
    : maxInputInput?.value || AI_INPUT_CAP_DEFAULT;
  const inputCap = parseInputCap(inputCapRaw);
  const errors = [];
  const fields = [];
  const profile = {};
  if (inputCap.error) {
    errors.push(inputCap.error);
    fields.push(maxInputInput?.value === 'custom' ? 'ai-endpoint-max-input-custom' : 'ai-endpoint-max-input-tokens');
  }
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
  if (errors.length && !clearKey && inputCap.error) {
    setEndpointValidation(errors.join(' '), fields);
    return null;
  }
  setEndpointValidation();
  const profileValid = errors.length === 0;
  return {
    version: 1, activeService: service, inputCapTokens: inputCap.value,
    profiles: profileValid || clearKey ? { [service]: profile } : {},
    profileValid,
    validation: errors.length ? { message: errors.join(' '), fields } : null,
  };
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
  const validation = config.validation;
  const profileValid = config.profileValid;
  const status = await sendAIEndpointMessage({ op: 'settings:set', config });
  updateEndpointStatus({ status });
  aiEndpointCapDirty = false;
  renderEndpointProfile(status.service || config.activeService);
  if (validation) setEndpointValidation(validation.message, validation.fields);
  return { ...status, profileValid };
}

async function saveAIEndpointSettings() {
  if (aiEndpointPending) return;
  setEndpointControlsPending(true);
  updateEndpointStatus({ pending: 'Saving...' });
  try {
    const saved = await persistEndpointSettings();
    if (saved?.profileValid) showToast('AI endpoint profile saved and activated', 'success');
    else if (saved) showToast('Input cap saved; endpoint profile was not saved', 'warning');
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
    if (!saved.profileValid) return;
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
    aiEndpointCapDirty = false;
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
  document.getElementById('ai-endpoint-max-input-tokens')?.addEventListener('change', event => {
    aiEndpointCapDirty = true;
    const custom = document.getElementById('ai-endpoint-max-input-custom');
    const isCustom = event.target.value === 'custom';
    if (isCustom) {
      const previous = event.target.dataset.previousValue === 'custom'
        ? Number(custom?.value || 0)
        : Number(event.target.dataset.previousValue || AI_INPUT_CAP_DEFAULT);
      if (custom && Number.isSafeInteger(previous) && previous > 0) custom.value = String(previous);
    }
    if (custom) custom.hidden = !isCustom;
    event.target.dataset.previousValue = event.target.value;
    markAIEndpointDirty();
  });
  document.getElementById('ai-endpoint-max-input-custom')?.addEventListener('input', () => {
    aiEndpointCapDirty = true;
    setEndpointValidation();
    markAIEndpointDirty();
  });
  document.getElementById('ai-endpoint-save')?.addEventListener('click', saveAIEndpointSettings);
  document.getElementById('ai-endpoint-test')?.addEventListener('click', testAIEndpointSettings);
  document.getElementById('ai-endpoint-clear-key')?.addEventListener('click', clearAIEndpointKey);
  document.querySelector('[data-ultrascripts-module-toggle="ai"]')?.addEventListener('change', () => setEndpointControlsPending(false));
}
