import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicWrite, digest, Serial } from './changes.js';
import { BridgeError } from './core.js';
import { fingerprint } from './text.js';
import type { Workspace } from './workspace.js';
import { MAX_CONCURRENT_JOBS, type Jobs } from './jobs.js';

// Coordinator reasoning runs outside the command-job pool; workers share its hard capacity.
export const MAX_AGENT_WORKERS = MAX_CONCURRENT_JOBS;
export const agentCoordinationBytes = 1024 * 1024;
export const agentAssignmentStates = ['queued', 'running', 'review', 'verified', 'blocked'] as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const head = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const filePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\x00-\x1f\x7f]/.test(s));
export const agentAssignSchema = z
  .object({
    taskId: id,
    workerId: id,
    ownedPaths: z.array(filePath).min(1).max(100),
    baseHead: head,
    priority: z.number().int().min(0).max(100).default(0),
    dependencies: z.array(id).max(100).default([]),
    workflowId: id.optional(),
  })
  .strict();
export const agentDispatchSchema = z.object({ taskId: id, workerId: id, jobId: id, baseHead: head }).strict();
// Deliberately no free-form prose, command output, environment, or model payloads.
// Unknown receipt keys are discarded before hashing, returning, or persisting.
export const agentReceiptSchema = z
  .object({
    outcome: z.enum(['completed', 'blocked']),
    testExitCodes: z.array(z.number().int().min(-2147483648).max(2147483647)).max(100),
    artifacts: z
      .array(z.object({ path: filePath, sha256: hash }).strip())
      .max(100)
      .default([]),
  })
  .strip();
export const agentFinishSchema = agentDispatchSchema.extend({ receipt: agentReceiptSchema });
const recordSchema = agentAssignSchema
  .extend({
    state: z.enum(agentAssignmentStates),
    requestHash: hash,
    jobId: id.nullable(),
    receipt: agentReceiptSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const ledgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceRoot: filePath,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    tasks: z.array(recordSchema).max(128),
  })
  .strict();
type Assignment = z.infer<typeof recordSchema>;
type Ledger = z.infer<typeof ledgerSchema>;
type Snapshot = { ledger: Ledger; beforeHash: string | null };
type Assign = z.input<typeof agentAssignSchema>;
type Dispatch = z.input<typeof agentDispatchSchema>;
type Finish = z.input<typeof agentFinishSchema>;
const key = (s: string) => s.replaceAll('\\', '/').toLowerCase();
const overlaps = (a: string, b: string) =>
  key(a) === key(b) || key(a).startsWith(`${key(b)}/`) || key(b).startsWith(`${key(a)}/`);
const now = () => new Date().toISOString();
const fail = (code: string, message: string): never => {
  throw new BridgeError(code, message);
};
const plan = (r: z.infer<typeof agentAssignSchema>) => ({
  taskId: r.taskId,
  workerId: r.workerId,
  ownedPaths: r.ownedPaths,
  baseHead: r.baseHead,
  priority: r.priority,
  dependencies: r.dependencies,
  ...(r.workflowId ? { workflowId: r.workflowId } : {}),
});

/** Durable metadata over existing job/workflow IDs. Never launches, retries, or cancels commands.
 * Call assign, explicitly dispatch/dispatchNext once a caller-owned job exists, finish after
 * settlement, then verify after review. Only verified tasks release file ownership.
 * A crashed lock is retained for operator inspection; it is never stolen on a timer.
 */
