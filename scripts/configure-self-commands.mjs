import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const state = path.join(repo, '.local');
const project = process.argv[2] ?? path.basename(repo);
const configPath = path.join(state, 'commands.json');
let config;
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  config = { projects: {} };
}
const command = (args, timeoutSeconds = 120) => ({ executable: process.execPath, args, timeoutSeconds });
const profiles = {
  build: command(['node_modules/typescript/bin/tsc']),
  test: command(['--test', 'test/*.test.mjs']),
  format_check: command([
    'node_modules/prettier/bin/prettier.cjs',
    '--check',
    'src',
    'test',
    'scripts/*.mjs',
    'package.json',
    '.prettierrc.json',
  ]),
  acceptance: command(['scripts/acceptance.mjs']),
  startup_test: {
    executable: path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      path.join(repo, 'test/startup.test.ps1'),
    ],
    timeoutSeconds: 120,
  },
};
config.projects ??= {};
config.projects[project] ??= {};
for (const [name, value] of Object.entries(profiles)) config.projects[project][name] ??= value;
await mkdir(state, { recursive: true });
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(`Configured ${Object.keys(profiles).join(', ')} for ${project}; existing profiles preserved.`);
