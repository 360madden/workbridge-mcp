import { mkdir, open, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicWrite, digest, Serial } from './changes.js';
import { BridgeError, errorDetails } from './core.js';
import { fileHash, fingerprint } from './text.js';
import { historyPage } from './history.js';
import type { Workspace } from './workspace.js';
import type { Patches } from './patches.js';
import type { Jobs } from './jobs.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().min(1).max(4096);
const literal = z
  .string()
  .max(24000)
  .refine((s) => !s.includes('\0'));
const command = z
  .object({
    executable: literal.min(1).max(4096),
    args: z
      .array(literal)
      .max(256)
      .refine((args) => args.reduce((n, a) => n + a.length, 0) <= 24000),
    timeoutSeconds: z.number().int().min(1).max(600),
  })
  .strict();
const input = z.object({ path: label, expectedHash: hash.nullable() }).strict();
const check = z.discriminatedUnion('kind', [
  z
    .object({
      name: z.string().min(1).max(100),
      kind: z.literal('profile'),
      command: z.string().min(1).max(100),
    })
    .strict(),
  z.object({ name: z.string().min(1).max(100), kind: z.literal('terminal'), ...command.shape }).strict(),
]);
export const workflowCreateSchema = z
  .object({
    workflowId: id,
    title: z.string().min(1).max(200),
    project: label,
    patchOperationId: id,
    inputs: z.array(input).max(200).default([]),
    checks: z.array(check).min(1).max(10),
  })
  .strict();
