'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'modules', 'webfetch', 'module.js');

function loadModule() {
  let registered = null;
  const runtimeCalls = [];
  const runtime = {
    sendMessage(message) {
      runtimeCalls.push(message);
      return Promise.resolve({
        ok: true,
        data: {
          url: message.request.url,
          redirected: false,
          redirectCount: 0,
          status: 200,
          statusText: 'OK',
          ok: true,
          headers: { 'content-type': 'application/json' },
          contentType: 'application/json',
          bodyEncoding: 'text',
          body: '{}',
          bytes: 2,
          returnedBytes: 2,
          truncated: false,
        },
      });
    },
  };
  const window = {
    Ultrascripts: {
      registry: {
        register(module) { registered = module; },
      },
    },
  };
  const context = vm.createContext({
    window,
    browser: { runtime },
    URL,
    console,
    Date,
    Map,
    Set,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Promise,
    module: { exports: {} },
  });
  vm.runInContext(fs.readFileSync(MODULE_PATH, 'utf8'), context, { filename: MODULE_PATH });
  return { module: registered, runtimeCalls };
}

async function expectError(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

async function testModuleContract() {
  const loaded = loadModule();
  const module = loaded.module;
  assert.ok(module, 'module registers itself');
  assert.equal(module.version, '1.0.0');
  assert.equal(JSON.stringify(Object.keys(module.ops)), JSON.stringify(['fetch']));

  const logs = [];
  const result = await module.ops.fetch.handler({
    url: 'https://example.com/data.json?secret=hidden',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer blocked',
    },
  }, { log: (...args) => logs.push(args) });

  assert.equal(loaded.runtimeCalls.length, 1);
  assert.equal(JSON.stringify(loaded.runtimeCalls[0].request.headers), JSON.stringify({ Accept: 'application/json' }));
  assert.equal(JSON.stringify(result.request.strippedHeaders), JSON.stringify(['Authorization']));
  assert.equal(result.bodyEncoding, 'text');
  assert.equal(logs[0].includes('https://example.com'), true);
  assert.equal(logs[0].some((value) => String(value).includes('secret=hidden')), false);

  await expectError(module.ops.fetch.handler({ url: 'http://example.com' }), 'scheme_blocked');
  await expectError(module.ops.fetch.handler({ url: 'https://user:pass@example.com' }), 'credentials_blocked');
  await expectError(module.ops.fetch.handler({ url: 'https://localhost/test' }), 'host_blocked');
  await expectError(module.ops.fetch.handler({ url: 'https://192.168.1.1/test' }), 'host_blocked');
  await expectError(module.ops.fetch.handler({ url: 'https://[fc00::1]/test' }), 'host_blocked');
  await expectError(module.ops.fetch.handler({ url: 'https://[100::1]/test' }), 'host_blocked');
  await expectError(module.ops.fetch.handler({ url: 'https://[2001:2::1]/test' }), 'host_blocked');
  await module.ops.fetch.handler({ url: 'https://[2606:4700:4700::1111]/test' });
  await expectError(module.ops.fetch.handler({ url: 'https://example.com', method: 'OPTIONS' }), 'invalid_args');
  await expectError(module.ops.fetch.handler({ url: 'https://example.com', method: 'POST' }), 'invalid_args');
  await expectError(module.ops.fetch.handler({ url: 'https://example.com', body: 'blocked' }), 'invalid_args');

  const tooManyHeaders = {};
  for (let index = 0; index < 21; index++) tooManyHeaders[`X-Test-${index}`] = 'value';
  await expectError(module.ops.fetch.handler({ url: 'https://example.com', headers: tooManyHeaders }), 'invalid_args');
  await expectError(module.ops.fetch.handler({
    url: 'https://example.com',
    headers: { 'X-Oversized': 'x'.repeat(2049) },
  }), 'invalid_args');
  await expectError(module.ops.fetch.handler({
    url: 'https://example.com',
    headers: { Authorization: 'x'.repeat(2049) },
  }), 'invalid_args');

  for (let index = 0; index < 20; index++) {
    await module.ops.fetch.handler({ url: `https://rate.example/item-${index}` });
  }
  await expectError(module.ops.fetch.handler({ url: 'https://rate.example/limited' }), 'rate_limit');
}

