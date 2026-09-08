'use strict';

const fs = require('node:fs');
const vm = require('node:vm');

function createAidDungeonRuntime({ state = {}, storyCards = [], history = [], info = {} } = {}) {
  const sandbox = vm.createContext({
    state: structuredClone(state),
    storyCards: structuredClone(storyCards),
    history: structuredClone(history),
    info: structuredClone(info),
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
  });

  function evaluate(source, filename = 'aidungeon-script.js') {
    return vm.runInContext(source, sandbox, { filename });
  }

  function load(filename) {
    return evaluate(fs.readFileSync(filename, 'utf8'), filename);
  }

  function runPhase(functionName, text) {
    sandbox.text = text;
    sandbox.stop = false;
    const result = vm.runInContext(`typeof ${functionName} === 'function' ? ${functionName}({ text }) : { text }`, sandbox);
    return result || { text: sandbox.text, stop: sandbox.stop };
  }

  return { sandbox, evaluate, load, runPhase };
}

module.exports = { createAidDungeonRuntime };
