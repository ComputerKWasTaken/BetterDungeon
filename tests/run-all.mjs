import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testsRoot = new URL('.', import.meta.url);
const smokeTest = fileURLToPath(new URL('smoke/repository-smoke.test.js', testsRoot));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', smokeTest], {
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