function makeResponse(body, init, url) {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { value: url || '' });
  return response;
}

function loadBackground(fetchImpl) {
  const listeners = [];
  const redirectListeners = [];
  const dnrUpdates = [];
  const storageArea = {
    get(_keys, callback) {
      const result = {};
      if (typeof callback === 'function') callback(result);
      return Promise.resolve(result);
    },
    set(_value, callback) {
      if (typeof callback === 'function') callback();
      return Promise.resolve();
    },
  };
  const chrome = {
    runtime: {
      id: 'betterdungeon-test',
      onMessage: {
        addListener(listener) { listeners.push(listener); },
      },
    },
    declarativeNetRequest: {
      updateSessionRules(update, callback) {
        dnrUpdates.push(update);
        if (typeof callback === 'function') callback();
        return Promise.resolve();
      },
    },
    webRequest: {
      onBeforeRedirect: {
        addListener(listener) { redirectListeners.push(listener); },
        removeListener(listener) {
          const index = redirectListeners.indexOf(listener);
          if (index >= 0) redirectListeners.splice(index, 1);
        },
      },
    },
    storage: { sync: storageArea, local: storageArea },
  };
  const guardedFetch = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (options.redirect === 'follow' && [301, 302, 303, 307, 308].includes(response.status)) {
      const redirectUrl = new URL(response.headers.get('location'), url).href;
      [...redirectListeners].forEach((listener) => listener({
        url,
        redirectUrl,
        tabId: -1,
        type: 'xmlhttprequest',
        initiator: 'chrome-extension://betterdungeon-test',
      }));
      const error = new Error('Redirect hop was intercepted');
      error.name = 'AbortError';
      throw error;
    }
    return response;
  };
  const context = vm.createContext({
    chrome,
    fetch: guardedFetch,
    URL,
    AbortController,
    TextDecoder,
    Uint8Array,
    Response,
    Headers,
    ReadableStream,
    setTimeout,
    clearTimeout,
    console,
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context, {
    filename: path.join(ROOT, 'background.js'),
  });

  function request(payload) {
    return new Promise((resolve, reject) => {
      const listener = listeners.find((candidate) => {
        try { return candidate({ type: 'ULTRASCRIPTS_WEBFETCH_FETCH', request: payload }, {}, resolve) === true; }
        catch (error) { reject(error); return false; }
      });
      if (!listener) reject(new Error('WebFetch background listener was not registered'));
    });
  }
  return { request, dnrUpdates };
}

