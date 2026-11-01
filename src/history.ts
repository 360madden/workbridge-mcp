import { lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError, errorDetails, limits } from './core.js';
import type { Workspace } from './workspace.js';

export const historyLimits = { metadataBytes: 256 * 1024, scanRecords: 1000 };
export const historyFilters = {
  project: z.string().min(1).max(4096).optional(),
  path: z.string().min(1).max(4096).optional(),
  scanLimit: z.number().int().min(1).max(historyLimits.scanRecords).default(200),
};
export type HistoryFilters = { project?: string; path?: string; state?: string; scanLimit?: number };
const key = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
const within = (directory: string, target: string) => {
  const relative = path.relative(directory, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
};

/** Bounded metadata only. Separate backup files and diffs are never read. */
export async function historyJson(file: string) {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new BridgeError('HISTORY_METADATA', 'History metadata must be a regular file, not a link.');
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > historyLimits.metadataBytes)
      throw new BridgeError(
        'HISTORY_METADATA_LIMIT',
        'History metadata exceeds its bounded read limit. Use the known operation ID for recovery.',
      );
    const bytes = Buffer.alloc(Math.min(info.size + 1, historyLimits.metadataBytes + 1));
    let total = 0;
    while (total < bytes.length) {
      const read = await handle.read(bytes, total, bytes.length - total, total);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    if (total > info.size || total > historyLimits.metadataBytes)
      throw new BridgeError(
        'HISTORY_METADATA_CHANGED',
        'History metadata changed while being read. Retry discovery.',
      );
    try {
      return JSON.parse(bytes.subarray(0, total).toString('utf8')) as unknown;
    } catch {
      throw new BridgeError('HISTORY_METADATA', 'History metadata is invalid JSON.');
    }
  } finally {
    await handle.close();
  }
}

export async function historyMatch(workspace: Workspace, filters: HistoryFilters) {
  const project =
    filters.project === undefined ? undefined : await workspace.historyPath(filters.project, true);
  const file = filters.path === undefined ? undefined : await workspace.historyPath(filters.path);
  return async (paths: string[], state: string) => {
    const targets = paths.map((item) => path.resolve(workspace.root, item));
    const matches =
      (filters.state === undefined || filters.state === state) &&
      targets.some(
        (target) =>
          (project === undefined || within(project, target)) &&
          (file === undefined || key(file) === key(target)),
      );
    if (!matches) return false;
    // Validate every path in a matching record, including paths outside the selected project.
    for (const item of paths) await workspace.historyPath(item);
    return true;
  };
}

export async function historyPage<T>(options: {
  directory: string;
  directories: boolean;
  offset: number;
  limit: number;
  scanLimit?: number;
  load: (id: string) => Promise<T | null>;
}) {
  const scanLimit = options.scanLimit ?? 200;
  if (
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    options.offset > 100000 ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 100 ||
    !Number.isInteger(scanLimit) ||
    scanLimit < 1 ||
    scanLimit > historyLimits.scanRecords
  )
    throw new BridgeError(
      'INVALID_HISTORY_PAGE',
      'Use a nonnegative offset, limit 1-100, and scanLimit 1-1000.',
    );
  const deadline = Date.now() + limits.scanMs;
  const names: string[] = [];
  let entries = 0,
    catalogTruncated = false,
    timeLimitReached = false;
  try {
    const directory = await lstat(options.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new BridgeError('HISTORY_METADATA', 'The history catalog must be a regular directory.');
    for await (const entry of await opendir(options.directory)) {
      if (++entries > limits.scanEntries || Date.now() >= deadline) {
        catalogTruncated = true;
        timeLimitReached = Date.now() >= deadline;
        break;
      }
      const id = options.directories ? entry.name : entry.name.replace(/\.json$/, '');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
      if (
        options.directories
          ? entry.isDirectory() || entry.isSymbolicLink()
          : (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.json')
      )
        names.push(id);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  names.sort();
  const items: T[] = [],
    issues: ({ operationId: string } & ReturnType<typeof errorDetails>)[] = [];
  let cursor = options.offset,
    scanned = 0,
    outputLimitReached = false;
  // Reserve room for the fixed metadata and array delimiters.
  let characters = 1024;
  while (cursor < names.length && scanned < scanLimit && items.length + issues.length < options.limit) {
    if (Date.now() >= deadline) {
      timeLimitReached = true;
      break;
    }
    const id = names[cursor]!;
    let item: T | null = null,
      issue: (typeof issues)[number] | undefined;
    scanned++;
    try {
      item = await options.load(id);
    } catch (error) {
      issue = { operationId: id, ...errorDetails(error) };
    }
    let size = item !== null || issue ? JSON.stringify(issue ?? item).length + 1 : 0;
    if (size + 1024 > limits.outputChars) {
      item = null;
      issue = {
        operationId: id,
        code: 'HISTORY_ENTRY_LIMIT',
        message: 'One history summary exceeds the output budget. Inspect this operation by ID.',
      };
      size = JSON.stringify(issue).length + 1;
    }
    if (characters + size > limits.outputChars) {
      outputLimitReached = true;
      break;
    }
    cursor++;
    characters += size;
    if (issue) issues.push(issue);
    else if (item !== null) items.push(item);
  }
  const nextOffset = cursor < names.length ? cursor : null;
  return {
    schemaVersion: 1 as const,
    items,
    issues,
    scanned,
    nextOffset,
    catalogTruncated,
    scanLimitReached: scanned >= scanLimit && nextOffset !== null,
    outputLimitReached,
    timeLimitReached,
    hasErrors: issues.length > 0,
    complete:
      nextOffset === null &&
      !catalogTruncated &&
      !timeLimitReached &&
      !outputLimitReached &&
      issues.length === 0,
    order: 'operationId ascending' as const,
    stateFreshness: 'recorded; use the operation status tool for current files',
  };
}