export class AgentCoordination {
  private serial = new Serial();
  private lockIdentity: string | undefined;
  private workspace: Workspace;
  private directory: string;
  private jobs: Pick<Jobs, 'status'>;
  private currentHead: () => Promise<string>;
  constructor(
    workspace: Workspace,
    directory: string,
    jobs: Pick<Jobs, 'status'>,
    currentHead: () => Promise<string>,
  ) {
    this.workspace = workspace;
    this.directory = path.resolve(directory);
    this.jobs = jobs;
    this.currentHead = currentHead;
    workspace.protect(this.directory);
  }
  private get file() {
    return path.join(this.directory, 'assignments.json');
  }
  private get lock() {
    return path.join(this.directory, 'assignments.lock');
  }
  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      return fail('INVALID_AGENT_ASSIGNMENT', 'Invalid or oversized coordination metadata.');
    return parsed.data;
  }
  private async directoryReady() {
    // Do not traverse a linked parent, including on first creation.
    let current = path.parse(this.directory).root;
    for (const component of this.directory.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        fail('CORRUPT_AGENT_STORAGE', 'Coordination storage must use regular directories.');
    }
  }
  private locked<T>(action: () => Promise<T>) {
    return this.serial.run(async () => {
      await this.workspace.ensureConfiguration();
      await this.directoryReady();
      let handle;
      // Cross-instance/process exclusion, in addition to in-instance serialization.
      for (let attempt = 0; !handle; attempt++) {
        try {
          handle = await open(this.lock, 'wx');
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // Windows may briefly reject opens while a deleted lock is pending removal.
          // Retry only exclusive acquisition; never delete or take over an existing lock.
          if (code !== 'EEXIST' && !(process.platform === 'win32' && code === 'EPERM')) throw error;
          if (attempt >= 100) {
            if (code !== 'EEXIST') throw error;
            fail(
              'AGENT_COORDINATION_BUSY',
              'Coordination is locked; inspect the existing owner before recovery.',
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      let identity: string | undefined;
      try {
        await handle.writeFile(JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: now() }));
        identity = fingerprint(await handle.stat());
        this.lockIdentity = identity;
        return await action();
      } finally {
        // Close before unlink: Windows can retain a delete-pending lock until the
        // last handle closes, causing competing exclusive opens to fail with EPERM.
        this.lockIdentity = undefined;
        await handle.close();
        // Check identity after closing; never remove another owner's replacement.
        if (identity && fingerprint(await lstat(this.lock)) === identity) await unlink(this.lock);
      }
    });
  }
  private validate(ledger: Ledger) {
    if (ledger.workspaceRoot !== this.workspace.root)
      fail('AGENT_WORKSPACE_MISMATCH', 'Assignments belong to another workspace.');
    const seen = new Set<string>(),
      jobs = new Set<string>(),
      workers = new Set<string>();
    for (const task of ledger.tasks) {
      if (seen.has(task.taskId) || digest(JSON.stringify(plan(task))) !== task.requestHash)
        fail('CORRUPT_AGENT_STORAGE', 'Duplicate or mismatched task identity.');
      seen.add(task.taskId);
      if (task.jobId) {
        if (jobs.has(task.jobId)) fail('CORRUPT_AGENT_STORAGE', 'A job is bound to multiple tasks.');
        jobs.add(task.jobId);
      }
      if (
        (task.state === 'queued') !== (task.jobId === null) ||
        ['review', 'verified', 'blocked'].includes(task.state) !== (task.receipt !== null)
      )
        fail('CORRUPT_AGENT_STORAGE', 'Assignment state and evidence disagree.');
      if (task.state === 'running') {
        if (workers.has(task.workerId)) fail('CORRUPT_AGENT_STORAGE', 'Worker has multiple running tasks.');
        workers.add(task.workerId);
      }
      if (
        new Set(task.ownedPaths.map(key)).size !== task.ownedPaths.length ||
        task.ownedPaths.some(
          (p, i) => !path.isAbsolute(p) || task.ownedPaths.slice(i + 1).some((q) => overlaps(p, q)),
        ) ||
        new Set(task.dependencies).size !== task.dependencies.length ||
        task.dependencies.includes(task.taskId)
      )
        fail('CORRUPT_AGENT_STORAGE', 'Invalid ownership or dependencies.');
      for (const dependency of task.dependencies) {
        const other = ledger.tasks.find((v) => v.taskId === dependency);
        // References must point backward in the append-only task catalog, ruling out cycles.
        if (!other || !seen.has(dependency) || (task.state !== 'queued' && other.state !== 'verified'))
          fail('CORRUPT_AGENT_STORAGE', 'Dependency ordering or verification is invalid.');
      }
      if (
        task.receipt &&
        (task.receipt.artifacts.some((a) => !task.ownedPaths.includes(a.path)) ||
          new Set(task.receipt.artifacts.map((a) => key(a.path))).size !== task.receipt.artifacts.length ||
          (task.state !== 'blocked' && !this.passed(task.receipt)))
      )
        fail('CORRUPT_AGENT_STORAGE', 'Receipt does not match ownership or successful checks.');
    }
    if (workers.size > MAX_AGENT_WORKERS) fail('CORRUPT_AGENT_STORAGE', 'Worker capacity exceeded.');
    const owners = ledger.tasks.filter((t) => t.state !== 'verified');
    if (
      owners.some((t, i) =>
        owners.slice(i + 1).some((u) => t.ownedPaths.some((p) => u.ownedPaths.some((q) => overlaps(p, q)))),
      )
    )
      fail('CORRUPT_AGENT_STORAGE', 'Unverified tasks have overlapping ownership.');
  }
  private async load(): Promise<Snapshot> {
    let handle;
    try {
      const entry = await lstat(this.file);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > agentCoordinationBytes)
        throw new Error('file');
      handle = await open(this.file, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.size > agentCoordinationBytes || fingerprint(entry) !== fingerprint(info))
        throw new Error('changed');
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length !== info.size || fingerprint(info) !== fingerprint(await handle.stat()))
        throw new Error('changed');
      const data = bytes.subarray(0, length);
      const ledger = ledgerSchema.parse(JSON.parse(data.toString('utf8')));
      this.validate(ledger);
      return { ledger, beforeHash: digest(data) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {
          ledger: { schemaVersion: 1, workspaceRoot: this.workspace.root, revision: 0, tasks: [] },
          beforeHash: null,
        };
      if (error instanceof BridgeError) throw error;
      return fail('CORRUPT_AGENT_STORAGE', 'Invalid coordination journal; no assignments changed.');
    } finally {
      await handle?.close();
    }
  }
  private async save(snapshot: Snapshot) {
    await this.directoryReady();
    const lock = await lstat(this.lock);
    if (!lock.isFile() || lock.isSymbolicLink() || fingerprint(lock) !== this.lockIdentity)
      fail('AGENT_LOCK_LOST', 'Coordination lock changed; no assignments were published.');
    const current = await this.load();
    if (current.beforeHash !== snapshot.beforeHash)
      fail('AGENT_SAVE_CONFLICT', 'Coordination journal changed; no replacement was written.');
    snapshot.ledger.revision++;
    this.validate(snapshot.ledger);
    const data = JSON.stringify(ledgerSchema.parse(snapshot.ledger));
    if (Buffer.byteLength(data) > agentCoordinationBytes)
      fail('AGENT_LIMIT', 'Assignment journal exceeds 1 MiB.');
    await atomicWrite(this.file, data, snapshot.beforeHash === null);
  }
  private async fresh(expected: string) {
    const current = await this.currentHead();
    if (!head.safeParse(current).success || current !== expected)
      fail('STALE_AGENT_ASSIGNMENT', 'Current HEAD differs from the pinned assignment base.');
  }
  private required(ledger: Ledger, taskId: string) {
    return ledger.tasks.find((t) => t.taskId === taskId) ?? fail('UNKNOWN_AGENT_TASK', 'Unknown task ID.');
  }
  private async target(input: string) {
    const target = await this.workspace.historyPath(input);
    try {
      if (!(await lstat(target)).isFile())
        fail('INVALID_AGENT_PATH', 'Own explicit files, not directories or special files.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return target;
  }
  private async pathsFresh(task: Assignment) {
    for (const p of task.ownedPaths) {
      if ((await this.target(p)) !== p) fail('STALE_AGENT_ASSIGNMENT', 'Assignment paths changed.');
    }
  }
  private passed(receipt: z.infer<typeof agentReceiptSchema>) {
    return (
      receipt.outcome === 'completed' &&
      receipt.testExitCodes.length > 0 &&
      receipt.testExitCodes.every((n) => n === 0)
    );
  }
  private async artifactsFresh(task: Assignment) {
    for (const artifact of task.receipt?.artifacts ?? []) {
      let actualHash: string | null = null;
      try {
        const file = await this.workspace.info(artifact.path, true);
        if (file.type === 'file') actualHash = file.sha256;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (actualHash !== artifact.sha256)
        fail('AGENT_ARTIFACT_MISMATCH', 'A declared artifact is missing or its SHA256 no longer matches.');
    }
  }
  private async job(jobId: string) {
    const job = await this.jobs.status(jobId);
    if (job.id !== jobId) fail('AGENT_JOB_MISMATCH', 'Job evidence does not match the bound job ID.');
    return job;
  }
  assign(args: Assign) {
    const value = this.parse(agentAssignSchema, args);
    if (Buffer.byteLength(JSON.stringify(value)) > 32 * 1024)
      return Promise.reject(new BridgeError('AGENT_LIMIT', 'Assignment request exceeds 32 KiB.'));
    return this.locked(async () => {
      await this.fresh(value.baseHead);
      value.ownedPaths = (await Promise.all(value.ownedPaths.map((p) => this.target(p)))).sort();
      value.dependencies.sort();
      if (
        new Set(value.dependencies).size !== value.dependencies.length ||
        value.dependencies.includes(value.taskId)
      )
        fail('AGENT_DEPENDENCY', 'Dependencies must be unique earlier tasks.');
      if (value.ownedPaths.some((p, i) => value.ownedPaths.slice(i + 1).some((q) => overlaps(p, q))))
        fail('AGENT_PATH_CONFLICT', 'Owned paths must be unique nonoverlapping files.');
      const snapshot = await this.load(),
        ledger = snapshot.ledger;
      const requestHash = digest(JSON.stringify(plan(value)));
      const previous = ledger.tasks.find((t) => t.taskId === value.taskId);
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail('AGENT_ID_REUSE', 'Task ID is already bound to a different assignment.');
        return structuredClone(previous);
      }
      if (ledger.tasks.length >= 128) fail('AGENT_LIMIT', 'At most 128 tasks may be retained in a catalog.');
      for (const dependency of value.dependencies) this.required(ledger, dependency);
      if (
        ledger.tasks.some(
          (t) =>
            t.state !== 'verified' && t.ownedPaths.some((p) => value.ownedPaths.some((q) => overlaps(p, q))),
        )
      )
        fail('AGENT_PATH_CONFLICT', 'An unverified task already owns an overlapping path.');
      const task: Assignment = {
        ...value,
        requestHash,
        state: 'queued',
        jobId: null,
        receipt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      ledger.tasks.push(task);
      await this.fresh(value.baseHead);
      await this.save(snapshot);
      return structuredClone(task);
    });
  }
  private async start(snapshot: Snapshot, value: Dispatch) {
    const { ledger } = snapshot,
      task = this.required(ledger, value.taskId);
    if (task.workerId !== value.workerId || task.baseHead !== value.baseHead)
      fail('AGENT_IDENTITY_MISMATCH', 'Worker or base HEAD does not match the assignment.');
    await this.fresh(task.baseHead);
    await this.pathsFresh(task);
    if (task.jobId === value.jobId) return structuredClone(task);
    if (task.state !== 'queued') fail('AGENT_STATE', 'Only queued tasks can be dispatched.');
    if (ledger.tasks.some((t) => t.jobId === value.jobId))
      fail('AGENT_JOB_REUSE', 'Job is already bound to another task.');
    if (task.dependencies.some((d) => this.required(ledger, d).state !== 'verified'))
      fail('AGENT_DEPENDENCY', 'Dependencies must be verified before dispatch.');
    const running = ledger.tasks.filter((t) => t.state === 'running');
    if (running.some((t) => t.workerId === value.workerId))
      fail('AGENT_WORKER_BUSY', 'Worker already has a running task.');
    if (running.length >= MAX_AGENT_WORKERS)
      fail(
        'AGENT_CAPACITY',
        `All ${MAX_AGENT_WORKERS} worker assignments are active; settle one before dispatching another.`,
      );
    const job = await this.job(value.jobId);
    // Live running jobs normally report completionPending until their final result is saved.
    // That flag must block finish/verify, not dispatch of an existing live job.
    if (job.status !== 'running') fail('AGENT_JOB_STATE', 'Dispatch requires an existing running job.');
    await this.pathsFresh(task);
    task.jobId = value.jobId;
    task.state = 'running';
    task.updatedAt = now();
    await this.fresh(task.baseHead);
    await this.save(snapshot);
    return structuredClone(task);
  }
  dispatch(args: Dispatch) {
    const value = this.parse(agentDispatchSchema, args);
    return this.locked(async () => this.start(await this.load(), value));
  }
  /** Explicit queue advancement only. Higher priority first, then stable assignment order.
   * Replaying a bound job returns its original task, never dispatches another queued task.
   */
  dispatchNext(args: Omit<Dispatch, 'taskId'>) {
    const value = this.parse(agentDispatchSchema.omit({ taskId: true }), args);
    return this.locked(async () => {
      const snapshot = await this.load();
      const previous = snapshot.ledger.tasks.find((t) => t.jobId === value.jobId);
      if (previous) return this.start(snapshot, { ...value, taskId: previous.taskId });
      await this.fresh(value.baseHead);
      const task = snapshot.ledger.tasks
        .filter(
          (t) =>
            t.state === 'queued' &&
            t.workerId === value.workerId &&
            t.baseHead === value.baseHead &&
            t.dependencies.every((d) => this.required(snapshot.ledger, d).state === 'verified'),
        )
        .sort((a, b) => b.priority - a.priority)[0];
      return task ? this.start(snapshot, { ...value, taskId: task.taskId }) : null;
    });
  }
  finish(args: Finish) {
    const value = this.parse(agentFinishSchema, args);
    return this.locked(async () => {
      const snapshot = await this.load(),
        task = this.required(snapshot.ledger, value.taskId);
      if (task.workerId !== value.workerId || task.jobId !== value.jobId || task.baseHead !== value.baseHead)
        fail('AGENT_IDENTITY_MISMATCH', 'Finish must match the dispatched task, worker, job and base HEAD.');
      await this.fresh(task.baseHead);
      await this.pathsFresh(task);
      value.receipt.artifacts = await Promise.all(
        value.receipt.artifacts.map(async (a) => ({ ...a, path: await this.target(a.path) })),
      );
      value.receipt.artifacts.sort((a, b) => a.path.localeCompare(b.path));
      if (
        value.receipt.artifacts.some((a) => !task.ownedPaths.includes(a.path)) ||
        new Set(value.receipt.artifacts.map((a) => key(a.path))).size !== value.receipt.artifacts.length
      )
        fail('AGENT_RECEIPT_SCOPE', 'Receipt artifacts must be unique owned files.');
      if (task.receipt) {
        if (digest(JSON.stringify(task.receipt)) !== digest(JSON.stringify(value.receipt)))
          fail('AGENT_FINISH_CONFLICT', 'Task already has a different sanitized receipt.');
        return structuredClone(task);
      }
      if (task.state !== 'running') fail('AGENT_STATE', 'Only dispatched tasks may finish.');
      const job = await this.job(value.jobId);
      if (job.status === 'running' || job.completionPending)
        fail('AGENT_JOB_UNSETTLED', 'Job has not durably settled; ownership is retained.');
      await this.pathsFresh(task);
      task.receipt = value.receipt;
      task.state =
        job.status === 'passed' && job.exitCode === 0 && this.passed(value.receipt) ? 'review' : 'blocked';
      task.updatedAt = now();
      await this.fresh(task.baseHead);
      await this.save(snapshot);
      return structuredClone(task);
    });
  }
  verify(args: { taskId: string; baseHead: string }) {
    const value = this.parse(z.object({ taskId: id, baseHead: head }).strict(), args);
    return this.locked(async () => {
      const snapshot = await this.load(),
        task = this.required(snapshot.ledger, value.taskId);
      if (task.baseHead !== value.baseHead)
        fail('AGENT_IDENTITY_MISMATCH', 'Review must use the pinned base HEAD.');
      await this.fresh(task.baseHead);
      await this.pathsFresh(task);
      if (task.state === 'verified') return structuredClone(task);
      if (task.state !== 'review' || !task.receipt || !this.passed(task.receipt))
        fail('AGENT_STATE', 'Only a successful reviewed receipt can be verified.');
      const job = await this.job(task.jobId!);
      if (job.status !== 'passed' || job.exitCode !== 0 || job.completionPending)
        fail('AGENT_JOB_UNSETTLED', 'Verification requires a durably passed existing job.');
      await this.pathsFresh(task);
      await this.artifactsFresh(task);
      task.state = 'verified';
      task.updatedAt = now();
      await this.fresh(task.baseHead);
      await this.save(snapshot);
      return structuredClone(task);
    });
  }
  /** Recorded metadata only; does not reconcile or automatically dispatch completed workers. */
  list() {
    return this.locked(async () => {
      const { ledger } = await this.load();
      const running = ledger.tasks.filter((t) => t.state === 'running').length;
      return {
        ...structuredClone(ledger),
        maxWorkers: MAX_AGENT_WORKERS,
        running,
        available: MAX_AGENT_WORKERS - running,
        // One logical coordinator role; this is NOT a reserved terminal command slot.
        coordinatorSlots: 1,
      };
    });
  }
}
