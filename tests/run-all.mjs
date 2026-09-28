import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = fileURLToPath(new URL('.', import.meta.url));
const testFiles = fs.readdirSync(testsDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
  .map(entry => path.join(testsDir, entry.name))
  .sort();
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...testFiles], {
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
