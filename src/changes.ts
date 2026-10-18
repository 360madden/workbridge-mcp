import { mkdir, open, rename, unlink, link, readFile, readdir, rmdir, lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import type { Workspace } from './workspace.js';
import { BridgeError, limits } from './core.js';
import { decodeText, fileHash } from './text.js';

export const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export async function atomicWrite(file: string, data: Buffer | string, exclusive = false) {
  const temporary = path.join(path.dirname(file), `.workbridge-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (exclusive) await link(temporary, file);
    else await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
}
type RecordData = {
  id: string;
  request: string;
  type: 'write' | 'mkdir' | 'move' | 'delete';
  path: string;
  destination?: string;
  before: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  directory: boolean;
  state: 'prepared' | 'applied' | 'failed' | 'undone';
  time: string;
  error?: string;
};
export function encodeText(text: string, original?: Buffer) {
  if (!original) return Buffer.from(text, 'utf8');
  const eol = decodeText(original).text.includes('\r\n')
    ? '\r\n'
    : decodeText(original).text.includes('\r')
      ? '\r'
      : '\n';
  text = text.replace(/\r\n|\r|\n/g, eol);
  if (original[0] === 255 && original[1] === 254)
    return Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]);
  if (original[0] === 254 && original[1] === 255)
    return Buffer.concat([Buffer.from([254, 255]), Buffer.from(text, 'utf16le').swap16()]);
  return Buffer.concat([
    original.subarray(0, 3).equals(Buffer.from([239, 187, 191]))
      ? Buffer.from([239, 187, 191])
      : Buffer.alloc(0),
    Buffer.from(text),
  ]);
}
export class Changes {
  readonly serial = new Serial();
  constructor(
    private workspace: Workspace,
    private directory: string,
  ) {
    workspace.protect(directory);
  }
  private journal(id: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
      throw new BridgeError(
        'INVALID_OPERATION_ID',
        'Use a unique operation ID containing letters, digits, underscores or hyphens.',
      );
    return path.join(this.directory, `${id}.json`);
  }
  private async save(record: RecordData) {
    await mkdir(this.directory, { recursive: true });
    // Keep metadata small: listing changes must not load every file backup.
    if (record.before !== null && record.before !== `${record.id}.before`) {
      await atomicWrite(
        path.join(this.directory, `${record.id}.before`),
        Buffer.from(record.before, 'base64'),
        true,
      );
      record.before = `${record.id}.before`;
    }
    await atomicWrite(this.journal(record.id), JSON.stringify(record));
  }
  private async backup(record: RecordData) {
    if (record.before !== `${record.id}.before`)
      throw new BridgeError(
        'CORRUPT_BACKUP',
        'Backup metadata is invalid; the working file was not restored.',
      );
    const bytes = await readFile(path.join(this.directory, record.before));
    if (digest(bytes) !== record.beforeHash)
      throw new BridgeError('CORRUPT_BACKUP', 'Backup checksum failed; the working file was not restored.');
    return bytes;
  }
  private async load(id: string): Promise<RecordData | null> {
    try {
      return JSON.parse(await readFile(this.journal(id), 'utf8')) as RecordData;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  private async bytes(target: string) {
    const info = await lstat(target);
    if (!info.isFile()) throw new BridgeError('NOT_FILE', 'This operation requires a regular file.');
    if (info.size > limits.editBytes)
      throw new BridgeError(
        'EDIT_LIMIT',
        `Recoverable edits/moves/deletes are limited to ${limits.editBytes} bytes. Large text reads have no file-size cap.`,
      );
    const h = await open(target, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(info.size + 1, limits.editBytes + 1));
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await h.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > limits.editBytes)
        throw new BridgeError('EDIT_LIMIT', 'File grew beyond the editable size limit.');
      if (total !== info.size) throw new BridgeError('CONFLICT', 'File changed while preparing its backup.');
      return buffer.subarray(0, total);
    } finally {
      await h.close();
    }
  }
  private async verify(target: string, hash: string | null) {
    try {
      await this.workspace.resolve(target);
      if (hash === null || (await fileHash(target)) !== hash)
        throw new BridgeError(
          'CONFLICT',
          'File changed or destination exists. Reread it before changing anything.',
        );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && hash === null) return;
      throw e;
    }
  }
  private summary(r: RecordData) {
    return {
      operationId: r.id,
      type: r.type,
      path: r.path,
      destination: r.destination,
      state: r.state,
      beforeHash: r.beforeHash,
      afterHash: r.afterHash,
      time: r.time,
      error: r.error,
    };
  }
  private async perform(
    id: string,
    request: unknown,
    prepare: () => Promise<Omit<RecordData, 'id' | 'request' | 'time' | 'state'>>,
    apply: (r: RecordData) => Promise<void>,
  ) {
    return this.serial.run(async () => {
      const requestHash = digest(JSON.stringify(request));
      const previous = await this.load(id);
      if (previous) {
        if (previous.request !== requestHash)
          throw new BridgeError('ID_REUSE', 'This operation ID was used for different arguments.');
        if (previous.state === 'prepared')
          throw new BridgeError(
            'OPERATION_UNCERTAIN',
            'This operation was interrupted. Inspect change_status and the file before retrying with another ID.',
          );
        return { ...this.summary(previous), replayed: true };
      }
      const record: RecordData = {
        ...(await prepare()),
        id,
        request: requestHash,
        time: new Date().toISOString(),
        state: 'prepared',
      };
      await this.save(record);
      try {
        await apply(record);
        record.state = 'applied';
      } catch (e) {
        record.state = 'failed';
        record.error = e instanceof BridgeError ? e.code : ((e as NodeJS.ErrnoException).code ?? 'IO_ERROR');
        await this.save(record);
        throw e;
      }
      await this.save(record);
      let diff: string | undefined;
      if (record.type === 'write') {
        const before = record.before ? decodeText(await this.backup(record)).text : '';
        const after = decodeText(await this.bytes(await this.workspace.resolve(record.path))).text;
        diff = createTwoFilesPatch(record.path, record.path, before, after, '', '', {
          context: 3,
          timeout: 250,
          maxEditLength: 10000,
        });
      }
      return {
        ...this.summary(record),
        ...(record.type === 'write'
          ? {
              diff: diff?.slice(0, limits.outputChars),
              diffTruncated: diff === undefined || diff.length > limits.outputChars,
            }
          : {}),
        replayed: false,
      };
    });
  }
  async write(id: string, file: string, content: string, expectedHash: string | null) {
    return this.writeOrEdit(id, file, { content }, expectedHash);
  }
  async edit(
    id: string,
    file: string,
    edits: { oldText: string; newText: string; occurrences: number }[],
    expectedHash: string,
  ) {
    return this.writeOrEdit(id, file, { edits }, expectedHash);
  }
  private writeOrEdit(
    id: string,
    file: string,
    input: { content?: string; edits?: { oldText: string; newText: string; occurrences: number }[] },
    expectedHash: string | null,
  ) {
    let output: Buffer;
    return this.perform(
      id,
      { type: 'write', file, input, expectedHash },
      async () => {
        const target = await this.workspace.resolveForCreate(file);
        await this.verify(target, expectedHash);
        const before = expectedHash === null ? null : await this.bytes(target);
        if (before && digest(before) !== expectedHash)
          throw new BridgeError('CONFLICT', 'File changed while preparing the edit.');
        let content = input.content ?? decodeText(before!).text;
        if (input.edits) {
          const eol = content.includes('\r\n') ? '\r\n' : content.includes('\r') ? '\r' : '\n';
          for (const edit of input.edits) {
            const oldText = edit.oldText.replace(/\r\n|\r|\n/g, eol),
              newText = edit.newText.replace(/\r\n|\r|\n/g, eol);
            if (!oldText) throw new BridgeError('INVALID_EDIT', 'oldText must not be empty.');
            let count = 0,
              at = 0;
            while ((at = content.indexOf(oldText, at)) !== -1) {
              count++;
              at += oldText.length;
              if (count > edit.occurrences) break;
            }
            if (count !== edit.occurrences)
              throw new BridgeError(
                'EDIT_MISMATCH',
                `Expected ${edit.occurrences} exact occurrences; found ${count}. Reread and narrow the edit.`,
              );
            if (content.length + count * (newText.length - oldText.length) > limits.editBytes)
              throw new BridgeError('EDIT_LIMIT', 'The edit would expand beyond the editable limit.');
            content = content.replaceAll(oldText, newText);
          }
        }
        output = encodeText(content, before ?? undefined);
        if (output.length > limits.editBytes || content.includes('\0'))
          throw new BridgeError(
            'EDIT_LIMIT',
            'Expected text within the editable byte limit, without NUL characters.',
          );
        return {
          type: 'write',
          path: this.workspace.relative(target),
          before: before?.toString('base64') ?? null,
          beforeHash: before ? digest(before) : null,
          afterHash: digest(output),
          directory: false,
        };
      },
      async (r) => {
        const target = await this.workspace.resolveForCreate(r.path);
        await this.verify(target, expectedHash);
        await atomicWrite(target, output!, expectedHash === null);
        await this.verify(target, r.afterHash);
      },
    );
  }
  createDirectory(id: string, directory: string) {
    return this.perform(
      id,
      { type: 'mkdir', directory },
      async () => {
        const target = await this.workspace.resolveForCreate(directory);
        try {
          await stat(target);
          throw new BridgeError('CONFLICT', 'Destination already exists.');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        return {
          type: 'mkdir',
          path: this.workspace.relative(target),
          before: null,
          beforeHash: null,
          afterHash: null,
          directory: true,
        };
      },
      async (r) => {
        await mkdir(await this.workspace.resolveForCreate(r.path));
      },
    );
  }
  private async moveExact(source: string, destination: string) {
    const caseOnly = process.platform === 'win32' && source.toLowerCase() === destination.toLowerCase();
    if (caseOnly) {
      const temporary = path.join(path.dirname(source), `.workbridge-${randomUUID()}.tmp`);
      await rename(source, temporary);
      try {
        await rename(temporary, destination);
      } catch (e) {
        await rename(temporary, source);
        throw e;
      }
    } else {
      await link(source, destination);
      try {
        await unlink(source);
      } catch (e) {
        await unlink(destination).catch(() => {});
        throw e;
      }
    }
  }
  move(id: string, file: string, destination: string, expectedHash: string) {
    return this.perform(
      id,
      { type: 'move', file, destination, expectedHash },
      async () => {
        const target = await this.workspace.resolve(file),
          dest = await this.workspace.resolveForCreate(destination);
        if (target === dest) throw new BridgeError('INVALID_PATH', 'Source and destination are identical.');
        if (!(process.platform === 'win32' && target.toLowerCase() === dest.toLowerCase()))
          await this.verify(dest, null);
        await this.verify(target, expectedHash);
        const before = await this.bytes(target);
        return {
          type: 'move',
          path: this.workspace.relative(target),
          destination: this.workspace.relative(dest),
          before: before.toString('base64'),
          beforeHash: digest(before),
          afterHash: digest(before),
          directory: false,
        };
      },
      async (r) => {
        const source = await this.workspace.resolve(r.path),
          dest = await this.workspace.resolveForCreate(r.destination!);
        await this.verify(source, r.beforeHash);
        await this.moveExact(source, dest);
      },
    );
  }
  delete(id: string, file: string, expectedHash: string | null) {
    return this.perform(
      id,
      { type: 'delete', file, expectedHash },
      async () => {
        const target = await this.workspace.resolveForCreate(file),
          info = await lstat(await this.workspace.resolve(target));
        if (info.isDirectory()) {
          if ((await readdir(target)).length)
            throw new BridgeError(
              'NOT_EMPTY',
              'Only empty directories can be deleted. Select individual files instead of recursive deletion.',
            );
          return {
            type: 'delete',
            path: this.workspace.relative(target),
            before: null,
            beforeHash: null,
            afterHash: null,
            directory: true,
          };
        }
        if (!expectedHash)
          throw new BridgeError('HASH_REQUIRED', 'Read the file or get its SHA256 before deletion.');
        await this.verify(target, expectedHash);
        const before = await this.bytes(target);
        return {
          type: 'delete',
          path: this.workspace.relative(target),
          before: before.toString('base64'),
          beforeHash: digest(before),
          afterHash: null,
          directory: false,
        };
      },
      async (r) => {
        const target = await this.workspace.resolve(r.path);
        if (r.directory) await rmdir(target);
        else {
          await this.verify(target, r.beforeHash);
          await unlink(target);
        }
      },
    );
  }
  async list(offset = 0, limit = 20) {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter((x) => /^[A-Za-z0-9_-]+\.json$/.test(x));
    const records: (RecordData | null)[] = [];
    for (const name of files) records.push(await this.load(name.slice(0, -5)));
    const sorted = records.filter((x): x is RecordData => !!x).sort((a, b) => b.time.localeCompare(a.time));
    return {
      changes: sorted.slice(offset, offset + limit).map((r) => this.summary(r)),
      nextOffset: offset + limit < sorted.length ? offset + limit : null,
    };
  }
  async status(id: string) {
    const record = await this.load(id);
    if (!record) throw new BridgeError('UNKNOWN_CHANGE', 'No such operation ID.');
    const current: Record<string, { exists: boolean; sha256: string | null }> = {};
    for (const file of [record.path, record.destination].filter((x): x is string => !!x)) {
      try {
        const info = await this.workspace.info(file, !record.directory);
        current[file] = { exists: true, sha256: info.sha256 };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        current[file] = { exists: false, sha256: null };
      }
    }
    return { ...this.summary(record), current };
  }
  undo(id: string) {
    return this.serial.run(async () => {
      const r = await this.load(id);
      if (!r) throw new BridgeError('UNKNOWN_CHANGE', 'No such operation ID.');
      if (r.state === 'undone') return { ...this.summary(r), replayed: true };
      if (r.state !== 'applied')
        throw new BridgeError(
          'OPERATION_UNCERTAIN',
          'Only completed changes can be undone automatically. Inspect this operation and the affected paths.',
        );
      const target = await this.workspace.resolveForCreate(r.path);
      if (r.type === 'mkdir') await rmdir(await this.workspace.resolve(target));
      else if (r.type === 'delete') {
        await this.verify(target, null);
        if (r.directory) await mkdir(target);
        else await atomicWrite(target, await this.backup(r), true);
      } else if (r.type === 'move') {
        const dest = await this.workspace.resolve(r.destination!);
        await this.verify(dest, r.afterHash);
        if (!(process.platform === 'win32' && target.toLowerCase() === dest.toLowerCase()))
          await this.verify(target, null);
        await this.moveExact(dest, target);
      } else {
        await this.verify(target, r.afterHash);
        if (r.before === null) await unlink(target);
        else await atomicWrite(target, await this.backup(r));
      }
      r.state = 'undone';
      await this.save(r);
      return { ...this.summary(r), replayed: false };
    });
  }
}
