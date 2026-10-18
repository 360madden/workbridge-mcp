import { lstat, realpath, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readRoots, rootsFile } from './roots-config.js';
import { atomicWrite } from './changes.js';

async function canonical(input: string, mustExist = true) {
  if (!path.isAbsolute(input)) throw new Error('Root paths must be absolute.');
  const absolute = path.resolve(input);
  let current = absolute;
  while (true) {
    const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (!mustExist && error.code === 'ENOENT') return null;
      throw error;
    });
    if (entry?.isSymbolicLink()) throw new Error('Root paths cannot contain symlinks or junctions.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try {
    if (!(await lstat(absolute)).isDirectory()) throw new Error('Root must be a directory.');
    return await realpath(absolute);
  } catch (error) {
    if (!mustExist && (error as NodeJS.ErrnoException).code === 'ENOENT') return absolute;
    throw error;
  }
}
const key = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
async function main() {
  const [action, stateInput, primaryInput, targetInput] = process.argv.slice(2);
  if (!['Show', 'Validate', 'Add', 'Remove'].includes(action ?? '') || !stateInput || !primaryInput)
    throw new Error('Use Manage-WorkspaceRoots.ps1 -Action Show|Validate|Add|Remove.');
  const state = await canonical(stateInput),
    primary = await canonical(primaryInput);
  const config = await readRoots(state);
  const mutating = action === 'Add' || action === 'Remove';
  if (mutating && process.env.WORKBRIDGE_ROOTS_MANAGED !== '1')
    throw new Error(
      'Configuration writes require Manage-WorkspaceRoots.ps1, which holds the Windows configuration lock.',
    );
  let roots = [...config.additionalRoots];
  let changed = false;
  if (mutating) {
    if (!targetInput) throw new Error('Add/Remove requires -Path.');
    const target = await canonical(targetInput, action === 'Add');
    if (key(target) === key(primary))
      throw new Error('The primary root is fixed; it cannot be added, removed or replaced by this command.');
    if (target === path.parse(target).root)
      throw new Error('Choose a project directory rather than an entire drive.');
    const relativeState = path.relative(state, target);
    if (
      relativeState === '' ||
      (relativeState !== '..' &&
        !relativeState.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativeState))
    )
      throw new Error('Workbridge private state cannot be a project root.');
    const normalized = await Promise.all(roots.map((root) => canonical(root, false)));
    if (action === 'Add' && !normalized.some((root) => key(root) === key(target))) {
      roots.push(target);
      changed = true;
    }
    if (action === 'Remove') {
      roots = roots.filter((_, index) => key(normalized[index]!) !== key(target));
      changed = roots.length !== config.additionalRoots.length;
    }
  }
  if (action === 'Validate' || action === 'Add') await Promise.all(roots.map((root) => canonical(root)));
  if (roots.length > 16) throw new Error('At most 16 additional roots are supported.');
  const next = JSON.stringify({ additionalRoots: roots }, null, 2) + '\n';
  if (Buffer.byteLength(next) > 16 * 1024) throw new Error('Root configuration exceeds 16 KiB.');
  let backup: string | null = null;
  if (changed) {
    const backups = path.join(state, 'root-config-backups');
    await mkdir(backups, { recursive: true });
    backup = path.join(backups, `${Date.now()}-${randomUUID()}.json`);
    await atomicWrite(
      backup,
      JSON.stringify(
        { primaryRoot: primary, previousFileExisted: config.raw !== null, previousContents: config.raw },
        null,
        2,
      ),
      true,
    );
    await atomicWrite(rootsFile(state), next);
  }
  console.log(
    JSON.stringify({
      action,
      primaryRoot: primary,
      additionalRoots: roots,
      changed,
      backup,
      restartRequired: changed ? true : null,
      note: changed
        ? 'Configuration changed. Project tools stop with WORKSPACE_RESTART_REQUIRED until the existing service is restarted.'
        : 'No configuration change in this invocation; any pending runtime restart was not checked.',
    }),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Workspace configuration failed.');
  process.exitCode = 1;
});
