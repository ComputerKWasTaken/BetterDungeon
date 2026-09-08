import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testsRoot = path.dirname(fileURLToPath(import.meta.url));

function findTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(target);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [target] : [];
  });
}

const files = findTests(testsRoot).sort();
if (!files.length) throw new Error('No BetterDungeon tests were found');

const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], {
  cwd: path.resolve(testsRoot, '..'),
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
