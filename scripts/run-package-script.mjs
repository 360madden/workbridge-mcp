import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { executableFor } from '../dist/command-executable.js';
const repo = fileURLToPath(new URL('..', import.meta.url));
const name = process.argv[2];
if (!['build', 'test', 'format:check', 'acceptance'].includes(name))
  throw new Error('Unsupported self-validation script.');
const command = await executableFor('npm', ['run', name], repo);
try {
  execFileSync(command.executable, command.args, { cwd: repo, windowsHide: true, stdio: 'inherit' });
} catch (error) {
  process.exitCode = typeof error.status === 'number' ? error.status : 1;
}
