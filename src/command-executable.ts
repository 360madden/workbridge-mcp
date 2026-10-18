import { stat } from 'node:fs/promises';
import path from 'node:path';
import { BridgeError } from './core.js';

async function isFile(file: string) {
  return (await stat(file).catch(() => null))?.isFile() ?? false;
}

export async function executableFor(executable: string, args: string[], cwd: string) {
  const explicit = path.isAbsolute(executable) || /[\\/]/.test(executable);
  const extensions =
    process.platform === 'win32' && !path.extname(executable) ? ['.exe', '.com', '.cmd', '.bat'] : [''];
  const directories = explicit ? [''] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  let resolved: string | undefined;
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = explicit
        ? path.resolve(cwd, executable + extension)
        : path.resolve(directory.replace(/^"|"$/g, ''), executable + extension);
      if (await isFile(candidate)) {
        resolved = candidate;
        break;
      }
    }
    if (resolved) break;
  }
  if (!resolved)
    throw new BridgeError(
      'EXECUTABLE_NOT_FOUND',
      'Executable was not found. Use an installed tool name on PATH or an absolute executable path.',
    );
  if (process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(resolved)) {
    const name = path
      .basename(resolved)
      .replace(/\.(cmd|bat|ps1)$/i, '')
      .toLowerCase();
    if (name === 'npm' || name === 'npx') {
      const cli = path.join(path.dirname(resolved), 'node_modules', 'npm', 'bin', `${name}-cli.js`);
      if (await isFile(cli)) return { executable: process.execPath, args: [cli, ...args] };
    }
    throw new BridgeError(
      'SHELL_REQUIRED',
      'This is a Windows script, not a native executable. Invoke an explicit interpreter (PowerShell -File, or cmd.exe with deliberate shell syntax). npm/npx use their official Node CLI entrypoints when installed beside the launcher.',
    );
  }
  return { executable: resolved, args };
}