async function testBackgroundTransport() {
  const calls = [];
  const queued = [];
  const background = loadBackground(async (url, options) => {
    calls.push({ url, options });
    if (!queued.length) throw new Error('No queued response');
    return queued.shift();
  });

  let response = await background.request({ url: 'http://example.com' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'scheme_blocked');
  assert.equal(calls.length, 0);

  queued.push(makeResponse('hello', {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Set-Cookie': 'blocked=1' },
  }, 'https://example.com/data'));
  response = await background.request({
    url: 'https://example.com/data',
    headers: { Authorization: 'blocked', 'X-Test': 'allowed' },
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.body, 'hello');
  assert.equal(response.data.bodyEncoding, 'text');
  assert.equal(response.data.headers['set-cookie'], undefined);
  assert.equal(JSON.stringify(calls[0].options.headers), JSON.stringify({ 'X-Test': 'allowed' }));
  assert.equal(calls[0].options.redirect, 'follow');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(background.dnrUpdates.some((update) => Array.isArray(update.addRules)), true);

  queued.push(
    makeResponse(null, { status: 302, headers: { Location: 'https://other.example/final' } }, 'https://example.com/start'),
    makeResponse('done', { status: 200, headers: { 'Content-Type': 'application/json' } }, 'https://other.example/final'),
  );
  response = await background.request({
    url: 'https://example.com/start',
    headers: { 'X-Private-Context': 'drop-on-cross-origin' },
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.redirected, true);
  assert.equal(response.data.redirectCount, 1);
  assert.equal(JSON.stringify(calls[2].options.headers), JSON.stringify({}));

  queued.push(makeResponse('binary', {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  }, 'https://example.com/image'));
  response = await background.request({ url: 'https://example.com/image' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'content_type_blocked');

  queued.push(makeResponse(null, {
    status: 302,
    headers: { Location: 'https://127.0.0.1/private' },
  }, 'https://example.com/start-private'));
  const callCountBeforePrivateRedirect = calls.length;
  response = await background.request({ url: 'https://example.com/start-private' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'host_blocked');
  assert.equal(calls.length, callCountBeforePrivateRedirect + 1);

  for (const contentType of [
    'application/json',
    'text/plain',
    'text/html; charset=utf-8',
    'application/xml',
    '',
  ]) {
    queued.push(makeResponse('readable', {
      status: 200,
      headers: contentType ? { 'Content-Type': contentType } : {},
    }, 'https://types.example/data'));
    response = await background.request({ url: 'https://types.example/data' });
    assert.equal(response.ok, true);
    assert.equal(response.data.body, 'readable');
  }

  queued.push(makeResponse(null, {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'text/plain', 'Content-Length': '321' },
  }, 'https://example.com/head'));
  response = await background.request({ url: 'https://example.com/head', method: 'HEAD' });
  assert.equal(response.ok, true);
  assert.equal(response.data.body, '');
  assert.equal(response.data.returnedBytes, 0);

  queued.push(makeResponse(null, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
  }, 'https://example.com/binary-head'));
  response = await background.request({ url: 'https://example.com/binary-head', method: 'HEAD' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'content_type_blocked');

  queued.push(makeResponse(null, {
    status: 302,
    headers: { Location: '/same-origin-final' },
  }, 'https://example.com/same-origin-start'));
  queued.push(makeResponse('same origin', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  }, 'https://example.com/same-origin-final'));
  const sameOriginCallStart = calls.length;
  response = await background.request({
    url: 'https://example.com/same-origin-start',
    headers: { 'X-Test': 'preserved' },
  });
  assert.equal(response.ok, true);
  assert.equal(calls[sameOriginCallStart + 1].options.headers['X-Test'], 'preserved');

  queued.push(makeResponse(null, {
    status: 302,
    headers: { Location: 'http://example.com/insecure' },
  }, 'https://example.com/http-redirect'));
  response = await background.request({ url: 'https://example.com/http-redirect' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'scheme_blocked');

  queued.push(makeResponse(null, {
    status: 302,
    headers: { Location: 'https://example.com/loop' },
  }, 'https://example.com/loop'));
  response = await background.request({ url: 'https://example.com/loop' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'redirect_loop');

  for (let index = 0; index < 6; index++) {
    queued.push(makeResponse(null, {
      status: 302,
      headers: { Location: `https://redirect.example/hop-${index + 1}` },
    }, `https://redirect.example/hop-${index}`));
  }
  response = await background.request({ url: 'https://redirect.example/hop-0' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'redirect_limit');

  queued.push(makeResponse('x'.repeat(2000), {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Content-Length': '2000' },
  }, 'https://example.com/large'));
  response = await background.request({
    url: 'https://example.com/large',
    maxBodyBytes: 1024,
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.returnedBytes, 1024);
  assert.equal(response.data.bytes, 2000);
  assert.equal(response.data.truncated, true);

  for (const invalidRequest of [
    { url: 'not a url' },
    { url: 'https://user:pass@example.com' },
    { url: 'https://localhost/data' },
    { url: 'https://10.0.0.1/data' },
    { url: 'https://[::1]/data' },
    { url: 'https://[100::1]/data' },
    { url: 'https://[2001:2::1]/data' },
    { url: 'https://example.com', method: 'OPTIONS' },
    { url: 'https://example.com', body: 'blocked' },
    { url: 'https://example.com', headers: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`X-${index}`, 'x'])) },
  ]) {
    response = await background.request(invalidRequest);
    assert.equal(response.ok, false);
    assert.equal(calls.some((call) => call.url === invalidRequest.url), false);
  }

  const timeoutBackground = loadBackground((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  }));
  response = await timeoutBackground.request({
    url: 'https://timeout.example/data',
    timeoutMs: 1000,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'timeout');
}

(async () => {
  await testModuleContract();
  await testBackgroundTransport();
  console.log('WebFetch module and transport tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
