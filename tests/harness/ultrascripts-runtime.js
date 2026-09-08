'use strict';

class UltrascriptsHarness {
  constructor({ modules = [], permissions = [], maxPayloadBytes = 64 * 1024 } = {}) {
    this.modules = new Map(modules.map(module => [module.id, { ...module }]));
    this.permissions = new Set(permissions);
    this.maxPayloadBytes = maxPayloadBytes;
    this.pending = new Map();
    this.completed = [];
    this.counter = 0;
    this.available = true;
  }

  serializable(value, label) {
    let json;
    try {
      json = JSON.stringify(value);
    } catch {
      throw new Error(`${label} is not serializable`);
    }
    if (json === undefined) throw new Error(`${label} is not serializable`);
    if (Buffer.byteLength(json, 'utf8') > this.maxPayloadBytes) {
      throw new Error(`${label} exceeds ${this.maxPayloadBytes} bytes`);
    }
    const secrets = /^(?:api[_-]?key|authorization|password|secret|token)$/i;
    const inspect = candidate => {
      if (!candidate || typeof candidate !== 'object') return;
      for (const [key, nested] of Object.entries(candidate)) {
        if (secrets.test(key)) throw new Error(`${label} contains forbidden secret field: ${key}`);
        inspect(nested);
      }
    };
    const cloned = JSON.parse(json);
    inspect(cloned);
    return cloned;
  }

  heartbeat() {
    return {
      protocol: 2,
      client: 'BetterDungeon',
      available: this.available,
      modules: [...this.modules.values()].map(value => structuredClone(value)),
    };
  }

  request(moduleId, operation, args = {}, { permission, timeoutMs = 30_000 } = {}) {
    if (!this.available) return Promise.reject(new Error('BetterDungeon is unavailable'));
    const module = this.modules.get(moduleId);
    if (!module || !module.ops?.includes(operation)) return Promise.reject(new Error(`Unsupported operation: ${moduleId}.${operation}`));
    if (permission && !this.permissions.has(permission)) return Promise.reject(new Error(`Permission denied: ${permission}`));

    const id = `test-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Ultrascripts request timed out: ${id}`));
      }, timeoutMs);
      let safeArgs;
      try {
        safeArgs = this.serializable(args, 'request');
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      this.pending.set(id, { id, moduleId, operation, args: safeArgs, resolve, reject, timer });
    });
  }

  pendingRequest() {
    const value = [...this.pending.values()][0];
    return value && { id: value.id, module: value.moduleId, operation: value.operation, args: structuredClone(value.args) };
  }

  resolve(id, result) {
    const request = this.pending.get(id);
    if (!request) return false;
    clearTimeout(request.timer);
    this.pending.delete(id);
    this.completed.push(id);
    try {
      request.resolve(this.serializable(result, 'response'));
    } catch (error) {
      request.reject(error);
    }
    return true;
  }

  reject(id, message) {
    const request = this.pending.get(id);
    if (!request) return false;
    clearTimeout(request.timer);
    this.pending.delete(id);
    this.completed.push(id);
    request.reject(new Error(message));
    return true;
  }

  cancel(id) {
    return this.reject(id, `Ultrascripts request cancelled: ${id}`);
  }

  reload() {
    for (const id of [...this.pending.keys()]) this.reject(id, 'BetterDungeon reloaded');
    this.counter = 0;
  }
}

module.exports = { UltrascriptsHarness };
