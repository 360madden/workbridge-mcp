import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// Standalone, offline and read-only. No owner discovery, service imports or writes.
// Usage: node scripts/preview-job-retention.mjs --jobs-dir PATH [--older-than-days 90]
// Exit 0: complete inventory; 1: incomplete/error inventory; 2: invalid arguments.
export const retentionLimits = Object.freeze({
  maxEntries: 20_000,
  maxRecords: 10_000,
  maxRecordBytes: 16 * 1024 * 1024,
  maxReadBytes: 256 * 1024 * 1024,
  maxScanMs: 20_000,
});
const ceilings = { ...retentionLimits, maxEntries: 100_000, maxRecords: 100_000, maxScanMs: 60_000 };
const statuses = ['running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted'];
const knownKeys = new Set([
  'id',
  'project',
  'command',
  'request',
  'status',
  'startedAt',
  'endedAt',
  'exitCode',
  'output',
  'outputTruncated',
  'error',
  'errorCode',
  'mode',
  'executable',
  'timeoutSeconds',
  'stdout',
  'stderr',
]);
const recordName = /^([A-Za-z0-9_-]{1,100})\.json$/;
const evidenceName = /^[A-Za-z0-9_-]{1,100}\.result\.json$/;
const dayMs = 86_400_000;
const stamp = (s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.nlink}`;
const sameDirectory = (a, b) => a.dev === b.dev && a.ino === b.ino;
const regularDirectory = (s) => s.isDirectory() && !s.isSymbolicLink();
const fail = (code) => Object.assign(new Error(code), { code });
const string = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
const date = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)) return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === v.slice(0, 19);
};

// Conservative mirror of the persisted Jobs schema; extra fields are preserved,
// but disqualify review because a future field could change ownership semantics.
function validRecord(j, id) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  if (
    j.id !== id ||
    !string(j.project, 4096, 1) ||
    !string(j.command, 4096) ||
    typeof j.request !== 'string' ||
    !/^[a-f0-9]{64}$/.test(j.request) ||
    !statuses.includes(j.status) ||
    !date(j.startedAt) ||
    !(j.exitCode === null || Number.isSafeInteger(j.exitCode)) ||
    !string(j.output, 1024 * 1024) ||
    typeof j.outputTruncated !== 'boolean'
  )
    return false;
  for (const [key, max] of Object.entries({
    error: 4096,
    errorCode: 200,
    executable: 4096,
    stdout: 1024 * 1024,
    stderr: 1024 * 1024,
  })) {
    if (Object.hasOwn(j, key) && !string(j[key], max)) return false;
  }
  if (Object.hasOwn(j, 'endedAt') && !date(j.endedAt)) return false;
  if (Object.hasOwn(j, 'mode') && !['profile', 'terminal'].includes(j.mode)) return false;
  if (
    Object.hasOwn(j, 'timeoutSeconds') &&
    (!Number.isInteger(j.timeoutSeconds) || j.timeoutSeconds < 1 || j.timeoutSeconds > 600)
  )
    return false;
  return true;
}

async function directoryChain(directory) {
  const parsed = path.parse(directory);
  const paths = [parsed.root];
  for (const part of directory.slice(parsed.root.length).split(path.sep).filter(Boolean))
    paths.push(path.join(paths.at(-1), part));
  const chain = [];
  for (const [index, file] of paths.entries()) {
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error.code === 'ENOENT' && index === paths.length - 1) return { chain, missing: true };
      throw fail('UNREADABLE_JOB_CATALOG');
    }
    if (!regularDirectory(info))
      throw fail(info.isSymbolicLink() ? 'LINKED_JOB_CATALOG' : 'UNREADABLE_JOB_CATALOG');
    chain.push({ file, info });
  }
  return { chain, missing: false };
}

async function checkChain(chain) {
  for (const { file, info } of chain) {
    const current = await lstat(file);
    if (!regularDirectory(current) || !sameDirectory(info, current)) throw fail('JOB_CATALOG_CHANGED');
  }
}

async function readRecord(file, before, directory, directoryInfo, budget) {
  let handle;
  try {
    const parent = await lstat(directory);
    if (!regularDirectory(parent) || !sameDirectory(parent, directoryInfo)) throw fail('JOB_CATALOG_CHANGED');
    // O_NOFOLLOW is supported on Unix; lstat/fstat checks also apply on Windows.
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || stamp(before) !== stamp(opened))
      throw fail('JOB_RECORD_CHANGED');
    const bytes = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < bytes.length) {
      if (budget.expired()) throw fail('TIME_LIMIT_REACHED');
      const read = await handle.read(bytes, length, bytes.length - length, length);
      length += read.bytesRead;
      budget.bytesRead += read.bytesRead;
      if (!read.bytesRead) break;
    }
    const after = await handle.stat(),
      current = await lstat(file),
      parentAfter = await lstat(directory);
    if (
      length !== opened.size ||
      current.isSymbolicLink() ||
      !current.isFile() ||
      stamp(opened) !== stamp(after) ||
      stamp(opened) !== stamp(current) ||
      !regularDirectory(parentAfter) ||
      !sameDirectory(directoryInfo, parentAfter)
    )
      throw fail('JOB_RECORD_CHANGED');
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    } catch {
      throw fail('INVALID_JOB_RECORD');
    }
  } finally {
    await handle?.close();
  }
}

function add(groups, key, bytes) {
  const row = (groups[key] ??= { count: 0, bytes: 0 });
  row.count++;
  row.bytes += bytes;
}
function ageBucket(age) {
  if (age === null) return 'unknown';
  if (age < 1) return 'under_1_day';
  if (age < 7) return '1_to_7_days';
  if (age < 30) return '7_to_30_days';
  if (age < 90) return '30_to_90_days';
  return '90_days_or_more';
}
function disposition(j, now, olderThanDays) {
  if (j.status === 'running') return 'active_or_unsaved_intent';
  if (j.errorCode === 'JOB_RECORD_SAVE_FAILED') return 'unsaved_result';
  if (Object.hasOwn(j, 'error') || Object.hasOwn(j, 'errorCode')) return 'stored_error';
  if (Object.keys(j).some((key) => !knownKeys.has(key))) return 'unknown_metadata';
  if (!j.endedAt || j.exitCode === null) return 'incomplete_result';
  if (Date.parse(j.startedAt) > Date.parse(j.endedAt) || Date.parse(j.endedAt) > now)
    return 'invalid_timeline';
  if (j.status !== 'passed' || j.exitCode !== 0) return 'non_success_result';
  if (j.outputTruncated) return 'truncated_output';
  return (now - Date.parse(j.endedAt)) / dayMs >= olderThanDays ? 'old_success_review' : 'within_retention';
}

/** Counts refer only to observed entries, never to an inferred total or reclaimable bytes.
 * Offline storage cannot establish current owner health, retained in-memory results,
 * workflow references, backups, or an atomic snapshot. Review is never authorization.
 */
export async function previewJobRetention(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('INVALID_ARGUMENTS');
  const allowed = new Set(['jobsDirectory', 'now', 'olderThanDays', 'limits']);
  if (Object.keys(options).some((k) => !allowed.has(k)) || !string(options.jobsDirectory, 32768, 1))
    throw fail('INVALID_ARGUMENTS');
  const now = options.now === undefined ? Date.now() : date(options.now) ? Date.parse(options.now) : NaN;
  const olderThanDays = options.olderThanDays ?? 90;
  if (!Number.isFinite(now) || !Number.isInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 36500)
    throw fail('INVALID_ARGUMENTS');
  if (
    options.limits !== undefined &&
    (!options.limits || typeof options.limits !== 'object' || Array.isArray(options.limits))
  )
    throw fail('INVALID_ARGUMENTS');
  const limits = { ...retentionLimits, ...options.limits };
  for (const [k, v] of Object.entries(limits)) {
    if (!Object.hasOwn(ceilings, k) || !Number.isSafeInteger(v) || v < 1 || v > ceilings[k])
      throw fail('INVALID_ARGUMENTS');
  }
  const directory = path.resolve(options.jobsDirectory),
    started = performance.now();
  const budget = { bytesRead: 0, expired: () => performance.now() - started >= limits.maxScanMs };
  const result = {
    schemaVersion: 1,
    mode: 'preview',
    readOnly: true,
    complete: false,
    truncated: false,
    hasErrors: false,
    policy: {
      olderThanDays,
      ageSource: 'endedAt',
      eligibleState: 'passed',
      preserveErrors: true,
      preserveIncomplete: true,
      preserveWorkerEvidence: true,
      automaticCleanup: false,
    },
    owner: { state: 'unverified', offline: true, retainedInMemoryResultsKnown: false },
    catalog: {
      exists: null,
      scannedEntries: 0,
      recordCount: 0,
      validRecords: 0,
      invalidRecords: 0,
      uninspectedRecords: 0,
      regularFileBytes: 0,
      recordBytes: 0,
      workerEvidence: { count: 0, bytes: 0 },
      otherEntries: 0,
      bytesRead: 0,
      enumerationComplete: false,
      countsAreLowerBounds: true,
    },
    limits,
    limitsReached: { entries: false, records: false, bytes: false, time: false },
    groups: { byState: {}, byAge: {}, byDisposition: {} },
    issues: {},
    archivalReview: {
      count: 0,
      bytes: 0,
      provisional: true,
      suppressed: true,
      actionableCount: 0,
      safeToArchive: false,
      requiredChecks: [
        'complete_error_free_inventory',
        'fresh_owner_capacity_and_retained_results',
        'workflow_and_external_references',
        'backup_and_explicit_archival_approval',
      ],
    },
    limitations: [
      'not_an_atomic_snapshot',
      'bytes_are_logical_file_sizes_not_disk_space',
      'worker_evidence_not_read_or_validated',
      'no_file_contents_names_or_paths_returned',
      'cooperative_time_budget_does_not_abort_os_io',
      'filesystem_checks_do_not_eliminate_external_writer_races',
    ],
  };
  const issue = (code) => {
    result.hasErrors = true;
    result.issues[code] = (result.issues[code] ?? 0) + 1;
  };
  const stop = (key) => {
    result.truncated = true;
    result.limitsReached[key] = true;
  };
  let chain;
  try {
    const inspected = await directoryChain(directory);
    chain = inspected.chain;
    result.catalog.exists = !inspected.missing;
    if (inspected.missing) {
      await checkChain(chain);
      // Recheck absence, since an owner could create the directory concurrently.
      try {
        await lstat(directory);
        throw fail('JOB_CATALOG_CHANGED');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      result.catalog.enumerationComplete = true;
    } else {
      const directoryInfo = chain.at(-1).info;
      for await (const entry of await opendir(directory)) {
        if (budget.expired()) {
          stop('time');
          break;
        }
        if (result.catalog.scannedEntries >= limits.maxEntries) {
          stop('entries');
          break;
        }
        const id = recordName.exec(entry.name)?.[1];
        if (id && result.catalog.recordCount >= limits.maxRecords) {
          stop('records');
          break;
        }
        result.catalog.scannedEntries++;
        const file = path.join(directory, entry.name);
        let info;
        try {
          info = await lstat(file);
        } catch {
          issue('UNREADABLE_CATALOG_ENTRY');
          continue;
        }
        const bytes = info.isFile() && !info.isSymbolicLink() ? info.size : 0;
        result.catalog.regularFileBytes += bytes;
        if (id) {
          result.catalog.recordCount++;
          result.catalog.recordBytes += bytes;
        }
        if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
          issue(info.isSymbolicLink() ? 'LINKED_CATALOG_ENTRY' : 'NONREGULAR_CATALOG_ENTRY');
          if (id) {
            result.catalog.invalidRecords++;
            add(result.groups.byState, 'unknown', bytes);
            add(result.groups.byAge, 'unknown', bytes);
            add(result.groups.byDisposition, 'unreadable_record', bytes);
          }
          continue;
        }
        if (!id) {
          if (evidenceName.test(entry.name)) {
            result.catalog.workerEvidence.count++;
            result.catalog.workerEvidence.bytes += bytes;
          } else result.catalog.otherEntries++;
          continue;
        }
        if (info.size > limits.maxRecordBytes) {
          issue('OVERSIZED_JOB_RECORD');
          result.catalog.invalidRecords++;
          add(result.groups.byState, 'unknown', bytes);
          add(result.groups.byAge, 'unknown', bytes);
          add(result.groups.byDisposition, 'oversized_record', bytes);
          continue;
        }
        // Reserve an extra byte to detect growth while keeping aggregate reads bounded.
        if (budget.bytesRead + info.size + 1 > limits.maxReadBytes) {
          stop('bytes');
          break;
        }
        try {
          const record = await readRecord(file, info, directory, directoryInfo, budget);
          if (!validRecord(record, id)) throw fail('INVALID_JOB_RECORD');
          result.catalog.validRecords++;
          add(result.groups.byState, record.status, bytes);
          const ended = record.endedAt === undefined ? null : Date.parse(record.endedAt),
            age = ended !== null && ended <= now ? (now - ended) / dayMs : null;
          add(result.groups.byAge, ageBucket(age), bytes);
          add(result.groups.byDisposition, disposition(record, now, olderThanDays), bytes);
        } catch (error) {
          if (error.code === 'TIME_LIMIT_REACHED') {
            stop('time');
            break;
          }
          const code = ['INVALID_JOB_RECORD', 'JOB_RECORD_CHANGED', 'JOB_CATALOG_CHANGED'].includes(
            error.code,
          )
            ? error.code
            : 'UNREADABLE_JOB_RECORD';
          issue(code);
          result.catalog.invalidRecords++;
          add(result.groups.byState, 'unknown', bytes);
          add(result.groups.byAge, 'unknown', bytes);
          add(result.groups.byDisposition, 'unreadable_record', bytes);
        }
      }
      result.catalog.enumerationComplete = !result.truncated;
      await checkChain(chain);
      if (stamp(directoryInfo) !== stamp(await lstat(directory))) throw fail('JOB_CATALOG_CHANGED');
    }
  } catch (error) {
    issue(
      ['LINKED_JOB_CATALOG', 'JOB_CATALOG_CHANGED'].includes(error.code)
        ? error.code
        : 'UNREADABLE_JOB_CATALOG',
    );
    result.catalog.enumerationComplete = false;
  }
  if (budget.expired()) stop('time');
  result.catalog.bytesRead = budget.bytesRead;
  result.catalog.uninspectedRecords =
    result.catalog.recordCount - result.catalog.validRecords - result.catalog.invalidRecords;
  result.complete = result.catalog.enumerationComplete && !result.truncated && !result.hasErrors;
  result.catalog.countsAreLowerBounds = !result.complete;
  result.archivalReview.suppressed = !result.complete;
  if (result.complete) {
    const review = result.groups.byDisposition.old_success_review;
    result.archivalReview.count = review?.count ?? 0;
    result.archivalReview.bytes = review?.bytes ?? 0;
  }
  return result;
}

async function main(args) {
  const flags = new Map([
    ['--jobs-dir', 'jobsDirectory'],
    ['--older-than-days', 'olderThanDays'],
    ['--now', 'now'],
    ['--max-entries', 'maxEntries'],
    ['--max-records', 'maxRecords'],
    ['--max-record-bytes', 'maxRecordBytes'],
    ['--max-read-bytes', 'maxReadBytes'],
    ['--max-scan-ms', 'maxScanMs'],
  ]);
  const options = { limits: {} },
    seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i],
      key = flags.get(flag),
      value = args[i + 1];
    if (!key || seen.has(flag) || !value || value.startsWith('--')) throw fail('INVALID_ARGUMENTS');
    seen.add(flag);
    if (key === 'jobsDirectory' || key === 'now') options[key] = value;
    else {
      if (!/^[1-9]\d*$/.test(value)) throw fail('INVALID_ARGUMENTS');
      if (key === 'olderThanDays') options[key] = Number(value);
      else options.limits[key] = Number(value);
    }
  }
  const result = await previewJobRetention(options);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.complete ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    // Never echo paths, arguments, record bytes or raw filesystem errors.
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        mode: 'preview',
        readOnly: true,
        complete: false,
        truncated: false,
        errorCode: 'INVALID_ARGUMENTS',
      }) + '\n',
    );
    process.exitCode = 2;
  });
}
