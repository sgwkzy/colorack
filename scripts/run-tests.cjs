const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const testFiles = [
  'app.config.test.cjs',
  ...fs.readdirSync(path.join(root, 'lib'))
    .filter((name) => name.endsWith('.test.cjs'))
    .map((name) => path.join('lib', name)),
  ...fs.readdirSync(path.join(root, 'functions'))
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join('functions', name)),
];

const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