export const workflowStates = [
  'pending',
  'validating',
  'ready_for_review',
  'failed',
  'stale',
  'blocked',
  'cancelled',
  'undone',
] as const;
const planSchema = z
  .object({
    title: z.string().min(1).max(200),
    project: label,
    patchOperationId: id,
    inputs: z.array(input).min(1).max(220),
    checks: z
      .array(
        z
          .object({
            name: z.string().min(1).max(100),
            kind: z.enum(['profile', 'terminal']),
            command: z.string().min(1).max(100).optional(),
            definition: command,
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
const attemptSchema = z
  .object({
    jobId: id,
    inputVersion: hash,
    invalidated: z.boolean().optional(),
    state: z.enum(['starting', 'running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted']),
    createdAt: z.iso.datetime(),
    checkedAt: z.iso.datetime().optional(),
    exitCode: z.number().int().nullable().optional(),
  })
  .strict();
const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    workflowId: id,
    workspaceRoot: label,
    requestHash: hash,
    plan: planSchema,
    planHash: hash,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    state: z.enum(workflowStates),
    cancelled: z.boolean(),
    attempts: z.array(z.array(attemptSchema).max(10)).min(1).max(10),
  })
  .strict();
type RecordData = z.infer<typeof recordSchema>;
type Create = z.input<typeof workflowCreateSchema>;
const key = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
};
const now = () => new Date().toISOString();
const jobId = (workflowId: string, step: number, attempt: number) =>
  `wf-${digest(workflowId).slice(0, 32)}-${step}-${attempt}`;

/** Explicit advancement over existing patch/job owners; no detached scheduling or automatic retries. */
export class Workflows {
  readonly serial = new Serial();
  constructor(
    private workspace: Workspace,
    private directory: string,
    private patches: Patches,
    private jobs: Jobs,
  ) {
    workspace.protect(directory);
  }
  private location(workflowId: string) {
    if (!id.safeParse(workflowId).success)
      throw new BridgeError('INVALID_WORKFLOW_ID', 'Invalid workflow ID.');
    return path.join(this.directory, `${workflowId}.json`);
  }
  private async catalog() {
    const entry = await lstat(this.directory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new BridgeError('CORRUPT_WORKFLOW', 'Workflow storage must use a regular directory, not a link.');
  }
  private async load(workflowId: string): Promise<RecordData | null> {
    let handle;
    try {
      const file = this.location(workflowId);
      await this.catalog();
      const entry = await lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('not a regular file');
      handle = await open(file, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.size > 128 * 1024) throw new Error('size');
      if (fingerprint(entry) !== fingerprint(info)) throw new Error('changed before read');
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length !== info.size || fingerprint(info) !== fingerprint(await handle.stat()))
        throw new Error('changed during read');
      const record = recordSchema.parse(JSON.parse(bytes.subarray(0, length).toString('utf8')));
      if (
        record.workflowId !== workflowId ||
        digest(JSON.stringify(record.plan)) !== record.planHash ||
        record.attempts.length !== record.plan.checks.length ||
        new Set(record.plan.inputs.map((f) => key(f.path))).size !== record.plan.inputs.length ||
        new Set(record.plan.checks.map((c) => c.name)).size !== record.plan.checks.length ||
        record.plan.checks.some((c) => (c.kind === 'profile') !== (c.command !== undefined)) ||
        record.attempts.some((a, step) => a.some((v, n) => v.jobId !== jobId(workflowId, step, n)))
      )
        throw new Error('identity');
      if (key(record.workspaceRoot) !== key(this.workspace.root))
        throw new BridgeError(
          'WORKFLOW_WORKSPACE_MISMATCH',
          'Workflow belongs to a different primary workspace root.',
        );
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(
        'CORRUPT_WORKFLOW',
        'Workflow journal is invalid. No workflow action was started.',
      );
    } finally {
      await handle?.close();
    }
  }
  private async required(workflowId: string) {
    const record = await this.load(workflowId);
    if (!record) throw new BridgeError('UNKNOWN_WORKFLOW', 'No workflow has this ID. Use workflow_list.');
    return record;
  }
  private async save(record: RecordData, exclusive = false) {
    record.updatedAt = now();
    const text = JSON.stringify(recordSchema.parse(record));
    if (Buffer.byteLength(text) > 128 * 1024)
      throw new BridgeError('WORKFLOW_LIMIT', 'Workflow journal exceeds 128 KiB.');
    await mkdir(this.directory, { recursive: true });
    await this.catalog();
    const file = this.location(record.workflowId);
    try {
      const entry = await lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new BridgeError('CORRUPT_WORKFLOW', 'Workflow metadata must be a regular file, not a link.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !exclusive) throw error;
    }
    await atomicWrite(file, text, exclusive);
  }
  private async target(project: string, file: string) {
    const target = await this.workspace.resolveForCreate(file);
    if (!within(project, target))
      throw new BridgeError(
        'WORKFLOW_SCOPE',
        'Every watched file and patch file must be inside the selected project.',
      );
    return target;
  }
  private async current(target: string, budget: { bytes: number }) {
    try {
      const resolved = await this.workspace.resolve(target);
      const before = await lstat(resolved);
      budget.bytes += before.size;
      if (budget.bytes > 64 * 1024 * 1024)
        throw new BridgeError('WORKFLOW_LIMIT', 'Watched inputs exceed the 64 MiB hashing budget.');
      const hash = await fileHash(resolved);
      const version = fingerprint(await lstat(resolved));
      if (version !== fingerprint(before))
        throw new BridgeError('FILE_CHANGED', 'Watched input changed while being checked.');
      return { hash, version };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hash: null, version: 'absent' };
      throw error;
    }
  }
  create(args: Create) {
    return this.serial.run(async () => {
      const parsed = workflowCreateSchema.safeParse(args);
      if (!parsed.success)
        throw new BridgeError(
          'INVALID_WORKFLOW',
          'Expected a project, patch ID, explicit file hashes, and 1-10 named checks.',
        );
      const value = parsed.data;
      if (Buffer.byteLength(JSON.stringify(value)) > 32 * 1024)
        throw new BridgeError('WORKFLOW_LIMIT', 'Workflow request exceeds 32 KiB.');
      const requestHash = digest(JSON.stringify(value));
      const previous = await this.load(value.workflowId);
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw new BridgeError('ID_REUSE', 'This workflow ID belongs to a different plan.');
        return { ...(await this.view(previous)), replayed: true };
      }
      const directory = await this.workspace.directory(value.project);
      const patch = await this.patches.status(value.patchOperationId);
      if (patch.direction === 'undo' || patch.state === 'undone')
        throw new BridgeError('PATCH_DIRECTION', 'Use a forward patch for a new workflow.');
      const inputs = new Map<string, z.infer<typeof input>>();
      const budget = { bytes: patch.files.reduce((sum, f) => sum + f.afterBytes, 0) };
      for (const f of patch.files) {
        const target = await this.target(directory, f.path);
        inputs.set(key(target), { path: this.workspace.relative(target), expectedHash: f.afterHash });
      }
      for (const f of value.inputs) {
        const target = await this.target(directory, f.path);
        const existing = inputs.get(key(target));
        if (existing) {
          if (existing.expectedHash !== f.expectedHash)
            throw new BridgeError(
              'WORKFLOW_INPUT_CONFLICT',
              'An explicit input disagrees with the patch after-hash.',
            );
          continue;
        }
        if ((await this.current(target, budget)).hash !== f.expectedHash)
          throw new BridgeError('CONFLICT', 'A validation input changed. Reread its hash.', { path: f.path });
        inputs.set(key(target), { path: this.workspace.relative(target), expectedHash: f.expectedHash });
      }
      if (new Set(value.checks.map((c) => c.name)).size !== value.checks.length)
        throw new BridgeError('INVALID_WORKFLOW', 'Check names must be unique.');
      const checks = [];
      for (const c of value.checks) {
        checks.push(
          c.kind === 'profile'
            ? {
                name: c.name,
                kind: c.kind,
                command: c.command,
                definition: command.parse(await this.jobs.definition(value.project, c.command)),
              }
            : {
                name: c.name,
                kind: c.kind,
                definition: command.parse({
                  executable: c.executable,
                  args: c.args,
                  timeoutSeconds: c.timeoutSeconds,
                }),
              },
        );
      }
      const plan = planSchema.parse({
        title: value.title,
        project: this.workspace.relative(directory),
        patchOperationId: value.patchOperationId,
        inputs: [...inputs.values()],
        checks,
      });
      if (Buffer.byteLength(JSON.stringify(plan)) > 32 * 1024)
        throw new BridgeError('WORKFLOW_LIMIT', 'Resolved workflow plan exceeds 32 KiB.');
      const record: RecordData = {
        schemaVersion: 1,
        workflowId: value.workflowId,
        workspaceRoot: this.workspace.root,
        requestHash,
        plan,
        planHash: digest(JSON.stringify(plan)),
        createdAt: now(),
        updatedAt: now(),
        state: 'pending',
        cancelled: false,
        attempts: checks.map(() => []),
      };
      await this.save(record, true);
      return { ...(await this.view(record)), replayed: false };
    });
  }
  private async inspect(record: RecordData) {
    const issues: { code: string; message: string; path?: string; check?: string }[] = [];
    const current: {
      path: string;
      expectedHash: string | null;
      actualHash: string | null;
      matches: boolean;
    }[] = [];
    const project = await this.workspace.directory(record.plan.project);
    const budget = { bytes: 0 };
    const versions = [];
    for (const f of record.plan.inputs) {
      try {
        const value = await this.current(await this.target(project, f.path), budget);
        const actualHash = value.hash;
        versions.push([f.path, actualHash, value.version]);
        current.push({ ...f, actualHash, matches: actualHash === f.expectedHash });
        if (actualHash !== f.expectedHash)
          issues.push({
            code: 'WORKFLOW_INPUT_CHANGED',
            message: 'Watched bytes differ from the validation plan.',
            path: f.path,
          });
      } catch (error) {
        current.push({ ...f, actualHash: null, matches: false });
        issues.push({ ...errorDetails(error), path: f.path });
      }
    }
    for (const c of record.plan.checks.filter((c) => c.kind === 'profile')) {
      try {
        if (
          JSON.stringify(await this.jobs.definition(record.plan.project, c.command!)) !==
          JSON.stringify(c.definition)
        )
          issues.push({
            code: 'WORKFLOW_COMMAND_CHANGED',
            message: 'Configured command differs from the saved definition.',
            check: c.name,
          });
      } catch (error) {
        issues.push({ ...errorDetails(error), check: c.name });
      }
    }
    return { current, issues, inputVersion: digest(JSON.stringify(versions)) };
  }
  private async job(jobId: string) {
    try {
      return await this.jobs.status(jobId);
    } catch (error) {
      if (error instanceof BridgeError && error.code === 'UNKNOWN_JOB') return null;
      throw error;
    }
  }
  private async view(record: RecordData) {
    const patch = await this.patches.status(record.plan.patchOperationId);
    const { current, issues, inputVersion } = await this.inspect(record);
    const steps = [];
    for (const [index, check] of record.plan.checks.entries()) {
      const attempts = record.attempts[index]!;
      const last = attempts.at(-1);
      const job = last ? await this.job(last.jobId) : null;
      if (last && !job && last.state !== 'starting')
        issues.push({
          code: 'WORKFLOW_JOB_MISSING',
          message: 'Recorded job evidence is missing; it will not be rerun automatically.',
          check: check.name,
        });
      if (last && (last.invalidated || last.inputVersion !== inputVersion))
        issues.push({
          code: 'WORKFLOW_VALIDATION_STALE',
          message:
            'Watched file versions changed since this attempt. Wait for its job to end, then explicitly retry this attempt against matching planned bytes.',
          check: check.name,
        });
      if (job?.errorCode === 'JOB_RECORD_SAVE_FAILED')
        issues.push({
          code: 'WORKFLOW_RESULT_UNSAVED',
          message:
            'The original result is retained by the job owner. Preserve output and resolve storage, then explicitly save it with command_retry_save before considering a new attempt.',
          check: check.name,
        });
      steps.push({ index, ...check, attempts, job });
    }
    let state: (typeof workflowStates)[number];
    if (record.cancelled) state = 'cancelled';
    else if (patch.state === 'undone') state = 'undone';
    else if (patch.direction === 'undo') state = 'blocked';
    else if (patch.state !== 'applied') state = record.attempts.some((a) => a.length) ? 'blocked' : 'pending';
    else if (issues.some((i) => i.code !== 'WORKFLOW_VALIDATION_STALE'))
      state = issues.some((i) => i.code === 'WORKFLOW_INPUT_CHANGED') ? 'stale' : 'blocked';
    else if (issues.length) state = 'failed';
    else if (steps.some((s) => s.job?.status === 'running' || s.job?.completionPending)) state = 'validating';
    else if (steps.some((s) => s.job && s.job.status !== 'passed')) state = 'failed';
    else if (
      steps.every(
        (s) => s.attempts.at(-1)?.state === 'passed' && s.job?.status === 'passed' && s.job.exitCode === 0,
      )
    )
      state = 'ready_for_review';
    else state = 'pending';
    const unsaved = steps.filter((s) => s.job?.errorCode === 'JOB_RECORD_SAVE_FAILED');
    const nextAction =
      unsaved.length && !['cancelled', 'undone'].includes(state)
        ? 'preserve later edits and command_output; resolve storage; command_retry_save for ' +
          unsaved.map((s) => s.job!.id).join(', ') +
          '; then workflow_status and workflow_resume without retryJobId to reconcile the original result'
        : state === 'ready_for_review'
          ? 'workflow_review'
          : state === 'failed'
            ? 'inspect command_output; wait for any running job; workflow_resume with retryJobId to retry this failed or invalidated attempt'
            : state === 'validating'
              ? 'wait for original job completion (including final result publication), then workflow_resume'
              : state === 'stale' || state === 'blocked'
                ? 'inspect workflow_status and patch_status; preserve later edits; create a fresh plan when inputs change'
                : state === 'pending'
                  ? 'workflow_resume'
                  : 'none';
    return {
      schemaVersion: 1 as const,
      workflowId: record.workflowId,
      title: record.plan.title,
      project: record.plan.project,
      patchOperationId: record.plan.patchOperationId,
      planHash: record.planHash,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      state,
      recordedState: record.state,
      patchState: patch.state,
      patchDirection: patch.direction,
      inputs: current,
      steps,
      issues,
      validationScope:
        'Only listed input bytes and file fingerprints; before/after checks are not a filesystem snapshot or continuous monitoring.',
      nextAction,
    };
  }
  async status(workflowId: string) {
    return this.view(await this.required(workflowId));
  }
  resume(workflowId: string, retryJobId?: string) {
    return this.serial.run(async () => {
      const record = await this.required(workflowId);
      if (record.cancelled) return this.view(record);
      // An exact old attempt is the retry token. Replaying it cannot create another job.
      if (retryJobId) {
        const previous = record.attempts.find((a) => a.some((v) => v.jobId === retryJobId));
        if (!previous)
          throw new BridgeError(
            'WORKFLOW_RETRY_MISMATCH',
            'retryJobId must name the failed attempt shown by workflow_status.',
          );
        if (previous.at(-1)?.jobId !== retryJobId) return this.view(record);
        const previousJob = await this.job(retryJobId);
        // An unsaved outcome is not permission to execute its command again.
        if (previousJob?.errorCode === 'JOB_RECORD_SAVE_FAILED')
          throw new BridgeError(
            'WORKFLOW_RESULT_UNSAVED',
            'The original job result has not been saved. Preserve command_output, resolve storage and use command_retry_save with the original job ID before retrying this check.',
          );
        if (previousJob?.completionPending && previousJob.status !== 'running')
          throw new BridgeError(
            'WORKFLOW_JOB_PENDING',
            'The original job is still stopping or publishing its final result. Inspect command_status until completionPending is false before deciding on an explicit retry. No new attempt was launched.',
            { jobId: retryJobId, nextAction: 'command_status' },
          );
        const changed =
          previous.at(-1)!.invalidated ||
          previous.at(-1)!.inputVersion !== (await this.inspect(record)).inputVersion;
        if (!previousJob || previousJob.status === 'running' || (previousJob.status === 'passed' && !changed))
          throw new BridgeError(
            'WORKFLOW_RETRY_MISMATCH',
            'Only a finished failed, cancelled, timed-out, interrupted, or invalidated attempt can be retried.',
          );
      }
      const patch = await this.patches.status(record.plan.patchOperationId);
      if (patch.direction === 'undo' || patch.state === 'undone') return this.finish(record);
      if (patch.state !== 'applied') {
        if (record.attempts.some((a) => a.length)) return this.finish(record);
        // The patch owner handles saved bytes, conflicts, and partial mutation recovery.
        await this.patches.resume(record.plan.patchOperationId);
      }
      let inspected = await this.inspect(record);
      if (inspected.issues.length) return this.finish(record);
      // A stale earlier check can need a retry while a later job is still running.
      // Preserve sequential execution and let that job finish or be cancelled first.
      for (const [index, attempts] of record.attempts.entries()) {
        const last = attempts.at(-1);
        const currentJob = last ? await this.job(last.jobId) : null;
        if (currentJob?.errorCode === 'JOB_RECORD_SAVE_FAILED') return this.finish(record);
        if (last && (currentJob?.status === 'running' || currentJob?.completionPending)) {
          if (last.state === 'starting') await this.launch(record, index, last.jobId);
          return this.finish(record);
        }
      }
      for (const index of record.plan.checks.keys()) {
        const attempts = record.attempts[index]!;
        let attempt = attempts.at(-1);
        if (attempt) {
          // Resolve an uncertain launch through the job owner's request-identity check,
          // not merely by trusting an existing record with the deterministic ID.
          if (attempt.state === 'starting') {
            if (!(await this.job(attempt.jobId))) {
              // No job journal means the owner never launched it. Refresh only this
              // unexecuted intent; previously executed attempts keep their versions.
              attempt.inputVersion = inspected.inputVersion;
              await this.save(record);
            }
            await this.launch(record, index, attempt.jobId);
          }
          const job = await this.job(attempt.jobId);
          if (!job && attempt.state !== 'starting') return this.finish(record);
          if (job) {
            // Recheck after uncertain-launch reconciliation; recovery may still be pending.
            if (job.errorCode === 'JOB_RECORD_SAVE_FAILED') return this.finish(record);
            if (job.status === 'running' || job.completionPending) return this.finish(record);
            // Check again after observing termination: a fast writer can change inputs
            // between the initial inspection and the job status read.
            inspected = await this.inspect(record);
            if (inspected.issues.length || attempt.inputVersion !== inspected.inputVersion)
              attempt.invalidated = true;
            attempt.state = job.status === 'passed' && job.exitCode !== 0 ? 'failed' : job.status;
            attempt.exitCode = job.exitCode;
            attempt.checkedAt = now();
            await this.save(record);
            if (inspected.issues.length) return this.finish(record);
            if (attempt.state === 'passed' && !attempt.invalidated) continue;
            if (retryJobId !== attempt.jobId) return this.finish(record);
            if (attempts.length >= 10)
              throw new BridgeError(
                'WORKFLOW_LIMIT',
                'Ten attempts are retained for this check. Inspect them and create a new plan.',
              );
            attempt = undefined;
          }
        }
        if (!attempt) {
          inspected = await this.inspect(record);
          if (inspected.issues.length) return this.finish(record);
          attempt = {
            jobId: jobId(workflowId, index, attempts.length),
            inputVersion: inspected.inputVersion,
            state: 'starting',
            createdAt: now(),
          };
          attempts.push(attempt);
          record.state = 'validating';
          // Persist intent before calling the durable job owner. Retry uses this exact ID.
          await this.save(record);
        }
        const job = await this.launch(record, index, attempt.jobId);
        attempt.state = job.status;
        attempt.exitCode = job.exitCode;
        await this.save(record);
        return this.finish(record);
      }
      return this.finish(record);
    });
  }
  private launch(record: RecordData, index: number, requestId: string) {
    const check = record.plan.checks[index]!;
    const definition = check.definition;
    return check.kind === 'profile'
      ? this.jobs.runPinned(record.plan.project, check.command!, definition, requestId)
      : this.jobs.terminal(
          record.plan.project,
          definition.executable,
          definition.args,
          definition.timeoutSeconds,
          requestId,
        );
  }
  private async finish(record: RecordData) {
    const result = await this.view(record);
    record.state = result.state;
    await this.save(record);
    return { ...result, recordedState: record.state, updatedAt: record.updatedAt };
  }
  cancel(workflowId: string) {
    return this.serial.run(async () => {
      const record = await this.required(workflowId);
      record.cancelled = true;
      record.state = 'cancelled';
      await this.save(record);
      for (const attempts of record.attempts) {
        const last = attempts.at(-1);
        const job = last ? await this.job(last.jobId) : null;
        if (last && (job?.status === 'running' || job?.completionPending)) await this.jobs.cancel(last.jobId);
      }
      return this.view(record);
    });
  }
  async review(workflowId: string, offset = 0, limit = 20000, tailChars = 1000) {
    const record = await this.required(workflowId);
    const status = await this.view(record);
    const diff = await this.patches.diff(record.plan.patchOperationId, offset, limit);
    const outputs = [];
    for (const attempts of record.attempts) {
      const last = attempts.at(-1);
      if (last && (await this.job(last.jobId)))
        outputs.push(await this.jobs.output(last.jobId, undefined, tailChars, 'combined', tailChars));
    }
    return { ...status, diff, outputs };
  }
  async list(options: {
    project?: string;
    path?: string;
    state?: (typeof workflowStates)[number];
    offset: number;
    limit: number;
    scanLimit: number;
  }) {
    if (
      !Number.isInteger(options.offset) ||
      options.offset < 0 ||
      options.offset > 100000 ||
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 50 ||
      !Number.isInteger(options.scanLimit) ||
      options.scanLimit < 1 ||
      options.scanLimit > 1000
    )
      throw new BridgeError(
        'INVALID_WORKFLOW_PAGE',
        'Use offset 0-100000, limit 1-50, and scanLimit 1-1000.',
      );
    const project =
      options.project === undefined
        ? undefined
        : this.workspace.relative(await this.workspace.directory(options.project));
    const file =
      options.path === undefined
        ? undefined
        : this.workspace.relative(await this.workspace.resolveForCreate(options.path));
    const { items, issues, ...page } = await historyPage({
      directory: this.directory,
      directories: false,
      offset: options.offset,
      limit: options.limit,
      scanLimit: options.scanLimit,
      load: async (workflowId) => {
        const r = await this.required(workflowId);
        if (
          (project !== undefined && key(project) !== key(r.plan.project)) ||
          (file !== undefined && !r.plan.inputs.some((f) => key(f.path) === key(file))) ||
          (options.state && options.state !== r.state)
        )
          return null;
        return {
          workflowId,
          title: r.plan.title,
          project: r.plan.project,
          patchOperationId: r.plan.patchOperationId,
          recordedState: r.state,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          checkCount: r.plan.checks.length,
        };
      },
    });
    return {
      ...page,
      workflows: items,
      issues: issues.map(({ operationId, ...error }) => ({ workflowId: operationId, ...error })),
      order: 'workflowId ascending' as const,
      stateFreshness: 'recorded; use workflow_status for current files and jobs',
    };
  }
}
