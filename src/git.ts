import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from './workspace.js';
import { BridgeError, limits } from './core.js';
import { atomicWrite, digest, Serial } from './changes.js';
import { fileHash } from './text.js';

export class GitTools {
  constructor(
    private workspace: Workspace,
    private directory: string,
    private serial = new Serial(),
  ) {
    workspace.protect(directory);
  }
  async read(project: string, file: string, ref = 'HEAD', startLine = 1, lineCount = 200) {
    const repo = await this.workspace.repository(project);
    const revision = await this.workspace.revision(repo, ref);
    const files = await this.workspace.gitPath(repo, file);
    const output = await this.workspace.git(repo, [
      'show',
      '--no-ext-diff',
      '--no-textconv',
      `${revision}:${files[0]}`,
    ]);
    if (output.includes('\0')) throw new BridgeError('NOT_TEXT', 'Historical file contains binary data.');
    const lines = output.split(/\r\n|\n|\r/);
    return {
      project: this.workspace.relative(repo),
      path: file,
      revision,
      startLine,
      totalLines: lines.length,
      text: lines
        .slice(startLine - 1, startLine - 1 + lineCount)
        .map((line, i) => `${startLine + i}: ${line}`)
        .join('\n')
        .slice(0, limits.outputChars),
      nextLine: startLine - 1 + lineCount < lines.length ? startLine + lineCount : null,
    };
  }
  async compare(project: string, base: string, head: string, file?: string) {
    const repo = await this.workspace.repository(project),
      a = await this.workspace.revision(repo, base),
      b = await this.workspace.revision(repo, head);
    return this.workspace.gitResult(
      repo,
      await this.workspace.git(repo, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--ignore-submodules=all',
        a,
        b,
        '--',
        ...(await this.workspace.gitPath(repo, file)),
      ]),
    );
  }
  async blame(project: string, file: string, startLine = 1, lineCount = 100, ref = 'HEAD') {
    const repo = await this.workspace.repository(project),
      revision = await this.workspace.revision(repo, ref);
    return this.workspace.gitResult(
      repo,
      await this.workspace.git(repo, [
        'blame',
        '--no-textconv',
        '-L',
        `${startLine},+${lineCount}`,
        revision,
        '--',
        ...(await this.workspace.gitPath(repo, file)),
      ]),
    );
  }
  async commit(
    project: string,
    message: string,
    files: { path: string; sha256: string | null }[],
    expectedHead: string | null,
    operationId: string,
  ) {
    return this.serial.run(async () => {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(operationId))
        throw new BridgeError('INVALID_OPERATION_ID', 'Invalid commit operation ID.');
      const journal = path.join(this.directory, `${operationId}.json`),
        request = digest(JSON.stringify({ project, message, files, expectedHead }));
      try {
        const old = JSON.parse(await readFile(journal, 'utf8')) as {
          request: string;
          state: string;
          commit?: string;
        };
        if (old.request !== request)
          throw new BridgeError('ID_REUSE', 'Commit operation ID was used with different arguments.');
        if (old.state !== 'committed')
          throw new BridgeError(
            'OPERATION_UNCERTAIN',
            'A previous commit attempt did not return a confirmed result. Inspect Git status/history before another attempt.',
          );
        return { operationId, commit: old.commit, replayed: true };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const repo = await this.workspace.repository(project);
      // symbolic-ref distinguishes an unborn branch from detached HEAD.
      try {
        await this.workspace.git(repo, ['symbolic-ref', '--quiet', 'HEAD']);
      } catch {
        throw new BridgeError('DETACHED_HEAD', 'Create/select a branch before committing.');
      }
      let head: string | null = null;
      try {
        head = await this.workspace.revision(repo, 'HEAD');
      } catch {
        /* unborn */
      }
      if (head !== expectedHead)
        throw new BridgeError(
          'CONFLICT',
          'HEAD changed. Inspect history and retry with the exact current commit (or null for an empty repository).',
        );
      try {
        await this.workspace.git(repo, ['var', 'GIT_AUTHOR_IDENT']);
        await this.workspace.git(repo, ['var', 'GIT_COMMITTER_IDENT']);
      } catch {
        throw new BridgeError(
          'GIT_IDENTITY',
          'Git author name/email are missing. Configure the intended identity locally; Workbridge will not invent one.',
        );
      }
      const selected: string[] = [];
      for (const file of files) {
        const [relative] = await this.workspace.gitPath(repo, file.path);
        if (!relative || relative === '.')
          throw new BridgeError('INVALID_PATH', 'Select individual files, not a repository or directory.');
        const target = await this.workspace.resolveForCreate(path.join(repo, relative));
        let hash: string | null = null;
        try {
          hash = await fileHash(await this.workspace.resolve(target));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        if (hash !== file.sha256) throw new BridgeError('CONFLICT', `Selected file changed: ${relative}`);
        selected.push(relative);
      }
      if (!selected.length || new Set(selected).size !== selected.length)
        throw new BridgeError('INVALID_PATH', 'Select at least one distinct file.');
      await mkdir(this.directory, { recursive: true });
      await atomicWrite(journal, JSON.stringify({ request, state: 'prepared', head, selected }), true);
      // Explicit paths only. --only commits these worktree paths, leaving
      // unrelated staged entries staged. Repository hooks/signing still apply.
      await this.workspace.git(repo, ['add', '-A', '--', ...selected]);
      const output = await this.workspace.git(repo, ['commit', '--only', '-m', message, '--', ...selected]);
      const commit = await this.workspace.revision(repo, 'HEAD');
      await atomicWrite(journal, JSON.stringify({ request, state: 'committed', commit, selected }));
      return { operationId, commit, output: output.slice(0, limits.outputChars), replayed: false };
    });
  }
}
