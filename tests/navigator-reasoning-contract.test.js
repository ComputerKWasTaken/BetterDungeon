const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
let syncStore = {
  betterDungeon_navigator_read_only: true,
  betterDungeon_navigator_settings: {
    version: 99,
    readOnly: false,
    thinkingLevel: 'bogus',
    sendReasoningToCustom: 'yes',
    unknown: true,
  },
};
const listeners = [];
const context = {
  console,
  setTimeout,
  clearTimeout,
  window: {},
  chrome: {
    runtime: {},
    storage: {
      sync: {
        get(keys, callback) {
          const requested = Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(requested.map(key => [key, syncStore[key]])));
        },
        set(values, callback) {
          syncStore = { ...syncStore, ...values };
          callback?.();
        },
      },
      onChanged: { addListener(listener) { listeners.push(listener); } },
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'services/navigator/settings.js'), 'utf8'), context);

(async () => {
  const settings = await context.window.NavigatorSettings.load();
  assert.equal(settings.version, 1);
  assert.equal(settings.readOnly, true);
  assert.equal(settings.thinkingLevel, 'low');
  assert.equal(settings.sendReasoningToCustom, false);
  assert.equal(settings.contextProfile, 'standard');
  assert.equal(settings.contextChars, 46000);
  assert.equal(settings.storyCardMode, 'directory');
  assert.deepEqual(Object.keys(settings).sort(), [
    'contextChars', 'contextProfile', 'readOnly', 'sendReasoningToCustom',
    'storyCardMode', 'thinkingLevel', 'version',
  ]);
  assert.equal(syncStore.betterDungeon_navigator_read_only, true);
  assert.equal(context.window.NavigatorSettings.outputTokensFor('high', { maxOutputTokensCeiling: 6144 }), 6144);
  assert.equal(context.window.NavigatorSettings.outputTokensFor('off', { maxOutputTokensCeiling: 6144 }), 2048);
  assert.equal(context.window.NavigatorSettings.MAX_OUTPUT_TOKENS_CEILING, 12288);

  const failingContext = {
    console,
    setTimeout,
    clearTimeout,
    window: {},
    chrome: { runtime: {}, storage: { sync: {
      get(keys, callback) { throw new Error('storage failed'); },
    } } },
  };
  vm.createContext(failingContext);
  vm.runInContext(fs.readFileSync(path.join(root, 'services/navigator/settings.js'), 'utf8'), failingContext);
  await assert.rejects(() => failingContext.window.NavigatorSettings.load(), /storage failed/);
  failingContext.chrome.runtime.id = 'test-extension';
  vm.runInContext(fs.readFileSync(path.join(root, 'services/navigator/mutations.js'), 'utf8'), failingContext);
  const failingMutations = new failingContext.window.NavigatorMutations('short');
  await assert.rejects(
    () => failingMutations.apply({ status: 'applying', shortId: 'short' }),
    error => error?.code === 'read_only'
  );

  const timeoutContext = {
    console,
    setTimeout,
    clearTimeout,
    window: {},
    chrome: { runtime: {}, storage: { sync: { get() {} } } },
  };
  vm.createContext(timeoutContext);
  vm.runInContext(fs.readFileSync(path.join(root, 'services/navigator/settings.js'), 'utf8'), timeoutContext);
  await assert.rejects(() => timeoutContext.window.NavigatorSettings.load(), /timed out/);
  timeoutContext.chrome.runtime.id = 'test-extension';
  vm.runInContext(fs.readFileSync(path.join(root, 'services/navigator/mutations.js'), 'utf8'), timeoutContext);
  const timeoutMutations = new timeoutContext.window.NavigatorMutations('short');
  await assert.rejects(
    () => timeoutMutations.apply({ status: 'applying', shortId: 'short' }),
    error => error?.code === 'read_only'
  );

  const executorContext = {
    console,
    window: {},
    setTimeout,
    clearTimeout,
  };
  vm.createContext(executorContext);
  vm.runInContext(fs.readFileSync(path.join(root, 'modules/ai/executor.js'), 'utf8'), executorContext);
  const chat = executorContext.window.UltrascriptsAIExecutor.createChatTask({
    systemInstruction: 'system',
    messages: [{ role: 'user', content: 'hello' }],
    budget: { maxInputChars: 1000, maxOutputTokens: 2048 },
    thinking: { level: 'off' },
  });
  assert.equal(chat.thinking.level, 'off');
  assert.throws(() => executorContext.window.UltrascriptsAIExecutor.createTask({
    prompt: 'hello',
    thinking: { level: 'off' },
  }), error => /thinking\.level must be one of/.test(error?.message));

  const background = fs.readFileSync(path.join(root, 'background-ai-openai-compatible.js'), 'utf8');
  assert.match(background, /requestedLevel === 'off'/);
  assert.match(background, /reasoning_effort = requestedLevel/);
  assert.match(background, /unsupportedReasoning/);
  assert.match(background, /output_exhausted/);
  assert.match(background, /onDelta, onStage\);/);
  assert.match(background, /at the \$\{settings\.requestedThinkingLevel/);
  assert.match(background, /defaulted: requestedLevel === AI_DEFAULT_THINKING_LEVEL/);
  assert.match(background, /type: 'stage'/);
  assert.match(background, /onStage/);
  assert.match(fs.readFileSync(path.join(root, 'modules/ai/openai-compatible-backend.js'), 'utf8'), /message\.type === 'stage'/);
  assert.match(fs.readFileSync(path.join(root, 'services/navigator/session.js'), 'utf8'), /streamStage: 'connecting'/);
  const sessionSource = fs.readFileSync(path.join(root, 'services/navigator/session.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(root, 'features/navigator_feature.js'), 'utf8');
  assert.match(sessionSource, /get isChatBusy\(\)/);
  assert.match(sessionSource, /return this\.sending \|\| this\.streamingMessageId !== null/);
  assert.match(featureSource, /setInterval\(\(\) =>/);
  assert.match(featureSource, /this\.session\?\.isChatBusy/);
  assert.match(featureSource, /Still reasoning — \$\{level\} · \$\{elapsed\}s/);
  console.log('Navigator settings and reasoning contract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
