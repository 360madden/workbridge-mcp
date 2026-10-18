import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPage, fileHash } from './text.js';
import { search } from './search.js';
import { BridgeError, limits, excludedDirectories } from './core.js';
export { BridgeError, limits, excludedDirectories, errorDetails } from './core.js';

const execute = promisify(execFile);
const excluded = new Set(excludedDirectories.map((x) => x.toLowerCase()));

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export class Workspace {
  private protectedDirectories: string[] = [];
  protect(directory: string) {
    this.protectedDirectories.push(path.resolve(directory));
  }
  private constructor(
    public root: string,
    public roots: string[],
  ) {}

  static async create(root = process.env.WORKBRIDGE_ROOT ?? 'C:\\work', additionalRoots: string[] = []) {
    const roots: string[] = [];
    for (const directory of [root, ...additionalRoots]) {
      if (!path.isAbsolute(directory))
        throw new BridgeError('INVALID_ROOT', 'Workspace roots must be absolute directories.');
      const canonical = await realpath(directory);
      if (!(await lstat(canonical)).isDirectory())
        throw new BridgeError('INVALID_ROOT', 'Workspace roots must be directories.');
      if (!roots.some((existing) => path.relative(existing, canonical) === '')) roots.push(canonical);
    }
    return new Workspace(roots[0]!, roots);
  }

  relative(target: string) {
    // Preserve primary-root paths and operation identities. Other roots use
    // absolute paths so every returned path can be passed back without ambiguity.
    return (inside(this.root, target) ? path.relative(this.root, target) || '.' : path.resolve(target))
      .split(path.sep)
      .join('/');
  }

  async resolve(input = '.') {
    // Reject Windows alternate streams/device names, including on non-Windows test hosts.
    const absolute = path.resolve(this.root, input);
    if (this.protectedDirectories.some((dir) => inside(dir, absolute)))
      throw new BridgeError(
        'PROTECTED_PATH',
        'Workbridge runtime state is not accessible through project file tools.',
      );
    const root = this.roots.find((directory) => inside(directory, absolute));
    if (!root) throw new BridgeError('OUTSIDE_ROOT', 'Path must stay inside a configured workspace root.');
    const relative = path.relative(root, absolute);
    let current = root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      if (
        part.includes(':') ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
      ) {
        throw new BridgeError(
          'INVALID_PATH',
          'Alternate streams and Windows device/ambiguous paths are not supported.',
        );
      }
      if (part.toLowerCase() === '.git')
        throw new BridgeError('GIT_INTERNAL', 'Use the Git tools instead of reading .git internals.');
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new BridgeError(
          'LINK_NOT_ALLOWED',
          'Symlinks and directory junctions are not followed. Use the real path inside an allowed root.',
        );
    }
    if (!inside(root, await realpath(absolute)))
      throw new BridgeError('OUTSIDE_ROOT', 'Resolved path leaves the workspace.');
    return absolute;
  }

  async resolveForCreate(input: string) {
    const absolute = path.resolve(this.root, input);
    if (this.roots.some((root) => path.relative(root, absolute) === ''))
      throw new BridgeError('ROOT_OPERATION', 'Workspace roots themselves cannot be changed.');
    // Validate all components, including a nonexistent final filename.
    const basename = path.basename(absolute);
    if (
      basename.toLowerCase() === '.git' ||
      basename.includes(':') ||
      /[. ]$/.test(basename) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(basename)
    )
      throw new BridgeError('INVALID_PATH', 'Invalid or reserved destination filename.');
    await this.directory(path.dirname(absolute));
    try {
      await this.resolve(absolute);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (this.protectedDirectories.some((dir) => inside(dir, absolute)))
      throw new BridgeError(
        'PROTECTED_PATH',
        'Workbridge runtime state cannot be changed through file tools.',
      );
    return absolute;
  }

  async directory(input: string) {
    const target = await this.resolve(input);
    if (!(await lstat(target)).isDirectory())
      throw new BridgeError('NOT_DIRECTORY', 'Expected a directory path.');
    return realpath(target);
  }

  async discover(directory = '.') {
    const target = await this.directory(directory);
    const result = await this.list(directory, false, 0, 500, '', true);
    const directories = result.entries.filter((x) => x.type === 'directory');
    const projects = await Promise.all(
      directories.map(async (entry) => {
        const gitEntry = await lstat(path.join(path.resolve(this.root, entry.path), '.git')).catch(
          () => null,
        );
        return { ...entry, git: Boolean(gitEntry && !gitEntry.isSymbolicLink()) };
      }),
    );
    return {
      root: this.root,
      roots: this.roots,
      directory: this.relative(target),
      projects,
      truncated: result.truncated,
      nextOffset: result.nextOffset,
    };
  }

  async list(
    directory = '.',
    recursive = false,
    offset = 0,
    limit = 200,
    nameContains = '',
    includeGenerated = false,
  ) {
    const target = await this.directory(directory);
    const state = { visited: 0, limited: false, skipped: 0, deadline: Date.now() + limits.scanMs };
    const entries: { path: string; type: string }[] = [];
    let matched = 0;
    let more = false;
    for await (const entry of this.walk(target, recursive, includeGenerated, state)) {
      if (!path.basename(entry.path).toLowerCase().includes(nameContains.toLowerCase())) continue;
      if (matched++ < offset) continue;
      if (entries.length === limit) {
        more = true;
        break;
      }
      entries.push(entry);
    }
    return {
      directory: this.relative(target),
      entries,
      truncated: more || state.limited,
      nextOffset: more ? offset + entries.length : null,
      scanLimitReached: state.limited,
      skipped: state.skipped,
    };
  }

  private async *walk(
    directory: string,
    recursive: boolean,
    includeGenerated: boolean,
    state: { visited: number; limited: boolean; skipped: number; deadline: number },
  ): AsyncGenerator<{ path: string; type: string }> {
    // opendir avoids loading a potentially huge directory before applying the budget.
    const { opendir } = await import('node:fs/promises');
    let handle;
    try {
      handle = await opendir(directory);
    } catch {
      state.skipped++;
      return;
    }
    for await (const entry of handle) {
      if (++state.visited > limits.scanEntries || Date.now() > state.deadline) {
        state.limited = true;
        return;
      }
      if (entry.name.toLowerCase() === '.git') continue;
      if (!includeGenerated && entry.isDirectory() && excluded.has(entry.name.toLowerCase())) continue;
      const absolute = path.join(directory, entry.name);
      // lstat again: Windows junctions must be treated like symlinks.
      let info;
      try {
        await this.resolve(absolute);
        info = await lstat(absolute);
      } catch {
        state.skipped++;
        continue;
      }
      if (!info.isFile() && !info.isDirectory()) {
        state.skipped++;
        continue;
      }
      yield { path: this.relative(absolute), type: info.isDirectory() ? 'directory' : 'file' };
      if (recursive && info.isDirectory()) {
        yield* this.walk(absolute, true, includeGenerated, state);
        if (state.limited) return;
      }
    }
  }

  async read(file: string, startLine = 1, lineCount = 200, cursor?: string) {
    const target = await this.resolve(file);
    return readPage(target, this.relative(target), startLine, lineCount, cursor);
  }

  async search(
    directory: string,
    query: string,
    caseSensitive = false,
    limit = 100,
    includeGenerated = false,
  ) {
    return search(this, { directory, query, caseSensitive, limit, includeGenerated });
  }

  async info(file: string, hash = false) {
    const target = await this.resolve(file),
      info = await lstat(target);
    return {
      path: this.relative(target),
      type: info.isDirectory() ? 'directory' : 'file',
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      sha256: hash && info.isFile() ? await fileHash(target) : null,
    };
  }

  async git(cwd: string, args: string[]) {
    try {
      const { stdout } = await execute(
        'git',
        [
          '--no-pager',
          '--literal-pathspecs',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.quotePath=false',
          '-c',
          'color.ui=false',
          ...args,
        ],
        {
          cwd,
          shell: false,
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) =>
                  !key.toUpperCase().startsWith('GIT_') && key.toUpperCase() !== 'CONTROL_PLANE_API_KEY',
              ),
            ),
            GIT_OPTIONAL_LOCKS: '0',
            GIT_TERMINAL_PROMPT: '0',
          },
        },
      );
      return stdout;
    } catch (error) {
      const e = error as Error & { code?: string; killed?: boolean; stderr?: string };
      if (e.code === 'ENOENT')
        throw new BridgeError(
          'GIT_NOT_FOUND',
          'Git is not on PATH. Install Git for Windows and restart the tunnel.',
        );
      if (e.killed || e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        throw new BridgeError(
          'GIT_LIMIT',
          'Git exceeded its time/output limit. Narrow the path or history range.',
        );
      throw new BridgeError(
        'GIT_ERROR',
        `Git could not inspect this repository/ref. ${(e.stderr ?? '').trim().slice(0, 2000)}`,
      );
    }
  }

  async repository(project: string) {
    const cwd = await this.directory(project);
    const top = (await this.git(cwd, ['rev-parse', '--show-toplevel'])).trim();
    return this.directory(top);
  }

  async gitPath(repository: string, file?: string) {
    if (!file) return [];
    const target = path.resolve(repository, file);
    if (!inside(repository, target))
      throw new BridgeError('OUTSIDE_PROJECT', 'Git path must stay within the repository.');
    // Deleted files are valid Git paths. Validate each existing parent without requiring the file to exist.
    let parent = target;
    for (;;) {
      try {
        await lstat(parent);
        await this.resolve(parent);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        parent = path.dirname(parent);
      }
    }
    return [path.relative(repository, target).split(path.sep).join('/') || '.'];
  }

  async revision(repository: string, ref: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/~^+-]{0,199}$/.test(ref))
      throw new BridgeError('INVALID_REF', 'Use a branch, tag, commit hash, or HEAD~N revision.');
    return (
      await this.git(repository, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
    ).trim();
  }

  gitResult(repository: string, output: string) {
    return {
      project: this.relative(repository),
      output: output.slice(0, limits.outputChars),
      truncated: output.length > limits.outputChars,
    };
  }

  async status(project: string) {
    const repo = await this.repository(project);
    return this.gitResult(
      repo,
      await this.git(repo, [
        'status',
        '--porcelain=v1',
        '--branch',
        '--untracked-files=normal',
        '--ignore-submodules=all',
      ]),
    );
  }

  async diff(project: string, staged = false, file?: string, base?: string) {
    const repo = await this.repository(project);
    const files = await this.gitPath(repo, file);
    const ref = base ? [await this.revision(repo, base)] : [];
    return this.gitResult(
      repo,
      await this.git(repo, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--ignore-submodules=all',
        '--unified=3',
        ...(staged ? ['--cached'] : []),
        ...ref,
        '--',
        ...files,
      ]),
    );
  }

  async history(project: string, limit = 20, skip = 0, file?: string, ref = 'HEAD') {
    const repo = await this.repository(project);
    const files = await this.gitPath(repo, file);
    const revision = await this.revision(repo, ref);
    return this.gitResult(
      repo,
      await this.git(repo, [
        'log',
        '--no-show-signature',
        `--max-count=${limit}`,
        `--skip=${skip}`,
        '--format=%H %aI %an%n%s%n',
        revision,
        '--',
        ...files,
      ]),
    );
  }
}
