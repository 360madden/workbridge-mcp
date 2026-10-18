import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const state = path.resolve(process.env.WORKBRIDGE_STATE_DIR ?? path.join(repo, '.local'));
const project = process.argv[2] ?? repo.split(path.sep).join('/').replace(/\/$/, '');
const configPath = path.join(state, 'commands.json');
let config;
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  config = { projects: {} };
}
const runner = path.join(repo, 'scripts', 'run-package-script.mjs');
const command = (script, timeoutSeconds = 120) => ({
  executable: process.execPath,
  args: [runner, script],
  timeoutSeconds,
});
const profiles = {
  build: command('build'),
  test: command('test'),
  format_check: command('format:check'),
  acceptance: command('acceptance'),
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
const conflicts = [];
for (const [name, value] of Object.entries(profiles)) {
  const existing = config.projects[project][name];
  if (existing && JSON.stringify(existing) !== JSON.stringify(value)) conflicts.push(name);
  config.projects[project][name] ??= value;
}
await mkdir(state, { recursive: true });
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(`Configured ${Object.keys(profiles).join(', ')} for ${project}; existing profiles preserved.`);
if (conflicts.length)
  console.log(
    `Preserved differing profiles: ${conflicts.join(', ')}. Review/migrate them explicitly or select a new profile project key; the full package lifecycle was not substituted silently.`,
  );
