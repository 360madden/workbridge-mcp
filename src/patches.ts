import { lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { applyPatch, createTwoFilesPatch, parsePatch } from 'diff';
import { z } from 'zod';
import { atomicWrite, digest, encodeText, type Serial } from './changes.js';
import { BridgeError, errorDetails, limits } from './core.js';
import { decodeText, fingerprint } from './text.js';
import type { Workspace } from './workspace.js';
import { historyLimits, historyMatch, historyPage, type HistoryFilters } from './history.js';

export const patchLimits = {
  files: 20,
  inputBytes: 2 * 1024 * 1024,
  snapshotBytes: 32 * 1024 * 1024,
  diffChars: 2 * 1024 * 1024,
};
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const patchFilesSchema = z
  .array(
    z
      .object({
        path: z.string().min(1).max(4096),
        expectedHash: hash.nullable(),
        patch: z.string().min(1).max(patchLimits.inputBytes),
      })
      .strict(),
  )
  .min(1)
  .max(patchLimits.files);
export type PatchFile = z.infer<typeof patchFilesSchema>[number];
const progressSchema = z.enum(['pending', 'applying', 'applied', 'undoing', 'undone']);
export const patchStates = ['prepared', 'applying', 'applied', 'undoing', 'undone', 'blocked'] as const;
const entrySchema = z
  .object({
    path: z.string().min(1).max(4096),
    action: z.enum(['create', 'update', 'delete']),
    beforeHash: hash.nullable(),
    afterHash: hash.nullable(),
    beforeBytes: z.number().int().min(0).max(limits.editBytes),
    afterBytes: z.number().int().min(0).max(limits.editBytes),
    progress: progressSchema,
  })
  .strict();
const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: idSchema,
    requestHash: hash,
    workspaceRoot: z.string().min(1).max(4096),
    state: z.enum(patchStates),
    direction: z.enum(['apply', 'undo']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    files: z.array(entrySchema).min(1).max(patchLimits.files),
    diffHash: hash,
    diffBytes: z
      .number()
      .int()
      .min(0)
      .max(patchLimits.diffChars * 4),
    diffComplete: z.boolean(),
    error: z
      .object({ code: z.string(), fileIndex: z.number().int().min(0).optional() })
      .strict()
      .optional(),
  })
  .strict();
type Entry = z.infer<typeof entrySchema>;
type RecordData = z.infer<typeof recordSchema>;
type Prepared = { entry: Entry; before: Buffer | null; after: Buffer | null };
const normalize = (text: string) => text.replace(/\r\n|\r/g, '\n');
const key = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);

/** Recoverable file sets, serialized with single-file edits and selected-file commits. */
export class Patches {
  constructor(
    private workspace: Workspace,
    private directory: string,
    private serial: Serial,
  ) {
    workspace.protect(directory);
  }
  private location(id: string) {
    if (!idSchema.safeParse(id).success)
      throw new BridgeError('INVALID_OPERATION_ID', 'Invalid patch operation ID.');
    return path.join(this.directory, id);
  }
  private async regularDirectory(target: string) {
    const entry = await lstat(target);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new BridgeError('CORRUPT_PATCH', 'Patch storage must use regular directories, not links.');
  }
  private async journalDirectory(id: string) {
    const directory = this.location(id);
    await this.regularDirectory(this.directory);
    await this.regularDirectory(directory);
    return directory;
  }
  private async bytes(target: string, maximum = limits.editBytes): Promise<Buffer> {
    const entry = await lstat(target);
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new BridgeError('NOT_FILE', 'Patches require regular files, not links.');
    const handle = await open(target, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new BridgeError('NOT_FILE', 'Patches require regular files.');
      if (fingerprint(entry) !== fingerprint(info))
        throw new BridgeError('CONFLICT', 'File changed before it could be read.');
      if (info.size > maximum) throw new BridgeError('PATCH_LIMIT', 'File exceeds the patch byte limit.');
      const buffer = Buffer.alloc(info.size + 1);
      let total = 0;
      while (total < buffer.length) {
        const result = await handle.read(buffer, total, buffer.length - total, total);
        if (!result.bytesRead) break;
        total += result.bytesRead;
      }
      if (total !== info.size || fingerprint(info) !== fingerprint(await handle.stat()))
        throw new BridgeError('CONFLICT', 'File changed while being read.');
      return buffer.subarray(0, total);
    } finally {
      await handle.close();
    }
  }
  private async current(file: string) {
    const target = await this.workspace.resolveForCreate(file);
    try {
      const bytes = await this.bytes(await this.workspace.resolve(target));
      return { target, bytes, hash: digest(bytes) as string | null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { target, bytes: null, hash: null };
    }
  }
  private summary(record: RecordData) {
    const {
      requestHash: _request,
      workspaceRoot: _root,
      diffHash: _diff,
      diffBytes: _bytes,
      ...summary
    } = record;
    return summary;
  }
  private async load(id: string): Promise<RecordData | null> {
    try {
      const directory = await this.journalDirectory(id);
      const value = JSON.parse(
        (await this.bytes(path.join(directory, 'record.json'), historyLimits.metadataBytes)).toString('utf8'),
      );
      const result = recordSchema.safeParse(value);
      if (!result.success || result.data.operationId !== id) throw new Error('schema');
      const record = result.data;
      // A terminal label must agree with the direction and every file's durable progress.
      // Interrupted forward/undo states remain valid; do not infer success from a label alone.
      if (
        (record.state === 'prepared' &&
          (record.direction !== 'apply' || record.files.some((f) => f.progress !== 'pending'))) ||
        (record.state === 'applied' &&
          (record.direction !== 'apply' || record.files.some((f) => f.progress !== 'applied'))) ||
        (record.state === 'undone' &&
          (record.direction !== 'undo' || record.files.some((f) => f.progress !== 'undone'))) ||
        (record.state === 'applying' && record.direction !== 'apply') ||
        (record.state === 'undoing' && record.direction !== 'undo') ||
        (record.direction === 'apply' &&
          record.files.some((f) => f.progress === 'undoing' || f.progress === 'undone')) ||
        (record.error !== undefined && record.state !== 'blocked') ||
        (record.error?.fileIndex !== undefined && record.error.fileIndex >= record.files.length)
      )
        throw new Error('inconsistent progress');
      if (key(record.workspaceRoot) !== key(this.workspace.root))
        throw new BridgeError(
          'PATCH_WORKSPACE_MISMATCH',
          'This patch belongs to a different primary workspace root.',
        );
      if (
        new Set(record.files.map((f) => key(path.resolve(this.workspace.root, f.path)))).size !==
        record.files.length
      )
        throw new Error('duplicate');
      if (
        record.files.reduce((sum, f) => sum + f.beforeBytes + f.afterBytes, 0) > patchLimits.snapshotBytes ||
        record.files.reduce((sum, f) => sum + f.path.length, 0) > 8000
      )
        throw new Error('size');
      for (const file of record.files) {
        if (
          file.beforeHash === file.afterHash ||
          (file.action === 'create') !== (file.beforeHash === null) ||
          (file.action === 'delete') !== (file.afterHash === null) ||
          (file.beforeHash === null && file.beforeBytes !== 0) ||
          (file.afterHash === null && file.afterBytes !== 0)
        )
          throw new Error('entry');
      }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (
        error instanceof BridgeError &&
        ['INVALID_OPERATION_ID', 'PATCH_WORKSPACE_MISMATCH'].includes(error.code)
      )
        throw error;
      throw new BridgeError('CORRUPT_PATCH', 'Patch journal is invalid. No project files were changed.');
    }
  }
  private async required(id: string) {
    const record = await this.load(id);
    if (!record) throw new BridgeError('UNKNOWN_PATCH', 'No published patch set has this operation ID.');
    return record;
  }
  private async save(record: RecordData) {
    const directory = await this.journalDirectory(record.operationId);
    const file = path.join(directory, 'record.json');
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new BridgeError('CORRUPT_PATCH', 'Patch metadata must be a regular file, not a link.');
    record.updatedAt = new Date().toISOString();
    await atomicWrite(file, JSON.stringify(record));
  }
  private async prepare(input: PatchFile[]) {
    const checked = patchFilesSchema.safeParse(input);
    if (!checked.success)
      throw new BridgeError(
        'INVALID_PATCH',
        'Expected 1–20 explicit paths, hashes, and single-file unified patches.',
      );
    const files = checked.data;
    if (files.reduce((sum, file) => sum + file.path.length, 0) > 8000)
      throw new BridgeError('PATCH_LIMIT', 'Combined path labels exceed 8000 characters.');
    if (Buffer.byteLength(JSON.stringify(files)) > patchLimits.inputBytes)
      throw new BridgeError('PATCH_LIMIT', 'Combined patch input exceeds 2 MiB.');
    const seen = new Set<string>();
    const prepared: Prepared[] = [];
    const issues: Record<string, unknown>[] = [];
    let total = 0;
    for (const [fileIndex, file] of files.entries()) {
      try {
        const current = await this.current(file.path);
        if (seen.has(key(current.target)))
          throw new BridgeError('DUPLICATE_PATH', 'Each canonical path may occur only once.');
        seen.add(key(current.target));
        if (current.hash !== file.expectedHash)
          throw new BridgeError('CONFLICT', 'Expected file version differs.', {
            expectedHash: file.expectedHash,
            actualHash: current.hash,
          });
        let parsed;
        try {
          parsed = parsePatch(normalize(file.patch));
        } catch {
          throw new BridgeError('INVALID_PATCH', 'Malformed unified patch.');
        }
        const patch = parsed[0];
        if (
          parsed.length !== 1 ||
          !patch ||
          patch.isBinary ||
          patch.isCopy ||
          patch.isRename ||
          patch.oldMode ||
          patch.newMode
        )
          throw new BridgeError(
            'INVALID_PATCH',
            'Use one text patch per explicit path; binary, rename, copy, and mode patches are unsupported.',
          );
        const label = file.path.replaceAll('\\', '/');
        const canonical = this.workspace.relative(current.target);
        const names = new Set([label, canonical]);
        const matches = (name: string | undefined, side: string) =>
          !!name && (names.has(name) || (name.startsWith(`${side}/`) && names.has(name.slice(2))));
        const creation = patch.oldFileName === '/dev/null';
        const deletion = patch.newFileName === '/dev/null';
        if (
          (creation && deletion) ||
          creation !== (file.expectedHash === null) ||
          (!creation && !matches(patch.oldFileName, 'a')) ||
          (!deletion && !matches(patch.newFileName, 'b'))
        )
          throw new BridgeError(
            'PATCH_PATH',
            'Patch headers must match the explicit path; use /dev/null for creation or deletion.',
          );
        const beforeText = current.bytes ? decodeText(current.bytes).text : '';
        if (new Set(beforeText.match(/\r\n|\r|\n/g) ?? []).size > 1)
          throw new BridgeError(
            'MIXED_EOL',
            'Mixed line endings require an explicit separate normalization before patching.',
          );
        let comparisons = 0;
        const result = applyPatch(normalize(beforeText), patch, {
          fuzzFactor: 0,
          autoConvertLineEndings: false,
          compareLine: (_line, actual, _operation, expected) => {
            if (++comparisons > 4_000_000)
              throw new BridgeError(
                'PATCH_LIMIT',
                'Patch matching exceeded its work budget. Narrow the patch.',
              );
            return actual === expected;
          },
        });
        if (result === false)
          throw new BridgeError(
            'PATCH_MISMATCH',
            'Patch context does not match the expected file. Reread and regenerate the patch.',
          );
        if (deletion && result !== '')
          throw new BridgeError('INVALID_PATCH', 'A deletion patch must remove all text.');
        if (result.includes('\0')) throw new BridgeError('NOT_TEXT', 'NUL characters are not supported.');
        const after = deletion ? null : encodeText(result, current.bytes ?? undefined);
        if (after && after.length > limits.editBytes)
          throw new BridgeError('PATCH_LIMIT', 'Patched file exceeds 16 MiB.');
        const afterHash = after === null ? null : digest(after);
        if (afterHash === current.hash)
          throw new BridgeError('NO_CHANGE', 'Patch does not change the file bytes.');
        total += (current.bytes?.length ?? 0) + (after?.length ?? 0);
        if (total > patchLimits.snapshotBytes)
          throw new BridgeError('PATCH_LIMIT', 'Combined before/after snapshots exceed 32 MiB.');
        prepared.push({
          before: current.bytes,
          after,
          entry: {
            path: canonical,
            action: creation ? 'create' : deletion ? 'delete' : 'update',
            beforeHash: current.hash,
            afterHash,
            beforeBytes: current.bytes?.length ?? 0,
            afterBytes: after?.length ?? 0,
            progress: 'pending',
          },
        });
      } catch (error) {
        issues.push({ fileIndex, path: file.path, ...errorDetails(error) });
      }
    }
    if (issues.length)
      throw new BridgeError('PATCH_PREFLIGHT', 'Patch preflight failed; no project files were changed.', {
        issues,
        nextAction: 'reread_and_regenerate',
      });
    let diff = '';
    let diffComplete = true;
    for (const item of prepared) {
      const chunk = createTwoFilesPatch(
        item.before === null ? '/dev/null' : `a/${item.entry.path}`,
        item.after === null ? '/dev/null' : `b/${item.entry.path}`,
        item.before === null ? '' : normalize(decodeText(item.before).text),
        item.after === null ? '' : normalize(decodeText(item.after).text),
        '',
        '',
        { context: 3, timeout: 250, maxEditLength: 10000 },
      );
      if (chunk === undefined) diffComplete = false;
      const text = chunk ?? `# Diff generation exceeded budget for ${JSON.stringify(item.entry.path)}.\n`;
      const remaining = patchLimits.diffChars - diff.length;
      diff += text.slice(0, remaining);
      if (text.length > remaining) diffComplete = false;
    }
    return { prepared, diff, diffComplete };
  }
  preview(files: PatchFile[]) {
    return this.previewGenerated(async () => files);
  }
  /** Internal adapter for format-aware editors; generation stays under the shared mutation lock. */
  previewGenerated(generate: () => Promise<PatchFile[]>) {
    return this.serial.run(async () => {
      const plan = await this.prepare(await generate());
      return {
        schemaVersion: 1,
        applicable: true,
        files: plan.prepared.map((p) => p.entry),
        diff: plan.diff.slice(0, limits.outputChars),
        diffComplete: plan.diffComplete,
        diffTruncated: plan.diff.length > limits.outputChars || !plan.diffComplete,
        snapshotBytes: plan.prepared.reduce((sum, p) => sum + p.entry.beforeBytes + p.entry.afterBytes, 0),
      };
    });
  }
  apply(id: string, files: PatchFile[]) {
    const parsed = patchFilesSchema.safeParse(files);
    if (!parsed.success) return Promise.reject(new BridgeError('INVALID_PATCH', 'Invalid patch request.'));
    return this.applyGenerated(id, digest(JSON.stringify(parsed.data)), async () => parsed.data);
  }
  /** Bind retries to the original structured request, before regenerating from changed working files. */
  applyGenerated(id: string, requestHash: string, generate: () => Promise<PatchFile[]>) {
    return this.serial.run(async () => {
      this.location(id);
      if (!hash.safeParse(requestHash).success)
        throw new BridgeError('INVALID_PATCH', 'Invalid generated request hash.');
      const previous = await this.load(id);
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw new BridgeError('ID_REUSE', 'Patch ID belongs to different arguments.');
        if (previous.state === 'applied' || previous.state === 'undone')
          return { ...this.summary(previous), replayed: true };
        throw new BridgeError(
          'OPERATION_UNCERTAIN',
          'Inspect patch_status, then explicitly patch_resume or patch_undo.',
          { operationId: id, state: previous.state, nextAction: 'patch_status' },
        );
      }
      const plan = await this.prepare(await generate());
      const now = new Date().toISOString();
      const record: RecordData = {
        schemaVersion: 1,
        operationId: id,
        requestHash,
        workspaceRoot: this.workspace.root,
        state: 'prepared',
        direction: 'apply',
        createdAt: now,
        updatedAt: now,
        files: plan.prepared.map((p) => p.entry),
        diffHash: digest(plan.diff),
        diffBytes: Buffer.byteLength(plan.diff),
        diffComplete: plan.diffComplete,
      };
      await mkdir(this.directory, { recursive: true });
      await this.regularDirectory(this.directory);
      const stage = path.join(this.directory, `.prepare-${id}-${randomUUID()}`);
      await mkdir(stage);
      try {
        for (const [index, item] of plan.prepared.entries()) {
          for (const side of ['before', 'after'] as const) {
            if (item[side] !== null)
              await atomicWrite(path.join(stage, `${index}.${side}`), item[side], true);
          }
        }
        await atomicWrite(path.join(stage, 'combined.diff'), plan.diff, true);
        await atomicWrite(path.join(stage, 'record.json'), JSON.stringify(record), true);
        await rename(stage, this.location(id));
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
      return this.execute(record, 'apply');
    });
  }
  private async snapshots(record: RecordData) {
    await this.journalDirectory(record.operationId);
    const items: Prepared[] = [];
    for (const [index, entry] of record.files.entries()) {
      const item: Prepared = { entry, before: null, after: null };
      for (const side of ['before', 'after'] as const) {
        if (entry[`${side}Hash`] !== null) {
          try {
            const bytes = await this.bytes(path.join(this.location(record.operationId), `${index}.${side}`));
            if (bytes.length !== entry[`${side}Bytes`] || digest(bytes) !== entry[`${side}Hash`])
              throw new Error('checksum');
            item[side] = bytes;
          } catch {
            throw new BridgeError(
              'CORRUPT_PATCH',
              'Patch snapshot is missing or corrupt. No recovery writes were made.',
              { fileIndex: index, side },
            );
          }
        }
      }
      items.push(item);
    }
    return items;
  }
  private allowed(entry: Entry, actual: string | null, direction: 'apply' | 'undo') {
    if (entry.progress === 'pending' || entry.progress === 'undone') return actual === entry.beforeHash;
    if (entry.progress === 'applied') return actual === entry.afterHash;
    if (entry.progress === 'undoing' && direction === 'apply') return false;
    return actual === entry.beforeHash || actual === entry.afterHash;
  }
  private async execute(record: RecordData, direction: 'apply' | 'undo') {
    let fileIndex: number | undefined;
    try {
      const snapshots = await this.snapshots(record);
      const observed = [];
      const issues = [];
      // Validate the entire set and all backups before the first recovery write.
      for (const [index, entry] of record.files.entries()) {
        try {
          const current = await this.current(entry.path);
          if (!this.allowed(entry, current.hash, direction))
            throw new BridgeError('CONFLICT', 'File differs from the recorded patch state.', {
              beforeHash: entry.beforeHash,
              afterHash: entry.afterHash,
              actualHash: current.hash,
              progress: entry.progress,
            });
          observed.push(current.hash);
        } catch (error) {
          issues.push({ fileIndex: index, path: entry.path, ...errorDetails(error) });
        }
      }
      if (issues.length)
        throw new BridgeError(
          'PATCH_CONFLICT',
          'Patch set conflicts with current files. No files were changed by this attempt.',
          { issues },
        );
      record.direction = direction;
      record.state = direction === 'apply' ? 'applying' : 'undoing';
      delete record.error;
      await this.save(record);
      const indexes = record.files.map((_, i) => i);
      if (direction === 'undo') indexes.reverse();
      for (const index of indexes) {
        fileIndex = index;
        const entry = record.files[index]!;
        const desired = direction === 'apply' ? entry.afterHash : entry.beforeHash;
        const finalProgress = direction === 'apply' ? 'applied' : 'undone';
        if (observed[index] !== desired) {
          // Persist intent before the write, so a crash after rename can be reconciled by hash.
          const previousProgress = entry.progress;
          entry.progress = direction === 'apply' ? 'applying' : 'undoing';
          await this.save(record);
          const current = await this.current(entry.path);
          if (current.hash !== observed[index]) {
            entry.progress = previousProgress;
            throw new BridgeError('PATCH_CONFLICT', 'File changed after patch preflight.', {
              fileIndex: index,
              path: entry.path,
              actualHash: current.hash,
            });
          }
          const bytes = snapshots[index]![direction === 'apply' ? 'after' : 'before'];
          if (bytes === null) await unlink(await this.workspace.resolve(current.target));
          else await atomicWrite(current.target, bytes, current.hash === null);
          if ((await this.current(entry.path)).hash !== desired)
            throw new BridgeError('PATCH_CONFLICT', 'File changed during patch application.', {
              fileIndex: index,
            });
        }
        entry.progress = finalProgress;
        await this.save(record);
      }
      for (const [index, entry] of record.files.entries()) {
        fileIndex = index;
        const expected = direction === 'apply' ? entry.afterHash : entry.beforeHash;
        if ((await this.current(entry.path)).hash !== expected)
          throw new BridgeError(
            'PATCH_CONFLICT',
            'A file changed before the complete set could be verified.',
            { fileIndex: index, path: entry.path },
          );
      }
      record.state = direction === 'apply' ? 'applied' : 'undone';
      await this.save(record);
      return { ...this.summary(record), replayed: false };
    } catch (error) {
      record.state = 'blocked';
      record.error = { code: errorDetails(error).code, ...(fileIndex !== undefined ? { fileIndex } : {}) };
      await this.save(record).catch(() => undefined);
      throw new BridgeError(
        'PATCH_BLOCKED',
        'Patch did not complete. Inspect its state before explicit recovery.',
        {
          operationId: record.operationId,
          direction: record.direction,
          state: record.state,
          cause: errorDetails(error),
          nextAction: 'patch_status',
        },
      );
    }
  }
  resume(id: string) {
    return this.serial.run(async () => {
      const record = await this.required(id);
      if (record.direction === 'undo' || record.state === 'undone')
        throw new BridgeError(
          'PATCH_DIRECTION',
          'Undo has started; continue patch_undo. To reapply, create a new patch ID from fresh hashes.',
        );
      if (record.state === 'applied') return { ...this.summary(record), replayed: true };
      return this.execute(record, 'apply');
    });
  }
  undo(id: string) {
    return this.serial.run(async () => {
      const record = await this.required(id);
      if (record.state === 'undone') return { ...this.summary(record), replayed: true };
      return this.execute(record, 'undo');
    });
  }
  async status(id: string) {
    const record = await this.required(id);
    const current = [];
    for (const entry of record.files) {
      try {
        const value = await this.current(entry.path);
        current.push({
          path: entry.path,
          sha256: value.hash,
          matches:
            value.hash === entry.beforeHash
              ? 'before'
              : value.hash === entry.afterHash
                ? 'after'
                : 'conflict',
        });
      } catch (error) {
        current.push({
          path: entry.path,
          sha256: null,
          matches: 'unavailable',
          error: errorDetails(error),
        });
      }
    }
    return {
      ...this.summary(record),
      current,
      nextAction:
        record.state === 'undone'
          ? 'none'
          : record.direction === 'undo'
            ? 'patch_undo'
            : record.state === 'applied'
              ? 'patch_diff_or_patch_undo'
              : 'patch_resume_or_patch_undo',
    };
  }
  async diff(id: string, offset = 0, limit = limits.outputChars) {
    const record = await this.required(id);
    let bytes;
    try {
      const directory = await this.journalDirectory(id);
      bytes = await this.bytes(path.join(directory, 'combined.diff'), patchLimits.diffChars * 4);
    } catch {
      throw new BridgeError('CORRUPT_PATCH', 'Saved combined diff is missing or invalid.');
    }
    if (bytes.length !== record.diffBytes || digest(bytes) !== record.diffHash)
      throw new BridgeError('CORRUPT_PATCH', 'Saved combined diff checksum failed.');
    const text = bytes.toString('utf8');
    return {
      schemaVersion: 1,
      operationId: id,
      diff: text.slice(offset, offset + limit),
      offset,
      nextOffset: offset + limit < text.length ? offset + limit : null,
      totalChars: text.length,
      diffComplete: record.diffComplete,
      diffTruncated: offset + limit < text.length || !record.diffComplete,
    };
  }
  async list(offset = 0, limit = 20, filters: HistoryFilters = {}) {
    const matches = await historyMatch(this.workspace, filters);
    const { items, ...page } = await historyPage({
      directory: this.directory,
      directories: true,
      offset,
      limit,
      scanLimit: filters.scanLimit,
      load: async (id) => {
        const record = await this.load(id);
        if (!record) throw new BridgeError('UNKNOWN_PATCH', 'No published patch set has this operation ID.');
        if (
          !(await matches(
            record.files.map((file) => file.path),
            record.state,
          ))
        )
          return null;
        const { files, ...summary } = this.summary(record);
        return { ...summary, fileCount: files.length };
      },
    });
    return { ...page, patches: items };
  }
}
